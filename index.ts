"use strict";

import sql, { Request as MSSQLRequest } from "mssql";
import forEach from "lodash/forEach";
import isNumber from "lodash/isNumber";
import map from "lodash/map";
import MSSQLError, { DBErrorProps } from "./classes/DBError";
import { Request, Response } from "express";
import { ConfigProps, DbProps } from "./types";

function isNumeric(value: string | number) {
  return /^-?\d+$/.test(String(value));
}

function isFloat(n: any) {
  return !isNaN(n) && n.toString().indexOf(".") != -1;
}

type PlainObject = { [k: string]: any } | null | undefined;
type QueryParameters = { [k: string]: any } | null | undefined;

export default class DB implements DbProps {
  private errors: {
    print: boolean;
  };

  private responseHeaders: string[];
  private tranHeader: string;
  private pool: any;

  private config: ConfigProps;

  log: Function = console.log;

  /**
   * Creates an instance of DB.
   * @typedef IConfig
   *
   * @param {string[]} [responseHeaders] - headers to be injected in express response
   * @param {string} [tranHeader] - additional transaction header which at the begining of each query. ex: "set nocount on "
   * @param {boolean} [errors.print] - console log error query with parameters for easy troubleshooting. ( uses log function )
   * @param {Function} [log] - your function to log to console: default condole.log but you can use colors etc...
   * @memberof DB
   */
  constructor(_config?: ConfigProps) {
    const { responseHeaders, tranHeader, log, errors, ...rest } = _config || {};

    if (log) this.log = log;
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

    const isDev = ["development", "dev"].includes(String(process.env.NODE_ENV));
    this.errors = {
      print: isDev ? true : false,
      ...(errors || {}),
    };

    this.responseHeaders = responseHeaders || [];
    this.tranHeader = tranHeader || ""; // `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;  \nset nocount on; \n`;
    this.pool = null;
  }

  #reply(req: Request, res: Response, data: any) {
    res.status(200);
    if (this.responseHeaders && Array.isArray(this.responseHeaders)) {
      this.responseHeaders.forEach((h) => {
        res.setHeader(h[0], h[1]);
      });
    } else {
    }

    res.send(data);
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
   this.#consoleLog(data);
  /**
   *
   *
   * @param {string} query
   * @param {QueryParameters} [params]
   * @param {boolean} [first_row=false]
   * @return {*}  {Promise<any>}
   * @memberof DB
   */
  async exec(query: string, params?: QueryParameters, first_row = false): Promise<any> {
    if (!this.pool) {
      const conPool = await new sql.ConnectionPool(this.config);
      this.pool = await conPool.connect();
    }

    let req: MSSQLRequest = this.pool.request();

    req = this.#getDBParams(req, params);

    /**
     * we are creating stack trace here so we can see where the query originated from
     * if we use the actual error in catch block, it creates stack trace to MSSQL
     * and most likely error is in the query
     */
    const execError = new Error();
    try {
      const result = await req.query(this.tranHeader + " " + query);

      return this.#jsonParseData(result.recordset, first_row);
    } catch (err: any) {
      if (err.message.includes("deadlock") || err.message.includes("unknown reason")) {
        // retry
        return this.exec(query, params);
      }

      /** setting query error message */
      execError.message = err.message;

      let info: DBErrorProps = {
        // code: err.number === 2627 ? "primary-key-violation" : "unknown",
        number: err.number,
        state: err.state,
        class: err.class,
        lineNumber: err.lineNumber,
        serverName: err?.serverName,
        database: this.config.database,
        message: err.message || "invalid err.message execute",
        qry: query,
        params: params,

        stack: execError.stack, //+ "\n" + err.stack.split("\n").slice(0, 2).join("\n"),
        // err.stack.split("\n").slice(0, 2).join("\n") + "\n" + execError.stack,
      };

      if (this.errors?.print) {
        this.#consoleLogError(info);
      }
      throw new MSSQLError(info);
      // error.stack = execError.stack;
      // throw err;
    }
  }
  #consoleLogError(props: DBErrorProps) {
    const { number, database, qry, message, params, status_code } = props;
    let par = "";

    if (number === 2627) {
      //"primary-key-violation"
      return;
    }

    this.#consoleLog(`****************** MSSQL ERROR start ******************`);

