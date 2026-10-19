import { useState } from 'react';
import { Rnd } from 'react-rnd';
import type { Visual } from '../types';
import { THEME } from '../themes';
import { useStore } from '../store';
import { useVisualData } from '../visuals/useVisualData';
import { ChartVisual } from '../visuals/ChartVisual';
import { CardVisual, KpiVisual, MatrixVisual, MultiRowCardVisual, SlicerVisual, TableVisual, TextboxVisual } from '../visuals/Others';
import { isChart, visualDef } from '../visuals/catalog';
import { fieldLabel } from '../format';
import { NULL_KEY } from '../query';
import { Icon, VisualIcon } from './icons';
import { Menu } from './Menu';

export const FIELD_MIME = 'application/x-linbi-field';

export function autoTitle(v: Visual): string {
  const f = v.fields;
  const lbl = (k: string) => (f[k] ?? []).map(fieldLabel);
  if (v.type === 'slicer') return lbl('category')[0] ?? '';
  if (v.type === 'scatter') {
    const parts = [...lbl('x'), ...lbl('y')];
    return parts.length ? `${parts.join(' e ')}${f.details?.length ? ' per ' + f.details[0].column : ''}` : '';
  }
  if (v.type === 'gauge') return lbl('values')[0] ?? '';
  if (v.type === 'kpi') return [...lbl('values'), ...lbl('target')].join(' e ');
  const values = [...lbl('values'), ...lbl('lineValues')];
  const dims = [...(f.category ?? []), ...(f.rows ?? []), ...(f.legend ?? []), ...(f.columns ?? [])].map((x) => x.column);
  if (!values.length) return dims.join(', ');
  return dims.length ? `${values.join(' e ')} per ${dims.join(' e ')}` : values.join(' e ');
}

export function VisualBody({ v, selected }: { v: Visual; selected: boolean }) {
  const data = useVisualData(v);
  const cross = useStore((s) => s.crossFilter);
  const setCross = useStore((s) => s.setCross);
  const def = visualDef(v.type);
  const catWell = def.category;

  const onSelect = (category: string | null) => {
    const field = catWell ? v.fields[catWell]?.[0] : data.items.find((i) => !i.measure)?.field;
    if (!field) return;
    const value = category === null ? NULL_KEY : category;
    if (cross?.visualId === v.id && cross.value === value) setCross(null);
    else setCross({ visualId: v.id, table: field.table, column: field.column, value });
  };

  if (v.type === 'textbox') return <TextboxVisual v={v} selected={selected} />;
  if (v.type === 'image') return <img src={v.image} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />;
  if (v.type === 'unsupported') return <div className="vc-error"><b>Oggetto visivo non supportato</b><span>{v.text}</span></div>;
  if (data.empty) return <div className="vc-placeholder"><VisualIcon type={v.type} size={Math.min(120, v.h * 0.45)} /></div>;
  if (data.error) return <div className="vc-error"><b>Impossibile visualizzare l'oggetto visivo.</b><span>{data.error}</span></div>;
  if (v.type === 'card') return <CardVisual data={data} />;
  if (v.type === 'kpi') return <KpiVisual data={data} />;
  if (v.type === 'multiRowCard') return <MultiRowCardVisual v={v} data={data} cross={cross} onSelect={onSelect} />;
  if (v.type === 'table') return <TableVisual v={v} data={data} cross={cross} onSelect={onSelect} />;
  if (v.type === 'matrix') return <MatrixVisual v={v} data={data} cross={cross} onSelect={onSelect} />;
  if (v.type === 'slicer') return <SlicerVisual v={v} data={data} />;
  return <ChartVisual v={v} data={data} cross={cross} onSelect={onSelect} />;
}

/** Non-interactive visual at its page position (PDF export). */
export function VisualStatic({ v }: { v: Visual }) {
  const title = v.format.titleText || autoTitle(v);
  return (
    <div className="vc-inner print-vc" style={{
      left: v.x, top: v.y, width: v.w, height: v.h, zIndex: v.z,
      background: v.format.background.toUpperCase() === '#FFFFFF' ? THEME.background : v.format.background,
      border: v.format.border ? '1px solid #C8C6C4' : undefined, borderRadius: v.format.border ? 4 : 0,
    }}>
      {v.format.titleShow && title && <div className="vc-title" style={{ fontSize: v.format.titleSize }}>{title}</div>}
      <div className="vc-body"><VisualBody v={v} selected={false} /></div>
    </div>
  );
}

