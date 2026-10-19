import type { CrossFilter, DatePart, Filter, FieldRef, Measure, Relationship, TableMeta, Visual } from './types';
import { measureSql } from './dax';
import { isNumeric } from './format';
import { visualDef } from './visuals/catalog';

export const NULL_KEY = '__NULL__';
export const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';
export const ql = (s: string) => "'" + s.replace(/'/g, "''") + "'";

/** `sortCol`: Power BI "sort by column" of a dim (ordering uses it via hidden s_<alias>). */
export interface QueryItem { alias: string; field: FieldRef; well: string; measure: boolean; sortCol?: string; }
export interface VisualQuery {
  sql: string;
  totalsSql?: string;     // grand total (table, matrix)
  colTotalsSql?: string;  // matrix: one row per column value
  rowTotalsSql?: string;  // matrix: one row per row group
  items: QueryItem[];
}
export interface FilterSpec { table: string; column: string; values: string[]; datePart?: DatePart; }

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
/** SQL of a date hierarchy level applied to a column expression (identity without a level). */
export function partExpr(part: DatePart | undefined, sql: string): string {
  switch (part) {
    case 'year': return `CAST(YEAR(${sql}) AS INTEGER)`;
    case 'quarter': return `('Trim ' || QUARTER(${sql}))`;
    case 'month': return `list_extract([${MONTHS.map((m) => `'${m}'`).join(', ')}], MONTH(${sql}))`;
    case 'day': return `CAST(DAY(${sql}) AS INTEGER)`;
    default: return sql;
  }
}

/* ------------------------------------------------------------------ */
/* Relationship graph                                                  */
/* ------------------------------------------------------------------ */

export interface Edge { to: string; parentCol: string; childCol: string; fanout: boolean; }

/**
 * Edges along which a filter on `to` reaches `table` (i.e. we can join from table to `to`
 * and use `to` to filter/group rows of `table`). Power BI semantics: filters flow from the
 * one side to the many side; the reverse only with cross-filter "Entrambe" (or 1:1, *:*).
 * `fanout` marks joins that can multiply rows of the starting table.
 */
export function edgesFrom(rels: Relationship[], table: string): Edge[] {
  const out: Edge[] = [];
  for (const r of rels) {
    if (!r.active || r.fromTable === r.toTable) continue;
    if (r.fromTable === table) {
      out.push({ to: r.toTable, parentCol: r.fromColumn, childCol: r.toColumn, fanout: r.cardinality === 'manyToMany' });
    }
    if (r.toTable === table && (r.crossFilter === 'both' || r.cardinality !== 'manyToOne')) {
      out.push({ to: r.fromTable, parentCol: r.toColumn, childCol: r.fromColumn, fanout: r.cardinality !== 'oneToOne' });
    }
  }
  return out;
}

export function reachable(rels: Relationship[], from: string): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const t = queue.shift()!;
    for (const e of edgesFrom(rels, t)) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return seen;
}

