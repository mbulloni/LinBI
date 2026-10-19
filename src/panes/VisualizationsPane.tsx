import { useState, type ReactNode } from 'react';
import { useStore, defaultFormat } from '../store';
import { uid } from '../format';
import type { Agg, Visual, VisualFormat } from '../types';
import { VISUALS, visualDef, isChart } from '../visuals/catalog';
import { AGG_LABEL, fieldLabel, isNumeric } from '../format';
import { Icon, VisualIcon } from '../components/icons';
import { Menu, Toggle } from '../components/Menu';
import { FIELD_MIME } from '../components/VisualContainer';
import { DEFAULT_CF, fieldKey } from '../visuals/condfmt';
import type { ColorScale, CondFormat, Page } from '../types';

function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="fmt-row"><span>{label}</span>
      <span className="colorpick"><input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />{value.toUpperCase()}</span>
    </label>
  );
}

function ScaleEditor({ scale, onChange }: { scale: ColorScale; onChange: (s: ColorScale) => void }) {
  return <>
    <ColorPick label="Valore minimo" value={scale.min} onChange={(min) => onChange({ ...scale, min })} />
    <div className="fmt-row inline"><span>Aggiungi colore centrale</span><Toggle on={!!scale.mid} onChange={(b) => onChange({ ...scale, mid: b ? '#FFEB84' : undefined })} /></div>
    {scale.mid && <ColorPick label="Valore centrale" value={scale.mid} onChange={(mid) => onChange({ ...scale, mid })} />}
    <ColorPick label="Valore massimo" value={scale.max} onChange={(max) => onChange({ ...scale, max })} />
  </>;
}

