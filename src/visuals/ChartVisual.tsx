import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { CrossFilter, Visual } from '../types';
import type { VisualData } from './useVisualData';
import { fieldLabel, fmtAuto, fmtFull, fmtPct, PALETTE } from '../format';
import { NULL_KEY, type QueryItem } from '../query';

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
  const stacked = ['stackedBar', 'stackedColumn', 'stackedBar100', 'stackedColumn100', 'stackedArea'].includes(v.type);
  const pct = v.type.endsWith('100');
  const kind = v.type === 'line' || v.type.includes('Area') || v.type === 'area' ? 'line' : 'bar';
  const area = v.type === 'area' || v.type === 'stackedArea';

  const cat = d.items.find((i) => i.well === 'category');
  const leg = d.items.find((i) => i.well === 'legend');
  const vals = d.items.filter((i) => i.well === 'values');
  const categories = cat ? uniq(d.rows.map((r) => r[cat.alias])) : [null];
  const catIndex = new Map(categories.map((c, i) => [c, i]));

  type S = { name: string; data: (number | null)[] };
  let series: S[];
  if (leg && vals[0]) {
    const legends = uniq(d.rows.map((r) => r[leg.alias]));
    series = legends.map((l) => ({ name: catLabel(l), data: categories.map(() => null as number | null) }));
    const li = new Map(legends.map((l, i) => [l, i]));
    for (const r of d.rows) series[li.get(r[leg.alias])!].data[cat ? catIndex.get(r[cat.alias])! : 0] = r[vals[0].alias];
  } else {
    series = vals.map((m) => ({ name: fieldLabel(m.field), data: categories.map(() => null as number | null) }));
    for (const r of d.rows) vals.forEach((m, k) => (series[k].data[cat ? catIndex.get(r[cat.alias])! : 0] = r[m.alias]));
  }
  if (pct) {
    const tot = categories.map((_, i) => series.reduce((a, s) => a + Math.abs(s.data[i] ?? 0), 0));
    series.forEach((s) => (s.data = s.data.map((x, i) => (x === null || !tot[i] ? x : (x / tot[i]) * 100))));
  }

  const axisLine = { show: false };
  // Like Power BI: rotate category labels when they no longer fit side by side.
  const slot = (width - 60) / Math.max(1, categories.length);
  const rotated = !horizontal && Math.max(1, ...categories.map((c) => catLabel(c).length)) * 6.2 > slot;
  const catAxis = {
    type: 'category' as const,
    data: categories.map(catLabel),
    show: horizontal ? f.yAxisShow : f.xAxisShow,
    inverse: horizontal,
    axisTick: { show: false },
    axisLine: { show: !horizontal, lineStyle: { color: '#C8C6C4' } },
    axisLabel: {
      color: AXIS_TEXT, fontSize: 11, hideOverlap: true, overflow: 'truncate' as const,
      ...(horizontal ? { width: 90 } : rotated ? { rotate: 45, interval: 0, width: 90 } : { width: Math.max(30, slot) }),
    },
    name: cat ? cat.field.column : '',
    nameLocation: 'middle' as const,
    nameGap: horizontal ? 0 : rotated ? 62 : 28,
    nameTextStyle: { color: '#252423', fontSize: 11 },
    boundaryGap: kind === 'bar',
  };
  if (horizontal) Object.assign(catAxis, { name: '' });
  const asPct = vals.length > 0 && d.percent.has(vals[0].alias) && !pct;
  const valAxis = {
    type: 'value' as const,
    show: horizontal ? f.xAxisShow : f.yAxisShow,
    max: pct ? 100 : undefined,
    axisLine,
    splitLine: { show: f.gridlines, lineStyle: { color: '#E1DFDD', type: 'dotted' as const } },
    axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: (x: number) => (pct ? x + '%' : asPct ? fmtPct(x) : fmtAuto(x, 0)) },
    name: horizontal || leg || vals.length > 1 ? '' : vals[0] ? fieldLabel(vals[0].field) : '',
    nameLocation: 'middle' as const,
    nameGap: 44,
    nameTextStyle: { color: '#252423', fontSize: 11 },
  };

  const showLegend = f.legendShow && (series.length > 1 || !!leg);
  const legendCfg = showLegend ? {
    show: true, type: 'scroll' as const, icon: 'circle', itemWidth: 8, itemHeight: 8,
    textStyle: { color: AXIS_TEXT, fontSize: 11 },
    ...(f.legendPos === 'top' ? { top: 0, left: 0 } : f.legendPos === 'bottom' ? { bottom: 0, left: 0 } : f.legendPos === 'left' ? { left: 0, top: 'middle', orient: 'vertical' as const } : { right: 0, top: 'middle', orient: 'vertical' as const }),
    ...(leg ? { formatter: undefined, data: series.map((s) => s.name) } : {}),
  } : { show: false };

  const singleColor = series.length === 1 && !leg;
  const option: echarts.EChartsCoreOption = {
    color: singleColor ? [f.color] : PALETTE,
    textStyle: { fontFamily: FONT },
    animationDuration: 300,
    legend: legendCfg,
    grid: {
      left: horizontal ? 8 : 28, right: 16, bottom: horizontal ? 8 : 30,
      top: showLegend && f.legendPos === 'top' ? 28 : 12, containLabel: true,
    },
    tooltip: {
      trigger: 'axis', axisPointer: { type: kind === 'bar' ? 'shadow' : 'line' }, confine: true,
      valueFormatter: (x: number) => (pct ? fmtFull(x) + '%' : asPct ? fmtPct(x) : fmtFull(x)),
    },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: series.map((s, k) => ({
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
      label: { show: f.dataLabels, position: stacked ? 'inside' : horizontal ? 'right' : 'top', fontSize: 10, color: stacked ? '#fff' : '#252423', formatter: (p: any) => (p.value === null ? '' : pct ? fmtAuto(p.value, 1) + '%' : asPct ? fmtPct(p.value) : fmtAuto(p.value)) },
      data: s.data.map((x, i) => ({
        value: x,
        itemStyle: selected !== undefined && categories[i] !== selected ? { opacity: 0.35 } : undefined,
      })),
      z: k,
    })),
  };
  return { option, categories };
}

