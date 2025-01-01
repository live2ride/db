export type ConfigProps = {
  database: string;
  user: string;
  password: string;
  server: string;
  options?: any;

  log?: Function;
  responseHeaders?: string[];
  tranHeader?: string;
  pool?: any;
  config?: ConfigProps;
  errors?: {
    print: boolean;
  };
};
export type DbProps = {
  log: Function;
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