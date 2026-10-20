import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api';
import type { CrossFilter, Visual } from '../types';
import type { VisualData } from './useVisualData';
import { fieldLabel, fmtAuto, fmtFull, fmtPct, fmtWith, locale } from '../format';
import { NULL_KEY, type QueryItem } from '../query';
import { useStore } from '../store';
import { cellFormat, cfInput, fieldKey, rangeOf, type Range } from './condfmt';
import { font, pt, sp, units } from './pbistyle';

const cell = (v: unknown, measure: boolean) => (measure ? fmtFull(v) : v === null || v === undefined ? '' : String(v));
const toKey = (v: string | null) => (v === null ? NULL_KEY : v);

/** Table/matrix look from the Power BI objects (column/row headers, values with banding, totals, grid). */
function tableVars(v: Visual): CSSProperties {
  const g = (o: string, p: string) => sp(v, o, p);
  const vars: Record<string, string | undefined> = {
    '--t-size': pt(g('values', 'fontSize') ?? g('grid', 'textSize'))?.toString(),
    '--t-font': font(g('values', 'fontFamily')),
    '--th-bg': g('columnHeaders', 'backColor'), '--th-fg': g('columnHeaders', 'fontColor'),
    '--th-size': pt(g('columnHeaders', 'fontSize'))?.toString(), '--th-font': font(g('columnHeaders', 'fontFamily')),
    '--td-bg1': g('values', 'backColorPrimary') ?? g('values', 'backColor'), '--td-fg1': g('values', 'fontColorPrimary') ?? g('values', 'fontColor'),
    '--td-bg2': g('values', 'backColorSecondary') ?? g('values', 'backColorPrimary') ?? g('values', 'backColor'),
    '--td-fg2': g('values', 'fontColorSecondary') ?? g('values', 'fontColorPrimary') ?? g('values', 'fontColor'),
    '--rh-bg': g('rowHeaders', 'backColor'), '--rh-fg': g('rowHeaders', 'fontColor'),
    '--tot-bg': g('total', 'backColor') ?? g('subTotals', 'backColor'), '--tot-fg': g('total', 'fontColor') ?? g('subTotals', 'fontColor'),
    '--td-pad': typeof g('grid', 'rowPadding') === 'number' ? g('grid', 'rowPadding') + 'px' : undefined,
    '--grid-h': g('grid', 'gridHorizontal') ? `${g('grid', 'gridHorizontalWeight') ?? 1}px solid ${g('grid', 'gridHorizontalColor') ?? '#E1DFDD'}` : undefined,
    '--grid-v': g('grid', 'gridVertical') ? `${g('grid', 'gridVerticalWeight') ?? 1}px solid ${g('grid', 'gridVerticalColor') ?? '#E1DFDD'}` : undefined,
  };
  for (const k of ['--t-size', '--th-size']) if (vars[k]) vars[k] += 'px';
  return Object.fromEntries(Object.entries(vars).filter(([, x]) => x !== undefined)) as CSSProperties;
}

/** Column of the row holding the value that drives `it`'s formatting (itself, or its "In base al campo" field). */
function driverAlias(v: Visual, it: QueryItem, cfItems: QueryItem[]): string {
  const input = v.format.cf?.[fieldKey(it.field)]?.input;
  if (!input) return it.alias;
  const k = fieldKey(cfInput(input));
  return cfItems.find((c) => fieldKey(c.field) === k)?.alias ?? it.alias;
}

/** Cell with the visual's conditional formatting for that field (`src` = the row the cell comes from). */
function decorated(v: Visual, it: QueryItem, ranges: Map<string, Range | null>, src: Record<string, any>, cfItems: QueryItem[], text: string, key: string, bold = false) {
  const { style, icon } = cellFormat(v.format.cf?.[fieldKey(it.field)], ranges.get(it.alias) ?? null, src[driverAlias(v, it, cfItems)]);
  return (
    <td key={key} className={it.measure ? 'num' : ''} style={{ ...(bold ? { fontWeight: 600 } : {}), ...style }}>
      {icon && <span style={{ color: icon.color, marginRight: 4, fontSize: 10 }}>{icon.ch}</span>}{text}
    </td>
  );
}
const rangesFor = (v: Visual, items: QueryItem[], rows: Record<string, any>[], cfItems: QueryItem[]) =>
  new Map(items.filter((i) => v.format.cf?.[fieldKey(i.field)]).map((i) => { const a = driverAlias(v, i, cfItems); return [i.alias, rangeOf(rows.map((r) => r[a]))]; }));

