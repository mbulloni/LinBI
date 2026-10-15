import { useCallback, useEffect, useState } from 'react';
import { useStore } from './store';
import { TitleBar } from './components/TitleBar';
import { Ribbon } from './components/Ribbon';
import { Backstage } from './components/Backstage';
import { ReportView, StatusBar } from './components/ReportView';
import { DataView } from './components/DataView';
import { ModelView } from './components/ModelView';
import { ManageRelationships, RelationshipEditor } from './components/Relationships';
import { Navigator } from './components/Navigator';
import { PowerQueryEditor } from './components/PowerQuery';
import { Icon } from './components/icons';
import { FiltersPane, CollapsedPane } from './panes/FiltersPane';
import { VisualizationsPane } from './panes/VisualizationsPane';
import { DataPane } from './panes/DataPane';
import type { View } from './types';

const VIEWS: [View, string, string][] = [
  ['report', 'report', 'Vista report'],
  ['data', 'tableView', 'Vista tabella'],
  ['model', 'model', 'Vista modello'],
  ['dax', 'dax', 'Vista query DAX'],
];

function useShortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;
      if (s.pq) return;
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); s.save(e.shiftKey); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); s.open(); return; }
      if (typing) return;
      if (s.relEditor || s.relManage) return;
      if (s.view === 'model' && s.selectedRelId && e.key === 'Delete') { s.deleteRelationship(s.selectedRelId); return; }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); s.undo(); }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
      else if (s.view === 'report' && s.selectedVisualId) {
        const v = s.page().visuals.find((x) => x.id === s.selectedVisualId);
        if (!v) return;
        if (e.key === 'Delete') s.removeVisual(v.id);
        else if (ctrl && e.key.toLowerCase() === 'c') s.set({ clipboard: JSON.parse(JSON.stringify(v)) });
        else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateVisual(v.id); }
        else if (e.key === 'Escape') s.selectVisual(null);
        else if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
          const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
          s.updateVisual(v.id, { x: Math.max(0, v.x + dx), y: Math.max(0, v.y + dy) });
        }
      }
      if (ctrl && e.key.toLowerCase() === 'v' && s.clipboard && s.view === 'report') {
        const c = s.clipboard;
        const id = s.addVisual(c.type, { x: c.x + 20, y: c.y + 20 });
        const past = useStore.getState().past;
        s.updateVisual(id, { fields: c.fields, format: c.format, w: c.w, h: c.h, text: c.text, slicerValues: c.slicerValues, filters: c.filters });
        useStore.setState({ past });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

export function App() {
  const s = useStore();
  const [fit, setFit] = useState(1);
  const onFit = useCallback((n: number) => setFit(n), []);
  useShortcuts();

  return (
    <div className="app">
      <TitleBar />
      <Ribbon />
      <div className="main">
        <div className="rail">
          {VIEWS.map(([k, icon, label]) => (
            <button key={k} title={label} className={s.view === k ? 'active' : ''} onClick={() => s.setView(k)}><Icon name={icon} size={22} /></button>
          ))}
        </div>
        <div className="workspace">
          {s.view === 'report' && <ReportView onFit={onFit} />}
          {s.view === 'data' && <DataView />}
          {s.view === 'model' && <ModelView />}
          {s.view === 'dax' && (
            <div className="placeholder-view"><Icon name="dax" size={48} /><h2>Vista query DAX</h2><span>Il motore DAX → SQL arriverà nella fase 5.</span></div>
          )}
          {s.view === 'report' && (s.panes.filters ? <FiltersPane /> : <CollapsedPane title="Filtri" onOpen={() => s.set({ panes: { ...s.panes, filters: true } })} />)}
          {s.view === 'report' && (s.panes.viz ? <VisualizationsPane /> : <CollapsedPane title="Visualizzazioni" onOpen={() => s.set({ panes: { ...s.panes, viz: true } })} />)}
          {s.view !== 'dax' && (s.panes.data ? <DataPane /> : <CollapsedPane title="Dati" onOpen={() => s.set({ panes: { ...s.panes, data: true } })} />)}
        </div>
      </div>
      <StatusBar fitScale={fit} />
      <Backstage />
      <Navigator />
      <PowerQueryEditor />
      <ManageRelationships />
      <RelationshipEditor />
      {s.toast && <div className="toast" onClick={() => s.set({ toast: null })}>{s.toast}</div>}
      {s.busy && <div className="busy"><div className="box"><div className="spinner" />{s.busy}</div></div>}
    </div>
  );
}
