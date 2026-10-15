import { useEffect, useRef, useState } from 'react';
import type { CrossFilter, Visual } from '../types';
import type { VisualData } from './useVisualData';
import { fieldLabel, fmtAuto, fmtFull, fmtPct } from '../format';
import { NULL_KEY, type QueryItem } from '../query';
import { useStore } from '../store';

const cell = (v: unknown, measure: boolean) => (measure ? fmtFull(v) : v === null || v === undefined ? '' : String(v));
const toKey = (v: string | null) => (v === null ? NULL_KEY : v);

export function CardVisual({ data }: { data: VisualData }) {
  const m = data.items[0];
  const val = m ? data.rows[0]?.[m.alias] : undefined;
  return (
    <div className="card-v">
      <div className="val">{m ? (typeof val === 'number' ? (data.percent.has(m.alias) ? fmtPct(val) : fmtAuto(val)) : val ?? '(Vuoto)') : ''}</div>
      {m && <div className="cap">{fieldLabel(m.field)}</div>}
    </div>
  );
}

export function TableVisual({ v, data, cross, onSelect }: { v: Visual; data: VisualData; cross: CrossFilter | null; onSelect: (c: string | null) => void }) {
  const updateFormat = useStore((s) => s.updateFormat);
  const firstDim = data.items.find((i) => !i.measure);
  const selected = cross?.visualId === v.id ? cross.value : undefined;
  const sortClick = (idx: number) => {
    const same = v.format.sortBy === idx;
    updateFormat(v.id, { sortBy: idx, sortDir: same && v.format.sortDir === 'desc' ? 'asc' : 'desc' });
  };
  const tot = data.totals?.[0];
  return (
    <div className="tbl">
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
              {data.items.map((it) => <td key={it.alias} className={it.measure ? 'num' : ''}>{data.percent.has(it.alias) ? fmtPct(r[it.alias]) : cell(r[it.alias], it.measure)}</td>)}
            </tr>
          );
        })}</tbody>
        {tot && <tfoot><tr>{data.items.map((it, i) => (
          <td key={it.alias} className={it.measure ? 'num' : ''}>{it.measure ? (data.percent.has(it.alias) ? fmtPct(tot[it.alias]) : fmtFull(tot[it.alias])) : i === 0 ? 'Totale' : ''}</td>
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
    return ia >= 0 && ib >= 0 ? ia - ib : (a ?? '').localeCompare(b ?? '', 'it', { numeric: true });
  });
  const rowTot = new Map((data.rowTotals ?? []).map((r) => [JSON.stringify(rows.map((d) => r[d.alias])), r]));
  const colTot = new Map((data.colTotals ?? []).map((r) => [r[col.alias], r]));
  const grand = data.totals?.[0];
  const span = Math.max(1, vals.length);
  const valCells = (src: Record<string, any> | undefined, k: string, bold = false) =>
    (vals.length ? vals : [null]).map((m, i) => <td key={k + i} className="num" style={bold ? { fontWeight: 600 } : undefined}>{m && src ? (data.percent.has(m.alias) ? fmtPct(src[m.alias]) : fmtFull(src[m.alias])) : ''}</td>);

  return (
    <div className="tbl">
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
  const updateVisual = useStore((s) => s.updateVisual);
  const it: QueryItem | undefined = data.items[0];
  const sel = new Set(v.slicerValues ?? []);
  const values = it ? data.rows.map((r) => r[it.alias] as string | null) : [];
  const set = (vals: string[]) => updateVisual(v.id, { slicerValues: vals });
  const toggle = (k: string, multi: boolean) => {
    if (multi) set(sel.has(k) ? [...sel].filter((x) => x !== k) : [...sel, k]);
    else set(sel.size === 1 && sel.has(k) ? [] : [k]);
  };
  if (!it) return null;
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

export function TextboxVisual({ v, selected }: { v: Visual; selected: boolean }) {
  const updateVisual = useStore((s) => s.updateVisual);
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (ref.current && !editing) ref.current.innerText = v.text ?? ''; }, [v.text, editing]);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);
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
