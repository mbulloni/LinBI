// Riquadro Analisi: reference lines drawn on a built ECharts option (markLine on the measure's series,
// trend = extra line series from a least-squares fit).
import type { AnalyticsLine, Visual } from '../types';
import type { VisualData } from './useVisualData';
import { fieldLabel, fmtAuto } from '../format';
import { fieldKey } from './condfmt';
import { withAlpha } from './pbistyle';

export const KIND_LABEL: Record<AnalyticsLine['kind'], string> = {
  constant: 'Linea costante', xConstant: 'Linea costante asse X', min: 'Linea min', max: 'Linea max',
  average: 'Linea media', median: 'Linea mediana', percentile: 'Linea percentile', trend: 'Linea di tendenza',
};

const HORIZONTAL = ['stackedBar', 'clusteredBar', 'stackedBar100'];
const STACKED = ['stackedBar', 'stackedColumn', 'stackedBar100', 'stackedColumn100', 'stackedArea'];

/** Lines Power BI offers for a visual type (stacked charts: constant only; scatter: x and y). */
export function analyticsKinds(v: Visual, legend: boolean): AnalyticsLine['kind'][] {
  if (v.type === 'scatter') return ['xConstant', 'constant', 'min', 'max', 'average', 'median', 'percentile', 'trend'];
  if (STACKED.includes(v.type) || v.type.endsWith('100')) return ['constant'];
  const kinds: AnalyticsLine['kind'][] = ['constant'];
  if (!legend) kinds.push('min', 'max', 'average', 'median', 'percentile');
  if (['line', 'area', 'clusteredColumn', 'clusteredBar', 'lineClusteredColumn', 'lineStackedColumn'].includes(v.type)) kinds.push('trend');
  return kinds;
}

export function supportsAnalytics(v: Visual): boolean {
  return v.type === 'scatter' || ['line', 'area', 'stackedArea', 'clusteredColumn', 'clusteredBar', 'stackedColumn', 'stackedBar', 'stackedColumn100', 'stackedBar100', 'lineClusteredColumn', 'lineStackedColumn'].includes(v.type);
}

export function percentile(ys: number[], p: number): number {
  const s = [...ys].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const r = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(r), hi = Math.ceil(r);
  return s[lo] + (s[hi] - s[lo]) * (r - lo);
}

export function stat(kind: AnalyticsLine['kind'], ys: number[], p = 50): number {
  if (!ys.length) return NaN;
  if (kind === 'min') return Math.min(...ys);
  if (kind === 'max') return Math.max(...ys);
  if (kind === 'average') return ys.reduce((a, b) => a + b, 0) / ys.length;
  if (kind === 'median') return percentile(ys, 50);
  return percentile(ys, p);
}

/** Least squares y = a + b·x. */
export function fit(pts: { x: number; y: number }[]): { a: number; b: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (!sxx) return null;
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  return { a: my - b * mx, b };
}

/** Points of a series: category charts use the index as x (continuous axes: the axis value). */
function points(s: any, horizontal: boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  (s.data ?? []).forEach((item: any, i: number) => {
    const raw = item !== null && typeof item === 'object' && !Array.isArray(item) ? item.value : item;
    let x: number, y: number;
    if (Array.isArray(raw)) [x, y] = horizontal ? [raw[1], raw[0]] : [Number(raw[0]), raw[1]];
    else { x = i; y = raw; }
    if (typeof y === 'number' && Number.isFinite(y) && Number.isFinite(x)) out.push({ x, y });
  });
  return out;
}

