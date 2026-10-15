/**
 * Translator for the M formulas of "Colonna personalizzata" (the `each …` body) into DuckDB SQL.
 * Covers the common subset: column references, literals, arithmetic, `&`, comparisons,
 * and/or/not, if-then-else and a table of Text.*, Number.*, Date.* functions.
 */

type Tok = { t: 'num' | 'str' | 'col' | 'id' | 'op' | 'kw' | 'eof'; v: string };

const KEYWORDS = new Set(['if', 'then', 'else', 'and', 'or', 'not', 'null', 'true', 'false', 'each']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Error('Testo non terminato: manca "');
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('Riferimento a colonna non terminato: manca ]');
      let name = src.slice(i + 1, j).trim();
      const quoted = /^#"(.*)"$/.exec(name);
      if (quoted) name = quoted[1].replace(/""/g, '"');
      out.push({ t: 'col', v: name });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*/.exec(src.slice(i));
    if (id) { out.push({ t: KEYWORDS.has(id[0]) ? 'kw' : 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/&=<>(),])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error(`Carattere non valido: ${c}`);
  }
  out.push({ t: 'eof', v: '' });
  return out;
}

const qi = (n: string) => '"' + n.replace(/"/g, '""') + '"';
const ql = (s: string) => "'" + s.replace(/'/g, "''") + "'";

/** M function → SQL builder (arguments already translated). */
const FUNCS: Record<string, (a: string[]) => string> = {
  'Text.Upper': (a) => `upper(${a[0]})`,
  'Text.Lower': (a) => `lower(${a[0]})`,
  'Text.Trim': (a) => `trim(${a[0]})`,
  'Text.Length': (a) => `length(${a[0]})`,
  'Text.Start': (a) => `left(${a[0]}, ${a[1]})`,
  'Text.End': (a) => `right(${a[0]}, ${a[1]})`,
  'Text.Middle': (a) => `substr(${a[0]}, (${a[1]}) + 1${a[2] ? ', ' + a[2] : ''})`,
  'Text.Contains': (a) => `contains(${a[0]}, ${a[1]})`,
  'Text.StartsWith': (a) => `starts_with(${a[0]}, ${a[1]})`,
  'Text.EndsWith': (a) => `ends_with(${a[0]}, ${a[1]})`,
  'Text.Replace': (a) => `replace(${a[0]}, ${a[1]}, ${a[2]})`,
  'Text.PadStart': (a) => `lpad(CAST(${a[0]} AS VARCHAR), ${a[1]}, ${a[2] ?? "' '"})`,
  'Text.PadEnd': (a) => `rpad(CAST(${a[0]} AS VARCHAR), ${a[1]}, ${a[2] ?? "' '"})`,
  'Text.From': (a) => `CAST(${a[0]} AS VARCHAR)`,
  'Text.Proper': (a) => properSql(a[0]),
  'Number.From': (a) => `TRY_CAST(${a[0]} AS DOUBLE)`,
  'Number.Round': (a) => `round(${a[0]}, ${a[1] ?? 0})`,
  'Number.RoundUp': (a) => `ceil(${a[0]})`,
  'Number.RoundDown': (a) => `floor(${a[0]})`,
  'Number.Abs': (a) => `abs(${a[0]})`,
  'Number.Sqrt': (a) => `sqrt(${a[0]})`,
  'Number.Power': (a) => `power(${a[0]}, ${a[1]})`,
  'Number.Mod': (a) => `(${a[0]}) % (${a[1]})`,
  'Number.IntegerDivide': (a) => `(${a[0]}) // (${a[1]})`,
  'Date.From': (a) => `TRY_CAST(${a[0]} AS DATE)`,
  'Date.Year': (a) => `year(${a[0]})`,
  'Date.Month': (a) => `month(${a[0]})`,
  'Date.Day': (a) => `day(${a[0]})`,
  'Date.QuarterOfYear': (a) => `quarter(${a[0]})`,
  'Date.DayOfWeek': (a) => `(isodow(${a[0]}) - 1)`,
  'Date.AddDays': (a) => `(${a[0]} + to_days(CAST(${a[1]} AS INTEGER)))`,
  'Date.AddMonths': (a) => `(${a[0]} + to_months(CAST(${a[1]} AS INTEGER)))`,
  'Date.AddYears': (a) => `(${a[0]} + to_years(CAST(${a[1]} AS INTEGER)))`,
  'Date.StartOfMonth': (a) => `date_trunc('month', ${a[0]})`,
  'Date.EndOfMonth': (a) => `last_day(${a[0]})`,
  'DateTime.LocalNow': () => 'localtimestamp',
  'Date.ToText': (a) => `CAST(${a[0]} AS VARCHAR)`,
};

/** Power BI "Iniziali maiuscole" (Text.Proper). */
export const properSql = (x: string) =>
  `array_to_string(list_transform(string_split(lower(${x}), ' '), lambda w: upper(left(w, 1)) || substr(w, 2)), ' ')`;

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCS);

/** Translates an M expression to SQL; throws an Italian error message like Power Query's "Expression.Error". */
export function mToSql(formula: string): string {
  const toks = tokenize(formula);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => peek().t === 'op' && peek().v === v;
  const isKw = (v: string) => peek().t === 'kw' && peek().v === v;
  const expect = (t: Tok['t'], v: string) => {
    const k = next();
    if (k.t !== t || k.v !== v) throw new Error(`Previsto "${v}"${k.t === 'eof' ? ' alla fine della formula' : `, trovato "${k.v}"`}`);
  };

  const expr = (): string => {
    if (isKw('if')) {
      next();
      const c = expr();
      expect('kw', 'then');
      const a = expr();
      expect('kw', 'else');
      const b = expr();
      return `CASE WHEN ${c} THEN ${a} ELSE ${b} END`;
    }
    return or();
  };
  const or = (): string => { let l = and(); while (isKw('or')) { next(); l = `(${l} OR ${and()})`; } return l; };
  const and = (): string => { let l = not(); while (isKw('and')) { next(); l = `(${l} AND ${not()})`; } return l; };
  const not = (): string => (isKw('not') ? (next(), `(NOT ${not()})`) : cmp());
  const cmp = (): string => {
    const l = add();
    const t = peek();
    if (t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
      next();
      const r = add();
      // M: x = null tests for null.
      if (r === 'NULL' && (t.v === '=' || t.v === '<>')) return `(${l} IS ${t.v === '=' ? '' : 'NOT '}NULL)`;
      return `(${l} ${t.v} ${r})`;
    }
    return l;
  };
  const add = (): string => {
    let l = mul();
    while (isOp('+') || isOp('-') || isOp('&')) {
      const op = next().v;
      const r = mul();
      l = op === '&' ? `(CAST(${l} AS VARCHAR) || CAST(${r} AS VARCHAR))` : `(${l} ${op} ${r})`;
    }
    return l;
  };
  const mul = (): string => {
    let l = unary();
    while (isOp('*') || isOp('/')) {
      const op = next().v;
      const r = unary();
      l = op === '/' ? `(CAST(${l} AS DOUBLE) / ${r})` : `(${l} * ${r})`;
    }
    return l;
  };
  const unary = (): string => (isOp('-') ? (next(), `(-${unary()})`) : primary());
  const primary = (): string => {
    const k = next();
    if (k.t === 'num') return k.v;
    if (k.t === 'str') return ql(k.v);
    if (k.t === 'col') return qi(k.v);
    if (k.t === 'kw' && k.v === 'null') return 'NULL';
    if (k.t === 'kw' && (k.v === 'true' || k.v === 'false')) return k.v.toUpperCase();
    if (k.t === 'kw' && k.v === 'each') return expr();
    if (k.t === 'op' && k.v === '(') { const e = expr(); expect('op', ')'); return `(${e})`; }
    if (k.t === 'id') {
      const fn = FUNCS[k.v];
      if (!fn) throw new Error(`Funzione non supportata: ${k.v}`);
      expect('op', '(');
      const args: string[] = [];
      if (!isOp(')')) { args.push(expr()); while (isOp(',')) { next(); args.push(expr()); } }
      expect('op', ')');
      return fn(args);
    }
    throw new Error(k.t === 'eof' ? 'Formula incompleta' : `Simbolo imprevisto: "${k.v}"`);
  };

  const out = expr();
  if (peek().t !== 'eof') throw new Error(`Simbolo imprevisto: "${peek().v}"`);
  return out;
}

/** Column names referenced by a formula (for validation against the current schema). */
export function referencedColumns(formula: string): string[] {
  try { return tokenize(formula).filter((t) => t.t === 'col').map((t) => t.v); } catch { return []; }
}
