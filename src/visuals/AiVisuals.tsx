// Power BI "AI visuals": decomposition tree, key influencers, smart narrative.
// They run several ad-hoc queries (runVisualQuery) on the visual's page with all filters in scope.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldRef, Filter, Visual } from '../types';
import { useStore } from '../store';
import { runVisualQuery } from './useVisualData';
import { fieldLabel, fmtAuto, isNumeric, PALETTE, uid, locale } from '../format';
import { NULL_KEY } from '../query';
import { Menu } from '../components/Menu';
import { autoTitle } from '../components/VisualContainer';

const label = (x: unknown) => (x === null || x === undefined ? '(Vuoto)' : String(x));
const asFilter = (f: FieldRef, value: string | null): Filter => ({ id: uid(), table: f.table, column: f.column, values: [value === null ? NULL_KEY : value] });
const dim = (f: FieldRef): FieldRef => ({ ...f, agg: 'none' });

/** Re-runs `fn` whenever data, filters or cross-filtering change. */
function useLive<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const tables = useStore((s) => s.tables);
  const report = useStore((s) => s.report);
  const cross = useStore((s) => s.crossFilter);
  const version = useStore((s) => s.dataVersion);
  const paused = useStore((s) => s.paused);
  const pauseTick = useStore((s) => s.pauseTick);
  const ran = useRef<number | null>(null);
  const [st, setSt] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    if (paused && ran.current === pauseTick) return;
    ran.current = pauseTick;
    let live = true;
    setSt((s) => ({ ...s, loading: true }));
    fn().then((data) => live && setSt({ data, error: null, loading: false })).catch((e) => live && setSt({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, report.relationships, report.reportFilters, report.pages, report.measures, cross, version, paused, pauseTick, ...deps]);
  return st;
}

/* ------------------------------ decomposition tree ------------------------------ */

type Node = { key: string | null; value: number };
const ROW = 38, HEAD = 34, COL = 168, GAP = 44;

async function breakdown(v: Visual, measure: FieldRef, by: FieldRef, filters: Filter[]): Promise<Node[]> {
  const q = { ...v, type: 'table' as const, fields: { columns: [dim(by), measure] }, format: { ...v.format, sortBy: 1, sortDir: 'desc' as const } };
  const { items, rows } = await runVisualQuery(q, filters);
  return rows.map((r) => ({ key: r[items[0].alias] as string | null, value: Number(r[items[1].alias] ?? 0) })).filter((n) => Number.isFinite(n.value));
}

