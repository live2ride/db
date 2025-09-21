import type { Request, Response } from "express";

export type PlainObject = Record<string, unknown>;

export type ConnectionOptions = {
  parseJSON?: boolean;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  [key: string]: unknown;
};

export type PoolOptions = {
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  acquireTimeoutMillis?: number;
  createTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
  reapIntervalMillis?: number;
  propagateCreateError?: boolean;
  [key: string]: unknown;
};

export type ConfigProps = {
  database: string;
  user: string;
  password: string;
  server: string;
  options?: ConnectionOptions;

  log?: (...args: unknown[]) => void;
  responseHeaders?: string[];
  tranHeader?: string;
  useOpenJson?: boolean;
  pool?: PoolOptions;
  config?: ConfigProps;
  errors?: {
    print: boolean;
  };
};

export type ExecResultMode = "first" | "rows" | "sets" | "meta";

export type ExecOptions = {
  /** How to shape the return. Default: 'rows' */
  result?: ExecResultMode;
  /** Toggle JSON/number coercion. Default: true */
  parse?: boolean;
  /** Force SET ROWCOUNT 1 wrapper */
  rowcountOne?: boolean;
  /** Auto pagination appender */
  applyPaging?: "auto" | "never";
  limit?: number;
};

export type DbPrint = {
  get: {
    params: (params: PlainObject) => string;
  };
  params: (params: PlainObject, qry?: string) => void;
  update: (tableName: string, params: PlainObject) => Promise<string>;
  insert: (tableName: string, params: PlainObject) => Promise<string>;
};

export type DbProps = {
  exec: <T = unknown>(
    query: string,
    params?: PlainObject | null,
    optionsOrBoolean?: ExecOptions | boolean
  ) => Promise<T>;
  send: (
    req: Request,
    res: Response,
    qry: string,
    params?: PlainObject | null
  ) => Promise<void>;
  print: DbPrint;
};

export type DBParam = {
  key: string;
  value: unknown;
};
