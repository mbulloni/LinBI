import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { ColumnMeta, FilterOp, GroupOp, JoinKind, NewStep, ValueType } from '../types';
import type { PQState } from '../store';
import { compileQuery, parseNumber, qi } from '../pq/compile';
import { mToSql, referencedColumns, SUPPORTED_FUNCTIONS } from '../pq/mexpr';
import { pqTypeOf } from '../pq/steps';
import { Icon } from './icons';

export type DialogState =
  | { kind: 'choose' }
  | { kind: 'rows'; step: 'keepTop' | 'keepBottom' | 'removeTop' | 'removeBottom' }
  | { kind: 'filter'; col: string; op?: FilterOp }
  | { kind: 'replace'; cols: string[] }
  | { kind: 'split'; col: string }
  | { kind: 'group'; cols: string[] }
  | { kind: 'custom' }
  | { kind: 'merge' }
  | { kind: 'append' }
  | { kind: 'round'; cols: string[] }
  | { kind: 'advanced'; m: string; name: string };

export interface Preview { columns: ColumnMeta[]; rows: Record<string, any>[]; sql: string; at: Date; }


export const vtypeOf = (c?: ColumnMeta): ValueType => {
  const t = pqTypeOf(c?.type ?? '');
  return t === 'int' || t === 'decimal' ? 'number' : t === 'date' ? 'date' : t === 'datetime' ? 'datetime' : t === 'bool' ? 'bool' : 'text';
};

export const srcExpr = (source: Parameters<typeof api.sourceExpr>[0]) => api.sourceExpr(source);

export const FILTER_OPS: Record<'text' | 'number', [FilterOp, string][]> = {
  text: [['eq', 'è uguale a'], ['ne', 'non è uguale a'], ['startsWith', 'inizia con'], ['endsWith', 'termina con'], ['contains', 'contiene'], ['notContains', 'non contiene']],
  number: [['eq', 'è uguale a'], ['ne', 'non è uguale a'], ['gt', 'è maggiore di'], ['ge', 'è maggiore o uguale a'], ['lt', 'è minore di'], ['le', 'è minore o uguale a']],
};

function Shell({ title, sub, children, onOk, onClose, okDisabled, okLabel = 'OK', width = 520 }: {
  title: string; sub?: ReactNode; children: ReactNode; onOk?: () => void; onClose: () => void; okDisabled?: boolean; okLabel?: string; width?: number;
}) {
  return (
    <div className="modal-bg pq-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: `min(${width}px, 94vw)` }}>
        <div className="dh"><h2>{title}</h2><button onClick={onClose}><Icon name="close" /></button></div>
        <div className="db pq-db">
          {sub && <div className="pq-sub">{sub}</div>}
          {children}
        </div>
        <div className="df">
          {onOk && <button className="btn primary" disabled={okDisabled} onClick={onOk}>{okLabel}</button>}
          <button className="btn" onClick={onClose}>{onOk ? 'Annulla' : 'Chiudi'}</button>
        </div>
      </div>
    </div>
  );
}

