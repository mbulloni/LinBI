// Home › Misura rapida: Power BI's quick measure templates. The chosen calculation and fields become
// DAX (shown before saving), validated and saved like a measure written in the formula bar.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { qi } from '../query';
import type { Agg, FieldRef } from '../types';
import { isNumeric } from '../format';
import { Icon } from './icons';

type Slot = 'value' | 'value2' | 'category' | 'date' | 'filter' | 'number' | 'unit' | 'max';
interface Tpl { id: string; group: string; name: string; slots: Slot[]; dax: (x: Ctx) => string; title: (x: Ctx) => string; format?: string; help: string }
interface Ctx { v: string; v2: string; vName: string; v2Name: string; cat: string; catName: string; date: string; filter: string; num: number; unit: string; max: number; }

const UNITS: [string, string][] = [['DAY', 'Giorni'], ['MONTH', 'Mesi'], ['QUARTER', 'Trimestri'], ['YEAR', 'Anni']];
export const TPL: Tpl[] = [
  { id: 'avgCat', group: 'Aggregato per categoria', name: 'Media per categoria', slots: ['value', 'category'], help: 'Media del valore calcolato per ogni elemento della categoria.',
    dax: (x) => `AVERAGEX(KEEPFILTERS(VALUES(${x.cat})), CALCULATE(${x.v}))`, title: (x) => `${x.vName} media per ${x.catName}` },
  { id: 'varCat', group: 'Aggregato per categoria', name: 'Varianza per categoria', slots: ['value', 'category'], help: 'Varianza dei valori calcolati per ogni elemento della categoria.',
    dax: (x) => `VAR __m = AVERAGEX(KEEPFILTERS(VALUES(${x.cat})), CALCULATE(${x.v}))\nRETURN AVERAGEX(KEEPFILTERS(VALUES(${x.cat})), (CALCULATE(${x.v}) - __m) ^ 2)`, title: (x) => `Varianza di ${x.vName} per ${x.catName}` },
  { id: 'maxCat', group: 'Aggregato per categoria', name: 'Massimo per categoria', slots: ['value', 'category'], help: 'Valore massimo tra gli elementi della categoria.',
    dax: (x) => `MAXX(KEEPFILTERS(VALUES(${x.cat})), CALCULATE(${x.v}))`, title: (x) => `${x.vName} massimo per ${x.catName}` },
  { id: 'minCat', group: 'Aggregato per categoria', name: 'Minimo per categoria', slots: ['value', 'category'], help: 'Valore minimo tra gli elementi della categoria.',
    dax: (x) => `MINX(KEEPFILTERS(VALUES(${x.cat})), CALCULATE(${x.v}))`, title: (x) => `${x.vName} minimo per ${x.catName}` },
  { id: 'filtered', group: 'Filtri', name: 'Valore filtrato', slots: ['value', 'filter'], help: 'Il valore calcolato solo per l\'elemento scelto.',
    dax: (x) => `CALCULATE(${x.v}, ${x.filter})`, title: (x) => `${x.vName} filtrato` },
  { id: 'diffFiltered', group: 'Filtri', name: 'Differenza dal valore filtrato', slots: ['value', 'filter'], help: 'Differenza tra il valore e quello dell\'elemento scelto.',
    dax: (x) => `VAR __base = CALCULATE(${x.v}, ${x.filter})\nRETURN ${x.v} - __base`, title: (x) => `Differenza di ${x.vName} dal valore filtrato` },
  { id: 'pctFiltered', group: 'Filtri', name: 'Variazione percentuale dal valore filtrato', slots: ['value', 'filter'], format: '0.00%', help: 'Variazione percentuale rispetto al valore dell\'elemento scelto.',
    dax: (x) => `VAR __base = CALCULATE(${x.v}, ${x.filter})\nRETURN DIVIDE(${x.v} - __base, __base)`, title: (x) => `Variazione % di ${x.vName} dal valore filtrato` },
  { id: 'ytd', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Totale da inizio anno', slots: ['value', 'date'], help: 'Totale dall\'inizio dell\'anno alla data corrente.',
    dax: (x) => `TOTALYTD(${x.v}, ${x.date})`, title: (x) => `${x.vName} da inizio anno` },
  { id: 'qtd', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Totale da inizio trimestre', slots: ['value', 'date'], help: 'Totale dall\'inizio del trimestre.',
    dax: (x) => `TOTALQTD(${x.v}, ${x.date})`, title: (x) => `${x.vName} da inizio trimestre` },
  { id: 'mtd', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Totale da inizio mese', slots: ['value', 'date'], help: 'Totale dall\'inizio del mese.',
    dax: (x) => `TOTALMTD(${x.v}, ${x.date})`, title: (x) => `${x.vName} da inizio mese` },
  { id: 'yoy', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Variazione anno su anno', slots: ['value', 'date'], format: '0.00%', help: 'Variazione percentuale rispetto allo stesso periodo dell\'anno precedente.',
    dax: (x) => `VAR __prev = CALCULATE(${x.v}, DATEADD(${x.date}, -1, YEAR))\nRETURN DIVIDE(${x.v} - __prev, __prev)`, title: (x) => `${x.vName} variazione % anno su anno` },
  { id: 'qoq', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Variazione trimestre su trimestre', slots: ['value', 'date'], format: '0.00%', help: 'Variazione percentuale rispetto al trimestre precedente.',
    dax: (x) => `VAR __prev = CALCULATE(${x.v}, DATEADD(${x.date}, -1, QUARTER))\nRETURN DIVIDE(${x.v} - __prev, __prev)`, title: (x) => `${x.vName} variazione % trimestre su trimestre` },
  { id: 'mom', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Variazione mese su mese', slots: ['value', 'date'], format: '0.00%', help: 'Variazione percentuale rispetto al mese precedente.',
    dax: (x) => `VAR __prev = CALCULATE(${x.v}, DATEADD(${x.date}, -1, MONTH))\nRETURN DIVIDE(${x.v} - __prev, __prev)`, title: (x) => `${x.vName} variazione % mese su mese` },
  { id: 'rolling', group: 'Funzioni di Business Intelligence per le gerarchie temporali', name: 'Media mobile', slots: ['value', 'date', 'number', 'unit'], help: 'Media del valore negli ultimi N periodi fino alla data corrente.',
    dax: (x) => `AVERAGEX(DATESINPERIOD(${x.date}, LASTDATE(${x.date}), -${x.num}, ${x.unit}), CALCULATE(${x.v}))`, title: (x) => `${x.vName} media mobile` },
  { id: 'running', group: 'Totali', name: 'Totale parziale', slots: ['value', 'category'], help: 'Somma cumulativa del valore lungo la categoria (ordine crescente).',
    dax: (x) => `CALCULATE(${x.v}, FILTER(ALLSELECTED(${x.cat}), ${x.cat} <= MAX(${x.cat})))`, title: (x) => `${x.vName} totale parziale in ${x.catName}` },
  { id: 'totalCat', group: 'Totali', name: 'Totale per categoria (filtri applicati)', slots: ['value', 'category'], help: 'Il totale di tutta la categoria, ignorandone il filtro della riga.',
    dax: (x) => `CALCULATE(${x.v}, ALLSELECTED(${x.cat}))`, title: (x) => `${x.vName} totale per ${x.catName}` },
  { id: 'shareCat', group: 'Totali', name: 'Percentuale del totale della categoria', slots: ['value', 'category'], format: '0.00%', help: 'Quota del valore sul totale della categoria.',
    dax: (x) => `DIVIDE(${x.v}, CALCULATE(${x.v}, ALLSELECTED(${x.cat})))`, title: (x) => `% di ${x.vName} sul totale di ${x.catName}` },
  { id: 'add', group: 'Operazioni matematiche', name: 'Addizione', slots: ['value', 'value2'], help: 'Somma dei due valori.', dax: (x) => `${x.v} + ${x.v2}`, title: (x) => `${x.vName} più ${x.v2Name}` },
  { id: 'sub', group: 'Operazioni matematiche', name: 'Sottrazione', slots: ['value', 'value2'], help: 'Differenza tra i due valori.', dax: (x) => `${x.v} - ${x.v2}`, title: (x) => `${x.vName} meno ${x.v2Name}` },
  { id: 'mul', group: 'Operazioni matematiche', name: 'Moltiplicazione', slots: ['value', 'value2'], help: 'Prodotto dei due valori.', dax: (x) => `${x.v} * ${x.v2}`, title: (x) => `${x.vName} per ${x.v2Name}` },
  { id: 'div', group: 'Operazioni matematiche', name: 'Divisione', slots: ['value', 'value2'], help: 'Rapporto tra i due valori (vuoto se il divisore è zero).', dax: (x) => `DIVIDE(${x.v}, ${x.v2})`, title: (x) => `${x.vName} diviso ${x.v2Name}` },
  { id: 'pctDiff', group: 'Operazioni matematiche', name: 'Differenza percentuale', slots: ['value', 'value2'], format: '0.00%', help: 'Differenza del primo valore rispetto al secondo, in percentuale.',
    dax: (x) => `DIVIDE(${x.v} - ${x.v2}, ${x.v2})`, title: (x) => `Differenza % di ${x.vName} da ${x.v2Name}` },
  { id: 'corr', group: 'Operazioni matematiche', name: 'Coefficiente di correlazione', slots: ['category', 'value', 'value2'], format: '0.00', help: 'Correlazione di Pearson tra i due valori sugli elementi della categoria.',
    dax: (x) => `VAR __t = ADDCOLUMNS(KEEPFILTERS(VALUES(${x.cat})), "__x", CALCULATE(${x.v}), "__y", CALCULATE(${x.v2}))\nVAR __n = COUNTROWS(__t)\nVAR __sx = SUMX(__t, [__x])\nVAR __sy = SUMX(__t, [__y])\nVAR __sxy = SUMX(__t, [__x] * [__y])\nVAR __sxx = SUMX(__t, [__x] ^ 2)\nVAR __syy = SUMX(__t, [__y] ^ 2)\nRETURN DIVIDE(__n * __sxy - __sx * __sy, SQRT(__n * __sxx - __sx ^ 2) * SQRT(__n * __syy - __sy ^ 2))`,
    title: (x) => `Correlazione di ${x.vName} e ${x.v2Name} per ${x.catName}` },
  { id: 'stars', group: 'Testo', name: 'Classificazione a stelle', slots: ['value', 'number', 'max'], help: 'Da 0 a N stelle in proporzione al valore (valore massimo = tutte le stelle).',
    dax: (x) => `VAR __v = ${x.v}\nVAR __r = ROUND(DIVIDE(__v, ${x.max}) * ${x.num}, 0)\nVAR __stars = IF(__r > ${x.num}, ${x.num}, IF(__r < 0, 0, __r))\nRETURN IF(ISBLANK(__v), BLANK(), REPT(UNICHAR(9733), __stars) & REPT(UNICHAR(9734), ${x.num} - __stars))`,
    title: (x) => `${x.vName} in stelle` },
  { id: 'concat', group: 'Testo', name: 'Elenco concatenato di valori', slots: ['category'], help: 'Gli elementi della categoria nel contesto, separati da virgole.',
    dax: (x) => `CONCATENATEX(VALUES(${x.cat}), ${x.cat}, ", ")`, title: (x) => `Elenco di ${x.catName}` },
];

