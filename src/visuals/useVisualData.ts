import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { useExtraFilters } from './filterContext';
import { buildVisualQuery, CF_WELL, type QueryItem } from '../query';
import type { Visual } from '../types';

export interface VisualData {
  loading: boolean;
  error?: string;
  empty: boolean;
  items: QueryItem[];
  /** Hidden items driving conditional formatting (CF_WELL), values in `rows`. */
  cfItems: QueryItem[];
  rows: Record<string, any>[];
  totals?: Record<string, any>[];
  colTotals?: Record<string, any>[];
  rowTotals?: Record<string, any>[];
  /** aliases of measures formatted as percentages in Power BI */
  percent: Set<string>;
}

let pending = 0;
/** Visual queries still running (PDF export waits for 0). */
export const pendingQueries = () => pending;

/** Builds the SQL for a visual from its wells + all filters in scope, and runs it on DuckDB. */
export function useVisualData(v: Visual): VisualData {
  const tables = useStore((s) => s.tables);
  const report = useStore((s) => s.report);
  const pageId = useStore((s) => s.activePageId);
  const cross = useStore((s) => s.crossFilter);
  const dataVersion = useStore((s) => s.dataVersion);
  const extra = useExtraFilters();
  // The visual's own page (PDF export renders every page at once).
  const page = report.pages.find((p) => p.visuals.some((x) => x.id === v.id)) ?? report.pages.find((p) => p.id === pageId) ?? report.pages[0];

  const q = useMemo(
    () => buildVisualQuery(v, tables, report.relationships, [...report.reportFilters, ...page.filters, ...extra], page.visuals, cross, report.measures),
    [v, tables, report.relationships, report.reportFilters, page.filters, page.visuals, cross, report.measures, extra],
  );
  const key = q && 'sql' in q ? [q.sql, q.totalsSql, q.colTotalsSql, q.rowTotalsSql].join('|') : JSON.stringify(q);
  const [state, setState] = useState<Omit<VisualData, 'percent' | 'cfItems'>>({ loading: false, empty: true, items: [], rows: [] });
  const percent = useMemo(() => new Set(state.items.filter((i) => i.field.agg === 'measure'
    && report.measures.find((m) => m.name === i.field.column)?.formatString?.includes('%')).map((i) => i.alias)), [state.items, report.measures]);

  useEffect(() => {
    if (!q) { setState({ loading: false, empty: true, items: [], rows: [] }); return; }
    if ('error' in q) { setState({ loading: false, empty: false, error: q.error, items: [], rows: [] }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    pending++;
    Promise.all([
      api.query(q.sql),
      q.totalsSql ? api.query(q.totalsSql) : Promise.resolve(null),
      q.colTotalsSql ? api.query(q.colTotalsSql) : Promise.resolve(null),
      q.rowTotalsSql ? api.query(q.rowTotalsSql) : Promise.resolve(null),
    ]).then(([res, tot, ctot, rtot]) => {
      if (live) setState({ loading: false, empty: false, items: q.items, rows: res.rows, totals: tot?.rows, colTotals: ctot?.rows, rowTotals: rtot?.rows });
    }).catch((e) => {
      if (live) setState({ loading: false, empty: false, error: e.message, items: q.items, rows: [] });
    }).finally(() => { pending--; });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dataVersion]);

  const items = useMemo(() => state.items.filter((i) => i.well !== CF_WELL), [state.items]);
  const cfItems = useMemo(() => state.items.filter((i) => i.well === CF_WELL), [state.items]);
  return { ...state, items, cfItems, percent };
}

/** Runs an ad-hoc query shaped like visual `v` (its wells), on `v`'s page with every filter in scope,
 *  plus `extra` filters. Used by visuals that need several queries (decomposition tree, key influencers, narrative). */
export async function runVisualQuery(v: Visual, extra: import('../types').Filter[] = []): Promise<{ items: import('../query').QueryItem[]; rows: Record<string, any>[] }> {
  const s = useStore.getState();
  const page = s.report.pages.find((p) => p.visuals.some((x) => x.id === v.id)) ?? s.page();
  const q = buildVisualQuery({ ...v, filters: [...(v.filters ?? []), ...extra] }, s.tables, s.report.relationships,
    [...s.report.reportFilters, ...page.filters], page.visuals, s.crossFilter, s.report.measures);
  if (!q) return { items: [], rows: [] };
  if ('error' in q) throw new Error(q.error);
  const res = await api.query(q.sql);
  return { items: q.items, rows: res.rows };
}
