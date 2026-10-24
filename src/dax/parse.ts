/** DAX lexer and parser: expressions (measures, columns, tables) and queries (DEFINE / EVALUATE). */

export class DaxError extends Error {}

/** `s`/`e`: position of the token in the source (DEFINE FUNCTION keeps its text). */
type Tok = { s?: number; e?: number } & (
  | { t: 'num'; v: string } | { t: 'str'; v: string } | { t: 'op'; v: string } | { t: 'kw'; v: string }
  | { t: 'col'; table?: string; v: string } | { t: 'id'; v: string } | { t: 'tbl'; v: string });

/** Words with a syntactic role when not used as a function or table[column]. */
const KEYWORDS = new Set(['VAR', 'RETURN', 'DEFINE', 'EVALUATE', 'MEASURE', 'ORDER', 'BY', 'ASC', 'DESC', 'IN', 'NOT', 'TRUE', 'FALSE', 'TABLE', 'COLUMN', 'FUNCTION']);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const peekNonWs = (j: number) => { while (j < src.length && /\s/.test(src[j])) j++; return src[j]; };
  const bracket = (): string => {
    let s = '';
    i++;
    while (i < src.length) {
      if (src[i] === ']') { if (src[i + 1] === ']') { s += ']'; i += 2; continue; } i++; return s; }
      s += src[i++];
    }
    throw new DaxError('Parentesi quadra non chiusa');
  };
  // Auto date hierarchy level: 'T'[Date].[Month] → treated as the base column.
  const level = () => { while (src[i] === '.' && src[i + 1] === '[') { i++; bracket(); } };
  const one = () => {
    const c = src[i];
    if (/\s/.test(c)) { i++; return; }
    if ((c === '/' && src[i + 1] === '/') || (c === '-' && src[i + 1] === '-')) { while (i < src.length && src[i] !== '\n') i++; return; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; return; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[1] }); i += m[1].length; return;
    }
    if (c === '"') {
      let s = ''; i++;
      for (;;) {
        if (i >= src.length) throw new DaxError('Testo non terminato: manca "');
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s }); return;
    }
    if (c === "'") {
      let s = ''; i++;
      while (i < src.length) { if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += src[i++]; }
      if (src[i] === '[') { out.push({ t: 'col', table: s, v: bracket() }); level(); } else out.push({ t: 'tbl', v: s });
      return;
    }
    if (c === '[') { out.push({ t: 'col', v: bracket() }); level(); return; }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w.]*/.exec(src.slice(i))!;
      i += m[0].length;
      const up = m[0].toUpperCase();
      const nx = peekNonWs(i);
      if (src[i] === '[') { out.push({ t: 'col', table: m[0], v: bracket() }); level(); }
      else if (nx === '(' && !(KEYWORDS.has(up) && up !== 'TRUE' && up !== 'FALSE')) out.push({ t: 'id', v: up });
      else if (KEYWORDS.has(up)) out.push({ t: 'kw', v: up });
      else out.push({ t: 'tbl', v: m[0] });
      return;
    }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '<=', '>=', '<>', '==', '=>'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; return; }
    if ('+-*/^&=<>(),{}:'.includes(c)) { out.push({ t: 'op', v: c }); i++; return; }
    throw new DaxError(`Carattere non valido: ${c}`);
  };
  while (i < src.length) {
    const n0 = out.length, st = i;
    one();
    for (let k = n0; k < out.length; k++) { out[k].s = st; out[k].e = i; }
  }
  return out;
}

export type Node =
  | { k: 'num'; v: string } | { k: 'str'; v: string } | { k: 'bool'; v: boolean }
  | { k: 'col'; table?: string; col: string } | { k: 'tbl'; name: string } | { k: 'var'; name: string }
  | { k: 'call'; fn: string; args: Node[] } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node } | { k: 'list'; rows: Node[][] }
  | { k: 'let'; vars: [string, Node][]; body: Node };

/** Parameter of a user-defined function: `expr` = passed unevaluated (references, EXPR), else evaluated once (VAL). */
export interface UdfParam { name: string; mode: 'val' | 'expr'; type: 'any' | 'scalar' | 'table' | 'ref'; subtype?: string; def?: Node; }
export interface UdfDef { params: UdfParam[]; body: Node; }
export interface QueryDefine { kind: 'measure' | 'var' | 'table' | 'column' | 'function'; table?: string; name: string; expr: Node; text: string; fn?: UdfDef; description?: string; }
export interface DaxQuery { defines: QueryDefine[]; evaluates: { expr: Node; order: { expr: Node; desc: boolean }[] }[]; }