export function DecompositionTreeVisual({ v }: { v: Visual }) {
  const updateVisual = useStore((s) => s.updateVisual);
  const setCross = useStore((s) => s.setCross);
  const measure = v.fields.values?.[0];
  const explain = v.fields.explain ?? [];
  const path = (v.tree ?? []).filter((p) => p.dim < explain.length);
  const [menu, setMenu] = useState<{ level: number; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const st = useLive(async () => {
    if (!measure) return null;
    const total = await runVisualQuery({ ...v, type: 'card', fields: { values: [measure] } });
    const levels: Node[][] = [];
    const filters: Filter[] = [];
    for (const p of path) {
      levels.push(await breakdown(v, measure, explain[p.dim], filters));
      if (p.value === undefined) break;
      filters.push(asFilter(explain[p.dim], p.value));
    }
    return { total: Number(total.rows[0]?.[total.items[0]?.alias] ?? 0), levels };
  }, [v.fields, JSON.stringify(path)]);

  if (!measure) return <div className="vc-placeholder ai-hint">Aggiungere un campo in <b>Analizza</b> e uno o più campi in <b>Spiega per</b>.</div>;
  if (st.error) return <div className="vc-error"><b>Impossibile visualizzare l'oggetto visivo.</b><span>{st.error}</span></div>;
  const data = st.data;
  const used = new Set(path.map((p) => p.dim));
  const setPath = (p: typeof path) => updateVisual(v.id, { tree: p });
  const maxRows = Math.max(1, Math.floor((v.h - 70 - HEAD) / ROW));

  // Expand a node (level -1 = root) with a field, or with the field whose best/worst member is most extreme (AI split).
  const expand = async (level: number, choice: number | 'high' | 'low') => {
    setMenu(null);
    let d = choice;
    if (choice === 'high' || choice === 'low') {
      setBusy(true);
      try {
        const filters = path.slice(0, level + 1).map((p) => asFilter(explain[p.dim], p.value ?? null));
        let best = -1, score = choice === 'high' ? -Infinity : Infinity;
        for (let i = 0; i < explain.length; i++) {
          if (used.has(i) && !path.slice(level + 1).some((p) => p.dim === i)) continue;
          const nodes = await breakdown(v, measure, explain[i], filters);
          if (nodes.length < 2) continue;
          const x = choice === 'high' ? nodes[0].value : nodes[nodes.length - 1].value;
          if (choice === 'high' ? x > score : x < score) { score = x; best = i; }
        }
        d = best;
      } finally { setBusy(false); }
      if (d === -1) return;
    }
    setPath([...path.slice(0, level + 1), { dim: d as number }]);
  };
  const pick = (level: number, key: string | null) => {
    const same = path[level].value === key;
    setPath([...path.slice(0, level), { dim: path[level].dim, ...(same ? {} : { value: key }) }]);
    const f = explain[path[level].dim];
    setCross(same ? null : { visualId: v.id, table: f.table, column: f.column, value: key === null ? NULL_KEY : key });
  };

  // Geometry: column 0 = root, column i+1 = level i; connectors from the expanded node to its children.
  const nodeY = (i: number) => HEAD + i * ROW;
  const levelNodes = data?.levels ?? [];
  const expandedIdx = (l: number) => (l < 0 ? 0 : Math.max(0, levelNodes[l]?.findIndex((n) => n.key === path[l]?.value) ?? 0));
  const width = (levelNodes.length + 1) * (COL + GAP);
  const fmt = (x: number) => fmtAuto(x);
  const bar = (value: number, max: number, sel: boolean) => (
    <div className="dt-bar"><div style={{ width: `${max > 0 ? Math.max(1, (Math.max(0, value) / max) * 100) : 0}%`, background: sel ? PALETTE[0] : PALETTE[0] + '99' }} /></div>
  );
  const canExpand = used.size < explain.length;

  return (
    <div className="dt" style={{ opacity: st.loading || busy ? 0.6 : 1 }}>
      <div className="dt-canvas" style={{ width }}>
        <svg className="dt-lines" width={width} height={HEAD + maxRows * ROW + 20}>
          {levelNodes.map((nodes, l) => {
            const py = nodeY(expandedIdx(l - 1)) + ROW / 2 - 4;
            const px = l * (COL + GAP) + COL;
            return nodes.slice(0, maxRows).map((_, i) => (
              <path key={`${l}-${i}`} d={`M${px},${py} C${px + GAP / 2},${py} ${px + GAP / 2},${nodeY(i) + ROW / 2 - 4} ${px + GAP},${nodeY(i) + ROW / 2 - 4}`} fill="none" stroke="#C8C6C4" strokeWidth={path[l]?.value !== undefined && nodes[i].key === path[l].value ? 1.6 : 0.8} />
            ));
          })}
        </svg>
        <div className="dt-col" style={{ left: 0, width: COL }}>
          <div className="dt-head">{fieldLabel(measure)}</div>
          <div className="dt-node sel" style={{ top: HEAD }}>
            <div className="dt-lbl"><span>{fieldLabel(measure)}</span><b>{data ? fmt(data.total) : ''}</b></div>
            {bar(1, 1, true)}
            {canExpand && path.length === 0 && <button className="dt-plus" title="Espandi" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ level: -1, x: r.right, y: r.top }); }}>+</button>}
          </div>
        </div>
        {levelNodes.map((nodes, l) => {
          const max = Math.max(0, ...nodes.map((n) => n.value));
          const f = explain[path[l].dim];
          return (
            <div key={l} className="dt-col" style={{ left: (l + 1) * (COL + GAP), width: COL }}>
              <div className="dt-head" title={fieldLabel(f)}>
                <span>{f.column}</span>
                <button title="Rimuovi livello" onClick={() => setPath(path.slice(0, l))}>×</button>
              </div>
              {nodes.slice(0, maxRows).map((n, i) => {
                const sel = path[l].value !== undefined && n.key === path[l].value;
                return (
                  <div key={i} className={'dt-node' + (sel ? ' sel' : '')} style={{ top: nodeY(i) }} onClick={() => pick(l, n.key)}>
                    <div className="dt-lbl"><span>{label(n.key)}</span><b>{fmt(n.value)}</b></div>
                    {bar(n.value, max, sel)}
                    {sel && canExpand && path.length === l + 1 && <button className="dt-plus" title="Espandi" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ level: l, x: r.right, y: r.top }); }}>+</button>}
                  </div>
                );
              })}
              {nodes.length > maxRows && <div className="dt-more" style={{ top: nodeY(maxRows) }}>+{nodes.length - maxRows} altri</div>}
            </div>
          );
        })}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="hdr">Divisione IA</div>
          <button onClick={() => expand(menu.level, 'high')}>Valore alto</button>
          <button onClick={() => expand(menu.level, 'low')}>Valore basso</button>
          <hr />
          {explain.map((f, i) => (used.has(i) ? null : <button key={i} onClick={() => expand(menu.level, i)}>{fieldLabel(f)}</button>))}
        </Menu>
      )}
    </div>
  );
}

/* ------------------------------ key influencers ------------------------------ */

interface Group { key: string | null; n: number; mean: number; sd: number; hits?: number }
interface Influencer { field: number; key: string | null; text: string; effect: number; n: number; score: number; groups: Group[]; overall: number }

/** Numeric "spiega per" fields with many values are split into 5 equal-count ranges (like Power BI). */
function binned(groups: Group[], numeric: boolean): Group[] {
  if (!numeric || groups.length <= 8) return groups;
  const sorted = [...groups].sort((a, b) => Number(a.key) - Number(b.key));
  const total = sorted.reduce((a, g) => a + g.n, 0);
  const out: Group[] = [];
  let cur: Group[] = [], acc = 0;
  const flush = () => {
    if (!cur.length) return;
    const n = cur.reduce((a, g) => a + g.n, 0);
    const mean = cur.reduce((a, g) => a + g.n * g.mean, 0) / (n || 1);
    const ss = cur.reduce((a, g) => a + (g.n - 1) * g.sd * g.sd + g.n * (g.mean - mean) ** 2, 0);
    const hits = cur.reduce((a, g) => a + (g.hits ?? 0), 0);
    const lo = fmtAuto(Number(cur[0].key)), hi = fmtAuto(Number(cur[cur.length - 1].key));
    out.push({ key: lo === hi ? lo : `${lo} - ${hi}`, n, mean, sd: Math.sqrt(ss / Math.max(1, n - 1)), hits });
    cur = [];
  };
  for (const g of sorted) { cur.push(g); acc += g.n; if (acc >= ((out.length + 1) * total) / 5) flush(); }
  flush();
  return out;
}

/* Top segments: a small regression/classification tree over the "Spiega per" factors. */
interface Combo { keys: (string | null)[]; n: number; s: number; ss: number }
interface Cond { f: number; op: 'eq' | 'ne' | 'le' | 'gt'; key?: string | null; t?: number }
interface Segment { conds: Cond[]; n: number; mean: number; z: number }

