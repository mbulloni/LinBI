// DAX editor with IntelliSense: suggestions for functions, tables ('…), columns and measures ([…),
// and the signature of the function being typed (current argument in bold).
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { DAX_FUNCTIONS, DAX_KEYWORDS, type DaxFn } from '../dax/functions';
import { daxLocal } from '../dax/separators';

interface Suggestion { label: string; kind: 'fn' | 'table' | 'column' | 'measure' | 'kw' | 'var'; insert: string; detail?: string; }
interface Ctx { from: number; to: number; items: Suggestion[]; }

const FN = new Map(DAX_FUNCTIONS.map((f) => [f.name, f]));
const tableRef = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/** Token being typed at `pos` and what fits there. */
function context(text: string, pos: number, model: { tables: { name: string; columns: { name: string }[] }[]; measures: { name: string; table: string }[] }, home: string): Ctx | null {
  const before = text.slice(0, pos);
  // Inside [ … : columns/measures (of the table written before the bracket, else measures + home table).
  const br = /(?:'((?:[^']|'')+)'|([A-Za-z_][\w]*))?\[([^\]\[]*)$/.exec(before);
  if (br) {
    const tname = (br[1] ?? br[2])?.replace(/''/g, "'");
    const prefix = br[3].toLowerCase();
    const t = tname ? model.tables.find((x) => x.name.toLowerCase() === tname.toLowerCase()) : undefined;
    const close = text[pos] === ']' ? '' : ']';
    const cols = (tt: typeof t) => (tt?.columns ?? []).map((c): Suggestion => ({ label: c.name, kind: 'column', insert: c.name + close, detail: tt!.name }));
    let items: Suggestion[];
    if (t) items = cols(t);
    else if (tname) return null;
    else {
      const homeT = model.tables.find((x) => x.name === home);
      items = [...model.measures.map((m): Suggestion => ({ label: m.name, kind: 'measure', insert: m.name + close, detail: m.table })), ...cols(homeT)];
    }
    items = items.filter((i) => i.label.toLowerCase().includes(prefix)).sort((a, b) => Number(!a.label.toLowerCase().startsWith(prefix)) - Number(!b.label.toLowerCase().startsWith(prefix)));
    return items.length ? { from: pos - br[3].length, to: pos, items } : null;
  }
  // Inside ' … : table names.
  // Only after an opening quote: an odd number of quotes outside "strings" before the caret.
  const quotes = before.replace(/"[^"]*"?/g, '').match(/'/g)?.length ?? 0;
  const q = quotes % 2 === 1 ? /'((?:[^']|'')*)$/.exec(before) : null;
  if (q && (before.slice(0, q.index).match(/"/g)?.length ?? 0) % 2 === 0) {
    const prefix = q[1].toLowerCase();
    const items = model.tables.filter((t) => t.name.toLowerCase().includes(prefix)).map((t): Suggestion => ({ label: t.name, kind: 'table', insert: `'${t.name.replace(/'/g, "''")}'` }));
    return items.length ? { from: q.index, to: pos, items } : null;
  }
  // A word: functions, tables, keywords (not inside a string literal).
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const w = /([A-Za-z_][\w.]*)$/.exec(before);
  if (!w || /[\w.]/.test(text[pos] ?? '')) return null;
  const prefix = w[1].toUpperCase();
  // Variables declared earlier in the expression (VAR name = …).
  const vars = [...new Set([...before.slice(0, pos - w[1].length).matchAll(/\bVAR\s+([A-Za-z_][\w]*)/gi)].map((m) => m[1]))];
  const items: Suggestion[] = [
    ...vars.filter((v) => v.toUpperCase().startsWith(prefix) && v.toUpperCase() !== prefix).map((v): Suggestion => ({ label: v, kind: 'var', insert: v, detail: 'variabile' })),
    ...DAX_FUNCTIONS.filter((f) => f.name.startsWith(prefix)).map((f): Suggestion => ({ label: f.name, kind: 'fn', insert: f.name + '(', detail: f.desc })),
    ...model.tables.filter((t) => t.name.toUpperCase().startsWith(prefix)).map((t): Suggestion => ({ label: t.name, kind: 'table', insert: tableRef(t.name) })),
    ...DAX_KEYWORDS.filter((k) => k.startsWith(prefix) && k !== prefix).map((k): Suggestion => ({ label: k, kind: 'kw', insert: k + ' ' })),
  ];
  if (items.length === 1 && items[0].label.toUpperCase() === prefix && items[0].kind !== 'fn') return null;
  return items.length ? { from: pos - w[1].length, to: pos, items: items.slice(0, 60) } : null;
}

/** Innermost function call around `pos` and the index of the argument being typed. */
function signatureAt(text: string, pos: number): { fn: DaxFn; arg: number } | null {
  let depth = 0, arg = 0, inStr = false;
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === ')' || c === ']') depth++;
    else if (c === '[' && depth > 0) depth--;
    else if (c === '(') {
      if (depth > 0) { depth--; continue; }
      const m = /([A-Za-z_][\w.]*)\s*$/.exec(text.slice(0, i));
      const fn = m && FN.get(m[1].toUpperCase());
      return fn ? { fn, arg } : null;
    } else if (c === (daxLocal() ? ';' : ',') && depth === 0) arg++;
  }
  return null;
}

