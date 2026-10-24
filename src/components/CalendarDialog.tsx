// Strumenti tabella › Opzioni calendario: calendars of a table for calendar-based time intelligence
// (TOTALYTD([Vendite], 'Calendario fiscale')). A calendar maps columns to time categories.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { calendarKey } from '../dax';
import type { CalendarDef, CalendarGroup, TimeUnit } from '../types';
import { Icon } from './icons';

const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** Categories in Power BI's order; `complete` ones identify a period on their own. */
export const CATEGORIES: { unit: TimeUnit; label: string; complete?: boolean; of?: TimeUnit }[] = [
  { unit: 'year', label: 'Anno', complete: true },
  { unit: 'semester', label: 'Semestre', complete: true },
  { unit: 'semesterOfYear', label: "Semestre dell'anno", of: 'semester' },
  { unit: 'quarter', label: 'Trimestre', complete: true },
  { unit: 'quarterOfYear', label: "Trimestre dell'anno", of: 'quarter' },
  { unit: 'quarterOfSemester', label: 'Trimestre del semestre', of: 'quarter' },
  { unit: 'month', label: 'Mese', complete: true },
  { unit: 'monthOfYear', label: "Mese dell'anno", of: 'month' },
  { unit: 'monthOfSemester', label: 'Mese del semestre', of: 'month' },
  { unit: 'monthOfQuarter', label: 'Mese del trimestre', of: 'month' },
  { unit: 'week', label: 'Settimana', complete: true },
  { unit: 'weekOfYear', label: "Settimana dell'anno", of: 'week' },
  { unit: 'weekOfSemester', label: 'Settimana del semestre', of: 'week' },
  { unit: 'weekOfQuarter', label: 'Settimana del trimestre', of: 'week' },
  { unit: 'weekOfMonth', label: 'Settimana del mese', of: 'week' },
  { unit: 'date', label: 'Data', complete: true },
  { unit: 'dayOfYear', label: "Giorno dell'anno", of: 'date' },
  { unit: 'dayOfSemester', label: 'Giorno del semestre', of: 'date' },
  { unit: 'dayOfQuarter', label: 'Giorno del trimestre', of: 'date' },
  { unit: 'dayOfMonth', label: 'Giorno del mese', of: 'date' },
  { unit: 'dayOfWeek', label: 'Giorno della settimana', of: 'date' },
];
const label = (u: TimeUnit | null) => (u ? CATEGORIES.find((c) => c.unit === u)?.label ?? u : 'Correlate al tempo');

/** Real-time validation (Power BI blocks saving on these). */
function errors(cal: CalendarDef, all: CalendarDef[]): string[] {
  const out: string[] = [];
  if (!cal.name.trim()) out.push('Il calendario deve avere un nome.');
  if (all.some((c) => c !== cal && c.name.trim().toLowerCase() === cal.name.trim().toLowerCase())) out.push(`Esiste già un calendario denominato "${cal.name.trim()}" nel modello.`);
  if (!cal.groups.some((g) => g.unit && g.primary)) out.push('Assegnare almeno una colonna principale a una categoria.');
  const seen = new Map<string, string>();
  for (const g of cal.groups) {
    if (g.unit && !g.primary && g.associated?.length) out.push(`${label(g.unit)}: manca la colonna principale.`);
    for (const c of [g.primary, ...(g.associated ?? [])].filter(Boolean) as string[]) {
      if (seen.has(c) && seen.get(c) !== label(g.unit)) out.push(`La colonna ${c} è assegnata sia a ${seen.get(c)} sia a ${label(g.unit)}.`);
      seen.set(c, label(g.unit));
    }
  }
  // Consistent categorization: a column has the same category in every calendar.
  for (const other of all.filter((c) => c !== cal && c.table === cal.table)) {
    for (const g of other.groups) for (const c of [g.primary, ...(g.associated ?? [])].filter(Boolean) as string[]) {
      if (seen.has(c) && seen.get(c) !== label(g.unit)) out.push(`La colonna ${c} è ${label(g.unit)} nel calendario ${other.name}: la categoria deve essere la stessa in tutti i calendari.`);
    }
  }
  return [...new Set(out)];
}

/** Period uniqueness warnings: a partial category needs categories that identify its period. */
function warnings(cal: CalendarDef): string[] {
  const out: string[] = [];
  for (const g of cal.groups) {
    const c = CATEGORIES.find((x) => x.unit === g.unit);
    if (!c?.of || !g.primary) continue;
    if (!calendarKey(cal, c.of)) out.push(`${c.label} non identifica un periodo da sola: aggiungere Anno (o la categoria che la contiene) oppure ${label(c.of)}.`);
  }
  return out;
}

