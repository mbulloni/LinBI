import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { DbConnection } from '../types';
import { Icon } from './icons';

type Kind = DbConnection['kind'] | 'sqlserver';
const KINDS: [Kind, string, string][] = [
  ['mysql', 'MySQL / MariaDB', '3306'],
  ['postgres', 'PostgreSQL', '5432'],
  ['sqlite', 'SQLite (file)', ''],
  ['sqlserver', 'SQL Server', '1433'],
];

const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** Ottieni dati › Database: connection form, then a navigator over the tables (like Power BI). */
export function DatabaseDialog() {
  const s = useStore();
  const open = s.dbDialog;
  const [kind, setKind] = useState<Kind>('mysql');
  const [form, setForm] = useState({ host: 'localhost', port: '', database: '', user: '', password: '', file: '', remember: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<{ c: DbConnection; alias: string; tables: { schema: string; table: string; rows: number | null }[]; stored: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ columns: string[]; rows: any[] } | null>(null);

  useEffect(() => { if (open) { setConn(null); setError(null); setPicked(new Set()); setFocus(null); } }, [open]);
  useEffect(() => {
    if (!conn || !focus) { setPreview(null); return; }
    const [schema, table] = focus.split('\u0001');
    api.query(`SELECT * FROM ${qi(conn.alias)}.${qi(schema)}.${qi(table)} LIMIT 50`).then(setPreview).catch((e) => setPreview({ columns: ['Errore'], rows: [{ Errore: e.message }] }));
  }, [conn, focus]);
  if (!open) return null;

  const close = () => s.set({ dbDialog: false });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const connection = (): DbConnection => (kind === 'sqlite'
    ? { kind: 'sqlite', file: form.file }
    : { kind: kind as 'mysql' | 'postgres', host: form.host.trim() || 'localhost', port: form.port.trim() || undefined, database: form.database.trim() || undefined, user: form.user.trim() || undefined });

  const doConnect = async () => {
    setBusy(true); setError(null);
    try {
      const c = connection();
      const r = await api.dbConnect(c, kind === 'sqlite' ? null : form.password, form.remember);
      if (!r.tables.length) throw new Error('Connessione riuscita, ma il database non contiene tabelle visibili.');
      setConn({ c, ...r });
      setForm({ ...form, password: '' });
    } catch (e: any) {
      setError(e.message.split('\n')[0]);
    } finally { setBusy(false); }
  };

  const key = (t: { schema: string; table: string }) => `${t.schema}\u0001${t.table}`;
  const load = (transform: boolean) => {
    const picks = conn!.tables.filter((t) => picked.has(key(t)));
    s.loadDbTables(conn!.c, picks, transform);
  };

  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: conn ? 'min(1100px, 92vw)' : 520, height: conn ? '78vh' : undefined }}>
        <div className="dh"><h2>{conn ? 'Strumento di navigazione' : 'Database'}</h2><button onClick={close}><Icon name="close" /></button></div>
        {!conn ? (
          <div className="db pq-db">
            <label className="pq-field">Tipo di database
              <select value={kind} onChange={(e) => { const k = e.target.value as Kind; setKind(k); set({ port: '' }); }}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {kind === 'sqlserver' && (
              <div className="pq-error" style={{ margin: 0 }}><Icon name="warning" size={18} /><div><b>Non disponibile su Linux</b><div>Il motore DuckDB non ha un connettore SQL Server. In alternativa esportare le tabelle in CSV/Parquet, oppure usare una replica PostgreSQL/MySQL.</div></div></div>
            )}
            {kind === 'sqlite' && (
              <label className="pq-field">File
                <div className="pq-row">
                  <input type="text" value={form.file} onChange={(e) => set({ file: e.target.value })} placeholder="/percorso/database.sqlite" />
                  <button className="btn" style={{ minWidth: 0 }} onClick={async () => { const p = await api.openDataDialog('sqlite'); if (p) set({ file: p }); }}>Sfoglia…</button>
                </div>
              </label>
            )}
            {(kind === 'mysql' || kind === 'postgres') && <>
              <div className="pq-row">
                <label className="pq-field" style={{ flex: 3 }}>Server<input type="text" value={form.host} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="pq-field" style={{ flex: 1 }}>Porta<input type="text" value={form.port} placeholder={KINDS.find((k) => k[0] === kind)![2]} onChange={(e) => set({ port: e.target.value })} /></label>
              </div>
              <label className="pq-field">Database<input type="text" value={form.database} onChange={(e) => set({ database: e.target.value })} placeholder={kind === 'mysql' ? 'nome del database (schema)' : 'nome del database'} /></label>
              <div className="pq-row">
                <label className="pq-field" style={{ flex: 1 }}>Nome utente<input type="text" value={form.user} onChange={(e) => set({ user: e.target.value })} /></label>
                <label className="pq-field" style={{ flex: 1 }}>Password<input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doConnect()} /></label>
              </div>
              <label className="pq-check"><input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />Ricorda le credenziali (cifrate nel portachiavi di sistema, mai salvate nel report)</label>
            </>}
            <div className="pq-note">Modalità di connettività dati: <b>Importa</b> (i dati vengono copiati nel modello e aggiornati con <i>Aggiorna</i>). Al primo uso DuckDB scarica l'estensione del connettore.</div>
            {error && <div className="pq-err" style={{ userSelect: 'text' }}>{error}</div>}
          </div>
        ) : (
          <div className="db">
            <div className="nav-left" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input type="search" placeholder="Cerca" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="item"><Icon name="sql" size={16} box={32} /><b>{conn.c.kind === 'sqlite' ? conn.c.file?.split('/').pop() : `${conn.c.host}${conn.c.database ? ' / ' + conn.c.database : ''}`}</b> [{conn.tables.length}]</div>
              <div style={{ overflow: 'auto', flex: 1 }}>
                {conn.tables.filter((t) => !q || t.table.toLowerCase().includes(q.toLowerCase())).map((t) => (
                  <div key={key(t)} className={'item' + (focus === key(t) ? ' sel' : '')} style={{ paddingLeft: 14, cursor: 'pointer' }} onClick={() => setFocus(key(t))}>
                    <input type="checkbox" checked={picked.has(key(t))} onClick={(e) => e.stopPropagation()} onChange={() => { const n = new Set(picked); n.has(key(t)) ? n.delete(key(t)) : n.add(key(t)); setPicked(n); setFocus(key(t)); }} />
                    <Icon name="tableSmall" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${t.schema}.${t.table}`}>{conn.c.kind === 'postgres' && t.schema !== 'public' ? `${t.schema}.` : ''}{t.table}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="nav-right">
              <div className="ttl">{focus ? focus.split('\u0001')[1] : 'Selezionare una tabella per l\'anteprima'}</div>
              <div className="grid-wrap">
                {preview && (
                  <table>
                    <thead><tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{preview.rows.map((r, i) => <tr key={i}>{preview.columns.map((c) => <td key={c}>{r[c] === null ? '' : String(r[c])}</td>)}</tr>)}</tbody>
                  </table>
                )}
              </div>
              <div className="nav-note">{conn.stored ? 'Credenziali memorizzate nel portachiavi di sistema.' : 'Portachiavi non disponibile: le credenziali restano valide solo per questa sessione.'} Anteprima: prime 50 righe.</div>
            </div>
          </div>
        )}
        <div className="df">
          {!conn ? <>
            <button className="btn primary" disabled={busy || kind === 'sqlserver' || (kind === 'sqlite' ? !form.file : !form.host)} onClick={doConnect}>{busy ? 'Connessione…' : 'Connetti'}</button>
            <button className="btn" onClick={close}>Annulla</button>
          </> : <>
            <button className="btn primary" disabled={!picked.size} onClick={() => load(false)}>Carica</button>
            <button className="btn" disabled={!picked.size} onClick={() => load(true)}>Trasforma dati</button>
            <button className="btn" onClick={() => setConn(null)}>Indietro</button>
            <button className="btn" onClick={close}>Annulla</button>
          </>}
        </div>
      </div>
    </div>
  );
}