const AGG_DAX: Partial<Record<Agg, string>> = { sum: 'SUM', avg: 'AVERAGE', min: 'MIN', max: 'MAX', count: 'COUNTA', countd: 'DISTINCTCOUNT', median: 'MEDIAN' };
const AGG_LBL: Partial<Record<Agg, string>> = { sum: 'Somma di', avg: 'Media di', min: 'Minimo di', max: 'Massimo di', count: 'Conteggio di', countd: 'Conteggio distinto di', median: 'Mediana di' };
const col = (t: string, c: string) => `${/^[A-Za-z_]\w*$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`}[${c.replace(/]/g, ']]')}]`;

export function QuickMeasureDialog() {
  const s = useStore();
  const open = s.quickMeasure;
  const [tpl, setTpl] = useState(TPL[0].id);
  const [val, setVal] = useState<{ f?: FieldRef; agg: Agg }>({ agg: 'sum' });
  const [val2, setVal2] = useState<{ f?: FieldRef; agg: Agg }>({ agg: 'sum' });
  const [cat, setCat] = useState<FieldRef>();
  const [date, setDate] = useState<FieldRef>();
  const [flt, setFlt] = useState<{ f?: FieldRef; value: string }>({ value: '' });
  const [values, setValues] = useState<string[]>([]);
  const [num, setNum] = useState(3);
  const [unit, setUnit] = useState('MONTH');
  const [maxVal, setMaxVal] = useState(5);
  const t = TPL.find((x) => x.id === tpl)!;
  const columns = useMemo(() => s.tables.flatMap((tb) => tb.columns.map((c) => ({ f: { table: tb.name, column: c.name, agg: 'none' as Agg }, num: isNumeric(c), date: /^(DATE|TIMESTAMP)/i.test(c.type) }))), [s.tables]);
  if (!open) return null;
  const close = () => s.set({ quickMeasure: false });
  const key = (f?: FieldRef) => (f ? JSON.stringify([f.table, f.column, f.agg]) : '');
  const valueOpts = [
    ...s.report.measures.map((m) => ({ f: { table: m.table, column: m.name, agg: 'measure' as Agg }, label: `${m.name} (misura)` })),
    ...columns.map((c) => ({ f: c.f, label: `${c.f.table}[${c.f.column}]`, num: c.num })),
  ];
  const valueExpr = (x: { f?: FieldRef; agg: Agg }) => (!x.f ? '' : x.f.agg === 'measure' ? `[${x.f.column.replace(/]/g, ']]')}]` : `${AGG_DAX[x.agg] ?? 'SUM'}(${col(x.f.table, x.f.column)})`);
  const valueName = (x: { f?: FieldRef; agg: Agg }) => (!x.f ? '' : x.f.agg === 'measure' ? x.f.column : `${AGG_LBL[x.agg] ?? 'Somma di'} ${x.f.column}`);
  const fvalue = flt.f && columns.find((c) => c.f.table === flt.f!.table && c.f.column === flt.f!.column)?.num && flt.value.trim() !== '' && !isNaN(Number(flt.value)) ? flt.value : `"${flt.value.replace(/"/g, '""')}"`;
  const ctx: Ctx = {
    v: valueExpr(val), v2: valueExpr(val2), vName: valueName(val), v2Name: valueName(val2),
    cat: cat ? col(cat.table, cat.column) : '', catName: cat?.column ?? '', date: date ? col(date.table, date.column) : '',
    filter: flt.f ? `${col(flt.f.table, flt.f.column)} = ${fvalue}` : '', num, unit, max: maxVal,
  };
  const ready = t.slots.every((sl) => (sl === 'value' ? !!val.f : sl === 'value2' ? !!val2.f : sl === 'category' ? !!cat : sl === 'date' ? !!date : sl === 'filter' ? !!flt.f && flt.value !== '' : true));
  const dax = ready ? t.dax(ctx) : '';
  const home = (val.f ?? cat ?? date)?.table ?? s.tables[0]?.name ?? '';
  const save = async () => {
    const taken = (n: string) => s.report.measures.some((m) => m.name === n) || s.tables.some((tb) => tb.columns.some((c) => c.name === n));
    let name = t.title(ctx).replace(/[[\]]/g, ''), i = 2;
    const base = name;
    while (taken(name)) name = `${base} ${i++}`;
    s.set({ daxEdit: { kind: 'measure', table: home, original: null, text: `${name} = ${dax}`, ...(t.format ? { formatString: t.format } : {}) } });
    close();
    // Saved like the formula bar does; on errors the bar stays open with the message.
    await useStore.getState().saveDax();
  };
  const loadValues = async (f?: FieldRef) => {
    setFlt({ f, value: '' }); setValues([]);
    if (!f) return;
    try { const r = await api.query(`SELECT DISTINCT CAST(${qi(f.column)} AS VARCHAR) AS v FROM ${qi(f.table)} WHERE ${qi(f.column)} IS NOT NULL ORDER BY 1 LIMIT 500`); setValues(r.rows.map((x) => String(x.v))); } catch { /* free text */ }
  };
  const ValuePick = ({ x, set, label }: { x: { f?: FieldRef; agg: Agg }; set: (v: { f?: FieldRef; agg: Agg }) => void; label: string }) => (
    <label className="pq-field">{label}
      <span className="pq-row">
        <select value={key(x.f)} onChange={(e) => { const o = valueOpts.find((v) => key(v.f) === e.target.value); set({ f: o?.f, agg: o && o.f.agg === 'none' && !(o as any).num ? 'count' : x.agg }); }} style={{ flex: 1 }}>
          <option value="">(scegliere)</option>{valueOpts.map((o) => <option key={key(o.f)} value={key(o.f)}>{o.label}</option>)}
        </select>
        {x.f && x.f.agg !== 'measure' && (
          <select value={x.agg} onChange={(e) => set({ ...x, agg: e.target.value as Agg })}>
            {(Object.keys(AGG_DAX) as Agg[]).map((a) => <option key={a} value={a}>{AGG_LBL[a]!.replace(' di', '')}</option>)}
          </select>
        )}
      </span>
    </label>
  );
  const ColPick = ({ v, set, label, filter }: { v?: FieldRef; set: (f?: FieldRef) => void; label: string; filter?: (c: typeof columns[number]) => boolean }) => (
    <label className="pq-field">{label}
      <select value={key(v)} onChange={(e) => set(columns.find((c) => key(c.f) === e.target.value)?.f)}>
        <option value="">(scegliere)</option>{columns.filter(filter ?? (() => true)).map((c) => <option key={key(c.f)} value={key(c.f)}>{c.f.table}[{c.f.column}]</option>)}
      </select>
    </label>
  );
  const groups = [...new Set(TPL.map((x) => x.group))];
  return (
    <div className="modal-bg">
      <div className="dialog qm" style={{ width: 'min(860px, 96vw)' }}>
        <div className="dh"><h2>Misure rapide</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db qm-body">
          <div className="qm-left">
            <label className="pq-field">Calcolo
              <select value={tpl} onChange={(e) => setTpl(e.target.value)} size={14}>
                {groups.map((g) => <optgroup key={g} label={g}>{TPL.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
              </select>
            </label>
            <div className="pq-note">{t.help}</div>
          </div>
          <div className="qm-right pq-db">
            {t.slots.includes('value') && <ValuePick x={val} set={setVal} label={t.slots.includes('value2') ? 'Primo valore' : 'Valore di base'} />}
            {t.slots.includes('value2') && <ValuePick x={val2} set={setVal2} label="Secondo valore" />}
            {t.slots.includes('category') && <ColPick v={cat} set={setCat} label={t.id === 'running' ? 'Campo' : 'Categoria'} />}
            {t.slots.includes('date') && <ColPick v={date} set={setDate} label="Data" filter={(c) => c.date} />}
            {t.slots.includes('filter') && <>
              <ColPick v={flt.f} set={loadValues} label="Filtro" />
              {flt.f && <label className="pq-field">Elemento
                <input type="text" list="qm-values" value={flt.value} onChange={(e) => setFlt({ ...flt, value: e.target.value })} />
                <datalist id="qm-values">{values.map((x) => <option key={x} value={x} />)}</datalist>
              </label>}
            </>}
            {t.slots.includes('number') && <label className="pq-field">{t.id === 'stars' ? 'Numero di stelle' : 'Periodi'}<input type="number" min={1} value={num} onChange={(e) => setNum(Math.max(1, Math.round(+e.target.value)))} /></label>}
            {t.slots.includes('max') && <label className="pq-field">Valore massimo (tutte le stelle)<input type="number" value={maxVal} onChange={(e) => setMaxVal(+e.target.value || 1)} /></label>}
            {t.slots.includes('unit') && <label className="pq-field">Unità
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            {dax && <><div className="qm-hdr">Formula DAX</div><pre className="pq-code qm-dax">{dax}</pre></>}
          </div>
        </div>
        <div className="df"><button className="btn primary" disabled={!ready || !home} onClick={save}>OK</button><button className="btn" onClick={close}>Annulla</button></div>
      </div>
    </div>
  );
}