/** True if a and b are connected by active relationships, ignoring direction. */
export function connected(rels: Relationship[], a: string, b: string, ignoreId?: string): boolean {
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length) {
    const t = queue.shift()!;
    if (t === b) return true;
    for (const r of rels) {
      if (!r.active || r.id === ignoreId) continue;
      const next = r.fromTable === t ? r.toTable : r.toTable === t ? r.fromTable : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}

interface JoinTree { alias: Map<string, string>; from: string; fanout: boolean; }

/** Shortest-path join tree from `base` covering `required` (all) and `optional` (when reachable). */
function joinTree(rels: Relationship[], base: string, required: string[], optional: string[]): JoinTree | { missing: string } {
  const parent = new Map<string, { node: string; edge: Edge }>();
  const order = [base];
  const queue = [base];
  const seen = new Set([base]);
  while (queue.length) {
    const t = queue.shift()!;
    for (const e of edgesFrom(rels, t)) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      parent.set(e.to, { node: t, edge: e });
      order.push(e.to);
      queue.push(e.to);
    }
  }
  for (const r of required) if (!seen.has(r)) return { missing: r };

  const needed = new Set<string>([base]);
  for (const t of [...required, ...optional.filter((o) => seen.has(o))]) {
    for (let n: string | undefined = t; n && !needed.has(n); n = parent.get(n)?.node) needed.add(n);
  }
  const alias = new Map<string, string>([[base, 't0']]);
  let sql = `${qi(base)} AS t0`;
  let fanout = false;
  for (const n of order) {
    if (n === base || !needed.has(n)) continue;
    const p = parent.get(n)!;
    const a = 't' + alias.size;
    alias.set(n, a);
    sql += ` LEFT JOIN ${qi(n)} AS ${a} ON ${alias.get(p.node)}.${qi(p.edge.parentCol)} = ${a}.${qi(p.edge.childCol)}`;
    fanout ||= p.edge.fanout;
  }
  return { alias, from: sql, fanout };
}

/* ------------------------------------------------------------------ */
/* Expressions                                                         */
/* ------------------------------------------------------------------ */

function column(tables: TableMeta[], f: FieldRef) {
  return tables.find((t) => t.name === f.table)?.columns.find((c) => c.name === f.column);
}

