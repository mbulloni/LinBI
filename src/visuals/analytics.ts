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
  forecast: 'Previsione', errorBars: 'Barre di errore',
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
  // Forecast: line charts with one measure and no legend (on a continuous axis, checked when drawing).
  if (v.type === 'line' && !legend) kinds.push('forecast');
  if (!legend && ['line', 'area', 'clusteredColumn', 'clusteredBar', 'lineClusteredColumn'].includes(v.type)) kinds.push('errorBars');
  return kinds;
}

const Z: Record<number, number> = { 75: 1.1503, 80: 1.2816, 85: 1.4395, 90: 1.6449, 95: 1.96, 99: 2.5758 };

/** Season length with the strongest autocorrelation (after removing the trend), 0 when none is clear. */
export function detectSeason(ys: number[]): number {
  const n = ys.length;
  const d = ys.slice(1).map((y, i) => y - ys[i]);
  const m = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const den = d.reduce((a, b) => a + (b - m) ** 2, 0);
  if (!den) return 0;
  let best = 0, bestR = 0.3;
  for (let lag = 2; lag <= Math.min(24, Math.floor(n / 2)); lag++) {
    let num = 0;
    for (let i = lag; i < d.length; i++) num += (d[i] - m) * (d[i - lag] - m);
    const r = num / den;
    if (r > bestR) { bestR = r; best = lag; }
  }
  return n >= 2 * best ? best : 0;
}

/**
 * Exponential smoothing like Power BI's forecast: Holt-Winters additive (Holt linear without seasonality),
 * parameters by grid search on one-step errors; band = z · σ · √h.
 */
export function forecastSeries(ys: number[], h: number, season = 0, confidence = 95): { mean: number[]; lo: number[]; hi: number[] } | null {
  const n = ys.length;
  if (n < 3 || h < 1) return null;
  const m = season > 1 && n >= 2 * season ? season : 0;
  const run = (a: number, b: number, g: number) => {
    let level = m ? ys.slice(0, m).reduce((x, y) => x + y, 0) / m : ys[0];
    let trend = m ? (ys.slice(m, 2 * m).reduce((x, y) => x + y, 0) - ys.slice(0, m).reduce((x, y) => x + y, 0)) / (m * m) : ys[1] - ys[0];
    const seas = m ? ys.slice(0, m).map((y) => y - level) : [];
    let sse = 0;
    for (let t = m ? m : 1; t < n; t++) {
      const sIdx = m ? t % m : 0;
      const pred = level + trend + (m ? seas[sIdx] : 0);
      sse += (ys[t] - pred) ** 2;
      const prevLevel = level;
      level = a * (ys[t] - (m ? seas[sIdx] : 0)) + (1 - a) * (level + trend);
      trend = b * (level - prevLevel) + (1 - b) * trend;
      if (m) seas[sIdx] = g * (ys[t] - level) + (1 - g) * seas[sIdx];
    }
    return { sse, level, trend, seas };
  };
  let best: ReturnType<typeof run> & { a: number } | null = null;
  const grid = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
  for (const a of grid) for (const b of [0.01, 0.05, 0.1, 0.2, 0.4]) for (const g of m ? [0.05, 0.1, 0.3, 0.5] : [0]) {
    const r = run(a, b, g);
    if (!best || r.sse < best.sse) best = { ...r, a };
  }
  if (!best) return null;
  const sigma = Math.sqrt(best.sse / Math.max(1, n - (m || 1)));
  const z = Z[confidence] ?? 1.96;
  const mean: number[] = [], lo: number[] = [], hi: number[] = [];
  for (let k = 1; k <= h; k++) {
    const y = best.level + k * best.trend + (m ? best.seas[(n + k - 1) % m] : 0);
    const w = z * sigma * Math.sqrt(1 + (k - 1) * best.a * best.a);
    mean.push(y); lo.push(y - w); hi.push(y + w);
  }
  return { mean, lo, hi };
}

