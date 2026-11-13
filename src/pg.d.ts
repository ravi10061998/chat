// The subset of the pg driver used by this project.
declare module "pg" {
  export class Pool {
    constructor(config: { connectionString: string; connectionTimeoutMillis: number });
    query<Row extends object = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{ rows: Row[] }>;
    on(event: "error", listener: (error: Error) => void): this;
    end(): Promise<void>;
  }
}
