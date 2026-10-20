import { create } from 'zustand';
import { api } from './api';
import type { Bookmark, CrossFilter, DbConnection, FieldRef, Filter, NewStep, Page, Relationship, Report, Step, Theme, TableMeta, View, Visual, VisualFormat, VisualType } from './types';
import { isNumeric, uid } from './format';
import { customName, setCustomVisuals, visualDef } from './visuals/catalog';
import { CF_WELL, connected, NULL_KEY, qi, ql } from './query';
import { calcColumnSql, calcTableSql, checkMeasure, type Model } from './dax';
import { resolveSource, setParams } from './pq/params';
import { parseLayout, setCfExportRanges, themeFromLayout } from './pbix/layout';
import { runVisualQuery } from './visuals/useVisualData';
import { cfInput, fieldKey, rangeOf } from './visuals/condfmt';
import { pbirToLayout } from './pbix/pbir';
import { buildPbipParts, buildPbitParts } from './pbix/pbit';
import { pendingQueries } from './visuals/useVisualData';
import { applyTheme, parseTheme, themeJson, THEMES } from './themes';
import { compileQuery } from './pq/compile';
import { dependencies, renameQueryRef, type QueryDef } from './pq/steps';

export const PAGE_W = 1280;
export const PAGE_H = 720;
/** Page size: Power BI pages keep their own (4:3, tooltip, custom). */
export const pageSize = (p: Page) => ({ w: p.width ?? PAGE_W, h: p.height ?? PAGE_H });

/** A visual is drawn unless it, or one of its groups, is hidden. */
export function isHiddenVisual(p: Page, v: Visual): boolean {
  if (v.hidden) return true;
  const seen = new Set<string>();
  for (let g = p.groups?.find((x) => x.id === v.group); g && !seen.has(g.id); g = p.groups?.find((x) => x.id === g!.parent)) {
    if (g.hidden) return true;
    seen.add(g.id);
  }
  return false;
}

export const defaultFormat = (type: VisualType): VisualFormat => ({
  titleShow: !['textbox', 'card', 'table', 'matrix', 'button', 'shape', 'image', 'multiRowCard', 'pageNavigator', 'bookmarkNavigator'].includes(type),
  titleText: '',
  titleSize: 14,
  legendShow: true,
  legendPos: 'top',
  dataLabels: type === 'pie' || type === 'donut' || type === 'treemap' || type === 'funnel',
  xAxisShow: true,
  yAxisShow: true,
  gridlines: true,
  color: '#118DFF',
  background: ['button', 'shape', 'image', 'pageNavigator', 'bookmarkNavigator'].includes(type) ? 'transparent' : '#FFFFFF',
  border: false,
  slicerStyle: 'list',
});

const newPage = (n: number): Page => ({ id: uid(), name: `Pagina ${n}`, visuals: [], filters: [] });
const emptyReport = (): Report => ({ pages: [newPage(1)], reportFilters: [], relationships: [], modelLayout: {}, measures: [] });

/** Field dragged/checked from the Data pane; `measure` marks a DAX measure. */
export type FieldDrop = Omit<FieldRef, 'agg'> & { measure?: boolean };

export interface RelEditor { draft: Relationship; isNew: boolean; }

/** True when every non-null value of table.column is distinct (candidate "one" side). */
export async function isUnique(table: string, column: string): Promise<boolean> {
  const r = await api.query(`SELECT COUNT(DISTINCT ${qi(column)}) = COUNT(*) AS u FROM ${qi(table)}`);
  return r.rows[0]?.u === true;
}

export type FilterScope = 'visual' | 'page' | 'report';

/** Query being edited in the Power Query editor; `orig` is the model table it came from (null = new). */
export interface PQQuery { name: string; orig: string | null; source: TableMeta['source']; steps: Step[]; }
/** `step` = number of applied steps shown (null = all, 0 = Origine). */
export interface PQState { queries: PQQuery[]; selected: string; step: number | null; deleted: string[]; }

const srcExpr = (source: TableMeta['source']) => api.sourceExpr(resolveSource(source));

/** Steps Power BI folds into the previous step of the same kind instead of adding a new one. */
function mergeStep(prev: Step, next: Step): boolean {
  if (prev.kind === 'renameColumns' && next.kind === 'renameColumns') {
    for (const [a, b] of next.renames) {
      const hit = prev.renames.find((r) => r[1] === a);
      if (hit) hit[1] = b; else prev.renames.push([a, b]);
    }
    prev.renames = prev.renames.filter(([a, b]) => a !== b);
    return true;
  }
  if (prev.kind === 'changeType' && next.kind === 'changeType') {
    for (const [c, t] of next.columns) {
      const hit = prev.columns.find((x) => x[0] === c);
      if (hit) hit[1] = t; else prev.columns.push([c, t]);
    }
    return true;
  }
  if (prev.kind === 'sort' && next.kind === 'sort') {
    for (const [c, d] of next.by) {
      const hit = prev.by.find((x) => x[0] === c);
      if (hit) hit[1] = d; else prev.by.push([c, d]);
    }
    return true;
  }
  return false;
}

const reEscape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renames a table everywhere the report refers to it (fields, filters, relationships, measures). */
function renameTableInReport(r: Report, from: string, to: string) {
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const k of ['table', 'fromTable', 'toTable']) if (o[k] === from) o[k] = to;
    Object.values(o).forEach(walk);
  };
  walk(r.pages); walk(r.reportFilters); walk(r.relationships); walk(r.measures);
  if (r.modelLayout[from]) { r.modelLayout[to] = r.modelLayout[from]; delete r.modelLayout[from]; }
  const quoted = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const bare = /^[A-Za-z_]\w*$/.test(from) ? new RegExp(`(^|[^\\w'\\]])${reEscape(from)}\\[`, 'g') : null;
  const target = /^[A-Za-z_]\w*$/.test(to) ? to : quoted(to);
  for (const m of r.measures) {
    m.expression = m.expression.split(quoted(from) + '[').join(target + '[');
    if (bare) m.expression = m.expression.replace(bare, (_x, pre) => `${pre}${target}[`);
  }
}

/** Formula bar edit of a measure, calculated column or calculated table. */
export interface DaxEdit { kind: 'measure' | 'column' | 'table'; table: string; original: string | null; text: string; formatString?: string; error?: string; }

const DAX_KIND = { measure: 'Misura', column: 'Colonna', table: 'Tabella' } as const;

