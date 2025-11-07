/**
 * Database library constants
 */

/**
 * Maximum value for SQL Server INT type (2^31 - 1 = 2,147,483,647)
 * Values larger than this should use BIGINT instead
 */
export const SQL_INT_MAX = 2147483647;

/**
 * Default number of retry attempts for deadlock errors
 */
export const DEFAULT_DEADLOCK_RETRIES = 5;

/**
 * Delay in milliseconds between deadlock retry attempts
 */
export const DEADLOCK_RETRY_DELAY_MS = 450;

/**
 * Default connection pool configuration
 */
export const DEFAULT_POOL_CONFIG = {
  /** Maximum number of connections in the pool */
  max: 100,
  /** Minimum number of connections in the pool */
  min: 0,
  /** Time in milliseconds before closing idle connections */
  idleTimeoutMillis: 30000,
} as const;

/**
 * Minimum varchar length for NULL values to prevent date truncation
 * SQL Server's ISNULL function can truncate dates if the parameter is too short
 */
export const MIN_VARCHAR_LENGTH_FOR_NULL = 40;

/**
 * Threshold for using NVARCHAR(MAX) instead of fixed length
 */
export const VARCHAR_MAX_THRESHOLD = 1000;
