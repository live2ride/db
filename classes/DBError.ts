export default class DBError extends Error {
  name: string;
  status_code: number;
  number: string;
  state: string;
  class: string;
  lineNumber: string;
  serverName: string;
  database: string;
  message: string;
  msg: string;
  qry: string;

  params: string;
  stack: string;

  constructor(err: any) {
    super("Database error"); // (1)
    this.name = "DBError";
    this.status_code = 500;
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
