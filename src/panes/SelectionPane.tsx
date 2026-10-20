// "Selezione" and "Segnalibri" panes (Visualizza ribbon), like Power BI Desktop.
import { useState, type ReactNode } from 'react';
import { useStore, isHiddenVisual } from '../store';
import type { Bookmark, Page, Visual, VisualGroup } from '../types';
import { Icon } from '../components/icons';
import { autoTitle } from '../components/VisualContainer';
import { visualDef } from '../visuals/catalog';

const Eye = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16"><path d="M1 8 C3 4 13 4 15 8 C13 12 3 12 1 8 Z" fill="none" stroke="#605E5C" strokeWidth="1.1" />
    {open ? <circle cx="8" cy="8" r="2" fill="#605E5C" /> : <path d="M2 14 L14 2" stroke="#605E5C" strokeWidth="1.2" />}</svg>
);

export function PaneShell({ title, onClose, children, tools }: { title: string; onClose: () => void; children: ReactNode; tools?: ReactNode }) {
  return (
    <div className="pane side-pane">
      <div className="pane-head"><h3>{title}</h3><div className="tools">{tools}<button title="Chiudi" onClick={onClose}><Icon name="close" size={12} /></button></div></div>
      <div className="pane-body">{children}</div>
    </div>
  );
}

const visualName = (v: Visual) => v.format.titleText || autoTitle(v) || visualDef(v.type, v.custom).name;

