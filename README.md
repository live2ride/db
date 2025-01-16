# MS SQL Server Interaction Library

A straightforward JavaScript library for interacting with MS SQL Server (MSSQL).

## Table of Contents

- [Parameters in Examples](#parameters-in-examples)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Direct Configuration](#direct-configuration)
  - [Environment Variables](#environment-variables)
  - [Additional Configuration Options](#additional-configuration-options)
- [Usage](#usage)
  - [Executing Queries](#executing-queries)
- [Examples](#examples)
  - [Create Table](#create-table)
  - [Select from Table](#select-from-table)
  - [Select First Row](#select-first-row)
- [Integration with Express](#integration-with-express)
- [Troubleshooting](#troubleshooting)
  - [Print Errors](#print-errors)
  - [Print Parameters](#print-parameters)
  - [Generate Insert Statement](#generate-insert-statement)
  - [Generate Update Statement](#generate-update-statement)

## Parameters in Examples

When using this library, parameters are defined as key-value pairs. Prefix each key with `@_` when referencing them in your SQL queries.

```javascript
const params = {
  num: 123,
  text: "add '@_' for each key you want to use in your query",
  obj: {
    message: "I'm an object",
  },
};
```

## Quick Start

Here's a short example demonstrating basic operations such as executing queries, inserting, and updating records.

```javascript
await db.exec('SELECT * FROM dbo.test WHERE num = @_num', { num: 1 });
await db.exec('SELECT * FROM dbo.test WHERE num IN (@_nums)', { nums: [1, 2, 3] });
await db.insert("dbo.test", { num: 1, obj: { key: "value" } });
await db.update("dbo.test", { num: 1, obj: { key: "value2" } });
```

## Configuration

### Direct Configuration

You can configure the database connection directly by passing a configuration object when initializing the `DB` instance.

```javascript
const dbConfig = {
  database: "your-database",
  user: "your-username",
  password: "your-password",
  server: "192.168.0.1",
};

const db = new DB(dbConfig);
```

### Environment Variables

Alternatively, you can set your configuration parameters in a `.env` file for better security and flexibility.

```env
DB_DATABASE=your-database-name
DB_USER=your-username
DB_PASSWORD=your-password
DB_SERVER=your-server-name
```

Initialize the `DB` instance without passing any parameters, and it will automatically use the environment variables.

```javascript
const db = new DB();
```

### Additional Configuration Options

You can further customize the behavior of the library using additional configuration options:

- **tranHeader**: A transaction header string added before each query.
- **responseHeaders**: An array of headers to include in responses when using `db.send`.

```javascript
const dbConfig = {
  tranHeader: "SET NOCOUNT ON;",
  responseHeaders: [
    ["Access-Control-Allow-Origin", "*"],
    ["Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE"],
  ],
};

const db = new DB(dbConfig);
```

## Usage

### Executing Queries

Use the `exec` method to execute SQL queries with parameters. It returns the query results in array format.

```javascript
await db.exec(
  query,         // String: Any valid SQL statement
  parameters,    // Object or Array: { key1: "value1" } or ["value1", "value2"]
  firstRowOnly   // Boolean (optional): If true, returns only the first row (default is false)
);
```

## Examples

### Create Table

Create a new table named `dbo.test` with various columns.

```javascript
const createTableQuery = `
  CREATE TABLE dbo.test (
    id INT IDENTITY PRIMARY KEY, 
    num INT, 
    text NVARCHAR(100), 
    obj NVARCHAR(300)
  )
`;

await db.exec(createTableQuery);
```

### Select from Table

Retrieve records from the `dbo.test` table. The results are returned as an array of JSON objects.

```javascript
const selectQuery = "SELECT * FROM dbo.test WHERE id = @_id";
const params = { id: 1 };

const results = await db.exec(selectQuery, params);

console.log(results);
/*
[
  {
    id: 1,
    num: undefined,
    text: "add '@_' for each key you want to use in your query",
    obj: undefined,
  },
  {
    id: 2,
    num: 123,
    text: "add '@_' for each key you want to use in your query",
    obj: { message: "I'm an object" },
  },
]
*/
```

Alternatively, you can iterate over the results using the `for` method:

```javascript
await db.for(selectQuery, { id: 1 }, async (row) => {
  console.log(row.id);
});
```

For queries with multiple IDs:

```javascript
const multiSelectQuery = "SELECT * FROM dbo.test WHERE id IN (@_ids)";
const multiParams = { ids: [1, 2, 3] };

const multiResults = await db.exec(multiSelectQuery, multiParams);
```

### Select First Row

Retrieve only the first row from a query result by setting the `firstRowOnly` parameter to `true`.

```javascript
const firstRowOnly = true;
const firstRow = await db.exec("SELECT * FROM dbo.test", null, firstRowOnly);

console.log(firstRow);
/*
{
  id: 1,
  num: undefined,
  text: "add '@_' for each key you want to use in your query",
  obj: undefined,
}
*/
```

## Integration with Express

Integrate the library with an Express.js server to handle database operations within your routes.

```javascript
const express = require("express");
const expressAsyncHandler = require("your/expressAsyncHandler"); // Replace with your actual async handler
const router = express.Router();

router.get(
  "/some-route",
  expressAsyncHandler(async (req, res) => {
    const query = `SELECT name FROM dbo.table WHERE id = @_id`;
    const params = { id: 100 };

    db.send(req, res, query, params);
  })
);

module.exports = router;
```

The `db.send` method sends the query results back to the client.

## Troubleshooting

### Print Errors

Enable detailed error logging to help debug issues.

**Using the `debug` library:**

```javascript
import debug from "debug";
debug.enable("db");

// Your database operations
const db = new DB(config);

const query = `SELECT TOP 2 hello, world FROM dbo.testTable`;
db.exec(query, params);

/*
Output:
****************** MSSQL ERROR start ******************
 --------  (db:XYZ): Invalid object name 'dbo.textTable'. -------- 
DECLARE
  @_num INT = 123,
  @_text NVARCHAR(103) = 'add '@_' for each key you want to use in your query',
  @_obj NVARCHAR(MAX) = '{"message":"I'm an object"}'
  
SELECT * FROM dbo.textTable
****************** MSSQL ERROR end ******************
*/
```

**Or set the `DEBUG` environment variable in your `.env` file:**

```env
DEBUG=db
```

### Print Parameters

View the parameters being sent with your queries for verification.

```javascript
db.print.params(params);

/*
Console Output:
DECLARE
  @_num INT = 123,
  @_text NVARCHAR(74) = 'add '@_' for each key you want to use in your query',
  @_obj NVARCHAR(MAX) = '{"message":"I'm an object"}'
*/
```

### Generate Insert Statement

Automatically generate an `INSERT` statement that matches the parameter keys with the table columns.

```javascript
await db.print.insert("test", params);

/*
Output:
INSERT INTO test (num, text, obj)
SELECT @_num, @_text, @_obj
*/
```

### Generate Update Statement

Automatically generate an `UPDATE` statement based on the provided parameters.

```javascript
await db.print.update("test", params);

/*
Output:
UPDATE test SET 
  num = @_num,
  text = @_text,
  obj = @_obj
WHERE SOME_VALUE
*/
```

---
 