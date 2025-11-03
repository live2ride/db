import MSSQLError from "../classes/DBError"

import type { ConfigProps, QueryParameters } from "../types"

type Options = {
  query: string
  params: QueryParameters
  config: ConfigProps
}
export const parseMSSQLError = (err: any, options: Options): MSSQLError => {
  const { query, params, config } = options || {}
  const execError = new Error(err.message)
  const info: any = {
    name: "DBError",
    number: err.number,
    state: err.state,
    class: err.class,
    lineNumber: err.lineNumber,
    serverName: err?.serverName,
    database: config.database,
    message: err.message || "Unknown database error",
    qry: query,
    params,
    stack: err?.stack || execError.stack,
  }

  const error = new MSSQLError(info)
  return error
}
