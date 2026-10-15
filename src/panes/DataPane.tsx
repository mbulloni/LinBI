import { useState } from 'react';
import { useStore } from '../store';
import type { TableMeta } from '../types';
import { isDate, isNumeric } from '../format';
import { Icon } from '../components/icons';
import { Menu } from '../components/Menu';
import { FIELD_MIME } from '../components/VisualContainer';
import { insertDax } from '../components/DaxQueryView';

export function DataPane() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; table: string; column?: string; measure?: string } | null>(null);
  if (!s.panes.data) return null;

  const report = s.view === 'report';
  const v = report ? s.page().visuals.find((x) => x.id === s.selectedVisualId) : undefined;
  const used = new Set(v ? Object.values(v.fields).flat().map((f) => f.table + '\u0001' + f.column) : []);
  // Power BI "measure tables" hold only measures (no columns, no data): list them too.
  const measureOnly: TableMeta[] = [...new Set(s.report.measures.map((m) => m.table))]
    .filter((n) => !s.tables.some((t) => t.name === n))
    .map((name) => ({ name, rowCount: 0, columns: [], source: { path: '' } }));
  const isOpen = (t: string) => open[t] ?? (q !== '' || s.tables.length === 1);

  const daxRef = (table: string, column: string, measure: boolean) => (measure ? `[${column}]` : `'${table.replace(/'/g, "''")}'[${column}]`);
  const toggleField = (table: string, column: string, measure = false) => {
    if (s.view === 'dax') { insertDax(daxRef(table, column, measure)); return; }
    if (!report) return;
    const key = table + '\u0001' + column;
    if (v && used.has(key)) {
      for (const [well, list] of Object.entries(v.fields)) {
        const i = list.findIndex((f) => f.table === table && f.column === column);
        if (i >= 0) { s.removeField(v.id, well, i); return; }
      }
    } else s.addField(v && !['textbox', 'image', 'unsupported'].includes(v.type) ? v.id : null, { table, column, measure });
  };

  return (
    <div className="pane">
      <div className="pane-head">
        <h3>Dati</h3>
        <div className="tools"><button title="Comprimi" onClick={() => s.set({ panes: { ...s.panes, data: false } })}><Icon name="collapseRight" /></button></div>
      </div>
      <div className="pane-search"><Icon name="search" size={14} /><input type="search" placeholder="Cerca" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="pane-body tree">
        {!s.tables.length && <div style={{ color: 'var(--text2)', padding: '6px 4px' }}>Nessun dato caricato. Usare <b>Ottieni dati</b> nella barra multifunzione.</div>}
        {[...s.tables, ...measureOnly].map((t) => {
          const match = (n: string) => !q || n.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase());
          const cols = t.columns.filter((c) => match(c.name));
          const measures = s.report.measures.filter((m) => m.table === t.name && match(m.name));
          if (q && !cols.length && !measures.length) return null;
          return (
            <div key={t.name}>
              <div className={'tnode table' + (!report && s.dataViewTable === t.name ? ' active' : '')}
                onClick={() => (report ? setOpen({ ...open, [t.name]: !isOpen(t.name) }) : s.set({ dataViewTable: t.name }))}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, table: t.name }); }}>
                <span onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [t.name]: !isOpen(t.name) }); }}><Icon name={isOpen(t.name) ? 'chevronDown' : 'chevronRight'} size={12} /></span>
                {t.source.dax ? <i className="fx-ico" title="Tabella calcolata">fx</i> : <Icon name="tableSmall" />}
                <span className="nm" title={t.source.dax ? `${t.name} = ${t.source.dax}` : t.name}>{t.name}</span>
                <button className="more" onClick={(e) => { e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, table: t.name }); }}><Icon name="more" size={14} /></button>
              </div>
              {isOpen(t.name) && (
                <div className="cols">
                  {measures.map((m) => {
                    const checked = used.has(t.name + '\u0001' + m.name);
                    return (
                      <div key={'m:' + m.name} className="tnode field" draggable={report}
                        onDragStart={(e) => { e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ table: t.name, column: m.name, measure: true })); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => toggleField(t.name, m.name, true)}
                        onDoubleClick={() => s.startDax('measure', m.table, m.name)}
                        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, table: t.name, measure: m.name }); }}>
                        {report && <input type="checkbox" checked={checked} readOnly />}
                        <span className="ty"><Icon name="calc" size={13} /></span>
                        <span className="nm" title={`${m.name} = ${m.expression}`}>{m.name}</span>
                      </div>
                    );
                  })}
                  {cols.map((c) => {
                    const checked = used.has(t.name + '\u0001' + c.name);
                    return (
                      <div key={c.name} className="tnode field" draggable={report}
                        onDragStart={(e) => { e.dataTransfer.setData(FIELD_MIME, JSON.stringify({ table: t.name, column: c.name })); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => toggleField(t.name, c.name)}
                        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, table: t.name, column: c.name }); }}>
                        {report && <input type="checkbox" checked={checked} readOnly />}
                        <span className="ty">{t.calcColumns?.some((x) => x.name === c.name) ? <i className="fx-ico">fx</i> : isNumeric(c) ? <Icon name="sigma" size={13} /> : isDate(c) ? <Icon name="calendar" size={13} /> : null}</span>
                        <span className="nm" title={`${c.name} (${c.type})`}>{c.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.measure ? <>
            <button onClick={() => { s.startDax('measure', menu.table, menu.measure); setMenu(null); }}><Icon name="calc" />Modifica misura</button>
            <button onClick={() => { s.deleteMeasure(menu.measure!); setMenu(null); }}><Icon name="trash" />Elimina misura</button>
          </> : menu.column ? <>
            {s.tables.find((t) => t.name === menu.table)?.calcColumns?.some((c) => c.name === menu.column) && <>
              <button onClick={() => { s.startDax('column', menu.table, menu.column); setMenu(null); }}><Icon name="calc" />Modifica colonna calcolata</button>
              <button onClick={() => { s.deleteCalcColumn(menu.table, menu.column!); setMenu(null); }}><Icon name="trash" />Elimina colonna</button>
              <hr />
            </>}
            <button disabled={!report} onClick={() => { s.addFilter('page', { table: menu.table, column: menu.column! }); setMenu(null); }}>Aggiungi a filtri › Livello di pagina</button>
            <button disabled={!report} onClick={() => { s.addFilter('report', { table: menu.table, column: menu.column! }); setMenu(null); }}>Aggiungi a filtri › Livello di report</button>
            <button disabled={!report} onClick={() => { const id = s.addVisual('slicer'); s.addField(id, { table: menu.table, column: menu.column! }); setMenu(null); }}>Crea filtro dei dati</button>
          </> : <>
            <button onClick={() => { s.startDax('measure', menu.table); setMenu(null); }}><Icon name="calc" />Nuova misura</button>
            <button disabled={!s.tables.some((t) => t.name === menu.table)} onClick={() => { s.startDax('column', menu.table); setMenu(null); }}><Icon name="calc" />Nuova colonna</button>
            {s.tables.find((t) => t.name === menu.table)?.source.dax && <button onClick={() => { s.startDax('table', menu.table, menu.table); setMenu(null); }}><Icon name="calc" />Modifica tabella calcolata</button>}
            <hr />
            <button onClick={() => { s.set({ view: 'data', dataViewTable: menu.table }); setMenu(null); }}>Visualizza in vista tabella</button>
            <button onClick={() => { setOpen({ ...open, [menu.table]: !isOpen(menu.table) }); setMenu(null); }}>{isOpen(menu.table) ? 'Comprimi' : 'Espandi'}</button>
            <button disabled={!s.tables.some((t) => t.name === menu.table && !t.source.dax)} onClick={() => { s.openPowerQuery(menu.table); setMenu(null); }}><Icon name="transform" size={16} box={32} />Modifica query</button>
            <button onClick={() => { s.refresh(); setMenu(null); }}>Aggiorna dati</button>
            <hr />
            <button onClick={() => { s.removeTable(menu.table); setMenu(null); }}><Icon name="trash" />Elimina dal modello</button>
          </>}
        </Menu>
      )}
    </div>
  );
}