/** Small preview grid with clickable headers (merge dialog key selection). */
function MiniGrid({ columns, rows, keyCol, onKey }: { columns: string[]; rows: Record<string, any>[]; keyCol?: string; onKey: (c: string) => void }) {
  return (
    <div className="pq-mini">
      <table>
        <thead><tr>{columns.map((c) => <th key={c} className={c === keyCol ? 'sel' : ''} onClick={() => onKey(c)}>{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{columns.map((c) => <td key={c} className={c === keyCol ? 'sel' : ''}>{r[c] === null ? 'null' : String(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

interface Props {
  dialog: DialogState;
  close: () => void;
  add: (s: NewStep) => void;
  preview: Preview | null;
  pq: PQState;
  notify: (m: string) => void;
}

export function PQDialog(p: Props) {
  switch (p.dialog.kind) {
    case 'choose': return <ChooseColumns {...p} />;
    case 'rows': return <RowsCount {...p} step={p.dialog.step} />;
    case 'filter': return <FilterRows {...p} col={p.dialog.col} op={p.dialog.op} />;
    case 'replace': return <ReplaceValues {...p} cols={p.dialog.cols} />;
    case 'split': return <SplitColumn {...p} col={p.dialog.col} />;
    case 'group': return <GroupBy {...p} cols={p.dialog.cols} />;
    case 'custom': return <CustomColumn {...p} />;
    case 'merge': return <Merge {...p} />;
    case 'append': return <Append {...p} />;
    case 'round': return <Round {...p} cols={p.dialog.cols} />;
    case 'advanced': return <Advanced {...p} m={p.dialog.m} name={p.dialog.name} />;
  }
}

function ChooseColumns({ close, add, preview }: Props) {
  const cols = preview?.columns.map((c) => c.name) ?? [];
  const [keep, setKeep] = useState<Set<string>>(new Set(cols));
  const [q, setQ] = useState('');
  const all = keep.size === cols.length;
  return (
    <Shell title="Scegli colonne" sub="Scegliere le colonne da mantenere" onClose={close} okDisabled={!keep.size}
      onOk={() => { if (!all) add({ kind: 'selectColumns', columns: cols.filter((c) => keep.has(c)) }); close(); }}>
      <input type="search" placeholder="Cerca colonne" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pq-checklist">
        <label><input type="checkbox" checked={all} onChange={() => setKeep(all ? new Set() : new Set(cols))} />(Seleziona tutte le colonne)</label>
        {cols.filter((c) => c.toLowerCase().includes(q.toLowerCase())).map((c) => (
          <label key={c}><input type="checkbox" checked={keep.has(c)} onChange={() => { const n = new Set(keep); n.has(c) ? n.delete(c) : n.add(c); setKeep(n); }} />{c}</label>
        ))}
      </div>
    </Shell>
  );
}

const ROWS_TEXT = {
  keepTop: ['Mantieni prime righe', 'Specificare quante righe mantenere a partire dall\'inizio.'],
  keepBottom: ['Mantieni ultime righe', 'Specificare quante righe mantenere a partire dalla fine.'],
  removeTop: ['Rimuovi prime righe', 'Specificare quante righe rimuovere a partire dall\'inizio.'],
  removeBottom: ['Rimuovi ultime righe', 'Specificare quante righe rimuovere a partire dalla fine.'],
} as const;

function RowsCount({ close, add, step }: Props & { step: keyof typeof ROWS_TEXT }) {
  const [n, setN] = useState('');
  const v = Number(n);
  const ok = Number.isInteger(v) && v > 0;
  return (
    <Shell title={ROWS_TEXT[step][0]} sub={ROWS_TEXT[step][1]} onClose={close} okDisabled={!ok} onOk={() => { add({ kind: step, n: v }); close(); }}>
      <label className="pq-field">Numero di righe<input type="number" min={1} autoFocus value={n} onChange={(e) => setN(e.target.value)} /></label>
    </Shell>
  );
}

function FilterRows({ close, add, preview, col, op: op0 }: Props & { col: string; op?: FilterOp }) {
  const meta = preview?.columns.find((c) => c.name === col);
  const vt = vtypeOf(meta);
  const ops = vt === 'text' ? FILTER_OPS.text : FILTER_OPS.number;
  const [op, setOp] = useState<FilterOp>(op0 ?? 'eq');
  const [value, setValue] = useState('');
  const bad = vt === 'number' && parseNumber(value) === null;
  return (
    <Shell title="Filtra righe" sub={<>Applicare una o più condizioni di filtro alle righe della tabella.<br />Mantieni le righe in cui <b>{col}</b></>}
      onClose={close} okDisabled={!value.trim() || bad}
      onOk={() => { add({ kind: 'filterRows', column: col, op, value: value.trim(), vtype: vt }); close(); }}>
      <div className="pq-row">
        <select value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="text" autoFocus placeholder={vt === 'date' ? 'AAAA-MM-GG' : vt === 'number' ? 'Immettere un numero' : 'Immettere un valore'} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {bad && value && <div className="pq-err">Immettere un numero valido.</div>}
    </Shell>
  );
}

function ReplaceValues({ close, add, preview, cols }: Props & { cols: string[] }) {
  const metas = cols.map((c) => preview?.columns.find((x) => x.name === c));
  const vt = vtypeOf(metas[0]);
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [whole, setWhole] = useState(false);
  const bad = vt === 'number' && (parseNumber(find) === null || parseNumber(repl) === null);
  return (
    <Shell title="Sostituisci valori" sub="Sostituire un valore con un altro nelle colonne selezionate." onClose={close} okDisabled={bad || (vt === 'text' && !whole && !find)}
      onOk={() => { add({ kind: 'replaceValues', columns: cols, find, replace: repl, vtype: vt, whole: vt !== 'text' || whole }); close(); }}>
      <label className="pq-field">Valore da trovare<input type="text" autoFocus value={find} onChange={(e) => setFind(e.target.value)} /></label>
      <label className="pq-field">Sostituisci con<input type="text" value={repl} onChange={(e) => setRepl(e.target.value)} /></label>
      {vt === 'text' && <label className="pq-check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />Confronta intero contenuto della cella</label>}
      <div className="pq-note">Colonne: {cols.join(', ')}</div>
    </Shell>
  );
}

const DELIMS: [string, string][] = [[',', 'Virgola'], [';', 'Punto e virgola'], [':', 'Due punti'], [' ', 'Spazio'], ['\t', 'Tabulazione'], ['-', 'Trattino'], ['', '--Personalizzato--']];

function SplitColumn({ close, add, preview, col, notify }: Props & { col: string }) {
  const [d, setD] = useState(',');
  const [custom, setCustom] = useState('');
  const delim = d === '' ? custom : d;
  const ok = async () => {
    try {
      const r = await api.query(`SELECT max(len(string_split(CAST(${qi(col)} AS VARCHAR), '${delim.replace(/'/g, "''")}'))) AS n FROM (${preview!.sql})`);
      add({ kind: 'splitColumn', column: col, delimiter: delim, parts: Math.max(1, Number(r.rows[0]?.n ?? 1)) });
      close();
    } catch (e: any) { notify(e.message); }
  };
  return (
    <Shell title="Dividi colonna in base al delimitatore" sub={<>Specificare il delimitatore usato per dividere la colonna <b>{col}</b>.</>} onClose={close} okDisabled={!delim || !preview} onOk={ok}>
      <label className="pq-field">Selezionare o immettere il delimitatore
        <select value={d} onChange={(e) => setD(e.target.value)}>{DELIMS.map(([k, l]) => <option key={l} value={k}>{l}</option>)}</select>
      </label>
      {d === '' && <input type="text" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} />}
      <div className="pq-note">Dividi in corrispondenza di ogni occorrenza del delimitatore. Il numero di colonne è calcolato sui dati.</div>
    </Shell>
  );
}

const GROUP_OPS: [GroupOp, string][] = [['count', 'Conteggio righe'], ['countd', 'Conteggio valori distinti'], ['sum', 'Somma'], ['avg', 'Media'], ['median', 'Mediana'], ['min', 'Min'], ['max', 'Max']];

function GroupBy({ close, add, preview, cols }: Props & { cols: string[] }) {
  const all = preview?.columns ?? [];
  const [keys, setKeys] = useState<string[]>(cols.length ? cols : all[0] ? [all[0].name] : []);
  const [aggs, setAggs] = useState<{ name: string; op: GroupOp; column?: string }[]>([{ name: 'Conteggio', op: 'count' }]);
  const numeric = all.find((c) => vtypeOf(c) === 'number')?.name ?? all[0]?.name;
  const valid = aggs.every((a) => a.name.trim() && (a.op === 'count' || a.column)) && new Set([...keys, ...aggs.map((a) => a.name)]).size === keys.length + aggs.length;
  const setAgg = (i: number, patch: Partial<(typeof aggs)[number]>) => setAggs(aggs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <Shell title="Raggruppa per" sub="Specificare le colonne in base a cui raggruppare e uno o più output." width={640} onClose={close} okDisabled={!valid}
      onOk={() => { add({ kind: 'groupBy', keys, aggs: aggs.map((a) => (a.op === 'count' ? { name: a.name.trim(), op: a.op } : { ...a, name: a.name.trim() })) }); close(); }}>
      <div className="pq-label">Raggruppa per</div>
      {keys.map((k, i) => (
        <div className="pq-row" key={i}>
          <select value={k} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? e.target.value : x)))}>{all.map((c) => <option key={c.name}>{c.name}</option>)}</select>
          <button className="pq-x" title="Rimuovi" onClick={() => setKeys(keys.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button className="pq-link" onClick={() => setKeys([...keys, all.find((c) => !keys.includes(c.name))?.name ?? all[0].name])}>Aggiungi raggruppamento</button>
      <div className="pq-label" style={{ marginTop: 12 }}>Nome nuova colonna · Operazione · Colonna</div>
      {aggs.map((a, i) => (
        <div className="pq-row" key={i}>
          <input type="text" value={a.name} onChange={(e) => setAgg(i, { name: e.target.value })} />
          <select value={a.op} onChange={(e) => { const op = e.target.value as GroupOp; setAgg(i, { op, column: op === 'count' ? undefined : a.column ?? numeric }); }}>
            {GROUP_OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={a.column ?? ''} disabled={a.op === 'count'} onChange={(e) => setAgg(i, { column: e.target.value })}>
            <option value="" disabled />{all.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
          <button className="pq-x" title="Rimuovi" onClick={() => setAggs(aggs.filter((_, j) => j !== i))} disabled={aggs.length === 1}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button className="pq-link" onClick={() => setAggs([...aggs, { name: `Conteggio${aggs.length}`, op: 'sum', column: numeric }])}>Aggiungi aggregazione</button>
    </Shell>
  );
}

function CustomColumn({ close, add, preview }: Props) {
  const cols = preview?.columns.map((c) => c.name) ?? [];
  const [name, setName] = useState('Personalizzato');
  const [formula, setFormula] = useState('');
  const [pick, setPick] = useState(cols[0] ?? '');
  const check = useMemo(() => {
    if (!formula.trim()) return { ok: false, msg: '' };
    try {
      mToSql(formula);
      const missing = referencedColumns(formula).filter((c) => !cols.includes(c));
      if (missing.length) return { ok: false, msg: `Impossibile trovare la colonna "${missing[0]}".` };
      return { ok: true, msg: 'Nessun errore di sintassi rilevato.' };
    } catch (e: any) { return { ok: false, msg: 'Expression.SyntaxError: ' + e.message }; }
  }, [formula, cols.join('\u0001')]);
  const taken = cols.includes(name.trim());
  return (
    <Shell title="Colonna personalizzata" sub="Aggiungere una colonna calcolata da altre colonne." width={760} onClose={close} okDisabled={!check.ok || !name.trim() || taken}
      onOk={() => { add({ kind: 'customColumn', name: name.trim(), formula: formula.trim() }); close(); }}>
      <div className="pq-custom">
        <div className="pq-custom-main">
          <label className="pq-field">Nome nuova colonna<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          {taken && <div className="pq-err">Esiste già una colonna con questo nome.</div>}
          <div className="pq-label">Formula colonna personalizzata</div>
          <div className="pq-formula"><span>=</span><textarea autoFocus spellCheck={false} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder='es. [Sales] - [COGS]   oppure   if [Units Sold] > 1000 then "Alto" else "Basso"' /></div>
          <div className={check.ok ? 'pq-ok' : 'pq-err'}>{check.ok ? '✓ ' : ''}{check.msg}</div>
          <details className="pq-note"><summary>Funzioni M supportate</summary>{SUPPORTED_FUNCTIONS.join(', ')}; operatori + - * / &amp; = &lt;&gt; &lt; &gt; and or not, if … then … else.</details>
        </div>
        <div className="pq-custom-cols">
          <div className="pq-label">Colonne disponibili</div>
          <div className="pq-checklist">{cols.map((c) => <div key={c} className={'pq-colitem' + (c === pick ? ' sel' : '')} onClick={() => setPick(c)} onDoubleClick={() => setFormula(formula + `[${c}]`)} title="Doppio clic per inserire">{c}</div>)}</div>
          <button className="btn" onClick={() => setFormula(formula + `[${pick}]`)} disabled={!pick}>&lt;&lt; Inserisci</button>
        </div>
      </div>
    </Shell>
  );
}

/** Columns + first rows of another query, compiled from the editor's drafts. */
function useQueryPreview(pq: PQState, name: string) {
  const [res, setRes] = useState<{ columns: string[]; rows: Record<string, any>[]; sql: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const q = pq.queries.find((x) => x.name === name);
    setRes(null); setErr(null);
    if (!q) return;
    let dead = false;
    (async () => {
      try {
        const sql = await compileQuery(q, pq.queries, { srcExpr });
        const r = await api.query(`SELECT * FROM (${sql}) LIMIT 5`);
        const d = await api.query(`DESCRIBE SELECT * FROM (${sql})`);
        if (!dead) setRes({ columns: d.rows.map((x) => x.column_name), rows: r.rows, sql });
      } catch (e: any) { if (!dead) setErr(e.message.split('\n')[0]); }
    })();
    return () => { dead = true; };
  }, [pq, name]);
  return { res, err };
}

const JOINS: [JoinKind, string][] = [['left', 'Esterno sinistro (tutte dalla prima, corrispondenti dalla seconda)'], ['right', 'Esterno destro (tutte dalla seconda, corrispondenti dalla prima)'], ['full', 'Esterno completo (tutte le righe da entrambe)'], ['inner', 'Interno (solo righe corrispondenti)'], ['leftAnti', 'Anti sinistro (solo righe nella prima)']];

function Merge({ close, add, preview, pq }: Props) {
  const others = pq.queries.filter((q) => q.name !== pq.selected).map((q) => q.name);
  const [other, setOther] = useState(others[0] ?? '');
  const [lk, setLk] = useState<string | undefined>();
  const [rk, setRk] = useState<string | undefined>();
  const [join, setJoin] = useState<JoinKind>('left');
  const [expand, setExpand] = useState<Set<string> | null>(null);
  const [stats, setStats] = useState<string>('');
  const { res, err } = useQueryPreview(pq, other);
  useEffect(() => { setRk(undefined); setExpand(null); }, [other]);
  useEffect(() => {
    if (res && lk && !rk) setRk(res.columns.find((c) => c.toLowerCase() === lk.toLowerCase()));
  }, [res, lk]);
  useEffect(() => {
    setStats('');
    if (!preview || !res || !lk || !rk) return;
    api.query(`SELECT count(*) AS n, count(*) FILTER (WHERE l.${qi(lk)} IN (SELECT r.${qi(rk)} FROM (${res.sql}) r)) AS m FROM (${preview.sql}) l`)
      .then((r) => setStats(`La selezione corrisponde a ${Number(r.rows[0].m).toLocaleString('it-IT')} di ${Number(r.rows[0].n).toLocaleString('it-IT')} righe della prima tabella.`))
      .catch((e) => setStats('⚠ ' + e.message.split('\n')[0]));
  }, [preview?.sql, res?.sql, lk, rk]);
  const exp = expand ?? new Set((res?.columns ?? []).filter((c) => c !== rk));
  return (
    <Shell title="Unisci" sub="Selezionare una tabella e le colonne corrispondenti per creare una tabella unita." width={860} onClose={close}
      okDisabled={!lk || !rk || !res || (join !== 'leftAnti' && !exp.size)}
      onOk={() => { add({ kind: 'merge', table: other, left: [lk!], right: [rk!], join, expand: res!.columns.filter((c) => exp.has(c)) }); close(); }}>
      <div className="pq-label">{pq.selected}</div>
      <MiniGrid columns={preview?.columns.map((c) => c.name) ?? []} rows={preview?.rows ?? []} keyCol={lk} onKey={setLk} />
      <select value={other} onChange={(e) => setOther(e.target.value)} style={{ marginTop: 10 }}>{others.map((o) => <option key={o}>{o}</option>)}</select>
      {err && <div className="pq-err">{err}</div>}
      {res && <MiniGrid columns={res.columns} rows={res.rows} keyCol={rk} onKey={setRk} />}
      <div className="pq-row" style={{ marginTop: 10 }}>
        <label className="pq-field" style={{ flex: 1 }}>Tipo di join<select value={join} onChange={(e) => setJoin(e.target.value as JoinKind)}>{JOINS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      {res && join !== 'leftAnti' && (
        <>
          <div className="pq-label">Colonne da espandere (prefisso “{other}.”)</div>
          <div className="pq-chips">{res.columns.map((c) => (
            <label key={c}><input type="checkbox" checked={exp.has(c)} onChange={() => { const n = new Set(exp); n.has(c) ? n.delete(c) : n.add(c); setExpand(n); }} />{c}</label>
          ))}</div>
        </>
      )}
      <div className="pq-note">{!lk || !rk ? 'Fare clic sull\'intestazione della colonna chiave in entrambe le tabelle.' : stats}</div>
    </Shell>
  );
}

function Append({ close, add, pq }: Props) {
  const others = pq.queries.filter((q) => q.name !== pq.selected).map((q) => q.name);
  const [sel, setSel] = useState<string[]>(others.slice(0, 1));
  return (
    <Shell title="Accoda" sub="Concatenare le righe di più tabelle. Le colonne con lo stesso nome vengono allineate; le altre restano vuote (null)." onClose={close} okDisabled={!sel.length}
      onOk={() => { add({ kind: 'append', tables: sel }); close(); }}>
      <div className="pq-label">Tabelle da accodare a “{pq.selected}”</div>
      <div className="pq-checklist">{others.map((o) => (
        <label key={o}><input type="checkbox" checked={sel.includes(o)} onChange={() => setSel(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])} />{o}</label>
      ))}</div>
    </Shell>
  );
}

function Round({ close, add, cols }: Props & { cols: string[] }) {
  const [d, setD] = useState('2');
  const v = Number(d);
  return (
    <Shell title="Arrotonda" sub="Specificare il numero di cifre decimali." onClose={close} okDisabled={!Number.isInteger(v) || v < 0}
      onOk={() => { add({ kind: 'transform', columns: cols, fn: 'round', digits: v }); close(); }}>
      <label className="pq-field">Posizioni decimali<input type="number" min={0} autoFocus value={d} onChange={(e) => setD(e.target.value)} /></label>
    </Shell>
  );
}

function Advanced({ close, m, name, notify }: Props & { m: string; name: string }) {
  return (
    <Shell title={name} sub="Codice M generato dai passaggi applicati (sola lettura: modificare i passaggi dall'editor)." width={900} onClose={close}
      onOk={() => { navigator.clipboard.writeText(m); notify('Codice M copiato negli appunti.'); }} okLabel="Copia">
      <pre className="pq-code">{m}</pre>
    </Shell>
  );
}
