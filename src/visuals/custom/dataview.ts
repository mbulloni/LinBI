// Custom visuals: query result → Power BI DataView (metadata, categorical, table, tree, single, matrix).
// Power BI hands a visual every shape it can build from the query, so all of them are filled; the
// chosen dataViewMapping decides which roles are categories, series and values. Identities are plain
// { key, sel } records (sel = column predicates): the iframe runtime (host.js) turns them into selection ids.
import type { CustomVisualPkg, FieldRef, Measure, TableMeta, Visual } from '../../types';
import type { QueryItem } from '../../query';
import { fieldLabel } from '../../format';
import { dataViewObjects, type ScopedObjects } from './objects';

export interface Pred { t: string; c: string; v: string | null; part?: string; }
export interface Identity { key: string; sel: Pred[]; }

const AGG_NAME: Record<string, string> = { sum: 'Sum', avg: 'Avg', countd: 'CountNonNull', min: 'Min', max: 'Max', count: 'Count', median: 'Median', stdev: 'StandardDeviation', var: 'Variance' };
const PART: Record<string, string> = { year: 'Anno', quarter: 'Trimestre', month: 'Mese', day: 'Giorno' };

/** queryName as Power BI writes it (Table.Column, Sum(Table.Column), Table.Measure). */
export function queryName(f: FieldRef): string {
  const base = `${f.table}.${f.column}`;
  if (f.datePart) return `${base}.Variation.Gerarchia date.${PART[f.datePart]}`;
  return f.agg === 'none' || f.agg === 'measure' ? base : `${AGG_NAME[f.agg] ?? 'Sum'}(${base})`;
}

