import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './icons';
import { Menu } from './Menu';
import { CommandSearch } from './CommandSearch';
import type { PbiStatus } from '../api';

export function TitleBar() {
  const { filePath, dirty, past, future, undo, redo, save, sourceName } = useStore();
  const sensitivity = useStore((s) => s.report.sensitivity);
  const [max, setMax] = useState(false);
  // "Accedi": the Power BI account used by Pubblica (device-code sign-in, one per tenant profile).
  const publishOpen = useStore((s) => s.publishDialog);
  const set = useStore((s) => s.set);
  const notify = useStore((s) => s.notify);
  const [pbi, setPbi] = useState<PbiStatus | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const serviceOpen = useStore((s) => s.serviceDialog);
  useEffect(() => { if (!publishOpen && !serviceOpen) api.pbi.status().then(setPbi).catch(() => setPbi(null)); }, [publishOpen, serviceOpen]);
  const account = pbi?.account;
  const userClick = (e: React.MouseEvent) => {
    if (!account) { set({ publishDialog: true }); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.right - 260, y: r.bottom + 2 });
  };
  useEffect(() => api.win.onState(setMax), []);
  const name = filePath ? filePath.split('/').pop()!.replace(/\.lbix$/, '') : sourceName ?? 'Senza titolo';
  const title = `${name}${dirty ? ' *' : ''} - LinBI`;
  useEffect(() => api.win.setTitle(title), [title]);

  return (
    <div className="titlebar" onDoubleClick={(e) => e.target === e.currentTarget && api.win.maximize()}>
      <div className="appicon">
        <svg width="20" height="20" viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" rx="3" fill="#252423" />
          <rect x="5" y="10" width="2.4" height="5" rx=".6" fill="#F2C811" />
          <rect x="8.8" y="6" width="2.4" height="9" rx=".6" fill="#F2C811" />
          <rect x="12.6" y="8" width="2.4" height="7" rx=".6" fill="#F2C811" />
        </svg>
      </div>
      <div className="qa">
        <button title="Salva (Ctrl+S)" onClick={() => save()}><Icon name="save" /></button>
        <button title="Annulla (Ctrl+Z)" disabled={!past.length} onClick={undo}><Icon name="undo" /></button>
        <button title="Ripeti (Ctrl+Y)" disabled={!future.length} onClick={redo}><Icon name="redo" /></button>
      </div>
      <div className="title">{title}{sensitivity && <span className="sens-pill" title={sensitivity.description ?? 'Etichetta di riservatezza'}><span className="sens-dot" style={{ background: sensitivity.color ?? '#605E5C' }} />{sensitivity.name}</span>}</div>
      <CommandSearch />
      <button className="user" title={account ? `Power BI: ${account}${pbi?.profileName ? ` (${pbi.profileName})` : ''}` : 'Accedi a Power BI'} onClick={userClick}>
        <Icon name="user" size={16} />{account ? account.split('@')[0] : 'Accedi'}
      </button>
      {menu && account && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="hdr">{account}</div>
          {pbi?.profileName && <div className="hdr" style={{ fontWeight: 400 }}>Profilo: {pbi.profileName}</div>}
          <button onClick={() => { setMenu(null); set({ publishDialog: true }); }}>Pubblica / cambia profilo…</button>
          <button onClick={() => { setMenu(null); void api.openPbiPortal(); }}>Apri il servizio Power BI…</button>
          <button onClick={async () => { setMenu(null); await api.pbi.signOut(); setPbi(await api.pbi.status()); notify('Disconnesso da Power BI.'); }}>Esci</button>
        </Menu>
      )}
      <div className="winbtns">
        <button onClick={() => api.win.minimize()} title="Riduci a icona"><Icon name="winMin" /></button>
        <button onClick={() => api.win.maximize()} title={max ? 'Ripristina' : 'Ingrandisci'}><Icon name={max ? 'winRestore' : 'winMax'} /></button>
        <button className="close" onClick={() => api.win.close()} title="Chiudi"><Icon name="close" /></button>
      </div>
    </div>
  );
}
