"use strict";
const sql = require("mssql");
const log = require("@live2ride/log");
const forEach = require("lodash/forEach");
const isNumber = require("lodash/isNumber");
const map = require("lodash/map");

class DBError extends Error {
  constructor(err) {
    super("Database error"); // (1)

    this.code = err?.code;
    this.number = err?.number;
    this.state = err?.state;
    this.class = err?.class;
    this.lineNumber = err?.lineNumber;
    this.serverName = err?.serverName;
    this.database = err?.database;
    this.message = err?.message;
    this.msg = err?.message;
    this.qry = err?.qry;

    this.params = err?.params;
    this.stack = err?.stack;

    Error.captureStackTrace(this, this.constructor);
  }
}

function isNumeric(value) {
  return /^-?\d+$/.test(value);
}

function isFloat(n) {
  return !isNaN(n) && n.toString().indexOf(".") != -1;
}

function status(headers) {
  function success(req, res, data = null) {
    send(req, res, 200, data);
  }
  function error(req, res, err) {
    const { code, message } = err || {};
    send(req, res, code || 500, { message: message || "unknown" });
  }

  function send(req, res, code, data) {
    if (res.headersSent) {
      return;
    }

    res.status(code);
    if (headers && Array.isArray(headers)) {
      headers.forEach((h) => {
        res.setHeader(h[0], h[1]);
      });
    }

    res.setHeader("Content-Type", "text/json");

    res.send(data);
  }

  return {
    success,
    error,
  };
}

