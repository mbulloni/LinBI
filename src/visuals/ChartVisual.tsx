import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { CrossFilter, Visual } from '../types';
import type { VisualData } from './useVisualData';
import { fieldLabel, fmtAuto, fmtFull, fmtPct, PALETTE } from '../format';
import { NULL_KEY, type QueryItem } from '../query';
import { useStore } from '../store';
import { rangeOf, scaleColor } from './condfmt';
import { font, pointColors, pt, queryRef, sp, units } from './pbistyle';

/** ECharts axis label/title/grid settings from the visual's categoryAxis/valueAxis objects. */
function axisLook(v: Visual, obj: 'categoryAxis' | 'valueAxis') {
  const col = sp(v, obj, 'labelColor'), size = pt(sp(v, obj, 'fontSize')), fam = font(sp(v, obj, 'fontFamily'));
  return {
    show: sp(v, obj, 'show') !== false,
    label: { ...(col ? { color: col } : {}), ...(size ? { fontSize: size } : {}), ...(fam ? { fontFamily: fam } : {}) },
    title: sp(v, obj, 'showAxisTitle') !== false,
    titleStyle: { ...(sp(v, obj, 'titleColor') ? { color: sp(v, obj, 'titleColor') } : {}), ...(pt(sp(v, obj, 'titleFontSize')) ? { fontSize: pt(sp(v, obj, 'titleFontSize')) } : {}) },
    grid: sp(v, obj, 'gridlineShow'),
    gridColor: sp(v, obj, 'gridlineColor') as string | undefined,
    units: sp(v, obj, 'labelDisplayUnits'),
    precision: sp(v, obj, 'labelPrecision'),
  };
}

/** Legend placement and text from the legend object (Top, TopCenter, Bottom, Left, Right, …). */
function legendLook(v: Visual, fallback: string) {
  const pos = String(sp(v, 'legend', 'position') ?? fallback).toLowerCase();
  const side = pos.startsWith('bottom') ? 'bottom' : pos.startsWith('left') ? 'left' : pos.startsWith('right') ? 'right' : 'top';
  const center = pos.endsWith('center');
  const col = sp(v, 'legend', 'labelColor'), size = pt(sp(v, 'legend', 'fontSize'));
  return {
    side,
    cfg: {
      ...(side === 'top' ? { top: 0, left: center ? 'center' : 0 } : side === 'bottom' ? { bottom: 0, left: center ? 'center' : 0 } : side === 'left' ? { left: 0, top: 'middle', orient: 'vertical' as const } : { right: 0, top: 'middle', orient: 'vertical' as const }),
      textStyle: { color: col ?? AXIS_TEXT, fontSize: size ?? 11 },
    },
  };
}

/** Data labels: color/size/units from the labels object. */
function labelLook(v: Visual) {
  return { color: sp(v, 'labels', 'color') as string | undefined, size: pt(sp(v, 'labels', 'fontSize')), units: sp(v, 'labels', 'labelDisplayUnits'), precision: sp(v, 'labels', 'labelPrecision') };
}

/** The default single-series color follows the theme's first color. */
const main = (c: string) => (c.toUpperCase() === '#118DFF' ? PALETTE[0] : c);

const FONT = "'Segoe UI', 'Selawik', 'Ubuntu Sans', sans-serif";
const AXIS_TEXT = '#605E5C';
const catLabel = (c: string | null) => (c === null ? '(Vuoto)' : c);

interface Built { option: echarts.EChartsCoreOption; categories: (string | null)[]; }