function valueType(f: FieldRef, tables: TableMeta[], sample: unknown[]): Record<string, any> {
  if (f.agg === 'count' || f.agg === 'countd') return { numeric: true, integer: true };
  if (f.agg !== 'none') return { numeric: true };
  if (f.datePart) return f.datePart === 'quarter' || f.datePart === 'month' ? { text: true } : { numeric: true, integer: true };
  const t = tables.find((x) => x.name === f.table)?.columns.find((c) => c.name === f.column)?.type.toUpperCase() ?? 'VARCHAR';
  if (/INT/.test(t)) return { numeric: true, integer: true };
  if (/DOUBLE|DECIMAL|FLOAT|REAL|NUMERIC/.test(t)) return { numeric: true };
  if (/^DATE$/.test(t)) return { dateTime: true };
  if (/TIMESTAMP|TIME/.test(t)) return { dateTime: true };
  if (/BOOL/.test(t)) return { bool: true };
  // No data category in the model: URLs of images/pages are recognised from their values.
  const text = sample.filter((x): x is string => typeof x === 'string' && x !== '');
  if (text.length && text.every((x) => /^(https?:\/\/\S+\.(png|jpe?g|gif|svg|webp|bmp)(\?\S*)?|data:image\/)/i.test(x))) return { text: true, misc: { imageUrl: true } };
  if (text.length && text.every((x) => /^https?:\/\//i.test(x))) return { text: true, misc: { webUrl: true } };
  return { text: true };
}

/** Raw value of an item in a result row, typed like Power BI (numbers, Date for dates). */
function rawValue(it: QueryItem, row: Record<string, any>, type: Record<string, any>): any {
  const x = it.measure ? row[it.alias] : row['k_' + it.alias] ?? row[it.alias];
  if (x === null || x === undefined) return null;
  if (type.numeric) { const n = Number(x); return Number.isFinite(n) ? n : null; }
  if (type.dateTime) { const d = new Date(String(x).replace(' ', 'T')); return isNaN(d.getTime()) ? String(x) : d; }
  if (type.bool) return x === true || x === 'true';
  return it.measure ? x : row[it.alias] ?? String(x);
}

/** Text form of a dim value, as LinBI filters and cross-filters compare it. */
const keyText = (it: QueryItem, row: Record<string, any>): string | null => (row[it.alias] === null || row[it.alias] === undefined ? null : String(row[it.alias]));

/** Roles a mapping fragment refers to ({ for: { in } }, { bind: { to } }, select lists, group.by). */
function rolesIn(x: any, out: string[] = []): string[] {
  if (!x || typeof x !== 'object') return out;
  if (Array.isArray(x)) { x.forEach((y) => rolesIn(y, out)); return out; }
  if (x.for?.in && !out.includes(x.for.in)) out.push(x.for.in);
  if (x.bind?.to && !out.includes(x.bind.to)) out.push(x.bind.to);
  for (const [k, v] of Object.entries(x)) if (k !== 'for' && k !== 'bind' && k !== 'dataReductionAlgorithm') rolesIn(v, out);
  return out;
}

/** First mapping whose conditions accept the number of fields in each role. */
function pickMapping(pkg: CustomVisualPkg, v: Visual): any {
  const maps: any[] = pkg.pbiviz?.capabilities?.dataViewMappings ?? [];
  const n = (r: string) => v.fields[r]?.length ?? 0;
  const ok = (m: any) => !m.conditions?.length || m.conditions.some((c: any) => Object.entries<any>(c).every(([r, lim]) => n(r) >= (lim?.min ?? 0) && n(r) <= (lim?.max ?? Infinity)));
  return maps.find(ok) ?? maps[0] ?? {};
}

/** Selector of an instance (persistProperties / per-point formatting) in Power BI's format. */
export function selectorOf(sel: Pred[]): any {
  return {
    data: sel.map((p) => ({
      scopeId: { Comparison: { ComparisonKind: 0, Left: { Column: { Expression: { SourceRef: { Entity: p.t } }, Property: p.c } }, Right: { Literal: { Value: p.v === null ? 'null' : `'${p.v.replace(/'/g, "''")}'` } } } },
    })),
  };
}

/** Whether a stored selector designates this instance (scopeId comparisons, or "all instances" wildcard). */
function matches(selector: any, sel: Pred[]): boolean {
  const data: any[] = selector?.data ?? [];
  if (!data.length) return false;
  return data.every((d) => {
    if (d.dataViewWildcard) return true;
    const cmp = d.scopeId?.Comparison;
    if (!cmp) return false;
    const col = cmp.Left?.Column;
    const lit = String(cmp.Right?.Literal?.Value ?? '');
    const val = lit === 'null' ? null : lit.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'").replace(/^(-?[\d.]+)[LDM]$/, '$1');
    return sel.some((p) => p.c === col?.Property && (!col?.Expression?.SourceRef?.Entity || p.t === col.Expression.SourceRef.Entity) && p.v === val);
  });
}

function objectsFor(scoped: ScopedObjects[], sel: Pred[]): Record<string, any> | undefined {
  let out: Record<string, any> | undefined;
  for (const s of scoped) if (!s.selector?.metadata && matches(s.selector, sel)) (out ??= {})[s.obj] = { ...out?.[s.obj], ...s.props };
  return out;
}

export interface DataViewPayload {
  metadata: { columns: any[]; objects: Record<string, any> };
  categorical?: { categories?: any[]; values?: any[]; series?: { source: any; groups: { name: any; identity: Identity; values: number[]; objects?: any }[] } };
  table: { columns: any[]; rows: any[][]; identity: Identity[] };
  tree: { root: any };
  single?: { value: any };
  matrix?: any;
}

export function buildDataView(pkg: CustomVisualPkg, v: Visual, items: QueryItem[], rows: Record<string, any>[], tables: TableMeta[], measures: Measure[]): DataViewPayload {
  const objs = dataViewObjects(v.style?.objects);
  // One metadata column per distinct field (a field in two roles = one column with both roles).
  const columns: any[] = [];
  const colOf = new Map<QueryItem, any>();
  const types = new Map<QueryItem, Record<string, any>>();
  for (const it of items) {
    const qn = queryName(it.field);
    let col = columns.find((c) => c.queryName === qn);
    if (!col) {
      const type = valueType(it.field, tables, rows.slice(0, 50).map((r) => r[it.alias]));
      const fmt = it.field.agg === 'measure' ? measures.find((m) => m.name === it.field.column)?.formatString : undefined;
      col = {
        roles: {}, type, displayName: fieldLabel(it.field), queryName: qn, index: columns.length, isMeasure: it.measure,
        ...(fmt ? { format: fmt } : {}),
        expr: it.field.agg === 'measure' ? { ref: it.field.column, source: { entity: it.field.table } } : { ref: it.field.column, source: { entity: it.field.table } },
        // Power BI's SQExpr shape used by filter utilities (target table/column).
        ...(it.measure ? {} : { identityExprs: [{ ref: it.field.column, source: { entity: it.field.table } }] }),
      };
      const own = objs.scoped.filter((s) => s.selector?.metadata === qn);
      if (own.length) col.objects = Object.fromEntries(own.map((s) => [s.obj, s.props]));
      columns.push(col);
    }
    col.roles[it.well] = true;
    if (col.rolesIndex) (col.rolesIndex[it.well] ??= []).push(items.filter((x) => x.well === it.well).indexOf(it));
    else col.rolesIndex = { [it.well]: [items.filter((x) => x.well === it.well).indexOf(it)] };
    colOf.set(it, col);
    types.set(it, col.type);
  }
  const dims = items.filter((i) => !i.measure);
  const pred = (it: QueryItem, row: Record<string, any>): Pred => ({ t: it.field.table, c: it.field.column, v: keyText(it, row), ...(it.field.datePart ? { part: it.field.datePart } : {}) });
  const identity = (sel: Pred[]): Identity => ({ key: JSON.stringify(sel), sel });
  const val = (it: QueryItem, row: Record<string, any>) => rawValue(it, row, types.get(it)!);

  // --- table: every column in role order, one row per result row
  const tableItems = uniqBy(items, (i) => colOf.get(i));
  const table = {
    columns: tableItems.map((i) => colOf.get(i)),
    rows: rows.map((r) => tableItems.map((i) => val(i, r))),
    identity: rows.map((r) => identity(dims.map((d) => pred(d, r)))),
  };

  const mapping = pickMapping(pkg, v);
  const out: DataViewPayload = { metadata: { columns, objects: objs.plain }, table, tree: { root: {} } };

  // --- categorical
  const cm = mapping.categorical ?? (!mapping.table && !mapping.single && !mapping.matrix ? {} : undefined);
  if (cm) {
    const seriesRole: string | undefined = cm.values?.group?.by;
    const catRoles = rolesIn(cm.categories);
    const valRoles = rolesIn(cm.values).filter((r) => r !== seriesRole);
    // Grouping fields are categories unless the mapping binds their role as a value (bind.to);
    // measures always go to values, even when listed under categories.select (Power BI does the same).
    const seriesItem = seriesRole ? items.find((i) => i.well === seriesRole && !i.measure) : undefined;
    const catItems = items.filter((i) => !i.measure && i !== seriesItem && (catRoles.includes(i.well) || !valRoles.includes(i.well)));
    const valItems = uniqBy(items.filter((i) => !catItems.includes(i) && i !== seriesItem), (i) => colOf.get(i));

    // Category instances = distinct category tuples, in query order.
    const instKey = (r: Record<string, any>) => JSON.stringify(catItems.map((c) => keyText(c, r)));
    const inst: Record<string, any>[] = [];
    const instIdx = new Map<string, number>();
    for (const r of rows) { const k = instKey(r); if (!instIdx.has(k)) { instIdx.set(k, inst.length); inst.push(r); } }
    if (!catItems.length && rows.length && !seriesItem) { inst.splice(0, inst.length, ...rows.slice(0, 1)); }
    const categories = catItems.map((c) => {
      const instObjs = inst.map((r) => objectsFor(objs.scoped, [pred(c, r)]));
      return {
        source: colOf.get(c), values: inst.map((r) => val(c, r)),
        identity: inst.map((r) => identity(catItems.map((x) => pred(x, r)))),
        identityFields: [colOf.get(c).expr],
        ...(instObjs.some(Boolean) ? { objects: instObjs } : {}),
      };
    });

    let values: any[];
    let series: NonNullable<DataViewPayload['categorical']>['series'];
    if (seriesItem) {
      const sKeys: (string | null)[] = [];
      const sRow = new Map<string | null, Record<string, any>>();
      for (const r of rows) { const k = keyText(seriesItem, r); if (!sRow.has(k)) { sRow.set(k, r); sKeys.push(k); } }
      const cell = new Map<string, Record<string, any>>();
      for (const r of rows) cell.set(instKey(r) + '\u0001' + keyText(seriesItem, r), r);
      values = [];
      series = { source: colOf.get(seriesItem), groups: [] };
      for (const sk of sKeys) {
        const sr = sRow.get(sk)!;
        const sid = identity([pred(seriesItem, sr)]);
        const idxs: number[] = [];
        for (const m of valItems) {
          idxs.push(values.length);
          values.push({
            source: { ...colOf.get(m), groupName: val(seriesItem, sr) },
            values: inst.map((r) => { const c = cell.get(instKey(r) + '\u0001' + sk); return c ? val(m, c) : null; }),
            identity: sid,
          });
        }
        const so = objectsFor(objs.scoped, sid.sel);
        series.groups.push({ name: val(seriesItem, sr), identity: sid, values: idxs, ...(so ? { objects: so } : {}) });
      }
    } else {
      values = valItems.map((m) => {
        const vs = inst.map((r) => val(m, r));
        const nums = vs.filter((x): x is number => typeof x === 'number');
        return { source: colOf.get(m), values: vs, ...(nums.length ? { minLocal: Math.min(...nums), maxLocal: Math.max(...nums) } : {}) };
      });
    }
    // Like Power BI, empty parts are left out (visuals test `categorical.categories` / `values`).
    out.categorical = { ...(categories.length ? { categories } : {}), ...(values.length ? { values } : {}), ...(series ? { series } : {}) } as any;
  }

  // --- single
  const single = mapping.single?.role;
  const sItem = items.find((i) => i.well === single) ?? (single ? undefined : items.find((i) => i.measure));
  if (sItem && rows.length) out.single = { value: val(sItem, rows[0]) };

  // --- tree: one child per row, values keyed by metadata column index
  out.tree.root = {
    childIdentityFields: dims.map((d) => colOf.get(d).expr),
    children: rows.map((r) => {
      const first = dims[0];
      const values: Record<number, { value: any }> = {};
      for (const it of items) values[colOf.get(it).index] = { value: val(it, r) };
      return { ...(first ? { name: keyText(first, r), value: val(first, r) } : {}), values, identity: identity(dims.map((d) => pred(d, r))) };
    }),
  };

  // --- matrix (rows hierarchy × column levels, values); without a matrix mapping: dims as rows, measures as values
  out.matrix = buildMatrix(mapping.matrix ?? null, items, rows, colOf, val, pred, identity);
  return out;
}

function uniqBy<T>(list: T[], key: (x: T) => unknown): T[] {
  const seen = new Set<unknown>();
  return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

function buildMatrix(mm: any | null, items: QueryItem[], rows: Record<string, any>[], colOf: Map<QueryItem, any>,
  val: (it: QueryItem, r: Record<string, any>) => any, pred: (it: QueryItem, r: Record<string, any>) => Pred, identity: (s: Pred[]) => Identity) {
  const rowRoles = rolesIn(mm?.rows), colRoles = rolesIn(mm?.columns), valRoles = rolesIn(mm?.values);
  const rowDims = items.filter((i) => !i.measure && (mm ? rowRoles.includes(i.well) : true));
  const colDims = mm ? items.filter((i) => !i.measure && colRoles.includes(i.well)) : [];
  const vals = uniqBy(items.filter((i) => i.measure || valRoles.includes(i.well)), (i) => colOf.get(i));
  const colKey = (r: Record<string, any>) => JSON.stringify(colDims.map((c) => r[c.alias] ?? null));
  // Column leaves (one per distinct column tuple; a single implicit leaf without column dims).
  const leaves: Record<string, any>[] = [];
  const leafIdx = new Map<string, number>();
  for (const r of rows) { const k = colKey(r); if (!leafIdx.has(k)) { leafIdx.set(k, leaves.length); leaves.push(r); } }
  const columnsRoot: any = { children: [] };
  for (const r of leaves) {
    let node = columnsRoot;
    colDims.forEach((c, lvl) => {
      const v = val(c, r);
      let child = node.children.find((x: any) => x.value === v || (x.value instanceof Date && v instanceof Date && +x.value === +v));
      if (!child) { child = { level: lvl, value: v, identity: identity(colDims.slice(0, lvl + 1).map((d) => pred(d, r))), children: [] }; node.children.push(child); }
      node = child;
    });
    if (vals.length > 1 || !colDims.length) node.children = vals.map((_m, i) => ({ level: colDims.length, levelSourceIndex: i }));
    else delete node.children;
  }
  const rowsRoot: any = { children: [] };
  for (const r of rows) {
    let node = rowsRoot;
    rowDims.forEach((d, lvl) => {
      const v = val(d, r);
      let child = node.children?.find((x: any) => x.value === v || (x.value instanceof Date && v instanceof Date && +x.value === +v));
      if (!child) { child = { level: lvl, value: v, identity: identity(rowDims.slice(0, lvl + 1).map((x) => pred(x, r))), children: [] }; (node.children ??= []).push(child); }
      node = child;
    });
    node.values ??= {};
    const base = leafIdx.get(colKey(r))! * vals.length;
    vals.forEach((m, i) => { node.values[base + i] = { value: val(m, r), ...(i ? { valueSourceIndex: i } : {}) }; });
  }
  const clean = (n: any) => { if (n.children && !n.children.length) delete n.children; n.children?.forEach(clean); };
  clean(rowsRoot);
  return {
    rows: { root: rowsRoot, levels: rowDims.map((d) => ({ sources: [colOf.get(d)] })) },
    columns: { root: columnsRoot, levels: [...colDims.map((d) => ({ sources: [colOf.get(d)] })), ...(vals.length ? [{ sources: vals.map((m) => colOf.get(m)) }] : [])] },
    valueSources: vals.map((m) => colOf.get(m)),
  };
}

/** Allowed network for the visual: legacy packages (no privileges) like Power BI at the time, else declared WebAccess origins. */
export function webAccess(pkg: CustomVisualPkg): string[] | 'any' | 'none' {
  const priv: any[] | undefined = pkg.pbiviz?.capabilities?.privileges;
  if (!priv) {
    const api = String(pkg.pbiviz?.apiVersion ?? '1').split('.').map(Number);
    return api[0] < 4 ? 'any' : 'none';
  }
  const web = priv.find((p) => p.name === 'WebAccess');
  if (!web) return 'none';
  const list: string[] = (web.parameters ?? []).filter((x: unknown): x is string => typeof x === 'string');
  return list.includes('*') ? 'any' : list.length ? list : 'none';
}
