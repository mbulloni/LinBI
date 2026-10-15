import type { QueryResult, ColumnMeta, TableMeta, DbConnection } from './types';
import type { PbitPart } from './pbix/pbit';

/** Output of electron/pbix/read_pbix.py */
export interface PowerBIModel {
  file: string;
  kind: 'pbix' | 'pbit' | 'pbip' | 'live';
  tables: { name: string; parquet: string | null; rows: number; m: string | null; columns?: { name: string; dataType: string }[]; sortBy?: Record<string, string>; dax?: string; calcColumns?: { name: string; expression: string }[] }[];
  relationships: { fromTable: string; fromColumn: string; toTable: string; toColumn: string; cardinality: string; crossFilter: 'single' | 'both'; active: boolean }[];
  measures: { table: string; name: string; expression: string; formatString?: string }[];
  layout: string | null;
  /** Enhanced report format (PBIR): JSON files under Report/definition/. */
  pbir?: Record<string, string>;
  resources: Record<string, string>;
  warnings: string[];
}
type TableInfo = { name: string; rowCount: number; columns: ColumnMeta[] };

interface Api {
  query(sql: string): Promise<QueryResult>;
  preview(file: string, sheet?: string): Promise<QueryResult>;
  importFile(file: string, table: string, sheet?: string): Promise<TableInfo>;
  dropTable(table: string): Promise<void>;
  materialize(table: string, sql: string): Promise<TableInfo>;
  sourceExpr(source: TableMeta['source']): Promise<string>;
  dbConnect(c: DbConnection, password: string | null, remember: boolean): Promise<{ alias: string; tables: { schema: string; table: string; rows: number | null }[]; stored: boolean }>;
  dbForget(c: DbConnection): Promise<void>;
  addCalcColumn(table: string, column: string, expr: string, replace: boolean): Promise<TableInfo>;
  dropColumn(table: string, column: string): Promise<TableInfo>;
  sampleData(): Promise<{ financials: string; products: string; countries: string }>;
  openDataDialog(kind: string): Promise<string | null>;
  saveFile(content: string, path?: string | null, embed?: { table: string; file: string }[]): Promise<string | null>;
  openFile(kind?: 'report' | 'lbix' | 'powerbi'): Promise<{ path: string; content?: string; powerbi?: boolean; dataDir?: string } | null>;
  readPowerBI(file: string): Promise<PowerBIModel>;
  readText(kind: string): Promise<{ path: string; content: string } | null>;
  saveText(content: string, defaultPath: string, kind: string): Promise<string | null>;
  savePbit(parts: PbitPart[], suggested?: string): Promise<string | null>;
  printPdf(suggested?: string): Promise<string | null>;
  savePbip(parts: { path: string; text?: string; dataUrl?: string }[], suggested?: string): Promise<string | null>;
  createEmptyTable(table: string, columns: { name: string; dataType: string }[]): Promise<TableInfo>;
  win: {
    minimize(): void;
    maximize(): void;
    close(): void;
    setTitle(t: string): void;
    onState(cb: (max: boolean) => void): () => void;
  };
}

declare global {
  interface Window { api: Api; }
}

export const api = window.api;