export function applyAnalytics(v: Visual, d: VisualData, option: any): void {
  const lines = v.format.analytics;
  if (!lines?.length || !supportsAnalytics(v) || !Array.isArray(option.series) || !option.series.length) return;
  const scatter = v.type === 'scatter';
  const horizontal = HORIZONTAL.includes(v.type);
  const series: any[] = option.series;
  const base = series.length;
  const vals = d.items.filter((i) => i.well === 'values'), lineVals = d.items.filter((i) => i.well === 'lineValues');
  const legend = d.items.some((i) => i.well === 'legend');
  const seriesOf = (l: AnalyticsLine): number => {
    if (scatter || legend || !l.measure) return 0;
    const k = vals.findIndex((i) => fieldKey(i.field) === l.measure);
    if (k >= 0) return k;
    const j = lineVals.findIndex((i) => fieldKey(i.field) === l.measure);
    return j >= 0 ? vals.length + j : 0;
  };
  const nameOf = (l: AnalyticsLine, si: number) => {
    if (l.name) return l.name;
    const m = scatter ? d.items.find((i) => i.well === (l.axis === 'x' ? 'x' : 'y')) : [...vals, ...lineVals][si];
    return KIND_LABEL[l.kind] + (m && !['constant', 'xConstant', 'trend'].includes(l.kind) ? ' — ' + fieldLabel(m.field) : '');
  };
  // Keep the legend to the data series.
  if (option.legend && !Array.isArray(option.legend) && !option.legend.data) option.legend.data = series.map((s) => s.name);
  for (const l of lines) {
    const si = Math.min(seriesOf(l), base - 1);
    const s = series[si];
    const color = withAlpha(l.color ?? '#252423', l.transparency);
    const lineStyle = { color, type: l.style ?? 'dashed', width: l.width ?? 1.5 };
    const name = nameOf(l, si);
    if (l.kind === 'trend') {
      const pts = scatter ? series.flatMap((x) => (x.data ?? []).map((p: any) => ({ x: p.value?.[0], y: p.value?.[1] }))).filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y)) : points(s, horizontal);
      const f = fit(pts);
      if (!f) continue;
      const xs = pts.map((p) => p.x);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const categoryAxis = !scatter && !(s.data ?? []).some((x: any) => Array.isArray(x?.value ?? x));
      const data = categoryAxis
        ? (s.data ?? []).map((_: unknown, i: number) => (horizontal ? [f.a + f.b * i, i] : f.a + f.b * i))
        : [[lo, f.a + f.b * lo], [hi, f.a + f.b * hi]].map(([x, y]) => (horizontal ? [y, x] : [x, y]));
      series.push({
        type: 'line', name, data, symbol: 'none', silent: true, z: 100, lineStyle, itemStyle: { color }, tooltip: { show: false },
        ...(s.yAxisIndex !== undefined ? { yAxisIndex: s.yAxisIndex } : {}),
        label: { show: false }, endLabel: { show: !!l.label, formatter: name, color, fontSize: 10 },
      });
      continue;
    }
    let value: number;
    let key: 'xAxis' | 'yAxis' = horizontal ? 'xAxis' : 'yAxis';
    if (l.kind === 'constant' || l.kind === 'xConstant') {
      value = l.value ?? 0;
      if (scatter && l.kind === 'xConstant') key = 'xAxis';
    } else {
      const pts = scatter ? series.flatMap((x) => (x.data ?? []).map((p: any) => ({ x: p.value?.[0], y: p.value?.[1] }))) : points(s, horizontal);
      const useX = scatter && l.axis === 'x';
      if (useX) key = 'xAxis';
      value = stat(l.kind, pts.map((p: any) => (useX ? p.x : p.y)).filter((n: number) => Number.isFinite(n)), l.percentile ?? 50);
    }
    if (!Number.isFinite(value)) continue;
    const target = l.kind === 'constant' && !scatter ? series[0] : s;
    target.markLine ??= { silent: true, symbol: 'none', animation: false, data: [] };
    target.markLine.data.push({
      name, [key]: value, lineStyle,
      label: { show: !!l.label, position: key === 'xAxis' ? 'end' : 'insideEndTop', color, fontSize: 10, formatter: () => `${name}: ${fmtAuto(value)}` },
    });
  }
}