const statsOf = (rows: Combo[]) => rows.reduce((a, r) => ({ n: a.n + r.n, s: a.s + r.s, ss: a.ss + r.ss }), { n: 0, s: 0, ss: 0 });
const sseOf = (x: { n: number; s: number; ss: number }) => (x.n ? x.ss - (x.s * x.s) / x.n : 0);

/** Equal-count cut points (≤ 4) of a numeric factor, weighted by rows. */
function cuts(rows: Combo[], f: number): number[] {
  const vals = rows.map((r) => ({ x: Number(r.keys[f]), n: r.n })).filter((x) => Number.isFinite(x.x)).sort((a, b) => a.x - b.x);
  const total = vals.reduce((a, x) => a + x.n, 0);
  const out: number[] = [];
  let acc = 0;
  for (const v of vals) { acc += v.n; if (acc >= ((out.length + 1) * total) / 5 && out.length < 4 && v.x !== out[out.length - 1]) out.push(v.x); }
  return out.filter((x, i) => i < out.length - 1 || x < vals[vals.length - 1]?.x);
}

/** Greedy tree (depth ≤ 3): splits maximizing the variance reduction, leaves = candidate segments. */
function grow(rows: Combo[], numeric: boolean[], minSize: number): { conds: Cond[]; rows: Combo[] }[] {
  const edges = numeric.map((isNum, f) => (isNum ? cuts(rows, f) : []));
  const leaves: { conds: Cond[]; rows: Combo[] }[] = [];
  const rec = (part: Combo[], conds: Cond[], depth: number) => {
    const all = statsOf(part);
    let best: { gain: number; l: Combo[]; r: Combo[]; lc: Cond; rc: Cond } | null = null;
    if (depth < 3 && all.n >= 2 * minSize) {
      numeric.forEach((isNum, f) => {
        const tests: [Cond, Cond, (c: Combo) => boolean][] = isNum
          ? edges[f].map((t) => [{ f, op: 'le', t }, { f, op: 'gt', t }, (c: Combo) => Number(c.keys[f]) <= t])
          : [...new Set(part.map((c) => c.keys[f]))].slice(0, 40).map((key) => [{ f, op: 'eq', key }, { f, op: 'ne', key }, (c: Combo) => c.keys[f] === key]);
        for (const [lc, rc, inL] of tests) {
          const l = part.filter(inL), r = part.filter((c) => !inL(c));
          const ls = statsOf(l), rs = statsOf(r);
          if (ls.n < minSize || rs.n < minSize) continue;
          const gain = sseOf(all) - sseOf(ls) - sseOf(rs);
          if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, l, r, lc, rc };
        }
      });
    }
    if (!best) { leaves.push({ conds, rows: part }); return; }
    const b = best as { l: Combo[]; r: Combo[]; lc: Cond; rc: Cond };
    rec(b.l, [...conds, b.lc], depth + 1);
    rec(b.r, [...conds, b.rc], depth + 1);
  };
  rec(rows, [], 0);
  return leaves;
}

/** Conditions of a segment, merged per factor ("Prezzo > 10 e ≤ 50", "Paese non è A, B"). */
function condText(conds: Cond[], explain: FieldRef[]): string[] {
  const out: string[] = [];
  const byF = new Map<number, Cond[]>();
  for (const c of conds) (byF.get(c.f) ?? byF.set(c.f, []).get(c.f)!).push(c);
  for (const [f, cs] of byF) {
    const name = explain[f].column;
    const eq = cs.find((c) => c.op === 'eq');
    if (eq) { out.push(`${name} è ${label(eq.key)}`); continue; }
    const ne = cs.filter((c) => c.op === 'ne').map((c) => label(c.key));
    if (ne.length) out.push(`${name} non è ${ne.join(', ')}`);
    const lo = Math.max(...cs.filter((c) => c.op === 'gt').map((c) => c.t!), -Infinity), hi = Math.min(...cs.filter((c) => c.op === 'le').map((c) => c.t!), Infinity);
    if (lo > -Infinity && hi < Infinity) out.push(`${name} è compreso tra ${fmtAuto(lo)} (escluso) e ${fmtAuto(hi)}`);
    else if (lo > -Infinity) out.push(`${name} è maggiore di ${fmtAuto(lo)}`);
    else if (hi < Infinity) out.push(`${name} è minore o uguale a ${fmtAuto(hi)}`);
  }
  return out;
}

