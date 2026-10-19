// Ottieni dati › Web / Feed OData / Cartella, and Power Query › Gestisci parametri.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { PQParam, TableMeta } from '../types';
import { Icon } from './icons';

const TITLE = { web: 'Da Web', odata: 'Feed OData', folder: 'Cartella' } as const;

/** New Web/OData/Folder query, opened in the Power Query editor. */
export function SourceDialog() {
  const s = useStore();
  const kind = s.sourceDialog;
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('');
  const [ext, setExt] = useState('csv');
  const [name, setName] = useState('');
  useEffect(() => { setUrl(''); setFormat(''); setName(''); }, [kind]);
  if (!kind) return null;
  const params = s.report.pqParams ?? [];
  const close = () => s.set({ sourceDialog: null });
  const guess = () => {
    const base = kind === 'folder' ? url.replace(/\/+$/, '').split('/').pop() : (() => { try { return new URL(url.replace(/#\[[^\]]+\]/g, 'x')).pathname.split('/').filter(Boolean).pop()?.replace(/\.\w+$/, ''); } catch { return ''; } })();
    return (base || TITLE[kind]).replace(/[^\w àèéìòù.-]/gi, '_');
  };
  const ok = () => {
    const taken = new Set([...s.tables.map((t) => t.name), ...(s.pq?.queries.map((q) => q.name) ?? [])]);
    let n = name.trim() || guess(), i = 2;
    while (taken.has(n)) n = `${name.trim() || guess()} (${i++})`;
    const source: TableMeta['source'] = kind === 'web' ? { path: '', web: { url: url.trim(), ...(format ? { format: format as 'csv' } : {}) } }
      : kind === 'odata' ? { path: '', odata: { url: url.trim() } } : { path: '', folder: { path: url.trim(), ext } };
    const q = { name: n, orig: null, source, steps: [] };
    close();
    if (s.pq) s.pqSet((st) => { st.queries.push(q); st.selected = n; st.step = null; });
    else s.openPowerQuery(undefined, q);
  };
  const valid = kind === 'folder' ? !!url.trim() : /^(https?:\/\/|#\[)/i.test(url.trim());
  return (
    <div className="modal-bg pq-modal">
      <div className="dialog" style={{ width: 'min(620px, 94vw)' }}>
        <div className="dh"><h2>{TITLE[kind]}</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db pq-db">
          {kind === 'folder' ? (
            <label className="pq-field">Percorso cartella
              <span className="pq-row"><input type="text" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/home/…/dati" style={{ flex: 1 }} />
                <button className="btn" onClick={async () => { const d = await api.openDir(); if (d) setUrl(d); }}>Sfoglia…</button></span>
            </label>
          ) : (
            <label className="pq-field">URL<input type="text" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === 'odata' ? 'https://services.odata.org/V4/Northwind/Northwind.svc/Customers' : 'https://…/dati.csv'} /></label>
          )}
          {kind === 'web' && (
            <label className="pq-field">Formato
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="">Automatico (estensione o tipo di contenuto)</option><option value="csv">Testo/CSV</option><option value="json">JSON</option><option value="parquet">Parquet</option><option value="xlsx">Excel</option>
              </select>
            </label>
          )}
          {kind === 'folder' && (
            <label className="pq-field">Combina i file con estensione
              <select value={ext} onChange={(e) => setExt(e.target.value)}><option value="csv">.csv</option><option value="parquet">.parquet</option><option value="json">.json</option></select>
            </label>
          )}
          <label className="pq-field">Nome della query<input type="text" value={name} placeholder={valid ? guess() : ''} onChange={(e) => setName(e.target.value)} /></label>
          <div className="pq-note">
            {kind === 'folder' ? 'I file vengono uniti allineando le colonne per nome; la colonna Source.Name indica il file di provenienza.'
              : 'I dati vengono scaricati da LinBI e conservati in cache per 10 minuti; Aggiorna li scarica di nuovo.'}
            {params.length > 0 && <> Parametri utilizzabili: {params.map((p) => <code key={p.name} style={{ marginRight: 6 }}>#[{p.name}]</code>)}.</>}
          </div>
        </div>
        <div className="df"><button className="btn primary" disabled={!valid} onClick={ok}>OK</button><button className="btn" onClick={close}>Annulla</button></div>
      </div>
    </div>
  );
}

/** Power Query › Gestisci parametri. */
export function ParamsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [list, setList] = useState<PQParam[]>(() => structuredClone(s.report.pqParams ?? []));
  const [sel, setSel] = useState(0);
  const p = list[sel];
  const set = (patch: Partial<PQParam>) => setList(list.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  const names = list.map((x) => x.name.trim());
  const bad = names.some((n) => !n || !/^[A-Za-z_][\w ]*$/.test(n)) || new Set(names).size !== names.length
    || list.some((x) => x.type === 'number' && !Number.isFinite(Number(x.value))) || list.some((x) => x.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(x.value));
  const save = () => { s.mut((r) => { r.pqParams = list.map((x) => ({ ...x, name: x.name.trim() })); }); onClose(); };
  return (
    <div className="modal-bg pq-modal">
      <div className="dialog" style={{ width: 'min(720px, 94vw)' }}>
        <div className="dh"><h2>Gestisci parametri</h2><button onClick={onClose}><Icon name="close" /></button></div>
        <div className="db pq-db">
          <div className="param-mgr">
            <div className="param-list">
              <button className="pq-link" onClick={() => { setList([...list, { name: `Parametro${list.length + 1}`, type: 'text', value: '' }]); setSel(list.length); }}>+ Nuovo</button>
              {list.map((x, i) => (
                <div key={i} className={'param-item' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                  <span>{x.name || '(senza nome)'}</span>
                  <button title="Elimina" onClick={(e) => { e.stopPropagation(); setList(list.filter((_, j) => j !== i)); setSel(Math.max(0, sel - (i <= sel ? 1 : 0))); }}><Icon name="close" size={11} /></button>
                </div>
              ))}
            </div>
            {p ? (
              <div className="param-form">
                <label className="pq-field">Nome<input type="text" value={p.name} onChange={(e) => set({ name: e.target.value })} /></label>
                <label className="pq-field">Descrizione<input type="text" value={p.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} /></label>
                <label className="pq-field">Tipo
                  <select value={p.type} onChange={(e) => set({ type: e.target.value as PQParam['type'] })}><option value="text">Testo</option><option value="number">Numero decimale</option><option value="date">Data</option></select>
                </label>
                <label className="pq-field">Valore corrente<input type={p.type === 'date' ? 'date' : 'text'} value={p.value} onChange={(e) => set({ value: e.target.value })} /></label>
                <div className="pq-note">Usare <code>#[{p.name || 'Nome'}]</code> nel percorso o nell'URL di un'origine e nei valori di Filtra righe.</div>
              </div>
            ) : <div className="pq-note">Nessun parametro. Usare <b>Nuovo</b>.</div>}
          </div>
          {bad && <div className="pq-err">Nomi univoci (lettere, cifre, spazi, _), valori numerici o date (AAAA-MM-GG) validi.</div>}
        </div>
        <div className="df"><button className="btn primary" disabled={bad} onClick={save}>OK</button><button className="btn" onClick={onClose}>Annulla</button></div>
      </div>
    </div>
  );
}
