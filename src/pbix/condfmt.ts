// Conditional formatting ↔ Power BI report JSON (legacy Layout / PBIR objects):
// - tables/matrices: objects.values entries (selector { data: [dataViewWildcard], metadata: queryRef }) with
//   backColor / fontColor = FillRule (linearGradient2/3) or Conditional (rules), icon = Conditional with icon names;
//   objects.columnFormatting (selector { metadata }) with dataBars;
// - charts: objects.dataPoint wildcard entry with fill = FillRule / Conditional on an input field.
import type { CfRule, ColorScale, CondFormat, FieldRef, Visual, VisualFormat } from '../types';
import { decode } from '../visuals/pbistyle';
import { cfInput, DEFAULT_ICONS, fieldKey } from '../visuals/condfmt';

type ToField = (e: any) => FieldRef | null;
const L = (v: string) => ({ Literal: { Value: v } });
const num = (n: number) => L(`${n}D`);
const str = (s: string) => L(`'${s.replace(/'/g, "''")}'`);
/** Color/number of a value written as { expr: … }, { Literal } or { ThemeDataColor }. */
const color = (x: any) => { const c = decode(x?.ThemeDataColor ? { expr: x } : x); return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c.toUpperCase() : undefined; };
const numberOf = (x: any) => { const v = decode(x); return typeof v === 'number' ? v : undefined; };

/* --------------------------------- import -------------------------------- */

function gradient(fr: any): ColorScale | undefined {
  const g = fr?.linearGradient3 ?? fr?.linearGradient2;
  const min = color(g?.min?.color), max = color(g?.max?.color);
  if (!min || !max) return undefined;
  const mid = fr.linearGradient3 ? color(g.mid?.color) : undefined;
  const mv = numberOf(g.min?.value), xv = numberOf(g.max?.value), dv = fr.linearGradient3 ? numberOf(g.mid?.value) : undefined;
  return { min, max, ...(mid ? { mid } : {}), ...(mv !== undefined ? { minValue: mv } : {}), ...(xv !== undefined ? { maxValue: xv } : {}), ...(dv !== undefined ? { midValue: dv } : {}) };
}

/** Bounds of one rule from its condition (Comparison, or And of two comparisons). */
function bounds(c: any, toField: ToField, out: { rule: Partial<CfRule>; input?: FieldRef }): boolean {
  if (c?.And) return bounds(c.And.Left, toField, out) && bounds(c.And.Right, toField, out);
  const cmp = c?.Comparison;
  if (!cmp) return false;
  out.input ??= toField(cmp.Left) ?? undefined;
  const raw = cmp.Right?.Literal?.Value;
  if (raw === 'null') { out.rule.blank = true; return true; }
  const n = numberOf(cmp.Right);
  if (n === undefined) return false;
  switch (cmp.ComparisonKind) {
    case 0: out.rule.min = n; out.rule.minInc = true; out.rule.max = n; out.rule.maxInc = true; break;
    case 1: out.rule.min = n; out.rule.minInc = false; break;
    case 2: out.rule.min = n; out.rule.minInc = true; break;
    case 3: out.rule.max = n; out.rule.maxInc = false; break;
    case 4: out.rule.max = n; out.rule.maxInc = true; break;
    default: return false;
  }
  return true;
}