/** Table/matrix: conditional formatting per value field. */
function CondFormatCard({ v }: { v: Visual }) {
  const s = useStore();
  const items = visualDef(v.type).wells.flatMap((w) => (v.fields[w.key] ?? []).filter((f) => f.agg !== 'none'));
  const [sel, setSel] = useState(0);
  const f = items[Math.min(sel, items.length - 1)];
  if (!f) return <Card title="Formattazione condizionale"><div style={{ color: 'var(--text2)' }}>Aggiungere un campo valore.</div></Card>;
  const key = fieldKey(f);
  const cf: CondFormat = v.format.cf?.[key] ?? {};
  const set = (patch: Partial<CondFormat>) => {
    const next = { ...cf, ...patch };
    for (const k of Object.keys(next) as (keyof CondFormat)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    const all = { ...(v.format.cf ?? {}) };
    if (Object.keys(next).length) all[key] = next; else delete all[key];
    s.updateFormat(v.id, { cf: all });
  };
  return (
    <Card title="Formattazione condizionale" defaultOpen={!!v.format.cf && Object.keys(v.format.cf).length > 0}>
      <label className="fmt-row"><span>Applica al campo</span>
        <select value={items.indexOf(f)} onChange={(e) => setSel(+e.target.value)}>
          {items.map((x, i) => <option key={i} value={i}>{fieldLabel(x)}</option>)}
        </select>
      </label>
      <div className="fmt-row inline"><span>Colore di sfondo</span><Toggle on={!!cf.background} onChange={(b) => set({ background: b ? DEFAULT_CF.background : undefined })} /></div>
      {cf.background && <ScaleEditor scale={cf.background} onChange={(background) => set({ background })} />}
      <div className="fmt-row inline"><span>Colore carattere</span><Toggle on={!!cf.font} onChange={(b) => set({ font: b ? DEFAULT_CF.font : undefined })} /></div>
      {cf.font && <ScaleEditor scale={cf.font} onChange={(font) => set({ font })} />}
      <div className="fmt-row inline"><span>Barre dei dati</span><Toggle on={!!cf.bars} onChange={(b) => set({ bars: b ? DEFAULT_CF.bars : undefined })} /></div>
      {cf.bars && <>
        <ColorPick label="Barra positiva" value={cf.bars.positive} onChange={(positive) => set({ bars: { ...cf.bars!, positive } })} />
        <ColorPick label="Barra negativa" value={cf.bars.negative} onChange={(negative) => set({ bars: { ...cf.bars!, negative } })} />
      </>}
      <div className="fmt-row inline"><span>Icone</span><Toggle on={!!cf.icons} onChange={(b) => set({ icons: b || undefined })} /></div>
    </Card>
  );
}

function Wells({ v }: { v: Visual }) {
  const s = useStore();
  const def = visualDef(v.type);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ well: string; idx: number; x: number; y: number } | null>(null);
  const colMeta = (t: string, c: string) => s.tables.find((x) => x.name === t)?.columns.find((x) => x.name === c);

  if (!def.wells.length) return null;
  const mf = menu ? v.fields[menu.well]?.[menu.idx] : undefined;
  const numeric = mf ? isNumeric(colMeta(mf.table, mf.column)) : false;
  const aggs: Agg[] = numeric ? ['sum', 'avg', 'min', 'max', 'countd', 'count', 'stdev', 'var', 'median', 'none'] : ['none', 'min', 'max', 'countd', 'count'];
  const wellIsMeasure = menu ? def.wells.find((w) => w.key === menu.well)?.measure : false;

  return (
    <div className="wells">
      {def.wells.map((w) => (
        <div
          key={w.key}
          className={'well' + (over === w.key ? ' over' : '')}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(FIELD_MIME)) { e.preventDefault(); setOver(w.key); } }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { setOver(null); const raw = e.dataTransfer.getData(FIELD_MIME); if (raw) s.addField(v.id, JSON.parse(raw), w.key); }}
        >
          <div className="wl">{w.label}</div>
          {(v.fields[w.key] ?? []).map((f, i) => (
            <div className="pill" key={i} title={`${f.table}[${f.column}]`}>
              <span className="nm">{fieldLabel(f)}</span>
              <button title="Opzioni" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ well: w.key, idx: i, x: r.left - 160, y: r.bottom + 2 }); }}><Icon name="chevronDown" size={12} /></button>
              <button title="Rimuovi campo" onClick={() => s.removeField(v.id, w.key, i)}><Icon name="close" size={11} /></button>
            </div>
          ))}
          {(!w.max || (v.fields[w.key]?.length ?? 0) < w.max) && <div className={'add' + (over === w.key ? ' over' : '')}>Aggiungi campi dati qui</div>}
        </div>
      ))}
      {menu && mf && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button onClick={() => { s.removeField(v.id, menu.well, menu.idx); setMenu(null); }}>Rimuovi campo</button>
          {mf.agg !== 'measure' && <hr />}
          {mf.agg !== 'measure' && aggs.filter((a) => !(wellIsMeasure && a === 'none' && v.type !== 'table')).map((a) => (
            <button key={a} onClick={() => { s.setFieldAgg(v.id, menu.well, menu.idx, a); setMenu(null); }}>
              <span style={{ width: 12 }}>{mf.agg === a ? '✓' : ''}</span>{AGG_LABEL[a]}
            </button>
          ))}
        </Menu>
      )}
    </div>
  );
}

function Card({ title, toggle, children, defaultOpen = false }: { title: string; toggle?: [boolean, (b: boolean) => void]; children?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fmt-card">
      <div className="fc-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="sp">{title}</span>
        {toggle && <span onClick={(e) => e.stopPropagation()}><Toggle on={toggle[0]} onChange={toggle[1]} /></span>}
      </div>
      {open && children && <div className="fc-body">{children}</div>}
    </div>
  );
}