function uniq(vals: (string | null)[]) {
  const seen = new Set<string | null>();
  const out: (string | null)[] = [];
  for (const v of vals) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

function cartesian(v: Visual, d: VisualData, selected: string | null | undefined, width: number): Built {
  const f = v.format;
  const horizontal = ['stackedBar', 'clusteredBar', 'stackedBar100'].includes(v.type);
  const stacked = ['stackedBar', 'stackedColumn', 'stackedBar100', 'stackedColumn100', 'stackedArea', 'lineStackedColumn'].includes(v.type);
  const pct = v.type.endsWith('100');
  const kind = v.type === 'line' || v.type.includes('Area') || v.type === 'area' ? 'line' : 'bar';
  const area = v.type === 'area' || v.type === 'stackedArea';

  const cat = d.items.find((i) => i.well === 'category');
  // "Expand all" levels: one combined category per row ("2014 Trim 1").
  const catItems = d.items.filter((i) => i.well === 'category');
  const ck = (r: Record<string, any>): string | null => (catItems.length > 1 ? catItems.map((c) => r[c.alias] ?? '(Vuoto)').join(' ') : r[cat!.alias]);
  const leg = d.items.find((i) => i.well === 'legend');
  const vals = d.items.filter((i) => i.well === 'values');
  const categories = cat ? uniq(d.rows.map((r) => ck(r))) : [null];
  const catIndex = new Map(categories.map((c, i) => [c, i]));

  type S = { name: string; data: (number | null)[] };
  let series: S[];
  if (leg && vals[0]) {
    const legends = uniq(d.rows.map((r) => r[leg.alias]));
    series = legends.map((l) => ({ name: catLabel(l), data: categories.map(() => null as number | null) }));
    const li = new Map(legends.map((l, i) => [l, i]));
    for (const r of d.rows) series[li.get(r[leg.alias])!].data[cat ? catIndex.get(ck(r))! : 0] = r[vals[0].alias];
  } else {
    series = vals.map((m) => ({ name: fieldLabel(m.field), data: categories.map(() => null as number | null) }));
    for (const r of d.rows) vals.forEach((m, k) => (series[k].data[cat ? catIndex.get(ck(r))! : 0] = r[m.alias]));
  }
  // Combo charts: line measures on a secondary axis, one value per category.
  const lineItems = d.items.filter((i) => i.well === 'lineValues');
  const lines: S[] = lineItems.map((m) => ({ name: fieldLabel(m.field), data: categories.map(() => null as number | null) }));
  for (const r of (leg && d.rowTotals) || d.rows) {
    const i = cat ? catIndex.get(ck(r)) : 0;
    if (i !== undefined) lineItems.forEach((m, k) => (lines[k].data[i] = r[m.alias]));
  }
  if (pct) {
    const tot = categories.map((_, i) => series.reduce((a, s) => a + Math.abs(s.data[i] ?? 0), 0));
    series.forEach((s) => (s.data = s.data.map((x, i) => (x === null || !tot[i] ? x : (x / tot[i]) * 100))));
  }

  const axisLine = { show: false };
  const ca = axisLook(v, 'categoryAxis'), va = axisLook(v, 'valueAxis'), lb = labelLook(v);
  const pc = pointColors(v);
  const fmtVal = (x: number, digits?: number) => units(x, va.units, va.precision) ?? fmtAuto(x, digits);
  const fmtLbl = (x: number) => units(x, lb.units, lb.precision) ?? fmtAuto(x);
  // Like Power BI: rotate category labels when they no longer fit side by side.
  const slot = (width - 60) / Math.max(1, categories.length);
  const rotated = !horizontal && Math.max(1, ...categories.map((c) => catLabel(c).length)) * 6.2 > slot;
  const catAxis = {
    type: 'category' as const,
    data: categories.map(catLabel),
    show: (horizontal ? f.yAxisShow : f.xAxisShow) && ca.show,
    inverse: horizontal,
    axisTick: { show: false },
    axisLine: { show: !horizontal, lineStyle: { color: '#C8C6C4' } },
    axisLabel: {
      color: AXIS_TEXT, fontSize: 11, hideOverlap: true, overflow: 'truncate' as const,
      ...(horizontal ? { width: 90 } : rotated ? { rotate: 45, interval: 0, width: 90 } : { width: Math.max(30, slot) }),
      ...ca.label,
    },
    name: cat && ca.title ? cat.field.column : '',
    nameLocation: 'middle' as const,
    nameGap: horizontal ? 0 : rotated ? 62 : 28,
    nameTextStyle: { color: '#252423', fontSize: 11, ...ca.titleStyle },
    boundaryGap: kind === 'bar',
  };
  if (horizontal) Object.assign(catAxis, { name: '' });
  const asPct = vals.length > 0 && d.percent.has(vals[0].alias) && !pct;
  const valAxis = {
    type: 'value' as const,
    show: (horizontal ? f.xAxisShow : f.yAxisShow) && va.show,
    max: pct ? 100 : undefined,
    axisLine,
    splitLine: { show: va.grid ?? f.gridlines, lineStyle: { color: va.gridColor ?? '#E1DFDD', type: 'dotted' as const } },
    axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: (x: number) => (pct ? x + '%' : asPct ? fmtPct(x) : fmtVal(x, 0)), ...va.label },
    name: !va.title || horizontal || leg || vals.length > 1 || d.items.some((i) => i.well === 'lineValues') ? '' : vals[0] ? fieldLabel(vals[0].field) : '',
    nameLocation: 'middle' as const,
    nameGap: 44,
    nameTextStyle: { color: '#252423', fontSize: 11, ...va.titleStyle },
  };

  const lineAxis = { ...valAxis, name: '', position: 'right' as const, splitLine: { show: false },
    axisLabel: { ...valAxis.axisLabel, formatter: (x: number) => fmtAuto(x, 0) } };
  const showLegend = f.legendShow && (series.length + lines.length > 1 || !!leg);
  const lg = legendLook(v, f.legendPos);
  const legendCfg = showLegend ? {
    show: true, type: 'scroll' as const, icon: 'circle', itemWidth: 8, itemHeight: 8,
    ...lg.cfg,
    ...(leg ? { formatter: undefined, data: [...series, ...lines].map((s) => s.name) } : {}),
  } : { show: false };

  const singleColor = series.length === 1 && !leg && !lines.length;
  // "Colori dati" › fx gradient: each bar colored by its value.
  const grad = singleColor && f.colorScale ? f.colorScale : undefined;
  const gradRange = grad ? rangeOf(series[0].data) : null;
  const option: echarts.EChartsCoreOption = {
    textStyle: { fontFamily: FONT },
    animationDuration: 300,
    legend: legendCfg,
    grid: {
      left: horizontal ? 8 : 28, right: 16, bottom: horizontal ? 8 : 30,
      top: showLegend && lg.side === 'top' ? 28 : 12, containLabel: true,
      ...(showLegend && lg.side === 'bottom' ? { bottom: horizontal ? 30 : 54 } : {}),
    },
    tooltip: {
      trigger: 'axis', axisPointer: { type: kind === 'bar' ? 'shadow' : 'line' }, confine: true,
      valueFormatter: (x: number) => (pct ? fmtFull(x) + '%' : asPct ? fmtPct(x) : fmtFull(x)),
    },
    color: singleColor ? [main(f.color)] : series.map((s, k) => pc.byValue.get(leg ? s.name : '') ?? pc.byRef.get(vals[k] ? queryRef(vals[k].field) : '') ?? PALETTE[k % PALETTE.length]).concat(PALETTE),
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : lines.length ? [valAxis, lineAxis] : valAxis,
    series: [...series.map((s, k) => ({
      name: s.name,
      type: kind,
      stack: stacked ? 'total' : undefined,
      barMaxWidth: 60,
      barGap: '8%',
      symbol: kind === 'line' ? 'none' : undefined,
      smooth: false,
      lineStyle: kind === 'line' ? { width: 2.5 } : undefined,
      areaStyle: area ? { opacity: stacked ? 0.85 : 0.4 } : undefined,
      emphasis: { focus: 'none' },
      label: { show: f.dataLabels, position: stacked ? 'inside' : horizontal ? 'right' : 'top', fontSize: lb.size ?? 10, color: lb.color ?? (stacked ? '#fff' : '#252423'), formatter: (p: any) => (p.value === null ? '' : pct ? fmtAuto(p.value, 1) + '%' : asPct ? fmtPct(p.value) : fmtLbl(p.value)) },
      data: s.data.map((x, i) => ({
        value: x,
        itemStyle: {
          ...(singleColor && pc.byValue.has(categories[i] ?? '') ? { color: pc.byValue.get(categories[i] ?? '') } : {}),
          ...(grad && gradRange && x !== null ? { color: scaleColor(grad, gradRange, x) } : {}),
          ...(selected !== undefined && categories[i] !== selected ? { opacity: 0.35 } : {}),
        },
      })),
      z: k,
    })), ...lines.map((s, k) => ({
      name: s.name, type: 'line', yAxisIndex: 1, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5 },
      color: PALETTE[(series.length + k) % PALETTE.length], z: 50 + k,
      label: { show: f.dataLabels, position: 'top', fontSize: 10, color: '#252423', formatter: (p: any) => (p.value === null ? '' : fmtAuto(p.value)) },
      data: s.data,
    }))],
  };
  return { option, categories };
}

