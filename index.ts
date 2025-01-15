import { Request, Response } from "express";
import find from "lodash/find";
import forEach from "lodash/forEach";

import map from "lodash/map";
import sql, { Request as MSSQLRequest } from "mssql";
import MSSQLError, { DBErrorProps } from "./classes/DBError";
import { ConfigProps, DBParam, DbProps } from "./types";
import { extractOpenJson } from "./utils/extract-openjson";
import { inputBuilder } from "./utils/input"
import { getOrderBy } from "src/modules/db/utils/move-orderby";
import debug from "debug";


const isDefined = (value: any): boolean => Boolean(value);// const isDefined = (value: any): boolean => value !== undefined && value !== null;
const sleep = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isNumeric(value: string | number) {
  return /^-?\d+$/.test(String(value));
}



type PlainObject = { [k: string]: any } | null | undefined;
type QueryParameters = { [k: string]: any } | null | undefined;

export default class DB implements DbProps {

  private responseHeaders: string[];

  private tranHeader: string;

  private pool: any;

  private config: ConfigProps;



  /**
   * Creates an instance of DB.
   * @typedef IConfig
   *
   * @param {string[]} [responseHeaders] - headers to be injected in express response
   * @param {string} [tranHeader] - additional transaction header which at the begining of each query. ex: "set nocount on "
   * @param {Function} [log] - your function to log to console: default condole.log but you can use colors etc...
   * @memberof DB
   */
  constructor(_config?: Partial<ConfigProps>) {
    const { responseHeaders, tranHeader, log, errors, ...rest } = _config || {};


    this.config = {
      database: process.env.DB_DATABASE || "",
      user: process.env.DB_USER || "",
      password: process.env.DB_PASSWORD || "",
      server: process.env.DB_SERVER || "",
      options: {
        parseJSON: true,
        encrypt: false, // for azure
        trustServerCertificate: false, // change to true for local dev / self-signed certs
      },
      pool: {
        max: 100,
        min: 0,
        idleTimeoutMillis: 30000,
      },
      ...rest,
    };




    this.responseHeaders = responseHeaders || [];
    this.tranHeader = tranHeader || `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`; //  \nset nocount on; \n`;
    this.pool = null;
  }



