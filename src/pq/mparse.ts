// M code → applied steps: what the Advanced editor and the formula bar write back.
// Reads `let … in` documents and the Table.* functions MiB-BI generates (pq/m.ts), plus common
// hand-written variants; `each` bodies stay text (translated to SQL by mexpr). Anything else is
// reported precisely instead of being dropped.
import type { FilterOp, GroupOp, JoinKind, NewStep, PQType, TransformFn, ValueType } from '../types';
import { mToSql } from './mexpr';

export class MParseError extends Error {}

/* ------------------------------ lexing helpers ------------------------------ */

/** Index after a string/quoted identifier/comment starting at i, or i when none starts there. */
function skipAtom(src: string, i: number): number {
  if (src[i] === '"' || (src[i] === '#' && src[i + 1] === '"')) {
    let j = src[i] === '#' ? i + 2 : i + 1;
    for (;;) {
      if (j >= src.length) throw new MParseError('Testo non terminato: manca "');
      if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } return j + 1; }
      j++;
    }
  }
  if (src.startsWith('//', i)) { const j = src.indexOf('\n', i); return j < 0 ? src.length : j; }
  if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); if (j < 0) throw new MParseError('Commento non terminato'); return j + 2; }
  return i;
}

/** Splits `src` at top-level occurrences of `sep` (outside strings, comments and brackets). */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < src.length;) {
    const j = skipAtom(src, i);
    if (j !== i) { i = j; continue; }
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && src.startsWith(sep, i)) { out.push(src.slice(start, i)); i += sep.length; start = i; continue; }
    i++;
  }
  out.push(src.slice(start));
  return out;
}

const unquote = (s: string) => { const t = s.trim(); const m = /^#"((?:[^"]|"")*)"$/.exec(t); return m ? m[1].replace(/""/g, '"') : t; };

/** Removes line and block comments (not inside strings or quoted identifiers). */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length;) {
    const j = skipAtom(src, i);
    if (j !== i) { out += src[i] === '/' ? ' ' : src.slice(i, j); i = j; continue; }
    out += src[i++];
  }
  return out;
}

/** `let a = …, b = … in b` → assignments and the result identifier. */
export function parseLet(src: string): { steps: [string, string][]; result: string } {
  const text = stripComments(src.replace(/^\uFEFF/, '')).trim();
  const m = /^let\b([\s\S]*)$/.exec(text);
  if (!m) throw new MParseError('Il codice deve iniziare con "let".');
  // Last top-level " in " keyword.
  let depth = 0, at = -1;
  for (let i = 0; i < m[1].length;) {
    const j = skipAtom(m[1], i);
    if (j !== i) { i = j; continue; }
    const c = m[1][i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && /\bin\b/.test(m[1].slice(i, i + 2)) && /\s/.test(m[1][i - 1] ?? ' ') && /\s/.test(m[1][i + 2] ?? ' ')) at = i;
    i++;
  }
  if (at < 0) throw new MParseError('Manca "in" alla fine dell\'espressione let.');
  const body = m[1].slice(0, at), result = unquote(m[1].slice(at + 2));
  const steps = splitTop(body, ',').map((x) => x.trim()).filter(Boolean).map((a): [string, string] => {
    const parts = splitTop(a, '=');
    if (parts.length < 2) throw new MParseError(`Assegnazione non valida: ${a.slice(0, 60)}`);
    return [unquote(parts[0]), parts.slice(1).join('=').trim()];
  });
  return { steps, result };
}

/* ------------------------------ value parser ------------------------------ */

type V =
  | { k: 'call'; fn: string; args: V[] } | { k: 'list'; items: V[] } | { k: 'record'; fields: [string, V][] }
  | { k: 'str'; v: string } | { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'each'; text: string }
  | { k: 'type'; v: string } | { k: 'null' } | { k: 'bool'; v: boolean } | { k: 'date'; v: string };

