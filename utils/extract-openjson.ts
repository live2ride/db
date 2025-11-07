/**
 * Extracts parameter names used in SQL IN clauses from a query string.
 *
 * Identifies parameters that should be converted to OPENJSON for array handling.
 * Looks for patterns like: `IN (@_paramName)` and extracts the parameter name.
 *
 * @param input - The SQL query string to parse
 * @returns Array of parameter names found in IN clauses
 *
 * @example
 * const query = "SELECT * FROM users WHERE id IN (@_userIds) AND status IN (@_statuses)"
 * const params = extractOpenJson(query)
 * // Returns: ["userIds", "statuses"]
 */
export function extractOpenJson(input: string): string[] {
    const regex = /\b(?:in)\s*\(\s*@_(\w+)\s*\)/gi; // Match only after "in" or "openjson"

    const matches: string[] = [];
    let match: RegExpExecArray | null;

     
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1].replace("@_", "").trim());
    }
    return matches;
}




/**
 * Extracts parameter names used in OPENJSON calls without WITH clauses.
 *
 * Identifies OPENJSON parameters that need automatic WITH clause generation
 * for handling arrays of objects.
 *
 * @param input - The SQL query string to parse
 * @returns Array of parameter names used in OPENJSON without WITH
 *
 * @example
 * const query = "SELECT * FROM OPENJSON(@_userData) AS users"
 * const params = extractOpenJsonObjects(query)
 * // Returns: ["userData"]
 */
export function extractOpenJsonObjects(input: string): string[] {
    const regex = /OPENJSON\(@_(.*?)\)(?!\s*WITH)/gi;
    const matches: string[] = [];

    let match;
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1]); // Capture only the variable name inside OPENJSON(@_...)
    }

    return matches;
}

/**
 * Generates a WITH clause for OPENJSON based on the structure of the provided data.
 *
 * Automatically determines SQL data types from the first element in the array
 * and creates an appropriate WITH clause for type-safe OPENJSON queries.
 *
 * Supports both arrays of objects and arrays of primitive values.
 *
 * @param data - Array of data to analyze for type inference
 * @param fieldName - Name of the parameter field (for error messages)
 * @returns A WITH clause string ready to append to OPENJSON
 * @throws Error if data array is empty
 *
 * @example
 * // For array of objects:
 * const data = [{ id: 1, name: "John" }, { id: 2, name: "Jane" }]
 * const withClause = generateOpenJsonQueryWithClause(data, "users")
 * // Returns: "WITH(id BIGINT '$.id', name NVARCHAR(255) '$.name')"
 *
 * @example
 * // For array of primitives:
 * const data = [1, 2, 3, 4]
 * const withClause = generateOpenJsonQueryWithClause(data, "ids")
 * // Returns: "WITH(value BIGINT '$')"
 */
export const generateOpenJsonQueryWithClause = (data: any[], fieldName: string): string => {
    if (data.length === 0) {
        throw new Error("JSON data is empty.");
    }

    let withClause = "";

    if (typeof data[0] === "object" && data[0] !== null) {
        // Case: Array of Objects
        const firstObject = data[0];

        // Function to determine SQL data type
        const getSqlType = (value: any): string => {
            if (typeof value === "number") {
                return Number.isInteger(value) ? "BIGINT" : "FLOAT";
            }
            if (typeof value === "boolean") {
                return "BIT";
            }
            if (typeof value === "string") {
                return value.length > 255 ? "NVARCHAR(MAX)" : "NVARCHAR(255)";
            }
            return "NVARCHAR(MAX)"; // Default type
        };

        // Generate the WITH clause dynamically
        withClause = Object.entries(firstObject)
            .map(([key, value]) => `${key} ${getSqlType(value)} '$.${key}'`)
            .join(",\n ");
    } else {
        // Case: Array of Primitive Values
        const valueType = typeof data[0];
        let sqlType = "NVARCHAR(MAX)"; // Default

        if (valueType === "number") {
            sqlType = Number.isInteger(data[0]) ? "BIGINT" : "FLOAT";
        } else if (valueType === "boolean") {
            sqlType = "BIT";
        }

        withClause = `value ${sqlType} '$' `;
    }

    // Build the final SQL query
    return `
    WITH(
${withClause}
)
  `;
};