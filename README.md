Give me the cleaned-up version of the README in Markdown, without explanations or additional comments. Format your response in Markdown syntax so I can paste it into a .md file without modification.
README:


# Description

Simple way to interact with MS SQL Server (MSSQL).

### Config

```javascript
const dbConfig = {
  database: "database",
  user: "user",
  password: "password",
  server: "192.168.0.1",
};
const db = new DB(dbConfig);
```

##### Alternatively, you can set variables in your `.env` file

```env
DB_DATABASE=my-database-name
DB_USER=demo-user
DB_PASSWORD=demo-password
DB_SERVER=server-name
```

```javascript
const db = new DB();
```

#### Other Config Options

- **tranHeader**: Transaction header. String added before each query.
- **responseHeaders**: Array of headers added to response when using `db.send`.
- **errors**:
  - **print**: Prints errors in console with statement prepared for testing. `true` in development.

```javascript
const dbConfig = {
  tranHeader: "set nocount on;",
  errors: {
    print: true,
    includeInResponse: true,
  },
  responseHeaders: [
    ["Access-Control-Allow-Origin", "*"],
    ["Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE"],
  ],
};
```

### Usage

**exec**: Executes a query with parameters and returns results.

```javascript
await db.exec(
  query, // string (any SQL statement)
  parameters, // Javascript object or array
  first_row_only // boolean (default false)
);
```

## Examples

#### Following params will be used in examples below
```javascript
let params = {
  num: 123,
  text: "add '@_' for each key you want to use in your query",
  obj: {
    message: "I'm an object",
  },
};
```

### Create Table
```javascript
let qry = `
  CREATE TABLE dbo.test (
    id INT IDENTITY, 
    num INT, 
    text NVARCHAR(100), 
    obj NVARCHAR(300)
  )
`;
await db.exec(qry);
```


### Select from Table

Results are always an array of records in JSON format.

```javascript
let qry = "SELECT * FROM dbo.test WHERE id = @_id";
let params = { id: 1 };

let res = await db.exec(qry, params);
 
output:
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
];
```

OR

```javascript
await db.for(qry, {}, async (row) => {
  console.log(row.id);
});
```

```javascript
let qry = "SELECT * FROM dbo.test WHERE id IN (@_ids)";
let params = { ids: [1, 2, 3] };
```

#### Select First Row

```javascript
const first_row_only = true;
let res = await db.exec("SELECT * FROM dbo.test", null, first_row_only);

output:
{
  id: 1,
  num: undefined,
  text: "add '@_' for each key you want to use in your query",
  obj: undefined,
},
```

## Using with Express

```javascript
const express = require("express");
const expressAsyncHandler = require("your/expressAsyncHandler");
const router = express.Router();

router.get(
  "/some-route",
  expressAsyncHandler(async (req, res) => {
    let qry = `SELECT name FROM dbo.table WHERE id = @_id`;
    let params = { id: 100 };

    db.send(req, res, qry, params);
  })
);
```

`db.send` sends the data back to the client.

## Troubleshooting

### Print Errors

```javascript
const config = {
  printErrors: true,
};
const db = new DB(config);


let qry = `SELECT TOP 2 hello, world FROM dbo.testTable`;
db.exec(qry, params);

output:
****************** MSSQL ERROR start ******************
 --------  (db:XYZ): Invalid object name 'dbo.textTable'.  -------- 
declare
 @_num int = 123
, @_text NVarChar(103) = 'add '@_' for each key you want to use in your query'
, @_obj NVarChar(max) = '{"message":"I'm an object"}'

select * from dbo.textTable
****************** MSSQL ERROR end ******************
```
  

### Print parameters
```javascript
db.print.params(params);
 
Prints to console:
DECLARE
  @_num INT = 123,
  @_text NVARCHAR(74) = 'add '@_' for each key you want to use in your query',
  @_obj NVARCHAR(MAX) = '{"message":"I'm an object"}'
```
 
### Generate insert statement
matches all params keys with columns in table and generates insert statement

```javascript
await db.print.insert("test", params)

output:
insert into test (num,text,obj)
select @_num,@_text,@_obj
```
### Generate update statement
```javascript
await db.print.update("test", params)

output: 
update test set 
    num = @_num,
    text = @_text,
    obj = @_obj
where SOME_VALUE

```