function pieLike(v: Visual, d: VisualData, selected: string | null | undefined): Built {
  const f = v.format;
  const cat = d.items.find((i) => i.well === 'category');
  const val = d.items.find((i) => i.well === 'values');
  const categories = cat ? d.rows.map((r) => r[cat.alias]) : [null];
  const pc = pointColors(v);
  const lb = labelLook(v);
  const data = d.rows.map((r, i) => {
    const own = pc.byValue.get(categories[i] ?? '');
    return {
      name: catLabel(cat ? r[cat.alias] : null),
      value: val ? r[val.alias] : 0,
      idx: i,
      itemStyle: { ...(own ? { color: own } : {}), ...(selected !== undefined && categories[i] !== selected ? { opacity: 0.35 } : {}) },
    };
  });
  const lg = legendLook(v, f.legendPos);
  const legend = f.legendShow ? { show: true, type: 'scroll' as const, icon: 'circle', itemWidth: 8, itemHeight: 8, ...lg.cfg } : { show: false };
  const base = { color: PALETTE, textStyle: { fontFamily: FONT }, legend, animationDuration: 300, tooltip: { trigger: 'item', confine: true, valueFormatter: fmtFull } };

  if (v.type === 'treemap') {
    return {
      categories,
      option: {
        ...base, legend: { show: false },
        series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%', top: 0, left: 0,
          itemStyle: { borderColor: '#fff', borderWidth: 1, gapWidth: 1 },
          label: { show: f.dataLabels, fontSize: 11, formatter: '{b}' },
          data: data.map((x, i) => ({ ...x, itemStyle: { color: PALETTE[i % PALETTE.length], ...x.itemStyle } })) }],
      },
    };
  }
  if (v.type === 'funnel') {
    return {
      categories,
      option: {
        ...base, legend: { show: false },
        series: [{ type: 'funnel', sort: 'descending', left: '18%', width: '64%', top: 8, bottom: 8, gap: 2,
          label: { show: true, position: 'left', color: AXIS_TEXT, fontSize: 11, formatter: '{b}' },
          labelLine: { show: false },
          itemStyle: { color: main(f.color), borderWidth: 0 },
          data: f.dataLabels ? data.map((x) => ({ ...x, label: { show: true } })) : data }],
      },
    };
  }
  return {
    categories,
    option: {
      ...base,
      series: [{
        type: 'pie', radius: v.type === 'donut' ? ['45%', '72%'] : [0, '72%'],
        center: [f.legendShow && lg.side === 'right' ? '42%' : f.legendShow && lg.side === 'left' ? '58%' : '50%', f.legendShow && lg.side === 'top' ? '55%' : f.legendShow && lg.side === 'bottom' ? '45%' : '50%'],
        avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 1 },
        label: { show: f.dataLabels, color: lb.color ?? AXIS_TEXT, fontSize: lb.size ?? 11, formatter: (p: any) => `${units(p.value, lb.units, lb.precision) ?? fmtAuto(p.value)} (${p.percent.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%)` },
        data,
      }],
    },
  };
}

