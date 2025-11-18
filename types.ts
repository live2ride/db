import type { Request, Response } from "express"

export type PlainObject = Record<string, unknown>

export type ConnectionOptions = {
  parseJSON?: boolean
  encrypt?: boolean
  trustServerCertificate?: boolean
  [key: string]: unknown
}

export type PoolOptions = {
  max?: number
  min?: number
  idleTimeoutMillis?: number
  acquireTimeoutMillis?: number
  createTimeoutMillis?: number
  destroyTimeoutMillis?: number
  reapIntervalMillis?: number
  propagateCreateError?: boolean
  [key: string]: unknown
}

export type ConfigProps = {
  database: string
  user: string
  password: string
  server: string
  options?: ConnectionOptions

  log?: (...args: unknown[]) => void
  responseHeaders?: string[]
  tranHeader?: string
  useOpenJson?: boolean
  pool?: PoolOptions
  config?: ConfigProps
  errors?: {
    print: boolean
  }
}

export type ExecResultMode = "first" | "rows" | "sets" | "meta"

export type ExecOptions = {
  /** How to shape the return. Default: 'rows' */
  result?: ExecResultMode
  /** Toggle JSON/number coercion. Default: true */
  parse?: boolean
  /** Force SET ROWCOUNT 1 wrapper */
  rowcountOne?: boolean
  /** Auto pagination appender */
  applyPaging?: "auto" | "never"
  limit?: number
}

export type DbPrint = {
  get: {
    params: (params: PlainObject) => string
  }
  params: (params: PlainObject, qry?: string) => void
  update: (tableName: string, params: PlainObject) => Promise<string>
  insert: (tableName: string, params: PlainObject) => Promise<string>
}

export type IsolationLevel =
  | "READ UNCOMMITTED"
  | "READ COMMITTED"
  | "REPEATABLE READ"
  | "SERIALIZABLE"
  | "SNAPSHOT"

export type TransactionHooks = {
  onBegin?: (txId: string) => void | Promise<void>
  onCommit?: (txId: string, duration: number) => void | Promise<void>
  onRollback?: (txId: string, error: any, duration: number) => void | Promise<void>
}

export type TransactionOptions = {
  isolationLevel?: IsolationLevel
  name?: string
  timeout?: number
  maxRetries?: number
  retryDelay?: number
  retryBackoff?: number
  hooks?: TransactionHooks
}

export type TransactionInfo = {
  id: string
  name?: string
  startTime: Date
  isolationLevel?: IsolationLevel
  isActive: boolean
}

export type TransactionCallback<T> = (tx: DbProps) => Promise<T>

export type DbProps = {
  exec: <T = unknown>(
    query: string,
    params?: PlainObject | null,
    optionsOrBoolean?: ExecOptions | boolean
  ) => Promise<T>
  send: (req: Request, res: Response, qry: string, params?: PlainObject | null) => Promise<void>
  transaction: <T = unknown>(callback: TransactionCallback<T>, options?: TransactionOptions) => Promise<T>
  update: (tableName: string, params: PlainObject) => Promise<UpdateResponseType>
  delete: (tableName: string, params: PlainObject) => Promise<UpdateResponseType>
  insert: <T = unknown>(tableName: string, params: PlainObject) => Promise<T>
  where: <T = unknown>(query: string, props: PlainObject, filterFields: PlainObject) => Promise<T | undefined>
  for: <T = unknown>(query: string, params: PlainObject | null | undefined, fun: (row: T) => Promise<T>) => Promise<T>
  savepoint?: (name: string) => Promise<void>
  rollbackTo?: (name: string) => Promise<void>
  releaseSavepoint?: (name: string) => Promise<void>
  getTransactionInfo?: () => TransactionInfo | undefined
  print: DbPrint
}

export type DBParam = {
  key: string
  value: unknown
}

export type UpdateResponseType = { rowsAffected: number }
export type QueryParameters = { [k: string]: any }