function FormatPane({ v }: { v: Visual }) {
  const s = useStore();
  const [tab, setTab] = useState<'visual' | 'general'>('visual');
  const f = v.format;
  const up = (p: Partial<VisualFormat>) => s.updateFormat(v.id, p);
  const tg = (k: keyof VisualFormat): [boolean, (b: boolean) => void] => [f[k] as boolean, (b) => up({ [k]: b })];
  const chart = isChart(v.type);
  const cartesian = chart && !['pie', 'donut', 'treemap', 'funnel', 'gauge'].includes(v.type);
  const mapv = v.type === 'map' || v.type === 'filledMap';
  const hasLegend = ['pie', 'donut'].includes(v.type) || (cartesian && v.type !== 'scatter') || v.type === 'scatter' || mapv;

  return (
    <div>
      <div className="subtabs">
        <button className={tab === 'visual' ? 'active' : ''} onClick={() => setTab('visual')}>Oggetto visivo</button>
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>Generale</button>
      </div>
      {tab === 'visual' && <>
        {cartesian && <Card title="Asse X" toggle={tg('xAxisShow')} />}
        {cartesian && <Card title="Asse Y" toggle={tg('yAxisShow')} />}
        {cartesian && <Card title="Linee griglia" toggle={tg('gridlines')} />}
        {hasLegend && (
          <Card title="Legenda" toggle={tg('legendShow')}>
            <label className="fmt-row"><span>Posizione</span>
              <select value={f.legendPos} onChange={(e) => up({ legendPos: e.target.value as VisualFormat['legendPos'] })}>
                <option value="top">In alto</option><option value="bottom">In basso</option><option value="left">A sinistra</option><option value="right">A destra</option>
              </select>
            </label>
          </Card>
        )}
        {(chart || v.type === 'map') && v.type !== 'gauge' && <Card title="Etichette dati" toggle={tg('dataLabels')} />}
        {(chart || v.type === 'gauge' || mapv) && !['pie', 'donut', 'treemap'].includes(v.type) && (
          <Card title="Colonne / Colori" defaultOpen>
            <label className="fmt-row"><span>Colore predefinito</span>
              <span className="colorpick"><input type="color" value={f.color} onChange={(e) => up({ color: e.target.value })} />{f.color.toUpperCase()}</span>
            </label>
            {cartesian && v.type !== 'scatter' && <>
              <div className="fmt-row inline"><span>Sfumatura per valore (fx)</span><Toggle on={!!f.colorScale} onChange={(b) => up({ colorScale: b ? { min: '#DEEFFF', max: '#0B5394' } : undefined })} /></div>
              {f.colorScale && <ScaleEditor scale={f.colorScale} onChange={(colorScale) => up({ colorScale })} />}
            </>}
          </Card>
        )}
        {(v.type === 'table' || v.type === 'matrix') && <CondFormatCard v={v} />}
        {(chart || mapv) && (
          <Card title="Descrizioni comando">
            <label className="fmt-row"><span>Tipo</span>
              <select value={f.tooltipPage ?? ''} onChange={(e) => up({ tooltipPage: e.target.value || undefined })}>
                <option value="">Predefinito</option>
                {s.report.pages.filter((p) => p.tooltip).map((p) => <option key={p.id} value={p.id}>Pagina del report: {p.name}</option>)}
              </select>
            </label>
            {!s.report.pages.some((p) => p.tooltip) && <div style={{ color: 'var(--text2)', fontSize: 11 }}>Nessuna pagina impostata come descrizione comando.</div>}
          </Card>
        )}
        {v.type === 'slicer' && (
          <Card title="Impostazioni filtro dei dati" defaultOpen>
            <label className="fmt-row"><span>Stile</span>
              <select value={f.slicerStyle} onChange={(e) => up({ slicerStyle: e.target.value as VisualFormat['slicerStyle'] })}>
                <option value="list">Elenco verticale</option><option value="dropdown">Elenco a discesa</option>
              </select>
            </label>
          </Card>
        )}
        {!chart && !mapv && !['slicer', 'table', 'matrix'].includes(v.type) && <div style={{ color: 'var(--text2)', padding: '10px 0' }}>Nessuna opzione aggiuntiva per questo oggetto visivo.</div>}
      </>}
      {tab === 'general' && <>
        <Card title="Proprietà" defaultOpen>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="fmt-row"><span>{{ x: 'Posizione X', y: 'Posizione Y', w: 'Larghezza', h: 'Altezza' }[k]}</span>
                <input type="number" value={v[k]} onChange={(e) => s.updateVisual(v.id, { [k]: Math.max(k === 'w' || k === 'h' ? 40 : 0, +e.target.value) })} style={{ width: '100%' }} />
              </label>
            ))}
          </div>
        </Card>
        <Card title="Titolo" toggle={tg('titleShow')} defaultOpen>
          <label className="fmt-row"><span>Testo</span><input type="text" value={f.titleText} placeholder="Automatico" onChange={(e) => up({ titleText: e.target.value })} /></label>
          <label className="fmt-row"><span>Dimensioni del testo</span><input type="number" min={8} max={40} value={f.titleSize} onChange={(e) => up({ titleSize: +e.target.value })} /></label>
        </Card>
        <Card title="Effetti">
          <label className="fmt-row"><span>Sfondo</span>
            <span className="colorpick"><input type="color" value={f.background} onChange={(e) => up({ background: e.target.value })} />{f.background.toUpperCase()}</span>
          </label>
          <div className="fmt-row inline"><span>Bordo oggetto visivo</span><Toggle on={f.border} onChange={(b) => up({ border: b })} /></div>
        </Card>
      </>}
    </div>
  );
}