function scatter(v: Visual, d: VisualData, selected: string | null | undefined): Built {
  const f = v.format;
  const det = d.items.find((i) => i.well === 'details');
  const x = d.items.find((i) => i.well === 'x');
  const y = d.items.find((i) => i.well === 'y');
  const leg = d.items.find((i) => i.well === 'legend');
  const categories = det ? d.rows.map((r) => r[det.alias]) : [null];
  const groups = leg ? uniq(d.rows.map((r) => r[leg.alias])) : [null];
  const axis = (it: QueryItem | undefined, show: boolean) => ({
    type: 'value', show, scale: true, name: it ? fieldLabel(it.field) : '', nameLocation: 'middle', nameGap: 30,
    nameTextStyle: { color: '#252423', fontSize: 11 },
    splitLine: { show: f.gridlines, lineStyle: { color: '#E1DFDD', type: 'dotted' } },
    axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: (n: number) => fmtAuto(n, 0) },
  });
  return {
    categories,
    option: {
      color: PALETTE, textStyle: { fontFamily: FONT }, animationDuration: 300,
      legend: { show: f.legendShow && !!leg, top: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
      grid: { left: 30, right: 16, top: leg ? 28 : 12, bottom: 30, containLabel: true },
      tooltip: { trigger: 'item', confine: true, formatter: (p: any) => `${p.data.name}<br/>${x ? fieldLabel(x.field) : ''}: <b>${fmtFull(p.data.value[0])}</b><br/>${y ? fieldLabel(y.field) : ''}: <b>${fmtFull(p.data.value[1])}</b>` },
      xAxis: axis(x, f.xAxisShow),
      yAxis: axis(y, f.yAxisShow),
      series: groups.map((g) => ({
        type: 'scatter', name: catLabel(g), symbolSize: 10,
        itemStyle: groups.length === 1 ? { color: main(f.color) } : undefined,
        data: d.rows.map((r, i) => ({ r, i })).filter(({ r }) => !leg || r[leg.alias] === g).map(({ r, i }) => ({
          name: catLabel(det ? r[det.alias] : null), value: [x ? r[x.alias] : 0, y ? r[y.alias] : 0], idx: i,
          itemStyle: selected !== undefined && categories[i] !== selected ? { opacity: 0.25 } : undefined,
        })),
      })),
    },
  };
}

