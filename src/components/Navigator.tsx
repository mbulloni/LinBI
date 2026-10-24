import { useStore } from '../store';
import { Icon } from './icons';

/** Power BI-style "Navigator" dialog: preview the source before loading it into the model. */
export function Navigator() {
  const s = useStore();
  const nav = s.navigator;
  if (!nav) return null;
  const file = nav.path.split('/').pop();
  const close = () => s.set({ navigator: null });
  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 'min(1100px, 92vw)', height: '78vh' }}>
        <div className="dh"><h2>Strumento di navigazione</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db">
          <div className="nav-left">
            <div className="item"><Icon name="docs" size={16} /><b>{file}</b> [1]</div>
            <div className="item sel" style={{ paddingLeft: 22 }}><input type="checkbox" checked readOnly /><Icon name="tableSmall" />{nav.tableName}</div>
          </div>
          <div className="nav-right">
            <div className="ttl">Nome tabella <input type="text" value={nav.tableName} onChange={(e) => s.set({ navigator: { ...nav, tableName: e.target.value } })} /></div>
            <div className="grid-wrap">
              {nav.loading && !nav.preview && <div style={{ padding: 24, display: 'flex', gap: 12, alignItems: 'center' }}><div className="spinner" />Caricamento anteprima…</div>}
              {nav.error && <div style={{ padding: 24, color: 'var(--err-text)' }}>{nav.error}</div>}
              {nav.preview && (
                <table>
                  <thead><tr>{nav.preview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{nav.preview.rows.map((r, i) => <tr key={i}>{nav.preview!.columns.map((c) => <td key={c}>{r[c] === null ? '' : String(r[c])}</td>)}</tr>)}</tbody>
                </table>
              )}
            </div>
            <div className="nav-note">L'anteprima mostra le prime 50 righe. I tipi di dati vengono rilevati automaticamente.</div>
          </div>
        </div>
        <div className="df">
          <button className="btn primary" disabled={nav.loading || !nav.preview || !nav.tableName.trim()} onClick={() => s.loadNavigator()}>Carica</button>
          <button className="btn" disabled={nav.loading || !nav.preview || !nav.tableName.trim()} onClick={() => s.transformNavigator()}>Trasforma dati</button>
          <button className="btn" onClick={close}>Annulla</button>
        </div>
      </div>
    </div>
  );
}
