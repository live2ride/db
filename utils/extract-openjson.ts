export function extractOpenJson(input: string): string[] {
    const regex = /\b(?:in)\s*\(\s*@_(\w+)\s*\)/gi; // Match only after "in" or "openjson"

    const matches: string[] = [];
    let match: RegExpExecArray | null;

     
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1].replace("@_", "").trim());
    }
    return matches;
}




export function extractOpenJsonObjects(input: string): string[] {
    const regex = /OPENJSON\(@_(.*?)\)(?!\s*WITH)/gi;
    const matches: string[] = [];

    let match;
    while ((match = regex.exec(input)) !== null) {
        matches.push(match[1]); // Capture only the variable name inside OPENJSON(@_...)
    }

    return matches;
}

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