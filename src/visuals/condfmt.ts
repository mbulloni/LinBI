// Conditional formatting (Power BI "Formattazione condizionale"): per value field of a table/matrix,
// background and font color gradients, data bars and icons; for charts, data colors by value.
import type { CSSProperties } from 'react';
import type { ColorScale, CondFormat, FieldRef } from '../types';

export const fieldKey = (f: FieldRef) => `${f.table}\u0001${f.column}\u0001${f.agg}`;

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
  let t = r.max === r.min ? 1 : (x - r.min) / (r.max - r.min);
  t = Math.max(0, Math.min(1, t));
  let a = scale.min, b = scale.max;
  if (scale.mid) { if (t < 0.5) { b = scale.mid; t *= 2; } else { a = scale.mid; t = (t - 0.5) * 2; } }
  const ca = rgb(a), cb = rgb(b);
  return '#' + ca.map((c, i) => hex2(c + (cb[i] - c) * t)).join('');
}

/** Readable text on a colored background. */
const ink = (bg: string) => { const [r, g, b] = rgb(bg); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#252423' : '#FFFFFF'; };

const ICONS = [{ ch: '▼', color: '#D64554' }, { ch: '◆', color: '#F2C80F' }, { ch: '▲', color: '#1AAB40' }];

/** Cell decoration for value `x` of a field whose visible values span `r`. */
export function cellFormat(cf: CondFormat | undefined, r: Range | null, x: unknown): { style?: CSSProperties; icon?: { ch: string; color: string } } {
  if (!cf || !r || x === null || x === undefined) return {};
  const n = Number(x);
  if (!Number.isFinite(n)) return {};
  const style: CSSProperties = {};
  if (cf.background) { style.backgroundColor = scaleColor(cf.background, r, n); style.color = ink(style.backgroundColor); }
  if (cf.font) style.color = scaleColor(cf.font, r, n);
  if (cf.bars) {
    const lo = Math.min(0, r.min), hi = Math.max(0, r.max), span = hi - lo || 1;
    const zero = ((0 - lo) / span) * 100, end = ((n - lo) / span) * 100;
    const [from, to] = n >= 0 ? [zero, end] : [end, zero];
    const c = n >= 0 ? cf.bars.positive : cf.bars.negative;
    style.backgroundImage = `linear-gradient(to right, transparent ${from}%, ${c}66 ${from}%, ${c}66 ${to}%, transparent ${to}%)`;
  }
  let icon;
  if (cf.icons) {
    const t = r.max === r.min ? 1 : (n - r.min) / (r.max - r.min);
    icon = ICONS[t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2];
  }
  return { style, icon };
}