/** Pixel position of the caret inside a textarea (mirror element). */
function caretXY(ta: HTMLTextAreaElement, pos: number) {
  const st = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'tabSize'] as const) (div.style as any)[p] = st[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: st.whiteSpace === 'pre' ? 'pre' : 'pre-wrap', wordWrap: 'break-word', width: ta.clientWidth + 'px', top: '0', left: '0' });
  div.textContent = ta.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '​';
  div.appendChild(mark);
  document.body.appendChild(div);
  const r = { x: mark.offsetLeft - ta.scrollLeft, y: mark.offsetTop - ta.scrollTop, h: parseFloat(st.lineHeight) || 18 };
  document.body.removeChild(div);
  return r;
}

export interface DaxInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Table whose columns bare [names] refer to. */
  home?: string;
  rows?: number;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called for keys the suggestion list does not consume. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void;
}

export const DaxInput = forwardRef<HTMLTextAreaElement | null, DaxInputProps>(function DaxInput({ value, onChange, home = '', rows, className, placeholder, autoFocus, onKeyDown, onScroll }, fwd) {
  const s = useStore();
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(fwd, () => ta.current as HTMLTextAreaElement);
  const [caret, setCaret] = useState<number | null>(null);
  const [sel, setSel] = useState(0);
  const [hidden, setHidden] = useState(false);
  const model = useMemo(() => ({ tables: s.tables, measures: s.report.measures }), [s.tables, s.report.measures]);
  const ctx = caret !== null && !hidden ? context(value, caret, model, home) : null;
  const sig = caret !== null ? signatureAt(value, caret) : null;
  const pos = caret !== null && ta.current && (ctx || sig) ? caretXY(ta.current, ctx ? ctx.from : caret) : null;

  const accept = (it: Suggestion) => {
    if (!ctx) return;
    const next = value.slice(0, ctx.from) + it.insert + value.slice(ctx.to);
    const at = ctx.from + it.insert.length;
    onChange(next);
    setSel(0);
    requestAnimationFrame(() => { ta.current?.setSelectionRange(at, at); setCaret(at); });
  };
  const track = () => { const el = ta.current; if (el) setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null); };

  return (
    <div className="dax-input">
      <textarea ref={ta} className={className} rows={rows} spellCheck={false} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setHidden(false); setSel(0); setCaret(e.target.selectionStart); }}
        onSelect={track} onClick={track} onScroll={(e) => { onScroll?.(e); if (caret !== null) setCaret(caret); }} onBlur={() => setTimeout(() => setCaret(null), 150)}
        onKeyDown={(e) => {
          if (ctx) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % ctx.items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + ctx.items.length) % ctx.items.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); accept(ctx.items[Math.min(sel, ctx.items.length - 1)]); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHidden(true); return; }
          }
          if (e.ctrlKey && e.key === ' ') { e.preventDefault(); setHidden(false); track(); return; }
          onKeyDown?.(e);
        }} />
      {pos && ta.current && ctx && (
        <div className="dax-suggest" style={{ left: ta.current.offsetLeft + pos.x, top: ta.current.offsetTop + pos.y + pos.h + 2 }}>
          {ctx.items.map((it, i) => (
            <div key={it.kind + it.label} className={'dax-sg' + (i === Math.min(sel, ctx.items.length - 1) ? ' active' : '')} onMouseDown={(e) => { e.preventDefault(); accept(it); }}
              ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: 'nearest' }); }}>
              <span className={'dax-sg-k ' + it.kind}>{it.kind === 'fn' ? 'ƒ' : it.kind === 'table' ? '▦' : it.kind === 'measure' ? '∑' : it.kind === 'column' ? '▤' : it.kind === 'var' ? 'x' : '·'}</span>
              <span className="dax-sg-l">{it.label}</span>
              {it.detail && it.kind !== 'fn' && <span className="dax-sg-d">{it.detail}</span>}
            </div>
          ))}
          {(() => { const it = ctx.items[Math.min(sel, ctx.items.length - 1)]; const f = it.kind === 'fn' ? FN.get(it.label) : undefined; return f ? <div className="dax-sg-doc"><b>{f.name}({f.params.join(daxLocal() ? '; ' : ', ')})</b><br />{f.desc}</div> : null; })()}
        </div>
      )}
      {pos && ta.current && !ctx && sig && (
        <div className="dax-sig" style={{ left: ta.current.offsetLeft + pos.x, top: ta.current.offsetTop + pos.y + pos.h + 2 }}>
          <span>{sig.fn.name}(</span>
          {sig.fn.params.map((p, i) => <span key={i}>{i ? (daxLocal() ? '; ' : ', ') : ''}{i === Math.min(sig.arg, sig.fn.params.length - 1) ? <b>{p}</b> : p}</span>)}
          <span>)</span>
          <div className="dax-sig-d">{sig.fn.desc}</div>
        </div>
      )}
    </div>
  );
});
