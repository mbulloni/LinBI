export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'countd' | 'median' | 'stdev' | 'var' | 'none' | 'measure';

export interface ColumnMeta { name: string; type: string; }
export interface TableMeta {
  name: string;
  rowCount: number;
  columns: ColumnMeta[];
  /** `m` keeps the original Power Query expression of tables imported from .pbix/.pbit;
   *  `ref` makes the query start from another query (Power Query "Riferimento"). */
  source: {
    path: string; sheet?: string; m?: string; ref?: string; dax?: string; db?: DbSource;
    /** Web.Contents / OData.Feed / Folder.Files sources (text may contain #[Parametro]). */
    web?: { url: string; format?: 'csv' | 'json' | 'parquet' | 'xlsx' };
    odata?: { url: string };
    folder?: { path: string; ext: string };
  };
  /** Power Query applied steps, compiled to a SQL pipeline by pq/compile.ts. */
  steps?: Step[];
  /** Schema of the source before the steps (types of the M "Origine" step in .pbit export). */
  sourceColumns?: ColumnMeta[];
  /** DAX calculated columns, re-evaluated after every load (`source.dax` = calculated table). */
  calcColumns?: { name: string; expression: string }[];
  /** Power BI "sort by column": display column → column whose values define its order. */
  sortBy?: Record<string, string>;
  /** Power BI data category per column (Country, StateOrProvince, City, PostalCode, Latitude, ImageUrl…). */
  dataCategory?: Record<string, string>;
  /** Field parameter: the label column, and the field each label stands for (in order). */
  fieldParam?: { column: string; fields: ParamField[] };
}

export interface ParamField { label: string; table: string; column: string; measure?: boolean; }

/** Database table source (Ottieni dati › Database). The password is stored outside the report. */
export interface DbSource { kind: 'mysql' | 'postgres' | 'sqlite'; host?: string; port?: string; database?: string; user?: string; file?: string; schema: string; table: string; }
export type DbConnection = Omit<DbSource, 'schema' | 'table'>;

/** Level of the automatic date hierarchy (a date column placed on an axis becomes Year › Quarter › Month › Day). */
export type DatePart = 'year' | 'quarter' | 'month' | 'day';
export interface FieldRef { table: string; column: string; agg: Agg; datePart?: DatePart; }

export type VisualType =
  | 'stackedBar' | 'stackedColumn' | 'clusteredBar' | 'clusteredColumn'
  | 'stackedBar100' | 'stackedColumn100' | 'line' | 'area' | 'stackedArea'
  | 'lineClusteredColumn' | 'lineStackedColumn' | 'waterfall' | 'ribbon'
  | 'pie' | 'donut' | 'treemap' | 'funnel' | 'scatter' | 'gauge' | 'map' | 'filledMap'
  | 'card' | 'multiRowCard' | 'kpi' | 'button' | 'shape' | 'decompositionTree' | 'keyInfluencers' | 'smartNarrative'
  | 'pythonVisual' | 'rVisual' | 'qna' | 'pageNavigator' | 'bookmarkNavigator' | 'table' | 'matrix' | 'slicer' | 'textbox' | 'image' | 'custom' | 'unsupported';

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
  slicerStyle: 'list' | 'dropdown' | 'slider';
  /** Title and container look (imported from Power BI or set in the Format pane). */
  titleColor?: string;
  titleAlign?: 'left' | 'center' | 'right';
  titleFont?: string;
  titleBold?: boolean;
  titleBg?: string;
  bgTransparency?: number; // 0–100
  /** Tooltip: id of a tooltip page shown on hover instead of the default tooltip. */
  tooltipPage?: string;
  borderColor?: string;
  borderRadius?: number;
  sortBy?: number; // index into result columns
  sortDir?: 'asc' | 'desc';
  /** Conditional formatting of table/matrix value fields, keyed by condfmt.fieldKey(). */
  cf?: Record<string, CondFormat>;
  /** Category axis type ("Tipo" in Asse X): continuous for dates/numbers, categorical = one slot per value. */
  axisType?: 'continuous' | 'categorical';
  /** Charts: data colors as a gradient over the values (single series). */
  colorScale?: ColorScale;
  /** Charts: data colors from another field (gradient or rules), like Power BI "In base al campo". */
  colorRule?: ColorRule;
}