/** Page settings (no visual selected): size, background, tooltip page, drill-through fields. */
function PageSettings() {
  const s = useStore();
  const p = s.page();
  const [over, setOver] = useState(false);
  const up = (fn: (pg: Page) => void) => s.mut((r) => { const pg = r.pages.find((x) => x.id === p.id); if (pg) fn(pg); });
  const w = p.width ?? 1280, h = p.height ?? 720;
  const kind = w === 1280 && h === 720 ? '16:9' : w === 960 && h === 720 ? '4:3' : w === 320 && h === 240 ? 'tooltip' : 'custom';
  const dt = p.drillthrough?.fields ?? [];
  return (
    <div>
      <div style={{ fontWeight: 600, margin: '8px 0' }}>Pagina «{p.name}»</div>
      <Card title="Impostazioni area di disegno" defaultOpen>
        <label className="fmt-row"><span>Tipo</span>
          <select value={kind} onChange={(e) => up((pg) => {
            const [nw, nh] = ({ '16:9': [1280, 720], '4:3': [960, 720], tooltip: [320, 240], custom: [w, h] } as Record<string, number[]>)[e.target.value];
            if (nw === 1280 && nh === 720) { delete pg.width; delete pg.height; } else { pg.width = nw; pg.height = nh; }
            if (e.target.value === 'tooltip') pg.tooltip = true;
          })}>
            <option value="16:9">16:9</option><option value="4:3">4:3</option><option value="tooltip">Descrizione comando (320 × 240)</option><option value="custom">Personalizzato</option>
          </select>
        </label>
        {kind === 'custom' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="fmt-row"><span>Larghezza</span><input type="number" min={100} value={w} onChange={(e) => up((pg) => { pg.width = Math.max(100, +e.target.value); pg.height = h; })} /></label>
          <label className="fmt-row"><span>Altezza</span><input type="number" min={100} value={h} onChange={(e) => up((pg) => { pg.height = Math.max(100, +e.target.value); pg.width = w; })} /></label>
        </div>}
      </Card>
      <Card title="Sfondo area di disegno">
        <ColorPick label="Colore" value={p.backgroundColor ?? '#FFFFFF'} onChange={(c) => up((pg) => { pg.backgroundColor = c; })} />
        <label className="fmt-row"><span>Trasparenza (%)</span><input type="number" min={0} max={100} value={p.backgroundTransparency ?? 0} onChange={(e) => up((pg) => { pg.backgroundTransparency = Math.max(0, Math.min(100, +e.target.value)); })} /></label>
      </Card>
      <Card title="Informazioni pagina" defaultOpen>
        <div className="fmt-row inline"><span>Consenti l'uso come descrizione comando</span><Toggle on={!!p.tooltip} onChange={(b) => up((pg) => { pg.tooltip = b || undefined; })} /></div>
        <div className="fmt-row inline"><span>Nascondi pagina</span><Toggle on={!!p.hidden} onChange={(b) => up((pg) => { pg.hidden = b || undefined; })} /></div>
      </Card>
      <div className="wells">
        <div className={'well' + (over ? ' over' : '')}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(FIELD_MIME)) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            setOver(false);
            const raw = e.dataTransfer.getData(FIELD_MIME);
            if (!raw) return;
            const f = JSON.parse(raw);
            if (f.measure) { s.notify('Il drill-through usa colonne, non misure.'); return; }
            up((pg) => {
              const first = !pg.drillthrough;
              const list = (pg.drillthrough ??= { fields: [] }).fields;
              if (!list.some((x) => x.table === f.table && x.column === f.column)) list.push({ table: f.table, column: f.column });
              // Like Power BI, a new drill-through page gets a Back button (Ctrl+click in edit mode).
              if (first && !pg.visuals.some((v) => v.type === 'button')) {
                const L = (x: string) => ({ expr: { Literal: { Value: x } } });
                pg.visuals.push({
                  id: uid(), type: 'button', x: 16, y: 16, w: 40, h: 40, z: Math.max(0, ...pg.visuals.map((v) => v.z)) + 1, fields: {}, format: defaultFormat('button'),
                  style: {
                    pbiType: 'actionButton',
                    objects: { icon: [{ properties: { shapeType: L("'back'"), lineColor: { solid: { color: L("'#252423'") } } } }], outline: [{ properties: { show: L('false') } }] },
                    vcObjects: { visualLink: [{ properties: { show: L('true'), type: L("'Back'"), tooltip: L("'Indietro'") } }] },
                  },
                });
              }
            });
          }}>
          <div className="wl">Drill-through</div>
          {dt.map((f, i) => (
            <div className="pill" key={i}><span className="nm">{f.column}</span>
              <button title="Rimuovi campo" onClick={() => up((pg) => { pg.drillthrough!.fields.splice(i, 1); if (!pg.drillthrough!.fields.length) delete pg.drillthrough; })}><Icon name="close" size={11} /></button></div>
          ))}
          <div className={'add' + (over ? ' over' : '')}>Aggiungi i campi di drill-through qui</div>
        </div>
        {dt.length > 0 && <div className="fmt-row inline"><span>Mantieni tutti i filtri</span><Toggle on={!!p.drillthrough?.keepAll} onChange={(b) => up((pg) => { pg.drillthrough!.keepAll = b || undefined; })} /></div>}
      </div>
    </div>
  );
}

