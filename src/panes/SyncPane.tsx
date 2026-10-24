// Formato › Sincronizza filtri dei dati: for the selected slicer, the pages where a synced copy exists
// ("Sincronizza") and is shown ("Visibile"); copies share the group name, selection and fields.
import { useStore } from '../store';
import { PaneShell } from './SelectionPane';
import { Toggle } from '../components/Menu';
import { autoTitle } from '../components/VisualContainer';

export function SyncPane() {
  const s = useStore();
  const page = s.page();
  const v = page.visuals.find((x) => x.id === s.selectedVisualId);
  const close = () => s.set({ panes: { ...s.panes, sync: false } });
  if (!v || v.type !== 'slicer') {
    return <PaneShell title="Sincronizza filtri dei dati" onClose={close}><div className="side-empty">Selezionare un filtro dei dati per sincronizzarlo con altre pagine.</div></PaneShell>;
  }
  const g = v.syncGroup;
  const memberOn = (pid: string) => {
    const p = s.report.pages.find((x) => x.id === pid)!;
    return p.id === page.id ? v : g ? p.visuals.find((x) => x.syncGroup?.name === g.name) : undefined;
  };
  return (
    <PaneShell title="Sincronizza filtri dei dati" onClose={close}>
      <div className="sync-pane">
        <div className="sync-name">{v.format.titleText || autoTitle(v) || 'Filtro dei dati'}</div>
        <table className="sync-table">
          <thead><tr><th>Nome</th><th title="Sincronizza">⟳</th><th title="Visibile">👁</th></tr></thead>
          <tbody>
            {s.report.pages.map((p) => {
              const m = memberOn(p.id);
              const sync = !!m && (p.id === page.id ? !!g : true);
              const visible = !!m && !m.hidden;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><input type="checkbox" checked={sync} title="Sincronizza" onChange={(e) => s.syncSlicer(v.id, p.id, { sync: e.target.checked, visible: e.target.checked ? visible : p.id === page.id ? visible : false })} /></td>
                  <td><input type="checkbox" checked={visible} title="Visibile" onChange={(e) => s.syncSlicer(v.id, p.id, { sync: e.target.checked || sync, visible: e.target.checked })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {g && <details className="sync-adv" open>
          <summary>Opzioni avanzate</summary>
          <label className="pq-field">Nome gruppo
            <input type="text" defaultValue={g.name} key={g.name} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== g.name) s.setSyncGroup(v.id, { name: n }); }} /></label>
          <div className="fmt-row inline"><span>Sincronizza modifiche ai campi con altri filtri dei dati</span><Toggle on={g.fieldChanges !== false} onChange={(b) => s.setSyncGroup(v.id, { fieldChanges: b ? undefined : false })} /></div>
          <div className="fmt-row inline"><span>Sincronizza modifiche ai filtri con altri filtri dei dati</span><Toggle on={g.filterChanges !== false} onChange={(b) => s.setSyncGroup(v.id, { filterChanges: b ? undefined : false })} /></div>
          <p className="sync-hint">I filtri dei dati con lo stesso nome di gruppo condividono la selezione, anche se si trovano su pagine diverse.</p>
        </details>}
      </div>
    </PaneShell>
  );
}
