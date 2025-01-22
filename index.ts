import { Request, Response } from "express";
import find from "lodash/find";
import forEach from "lodash/forEach";

import map from "lodash/map";
import sql, { Request as MSSQLRequest } from "mssql";
import MSSQLError, { DBErrorProps } from "./classes/DBError";
import { ConfigProps, DBParam, DbProps } from "./types";
import { extractOpenJson } from "./utils/extract-openjson";
import { inputBuilder } from "./utils/input"
import { getOrderBy } from "./utils/move-orderby";
import debug from "debug";

type PlainObject = { [key: string]: any };

const isDefined = (value: any): boolean => Boolean(value);// const isDefined = (value: any): boolean => value !== undefined && value !== null;
const sleep = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isNumeric(value: string | number) {
  return /^-?\d+$/.test(String(value));
}



type UpdateResponseType = { rowsAffected: number }
type QueryParameters = { [k: string]: any }

type StorageType = {
  [key: string]: {
    primaryKey?: string,
    isIdentity?: boolean,
    columns?: { column_name: string }[],
  }
}
/** save tables metadata so we dont have to fetch from db every time,
 * implement other storage solution like redis
 */
let STORAGE: StorageType = {}

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
  async exec<T = any>(query: string, params?: QueryParameters | null, firstRecordOnly = false): Promise<T> {
    return this.#exec(query, params, firstRecordOnly);
  }
  async #exec<T = any>(query: string, params?: QueryParameters | null, firstRecordOnly = false, retryCount = 0): Promise<T> {
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
  /**
   * Retrieves the server and database name for the current database connection.
   *
   * @returns A promise that resolves to an object containing the server name and database name.
   */

  async stats() {
    const qry = 'SELECT   @@SERVERNAME AS ServerName,    DB_NAME() AS DatabaseName; '
    return await this.#exec(qry, null, true)
  }
  /**
   * Updates records in the specified table with the provided parameters.
   *
   * @param tableName - The name of the table where the records will be updated.
   * @param params - An object containing the key-value pairs to be updated.
   * @returns A promise that resolves to an object containing the number of affected rows ({rowsAffected}).
   */
  async update(tableName: string, params: QueryParameters): Promise<UpdateResponseType> {
    const qry = await this.#get.update(tableName, params)
    return this.#exec<UpdateResponseType>(qry + `\nselect @@ROWCOUNT as rowsAffected`, params, true);
  }

  /**
   * Inserts a new record into the specified table with the provided parameters.
   *
   * @param tableName - The name of the table where the record will be inserted.
   * @param params - An object containing the key-value pairs to be inserted as a new record.
   * @returns A promise that resolves to an object containing the inserted record's primary key and its value.
   */

  async insert(tableName: string, params: QueryParameters): Promise<PlainObject> {
    const qry = await this.#get.insert(tableName, params)
    return this.#exec<PlainObject>(qry, params, true);
  }

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
    fun: (row: T) => Promise<T>
  ): Promise<T> {
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

      const par = this.print.get.params(params as any)
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
  async send(req: Request, res: Response, qry: string, params?: QueryParameters | null): Promise<void> {
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

  toTEXT(req: Request, res: Response, data: QueryParameters) {
    this.#reply(req, res, data);
  }

  toJSON(req: Request, res: Response, data: QueryParameters) {
    const jsonData = JSON.stringify(data);
    this.#reply(req, res, jsonData);
  }



  #get = {
    insert: async (tableName: string, params: QueryParameters) => {
      const columns = await this.#get.matchingColumns(tableName, params, "");
      if (!columns) {
        throw new Error("Invalid table columns");
      }
      const primaryKey = await this.#get.schema.primaryKey(tableName);
      const columnsStr = columns.map(column => `@_${column}`).join(',');
      let qry = `insert into ${tableName} (${columns.join(",")}) \n`
      if (primaryKey) qry += `OUTPUT INSERTED.${primaryKey} \n`
      qry += `values (${columnsStr})`
      return qry;
    },
    update: async (tableName: string, params: QueryParameters) => {

      const primaryKey = await this.#get.schema.primaryKey(tableName);
      if (!primaryKey) throw new Error(`Table ${tableName} has no primary key`);
      const columns = await this.#get.matchingColumns(tableName, params, primaryKey);

      if (!columns) {
        throw new Error(`Table ${tableName} has no matching columns`);
      }

      const columnsStr = columns.map(column => `${column} = @_${column}`).join(',\n');
      let qry = `update ${tableName} set
      ${columnsStr}
      where ${primaryKey} = @_${primaryKey} `

      return qry

    },
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
    params: (req: MSSQLRequest, params?: QueryParameters | null): MSSQLRequest => {
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
    keys: (params: QueryParameters): DBParam[] => {
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
        const parts = String(tableName).replace("..", ".dbo.").split(".")
        const table = parts.pop()
        const schema = parts.pop()
        const catalog = parts.pop()
        return { table, schema, catalog }
      },
      primaryKey: async (tableName: string) => {
        const primaryKey = STORAGE[tableName]?.primaryKey;
        if (primaryKey) return primaryKey;


        const { table, schema, catalog } = this.#get.schema.parts(tableName);

        let qry = ``
        if (catalog) qry += `use ${catalog} \n`
        qry += `select col.column_name as column_name,
        COLUMNPROPERTY(OBJECT_ID(col.TABLE_CATALOG +'.' +col.TABLE_SCHEMA +'.'+  col.TABLE_NAME), col.COLUMN_NAME, 'IsIdentity') AS isIdentity
from information_schema.table_constraints tab 
inner join information_schema.key_column_usage col 
    on tab.constraint_name = col.constraint_name
where tab.constraint_type = 'primary key' 
and tab.table_name = @_table`
        if (schema) qry += `\nand tab.table_schema = @_schema`

        const res = await this.exec<any>(qry, { table, schema }, true) || {}

        let column_name = res.column_name;
        let isIdentity = res.isIdentity;

        if (!column_name) {
          qry = `SELECT column_name,1 as isIdentity
                  FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') = 1
                  and table_name = @_table
                  `
          if (schema) qry += `\nand table_schema = @_schema`
          let colRes = await this.#exec(qry, { table, schema }, true) || {}
          column_name = colRes.column_name
        }


        if (!STORAGE[tableName]) STORAGE[tableName] = {}
        STORAGE[tableName] = {
          ...STORAGE[tableName],
          primaryKey: column_name,
          isIdentity
        }

        return column_name;
      },
      columns: async (tableName: string): Promise<{ column_name: string }[]> => {
        const tableColumns = STORAGE[tableName]?.columns;
        if (tableColumns) return tableColumns;

        const { table, schema, catalog } = this.#get.schema.parts(tableName);

        let qry = '';
        if (catalog) qry += `use ${catalog} \n`;
        qry += `select column_name from INFORMATION_SCHEMA.columns where table_name = @_table`;
        if (schema) qry += `\nand table_schema = @_schema`;

        const res = await this.exec<{ column_name: string }[]>(qry, { table, schema });

        if (!STORAGE[tableName]) STORAGE[tableName] = {}
        STORAGE[tableName].columns = res
        return res;
      },
    },

    matchingColumns: async (tableName: string, parameters: QueryParameters, primaryKey: string): Promise<string[] | undefined> => {
      if (!parameters || Object.keys(parameters).length === 0) {
        throw new Error("Invalid parameters");
      }

      const columns = await this.#get.schema.columns(tableName);
      const matchedColumns = columns?.filter(({ column_name }) => column_name in parameters && column_name !== primaryKey);
      return matchedColumns?.map(({ column_name }) => column_name);
    },
  }





  test(qry: string, params: QueryParameters) {
    this.print.params(params);
    console.info(qry);
  }

  print = {
    get: {
      params: (params: QueryParameters) => {
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
    params: (params: QueryParameters, qry?: string) => {
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
    update: async (tableName: string, params: QueryParameters) => {
      const qry = await this.#get.update(tableName, params);
      console.info(qry);
      return qry
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
      const qry = await this.#get.insert(tableName, params);
      console.info(qry);
      return qry
    }
  }



}
