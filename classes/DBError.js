export default class DBError extends Error {
    constructor(err) {
        super("Database error"); // (1)
        this.name = "DBError";
        this.status_code = 500;
        this.number = err === null || err === void 0 ? void 0 : err.number;
        this.state = err === null || err === void 0 ? void 0 : err.state;
        this.class = err === null || err === void 0 ? void 0 : err.class;
        this.lineNumber = err === null || err === void 0 ? void 0 : err.lineNumber;
        this.serverName = err === null || err === void 0 ? void 0 : err.serverName;
        this.database = err === null || err === void 0 ? void 0 : err.database;
        this.message = err === null || err === void 0 ? void 0 : err.message;
        this.msg = err === null || err === void 0 ? void 0 : err.message;
        this.qry = err === null || err === void 0 ? void 0 : err.qry;
        this.params = err === null || err === void 0 ? void 0 : err.params;
        this.stack = err === null || err === void 0 ? void 0 : err.stack;
        Error.captureStackTrace(this, this.constructor);
    }
}
