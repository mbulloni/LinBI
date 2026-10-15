/**
 * Minimal DAX → SQL compiler for measures (a preview of phase 5).
 *
 * Supported: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, DISTINCTCOUNT, COUNTROWS,
 * DIVIDE, IF, BLANK, ISBLANK, ABS, ROUND, AND, OR, NOT, COALESCE, arithmetic, comparison, &,
 * references to other measures, and CALCULATE / FILTER(<table>, …) / KEEPFILTERS with
 * row-level conditions on the measure's own table. Anything else (ALL, RANKX, time
 * intelligence, iterators, …) is reported as unsupported rather than approximated.
 *
 * CALCULATE filters become aggregate FILTER (WHERE …) clauses: they intersect with the
 * visual's filter context instead of replacing filters on the same column.
 */
import type { Measure, TableMeta } from './types';
import { isNumeric } from './format';

export interface CompiledMeasure {
  table: string;            // base table the aggregation runs on
  cols: string[];           // columns of `table` the expression reads
  render: (colExprs: string[]) => string;
}

class DaxError extends Error {}

/* ---------------------------------- lexer --------------------------------- */

type Tok =
  | { t: 'num'; v: string } | { t: 'str'; v: string } | { t: 'op'; v: string }
  | { t: 'col'; table?: string; v: string } | { t: 'id'; v: string } | { t: 'tbl'; v: string };

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
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if ((c === '/' && src[i + 1] === '/') || (c === '-' && src[i + 1] === '-')) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[1] }); i += m[1].length; continue;
    }
    if (c === '"') {
      let s = ''; i++;
      while (i < src.length) { if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; } s += src[i++]; }
      out.push({ t: 'str', v: s }); continue;
    }
    if (c === "'") {
      let s = ''; i++;
      while (i < src.length) { if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; } s += src[i++]; }
      if (src[i] === '[') { out.push({ t: 'col', table: s, v: bracket() }); level(); } else out.push({ t: 'tbl', v: s });
      continue;
    }
    if (c === '[') { out.push({ t: 'col', v: bracket() }); level(); continue; }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w.]*/.exec(src.slice(i))!;
      i += m[0].length;
      if (src[i] === '[') { out.push({ t: 'col', table: m[0], v: bracket() }); level(); }
      else if (peekNonWs(i) === '(' || /^(TRUE|FALSE|IN|NOT)$/i.test(m[0])) out.push({ t: 'id', v: m[0].toUpperCase() });
      else out.push({ t: 'tbl', v: m[0] });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '<=', '>=', '<>', '=='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/&=<>(),{}'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new DaxError(`Carattere non valido: ${c}`);
  }
  return out;
}

/* --------------------------------- parser --------------------------------- */

type Node =
  | { k: 'num'; v: string } | { k: 'str'; v: string } | { k: 'bool'; v: boolean }
  | { k: 'col'; table?: string; col: string } | { k: 'tbl'; name: string }
  | { k: 'call'; fn: string; args: Node[] } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node } | { k: 'list'; items: Node[] };

function parse(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as any).v === v;
  const isId = (v: string) => peek()?.t === 'id' && (peek() as any).v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new DaxError(`Atteso "${v}"`); p++; };

  const levels: string[][] = [['||'], ['&&'], ['=', '==', '<>', '<', '>', '<=', '>='], ['&'], ['+', '-'], ['*', '/']];
  const bin = (lvl: number): Node => {
    if (lvl === levels.length) return unary();
    let a = bin(lvl + 1);
    for (;;) {
      if (lvl === 2 && isId('IN')) { p++; a = { k: 'bin', op: 'IN', a, b: unary() }; continue; }
      const t = peek();
      if (t?.t === 'op' && levels[lvl].includes(t.v)) { p++; a = { k: 'bin', op: t.v, a, b: bin(lvl + 1) }; } else return a;
    }
  };
  const unary = (): Node => {
    if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    if (isId('NOT') && toks[p + 1]?.t !== 'op') { p++; return { k: 'call', fn: 'NOT', args: [unary()] }; }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new DaxError('Espressione incompleta');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'col') return { k: 'col', table: t.table, col: t.v };
    if (t.t === 'tbl') return { k: 'tbl', name: t.v };
    if (t.t === 'id') {
      if (t.v === 'TRUE' || t.v === 'FALSE') { if (isOp('(')) { p++; expect(')'); } return { k: 'bool', v: t.v === 'TRUE' }; }
      expect('(');
      const args: Node[] = [];
      while (!isOp(')')) {
        if (isOp(',')) { p++; args.push({ k: 'call', fn: 'BLANK', args: [] }); continue; } // omitted optional arg
        args.push(bin(0));
        if (isOp(',')) p++;
      }
      p++;
      return { k: 'call', fn: t.v, args };
    }
    if (t.v === '(') { const e = bin(0); expect(')'); return e; }
    if (t.v === '{') {
      const items: Node[] = [];
      while (!isOp('}')) { items.push(bin(0)); if (isOp(',')) p++; }
      p++;
      return { k: 'list', items };
    }
    throw new DaxError(`Simbolo inatteso: ${t.v}`);
  };
  const e = bin(0);
  if (p < toks.length) throw new DaxError('Testo inatteso dopo la fine dell\'espressione');
  return e;
}

