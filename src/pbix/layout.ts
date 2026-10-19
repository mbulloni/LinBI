/**
 * Power BI report layout (Report/Layout JSON, legacy format) ↔ LinBI report.
 * Reference: sections[] → visualContainers[] whose `config` is a JSON string holding
 * singleVisual { visualType, projections, prototypeQuery, objects, vcObjects }.
 */
import type { Agg, Bookmark, FieldRef, Filter, Page, TableMeta, Theme, Visual, VisualGroup, VisualType } from '../types';
import { parseTheme, themeJson } from '../themes';
import { defaultFormat, PAGE_H, PAGE_W } from '../store';
import { isChart as isChartType, visualDef } from '../visuals/catalog';
import { NULL_KEY } from '../query';
import { uid } from '../format';
import { decode, pt } from '../visuals/pbistyle';

/* ------------------------------- mappings ------------------------------- */

const TYPE_IN: Record<string, VisualType> = {
  clusteredColumnChart: 'clusteredColumn', columnChart: 'stackedColumn', hundredPercentStackedColumnChart: 'stackedColumn100',
  clusteredBarChart: 'clusteredBar', barChart: 'stackedBar', hundredPercentStackedBarChart: 'stackedBar100',
  lineChart: 'line', areaChart: 'area', stackedAreaChart: 'stackedArea',
  lineClusteredColumnComboChart: 'lineClusteredColumn', lineStackedColumnComboChart: 'lineStackedColumn',
  ribbonChart: 'ribbon', waterfallChart: 'waterfall',
  pieChart: 'pie', donutChart: 'donut', treemap: 'treemap', funnel: 'funnel', scatterChart: 'scatter', gauge: 'gauge',
  card: 'card', cardVisual: 'card', multiRowCard: 'multiRowCard', kpi: 'kpi',
  tableEx: 'table', table: 'table', pivotTable: 'matrix', slicer: 'slicer', advancedSlicerVisual: 'slicer',
  textbox: 'textbox', image: 'image', actionButton: 'button', basicShape: 'shape', shape: 'shape',
  map: 'map', azureMap: 'map', filledMap: 'filledMap', shapeMap: 'filledMap',
  decompositionTreeVisual: 'decompositionTree', keyDriversVisual: 'keyInfluencers', smartNarrativeVisual: 'smartNarrative',
  pythonVisual: 'pythonVisual', scriptVisual: 'rVisual', qnaVisual: 'qna',
};
/** Decorative/navigation objects that carry no data: not imported. */
const SKIP = new Set(['bookmarkNavigator', 'pageNavigator', 'lineShape']);

const TYPE_OUT: Partial<Record<VisualType, string>> = {
  stackedBar: 'barChart', stackedColumn: 'columnChart', clusteredBar: 'clusteredBarChart', clusteredColumn: 'clusteredColumnChart',
  stackedBar100: 'hundredPercentStackedBarChart', stackedColumn100: 'hundredPercentStackedColumnChart',
  line: 'lineChart', area: 'areaChart', stackedArea: 'stackedAreaChart', pie: 'pieChart', donut: 'donutChart',
  treemap: 'treemap', funnel: 'funnel', scatter: 'scatterChart', gauge: 'gauge', card: 'card', table: 'tableEx',
  lineClusteredColumn: 'lineClusteredColumnComboChart', lineStackedColumn: 'lineStackedColumnComboChart', ribbon: 'ribbonChart',
  waterfall: 'waterfallChart', multiRowCard: 'multiRowCard', kpi: 'kpi',
  matrix: 'pivotTable', slicer: 'slicer', textbox: 'textbox', image: 'image', button: 'actionButton', shape: 'basicShape', map: 'map', filledMap: 'filledMap',
  decompositionTree: 'decompositionTreeVisual', keyInfluencers: 'keyDriversVisual', smartNarrative: 'smartNarrativeVisual',
  pythonVisual: 'pythonVisual', rVisual: 'scriptVisual', qna: 'qnaVisual',
};

/** Power BI projection role → LinBI well, per LinBI visual type. */
function roleMap(t: VisualType): Record<string, string> {
  switch (t) {
    case 'pie': case 'donut': case 'funnel': return { Category: 'category', Y: 'values', Values: 'values' };
    case 'treemap': return { Group: 'category', Category: 'category', Values: 'values', Y: 'values' };
    case 'scatter': return { Category: 'details', Details: 'details', X: 'x', Y: 'y', Series: 'legend' };
    case 'gauge': return { Y: 'values', TargetValue: 'target' };
    case 'card': return { Values: 'values', Indicator: 'values', Data: 'values' };
    case 'multiRowCard': return { Values: 'values' };
    case 'kpi': return { Indicator: 'values', TrendLine: 'trend', Goal: 'target' };
    case 'waterfall': return { Category: 'category', Y: 'values' };
    case 'pythonVisual': case 'rVisual': return { Values: 'values' };
    case 'decompositionTree': return { Analyze: 'values', ExplainBy: 'explain' };
    case 'keyInfluencers': return { Target: 'target', ExplainBy: 'explain' };
    case 'map': return { Category: 'category', Series: 'legend', Y: 'lat', X: 'lon', Size: 'values' };
    case 'filledMap': return { Category: 'category', Series: 'legend', Gradient: 'values', Y: 'values' };
    case 'lineClusteredColumn': case 'lineStackedColumn': return { Category: 'category', Y: 'values', Y2: 'lineValues', Series: 'legend' };
    case 'table': return { Values: 'columns' };
    case 'matrix': return { Rows: 'rows', Columns: 'columns', Values: 'values' };
    case 'slicer': return { Values: 'category' };
    default: return { Category: 'category', Y: 'values', Y2: 'values', Series: 'legend' };
  }
}

