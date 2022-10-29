export default class DBError extends Error {
    name: string;
    status_code: number;
    number: string;
    state: string;
    class: string;
    lineNumber: string;
    serverName: string;
    database: string;
    message: string;
    msg: string;
    qry: string;
    params: string;
    stack: string;
    constructor(err: any);
}
