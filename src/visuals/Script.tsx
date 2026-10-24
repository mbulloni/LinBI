// Python / R visuals: the visual's fields become `dataset`, the script draws an image (electron/scripts.cjs).
import { useEffect, useState } from 'react';
import type { Visual } from '../types';
import type { VisualData } from './useVisualData';
import { useStore } from '../store';
import { api } from '../api';
import { sp } from './pbistyle';

export const DEFAULT_SCRIPT: Record<'pythonVisual' | 'rVisual', string> = {
  pythonVisual: `# Il codice seguente per creare un dataframe e rimuovere le righe duplicate viene sempre eseguito
# e funge da preambolo per lo script:
# dataset = pandas.DataFrame(<campi>)
# dataset = dataset.drop_duplicates()

# Incollare o digitare qui il codice dello script:
import matplotlib.pyplot as plt
dataset.plot()
plt.show()
`,
  rVisual: `# Il codice seguente per creare un dataframe e rimuovere le righe duplicate viene sempre eseguito
# e funge da preambolo per lo script:
# dataset <- data.frame(<campi>)
# dataset <- unique(dataset)

# Incollare o digitare qui il codice dello script:
plot(dataset)
`,
};

/** Script of the visual: edited in MiB-BI, else imported from Power BI (objects.script.source). */
export const scriptOf = (v: Visual): string => v.script ?? (typeof sp(v, 'script', 'source') === 'string' ? sp(v, 'script', 'source') : '');

const csvCell = (x: unknown) => {
  if (x === null || x === undefined) return '';
  const s = String(x);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** dataset columns are named after the fields (column or measure names), made unique. */
function toCsv(data: VisualData): string {
  const seen = new Map<string, number>();
  const names = data.items.map((i) => {
    const n = i.field.column;
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return k ? `${n}.${k}` : n;
  });
  // Dimensions come back as text: use their raw key column when numeric (k_cN).
  const value = (r: Record<string, any>, i: VisualData['items'][number]) => (i.measure ? r[i.alias] : r[`k_${i.alias}`] ?? r[i.alias]);
  return [names.map(csvCell).join(','), ...data.rows.map((r) => data.items.map((i) => csvCell(value(r, i))).join(','))].join('\n');
}

export function ScriptVisual({ v, data }: { v: Visual; data: VisualData }) {
  const enabled = useStore((s) => s.scriptsEnabled);
  const set = useStore((s) => s.set);
  const [img, setImg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const script = scriptOf(v);
  const lang = v.type === 'rVisual' ? 'r' : 'python';
  const csv = data.loading || data.error ? null : toCsv(data);
  const w = v.w - 8, h = v.h - (v.format.titleShow ? 34 : 10);

  useEffect(() => {
    if (!enabled || !script.trim() || csv === null || !data.items.length) return;
    let live = true;
    // Debounced: resizing or typing should not start a process per frame.
    const t = setTimeout(() => {
      setBusy(true);
      api.runScript(lang, script, csv, w, h)
        .then((u) => { if (live) { setImg(u); setErr(null); } })
        .catch((e) => { if (live) setErr(e.message); })
        .finally(() => live && setBusy(false));
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [enabled, script, csv, w, h, lang]);

  if (!enabled) {
    return (
      <div className="script-v ask">
        <b>Abilitare gli oggetti visivi script?</b>
        <span>Gli oggetti visivi Python e R eseguono codice sul computer: abilitarli solo per report di cui ci si fida.</span>
        <button className="btn primary" onClick={(e) => { e.stopPropagation(); set({ scriptsEnabled: true }); }}>Abilita</button>
      </div>
    );
  }
  if (!script.trim()) {
    return <div className="script-v ask"><span>Aggiungere i campi in <b>Valori</b> e scrivere lo script nell'editor.</span>
      <button className="btn" onClick={(e) => { e.stopPropagation(); set({ scriptEditor: v.id }); }}>Apri l'editor di script</button></div>;
  }
  return (
    <div className="script-v" style={{ opacity: busy ? 0.6 : 1 }} onDoubleClick={() => set({ scriptEditor: v.id })}>
      {err ? <div className="vc-error" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}><b>Errore dello script</b><span>{err}</span></div>
        : img ? <img src={img} alt="" draggable={false} /> : <span className="script-run">Esecuzione dello script…</span>}
    </div>
  );
}

/** Script editor (bottom of the report canvas in Power BI): edit, run, close. */
export function ScriptEditor() {
  const s = useStore();
  const v = s.report.pages.flatMap((p) => p.visuals).find((x) => x.id === s.scriptEditor);
  const [text, setText] = useState('');
  useEffect(() => {
    if (v) setText(scriptOf(v) || DEFAULT_SCRIPT[v.type as 'pythonVisual' | 'rVisual'] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.scriptEditor]);
  if (!v) return null;
  const run = () => s.updateVisual(v.id, { script: text });
  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 760, maxHeight: '90vh' }}>
        <div className="dh"><h2>Editor di script {v.type === 'rVisual' ? 'R' : 'Python'}</h2><button onClick={() => s.set({ scriptEditor: null })}>×</button></div>
        <div className="db">
          <textarea className="script-editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } }} />
          <div className="pq-note">La variabile <code>dataset</code> contiene i campi in <b>Valori</b> (righe duplicate rimosse). Ctrl+Invio esegue lo script.</div>
        </div>
        <div className="df">
          <button className="btn primary" onClick={() => { run(); if (!s.scriptsEnabled) s.set({ scriptsEnabled: true }); }}>Esegui script</button>
          <button className="btn" onClick={() => { run(); s.set({ scriptEditor: null }); }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
