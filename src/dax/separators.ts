import { globalOptions } from '../options';

/**
 * DAX separators (Opzioni › Impostazioni internazionali): standard = "," between arguments and "." in numbers;
 * local (Italian) = ";" and ",". Conversions map one character to one character, so caret positions are kept.
 * Text inside "strings", 'table names', [columns] and comments is left alone.
 */
function mapChars(text: string, fn: (ch: string, prev: string, next: string) => string): string {
  let out = '', i = 0;
  while (i < text.length) {
    const ch = text[i];
    const close = ch === '"' ? '"' : ch === "'" ? "'" : ch === '[' ? ']' : null;
    if (close) {
      let j = i + 1;
      while (j < text.length) { if (text[j] === close) { if (close !== ']' && text[j + 1] === close) { j += 2; continue; } break; } j++; }
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if ((ch === '/' && text[i + 1] === '/') || (ch === '-' && text[i + 1] === '-')) { const j = text.indexOf('\n', i); const e = j < 0 ? text.length : j; out += text.slice(i, e); i = e; continue; }
    if (ch === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); const e = j < 0 ? text.length : j + 2; out += text.slice(i, e); i = e; continue; }
    out += fn(ch, text[i - 1] ?? '', text[i + 1] ?? '');
    i++;
  }
  return out;
}

const digit = (c: string) => c >= '0' && c <= '9';

/** Standard → local: "," → ";", decimal "." → ",". */
export function toLocal(text: string): string {
  return mapChars(text, (c, p, n) => (c === ',' ? ';' : c === '.' && digit(p) && digit(n) ? ',' : c));
}

/** Local → standard: decimal "," → ".", ";" → ",". */
export function toStandard(text: string): string {
  return mapChars(text, (c) => (c === ',' ? '.' : c === ';' ? ',' : c));
}

export const daxLocal = () => globalOptions().daxLocalSeparators === true;
/** Text shown in DAX editors from stored (standard) DAX, and back. */
export const daxShow = (t: string) => (daxLocal() ? toLocal(t) : t);
export const daxStore = (t: string) => (daxLocal() ? toStandard(t) : t);