/** "Name = expression" → parts; names may be written as [Name] or 'Name'. */
function splitDax(text: string): { name: string; expr: string } | null {
  const m = /^\s*([^=]+?)\s*=([\s\S]*)$/.exec(text);
  if (!m) return null;
  const name = m[1].trim().replace(/^\[(.*)\]$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  return name ? { name, expr: m[2].trim() } : null;
}

export interface Navigator { path: string; tableName: string; preview: { columns: string[]; rows: any[] } | null; error?: string; loading: boolean; }

interface State {
  tables: TableMeta[];
  report: Report;
  activePageId: string;
  view: View;
  selectedVisualId: string | null;
  crossFilter: CrossFilter | null;
  panes: { filters: boolean; viz: boolean; data: boolean; selection: boolean; bookmarks: boolean };
  /** Visuals selected together (Ctrl+click), e.g. to group them. */
  multiSel: string[];
  vizTab: 'build' | 'format';
  dataVersion: number;
  filePath: string | null;
  dirty: boolean;
  past: Report[];
  future: Report[];
  navigator: Navigator | null;
  zoom: number | 'fit';
  toast: string | null;
  dataViewTable: string | null;
  fileMenu: boolean;
  gridlines: boolean;
  snapToGrid: boolean;
  busy: string | null;
  /** Python/R visuals run only after the user enables them in this session (like Power BI Desktop). */
  scriptsEnabled: boolean;
  /** Visual whose script is open in the script editor. */
  scriptEditor: string | null;
  /** Ottieni dati › Web / Feed OData / Cartella dialog. */
  sourceDialog: 'web' | 'odata' | 'folder' | null;
  /** Nuovo parametro dialog. */
  paramDialog: 'numeric' | 'fields' | null;
  clipboard: Visual | null;
  focusId: string | null;
  relManage: boolean;
  relEditor: RelEditor | null;
  selectedRelId: string | null;
  pq: PQState | null;
  daxEdit: DaxEdit | null;
  daxQueryText: string;

  model: () => Model;
  startDax: (kind: DaxEdit['kind'], table?: string, original?: string) => void;
  saveDax: () => Promise<boolean>;
  deleteMeasure: (name: string) => void;
  deleteCalcColumn: (table: string, name: string) => Promise<void>;
  finalizeModel: () => Promise<void>;
  setTheme: (t: Theme | undefined) => void;
  printing: boolean;
  exportPdf: () => Promise<void>;
  importTheme: () => Promise<void>;
  exportTheme: () => Promise<void>;

  openPowerQuery: (focus?: string, extra?: PQQuery | PQQuery[]) => void;
  dbDialog: boolean;
  publishDialog: boolean;
  loadDbTables: (c: DbConnection, picks: { schema: string; table: string }[], transform: boolean) => Promise<void>;
  pqSet: (fn: (st: PQState) => void) => void;
  pqAddStep: (step: NewStep) => void;
  pqNewSource: (kind: string) => Promise<void>;
  pqApply: () => Promise<void>;
  transformNavigator: () => void;

  saveRelationship: (r: Relationship) => void;
  deleteRelationship: (id: string) => void;
  detectRelationships: (only?: string[]) => Promise<number>;
  setModelPos: (table: string, pos: { x: number; y: number }) => void;

  set: (p: Partial<State>) => void;
  mut: (fn: (r: Report) => void) => void;
  undo: () => void;
  redo: () => void;
  notify: (msg: string, ms?: number) => void;

  page: () => Page;
  setView: (v: View) => void;
  setActivePage: (id: string) => void;
  addPage: () => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  duplicatePage: (id: string) => void;

  addVisual: (type: VisualType, at?: { x: number; y: number }, custom?: string) => string;
  /** Visualizzazioni › … › Importa un oggetto visivo da un file (.pbiviz). */
  importCustomVisual: () => Promise<void>;
  removeCustomVisual: (guid: string) => void;
  // Selection pane and bookmarks
  setVisualHidden: (id: string, hidden: boolean) => void;
  setGroupHidden: (groupId: string, hidden: boolean) => void;
  groupVisuals: (ids: string[]) => void;
  ungroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  moveLayer: (id: string, dir: 1 | -1) => void;
  /** Modellazione › Nuovo parametro: numeric range (what-if) or fields. */
  createParameter: (p: { kind: 'numeric'; name: string; min: number; max: number; step: number; def: number; slicer: boolean } | { kind: 'fields'; name: string; fields: import('./types').ParamField[]; slicer: boolean }) => Promise<void>;
  /** Drill-through: go to `pageId` filtered on the source data point (values per field). */
  drillThrough: (pageId: string, values: { table: string; column: string; datePart?: import('./types').DatePart; value: string | null }[]) => void;
  addBookmark: () => void;
  updateBookmark: (id: string) => void;
  applyBookmark: (id: string) => void;
  setBookmark: (id: string, patch: Partial<Bookmark>) => void;
  removeBookmark: (id: string) => void;
  moveBookmark: (id: string, dir: 1 | -1) => void;
  updateVisual: (id: string, patch: Partial<Visual>, commit?: boolean) => void;
  updateFormat: (id: string, patch: Partial<VisualFormat>) => void;
  removeVisual: (id: string) => void;
  duplicateVisual: (id: string) => void;
  changeVisualType: (id: string, type: VisualType, custom?: string) => void;
  addField: (visualId: string | null, field: FieldDrop, well?: string, at?: { x: number; y: number }) => void;
  removeField: (visualId: string, well: string, idx: number) => void;
  setFieldAgg: (visualId: string, well: string, idx: number, agg: FieldRef['agg']) => void;
  /** Strumenti colonna: data category and "Ordina per colonna" (null removes). */
  setColumnProps: (table: string, column: string, p: { dataCategory?: string | null; sortBy?: string | null }) => void;
  /** Date field in a hierarchy well: plain date ("Data") or automatic date hierarchy ("Gerarchia date"). */
  setDateHierarchy: (visualId: string, well: string, idx: number, on: boolean) => void;
  selectVisual: (id: string | null) => void;
  setCross: (c: CrossFilter | null) => void;

  addFilter: (scope: FilterScope, field: Omit<FieldRef, 'agg'>) => void;
  updateFilter: (scope: FilterScope, id: string, values: string[], field?: Omit<FieldRef, 'agg'>) => void;
  removeFilter: (scope: FilterScope, id: string) => void;

  openNavigator: (kind: string) => Promise<void>;
  loadNavigator: () => Promise<void>;
  loadSample: () => Promise<void>;
  removeTable: (name: string) => Promise<void>;
  refresh: () => Promise<void>;

  newReport: () => Promise<void>;
  save: (as?: boolean) => Promise<void>;
  open: (file?: string) => Promise<void>;
  importPowerBI: (path: string) => Promise<void>;
  exportPbit: () => Promise<void>;
  exportPbip: () => Promise<void>;
  sourceName: string | null;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function tableNameFor(path: string, existing: TableMeta[]): string {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '_') || 'Tabella';
  let name = base, i = 2;
  while (existing.some((t) => t.name === name)) name = `${base} (${i++})`;
  return name;
}

export const useStore = create<State>((set, get) => {
  const init = emptyReport();

  const findVisual = (r: Report, id: string) => {
    for (const p of r.pages) {
      const v = p.visuals.find((x) => x.id === id);
      if (v) return v;
    }
    return undefined;
  };

  const filterList = (r: Report, scope: FilterScope): Filter[] | undefined => {
    if (scope === 'report') return r.reportFilters;
    const p = r.pages.find((x) => x.id === get().activePageId)!;
    if (scope === 'page') return p.filters;
    const v = p.visuals.find((x) => x.id === get().selectedVisualId);
    return v ? (v.filters ??= []) : undefined;
  };

  const columnOf = (f: Omit<FieldRef, 'agg'>) => get().tables.find((t) => t.name === f.table)?.columns.find((c) => c.name === f.column);

  /** Puts a field into the best-fitting well, mimicking Power BI's auto placement. */
  const placeField = (v: Visual, field: FieldDrop, wellKey?: string) => {
    const def = visualDef(v.type, v.custom);
    const { measure, ...f } = field;
    const num = measure || isNumeric(columnOf(f));
    const hasRoom = (k: string) => {
      const w = def.wells.find((x) => x.key === k)!;
      return !w.max || (v.fields[k]?.length ?? 0) < w.max;
    };
    let well = wellKey ? def.wells.find((w) => w.key === wellKey) : undefined;
    // Latitude/Longitude data category (or column name) → the map's coordinate wells.
    const category = get().tables.find((t) => t.name === f.table)?.dataCategory?.[f.column];
    well ??= def.wells.find((w) => (category === 'Latitude' ? w.key === 'lat' : category === 'Longitude' ? w.key === 'lon' : false) && hasRoom(w.key));
    well ??= def.wells.find((w) => w.match?.test(f.column) && hasRoom(w.key));
    if (!well) {
      well = (num ? def.wells.find((w) => w.measure && hasRoom(w.key)) : undefined)
        ?? def.wells.find((w) => !w.measure && hasRoom(w.key))
        ?? def.wells.find((w) => hasRoom(w.key))
        ?? def.wells[0];
    }
    if (!well) return;
    const agg: FieldRef['agg'] = measure ? 'measure' : ['table', 'multiRowCard', 'pythonVisual', 'rVisual'].includes(v.type) ? (num ? 'sum' : 'none') : well.measure ? (num ? 'sum' : 'count') : 'none';
    const list = (v.fields[well.key] ??= []);
    if (list.some((x) => x.table === f.table && x.column === f.column && x.agg === agg && !x.datePart)) return;
    if (well.max && list.length >= well.max) list.splice(well.max - 1);
    // A date on a hierarchy axis becomes the automatic date hierarchy, like Power BI.
    if (well.hierarchy && agg === 'none' && /^(DATE|TIMESTAMP)/i.test(columnOf(f)?.type ?? '') && !list.some((x) => x.table === f.table && x.column === f.column)) {
      for (const datePart of ['year', 'quarter', 'month', 'day'] as const) list.push({ ...f, agg, datePart });
      return;
    }
    list.push({ ...f, agg });
  };

  const nextPosition = (p: Page, w: number, h: number) => {
    const n = p.visuals.length;
    return { x: 20 + ((n * 30) % 400), y: 20 + ((n * 30) % 240), w, h };
  };

  const defaultSize = (type: VisualType) =>
    type === 'card' ? { w: 220, h: 120 } : type === 'kpi' ? { w: 280, h: 180 } : type === 'multiRowCard' ? { w: 300, h: 260 } : type === 'slicer' ? { w: 220, h: 260 } : type === 'textbox' ? { w: 300, h: 80 } : { w: 440, h: 300 };

  /** Runs a query (source + applied steps) and stores the result as model table `def.name`.
   *  `context` resolves references to other queries (defaults to the loaded tables). */
  const loadTable = async (def: QueryDef & { sortBy?: Record<string, string>; dataCategory?: Record<string, string>; calcColumns?: TableMeta['calcColumns'] }, context?: QueryDef[]) => {
    const all = context ?? get().tables;
    const meta = await api.materialize(def.name, await compileQuery(def, all, { srcExpr }));
    const steps = def.steps?.length ? def.steps : undefined;
    let sourceColumns: TableMeta['sourceColumns'];
    if (steps) {
      const d = await api.query(`DESCRIBE SELECT * FROM (${await compileQuery({ ...def, steps: [] }, all, { srcExpr })})`);
      sourceColumns = d.rows.map((r) => ({ name: r.column_name, type: r.column_type }));
    }
    const prev = get().tables.find((x) => x.name === def.name);
    const sortBy = def.sortBy ?? prev?.sortBy;
    const dataCategory = def.dataCategory ?? prev?.dataCategory;
    const calcColumns = def.calcColumns ?? prev?.calcColumns;
    const t: TableMeta = { ...meta, source: def.source, ...(steps ? { steps, sourceColumns } : {}), ...(sortBy ? { sortBy } : {}), ...(dataCategory && Object.keys(dataCategory).length ? { dataCategory } : {}), ...(calcColumns?.length ? { calcColumns } : {}) };
    set((s) => ({
      tables: prev ? s.tables.map((x) => (x.name === def.name ? t : x)) : [...s.tables, t],
      dataVersion: s.dataVersion + 1,
      dataViewTable: s.dataViewTable ?? def.name,
      dirty: true,
    }));
  };
  const importTable = (path: string, name: string, sheet?: string, m?: string) =>
    loadTable({ name, source: { path, sheet, ...(m ? { m } : {}) } });

  return {
    tables: [],
    report: init,
    activePageId: init.pages[0].id,
    view: 'report',
    selectedVisualId: null,
    crossFilter: null,
    panes: { filters: true, viz: true, data: true, selection: false, bookmarks: false },
    multiSel: [],
    vizTab: 'build',
    dataVersion: 0,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    navigator: null,
    zoom: 'fit',
    toast: null,
    dataViewTable: null,
    fileMenu: false,
    gridlines: false,
    snapToGrid: false,
    busy: null,
    scriptsEnabled: false,
    scriptEditor: null,
    paramDialog: null,
    sourceDialog: null,
    clipboard: null,
    focusId: null,
    sourceName: null,

    importPowerBI: async (path) => {
      set({ fileMenu: false, busy: 'Lettura del file Power BI…' });
      try {
        const model = await api.readPowerBI(path);
        await get().newReport();
        set({ busy: `Caricamento di ${model.tables.length} tabelle…` });
        const failed: string[] = [];
        for (const t of model.tables) {
          try {
            if (t.dax) {
              // Calculated table: evaluated by finalizeModel() once the other tables are loaded.
              set((s) => ({ tables: [...s.tables, { name: t.name, rowCount: 0, columns: [], source: { path: '', dax: t.dax } }] }));
              continue;
            }
            if (t.parquet) { await importTable(t.parquet, t.name, undefined, t.m ?? undefined); continue; }
            // .pbit: no data inside; try the local file the Power Query points at, else empty typed table.
            const src = /File\.Contents\("([^"]+)"\)/.exec(t.m ?? '')?.[1];
            const sheet = /Item="([^"]+)",Kind="Sheet"/.exec(t.m ?? '')?.[1];
            let ok = false;
            if (src) { try { await importTable(src, t.name, sheet, t.m ?? undefined); ok = true; } catch { /* fall through */ } }
            if (!ok) {
              const meta = await api.createEmptyTable(t.name, t.columns ?? []);
              set((s) => ({ tables: [...s.tables, { ...meta, source: { path: src ?? '', m: t.m ?? undefined } }] }));
              failed.push(t.name);
            }
          } catch {
            failed.push(t.name);
          }
        }
        const sortBy = new Map(model.tables.map((t) => [t.name, t.sortBy ?? {}]));
        const cats = new Map(model.tables.filter((t) => t.dataCategory && Object.keys(t.dataCategory).length).map((t) => [t.name, t.dataCategory!]));
        // Calculated columns of schema-only files (.pbit/.pbip) are computed here; .pbix data already has them.
        const calc = new Map(model.tables.filter((t) => !t.parquet && t.calcColumns?.length).map((t) => [t.name, t.calcColumns!]));
        set((s) => ({ tables: s.tables.map((t) => ({ ...t, sortBy: sortBy.get(t.name), ...(cats.has(t.name) ? { dataCategory: cats.get(t.name) } : {}), ...(calc.has(t.name) ? { calcColumns: calc.get(t.name) } : {}) })) }));
        const relationships: Relationship[] = model.relationships.map((r) => {
          const swap = r.cardinality === 'oneToMany';
          return {
            id: uid(),
            fromTable: swap ? r.toTable : r.fromTable, fromColumn: swap ? r.toColumn : r.fromColumn,
            toTable: swap ? r.fromTable : r.toTable, toColumn: swap ? r.fromColumn : r.toColumn,
            cardinality: r.cardinality === 'oneToOne' ? 'oneToOne' : r.cardinality === 'manyToMany' ? 'manyToMany' : 'manyToOne',
            crossFilter: r.crossFilter, active: r.active,
          };
        });
        const measures = model.measures.map((m) => ({ table: m.table, name: m.name, expression: m.expression, formatString: m.formatString || undefined }));
        // Calculated tables/columns first: the layout may use their fields.
        if (get().tables.some((t) => t.source.dax || t.calcColumns?.length)) {
          set({ report: { ...emptyReport(), relationships, measures } });
          await get().finalizeModel();
        }
        const tables = get().tables;
        const layoutJson = model.layout ?? (model.pbir ? pbirToLayout(model.pbir) : null);
        setCustomVisuals(model.customVisuals);
        const parsed = layoutJson ? parseLayout(layoutJson, tables, new Set(measures.map((m) => m.name)), model.resources) : null;
        const pages = parsed?.pages ?? emptyReport().pages;
        const theme = layoutJson ? themeFromLayout(layoutJson, model.resources) : undefined;
        const report: Report = { pages, reportFilters: parsed?.reportFilters ?? [], relationships, modelLayout: {}, measures, ...(theme ? { theme } : {}), ...(parsed?.bookmarks.length ? { bookmarks: parsed.bookmarks } : {}), ...(model.customVisuals?.length ? { customVisuals: model.customVisuals } : {}) };
        set({ report, activePageId: pages[0].id, past: [], future: [], dirty: false, filePath: null, sourceName: path.split('/').pop()!, view: 'report', dataVersion: get().dataVersion + 1 });

        const unsupportedDax = measures.filter((m) => checkMeasure({ tables, rels: relationships, measures }, m)).length;
        const notes = [
          `Importati: ${tables.length} tabelle, ${relationships.length} relazioni, ${measures.length} misure, ${pages.length} pagine.`,
          ...model.warnings,
          failed.length ? `Dati non disponibili per: ${failed.join(', ')} (${model.kind === 'pbip' ? 'progetto .pbip' : 'modello .pbit'}: il file non contiene dati e le origini non sono raggiungibili).` : '',
          unsupportedDax ? `${unsupportedDax} misure DAX usano funzioni non ancora supportate.` : '',
          parsed && Object.keys(parsed.skipped).length ? `Oggetti visivi non supportati: ${Object.entries(parsed.skipped).map(([k, n]) => `${k} (${n})`).join(', ')}.` : '',
        ].filter(Boolean);
        get().notify(notes.join(' '), 15000);
      } catch (e: any) {
        get().notify(e.message, 15000);
      } finally {
        set({ busy: null });
      }
    },
    exportPbit: async () => {
      set({ fileMenu: false });
      const { report, tables, filePath, sourceName } = get();
      const base = (filePath?.split('/').pop() ?? sourceName ?? 'Report').replace(/\.(lbix|pbix|pbit)$/i, '');
      try {
        await prepareCfExport();
        const out = await api.savePbit(buildPbitParts(report, tables), base + '.pbit');
        if (out) get().notify(`Esportato ${out.split('/').pop()}. Aprirlo in Power BI Desktop: i dati vengono ricaricati dalle origini (percorsi Linux da aggiornare in Trasforma dati › Impostazioni origine dati).`, 12000);
      } catch (e: any) {
        get().notify('Esportazione non riuscita: ' + e.message);
      }
    },
    exportPbip: async () => {
      set({ fileMenu: false });
      const { report, tables, filePath, sourceName } = get();
      const base = (filePath?.split('/').pop() ?? sourceName ?? 'Report').replace(/\.(lbix|pbix|pbit|pbip)$/i, '');
      try {
        await prepareCfExport();
        const out = await api.savePbip(buildPbipParts(report, tables), base + '.pbip');
        if (out) get().notify(`Progetto salvato: ${out.split('/').pop()} con le cartelle .Report e .SemanticModel (file di testo, adatti a git).`, 9000);
      } catch (e: any) {
        get().notify('Salvataggio del progetto non riuscito: ' + e.message);
      }
    },
    relManage: false,
    relEditor: null,
    selectedRelId: null,
    pq: null,
    daxEdit: null,
    daxQueryText: '',

    printing: false,
    exportPdf: async () => {
      const { filePath, sourceName } = get();
      const base = (filePath?.split('/').pop() ?? sourceName ?? 'Report').replace(/\.(lbix|pbix|pbit|pbip)$/i, '');
      set({ fileMenu: false, crossFilter: null, printing: true, busy: 'Esportazione in PDF…' });
      try {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        await wait(400);
        for (let t = 0; t < 30000 && pendingQueries() > 0; t += 100) await wait(100);
        await wait(700); // chart animations
        const out = await api.printPdf(base + '.pdf');
        if (out) get().notify(`Esportato ${out.split('/').pop()} (${get().report.pages.length} ${get().report.pages.length === 1 ? 'pagina' : 'pagine'}).`);
      } catch (e: any) {
        get().notify('Esportazione PDF non riuscita: ' + e.message);
      } finally {
        set({ printing: false, busy: null });
      }
    },
    setTheme: (t) => get().mut((r) => { if (t) r.theme = t; else delete r.theme; }),
    importTheme: async () => {
      try {
        const f = await api.readText('theme');
        if (!f) return;
        const t = parseTheme(f.content, f.path.split('/').pop()!.replace(/\.json$/i, ''));
        get().setTheme(t);
        get().notify(`Tema "${t.name}" applicato.`);
      } catch (e: any) { get().notify('Tema non valido: ' + e.message); }
    },
    exportTheme: async () => {
      const t = get().report.theme ?? THEMES[0];
      const p = await api.saveText(themeJson(t), `${t.name}.json`, 'theme');
      if (p) get().notify(`Tema salvato in ${p.split('/').pop()}.`);
    },
    model: () => ({ tables: get().tables, rels: get().report.relationships, measures: get().report.measures }),
    startDax: (kind, table, original) => {
      const { tables, report, dataViewTable } = get();
      const home = table ?? dataViewTable ?? tables[0]?.name ?? '';
      if (!home && kind !== 'table') { get().notify('Caricare prima dei dati.'); return; }
      let text: string, formatString: string | undefined;
      if (original && kind === 'measure') {
        const m = report.measures.find((x) => x.name === original)!;
        text = `${m.name} = ${m.expression}`;
        formatString = m.formatString;
      } else if (original && kind === 'column') {
        text = `${original} = ${tables.find((t) => t.name === home)?.calcColumns?.find((c) => c.name === original)?.expression ?? ''}`;
      } else if (original) {
        text = `${original} = ${tables.find((t) => t.name === original)?.source.dax ?? ''}`;
      } else {
        const taken = (n: string) => report.measures.some((m) => m.name === n) || tables.some((t) => t.name === n || t.columns.some((c) => c.name === n));
        let name: string = DAX_KIND[kind], i = 2;
        while (taken(name)) name = `${DAX_KIND[kind]} ${i++}`;
        text = `${name} = `;
      }
      set({ daxEdit: { kind, table: home, original: original ?? null, text, formatString }, fileMenu: false });
    },
    saveDax: async () => {
      const ed = get().daxEdit;
      if (!ed) return false;
      const fail = (error: string) => { set({ daxEdit: { ...ed, error } }); return false; };
      const parts = splitDax(ed.text);
      if (!parts) return fail('Sintassi: Nome = espressione');
      if (!parts.expr) return fail("Manca l'espressione dopo =");
      const { name, expr } = parts;
      const tables = get().tables;
      try {
        if (ed.kind === 'measure') {
          const others = get().report.measures.filter((m) => m.name !== ed.original);
          if (others.some((m) => m.name.toLowerCase() === name.toLowerCase())) return fail(`Esiste già una misura denominata "${name}".`);
          if (tables.some((t) => t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()))) return fail(`Il nome "${name}" è già usato da una colonna.`);
          const m = { table: ed.table, name, expression: expr, ...(ed.formatString ? { formatString: ed.formatString } : {}) };
          const err = checkMeasure({ ...get().model(), measures: [...others, m] }, m);
          if (err) return fail(err);
          const old = ed.original;
          get().mut((r) => {
            const i = r.measures.findIndex((x) => x.name === old);
            if (i >= 0) r.measures[i] = m; else r.measures.push(m);
            if (old && old !== name) {
              // Power BI updates references to a renamed measure.
              const re = new RegExp(`\\[${reEscape(old)}\\]`, 'gi');
              for (const x of r.measures) if (x !== m) x.expression = x.expression.replace(re, `[${name}]`);
              const walk = (o: any) => {
                if (!o || typeof o !== 'object') return;
                if (Array.isArray(o)) { o.forEach(walk); return; }
                if (o.agg === 'measure' && o.column === old) o.column = name;
                Object.values(o).forEach(walk);
              };
              walk(r.pages);
            }
          });
        } else if (ed.kind === 'column') {
          const t = tables.find((x) => x.name === ed.table)!;
          if (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.name !== ed.original)) return fail(`La tabella contiene già una colonna "${name}".`);
          const sql = calcColumnSql(get().model(), t.name, expr);
          if (ed.original && ed.original !== name) await api.dropColumn(t.name, ed.original);
          const meta = await api.addCalcColumn(t.name, name, sql, ed.original === name);
          const calcColumns = [...(t.calcColumns ?? []).filter((c) => c.name !== ed.original), { name, expression: expr }];
          set((s) => ({ tables: s.tables.map((x) => (x.name === t.name ? { ...x, columns: meta.columns, rowCount: meta.rowCount, calcColumns } : x)), dirty: true }));
        } else {
          if (tables.some((t) => t.name.toLowerCase() === name.toLowerCase() && t.name !== ed.original)) return fail(`Esiste già una tabella denominata "${name}".`);
          const sql = calcTableSql(get().model(), expr);
          const prev = tables.find((t) => t.name === ed.original);
          if (ed.original && ed.original !== name) {
            await api.dropTable(ed.original);
            const from = ed.original;
            get().mut((r) => renameTableInReport(r, from, name));
          }
          const meta = await api.materialize(name, sql);
          const t: TableMeta = { ...meta, source: { path: '', dax: expr }, ...(prev?.calcColumns ? { calcColumns: prev.calcColumns } : {}) };
          set((s) => ({ tables: prev ? s.tables.map((x) => (x.name === prev.name ? t : x)) : [...s.tables, t], dirty: true }));
        }
      } catch (e: any) {
        return fail(e.message.split('\n')[0]);
      }
      set((s) => ({ daxEdit: null, dataVersion: s.dataVersion + 1 }));
      return true;
    },
    deleteMeasure: (name) => get().mut((r) => {
      r.measures = r.measures.filter((m) => m.name !== name);
      for (const p of r.pages) for (const v of p.visuals) for (const k of Object.keys(v.fields)) v.fields[k] = v.fields[k].filter((f) => !(f.agg === 'measure' && f.column === name));
    }),
    deleteCalcColumn: async (table, name) => {
      try {
        const meta = await api.dropColumn(table, name);
        set((s) => ({ tables: s.tables.map((t) => (t.name === table ? { ...t, columns: meta.columns, calcColumns: t.calcColumns?.filter((c) => c.name !== name) } : t)), dataVersion: s.dataVersion + 1, dirty: true }));
      } catch (e: any) { get().notify(e.message); }
    },
    // Calculated tables, then calculated columns, after any data load (they read loaded data).
    finalizeModel: async () => {
      const errors: string[] = [];
      for (const t of get().tables.filter((x) => x.source.dax)) {
        try {
          const meta = await api.materialize(t.name, calcTableSql(get().model(), t.source.dax!));
          set((s) => ({ tables: s.tables.map((x) => (x.name === t.name ? { ...x, ...meta } : x)) }));
        } catch (e: any) { errors.push(`${t.name}: ${e.message.split('\n')[0]}`); }
      }
      for (const t of get().tables.filter((x) => x.calcColumns?.length)) {
        for (const cc of t.calcColumns!) {
          try {
            const cur = get().tables.find((x) => x.name === t.name)!;
            const meta = await api.addCalcColumn(t.name, cc.name, calcColumnSql(get().model(), t.name, cc.expression), cur.columns.some((c) => c.name === cc.name));
            set((s) => ({ tables: s.tables.map((x) => (x.name === t.name ? { ...x, columns: meta.columns, rowCount: meta.rowCount } : x)) }));
          } catch (e: any) { errors.push(`${t.name}[${cc.name}]: ${e.message.split('\n')[0]}`); }
        }
      }
      if (errors.length) get().notify('Calcolo DAX non riuscito — ' + errors.join(' · '), 12000);
      set((s) => ({ dataVersion: s.dataVersion + 1 }));
    },

    openPowerQuery: (focus, extra) => {
      const queries: PQQuery[] = get().tables.filter((t) => !t.source.dax).map((t) => ({ name: t.name, orig: t.name, source: clone(t.source), steps: clone(t.steps ?? []) }));
      const extras = extra ? (Array.isArray(extra) ? extra : [extra]) : [];
      queries.push(...extras);
      const selected = extras[0]?.name ?? focus ?? queries[0]?.name ?? '';
      set({ pq: { queries, selected, step: null, deleted: [] }, fileMenu: false });
    },
    pqSet: (fn) => {
      const pq = get().pq;
      if (!pq) return;
      const next = clone(pq);
      fn(next);
      set({ pq: next });
    },
    pqAddStep: (raw) => get().pqSet((st) => {
      const q = st.queries.find((x) => x.name === st.selected);
      if (!q) return;
      const step = { ...raw, id: uid() } as Step;
      const pos = st.step ?? q.steps.length;
      if (pos > 0 && mergeStep(q.steps[pos - 1], step)) {
        if (q.steps[pos - 1].kind === 'renameColumns' && !(q.steps[pos - 1] as any).renames.length) q.steps.splice(pos - 1, 1);
        return;
      }
      q.steps.splice(pos, 0, step);
      st.step = pos + 1 >= q.steps.length ? null : pos + 1;
    }),
    pqNewSource: async (kind) => {
      const path = await api.openDataDialog(kind);
      const pq = get().pq;
      if (!path || !pq) return;
      const taken = [...get().tables, ...pq.queries] as { name: string }[];
      const name = tableNameFor(path, taken as TableMeta[]);
      get().pqSet((st) => { st.queries.push({ name, orig: null, source: { path }, steps: [] }); st.selected = name; st.step = null; });
    },
    dbDialog: false,
    publishDialog: false,
    loadDbTables: async (c, picks, transform) => {
      const taken = new Set(get().tables.map((t) => t.name));
      const defs = picks.map((p) => {
        let name = p.table, i = 2;
        while (taken.has(name)) name = `${p.table} (${i++})`;
        taken.add(name);
        return { name, source: { path: '', db: { ...c, schema: p.schema, table: p.table } } };
      });
      set({ dbDialog: false });
      if (transform) { get().openPowerQuery(undefined, defs.map((d) => ({ ...d, orig: null, steps: [] }))); return; }
      set({ busy: `Caricamento di ${defs.length} ${defs.length === 1 ? 'tabella' : 'tabelle'} dal database…` });
      const failed: string[] = [];
      try {
        for (const d of defs) { try { await loadTable(d); } catch (e: any) { failed.push(`${d.name}: ${e.message.split('\n')[0]}`); } }
        const loaded = defs.map((d) => d.name).filter((n) => get().tables.some((t) => t.name === n));
        const n = loaded.length > 0 ? await get().detectRelationships(loaded) : 0;
        get().notify([loaded.length === 1 ? 'Caricata 1 tabella.' : `Caricate ${loaded.length} tabelle.`, n ? `Rilevate ${n} relazioni.` : '', failed.length ? `Errori: ${failed.join(' · ')}` : ''].filter(Boolean).join(' '), failed.length ? 12000 : 6000);
      } finally {
        set({ busy: null });
      }
    },
    transformNavigator: () => {
      const nav = get().navigator;
      if (!nav) return;
      set({ navigator: null });
      get().openPowerQuery(undefined, { name: nav.tableName.trim(), orig: null, source: { path: nav.path }, steps: [] });
    },
    pqApply: async () => {
      const pq = get().pq;
      if (!pq) return;
      set({ busy: 'Applicazione delle modifiche alle query…' });
      const failed: string[] = [];
      try {
        for (const name of pq.deleted) await get().removeTable(name);
        const before = get().tables;
        const key = (q: QueryDef) => JSON.stringify([q.source, q.steps ?? []]);
        const changed = new Set(pq.queries.filter((q) => {
          const t = before.find((x) => x.name === q.orig);
          return !t || q.orig !== q.name || key(t) !== key(q);
        }).map((q) => q.name));
        // References are inlined in the SQL, so dependents of a changed query reload too.
        for (let grew = true; grew;) {
          grew = false;
          for (const q of pq.queries) {
            if (!changed.has(q.name) && dependencies(q).some((d) => changed.has(d))) { changed.add(q.name); grew = true; }
          }
        }
        for (const q of pq.queries) {
          if (!q.orig || q.orig === q.name) continue;
          await api.dropTable(q.orig);
          const from = q.orig;
          get().mut((r) => renameTableInReport(r, from, q.name));
          set((s) => ({
            tables: s.tables.map((t) => (t.name === from ? { ...t, name: q.name } : t)),
            dataViewTable: s.dataViewTable === from ? q.name : s.dataViewTable,
          }));
        }
        for (const q of pq.queries) {
          if (!changed.has(q.name)) continue;
          try { await loadTable({ name: q.name, source: q.source, steps: q.steps }, pq.queries); } catch (e: any) { failed.push(`${q.name}: ${e.message}`); }
        }
        const order = pq.queries.map((q) => q.name);
        const pos = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
        set((s) => ({ tables: [...s.tables].sort((a, b) => pos(a.name) - pos(b.name)), dataVersion: s.dataVersion + 1 }));
        await get().finalizeModel();
        if (failed.length) { get().notify('Caricamento non riuscito — ' + failed.join(' · '), 15000); return; }
        set({ pq: null });
        const fresh = pq.queries.filter((q) => !q.orig).map((q) => q.name);
        if (fresh.length) {
          const n = await get().detectRelationships(fresh);
          if (n) get().notify(`Rilevate automaticamente ${n} ${n === 1 ? 'relazione' : 'relazioni'}. Verificarle nella vista modello.`);
        }
      } catch (e: any) {
        get().notify('Applicazione non riuscita: ' + e.message, 12000);
      } finally {
        set({ busy: null });
      }
    },

    saveRelationship: (rel) => get().mut((r) => {
      const i = r.relationships.findIndex((x) => x.id === rel.id);
      if (i >= 0) r.relationships[i] = rel; else r.relationships.push(rel);
    }),
    deleteRelationship: (id) => {
      get().mut((r) => { r.relationships = r.relationships.filter((x) => x.id !== id); });
      if (get().selectedRelId === id) set({ selectedRelId: null });
    },
    // Power BI-style autodetect: same column name (case-insensitive), compatible type,
    // unique values on exactly one side (→ *:1) or both (→ 1:1). Ambiguous paths stay inactive.
    detectRelationships: async (only) => {
      const tables = get().tables;
      const found: Relationship[] = [];
      const rels = () => [...get().report.relationships, ...found];
      const related = (a: string, b: string) => rels().some((x) => (x.fromTable === a && x.toTable === b) || (x.fromTable === b && x.toTable === a));
      for (let i = 0; i < tables.length; i++) {
        for (let j = i + 1; j < tables.length; j++) {
          const a = tables[i], b = tables[j];
          if (only && !only.includes(a.name) && !only.includes(b.name)) continue;
          if (related(a.name, b.name)) continue;
          for (const ca of a.columns) {
            const cb = b.columns.find((c) => c.name.toLowerCase() === ca.name.toLowerCase());
            if (!cb || isNumeric(ca) !== isNumeric(cb) || related(a.name, b.name)) continue;
            const [ua, ub] = await Promise.all([isUnique(a.name, ca.name), isUnique(b.name, cb.name)]);
            if (!ua && !ub) continue;
            const [m, mc, o, oc] = ub ? [a.name, ca.name, b.name, cb.name] : [b.name, cb.name, a.name, ca.name];
            found.push({
              id: uid(), fromTable: m, fromColumn: mc, toTable: o, toColumn: oc,
              cardinality: ua && ub ? 'oneToOne' : 'manyToOne', crossFilter: ua && ub ? 'both' : 'single',
              active: !connected(rels(), m, o),
            });
          }
        }
      }
      if (found.length) get().mut((r) => r.relationships.push(...found));
      return found.length;
    },
    setModelPos: (table, pos) => get().mut((r) => { r.modelLayout[table] = pos; }),

    set: (p) => set(p),

    mut: (fn) => {
      const prev = clone(get().report);
      const next = clone(prev);
      fn(next);
      set((s) => ({ report: next, past: [...s.past.slice(-49), prev], future: [], dirty: true }));
    },
    undo: () => {
      const { past, report, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ report: prev, past: past.slice(0, -1), future: [report, ...future], dirty: true });
      if (!prev.pages.some((p) => p.id === get().activePageId)) set({ activePageId: prev.pages[0].id });
    },
    redo: () => {
      const { past, report, future } = get();
      if (!future.length) return;
      set({ report: future[0], future: future.slice(1), past: [...past, report], dirty: true });
    },
    notify: (msg, ms = 6000) => {
      set({ toast: msg });
      setTimeout(() => get().toast === msg && set({ toast: null }), ms);
    },

    page: () => get().report.pages.find((p) => p.id === get().activePageId) ?? get().report.pages[0],
    setView: (view) => set({ view, fileMenu: false }),
    setActivePage: (id) => set({ activePageId: id, selectedVisualId: null, crossFilter: null }),
    addPage: () => {
      const p = newPage(get().report.pages.length + 1);
      while (get().report.pages.some((x) => x.name === p.name)) p.name += '+';
      get().mut((r) => r.pages.push(p));
      set({ activePageId: p.id, selectedVisualId: null, crossFilter: null });
    },
    renamePage: (id, name) => get().mut((r) => { const p = r.pages.find((x) => x.id === id); if (p && name.trim()) p.name = name.trim(); }),
    deletePage: (id) => {
      const pages = get().report.pages;
      if (pages.length <= 1) return;
      const idx = pages.findIndex((p) => p.id === id);
      get().mut((r) => { r.pages = r.pages.filter((p) => p.id !== id); });
      if (get().activePageId === id) set({ activePageId: get().report.pages[Math.max(0, idx - 1)].id });
    },
    duplicatePage: (id) => {
      const src = get().report.pages.find((p) => p.id === id);
      if (!src) return;
      const copy: Page = { ...clone(src), id: uid(), name: `Duplicato di ${src.name}` };
      copy.visuals.forEach((v) => (v.id = uid()));
      get().mut((r) => r.pages.splice(r.pages.findIndex((p) => p.id === id) + 1, 0, copy));
      set({ activePageId: copy.id });
    },

    setVisualHidden: (id, hidden) => get().mut((r) => { const v = findVisual(r, id); if (v) v.hidden = hidden || undefined; }),
    setGroupHidden: (groupId, hidden) => get().mut((r) => { for (const p of r.pages) { const g = p.groups?.find((x) => x.id === groupId); if (g) g.hidden = hidden || undefined; } }),
    groupVisuals: (ids) => {
      if (ids.length < 2) return;
      get().mut((r) => {
        const p = r.pages.find((x) => x.visuals.some((v) => v.id === ids[0]));
        if (!p) return;
        const g = { id: uid(), name: `Gruppo ${(p.groups?.length ?? 0) + 1}` };
        (p.groups ??= []).push(g);
        for (const v of p.visuals) if (ids.includes(v.id)) v.group = g.id;
      });
      set({ multiSel: [] });
    },
    ungroup: (groupId) => get().mut((r) => {
      for (const p of r.pages) {
        const g = p.groups?.find((x) => x.id === groupId);
        if (!g) continue;
        for (const v of p.visuals) if (v.group === groupId) v.group = g.parent;
        for (const x of p.groups!) if (x.parent === groupId) x.parent = g.parent;
        p.groups = p.groups!.filter((x) => x.id !== groupId);
      }
    }),
    renameGroup: (groupId, name) => get().mut((r) => { for (const p of r.pages) { const g = p.groups?.find((x) => x.id === groupId); if (g) g.name = name; } }),
    moveLayer: (id, dir) => get().mut((r) => {
      const p = r.pages.find((x) => x.visuals.some((v) => v.id === id));
      if (!p) return;
      const order = [...p.visuals].sort((a, b) => a.z - b.z);
      const i = order.findIndex((v) => v.id === id), j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      order.forEach((v, k) => (v.z = k + 1));
    }),
    createParameter: async (p) => {
      const name = p.name.trim();
      if (!name) throw new Error('Indicare un nome.');
      if (get().tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`Esiste già una tabella denominata "${name}".`);
      const q = (s: string) => s.replace(/"/g, '""');
      let expr: string;
      if (p.kind === 'numeric') {
        if (!(p.step > 0) || p.max < p.min) throw new Error('Intervallo non valido: minimo ≤ massimo e incremento > 0.');
        if ((p.max - p.min) / p.step > 100000) throw new Error('Troppi valori: aumentare l\'incremento.');
        expr = `SELECTCOLUMNS(GENERATESERIES(${p.min}, ${p.max}, ${p.step}), "${q(name)}", [Value])`;
      } else {
        if (!p.fields.length) throw new Error('Aggiungere almeno un campo.');
        const ref = (f: import('./types').ParamField) => (f.measure ? `[${f.column}]` : `'${f.table.replace(/'/g, "''")}'[${f.column}]`);
        expr = `SELECTCOLUMNS({ ${p.fields.map((f, i) => `("${q(f.label)}", NAMEOF(${ref(f)}), ${i})`).join(', ')} }, "${q(name)}", [Value1], "${q(name)} Campi", [Value2], "${q(name)} Ordine", [Value3])`;
      }
      const meta = await api.materialize(name, calcTableSql(get().model(), expr));
      const t: TableMeta = { ...meta, source: { path: '', dax: expr }, ...(p.kind === 'fields' ? { fieldParam: { column: name, fields: p.fields }, sortBy: { [name]: `${name} Ordine` } } : {}) };
      set((s) => ({ tables: [...s.tables, t], dirty: true }));
      get().mut((r) => {
        if (p.kind === 'numeric') r.measures.push({ table: name, name: `${name} Valore`, expression: `SELECTEDVALUE('${name.replace(/'/g, "''")}'[${name}], ${p.def})` });
        if (!p.slicer) return;
        const page = r.pages.find((x) => x.id === get().activePageId)!;
        const z = Math.max(0, ...page.visuals.map((v) => v.z)) + 1;
        page.visuals.push({
          id: uid(), type: 'slicer', x: 20, y: 20, w: 240, h: p.kind === 'numeric' ? 90 : 200, z,
          fields: { category: [{ table: name, column: name, agg: 'none' }] },
          format: { ...defaultFormat('slicer'), slicerStyle: p.kind === 'numeric' ? 'slider' : 'list' },
          ...(p.kind === 'numeric' ? { slicerValues: [String(p.def)] } : {}),
        });
      });
      set((s) => ({ dataVersion: s.dataVersion + 1 }));
    },
    drillThrough: (pageId, values) => {
      const source = get().page();
      get().mut((r) => {
        const p = r.pages.find((x) => x.id === pageId);
        if (!p?.drillthrough) return;
        const fields = p.drillthrough.fields;
        const own = values.filter((x) => fields.some((f) => f.table === x.table && f.column === x.column && f.datePart === x.datePart));
        p.filters = [
          ...p.filters.filter((f) => !f.drillthrough),
          // "Mantieni tutti i filtri": the source page filters come along too.
          ...(p.drillthrough.keepAll ? source.filters.filter((f) => f.values.length && !f.drillthrough).map((f) => ({ ...clone(f), id: uid(), drillthrough: true })) : []),
          ...own.map((x) => ({ id: uid(), table: x.table, column: x.column, values: [x.value === null ? NULL_KEY : x.value], drillthrough: true, ...(x.datePart ? { datePart: x.datePart } : {}) })),
        ];
      });
      set({ activePageId: pageId, selectedVisualId: null, crossFilter: null });
    },
    addBookmark: () => {
      const id = uid();
      get().mut((r) => {
        const n = (r.bookmarks?.length ?? 0) + 1;
        (r.bookmarks ??= []).push({ id, name: `Segnalibro ${n}`, applyData: true, applyDisplay: true, applyPage: true, page: get().activePageId, state: { hidden: [], hiddenGroups: [] } });
      });
      get().updateBookmark(id);
    },
    // Captures the current state of the bookmark's page (the active page) into it.
    updateBookmark: (id) => get().mut((r) => {
      const b = r.bookmarks?.find((x) => x.id === id);
      const p = r.pages.find((x) => x.id === get().activePageId);
      if (!b || !p) return;
      b.page = p.id;
      const scope = p.visuals.filter((v) => !b.targets || b.targets.includes(v.id));
      b.state = {
        hidden: scope.filter((v) => v.hidden).map((v) => v.id),
        hiddenGroups: (p.groups ?? []).filter((g) => g.hidden).map((g) => g.id),
        reportFilters: clone(r.reportFilters),
        pageFilters: clone(p.filters),
        slicers: Object.fromEntries(scope.filter((v) => v.type === 'slicer').map((v) => [v.id, [...(v.slicerValues ?? [])]])),
      };
    }),
    applyBookmark: (id) => {
      const b = get().report.bookmarks?.find((x) => x.id === id);
      if (!b) return;
      const target = b.applyPage && b.page && get().report.pages.some((p) => p.id === b.page) ? b.page : get().activePageId;
      get().mut((r) => {
        const p = r.pages.find((x) => x.id === target);
        if (!p) return;
        const scope = p.visuals.filter((v) => !b.targets || b.targets.includes(v.id));
        if (b.applyDisplay) {
          for (const v of scope) v.hidden = b.state.hidden.includes(v.id) || undefined;
          if (!b.targets) for (const g of p.groups ?? []) g.hidden = b.state.hiddenGroups.includes(g.id) || undefined;
        }
        if (b.applyData) {
          if (!b.targets && b.state.reportFilters) r.reportFilters = clone(b.state.reportFilters);
          if (!b.targets && b.state.pageFilters && p.id === b.page) p.filters = clone(b.state.pageFilters);
          for (const v of scope) if (v.type === 'slicer' && b.state.slicers?.[v.id]) v.slicerValues = [...b.state.slicers[v.id]];
        }
      });
      set({ activePageId: target, selectedVisualId: null, ...(b.applyData ? { crossFilter: null } : {}) });
    },
    setBookmark: (id, patch) => get().mut((r) => { const b = r.bookmarks?.find((x) => x.id === id); if (b) Object.assign(b, patch); }),
    removeBookmark: (id) => get().mut((r) => { r.bookmarks = r.bookmarks?.filter((x) => x.id !== id); }),
    moveBookmark: (id, dir) => get().mut((r) => {
      const list = r.bookmarks ?? [];
      const i = list.findIndex((x) => x.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    }),
    importCustomVisual: async () => {
      try {
        const pkg = await api.importPbiviz();
        if (!pkg) return;
        get().mut((r) => { r.customVisuals = [...(r.customVisuals ?? []).filter((p) => p.guid !== pkg.guid), pkg]; });
        get().notify(`Oggetto visivo «${customName(pkg)}» importato: si trova nel riquadro Visualizzazioni.`);
      } catch (e: any) {
        get().notify('Importazione non riuscita: ' + e.message, 10000);
      }
    },
    removeCustomVisual: (guid) => {
      const used = get().report.pages.some((p) => p.visuals.some((v) => v.custom === guid));
      if (used) { get().notify("L'oggetto visivo è usato nel report: eliminare prima gli oggetti visivi che lo usano."); return; }
      get().mut((r) => { r.customVisuals = r.customVisuals?.filter((p) => p.guid !== guid); });
    },
    addVisual: (type, at, custom) => {
      const id = uid();
      const page = get().page();
      const size = defaultSize(type);
      const pos = at ? { ...at, ...size } : nextPosition(page, size.w, size.h);
      const z = Math.max(0, ...page.visuals.map((v) => v.z)) + 1;
      get().mut((r) => {
        r.pages.find((p) => p.id === page.id)!.visuals.push({ id, type, ...pos, z, fields: {}, format: defaultFormat(type), text: type === 'textbox' ? '' : undefined, ...(custom ? { custom } : {}) });
      });
      set({ selectedVisualId: id, vizTab: 'build' });
      return id;
    },
    updateVisual: (id, patch, commit = true) => {
      if (commit) get().mut((r) => Object.assign(findVisual(r, id)!, patch));
      else {
        const r = clone(get().report);
        Object.assign(findVisual(r, id)!, patch);
        set({ report: r, dirty: true });
      }
    },
    updateFormat: (id, patch) => get().mut((r) => { const v = findVisual(r, id); if (v) v.format = { ...v.format, ...patch }; }),
    removeVisual: (id) => {
      get().mut((r) => r.pages.forEach((p) => (p.visuals = p.visuals.filter((v) => v.id !== id))));
      set((s) => ({ selectedVisualId: s.selectedVisualId === id ? null : s.selectedVisualId, crossFilter: s.crossFilter?.visualId === id ? null : s.crossFilter }));
    },
    duplicateVisual: (id) => {
      const nid = uid();
      get().mut((r) => {
        for (const p of r.pages) {
          const v = p.visuals.find((x) => x.id === id);
          if (v) p.visuals.push({ ...clone(v), id: nid, x: v.x + 20, y: v.y + 20, z: Math.max(...p.visuals.map((q) => q.z)) + 1 });
        }
      });
      set({ selectedVisualId: nid });
    },
    changeVisualType: (id, type, custom) => get().mut((r) => {
      const v = findVisual(r, id);
      if (!v || (v.type === type && v.custom === custom)) return;
      const all = Object.values(v.fields).flat();
      v.type = type;
      if (custom) v.custom = custom; else delete v.custom;
      delete v.jsonFilters;
      v.fields = {};
      v.format = { ...defaultFormat(type), titleText: v.format.titleText, background: v.format.background, border: v.format.border };
      for (const f of all) placeField(v, { table: f.table, column: f.column, measure: f.agg === 'measure' });
    }),
    addField: (visualId, field, well, at) => {
      let id = visualId;
      if (!id) {
        // Like Power BI: a geographic column (data category) dropped on the canvas makes a map.
        const geo = !field.measure && /^(Address|Place|City|County|StateOrProvince|PostalCode|Country|Continent|Latitude|Longitude)$/.test(get().tables.find((t) => t.name === field.table)?.dataCategory?.[field.column] ?? '');
        const type: VisualType = field.measure ? 'card' : geo ? 'map' : isNumeric(columnOf(field)) ? 'clusteredColumn' : 'table';
        id = get().addVisual(type, at);
        // Fold into the creation step so a single undo removes the new visual.
        const past = get().past;
        get().mut((r) => placeField(findVisual(r, id!)!, field, well));
        set({ past: past });
        return;
      }
      get().mut((r) => { const v = findVisual(r, id!); if (v) placeField(v, field, well); });
    },
    removeField: (visualId, well, idx) => get().mut((r) => { const v = findVisual(r, visualId); v?.fields[well]?.splice(idx, 1); }),
    setFieldAgg: (visualId, well, idx, agg) => get().mut((r) => { const f = findVisual(r, visualId)?.fields[well]?.[idx]; if (f) f.agg = agg; }),
    setColumnProps: (table, column, p) => {
      set((s) => ({
        dirty: true, dataVersion: s.dataVersion + 1,
        tables: s.tables.map((t) => {
          if (t.name !== table) return t;
          const next = { ...t };
          for (const k of ['dataCategory', 'sortBy'] as const) {
            if (p[k] === undefined) continue;
            const m = { ...(t[k] ?? {}) };
            if (p[k]) m[column] = p[k]!; else delete m[column];
            if (Object.keys(m).length) next[k] = m; else delete next[k];
          }
          return next;
        }),
      }));
    },
    setDateHierarchy: (visualId, well, idx, on) => get().mut((r) => {
      const v = findVisual(r, visualId);
      const list = v?.fields[well];
      const f = list?.[idx];
      if (!v || !list || !f) return;
      const same = (x: FieldRef) => x.table === f.table && x.column === f.column && x.agg === 'none';
      const first = list.findIndex(same);
      const rest = list.filter((x) => !same(x));
      const base = { table: f.table, column: f.column, agg: 'none' as const };
      const repl: FieldRef[] = on ? (['year', 'quarter', 'month', 'day'] as const).map((datePart) => ({ ...base, datePart })) : [base];
      rest.splice(Math.min(first, rest.length), 0, ...repl);
      v.fields[well] = rest;
      delete v.drill;
    }),
    selectVisual: (id) => set({ selectedVisualId: id }),
    setCross: (c) => set({ crossFilter: c }),

    addFilter: (scope, field) => get().mut((r) => {
      const list = filterList(r, scope);
      if (list && !list.some((f) => f.table === field.table && f.column === field.column)) list.push({ id: uid(), ...field, values: [] });
    }),
    // `field` materialises the implicit per-field filter cards of a visual on first edit.
    updateFilter: (scope, id, values, field) => get().mut((r) => {
      const list = filterList(r, scope);
      if (!list) return;
      const f = list.find((x) => x.id === id);
      if (f) f.values = values;
      else if (field) list.push({ id, ...field, values });
    }),
    removeFilter: (scope, id) => get().mut((r) => {
      const list = filterList(r, scope);
      if (list) list.splice(0, list.length, ...list.filter((f) => f.id !== id));
    }),

    openNavigator: async (kind) => {
      set({ fileMenu: false });
      const path = await api.openDataDialog(kind);
      if (!path) return;
      set({ navigator: { path, tableName: tableNameFor(path, get().tables), preview: null, loading: true } });
      try {
        const preview = await api.preview(path);
        set((s) => ({ navigator: s.navigator && { ...s.navigator, preview, loading: false } }));
      } catch (e: any) {
        set((s) => ({ navigator: s.navigator && { ...s.navigator, error: e.message, loading: false } }));
      }
    },
    loadNavigator: async () => {
      const nav = get().navigator;
      if (!nav) return;
      set({ navigator: { ...nav, loading: true }, busy: 'Caricamento dei dati…' });
      try {
        await importTable(nav.path, nav.tableName);
        set({ navigator: null });
        const n = await get().detectRelationships([nav.tableName]);
        if (n) get().notify(`Rilevate automaticamente ${n} ${n === 1 ? 'relazione' : 'relazioni'}. Verificarle nella vista modello.`);
      } catch (e: any) {
        set({ navigator: { ...nav, loading: false, error: e.message } });
      } finally {
        set({ busy: null });
      }
    },
    loadSample: async () => {
      set({ busy: 'Caricamento dei dati di esempio…', fileMenu: false });
      try {
        const p = await api.sampleData();
        await importTable(p.financials, 'financials');
        await importTable(p.products, 'products');
        await importTable(p.countries, 'countries');
        await get().detectRelationships(['financials', 'products', 'countries']);
      } catch (e: any) {
        get().notify('Errore: ' + e.message);
      } finally {
        set({ busy: null });
      }
    },
    removeTable: async (name) => {
      await api.dropTable(name);
      get().mut((r) => {
        r.relationships = r.relationships.filter((x) => x.fromTable !== name && x.toTable !== name);
        delete r.modelLayout[name];
      });
      set((s) => ({ tables: s.tables.filter((t) => t.name !== name), dataVersion: s.dataVersion + 1, dataViewTable: s.dataViewTable === name ? null : s.dataViewTable, dirty: true }));
    },
    refresh: async () => {
      set({ busy: 'Aggiornamento in corso…' });
      try {
        await api.clearRemoteCache(); // Web/OData sources are downloaded again
        for (const t of get().tables) if (!t.source.dax) await loadTable(t);
        await get().finalizeModel();
      } catch (e: any) {
        get().notify('Aggiornamento non riuscito: ' + e.message);
      } finally {
        set({ busy: null });
      }
    },

    newReport: async () => {
      for (const t of get().tables) await api.dropTable(t.name);
      const r = emptyReport();
      set({ sourceName: null, tables: [], report: r, activePageId: r.pages[0].id, selectedVisualId: null, crossFilter: null, filePath: null, dirty: false, past: [], future: [], fileMenu: false, view: 'report', dataViewTable: null, dataVersion: get().dataVersion + 1 });
    },
    save: async (as = false) => {
      const { tables, report, filePath } = get();
      // Version 2: data embedded as Parquet (like a .pbix), sources and steps kept for refresh.
      const content = JSON.stringify({
        format: 'lbix', version: 2,
        tables: tables.map((t, i) => ({ name: t.name, source: t.source, steps: t.steps, sourceColumns: t.sourceColumns, sortBy: t.sortBy, ...(t.dataCategory ? { dataCategory: t.dataCategory } : {}), calcColumns: t.calcColumns, ...(t.fieldParam ? { fieldParam: t.fieldParam } : {}), data: `data/${i}.parquet` })),
        report,
      }, null, 2);
      set({ busy: 'Salvataggio…' });
      try {
        const p = await api.saveFile(content, as ? null : filePath, tables.map((t, i) => ({ table: t.name, file: `data/${i}.parquet` })));
        if (p) set({ filePath: p, dirty: false, fileMenu: false });
      } catch (e: any) {
        get().notify('Salvataggio non riuscito: ' + e.message);
      } finally {
        set({ busy: null });
      }
    },
    open: async (file) => {
      const f = file ? await api.openAt(file).catch((e) => { get().notify('Apertura non riuscita: ' + e.message); return null; }) : await api.openFile();
      if (!f) return;
      if (f.powerbi) return get().importPowerBI(f.path);
      try {
        const doc = JSON.parse(f.content!);
        if (doc.format !== 'lbix') throw new Error('file non valido');
        await get().newReport();
        set({ busy: 'Apertura del report…' });
        const failed: string[] = [];
        const defs = doc.tables as (QueryDef & { sortBy?: Record<string, string>; dataCategory?: Record<string, string>; calcColumns?: TableMeta['calcColumns']; sourceColumns?: TableMeta['sourceColumns']; fieldParam?: TableMeta['fieldParam']; data?: string })[];
        for (const t of defs) {
          if (f.dataDir && t.data) {
            // Embedded data: no access to the original sources needed (Aggiorna reloads from them).
            try {
              const meta = await api.materialize(t.name, `SELECT * FROM read_parquet(${ql(`${f.dataDir}/${t.data}`)})`);
              const { data: _d, ...def } = t;
              set((st) => ({ tables: [...st.tables, { ...meta, ...def } as TableMeta], dataVersion: st.dataVersion + 1 }));
              continue;
            } catch { /* fall back to the sources */ }
          }
          if (t.source.dax) { set((st) => ({ tables: [...st.tables, { name: t.name, rowCount: 0, columns: [], source: t.source, calcColumns: t.calcColumns, ...(t.sortBy ? { sortBy: t.sortBy } : {}), ...(t.dataCategory ? { dataCategory: t.dataCategory } : {}), ...(t.fieldParam ? { fieldParam: t.fieldParam } : {}) }] })); continue; }
          try { await loadTable(t, defs); } catch { failed.push(t.name); }
        }
        doc.report.relationships ??= [];
        doc.report.modelLayout ??= {};
        doc.report.measures ??= [];
        set({ report: doc.report, activePageId: doc.report.pages[0].id, filePath: f.path, dirty: false, past: [], future: [] });
        await get().finalizeModel();
        set({ dirty: false });
        if (failed.length) get().notify(`Impossibile ricaricare: ${failed.join(', ')}. Verificare il percorso dell'origine dati.`);
      } catch (e: any) {
        get().notify('Apertura non riuscita: ' + e.message);
      } finally {
        set({ busy: null });
      }
    },
  };
});

