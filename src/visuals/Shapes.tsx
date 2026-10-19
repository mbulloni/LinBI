// Buttons (Power BI actionButton) and shapes (basicShape/shape), drawn from their imported formatting.
import { useState, type CSSProperties } from 'react';
import type { Visual } from '../types';
import { useStore } from '../store';
import { api } from '../api';
import { font, pt, sp, withAlpha } from './pbistyle';

const ICON_PATHS: Record<string, string> = {
  back: 'M14 5 L7 12 L14 19 M7 12 H21',
  information: 'M12 3 A9 9 0 1 1 11.99 3 M12 10 V17 M12 7 V7.5',
  help: 'M12 3 A9 9 0 1 1 11.99 3 M9.5 9.5 A2.5 2.5 0 1 1 12 12 V14 M12 17 V17.5',
  bookmark: 'M7 3 H17 V21 L12 16 L7 21 Z',
  reset: 'M4 12 A8 8 0 1 0 7 5.8 M4 4 V9 H9',
  qna: 'M4 5 H20 V16 H11 L6 20 V16 H4 Z',
  navigator: 'M4 6 H20 M4 12 H20 M4 18 H20',
};

/** Page history for "Indietro" buttons. */
const history: string[] = [];
useStore.subscribe((s, prev) => { if (s.activePageId !== prev.activePageId && prev.activePageId) history.push(prev.activePageId); });

/** Button action (vcObjects.visualLink): page navigation, back, web URL. Bookmarks: not yet. */
function runAction(v: Visual) {
  const s = useStore.getState();
  const type = sp(v, 'visualLink', 'type');
  if (sp(v, 'visualLink', 'show') === false || !type) return;
  if (type === 'PageNavigation') {
    const target = sp(v, 'visualLink', 'navigationSection');
    const p = s.report.pages.find((x) => x.pbiName === target);
    if (p) s.set({ activePageId: p.id, selectedVisualId: null });
  } else if (type === 'Back') {
    const prev = history.pop();
    if (prev && s.report.pages.some((p) => p.id === prev)) { s.set({ activePageId: prev, selectedVisualId: null }); history.pop(); }
  } else if (type === 'WebUrl') {
    const url = sp(v, 'visualLink', 'webUrl');
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) api.openExternal(url);
  } else if (type === 'Bookmark') {
    const name = sp(v, 'visualLink', 'bookmark');
    const b = s.report.bookmarks?.find((x) => x.pbiName === name || x.id === name);
    if (b) s.applyBookmark(b.id); else s.notify('Segnalibro non trovato.');
  } else {
    s.notify('Azione "' + type + '": disponibile in una prossima versione.');
  }
}

export function ButtonVisual({ v }: { v: Visual }) {
  const [hover, setHover] = useState(false);
  const st = hover ? 'hover' : undefined;
  const g = (obj: string, prop: string) => sp(v, obj, prop, st);
  const fill = g('fill', 'show') === true ? withAlpha(g('fill', 'fillColor') ?? '#E6E6E6', g('fill', 'transparency')) : 'transparent';
  const outline = g('outline', 'show') !== false;
  const lineColor = withAlpha(g('outline', 'lineColor') ?? '#666666', g('outline', 'transparency'));
  const weight = Number(g('outline', 'weight') ?? 1);
  const round = Number(g('shape', 'roundEdge') ?? 0);
  const showText = g('text', 'show') === true;
  const text = String(g('text', 'text') ?? '');
  const icon = String(g('icon', 'shapeType') ?? 'blank');
  const showIcon = g('icon', 'show') !== false && icon !== 'blank' && ICON_PATHS[icon];
  const iconColor = g('icon', 'lineColor') ?? '#666666';
  const valign = g('text', 'verticalAlignment');
  const box: CSSProperties = {
    position: 'absolute', inset: 0, background: fill, border: outline && weight > 0 ? `${weight}px solid ${lineColor}` : 'none',
    borderRadius: round, display: 'flex', gap: 6, cursor: 'pointer', overflow: 'hidden',
    alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
    justifyContent: { left: 'flex-start', right: 'flex-end' }[String(g('text', 'horizontalAlignment'))] ?? 'center',
    padding: `${g('text', 'topMargin') ?? 0}px ${g('text', 'rightMargin') ?? 0}px ${g('text', 'bottomMargin') ?? 0}px ${g('text', 'leftMargin') ?? 0}px`,
  };
  const tip = sp(v, 'visualLink', 'tooltip');
  return (
    <div style={box} title={typeof tip === 'string' ? tip + ' (Ctrl+clic)' : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) runAction(v); }}>
      {showIcon && <svg width="40%" height="60%" viewBox="0 0 24 24" style={{ maxWidth: 48 }}><path d={ICON_PATHS[icon]} fill="none" stroke={iconColor} strokeWidth={Number(g('icon', 'weight') ?? 2)} strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {showText && text && <span style={{ color: g('text', 'fontColor') ?? '#252423', fontSize: pt(g('text', 'fontSize'), 13), fontFamily: font(g('text', 'fontFamily')), fontWeight: g('text', 'bold') ? 700 : undefined, whiteSpace: 'pre-wrap', lineHeight: 1.1 }}>{text}</span>}
    </div>
  );
}

