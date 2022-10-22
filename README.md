# Description

Simple way to interact with MS SQL Server(MSSQL)

### Config

```javascript
const dbConfig = {
  database: "master",
  user: "demo user",
  password: "demo password",
  server: 192.168.0.1,
};
const db = new DB(dbConfig);

```

##### Alternatively you can set variables in your env file

```javascript
.env {
  DB_DATABASE=my-database-name
  DB_USER=demo-user
  DB_PASSWORD=demo-password
  DB_SERVER=server-name
}
const db = new DB();
```

#### Other config options

**tranHeader**: transaction header. string added before each query.
**responseHeaders**: array of headers added to response when using db.send
**errors**:

- **print**: prints errors in console with statement prepared for testing. true in development
- **includeInResponse**: include errors in response when using db.send. true in development

```javascript
example:
const dbConfig = {
  tranHeader: "set nocount on;",
  errors:{
    print: true,
    includeInResponse: true,
  },
  responseHeaders: [
      ["Access-Control-Allow-Origin", "*"],
      ["Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE"],
  ];
};
```

### Usage

exec: executes query with parameters and returns results;

```javascript
await db.exec(
  query: any sql statement
  parameters: (json object) ,
  first_row_only: default false
    * true returns json object
    * false returns array of objects
)
```

## Examples

### Create table

```javascript
let qry = `
    create table dbo.test (
        id int identity, 
        num int, 
        text nvarchar(100), 
        obj nvarchar(300)
    )
`;
await db.exec(qry);
```

### Insert data into table

```javascript
let qry = `
    insert into dbo.test (text) 
    select @_text
`;
let params = {
  text: "keys are converted into paramters (@_ + key)",
};

await db.exec(qry, params);

let qry = `
    insert into dbo.test (num, text, obj) 
    select @_num, @_text, @_obj 
`;
let params = {
  num: 123,
  text: "add '@_' for each key you want to use in your query ",
  obj: {
    message: "im an object",
  },
};
await db.exec(qry, params);
```

#

### Select from table

##### results are always an array of records in json format.

```javascript
let qry = "select * from dbo.test where id = @_id";
let params = { id: 1 };

await db.exec(qry, params);
console.log(res);

results: [
  {
    id: 1,
    num: undefined,
    text: "add '@_' for each key you want to use in your query ",
    obj: undefined,
  },
  {
    id: 2,
    num: 123,
    text: "add '@_' for each key you want to use in your query ",
    obj: { message: "im an object" },
  },
];
```

#

##### Select first row

```javascript
const first_row_only = true
let res = await db.exec("select * from dbo.test", null, first_row_only);
console.log(res);

result:
 {
    id: 1,
    num: undefined,
    text: "add '@_' for each key you want to use in your query ",
    obj: undefined
  },
```

#

#

## Using with express?

```javascript
const express = require("express");
const asyncHandler = require("your/asyncHandler");
const router = express.Router();


    router.get("/pow",
      asyncHandler(async (req, res) => {
          let qry = `select name from dbo.table where id = @_id`
          let params = { id = 100 }

          db.send(req, res, qry, params);
        })
  );
```

db.send sends the data back to client

#

#

## Troubleshooting

### Print errors

```javascript
const config = {
  printErrors: true,
};
const db = new DB(config);
let qry = `select top 2 hello, world from dbo.testTable`;
let params = {
  par: "parameter value",
};
db.exec(qry, params);
```

##### result:

```javascript
****************** MSSQL ERROR start ******************
--------  (db:dev): Invalid object name 'dbo.testTable'.  --------
declare
@_par NVarChar(37) = 'parameter value'

select top 2 hello, world from dbo.testTable
****************** MSSQL ERROR end ******************

```

### db.printParams

```javascript
const params = {
    num: 123,
    text: "add '@_' for each key you want to use in your query ",
    obj: {
      message: "im an object",
    },
  };

  db.printParams(params);

  prints to console:
  declare
     @_num int = 123
    , @_text NVarChar(74) = 'add '@_' for each key you want to use in your query '
    , @_obj NVarChar(max) = '{"message":"im an object"}'
```