class P {
  i = 0;
  constructor(private s: string) {}
  ws() { for (;;) { while (/\s/.test(this.s[this.i] ?? '')) this.i++; const j = skipAtom(this.s, this.i); if (j !== this.i && this.s[this.i] === '/') { this.i = j; continue; } return; } }
  peek(t: string) { this.ws(); return this.s.startsWith(t, this.i); }
  eat(t: string) { this.ws(); if (!this.s.startsWith(t, this.i)) throw new MParseError(`Atteso "${t}" vicino a: ${this.s.slice(this.i, this.i + 30)}`); this.i += t.length; }
  /** Raw text up to the next top-level "," or closing bracket. */
  raw(): string {
    this.ws();
    let depth = 0; const start = this.i;
    while (this.i < this.s.length) {
      const j = skipAtom(this.s, this.i);
      if (j !== this.i) { this.i = j; continue; }
      const c = this.s[this.i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      this.i++;
    }
    return this.s.slice(start, this.i).trim();
  }
  value(): V {
    this.ws();
    const rest = this.s.slice(this.i);
    if (/^each\b/.test(rest)) { this.i += 4; return { k: 'each', text: this.raw() }; }
    if (/^\(\s*_\s*\)\s*=>/.test(rest)) { this.i += /^\(\s*_\s*\)\s*=>/.exec(rest)![0].length; return { k: 'each', text: this.raw() }; }
    if (/^type\b/.test(rest)) { this.i += 4; this.ws(); const t = /^[A-Za-z.]+/.exec(this.s.slice(this.i))![0]; this.i += t.length; return { k: 'type', v: 'type ' + t }; }
    if (/^null\b/.test(rest)) { this.i += 4; return { k: 'null' }; }
    if (/^(true|false)\b/.test(rest)) { const b = rest.startsWith('true'); this.i += b ? 4 : 5; return { k: 'bool', v: b }; }
    const dt = /^#(date|datetime)\(([^)]*)\)/.exec(rest);
    if (dt) {
      this.i += dt[0].length;
      const n = dt[2].split(',').map((x) => +x.trim());
      const p2 = (x: number) => String(x).padStart(2, '0');
      return { k: 'date', v: `${n[0]}-${p2(n[1])}-${p2(n[2])}${dt[1] === 'datetime' ? ` ${p2(n[3] ?? 0)}:${p2(n[4] ?? 0)}:${p2(n[5] ?? 0)}` : ''}` };
    }
    if (rest[0] === '"') { const j = skipAtom(this.s, this.i); const v = this.s.slice(this.i + 1, j - 1).replace(/""/g, '"'); this.i = j; return { k: 'str', v }; }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (num) { this.i += num[0].length; return { k: 'num', v: +num[0] }; }
    if (rest[0] === '{') {
      this.i++; const items: V[] = [];
      while (!this.peek('}')) { items.push(this.value()); if (this.peek(',')) this.eat(','); else break; }
      this.eat('}'); return { k: 'list', items };
    }
    if (rest[0] === '[') {
      this.i++; const fields: [string, V][] = [];
      while (!this.peek(']')) { this.ws(); const name = /^[A-Za-z_][\w ]*/.exec(this.s.slice(this.i))![0]; this.i += name.length; this.eat('='); fields.push([name.trim(), this.value()]); if (this.peek(',')) this.eat(','); else break; }
      this.eat(']'); return { k: 'record', fields };
    }
    let id: string;
    if (rest.startsWith('#"')) { const j = skipAtom(this.s, this.i); id = unquote(this.s.slice(this.i, j)); this.i = j; }
    else {
      const m = /^#?[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*/.exec(rest);
      if (!m) throw new MParseError(`Espressione non riconosciuta: ${rest.slice(0, 40)}`);
      id = m[0]; this.i += id.length;
    }
    if (this.peek('(')) {
      this.eat('('); const args: V[] = [];
      while (!this.peek(')')) { args.push(this.value()); if (this.peek(',')) this.eat(','); else break; }
      this.eat(')'); return { k: 'call', fn: id, args };
    }
    if (/^(Int64|Number|Text|Date|DateTime|Logical|Currency|Percentage)\.Type$/.test(id)) return { k: 'type', v: id };
    // Field access (#"Passo"[Colonna]): kept as an opaque identifier (e.g. List.Distinct(t[col]) in Table.Pivot).
    this.ws();
    if (this.s[this.i] === '[') { const j = this.s.indexOf(']', this.i); if (j > 0) { id += this.s.slice(this.i, j + 1); this.i = j + 1; } }
    return { k: 'id', v: id };
  }
}

export function parseValue(src: string): V {
  const p = new P(src);
  const v = p.value();
  p.ws();
  if (p.i < src.length) throw new MParseError(`Testo in eccesso: ${src.slice(p.i, p.i + 30)}`);
  return v;
}

/* ------------------------------ M → steps ------------------------------ */

const str = (v: V | undefined, what: string): string => { if (v?.k === 'str') return v.v; throw new MParseError(`Atteso un testo per ${what}.`); };
const num = (v: V | undefined, what: string): number => { if (v?.k === 'num') return v.v; throw new MParseError(`Atteso un numero per ${what}.`); };
const strs = (v: V | undefined, what: string): string[] => {
  if (v?.k === 'str') return [v.v];
  if (v?.k === 'list') return v.items.map((x) => str(x, what));
  throw new MParseError(`Attesa una lista di colonne per ${what}.`);
};
const pairs = (v: V | undefined, what: string): V[][] => {
  if (v?.k !== 'list') throw new MParseError(`Attesa una lista per ${what}.`);
  const items = v.items.length && v.items[0].k !== 'list' ? [v] : v.items;
  return items.map((x) => { if (x.k !== 'list') throw new MParseError(`Attesa una lista di coppie per ${what}.`); return x.items; });
};
const lit = (v: V): { value: string | null; vtype: ValueType } => (v.k === 'str' ? { value: v.v, vtype: 'text' } : v.k === 'num' ? { value: String(v.v), vtype: 'number' }
  : v.k === 'date' ? { value: v.v, vtype: v.v.includes(':') ? 'datetime' : 'date' } : v.k === 'bool' ? { value: String(v.v), vtype: 'bool' } : v.k === 'null' ? { value: null, vtype: 'text' }
    // An identifier is a Power Query parameter.
    : v.k === 'id' ? { value: `#[${v.v}]`, vtype: 'text' } : (() => { throw new MParseError('Atteso un valore letterale.'); })());

const TYPES: Record<string, PQType> = {
  'type text': 'text', 'Text.Type': 'text', 'Int64.Type': 'int', 'type number': 'decimal', 'Number.Type': 'decimal', 'Currency.Type': 'decimal', 'Percentage.Type': 'decimal',
  'type date': 'date', 'Date.Type': 'date', 'type datetime': 'datetime', 'DateTime.Type': 'datetime', 'type logical': 'bool', 'Logical.Type': 'bool',
};
const TRANSFORMS: Record<string, TransformFn> = {
  'Text.Upper': 'upper', 'Text.Lower': 'lower', 'Text.Proper': 'proper', 'Text.Trim': 'trim', 'Text.Length': 'length', 'Number.Abs': 'abs',
  'Date.Year': 'year', 'Date.Month': 'month', 'Date.Day': 'day', 'Date.QuarterOfYear': 'quarter',
};
const JOINS: Record<string, JoinKind> = { 'JoinKind.LeftOuter': 'left', 'JoinKind.RightOuter': 'right', 'JoinKind.FullOuter': 'full', 'JoinKind.Inner': 'inner', 'JoinKind.LeftAnti': 'leftAnti' };

const col = (s: string) => { const m = /^\[\s*(#"(?:[^"]|"")*"|[^\]]+?)\s*\]$/.exec(s.trim()); return m ? unquote(m[1]) : null; };

/** `each` condition → structured filter when it is one of the editor's shapes, else a free M condition. */
function filterStep(cond: string): NewStep {
  const c = cond.trim();
  const cmp = /^(\[[^\]]+\])\s*(=|<>|>=|<=|>|<)\s*(.+)$/s.exec(c);
  if (cmp && col(cmp[1])) {
    try {
      const v = lit(parseValue(cmp[3]));
      if (v.value !== null) {
        const op = ({ '=': 'eq', '<>': 'ne', '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le' } as Record<string, FilterOp>)[cmp[2]];
        return { kind: 'filterRows', column: col(cmp[1])!, op, value: v.value, vtype: v.vtype };
      }
    } catch { /* free condition */ }
  }
  const txt = /^(not\s+)?Text\.(Contains|StartsWith|EndsWith)\(\s*(\[[^\]]+\])\s*,\s*("(?:[^"]|"")*")\s*\)$/.exec(c);
  if (txt && col(txt[3])) {
    const op: FilterOp = txt[2] === 'Contains' ? (txt[1] ? 'notContains' : 'contains') : txt[1] ? 'contains' : txt[2] === 'StartsWith' ? 'startsWith' : 'endsWith';
    if (!txt[1] || txt[2] === 'Contains') return { kind: 'filterRows', column: col(txt[3])!, op, value: txt[4].slice(1, -1).replace(/""/g, '"'), vtype: 'text' };
  }
  const inList = /^(not\s+)?List\.Contains\(\s*(\{[\s\S]*\})\s*,\s*(\[[^\]]+\])\s*\)$/.exec(c);
  if (inList && col(inList[3])) {
    const items = (parseValue(inList[2]) as Extract<V, { k: 'list' }>).items.map(lit);
    return { kind: 'filterRows', column: col(inList[3])!, op: inList[1] ? 'notIn' : 'in', values: items.map((x) => x.value), vtype: items[0]?.vtype ?? 'text' };
  }
  mToSql(c); // validates the condition (throws on unsupported syntax)
  return { kind: 'selectRows', formula: c };
}

const GROUP_FN: Record<string, GroupOp> = { 'List.Sum': 'sum', 'List.Average': 'avg', 'List.Median': 'median', 'List.Min': 'min', 'List.Max': 'max' };
function groupAgg(name: string, e: string): { name: string; op: GroupOp; column?: string } {
  const t = e.replace(/\s+/g, ' ').trim();
  if (/^Table\.RowCount\(_\)$/.test(t)) return { name, op: 'count' };
  if (/^Table\.RowCount\(Table\.Distinct\(_\)\)$/.test(t)) return { name, op: 'countd' };
  let m = /^List\.Count\(List\.Distinct\((\[[^\]]+\])\)\)$/.exec(t);
  if (m && col(m[1])) return { name, op: 'countd', column: col(m[1])! };
  m = /^(List\.\w+)\((\[[^\]]+\])\)$/.exec(t);
  if (m && GROUP_FN[m[1]] && col(m[2])) return { name, op: GROUP_FN[m[1]], column: col(m[2])! };
  throw new MParseError(`Aggregazione non supportata in Table.Group: ${e}`);
}