export function VisualContainer({ v, scale }: { v: Visual; scale: number }) {
  const s = useStore();
  const selected = s.selectedVisualId === v.id;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const title = v.format.titleText || autoTitle(v);
  const def = visualDef(v.type);
  const allFields = def.wells.flatMap((w) => (v.fields[w.key] ?? []).map((f) => ({ f, w })));

  return (
    <Rnd
      className={'vc' + (selected ? ' selected' : '') + (over ? ' drop-target' : '')}
      size={{ width: v.w, height: v.h }}
      position={{ x: v.x, y: v.y }}
      scale={scale}
      bounds="parent"
      minWidth={60}
      minHeight={40}
      dragGrid={s.snapToGrid ? [16, 16] : [1, 1]}
      resizeGrid={s.snapToGrid ? [16, 16] : [1, 1]}
      cancel=".tbl, .slicer-v, .textbox-v[contenteditable=true], .vc-header"
      style={{ zIndex: selected ? 1000 : v.z }}
      enableResizing={selected}
      resizeHandleClasses={selected ? { topLeft: 'rnd-handle', topRight: 'rnd-handle', bottomLeft: 'rnd-handle', bottomRight: 'rnd-handle', top: 'rnd-handle', bottom: 'rnd-handle', left: 'rnd-handle', right: 'rnd-handle' } : undefined}
      resizeHandleStyles={{ top: { left: '50%', marginLeft: -4, top: -5 }, bottom: { left: '50%', marginLeft: -4, bottom: -5 }, left: { top: '50%', marginTop: -4, left: -5 }, right: { top: '50%', marginTop: -4, right: -5 }, topLeft: { left: -5, top: -5 }, topRight: { right: -5, top: -5 }, bottomLeft: { left: -5, bottom: -5 }, bottomRight: { right: -5, bottom: -5 } }}
      onMouseDown={(e: MouseEvent) => { e.stopPropagation(); if (!selected) s.selectVisual(v.id); }}
      onDragStop={(_e, d) => { if (d.x !== v.x || d.y !== v.y) s.updateVisual(v.id, { x: Math.round(d.x), y: Math.round(d.y) }); }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => s.updateVisual(v.id, { w: Math.round(ref.offsetWidth), h: Math.round(ref.offsetHeight), x: Math.round(pos.x), y: Math.round(pos.y) })}
    >
      <div
        className="vc-inner"
        style={{ background: v.format.background.toUpperCase() === '#FFFFFF' ? THEME.background : v.format.background, border: v.format.border ? '1px solid #C8C6C4' : undefined, borderRadius: v.format.border ? 4 : 0 }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(FIELD_MIME)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const raw = e.dataTransfer.getData(FIELD_MIME);
          if (!raw) return;
          e.preventDefault(); e.stopPropagation();
          s.addField(v.id, JSON.parse(raw));
          s.selectVisual(v.id);
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {v.format.titleShow && title && <div className="vc-title" style={{ fontSize: v.format.titleSize }}>{title}</div>}
        <div className="vc-body"><VisualBody v={v} selected={selected} /></div>
      </div>
      <div className="vc-frame" />
      <div className="vc-header" onMouseDown={(e) => e.stopPropagation()}>
        {isChart(v.type) || v.type === 'table' || v.type === 'matrix' ? (
          <button title="Modalità messa a fuoco" onClick={() => s.set({ focusId: v.id })}><Icon name="focus" size={13} /></button>
        ) : null}
        <button title="Altre opzioni" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 200, y: r.bottom + 2 }); }}><Icon name="more" size={14} /></button>
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {allFields.length > 0 && v.type !== 'textbox' && v.type !== 'card' && v.type !== 'kpi' && v.type !== 'slicer' && v.type !== 'gauge' && <>
            <div className="hdr">Ordina asse</div>
            {allFields.map(({ f }, i) => (
              <button key={i} onClick={() => { setMenu(null); s.updateFormat(v.id, { sortBy: i, sortDir: v.format.sortBy === i && v.format.sortDir === 'desc' ? 'asc' : 'desc' }); }}>
                <span style={{ width: 12 }}>{v.format.sortBy === i ? '✓' : ''}</span>{fieldLabel(f)}
              </button>
            ))}
            <button onClick={() => { setMenu(null); s.updateFormat(v.id, { sortDir: 'desc' }); }}><span style={{ width: 12 }}>{v.format.sortDir !== 'asc' ? '✓' : ''}</span>Ordinamento decrescente</button>
            <button onClick={() => { setMenu(null); s.updateFormat(v.id, { sortDir: 'asc', sortBy: v.format.sortBy ?? 0 }); }}><span style={{ width: 12 }}>{v.format.sortDir === 'asc' ? '✓' : ''}</span>Ordinamento crescente</button>
            <hr />
          </>}
          <button onClick={() => { setMenu(null); s.duplicateVisual(v.id); }}>Duplica</button>
          <button onClick={() => { setMenu(null); s.set({ clipboard: JSON.parse(JSON.stringify(v)) }); }}>Copia</button>
          <button onClick={() => { setMenu(null); s.updateVisual(v.id, { z: Math.max(...s.page().visuals.map((x) => x.z)) + 1 }); }}>Porta in primo piano</button>
          <button onClick={() => { setMenu(null); s.updateVisual(v.id, { z: Math.min(...s.page().visuals.map((x) => x.z)) - 1 }); }}>Porta in secondo piano</button>
          <hr />
          <button onClick={() => { setMenu(null); s.removeVisual(v.id); }}><Icon name="trash" />Rimuovi</button>
        </Menu>
      )}
    </Rnd>
  );
}
