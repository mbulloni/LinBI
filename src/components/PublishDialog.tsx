import { useEffect, useRef, useState } from 'react';
import { api, type PbiResult, type PbiStatus, type PbiWorkspace } from '../api';
import { prepareCfExport, useStore } from '../store';
import { buildFabricModel, buildPushSchema, buildReportParts, buildThinPbixParts } from '../pbix/pbit';
import { Icon } from './icons';

type Mode = 'push' | 'fabric';

/** "Pubblica": straight to the Power BI service through its REST APIs (push dataset + thin report
 *  with Pro, full semantic model on Fabric/Premium capacity), or one of the file-based routes. */
export function PublishDialog() {
  const s = useStore();
  const open = s.publishDialog;
  const [st, setSt] = useState<PbiStatus | null>(null);
  // Settings form: 'edit' = app of the active profile, 'new' = another profile (another app/tenant).
  const [setup, setSetup] = useState<false | 'edit' | 'new'>(false);
  const [profName, setProfName] = useState('');
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('organizations');
  const [confirmDel, setConfirmDel] = useState(false);
  const [login, setLogin] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [spaces, setSpaces] = useState<PbiWorkspace[] | null>(null);
  const [ws, setWs] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('push');
  const [name, setName] = useState('');
  const [keepDb, setKeepDb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [frac, setFrac] = useState<number | null>(null);
  const [result, setResult] = useState<PbiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const base = (s.filePath?.split('/').pop() ?? s.sourceName ?? 'Report').replace(/\.(lbix|pbix|pbit|pbip)$/i, '');
  const hasDb = s.tables.some((t) => t.source.db && t.source.db.kind !== 'sqlite');

  useEffect(() => {
    if (!open) return;
    setLog([]); setResult(null); setError(null); setFrac(null); setName(base);
    setConfirmDel(false);
    api.pbi.status().then((x) => { setSt(x); fillSetup(x); setSetup(x.clientId ? false : 'edit'); }).catch((e) => setError(e.message));
    return api.pbi.onProgress((msg, f) => { setLog((l) => [...l.slice(-200), msg]); if (f !== null) setFrac(f); });
  }, [open]);

  useEffect(() => {
    if (!open || !st?.account) return;
    api.pbi.workspaces().then((list) => {
      setSpaces(list);
      if (!list.length) { setWs(null); return; }
      const pick = list.find((w) => w.id === st.lastWorkspace) ?? list.find((w) => w.dedicated) ?? list[0];
      setWs(pick.id);
      setMode(pick.dedicated ? 'fabric' : 'push');
    }).catch((e) => setError(e.message));
  }, [open, st?.profileId, st?.account]);

  function fillSetup(x: PbiStatus | null) {
    setProfName(x?.profileName || (x?.profiles.length ? '' : 'Predefinito'));
    setClientId(x?.clientId ?? ''); setTenant(x?.tenant ?? 'organizations');
  }

  if (!open) return null;
  const close = () => { if (login) api.pbi.loginCancel(); setLogin(null); s.set({ publishDialog: false }); };
  const go = (fn: () => void) => () => { close(); fn(); };
  const empty = !s.tables.length;
  const space = spaces?.find((w) => w.id === ws);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const fresh = (x: PbiStatus) => { setSt(x); setSpaces(null); setWs(null); setLog([]); setResult(null); setConfirmDel(false); };
  const saveSetup = () => wrap(async () => {
    fresh(setup === 'new' ? await api.pbi.addProfile(clientId, tenant, profName) : await api.pbi.configure(clientId, tenant, profName));
    setSetup(false);
  });
  const newProfile = () => { setProfName(''); setClientId(''); setTenant('organizations'); setSetup('new'); setConfirmDel(false); };
  const editProfile = () => { fillSetup(st); setSetup('edit'); setConfirmDel(false); };
  const pickProfile = (id: string) => wrap(async () => { if (login) { await api.pbi.loginCancel(); setLogin(null); } fresh(await api.pbi.selectProfile(id)); });
  const removeProfile = () => wrap(async () => { const x = await api.pbi.removeProfile(); fresh(x); fillSetup(x); if (!x.clientId) setSetup('edit'); });
  const signIn = () => wrap(async () => {
    const code = await api.pbi.loginStart();
    setLogin(code);
    api.openExternal(code.verificationUri).catch(() => {});
    try { setSt(await api.pbi.loginWait()); } finally { setLogin(null); }
  });
  const signOut = () => wrap(async () => { await api.pbi.signOut(); setSt({ ...st!, account: null }); setSpaces(null); });

  const publish = () => wrap(async () => {
    setLog([]); setResult(null); setFrac(null);
    await prepareCfExport();
    const { report, tables } = useStore.getState();
    let spec: unknown;
    const pre: string[] = [];
    if (mode === 'push') {
      const { schema, warnings } = buildPushSchema(report, tables);
      pre.push(...warnings);
      spec = { workspace: ws, name: name.trim(), schema, thinParts: buildThinPbixParts(report), reportParts: buildReportParts(report, false) };
    } else {
      const { model, embed, warnings } = buildFabricModel(report, tables, keepDb);
      pre.push(...warnings);
      spec = { workspace: ws, name: name.trim(), model, embed, reportParts: buildReportParts(report) };
    }
    setLog(pre);
    const r = await api.pbi.publish(mode, spec);
    setResult({ ...r, warnings: [...pre, ...r.warnings] });
    setFrac(1);
  });

  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 720, maxHeight: '90vh' }}>
        <div className="dh"><h2>Pubblica in Power BI</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db pq-db">
          {!setup && st && st.profiles.length > 0 && (
            <div className="pq-row">
              <label className="pq-field" style={{ flex: 1 }}>Profilo (tenant)
                <select value={st.profileId ?? ''} disabled={busy} onChange={(e) => pickProfile(e.target.value)}>
                  {st.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.account ? ` — ${p.account}` : ''}</option>)}
                </select>
              </label>
              <button className="btn" style={{ minWidth: 0, alignSelf: 'flex-end' }} disabled={busy} onClick={newProfile}>Nuovo profilo</button>
              {confirmDel
                ? <><button className="btn primary" style={{ minWidth: 0, alignSelf: 'flex-end' }} disabled={busy} onClick={removeProfile}>Elimina «{st.profileName}»</button>
                    <button className="btn" style={{ minWidth: 0, alignSelf: 'flex-end' }} onClick={() => setConfirmDel(false)}>Annulla</button></>
                : <button className="btn" style={{ minWidth: 0, alignSelf: 'flex-end' }} disabled={busy} onClick={() => setConfirmDel(true)}>Elimina</button>}
            </div>
          )}
          {setup ? (
            <>
              <div className="pq-note">
                LinBI accede a Power BI con un'<b>app registrata nel tenant Microsoft Entra</b> della propria organizzazione (serve un account aziendale con licenza Power BI Pro, PPU o capacità Fabric). Una volta sola, in <i>portal.azure.com › Microsoft Entra ID › Registrazioni app</i>:
                <ol className="pbi-steps">
                  <li><b>Nuova registrazione</b>: nome a scelta (es. LinBI), «Solo account in questa directory organizzativa», nessun URI di reindirizzamento.</li>
                  <li><b>Autenticazione</b> › «Consenti flussi client pubblici»: <b>Sì</b>.</li>
                  <li><b>Autorizzazioni API</b> › Aggiungi › <b>Power BI Service</b> › Autorizzazioni delegate: Workspace.Read.All, Dataset.ReadWrite.All, Report.ReadWrite.All, Content.Create; per il modello completo anche Item.ReadWrite.All. Se richiesto, far concedere il consenso dall'amministratore.</li>
                  <li>Copiare qui <b>ID applicazione (client)</b> e <b>ID directory (tenant)</b>.</li>
                </ol>
              </div>
              <div className="pq-row">
                <label className="pq-field" style={{ flex: 1 }}>Nome del profilo<input type="text" value={profName} onChange={(e) => setProfName(e.target.value)} placeholder="es. Tenant di test" /></label>
              </div>
              <div className="pq-row">
                <label className="pq-field" style={{ flex: 1 }}>ID applicazione (client)<input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" /></label>
                <label className="pq-field" style={{ flex: 1 }}>ID directory (tenant)<input type="text" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="organizations" /></label>
              </div>
            </>
          ) : !st?.account ? (
            <div className="publish-opt" style={{ alignItems: 'center' }}>
              <Icon name="user" size={28} box={32} />
              <span className="txt" style={{ flex: 1 }}>
                {login ? <>
                  <b>Accesso in corso</b>
                  <span>Nel browser aperto su <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal(login.verificationUri); }}>{login.verificationUri}</a> inserire il codice:</span>
                  <span className="pbi-code" style={{ userSelect: 'text' }}>{login.userCode}</span>
                </> : <>
                  <b>Non connesso a Power BI</b>
                  <span>Accesso con il codice dispositivo: si completa nel browser, la password non passa da LinBI.</span>
                </>}
              </span>
              {login ? <button className="btn" onClick={() => { api.pbi.loginCancel(); setLogin(null); }}>Annulla</button>
                : <button className="btn primary" disabled={busy} onClick={signIn}>Accedi</button>}
            </div>
          ) : (
            <>
              <div className="pq-row pq-note">
                <Icon name="user" size={16} /><span style={{ flex: 1 }}>Connesso come <b>{st.account}</b>{st.persistent ? '' : ' (solo per questa sessione: portachiavi non disponibile)'}</span>
                <button className="btn" style={{ minWidth: 0 }} disabled={busy} onClick={signOut}>Esci</button>
              </div>
              <div className="pq-row">
                <label className="pq-field" style={{ flex: 2 }}>Area di lavoro
                  <select value={ws ?? ''} disabled={!spaces || busy} onChange={(e) => { const w = spaces!.find((x) => x.id === e.target.value)!; setWs(w.id); setMode(w.dedicated ? 'fabric' : 'push'); }}>
                    {!spaces && <option>Caricamento…</option>}
                    {spaces?.map((w) => <option key={w.id} value={w.id}>{w.name}{w.dedicated ? ' ◆ capacità' : ''}</option>)}
                  </select>
                </label>
                <label className="pq-field" style={{ flex: 2 }}>Nome del report e del modello<input type="text" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
              </div>
              <label className={'publish-opt' + (mode === 'fabric' ? ' sel' : '')} style={{ opacity: space?.dedicated ? 1 : 0.55 }}>
                <input type="radio" checked={mode === 'fabric'} disabled={!space?.dedicated || busy} onChange={() => setMode('fabric')} />
                <span className="txt"><b>Modello semantico completo</b><span>Area di lavoro su capacità Fabric, Premium o PPU. Il servizio costruisce il modello (relazioni, misure, colonne e tabelle calcolate) e lo aggiorna; i dati locali vengono incorporati nel modello, senza gateway.</span>
                  {mode === 'fabric' && hasDb && <span className="pq-check"><input type="checkbox" checked={keepDb} disabled={busy} onChange={(e) => setKeepDb(e.target.checked)} />Mantieni le connessioni ai database (server raggiungibile dal servizio o gateway) invece di incorporare i dati</span>}
                </span>
              </label>
              <label className={'publish-opt' + (mode === 'push' ? ' sel' : '')}>
                <input type="radio" checked={mode === 'push'} disabled={busy} onChange={() => setMode('push')} />
                <span className="txt"><b>Dataset push + report (Power BI Pro)</b><span>Qualsiasi area di lavoro. LinBI invia tabelle, relazioni, misure DAX e righe; colonne calcolate come valori fissi, max 5 milioni di righe per tabella. Per aggiornare i dati si ripubblica.</span></span>
              </label>
            </>
          )}
          {(log.length > 0 || busy && st?.account) && (
            <div className="pbi-log" ref={logRef}>
              {frac !== null && <div className="pbi-bar"><div style={{ width: `${Math.round(frac * 100)}%` }} /></div>}
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {result && (
            <div className="pq-error" style={{ margin: 0, background: '#DFF6DD', borderColor: '#9FD89F' }}>
              <Icon name="info" size={18} box={32} />
              <div><b>Pubblicato</b>
                {result.webUrl ? <div><a href="#" onClick={(e) => { e.preventDefault(); api.openExternal(result.webUrl!); }}>Apri il report in Power BI</a></div> : null}
                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            </div>
          )}
          {error && <div className="pq-err" style={{ userSelect: 'text' }}>{error}</div>}

          <details className="pbi-other">
            <summary>Altri modi di condividere</summary>
            <button className="publish-opt" disabled={empty} onClick={go(() => s.exportPbit())}>
              <Icon name="publish" size={24} box={32} />
              <span className="txt"><b>Modello Power BI (.pbit)</b><span>Da aprire in Power BI Desktop, che ricarica i dati dalle origini.</span></span>
            </button>
            <button className="publish-opt" disabled={empty} onClick={go(() => s.exportPbip())}>
              <Icon name="docs" size={24} box={32} />
              <span className="txt"><b>Progetto Power BI (.pbip) → Git / Fabric</b><span>File di testo con metadati <code>.platform</code> per l'integrazione Git di un'area di lavoro Fabric.</span></span>
            </button>
            <button className="publish-opt" disabled={!s.report.pages.some((p) => p.visuals.length)} onClick={go(() => s.exportPdf())}>
              <Icon name="newPage" size={24} box={32} />
              <span className="txt"><b>PDF</b><span>Tutte le pagine del report.</span></span>
            </button>
            <button className="publish-opt" onClick={go(() => s.save(true))}>
              <Icon name="save" size={24} />
              <span className="txt"><b>File LinBI (.lbix) con i dati</b><span>Si apre con LinBI senza accedere alle origini.</span></span>
            </button>
          </details>
        </div>
        <div className="df">
          {setup ? <>
            <button className="btn primary" disabled={busy || !clientId.trim() || !profName.trim()} onClick={saveSetup}>{setup === 'new' ? 'Crea profilo' : 'Salva'}</button>
            {st?.clientId && <button className="btn" onClick={() => setSetup(false)}>Annulla</button>}
          </> : <>
            {st?.account && <button className="btn primary" disabled={busy || empty || !space || !name.trim() || (mode === 'fabric' && !space.dedicated)} onClick={publish}>{busy ? 'Pubblicazione…' : 'Pubblica'}</button>}
            <button className="btn" disabled={busy} onClick={editProfile}>Impostazioni app</button>
          </>}
          <button className="btn" onClick={close}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
