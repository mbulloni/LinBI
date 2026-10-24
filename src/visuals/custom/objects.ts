// Custom visuals: Power BI report `objects` (expr/Literal form, as stored in the file) ↔ the
// DataViewObjects the visual reads (plain values), persistProperties and JSON filters.
import { literal, themeColor, type Objects } from '../pbistyle';
import type { ColumnMeta, Filter, TableMeta } from '../../types';
import { NULL_KEY } from '../../query';
import { uid } from '../../format';

const L = (v: string) => ({ expr: { Literal: { Value: v } } });

/** One report property value → the value a visual sees (colors as { solid: { color } }). */
export function plainValue(x: any): any {
  if (x === null || x === undefined || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(plainValue);
  if (x.expr) {
    const e = x.expr;
    if (e.Literal) return literal(e.Literal.Value);
    if (e.ThemeDataColor) return themeColor(e.ThemeDataColor.ColorId, e.ThemeDataColor.Percent);
    return undefined; // measures, rules: not static
  }
  if (x.filter) return undefined; // semantic-query filters reach the visual as jsonFilters
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(x)) { const p = plainValue(v); if (p !== undefined) out[k] = p; }
  return out;
}

const props = (e: { properties?: Record<string, any> }) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(e.properties ?? {})) { const p = plainValue(v); if (p !== undefined) out[k] = p; }
  return out;
};

export interface ScopedObjects { obj: string; selector: any; props: Record<string, any>; }

/** Visual-wide objects (no selector) and per-instance ones (selector: data point, series, measure). */
export function dataViewObjects(objs: Objects | undefined): { plain: Record<string, Record<string, any>>; scoped: ScopedObjects[] } {
  const plain: Record<string, Record<string, any>> = {};
  const scoped: ScopedObjects[] = [];
  for (const [obj, entries] of Object.entries(objs ?? {})) {
    for (const e of entries ?? []) {
      if (!e.selector) plain[obj] = { ...plain[obj], ...props(e) };
      else scoped.push({ obj, selector: e.selector, props: props(e) });
    }
  }
  return { plain, scoped };
}

/** Plain value written by the visual (persistProperties) → report expr form. */
export function exprValue(x: any): any {
  if (x === null || x === undefined) return undefined;
  if (typeof x === 'string') return L(`'${x.replace(/'/g, "''")}'`);
  if (typeof x === 'number') return L(Number.isInteger(x) ? `${x}L` : `${x}D`);
  if (typeof x === 'boolean') return L(String(x));
  if (Array.isArray(x)) return x.map(exprValue);
  if (typeof x === 'object') {
    if (x.solid) return { solid: { color: exprValue(x.solid.color) } };
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(x)) { const e = exprValue(v); if (e !== undefined) out[k] = e; }
    return out;
  }
  return undefined;
}

const sameSel = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** VisualObjectInstancesToPersist (merge/replace/remove) applied to the report objects. */
export function persist(objs: Objects | undefined, changes: any): Objects {
  const out: Objects = structuredClone(objs ?? {});
  const entry = (obj: string, selector: any) => {
    const list = (out[obj] ??= []);
    let e = list.find((x) => sameSel(x.selector, selector));
    if (!e) { e = { properties: {}, ...(selector ? { selector } : {}) }; list.push(e); }
    return e;
  };
  for (const kind of ['replace', 'merge'] as const) {
    for (const inst of changes?.[kind] ?? []) {
      if (!inst?.objectName) continue;
      const e = entry(inst.objectName, inst.selector);
      const next: Record<string, any> = kind === 'replace' ? {} : { ...(e.properties ?? {}) };
      for (const [k, v] of Object.entries(inst.properties ?? {})) { const x = exprValue(v); if (x === undefined) delete next[k]; else next[k] = x; }
      e.properties = next;
    }
  }
  for (const inst of changes?.remove ?? []) {
    const e = out[inst?.objectName]?.find((x) => sameSel(x.selector, inst.selector));
    if (e) for (const k of Object.keys(inst.properties ?? {})) delete e.properties?.[k];
  }
  return out;
}

