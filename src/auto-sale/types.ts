export interface AssetBinding { fetch(request: Request): Promise<Response>; }
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}
export interface D1DatabaseLike { prepare(query: string): D1PreparedStatementLike; }
export interface AutoSaleEnv {
  ASSETS: AssetBinding;
  DB?: D1DatabaseLike;
  AUTO_SALE_API_KEY?: string;
  AUTO_SALE_DEMO_MODE?: string;
  PRODUCT_MODE?: string;
}
export type AnyRecord = Record<string, unknown>;
