export interface ConfigProps {
  database: string;
  user: string;
  password: string;
  server: string;
  options: any;

  log?: Function;
  responseHeaders?: string[];
  tranHeader?: string;
  pool?: any;
  config?: ConfigProps;
  errors?: {
    print: boolean;
  };
}
export interface DbProps {
  log: Function;
  exec: Function;
  send: Function;
  printParams: Function;
}
