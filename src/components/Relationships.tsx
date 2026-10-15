import { useEffect, useState } from 'react';
import { api } from '../api';
import { isUnique, useStore } from '../store';
import type { Relationship } from '../types';
import { connected, qi } from '../query';
import { isNumeric, uid } from '../format';
import { Icon } from './icons';

type Card = '*:1' | '1:1' | '1:*' | '*:*';
const CARD_LABEL: Record<Card, string> = { '*:1': 'Molti-a-uno (*:1)', '1:1': 'Uno-a-uno (1:1)', '1:*': 'Uno-a-molti (1:*)', '*:*': 'Molti-a-molti (*:*)' };

export const relLabel = (r: Relationship) => `${r.fromTable} (${r.fromColumn})`;
export const relTarget = (r: Relationship) => `${r.toTable} (${r.toColumn})`;

export function emptyDraft(fromTable = '', fromColumn = '', toTable = '', toColumn = ''): Relationship {
  return { id: uid(), fromTable, fromColumn, toTable, toColumn, cardinality: 'manyToOne', crossFilter: 'single', active: true };
}

/** Why a relationship cannot be active (another active path already links its tables). */
export function activationConflict(rels: Relationship[], r: Relationship): string | null {
  if (!connected(rels, r.fromTable, r.toTable, r.id)) return null;
  return `Esiste già un percorso attivo tra "${r.fromTable}" e "${r.toTable}". Disattivare l'altra relazione oppure salvare questa come inattiva.`;
}

