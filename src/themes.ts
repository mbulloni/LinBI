/** Report themes: Power BI theme JSON subset (name, dataColors, background, foreground, tableAccent). */
import type { Theme } from './types';
import { PALETTE } from './format';

const DEFAULT_COLORS = [...PALETTE];

export const THEMES: Theme[] = [
  { name: 'Predefinito', dataColors: DEFAULT_COLORS },
  { name: 'Classico', dataColors: ['#01B8AA', '#374649', '#FD625E', '#F2C80F', '#5F6B6D', '#8AD4EB', '#FE9666', '#A66999', '#3599B8', '#DFBFBF'] },
  { name: 'Innovazione', dataColors: ['#E8D166', '#E12F21', '#D88445', '#8E56C2', '#4B4BB0', '#48A6C8', '#53BF9B', '#A6BC5A', '#C93F7C', '#7A7A7A'], background: '#FCFCFC' },
  { name: 'Frontiera', dataColors: ['#936846', '#4A6971', '#A9C7BD', '#C5A572', '#7F2B26', '#C27B7B', '#6A6A9E', '#9DB5B6', '#BB8C5D', '#565656'] },
  { name: 'Tramonto', dataColors: ['#B3456E', '#E05C74', '#F88E73', '#F3BD7E', '#C1D592', '#8BC6A6', '#55A7AB', '#428593', '#8D5584', '#D07A8F'] },
  { name: 'Elettrico', dataColors: ['#D4B60A', '#3BBFC7', '#F29F05', '#F2385A', '#7D57C2', '#51BD69', '#2D6FE0', '#E14FA0', '#8C8C8C', '#24A3A3'] },
  { name: 'Tempesta', dataColors: ['#26457D', '#4D7CB5', '#7BA7D6', '#A4C8EA', '#5F6A75', '#8E99A4', '#C0C7CE', '#3F8FA3', '#68B5BF', '#B4DCE0'], background: '#F7F9FC' },
  { name: 'Sicuro per daltonici', dataColors: ['#074650', '#009292', '#FE6DB6', '#FEB5DA', '#480091', '#B66DFF', '#B5DAFE', '#6DB6FF', '#914800', '#23FD23'] },
];

/** Values the renderers read (charts, visual and page backgrounds). */
export const THEME = { background: '#FFFFFF' };

/** Applies a theme to the shared palette (mutated in place: chart code imports PALETTE). */
export function applyTheme(t?: Theme) {
  const colors = t?.dataColors?.length ? t.dataColors : DEFAULT_COLORS;
  PALETTE.splice(0, PALETTE.length, ...Array.from({ length: Math.max(16, colors.length) }, (_, i) => colors[i % colors.length]));
  THEME.background = t?.background ?? '#FFFFFF';
}

/** Validates an imported Power BI theme file. */
export function parseTheme(json: string, fallbackName: string): Theme {
  const j = JSON.parse(json);
  const hex = (x: unknown) => typeof x === 'string' && /^#[0-9a-f]{3,8}$/i.test(x);
  const dataColors = Array.isArray(j.dataColors) ? j.dataColors.filter(hex) : [];
  if (!dataColors.length) throw new Error('il file non contiene "dataColors"');
  return {
    name: typeof j.name === 'string' && j.name ? j.name : fallbackName,
    dataColors,
    ...(hex(j.background) ? { background: j.background } : {}),
    ...(hex(j.foreground) ? { foreground: j.foreground } : {}),
    ...(hex(j.tableAccent) ? { tableAccent: j.tableAccent } : {}),
  };
}

/** Power BI theme JSON for export / .pbit custom theme. */
export const themeJson = (t: Theme) => JSON.stringify({ name: t.name, dataColors: t.dataColors, ...(t.background ? { background: t.background } : {}), ...(t.foreground ? { foreground: t.foreground } : {}), ...(t.tableAccent ? { tableAccent: t.tableAccent } : {}) }, null, 2);