const AGG_IN: Record<number, Agg> = { 0: 'sum', 1: 'avg', 2: 'countd', 3: 'min', 4: 'max', 5: 'count', 6: 'median', 7: 'stdev', 8: 'var' };
const AGG_OUT: Partial<Record<Agg, [number, string]>> = { sum: [0, 'Sum'], avg: [1, 'Avg'], countd: [2, 'CountNonNull'], min: [3, 'Min'], max: [4, 'Max'], count: [5, 'Count'], median: [6, 'Median'], stdev: [7, 'StandardDeviation'], var: [8, 'Variance'] };

/* -------------------------------- helpers ------------------------------- */

const json = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : s ?? {}; } catch { return {}; } };
const lit = (o: any): string | undefined => o?.expr?.Literal?.Value;
const litBool = (o: any): boolean | undefined => { const v = lit(o); return v === undefined ? undefined : v === 'true'; };
const litText = (o: any): string | undefined => { const v = lit(o); return v === undefined ? undefined : v.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'"); };
const prop = (objs: any, name: string) => objs?.[name]?.[0]?.properties ?? {};

type FromMap = Record<string, string>;

/** Semantic-query expression → FieldRef (Column, Aggregation, Measure, HierarchyLevel). */
function exprToField(e: any, from: FromMap): FieldRef | null {
  const entity = (x: any) => from[x?.SourceRef?.Source] ?? x?.SourceRef?.Entity;
  if (e?.Column) return { table: entity(e.Column.Expression), column: e.Column.Property, agg: 'none' };
  if (e?.Measure) return { table: entity(e.Measure.Expression), column: e.Measure.Property, agg: 'measure' };
  if (e?.Aggregation) {
    const inner = exprToField(e.Aggregation.Expression, from);
    return inner ? { ...inner, agg: AGG_IN[e.Aggregation.Function] ?? 'sum' } : null;
  }
  if (e?.HierarchyLevel) {
    const h = e.HierarchyLevel.Expression?.Hierarchy;
    const pvs = h?.Expression?.PropertyVariationSource;
    // Auto date hierarchy (Date → Year/Quarter/Month/Day): fall back to the date column itself.
    if (pvs) return { table: entity(pvs.Expression), column: pvs.Property, agg: 'none' };
    return { table: entity(h?.Expression), column: e.HierarchyLevel.Level, agg: 'none' };
  }
  return null;
}

/** Literal from a filter ("'abc'", "12L", "1.5D", "datetime'…'", "null") → LinBI filter value. */
function literalValue(v: string, dateOnly: boolean): string {
  if (v === 'null') return NULL_KEY;
  let m = /^'(.*)'$/s.exec(v);
  if (m) return m[1].replace(/''/g, "'");
  m = /^datetime'(.*)'$/.exec(v);
  if (m) return dateOnly ? m[1].slice(0, 10) : m[1].replace('T', ' ').replace(/\.0+$/, '');
  m = /^(-?[\d.]+(?:E[+-]?\d+)?)[LDM]$/i.exec(v);
  if (m) return String(Number(m[1]));
  return v;
}

/** Categorical "In" filter (page/report/visual filters, slicer selections). */
function parseCondition(f: any, tables: TableMeta[]): Filter | null {
  const from: FromMap = Object.fromEntries((f?.From ?? []).map((x: any) => [x.Name, x.Entity]));
  const cond = f?.Where?.[0]?.Condition?.In;
  if (!cond || cond.Expressions?.length !== 1) return null;
  const field = exprToField(cond.Expressions[0], from);
  if (!field || field.agg !== 'none') return null;
  const meta = tables.find((t) => t.name === field.table)?.columns.find((c) => c.name === field.column);
  if (!meta) return null;
  const values = (cond.Values ?? []).map((row: any[]) => literalValue(row[0]?.Literal?.Value ?? 'null', meta.type === 'DATE'));
  return { id: uid(), table: field.table, column: field.column, values };
}

function parseFilters(raw: unknown, tables: TableMeta[]): Filter[] {
  const list = json(raw);
  if (!Array.isArray(list)) return [];
  return list.map((f) => parseCondition(f.filter, tables)).filter((x): x is Filter => !!x && x.values.length > 0);
}

/* -------------------------------- import -------------------------------- */

export interface LayoutImport { pages: Page[]; reportFilters: Filter[]; skipped: Record<string, number>; bookmarks: Bookmark[]; }

export function parseLayout(layoutJson: string, tables: TableMeta[], measureNames: Set<string>, resources: Record<string, string>): LayoutImport {
  const layout = JSON.parse(layoutJson);
  const skipped: Record<string, number> = {};
  const known = (f: FieldRef) => (f.agg === 'measure' ? measureNames.has(f.column) : tables.some((t) => t.name === f.table && t.columns.some((c) => c.name === f.column)));

  const sections = [...(layout.sections ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const pages: Page[] = sections.map((sec: any, si: number) => {
    // Pages keep their Power BI size (16:9, 4:3, tooltip, custom): no rescaling.
    const scale = 1;
    const secCfg = json(sec.config);
    const bgProps = prop(secCfg.objects, 'background');
    const bgName = bgProps?.image?.image?.url?.expr?.ResourcePackageItem?.ItemName;
    const bgFit = decode(bgProps?.image?.image?.scaling);
    const bgColor = decode(bgProps.color);
    const bgTransp = decode(bgProps.transparency);
    const outspace = prop(secCfg.objects, 'outspace');
    const wallColor = decode(outspace.color);
    // Older files keep geometry only in config.layouts[0].position.
    const geom = (c: any) => {
      const p = json(c.config).layouts?.[0]?.position ?? {};
      return { x: c.x ?? p.x ?? 0, y: c.y ?? p.y ?? 0, z: c.z ?? p.z ?? 0, width: c.width ?? p.width ?? 200, height: c.height ?? p.height ?? 150 };
    };
    const containers = [...(sec.visualContainers ?? [])];
    const zs = containers.map((c: any) => geom(c).z).sort((a: number, b: number) => a - b);
    const visuals: Visual[] = [];
    const groups: (VisualGroup & { parentName?: string })[] = [];
    const groupOf = new Map<Visual, string>();

    for (const raw of containers) {
      const vc = { ...raw, ...geom(raw) };
      const cfg = json(vc.config);
      const sv = cfg.singleVisual;
      if (!sv) {
        const g = cfg.singleVisualGroup;
        if (g) groups.push({ id: uid(), name: g.displayName || 'Gruppo', pbiName: cfg.name, ...(g.isHidden ? { hidden: true } : {}), parentName: cfg.parentGroupName });
        continue;
      }
      const pbiType: string = sv.visualType;
      if (SKIP.has(pbiType)) continue;
      let type: VisualType = TYPE_IN[pbiType] ?? 'unsupported';
      if (type === 'unsupported') skipped[pbiType] = (skipped[pbiType] ?? 0) + 1;

      const from: FromMap = Object.fromEntries((sv.prototypeQuery?.From ?? []).map((x: any) => [x.Name, x.Entity]));
      const byRef: Record<string, FieldRef> = {};
      for (const sel of sv.prototypeQuery?.Select ?? []) {
        const f = exprToField(sel, from);
        if (f) byRef[sel.Name] = f;
      }

      const def = visualDef(type);
      const roles = roleMap(type);
      const fields: Record<string, FieldRef[]> = {};
      for (const [role, projs] of Object.entries<any[]>(sv.projections ?? {})) {
        const well = roles[role];
        const w = def.wells.find((x) => x.key === well);
        if (!w) continue;
        let refs = projs;
        // Drill hierarchies list every level; keep the active one in single-field wells.
        if (w.max === 1 && refs.length > 1) refs = [refs.find((p) => p.active) ?? refs[0]];
        for (const p of refs) {
          const f = byRef[p.queryRef];
          if (!f || !known(f)) continue;
          const list = (fields[well] ??= []);
          if (w.max && list.length >= w.max) continue;
          if (!list.some((x) => x.table === f.table && x.column === f.column && x.agg === f.agg)) {
            list.push(type === 'table' && f.agg === 'none' ? f : f.agg === 'none' && w.measure ? { ...f, agg: 'count' } : f);
          }
        }
      }

      const format = defaultFormat(type);
      const title = prop(sv.vcObjects, 'title');
      const titleText = litText(title.text);
      const titleShow = litBool(title.show);
      if (titleText) format.titleText = titleText;
      if (titleShow !== undefined) format.titleShow = titleShow;
      const legend = litBool(prop(sv.objects, 'legend').show);
      if (legend !== undefined) format.legendShow = legend;
      const labels = litBool(prop(sv.objects, 'labels').show);
      if (labels !== undefined) format.dataLabels = labels;
      const color = litText(prop(sv.objects, 'dataPoint').fill?.solid?.color);
      if (color && /^#[0-9a-f]{6}$/i.test(color)) format.color = color.toUpperCase();
      const bg = prop(sv.vcObjects, 'background');
      const bgc = decode(bg.color), bgt = decode(bg.transparency);
      if (typeof bgc === 'string' && /^#[0-9a-f]{6}$/i.test(bgc)) format.background = bgc.toUpperCase();
      if (typeof bgt === 'number') format.bgTransparency = bgt;
      if (litBool(bg.show) === false || bgt === 100) format.background = 'transparent';
      const tp = prop(sv.vcObjects, 'title');
      const tc = decode(tp.fontColor), tb = decode(tp.background), ta = decode(tp.alignment), tf = decode(tp.fontFamily), ts = decode(tp.fontSize), tbold = decode(tp.bold);
      if (typeof tc === 'string') format.titleColor = tc;
      if (typeof tb === 'string') format.titleBg = tb;
      if (ta === 'left' || ta === 'center' || ta === 'right') format.titleAlign = ta;
      if (typeof tf === 'string') format.titleFont = tf;
      if (typeof ts === 'number') format.titleSize = pt(ts)!;
      if (typeof tbold === 'boolean') format.titleBold = tbold;
      const bd = prop(sv.vcObjects, 'border');
      if (decode(bd.show) === true) {
        format.border = true;
        const c = decode(bd.color);
        if (typeof c === 'string') format.borderColor = c;
        const r = decode(bd.radius);
        if (typeof r === 'number') format.borderRadius = r;
      }
      if (type === 'slicer' && litText(prop(sv.objects, 'data').mode) === 'Dropdown') format.slicerStyle = 'dropdown';

      // Explicit sort (OrderBy) → index into LinBI's item order (wells in catalog order).
      const ob = sv.prototypeQuery?.OrderBy?.[0];
      if (ob) {
        const f = exprToField(ob.Expression, from);
        const flat = def.wells.flatMap((w) => fields[w.key] ?? []);
        const idx = f ? flat.findIndex((x) => x.table === f.table && x.column === f.column && x.agg === f.agg) : -1;
        if (idx >= 0) { format.sortBy = idx; format.sortDir = ob.Direction === 1 ? 'asc' : 'desc'; }
      }

      const v: Visual = {
        id: uid(), type,
        x: Math.round(vc.x * scale), y: Math.round(vc.y * scale),
        w: Math.max(20, Math.round(vc.width * scale)), h: Math.max(20, Math.round(vc.height * scale)),
        z: zs.indexOf(vc.z ?? 0) + 1,
        fields, format,
        filters: parseFilters(vc.filters, tables),
        style: { pbiType, ...(sv.objects ? { objects: sv.objects } : {}), ...(sv.vcObjects ? { vcObjects: sv.vcObjects } : {}) },
        ...(cfg.name ? { pbiName: cfg.name } : {}),
        // Hidden visuals stay in the report (Selection pane, bookmarks), just not drawn.
        ...(sv.display?.mode === 'hidden' ? { hidden: true } : {}),
      };
      if (cfg.parentGroupName) groupOf.set(v, cfg.parentGroupName);
      if (type === 'unsupported') { v.text = pbiType; v.style!.raw = sv; }
      if (type === 'keyInfluencers') {
        const kd = prop(sv.objects, 'keyDrivers');
        const tv = decode(kd.targetValue);
        // targetValue is a literal holding a literal ('''Male''' → 'Male' → Male).
        if (typeof tv === 'string') v.ki = { target: tv.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'") };
        if (decode(kd.numericTargetSelectedKind) === 1) v.ki = { ...v.ki, dir: 'down' };
      }
      if (type === 'textbox') {
        const paras = prop(sv.objects, 'general').paragraphs ?? [];
        v.text = (Array.isArray(paras) ? paras : []).map((p: any) => (p.textRuns ?? []).map((r: any) => r.value ?? '').join('')).join('\n');
      }
      if (type === 'image') {
        const name = prop(sv.objects, 'general').imageUrl?.expr?.ResourcePackageItem?.ItemName;
        v.image = name ? resources[name] : undefined;
        if (!v.image) continue;
      }
      if (type === 'slicer') {
        const sel = parseCondition(prop(sv.objects, 'general').filter?.filter, tables);
        if (sel) v.slicerValues = sel.values;
      }
      visuals.push(v);
    }
    return {
      id: uid(),
      name: sec.displayName || `Pagina ${si + 1}`,
      visuals: (() => {
        const byName = new Map(groups.map((g) => [g.pbiName, g.id]));
        for (const [v, name] of groupOf) { const id = byName.get(name); if (id) v.group = id; }
        return visuals;
      })(),
      ...(groups.length ? { groups: groups.map(({ parentName, ...g }) => ({ ...g, ...(parentName && groups.some((x) => x.pbiName === parentName) ? { parent: groups.find((x) => x.pbiName === parentName)!.id } : {}) })) } : {}),
      filters: parseFilters(sec.filters, tables),
      background: bgName ? resources[bgName] : undefined,
      ...(sec.width && sec.height && (sec.width !== PAGE_W || sec.height !== PAGE_H) ? { width: sec.width, height: sec.height } : {}),
      ...(typeof bgColor === 'string' ? { backgroundColor: bgColor } : {}),
      ...(typeof bgTransp === 'number' ? { backgroundTransparency: bgTransp } : {}),
      ...(bgFit === 'Fit' || bgFit === 'Fill' || bgFit === 'Normal' ? { backgroundFit: bgFit } : {}),
      ...(typeof wallColor === 'string' ? { wallpaper: wallColor } : {}),
      ...(secCfg.visibility === 1 ? { hidden: true } : {}),
      ...(sec.name ? { pbiName: sec.name } : {}),
    };
  });
  return {
    pages: pages.length ? pages : [{ id: uid(), name: 'Pagina 1', visuals: [], filters: [] }],
    reportFilters: parseFilters(layout.filters, tables), skipped,
    bookmarks: parseBookmarks(json(layout.config).bookmarks, pages, tables),
  };
}

/** Bookmarks of Report/Layout config (with bookmark groups) → LinBI bookmarks. */
function parseBookmarks(list: unknown, pages: Page[], tables: TableMeta[]): Bookmark[] {
  if (!Array.isArray(list)) return [];
  const out: Bookmark[] = [];
  const add = (b: any, group?: string) => {
    if (Array.isArray(b?.children)) { for (const c of b.children) add(c, b.displayName); return; }
    const es = b?.explorationState ?? {};
    const page = pages.find((p) => p.pbiName === es.activeSection);
    // Visual names are only unique within a page (copied pages reuse them).
    const visual = new Map<string, Visual>((page?.visuals ?? []).filter((v) => v.pbiName).map((v) => [v.pbiName!, v]));
    const o = b?.options ?? {};
    const sec = es.sections?.[es.activeSection] ?? {};
    const targets = o.applyOnlyToTargetVisuals && Array.isArray(o.targetVisualNames) ? o.targetVisualNames.map((n: string) => visual.get(n)?.id).filter(Boolean) : undefined;
    const hidden: string[] = [], slicers: Record<string, string[]> = {};
    for (const [name, st] of Object.entries<any>(sec.visualContainers ?? {})) {
      const v = visual.get(name);
      if (!v || (targets && !targets.includes(v.id))) continue;
      if (st?.singleVisual?.display?.mode === 'hidden') hidden.push(v.id);
      const f = st?.singleVisual?.objects?.merge?.general?.[0]?.properties?.filter?.filter;
      if (v.type === 'slicer' && f) { const c = parseCondition(f, tables); slicers[v.id] = c?.values ?? []; }
    }
    const hiddenGroups = Object.entries<any>(sec.visualContainerGroups ?? {}).filter(([, g]) => g?.isHidden)
      .map(([name]) => page?.groups?.find((g) => g.pbiName === name)?.id).filter((x): x is string => !!x);
    const byExpr = (x: any) => (Array.isArray(x?.byExpr) ? x.byExpr.map((f: any) => parseCondition(f.filter, tables)).filter((f: Filter | null): f is Filter => !!f) : undefined);
    out.push({
      id: uid(), name: b?.displayName || 'Segnalibro', pbiName: b?.name, ...(group ? { group } : {}), ...(page ? { page: page.id } : {}),
      applyData: !o.suppressData, applyDisplay: !o.suppressDisplay, applyPage: !o.suppressActiveSection,
      ...(targets ? { targets } : {}),
      state: { hidden, hiddenGroups, reportFilters: byExpr(es.filters), pageFilters: byExpr(sec.filters), slicers },
    });
  };
  for (const b of list) add(b);
  return out;
}

/* -------------------------------- export -------------------------------- */

const L = (v: string) => ({ expr: { Literal: { Value: v } } });
const Ls = (s: string) => L(`'${s.replace(/'/g, "''")}'`);

function filterJson(f: Filter, name: string) {
  const values = f.values.map((v) => [{ Literal: { Value: v === NULL_KEY ? 'null' : `'${v.replace(/'/g, "''")}'` } }]);
  return {
    name,
    expression: { Column: { Expression: { SourceRef: { Entity: f.table } }, Property: f.column } },
    filter: {
      Version: 2,
      From: [{ Name: 't', Entity: f.table, Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 't' } }, Property: f.column } }], Values: values } } }],
    },
    type: 'Categorical',
    howCreated: 1,
  };
}