  #reply(req: Request, res: Response, data: any) {
    if (res && res.status) {
      res?.status(200);
      if (this.responseHeaders && Array.isArray(this.responseHeaders)) {
        this.responseHeaders.forEach((h) => {
          res.setHeader(h[0], h[1]);
        });

      }

      res.send(data);
    }
  }

  /**
   * @description Simple function which adds params (json object) as parameters to sql then executes sql query and returns results
   * @param {string} query - Sql query
   * @param {Object} params - json object with values whose keys are converted into (@_ + key)  ex: {id: 123} id = @_id
   * @param {boolean} first_row - return only first row as object
   * @returns {Promise<void>} - array of objects
   * @example 
   let qry = `select * from dbo.myTable where id = @_id and type = @_type
   let data = await db.exec(qry, {id: 123, type: "some type"})
   console.info(data);
  /**
   *
   *
   * @param {string} query
   * @param {QueryParameters} [params]
   * @param {boolean} [first_row=false]
   * @return {*}  {Promise<any>}
   * @memberof DB
   */
  async exec<T = any>(query: string, params?: QueryParameters, firstRecordOnly = false): Promise<T> {
    return this.#exec(query, params, firstRecordOnly);
  }
  async #exec<T = any>(query: string, params?: QueryParameters, firstRecordOnly = false, retryCount = 0): Promise<T> {
    if (!this.pool) {
      const conPool = await new sql.ConnectionPool(this.config);
      this.pool = await conPool.connect();
    }

    let req: MSSQLRequest = this.pool.request();
    if (params?.limit && !params.page) params.page = 0

    req = this.#get.params(req, params);

    /** replace  and id in (@_id) with  and id in (select value from openjson(@_id)) */
    query = this.#get.query(query, params)


    /**
     * we are creating stack trace here so we can see where the query originated from
     * if we use the actual error in catch block, it creates stack trace to MSSQL
     * and most likely error is in the query
     */

    try {
      let header = this.tranHeader;

      if (firstRecordOnly) header += `\nset rowcount 1`

      const result = await req.query(`${header} \n ${query}`);

      return this.#get.parsedJson<T>(result.recordset, firstRecordOnly) as T
    } catch (err: any) {

      if (err.message.includes("deadlock") || err.message.includes("unknown reason")) {
        // retry
        if (retryCount < 5) {
          await sleep(150)
          return this.#exec<T>(query, params, firstRecordOnly, retryCount + 1);
        }
      }
      const execError = new Error();
      /** setting query error message */
      execError.message = err.message;

      const info: DBErrorProps = {
        // code: err.number === 2627 ? "primary-key-violation" : "unknown",
        number: err.number,
        state: err.state,
        class: err.class,
        lineNumber: err.lineNumber,
        serverName: err?.serverName,
        database: this.config.database,
        message: err.message || "invalid err.message",
        qry: query,
        params,

        stack: execError.stack, // + "\n" + err.stack.split("\n").slice(0, 2).join("\n"),
        // err.stack.split("\n").slice(0, 2).join("\n") + "\n" + execError.stack,
      };


      this.#consoleLogError(info);

      throw new MSSQLError(info);
      // error.stack = execError.stack;
      // throw err;
    }
  }

  // The `where` function builds and executes the query

  async where<T = any>(
    query: string,
    props: QueryParameters,
    filterFields: QueryParameters
  ): Promise<T | undefined> {

    const whereClauses: string[] = [];
    if (filterFields) {
      // Check for an ORDER BY clause


      for (const [field, value] of Object.entries(filterFields)) {
        if (isDefined(value)) {
          whereClauses.push(`${field} = @_${field}`);
        }
      }
      const hasWhere = /\bWHERE\b/i.test(query);

      if (whereClauses.length > 0) {
        const additionalWhere =
          whereClauses.length > 1
            ? `(${whereClauses.join(' AND ')})` // Wrap in parentheses if more than one field
            : whereClauses.join(' AND ');

        const orderByClause = getOrderBy(query);
        if (orderByClause) {
          query = query.replace(orderByClause, '');
        }
        query += hasWhere
          ? ` AND ${additionalWhere}`
          : ` WHERE ${additionalWhere}`;
        query += ` ${orderByClause || ""}`


      }

    }
    return this.exec<T>(query, { ...props, ...filterFields })
  }

  async for<T = any>(query: string,
    params: QueryParameters | null | undefined,
    fun: (row: any) => Promise<T>
  ): Promise<any> {
    const rows: any = await this.exec<T>(query, params);
    if (rows && rows?.length > 0) {
      for (const r of rows) {
        await fun(r);
      }
    }
    return rows;
  }

  #consoleLogError(props: DBErrorProps) {
    const { number, database, qry, message, params, } = props;


    if ([2627, 2601].includes(number)) {
      // 2627 "primary-key-violation"
      // 2601 "duplicate-key"
      // console.info("consoleLogError includes return", );
      return;
    }
    if (debug.enabled("db")) {
      console.info("\x1b[31m", `****************** MSSQL ERROR start ******************`);

      console.info("\x1b[31m", " -------- ", `(db:${database}):`, message, " -------- ");

      const par = this.print.get.params(params)
      console.info("\x1b[33m", par);
      console.info("\x1b[33m", qry);
      console.info("\x1b[31m", `****************** MSSQL ERROR end ******************`);
    }

  }

  /**
   * Must use await db.send or return db.send otherwise send gets stuck on error
   * @description Executes sql statement and send results to client
   * @param {Request} req - express request
   * @param {Response} res - express request response
   * @param {string} qry - sql server query ex: select * from table
   * @param {object} params - json object whose keys are converted to sql parameters. in sql use @_ + key. example select * from table where someid = @_myid {myid: 123}
   * @returns {Promise<void>} - array of objects
   */
  async send(req: Request, res: Response, qry: string, params?: PlainObject): Promise<void> {
    const data: any = await this.exec(qry, params);

    // if(req instanceof Request){
    if (req.accepts("json")) {
      // res.setHeader("Content-Type", "application/json");
      this.toJSON(req, res, data);
    } else if (req.accepts("text")) {
      // res.setHeader("Content-Type", "text/plain");
      this.toTEXT(req, res, data);
    } else if (req.accepts("html")) {
      // res.setHeader("Content-Type", "text/html");
      this.toTEXT(req, res, data);
    } else if (req.accepts("xml")) {
      // res.setHeader("Content-Type", "application/zip");

      throw new Error("mssql feature of send function has not been implemented yet");
    } else {
      this.toJSON(req, res, data);
    }
    // }
    return data;

  }

  toTEXT(req: Request, res: Response, data: PlainObject) {
    this.#reply(req, res, data);
  }

  toJSON(req: Request, res: Response, data: PlainObject) {
    const jsonData = JSON.stringify(data);
    this.#reply(req, res, jsonData);
  }



  #get = {
    query: (query: string, params: any) => {
      const arrays = extractOpenJson(query)

      if (arrays.length > 0) {
        const pars = this.#get.keys(params);

        forEach(arrays, (key) => {
          const o = find(pars, { key })
          if (o && Array.isArray(o.value)) {
            query = query.replace(`@_${key}`, `select value from openjson(@_${key})`)
          }
        })
      }



      if (typeof params?.limit === 'number' && !isNaN(Number(params?.limit))
        && !query.includes("fetch next")
      ) {
        query += `\nOFFSET @_page * @_limit ROWS FETCH NEXT @_limit ROWS ONLY;`
      }

      return query;
    },
    params: (req: MSSQLRequest, params?: PlainObject): MSSQLRequest => {
      if (params) {

        const pars = this.#get.keys(params);

        forEach(pars, (o: any) => {
          const { key, value } = o;
          const _key = key;
          this.#get.input(req, _key, value);
        });
      }
      return req;
    },
    keys: (params: PlainObject): DBParam[] => {
      // @ts-ignore
      return map(params, (value: string, key: string) => {
        return { key, value };
      })
    },

    input: inputBuilder,
    parsedJson: <T = any>(data: T, firstRecordOnly: boolean): T | undefined => {
      if (data && data[0]) {
        forEach(data, (o: any) => {
          // parse all the objects
          Object.keys(o).forEach((key) => {
            const str = o[key];

            if (str === null) {
              o[key] = undefined;
            } else if (typeof str === "string") {
              if (isNumeric(str)) {
                o[key] = Number(str);
              } else {
                try {
                  const nv = JSON.parse(o[key]);
                  o = Object.assign(o, { [key]: nv });
                } catch {/** */ }
              }
            }
          });
        });

        if (firstRecordOnly) {
          return data[0];
        }
        return data;

      }
      if (firstRecordOnly) {
        return undefined;
      }
      return data;


    },

    schema: {
      parts: (tableName: string) => {
        const cleanTableName = tableName.replace("..", ".dbo.")
        const parts = String(tableName).split(".")
        const table = parts.pop()
        const schema = parts.pop()
        const catalog = parts.pop()
        return { table, schema, catalog }
      },
      primaryKey: async (tableName: string) => {
        const { table, schema, catalog } = this.#get.schema.parts(tableName);


        let qry = ``
        if (catalog) qry += `use ${catalog} \n`
        qry += `select col.column_name as column_name
from information_schema.table_constraints tab 
inner join information_schema.key_column_usage col 
    on tab.constraint_name = col.constraint_name
where tab.constraint_type = 'primary key' 
and tab.table_name = @_table`
        if (schema) qry += `\nand tab.table_schema = @_schema`
        const { column_name } = await this.exec<any>(qry, { table, schema }, true) || {}
        return column_name;
      },
      columns: async (tableName: string) => {
        const { table, schema, catalog } = this.#get.schema.parts(tableName);

        let qry = ``
        if (catalog) qry += `use ${catalog} \n`
        qry += `select column_name 
from INFORMATION_SCHEMA.columns
where table_name = @_table`
        if (schema) qry += `\nand table_schema = @_schema`
        return this.exec<{ column_name: string }[]>(qry, { table, schema })
      },
    },

    matchingColumns: async (tableName: string, params: PlainObject) => {
      if (!params || Object.keys(params).length === 0) {
        throw new Error("Invalid params")
      }

      const columns = await this.#get.schema.columns(tableName)
      if (columns) {
        const matchingColumns = columns.filter(column => column.column_name in params);
        return matchingColumns.map(c => c.column_name)
      }
      return undefined
    }
  }





  test(qry: string, params: PlainObject) {
    this.print.params(params);
    console.info(qry);
  }

  print = {
    get: {
      params: (params: PlainObject) => {
        let declaration = "declare \n";
        let separator = "";
        const parameters = this.#get.keys(params);

        forEach(parameters, (param: any) => {
          const result = this.#get.input(undefined, param.key, param.value);
          if (result) {
            const { value, type } = result;
            const formattedValue = ["int", "BigInt", "float"].includes(String(type))
              ? value
              : value === null
                ? value
                : `'${value}'`;

            declaration += `  ${separator}@_${param.key} ${type} = ${formattedValue} \n`;
            separator = ",";
          }
        });
        return declaration;
      }
    },
    /**
   * Prints params object as sql parameters for testing.
   *
   * @param {Object} params
   */
    params: (params: PlainObject, qry?: string) => {
      const p = this.print.get.params(params);

      console.info(p);

      if (qry) console.info(this.#get.query(qry, params));
    },
    /**
   * Prints update query to quickly match columns in table with object
   *
   * @tableName {String} Table to look up columns
   * @param {Object} params Object to match with columns
   * 
   * @example 
    * db.print.update("dbo.users", {id: 1, name: "John", un_matched_column: "some value"})
    * prints: update dbo.users set id = @_id, name = @_name
   */
    update: async (tableName: string, params: { [key: string]: any }) => {
      const columns = await this.#get.matchingColumns(tableName, params);
      const primaryKey = await this.#get.schema.primaryKey(tableName);

      if (columns) {
        const columnsStr = columns.map(column => `${column} = @_${column}`).join(',\n');
        const qry = `update ${tableName} set \n${columnsStr}\n where ${primaryKey} = @_${primaryKey}`

        console.info(qry);
        return qry
      }
    },
    /**
    * Prints insert query to quickly match columns in table with object
    *
    * @tableName {String} Table to look up columns
    * @param {Object} params Object to match with columns
    * 
    * @example 
    * db.print.insert("dbo.users", {id: 1, name: "John", un_matched_column: "some value"})
    * prints: insert into dbo.users (id, name) select (@_id, @_name)
    */
    insert: async (tableName: string, params: { [key: string]: any }) => {
      const columns = await this.#get.matchingColumns(tableName, params);

      if (columns) {
        const columnsStr = columns.map(column => `@_${column}`).join(',');
        const qry = `insert into ${tableName} (${columns.join(",")})\nselect ${columnsStr}`
        console.info(qry);
        return qry
      }
    }
  }



}