class Parser {
  p = 0;
  scopes: Set<string>[] = [new Set()];
  constructor(public toks: Tok[], public src = '') {}

  peek() { return this.toks[this.p]; }
  isOp(v: string) { const t = this.peek(); return t?.t === 'op' && t.v === v; }
  isKw(v: string) { const t = this.peek(); return t?.t === 'kw' && t.v === v; }
  expect(v: string) {
    if (!this.isOp(v)) {
      const t = this.peek();
      throw new DaxError(`Atteso "${v}"${t ? `, trovato "${'v' in t ? t.v : ''}"` : ' alla fine dell\'espressione'}`);
    }
    this.p++;
  }
  expectKw(v: string) { if (!this.isKw(v)) throw new DaxError(`Atteso ${v}`); this.p++; }
  isVar(name: string) { return this.scopes.some((s) => s.has(name.toUpperCase())); }

  /** expression := VAR … RETURN expression | binary */
  expr(): Node {
    if (this.isKw('VAR')) {
      const vars: [string, Node][] = [];
      this.scopes.push(new Set());
      try {
        while (this.isKw('VAR')) {
          this.p++;
          const t = this.toks[this.p++];
          if (!t || (t.t !== 'tbl' && t.t !== 'kw')) throw new DaxError('Nome di variabile non valido dopo VAR');
          this.expect('=');
          const value = this.expr();
          vars.push([t.v, value]);
          this.scopes[this.scopes.length - 1].add(t.v.toUpperCase());
        }
        this.expectKw('RETURN');
        return { k: 'let', vars, body: this.expr() };
      } finally { this.scopes.pop(); }
    }
    return this.bin(0);
  }

  static LEVELS: string[][] = [['||'], ['&&'], ['=', '==', '<>', '<', '>', '<=', '>='], ['&'], ['+', '-'], ['*', '/'], ['^']];

  bin(lvl: number): Node {
    if (lvl === Parser.LEVELS.length) return this.unary();
    let a = this.bin(lvl + 1);
    for (;;) {
      if (lvl === 2 && this.isKw('IN')) { this.p++; a = { k: 'bin', op: 'IN', a, b: this.unary() }; continue; }
      if (lvl === 2 && this.isKw('NOT') && this.toks[this.p + 1]?.t === 'kw' && (this.toks[this.p + 1] as any).v === 'IN') {
        this.p += 2;
        a = { k: 'call', fn: 'NOT', args: [{ k: 'bin', op: 'IN', a, b: this.unary() }] };
        continue;
      }
      const t = this.peek();
      if (t?.t === 'op' && Parser.LEVELS[lvl].includes(t.v)) { this.p++; a = { k: 'bin', op: t.v, a, b: this.bin(lvl + 1) }; } else return a;
    }
  }

  unary(): Node {
    if (this.isOp('-')) { this.p++; return { k: 'neg', a: this.unary() }; }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    if (this.isKw('NOT')) { this.p++; return { k: 'call', fn: 'NOT', args: [this.unary()] }; }
    return this.primary();
  }

