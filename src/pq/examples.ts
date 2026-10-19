// "Colonna da esempi": finds a transformation of the existing columns that reproduces the values
// typed by the user, as an M formula (added as a custom column) plus a JS preview of it.
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DELIMS = [' ', ',', ';', '-', '_', '@', '.', '/', ':', '|', '#'];

export interface Candidate { label: string; formula: string; fn: (row: Record<string, any>) => string | null; }

const mStr = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const mCol = (c: string) => (/^[A-Za-z_][\w ]*$/.test(c) && !c.endsWith(' ') ? `[${c}]` : `[#${mStr(c)}]`);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const proper = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_m, a, b) => a + b.toUpperCase());

/** Candidate transformations of one column, simplest first. */
function columnCandidates(col: string, isDate: boolean, sample: string[]): Candidate[] {
  const c = mCol(col);
  const g = (r: Record<string, any>) => txt(r[col]);
  const out: Candidate[] = [];
  const add = (label: string, formula: string, fn: (s: string) => string | null) => out.push({ label, formula, fn: (r) => { const v = g(r); return v === null ? null : fn(v); } });
  if (isDate) {
    const d = (s: string) => new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T'));
    add(`Anno da ${col}`, `Date.Year(${c})`, (s) => String(d(s).getFullYear()));
    add(`Mese da ${col}`, `Date.Month(${c})`, (s) => String(d(s).getMonth() + 1));
    add(`Giorno da ${col}`, `Date.Day(${c})`, (s) => String(d(s).getDate()));
    add(`Nome del mese da ${col}`, `Date.MonthName(${c})`, (s) => MONTHS[d(s).getMonth()]);
    add(`Trimestre da ${col}`, `Date.QuarterOfYear(${c})`, (s) => String(Math.floor(d(s).getMonth() / 3) + 1));
  }
  add(col, `Text.From(${c})`, (s) => s);
  add(`${col} in maiuscolo`, `Text.Upper(${c})`, (s) => s.toUpperCase());
  add(`${col} in minuscolo`, `Text.Lower(${c})`, (s) => s.toLowerCase());
  add(`${col} con iniziali maiuscole`, `Text.Proper(${c})`, proper);
  add(`${col} senza spazi iniziali/finali`, `Text.Trim(${c})`, (s) => s.trim());
  for (const dl of DELIMS) {
    if (!sample.some((s) => s.includes(dl))) continue;
    for (let n = 0; n < 3; n++) {
      const before = (s: string) => s.split(dl).slice(0, n + 1).join(dl);
      const afterN = (s: string) => s.split(dl).slice(n + 1).join(dl);
      const idx = n ? `, ${n}` : '';
      add(`Testo prima di "${dl}" in ${col}`, `Text.BeforeDelimiter(${c}, ${mStr(dl)}${idx})`, before);
      add(`Testo dopo "${dl}" in ${col}`, `Text.AfterDelimiter(${c}, ${mStr(dl)}${idx})`, afterN);
      for (const [name, f] of [['Text.Upper', (s: string) => s.toUpperCase()], ['Text.Lower', (s: string) => s.toLowerCase()], ['Text.Proper', proper]] as const) {
        add(`Testo prima di "${dl}" in ${col}`, `${name}(Text.BeforeDelimiter(${c}, ${mStr(dl)}${idx}))`, (s) => f(before(s)));
        add(`Testo dopo "${dl}" in ${col}`, `${name}(Text.AfterDelimiter(${c}, ${mStr(dl)}${idx}))`, (s) => f(afterN(s)));
      }
    }
    for (const d2 of DELIMS) {
      if (d2 === dl || !sample.some((s) => s.includes(d2))) continue;
      add(`Testo tra "${dl}" e "${d2}" in ${col}`, `Text.BetweenDelimiters(${c}, ${mStr(dl)}, ${mStr(d2)})`, (s) => (s.split(dl)[1] ?? '').split(d2)[0]);
    }
  }
  return out;
}

/** Learns from examples (row index → expected text). Returns the first candidate matching all of them. */
export function learn(rows: Record<string, any>[], columns: { name: string; type: string }[], examples: Map<number, string>): Candidate | null {
  const ex = [...examples.entries()].filter(([, v]) => v.trim() !== '');
  if (!ex.length) return null;
  const ok = (c: Candidate) => ex.every(([i, v]) => (c.fn(rows[i]) ?? '') === v);
  const exRows = ex.map(([i]) => rows[i]);
  // Fixed-length start/end of a column.
  const lengths = [...new Set(ex.map(([, v]) => v.length))];
  const cands: Candidate[] = [];
  for (const col of columns) {
    const isDate = /^(DATE|TIMESTAMP)/i.test(col.type);
    const sample = exRows.map((r) => txt(r[col.name]) ?? '');
    cands.push(...columnCandidates(col.name, isDate, sample));
    if (lengths.length === 1) {
      const k = lengths[0];
      const c = mCol(col.name);
      cands.push({ label: `Primi ${k} caratteri di ${col.name}`, formula: `Text.Start(Text.From(${c}), ${k})`, fn: (r) => (txt(r[col.name]) === null ? null : txt(r[col.name])!.slice(0, k)) });
      cands.push({ label: `Ultimi ${k} caratteri di ${col.name}`, formula: `Text.End(Text.From(${c}), ${k})`, fn: (r) => (txt(r[col.name]) === null ? null : txt(r[col.name])!.slice(-k)) });
    }
  }
  const single = cands.find(ok);
  if (single) return single;
  // Two columns joined by a separator, e.g. "Rossi, Mario".
  const [i0, v0] = ex[0];
  for (const a of columns) for (const b of columns) {
    if (a === b) continue;
    const va = txt(rows[i0][a.name]), vb = txt(rows[i0][b.name]);
    if (!va || !vb || !v0.startsWith(va) || !v0.endsWith(vb) || v0.length < va.length + vb.length) continue;
    const sep = v0.slice(va.length, v0.length - vb.length);
    const c: Candidate = {
      label: `${a.name} e ${b.name} uniti con "${sep}"`,
      formula: `Text.From(${mCol(a.name)}) & ${mStr(sep)} & Text.From(${mCol(b.name)})`,
      fn: (r) => (txt(r[a.name]) === null || txt(r[b.name]) === null ? null : `${txt(r[a.name])}${sep}${txt(r[b.name])}`),
    };
    if (ok(c)) return c;
  }
  // Same text everywhere.
  if (new Set(ex.map(([, v]) => v)).size === 1 && ex.length > 1) return { label: `Testo fisso "${ex[0][1]}"`, formula: mStr(ex[0][1]), fn: () => ex[0][1] };
  return null;
}