/* -------------------------------- compiler -------------------------------- */

const sqlStr = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const CMP: Record<string, string> = { '=': '=', '==': '=', '<>': '<>', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };

interface Ctx {
  measures: Measure[];
  tables: TableMeta[];
  home: string;
  cols: { table: string; col: string }[];
  baseTables: Set<string>;
  conds: string[];
  stack: string[];
}

const findMeasure = (ctx: Ctx, name: string) => ctx.measures.find((m) => m.name.toLowerCase() === name.toLowerCase());

function colRef(ctx: Ctx, table: string, col: string): string {
  const t = ctx.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
  const c = t?.columns.find((x) => x.name.toLowerCase() === col.toLowerCase());
  if (!t || !c) throw new DaxError(`Colonna non trovata: '${table}'[${col}]`);
  ctx.baseTables.add(t.name);
  let i = ctx.cols.findIndex((x) => x.table === t.name && x.col === c.name);
  if (i < 0) { ctx.cols.push({ table: t.name, col: c.name }); i = ctx.cols.length - 1; }
  return `\u0000${i}\u0000`;
}

function colMeta(ctx: Ctx, table: string, col: string) {
  return ctx.tables.find((x) => x.name.toLowerCase() === table.toLowerCase())?.columns.find((x) => x.name.toLowerCase() === col.toLowerCase());
}

/** Row-level expression (inside CALCULATE/FILTER conditions). `table` resolves bare [Column]. */
function row(ctx: Ctx, n: Node, table: string): string {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return sqlStr(n.v);
    case 'bool': return n.v ? 'TRUE' : 'FALSE';
    case 'col': return colRef(ctx, n.table ?? table, n.col);
    case 'neg': return `(-${row(ctx, n.a, table)})`;
    case 'bin': {
      if (n.op === 'IN') {
        if (n.b.k !== 'list') throw new DaxError('IN richiede un elenco {…}');
        return `(${row(ctx, n.a, table)} IN (${n.b.items.map((x) => row(ctx, x, table)).join(', ')}))`;
      }
      const a = row(ctx, n.a, table), b = row(ctx, n.b, table);
      if (n.op === '&&') return `(${a} AND ${b})`;
      if (n.op === '||') return `(${a} OR ${b})`;
      if (n.op === '&') return `CONCAT(${a}, ${b})`;
      if (CMP[n.op]) return `(${a} ${CMP[n.op]} ${b})`;
      return `(${a} ${n.op} ${b})`;
    }
    case 'call': {
      const args = n.args;
      if (n.fn === 'NOT') return `(NOT ${row(ctx, args[0], table)})`;
      if (n.fn === 'AND') return `(${row(ctx, args[0], table)} AND ${row(ctx, args[1], table)})`;
      if (n.fn === 'OR') return `(${row(ctx, args[0], table)} OR ${row(ctx, args[1], table)})`;
      if (n.fn === 'BLANK') return 'NULL';
      if (n.fn === 'ISBLANK') return `(${row(ctx, args[0], table)} IS NULL)`;
      if (n.fn === 'KEEPFILTERS') return row(ctx, args[0], table);
      throw new DaxError(`Funzione non supportata in un filtro: ${n.fn}`);
    }
    default: throw new DaxError('Espressione di filtro non supportata');
  }
}

