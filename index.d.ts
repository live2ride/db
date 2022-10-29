import { Request, Response } from "express";
declare type PlainObject = {
    [k: string]: any;
};
export default class DB {
    #private;
    errors: {
        print: false;
    };
    responseHeaders: string;
    tranHeader: string;
    pool: any;
    config: any;
    constructor(_config?: PlainObject);
    /**
     * @description Simple function which adds params (json object) as parameters to sql then executes sql query and returns results
     * @param {string} query - Sql query
     * @param {Object} params - json object with values whose keys are converted into (@_ + key)  ex: {id: 123} id = @_id
     * @param {boolean} first_row - return only first row as object
     * @returns {Promise<void>} - array of objects
     * @example
     let qry = `select * from dbo.myTable where id = @_id and type = @_type
     let data = await db.exec(qry, {id: 123, type: "some type"})
     console.log(data);
     */
    exec(query: string, params?: PlainObject, first_row?: boolean): Promise<any>;
    /**
     * @description Executes sql statement and send results to client
     * @param {Request} req - express request
     * @param {Response} res - express request response
     * @param {string} qry - sql server query ex: select * from table
     * @param {object} params - json object whose keys are converted to sql parameters. in sql use @_ + key. example select * from table where someid = @_myid {myid: 123}
     * @returns {Promise<void>} - array of objects
     */
    send(req: Request, res: Response, qry: string, params: PlainObject): Promise<void>;
    toTEXT(req: Request, res: Response, data: PlainObject): void;
    toJSON(req: Request, res: Response, data: PlainObject): void;
    test(qry: string, params: PlainObject): void;
    /**
     * prints your object as sql parameters.
     * useful if you need to test your query in sql management studio
     *
     * @param {Object} params
     */
    printParams(params: PlainObject): void;
}
export {};
