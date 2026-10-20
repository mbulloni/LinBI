// Riquadro Analisi ↔ Power BI report objects: y1AxisReferenceLine / xAxisReferenceLine (constant lines, selector id),
// minLine / maxLine / averageLine / medianLine / percentileLine (selector { metadata: queryRef of the measure, id }),
// trend (no selector). Properties: show, displayName, value / percentile, lineColor, transparency, style, width, dataLabelShow.
import type { AnalyticsLine, FieldRef } from '../types';
import { decode } from '../visuals/pbistyle';
import { fieldKey } from '../visuals/condfmt';
import { uid } from '../format';

type Kind = AnalyticsLine['kind'];
export const ANALYTICS_OBJECT: Record<Kind, string> = {
  constant: 'y1AxisReferenceLine', xConstant: 'xAxisReferenceLine', min: 'minLine', max: 'maxLine',
  average: 'averageLine', median: 'medianLine', percentile: 'percentileLine', trend: 'trend',
};
const KIND_OF = Object.fromEntries(Object.entries(ANALYTICS_OBJECT).map(([k, o]) => [o, k as Kind]));

const L = (v: string) => ({ expr: { Literal: { Value: v } } });
const str = (s: string) => L(`'${s.replace(/'/g, "''")}'`);
const num = (n: number) => L(`${n}D`);

export function importAnalytics(objects: any, byRef: Record<string, FieldRef>): AnalyticsLine[] {
  const out: AnalyticsLine[] = [];
  for (const [obj, entries] of Object.entries<any[]>(objects ?? {})) {
    const kind = KIND_OF[obj];
    if (!kind) continue;
    for (const e of entries ?? []) {
      const p = e.properties ?? {};
      const d = (k: string) => decode(p[k]);
      if (d('show') === false) continue;
      if (kind === 'trend' && d('show') !== true) continue;
      const m = e.selector?.metadata ? byRef[e.selector.metadata] : undefined;
      const color = d('lineColor');
      const style = d('style');
      const line: AnalyticsLine = {
        id: uid(), kind,
        ...(typeof d('displayName') === 'string' ? { name: d('displayName') } : {}),
        ...(typeof d('value') === 'number' ? { value: d('value') } : typeof d('value') === 'string' && Number.isFinite(+d('value')) ? { value: +d('value') } : {}),
        ...(typeof d('percentile') === 'number' ? { percentile: d('percentile') } : {}),
        ...(m ? { measure: fieldKey(m) } : {}),
        ...(typeof color === 'string' ? { color } : {}),
        ...(style === 'solid' || style === 'dashed' || style === 'dotted' ? { style } : {}),
        ...(typeof d('width') === 'number' ? { width: d('width') } : {}),
        ...(typeof d('transparency') === 'number' ? { transparency: d('transparency') } : {}),
        ...(d('dataLabelShow') === true ? { label: true } : {}),
      };
      if ((kind === 'constant' || kind === 'xConstant') && line.value === undefined) continue;
      out.push(line);
    }
  }
  return out;
}

/** Replaces the analytics objects of `objects` with the visual's lines. */
export function exportAnalytics(lines: AnalyticsLine[] | undefined, objects: any, nameOf: (key: string) => string | undefined) {
  for (const o of Object.values(ANALYTICS_OBJECT)) delete objects[o];
  (lines ?? []).forEach((l, i) => {
    const props: Record<string, any> = { show: L('true') };
    if (l.name) props.displayName = str(l.name);
    if (l.value !== undefined && (l.kind === 'constant' || l.kind === 'xConstant')) props.value = num(l.value);
    if (l.kind === 'percentile') props.percentile = num(l.percentile ?? 50);
    if (l.color) props.lineColor = { solid: { color: str(l.color) } };
    if (l.transparency !== undefined) props.transparency = num(l.transparency);
    if (l.style) props.style = str(l.style);
    if (l.width !== undefined) props.width = num(l.width);
    if (l.label) props.dataLabelShow = L('true');
    const meta = l.measure ? nameOf(l.measure) : undefined;
    const selector = l.kind === 'trend' ? undefined : { ...(meta ? { metadata: meta } : {}), id: String(i + 1) };
    (objects[ANALYTICS_OBJECT[l.kind]] ??= []).push({ properties: props, ...(selector ? { selector } : {}) });
  });
}
