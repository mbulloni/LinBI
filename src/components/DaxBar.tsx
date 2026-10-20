import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Icon } from './icons';
import { DaxInput } from './DaxInput';

const FORMATS: [string, string][] = [['', 'Generale'], ['0', 'Numero intero'], ['#,0.00', 'Numero decimale'], ['0.00%', 'Percentuale'], ['€ #,0.00', 'Valuta (€)']];
const KIND_LABEL = { measure: 'Strumenti misura', column: 'Strumenti colonna', table: 'Strumenti tabella', calcItem: 'Elemento di calcolo' } as const;

/** Power BI's formula bar for DAX: "Nome = espressione", ✓ to commit, ✗ (or Esc) to cancel. */
export function DaxBar() {
  const s = useStore();
  const ed = s.daxEdit;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ed) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ed?.kind, ed?.original]);
  if (!ed) return null;
  const set = (patch: Partial<typeof ed>) => s.set({ daxEdit: { ...ed, ...patch, error: patch.error } });
  const lines = Math.min(12, Math.max(1, ed.text.split('\n').length));
  const homes = [...new Set([...s.tables.map((t) => t.name), ...s.report.measures.map((m) => m.table)])];
  return (
    <div className="daxbar">
      <div className="daxbar-tools">
        <b>{KIND_LABEL[ed.kind]}</b>
        {ed.kind === 'measure' && (
          <>
            <label>Tabella principale <select value={ed.table} onChange={(e) => set({ table: e.target.value })}>{homes.map((h) => <option key={h}>{h}</option>)}</select></label>
            <label>Formato <select value={ed.formatString ?? ''} onChange={(e) => set({ formatString: e.target.value || undefined })}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </>
        )}
        {ed.kind === 'column' && <span>Tabella: {ed.table}</span>}
        {ed.kind === 'calcItem' && <span>Gruppo di calcolo: {ed.table} · usare SELECTEDMEASURE() per la misura nel contesto</span>}
        <span className="hint">Invio per confermare · Maiusc+Invio per andare a capo · Ctrl+Spazio suggerimenti · Esc per annullare</span>
      </div>
      <div className="daxbar-row">
        <button title="Annulla" onClick={() => s.set({ daxEdit: null })}><Icon name="close" size={14} /></button>
        <button title="Conferma" className="ok" onClick={() => s.saveDax()}>✓</button>
        <DaxInput ref={ref} rows={lines} value={ed.text} home={ed.kind === 'measure' || ed.kind === 'column' ? ed.table : ''}
          onChange={(text) => set({ text })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); s.saveDax(); }
            if (e.key === 'Escape') s.set({ daxEdit: null });
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget, a = el.selectionStart;
              set({ text: el.value.slice(0, a) + '    ' + el.value.slice(el.selectionEnd) });
              requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
            }
          }} />
      </div>
      {ed.error && <div className="daxbar-err"><Icon name="warning" size={14} />{ed.error}</div>}
    </div>
  );
}