/** A CALCULATE filter argument → SQL condition. */
function filterArg(ctx: Ctx, n: Node): string {
  if (n.k === 'call' && n.fn === 'FILTER') {
    const [src, cond] = n.args;
    if (src?.k === 'tbl') return row(ctx, cond, src.name);
    if (src?.k === 'call') throw new DaxError(`${src.fn} dentro FILTER non è ancora supportata (fase 5)`);
    throw new DaxError('Primo argomento di FILTER non supportato');
  }
  if (n.k === 'call' && n.fn === 'KEEPFILTERS') return filterArg(ctx, n.args[0]);
  if (n.k === 'call' && ['ALL', 'ALLEXCEPT', 'ALLSELECTED', 'REMOVEFILTERS', 'USERELATIONSHIP', 'CROSSFILTER', 'VALUES'].includes(n.fn)) {
    throw new DaxError(`${n.fn} non è ancora supportata (fase 5)`);
  }
  return row(ctx, n, ctx.home);
}

function agg(ctx: Ctx, fn: string, arg: Node | undefined): string {
  if (!arg || arg.k !== 'col') throw new DaxError(`${fn} richiede una colonna`);
  const table = arg.table ?? ctx.home;
  const c = colRef(ctx, table, arg.col);
  const num = isNumeric(colMeta(ctx, table, arg.col));
  const filt = ctx.conds.length ? ` FILTER (WHERE ${ctx.conds.join(' AND ')})` : '';
  switch (fn) {
    case 'SUM': return `CAST(SUM(${c})${filt} AS DOUBLE)`;
    case 'AVERAGE': return `CAST(AVG(${c})${filt} AS DOUBLE)`;
    case 'MIN': return num ? `CAST(MIN(${c})${filt} AS DOUBLE)` : `MIN(${c})${filt}`;
    case 'MAX': return num ? `CAST(MAX(${c})${filt} AS DOUBLE)` : `MAX(${c})${filt}`;
    case 'COUNT': case 'COUNTA': return `CAST(COUNT(${c})${filt} AS DOUBLE)`;
    case 'COUNTBLANK': return `CAST(COUNT(*) FILTER (WHERE ${[`${c} IS NULL`, ...ctx.conds].join(' AND ')}) AS DOUBLE)`;
    case 'DISTINCTCOUNT': return `CAST(COUNT(DISTINCT ${c})${filt} AS DOUBLE)`;
  }
  throw new DaxError(fn);
}