/** Number with the visual's display units/precision (Power BI labels), else LinBI's automatic format. */
export function fmtStyled(data: VisualData, alias: string, x: unknown, unit: unknown, precision: unknown, row?: Record<string, any>): string {
  if (typeof x !== 'number') return x === null || x === undefined ? '(Vuoto)' : String(x);
  const dyn = dynFmt(row, alias);
  if (dyn !== undefined) return fmtWith(x, dyn);
  if (data.percent.has(alias)) return fmtPct(x);
  return units(x, unit, precision) ?? (typeof precision === 'number' ? x.toLocaleString(locale(), { minimumFractionDigits: precision, maximumFractionDigits: precision }) : fmtAuto(x));
}

/** Format string a calculation item chose for this cell (column `<alias>__f`), if any. */
const dynFmt = (row: Record<string, any> | undefined, alias: string): string | undefined => {
  const f = row?.[alias + '__f'];
  return typeof f === 'string' && f.trim() ? f : undefined;
};
/** Measure cell text: dynamic format string, else percent / full number. */
const measureText = (data: VisualData, alias: string, row: Record<string, any> | undefined, full = true) => {
  const x = row?.[alias];
  const dyn = dynFmt(row, alias);
  if (dyn !== undefined && typeof x === 'number') return fmtWith(x, dyn);
  return data.percent.has(alias) ? fmtPct(x) : full ? fmtFull(x) : fmtAuto(x);
};