function gauge(v: Visual, d: VisualData): Built {
  const val = d.items.find((i) => i.well === 'values');
  const tgt = d.items.find((i) => i.well === 'target');
  const value = val ? d.rows[0]?.[val.alias] ?? 0 : 0;
  const target = tgt ? d.rows[0]?.[tgt.alias] : undefined;
  const max = target ? Math.max(target, value) * 1.25 : value * 2 || 1;
  return {
    categories: [],
    option: {
      textStyle: { fontFamily: FONT },
      series: [{
        type: 'gauge', startAngle: 180, endAngle: 0, min: 0, max, center: ['50%', '72%'], radius: '95%',
        progress: { show: true, width: 36, itemStyle: { color: main(v.format.color) } },
        axisLine: { lineStyle: { width: 36, color: [[1, '#E6E6E6']] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: true, distance: -20, color: AXIS_TEXT, fontSize: 10, formatter: (n: number) => (n === 0 || Math.abs(n - max) < 1e-9 ? fmtAuto(n) : '') },
        anchor: { show: false },
        detail: { valueAnimation: true, offsetCenter: [0, '-12%'], fontSize: 22, color: '#252423', formatter: (n: number) => fmtAuto(n) },
        markLine: undefined,
        data: [{ value }],
      }, ...(target !== undefined ? [{
        type: 'gauge', startAngle: 180, endAngle: 0, min: 0, max, center: ['50%', '72%'], radius: '95%',
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false }, detail: { show: false },
        pointer: { show: true, length: 40, width: 3, offsetCenter: [0, '-78%'], itemStyle: { color: '#252423' } },
        data: [{ value: target }],
      }] : [])],
    },
  };
}

const UP = '#1AAB40', DOWN = '#D64554', TOTAL = '#118DFF';

