// Home › Immetti dati ("Crea tabella"): a small grid typed or pasted (tab-separated, e.g. from Excel);
// the table keeps its values in the report and gets automatic column types.
import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from './icons';

export function EnterDataDialog() {
  const s = useStore();
  const [name, setName] = useState('Tabella');
  const [cols, setCols] = useState<string[]>(['Colonna1']);
  const [rows, setRows] = useState<string[][]>([['']]);
  if (!s.enterData) return null;
  const close = () => s.set({ enterData: false });
  const setCell = (r: number, c: number, v: string) => setRows(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  // Paste of several cells (tabs/new lines) fills the grid from the clicked cell, growing it as needed.
  const paste = (r0: number, c0: number, text: string) => {
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    if (lines.length === 1 && lines[0].length === 1) return false;
    const width = Math.max(cols.length, c0 + Math.max(...lines.map((l) => l.length)));
    const nextCols = [...cols];
    while (nextCols.length < width) nextCols.push(`Colonna${nextCols.length + 1}`);
    const next = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
    lines.forEach((l, i) => {
      while (next.length <= r0 + i) next.push(Array(width).fill(''));
      l.forEach((v, j) => { next[r0 + i][c0 + j] = v; });
    });
    setCols(nextCols); setRows(next);
    return true;
  };
  const taken = s.tables.some((t) => t.name === name.trim());
  const filled = rows.filter((r) => r.some((x) => x.trim() !== ''));
  const dupCols = new Set(cols.map((c) => c.trim())).size !== cols.length || cols.some((c) => !c.trim());
  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 'min(860px, 96vw)' }}>
        <div className="dh"><h2>Crea tabella</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db">
          <div className="ed-grid">
            <table>
              <thead><tr><th />{cols.map((c, j) => (
                <th key={j}><input value={c} onChange={(e) => setCols(cols.map((x, k) => (k === j ? e.target.value : x)))} />
                  {cols.length > 1 && <button title="Elimina colonna" onClick={() => { setCols(cols.filter((_, k) => k !== j)); setRows(rows.map((r) => r.filter((_, k) => k !== j))); }}>×</button>}</th>
              ))}<th><button title="Inserisci colonna" onClick={() => { setCols([...cols, `Colonna${cols.length + 1}`]); setRows(rows.map((r) => [...r, ''])); }}>+</button></th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}><td className="rn">{i + 1}</td>{cols.map((_, j) => (
                  <td key={j}><input value={r[j] ?? ''} onChange={(e) => setCell(i, j, e.target.value)}
                    onPaste={(e) => { if (paste(i, j, e.clipboardData.getData('text'))) e.preventDefault(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) setRows([...rows, cols.map(() => '')]); }} /></td>
                ))}<td>{rows.length > 1 && <button title="Elimina riga" onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>}</td></tr>
              ))}
                <tr><td className="rn"><button title="Inserisci riga" onClick={() => setRows([...rows, cols.map(() => '')])}>+</button></td></tr>
              </tbody>
            </table>
          </div>
          <label className="pq-field" style={{ marginTop: 10 }}>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          {taken && <div className="pq-err">Esiste già una tabella con questo nome.</div>}
          {dupCols && <div className="pq-err">I nomi di colonna devono essere diversi e non vuoti.</div>}
          <div className="pq-note">Incollare celle copiate da un foglio di calcolo per riempire la griglia. I tipi delle colonne (numero, data, vero/falso, testo) vengono rilevati automaticamente.</div>
        </div>
        <div className="df">
          <button className="btn primary" disabled={!name.trim() || taken || dupCols} onClick={() => s.createInlineTable(name.trim(), cols.map((c) => c.trim()), filled.map((r) => cols.map((_, j) => (r[j] ?? '').trim() || null)))}>Carica</button>
          <button className="btn" onClick={close}>Annulla</button>
        </div>
      </div>
    </div>
  );
}