/**
 * One step expression → step(s). `pending` carries a Table.NestedJoin waiting for its
 * Table.ExpandTableColumn (the two M steps of a merge).
 */
export function exprToStep(expr: string, pending?: { table: string; left: string[]; right: string[]; join: JoinKind; column: string }): NewStep | { nested: NonNullable<typeof pending> } {
  const v = parseValue(expr);
  if (v.k !== 'call') throw new MParseError(`Atteso un passaggio Table.*: ${expr.slice(0, 50)}`);
  const a = v.args;
  const each = (x: V | undefined, what: string) => { if (x?.k === 'each') return x.text; throw new MParseError(`Atteso "each …" per ${what}.`); };
  switch (v.fn) {
    case 'Table.RemoveColumns': return { kind: 'removeColumns', columns: strs(a[1], v.fn) };
    case 'Table.SelectColumns': return { kind: 'selectColumns', columns: strs(a[1], v.fn) };
    case 'Table.RenameColumns': return { kind: 'renameColumns', renames: pairs(a[1], v.fn).map((p) => [str(p[0], v.fn), str(p[1], v.fn)] as [string, string]) };
    case 'Table.TransformColumnTypes': return {
      kind: 'changeType', columns: pairs(a[1], v.fn).map((p) => {
        const t = p[1]?.k === 'type' ? TYPES[p[1].v] : undefined;
        if (!t) throw new MParseError(`Tipo non supportato per la colonna "${str(p[0], v.fn)}".`);
        return [str(p[0], v.fn), t] as [string, PQType];
      }),
    };
    case 'Table.SelectRows': return filterStep(each(a[1], v.fn));
    case 'Table.Sort': return { kind: 'sort', by: pairs(a[1], v.fn).map((p) => [str(p[0], v.fn), p[1]?.k === 'id' && p[1].v === 'Order.Descending' ? 'desc' : 'asc'] as [string, 'asc' | 'desc']) };
    case 'Table.Distinct': return { kind: 'removeDuplicates', columns: a[1] ? strs(a[1], v.fn) : [] };
    case 'Table.Pivot': {
      // Table.Pivot(t, List.Distinct(t[col]), "col", "val", aggregator?)
      const f = a[4];
      const AGG: Record<string, GroupOp> = { 'List.Sum': 'sum', 'List.Average': 'avg', 'List.Count': 'count', 'List.Min': 'min', 'List.Max': 'max', 'List.Median': 'median' };
      const agg: GroupOp | 'none' = !f ? 'none' : f.k === 'id' && AGG[f.v] ? AGG[f.v] : f.k === 'each' && /List\.Count\(\s*List\.Distinct\(\s*_\s*\)\s*\)/.test(f.text) ? 'countd' : (() => { throw new MParseError('Table.Pivot: funzione di aggregazione non supportata.'); })();
      return { kind: 'pivot', column: str(a[2], v.fn), value: str(a[3], v.fn), agg };
    }
    case 'Table.FirstN': return { kind: 'keepTop', n: num(a[1], v.fn) };
    case 'Table.LastN': return { kind: 'keepBottom', n: num(a[1], v.fn) };
    case 'Table.Skip': return { kind: 'removeTop', n: num(a[1], v.fn) };
    case 'Table.RemoveLastN': return { kind: 'removeBottom', n: num(a[1], v.fn) };
    case 'Table.ReplaceValue': {
      const f = lit(a[1]), r = lit(a[2]);
      return { kind: 'replaceValues', columns: strs(a[4], v.fn), find: f.value ?? '', replace: r.value ?? '', vtype: f.vtype, whole: !(a[3]?.k === 'id' && a[3].v === 'Replacer.ReplaceText') };
    }
    case 'Table.TransformColumns': {
      const ps = pairs(a[1], v.fn);
      const fns = ps.map((p) => {
        const f = p[1];
        if (f?.k === 'id' && TRANSFORMS[f.v]) return { fn: TRANSFORMS[f.v] };
        const round = f?.k === 'each' ? /^Number\.Round\(\s*_\s*,\s*(\d+)\s*\)$/.exec(f.text) : null;
        if (round) return { fn: 'round' as TransformFn, digits: +round[1] };
        throw new MParseError('Table.TransformColumns: trasformazione non supportata.');
      });
      if (fns.some((x) => x.fn !== fns[0].fn || x.digits !== fns[0].digits)) throw new MParseError('Table.TransformColumns: usare la stessa trasformazione per tutte le colonne.');
      return { kind: 'transform', columns: ps.map((p) => str(p[0], v.fn)), fn: fns[0].fn, ...(fns[0].digits !== undefined ? { digits: fns[0].digits } : {}) };
    }
    case 'Table.FillDown': return { kind: 'fillDown', columns: strs(a[1], v.fn) };
    case 'Table.FillUp': return { kind: 'fillUp', columns: strs(a[1], v.fn) };
    case 'Table.SplitColumn': {
      const sp = a[2];
      if (sp?.k !== 'call' || !/Splitter\.SplitTextByDelimiter/.test(sp.fn)) throw new MParseError('Table.SplitColumn: è supportato solo Splitter.SplitTextByDelimiter.');
      const parts = a[3]?.k === 'list' ? a[3].items.length : a[3]?.k === 'num' ? a[3].v : 2;
      return { kind: 'splitColumn', column: str(a[1], v.fn), delimiter: str(sp.args[0], 'il delimitatore'), parts };
    }
    case 'Table.AddColumn': { const f = each(a[2], v.fn); mToSql(f); return { kind: 'customColumn', name: str(a[1], v.fn), formula: f }; }
    case 'Table.AddIndexColumn': return { kind: 'indexColumn', name: str(a[1], v.fn), start: a[2] ? num(a[2], v.fn) : 0 };
    case 'Table.DuplicateColumn': return { kind: 'duplicateColumn', column: str(a[1], v.fn), name: str(a[2], v.fn) };
    case 'Table.Group': return {
      kind: 'groupBy', keys: strs(a[1], v.fn),
      aggs: pairs(a[2], v.fn).map((p) => groupAgg(str(p[0], v.fn), each(p[1], v.fn))),
    };
    case 'Table.Unpivot': case 'Table.UnpivotOtherColumns': return { kind: 'unpivot', columns: strs(a[1], v.fn), other: v.fn === 'Table.UnpivotOtherColumns', cast: true };
    case 'Table.NestedJoin': {
      const other = a[2]?.k === 'id' ? a[2].v : str(a[2], 'la tabella da unire');
      return { nested: { table: other, left: strs(a[1], v.fn), right: strs(a[3], v.fn), column: str(a[4], v.fn), join: (a[5]?.k === 'id' && JOINS[a[5].v]) || 'left' } };
    }
    case 'Table.ExpandTableColumn': {
      if (!pending || str(a[1], v.fn) !== pending.column) throw new MParseError('Table.ExpandTableColumn deve seguire il relativo Table.NestedJoin.');
      return { kind: 'merge', table: pending.table, left: pending.left, right: pending.right, join: pending.join, expand: strs(a[2], v.fn) };
    }
    case 'Table.Combine': {
      if (a[0]?.k !== 'list') throw new MParseError('Table.Combine: attesa una lista di tabelle.');
      return { kind: 'append', tables: a[0].items.slice(1).map((x) => (x.k === 'id' ? x.v : str(x, 'la tabella'))) };
    }
    case 'Table.PromoteHeaders': return { kind: 'promoteHeaders', renames: [] };
    default: throw new MParseError(`Funzione M non supportata dall'editor di MiB-BI: ${v.fn}`);
  }
}

