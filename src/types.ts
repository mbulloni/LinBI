export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'countd' | 'none' | 'measure';

export interface ColumnMeta { name: string; type: string; }
export interface TableMeta {
  name: string;
  rowCount: number;
  columns: ColumnMeta[];
  /** `m` keeps the original Power Query expression of tables imported from .pbix/.pbit. */
  source: { path: string; sheet?: string; m?: string };
  /** Power BI "sort by column": display column → column whose values define its order. */
  sortBy?: Record<string, string>;
}

export interface FieldRef { table: string; column: string; agg: Agg; }

export type VisualType =
  | 'stackedBar' | 'stackedColumn' | 'clusteredBar' | 'clusteredColumn'
  | 'stackedBar100' | 'stackedColumn100' | 'line' | 'area' | 'stackedArea'
  | 'pie' | 'donut' | 'treemap' | 'funnel' | 'scatter' | 'gauge'
  | 'card' | 'table' | 'matrix' | 'slicer' | 'textbox' | 'image' | 'unsupported';

export interface VisualFormat {
  titleShow: boolean;
  titleText: string;
  titleSize: number;
  legendShow: boolean;
  legendPos: 'top' | 'bottom' | 'left' | 'right';
  dataLabels: boolean;
  xAxisShow: boolean;
  yAxisShow: boolean;
  gridlines: boolean;
  color: string;
  background: string;
  border: boolean;
  slicerStyle: 'list' | 'dropdown';
  sortBy?: number; // index into result columns
  sortDir?: 'asc' | 'desc';
}

export interface Visual {
  id: string;
  type: VisualType;
  x: number; y: number; w: number; h: number; z: number;
  fields: Record<string, FieldRef[]>;
  format: VisualFormat;
  slicerValues?: string[];
  filters?: Filter[];
  text?: string;       // textbox content, or original visualType for 'unsupported'
  image?: string;      // data URL for 'image'
}

export interface Filter {
  id: string;
  table: string;
  column: string;
  values: string[]; // empty = all
}

export interface Page {
  id: string;
  name: string;
  visuals: Visual[];
  filters: Filter[];
  background?: string; // data URL (page wallpaper imported from .pbix)
}

export type Cardinality = 'manyToOne' | 'oneToOne' | 'manyToMany';

/** Normalised like Power BI: `from` is the many side, `to` the one side (for *:1). */
export interface Relationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: Cardinality;
  crossFilter: 'single' | 'both';
  active: boolean;
}

/** DAX measure (stored as written; evaluated by the DAX→SQL compiler in dax.ts). */
export interface Measure {
  table: string;
  name: string;
  expression: string;
  formatString?: string;
}

export interface Report {
  pages: Page[];
  reportFilters: Filter[];
  relationships: Relationship[];
  modelLayout: Record<string, { x: number; y: number }>;
  measures: Measure[];
}

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: string;
}

export type View = 'report' | 'data' | 'model' | 'dax';

export interface QueryResult { columns: string[]; rows: Record<string, any>[]; }
