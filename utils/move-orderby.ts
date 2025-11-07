/**
 * Extracts the last ORDER BY clause from a SQL query.
 *
 * Useful for manipulating queries that need ORDER BY repositioned
 * (e.g., when adding pagination or additional WHERE clauses).
 *
 * @param query - The SQL query string to parse
 * @returns The last ORDER BY clause found, or undefined if none exists
 *
 * @example
 * const query = "SELECT * FROM users WHERE active = 1 ORDER BY created_date DESC"
 * const orderBy = getOrderBy(query)
 * // Returns: "ORDER BY created_date DESC"
 */
export const getOrderBy = (query: string): string | undefined => {
    const orderByMatches = [...query.matchAll(/\bORDER BY\b.*/gi)];

    // Check if there are any "ORDER BY" clauses
    if (orderByMatches.length > 0) {
        // Get the last ORDER BY match
        const lastOrderByMatch = orderByMatches[orderByMatches.length - 1];

        // Extract the last ORDER BY clause
        const lastOrderByClause = lastOrderByMatch[0];

        // Remove the last ORDER BY clause from the query
        // query = query.replace(lastOrderByClause, '').trim();
        return lastOrderByClause;
    }
    // return query
}