function measureExpr(tables: TableMeta[], f: FieldRef, c: string): string {
  const num = isNumeric(column(tables, f));
  switch (f.agg) {
    case 'count': return `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'countd': return `CAST(COUNT(DISTINCT ${c}) AS DOUBLE)`;
    case 'sum': return num ? `CAST(SUM(${c}) AS DOUBLE)` : `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'avg': return num ? `CAST(AVG(${c}) AS DOUBLE)` : `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'median': return num ? `CAST(MEDIAN(${c}) AS DOUBLE)` : `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'stdev': return num ? `CAST(STDDEV_SAMP(${c}) AS DOUBLE)` : `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'var': return num ? `CAST(VAR_SAMP(${c}) AS DOUBLE)` : `CAST(COUNT(${c}) AS DOUBLE)`;
    case 'min': return num ? `CAST(MIN(${c}) AS DOUBLE)` : `CAST(MIN(${c}) AS VARCHAR)`;
    case 'max': return num ? `CAST(MAX(${c}) AS DOUBLE)` : `CAST(MAX(${c}) AS VARCHAR)`;
    default: return `CAST(${c} AS VARCHAR)`;
  }
}

/** SQL predicate for a basic filter on column expression `expr`. */
export function filterSql(expr: string, values: string[]): string {
  const vals = values.filter((v) => v !== NULL_KEY);
  const parts: string[] = [];
  if (vals.length) parts.push(`CAST(${expr} AS VARCHAR) IN (${vals.map(ql).join(', ')})`);
  if (vals.length !== values.length) parts.push(`${expr} IS NULL`);
  return '(' + parts.join(' OR ') + ')';
}

/** Filters in scope for visual `v`: report/page/visual filters, other slicers, cross-filter. */
export function effectiveFilters(v: Visual, filters: Filter[], visuals: Visual[], cross: CrossFilter | null): FilterSpec[] {
  const out: FilterSpec[] = [];
  for (const f of [...filters, ...(v.filters ?? [])]) if (f.values.length) out.push(f);
  for (const s of visuals) {
    if (s.id === v.id || s.type !== 'slicer' || !s.slicerValues?.length) continue;
    const field = s.fields.category?.[0];
    if (field) out.push({ table: field.table, column: field.column, values: s.slicerValues, datePart: field.datePart });
  }
  if (cross && cross.visualId !== v.id) out.push({ table: cross.table, column: cross.column, values: [cross.value], datePart: cross.datePart });
  return out;
}

/* ------------------------------------------------------------------ */
/* Query construction                                                  */
/* ------------------------------------------------------------------ */

/** Plain (non-DAX) aggregation: base table, columns read, SQL template. */
interface CompiledMeasure { table: string; cols: string[]; render: (colExprs: string[]) => string; }

interface Ctx { tables: TableMeta[]; rels: Relationship[]; filters: FilterSpec[]; compiled: Map<string, CompiledMeasure>; }
type Core = { sql: string } | { error: string };

const uniq = <T,>(a: T[]) => [...new Set(a)];
const k = (it: QueryItem) => 'k_' + it.alias;
/** Sort key of a dim: its "sort by column", or the month/quarter number of a date hierarchy level. */
const sortKeyOf = (d: QueryItem, colSql: string) => (d.field.datePart === 'month' ? `MONTH(${colSql})` : d.field.datePart === 'quarter' ? `QUARTER(${colSql})` : colSql);
const sk = (it: QueryItem) => 's_' + it.alias;

function whereFor(ctx: Ctx, tree: JoinTree): string {
  const where = ctx.filters.filter((f) => tree.alias.has(f.table)).map((f) => filterSql(partExpr(f.datePart, `${tree.alias.get(f.table)}.${qi(f.column)}`), f.values));
  return where.length ? ` WHERE ${where.join(' AND ')}` : '';
}

function missingError(ctx: Ctx, base: string, missing: string): string {
  if (connected(ctx.rels, base, missing)) {
    return `La relazione tra "${missing}" e "${base}" non consente a "${missing}" di filtrare "${base}". Impostare la direzione del filtro incrociato su "Entrambe" nella vista modello.`;
  }
  return `Impossibile determinare le relazioni tra i campi di "${base}" e "${missing}". Creare una relazione nella vista modello.`;
}

/**
 * Produces a SELECT exposing k_<alias> (raw value) for each dim and <alias> for each measure.
 * Measures are evaluated on their own table ("base") with dims/filters joined in, mirroring
 * how Power BI evaluates a measure in the filter context of each group.
 */
function core(dims: QueryItem[], measures: QueryItem[], ctx: Ctx): Core {
  const dimTables = uniq(dims.map((d) => d.field.table));
  const filterTables = uniq(ctx.filters.map((f) => f.table));

  if (!measures.length) {
    const candidates = uniq([...dimTables, ...ctx.tables.map((t) => t.name)]);
    let tree: JoinTree | null = null;
    for (const base of candidates) {
      const t = joinTree(ctx.rels, base, dimTables, filterTables);
      if (!('missing' in t)) { tree = t; break; }
    }
    if (!tree) return { error: missingError(ctx, dimTables[0], dimTables[1] ?? dimTables[0]) };
    const a = (d: QueryItem) => tree!.alias.get(d.field.table);
    const sel = [...dims.map((d) => `${partExpr(d.field.datePart, `${a(d)}.${qi(d.field.column)}`)} AS ${k(d)}`), ...dims.filter((d) => d.sortCol).map((d) => `${sortKeyOf(d, `${a(d)}.${qi(d.sortCol!)}`)} AS ${sk(d)}`)];
    return { sql: `SELECT DISTINCT ${sel.join(', ')} FROM ${tree.from}${whereFor(ctx, tree)}` };
  }

  const groups = new Map<string, QueryItem[]>();
  for (const m of measures) {
    const base = ctx.compiled.get(m.alias)!.table;
    groups.set(base, [...(groups.get(base) ?? []), m]);
  }

  const parts: string[] = [];
  for (const [base, ms] of groups) {
    const tree = joinTree(ctx.rels, base, dimTables, filterTables);
    if ('missing' in tree) return { error: missingError(ctx, base, tree.missing) };
    const col = (f: FieldRef) => partExpr(f.datePart, `${tree.alias.get(f.table)}.${qi(f.column)}`);
    const sortCol = (d: QueryItem) => sortKeyOf(d, `${tree.alias.get(d.field.table)}.${qi(d.sortCol!)}`);
    const sorted = dims.filter((d) => d.sortCol);
    const where = whereFor(ctx, tree);
    const group = dims.length ? ' GROUP BY ALL' : '';
    const cm = (m: QueryItem) => ctx.compiled.get(m.alias)!;
    if (!tree.fanout) {
      const sel = [...dims.map((d) => `${col(d.field)} AS ${k(d)}`), ...sorted.map((d) => `MIN(${sortCol(d)}) AS ${sk(d)}`), ...ms.map((m) => `${cm(m).render(cm(m).cols.map((c) => `t0.${qi(c)}`))} AS ${m.alias}`)];
      parts.push(`SELECT ${sel.join(', ')} FROM ${tree.from}${where}${group}`);
    } else {
      // A one-to-many hop could repeat base rows: keep each base row once per group.
      const inner = [`t0.rowid AS __rid`, ...dims.map((d) => `${col(d.field)} AS ${k(d)}`), ...sorted.map((d) => `${sortCol(d)} AS ${sk(d)}`),
        ...ms.flatMap((m) => cm(m).cols.map((c, i) => `t0.${qi(c)} AS v_${m.alias}_${i}`))];
      const outer = [...dims.map(k), ...sorted.map((d) => `MIN(${sk(d)}) AS ${sk(d)}`), ...ms.map((m) => `${cm(m).render(cm(m).cols.map((_c, i) => `v_${m.alias}_${i}`))} AS ${m.alias}`)];
      parts.push(`SELECT ${outer.join(', ')} FROM (SELECT DISTINCT ${inner.join(', ')} FROM ${tree.from}${where}) AS f${group}`);
    }
  }
  if (parts.length === 1) return { sql: parts[0] };

  // Measures from several tables: align the per-table results on the dims.
  const ctes = parts.map((p, i) => `q${i} AS (${p})`).join(', ');
  const keyOf = (d: QueryItem, upto: number) => `COALESCE(${Array.from({ length: upto }, (_, i) => `q${i}.${k(d)}`).join(', ')})`;
  let from = 'q0';
  for (let i = 1; i < parts.length; i++) {
    const on = dims.length ? dims.map((d) => `${i === 1 ? `q0.${k(d)}` : keyOf(d, i)} IS NOT DISTINCT FROM q${i}.${k(d)}`).join(' AND ') : 'TRUE';
    from += ` FULL JOIN q${i} ON ${on}`;
  }
  const measureSrc = new Map<string, number>();
  [...groups.values()].forEach((ms, i) => ms.forEach((m) => measureSrc.set(m.alias, i)));
  const sortOf = (d: QueryItem) => `COALESCE(${parts.map((_p, i) => `q${i}.${sk(d)}`).join(', ')})`;
  const sel = [...dims.map((d) => `${keyOf(d, parts.length)} AS ${k(d)}`), ...dims.filter((d) => d.sortCol).map((d) => `${sortOf(d)} AS ${sk(d)}`), ...measures.map((m) => `q${measureSrc.get(m.alias)}.${m.alias}`)];
  return { sql: `WITH ${ctes} SELECT ${sel.join(', ')} FROM ${from}` };
}

/** Adds display (VARCHAR) columns for dims, ordering and limit on top of a core query. */
function finalize(c: { sql: string }, dims: QueryItem[], measures: QueryItem[], order = '', limit = 0): string {
  const sel = [...dims.flatMap((d) => [`CAST(q.${k(d)} AS VARCHAR) AS ${d.alias}`, `q.${k(d)}`, ...(d.sortCol ? [`q.${sk(d)}`] : [])]), ...measures.map((m) => `q.${m.alias}`)];
  return `SELECT ${sel.join(', ')} FROM (${c.sql}) AS q${order ? ` ORDER BY ${order}` : ''}${limit ? ` LIMIT ${limit}` : ''}`;
}

export function buildVisualQuery(
  v: Visual, tables: TableMeta[], rels: Relationship[], filters: Filter[], visuals: Visual[], cross: CrossFilter | null,
  daxMeasures: Measure[] = [],
): VisualQuery | { error: string } | null {
  // These visuals run their own queries (visuals/AiVisuals.tsx).
  if (v.type === 'decompositionTree' || v.type === 'keyInfluencers' || v.type === 'smartNarrative' || v.type === 'qna') return null;
  const def = visualDef(v.type);
  const items: QueryItem[] = [];
  // Hierarchy axis: only the current drill level (or, with "expand all", every level down to it);
  // the values drilled into become filters on the upper levels.
  const extra: Filter[] = [];
  for (const w of def.wells) {
    let fs = v.fields[w.key] ?? [];
    if (w.hierarchy && fs.length > 1) {
      const lvl = Math.min(v.drill?.level ?? 0, fs.length - 1);
      (v.drill?.path ?? []).slice(0, lvl).forEach((val, i) => { if (!v.drill?.expand) extra.push({ id: 'drill' + i, table: fs[i].table, column: fs[i].column, datePart: fs[i].datePart, values: [val === null ? NULL_KEY : val] }); });
      fs = v.drill?.expand ? fs.slice(0, lvl + 1) : [fs[lvl]];
    }
    for (const f of fs) items.push({ alias: 'c' + items.length, field: f, well: w.key, measure: f.agg !== 'none' });
  }
  if (extra.length) v = { ...v, filters: [...(v.filters ?? []), ...extra] };
  if (!items.length) return null;
  // Every measure item compiles to (base table, columns, SQL template): plain aggregations
  // run on their column's table, DAX measures on the table their columns come from.
  const compiled = new Map<string, CompiledMeasure>();
  for (const i of items) {
    if (i.field.agg === 'measure') {
      if (!daxMeasures.some((m) => m.name === i.field.column)) return { error: `La misura [${i.field.column}] non esiste più.` };
      continue;
    }
    if (!tables.some((t) => t.name === i.field.table)) return { error: `La tabella "${i.field.table}" non esiste più nel modello.` };
    if (!column(tables, i.field)) return { error: `Il campo "${i.field.column}" non esiste più.` };
    if (i.measure) {
      const f = i.field;
      compiled.set(i.alias, { table: f.table, cols: [f.column], render: ([e]) => measureExpr(tables, f, e) });
    }
  }

  const ctx: Ctx = { tables, rels, compiled, filters: effectiveFilters(v, filters, visuals, cross).filter((f) => tables.some((t) => t.name === f.table)) };
  const dims = items.filter((i) => !i.measure);
  const measures = items.filter((i) => i.measure);
  for (const d of dims) {
    const t = tables.find((x) => x.name === d.field.table);
    const sc = t?.sortBy?.[d.field.column];
    if (sc && sc !== d.field.column && t!.columns.some((c) => c.name === sc)) d.sortCol = sc;
    // Months and quarters sort by date (MIN of the date column in the group), not alphabetically.
    if (d.field.datePart === 'month' || d.field.datePart === 'quarter') d.sortCol = d.field.column;
  }
  // DAX measures run as correlated subqueries over the groups produced by core():
  // each one sees the visual's filters plus "dim = this group's value".
  const model = { tables, rels, measures: daxMeasures };
  const build = (ds: QueryItem[], ms: QueryItem[]): Core => {
    const plain = ms.filter((m) => m.field.agg !== 'measure');
    const dax = ms.filter((m) => m.field.agg === 'measure');
    const c: Core = !ds.length && !plain.length ? { sql: 'SELECT 1 AS __one' } : core(ds, plain, ctx);
    if ('error' in c || !dax.length) return c;
    try {
      const groups = ds.map((d) => ({ table: d.field.table, column: d.field.column, ref: `g.${k(d)}`, ...(d.field.datePart ? { expr: (x: string) => partExpr(d.field.datePart, x) } : {}) }));
      const outer = ctx.filters.map((f) => ({ ...f, ...(f.datePart ? { expr: (x: string) => partExpr(f.datePart, x) } : {}) }));
      const sel = dax.map((m) => `${measureSql(model, m.field.column, m.field.table, outer, groups)} AS ${m.alias}`);
      let sql = `SELECT g.*, ${sel.join(', ')} FROM (${c.sql}) AS g`;
      // Like Power BI, groups where every measure is blank are not shown.
      if (ds.length && !plain.length) sql = `SELECT * FROM (${sql}) AS b WHERE NOT (${dax.map((m) => `b.${m.alias} IS NULL`).join(' AND ')})`;
      return { sql };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };
  const main = build(dims, measures);
  if ('error' in main) return main;

  // Sorting: explicit choice, else Power BI defaults (time-like axes ascending, charts by value desc).
  let order: string;
  const fmt = v.format;
  const key = (d: QueryItem) => (d.sortCol ? `q.${sk(d)}` : `q.${k(d)}`);
  const dimKey = (d: QueryItem) => `${key(d)} ASC NULLS LAST`;
  if (v.topN && measures.length) {
    order = `${measures[0].alias} ${v.topAsc ? 'ASC' : 'DESC'} NULLS LAST`;
  } else if (fmt.sortBy !== undefined && items[fmt.sortBy]) {
    const it = items[fmt.sortBy];
    order = `${it.measure ? it.alias : key(it)} ${fmt.sortDir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
  } else if (['line', 'area', 'stackedArea', 'table', 'matrix', 'slicer', 'kpi', 'waterfall', 'multiRowCard', 'pythonVisual', 'rVisual'].includes(v.type) || !measures.length || dims.some((d) => d.field.datePart)) {
    order = dims.map(dimKey).join(', ');
  } else if (v.fields.legend?.length && dims.length > 1) {
    // Stacked/clustered with legend: rank categories by their total, like Power BI.
    const cat = dims.find((d) => d.well !== 'legend') ?? dims[0];
    const leg = dims.find((d) => d.well === 'legend')!;
    order = `SUM(q.${measures[0].alias}) OVER (PARTITION BY q.${k(cat)}) DESC, ${key(cat)}, ${key(leg)}`;
  } else {
    order = `${measures[0].alias} DESC NULLS LAST`;
  }
  // Python/R visuals get up to 150,000 rows, like Power BI.
  const limit = v.topN ? v.topN : v.type === 'table' || v.type === 'matrix' ? 5000 : v.type === 'map' || v.type === 'filledMap' ? 10000 : v.type === 'pythonVisual' || v.type === 'rVisual' ? 150000 : 1000;
  const out: VisualQuery = { sql: finalize(main, dims, measures, order, limit), items };

  // Combo chart with a column legend: the lines are per category only (rowTotalsSql, keyed by category).
  const lineVals = measures.filter((m) => m.well === 'lineValues');
  const comboCat = dims.find((d) => d.well === 'category');
  if (lineVals.length && comboCat && dims.some((d) => d.well === 'legend')) {
    const lt = build([comboCat], lineVals);
    if ('sql' in lt) out.rowTotalsSql = finalize(lt, [comboCat], lineVals);
  }

  if ((v.type === 'table' || v.type === 'matrix') && measures.length) {
    const grand = build([], measures);
    if ('sql' in grand) out.totalsSql = finalize(grand, [], measures);
    const colDim = v.type === 'matrix' ? items.find((i) => i.well === 'columns') : undefined;
    const rowDims = items.filter((i) => i.well === 'rows');
    if (colDim) {
      const ct = build([colDim], measures);
      if ('sql' in ct) out.colTotalsSql = finalize(ct, [colDim], measures, dimKey(colDim));
      if (rowDims.length) {
        // Row totals need their own aggregation (AVG etc. are not additive).
        const rt = build(rowDims, measures);
        if ('sql' in rt) out.rowTotalsSql = finalize(rt, rowDims, measures);
      }
    }
  }
  return out;
}