function scalar(ctx: Ctx, n: Node): string {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return sqlStr(n.v);
    case 'bool': return n.v ? 'TRUE' : 'FALSE';
    case 'col': {
      const m = findMeasure(ctx, n.col);
      if (m) return measureRef(ctx, m);
      throw new DaxError(`La colonna [${n.col}] non può essere usata fuori da un'aggregazione`);
    }
    case 'tbl': throw new DaxError(`Tabella ${n.name} usata come valore`);
    case 'list': throw new DaxError('Elenco {…} non supportato qui');
    case 'neg': return `(-${scalar(ctx, n.a)})`;
    case 'bin': {
      const a = scalar(ctx, n.a), b = scalar(ctx, n.b);
      switch (n.op) {
        case '+': case '-': return `(COALESCE(${a}, 0) ${n.op} COALESCE(${b}, 0))`;
        case '*': return `(${a} * ${b})`;
        case '/': return `(${a} / NULLIF(${b}, 0))`;
        case '&': return `CONCAT(${a}, ${b})`;
        case '&&': return `(${a} AND ${b})`;
        case '||': return `(${a} OR ${b})`;
        default: if (CMP[n.op]) return `(${a} ${CMP[n.op]} ${b})`;
      }
      throw new DaxError(`Operatore non supportato: ${n.op}`);
    }
    case 'call': {
      const A = n.args;
      switch (n.fn) {
        case 'SUM': case 'AVERAGE': case 'COUNT': case 'COUNTA': case 'COUNTBLANK': case 'DISTINCTCOUNT':
          return agg(ctx, n.fn, A[0]);
        case 'MIN': case 'MAX':
          if (A.length === 2) return `${n.fn === 'MIN' ? 'LEAST' : 'GREATEST'}(${scalar(ctx, A[0])}, ${scalar(ctx, A[1])})`;
          return agg(ctx, n.fn, A[0]);
        case 'COUNTROWS': {
          const t = A[0];
          let conds = ctx.conds;
          let table: string;
          if (t?.k === 'tbl') table = t.name;
          else if (t?.k === 'call' && t.fn === 'FILTER' && t.args[0]?.k === 'tbl') { table = t.args[0].name; conds = [...conds, row(ctx, t.args[1], table)]; }
          else throw new DaxError('COUNTROWS: argomento non supportato');
          const real = ctx.tables.find((x) => x.name.toLowerCase() === table.toLowerCase());
          if (!real) throw new DaxError(`Tabella non trovata: ${table}`);
          ctx.baseTables.add(real.name);
          return `CAST(COUNT(*)${conds.length ? ` FILTER (WHERE ${conds.join(' AND ')})` : ''} AS DOUBLE)`;
        }
        case 'DIVIDE': {
          const a = scalar(ctx, A[0]), b = scalar(ctx, A[1]);
          const alt = A[2] && !(A[2].k === 'call' && A[2].fn === 'BLANK') ? scalar(ctx, A[2]) : 'NULL';
          return `(CASE WHEN ${b} IS NULL OR ${b} = 0 THEN ${alt} ELSE ${a} / ${b} END)`;
        }
        case 'IF': return `(CASE WHEN ${scalar(ctx, A[0])} THEN ${scalar(ctx, A[1])} ELSE ${A[2] ? scalar(ctx, A[2]) : 'NULL'} END)`;
        case 'BLANK': return 'NULL';
        case 'ISBLANK': return `(${scalar(ctx, A[0])} IS NULL)`;
        case 'ABS': return `ABS(${scalar(ctx, A[0])})`;
        case 'ROUND': return `ROUND(${scalar(ctx, A[0])}, ${A[1] ? scalar(ctx, A[1]) : '0'})`;
        case 'AND': return `(${scalar(ctx, A[0])} AND ${scalar(ctx, A[1])})`;
        case 'OR': return `(${scalar(ctx, A[0])} OR ${scalar(ctx, A[1])})`;
        case 'NOT': return `(NOT ${scalar(ctx, A[0])})`;
        case 'CONCATENATE': return `CONCAT(${scalar(ctx, A[0])}, ${scalar(ctx, A[1])})`;
        case 'COALESCE': return `COALESCE(${A.map((x) => scalar(ctx, x)).join(', ')})`;
        case 'CALCULATE': {
          if (!A[0]) throw new DaxError('CALCULATE senza espressione');
          const saved = ctx.conds;
          ctx.conds = [...saved, ...A.slice(1).map((f) => filterArg(ctx, f))];
          try { return scalar(ctx, A[0]); } finally { ctx.conds = saved; }
        }
      }
      throw new DaxError(`Funzione DAX non ancora supportata: ${n.fn} (fase 5)`);
    }
  }
}

function measureRef(ctx: Ctx, m: Measure): string {
  if (ctx.stack.includes(m.name)) throw new DaxError(`Riferimento circolare: ${[...ctx.stack, m.name].join(' → ')}`);
  ctx.stack.push(m.name);
  const savedHome = ctx.home;
  ctx.home = m.table;
  try { return `(${scalar(ctx, parse(m.expression))})`; }
  catch (e) { if (e instanceof DaxError && ctx.stack.length > 1 && !e.message.includes('[')) throw new DaxError(`[${m.name}]: ${e.message}`); throw e; }
  finally { ctx.home = savedHome; ctx.stack.pop(); }
}

export function compileMeasure(name: string, home: string, measures: Measure[], tables: TableMeta[]): CompiledMeasure | { error: string } {
  const m = measures.find((x) => x.name === name && x.table === home) ?? measures.find((x) => x.name === name);
  if (!m) return { error: `Misura non trovata: [${name}]` };
  const ctx: Ctx = { measures, tables, home: m.table, cols: [], baseTables: new Set(), conds: [], stack: [] };
  try {
    const tpl = measureRef(ctx, m);
    const bases = [...ctx.baseTables];
    if (bases.length > 1) throw new DaxError(`la misura usa più tabelle (${bases.join(', ')}): non ancora supportato`);
    const table = bases[0] ?? (tables.some((t) => t.name === m.table) ? m.table : tables[0]?.name ?? m.table);
    return {
      table,
      cols: ctx.cols.map((c) => c.col),
      render: (exprs) => tpl.replace(/\u0000(\d+)\u0000/g, (_s, i) => exprs[+i]),
    };
  } catch (e) {
    return { error: `Misura [${m.name}]: ${(e as Error).message}` };
  }
}
