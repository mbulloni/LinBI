// Visualizza › Layout per dispositivi mobili: a phone canvas per page where the page's visuals are placed
// again (same visuals and data, own position/size in Page.mobile), like Power BI's mobile layout.
import { useStore, isHiddenVisual } from '../store';
import { VisualContainer, autoTitle } from './VisualContainer';
import { PageBackground } from './ReportView';
import { THEME } from '../themes';
import { visualDef } from '../visuals/catalog';
import { VisualIcon } from './icons';

export const PHONE_W = 360;
const MIN_H = 640;

export function MobileLayoutView() {
  const s = useStore();
  const page = s.page();
  const layout = page.mobile ?? {};
  const placed = page.visuals.filter((v) => layout[v.id] && !isHiddenVisual(page, v));
  const bottom = Math.max(0, ...placed.map((v) => layout[v.id].y + layout[v.id].h));
  const height = Math.max(MIN_H, bottom + 160);
  const set = (id: string, g: { x: number; y: number; w: number; h: number } | null) => s.mut((r) => {
    const p = r.pages.find((x) => x.id === page.id)!;
    const m = { ...(p.mobile ?? {}) };
    if (g) m[id] = g; else delete m[id];
    if (Object.keys(m).length) p.mobile = m; else delete p.mobile;
  });
  // New visual on the phone: full width, desktop aspect ratio, below the others.
  const add = (id: string) => {
    const v = page.visuals.find((x) => x.id === id)!;
    const w = PHONE_W - 16;
    set(id, { x: 8, y: bottom + 8, w, h: Math.max(60, Math.round((v.h * w) / Math.max(1, v.w))) });
  };
  return (
    <div className="mobile-layout">
      <div className="mobile-list">
        <div className="mobile-hdr">Oggetti visivi pagina</div>
        <div className="pq-note">Fare clic su un oggetto visivo per aggiungerlo al layout per dispositivi mobili.</div>
        {page.visuals.filter((v) => !isHiddenVisual(page, v)).map((v) => (
          <div key={v.id} className={'mobile-item' + (layout[v.id] ? ' on' : '')} onClick={() => (layout[v.id] ? s.selectVisual(v.id) : add(v.id))}
            draggable onDragStart={(e) => e.dataTransfer.setData('application/x-mib-bi-mobile', v.id)}>
            <VisualIcon type={v.type} size={18} />
            <span>{v.format.titleText || autoTitle(v) || visualDef(v.type, v.custom).name}</span>
            {layout[v.id] ? <button title="Rimuovi dal layout" onClick={(e) => { e.stopPropagation(); set(v.id, null); }}>×</button> : <b>+</b>}
          </div>
        ))}
        <button className="btn" style={{ marginTop: 12 }} onClick={() => s.set({ mobileLayout: false })}>Torna al layout del report</button>
      </div>
      <div className="mobile-stage">
        <div className="phone" onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-mib-bi-mobile')) e.preventDefault(); }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-mib-bi-mobile');
            if (!id || layout[id]) return;
            const v = page.visuals.find((x) => x.id === id)!;
            const r = (e.currentTarget.querySelector('.page') as HTMLElement).getBoundingClientRect();
            const w = Math.min(PHONE_W - 16, v.w);
            set(id, { x: Math.max(0, Math.min(PHONE_W - w, Math.round(e.clientX - r.left - w / 2))), y: Math.max(0, Math.round(e.clientY - r.top - 20)), w, h: Math.max(60, Math.round((v.h * w) / Math.max(1, v.w))) });
          }}>
          <div className="page grid" style={{ width: PHONE_W, height, position: 'relative', backgroundColor: THEME.background }} onMouseDown={() => s.selectVisual(null)}>
            <PageBackground p={page} />
            {placed.map((v) => <VisualContainer key={v.id} v={v} scale={1} geom={layout[v.id]} onGeom={(g) => set(v.id, g)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