/** Gradient; minValue/midValue/maxValue = "Personalizzato" stops (otherwise lowest/highest value shown). */
export interface ColorScale { min: string; max: string; mid?: string; minValue?: number; midValue?: number; maxValue?: number; }
/** Rule ("Regole"): value in [min, max) (bounds optional, inclusive flags) or blank → `value` (color or icon name). */
export interface CfRule { min?: number; minInc?: boolean; max?: number; maxInc?: boolean; blank?: boolean; value: string; }
export interface CondFormat {
  background?: ColorScale;
  font?: ColorScale;
  /** "Stile formato: Regole" for background/font color (take precedence over the gradient). */
  bgRules?: CfRule[];
  fontRules?: CfRule[];
  bars?: { positive: string; negative: string };
  icons?: boolean;
  /** Icon rules (Power BI icon names, e.g. TriangleHigh); without them, icons split the range in thirds. */
  iconRules?: CfRule[];
  /** "In base al campo": the field whose value drives the format (default: the formatted field itself). */
  input?: FieldRef;
}
/** Charts "Colori dati › fx": color of each data point from a field, by gradient or rules. */
export interface ColorRule { field: FieldRef; scale?: ColorScale; rules?: CfRule[]; }

export interface Visual {
  id: string;
  type: VisualType;
  x: number; y: number; w: number; h: number; z: number;
  fields: Record<string, FieldRef[]>;
  format: VisualFormat;
  slicerValues?: string[];
  filters?: Filter[];
  /** Hidden (Selection pane / bookmarks): not drawn. */
  hidden?: boolean;
  /** Group the visual belongs to (Page.groups). */
  group?: string;
  /** Container name in the Power BI file (bookmark and button targets). */
  pbiName?: string;
  /** Formatting imported from Power BI (objects/vcObjects as in the file), see visuals/pbistyle.ts. */
  style?: import('./visuals/pbistyle').PbiStyle;
  /** Decomposition tree: expanded path (dimension index in "Spiega per", expanded value). */
  tree?: { dim: number; value?: string | null }[];
  /** Key influencers: categorical target value, numeric direction, selected influencer. */
  ki?: { target?: string; dir?: 'up' | 'down'; selected?: string; tab?: 'influencers' | 'segments' };
  /** Python/R visual script. */
  script?: string;
  /** Q&A: question and the answer's visual spec (kept so Claude is not asked again). */
  qna?: { question: string; spec?: import('./api').QnaSpec; source?: 'local' | 'claude' };
  /** Drill state of a hierarchy axis: current level, values drilled into, "expand all" levels shown, drill mode on. */
  drill?: { level: number; path: (string | null)[]; expand?: boolean; mode?: boolean };
  /** Top N rows by the first value (Q&A "i primi 5"). */
  topN?: number;
  topAsc?: boolean;
  /** Custom visual (.pbiviz): guid of its package in Report.customVisuals. */
  custom?: string;
  /** Filters a custom visual applied with host.applyJsonFilter (Power BI IFilter JSON), keyed "objectName.propertyName". */
  jsonFilters?: Record<string, any>;
  text?: string;       // textbox content, or original visualType for 'unsupported'
  image?: string;      // data URL for 'image'
}

export interface Filter {
  id: string;
  table: string;
  column: string;
  values: string[]; // empty = all
  datePart?: DatePart;
  /** set by drill-through on the target page (removed when leaving it) */
  drillthrough?: boolean;
}

export interface Page {
  id: string;
  name: string;
  visuals: Visual[];
  filters: Filter[];
  background?: string; // data URL (page wallpaper imported from .pbix)
  /** Page size (default 1280×720), page color and wallpaper fit, hidden pages (tooltips) like Power BI. */
  width?: number;
  height?: number;
  backgroundColor?: string;
  backgroundTransparency?: number;
  backgroundFit?: 'Fit' | 'Fill' | 'Normal';
  wallpaper?: string;
  hidden?: boolean;
  /** Section name in the Power BI file (target of page-navigation buttons). */
  pbiName?: string;
  /** Drill-through target: fields that receive the filter from the source data point. */
  drillthrough?: { fields: { table: string; column: string; datePart?: DatePart }[]; keepAll?: boolean };
  /** Page usable as a report-page tooltip. */
  tooltip?: boolean;
  /** Visual groups (Selection pane); a hidden group hides its visuals and subgroups. */
  groups?: VisualGroup[];
}

export interface VisualGroup { id: string; name: string; hidden?: boolean; parent?: string; pbiName?: string; }