/** Expression split into string literals (decoded) and the text between them (whitespace-normalized). */
function splitLiterals(expr: string): { code: string[]; lits: string[] } {
  const code: string[] = [], lits: string[] = [];
  let cur = '';
  for (let i = 0; i < expr.length;) {
    if (expr[i] === '"' && expr[i - 1] !== '#') {
      let j = i + 1, v = '';
      while (j < expr.length) { if (expr[j] === '"') { if (expr[j + 1] === '"') { v += '"'; j += 2; continue; } break; } v += expr[j++]; }
      code.push(cur.replace(/\s+/g, ' ').trim()); lits.push(v); cur = ''; i = j + 1;
    } else cur += expr[i++];
  }
  code.push(cur.replace(/\s+/g, ' ').trim());
  return { code, lits };
}

type Source = import('../types').TableMeta['source'];
/** Source edited in M: the source steps keep MiB-BI's shape and only their text literals change
 *  (path, sheet, URL, server, database, schema, table…); each changed literal updates the source field that held it. */
function editedSource(docSteps: [string, string][], baseSteps: [string, string][], source: Source): Source {
  const fail = () => { throw new MParseError(`L'origine si modifica cambiando solo i valori tra virgolette dei passaggi "${baseSteps.map((b) => b[0]).join('", "')}" (o dal passaggio Origine).`); };
  const changes = new Map<string, string>();
  baseSteps.forEach(([name, expr], i) => {
    const d = docSteps[i];
    if (!d || d[0] !== name) fail();
    const a = splitLiterals(expr), b = splitLiterals(d[1]);
    if (a.code.length !== b.code.length || a.code.some((c, k) => c !== b.code[k])) fail();
    a.lits.forEach((v, k) => { if (v !== b.lits[k]) { if (changes.has(v) && changes.get(v) !== b.lits[k]) fail(); changes.set(v, b.lits[k]); } });
  });
  if (!changes.size) return source;
  const next: any = structuredClone(source);
  let used = 0;
  const visit = (o: any) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string' && changes.has(o[k])) { o[k] = changes.get(o[k]); used++; }
      else if (o[k] && typeof o[k] === 'object') visit(o[k]);
    }
  };
  visit(next);
  // Folder sources: the extension literal is written with its dot (".csv").
  if (next.folder) for (const [from, to] of changes) if (from === '.' + next.folder.ext) { next.folder.ext = to.replace(/^\./, ''); used++; }
  if (!used) fail();
  return next;
}

