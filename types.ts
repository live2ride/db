export type PlainObject = { [key: string]: any };
export type ConfigProps = {
  database: string;
  user: string;
  password: string;
  server: string;
  options?: any;

  log?: Function;
  responseHeaders?: string[];
  tranHeader?: string;
  useOpenJson?: boolean;
  pool?: any;
  config?: ConfigProps;
  errors?: {
    print: boolean;
  };
};
export type DbProps = {

  exec: Function;
  send: Function;
  print: {
    params: Function;
    insert: Function;
    update: Function;
  }

};

export type DBParam = {
  key: string, value: any
}