  primary(): Node {
    const t = this.toks[this.p++];
    if (!t) throw new DaxError('Espressione incompleta');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'col') return { k: 'col', table: t.table, col: t.v };
    if (t.t === 'tbl') {
      // Visual calculation axes: ROWS COLUMNS, COLUMNS ROWS, ROWS ROWPAGES… are one argument.
      const AX = /^(ROWS|COLUMNS|ROWPAGES)$/i;
      if (AX.test(t.v) && !this.isVar(t.v)) {
        let name = t.v.toUpperCase();
        while (this.peek()?.t === 'tbl' && AX.test((this.peek() as { v: string }).v)) name += ' ' + (this.toks[this.p++] as { v: string }).v.toUpperCase();
        return { k: 'tbl', name };
      }
      return this.isVar(t.v) ? { k: 'var', name: t.v.toUpperCase() } : { k: 'tbl', name: t.v };
    }
    if (t.t === 'kw') {
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
      if (t.v === 'ASC' || t.v === 'DESC') return { k: 'tbl', name: t.v };
      if (this.isVar(t.v)) return { k: 'var', name: t.v };
      throw new DaxError(`Parola chiave inattesa: ${t.v}`);
    }
    if (t.t === 'id') {
      this.expect('(');
      const args: Node[] = [];
      while (!this.isOp(')')) {
        if (this.isOp(',')) { this.p++; args.push({ k: 'call', fn: 'BLANK', args: [] }); continue; } // omitted optional arg
        args.push(this.expr());
        if (this.isOp(',')) { this.p++; if (this.isOp(')')) args.push({ k: 'call', fn: 'BLANK', args: [] }); }
        else if (!this.isOp(')')) throw new DaxError(`Atteso "," o ")" negli argomenti di ${t.v}`);
      }
      this.p++;
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
      return { k: 'call', fn: t.v, args };
    }
    if (t.v === '(') { const e = this.expr(); this.expect(')'); return e; }
    if (t.v === '{') {
      // Table constructor: {1, 2} or {(1, "a"), (2, "b")}
      const rows: Node[][] = [];
      while (!this.isOp('}')) {
        if (this.isOp('(')) {
          this.p++;
          const row: Node[] = [this.expr()];
          while (this.isOp(',')) { this.p++; row.push(this.expr()); }
          this.expect(')');
          rows.push(row);
        } else rows.push([this.expr()]);
        if (this.isOp(',')) this.p++;
        else if (!this.isOp('}')) throw new DaxError('Atteso "," o "}" nel costruttore di tabella');
      }
      this.p++;
      return { k: 'list', rows };
    }
    throw new DaxError(`Simbolo inatteso: ${t.v}`);
  }

  done() { return this.p >= this.toks.length; }

  /** ( name [: type subtype mode] [= default], … ) => body */
  fnDef(): UdfDef {
    this.expect('(');
    const params: UdfParam[] = [];
    const REF = new Set(['ANYREF', 'COLUMNREF', 'MEASUREREF', 'TABLEREF', 'CALENDARREF']);
    const SUB = new Set(['VARIANT', 'INT64', 'DECIMAL', 'DOUBLE', 'STRING', 'DATETIME', 'BOOLEAN', 'NUMERIC']);
    while (!this.isOp(')')) {
      const t = this.toks[this.p++];
      if (!t || (t.t !== 'tbl' && t.t !== 'kw') || !/^[A-Za-z_]\w*$/.test(t.v)) throw new DaxError('Nome di parametro non valido');
      const p: UdfParam = { name: t.v.toUpperCase(), mode: 'val', type: 'any' };
      if (params.some((x) => x.name === p.name)) throw new DaxError(`Parametro duplicato: ${t.v}`);
      let explicit: string | undefined;
      if (this.isOp(':')) {
        this.p++;
        for (let h = this.peek(); h && (h.t === 'tbl' || h.t === 'kw'); h = this.peek()) {
          const w = h.v.toUpperCase();
          this.p++;
          if (w === 'VAL' || w === 'EXPR') explicit = w;
          else if (w === 'ANYVAL') p.type = 'any';
          else if (w === 'SCALAR') p.type = 'scalar';
          else if (w === 'TABLE') p.type = 'table';
          else if (REF.has(w)) p.type = 'ref';
          else if (SUB.has(w)) { p.type = 'scalar'; p.subtype = w; }
          else throw new DaxError(`Tipo di parametro sconosciuto: ${h.v}`);
        }
      }
      if (p.type === 'ref' && explicit === 'VAL') throw new DaxError(`Il parametro ${t.v} è un riferimento: VAL non è consentito`);
      p.mode = p.type === 'ref' || explicit === 'EXPR' ? 'expr' : 'val';
      if (this.isOp('=')) { this.p++; p.def = this.expr(); }
      params.push(p);
      if (this.isOp(',')) this.p++;
      else if (!this.isOp(')')) throw new DaxError('Atteso "," o ")" nei parametri della funzione');
    }
    this.p++;
    this.expect('=>');
    this.scopes.push(new Set(params.map((x) => x.name)));
    try { return { params, body: this.expr() }; } finally { this.scopes.pop(); }
  }
}

