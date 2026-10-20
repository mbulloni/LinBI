// Q&A visual: type a question, get a visual (local rules or Claude), turn it into a regular visual.
import { useEffect, useMemo, useState } from 'react';
import type { Visual } from '../types';
import { useStore } from '../store';
import { api, type ClaudeStatus } from '../api';
import { buildIndex, parse, schemaText, suggestions, toVisual, type QnaIndex } from './rules';
import { VisualBody } from '../components/VisualContainer';
import { sp } from '../visuals/pbistyle';

let cache: { key: unknown[]; idx: Promise<QnaIndex> } | null = null;
function useIndex(): QnaIndex | null {
  const tables = useStore((s) => s.tables);
  const measures = useStore((s) => s.report.measures);
  const version = useStore((s) => s.dataVersion);
  const [idx, setIdx] = useState<QnaIndex | null>(null);
  useEffect(() => {
    const key = [tables, measures, version];
    if (!cache || cache.key.some((k, i) => k !== key[i])) cache = { key, idx: buildIndex(tables, measures) };
    let live = true;
    cache.idx.then((x) => live && setIdx(x));
    return () => { live = false; };
  }, [tables, measures, version]);
  return idx;
}

/** `onChange`: the visual lives outside the report (Esplora Q&A), changes go to its owner. */
export function QnaVisual({ v, selected, onChange }: { v: Visual; selected: boolean; onChange?: (patch: Partial<Visual>) => void }) {
  const s = useStore();
  const update = (patch: Partial<Visual>) => (onChange ? onChange(patch) : s.updateVisual(v.id, patch));
  const idx = useIndex();
  const saved = v.qna?.question ?? (typeof sp(v, 'hiddenProperties', 'savedUtterance') === 'string' ? sp(v, 'hiddenProperties', 'savedUtterance') : '');
  const [q, setQ] = useState(saved);
  const [mode, setMode] = useState<'local' | 'claude'>(v.qna?.source ?? 'local');
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [settings, setSettings] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.claude.status().then(setClaude).catch(() => {}); }, []);

  // Local answers are recomputed (cheap); Claude answers are kept in the visual so reopening costs nothing.
  const spec = useMemo(() => {
    if (v.qna?.source === 'claude' && v.qna.spec && v.qna.question === saved) return v.qna.spec;
    return idx && saved.trim() ? parse(saved, idx) : null;
  }, [idx, saved, v.qna]);
  const answer = useMemo(() => (spec?.answerable ? toVisual(spec, { id: v.id + ':qna', x: 0, y: 0, w: v.w, h: v.h - 70, z: 0 }, s.tables, s.report.measures) : null), [spec, s.tables, s.report.measures, v.w, v.h]);

  const ask = async (question = q) => {
    setError(null);
    if (!question.trim()) return;
    if (mode === 'local' || !claude?.configured) { update({ qna: { question, source: 'local' } }); return; }
    if (!idx) return;
    setBusy(true);
    try {
      const r = await api.claude.ask(question, schemaText(s.tables, s.report.measures, idx));
      update({ qna: { question, spec: r.spec, source: 'claude' } });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const convert = () => {
    if (!answer) return;
    const nv: Visual = { ...answer, id: v.id, x: v.x, y: v.y, w: v.w, h: v.h, z: v.z, format: { ...answer.format, titleShow: true } };
    s.mut((r) => { for (const p of r.pages) p.visuals = p.visuals.map((x) => (x.id === v.id ? nv : x)); });
  };
  const saveClaude = async () => {
    try { setClaude(await api.claude.configure(key || null, claude?.model)); setKey(''); setSettings(false); setMode('claude'); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="qna" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('input,select,button,textarea')) e.stopPropagation(); }}>
      <div className="qna-bar">
        <input type="text" value={q} placeholder="Porre una domanda sui dati" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} />
        <select value={mode} title="Interpretazione della domanda" onChange={(e) => setMode(e.target.value as 'local' | 'claude')}>
          <option value="local">Locale</option>
          <option value="claude" disabled={!claude?.configured}>Claude{claude?.configured ? '' : ' (da configurare)'}</option>
        </select>
        <button className="btn" style={{ minWidth: 0 }} disabled={busy} onClick={() => ask()}>{busy ? '…' : 'Chiedi'}</button>
        <button className="btn" style={{ minWidth: 0 }} title="Impostazioni Claude" onClick={() => setSettings(!settings)}>⚙</button>
      </div>
      {settings && claude && (
        <div className="qna-settings">
          <div><b>Claude</b> interpreta domande libere. Riceve solo lo schema del modello (tabelle, colonne, misure e alcuni valori di esempio), mai le righe dei dati. Ogni domanda è una richiesta a pagamento all'API di Anthropic.</div>
          <label>Chiave API <input type="password" value={key} placeholder={claude.configured ? (claude.fromEnv ? 'da ANTHROPIC_API_KEY' : 'salvata (lasciare vuoto per mantenerla)') : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} /></label>
          <label>Modello <select value={claude.model} onChange={async (e) => setClaude(await api.claude.configure(null, e.target.value))}>{claude.models.map((m) => <option key={m}>{m}</option>)}</select></label>
          <div className="qna-row"><button className="btn primary" onClick={saveClaude}>Salva</button>
            {claude.configured && !claude.fromEnv && <button className="btn" onClick={async () => { setClaude(await api.claude.configure('')); setMode('local'); }}>Rimuovi chiave</button>}</div>
        </div>
      )}
      {error && <div className="pq-err" style={{ margin: '4px 0' }}>{error}</div>}
      {spec && (
        <div className="qna-restate">
          <span>{spec.answerable ? 'Mostra: ' : ''}{spec.restatement}{v.qna?.source === 'claude' ? ' · Claude' : ''}</span>
          {answer && selected && !onChange && <button className="btn" style={{ minWidth: 0 }} onClick={convert}>Trasforma in oggetto visivo</button>}
        </div>
      )}
      <div className="qna-body">
        {answer ? <VisualBody v={answer} selected={false} />
          : !saved && idx && (
            <div className="qna-sugg">
              <div>Prova a chiedere:</div>
              {suggestions(idx).map((x) => <button key={x} onClick={() => { setQ(x); ask(x); }}>{x}</button>)}
            </div>
          )}
      </div>
    </div>
  );
}