// Charts and backgrounds read the theme from shared state: keep it in sync with the report.
/** Before writing Power BI files: visible range of fields with default icons (thresholds become numbers). */
export async function prepareCfExport() {
  const ranges = new Map<string, Map<string, { min: number; max: number }>>();
  for (const p of useStore.getState().report.pages) for (const v of p.visuals) {
    const keys = Object.entries(v.format.cf ?? {}).filter(([, c]) => c.icons && !c.iconRules?.length);
    if (!keys.length) continue;
    try {
      const { items, rows } = await runVisualQuery(v);
      const m = new Map<string, { min: number; max: number }>();
      for (const [key, c] of keys) {
        const drv = c.input ? items.find((i) => i.well === CF_WELL && fieldKey(i.field) === fieldKey(cfInput(c.input!))) : items.find((i) => fieldKey(i.field) === key);
        const r = drv ? rangeOf(rows.map((x) => x[drv.alias])) : null;
        if (r) m.set(key, r);
      }
      ranges.set(v.id, m);
    } catch { /* visual with errors: icons exported without thresholds */ }
  }
  setCfExportRanges(ranges);
}

useStore.subscribe((s, prev) => { if (s.report.theme !== prev.report.theme) applyTheme(s.report.theme); });
useStore.subscribe((s, prev) => { if (s.report.customVisuals !== prev.report.customVisuals) setCustomVisuals(s.report.customVisuals); });

// File passed on the command line (or opened from the file manager).
api.onOpenArg((file) => useStore.getState().open(file));

// Power Query parameters used by source/filter resolution.
setParams(useStore.getState().report.pqParams);
useStore.subscribe((st, prev) => { if (st.report.pqParams !== prev.report.pqParams) setParams(st.report.pqParams); });
