// Ottieni dati › Power BI (servizio): with the work account, every workspace the user can see, its reports
// (downloaded as .pbix and opened like a local file) and semantic models (schema + data read with DAX queries).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, type PbiStatus, type PbiWorkspace } from '../api';
import { Icon } from './icons';

type Items = Awaited<ReturnType<typeof api.pbi.items>>;

export function ServiceDialog() {
  const s = useStore();
  const open = s.serviceDialog;
  const [st, setSt] = useState<PbiStatus | null>(null);
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('linbi.pbiEmail') ?? ''; } catch { return ''; } });
  const [browser, setBrowser] = useState(false);
  const [spaces, setSpaces] = useState<PbiWorkspace[] | null>(null);
  const [ws, setWs] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Items | null>(null);
  const [pick, setPick] = useState<{ kind: 'report' | 'dataset'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setMsg(null); setPick(null);
    api.pbi.status().then(setSt).catch((e) => setError(e.message));
    return api.pbi.onProgress((m) => setMsg(m));
  }, [open]);
  useEffect(() => {
    if (!open || !st?.account) return;
    setSpaces(null);
    api.pbi.workspaces().then((l) => { setSpaces(l); setWs((cur) => cur ?? l[0]?.id ?? null); }).catch((e) => setError(e.message));
  }, [open, st?.account]);
  useEffect(() => {
    if (ws === null || !st?.account) return;
    setItems(null); setPick(null);
    api.pbi.items(ws).then(setItems).catch((e) => setError(e.message));
  }, [ws, st?.account]);

  if (!open) return null;
  const close = () => { if (browser) api.pbi.loginBrowserCancel(); s.set({ serviceDialog: false }); };
  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const signIn = () => wrap(async () => {
    try { localStorage.setItem('linbi.pbiEmail', email.trim()); } catch { /* not kept */ }
    setBrowser(true);
    try { setSt(await api.pbi.loginBrowser(email.trim() || undefined)); } finally { setBrowser(false); }
  });
  const load = () => wrap(async () => {
    if (!pick || ws === null) return;
    if (pick.kind === 'report') {
      const file = await api.pbi.downloadReport(ws, pick.id, pick.name);
      s.set({ serviceDialog: false });
      await s.importPowerBI(file);
    } else {
      const model = await api.pbi.datasetModel(ws, pick.id, pick.name);
      s.set({ serviceDialog: false });
      await s.importPowerBI(pick.name, model);
    }
  });
  const space = spaces?.find((w) => w.id === ws);
  const shown = spaces?.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <div className="modal-bg">
      <div className="dialog svc-dlg">
        <div className="dh"><h2>Power BI — aree di lavoro</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db" style={{ flexDirection: 'column', gap: 10 }}>
          {!st ? <span className="hint">Caricamento…</span> : !st.account ? (
            <div className="publish-opt" style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <Icon name="user" size={28} box={32} />
              <span className="txt" style={{ flex: 1 }}>
                {browser ? <><b>Completare l'accesso nel browser</b><span>Scegliere l'account aziendale nella pagina Microsoft che si è aperta.</span></> : <>
                  <b>Accedere con l'account aziendale</b>
                  <span>LinBI mostra le aree di lavoro, i report e i modelli semantici a cui l'account ha accesso nel servizio Power BI.</span>
                  <label className="pq-field" style={{ marginTop: 8 }}>Indirizzo e-mail aziendale
                    <input type="email" value={email} placeholder="nome.cognome@azienda.it" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') signIn(); }} /></label>
                </>}
              </span>
              {browser ? <button className="btn" onClick={() => api.pbi.loginBrowserCancel()}>Annulla</button>
                : <button className="btn primary" disabled={busy} onClick={() => {
                  // No app registered yet: the Pubblica sign-in asks for the application ID given by the IT department.
                  if (!st.clientId && !st.builtin) { try { localStorage.setItem('linbi.pbiEmail', email.trim()); } catch { /* not kept */ } s.set({ serviceDialog: false, publishDialog: true }); } else signIn();
                }}>Accedi</button>}
            </div>
          ) : (
            <>
              <div className="pq-row pq-note"><Icon name="user" size={16} /><span style={{ flex: 1 }}>Connesso come <b>{st.account}</b></span></div>
              <div className="svc-body">
                <div className="svc-col">
                  <div className="ws-search"><Icon name="search" size={14} /><input type="search" placeholder="Cerca aree di lavoro" value={q} onChange={(e) => setQ(e.target.value)} />
                    <span className="hint">{spaces ? spaces.length : '…'}</span></div>
                  <div className="ws-list" style={{ maxHeight: 'none', flex: 1 }}>
                    {shown.map((w) => (
                      <button key={w.id || 'me'} className={'ws-item' + (w.id === ws ? ' sel' : '')} onClick={() => setWs(w.id)}>
                        <Icon name={w.id ? 'tableSmall' : 'user'} size={14} /><span>{w.name}</span>{w.dedicated && <span className="ws-badge">◆</span>}
                      </button>
                    ))}
                    {!spaces && <div className="hint" style={{ padding: 8 }}>Ricerca delle aree di lavoro…</div>}
                  </div>
                </div>
                <div className="svc-col wide">
                  <div className="roles-hd">{space?.name ?? 'Area di lavoro'}</div>
                  <div className="ws-list" style={{ maxHeight: 'none', flex: 1, borderTop: 0 }}>
                    {!items && ws !== null && <div className="hint" style={{ padding: 8 }}>Caricamento del contenuto…</div>}
                    {items && !items.reports.length && !items.datasets.length && <div className="hint" style={{ padding: 8 }}>Nessun report o modello semantico.</div>}
                    {items?.reports.map((r) => (
                      <button key={'r' + r.id} className={'ws-item' + (pick?.id === r.id ? ' sel' : '')} onClick={() => setPick({ kind: 'report', id: r.id, name: r.name })} onDoubleClick={load}>
                        <Icon name="report" size={14} /><span>{r.name}</span><span className="ws-badge">report (.pbix)</span>
                      </button>
                    ))}
                    {items?.datasets.map((d) => (
                      <button key={'d' + d.id} className={'ws-item' + (pick?.id === d.id ? ' sel' : '')} onClick={() => setPick({ kind: 'dataset', id: d.id, name: d.name })} onDoubleClick={load}>
                        <Icon name="model" size={14} /><span>{d.name}</span><span className="ws-badge">modello semantico</span>
                      </button>
                    ))}
                  </div>
                  <span className="hint">Report: scaricato come .pbix (pagine, modello e dati), se il download è consentito. Modello semantico: tabelle, relazioni e misure lette con query DAX (max 100.000 righe per tabella), senza pagine.</span>
                </div>
              </div>
            </>
          )}
          {msg && busy && <div className="hint">{msg}</div>}
          {error && <div className="pq-err" style={{ userSelect: 'text' }}>{error}</div>}
        </div>
        <div className="df">
          {st?.account && <button className="btn primary" disabled={busy || !pick} onClick={load}>{busy ? 'Caricamento…' : pick?.kind === 'report' ? 'Apri report' : 'Carica'}</button>}
          <button className="btn" onClick={close}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