const hex = () => Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** LinBI report → Report/Layout JSON + image resources to package. */
/** Custom theme referenced by a Report/Layout (themeCollection.customTheme → RegisteredResources). */
export function themeFromLayout(layoutJson: string, resources: Record<string, string>): Theme | undefined {
  try {
    const cfg = JSON.parse(JSON.parse(layoutJson).config ?? '{}');
    const name: string | undefined = cfg.themeCollection?.customTheme?.name;
    const url = name ? resources[name] : undefined;
    if (!url) return undefined;
    const text = decodeURIComponent(escape(atob(url.split(',')[1])));
    return parseTheme(text, name!.replace(/\.json$/i, ''));
  } catch {
    return undefined;
  }
}

/** Stable Power BI names, so bookmarks and buttons keep pointing at the same pages and visuals. */
const vname = (v: Visual) => v.pbiName ?? (v.id + '00000000000000000000').slice(0, 20);
const sname = (p: Page) => p.pbiName ?? 'ReportSection' + p.id;
const gname = (g: VisualGroup) => g.pbiName ?? ('g' + g.id + '0000000000000000000').slice(0, 20);

/** LinBI bookmarks → Report/Layout config.bookmarks (explorationState). */
function bookmarksJson(bookmarks: Bookmark[], pages: Page[]) {
  const one = (b: Bookmark) => {
    const page = pages.find((p) => p.id === b.page) ?? pages[0];
    const visualContainers: Record<string, unknown> = {};
    for (const v of page.visuals) {
      if (b.targets && !b.targets.includes(v.id)) continue;
      const sv: any = {};
      if (b.state.hidden.includes(v.id)) sv.display = { mode: 'hidden' };
      if (v.type === 'slicer' && b.state.slicers?.[v.id]?.length && v.fields.category?.[0]) {
        const f = v.fields.category[0];
        sv.objects = { merge: { general: [{ properties: { filter: { filter: filterJson({ id: '', table: f.table, column: f.column, values: b.state.slicers[v.id] }, '').filter } } }] } };
      }
      visualContainers[vname(v)] = { singleVisual: sv };
    }
    const visualContainerGroups = Object.fromEntries((page.groups ?? []).map((g) => [gname(g), { isHidden: b.state.hiddenGroups.includes(g.id) }]));
    const byExpr = (fs?: Filter[]) => ({ byExpr: (fs ?? []).filter((f) => f.values.length).map((f) => filterJson(f, hex())) });
    return {
      displayName: b.name, name: b.pbiName ?? 'Bookmark' + b.id,
      explorationState: {
        version: '1.3', activeSection: sname(page), filters: byExpr(b.state.reportFilters),
        sections: { [sname(page)]: { visualContainers, visualContainerGroups, filters: byExpr(b.state.pageFilters) } },
      },
      options: {
        ...(b.applyData ? {} : { suppressData: true }), ...(b.applyDisplay ? {} : { suppressDisplay: true }), ...(b.applyPage ? {} : { suppressActiveSection: true }),
        ...(b.targets ? { targetVisualNames: page.visuals.filter((v) => b.targets!.includes(v.id)).map(vname), applyOnlyToTargetVisuals: true } : {}),
      },
    };
  };
  // Consecutive bookmarks of the same group become a bookmark group.
  const out: any[] = [];
  for (const b of bookmarks) {
    const last = out[out.length - 1];
    if (b.group && last?.children && last.displayName === b.group) last.children.push(one(b));
    else if (b.group) out.push({ displayName: b.group, name: 'Bookmark' + hex(), children: [one(b)] });
    else out.push(one(b));
  }
  return out;
}

