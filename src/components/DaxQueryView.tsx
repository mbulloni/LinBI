import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { daxQuerySql, type DaxQueryResult } from '../dax';
import { fmtFull, isDate, isNumeric } from '../format';
import { Icon } from './icons';
import { Menu } from './Menu';
import { DaxInput } from './DaxInput';

let inserter: ((text: string) => void) | null = null;
/** Inserts text at the cursor of the DAX query editor (fields clicked in the Data pane). */
export function insertDax(text: string) { inserter?.(text); }

interface Result { cols: DaxQueryResult['columns']; rows: Record<string, any>[]; sql: string; ms: number; }

function examples(s: ReturnType<typeof useStore.getState>): [string, string][] {
  const t = s.tables.find((x) => !x.source.dax) ?? s.tables[0];
  if (!t) return [['Calendario', 'EVALUATE\n    CALENDAR(DATE(2024, 1, 1), DATE(2024, 1, 31))']];
  const q = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const dim = t.columns.find((c) => !isNumeric(c) && !isDate(c)) ?? t.columns[0];
  const num = t.columns.find((c) => isNumeric(c)) ?? t.columns[0];
  const date = s.tables.flatMap((x) => x.columns.filter((c) => isDate(c)).map((c) => `${q(x.name)}[${c.name}]`))[0];
  const m = s.report.measures[0];
  const total = m ? `[${m.name}]` : `SUM(${q(t.name)}[${num.name}])`;
  const out: [string, string][] = [
    ['Prime righe di una tabella', `EVALUATE\n    TOPN(100, ${q(t.name)})`],
    ['Riepilogo per categoria', `EVALUATE\n    SUMMARIZECOLUMNS(\n        ${q(t.name)}[${dim.name}],\n        "Totale", ${total},\n        "% del totale", DIVIDE(${total}, CALCULATE(${total}, ALL(${q(t.name)}[${dim.name}])))\n    )\nORDER BY [Totale] DESC`],
    ['Misura definita nella query', `DEFINE\n    MEASURE ${q(t.name)}[Media riga] = AVERAGEX(${q(t.name)}, ${q(t.name)}[${num.name}])\n    MEASURE ${q(t.name)}[Classifica] = RANKX(ALL(${q(t.name)}[${dim.name}]), [Media riga])\n\nEVALUATE\n    SUMMARIZECOLUMNS(${q(t.name)}[${dim.name}], "Media riga", [Media riga], "Classifica", [Classifica])\nORDER BY [Classifica]`],
    ['Valori distinti con FILTER', `EVALUATE\n    FILTER(VALUES(${q(t.name)}[${dim.name}]), LEN(${q(t.name)}[${dim.name}]) > 3)`],
  ];
  if (date) {
    const [dt, dc] = [date.slice(0, date.indexOf('[')), date];
    out.push(['Time intelligence (YTD, anno precedente)', `DEFINE\n    MEASURE ${q(t.name)}[Totale] = ${total}\n    MEASURE ${q(t.name)}[Totale YTD] = TOTALYTD([Totale], ${dc})\n    MEASURE ${q(t.name)}[Anno precedente] = CALCULATE([Totale], SAMEPERIODLASTYEAR(${dc}))\n\nEVALUATE\n    SUMMARIZECOLUMNS(\n        ${dt}[${dc.slice(dc.indexOf('[') + 1, -1)}],\n        "Totale", [Totale], "YTD", [Totale YTD], "Anno prec.", [Anno precedente]\n    )\nORDER BY ${dc}`]);
  }
  out.push(['Tabella calendario', 'EVALUATE\n    ADDCOLUMNS(\n        CALENDAR(DATE(2024, 1, 1), DATE(2024, 12, 31)),\n        "Anno", YEAR([Date]),\n        "Mese", FORMAT([Date], "mmmm"),\n        "Trimestre", "T" & QUARTER([Date])\n    )']);
  return out;
}

/** Power BI "Vista query DAX": DEFINE / EVALUATE editor, results grid and the SQL each query compiles to. */
export function DaxQueryView() {
  const s = useStore();
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const text = s.daxQueryText;
  const setText = (t: string) => useStore.setState({ daxQueryText: t });

  useEffect(() => {
    if (!text) setText(examples(useStore.getState())[1]?.[1] ?? '');
    inserter = (ins) => {
      const el = ta.current;
      const cur = useStore.getState().daxQueryText;
      if (!el) { setText(cur + ins); return; }
      const a = el.selectionStart, b = el.selectionEnd;
      setText(cur.slice(0, a) + ins + cur.slice(b));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + ins.length, a + ins.length); });
    };
    return () => { inserter = null; };
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const queries = daxQuerySql(s.model(), text);
      const out: Result[] = [];
      for (const q of queries) {
        const t0 = performance.now();
        const r = await api.query(q.sql);
        out.push({ cols: q.columns, rows: r.rows, sql: q.sql, ms: Math.round(performance.now() - t0) });
      }
      setResults(out);
      setTab(0);
    } catch (e: any) {
      setError(e.message.split('\n')[0]);
    } finally {
      setRunning(false);
    }
  };

  const res = results[tab];
  const lines = text.split('\n').length;
  return (
    <div className="daxview">
      <div className="daxview-bar">
        <button className="btn primary" onClick={run} disabled={running || !text.trim()}><Icon name="refresh" size={14} box={32} />Esegui</button>
        <button className="btn" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2 }); }}>Esempi<Icon name="chevronDown" size={10} /></button>
        <label className="rcheck"><input type="checkbox" checked={showSql} onChange={(e) => setShowSql(e.target.checked)} />Mostra SQL generato (DuckDB)</label>
        <span className="hint">Ctrl+Invio per eseguire · clic su un campo nel riquadro Dati per inserirlo</span>
      </div>
      <div className="daxview-editor">
        <div className="gutter" ref={gutter}>{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
        <DaxInput ref={ta} value={text} onChange={setText}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
            if (e.key === 'F5') { e.preventDefault(); run(); }
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget, a = el.selectionStart;
              setText(text.slice(0, a) + '    ' + text.slice(el.selectionEnd));
              requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
            }
          }} />
      </div>
      <div className="daxview-results">
        <div className="daxview-tabs">
          {results.map((r, i) => <button key={i} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>Risultato {i + 1}</button>)}
          <span style={{ flex: 1 }} />
          {res && <span className="hint">{res.rows.length.toLocaleString('it-IT')} righe · {res.ms} ms</span>}
        </div>
        {error && <div className="pq-error" style={{ margin: 12 }}><Icon name="warning" size={18} /><div><b>Errore della query</b><div>{error}</div></div></div>}
        {!error && showSql && res && <pre className="pq-sql" style={{ maxHeight: 220 }}>{res.sql}</pre>}
        {!error && res && (
          <div className="grid-wrap">
            <table>
              <thead><tr>{res.cols.map((c) => <th key={c.name}>{c.display}</th>)}</tr></thead>
              <tbody>{res.rows.slice(0, 2000).map((r, i) => (
                <tr key={i}>{res.cols.map((c) => {
                  const v = r[c.name];
                  const num = typeof v === 'number';
                  return <td key={c.name} className={(num ? 'num' : '') + (v === null ? ' null' : '')}>{v === null ? '' : num ? fmtFull(v) : String(v)}</td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {!error && !res && <div className="pq-empty">Scrivere una query DAX (EVALUATE …) e premere <b>Esegui</b>.</div>}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {examples(s).map(([l, q]) => <button key={l} onClick={() => { setText(q); setMenu(null); }}>{l}</button>)}
        </Menu>
      )}
    </div>
  );
}