function rules(cond: any, toField: ToField): { rules: CfRule[]; input?: FieldRef } | undefined {
  const out: CfRule[] = [];
  let input: FieldRef | undefined;
  for (const k of cond?.Cases ?? []) {
    const acc: { rule: Partial<CfRule>; input?: FieldRef } = { rule: {}, input };
    const value = decode({ expr: k.Value });
    if (typeof value !== 'string' || !bounds(k.Condition, toField, acc)) continue;
    input ??= acc.input;
    out.push({ ...acc.rule, value: /^#/.test(value) ? value.toUpperCase() : value } as CfRule);
  }
  return out.length ? { rules: out, input } : undefined;
}

/** A color property (backColor/fontColor/fill): gradient or rules, and the driving field. */
function colorFormat(p: any, toField: ToField): { scale?: ColorScale; rules?: CfRule[]; input?: FieldRef } | undefined {
  const e = p?.solid?.color?.expr;
  if (e?.FillRule) { const scale = gradient(e.FillRule.FillRule); return scale ? { scale, input: toField(e.FillRule.Input) ?? undefined } : undefined; }
  if (e?.Conditional) { const r = rules(e.Conditional, toField); return r ? { rules: r.rules, input: r.input } : undefined; }
  return undefined;
}

const sameField = (a?: FieldRef, b?: FieldRef) => !!a && !!b && a.table === b.table && a.column === b.column && (a.agg === b.agg || a.agg === 'measure' || b.agg === 'measure');

/** Reads table/matrix and chart conditional formatting into `format` (byRef: queryRef → visual field). */
export function importCondFormat(objects: any, byRef: Record<string, FieldRef>, fields: FieldRef[], format: VisualFormat, toField: ToField, chart: boolean) {
  const wild = (sel: any) => (sel?.data ?? []).some((d: any) => d.dataViewWildcard);
  const cf: Record<string, CondFormat> = { ...(format.cf ?? {}) };
  const target = (sel: any) => { const f = byRef[sel?.metadata]; return f && fields.find((x) => sameField(x, f) && x.agg === f.agg) ? f : undefined; };
  for (const e of objects?.values ?? []) {
    const f = target(e.selector);
    if (!f) continue;
    const c: CondFormat = { ...cf[fieldKey(f)] };
    const pr = e.properties ?? {};
    const bg = colorFormat(pr.backColor, toField), fg = colorFormat(pr.fontColor, toField);
    let input: FieldRef | undefined;
    if (bg) { if (bg.scale) c.background = bg.scale; if (bg.rules) c.bgRules = bg.rules; input ??= bg.input; }
    if (fg) { if (fg.scale) c.font = fg.scale; if (fg.rules) c.fontRules = fg.rules; input ??= fg.input; }
    const ic = pr.icon?.value?.expr?.Conditional ?? pr.icon?.expr?.Conditional;
    const ir = ic ? rules(ic, toField) : undefined;
    if (ir) { c.icons = true; c.iconRules = ir.rules; input ??= ir.input; }
    if (input && !sameField(input, f)) c.input = input;
    if (Object.keys(c).length) cf[fieldKey(f)] = c;
  }
  for (const e of objects?.columnFormatting ?? []) {
    const db = e.properties?.dataBars;
    const f = db ? target(e.selector) : undefined;
    if (!f) continue;
    cf[fieldKey(f)] = { ...cf[fieldKey(f)], bars: { positive: color(db.positiveColor?.solid?.color) ?? '#118DFF', negative: color(db.negativeColor?.solid?.color) ?? '#D64554' } };
  }
  if (Object.keys(cf).length) format.cf = cf;
  if (chart) {
    const rule = (e: any) => { const x = e.properties?.fill?.solid?.color?.expr; return !!(x?.FillRule || x?.Conditional || e.properties?.fillRule); };
    const dp = (objects?.dataPoint ?? []).find((e: any) => (wild(e.selector) || !e.selector) && rule(e));
    if (!dp) return;
    const legacy = dp.properties.fillRule ? gradient(dp.properties.fillRule) : undefined;
    const fm = legacy ? { scale: legacy } : colorFormat(dp.properties.fill, toField);
    if (!fm) return;
    const own = fields.find((x) => x.agg !== 'none');
    if (fm.scale && (!fm.input || sameField(fm.input, own))) format.colorScale = fm.scale;
    else if (fm.input) format.colorRule = { field: fm.input, ...(fm.scale ? { scale: fm.scale } : {}), ...(fm.rules ? { rules: fm.rules } : {}) };
  }
}

/* --------------------------------- export -------------------------------- */

/** Semantic-query expression of a field (Entity form, as conditional-formatting inputs are written). */
export function fieldExpr(f: FieldRef, aggFn: (a: FieldRef['agg']) => number | undefined): any {
  const src = { SourceRef: { Entity: f.table } };
  if (f.agg === 'measure') return { Measure: { Expression: src, Property: f.column } };
  const col = { Column: { Expression: src, Property: f.column } };
  const fn = f.agg === 'none' ? undefined : aggFn(f.agg);
  return fn === undefined ? col : { Aggregation: { Expression: col, Function: fn } };
}

function fillRule(s: ColorScale) {
  const stop = (c: string, v?: number) => ({ color: str(c), ...(v !== undefined ? { value: num(v) } : {}) });
  const body = { min: stop(s.min, s.minValue), ...(s.mid ? { mid: stop(s.mid, s.midValue) } : {}), max: stop(s.max, s.maxValue), nullColoringStrategy: { strategy: str('asZero') } };
  return s.mid ? { linearGradient3: body } : { linearGradient2: body };
}

function condition(r: CfRule, input: any): any {
  const cmp = (kind: number, n: number | null) => ({ Comparison: { ComparisonKind: kind, Left: input, Right: n === null ? L('null') : num(n) } });
  if (r.blank) return cmp(0, null);
  const parts: any[] = [];
  if (r.min !== undefined) parts.push(cmp(r.minInc === false ? 1 : 2, r.min));
  if (r.max !== undefined) parts.push(cmp(r.maxInc ? 4 : 3, r.max));
  if (!parts.length) parts.push(cmp(1, -Number.MAX_SAFE_INTEGER));
  return parts.length === 2 ? { And: { Left: parts[0], Right: parts[1] } } : parts[0];
}
const conditional = (list: CfRule[], input: any) => ({ Conditional: { Cases: list.map((r) => ({ Condition: condition(r, input), Value: str(r.value) })) } });
const colorProp = (scale: ColorScale | undefined, list: CfRule[] | undefined, input: any) =>
  list?.length ? { solid: { color: { expr: conditional(list, input) } } } : scale ? { solid: { color: { expr: { FillRule: { Input: input, FillRule: fillRule(scale) } } } } } : undefined;

/** Default icons (thirds of the visible range) as numeric rules, from the range at export time. */
export function thirds(r: { min: number; max: number }): CfRule[] {
  const a = r.min + (r.max - r.min) / 3, b = r.min + ((r.max - r.min) * 2) / 3;
  return [{ max: a, value: DEFAULT_ICONS[0] }, { min: a, max: b, value: DEFAULT_ICONS[1] }, { min: b, value: DEFAULT_ICONS[2] }];
}

const ruleBased = (x: unknown) => /"(FillRule|Conditional)"/.test(JSON.stringify(x ?? null));
/** Entry without its conditional-formatting properties (null when nothing else is left). */
function stripCf(e: any): any {
  const p = { ...(e?.properties ?? {}) };
  for (const k of ['backColor', 'fontColor', 'fill']) if (ruleBased(p[k])) delete p[k];
  delete p.icon; delete p.dataBars; delete p.fillRule;
  return Object.keys(p).length ? { ...e, properties: p } : null;
}

/** Writes MiB-BI's conditional formatting into `objects` (previous rule entries replaced).
 *  nameOf: field → queryRef in the visual's Select; ranges: visible range per field key (default icons). */
export function exportCondFormat(v: Visual, objects: any, nameOf: (f: FieldRef) => string | undefined, aggFn: (a: FieldRef['agg']) => number | undefined,
  chart: boolean, ranges?: Map<string, { min: number; max: number }>) {
  for (const o of ['values', 'columnFormatting', 'dataPoint']) {
    if (!objects[o]) continue;
    objects[o] = objects[o].map(stripCf).filter(Boolean);
    if (!objects[o].length) delete objects[o];
  }
  const wildcard = (metadata?: string) => ({ data: [{ dataViewWildcard: { matchingOption: 1 } }], ...(metadata ? { metadata } : {}) });
  for (const [key, c] of Object.entries(v.format.cf ?? {})) {
    const f = Object.values(v.fields).flat().find((x) => fieldKey(x) === key);
    const name = f && nameOf(f);
    if (!f || !name) continue;
    const input = fieldExpr(cfInput(c.input ?? f), aggFn);
    const props: Record<string, any> = {};
    const bg = colorProp(c.background, c.bgRules, input), fg = colorProp(c.font, c.fontRules, input);
    if (bg) props.backColor = bg;
    if (fg) props.fontColor = fg;
    const r = ranges?.get(key);
    const icons = c.iconRules?.length ? c.iconRules : c.icons && r ? thirds(r) : undefined;
    if (icons) props.icon = { value: { expr: conditional(icons, input) }, layout: { expr: str('Before') }, verticalAlignment: { expr: str('Top') } };
    if (Object.keys(props).length) (objects.values ??= []).push({ properties: props, selector: wildcard(name) });
    if (c.bars) {
      (objects.columnFormatting ??= []).push({
        properties: { dataBars: {
          positiveColor: { solid: { color: { expr: str(c.bars.positive) } } }, negativeColor: { solid: { color: { expr: str(c.bars.negative) } } },
          axisColor: { solid: { color: { expr: str('foreground') } } }, reverseDirection: { expr: L('false') }, hideText: { expr: L('false') },
        } },
        selector: { metadata: name },
      });
    }
  }
  if (chart) {
    const own = Object.values(v.fields).flat().find((x) => x.agg !== 'none');
    const fm = v.format;
    const fill = fm.colorRule ? colorProp(fm.colorRule.scale, fm.colorRule.rules, fieldExpr(cfInput(fm.colorRule.field), aggFn))
      : fm.colorScale && own ? colorProp(fm.colorScale, undefined, fieldExpr(own, aggFn)) : undefined;
    if (fill) (objects.dataPoint ??= []).push({ properties: { fill }, selector: wildcard() });
  }
}
