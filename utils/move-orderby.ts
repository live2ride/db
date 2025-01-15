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