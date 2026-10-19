import { useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Icon, VisualIcon } from './icons';
import { Menu } from './Menu';
import { VISUALS } from '../visuals/catalog';
import { THEMES } from '../themes';
import type { Theme } from '../types';

function ThemeSwatch({ t, active, onClick, label }: { t: Theme; active: boolean; onClick: () => void; label?: boolean }) {
  return (
    <button className={'theme-swatch' + (active ? ' active' : '')} title={t.name} onClick={onClick}>
      <span className="sw" style={{ background: t.background ?? '#fff' }}>
        <b style={{ color: t.foreground ?? '#252423' }}>Aa</b>
        <span className="bars">{t.dataColors.slice(0, 4).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
      </span>
      {label && <span className="nm">{t.name}</span>}
    </button>
  );
}

type Tab = 'home' | 'insert' | 'modeling' | 'view' | 'optimize' | 'help';
const TABS: [Tab, string][] = [['home', 'Home'], ['insert', 'Inserisci'], ['modeling', 'Modellazione'], ['view', 'Visualizza'], ['optimize', 'Ottimizza'], ['help', 'Guida']];

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rgroup"><div className="items">{children}</div><div className="label">{label}</div></div>;
}

export function Big({ icon, label, onClick, disabled, dropdown, title }: { icon: string; label: ReactNode; onClick?: (e: React.MouseEvent) => void; disabled?: boolean; dropdown?: boolean; title?: string }) {
  return (
    <button className="rbtn-l" onClick={onClick} disabled={disabled} title={title}>
      <Icon name={icon} size={32} />
      <span className="lbl"><span>{label}{dropdown && <span className="chev"><Icon name="chevronDown" size={10} /></span>}</span></span>
    </button>
  );
}

