// Altre opzioni › Esporta dati (Power BI Desktop): the visual's summarized data (.xlsx or .csv) or the rows
// underneath it (.xlsx), with every filter in scope (page, report, slicers, cross-filter).
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { fieldKind, underlyingQuery, CF_WELL, type QueryItem } from '../query';
import { runVisualQuery, useVisualData } from '../visuals/useVisualData';
import { scopedVisuals } from '../visuals/interactions';
import { fieldLabel, fmtFull } from '../format';
import { autoTitle } from './VisualContainer';
import { Icon } from './icons';
import type { TableMeta, Visual } from '../types';

type Col = { name: string; kind: 'number' | 'date' | 'text' };
const kindOf = (k: ReturnType<typeof fieldKind>): Col['kind'] => (k === 'number' ? 'number' : k === 'date' || k === 'datetime' ? 'date' : 'text');

/** Columns of a visual query: dims by their field type, measures as numbers. */
export function exportColumns(items: QueryItem[], tables: TableMeta[]): Col[] {
  return items.filter((i) => i.well !== CF_WELL).map((i) => ({ name: fieldLabel(i.field), kind: i.measure ? 'number' : kindOf(fieldKind(i.field, tables)) }));
}

export async function summarizedData(v: Visual) {
  const s = useStore.getState();
  const { items, rows } = await runVisualQuery(v);
  const vis = items.filter((i) => i.well !== CF_WELL);
  return { columns: exportColumns(vis, s.tables), rows: rows.map((r) => vis.map((i) => r[i.alias] ?? null)) };
}

export async function underlyingData(v: Visual) {
  const s = useStore.getState();
  const page = s.report.pages.find((p) => p.visuals.some((x) => x.id === v.id)) ?? s.page();
  const q = underlyingQuery(v, s.tables, s.report.relationships, [...s.report.reportFilters, ...page.filters], scopedVisuals(page, v), s.crossFilter);
  if ('error' in q) throw new Error(q.error);
  const res = await api.queryAs(q.sql);
  const keys = q.columns.map((c) => `${c.table}.${c.column}`);
  return {
    columns: q.columns.map((c) => ({ name: c.name, kind: kindOf(fieldKind(c, s.tables)) })),
    rows: res.rows.map((r) => keys.map((k) => r[k] ?? null)),
  };
}

export function ExportDataDialog() {
  const s = useStore();
  const v = s.exportData ? s.report.pages.flatMap((p) => p.visuals).find((x) => x.id === s.exportData) : undefined;
  const [kind, setKind] = useState<'summary' | 'underlying'>('summary');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v) return null;
  const close = () => { s.set({ exportData: null }); setErr(null); };
  const hasMeasures = Object.values(v.fields).flat().some((f) => f.agg !== 'none');
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const data = kind === 'summary' ? await summarizedData(v) : await underlyingData(v);
      const name = v.format.titleText || autoTitle(v) || 'data';
      const fmt = kind === 'underlying' ? 'xlsx' : format;
      const rows = data.rows.slice(0, fmt === 'csv' ? 30000 : 150000);
      const out = await api.exportData(name, data.columns, rows, fmt);
      if (out) { s.notify(`Esportate ${rows.length.toLocaleString()} righe in ${out}${rows.length < data.rows.length ? ` (limite raggiunto: ${data.rows.length.toLocaleString()} righe disponibili)` : ''}.`); close(); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="modal-bg">
      <div className="dialog export-dlg">
        <div className="dh"><h2>Scegliere il tipo di dati da esportare</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db">
          <label className={'export-opt' + (kind === 'summary' ? ' on' : '')}>
            <input type="radio" checked={kind === 'summary'} onChange={() => setKind('summary')} />
            <div><b>Dati riepilogati</b><span>Esporta i dati usati nell'oggetto visivo, con i filtri applicati.</span>
              {kind === 'summary' && <select value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv')}>
                <option value="xlsx">.xlsx (Excel), massimo 150.000 righe</option><option value="csv">.csv, massimo 30.000 righe</option>
              </select>}
            </div>
          </label>
          <label className={'export-opt' + (kind === 'underlying' ? ' on' : '') + (hasMeasures ? '' : ' off')}>
            <input type="radio" checked={kind === 'underlying'} disabled={!hasMeasures} onChange={() => setKind('underlying')} />
            <div><b>Dati sottostanti</b><span>Esporta le righe delle tabelle da cui l'oggetto visivo calcola i valori (.xlsx). Disponibile quando l'oggetto visivo aggrega dati.</span></div>
          </label>
          {err && <div className="vc-error" style={{ position: 'static' }}>{err}</div>}
        </div>
        <div className="df">
          <button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Esportazione…' : 'Esporta'}</button>
          <button className="btn" onClick={close}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

/** Mostra come tabella: the data behind the visual, as the visual's query returns it (with filters and cross-filter). */
export function VisualDataTable({ v }: { v: Visual }) {
  const data = useVisualData(v);
  const tables = useStore((s) => s.tables);
  const cols = exportColumns(data.items, tables);
  if (data.error) return <div className="vc-error"><span>{data.error}</span></div>;
  return (
    <div className="tbl focus-tbl">
      <table>
        <thead><tr>{data.items.map((i, k) => <th key={i.alias} className={cols[k]?.kind === 'number' ? 'num' : ''}>{fieldLabel(i.field)}</th>)}</tr></thead>
        <tbody>{data.rows.slice(0, 5000).map((r, n) => (
          <tr key={n}>{data.items.map((i, k) => { const x = r[i.alias]; return <td key={i.alias} className={cols[k]?.kind === 'number' ? 'num' : ''}>{x === null || x === undefined ? '' : cols[k]?.kind === 'number' ? fmtFull(x) : String(x)}</td>; })}</tr>
        ))}</tbody>
      </table>
      {data.rows.length > 5000 && <div className="side-empty">Mostrate le prime 5.000 righe di {data.rows.length.toLocaleString()}.</div>}
    </div>
  );
}