export function CalendarDialog() {
  const s = useStore();
  const table = s.calendarDialog;
  const [list, setList] = useState<CalendarDef[]>([]);
  const [edit, setEdit] = useState<number | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; lines: string[] } | null>(null);
  useEffect(() => {
    if (!table) return;
    setList(structuredClone((s.report.calendars ?? []).filter((c) => c.table === table)));
    setEdit(null);
    setCheck(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);
  if (!table) return null;
  const t = s.tables.find((x) => x.name === table);
  const close = () => s.set({ calendarDialog: null });
  const others = (s.report.calendars ?? []).filter((c) => c.table !== table);
  const save = (next: CalendarDef[]) => { s.setCalendars(table, next.map((c) => ({ ...c, name: c.name.trim() }))); setList(next); };
  const cols = t?.columns.map((c) => c.name) ?? [];

  if (edit !== null) {
    const cal = list[edit];
    const upd = (fn: (c: CalendarDef) => void) => { const next = structuredClone(list); fn(next[edit]); setList(next); setCheck(null); };
    const used = new Set(cal.groups.flatMap((g) => [g.primary, ...(g.associated ?? [])]).filter(Boolean) as string[]);
    const errs = errors(cal, [...others, ...list]);
    const warns = warnings(cal);
    const free = (keep?: string) => cols.filter((c) => c === keep || !used.has(c));
    const setGroup = (i: number, patch: Partial<CalendarGroup>) => upd((c) => { Object.assign(c.groups[i], patch); });
    const validate = async () => {
      const lines: string[] = [];
      const T = qi(table);
      try {
        for (const g of cal.groups) for (const c of [g.primary, ...(g.associated ?? [])].filter(Boolean) as string[]) {
          const n = Number((await api.queryAs(`SELECT COUNT(*) AS n FROM ${T} WHERE ${qi(c)} IS NULL`)).rows[0].n);
          if (n) lines.push(`La colonna ${c} (${label(g.unit)}) ha ${n} valori vuoti.`);
        }
        for (const g of cal.groups.filter((x) => x.primary && x.associated?.length)) for (const a of g.associated!) {
          const r = (await api.queryAs(`SELECT COUNT(DISTINCT ${qi(g.primary!)}) AS p, COUNT(DISTINCT ${qi(a)}) AS a, COUNT(DISTINCT (${qi(g.primary!)}, ${qi(a)})) AS pa FROM ${T}`)).rows[0];
          if (Number(r.pa) !== Number(r.p) || Number(r.pa) !== Number(r.a)) lines.push(`${label(g.unit)}: la colonna principale ${g.primary} e la colonna associata ${a} non hanno una corrispondenza uno-a-uno.`);
        }
        // Higher and lower categories: one-to-many (each period of a lower category falls in one period above it).
        const units = ['year', 'semester', 'quarter', 'month', 'week', 'date'].filter((u) => calendarKey(cal, u));
        for (let i = 1; i < units.length; i++) {
          const lo = calendarKey(cal, units[i])!;
          for (const up of units.slice(0, i)) {
            // Weeks may straddle months, quarters and semesters.
            if (units[i] === 'week' && up !== 'year') continue;
            const hi = calendarKey(cal, up)!;
            if (hi.every((c) => lo.includes(c))) continue;
            const r = (await api.queryAs(`SELECT COUNT(*) AS n FROM (SELECT ${lo.map(qi).join(', ')} FROM ${T} GROUP BY ${lo.map(qi).join(', ')} HAVING COUNT(DISTINCT (${hi.map(qi).join(', ')})) > 1)`)).rows[0];
            if (Number(r.n)) lines.push(`${Number(r.n)} periodi di ${label(units[i] as TimeUnit)} cadono in più periodi di ${label(up as TimeUnit)}.`);
          }
        }
        setCheck({ ok: !lines.length, lines: lines.length ? lines : ['Nessun problema rilevato nei dati del calendario.'] });
      } catch (e: any) { setCheck({ ok: false, lines: [e.message.split('\n')[0]] }); }
    };
    const unitsUsed = new Set(cal.groups.map((g) => g.unit));
    return (
      <div className="modal-bg">
        <div className="dialog cal-dlg">
          <div className="dh"><h2>{edit < (s.report.calendars ?? []).filter((c) => c.table === table).length ? 'Modifica calendario' : 'Nuovo calendario'}</h2><button onClick={close}><Icon name="close" /></button></div>
          <div className="db cal-edit">
            <label className="cal-name">Nome del calendario<input value={cal.name} autoFocus onChange={(e) => upd((c) => { c.name = e.target.value; })} /></label>
            <div className="hint">Tabella: <b>{table}</b>. Assegnare le colonne alle categorie di tempo: la colonna principale ordina i periodi, le colonne associate rappresentano la stessa categoria.</div>
            <div className="cal-grid">
              <div className="cal-row head"><span>Categoria</span><span>Colonna principale</span><span>Colonne associate</span><span /></div>
              {cal.groups.map((g, i) => (
                <div key={i} className="cal-row">
                  <span className="cat">{label(g.unit)}</span>
                  {g.unit ? (
                    <select value={g.primary ?? ''} onChange={(e) => setGroup(i, { primary: e.target.value || undefined })}>
                      <option value="">(selezionare)</option>
                      {free(g.primary).map((c) => <option key={c}>{c}</option>)}
                    </select>
                  ) : <span className="hint">—</span>}
                  <span className="chips">
                    {(g.associated ?? []).map((a) => <span key={a} className="chip">{a}<button title="Rimuovi" onClick={() => setGroup(i, { associated: g.associated!.filter((x) => x !== a) })}>×</button></span>)}
                    <select value="" onChange={(e) => e.target.value && setGroup(i, { associated: [...(g.associated ?? []), e.target.value] })}>
                      <option value="">+ {g.unit ? 'colonna associata' : 'colonna'}</option>
                      {free().map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </span>
                  <button className="btn-mini" title="Rimuovi categoria" onClick={() => upd((c) => { c.groups.splice(i, 1); })}><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
            <div className="cal-add">
              <select value="" onChange={(e) => {
                const v = e.target.value;
                if (v) upd((c) => { c.groups.push(v === 'related' ? { unit: null, associated: [] } : { unit: v as TimeUnit }); });
              }}>
                <option value="">Aggiungi categoria…</option>
                {CATEGORIES.filter((c) => !unitsUsed.has(c.unit)).map((c) => <option key={c.unit} value={c.unit}>{c.label}{c.complete ? '' : ' (parziale)'}</option>)}
                {!unitsUsed.has(null) && <option value="related">Correlate al tempo (mantengono il contesto solo con DATEADD e SAMEPERIODLASTYEAR)</option>}
              </select>
              <button className="btn" onClick={validate} disabled={!!errs.length}>Convalida dati</button>
            </div>
            {errs.map((e) => <div key={e} className="daxbar-err"><Icon name="warning" size={14} />{e}</div>)}
            {warns.map((w) => <div key={w} className="cal-warn"><Icon name="warning" size={14} />{w}</div>)}
            {check && check.lines.map((l) => <div key={l} className={check.ok ? 'roles-ok' : 'cal-warn'}><Icon name={check.ok ? 'info' : 'warning'} size={14} />{l}</div>)}
          </div>
          <div className="df">
            <button className="btn primary" disabled={!!errs.length} onClick={() => { save(list); setEdit(null); }}>Salva</button>
            <button className="btn" onClick={() => { setList(structuredClone((s.report.calendars ?? []).filter((c) => c.table === table))); setEdit(null); }}>Annulla</button>
          </div>
        </div>
      </div>
    );
  }

  const dateCol = t?.columns.find((c) => /^(DATE|TIMESTAMP)/i.test(c.type))?.name;
  const newCal = () => {
    let name = 'Calendario', i = 2;
    while ([...others, ...list].some((c) => c.name.toLowerCase() === name.toLowerCase())) name = `Calendario ${i++}`;
    const guess = (re: RegExp) => cols.find((c) => re.test(c));
    const groups: CalendarGroup[] = [];
    const y = guess(/^(anno|year)$/i);
    if (y) groups.push({ unit: 'year', primary: y });
    const m = guess(/^(mese|month)\s*(num|number|numero)?$/i);
    if (m && y) groups.push({ unit: 'monthOfYear', primary: m });
    if (dateCol) groups.push({ unit: 'date', primary: dateCol });
    setList([...list, { name, table, groups }]);
    setEdit(list.length);
  };
  return (
    <div className="modal-bg">
      <div className="dialog cal-dlg">
        <div className="dh"><h2>Opzioni calendario — {table}</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db cal-edit">
          <div className="hint">I calendari indicano quali colonne della tabella rappresentano anni, trimestri, mesi, settimane e date. Si usano nelle funzioni di time intelligence al posto della colonna di date, ad esempio <code>TOTALYTD([Vendite], 'Calendario')</code> o <code>TOTALWTD([Vendite], 'Calendario')</code>, e funzionano con qualsiasi calendario (fiscale, 4-4-5, 13 periodi, date mancanti).</div>
          <div className="cal-grid">
            <div className="cal-row list head"><span>Nome</span><span>Categorie</span><span /></div>
            {list.map((c, i) => (
              <div key={c.name + i} className="cal-row list">
                <span><Icon name="calendar" size={13} /> {c.name}</span>
                <span className="hint">{c.groups.map((g) => `${label(g.unit)}${g.primary ? `: ${g.primary}` : ''}`).join(' · ')}</span>
                <span className="actions">
                  <button className="btn-mini" onClick={() => setEdit(i)}>Modifica</button>
                  <button className="btn-mini" onClick={() => save(list.filter((_x, k) => k !== i))}><Icon name="trash" size={12} />Elimina</button>
                </span>
              </div>
            ))}
            {!list.length && <div className="hint" style={{ padding: 10 }}>Nessun calendario definito per questa tabella.</div>}
          </div>
          <div className="cal-add">
            <button className="btn" onClick={newCal}><Icon name="plus" size={12} />Nuovo calendario</button>
            <button className="btn" disabled={!dateCol} onClick={() => s.set({ calendarDialog: null, propsTarget: { table } })}>{s.report.dateTables?.[table] ? 'Tabella delle date…' : 'Contrassegna come tabella delle date'}</button>
          </div>
        </div>
        <div className="df"><button className="btn primary" onClick={close}>Chiudi</button></div>
      </div>
    </div>
  );
}
