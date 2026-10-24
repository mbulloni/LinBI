import type { Interaction, Page, Report, Visual, VisualType } from '../types';

/** Visuals that can show a selection elsewhere as a highlight (full values faded, selected part solid). */
const HIGHLIGHT = new Set<VisualType>([
  'stackedBar', 'stackedColumn', 'clusteredBar', 'clusteredColumn', 'stackedBar100', 'stackedColumn100',
  'lineClusteredColumn', 'lineStackedColumn', 'pie', 'donut', 'treemap', 'funnel', 'scatter',
]);
export const canHighlight = (v: Visual) => HIGHLIGHT.has(v.type);

/** Visuals whose selection can reach other visuals (Modifica interazioni shows icons on the others). */
export const isSource = (v: Visual) => !['textbox', 'image', 'shape', 'button', 'pageNavigator', 'bookmarkNavigator', 'card', 'kpi', 'gauge', 'unsupported', 'smartNarrative', 'pythonVisual', 'rVisual'].includes(v.type);
/** Visuals affected by the others' selections. */
export const isTarget = (v: Visual) => !['textbox', 'image', 'shape', 'button', 'pageNavigator', 'bookmarkNavigator', 'unsupported'].includes(v.type);
/** Slicers (and custom visuals acting as slicers) filter or do nothing: no highlight. */
export const filtersOnly = (src: Visual) => src.type === 'slicer' || !!src.jsonFilters || src.type === 'custom';

export const interactionKey = (source: string, target: string) => `${source}>${target}`;

/** Choices offered in Modifica interazioni for the source → target pair. */
export function interactionChoices(src: Visual, target: Visual): Interaction[] {
  return filtersOnly(src) || !canHighlight(target) ? ['filter', 'none'] : ['filter', 'highlight', 'none'];
}

/** How a selection in `sourceId` reaches `target`: the pair's setting, else the report default
 *  (highlight where the target supports it, unless Opzioni › Impostazioni report sets filter). */
export function interactionOf(report: Report, page: Page, sourceId: string, target: Visual): Interaction {
  const set = page.interactions?.[interactionKey(sourceId, target.id)];
  if (set === 'none') return 'none';
  const src = page.visuals.find((x) => x.id === sourceId);
  if (set === 'filter' || (src && filtersOnly(src)) || !canHighlight(target)) return 'filter';
  if (set === 'highlight') return 'highlight';
  return report.options?.filterByDefault ? 'filter' : 'highlight';
}

/** Visuals of the page whose slicer selections reach `target` (sources set to "Nessuna" left out). */
export function scopedVisuals(page: Page, target: Visual): Visual[] {
  if (!page.interactions) return page.visuals;
  return page.visuals.filter((s) => s.id === target.id || page.interactions![interactionKey(s.id, target.id)] !== 'none');
}

/** Power BI Layout section config `relationships[].type` / PBIR visualInteractions type. */
export const INTERACTION_IN: Record<string | number, Interaction | undefined> = { 1: 'filter', 2: 'highlight', 3: 'none', DataFilter: 'filter', HighlightFilter: 'highlight', NoFilter: 'none' };
export const INTERACTION_OUT: Record<Interaction, number> = { filter: 1, highlight: 2, none: 3 };