/** Data typed in the M of a table ("Immetti dati"): MiB-BI's #table({cols}, {{…}}) or Power BI's
 *  Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("…", BinaryEncoding.Base64), Compression.Deflate)), … type table [A = _t, …]). */
export async function inlineFromM(m: string): Promise<{ columns: string[]; rows: (string | null)[][] } | null> {
  let doc: ReturnType<typeof parseLet>;
  try { doc = parseLet(m); } catch { return null; }
  const first = doc.steps[0]?.[1] ?? '';
  const cell = (v: V): string | null => (v.k === 'str' ? v.v : v.k === 'num' ? String(v.v) : v.k === 'bool' ? String(v.v) : v.k === 'date' ? v.v : null);
  if (/^#table\s*\(/.test(first.trim())) {
    try {
      const v = parseValue(first);
      if (v.k !== 'call' || v.args[0]?.k !== 'list' || v.args[1]?.k !== 'list') return null;
      const columns = v.args[0].items.map((x) => (x.k === 'str' ? x.v : ''));
      const rows = v.args[1].items.map((r) => (r.k === 'list' ? r.items.map(cell) : []));
      return columns.every(Boolean) ? { columns, rows } : null;
    } catch { return null; }
  }
  const b64 = /Binary\.FromText\("([A-Za-z0-9+/=]+)",\s*BinaryEncoding\.Base64\)/.exec(first)?.[1];
  const cols = /type table \[([^\]]*)\]/.exec(first)?.[1];
  if (!b64 || !cols) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const deflate = /Compression\.Deflate/.test(first);
    const text = deflate ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() : new TextDecoder().decode(bytes);
    const data = JSON.parse(text) as unknown[][];
    const columns = cols.split(',').map((c) => c.split('=')[0].trim().replace(/^#"(.*)"$/, '$1').replace(/""/g, '"'));
    return { columns, rows: data.map((r) => columns.map((_, i) => (r[i] === null || r[i] === undefined ? null : String(r[i])))) };
  } catch { return null; }
}