module.exports = class DB {
  constructor(_config) {
    const { responseHeaders, errors, ...rest } = _config;
    const isDev = ["development", "dev"].includes(process.env.NODE_ENV);
    this.errors = {
      print: isDev ? true : false,
      includeInResponse: isDev ? true : false,
      ...(errors || {}),
    };
    this.config = {
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      options: {
        parseJSON: true,
        encrypt: false, // for azure
        trustServerCertificate: false, // change to true for local dev / self-signed certs
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
      ...rest,
    };

    this.responseHeaders = responseHeaders;
    this.tranHeader = _config.tranHeader || ""; // `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;  \nset nocount on; \n`;
    this.pool = null;
  }
  #reply(req, res, data = null) {
    status(this.responseHeaders).success(req, res, data);
  }

  #errorReply(req, res, err) {
    let badRequest = new Error("BAD_REQUEST");
    badRequest.code = 400;

    status(this.responseHeaders).error(
      req,
      res,
      this.errors.includeInResponse ? err : badRequest
    );
  }
  async exec(qry, params = [], first_row = false) {
    if (!this.pool) {
      const conPool = await new sql.ConnectionPool(this.config);
      this.pool = await conPool.connect();
    }

    let req = new sql.Request();
    req = this.#getDBParams(req, params);

    try {
      const result = await this.pool.query(this.tranHeader + " " + qry);

      return this.#jsonParseData(result.recordset, first_row);
    } catch (err) {
      if (
        err.message.includes("deadlock") ||
        err.message.includes("unknown reason")
      ) {
        // retry
        return this.exec(qry, params);
      }
      let info = {
        // code: err.number === 2627 ? "primary-key-violation" : "unknown",
        number: err.number,
        state: err.state,
        class: err.class,
        lineNumber: err.lineNumber,
        serverName: err?.serverName,
        database: this.config.database,
        message: err.message || "invalid err.message execute",
        qry: qry,
        params: params,
        // stack: Error().stack.split("\n"),
      };

      if (this.errors?.print) {
        this.#consoleLogError(info);
      }

      throw new DBError(info);
    }
  }

  #consoleLogError(props) {
    const { databse, qry, message, params, code, database } = props;
    let par = "";

    if (props.number === 2627) {
      //"primary-key-violation"
      return;
    }

    log.warning(`****************** MSSQL ERROR start ******************`);
    log.warning(" -------- ", `(db:${databse}):`, message, " -------- ");
    if (params && (params.length > 0 || Object.keys(params).length > 0)) {
      let par = params;
      if (typeof params === "string") {
        try {
          par = JSON.parse(params);
        } catch {}
      }

      this.printParams(par);
    }
    log.warning(qry);
    log.warning(`****************** MSSQL ERROR end ******************`);
  }

  send(req, res, qry, params) {
    this.exec(qry, params)
      .then((data) => {
        if (req.accepts("json")) {
          this.toJSON(req, res, data);
        } else if (req.accepts("text")) {
          this.toTEXT(req, res, data);
        } else if (req.accepts("html")) {
          this.toTEXT(req, res, data);
        } else if (req.accepts("xml")) {
          throw "mssql feature of send function has not been implemented yet";
        } else {
          this.toJSON(req, res, data);
        }
      })
      .catch((err) => {
        this.#errorReply(req, res, err);
      });
  }
  sendQry(req, res, qry, params) {
    this.send(req, res, qry, params);
  }
  toTEXT(req, res, data) {
    this.#reply(req, res, data);
  }

  toJSON(req, res, data) {
    let jsonData = JSON.stringify(data);
    this.#reply(req, res, jsonData);
  }

  #jsonParseData(data, first_row) {
    if (data && data[0]) {
      forEach(data, (o) => {
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

  #getDBParams(req, params) {
    let pars = this.#getParamsKeys(params);

    forEach(pars, (o) => {
      const { key, value } = o;
      let _key = key;
      this.#reqInput(req, _key, value);
    });

    return req;
  }
  #getParamsKeys(params) {
    return map(params, (value, key) => {
      let _key = `_${key}`;

      return { key: _key, value: value };
    });
  }
  #reqInput(req, _key, value) {
    let _value = value;
    let sqlType, type;
    if (_key === "_page" && !_value) {
      _value = 0;
    }
    try {
      if (value === null || value === undefined) {
        _value = null;
        sqlType = sql.NVarChar(11);
        type = "NVarChar(11)";
      } else if (_value.toString() === "0") {
        sqlType = sql.Int;
        type = "int";
      } else if (isNumber(_value)) {
        _value = Number(_value);

        if (isFloat(_value)) {
          // console.log("param is float:::::::::::::", _key, _value)
          sqlType = sql.Float;
          type = "float";
        } else {
          if (_value > 2047483647) {
            // console.log("param is BigInt:::::::::::::", _key, _value);
            sqlType = sql.BigInt;
            type = "BigInt";
          } else {
            // console.log("param is Int:::::::::::::", _key, _value);
            sqlType = sql.Int;
            type = "int";
          }
        }
      } else if (typeof _value === "object" || _value instanceof Set) {
        if (_value instanceof Set) {
          _value = [...value];
        }

        _value = JSON.stringify(_value);
        sqlType = sql.NVarChar(sql.MAX);
        type = "NVarChar(max)";
      } else if (typeof _value === "string") {
        sqlType = sql.NVarChar(JSON.stringify(_value).length + 20);
        type = `NVarChar(${JSON.stringify(_value).length + 20})`;
      } else if (typeof _value == "boolean") {
        /* dont use bit, use varchar instead  */

        // sqlType = sql.Bit;
        // type = "bit";

        _value = JSON.stringify(_value);
        sqlType = sql.NVarChar(10);
        type = "NVarChar(10)";
      } else if (_value instanceof Date) {
        sqlType = sql.DateTime;
        type = "DateTime";
      } else {
        sqlType = sql.NVarChar(JSON.stringify(_value).length + 10);
        type = `NVarChar(${JSON.stringify(_value).length + 10})`;
      }

      if (req) req.input(_key, sqlType, _value);

      // console.log("param is sqlType:::::::::::::", _key, `(${type}) = `, _value);
    } catch (e) {
      // console.log("param catch", _value, e);
      req.input(_key, sql.NVarChar(100), _value);
    }
    return { type: type, value: _value };
  }
  test(qry, params) {
    this.printParams(params);
    log.cyan(qry);
  }
  printParams(params) {
    let p = "declare \n";

    let comma = "";
    let pars = this.#getParamsKeys(params);

    forEach(pars, (par) => {
      let { value, type } = this.#reqInput(undefined, par.key, par.value);
      if (value?.length > 1200) {
        value = "this value is too large....";
      }
      const strValue = ["int", "BigInt", "float"].includes(type)
        ? value
        : value === null
        ? value
        : `'${value}'`;
      p += `${comma} @${par.key} ${type} = ${strValue} \n`;
      comma = ",";
    });

    log.warning(p);
  }
};