/* ------------------------------ JSON filters ----------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');
/** Value from a visual's filter → MiB-BI filter value (text form of the column, like CAST(... AS VARCHAR)). */
function filterValue(v: unknown, col?: ColumnMeta): string {
  if (v === null || v === undefined) return NULL_KEY;
  const d = v instanceof Date ? v : typeof v === 'string' && col && /^(DATE|TIMESTAMP)/i.test(col.type) && !isNaN(Date.parse(v)) ? new Date(v) : null;
  if (d && col) {
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return /^DATE$/i.test(col.type) ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return String(v);
}

/** Basic "In" filters of host.applyJsonFilter → MiB-BI filters on the target columns.
 *  Advanced (range) filters on a column become the list of its values in range. */
export function jsonFilterToFilters(f: any, tables: TableMeta[], distinct?: (t: string, c: string) => string[] | undefined): Filter[] {
  const list = Array.isArray(f) ? f : f ? [f] : [];
  const out: Filter[] = [];
  for (const x of list) {
    const target = Array.isArray(x?.target) ? x.target : [x?.target];
    if (x?.operator === 'In' && Array.isArray(x.values)) {
      // Tuple filters (several targets): one MiB-BI filter per target column.
      target.forEach((t: any, i: number) => {
        const col = tables.find((tb) => tb.name === t?.table)?.columns.find((c) => c.name === t?.column);
        if (!col) return;
        const values = x.values.map((row: any) => filterValue(Array.isArray(row) ? row[i] : row?.value ?? row, col));
        if (values.length) out.push({ id: uid(), table: t.table, column: t.column, values: [...new Set<string>(values)] });
      });
    } else if (Array.isArray(x?.conditions) && target[0]) {
      const t = target[0];
      const col = tables.find((tb) => tb.name === t.table)?.columns.find((c) => c.name === t.column);
      const all = distinct?.(t.table, t.column);
      if (!col || !all) continue;
      const num = (s: string) => (/^(DATE|TIMESTAMP)/i.test(col.type) ? Date.parse(s.replace(' ', 'T')) : Number(s));
      const test = (s: string, c: any) => {
        const a = num(s), b = c.value instanceof Date ? c.value.getTime() : num(filterValue(c.value, col));
        switch (c.operator) {
          case 'LessThan': return a < b; case 'LessThanOrEqual': return a <= b;
          case 'GreaterThan': return a > b; case 'GreaterThanOrEqual': return a >= b;
          case 'Is': return s === filterValue(c.value, col); case 'IsNot': return s !== filterValue(c.value, col);
          case 'Contains': return s.includes(String(c.value)); case 'DoesNotContain': return !s.includes(String(c.value));
          case 'StartsWith': return s.startsWith(String(c.value)); case 'IsBlank': return s === NULL_KEY; case 'IsNotBlank': return s !== NULL_KEY;
          default: return true;
        }
      };
      const and = x.logicalOperator !== 'Or';
      const values = all.filter((s) => (and ? x.conditions.every((c: any) => test(s, c)) : x.conditions.some((c: any) => test(s, c))));
      out.push({ id: uid(), table: t.table, column: t.column, values: values.length ? values : ['\u0000'] });
    }
  }
  return out;
}

/** MiB-BI "In" filter → Power BI basic JSON filter (restores the visual's selection). */
export function basicJsonFilter(f: Filter, col?: ColumnMeta) {
  const num = col && /INT|DOUBLE|DECIMAL|FLOAT|REAL|NUMERIC/i.test(col.type);
  return {
    $schema: 'https://powerbi.com/product/schema#basic', filterType: 1, target: { table: f.table, column: f.column }, operator: 'In',
    values: f.values.map((v) => (v === NULL_KEY ? null : num ? Number(v) : v)),
  };
}