/** Page navigator (visible pages) or bookmark navigator (a bookmark group, or all): one button each. */
export function NavigatorVisual({ v }: { v: Visual }) {
  const s = useStore();
  const [hover, setHover] = useState<string | null>(null);
  const pages = s.report.pages.filter((p) => !p.hidden);
  const group = sp(v, 'bookmarks', 'bookmarkGroup');
  const bms = (s.report.bookmarks ?? []).filter((b) => !group || b.group === group || b.pbiName === group);
  const items = v.type === 'pageNavigator'
    ? pages.map((p) => ({ id: p.id, label: p.name, active: p.id === s.activePageId, go: () => s.set({ activePageId: p.id, selectedVisualId: null }) }))
    : bms.map((b) => ({ id: b.id, label: b.name, active: false, go: () => s.applyBookmark(b.id) }));
  const vertical = sp(v, 'layout', 'orientation') === 1 || v.h > v.w * 1.5;
  const g = (obj: string, prop: string, state?: string) => sp(v, obj, prop, state);
  return (
    <div className="nav-v" style={{ flexDirection: vertical ? 'column' : 'row' }}>
      {items.map((it) => {
        const st = it.active ? 'selected' : hover === it.id ? 'hover' : undefined;
        const fill = g('fill', 'fillColor', st) ?? (it.active ? '#252423' : '#E6E6E6');
        return (
          <div key={it.id} className="nav-btn" title={`${it.label} (Ctrl+clic)`}
            style={{ background: withAlpha(fill, g('fill', 'transparency', st)), color: g('text', 'fontColor', st) ?? (it.active ? '#FFFFFF' : '#252423'), fontSize: pt(g('text', 'fontSize', st), 13), fontFamily: font(g('text', 'fontFamily', st)), borderRadius: Number(g('shape', 'roundEdge', st) ?? 0) }}
            onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)}
            onClick={(e) => { if (e.ctrlKey || e.metaKey) it.go(); }}>{it.label}</div>
        );
      })}
      {!items.length && <span className="side-empty">{v.type === 'pageNavigator' ? 'Nessuna pagina visibile.' : 'Nessun segnalibro.'}</span>}
    </div>
  );
}

export function ShapeVisual({ v }: { v: Visual }) {
  const kind = String(sp(v, 'general', 'shapeType') ?? sp(v, 'shape', 'tileShape') ?? 'rectangle').toLowerCase();
  const fillOn = (sp(v, 'fill', 'show') ?? true) !== false;
  const fill = fillOn ? withAlpha(sp(v, 'fill', 'fillColor') ?? '#118DFF', sp(v, 'fill', 'transparency')) : 'none';
  const lineOn = (sp(v, 'line', 'show') ?? sp(v, 'outline', 'show') ?? true) !== false;
  const stroke = lineOn ? withAlpha(sp(v, 'line', 'lineColor') ?? sp(v, 'outline', 'lineColor') ?? '#252423', sp(v, 'line', 'transparency') ?? sp(v, 'outline', 'transparency')) : 'none';
  const sw = lineOn ? Number(sp(v, 'line', 'weight') ?? sp(v, 'outline', 'weight') ?? 1) : 0;
  const round = Number(sp(v, 'line', 'roundEdge') ?? sp(v, 'shape', 'roundEdge') ?? 0);
  const rot = Number(sp(v, 'rotation', 'angle') ?? sp(v, 'general', 'rotation') ?? 0);
  const w = v.w, h = v.h, i = sw / 2;
  let el;
  if (kind === 'line') el = <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke === 'none' ? (fill === 'none' ? '#252423' : fill) : stroke} strokeWidth={Math.max(1, sw)} />;
  else if (kind === 'oval') el = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (kind === 'triangle') el = <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (kind === 'arrow') el = <polygon points={`${i},${h * 0.3} ${w * 0.6},${h * 0.3} ${w * 0.6},${i} ${w - i},${h / 2} ${w * 0.6},${h - i} ${w * 0.6},${h * 0.7} ${i},${h * 0.7}`} fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (kind === 'tabcutcorner') el = <polygon points={`${i},${i} ${w - Math.min(w, h) * 0.25},${i} ${w - i},${Math.min(w, h) * 0.25} ${w - i},${h - i} ${i},${h - i}`} fill={fill} stroke={stroke} strokeWidth={sw} />;
  else el = <rect x={i} y={i} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={round} fill={fill} stroke={stroke} strokeWidth={sw} />;
  return (
    <svg style={{ position: 'absolute', inset: 0, transform: rot ? `rotate(${rot}deg)` : undefined }} width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">{el}</svg>
  );
}