export function Small({ icon, label, onClick, disabled }: { icon: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return <button className="rbtn-s" onClick={onClick} disabled={disabled}><Icon name={icon} size={16} />{label}</button>;
}

type MenuState = { kind: string; x: number; y: number } | null;

export function Ribbon() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [menu, setMenu] = useState<MenuState>(null);
  const report = s.view === 'report';
  const sel = s.selectedVisualId;
  const openMenu = (kind: string) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, x: r.left, y: r.bottom + 2 });
  };
  const close = () => setMenu(null);
  const selVisual = sel ? s.page().visuals.find((v) => v.id === sel) : undefined;

  const copy = () => selVisual && s.set({ clipboard: JSON.parse(JSON.stringify(selVisual)) });
  const cut = () => { if (selVisual) { copy(); s.removeVisual(selVisual.id); } };
  const paste = () => {
    const c = s.clipboard;
    if (!c) return;
    const id = s.addVisual(c.type, { x: c.x + 20, y: c.y + 20 });
    const past = useStore.getState().past;
    s.updateVisual(id, { fields: c.fields, format: c.format, w: c.w, h: c.h, text: c.text, slicerValues: c.slicerValues });
    useStore.setState({ past }); // collapse into a single undo step with the add
  };

  const dataGroup = (
    <Group label="Dati">
      <Big icon="getData" label={<>Ottieni<br />dati</>} dropdown onClick={openMenu('getdata')} />
      <Big icon="excel" label={<>Cartella di<br />lavoro di Excel</>} onClick={() => s.openNavigator('excel')} />
      <Big icon="sql" label={<>Database<br />SQL</>} onClick={() => s.set({ dbDialog: true })} title="MySQL/MariaDB, PostgreSQL, SQLite" />
      <Big icon="enterData" label={<>Immetti<br />dati</>} disabled title="Disponibile in una fase successiva" />
      <Big icon="recent" label={<>Origini<br />recenti</>} disabled dropdown />
    </Group>
  );

  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        <button className="file" onClick={() => s.set({ fileMenu: true })}>File</button>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="ribbon-body">
        {tab === 'home' && <>
          <Group label="Appunti">
            <Big icon="paste" label="Incolla" onClick={paste} disabled={!s.clipboard || !report} />
            <div className="rcol">
              <Small icon="cut" label="Taglia" onClick={cut} disabled={!selVisual} />
              <Small icon="copy" label="Copia" onClick={copy} disabled={!selVisual} />
              <Small icon="painter" label="Copia formato" disabled />
            </div>
          </Group>
          {dataGroup}
          <Group label="Query">
            <Big icon="transform" label={<>Trasforma<br />dati</>} onClick={() => s.openPowerQuery(s.dataViewTable ?? undefined)} title="Apre l'editor di Power Query" />
            <Big icon="refresh" label="Aggiorna" onClick={() => s.refresh()} disabled={!s.tables.length} />
          </Group>
          <Group label="Inserisci">
            <Big icon="newVisual" label={<>Nuovo oggetto<br />visivo</>} onClick={() => s.addVisual('clusteredColumn')} disabled={!report} />
            <Big icon="textBox" label={<>Casella di<br />testo</>} onClick={() => s.addVisual('textbox')} disabled={!report} />
            <Big icon="moreVisuals" label={<>Altri oggetti<br />visivi</>} dropdown onClick={openMenu('visuals')} disabled={!report} />
          </Group>
          {s.view === 'model' && (
            <Group label="Relazioni">
              <Big icon="relationships" label={<>Gestisci<br />relazioni</>} onClick={() => s.set({ relManage: true })} disabled={!s.tables.length} />
            </Group>
          )}
          <Group label="Parametri">
            <Big icon="newTable" label={<>Nuovo<br />parametro</>} dropdown onClick={openMenu('params')} disabled={!s.tables.length} />
          </Group>
          <Group label="Calcoli">
            <Big icon="measure" label={<>Nuova<br />misura</>} onClick={() => s.startDax('measure')} disabled={!s.tables.length} />
            <Big icon="quickMeasure" label={<>Misura<br />rapida</>} disabled />
          </Group>
          <Group label="Riservatezza"><Big icon="sensitivity" label="Riservatezza" disabled dropdown /></Group>
          <Group label="Condividi"><Big icon="publish" label="Pubblica" onClick={() => s.set({ publishDialog: true })} /></Group>
        </>}

        {tab === 'insert' && <>
          <Group label="Pagine"><Big icon="newPage" label={<>Nuova<br />pagina</>} dropdown onClick={openMenu('newpage')} disabled={!report} /></Group>
          <Group label="Oggetti visivi">
            <Big icon="newVisual" label={<>Nuovo oggetto<br />visivo</>} onClick={() => s.addVisual('clusteredColumn')} disabled={!report} />
            <Big icon="moreVisuals" label={<>Altri oggetti<br />visivi</>} dropdown onClick={openMenu('visuals')} disabled={!report} />
          </Group>
          <Group label="Elementi">
            <Big icon="textBox" label={<>Casella di<br />testo</>} onClick={() => s.addVisual('textbox')} disabled={!report} />
            <Big icon="newVisual" label="Scheda" onClick={() => s.addVisual('card')} disabled={!report} />
            <Big icon="newTable" label="Tabella" onClick={() => s.addVisual('table')} disabled={!report} />
            <Big icon="newVisual" label="Pulsanti" dropdown onClick={openMenu('buttons')} disabled={!report} />
          </Group>
        </>}

        {tab === 'modeling' && <>
          <Group label="Relazioni">
            <Big icon="relationships" label={<>Gestisci<br />relazioni</>} onClick={() => s.set({ relManage: true })} disabled={!s.tables.length} />
            <Big icon="refresh" label={<>Rilevamento<br />automatico</>} disabled={s.tables.length < 2} onClick={async () => {
              const n = await s.detectRelationships();
              s.notify(n ? `Rilevate ${n} nuove relazioni.` : 'Nessuna nuova relazione rilevata.');
            }} />
          </Group>
          <Group label="Calcoli">
            <Big icon="measure" label={<>Nuova<br />misura</>} onClick={() => s.startDax('measure')} disabled={!s.tables.length} />
            <Big icon="quickMeasure" label={<>Misura<br />rapida</>} disabled />
            <Big icon="newColumn" label={<>Nuova<br />colonna</>} onClick={() => s.startDax('column', s.tables.find((t) => t.name === s.dataViewTable)?.name ?? s.tables[0]?.name)} disabled={!s.tables.length} />
            <Big icon="newTable" label={<>Nuova<br />tabella</>} onClick={() => s.startDax('table')} />
          </Group>
          <Group label="Dati"><Big icon="refresh" label="Aggiorna" onClick={() => s.refresh()} disabled={!s.tables.length} /></Group>
        </>}

        {tab === 'view' && <>
          <Group label="Temi">
            <div className="theme-strip">
              {THEMES.slice(0, 4).map((t) => <ThemeSwatch key={t.name} t={t} active={(s.report.theme?.name ?? 'Predefinito') === t.name} onClick={() => s.setTheme(t.name === 'Predefinito' ? undefined : t)} />)}
            </div>
            <Big icon="themes" label="Temi" dropdown onClick={openMenu('themes')} />
          </Group>
          <Group label="Ridimensiona">
            <Big icon="pageView" label={<>Visualizzazione<br />pagina</>} dropdown onClick={openMenu('pageview')} disabled={!report} />
            <Big icon="mobile" label={<>Layout<br />per dispositivi mobili</>} disabled />
          </Group>
          <Group label="Opzioni di pagina">
            <div className="rcol">
              <label className="rcheck"><input type="checkbox" checked={s.gridlines} onChange={(e) => s.set({ gridlines: e.target.checked })} />Griglia</label>
              <label className="rcheck"><input type="checkbox" checked={s.snapToGrid} onChange={(e) => s.set({ snapToGrid: e.target.checked })} />Allinea alla griglia</label>
            </div>
          </Group>
          <Group label="Mostra riquadri">
            <div className="rcol">
              {([['filters', 'Filtri'], ['viz', 'Visualizzazioni'], ['data', 'Dati'], ['bookmarks', 'Segnalibri'], ['selection', 'Selezione']] as const).map(([k, l]) => (
                <label key={k} className="rcheck"><input type="checkbox" checked={s.panes[k]} onChange={(e) => s.set({ panes: { ...s.panes, [k]: e.target.checked } })} />{l}</label>
              ))}
            </div>
          </Group>
        </>}

        {tab === 'optimize' && <>
          <Group label="Query"><Big icon="pause" label={<>Sospendi<br />oggetti visivi</>} disabled /></Group>
          <Group label="Prestazioni"><Big icon="analyzer" label={<>Analizzatore<br />prestazioni</>} disabled /></Group>
          <Group label="Dati"><Big icon="refresh" label={<>Aggiorna<br />oggetti visivi</>} onClick={() => s.set({ dataVersion: s.dataVersion + 1 })} /></Group>
        </>}

        {tab === 'help' && <>
          <Group label="Guida">
            <Big icon="info" label="Informazioni" onClick={() => s.notify('LinBI 0.1 — clone educativo di Power BI Desktop per Linux. Motore: DuckDB · Grafici: Apache ECharts.')} />
            <Big icon="docs" label="Documentazione" onClick={() => s.notify('Leggere README.md nella cartella del progetto.')} />
          </Group>
        </>}
      </div>

      {menu?.kind === 'getdata' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          <div className="hdr">Origini dati comuni</div>
          <button onClick={() => { close(); s.openNavigator('excel'); }}><Icon name="excel" size={18} />Cartella di lavoro di Excel</button>
          <button onClick={() => { close(); s.openNavigator('csv'); }}><Icon name="docs" size={18} />Testo/CSV</button>
          <button onClick={() => { close(); s.openNavigator('json'); }}><Icon name="docs" size={18} />JSON</button>
          <button onClick={() => { close(); s.openNavigator('parquet'); }}><Icon name="sql" size={18} />Parquet</button>
          <button onClick={() => { close(); s.set({ dbDialog: true }); }}><Icon name="sql" size={18} />Database (MySQL, PostgreSQL, SQLite)</button>
          <hr />
          <button onClick={() => { close(); s.loadSample(); }}><Icon name="sample" size={18} />Dati di esempio (Financials)</button>
          <button onClick={() => { close(); s.openNavigator('any'); }}>Altro…</button>
        </Menu>
      )}
      {menu?.kind === 'visuals' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          {VISUALS.map((v) => <button key={v.type} onClick={() => { close(); s.addVisual(v.type); }}><VisualIcon type={v.type} />{v.name}</button>)}
        </Menu>
      )}
      {menu?.kind === 'themes' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          <div className="hdr">Questo report</div>
          <div className="theme-grid">
            {THEMES.map((t) => <ThemeSwatch key={t.name} t={t} label active={(s.report.theme?.name ?? 'Predefinito') === t.name} onClick={() => { close(); s.setTheme(t.name === 'Predefinito' ? undefined : t); }} />)}
            {s.report.theme && !THEMES.some((t) => t.name === s.report.theme!.name) && <ThemeSwatch t={s.report.theme} label active onClick={close} />}
          </div>
          <hr />
          <button onClick={() => { close(); s.importTheme(); }}>Sfoglia temi…</button>
          <button onClick={() => { close(); s.exportTheme(); }}>Salva tema corrente</button>
        </Menu>
      )}
      {menu?.kind === 'newpage' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          <button onClick={() => { close(); s.addPage(); }}>Pagina vuota</button>
          <button onClick={() => { close(); s.duplicatePage(s.activePageId); }}>Duplica pagina</button>
        </Menu>
      )}
      {menu?.kind === 'buttons' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          {([['Indietro', 'Back', 'back'], ['Segnalibro', 'Bookmark', 'bookmark'], ['Vuoto', '', 'blank']] as const).map(([label, action, icon]) => (
            <button key={label} onClick={() => {
              close();
              const id = s.addVisual('button');
              const L = (x: string) => ({ expr: { Literal: { Value: x } } });
              s.updateVisual(id, { w: 120, h: 40, style: {
                pbiType: 'actionButton',
                objects: { icon: [{ properties: { shapeType: L(`'${icon}'`) } }], text: [{ properties: { show: L(icon === 'blank' ? 'true' : 'false'), text: L(`'${label}'`) } }], outline: [{ properties: { show: L('true') } }] },
                vcObjects: action ? { visualLink: [{ properties: { show: L('true'), type: L(`'${action}'`), ...(action === 'Bookmark' && s.report.bookmarks?.[0] ? { bookmark: L(`'${s.report.bookmarks[0].pbiName ?? s.report.bookmarks[0].id}'`) } : {}) } }] } : {},
              } });
            }}>{label}</button>
          ))}
          <hr />
          <button onClick={() => { close(); const id = s.addVisual('pageNavigator'); s.updateVisual(id, { w: 500, h: 44 }); }}>Navigatore pagine</button>
          <button onClick={() => { close(); const id = s.addVisual('bookmarkNavigator'); s.updateVisual(id, { w: 500, h: 44 }); }}>Navigatore segnalibri</button>
        </Menu>
      )}
      {menu?.kind === 'params' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          <button onClick={() => { close(); s.set({ paramDialog: 'numeric' }); }}>Intervallo numerico</button>
          <button onClick={() => { close(); s.set({ paramDialog: 'fields' }); }}>Campi</button>
        </Menu>
      )}
      {menu?.kind === 'pageview' && (
        <Menu x={menu.x} y={menu.y} onClose={close}>
          <button onClick={() => { close(); s.set({ zoom: 'fit' }); }}>Adatta alla pagina</button>
          <button onClick={() => { close(); s.set({ zoom: 1 }); }}>Dimensioni effettive</button>
        </Menu>
      )}
    </div>
  );
}
