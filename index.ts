import type { Request, Response } from "express"
import type { Request as MSSQLRequest } from "mssql"

import sql from "mssql"
import debug from "debug"
import map from "lodash-es/map"
/** lodash */
import find from "lodash-es/find"
import forEach from "lodash-es/forEach"

import { inputBuilder } from "./utils/input"
import { getOrderBy } from "./utils/move-orderby"
import { parseMSSQLError } from "./utils/parse-error"
import { validateTableName } from "./utils/validate-table-name"
import {
  extractOpenJson,
  extractOpenJsonObjects,
  generateOpenJsonQueryWithClause,
} from "./utils/extract-openjson"

/** lodash */
import type { DBErrorProps } from "./classes/DBError"
import type {
  DBParam,
  DbProps,
  ConfigProps,
  ExecOptions,
  QueryParameters,
  UpdateResponseType,
} from "./types"

const isDefined = (value: any): boolean => Boolean(value) // const isDefined = (value: any): boolean => value !== undefined && value !== null;
const sleep = async (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function isNumeric(value: string | number) {
  return /^-?\d+$/.test(String(value))
}

type StorageType = {
  keys: {
    [key: string]: {
      primaryKey?: string
      isIdentity?: boolean
    }
  }
  columns: {
    [key: string]: string[]
  }
  promises: {
    [key: string]: Promise<any>
  }
}

/** save tables metadata so we dont have to fetch from db every time,
 * implement other storage solution like redis
 */
const STORAGE: StorageType = {
  keys: {},
  columns: {},
  promises: {},
}

export default class DB implements DbProps {
  private responseHeaders: string[]

  private tranHeader: string

  private pool: any

  private config: ConfigProps

  /**
   * Creates an instance of DB.
   * @typedef IConfig
   *
   * @param {string[]} [responseHeaders] - headers to be injected in express response
   * @param {string} [tranHeader] - additional transaction header which at the begining of each query. ex: "set nocount on "
   * @param {Function} [log] - your function to log to console: default condole.log but you can use colors etc...
   * @memberof DB
   */
  constructor(_config?: Partial<ConfigProps>) {
    const { responseHeaders, tranHeader, log, errors, ...rest } = _config || {}

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
    }

    // Validate required connection parameters
    this.#validateConnectionConfig()

    this.responseHeaders = responseHeaders || []
    this.tranHeader = tranHeader || `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` //  \nset nocount on; \n`;
    this.pool = null
  }

  /**
   * Validates that required connection parameters are present
   * @throws Error if required parameters are missing
   */
  #validateConnectionConfig(): void {
    const required = ['database', 'user', 'password', 'server'] as const
    const missing: string[] = []

    for (const field of required) {
      if (!this.config[field] || this.config[field].trim() === '') {
        missing.push(field)
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing required database connection parameters: ${missing.join(', ')}. ` +
        `Please provide them in the constructor or set environment variables: ` +
        missing.map(f => `DB_${f.toUpperCase()}`).join(', ')
      )
    }

    // Security warning for trustServerCertificate
    if (this.config.options?.trustServerCertificate === true) {
      console.warn(
        'WARNING: trustServerCertificate is set to true. ' +
        'This disables certificate validation and may expose you to man-in-the-middle attacks. ' +
        'Only use this setting in development environments with self-signed certificates.'
      )
    }
  }

  #reply(req: Request, res: Response, data: any) {
    if (res && res.status) {
      res?.status(200)
      if (this.responseHeaders && Array.isArray(this.responseHeaders)) {
        this.responseHeaders.forEach((h) => {
          res.setHeader(h[0], h[1])
        })
      }

      res.send(data)
    }
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
   console.info(data);
  /**
   *
   *
   * @param {string} query
   * @param {QueryParameters} [params]
   * @param {boolean} [first_row=false]
   * @return {*}  {Promise<any>}
   * @memberof DB
   */
  async exec<T = any>(
    query: string,
    params?: QueryParameters | null,
    optionsOrBoolean?: ExecOptions | boolean
  ): Promise<T> {
    return this.#exec<T>(query, params, optionsOrBoolean)
  }

  async #exec<T = any>(
    originalQuery: string,
    params?: QueryParameters | null,
    optionsOrBoolean?: ExecOptions | boolean,
    retryCount = 0
  ): Promise<T> {
    if (!this.pool) {
      const conPool = await new sql.ConnectionPool(this.config)
      this.pool = await conPool.connect()
    }

    // Normalize options (preserve old boolean behavior)
    const opts: Required<ExecOptions> = this.#normalizeExecOptions(optionsOrBoolean)

    let req: MSSQLRequest = this.pool.request()
    if (params?.limit && !params.page) params.page = 0
    req = this.#get.params(req, params)

    // Build query (suppress auto paging if returning multiple sets)
    const query = this.#get.query(
      originalQuery,
      params,
      opts.result === "sets" || opts.applyPaging === "never"
    )

    // Build header + safe ROWCOUNT wrapping
    let header = this.tranHeader
    const applyRowcount = opts.rowcountOne || opts.result === "first" || optionsOrBoolean === true

    if (applyRowcount) header += `\nSET ROWCOUNT 1;`

    const sqlText = `${header}\n${query}\n${applyRowcount ? "SET ROWCOUNT 0;" : ""}`

    try {
      const result = await req.query(sqlText)

      if (opts.result === "meta") {
        if (!opts.parse) return result as unknown as T
        // clone the recordsets with parsing applied
        const parsedSets = this.#parseRecordsets(result.recordsets)
        return {
          ...result,
          recordsets: parsedSets,
          recordset: parsedSets?.[0] ?? [],
        } as unknown as T
      }

      if (opts.result === "sets") {
        const sets = opts.parse ? this.#parseRecordsets(result.recordsets) : result.recordsets
        return sets as unknown as T
      }

      // Default to first recordset
      const rows = result.recordsets?.[0] ?? []
      const parsedRows = opts.parse ? this.#parseRows(rows) : rows

      // Handle result modes
      if (opts.result === "first" || opts.limit === 1) {
        return (parsedRows?.[0] as T) ?? (undefined as unknown as T)
      }

      // 'rows'
      return parsedRows as unknown as T
    } catch (err: any) {
      if (err.message.includes("deadlock") || err.message.includes("unknown reason")) {
        if (retryCount < 5) {
          await sleep(450)
          return this.#exec<T>(query, params, optionsOrBoolean, retryCount + 1)
        }
      }

      const hadFetchNext = (_sqlText: string): boolean => {
        return /\bFETCH\s+NEXT\b/i.test(_sqlText)
      }

      const isNextUsageError = (_err: any): boolean => {
        const msg = String(err?.message || "")
        return err?.number === 153 || msg.includes("usage of the option NEXT")
      }
      // If our module injected FETCH NEXT (or server threw 153), run the lightest original query once.
      const hadPaging = hadFetchNext(query)
      if ((hadPaging || isNextUsageError(err)) && retryCount < 1) {
        await this.#exec<T>(
          originalQuery,
          params,
          { ...opts, applyPaging: "never", rowcountOne: true }, // no OFFSET/FETCH, just ROWCOUNT 1
          retryCount + 1
        )
      }

      const error = parseMSSQLError(err, { query, params: params || {}, config: this.config })
      this.#consoleLogError(error as DBErrorProps)
      throw error
    }
  }

  /**
   * Retrieves the server and database name for the current database connection.
   *
   * @returns A promise that resolves to an object containing the server name and database name.
   */

  async stats() {
    const qry = "SELECT   @@SERVERNAME AS ServerName,    DB_NAME() AS DatabaseName; "
    return await this.#exec(qry, null, true)
  }

  /**
   * Public getter methods for retrieving database schema information
   */
  get = {
    /**
     * Retrieves the identity column name for a given table.
     *
     * @param tableName - The name of the table to retrieve the identity column for.
     * @returns A promise that resolves to the identity column name as a string, or undefined if no identity column exists.
     * @example
     * const identityCol = await db.get.identityColumn("dbo.users")
     * // Returns: "id"
     */
    identityColumn: async (tableName: string): Promise<string | undefined> => {
      const cols = await this.#get.schema.identityColumns(tableName)
      return cols?.[0]?.column_name
    },
  }

  /**
   * Updates records in the specified table with the provided parameters.
   *
   * @param tableName - The name of the table where the records will be updated.
   * @param params - An object containing the key-value pairs to be updated.
   * @returns A promise that resolves to an object containing the number of affected rows ({rowsAffected}).
   */
  async update(tableName: string, params: QueryParameters): Promise<UpdateResponseType> {
    validateTableName(tableName)
    const qry = await this.#get.update(tableName, params)

    return this.#exec<UpdateResponseType>(qry + `\nselect @@ROWCOUNT as rowsAffected`, params, true)
  }

  /**
   * Deletes records from the specified table with the provided parameters.
   * All params provided are used as filter conditions in the WHERE clause.
   *
   * @param tableName - The name of the table where the records will be deleted.
   * @param params - An object containing the key-value pairs to be used as filter conditions.
   * @returns A promise that resolves to an object containing the number of affected rows ({rowsAffected}).
   */
  async delete(tableName: string, params: QueryParameters): Promise<UpdateResponseType> {
    validateTableName(tableName)
    const qry = await this.#get.delete(tableName, params)

    return this.#exec<UpdateResponseType>(qry + `\nselect @@ROWCOUNT as rowsAffected`, params, true)
  }

  /**
   * Inserts a new record into the specified table with the provided parameters.
   *
   * @param tableName - The name of the table where the record will be inserted.
   * @param params - An object containing the key-value pairs to be inserted as a new record.
   * @returns A promise that resolves to an object containing the inserted record's primary key and its value.
   */

  async insert<T = any>(tableName: string, params: QueryParameters): Promise<T> {
    validateTableName(tableName)
    /** providing an object with identity column null fails because its trying to insert identity value
     *
     */
    const qry = await this.#get.insert(tableName, params)
    return this.#exec<T>(qry, params, true)
  }

  async where<T = any>(
    query: string,
    props: QueryParameters,
    filterFields: QueryParameters
  ): Promise<T | undefined> {
    const whereClauses: string[] = []
    if (filterFields) {
      // Check for an ORDER BY clause

      for (const [field, value] of Object.entries(filterFields)) {
        if (isDefined(value)) {
          whereClauses.push(`${field} = @_${field}`)
        }
      }
      const hasWhere = /\bWHERE\b/i.test(query)

      if (whereClauses.length > 0) {
        const additionalWhere =
          whereClauses.length > 1
            ? `(${whereClauses.join(" AND ")})` // Wrap in parentheses if more than one field
            : whereClauses.join(" AND ")

        const orderByClause = getOrderBy(query)
        if (orderByClause) {
          query = query.replace(orderByClause, "")
        }
        query += hasWhere ? ` AND ${additionalWhere}` : ` WHERE ${additionalWhere}`
        query += ` ${orderByClause || ""}`
      }
    }
    return this.exec<T>(query, { ...props, ...filterFields })
  }

  async for<T = any>(
    query: string,
    params: QueryParameters | null | undefined,
    fun: (row: T) => Promise<T>
  ): Promise<T> {
    const rows: any = await this.exec<T>(query, params)
    if (rows && rows?.length > 0) {
      for (const r of rows) {
        await fun(r)
      }
    }
    return rows
  }

  #consoleLogError(props: DBErrorProps) {
    const { number, database, qry, message, params } = props

    if (debug.enabled("db")) {
      console.info("\x1b[31m", `****************** MSSQL ERROR start ******************`)

      console.info("\x1b[31m", " -------- ", `(db:${database}):`, message, " -------- ")

      const par = this.print.get.params(params as any)
      console.info("\x1b[33m", par)
      console.info("\x1b[33m", qry)
      console.info("\x1b[31m", `****************** MSSQL ERROR end ******************`)
    }
  }

  /**
   * Must use await db.send or return db.send otherwise send gets stuck on error
   * @description Executes sql statement and send results to client
   * @param {Request} req - express request
   * @param {Response} res - express request response
   * @param {string} qry - sql server query ex: select * from table
   * @param {object} params - json object whose keys are converted to sql parameters. in sql use @_ + key. example select * from table where someid = @_myid {myid: 123}
   * @returns {Promise<void>} - array of objects
   */
  async send(
    req: Request,
    res: Response,
    qry: string,
    params?: QueryParameters | null
  ): Promise<void> {
    const data: any = await this.exec(qry, params)

    if (req.accepts("json")) {
      this.toJSON(req, res, data)
    } else if (req.accepts("text")) {
      this.toTEXT(req, res, data)
    } else if (req.accepts("html")) {
      this.toTEXT(req, res, data)
    } else if (req.accepts("xml")) {
      throw new Error("mssql feature of send function has not been implemented yet")
    } else {
      this.toJSON(req, res, data)
    }
    return data
  }

  toTEXT(req: Request, res: Response, data: QueryParameters) {
    this.#reply(req, res, data)
  }

  toJSON(req: Request, res: Response, data: QueryParameters) {
    const jsonData = JSON.stringify(data)
    this.#reply(req, res, jsonData)
  }

  #get = {
    insert: async (tableName: string, params: QueryParameters) => {
      const { isIdentity, primaryKey } =
        (await this.#get.schema.primaryKey(tableName)) || ({} as any)
      /** if column is not identity then primary key is required */
      const columns = await this.#get.matchingColumns(
        tableName,
        params,
        isIdentity ? primaryKey : undefined
      )

      if (!columns || !columns.length) {
        throw new Error(`Invalid table columns (${tableName})`)
      }

      const columnsStr = columns.map((column) => `@_${column}`).join(",")
      /** must use declare table statement for triggers to work */
      let qry = `
      DECLARE @InsertedTable TABLE (${primaryKey} nvarchar(300));
      insert into ${tableName} ([${columns.join("],[")}]) \n`
      if (primaryKey) qry += `OUTPUT INSERTED.${primaryKey} into @InsertedTable \n`
      qry += `values (${columnsStr})
      select * from @InsertedTable`
      return qry
    },
    update: async (tableName: string, params: QueryParameters) => {
      const { primaryKey } = (await this.#get.schema.primaryKey(tableName)) || ({} as any)

      if (!primaryKey) throw new Error(`Table ${tableName} has no primary key`)
      const columns = await this.#get.matchingColumns(tableName, params, primaryKey)

      if (!columns || columns.length === 0) {
        throw new Error(`Table ${tableName} has no matching columns`)
      }

      const columnsStr = columns.map((column) => `${column} = @_${column}`).join(",\n")
      const qry = `update ${tableName} set
      ${columnsStr}
      where ${primaryKey} = @_${primaryKey} `

      return qry
    },
    delete: async (tableName: string, params: QueryParameters) => {
      // Verify table has columns
      const columns = await this.#get.schema.columns(tableName)
      if (!columns?.length) throw new Error(`No columns found for table ${tableName}`)

      // All params must be in the filter (all params are filter conditions)
      const whereClauses: string[] = []
      for (const [field, value] of Object.entries(params)) {
        if (isDefined(value)) {
          // Verify the field exists in the table
          if (!columns.includes(field)) {
            throw new Error(`Column '${field}' does not exist in table ${tableName}`)
          }
          whereClauses.push(`${field} = @_${field}`)
        }
      }

      if (whereClauses.length === 0) {
        throw new Error(`No valid filter conditions provided for delete operation`)
      }

      const whereClause = whereClauses.join(" AND ")
      const qry = `delete from ${tableName}
      where ${whereClause}`

      return qry
    },
    query: (query: string, params: any, suppressPaging?: boolean) => {
      if (this.config.useOpenJson) {
        const pars = this.#get.keys(params)

        const inOpenJsonArrays = extractOpenJson(query)
        forEach(inOpenJsonArrays, (key) => {
          const o = find(pars, { key })
          if (o && Array.isArray(o.value)) {
            query = query.replace(`@_${key}`, `select value from openjson(@_${key})`)
          }
        })

        const openJsonObjects = extractOpenJsonObjects(query)
        forEach(openJsonObjects, (key) => {
          const o = find(pars, { key })
          const v = o?.value?.[0]
          if (v && typeof v === "object" && Array.isArray(o?.value)) {
            query = query.replace(
              `@_${key})`,
              `@_${key}) ${generateOpenJsonQueryWithClause(o.value, key)}`
            )
          }
        })
      }

      if (
        !suppressPaging &&
        typeof params?.limit === "number" &&
        !isNaN(Number(params?.limit)) &&
        !["fetch next"].some((s) => query.toLowerCase().includes(s)) &&
        // Avoid mixing TOP with OFFSET/FETCH which SQL Server forbids
        !/\btop\b/i.test(query) &&
        // fetch next requires order by
        ["order by"].some((s) => query.toLowerCase().includes(s))
      ) {
        query += `\nOFFSET @_page * @_limit ROWS FETCH NEXT @_limit ROWS ONLY;`
      }

      return query
    },

    params: (req: MSSQLRequest, params?: QueryParameters | null): MSSQLRequest => {
      if (params) {
        const pars = this.#get.keys(params)

        forEach(pars, (o: any) => {
          const { key, value } = o
          const _key = key
          this.#get.input(req, _key, value)
        })
      }
      return req
    },
    keys: (params: QueryParameters): DBParam[] => {
      // @ts-ignore
      return map(params, (value: string, key: string) => {
        return { key, value }
      })
    },

    input: inputBuilder,

    schema: {
      parts: (tableName: string) => {
        const parts = String(tableName).replace("..", ".dbo.").split(".")
        const table = parts.pop()
        const schema = parts.pop()
        const catalog = parts.pop()
        return { table, schema, catalog }
      },
      primaryKey: async (tableName: string) => {
        const storage = STORAGE.keys[tableName]

        if (storage) return storage

        const { table, schema, catalog } = this.#get.schema.parts(tableName)
        const catalogStr = catalog ? `${catalog}.` : ""
        let qry = ``

        qry += `select col.column_name as column_name, 
        COLUMNPROPERTY(OBJECT_ID(col.TABLE_CATALOG +'.' +col.TABLE_SCHEMA +'.'+  col.TABLE_NAME), col.COLUMN_NAME, 'IsIdentity') AS isIdentity
from ${catalogStr}information_schema.table_constraints tab 
inner join ${catalogStr}information_schema.key_column_usage col 
    on tab.constraint_name = col.constraint_name
where tab.constraint_type = 'primary key' 
and tab.table_name = @_table`
        if (schema) qry += `\nand tab.table_schema = @_schema`

        const res = (await this.exec<any>(qry, { table, schema }, true)) || {}

        let primaryKey = res.column_name
        const isIdentity = res.isIdentity

        if (!primaryKey) {
          qry = `select col.column_name as column_name,
                        COLUMNPROPERTY(OBJECT_ID(col.TABLE_CATALOG +'.' +col.TABLE_SCHEMA +'.'+  col.TABLE_NAME), col.COLUMN_NAME, 'IsIdentity') AS isIdentity
                from ${catalogStr}information_schema.table_constraints tab
                inner join ${catalogStr}information_schema.key_column_usage col
                    on tab.constraint_name = col.constraint_name
                where tab.constraint_type = 'primary key'
                  and tab.table_name = @_table
                  ${schema ? "and tab.table_schema = @_schema" : ""}
                union all 
                SELECT c.name AS column_name,c.is_identity AS isIdentity
                FROM ${catalogStr}sys.columns AS c
                  JOIN ${catalogStr}sys.tables   AS t ON c.object_id = t.object_id
                  JOIN ${catalogStr}sys.schemas  AS s ON t.schema_id  = s.schema_id
                  ${schema ? "AND s.name = @_schema" : ""}
                WHERE t.name = @_table
                  AND c.is_identity = 1
                union all 
                SELECT c.name AS identity_column, null
                FROM ${catalogStr}sys.identity_columns c
                JOIN ${catalogStr}sys.tables t ON c.object_id = t.object_id
                JOIN ${catalogStr}sys.schemas s ON t.schema_id = s.schema_id
                WHERE t.name = @_table
                ${schema ? "AND s.name = @_schema" : ""}`

          const colRes = (await this.#exec(qry, { table, schema }, true)) || {}

          primaryKey = colRes.column_name
        }

        STORAGE.keys[tableName] = {
          primaryKey,
          isIdentity,
        }

        return STORAGE.keys[tableName]
      },
      /**
       * Retrieves an array of column names for a given table.
       * The result is cached, so subsequent calls with the same table name will return the cached result.
       *
       * @param tableName - The name of the table to retrieve columns for.
       * @returns A promise that resolves to an array of column names, or undefined if the table has no columns.
       * @throws An error if the table does not exist.
       */
      columns: async (tableName: string): Promise<string[]> => {
        const storage = STORAGE.columns[tableName]
        if (storage) {
          return storage
        }

        const { table, schema, catalog } = this.#get.schema.parts(tableName)
        const catalogStr = catalog ? `${catalog}.` : ""
        let qry = `select column_name
        from ${catalogStr}INFORMATION_SCHEMA.columns
        where table_name = @_table`
        if (schema) qry += `\nand table_schema = @_schema`

        const res = await this.exec(qry, { table, schema })

        if (!res.length) {
          throw new Error(`Table ${tableName} has no columns`)
        }

        const columns = res.map((r) => r.column_name)
        STORAGE.columns[tableName] = columns // Cache the result.

        return columns
      },
      /**
       * Retrieves identity columns for a given table.
       *
       * @param tableName - The name of the table to retrieve identity columns for.
       * @returns A promise that resolves to an array of objects containing column name and identity properties.
       * @example
       * const identityCols = await db.getIdentityColumns("dbo.users")
       * // Returns: [{ column_name: "id", is_identity: 1, seed_value: 1, increment_value: 1 }]
       */
      identityColumns: async (
        tableName: string
      ): Promise<
        Array<{
          column_name: string
          is_identity: number
          seed_value: number
          increment_value: number
        }>
      > => {
        const { table, schema, catalog } = this.#get.schema.parts(tableName)
        const catalogStr = catalog ? `${catalog}.` : ""

        const qry = `
          SELECT
            c.name AS column_name,
            c.is_identity,
            CAST(ic.seed_value AS bigint) AS seed_value,
            CAST(ic.increment_value AS bigint) AS increment_value
          FROM ${catalogStr}sys.columns AS c
          JOIN ${catalogStr}sys.tables AS t ON c.object_id = t.object_id
          JOIN ${catalogStr}sys.schemas AS s ON t.schema_id = s.schema_id
          LEFT JOIN ${catalogStr}sys.identity_columns AS ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE t.name = @_table
            ${schema ? "AND s.name = @_schema" : ""}
            AND c.is_identity = 1`

        const res = await this.exec(qry, { table, schema })
        return res
      },
    },

    /**
     * Matches the columns of a specified table with the given parameters, excluding the primary key.
     *
     * @param tableName - The name of the table to check for matching columns.
     * @param parameters - An object containing the parameters to match against the table's columns.
     * @param primaryKey - (Optional) The primary key column to exclude from matching.
     * @returns A promise that resolves to an array of matched column names, or undefined if no matches are found.
     * @throws An error if the parameters are invalid or if no columns are found in the table.
     */

    matchingColumns: async (
      tableName: string,
      parameters: QueryParameters,
      primaryKey?: string
    ): Promise<string[] | undefined> => {
      if (!parameters || Object.keys(parameters).length === 0) {
        throw new Error("Invalid parameters")
      }

      const columns = await this.#get.schema.columns(tableName)
      if (!columns?.length) throw new Error(`No columns found for table ${tableName}`)

      const matchedColumns = columns?.filter(
        (column_name) => column_name in parameters && column_name !== primaryKey
      )
      if (!matchedColumns?.length)
        throw new Error(
          `No columns in table ${tableName} have been matched for with parameters ${JSON.stringify(parameters)}`
        )
      return matchedColumns
    },
  }

  test(qry: string, params: QueryParameters) {
    this.print.params(params)
    console.info(qry)
  }

  print = {
    get: {
      params: (params: QueryParameters) => {
        let declaration = "declare \n"
        let separator = ""
        const parameters = this.#get.keys(params)

        forEach(parameters, (param: any) => {
          const result = this.#get.input(undefined, param.key, param.value)
          if (result) {
            const { value, type } = result
            const formattedValue = ["int", "BigInt", "float"].includes(String(type))
              ? value
              : value === null
                ? value
                : `'${value}'`

            declaration += `  ${separator}@_${param.key} ${type} = ${formattedValue} \n`
            separator = ","
          }
        })
        return declaration
      },
    },
    /**
     * Prints params object as sql parameters for testing.
     *
     * @param {Object} params
     */
    params: (params: QueryParameters, qry?: string) => {
      const p = this.print.get.params(params)

      console.info(p)

      if (qry) console.info(this.#get.query(qry, params))
      if (debug.enabled("db:print")) {
        console.log("print.params:stack")
      }
    },
    /**
     * Prints update query to quickly match columns in table with object
     *
     * @tableName {String} Table to look up columns
     * @param {Object} params Object to match with columns
     *
     * @example
     * db.print.update("dbo.users", {id: 1, name: "John", un_matched_column: "some value"})
     * prints: update dbo.users set id = @_id, name = @_name
     */
    update: async (tableName: string, params: QueryParameters) => {
      const qry = await this.#get.update(tableName, params)

      return qry
    },
    /**
     * Prints insert query to quickly match columns in table with object
     *
     * @tableName {String} Table to look up columns
     * @param {Object} params Object to match with columns
     *
     * @example
     * db.print.insert("dbo.users", {id: 1, name: "John", un_matched_column: "some value"})
     * prints: insert into dbo.users (id, name) select (@_id, @_name)
     */
    insert: async (tableName: string, params: { [key: string]: any }) => {
      const qry = await this.#get.insert(tableName, params)

      return qry
    },
    /**
     * Prints delete query to quickly match columns in table with object
     *
     * @tableName {String} Table to look up columns
     * @param {Object} params Object to match with columns (used as filter conditions)
     *
     * @example
     * db.print.delete("dbo.users", {id: 1, status: "inactive"})
     * prints: delete from dbo.users where id = @_id AND status = @_status
     */
    delete: async (tableName: string, params: QueryParameters) => {
      const qry = await this.#get.delete(tableName, params)

      return qry
    },
  }

  #normalizeExecOptions(optionsOrBoolean?: ExecOptions | boolean): Required<ExecOptions> {
    // old boolean → 'first'
    const base: ExecOptions =
      typeof optionsOrBoolean === "boolean"
        ? { result: optionsOrBoolean ? "first" : "rows" }
        : optionsOrBoolean || {}

    return {
      result: base.result ?? "rows",
      parse: base.parse !== false,
      rowcountOne: base.rowcountOne === true,
      applyPaging: base.applyPaging ?? "auto",
      limit: base.limit ?? 0, // 0 = no limit
    }
  }

  /** Coerce one row (null→undefined, ints, JSON) */
  #coerceRow(o: any) {
    if (!o) return o
    Object.keys(o).forEach((key) => {
      const str = o[key]
      if (str === null) {
        o[key] = undefined
      } else if (typeof str === "string") {
        if (/^-?\d+$/.test(str)) {
          o[key] = Number(str)
        } else {
          try {
            const nv = JSON.parse(str)
            o[key] = nv
          } catch {
            /** */
          }
        }
      }
    })
    return o
  }

  #parseRows(rows: any[]) {
    if (!Array.isArray(rows)) return []
    for (let i = 0; i < rows.length; i++) {
      rows[i] = this.#coerceRow(rows[i])
    }
    return rows
  }

  #parseRecordsets(recordsets: any[][]) {
    if (!Array.isArray(recordsets)) return []
    return recordsets.map((set) => this.#parseRows([...set]))
  }
}