/** Whole document → source (possibly edited, see editedSource) and the steps after it. */
export function mToQuery(text: string, baseM: string, source: Source): { source: Source; steps: NewStep[] } {
  const doc = parseLet(text);
  const base = parseLet(baseM);
  const src = editedSource(doc.steps.slice(0, base.steps.length), base.steps, source);
  return { source: src, steps: stepsAfter(doc, base) };
}

/**
 * Whole document → steps after the source. The lines of `baseM` (the query's source) must be
 * unchanged (mToQuery also accepts an edited source).
 */
export function mToSteps(text: string, baseM: string): NewStep[] {
  const doc = parseLet(text);
  const base = parseLet(baseM);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < base.steps.length; i++) {
    const d = doc.steps[i];
    if (!d || d[0] !== base.steps[i][0] || norm(d[1]) !== norm(base.steps[i][1])) {
      throw new MParseError(`L'origine ("${base.steps[i][0]}") non può essere modificata in questo punto: usare l'Editor avanzato o il passaggio Origine.`);
    }
  }
  return stepsAfter(doc, base);
}

function stepsAfter(doc: ReturnType<typeof parseLet>, base: ReturnType<typeof parseLet>): NewStep[] {
  const out: NewStep[] = [];
  let pending: Parameters<typeof exprToStep>[1];
  let prev = base.steps[base.steps.length - 1][0];
  for (const [name, expr] of doc.steps.slice(base.steps.length)) {
    try {
      const r = exprToStep(expr, pending);
      if ('nested' in r) { pending = r.nested; prev = name; continue; }
      if (pending && r.kind !== 'merge') throw new MParseError('Table.NestedJoin senza Table.ExpandTableColumn.');
      pending = undefined;
      out.push(r);
      prev = name;
    } catch (e) {
      throw new MParseError(`Passaggio "${name}": ${(e as Error).message}`);
    }
  }
  if (pending) throw new MParseError('Table.NestedJoin senza Table.ExpandTableColumn.');
  if (doc.result !== prev) throw new MParseError(`"in" deve restituire l'ultimo passaggio ("${prev}").`);
  return out;
}
