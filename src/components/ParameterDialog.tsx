// Modellazione › Nuovo parametro: "Intervallo numerico" (what-if) or "Campi" (field parameter).
import { useState } from 'react';
import { useStore } from '../store';
import type { ParamField } from '../types';
import { Icon } from './icons';

export function ParameterDialog() {
  const s = useStore();
  const kind = s.paramDialog;
  const [name, setName] = useState('Parametro');
  const [min, setMin] = useState(0), [max, setMax] = useState(20), [step, setStep] = useState(1), [def, setDef] = useState(0);
  const [fields, setFields] = useState<ParamField[]>([]);
  const [slicer, setSlicer] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  if (!kind) return null;
  const close = () => { s.set({ paramDialog: null }); setErr(null); setFields([]); };
  const create = async () => {
    try {
      await s.createParameter(kind === 'numeric' ? { kind, name, min, max, step, def, slicer } : { kind, name, fields, slicer });
      s.notify(kind === 'numeric' ? `Creati la tabella "${name}", la misura "${name} Valore" e il filtro dei dati.` : `Creato il parametro di campo "${name}": trascinarlo in un oggetto visivo.`);
      close();
    } catch (e: any) { setErr(e.message); }
  };
  const options: ParamField[] = [
    ...s.report.measures.map((m) => ({ label: m.name, table: m.table, column: m.name, measure: true })),
    ...s.tables.filter((t) => !t.fieldParam).flatMap((t) => t.columns.map((c) => ({ label: c.name, table: t.name, column: c.name }))),
  ];
  const num = (v: number, setV: (n: number) => void, label: string) => (
    <label className="pq-field" style={{ flex: 1 }}>{label}<input type="number" value={v} onChange={(e) => setV(+e.target.value)} /></label>
  );
  return (
    <div className="modal-bg">
      <div className="dialog" style={{ width: 560 }}>
        <div className="dh"><h2>Parametri</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db pq-db">
          <div className="pq-row">
            <label className="pq-field" style={{ flex: 1 }}>Che cosa verrà modificato?
              <select value={kind} onChange={(e) => s.set({ paramDialog: e.target.value as 'numeric' | 'fields' })}>
                <option value="numeric">Intervallo numerico</option><option value="fields">Campi</option>
              </select>
            </label>
            <label className="pq-field" style={{ flex: 1 }}>Nome<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          </div>
          {kind === 'numeric' ? <>
            <div className="pq-row">{num(min, setMin, 'Minimo')}{num(max, setMax, 'Massimo')}</div>
            <div className="pq-row">{num(step, setStep, 'Incremento')}{num(def, setDef, 'Valore predefinito')}</div>
            <div className="pq-note">Crea la tabella <b>{name}</b> (GENERATESERIES), la misura <b>{name} Valore</b> (SELECTEDVALUE) da usare nelle formule DAX, e un filtro dei dati a cursore.</div>
          </> : <>
            <label className="pq-field">Aggiungi campi
              <select value="" onChange={(e) => { const o = options[+e.target.value]; if (o && !fields.some((f) => f.table === o.table && f.column === o.column)) setFields([...fields, o]); }}>
                <option value="">Scegliere un campo o una misura…</option>
                {options.map((o, i) => <option key={i} value={i}>{o.measure ? `[${o.column}]` : `${o.table}[${o.column}]`}</option>)}
              </select>
            </label>
            <div className="param-fields">
              {fields.map((f, i) => (
                <div key={i} className="pill">
                  <input type="text" value={f.label} title="Etichetta mostrata nel filtro dei dati" onChange={(e) => setFields(fields.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                  <span className="src">{f.measure ? 'misura' : f.table}</span>
                  <button title="Su" disabled={!i} onClick={() => { const n = [...fields]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFields(n); }}>↑</button>
                  <button title="Rimuovi" onClick={() => setFields(fields.filter((_, k) => k !== i))}><Icon name="close" size={11} /></button>
                </div>
              ))}
              {!fields.length && <div className="pq-note">Nessun campo: aggiungerne almeno uno.</div>}
            </div>
            <div className="pq-note">Il filtro dei dati del parametro sceglie quali campi mostrano gli oggetti visivi che usano la colonna <b>{name}</b>.</div>
          </>}
          <label className="pq-check"><input type="checkbox" checked={slicer} onChange={(e) => setSlicer(e.target.checked)} />Aggiungi filtro dei dati alla pagina</label>
          {err && <div className="pq-err">{err}</div>}
        </div>
        <div className="df"><button className="btn primary" onClick={create}>Crea</button><button className="btn" onClick={close}>Annulla</button></div>
      </div>
    </div>
  );
}
