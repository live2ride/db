/**
 * Validates SQL Server table names to prevent SQL injection.
 *
 * Accepts:
 * - Simple names: tableName
 * - Schema qualified: schema.tableName
 * - Fully qualified: database.schema.tableName
 * - Default schema: database..tableName
 * - Temporary tables: #tempTable, ##globalTempTable
 *
 * @param tableName - The table name to validate
 * @throws Error if the table name contains invalid characters
 */
export function validateTableName(tableName: string): void {
  if (!tableName || typeof tableName !== 'string') {
    throw new Error('Table name must be a non-empty string');
  }

  // Allow alphanumeric, underscore, dot, hash (for temp tables), and brackets for quoted identifiers
  const validPattern = /^[a-zA-Z0-9_#.\[\]]+$/;

  if (!validPattern.test(tableName)) {
    throw new Error(
      `Invalid table name: "${tableName}". Table names can only contain letters, numbers, underscores, dots, and hash symbols for temp tables.`
    );
  }

  // Split by dots to validate each part
  const parts = tableName.split('.');

  if (parts.length > 3) {
    throw new Error(
      `Invalid table name: "${tableName}". Maximum format is database.schema.table`
    );
  }

  // Validate each part (database, schema, table)
  for (const part of parts) {
    if (part === '') {
      // Allow empty schema (e.g., database..table)
      continue;
    }

    // Check for SQL injection patterns
    const dangerousPatterns = [
      /;/,           // Statement terminator
      /--/,          // Comment
      /\/\*/,        // Block comment start
      /\*\//,        // Block comment end
      /'/,           // String delimiter
      /"/,           // String delimiter (unless part of bracketed identifier)
      /xp_/i,        // Extended stored procedures
      /sp_/i,        // System stored procedures (in parts, to be cautious)
      /exec/i,       // Execute command
      /execute/i,    // Execute command
      /drop/i,       // Drop command
      /truncate/i,   // Truncate command
      /alter/i,      // Alter command
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(part)) {
        throw new Error(
          `Invalid table name: "${tableName}". Contains potentially dangerous pattern in "${part}"`
        );
      }
    }
  }
}
