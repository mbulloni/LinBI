import type { Agg, ColumnMeta, FieldRef } from './types';

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL.*)$/i;
export const isNumeric = (c?: ColumnMeta) => !!c && NUMERIC.test(c.type);
export const isDate = (c?: ColumnMeta) => !!c && /^(DATE|TIMESTAMP.*|TIME)$/i.test(c.type);

export const AGG_LABEL: Record<Agg, string> = {
  sum: 'Somma', avg: 'Media', min: 'Minimo', max: 'Massimo',
  count: 'Conteggio', countd: 'Conteggio (distinto)', none: 'Non riepilogare', measure: 'Misura',
};

export const AGG_PREFIX: Record<Agg, string> = {
  sum: 'Somma di', avg: 'Media di', min: 'Minimo di', max: 'Massimo di',
  count: 'Conteggio di', countd: 'Conteggio di', none: '', measure: '',
};

export function fieldLabel(f: FieldRef): string {
  return f.agg === 'none' || f.agg === 'measure' ? f.column : `${AGG_PREFIX[f.agg]} ${f.column}`;
}

const nf = (d: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: 'always' });

/** Power BI "Auto" display units: K, Mln, Mld. */
export function fmtAuto(v: unknown, digits = 2): string {
  if (v === null || v === undefined || v === '') return '(Vuoto)';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const a = Math.abs(n);
  if (a >= 1e9) return nf(digits).format(n / 1e9) + ' Mld';
  if (a >= 1e6) return nf(digits).format(n / 1e6) + ' Mln';
  if (a >= 1e3) return nf(digits).format(n / 1e3) + ' K';
  return nf(digits).format(n);
}

/** Percentage for measures whose Power BI format string contains "%". */
export function fmtPct(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(Vuoto)';
  const n = Number(v);
  return Number.isFinite(n) ? nf(1).format(n * 100) + '%' : String(v);
}

/** Full number, used in tables and tooltips. */
export function fmtFull(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return nf(Number.isInteger(n) ? 0 : 2).format(n);
}

/** Power BI default theme palette. */
export const PALETTE = ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550',
  '#197278', '#1AAB40', '#15C6F4', '#4092FF', '#FFA058', '#BE5DC9', '#F472D0', '#B5A1FF'];

export const uid = () => Math.random().toString(36).slice(2, 10);
