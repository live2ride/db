"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var _DB_instances, _DB_reply, _DB_consoleLogError, _DB_jsonParseData, _DB_getDBParams, _DB_getParamsKeys, _DB_reqInput;
import sql from "mssql";
import forEach from "lodash/forEach";
import isNumber from "lodash/isNumber";
import map from "lodash/map";
import MSSQLError from "./classes/DBError";
function isNumeric(value) {
    return /^-?\d+$/.test(String(value));
}
function isFloat(n) {
    return !isNaN(n) && n.toString().indexOf(".") != -1;
}
export default class DB {
    constructor(_config) {
        _DB_instances.add(this);
        this.config = {
            database: process.env.DB_DATABASE,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            server: process.env.DB_SERVER || "",
        };
        const _a = _config || {}, { responseHeaders, errors } = _a, rest = __rest(_a, ["responseHeaders", "errors"]);
        this.config = Object.assign(Object.assign({}, this.config), rest);
        const isDev = ["development", "dev"].includes(String(process.env.NODE_ENV));
        this.errors = Object.assign({ print: isDev ? true : false }, (errors || {}));
        this.responseHeaders = responseHeaders;
        this.tranHeader = (_config === null || _config === void 0 ? void 0 : _config.tranHeader) || ""; // `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;  \nset nocount on; \n`;
        this.pool = null;
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
     console.log(data);
     */
    exec(query, params, first_row = false) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pool) {
                const conPool = yield new sql.ConnectionPool(this.config);
                this.pool = yield conPool.connect();
            }
            let req = this.pool.request();
            req = __classPrivateFieldGet(this, _DB_instances, "m", _DB_getDBParams).call(this, req, params);
            try {
                const result = yield req.query(this.tranHeader + " " + query);
                return __classPrivateFieldGet(this, _DB_instances, "m", _DB_jsonParseData).call(this, result.recordset, first_row);
            }
            catch (err) {
                if (err.message.includes("deadlock") ||
                    err.message.includes("unknown reason")) {
                    // retry
                    return this.exec(query, params);
                }
                let info = {
                    // code: err.number === 2627 ? "primary-key-violation" : "unknown",
                    number: err.number,
                    state: err.state,
                    class: err.class,
                    lineNumber: err.lineNumber,
                    serverName: err === null || err === void 0 ? void 0 : err.serverName,
                    database: this.config.database,
                    message: err.message || "invalid err.message execute",
                    qry: query,
                    params: params,
                    // stack: Error().stack.split("\n"),
                };
                if ((_a = this.errors) === null || _a === void 0 ? void 0 : _a.print) {
                    __classPrivateFieldGet(this, _DB_instances, "m", _DB_consoleLogError).call(this, info);
                }
                throw new MSSQLError(info);
            }
        });
    }
    /**
     * @description Executes sql statement and send results to client
     * @param {Request} req - express request
     * @param {Response} res - express request response
     * @param {string} qry - sql server query ex: select * from table
     * @param {object} params - json object whose keys are converted to sql parameters. in sql use @_ + key. example select * from table where someid = @_myid {myid: 123}
     * @returns {Promise<void>} - array of objects
     */
    send(req, res, qry, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.exec(qry, params);
            // if(req instanceof Request){
            if (req.accepts("json")) {
                return this.toJSON(req, res, data);
            }
            else if (req.accepts("text")) {
                return this.toTEXT(req, res, data);
            }
            else if (req.accepts("html")) {
                return this.toTEXT(req, res, data);
            }
            else if (req.accepts("xml")) {
                throw "mssql feature of send function has not been implemented yet";
            }
            // }
            this.toJSON(req, res, data);
        });
    }
    toTEXT(req, res, data) {
        __classPrivateFieldGet(this, _DB_instances, "m", _DB_reply).call(this, req, res, data);
    }
    toJSON(req, res, data) {
        let jsonData = JSON.stringify(data);
        __classPrivateFieldGet(this, _DB_instances, "m", _DB_reply).call(this, req, res, jsonData);
    }
    test(qry, params) {
        this.printParams(params);
        console.log(qry);
    }
    /**
     * prints your object as sql parameters.
     * useful if you need to test your query in sql management studio
     *
     * @param {Object} params
     */
    printParams(params) {
        let p = "declare \n";
        let comma = "";
        let pars = __classPrivateFieldGet(this, _DB_instances, "m", _DB_getParamsKeys).call(this, params);
        forEach(pars, (par) => {
            let { value, type } = __classPrivateFieldGet(this, _DB_instances, "m", _DB_reqInput).call(this, undefined, par.key, par.value);
            if ((value === null || value === void 0 ? void 0 : value.length) > 1200) {
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
        console.log(p);
    }
}
_DB_instances = new WeakSet(), _DB_reply = function _DB_reply(req, res, data) {
    res.status(200);
    if (this.responseHeaders && Array.isArray(this.responseHeaders)) {
        this.responseHeaders.forEach((h) => {
            res.setHeader(h[0], h[1]);
        });
    }
    res.setHeader("Content-Type", "text/json");
    res.send(data);
}, _DB_consoleLogError = function _DB_consoleLogError(props) {
    const { databse, qry, message, params, code, database } = props;
    let par = "";
    if (props.number === 2627) {
        //"primary-key-violation"
        return;
    }
    console.log(`****************** MSSQL ERROR start ******************`);
    console.log(" -------- ", `(db:${databse}):`, message, " -------- ");
    if (params && (params.length > 0 || Object.keys(params).length > 0)) {
        let par = params;
        if (typeof params === "string") {
            try {
                par = JSON.parse(params);
            }
            catch (_a) { }
        }
        this.printParams(par);
    }
    console.log(qry);
    console.log(`****************** MSSQL ERROR end ******************`);
}, _DB_jsonParseData = function _DB_jsonParseData(data, first_row) {
    if (data && data[0]) {
        forEach(data, (o) => {
            //parse all the objects
            Object.keys(o).forEach((key, index) => {
                const str = o[key];
                if (str === null) {
                    o[key] = undefined;
                }
                else if (typeof str === "string") {
                    if (isNumeric(str)) {
                        o[key] = Number(str);
                    }
                    else {
                        try {
                            const nv = JSON.parse(o[key]);
                            o = Object.assign(o, { [key]: nv }); //this works in react and not in nodejs,
                        }
                        catch (_a) { }
                    }
                }
            });
        });
        if (first_row) {
            return data[0];
        }
        else {
            return data;
        }
    }
    else {
        if (first_row) {
            return undefined;
        }
        else {
            return data;
        }
    }
}, _DB_getDBParams = function _DB_getDBParams(req, params) {
    let pars = __classPrivateFieldGet(this, _DB_instances, "m", _DB_getParamsKeys).call(this, params);
    forEach(pars, (o) => {
        const { key, value } = o;
        let _key = key;
        __classPrivateFieldGet(this, _DB_instances, "m", _DB_reqInput).call(this, req, _key, value);
    });
    return req;
}, _DB_getParamsKeys = function _DB_getParamsKeys(params) {
    return map(params, (value, key) => {
        let _key = `_${key}`;
        return { key: _key, value: value };
    });
}, _DB_reqInput = function _DB_reqInput(req, _key, value) {
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
        }
        else if (_value.toString() === "0") {
            sqlType = sql.Int;
            type = "int";
        }
        else if (isNumber(_value)) {
            _value = Number(_value);
            if (isFloat(_value)) {
                // console.log("param is float:::::::::::::", _key, _value)
                sqlType = sql.Float;
                type = "float";
            }
            else {
                if (_value > 2047483647) {
                    // console.log("param is BigInt:::::::::::::", _key, _value);
                    sqlType = sql.BigInt;
                    type = "BigInt";
                }
                else {
                    // console.log("param is Int:::::::::::::", _key, _value);
                    sqlType = sql.Int;
                    type = "int";
                }
            }
        }
        else if (typeof _value === "object" || _value instanceof Set) {
            if (_value instanceof Set) {
                _value = [...value];
            }
            _value = JSON.stringify(_value);
            sqlType = sql.NVarChar(sql.MAX);
            type = "NVarChar(max)";
        }
        else if (typeof _value === "string") {
            sqlType = sql.NVarChar(JSON.stringify(_value).length + 20);
            type = `NVarChar(${JSON.stringify(_value).length + 20})`;
        }
        else if (typeof _value == "boolean") {
            /* dont use bit, use varchar instead  */
            // sqlType = sql.Bit;
            // type = "bit";
            _value = JSON.stringify(_value);
            sqlType = sql.NVarChar(10);
            type = "NVarChar(10)";
        }
        else if (_value instanceof Date) {
            sqlType = sql.DateTime;
            type = "DateTime";
        }
        else {
            sqlType = sql.NVarChar(JSON.stringify(_value).length + 10);
            type = `NVarChar(${JSON.stringify(_value).length + 10})`;
        }
        if (req)
            req.input(_key, sqlType, _value);
        // console.log("param is sqlType:::::::::::::", _key, `(${type}) = `, _value);
    }
    catch (e) {
        // console.log("param catch", _value, e);
        req.input(_key, sql.NVarChar(100), _value);
    }
    return { type: type, value: _value };
};