/** Next x values of a continuous axis: calendar months/years when the points are month/year starts, else the usual step. */
function futureX(xs: number[], h: number, time: boolean): number[] {
  const n = xs.length;
  if (time && n > 1) {
    const ds = xs.map((x) => new Date(x));
    const monthly = ds.every((d) => d.getUTCDate() === ds[0].getUTCDate()) && xs.slice(1).every((x, i) => (x - xs[i]) / 864e5 >= 27 && (x - xs[i]) / 864e5 <= 31 * 12 + 1);
    if (monthly) {
      const months = Math.round((ds[n - 1].getUTCFullYear() * 12 + ds[n - 1].getUTCMonth() - (ds[0].getUTCFullYear() * 12 + ds[0].getUTCMonth())) / (n - 1)) || 1;
      return Array.from({ length: h }, (_, k) => Date.UTC(ds[n - 1].getUTCFullYear(), ds[n - 1].getUTCMonth() + months * (k + 1), ds[n - 1].getUTCDate()));
    }
  }
  const steps = xs.slice(1).map((x, i) => x - xs[i]).sort((a, b) => a - b);
  const step = steps[Math.floor(steps.length / 2)] || 1;
  return Array.from({ length: h }, (_, k) => xs[n - 1] + step * (k + 1));
}