export function buildLayout(pages: Page[], reportFilters: Filter[], theme?: Theme, bookmarks: Bookmark[] = []): { layout: string; resources: Record<string, string> } {
  const resources: Record<string, string> = {};
  const addResource = (dataUrl: string) => {
    const m = /^data:image\/(\w+)/.exec(dataUrl);
    const name = `image${Object.keys(resources).length + 1}${hex().slice(0, 8)}.${m?.[1] === 'jpeg' ? 'jpg' : m?.[1] ?? 'png'}`;
    resources[name] = dataUrl;
    return name;
  };

  const sections = pages.map((p, i) => {
    const containers = p.visuals.filter((v) => v.type !== 'unsupported' || v.style?.raw).map((v, vi) => {
      if (v.type === 'unsupported') {
        // Not rendered by LinBI (custom visuals, Q&A…): written back unchanged at its current position.
        const config = { name: vname(v), layouts: [{ id: 0, position: { x: v.x, y: v.y, z: v.z * 1000, width: v.w, height: v.h, tabOrder: vi * 1000 } }], singleVisual: v.hidden ? { ...(v.style!.raw as object), display: { mode: 'hidden' } } : v.style!.raw, ...(v.group ? { parentGroupName: gname(p.groups!.find((g) => g.id === v.group)!) } : {}) };
        return { x: v.x, y: v.y, z: v.z * 1000, width: v.w, height: v.h, config: JSON.stringify(config), filters: '[]' };
      }
      const def = visualDef(v.type);
      const roles = Object.entries(roleMap(v.type));
      const entities = [...new Set(Object.values(v.fields).flat().map((f) => f.table))];
      const alias: Record<string, string> = {};
      entities.forEach((e, ei) => (alias[e] = (e[0] ?? 't').toLowerCase().replace(/[^a-z]/, 't') + (ei || '')));
      const select: any[] = [];
      const projections: Record<string, { queryRef: string; active?: boolean }[]> = {};
      for (const w of def.wells) {
        const role = roles.find(([, well]) => well === w.key)?.[0];
        if (!role) continue;
        for (const f of v.fields[w.key] ?? []) {
          const src = { SourceRef: { Source: alias[f.table] } };
          let expr: any, name: string;
          if (f.agg === 'measure') { expr = { Measure: { Expression: src, Property: f.column } }; name = `${f.table}.${f.column}`; }
          else if (f.agg === 'none') { expr = { Column: { Expression: src, Property: f.column } }; name = `${f.table}.${f.column}`; }
          else {
            const [fn, label] = AGG_OUT[f.agg]!;
            expr = { Aggregation: { Expression: { Column: { Expression: src, Property: f.column } }, Function: fn } };
            name = `${label}(${f.table}.${f.column})`;
          }
          if (!select.some((s) => s.Name === name)) select.push({ ...expr, Name: name });
          (projections[role] ??= []).push({ queryRef: name, ...(role === 'Category' || role === 'Rows' ? { active: true } : {}) });
        }
      }
      // Imported formatting is kept; LinBI's own settings overwrite their properties.
      const objects: any = structuredClone(v.style?.objects ?? {});
      const vcObjects: any = structuredClone(v.style?.vcObjects ?? {});
      const put = (objs: any, obj: string, props: Record<string, unknown>) => {
        const list: any[] = (objs[obj] ??= []);
        let e = list.find((x) => !x.selector);
        if (!e) { e = { properties: {} }; list.unshift(e); }
        e.properties = { ...(e.properties ?? {}), ...props };
      };
      const color = (c: string) => ({ solid: { color: Ls(c) } });
      const fm = v.format;
      put(vcObjects, 'title', {
        show: L(String(fm.titleShow)), ...(fm.titleText ? { text: Ls(fm.titleText) } : {}),
        ...(fm.titleColor ? { fontColor: color(fm.titleColor) } : {}), ...(fm.titleAlign ? { alignment: Ls(fm.titleAlign) } : {}),
        ...(fm.titleFont ? { fontFamily: Ls(fm.titleFont) } : {}), ...(fm.titleBg ? { background: color(fm.titleBg) } : {}),
        ...(fm.titleBold !== undefined ? { bold: L(String(fm.titleBold)) } : {}), fontSize: L(`${Math.round(fm.titleSize * 0.75 * 10) / 10}D`),
      });
      if (fm.background === 'transparent') put(vcObjects, 'background', { show: L('false') });
      else put(vcObjects, 'background', { show: L('true'), color: color(fm.background), transparency: L(`${fm.bgTransparency ?? 0}D`) });
      if (fm.border) put(vcObjects, 'border', { show: L('true'), ...(fm.borderColor ? { color: color(fm.borderColor) } : {}), ...(fm.borderRadius !== undefined ? { radius: L(`${fm.borderRadius}D`) } : {}) });
      else if (vcObjects.border) put(vcObjects, 'border', { show: L('false') });
      if (isChartType(v.type)) {
        put(objects, 'legend', { show: L(String(fm.legendShow)) });
        put(objects, 'labels', { show: L(String(fm.dataLabels)) });
        if (fm.color && fm.color !== '#118DFF') put(objects, 'dataPoint', { fill: color(fm.color) });
      }
      if ((v.type === 'pythonVisual' || v.type === 'rVisual') && v.script !== undefined) put(objects, 'script', { source: Ls(v.script), provider: Ls(v.type === 'rVisual' ? 'R' : 'Python') });
      if (v.type === 'qna' && v.qna?.question) put(objects, 'hiddenProperties', { savedUtterance: Ls(v.qna.question) });
      if (v.type === 'textbox') {
        const same = (objects.general?.[0]?.properties?.paragraphs ?? []).map((p: any) => (p.textRuns ?? []).map((r: any) => r.value ?? '').join('')).join('\n') === (v.text ?? '');
        if (!same) put(objects, 'general', { paragraphs: (v.text ?? '').split('\n').map((t) => ({ textRuns: [{ value: t }] })) });
      }
      if (v.type === 'image' && v.image) {
        put(objects, 'general', { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: addResource(v.image) } } } });
      }
      if (v.type === 'slicer') {
        put(objects, 'data', { mode: Ls(v.format.slicerStyle === 'dropdown' ? 'Dropdown' : 'Basic') });
        const f = v.fields.category?.[0];
        if (f && v.slicerValues?.length) put(objects, 'general', { filter: { filter: filterJson({ id: '', table: f.table, column: f.column, values: v.slicerValues }, '').filter } });
        else if (objects.general) for (const e of objects.general) delete e.properties?.filter;
      }
      const flat = def.wells.flatMap((w) => v.fields[w.key] ?? []);
      const sortField = v.format.sortBy !== undefined ? flat[v.format.sortBy] : undefined;
      const sortSel = sortField ? select.find((s) => (s.Column ?? s.Measure ?? s.Aggregation?.Expression?.Column)?.Property === sortField.column) : undefined;
      const parent = v.group ? p.groups?.find((g) => g.id === v.group) : undefined;
      const config = {
        name: vname(v),
        layouts: [{ id: 0, position: { x: v.x, y: v.y, z: v.z * 1000, width: v.w, height: v.h, tabOrder: vi * 1000 } }],
        ...(parent ? { parentGroupName: gname(parent) } : {}),
        singleVisual: {
          ...(v.hidden ? { display: { mode: 'hidden' } } : {}),
          // Same Power BI type as imported when it maps to this LinBI type (cardVisual, advancedSlicerVisual, shape…).
          visualType: v.style?.pbiType && TYPE_IN[v.style.pbiType] === v.type ? v.style.pbiType : TYPE_OUT[v.type],
          projections,
          prototypeQuery: {
            Version: 2,
            From: entities.map((e) => ({ Name: alias[e], Entity: e, Type: 0 })),
            Select: select,
            ...(sortSel ? { OrderBy: [{ Direction: v.format.sortDir === 'asc' ? 1 : 2, Expression: Object.fromEntries(Object.entries(sortSel).filter(([k]) => k !== 'Name')) }] } : {}),
          },
          drillFilterOtherVisuals: true,
          objects,
          vcObjects,
        },
      };
      return {
        x: v.x, y: v.y, z: v.z * 1000, width: v.w, height: v.h,
        config: JSON.stringify(config),
        filters: JSON.stringify((v.filters ?? []).filter((f) => f.values.length).map((f) => filterJson(f, hex()))),
      };
    });
    const secConfig: any = { objects: {} };
    const bgProps: any = {};
    if (p.background) bgProps.image = { image: { name: L("'background'"), url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: addResource(p.background) } } }, scaling: Ls(p.backgroundFit ?? 'Fit') } };
    if (p.backgroundColor) bgProps.color = { solid: { color: Ls(p.backgroundColor) } };
    if (p.backgroundTransparency !== undefined) bgProps.transparency = L(`${p.backgroundTransparency}D`);
    if (Object.keys(bgProps).length) secConfig.objects.background = [{ properties: bgProps }];
    if (p.wallpaper) secConfig.objects.outspace = [{ properties: { color: { solid: { color: Ls(p.wallpaper) } } } }];
    if (p.hidden) secConfig.visibility = 1;
    return {
      name: sname(p), displayName: p.name, ordinal: i, displayOption: 1, width: p.width ?? PAGE_W, height: p.height ?? PAGE_H,
      config: JSON.stringify(secConfig),
      filters: JSON.stringify(p.filters.filter((f) => f.values.length).map((f) => filterJson(f, hex()))),
      // Groups are containers too (singleVisualGroup), placed around their members.
      visualContainers: [...containers, ...(p.groups ?? []).map((g, gi) => {
        const members = p.visuals.filter((v) => v.group === g.id);
        const x = members.length ? Math.min(...members.map((v) => v.x)) : 0, y = members.length ? Math.min(...members.map((v) => v.y)) : 0;
        const w = members.length ? Math.max(...members.map((v) => v.x + v.w)) - x : 1, h = members.length ? Math.max(...members.map((v) => v.y + v.h)) - y : 1;
        const parent = g.parent ? p.groups!.find((q) => q.id === g.parent) : undefined;
        const config = { name: gname(g), layouts: [{ id: 0, position: { x, y, z: 0, width: w, height: h, tabOrder: (containers.length + gi) * 1000 } }], singleVisualGroup: { displayName: g.name, groupMode: 0, ...(g.hidden ? { isHidden: true } : {}) }, ...(parent ? { parentGroupName: gname(parent) } : {}) };
        return { x, y, z: 0, width: w, height: h, config: JSON.stringify(config), filters: '[]' };
      })],
    };
  });

  let themeName: string | undefined;
  if (theme) {
    themeName = `${theme.name.replace(/[^\w -]/g, '_')}${Date.now().toString(36)}.json`;
    resources[themeName] = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(themeJson(theme))));
  }
  const layout = {
    id: 0,
    resourcePackages: Object.keys(resources).length ? [{
      // 202 = custom theme, 100 = image.
      resourcePackage: { name: 'RegisteredResources', type: 1, items: Object.keys(resources).map((n) => ({ type: n === themeName ? 202 : 100, path: n, name: n })), disabled: false },
    }] : [],
    sections,
    config: JSON.stringify({ version: '5.43', themeCollection: themeName ? { customTheme: { name: themeName, version: '5.43', type: 2 } } : {}, activeSectionIndex: 0, defaultDrillFilterOtherVisuals: true, linguisticSchemaSyncVersion: 0, settings: { useNewFilterPaneExperience: true, allowChangeFilterTypes: true }, objects: {}, ...(bookmarks.length ? { bookmarks: bookmarksJson(bookmarks, pages) } : {}) }),
    filters: JSON.stringify(reportFilters.filter((f) => f.values.length).map((f) => filterJson(f, hex()))),
    layoutOptimization: 0,
  };
  return { layout: JSON.stringify(layout), resources };
}
