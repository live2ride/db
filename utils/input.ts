import sql, { Request as MSSQLRequest } from "mssql";
import isNumber from "lodash/isNumber";
function isFloat(n: any) {
    return !Number.isNaN(n) && n.toString().indexOf(".") !== -1;
}
const getVarcharLength = (val: any) => {
    try {
        const len = JSON.stringify(val)?.length;
        if (len > 1000) {
            return sql.MAX;
        }
        return len + 50;
    } catch {
        return 10;
    }
}
export const inputBuilder = (req?: MSSQLRequest, _key?: string, value?: any) => {
    if (typeof (value) === "function") return;

    let _value = value;
    let sqlType: any = sql.NVarChar(sql.MAX);
    let type = "NVarChar(max)";

    if (_key === "page" && !_value) {
        _value = 0;
    }
    try {
        if (value === null || value === undefined || value === "undefined" || value === "null") {
            _value = null;
            sqlType =
                sql.NVarChar(
                    40
                ); /** keep minimum length to 40 because isnull(@_date, sysdatetime()) truncates dates to this length */
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
            } else if (_value > 2047483647) {
                // this.#consoleLog("param is BigInt:::::::::::::", _key, _value);
                sqlType = sql.BigInt;
                type = "BigInt";
            } else {
                // this.#consoleLog("param is Int:::::::::::::", _key, _value);
                sqlType = sql.Int;
                type = "int";
            }
        } else if (_value instanceof Date) {

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
            const len = getVarcharLength(_value);
            sqlType = sql.NVarChar(len);
            type = `NVarChar(${len})`;
        } else if (typeof _value === "boolean") {
            /* dont use bit, use varchar instead because values true and false work with varchar  */
            // sqlType = sql.Bit;
            // type = "bit";

            _value = JSON.stringify(_value);
            sqlType = sql.NVarChar(10);
            type = "NVarChar(10)";
        } else {
            const len = getVarcharLength(_value);
            sqlType = sql.NVarChar(len);
            type = `NVarChar(${len})`;
        }

        if (req && _key) req.input(`_${_key}`, sqlType, _value);

        // this.#consoleLog("param is sqlType:::::::::::::", _key, `(${type}) = `, _value);
    } catch (e) {
        console.error("#reqInput catch value:", _value);
        console.error("#reqInput catch error:", e);

        sqlType = sql.NVarChar(sql.MAX);
        type = "NVarChar(max)";
        _value = JSON.stringify(_value);

        if (req && _key) {

            req.input(`_${_key}`, sql.NVarChar(sql.MAX), _value);
        }
    }
    return { type, value: _value };
}