function Preview({ table, column, onPick }: { table: string; column: string; onPick: (c: string) => void }) {
  const [rows, setRows] = useState<{ columns: string[]; rows: Record<string, any>[] } | null>(null);
  useEffect(() => {
    setRows(null);
    if (table) api.query(`SELECT * FROM ${qi(table)} LIMIT 5`).then(setRows).catch(() => setRows({ columns: [], rows: [] }));
  }, [table]);
  return (
    <div className="grid-wrap rel-preview">
      {rows && (
        <table>
          <thead><tr>{rows.columns.map((c) => <th key={c} className={c === column ? 'sel' : ''} onClick={() => onPick(c)}>{c}</th>)}</tr></thead>
          <tbody>{rows.rows.map((r, i) => <tr key={i}>{rows.columns.map((c) => <td key={c} className={c === column ? 'sel' : ''}>{r[c] === null ? '' : String(r[c])}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/** "Nuova relazione" / "Modifica relazione" dialog. */
export function RelationshipEditor() {
  const s = useStore();
  const ed = s.relEditor;
  const [t1, setT1] = useState(''); const [c1, setC1] = useState('');
  const [t2, setT2] = useState(''); const [c2, setC2] = useState('');
  const [card, setCard] = useState<Card>('*:1');
  const [both, setBoth] = useState(false);
  const [active, setActive] = useState(true);
  const [uniq, setUniq] = useState<[boolean, boolean] | null>(null);

  useEffect(() => {
    if (!ed) return;
    const d = ed.draft;
    setT1(d.fromTable); setC1(d.fromColumn); setT2(d.toTable); setC2(d.toColumn);
    setCard(d.cardinality === 'oneToOne' ? '1:1' : d.cardinality === 'manyToMany' ? '*:*' : '*:1');
    setBoth(d.crossFilter === 'both'); setActive(d.active);
  }, [ed]);

  // Profile both columns; for new relationships also suggest cardinality like Power BI does.
  useEffect(() => {
    setUniq(null);
    if (!t1 || !c1 || !t2 || !c2) return;
    let live = true;
    Promise.all([isUnique(t1, c1), isUnique(t2, c2)]).then(([u1, u2]) => {
      if (!live) return;
      setUniq([u1, u2]);
      if (ed?.isNew) {
        const sug: Card = u1 && u2 ? '1:1' : u2 ? '*:1' : u1 ? '1:*' : '*:*';
        setCard(sug);
        if (sug === '1:1') setBoth(true);
      }
    });
    return () => { live = false; };
  }, [t1, c1, t2, c2, ed?.isNew]);

  if (!ed) return null;
  const meta = (t: string, c: string) => s.tables.find((x) => x.name === t)?.columns.find((x) => x.name === c);
  const draft = (): Relationship => {
    const swap = card === '1:*';
    return {
      id: ed.draft.id,
      fromTable: swap ? t2 : t1, fromColumn: swap ? c2 : c1, toTable: swap ? t1 : t2, toColumn: swap ? c1 : c2,
      cardinality: card === '1:1' ? 'oneToOne' : card === '*:*' ? 'manyToMany' : 'manyToOne',
      crossFilter: card === '1:1' || both ? 'both' : 'single',
      active,
    };
  };

  let error: string | null = null;
  if (!t1 || !c1 || !t2 || !c2) error = 'Selezionare una colonna in ciascuna tabella.';
  else if (t1 === t2) error = 'Selezionare due tabelle diverse.';
  else if (isNumeric(meta(t1, c1)) !== isNumeric(meta(t2, c2))) error = 'Le colonne selezionate hanno tipi di dati non compatibili.';
  else if (uniq && ((card === '*:1' && !uniq[1]) || (card === '1:*' && !uniq[0]) || (card === '1:1' && !(uniq[0] && uniq[1])))) {
    error = 'La cardinalità selezionata non è valida per questa relazione: la colonna sul lato "uno" contiene valori duplicati.';
  } else {
    const d = draft();
    const others = s.report.relationships.filter((r) => r.id !== d.id);
    if (others.some((r) => r.fromTable === d.fromTable && r.fromColumn === d.fromColumn && r.toTable === d.toTable && r.toColumn === d.toColumn)) error = 'Questa relazione esiste già.';
    else if (active) error = activationConflict(others, d);
  }

  const close = () => s.set({ relEditor: null });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" style={{ width: 'min(860px, 94vw)' }}>
        <div className="dh"><h2>{ed.isNew ? 'Nuova relazione' : 'Modifica relazione'}</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db" style={{ flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          <div style={{ color: 'var(--text2)' }}>Selezionare le tabelle e le colonne correlate.</div>
          <label className="fmt-row"><span>Da tabella</span>
            <select value={t1} onChange={(e) => { setT1(e.target.value); setC1(''); }}>
              <option value="" />{s.tables.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
          <Preview table={t1} column={c1} onPick={setC1} />
          <label className="fmt-row"><span>A tabella</span>
            <select value={t2} onChange={(e) => { setT2(e.target.value); setC2(''); }}>
              <option value="" />{s.tables.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
          <Preview table={t2} column={c2} onPick={setC2} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label className="fmt-row"><span>Cardinalità</span>
              <select value={card} onChange={(e) => { const v = e.target.value as Card; setCard(v); if (v === '1:1') setBoth(true); }}>
                {(Object.keys(CARD_LABEL) as Card[]).map((c) => <option key={c} value={c}>{CARD_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="fmt-row"><span>Direzione filtro incrociato</span>
              <select value={card === '1:1' || both ? 'both' : 'single'} disabled={card === '1:1'} onChange={(e) => setBoth(e.target.value === 'both')}>
                <option value="single">Singola</option><option value="both">Entrambe</option>
              </select>
            </label>
          </div>
          <label className="rcheck" style={{ paddingLeft: 0 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Rendi attiva questa relazione</label>
          {uniq && !error && <div style={{ color: 'var(--text2)' }}>
            {c1 && `${t1}[${c1}]: ${uniq[0] ? 'valori univoci' : 'valori ripetuti'}`} · {c2 && `${t2}[${c2}]: ${uniq[1] ? 'valori univoci' : 'valori ripetuti'}`}
          </div>}
          {error && t1 && t2 && c1 && c2 && <div className="rel-error">{error}</div>}
        </div>
        <div className="df">
          <button className="btn primary" disabled={!!error || !uniq} onClick={() => { s.saveRelationship(draft()); close(); }}>OK</button>
          <button className="btn" onClick={close}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

/** "Gestisci relazioni" dialog. */
export function ManageRelationships() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!s.relManage) return null;
  const rels = s.report.relationships;
  const selected = rels.find((r) => r.id === sel);
  const close = () => s.set({ relManage: false });

  const toggleActive = (r: Relationship) => {
    if (!r.active) {
      const c = activationConflict(rels, r);
      if (c) { s.notify(c); return; }
    }
    s.saveRelationship({ ...r, active: !r.active });
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" style={{ width: 'min(760px, 94vw)', height: 'min(520px, 86vh)' }}>
        <div className="dh"><h2>Gestisci relazioni</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db" style={{ flexDirection: 'column' }}>
          <div className="grid-wrap" style={{ border: '1px solid var(--line)' }}>
            <table style={{ width: '100%' }}>
              <thead><tr><th style={{ width: 60 }}>Attiva</th><th>Da: Tabella (Colonna)</th><th>A: Tabella (Colonna)</th><th style={{ width: 70 }}>Cardinalità</th><th style={{ width: 80 }}>Filtro</th></tr></thead>
              <tbody>
                {rels.map((r) => (
                  <tr key={r.id} className={sel === r.id ? 'selrow' : ''} onClick={() => setSel(r.id)} onDoubleClick={() => s.set({ relEditor: { draft: r, isNew: false } })}>
                    <td><input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} onClick={(e) => e.stopPropagation()} /></td>
                    <td>{relLabel(r)}</td>
                    <td>{relTarget(r)}</td>
                    <td>{r.cardinality === 'oneToOne' ? '1:1' : r.cardinality === 'manyToMany' ? '*:*' : '*:1'}</td>
                    <td>{r.crossFilter === 'both' ? 'Entrambe' : 'Singola'}</td>
                  </tr>
                ))}
                {!rels.length && <tr><td colSpan={5} style={{ color: 'var(--text2)', padding: 16 }}>Non sono state definite relazioni.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="df" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => s.set({ relEditor: { draft: emptyDraft(), isNew: true } })}>Nuova…</button>
            <button className="btn" disabled={busy || s.tables.length < 2} onClick={async () => {
              setBusy(true);
              const n = await s.detectRelationships();
              setBusy(false);
              s.notify(n ? `Rilevate ${n} nuove relazioni.` : 'Nessuna nuova relazione rilevata.');
            }}>Rilevamento automatico…</button>
            <button className="btn" disabled={!selected} onClick={() => selected && s.set({ relEditor: { draft: selected, isNew: false } })}>Modifica…</button>
            <button className="btn" disabled={!selected} onClick={() => { if (selected) { s.deleteRelationship(selected.id); setSel(null); } }}>Elimina</button>
          </div>
          <button className="btn" onClick={close}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
