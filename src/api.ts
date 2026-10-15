import type { QueryResult, ColumnMeta } from './types';
import type { PbitPart } from './pbix/pbit';

/** Output of electron/pbix/read_pbix.py */
export interface PowerBIModel {
  file: string;
  kind: 'pbix' | 'pbit' | 'live';
  tables: { name: string; parquet: string | null; rows: number; m: string | null; columns?: { name: string; dataType: string }[]; sortBy?: Record<string, string> }[];
  relationships: { fromTable: string; fromColumn: string; toTable: string; toColumn: string; cardinality: string; crossFilter: 'single' | 'both'; active: boolean }[];
  measures: { table: string; name: string; expression: string; formatString?: string }[];
  layout: string | null;
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
  sourceExpr(file: string, sheet?: string): Promise<string>;
  sampleData(): Promise<{ financials: string; products: string; countries: string }>;
  openDataDialog(kind: string): Promise<string | null>;
  saveFile(content: string, path?: string | null): Promise<string | null>;
  openFile(kind?: 'report' | 'lbix' | 'powerbi'): Promise<{ path: string; content?: string; powerbi?: boolean } | null>;
  readPowerBI(file: string): Promise<PowerBIModel>;
  savePbit(parts: PbitPart[], suggested?: string): Promise<string | null>;
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