function TopSegments({ v, target, explain, numericTarget, targetValue, dir, tLabel }: {
  v: Visual; target: FieldRef; explain: FieldRef[]; numericTarget: boolean; targetValue?: string; dir: 'up' | 'down'; tLabel: string;
}) {
  const updateVisual = useStore((s) => s.updateVisual);
  const tables = useStore((s) => s.tables);
  const colType = (f: FieldRef) => tables.find((t) => t.name === f.table)?.columns.find((c) => c.name === f.column);
  // The analyzed column itself is never a factor (it would explain itself).
  const factors = useMemo(() => explain.filter((f) => !(f.table === target.table && f.column === target.column)).slice(0, 5), [JSON.stringify(explain), target.table, target.column]);
  const st = useLive(async () => {
    if ((!numericTarget && targetValue === undefined) || !factors.length) return null;
    const dims = factors.map(dim);
    const col = dim(target);
    // One row per combination of factor values, with the target's count/sum/sum of squares.
    const q = (fields: FieldRef[], extra: Filter[] = []) => runVisualQuery({ ...v, type: 'pythonVisual', fields: { values: [...dims, ...fields] }, format: { ...v.format, sortBy: undefined } }, extra);
    const key = (r: Record<string, any>, items: { alias: string }[]) => JSON.stringify(dims.map((_, i) => r[items[i].alias] ?? null));
    let combos: Combo[];
    if (!numericTarget) {
      const cnt = { ...col, agg: 'count' as const };
      const [all, hit] = await Promise.all([q([cnt]), q([cnt], [asFilter(col, targetValue!)])]);
      const hits = new Map(hit.rows.map((r) => [key(r, hit.items), Number(r[hit.items[dims.length].alias] ?? 0)]));
      combos = all.rows.map((r) => { const h = hits.get(key(r, all.items)) ?? 0; return { keys: dims.map((_, i) => r[all.items[i].alias] ?? null), n: Number(r[all.items[dims.length].alias] ?? 0), s: h, ss: h }; });
    } else if (target.agg === 'measure') {
      const r0 = await q([target, { ...dims[0], agg: 'count' }]);
      combos = r0.rows.map((r) => { const n = Number(r[r0.items[dims.length + 1].alias] ?? 0), m = Number(r[r0.items[dims.length].alias] ?? 0); return { keys: dims.map((_, i) => r[r0.items[i].alias] ?? null), n, s: m * n, ss: m * m * n }; });
    } else {
      const r0 = await q([{ ...col, agg: 'avg' }, { ...col, agg: 'count' }, { ...col, agg: 'stdev' }]);
      combos = r0.rows.map((r) => {
        const a = Number(r[r0.items[dims.length].alias] ?? 0), n = Number(r[r0.items[dims.length + 1].alias] ?? 0), sd = Number(r[r0.items[dims.length + 2].alias] ?? 0);
        return { keys: dims.map((_, i) => r[r0.items[i].alias] ?? null), n, s: a * n, ss: sd * sd * Math.max(0, n - 1) + n * a * a };
      });
    }
    combos = combos.filter((c) => c.n > 0);
    const tot = statsOf(combos);
    if (!tot.n) return { segments: [] as Segment[], overall: 0, N: 0 };
    const overall = tot.s / tot.n;
    const sign = numericTarget && dir === 'down' ? -1 : 1;
    const minSize = Math.max(5, Math.ceil(tot.n * 0.03));
    const leaves = grow(combos, factors.map((f) => isNumeric(colType(f))), minSize);
    const segments: Segment[] = [];
    for (const l of leaves) {
      const x = statsOf(l.rows), rest = { n: tot.n - x.n, s: tot.s - x.s, ss: tot.ss - x.ss };
      if (!rest.n) continue;
      const m = x.s / x.n, rm = rest.s / rest.n;
      const va = Math.max(0, sseOf(x) / Math.max(1, x.n - 1)), vb = Math.max(0, sseOf(rest) / Math.max(1, rest.n - 1));
      const se = Math.sqrt(va / x.n + vb / rest.n);
      const z = se > 0 ? ((m - rm) / se) * sign : (m - rm) * sign > 0 ? 3 : 0;
      if (z >= 1.96) segments.push({ conds: l.conds, n: x.n, mean: m, z });
    }
    segments.sort((a, b) => (b.mean - a.mean) * sign);
    return { segments: segments.slice(0, 10), overall, N: tot.n };
  }, [target.table, target.column, target.agg, JSON.stringify(factors), targetValue, dir, numericTarget]);

  if (st.error) return <div className="ki-empty">{st.error}</div>;
  const d = st.data;
  const segs = d?.segments ?? [];
  const metric = (x: number) => (numericTarget ? fmtAuto(x) : (x * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) + '%');
  const selIdx = /^seg:(\d+)$/.exec(v.ki?.selected ?? '')?.[1];
  const sel = selIdx !== undefined ? segs[+selIdx] : undefined;
  const pick = (i: number | null) => updateVisual(v.id, { ki: { ...v.ki, tab: 'segments', selected: i === null ? undefined : `seg:${i}` } });
  if (!segs.length) return <div className="ki-empty" style={{ opacity: st.loading ? 0.6 : 1 }}>{st.loading ? 'Ricerca dei segmenti…' : !factors.length ? 'Aggiungere in Spiega per un campo diverso da quello analizzato.' : numericTarget
          ? `Nessun segmento con ${tLabel} significativamente ${dir === 'down' ? 'più basso' : 'più alto'} della media.`
          : `Nessun segmento in cui ${tLabel} è significativamente più spesso ${targetValue}.`}</div>;
  if (sel) {
    const diff = sel.mean - d!.overall;
    return (
      <div className="ki-seg" style={{ opacity: st.loading ? 0.6 : 1 }}>
        <button className="ki-back" onClick={() => pick(null)}>← Segmenti principali</button>
        <div className="ki-dtitle"><b>Segmento {+selIdx! + 1}</b></div>
        <div className="ki-dtitle">
          {numericTarget
            ? <>{target.agg === 'measure' ? tLabel : target.column} {target.agg === 'measure' ? 'è in media' : 'medio è'} <b>{metric(sel.mean)}</b>, {diff >= 0 ? <><b>{metric(diff)}</b> in più</> : <><b>{metric(-diff)}</b> in meno</>} rispetto alla media complessiva ({metric(d!.overall)}).</>
            : <>{tLabel} è <b>{targetValue}</b> nel <b>{metric(sel.mean)}</b> dei casi (media complessiva {metric(d!.overall)}).</>}
        </div>
        <div className="ki-dtitle">Il segmento contiene <b>{sel.n.toLocaleString(locale())}</b> {target.agg === 'measure' ? 'righe' : 'record'} ({((sel.n / d!.N) * 100).toLocaleString(locale(), { maximumFractionDigits: 1 })}% dei dati).</div>
        <div className="ki-conds"><div className="hdr">Caratteristiche del segmento</div>{condText(sel.conds, factors).map((t, i) => <div key={i} className="ki-cond">{t}</div>)}</div>
      </div>
    );
  }
  // Bubbles: height = value of the segment, size = population (like Power BI's segment chart).
  const W = 100, H = 100;
  const vals = [...segs.map((x) => x.mean), d!.overall];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const maxN = Math.max(...segs.map((x) => x.n));
  const y = (m: number) => H - 12 - ((m - lo) / span) * (H - 24);
  return (
    <div className="ki-segs" style={{ opacity: st.loading ? 0.6 : 1 }}>
      <div className="ki-dtitle">Segmenti in cui {numericTarget ? <>{tLabel} {dir === 'up' ? 'è più alto' : 'è più basso'}</> : <>{tLabel} è più probabilmente <b>{targetValue}</b></>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ki-bubbles">
        <line x1="0" x2={W} y1={y(d!.overall)} y2={y(d!.overall)} stroke="#252423" strokeDasharray="1.5 1.5" strokeWidth="0.3" />
      </svg>
      <div className="ki-bubble-layer">
        {segs.map((x, i) => {
          const r = 16 + 20 * Math.sqrt(x.n / maxN);
          return (
            <div key={i} className="ki-bubble" title={condText(x.conds, factors).join(' e ')} onClick={() => pick(i)}
              style={{ left: `${((i + 0.5) / segs.length) * 100}%`, top: `${y(x.mean)}%`, width: r * 2, height: r * 2 }}>
              <b>{metric(x.mean)}</b><span>Segmento {i + 1}</span>
            </div>
          );
        })}
      </div>
      <div className="ki-note">Linea tratteggiata: {numericTarget ? 'media' : 'percentuale'} complessiva ({metric(d!.overall)}). Dimensione della bolla: numero di record. Fare clic su un segmento per i dettagli.</div>
    </div>
  );
}

export function KeyInfluencersVisual({ v }: { v: Visual }) {
  const updateVisual = useStore((s) => s.updateVisual);
  const tables = useStore((s) => s.tables);
  const target = v.fields.target?.[0];
  const explain = v.fields.explain ?? [];
  const colType = (f: FieldRef) => tables.find((t) => t.name === f.table)?.columns.find((c) => c.name === f.column);
  // Numeric target (a numeric column or a measure): what makes it increase/decrease; otherwise: what makes it be <value>.
  const numericTarget = !!target && (target.agg === 'measure' || (target.agg !== 'none' && target.agg !== 'count' && target.agg !== 'countd') || isNumeric(colType(target)));
  const ki = v.ki ?? {};
  const dir = ki.dir ?? 'up';

  const values = useLive(async () => {
    if (!target || numericTarget) return [] as string[];
    const r = await runVisualQuery({ ...v, type: 'table', fields: { columns: [dim(target)] }, format: { ...v.format, sortBy: undefined } });
    return r.rows.map((x) => x[r.items[0].alias] as string).filter((x) => x !== null);
  }, [target?.table, target?.column, numericTarget]);
  const targetValue = numericTarget ? undefined : ki.target ?? values.data?.[0];

  const st = useLive(async () => {
    if (!target || !explain.length || (!numericTarget && targetValue === undefined)) return null;
    const out: Influencer[] = [];
    const col = dim(target);
    // Overall statistics.
    const statFields: FieldRef[] = target.agg === 'measure' ? [target] : [{ ...col, agg: 'avg' }, { ...col, agg: 'count' }, { ...col, agg: 'stdev' }];
    let overallN = 0, overallMean = 0, overallSd = 0;
    if (numericTarget) {
      const o = await runVisualQuery({ ...v, type: 'card', fields: { values: statFields } });
      const r = o.rows[0] ?? {};
      overallMean = Number(r[o.items[0].alias] ?? 0);
      overallN = target.agg === 'measure' ? 1 : Number(r[o.items[1].alias] ?? 0);
      overallSd = target.agg === 'measure' ? 0 : Number(r[o.items[2].alias] ?? 0);
    }
    for (let fi = 0; fi < explain.length; fi++) {
      const by = dim(explain[fi]);
      if (by.table === target.table && by.column === target.column) continue;
      let groups: Group[];
      if (numericTarget) {
        const r = await runVisualQuery({ ...v, type: 'table', fields: { columns: [by, ...statFields, ...(target.agg === 'measure' ? [{ ...by, agg: 'count' as const }] : [])] }, format: { ...v.format, sortBy: undefined } });
        const a = r.items.map((i) => i.alias);
        groups = r.rows.map((x) => target.agg === 'measure'
          ? { key: x[a[0]], mean: Number(x[a[1]] ?? 0), n: Number(x[a[2]] ?? 0), sd: 0 }
          : { key: x[a[0]], mean: Number(x[a[1]] ?? 0), n: Number(x[a[2]] ?? 0), sd: Number(x[a[3]] ?? 0) });
      } else {
        const cnt = { ...col, agg: 'count' as const };
        const all = await runVisualQuery({ ...v, type: 'table', fields: { columns: [by, cnt] }, format: { ...v.format, sortBy: undefined } });
        const hit = await runVisualQuery({ ...v, type: 'table', fields: { columns: [by, cnt] }, format: { ...v.format, sortBy: undefined } }, [asFilter(col, targetValue!)]);
        const hits = new Map(hit.rows.map((x) => [x[hit.items[0].alias], Number(x[hit.items[1].alias] ?? 0)]));
        groups = all.rows.map((x) => { const n = Number(x[all.items[1].alias] ?? 0); const h = hits.get(x[all.items[0].alias]) ?? 0; return { key: x[all.items[0].alias], n, hits: h, mean: n ? h / n : 0, sd: 0 }; });
      }
      groups = binned(groups.filter((g) => g.n > 0), isNumeric(colType(by)));
      const N = groups.reduce((a, g) => a + g.n, 0);
      if (!numericTarget) { const H = groups.reduce((a, g) => a + (g.hits ?? 0), 0); overallMean = N ? H / N : 0; }
      const M = numericTarget && target.agg !== 'measure' ? overallMean : groups.reduce((a, g) => a + g.n * g.mean, 0) / (N || 1);
      for (const g of groups) {
        const nr = N - g.n;
        if (nr <= 0 || g.n < 2) continue;
        let effect: number, score: number;
        if (numericTarget) {
          const restMean = (N * M - g.n * g.mean) / nr;
          effect = g.mean - restMean;
          // Welch-style statistic (measures: no row variance → rank by effect × √n).
          const se = target.agg === 'measure' ? 0 : Math.sqrt((g.sd * g.sd) / g.n + (overallSd * overallSd) / nr);
          score = se > 0 ? effect / se : (effect / (Math.abs(M) || 1)) * Math.sqrt(g.n) * 3;
          if (dir === 'down') { effect = -effect; score = -score; }
        } else {
          const H = groups.reduce((a, x) => a + (x.hits ?? 0), 0);
          const pr = (H - (g.hits ?? 0)) / nr;
          const p = (g.hits ?? 0) / g.n;
          const pool = H / N;
          const se = Math.sqrt(pool * (1 - pool) * (1 / g.n + 1 / nr));
          effect = pr > 0 ? p / pr : p > 0 ? Infinity : 0;
          score = se > 0 ? (p - pr) / se : 0;
        }
        if (score >= 1.96 && (numericTarget ? effect > 0 : effect > 1)) {
          out.push({ field: fi, key: g.key, effect, n: g.n, score, groups, overall: numericTarget ? M : overallMean,
            text: `${explain[fi].column} è ${label(g.key)}` });
        }
      }
    }
    out.sort((a, b) => b.score - a.score);
    return { list: out.slice(0, 20), N: overallN };
  }, [target?.table, target?.column, target?.agg, JSON.stringify(explain), targetValue, dir, numericTarget]);

  if (!target || !explain.length) return <div className="vc-placeholder ai-hint">Aggiungere il campo da analizzare in <b>Analizza</b> e i fattori in <b>Spiega per</b>.</div>;
  if (st.error || values.error) return <div className="vc-error"><b>Impossibile visualizzare l'oggetto visivo.</b><span>{st.error ?? values.error}</span></div>;
  const list = st.data?.list ?? [];
  const selKey = ki.selected;
  const sel = list.find((x) => `${x.field}\u0001${x.key}` === selKey) ?? list[0];
  const set = (patch: NonNullable<Visual['ki']>) => updateVisual(v.id, { ki: { ...ki, ...patch } });
  const tLabel = numericTarget ? fieldLabel(target) : target.column;
  const metric = (x: number) => (numericTarget ? fmtAuto(x) : (x * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) + '%');
  const effectText = (x: Influencer) => (numericTarget ? `${dir === 'up' ? '+' : '-'}${fmtAuto(x.effect)}` : `${x.effect === Infinity ? '∞' : x.effect.toLocaleString(locale(), { maximumFractionDigits: 2 })}x`);
  const maxEffect = Math.max(1e-9, ...list.map((x) => (x.effect === Infinity ? 0 : x.effect)));

  const tab = ki.tab ?? 'influencers';
  return (
    <div className="ki" style={{ opacity: st.loading && tab === 'influencers' ? 0.6 : 1 }}>
      <div className="ki-tabs">
        <button className={tab === 'influencers' ? 'active' : ''} onClick={() => set({ tab: 'influencers' })}>Influenzatori chiave</button>
        <button className={tab === 'segments' ? 'active' : ''} onClick={() => set({ tab: 'segments', selected: undefined })}>Segmenti principali</button>
      </div>
      <div className="ki-head">
        Che cosa influenza <b>{tLabel}</b> a{' '}
        {numericTarget ? (
          <select value={dir} onChange={(e) => set({ dir: e.target.value as 'up' | 'down', selected: undefined })}><option value="up">Aumentare</option><option value="down">Diminuire</option></select>
        ) : (
          <>essere <select value={targetValue ?? ''} onChange={(e) => set({ target: e.target.value, selected: undefined })}>{(values.data ?? []).map((x) => <option key={x} value={x}>{x}</option>)}</select></>
        )}
        ?
      </div>
      {tab === 'segments' ? <div className="ki-body"><TopSegments v={v} target={target} explain={explain} numericTarget={numericTarget} targetValue={targetValue} dir={dir} tLabel={tLabel} /></div> : <div className="ki-body">
        <div className="ki-list">
          {!st.loading && !list.length && <div className="ki-empty">Nessun fattore influenza in modo significativo {tLabel}.</div>}
          {list.map((x) => {
            const k = `${x.field}\u0001${x.key}`;
            return (
              <div key={k} className={'ki-item' + (sel === x ? ' sel' : '')} onClick={() => set({ selected: k })}>
                <div className="ki-txt">Quando <b>{x.text}</b></div>
                <div className="ki-eff"><div style={{ width: `${Math.max(8, ((x.effect === Infinity ? maxEffect : x.effect) / maxEffect) * 100)}%` }} /><span>{effectText(x)}</span></div>
              </div>
            );
          })}
        </div>
        <div className="ki-detail">
          {sel && (() => {
            const f = explain[sel.field];
            const gmax = Math.max(1e-9, ...sel.groups.map((g) => Math.abs(g.mean)), Math.abs(sel.overall));
            return <>
              <div className="ki-dtitle">
                {numericTarget
                  ? <>In media, quando <b>{sel.text}</b>, {tLabel} {dir === 'up' ? 'aumenta' : 'diminuisce'} di <b>{fmtAuto(sel.effect)}</b> rispetto agli altri valori di {f.column}.</>
                  : <>La probabilità che {tLabel} sia <b>{targetValue}</b> è <b>{effectText(sel)}</b> più alta quando <b>{sel.text}</b>.</>}
              </div>
              <div className="ki-bars">
                {sel.groups.slice(0, 15).map((g, i) => (
                  <div key={i} className={'ki-bar' + (g.key === sel.key ? ' sel' : '')}>
                    <span className="k" title={label(g.key)}>{label(g.key)}</span>
                    <span className="b"><span style={{ width: `${(Math.abs(g.mean) / gmax) * 100}%` }} /><i style={{ left: `${(Math.abs(sel.overall) / gmax) * 100}%` }} /></span>
                    <span className="v">{metric(g.mean)}</span>
                  </div>
                ))}
              </div>
              <div className="ki-note">Linea tratteggiata: {numericTarget ? 'media' : 'percentuale'} complessiva ({metric(sel.overall)}).</div>
            </>;
          })()}
        </div>
      </div>}
    </div>
  );
}

/* ------------------------------ smart narrative ------------------------------ */

const TIME = /\b(anno|anni|year|mese|month|data|date|giorno|day|trimestre|quarter|settimana|week|periodo|period)\b/i;

/** Sentences describing one visual's data (totals, best/worst categories, trends). */
async function describe(v: Visual): Promise<string[]> {
  const cat = v.fields.category?.[0] ?? v.fields.rows?.[0] ?? v.fields.details?.[0];
  const val = v.fields.values?.[0] ?? v.fields.y?.[0];
  if (!val) return [];
  const m = fieldLabel(val);
  const fmt = (x: number) => `<b>${fmtAuto(x)}</b>`;
  if (!cat) {
    const r = await runVisualQuery({ ...v, type: 'card', fields: { values: [val] } });
    const x = Number(r.rows[0]?.[r.items[0]?.alias]);
    return Number.isFinite(x) ? [`${m} è pari a ${fmt(x)}.`] : [];
  }
  const r = await runVisualQuery({ ...v, type: 'table', fields: { columns: [dim(cat), val] }, format: { ...v.format, sortBy: undefined } });
  const rows = r.rows.map((x) => ({ k: label(x[r.items[0].alias]), y: Number(x[r.items[1].alias]) })).filter((x) => Number.isFinite(x.y));
  if (rows.length < 2) return [];
  const out: string[] = [];
  const total = rows.reduce((a, x) => a + x.y, 0);
  const additive = val.agg === 'sum' || val.agg === 'count' || val.agg === 'countd' || val.agg === 'measure';
  const sorted = [...rows].sort((a, b) => b.y - a.y);
  const share = (x: number) => (total ? ((x / total) * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) + '%' : '');
  if (TIME.test(cat.column) || rows.every((x) => /^\d{4}(-\d\d){0,2}/.test(x.k))) {
    const first = rows[0], last = rows[rows.length - 1];
    const ch = first.y ? ((last.y - first.y) / Math.abs(first.y)) * 100 : 0;
    out.push(`${m} è ${ch >= 0 ? 'aumentato' : 'diminuito'} del <b>${Math.abs(ch).toLocaleString(locale(), { maximumFractionDigits: 1 })}%</b> tra <b>${first.k}</b> e <b>${last.k}</b> (da ${fmt(first.y)} a ${fmt(last.y)}).`);
    out.push(`Il valore più alto è stato registrato in <b>${sorted[0].k}</b> (${fmt(sorted[0].y)}), il più basso in <b>${sorted[sorted.length - 1].k}</b> (${fmt(sorted[sorted.length - 1].y)}).`);
  } else {
    out.push(`<b>${sorted[0].k}</b> ha il valore più alto di ${m} (${fmt(sorted[0].y)}${additive ? `, il ${share(sorted[0].y)} del totale` : ''}), seguito da <b>${sorted[1].k}</b> (${fmt(sorted[1].y)}).`);
    out.push(`<b>${sorted[sorted.length - 1].k}</b> ha il valore più basso (${fmt(sorted[sorted.length - 1].y)}).`);
    if (additive) {
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.2)));
      out.push(`${m} complessivo è ${fmt(total)} su ${rows.length} valori di ${cat.column}; i primi ${top.length} ne rappresentano il <b>${share(top.reduce((a, x) => a + x.y, 0))}</b>.`);
    }
  }
  return out;
}