export function SelectionPane() {
  const s = useStore();
  const page = s.page();
  const [rename, setRename] = useState<string | null>(null);
  const groups = page.groups ?? [];
  const sel = new Set(s.multiSel.length ? s.multiSel : s.selectedVisualId ? [s.selectedVisualId] : []);
  // Top of the list = front of the page (highest z), groups ordered by their frontmost member.
  const zOf = (g: VisualGroup): number => Math.max(0, ...page.visuals.filter((v) => v.group === g.id).map((v) => v.z), ...groups.filter((x) => x.parent === g.id).map(zOf));
  const items = (parent?: string): ({ g: VisualGroup } | { v: Visual })[] => [
    ...groups.filter((g) => g.parent === parent).map((g) => ({ g, z: zOf(g) })),
    ...page.visuals.filter((v) => v.group === parent || (!parent && v.group && !groups.some((g) => g.id === v.group))).map((v) => ({ v, z: v.z })),
  ].sort((a, b) => b.z - a.z).map(({ z: _z, ...x }) => x as { g: VisualGroup } | { v: Visual });

  const click = (v: Visual, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { const cur = new Set(sel); if (cur.has(v.id)) cur.delete(v.id); else cur.add(v.id); s.set({ multiSel: [...cur], selectedVisualId: v.id }); }
    else s.set({ multiSel: [], selectedVisualId: v.id });
  };
  const row = (x: { g: VisualGroup } | { v: Visual }, depth: number): ReactNode => {
    if ('g' in x) {
      const g = x.g;
      return (
        <div key={g.id}>
          <div className="sel-row group" style={{ paddingLeft: depth * 14 }}>
            {rename === g.id
              ? <input autoFocus defaultValue={g.name} onBlur={(e) => { s.renameGroup(g.id, e.target.value || g.name); setRename(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              : <span className="nm" onDoubleClick={() => setRename(g.id)} title="Doppio clic per rinominare">▾ {g.name}</span>}
            <button title="Separa" onClick={() => s.ungroup(g.id)}>⊟</button>
            <button title={g.hidden ? 'Mostra' : 'Nascondi'} onClick={() => s.setGroupHidden(g.id, !g.hidden)}><Eye open={!g.hidden} /></button>
          </div>
          {items(g.id).map((c) => row(c, depth + 1))}
        </div>
      );
    }
    const v = x.v;
    return (
      <div key={v.id} className={'sel-row' + (sel.has(v.id) ? ' sel' : '') + (isHiddenVisual(page, v) ? ' off' : '')} style={{ paddingLeft: depth * 14 + 4 }} onClick={(e) => click(v, e)}>
        <span className="nm" title={visualDef(v.type, v.custom).name}>{visualName(v)}</span>
        <button title="Porta avanti" onClick={(e) => { e.stopPropagation(); s.moveLayer(v.id, 1); }}><Icon name="chevronUp" size={11} /></button>
        <button title="Porta indietro" onClick={(e) => { e.stopPropagation(); s.moveLayer(v.id, -1); }}><Icon name="chevronDown" size={11} /></button>
        <button title={v.hidden ? 'Mostra' : 'Nascondi'} onClick={(e) => { e.stopPropagation(); s.setVisualHidden(v.id, !v.hidden); }}><Eye open={!v.hidden} /></button>
      </div>
    );
  };
  const ids = [...sel];
  return (
    <PaneShell title="Selezione" onClose={() => s.set({ panes: { ...s.panes, selection: false } })}>
      <div className="sel-tools">
        <button className="btn" disabled={ids.length < 2} title="Selezionare più oggetti visivi con Ctrl+clic" onClick={() => s.groupVisuals(ids)}>Raggruppa</button>
        <button className="btn" onClick={() => s.mut((r) => { const p = r.pages.find((x) => x.id === page.id)!; p.visuals.forEach((v) => (v.hidden = undefined)); p.groups?.forEach((g) => (g.hidden = undefined)); })}>Mostra tutto</button>
        <button className="btn" onClick={() => s.mut((r) => { const p = r.pages.find((x) => x.id === page.id)!; p.visuals.forEach((v) => (v.hidden = true)); })}>Nascondi tutto</button>
      </div>
      <div className="sel-hdr">Livelli</div>
      {items(undefined).map((x) => row(x, 0))}
      {!page.visuals.length && <div className="side-empty">Nessun oggetto visivo nella pagina.</div>}
    </PaneShell>
  );
}

export function BookmarksPane() {
  const s = useStore();
  const list = s.report.bookmarks ?? [];
  const [rename, setRename] = useState<string | null>(null);
  const [opts, setOpts] = useState<string | null>(null);
  const pageName = (id?: string) => s.report.pages.find((p: Page) => p.id === id)?.name;
  let lastGroup: string | undefined;
  const opt = (b: Bookmark, k: 'applyData' | 'applyDisplay' | 'applyPage', label: string) => (
    <label className="rcheck"><input type="checkbox" checked={b[k]} onChange={(e) => s.setBookmark(b.id, { [k]: e.target.checked })} />{label}</label>
  );
  return (
    <PaneShell title="Segnalibri" onClose={() => s.set({ panes: { ...s.panes, bookmarks: false } })}>
      <div className="sel-tools">
        <button className="btn" onClick={() => s.addBookmark()}>Aggiungi</button>
      </div>
      {list.map((b, i) => {
        const header = b.group && b.group !== lastGroup ? <div className="sel-hdr" key={'g' + i}>{b.group}</div> : null;
        lastGroup = b.group;
        return (
          <div key={b.id}>
            {header}
            <div className="bm-row" onClick={() => s.applyBookmark(b.id)} title={`Pagina: ${pageName(b.page) ?? '—'}`}>
              {rename === b.id
                ? <input autoFocus defaultValue={b.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { s.setBookmark(b.id, { name: e.target.value || b.name }); setRename(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                : <span className="nm">{b.name}</span>}
              <button title="Altre opzioni" onClick={(e) => { e.stopPropagation(); setOpts(opts === b.id ? null : b.id); }}><Icon name="more" size={13} /></button>
            </div>
            {opts === b.id && (
              <div className="bm-opts" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { s.updateBookmark(b.id); setOpts(null); }}>Aggiorna</button>
                <button onClick={() => { setRename(b.id); setOpts(null); }}>Rinomina</button>
                <button onClick={() => s.moveBookmark(b.id, -1)}>Sposta su</button>
                <button onClick={() => s.moveBookmark(b.id, 1)}>Sposta giù</button>
                <button onClick={() => { s.removeBookmark(b.id); setOpts(null); }}>Elimina</button>
                <hr />
                {opt(b, 'applyData', 'Dati')}
                {opt(b, 'applyDisplay', 'Visualizzazione')}
                {opt(b, 'applyPage', 'Pagina corrente')}
                <hr />
                <label className="rcheck"><input type="radio" checked={!b.targets} onChange={() => s.setBookmark(b.id, { targets: undefined })} />Tutti gli oggetti visivi</label>
                <label className="rcheck"><input type="radio" checked={!!b.targets} onChange={() => {
                  const cur = s.multiSel.length ? s.multiSel : s.selectedVisualId ? [s.selectedVisualId] : [];
                  if (!cur.length) { s.notify('Selezionare prima gli oggetti visivi (Ctrl+clic) da includere nel segnalibro.'); return; }
                  s.setBookmark(b.id, { targets: cur });
                }} />Oggetti visivi selezionati{b.targets ? ` (${b.targets.length})` : ''}</label>
              </div>
            )}
          </div>
        );
      })}
      {!list.length && <div className="side-empty">Aggiungere un segnalibro per salvare la visualizzazione corrente della pagina (filtri, oggetti visivi nascosti, pagina).</div>}
    </PaneShell>
  );
}
