import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './icons';
import logo from '../assets/logo.png';
import { Menu } from './Menu';
import { CommandSearch } from './CommandSearch';
import { setAppTheme, useAppTheme, type AppThemePref } from '../appTheme';

const THEME_UI: [AppThemePref, string, string][] = [['light', 'sun', 'Chiaro'], ['dark', 'moon', 'Scuro'], ['system', 'themeAuto', 'Usa impostazione di sistema']];

/** Tema dell'interfaccia (like the sun button of Power BI Desktop's title bar). */
function ThemeButton() {
  const pref = useAppTheme();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const cur = THEME_UI.find((t) => t[0] === pref) ?? THEME_UI[0];
  return <>
    <button className="theme-btn" title={`Tema: ${cur[2]}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2 }); }}>
      <Icon name={cur[1]} size={16} /><Icon name="chevronDown" size={10} />
    </button>
    {menu && (
      <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
        <div className="hdr">Tema</div>
        {THEME_UI.map(([k, icon, label]) => (
          <button key={k} onClick={() => { setMenu(null); setAppTheme(k); }}>
            <span style={{ width: 12 }}>{pref === k ? '✓' : ''}</span><Icon name={icon} size={16} />{label}
          </button>
        ))}
      </Menu>
    )}
  </>;
}
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
  const name = filePath ? filePath.split('/').pop()!.replace(/\.mibx$/, '') : sourceName ?? 'Senza titolo';
  const title = `${name}${dirty ? ' *' : ''} - MiB-BI`;
  useEffect(() => api.win.setTitle(title), [title]);

  return (
    <div className="titlebar" onDoubleClick={(e) => e.target === e.currentTarget && api.win.maximize()}>
      <div className="appicon">
        <img src={logo} width={20} height={20} alt="MiB-BI" draggable={false} />
      </div>
      <div className="qa">
        <button title="Salva (Ctrl+S)" onClick={() => save()}><Icon name="save" /></button>
        <button title="Annulla (Ctrl+Z)" disabled={!past.length} onClick={undo}><Icon name="undo" /></button>
        <button title="Ripeti (Ctrl+Y)" disabled={!future.length} onClick={redo}><Icon name="redo" /></button>
      </div>
      <div className="title">{title}{sensitivity && <span className="sens-pill" title={sensitivity.description ?? 'Etichetta di riservatezza'}><span className="sens-dot" style={{ background: sensitivity.color ?? '#605E5C' }} />{sensitivity.name}</span>}</div>
      <CommandSearch />
      <ThemeButton />
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