function pieLike(v: Visual, d: VisualData, selected: string | null | undefined): Built {
  const f = v.format;
  const cat = d.items.find((i) => i.well === 'category');
  const val = d.items.find((i) => i.well === 'values');
  const categories = cat ? d.rows.map((r) => r[cat.alias]) : [null];
  const data = d.rows.map((r, i) => ({
    name: catLabel(cat ? r[cat.alias] : null),
    value: val ? r[val.alias] : 0,
    idx: i,
    itemStyle: selected !== undefined && categories[i] !== selected ? { opacity: 0.35 } : undefined,
  }));
  const legend = f.legendShow ? {
    show: true, type: 'scroll' as const, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: AXIS_TEXT, fontSize: 11 },
    ...(f.legendPos === 'top' ? { top: 0 } : f.legendPos === 'bottom' ? { bottom: 0 } : f.legendPos === 'left' ? { left: 0, orient: 'vertical' as const, top: 'middle' } : { right: 0, orient: 'vertical' as const, top: 'middle' }),
  } : { show: false };
  const base = { color: PALETTE, textStyle: { fontFamily: FONT }, legend, animationDuration: 300, tooltip: { trigger: 'item', confine: true, valueFormatter: fmtFull } };

  if (v.type === 'treemap') {
    return {
      categories,
      option: {
        ...base, legend: { show: false },
        series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%', top: 0, left: 0,
          itemStyle: { borderColor: '#fff', borderWidth: 1, gapWidth: 1 },
          label: { show: f.dataLabels, fontSize: 11, formatter: '{b}' },
          data: data.map((x, i) => ({ ...x, itemStyle: { color: PALETTE[i % PALETTE.length], ...(x.itemStyle ?? {}) } })) }],
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
          itemStyle: { color: f.color, borderWidth: 0 },
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
        center: ['50%', f.legendShow && f.legendPos === 'top' ? '55%' : '50%'],
        avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 1 },
        label: { show: f.dataLabels, color: AXIS_TEXT, fontSize: 11, formatter: (p: any) => `${fmtAuto(p.value)} (${p.percent.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%)` },
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
        itemStyle: groups.length === 1 ? { color: f.color } : undefined,
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
        progress: { show: true, width: 36, itemStyle: { color: v.format.color } },
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

export function buildOption(v: Visual, d: VisualData, cross: CrossFilter | null, width = 400): Built {
  const selected = cross && cross.visualId === v.id ? (cross.value === NULL_KEY ? null : cross.value) : undefined;
  if (['pie', 'donut', 'treemap', 'funnel'].includes(v.type)) return pieLike(v, d, selected);
  if (v.type === 'scatter') return scatter(v, d, selected);
  if (v.type === 'gauge') return gauge(v, d);
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
      if (idx !== undefined && cats.current.length) onSelectRef.current(cats.current[idx]);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);

  useEffect(() => {
    if (!chart.current || data.error) return;
    const { option, categories } = buildOption(v, data, cross, el.current?.clientWidth ?? 400);
    cats.current = categories;
    chart.current.setOption(option, true);
  }, [v, data, cross]);

  return <div ref={el} style={{ position: 'absolute', inset: '0 4px 4px 4px' }} />;
}