export function VisualizationsPane() {
  const s = useStore();
  if (!s.panes.viz) return null;
  const v = s.page().visuals.find((x) => x.id === s.selectedVisualId);
  return (
    <div className="pane">
      <div className="pane-head">
        <h3>Visualizzazioni</h3>
        <div className="tools"><button title="Comprimi" onClick={() => s.set({ panes: { ...s.panes, viz: false } })}><Icon name="collapseRight" /></button></div>
      </div>
      <div style={{ padding: '0 12px 4px', fontWeight: 600 }}>{s.vizTab === 'build' ? 'Compila oggetto visivo' : 'Formato oggetto visivo'}</div>
      <div className="viz-tabs">
        <button className={s.vizTab === 'build' ? 'active' : ''} title="Aggiungi dati all'oggetto visivo" onClick={() => s.set({ vizTab: 'build' })}><Icon name="build" size={18} /></button>
        <button className={s.vizTab === 'format' ? 'active' : ''} title="Formato oggetto visivo" onClick={() => s.set({ vizTab: 'format' })}><Icon name="brush" size={18} /></button>
        <button disabled title="Analisi (non disponibile)"><Icon name="analytics" size={18} /></button>
      </div>
      <div className="pane-body">
        {s.vizTab === 'build' && <>
          <div className="viz-grid">
            {VISUALS.map((d) => (
              <button key={d.type} title={d.name} className={v?.type === d.type ? 'active' : ''}
                onClick={() => (v && v.type !== 'textbox' ? s.changeVisualType(v.id, d.type) : s.addVisual(d.type))}>
                <VisualIcon type={d.type} />
              </button>
            ))}
          </div>
          {v ? <Wells v={v} /> : <PageSettings />}
        </>}
        {s.vizTab === 'format' && (v ? <FormatPane key={v.id} v={v} /> : <div style={{ color: 'var(--text2)', paddingTop: 10 }}>Selezionare un oggetto visivo per formattarlo.</div>)}
      </div>
    </div>
  );
}