export function parse(src: string): Node {
  const ps = new Parser(lex(src), src);
  if (ps.done()) throw new DaxError('Espressione vuota');
  const e = ps.expr();
  if (!ps.done()) {
    const t = ps.peek();
    throw new DaxError(`Testo inatteso dopo la fine dell'espressione: "${'v' in t ? t.v : ''}"`);
  }
  return e;
}

/** Expression of a user-defined function: "( params ) => body". */
export function parseFunction(src: string): UdfDef {
  const ps = new Parser(lex(src), src);
  const f = ps.fnDef();
  if (!ps.done()) { const t = ps.peek(); throw new DaxError(`Testo inatteso dopo il corpo della funzione: "${'v' in t ? t.v : ''}"`); }
  return f;
}

/** `///` lines just above position `at` (UDF description). */
function docComment(src: string, at: number): string | undefined {
  const lines = src.slice(0, at).split('\n');
  lines.pop();
  const doc: string[] = [];
  while (lines.length && /^\s*\/\/\//.test(lines[lines.length - 1])) doc.unshift(lines.pop()!.replace(/^\s*\/\/\/\s?/, ''));
  return doc.length ? doc.join('\n') : undefined;
}

/** DAX query: [DEFINE (MEASURE t[m] = e | VAR v = e | TABLE t = e | COLUMN t[c] = e)*] (EVALUATE e [ORDER BY e [ASC|DESC], …])+ */
export function parseQuery(src: string): DaxQuery {
  const toks = lex(src);
  const ps = new Parser(toks, src);
  const q: DaxQuery = { defines: [], evaluates: [] };
  if (ps.isKw('DEFINE')) {
    ps.p++;
    while (ps.isKw('MEASURE') || ps.isKw('VAR') || ps.isKw('TABLE') || ps.isKw('COLUMN') || ps.isKw('FUNCTION')) {
      if (ps.isKw('FUNCTION')) {
        const at = ps.toks[ps.p++].s ?? 0;
        const t = ps.toks[ps.p++];
        if (!t || t.t !== 'tbl' || !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(t.v)) throw new DaxError('Sintassi: FUNCTION Nome = ( parametri ) => espressione');
        ps.expect('=');
        const start = ps.peek()?.s ?? 0;
        const fn = ps.fnDef();
        const text = src.slice(start, ps.toks[ps.p - 1].e).trim();
        q.defines.push({ kind: 'function', name: t.v, expr: fn.body, text, fn, description: docComment(src, at) });
        continue;
      }
      const kind = (ps.toks[ps.p++] as { v: string }).v.toLowerCase() as QueryDefine['kind'];
      const t = ps.toks[ps.p++];
      let table: string | undefined, name: string;
      if ((kind === 'measure' || kind === 'column') && t?.t === 'col') { table = t.table; name = t.v; }
      else if ((kind === 'var' || kind === 'table') && t && (t.t === 'tbl' || t.t === 'kw')) name = t.v;
      else throw new DaxError(kind === 'measure' ? "Sintassi: MEASURE 'Tabella'[Nome] = espressione" : `Nome non valido dopo ${kind.toUpperCase()}`);
      ps.expect('=');
      const start = ps.peek()?.s ?? 0;
      const expr = ps.expr();
      const text = src.slice(start, ps.toks[ps.p - 1].e).trim();
      if (kind === 'var') ps.scopes[0].add(name.toUpperCase());
      q.defines.push({ kind, table, name: kind === 'var' ? name.toUpperCase() : name, expr, text });
    }
  }
  while (ps.isKw('EVALUATE')) {
    ps.p++;
    const expr = ps.expr();
    const order: { expr: Node; desc: boolean }[] = [];
    if (ps.isKw('ORDER')) {
      ps.p++;
      ps.expectKw('BY');
      for (;;) {
        const e = ps.expr();
        let desc = false;
        if (ps.isKw('DESC')) { desc = true; ps.p++; } else if (ps.isKw('ASC')) ps.p++;
        order.push({ expr: e, desc });
        if (ps.isOp(',')) { ps.p++; continue; }
        break;
      }
    }
    q.evaluates.push({ expr, order });
  }
  if (!q.evaluates.length) throw new DaxError('La query deve contenere almeno un EVALUATE');
  if (!ps.done()) { const t = ps.peek(); throw new DaxError(`Testo inatteso: "${'v' in t ? t.v : ''}"`); }
  return q;
}