/** Waterfall: each category moves the running total up (green) or down (red); last bar = total. */
function waterfall(v: Visual, d: VisualData, selected: string | null | undefined): Built {
  const f = v.format;
  const cat = d.items.find((i) => i.well === 'category');
  const val = d.items.find((i) => i.well === 'values');
  const categories = cat ? d.rows.map((r) => r[cat.alias] as string | null) : [];
  type Step = { value: [number, number, number]; idx: number; v: number };
  const steps: Record<'up' | 'down' | 'total', Step[]> = { up: [], down: [], total: [] };
  let run = 0;
  d.rows.forEach((r, i) => {
    const x = val ? Number(r[val.alias] ?? 0) : 0;
    steps[x >= 0 ? 'up' : 'down'].push({ value: [i, run, run + x], idx: i, v: x });
    run += x;
  });
  steps.total.push({ value: [categories.length, 0, run], idx: categories.length, v: run });
  const bar = (color: string) => (params: any, api: any) => {
    const i = api.value(0);
    const a = api.coord([i, api.value(1)]), b = api.coord([i, api.value(2)]);
    const w = Math.min(60, api.size([1, 0])[0] * 0.6);
    const faded = selected !== undefined && i < categories.length && categories[i] !== selected;
    return { type: 'rect', shape: { x: a[0] - w / 2, y: Math.min(a[1], b[1]), width: w, height: Math.max(1, Math.abs(a[1] - b[1])) }, style: { fill: color, opacity: faded ? 0.35 : 1 } };
  };
  const series = ([['up', 'Aumento', UP], ['down', 'Riduzione', DOWN], ['total', 'Totale', TOTAL]] as const).map(([k, name, color]) => ({
    name, type: 'custom', color, renderItem: bar(color), encode: { x: 0, y: [1, 2] }, data: steps[k],
    label: { show: f.dataLabels, position: 'top', fontSize: 10, color: '#252423', formatter: (p: any) => fmtAuto(p.data.v) },
  }));
  return {
    categories,
    option: {
      textStyle: { fontFamily: FONT }, animationDuration: 300,
      legend: { show: f.legendShow, top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: AXIS_TEXT, fontSize: 11 } },
      grid: { left: 28, right: 16, bottom: 30, top: f.legendShow ? 28 : 12, containLabel: true },
      tooltip: { trigger: 'item', confine: true, formatter: (p: any) => `${p.data.idx < categories.length ? catLabel(categories[p.data.idx]) : 'Totale'}<br/>${val ? fieldLabel(val.field) : ''}: <b>${fmtFull(p.data.v)}</b>` },
      xAxis: { type: 'category', show: f.xAxisShow, data: [...categories.map(catLabel), 'Totale'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#C8C6C4' } }, axisLabel: { color: AXIS_TEXT, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', show: f.yAxisShow, scale: false, splitLine: { show: f.gridlines, lineStyle: { color: '#E1DFDD', type: 'dotted' } }, axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: (x: number) => fmtAuto(x, 0) } },
      series,
    },
  };
}

/** Ribbon chart: stacked columns re-ranked per category (largest on top), joined by ribbons. */
function ribbon(v: Visual, d: VisualData, selected: string | null | undefined, width: number): Built {
  const leg = d.items.find((i) => i.well === 'legend');
  if (!leg) return cartesian({ ...v, type: 'stackedColumn' }, d, selected, width);
  const f = v.format;
  const cat = d.items.find((i) => i.well === 'category');
  const val = d.items.find((i) => i.well === 'values');
  const categories = cat ? uniq(d.rows.map((r) => r[cat.alias])) : [null];
  const legends = uniq(d.rows.map((r) => r[leg.alias]));
  const ci = new Map(categories.map((c, i) => [c, i]));
  const li = new Map(legends.map((l, i) => [l, i]));
  const value: number[][] = legends.map(() => categories.map(() => 0));
  for (const r of d.rows) value[li.get(r[leg.alias])!][cat ? ci.get(r[cat.alias])! : 0] = Math.max(0, Number(r[val?.alias ?? ''] ?? 0));
  // [y0, y1] of every (series, category): smallest at the bottom.
  const span: [number, number][][] = legends.map(() => []);
  categories.forEach((_, c) => {
    let y = 0;
    legends.map((_, s) => s).sort((a, b) => value[a][c] - value[b][c]).forEach((s) => { span[s][c] = [y, y + value[s][c]]; y += value[s][c]; });
  });
  const max = Math.max(1, ...categories.map((_, c) => legends.reduce((a, _, s) => a + value[s][c], 0)));
  return {
    categories,
    option: {
      color: PALETTE, textStyle: { fontFamily: FONT }, animationDuration: 300,
      legend: { show: f.legendShow, type: 'scroll', top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: AXIS_TEXT, fontSize: 11 } },
      grid: { left: 28, right: 16, bottom: 30, top: f.legendShow ? 28 : 12, containLabel: true },
      tooltip: { trigger: 'item', confine: true, formatter: (p: any) => `${catLabel(categories[p.data.idx])}<br/>${p.seriesName}: <b>${fmtFull(p.data.v)}</b>` },
      xAxis: { type: 'category', show: f.xAxisShow, data: categories.map(catLabel), axisTick: { show: false }, axisLine: { lineStyle: { color: '#C8C6C4' } }, axisLabel: { color: AXIS_TEXT, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', show: f.yAxisShow, max, splitLine: { show: f.gridlines, lineStyle: { color: '#E1DFDD', type: 'dotted' } }, axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: (x: number) => fmtAuto(x, 0) } },
      series: legends.map((l, s) => ({
        name: catLabel(l), type: 'custom', encode: { x: 0, y: [1, 2] },
        data: categories.map((_, c) => ({ value: [c, ...span[s][c]], idx: c, v: value[s][c] })),
        renderItem: (params: any, api: any) => {
          const c = api.value(0);
          const band = api.size([1, 0])[0];
          const w = Math.min(60, band * 0.55);
          const p0 = api.coord([c, api.value(1)]), p1 = api.coord([c, api.value(2)]);
          const color = api.visual('color');
          const faded = selected !== undefined && categories[c] !== selected;
          const children: any[] = [{ type: 'rect', shape: { x: p0[0] - w / 2, y: p1[1], width: w, height: p0[1] - p1[1] }, style: { fill: color, opacity: faded ? 0.35 : 1 } }];
          const next = span[s][c + 1];
          if (next) {
            const q0 = api.coord([c + 1, next[0]]), q1 = api.coord([c + 1, next[1]]);
            children.push({ type: 'polygon', silent: true, shape: { points: [[p0[0] + w / 2, p1[1]], [q0[0] - w / 2, q1[1]], [q0[0] - w / 2, q0[1]], [p0[0] + w / 2, p0[1]]] }, style: { fill: color, opacity: 0.35 } });
          }
          return { type: 'group', children };
        },
        label: { show: f.dataLabels, position: 'inside', fontSize: 10, color: '#fff', formatter: (p: any) => (p.data.v ? fmtAuto(p.data.v) : '') },
      })),
    },
  };
}

export function buildOption(v: Visual, d: VisualData, cross: CrossFilter | null, width = 400): Built {
  const selected = cross && cross.visualId === v.id ? (cross.value === NULL_KEY ? null : cross.value) : undefined;
  if (['pie', 'donut', 'treemap', 'funnel'].includes(v.type)) return pieLike(v, d, selected);
  if (v.type === 'scatter') return scatter(v, d, selected);
  if (v.type === 'gauge') return gauge(v, d);
  if (v.type === 'waterfall') return waterfall(v, d, selected);
  if (v.type === 'ribbon') return ribbon(v, d, selected, width);
  return cartesian(v, d, selected, width);
}

export function ChartVisual({ v, data, cross, onSelect }: {
  v: Visual; data: VisualData; cross: CrossFilter | null; onSelect: (category: string | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const cats = useRef<(string | null)[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p: any) => {
      const idx = p.data?.idx ?? p.dataIndex;
      if (idx !== undefined && idx < cats.current.length) onSelectRef.current(cats.current[idx]);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);

  const theme = useStore((s) => s.report.theme);
  useEffect(() => {
    if (!chart.current || data.error) return;
    const { option, categories } = buildOption(v, data, cross, el.current?.clientWidth ?? 400);
    cats.current = categories;
    chart.current.setOption(option, true);
  }, [v, data, cross, theme]);

  return <div ref={el} style={{ position: 'absolute', inset: '0 4px 4px 4px' }} />;
}