/** Columns with data category "URL immagine" / "URL Web": image or link instead of text (like Power BI). */
function useRichCells(items: QueryItem[]) {
  const tables = useStore((s) => s.tables);
  const kind = new Map(items.filter((i) => !i.measure).map((i) => [i.alias, tables.find((t) => t.name === i.field.table)?.dataCategory?.[i.field.column]]));
  return (it: QueryItem, text: string, big = false): ReactNode => {
    const k = kind.get(it.alias);
    if (!text || !/^(https?:|data:image\/)/i.test(text)) return text;
    if (k === 'ImageUrl') return <img src={text} alt="" style={big ? { maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' } : { maxHeight: 40, maxWidth: 120, verticalAlign: 'middle' }} />;
    if (k === 'WebUrl') return <a href={text} onClick={(e) => { e.preventDefault(); e.stopPropagation(); api.openExternal(text).catch(() => {}); }}>{text}</a>;
    return text;
  };
}

export function CardVisual({ v, data }: { v: Visual; data: VisualData }) {
  const m = data.items[0];
  const rich = useRichCells(data.items);
  const val = m ? data.rows[0]?.[m.alias] : undefined;
  const showCat = sp(v, 'categoryLabels', 'show') !== false;
  return (
    <div className="card-v">
      <div className="val" style={{ color: sp(v, 'labels', 'color'), fontSize: pt(sp(v, 'labels', 'fontSize')), fontFamily: font(sp(v, 'labels', 'fontFamily')) }}>
        {m ? rich(m, fmtStyled(data, m.alias, val, sp(v, 'labels', 'labelDisplayUnits'), sp(v, 'labels', 'labelPrecision'), data.rows[0]), true) : ''}
      </div>
      {m && showCat && <div className="cap" style={{ color: sp(v, 'categoryLabels', 'color'), fontSize: pt(sp(v, 'categoryLabels', 'fontSize')), fontFamily: font(sp(v, 'categoryLabels', 'fontFamily')) }}>{fieldLabel(m.field)}</div>}
    </div>
  );
}

const fmtItem = (data: VisualData, it: QueryItem, x: unknown) =>
  typeof x === 'number' ? (data.percent.has(it.alias) ? fmtPct(x) : fmtAuto(x)) : x === null || x === undefined ? '(Vuoto)' : String(x);

/** Multi-row card: one block per row; text fields as heading, numbers as value + caption. */
export function MultiRowCardVisual({ v, data, cross, onSelect }: { v: Visual; data: VisualData; cross: CrossFilter | null; onSelect: (c: string | null) => void }) {
  const dims = data.items.filter((i) => !i.measure);
  const vals = data.items.filter((i) => i.measure);
  const first = dims[0];
  const selected = cross?.visualId === v.id ? cross.value : undefined;
  const bar = sp(v, 'card', 'barShow') !== false;
  const barColor = sp(v, 'card', 'barColor');
  const valStyle = { color: sp(v, 'dataLabels', 'color'), fontSize: pt(sp(v, 'dataLabels', 'fontSize')), fontFamily: font(sp(v, 'dataLabels', 'fontFamily')) };
  const capStyle = { color: sp(v, 'categoryLabels', 'color'), fontSize: pt(sp(v, 'categoryLabels', 'fontSize')), fontFamily: font(sp(v, 'categoryLabels', 'fontFamily')) };
  const headStyle = { color: sp(v, 'cardTitle', 'color'), fontSize: pt(sp(v, 'cardTitle', 'fontSize')), fontFamily: font(sp(v, 'cardTitle', 'fontFamily')) };
  const showCap = sp(v, 'categoryLabels', 'show') !== false;
  const rich = useRichCells(data.items);
  return (
    <div className="mrc">
      {data.rows.map((r, k) => (
        <div key={k} className={'mrc-row' + (selected !== undefined && first && selected !== toKey(r[first.alias]) ? ' dim' : '')} style={{ borderLeftColor: bar ? barColor : 'transparent' }} onClick={() => first && onSelect(r[first.alias])}>
          {dims.length > 0 && <div className="mrc-head" style={headStyle}>{dims.map((d, i) => <span key={d.alias}>{i ? ' · ' : ''}{rich(d, fmtItem(data, d, r[d.alias]))}</span>)}</div>}
          <div className="mrc-vals">{vals.map((m) => (
            <div key={m.alias}><div className="val" style={valStyle}>{fmtStyled(data, m.alias, r[m.alias], sp(v, 'dataLabels', 'labelDisplayUnits'), sp(v, 'dataLabels', 'labelPrecision'), r)}</div>{showCap && <div className="cap" style={capStyle}>{fieldLabel(m.field)}</div>}</div>
          ))}</div>
        </div>
      ))}
    </div>
  );
}

/** KPI: indicator (last point of the trend axis), goal and distance, trend area colored by status. */
export function KpiVisual({ data }: { data: VisualData }) {
  const val = data.items.find((i) => i.well === 'values');
  const trend = data.items.find((i) => i.well === 'trend');
  const goal = data.items.find((i) => i.well === 'target');
  const rows = data.rows.filter((r) => !val || r[val.alias] !== null);
  const last = rows[rows.length - 1];
  const x = val && last ? Number(last[val.alias]) : null;
  const g = goal && last && last[goal.alias] !== null ? Number(last[goal.alias]) : null;
  const ok = x === null || g === null || x >= g;
  const color = g === null ? '#118DFF' : ok ? '#1AAB40' : '#D64554';
  const pts = trend && val ? rows.map((r) => Number(r[val.alias])) : [];
  let path = '';
  if (pts.length > 1) {
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const xy = pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${40 - ((p - lo) / span) * 36}`);
    path = `M0,40 L${xy.join(' L')} L100,40 Z`;
  }
  const dist = x !== null && g ? ((x - g) / Math.abs(g)) * 100 : null;
  return (
    <div className="kpi-v">
      {path && <svg className="kpi-trend" viewBox="0 0 100 40" preserveAspectRatio="none"><path d={path} fill={color} opacity={0.25} /></svg>}
      <div className="val" style={{ color: g === null ? undefined : color }}>{x === null ? '(Vuoto)' : val && fmtItem(data, val, x)}{g !== null && <span className="kpi-mark">{ok ? ' ✓' : ' !'}</span>}</div>
      {g !== null && goal && <div className="cap">Obiettivo: {fmtItem(data, goal, g)}{dist !== null && <span style={{ color }}> ({dist >= 0 ? '+' : ''}{dist.toLocaleString(locale(), { maximumFractionDigits: 2 })}%)</span>}</div>}
    </div>
  );
}

export function TableVisual({ v, data, cross, onSelect }: { v: Visual; data: VisualData; cross: CrossFilter | null; onSelect: (c: string | null) => void }) {
  const updateFormat = useStore((s) => s.updateFormat);
  const rich = useRichCells(data.items);
  const firstDim = data.items.find((i) => !i.measure);
  const selected = cross?.visualId === v.id ? cross.value : undefined;
  const sortClick = (idx: number) => {
    const same = v.format.sortBy === idx;
    updateFormat(v.id, { sortBy: idx, sortDir: same && v.format.sortDir === 'desc' ? 'asc' : 'desc' });
  };
  const tot = data.totals?.[0];
  const ranges = rangesFor(v, data.items, data.rows, data.cfItems);
  return (
    <div className="tbl" style={tableVars(v)}>
      <table>
        <thead><tr>{data.items.map((it, i) => (
          <th key={it.alias} className={it.measure ? 'num' : ''} onClick={() => sortClick(i)}>
            {fieldLabel(it.field)}{v.format.sortBy === i ? (v.format.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
          </th>
        ))}</tr></thead>
        <tbody>{data.rows.map((r, k) => {
          const key = firstDim ? toKey(r[firstDim.alias]) : '';
          return (
            <tr key={k} className={selected !== undefined && selected === key ? 'sel' : ''} onClick={() => firstDim && onSelect(r[firstDim.alias])}>
              {data.items.map((it) => {
                const text = it.measure && (dynFmt(r, it.alias) || data.percent.has(it.alias)) ? measureText(data, it.alias, r) : cell(r[it.alias], it.measure);
                return v.format.cf?.[fieldKey(it.field)] ? decorated(v, it, ranges, r, data.cfItems, text, it.alias) : <td key={it.alias} className={it.measure ? 'num' : ''}>{it.measure ? text : rich(it, text)}</td>;
              })}
            </tr>
          );
        })}</tbody>
        {tot && <tfoot><tr>{data.items.map((it, i) => (
          <td key={it.alias} className={it.measure ? 'num' : ''}>{it.measure ? measureText(data, it.alias, tot) : i === 0 ? 'Totale' : ''}</td>
        ))}</tr></tfoot>}
      </table>
    </div>
  );
}

export function MatrixVisual({ v, data, cross, onSelect }: { v: Visual; data: VisualData; cross: CrossFilter | null; onSelect: (c: string | null) => void }) {
  const rows = data.items.filter((i) => i.well === 'rows');
  const col = data.items.find((i) => i.well === 'columns');
  const vals = data.items.filter((i) => i.well === 'values');
  const selected = cross?.visualId === v.id ? cross.value : undefined;

  if (!col) return <TableVisual v={v} data={{ ...data, items: [...rows, ...vals] }} cross={cross} onSelect={onSelect} />;

  const colValues: (string | null)[] = [];
  const rowKeys: string[] = [];
  const rowHead = new Map<string, Record<string, any>>();
  const cellMap = new Map<string, Record<string, any>>();
  for (const r of data.rows) {
    const rk = JSON.stringify(rows.map((d) => r[d.alias]));
    if (!rowHead.has(rk)) { rowHead.set(rk, r); rowKeys.push(rk); }
    if (!colValues.includes(r[col.alias])) colValues.push(r[col.alias]);
    cellMap.set(rk + '\u0001' + r[col.alias], r);
  }
  // Column order: the column-totals query is sorted by the engine (incl. "sort by column").
  const order = (data.colTotals ?? []).map((r) => r[col.alias]);
  colValues.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return ia >= 0 && ib >= 0 ? ia - ib : (a ?? '').localeCompare(b ?? '', locale(), { numeric: true });
  });
  const rowTot = new Map((data.rowTotals ?? []).map((r) => [JSON.stringify(rows.map((d) => r[d.alias])), r]));
  const colTot = new Map((data.colTotals ?? []).map((r) => [r[col.alias], r]));
  const grand = data.totals?.[0];
  const span = Math.max(1, vals.length);
  const ranges = rangesFor(v, vals, data.rows, data.cfItems);
  // Conditional formatting applies to the value cells, not to totals (Power BI default).
  const valCells = (src: Record<string, any> | undefined, k: string, bold = false) =>
    (vals.length ? vals : [null]).map((m, i) => {
      const text = m && src ? measureText(data, m.alias, src) : '';
      return m && src && !bold && k !== 'g' && !k.startsWith('ct') ? decorated(v, m, ranges, src, data.cfItems, text, k + i)
        : <td key={k + i} className="num" style={bold ? { fontWeight: 600 } : undefined}>{text}</td>;
    });

  return (
    <div className="tbl" style={tableVars(v)}>
      <table>
        <thead>
          <tr>
            {rows.map((d) => <th key={d.alias} rowSpan={vals.length > 1 ? 2 : 1}>{d.field.column}</th>)}
            {colValues.map((c) => <th key={String(c)} colSpan={span} className="num">{c ?? '(Vuoto)'}</th>)}
            <th colSpan={span} className="num">Totale</th>
          </tr>
          {vals.length > 1 && <tr>{[...colValues, 'tot'].flatMap((c) => vals.map((m) => <th key={String(c) + m.alias} className="num" style={{ top: 22 }}>{fieldLabel(m.field)}</th>))}</tr>}
        </thead>
        <tbody>{rowKeys.map((rk) => {
          const h = rowHead.get(rk)!;
          const key = rows[0] ? toKey(h[rows[0].alias]) : '';
          return (
            <tr key={rk} className={selected !== undefined && selected === key ? 'sel' : ''} onClick={() => rows[0] && onSelect(h[rows[0].alias])}>
              {rows.map((d) => <td key={d.alias} className="rowhdr">{h[d.alias] ?? '(Vuoto)'}</td>)}
              {colValues.flatMap((c) => valCells(cellMap.get(rk + '\u0001' + c), String(c)))}
              {valCells(rowTot.get(rk), 'tot', true)}
            </tr>
          );
        })}</tbody>
        <tfoot><tr>
          {rows.map((d, i) => <td key={d.alias}>{i === 0 ? 'Totale' : ''}</td>)}
          {colValues.flatMap((c) => valCells(colTot.get(c), 'ct' + c))}
          {valCells(grand, 'g')}
        </tr></tfoot>
      </table>
    </div>
  );
}

export function SlicerVisual({ v, data }: { v: Visual; data: VisualData }) {
  const setSlicer = useStore((s) => s.setSlicer);
  const it: QueryItem | undefined = data.items[0];
  const sel = new Set(v.pendingSlicer ?? v.slicerValues ?? []);
  const values = it ? data.rows.map((r) => r[it.alias] as string | null) : [];
  const set = (vals: string[]) => setSlicer(v.id, vals);
  const toggle = (k: string, multi: boolean) => {
    if (multi) set(sel.has(k) ? [...sel].filter((x) => x !== k) : [...sel, k]);
    else set(sel.size === 1 && sel.has(k) ? [] : [k]);
  };
  if (!it) return null;
  if (v.format.slicerStyle === 'slider') {
    // Single value on a numeric range (what-if parameters).
    const nums = values.filter((x): x is string => x !== null).map((x) => ({ x, n: Number(x) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);
    const cur = sel.size === 1 ? nums.findIndex((x) => x.x === [...sel][0]) : -1;
    if (!nums.length) return null;
    return (
      <div className="slicer-v slider-v">
        <div className="slider-val">{cur >= 0 ? nums[cur].n.toLocaleString(locale()) : '(Tutti)'}</div>
        <input type="range" min={0} max={nums.length - 1} step={1} value={cur >= 0 ? cur : 0}
          onMouseDown={(e) => e.stopPropagation()} onChange={(e) => set([nums[+e.target.value].x])} />
        <div className="slider-ends"><span>{nums[0].n.toLocaleString(locale())}</span><span>{nums[nums.length - 1].n.toLocaleString(locale())}</span></div>
      </div>
    );
  }
  if (v.format.slicerStyle === 'dropdown') {
    return (
      <div className="slicer-v">
        <select value={sel.size === 1 ? [...sel][0] : ''} onChange={(e) => set(e.target.value ? [e.target.value] : [])}>
          <option value="">Tutti</option>
          {values.map((x) => <option key={toKey(x)} value={toKey(x)}>{x ?? '(Vuoto)'}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="slicer-v">
      <label><input type="checkbox" checked={sel.size === 0} onChange={() => set([])} />Seleziona tutto</label>
      {values.map((x) => {
        const k = toKey(x);
        return (
          <label key={k} onClick={(e) => { e.preventDefault(); toggle(k, e.ctrlKey || e.metaKey); }}>
            <input type="checkbox" readOnly checked={sel.has(k)} />{x ?? '(Vuoto)'}
          </label>
        );
      })}
    </div>
  );
}

type Run = { value?: string; url?: string; textStyle?: Record<string, string> };
type Para = { textRuns?: Run[]; horizontalTextAlignment?: string };
const paraText = (ps: Para[]) => ps.map((p) => (p.textRuns ?? []).map((r) => r.value ?? '').join('')).join('\n');

/** Text box as formatted in Power BI (runs with size/color/weight/font, paragraph alignment). */
function RichText({ paras }: { paras: Para[] }) {
  return <>{paras.map((p, i) => (
    <div key={i} style={{ textAlign: (p.horizontalTextAlignment as CSSProperties['textAlign']) ?? undefined, minHeight: '1.2em', whiteSpace: 'pre-wrap' }}>
      {(p.textRuns ?? []).map((r, k) => {
        const t = r.textStyle ?? {};
        const size = /^([\d.]+)pt$/.exec(t.fontSize ?? '');
        const style: CSSProperties = {
          fontSize: size ? `${(+size[1] * 4) / 3}px` : t.fontSize, color: t.color, fontWeight: t.fontWeight as CSSProperties['fontWeight'],
          fontStyle: t.fontStyle as CSSProperties['fontStyle'], textDecoration: t.textDecoration, fontFamily: font(t.fontFamily),
        };
        return r.url ? <a key={k} href={r.url} style={style} onClick={(e) => { e.preventDefault(); api.openExternal(r.url!); }}>{r.value}</a> : <span key={k} style={style}>{r.value}</span>;
      })}
    </div>
  ))}</>;
}

export function TextboxVisual({ v, selected }: { v: Visual; selected: boolean }) {
  const updateVisual = useStore((s) => s.updateVisual);
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  // Imported formatting is shown until the text is edited in LinBI (then it becomes plain text).
  const paras = v.style?.objects?.general?.find((e) => !e.selector)?.properties?.paragraphs as Para[] | undefined;
  const rich = Array.isArray(paras) && paraText(paras) === (v.text ?? '') ? paras : undefined;
  useEffect(() => { if (ref.current && !editing) ref.current.innerText = v.text ?? ''; }, [v.text, editing, rich]);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);
  if (rich && !editing) {
    return <div className="textbox-v" style={{ inset: 6 }} onDoubleClick={() => { setEditing(true); setTimeout(() => { if (ref.current) { ref.current.innerText = v.text ?? ''; ref.current.focus(); } }); }}><RichText paras={rich} /></div>;
  }
  return (
    <div
      ref={ref}
      className="textbox-v"
      style={{ inset: 6 }}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={() => { setEditing(true); setTimeout(() => ref.current?.focus()); }}
      onBlur={() => { setEditing(false); const t = ref.current?.innerText ?? ''; if (t !== (v.text ?? '')) updateVisual(v.id, { text: t }); }}
    />
  );
}
