export type DBErrorProps = {
  code?: number;
  state: string;
  class: string;
  number: number;
  lineNumber: string;
  serverName: string;
  database: string;
  message: string;
  qry: string;

  params: { [key: string]: any } | null | undefined;
  // stack: any;
  stack: any;
};
export default class DBError extends Error implements DBErrorProps {
  name: string;

  code: number;

  number: number;

  state: string;

  class: string;

  lineNumber: string;

  serverName: string;

  database: string;

  message: string;

  msg: string;

  qry: string;

  params: { [key: string]: any } | null | undefined;

  stack: any;

  constructor(err: any) {
    super(err?.message || "Database error"); // (1)
    this.name = "DBError";
    this.code = 500;
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

    // Error.captureStackTrace(this, this.constructor);
  }
}
