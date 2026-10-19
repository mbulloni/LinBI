// Power BI formatting kept as-is from .pbix/.pbit/.pbip (Visual.style = singleVisual objects/vcObjects):
// renderers read what they support through these helpers, export writes it back untouched.
// Lookup order: the visual's own objects, then the theme's visualStyles[<type>]['*'], then ['*']['*'].
import type { Theme, Visual } from '../types';
import { PALETTE } from '../format';

type Entry = { properties?: Record<string, any>; selector?: any };
export type Objects = Record<string, Entry[]>;
export interface PbiStyle { pbiType?: string; objects?: Objects; vcObjects?: Objects; /** whole singleVisual of visuals LinBI cannot render (written back as is) */ raw?: unknown; }

/** Theme in use (set by applyTheme): data colors, background/foreground, visualStyles. */
export const STYLE_THEME: { theme?: Theme } = {};

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Theme color picker entry: 0 = background (white), 1 = foreground (black), 2.. = data colors; Percent tints (>0) or shades (<0). */
export function themeColor(id: number, percent = 0): string {
  const t = STYLE_THEME.theme;
  const base = id === 0 ? t?.background ?? '#FFFFFF' : id === 1 ? t?.foreground ?? '#000000' : PALETTE[(id - 2) % PALETTE.length];
  if (!percent) return base.toUpperCase();
  const c = rgb(base);
  return toHex(c.map((x) => (percent > 0 ? x + (255 - x) * percent : x * (1 + percent))));
}

/** Literal value: 'text', 12D/12L/12M numbers, true/false, null. */
export function literal(v: string): string | number | boolean | null {
  if (v === 'true' || v === 'false') return v === 'true';
  if (v === 'null') return null;
  const s = /^'(.*)'$/s.exec(v);
  if (s) return s[1].replace(/''/g, "'");
  const n = /^(-?[\d.]+(?:E[+-]?\d+)?)[LDM]?$/i.exec(v);
  if (n) return Number(n[1]);
  return v;
}

/** Decodes a property value (report expr or plain theme JSON) to string/number/boolean; colors to #RRGGBB. */
export function decode(x: any): any {
  if (x === null || x === undefined) return undefined;
  if (typeof x !== 'object') return x;
  if (x.solid) return decode(x.solid.color);
  if (x.expr) {
    const e = x.expr;
    if (e.Literal) return literal(e.Literal.Value);
    if (e.ThemeDataColor) return themeColor(e.ThemeDataColor.ColorId, e.ThemeDataColor.Percent);
    return undefined; // measures, conditional rules: not static
  }
  if (x.Literal) return literal(x.Literal.Value);
  return undefined;
}

/** Entries that apply to the visual as a whole (buttons: the "default" state). */
const plain = (e: Entry) => !e.selector || e.selector.id === 'default';

function themeProp(pbiType: string | undefined, obj: string, prop: string): any {
  const vs = (STYLE_THEME.theme as any)?.visualStyles;
  if (!vs) return undefined;
  for (const t of [pbiType, '*']) {
    if (!t) continue;
    const v = vs[t]?.['*']?.[obj]?.[0]?.[prop];
    if (v !== undefined) return decode(v);
  }
  return undefined;
}

/** Property of an object without selector (objects first, then vcObjects), falling back to the theme.
 *  `state` (buttons: hover, press, selected) overrides the default state when set. */
export function sp(v: Visual, obj: string, prop: string, state?: string): any {
  const st = v.style;
  for (const objs of [st?.objects, st?.vcObjects]) {
    const entries = objs?.[obj] ?? [];
    if (state) {
      const val = decode(entries.find((e) => e.selector?.id === state && e.properties?.[prop] !== undefined)?.properties?.[prop]);
      if (val !== undefined) return val;
    }
    for (const e of entries) {
      if (!plain(e)) continue;
      const val = decode(e.properties?.[prop]);
      if (val !== undefined) return val;
    }
  }
  return themeProp(st?.pbiType, obj, prop);
}

/** Entries of an object that target data points (dataPoint fill per category/series). */
export function selected(v: Visual, obj: string): Entry[] {
  return (v.style?.objects?.[obj] ?? []).filter((e) => e.selector);
}

/** Power BI font sizes are points. */
export const pt = (n: unknown, fallback?: number): number | undefined => {
  const x = typeof n === 'string' && /^[\d.]+$/.test(n) ? Number(n) : n;
  return typeof x === 'number' && x > 0 ? Math.round(x * 4 / 3 * 10) / 10 : fallback;
};

/** Power BI font family names → CSS stack. */
export const font = (f: unknown): string | undefined => {
  if (typeof f !== 'string' || !f) return undefined;
  const names = f.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [...names.map((n) => `'${n}'`), "'Segoe UI'", "'Ubuntu Sans'", 'sans-serif'].join(', ');
};

/** Color with transparency (0–100, Power BI) → CSS. */
export function withAlpha(hex: string, transparency: unknown): string {
  const t = typeof transparency === 'number' ? Math.max(0, Math.min(100, transparency)) : 0;
  if (!t) return hex;
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${(100 - t) / 100})`;
}

/** Display units: 0/1 auto/none, 1e3 K, 1e6 Mln, 1e9 Mrd, 1e12 Bln. */
export function units(n: number, unit: unknown, precision: unknown): string | undefined {
  if (typeof unit !== 'number' || unit === 0) {
    // Automatic units: only when a precision is set (otherwise LinBI's own automatic format applies).
    if (typeof precision !== 'number') return undefined;
    const a = Math.abs(n);
    unit = a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
  }
  if (typeof unit !== 'number') return undefined;
  const p = typeof precision === 'number' ? precision : unit === 1 ? undefined : 1;
  const suffix: Record<number, string> = { 1: '', 1000: ' K', 1000000: ' Mln', 1000000000: ' Mrd', 1000000000000: ' Bln' };
  const v = unit === 1 ? n : n / unit;
  return v.toLocaleString('it-IT', p === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: p, maximumFractionDigits: p }) + (suffix[unit] ?? '');
}

/** Query reference Power BI uses in selectors/projections ("Table.Measure", "Sum(Table.Column)"). */
export function queryRef(f: { table: string; column: string; agg: string }): string {
  const fn: Record<string, string> = { sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count', countd: 'CountNonNull', median: 'Median', stdev: 'StandardDeviation', var: 'Variance' };
  return fn[f.agg] ? `${fn[f.agg]}(${f.table}.${f.column})` : `${f.table}.${f.column}`;
}

/** dataPoint fills set on single categories/legend values (scopeId) or series (metadata = queryRef). */
export function pointColors(v: Visual): { byValue: Map<string, string>; byRef: Map<string, string> } {
  const byValue = new Map<string, string>(), byRef = new Map<string, string>();
  for (const e of selected(v, 'dataPoint')) {
    const c = decode(e.properties?.fill);
    if (typeof c !== 'string') continue;
    const sel = e.selector;
    const lit = sel?.data?.[0]?.scopeId?.Comparison?.Right?.Literal?.Value;
    if (lit !== undefined) { const x = literal(lit); byValue.set(x === null ? '' : String(x), c); }
    else if (sel?.metadata) byRef.set(sel.metadata, c);
  }
  return { byValue, byRef };
}