/** Dynamic value token of an edited narrative: {{Tabella[Colonna]:sum}} or {{Tabella[Misura]}}. */
const TOKEN = /\{\{([^\[\]{}]+)\[([^\]{}]+)\](?::(\w+))?\}\}/g;
const tokenField = (t: string, c: string, agg?: string): FieldRef => ({ table: t.trim(), column: c, agg: (agg as FieldRef['agg']) ?? 'measure' });
export const tokenOf = (f: FieldRef) => `{{${f.table}[${f.column}]${f.agg === 'measure' ? '' : ':' + f.agg}}}`;

/** Generated sentences → editable text (bold kept as **…**). */
const toEditable = (blocks: { lines: string[] }[]) => blocks.map((b) => b.lines.join(' ').replace(/<\/?b>/g, '**')).join('\n\n');

export function SmartNarrativeVisual({ v, selected }: { v: Visual; selected?: boolean }) {
  const pages = useStore((s) => s.report.pages);
  const tables = useStore((s) => s.tables);
  const measures = useStore((s) => s.report.measures);
  const updateVisual = useStore((s) => s.updateVisual);
  const [editing, setEditing] = useState<string | null>(null);
  const page = pages.find((p) => p.visuals.some((x) => x.id === v.id));
  const others = useMemo(() => (page?.visuals ?? []).filter((x) => x.id !== v.id && !['decompositionTree', 'keyInfluencers', 'smartNarrative', 'slicer'].includes(x.type)
    && Object.values(x.fields).some((f) => f.length)), [page]);
  const custom = v.narrative;
  const st = useLive(async () => {
    if (custom !== undefined) return [];
    const out: { title: string; lines: string[] }[] = [];
    for (const o of others) {
      try { const lines = await describe(o); if (lines.length) out.push({ title: o.format.titleText || autoTitle(o), lines }); } catch { /* skip visuals that fail */ }
    }
    return out;
  }, [others, custom]);
  // Dynamic values of the edited text, evaluated with the visual's filters like any visual.
  const tokens = useMemo(() => [...new Set([...(custom ?? '').matchAll(TOKEN)].map((m) => m[0]))], [custom]);
  const vals = useLive(async () => {
    const out: Record<string, string> = {};
    for (const t of tokens) {
      const [, tb, col, agg] = /\{\{([^\[\]{}]+)\[([^\]{}]+)\](?::(\w+))?\}\}/.exec(t)!;
      try {
        const f = tokenField(tb, col, agg);
        const r = await runVisualQuery({ ...v, type: 'card', fields: { values: [f] } });
        const x = r.rows[0]?.[r.items[0]?.alias];
        const pct = f.agg === 'measure' && measures.find((m) => m.name === f.column)?.formatString?.includes('%');
        out[t] = typeof x === 'number' || (x !== null && x !== undefined && !isNaN(Number(x))) ? (pct ? (Number(x) * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) + '%' : fmtAuto(Number(x))) : label(x);
      } catch { out[t] = '(errore)'; }
    }
    return out;
  }, [tokens.join('|')]);

  const fields = useMemo(() => [
    ...measures.map((m) => ({ label: m.name, f: { table: m.table, column: m.name, agg: 'measure' as const } })),
    ...tables.flatMap((t) => t.columns.filter((c) => isNumeric(c)).map((c) => ({ label: `Somma di ${c.name} (${t.name})`, f: { table: t.name, column: c.name, agg: 'sum' as const } }))),
  ], [measures, tables]);
  const insert = (i: number) => {
    const ta = document.getElementById('sn-edit-' + v.id) as HTMLTextAreaElement | null;
    const tok = tokenOf(fields[i].f);
    const text = editing ?? '';
    const at = ta ? ta.selectionStart : text.length;
    setEditing(text.slice(0, at) + tok + text.slice(at));
  };

  if (editing !== null) {
    return (
      <div className="sn sn-editing" onMouseDown={(e) => e.stopPropagation()}>
        <textarea id={'sn-edit-' + v.id} value={editing} onChange={(e) => setEditing(e.target.value)} />
        <div className="sn-tools">
          <select value="" onChange={(e) => e.target.value !== '' && insert(+e.target.value)}>
            <option value="">+ Valore</option>
            {fields.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
          </select>
          <span className="sn-help">**grassetto** · valori dinamici tra {'{{ }}'}</span>
          <button className="btn" onClick={() => setEditing(null)}>Annulla</button>
          <button className="btn primary" onClick={() => { updateVisual(v.id, { narrative: editing }); setEditing(null); }}>Fine</button>
        </div>
      </div>
    );
  }
  const toolbar = selected && (
    <div className="sn-bar" onMouseDown={(e) => e.stopPropagation()}>
      <button onClick={() => setEditing(custom ?? toEditable(st.data ?? []))}>Modifica</button>
      {custom !== undefined && <button onClick={() => updateVisual(v.id, { narrative: undefined })} title="Torna al riepilogo automatico">Rigenera</button>}
    </div>
  );
  if (custom !== undefined) {
    // Tokens become placeholders, the text is escaped, **bold** applied, then the (escaped) values put back highlighted.
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = (para: string) => {
      const found: string[] = [];
      const body = esc(para.replace(TOKEN, (t) => `\u0002${found.push(t) - 1}\u0003`)).replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
      return body.replace(/\u0002(\d+)\u0003/g, (_m, i) => `<b class="sn-val">${esc(vals.data?.[found[+i]] ?? '…')}</b>`);
    };
    return (
      <div className="sn" style={{ opacity: vals.loading ? 0.6 : 1 }}>
        {toolbar}
        {custom.split(/\n{2,}/).map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: html(p).replace(/\n/g, '<br/>') }} />)}
      </div>
    );
  }
  if (!others.length) return <div className="vc-placeholder ai-hint">{toolbar}La narrazione intelligente riassume gli oggetti visivi della pagina: aggiungerne qualcuno.</div>;
  return (
    <div className="sn" style={{ opacity: st.loading ? 0.6 : 1 }}>
      {toolbar}
      {(st.data ?? []).map((b, i) => (
        <p key={i}>{b.lines.map((l, k) => <span key={k} dangerouslySetInnerHTML={{ __html: escapeKeepB(l) + ' ' }} />)}</p>
      ))}
      {st.data && !st.data.length && !st.loading && <p>Nessun dato da riassumere.</p>}
    </div>
  );
}

/** The sentences only contain <b> markup we add; everything else (data values) is escaped. */
function escapeKeepB(s: string) {
  return s.split(/(<\/?b>)/).map((p) => (p === '<b>' || p === '</b>' ? p : p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))).join('');
}
