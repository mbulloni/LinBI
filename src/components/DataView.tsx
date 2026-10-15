import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { isNumeric, fmtFull } from '../format';
import { qi } from '../query';
import { Icon } from './icons';
import { Menu } from './Menu';

export function DataView() {
  const s = useStore();
  const t = s.tables.find((x) => x.name === s.dataViewTable) ?? s.tables[0];
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [sort, setSort] = useState<{ col: string; dir: 'ASC' | 'DESC' } | null>(null);
  const [selCol, setSelCol] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; col: string } | null>(null);

  useEffect(() => { setSort(null); setSelCol(null); }, [t?.name]);
  useEffect(() => {
    if (!t) return;
    const order = sort ? ` ORDER BY ${qi(sort.col)} ${sort.dir} NULLS LAST` : '';
    api.query(`SELECT * FROM ${qi(t.name)}${order} LIMIT 2000`).then((r) => setRows(r.rows)).catch((e) => s.notify(e.message));
  }, [t?.name, sort, s.dataVersion]);

  if (!t) return <div className="placeholder-view"><Icon name="tableView" size={48} /><h2>Nessun dato</h2><span>Caricare dati per visualizzarli in questa vista.</span></div>;
  const col = selCol ? t.columns.find((c) => c.name === selCol) : undefined;

  return (
    <div className="dataview">
      <div className="formulabar">
        <Icon name="close" size={12} /><span style={{ color: 'var(--text3)' }}>✓</span><span className="fx">fx</span>
        <span>{col ? `${col.name}  ·  Tipo di dati: ${col.type}` : ''}</span>
      </div>
      <div className="grid-wrap">
        <table>
          <thead><tr>{t.columns.map((c) => (
            <th key={c.name} className={selCol === c.name ? 'sel' : ''} onClick={() => setSelCol(c.name)}>
              <div className="h">
                <span>{c.name}</span>
                <span onClick={(e) => { e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, col: c.name }); }}>
                  <Icon name={sort?.col === c.name ? (sort.dir === 'ASC' ? 'chevronUp' : 'chevronDown') : 'chevronDown'} size={11} />
                </span>
              </div>
            </th>
          ))}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>{t.columns.map((c) => {
              const v = r[c.name];
              const num = isNumeric(c);
              return <td key={c.name} className={(num ? 'num' : '') + (selCol === c.name ? ' sel' : '') + (v === null ? ' null' : '')}>{v === null ? '' : num ? fmtFull(v) : String(v)}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button onClick={() => { setSort({ col: menu.col, dir: 'ASC' }); setMenu(null); }}>Ordinamento crescente</button>
          <button onClick={() => { setSort({ col: menu.col, dir: 'DESC' }); setMenu(null); }}>Ordinamento decrescente</button>
          <button onClick={() => { setSort(null); setMenu(null); }}>Cancella ordinamento</button>
        </Menu>
      )}
    </div>
  );
}