    this.#consoleLog(" -------- ", `(db:${database}):`, message, " -------- ");
    if (params && (params.length > 0 || Object.keys(params).length > 0)) {
      let par = params;
      if (typeof params === "string") {
        try {
          par = JSON.parse(params);
        } catch {}
      }

      this.printParams(par);
    }
    this.#consoleLog(qry);
    this.#consoleLog(`****************** MSSQL ERROR end ******************`);
  }

  /**
   * @description Executes sql statement and send results to client
   * @param {Request} req - express request
   * @param {Response} res - express request response
   * @param {string} qry - sql server query ex: select * from table
   * @param {object} params - json object whose keys are converted to sql parameters. in sql use @_ + key. example select * from table where someid = @_myid {myid: 123}
   * @returns {Promise<void>} - array of objects
   */
  async send(req: Request, res: Response, qry: string, params?: PlainObject): Promise<void> {
    const data = await this.exec(qry, params);

    // if(req instanceof Request){
    if (req.accepts("json")) {
      // res.setHeader("Content-Type", "application/json");
      return this.toJSON(req, res, data);
    } else if (req.accepts("text")) {
      // res.setHeader("Content-Type", "text/plain");
      return this.toTEXT(req, res, data);
    } else if (req.accepts("html")) {
      // res.setHeader("Content-Type", "text/html");
      return this.toTEXT(req, res, data);
    } else if (req.accepts("xml")) {
      // res.setHeader("Content-Type", "application/zip");

      throw "mssql feature of send function has not been implemented yet";
    }
    // }

    this.toJSON(req, res, data);
  }

  toTEXT(req: Request, res: Response, data: PlainObject) {
    this.#reply(req, res, data);
  }

  toJSON(req: Request, res: Response, data: PlainObject) {
    let jsonData = JSON.stringify(data);
    this.#reply(req, res, jsonData);
  }

  #jsonParseData(data: PlainObject, first_row: boolean) {
    if (data && data[0]) {
      forEach(data, (o: any) => {
        //parse all the objects
        Object.keys(o).forEach((key, index) => {
          const str = o[key];

          if (str === null) {
            o[key] = undefined;
          } else if (typeof str === "string") {
            if (isNumeric(str)) {
              o[key] = Number(str);
            } else {
              try {
                const nv = JSON.parse(o[key]);
                o = Object.assign(o, { [key]: nv }); //this works in react and not in nodejs,
              } catch {}
            }
          }
        });
      });

      if (first_row) {
        return data[0];
      } else {
        return data;
      }
    } else {
      if (first_row) {
        return undefined;
      } else {
        return data;
      }
    }
  }

  #getDBParams(req: MSSQLRequest, params?: PlainObject): MSSQLRequest {
    if (params) {
      let pars = this.#getParamsKeys(params);

      forEach(pars, (o: any) => {
        const { key, value } = o;
        let _key = key;
        this.#reqInput(req, _key, value);
      });
    }
    return req;
  }
  #getParamsKeys(params: PlainObject) {
    return map(params, (value: string, key: string) => {
      let _key = `_${key}`;

      return { key: _key, value: value };
    });
  }
  #sqlVarcharLen(val: any){
    try{
      const len = JSON.stringify(val)?.length;
      if(len > 1000){
        return sql.MAX;
      }
      return len + 50;
    }catch{
      return 10;
    }
    

  }
  #reqInput(req?: MSSQLRequest, _key?: string, value?: any) {
    let _value = value;
    let sqlType, type;
    if (_key === "_page" && !_value) {
      _value = 0;
    }
    try {
      if (value === null || value === undefined) {
        _value = null;
        sqlType = sql.NVarChar(40); /** keep minimum length to 40 because isnull(@_date, sysdatetime()) truncates dates to this length */
        type = "NVarChar(40)";
      } else if (_value.toString() === "0") {
        sqlType = sql.Int;
        type = "int";
      } else if (isNumber(_value)) {
        _value = Number(_value);

        if (isFloat(_value)) {
          // this.#consoleLog("param is float:::::::::::::", _key, _value)
          sqlType = sql.Float;
          type = "float";
        } else {
          if (_value > 2047483647) {
            // this.#consoleLog("param is BigInt:::::::::::::", _key, _value);
            sqlType = sql.BigInt;
            type = "BigInt";
          } else {
            // this.#consoleLog("param is Int:::::::::::::", _key, _value);
            sqlType = sql.Int;
            type = "int";
          }
        }
      }else if (_value instanceof Date){//must come before object since date is type of object
        _value = value.toISOString().replace("T", " ");
        sqlType = sql.DateTime;
        type = "DateTime";
      } else if (typeof _value === "object" || _value instanceof Set) {
        if (_value instanceof Set) {
          _value = [...value];
        }

        _value = JSON.stringify(_value);
        sqlType = sql.NVarChar(sql.MAX);
        type = "NVarChar(max)";
      } else if (typeof _value === "string") {
        const len = this.#sqlVarcharLen(_value);
        sqlType = sql.NVarChar(len);
        type = `NVarChar(${len})`;
      } else if (typeof _value == "boolean") {
        /* dont use bit, use varchar instead because values true and false work with varchar  */
        // sqlType = sql.Bit;
        // type = "bit";

        _value = JSON.stringify(_value);
        sqlType = sql.NVarChar(10);
        type = "NVarChar(10)";
      } else {
        const len = this.#sqlVarcharLen(_value);
        sqlType = sql.NVarChar(len);
        type = `NVarChar(${len})`;
      }

      if (req && _key) req.input(_key, sqlType, _value);

      // this.#consoleLog("param is sqlType:::::::::::::", _key, `(${type}) = `, _value);
    } catch (e) {
      // this.#consoleLog("param catch", _value, e);
      if (req && _key) {
        req.input(_key, sql.NVarChar(100), _value);
      }
    }
    return { type: type, value: _value };
  }
  test(qry: string, params: PlainObject) {
    this.printParams(params);
    this.#consoleLog(qry);
  }

  /**
   * prints your object as sql parameters.
   * useful if you need to test your query in sql management studio
   *
   * @param {Object} params
   */
  printParams(params: PlainObject) {
    let p = "declare \n";

    let comma = "";
    let pars = this.#getParamsKeys(params);

    forEach(pars, (par: any) => {
      let { value, type } = this.#reqInput(undefined, par.key, par.value);
      if (value?.length > 1200) {
        value = "this value is too large....";
      }
      const strValue = ["int", "BigInt", "float"].includes(String(type))
        ? value
        : value === null
          ? value
          : `'${value}'`;
      p += `${comma} @${par.key} ${type} = ${strValue} \n`;
      comma = ",";
    });

    this.#consoleLog(p);
  }

  #consoleLog(...props: any) {
    try {
      this.log(...props);
    } catch {
      this.log = console.log;
      this.log(...props);
    }
  }
}