/** Power BI bookmark: captured page, visibility, filters and slicer selections. */
export interface Bookmark {
  id: string;
  name: string;
  pbiName?: string;
  /** bookmark group (Bookmarks pane) */
  group?: string;
  page?: string;
  applyData: boolean;
  applyDisplay: boolean;
  applyPage: boolean;
  /** "Oggetti visivi selezionati": only these visuals; otherwise every visual of the bookmark's page */
  targets?: string[];
  state: {
    hidden: string[];
    hiddenGroups: string[];
    reportFilters?: Filter[];
    pageFilters?: Filter[];
    slicers?: Record<string, string[]>;
  };
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

/** Report theme (subset of the Power BI theme JSON). */
export interface Theme { name: string; dataColors: string[]; background?: string; foreground?: string; tableAccent?: string; visualStyles?: unknown; textClasses?: unknown; }

export interface Report {
  theme?: Theme;
  pages: Page[];
  reportFilters: Filter[];
  relationships: Relationship[];
  modelLayout: Record<string, { x: number; y: number }>;
  measures: Measure[];
  bookmarks?: Bookmark[];
  /** Power Query parameters (Gestisci parametri): referenced as #[Nome] in sources and filters. */
  pqParams?: PQParam[];
  /** Custom visuals (.pbiviz) imported from a file or embedded in a .pbix/.pbip. */
  customVisuals?: CustomVisualPkg[];
}

/** A custom visual package: the .pbiviz.json resource (visual, capabilities, content.js/css…) and its package.json. */
export interface CustomVisualPkg { guid: string; pbiviz: any; package?: any; }

export interface PQParam { name: string; type: 'text' | 'number' | 'date'; value: string; description?: string; }

export interface CrossFilter {
  visualId: string;
  table: string;
  column: string;
  value: string;
  datePart?: DatePart;
}

export type View = 'report' | 'data' | 'model' | 'dax';

export interface QueryResult { columns: string[]; rows: Record<string, any>[]; }

// ---- Power Query (phase 4) ----

export type PQType = 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'bool';
/** Literal kind of a value typed in a step dialog (decides SQL/M quoting). */
export type ValueType = 'text' | 'number' | 'date' | 'datetime' | 'bool';
export type FilterOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank' | 'in' | 'notIn';
export type TransformFn = 'upper' | 'lower' | 'proper' | 'trim' | 'length' | 'round' | 'abs' | 'year' | 'month' | 'day' | 'quarter';
export type GroupOp = 'count' | 'countd' | 'sum' | 'avg' | 'median' | 'min' | 'max';
export type JoinKind = 'left' | 'right' | 'full' | 'inner' | 'leftAnti';

export type Step = { id: string } & (
  | { kind: 'removeColumns'; columns: string[] }
  | { kind: 'selectColumns'; columns: string[] }
  | { kind: 'renameColumns'; renames: [string, string][] }
  | { kind: 'changeType'; columns: [string, PQType][] }
  | { kind: 'filterRows'; column: string; op: FilterOp; value?: string; vtype?: ValueType; values?: (string | null)[] }
  | { kind: 'sort'; by: [string, 'asc' | 'desc'][] }
  | { kind: 'removeDuplicates'; columns: string[] }
  | { kind: 'keepTop' | 'keepBottom' | 'removeTop' | 'removeBottom'; n: number }
  | { kind: 'replaceValues'; columns: string[]; find: string; replace: string; vtype: ValueType; whole: boolean }
  | { kind: 'transform'; columns: string[]; fn: TransformFn; digits?: number }
  | { kind: 'fillDown' | 'fillUp'; columns: string[] }
  | { kind: 'splitColumn'; column: string; delimiter: string; parts: number }
  | { kind: 'customColumn'; name: string; formula: string }
  | { kind: 'indexColumn'; name: string; start: number }
  | { kind: 'duplicateColumn'; column: string; name: string }
  | { kind: 'groupBy'; keys: string[]; aggs: { name: string; op: GroupOp; column?: string }[] }
  | { kind: 'unpivot'; columns: string[]; other: boolean; cast: boolean }
  | { kind: 'merge'; table: string; left: string[]; right: string[]; join: JoinKind; expand: string[] }
  | { kind: 'append'; tables: string[] }
  | { kind: 'conditionalColumn'; name: string; rules: CondRule[]; otherwise: string; otherwiseIsColumn?: boolean }
  | { kind: 'promoteHeaders'; renames: [string, string][] }
  /** Table.SelectRows with any `each` condition (written in the M editor), translated like custom columns. */
  | { kind: 'selectRows'; formula: string }
);
/** "Colonna condizionale": if [column] <op> value then output (a value, or another column). */
export interface CondRule { column: string; op: FilterOp; value: string; vtype: ValueType; output: string; outputIsColumn?: boolean; }
export type StepKind = Step['kind'];
/** A step before it gets its id (distributes Omit over the union). */
export type NewStep = Step extends infer S ? (S extends Step ? Omit<S, 'id'> : never) : never;
