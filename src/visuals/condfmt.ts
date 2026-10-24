// Conditional formatting (Power BI "Formattazione condizionale"): per value field of a table/matrix,
// background and font color gradients, data bars and icons; for charts, data colors by value.
import type { CSSProperties } from 'react';
import type { CfRule, ColorScale, CondFormat, FieldRef } from '../types';

export const fieldKey = (f: FieldRef) => `${f.table}\u0001${f.column}\u0001${f.agg}`;
/** Field driving a format: plain columns are summed (Power BI aggregates the "In base al campo" field). */
export const cfInput = (f: FieldRef): FieldRef => (f.agg === 'none' ? { ...f, agg: 'sum', datePart: undefined } : f);

export const DEFAULT_CF = {
  background: { min: '#F8696B', max: '#63BE7B' } as ColorScale,
  font: { min: '#D64554', max: '#1AAB40' } as ColorScale,
  bars: { positive: '#118DFF', negative: '#D64554' },
};

export interface Range { min: number; max: number; }

export function rangeOf(values: unknown[]): Range | null {
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return min <= max ? { min, max } : null;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** Color of `x` on the gradient (lowest value → min color, highest → max color, optional mid color). */
export function scaleColor(scale: ColorScale, r: Range, x: number): string {
  const lo = scale.minValue ?? r.min, hi = scale.maxValue ?? r.max;
  const mid = scale.midValue ?? (lo + hi) / 2;
  const mix = (a: string, b: string, t: number) => { const ca = rgb(a), cb = rgb(b); t = Math.max(0, Math.min(1, t)); return '#' + ca.map((c, i) => hex2(c + (cb[i] - c) * t)).join(''); };
  if (scale.mid) return x < mid ? mix(scale.min, scale.mid, mid === lo ? 1 : (x - lo) / (mid - lo)) : mix(scale.mid, scale.max, hi === mid ? 1 : (x - mid) / (hi - mid));
  return mix(scale.min, scale.max, hi === lo ? 1 : (x - lo) / (hi - lo));
}

/** First rule matching `x` (number, or null for blank). */
export function ruleValue(rules: CfRule[] | undefined, x: number | null): string | undefined {
  for (const r of rules ?? []) {
    if (r.blank) { if (x === null) return r.value; continue; }
    if (x === null) continue;
    if (r.min !== undefined && (r.minInc === false ? x <= r.min : x < r.min)) continue;
    if (r.max !== undefined && (r.maxInc ? x > r.max : x >= r.max)) continue;
    return r.value;
  }
  return undefined;
}

/** Built-in Power BI icon names MiB-BI draws (directional and shape sets). */
export const ICON_SET: Record<string, { ch: string; color: string }> = {
  TriangleLow: { ch: '▼', color: '#D64554' }, TriangleMedium: { ch: '▬', color: '#F2C80F' }, TriangleHigh: { ch: '▲', color: '#1AAB40' },
  ArrowDown: { ch: '↓', color: '#D64554' }, ArrowRightDown: { ch: '↘', color: '#F2C80F' }, ArrowRight: { ch: '→', color: '#F2C80F' }, ArrowRightUp: { ch: '↗', color: '#F2C80F' }, ArrowUp: { ch: '↑', color: '#1AAB40' },
  CircleLow: { ch: '●', color: '#D64554' }, CircleMedium: { ch: '●', color: '#F2C80F' }, CircleHigh: { ch: '●', color: '#1AAB40' }, CircleEmpty: { ch: '○', color: '#605E5C' },
  TrafficLow: { ch: '●', color: '#D64554' }, TrafficMedium: { ch: '●', color: '#F2C80F' }, TrafficHigh: { ch: '●', color: '#1AAB40' },
  DiamondMedium: { ch: '◆', color: '#F2C80F' }, FlagLow: { ch: '⚑', color: '#D64554' }, FlagMedium: { ch: '⚑', color: '#F2C80F' }, FlagHigh: { ch: '⚑', color: '#1AAB40' },
  CheckmarkHigh: { ch: '✔', color: '#1AAB40' }, ExclamationMedium: { ch: '!', color: '#F2C80F' }, XMarkLow: { ch: '✖', color: '#D64554' },
  StarEmpty: { ch: '☆', color: '#F2C80F' }, StarHalf: { ch: '⯪', color: '#F2C80F' }, StarFull: { ch: '★', color: '#F2C80F' },
};
const iconOf = (name: string) => ICON_SET[name] ?? { ch: '●', color: '#605E5C' };

/** Readable text on a colored background. */
const ink = (bg: string) => { const [r, g, b] = rgb(bg); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#252423' : '#FFFFFF'; };

/** Default icon set: the range split in thirds (Power BI's percent rules 0–33–67–100). */
export const DEFAULT_ICONS = ['TriangleLow', 'TriangleMedium', 'TriangleHigh'];

/** Cell decoration for driving value `x` (the field itself or the "In base al campo" one), values spanning `r`. */
export function cellFormat(cf: CondFormat | undefined, r: Range | null, x: unknown): { style?: CSSProperties; icon?: { ch: string; color: string } } {
  if (!cf) return {};
  const n0 = x === null || x === undefined || x === '' ? null : Number(x);
  const n = n0 !== null && Number.isFinite(n0) ? n0 : null;
  const style: CSSProperties = {};
  const bgRule = ruleValue(cf.bgRules, n), fgRule = ruleValue(cf.fontRules, n);
  if (bgRule) { style.backgroundColor = bgRule; style.color = ink(bgRule); }
  if (fgRule) style.color = fgRule;
  const iconRule = ruleValue(cf.iconRules, n);
  if (n === null || !r) return { style, ...(iconRule ? { icon: iconOf(iconRule) } : {}) };
  if (cf.background && !bgRule) { style.backgroundColor = scaleColor(cf.background, r, n); style.color = ink(style.backgroundColor); }
  if (cf.font && !fgRule) style.color = scaleColor(cf.font, r, n);
  if (cf.bars) {
    const lo = Math.min(0, r.min), hi = Math.max(0, r.max), span = hi - lo || 1;
    const zero = ((0 - lo) / span) * 100, end = ((n - lo) / span) * 100;
    const [from, to] = n >= 0 ? [zero, end] : [end, zero];
    const c = n >= 0 ? cf.bars.positive : cf.bars.negative;
    style.backgroundImage = `linear-gradient(to right, transparent ${from}%, ${c}66 ${from}%, ${c}66 ${to}%, transparent ${to}%)`;
  }
  let icon = iconRule ? iconOf(iconRule) : undefined;
  if (!icon && cf.icons && !cf.iconRules?.length) {
    const t = r.max === r.min ? 1 : (n - r.min) / (r.max - r.min);
    icon = iconOf(DEFAULT_ICONS[t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2]);
  }
  return { style, icon };
}
