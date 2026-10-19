import type { VisualType } from '../types';

export interface Well {
  key: string;
  label: string;
  measure: boolean; // values are aggregated by default
  max?: number;
}

export interface VisualDef {
  type: VisualType;
  name: string;
  wells: Well[];
  /** well that drives the category axis / cross-filter */
  category?: string;
}

const axisX = (measure: boolean): Well => ({ key: measure ? 'values' : 'category', label: 'Asse X', measure, ...(measure ? {} : { max: 1 }) });
const axisY = (measure: boolean): Well => ({ key: measure ? 'values' : 'category', label: 'Asse Y', measure, ...(measure ? {} : { max: 1 }) });
const legend: Well = { key: 'legend', label: 'Legenda', measure: false, max: 1 };

const columnLike = (type: VisualType, name: string): VisualDef => ({ type, name, wells: [axisX(false), axisY(true), legend], category: 'category' });
const combo = (type: VisualType, name: string): VisualDef => ({
  type, name, category: 'category',
  wells: [{ key: 'category', label: 'Asse X', measure: false, max: 1 }, { key: 'values', label: 'Asse Y colonne', measure: true },
    { key: 'lineValues', label: 'Asse Y linee', measure: true }, { key: 'legend', label: 'Legenda colonne', measure: false, max: 1 }],
});
const barLike = (type: VisualType, name: string): VisualDef => ({ type, name, wells: [axisY(false), axisX(true), legend], category: 'category' });

export const VISUALS: VisualDef[] = [
  barLike('stackedBar', 'Grafico a barre in pila'),
  columnLike('stackedColumn', 'Istogramma in pila'),
  barLike('clusteredBar', 'Grafico a barre raggruppate'),
  columnLike('clusteredColumn', 'Istogramma raggruppato'),
  barLike('stackedBar100', 'Grafico a barre in pila 100%'),
  columnLike('stackedColumn100', 'Istogramma in pila 100%'),
  columnLike('line', 'Grafico a linee'),
  columnLike('area', 'Grafico ad area'),
  columnLike('stackedArea', 'Grafico ad area in pila'),
  combo('lineStackedColumn', 'Grafico a linee e istogramma in pila'),
  combo('lineClusteredColumn', 'Grafico a linee e istogramma raggruppato'),
  columnLike('ribbon', 'Grafico a nastro'),
  { type: 'waterfall', name: 'Grafico a cascata', category: 'category', wells: [{ key: 'category', label: 'Categoria', measure: false, max: 1 }, { key: 'values', label: 'Asse Y', measure: true, max: 1 }] },
  {
    type: 'scatter', name: 'Grafico a dispersione', category: 'details',
    wells: [{ key: 'details', label: 'Valori', measure: false, max: 1 }, { key: 'x', label: 'Asse X', measure: true, max: 1 },
      { key: 'y', label: 'Asse Y', measure: true, max: 1 }, { key: 'legend', label: 'Legenda', measure: false, max: 1 }],
  },
  { type: 'pie', name: 'Grafico a torta', category: 'category', wells: [{ key: 'category', label: 'Legenda', measure: false, max: 1 }, { key: 'values', label: 'Valori', measure: true, max: 1 }] },
  { type: 'donut', name: 'Grafico ad anello', category: 'category', wells: [{ key: 'category', label: 'Legenda', measure: false, max: 1 }, { key: 'values', label: 'Valori', measure: true, max: 1 }] },
  { type: 'treemap', name: 'Mappa ad albero', category: 'category', wells: [{ key: 'category', label: 'Categoria', measure: false, max: 1 }, { key: 'values', label: 'Valori', measure: true, max: 1 }] },
  { type: 'funnel', name: 'Imbuto', category: 'category', wells: [{ key: 'category', label: 'Categoria', measure: false, max: 1 }, { key: 'values', label: 'Valori', measure: true, max: 1 }] },
  { type: 'gauge', name: 'Misuratore', wells: [{ key: 'values', label: 'Valore', measure: true, max: 1 }, { key: 'target', label: 'Valore di destinazione', measure: true, max: 1 }] },
  { type: 'card', name: 'Scheda', wells: [{ key: 'values', label: 'Campi', measure: true, max: 1 }] },
  { type: 'multiRowCard', name: 'Scheda con più righe', wells: [{ key: 'values', label: 'Campi', measure: false }] },
  {
    type: 'kpi', name: 'KPI',
    wells: [{ key: 'values', label: 'Valore', measure: true, max: 1 }, { key: 'trend', label: 'Asse delle tendenze', measure: false, max: 1 },
      { key: 'target', label: 'Obiettivi', measure: true, max: 1 }],
  },
  { type: 'slicer', name: 'Filtro dei dati', category: 'category', wells: [{ key: 'category', label: 'Campo', measure: false, max: 1 }] },
  { type: 'table', name: 'Tabella', wells: [{ key: 'columns', label: 'Colonne', measure: false }] },
  {
    type: 'matrix', name: 'Matrice', category: 'rows',
    wells: [{ key: 'rows', label: 'Righe', measure: false }, { key: 'columns', label: 'Colonne', measure: false, max: 1 }, { key: 'values', label: 'Valori', measure: true }],
  },
];

const OTHER: Partial<Record<VisualType, string>> = { textbox: 'Casella di testo', image: 'Immagine', button: 'Pulsante', shape: 'Forma', unsupported: 'Oggetto visivo non supportato' };

export const visualDef = (t: VisualType): VisualDef =>
  VISUALS.find((v) => v.type === t) ?? { type: t, name: OTHER[t] ?? t, wells: [] };

export const isChart = (t: VisualType) => !['card', 'multiRowCard', 'kpi', 'button', 'shape', 'table', 'matrix', 'slicer', 'textbox', 'image', 'unsupported'].includes(t);