/** Category key of a row, as cartesian() builds categories ("expand all" joins the levels). */
function catKey(d: VisualData, r: Record<string, any>): string | null {
  const cats = d.items.filter((i) => i.well === 'category');
  if (!cats.length) return null;
  return cats.length > 1 ? cats.map((c) => r[c.alias] ?? '(Vuoto)').join(' ') : r[cats[0].alias];
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
    if (l.kind === 'forecast') {
      // Continuous axis only: data are [x, y] points.
      const pts = (s.data ?? []).map((it: any) => (it && typeof it === 'object' && !Array.isArray(it) ? it.value : it)).filter((p: any) => Array.isArray(p) && Number.isFinite(Number(p[0])) && typeof p[1] === 'number');
      const keep = pts.slice(0, Math.max(0, pts.length - (l.ignoreLast ?? 0)));
      if (keep.length < 3) continue;
      const xs = keep.map((p: any) => Number(p[0])), ys = keep.map((p: any) => p[1] as number);
      const h = Math.max(1, Math.min(500, l.forecastLength ?? 10));
      const fc = forecastSeries(ys, h, l.seasonality || detectSeason(ys), l.confidence ?? 95);
      if (!fc) continue;
      const time = option.xAxis?.type === 'time' || (Array.isArray(option.xAxis) && option.xAxis[0]?.type === 'time');
      const fx = futureX(xs, h, time);
      const fcolor = l.color ?? s.itemStyle?.color ?? s.lineStyle?.color ?? '#118DFF';
      const last = [xs[xs.length - 1], ys[ys.length - 1]];
      const stack = `__fc${si}`;
      series.push(
        { type: 'line', name: `${name} — limite inferiore`, data: fx.map((x, k) => [x, fc.lo[k]]), stack, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false }, z: 90 },
        { type: 'line', name: `${name} — intervallo di confidenza ${l.confidence ?? 95}%`, data: fx.map((x, k) => [x, fc.hi[k] - fc.lo[k]]), stack, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: withAlpha(fcolor, l.shadeTransparency ?? 80) }, tooltip: { show: false }, z: 90 },
        { type: 'line', name, data: [last, ...fx.map((x, k) => [x, fc.mean[k]])], symbol: 'none', z: 100, lineStyle: { color: withAlpha(fcolor, l.transparency), type: l.style ?? 'solid', width: l.width ?? 2 }, itemStyle: { color: fcolor },
          tooltip: { valueFormatter: (x: number) => fmtAuto(x) } },
      );
      continue;
    }
    if (l.kind === 'errorBars') {
      const lo: (number | null)[] = [], hi: (number | null)[] = [];
      const ys = (s.data ?? []).map((it: any) => { const raw = it && typeof it === 'object' && !Array.isArray(it) ? it.value : it; return Array.isArray(raw) ? (horizontal ? raw[0] : raw[1]) : raw; });
      if (l.errMode === 'field') {
        const alias = (f?: AnalyticsLine['upper']) => (f ? d.cfItems.find((i) => fieldKey(i.field) === fieldKey(f))?.alias : undefined);
        const ua = alias(l.upper), la = alias(l.lower);
        const order: (string | null)[] = [];
        const byCat = new Map<string | null, Record<string, any>>();
        for (const r of d.rows) { const k = catKey(d, r); if (!byCat.has(k)) { byCat.set(k, r); order.push(k); } }
        order.forEach((k, i) => { const r = byCat.get(k)!; lo[i] = la && typeof r[la] === 'number' ? r[la] : null; hi[i] = ua && typeof r[ua] === 'number' ? r[ua] : null; });
      } else {
        const nums = ys.filter((y: any) => typeof y === 'number');
        const mean = nums.reduce((a: number, b: number) => a + b, 0) / (nums.length || 1);
        const sd = Math.sqrt(nums.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / Math.max(1, nums.length - 1));
        ys.forEach((y: any, i: number) => {
          if (typeof y !== 'number') { lo[i] = hi[i] = null; return; }
          const w = l.errMode === 'stdev' ? (l.errValue ?? 1) * sd : Math.abs(y) * (l.errValue ?? 10) / 100;
          lo[i] = y - w; hi[i] = y + w;
        });
      }
      const cont = (s.data ?? []).some((it: any) => Array.isArray(it?.value ?? it));
      const xOf = (i: number) => { const it = s.data[i]; const raw = it && typeof it === 'object' && !Array.isArray(it) ? it.value : it; return cont ? Number(horizontal ? raw[1] : raw[0]) : i; };
      const data = ys.map((_: unknown, i: number) => (lo[i] === null || hi[i] === null || lo[i] === undefined ? null : [xOf(i), lo[i], hi[i]])).filter(Boolean);
      // Bars of clustered charts: the error bar sits on its own bar of the category.
      const nBars = s.type === 'bar' ? series.slice(0, base).filter((x) => x.type === 'bar').length : 0;
      const barIdx = s.type === 'bar' ? series.slice(0, si).filter((x) => x.type === 'bar').length : 0;
      const ecolor = l.color ?? '#252423';
      series.push({
        type: 'custom', name, silent: true, z: 110, data, tooltip: { show: false },
        ...(s.yAxisIndex !== undefined ? { yAxisIndex: s.yAxisIndex } : {}),
        encode: horizontal ? { y: 0, x: [1, 2] } : { x: 0, y: [1, 2] },
        renderItem: (_p: any, api: any) => {
          const x = api.value(0), a = api.value(1), b = api.value(2);
          const pa = api.coord(horizontal ? [a, x] : [x, a]), pb = api.coord(horizontal ? [b, x] : [x, b]);
          let off = 0;
          const band = api.size(horizontal ? [0, 1] : [1, 0])[horizontal ? 1 : 0] || 0;
          if (nBars > 1 && !cont) {
            const usable = band * 0.8, bw = usable / (nBars + (nBars - 1) * 0.3);
            off = -usable / 2 + bw / 2 + barIdx * bw * 1.3;
          }
          const cap = Math.max(4, Math.min(10, band / (nBars || 1) / 4));
          const st = { stroke: withAlpha(ecolor, l.transparency), lineWidth: l.width ?? 1.5 };
          const seg = (x1: number, y1: number, x2: number, y2: number) => ({ type: 'line', shape: { x1, y1, x2, y2 }, style: st });
          return horizontal
            ? { type: 'group', children: [seg(pa[0], pa[1] + off, pb[0], pb[1] + off), seg(pa[0], pa[1] + off - cap, pa[0], pa[1] + off + cap), seg(pb[0], pb[1] + off - cap, pb[0], pb[1] + off + cap)] }
            : { type: 'group', children: [seg(pa[0] + off, pa[1], pb[0] + off, pb[1]), seg(pa[0] + off - cap, pa[1], pa[0] + off + cap, pa[1]), seg(pb[0] + off - cap, pb[1], pb[0] + off + cap, pb[1])] };
        },
      });
      continue;
    }
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
    // Area ombreggiata: from the line to the start (before) or the end (after) of the axis.
    if (l.shade) {
      target.markArea ??= { silent: true, data: [] };
      target.markArea.data.push([
        { [key]: value, itemStyle: { color: withAlpha(l.shadeColor ?? l.color ?? '#252423', l.shadeTransparency ?? 80) } },
        { [key]: l.shade === 'before' ? 'min' : 'max' },
      ]);
    }
  }
}
