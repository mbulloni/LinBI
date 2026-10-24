import type { Page, Report, Visual } from '../types';

/** Slicer selection state shared by synced slicers (Sincronizza filtri dei dati). */
const STATE_KEYS = ['slicerValues', 'pendingSlicer', 'slicerRange', 'slicerText', 'slicerRelative'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Members of a sync group across the report, with their page. */
export function syncMembers(r: Report, group: string): { page: Page; v: Visual }[] {
  return r.pages.flatMap((page) => page.visuals.filter((v) => v.syncGroup?.name === group).map((v) => ({ page, v })));
}

/**
 * After a report change: a synced slicer whose selection (or fields) changed passes it to the other slicers
 * of its group, like Power BI (filterChanges / fieldChanges, both on by default).
 */
export function propagateSync(prev: Report, next: Report) {
  const before = new Map(prev.pages.flatMap((p) => p.visuals.map((v) => [v.id, v] as const)));
  for (const p of next.pages) for (const v of p.visuals) {
    const g = v.syncGroup;
    if (!g) continue;
    const old = before.get(v.id);
    if (!old) continue;
    const stateChanged = g.filterChanges !== false && STATE_KEYS.some((k) => !same(old[k], v[k]));
    const fieldsChanged = g.fieldChanges !== false && !same(old.fields, v.fields);
    if (!stateChanged && !fieldsChanged) continue;
    for (const { v: o } of syncMembers(next, g.name)) {
      if (o.id === v.id) continue;
      if (stateChanged && o.syncGroup?.filterChanges !== false) for (const k of STATE_KEYS) { if (v[k] === undefined) delete o[k]; else (o as any)[k] = structuredClone(v[k]); }
      if (fieldsChanged && o.syncGroup?.fieldChanges !== false) o.fields = structuredClone(v.fields);
    }
    return; // one source per change
  }
}
