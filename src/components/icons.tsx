import type { ReactNode } from 'react';
import type { VisualType } from '../types';

const B = '#118DFF', D = '#12239E', O = '#E66C37', G = '#605E5C', K = '#252423';

/** Visualization icons, 20x20, in the spirit of the Power BI gallery. */
const VIS: Record<VisualType, ReactNode> = {
  stackedBar: <><rect x="2" y="3" width="8" height="3" fill={B} /><rect x="10" y="3" width="5" height="3" fill={D} /><rect x="2" y="8.5" width="5" height="3" fill={B} /><rect x="7" y="8.5" width="4" height="3" fill={D} /><rect x="2" y="14" width="10" height="3" fill={B} /><rect x="12" y="14" width="5" height="3" fill={D} /></>,
  stackedColumn: <><rect x="3" y="9" width="3" height="9" fill={B} /><rect x="3" y="5" width="3" height="4" fill={D} /><rect x="8.5" y="11" width="3" height="7" fill={B} /><rect x="8.5" y="7" width="3" height="4" fill={D} /><rect x="14" y="6" width="3" height="12" fill={B} /><rect x="14" y="2" width="3" height="4" fill={D} /></>,
  clusteredBar: <><rect x="2" y="2" width="12" height="2.5" fill={B} /><rect x="2" y="4.5" width="8" height="2.5" fill={D} /><rect x="2" y="9" width="15" height="2.5" fill={B} /><rect x="2" y="11.5" width="10" height="2.5" fill={D} /><rect x="2" y="16" width="6" height="2.5" fill={B} /></>,
  clusteredColumn: <><rect x="2" y="7" width="2.5" height="11" fill={B} /><rect x="4.5" y="10" width="2.5" height="8" fill={D} /><rect x="9" y="3" width="2.5" height="15" fill={B} /><rect x="11.5" y="8" width="2.5" height="10" fill={D} /><rect x="16" y="12" width="2.5" height="6" fill={B} /></>,
  stackedBar100: <><rect x="2" y="3" width="10" height="3" fill={B} /><rect x="12" y="3" width="6" height="3" fill={D} /><rect x="2" y="8.5" width="6" height="3" fill={B} /><rect x="8" y="8.5" width="10" height="3" fill={D} /><rect x="2" y="14" width="13" height="3" fill={B} /><rect x="15" y="14" width="3" height="3" fill={D} /></>,
  stackedColumn100: <><rect x="3" y="8" width="3" height="10" fill={B} /><rect x="3" y="2" width="3" height="6" fill={D} /><rect x="8.5" y="12" width="3" height="6" fill={B} /><rect x="8.5" y="2" width="3" height="10" fill={D} /><rect x="14" y="5" width="3" height="13" fill={B} /><rect x="14" y="2" width="3" height="3" fill={D} /></>,
  line: <><path d="M2 15 L7 9 L11 12 L18 4" stroke={B} strokeWidth="2" fill="none" /><path d="M2 18 H18" stroke={G} /></>,
  area: <><path d="M2 18 V13 L7 8 L11 11 L18 4 V18 Z" fill={B} opacity=".55" /><path d="M2 13 L7 8 L11 11 L18 4" stroke={B} strokeWidth="1.5" fill="none" /></>,
  stackedArea: <><path d="M2 18 V10 L7 6 L11 8 L18 3 V18 Z" fill={D} opacity=".7" /><path d="M2 18 V14 L7 11 L11 13 L18 9 V18 Z" fill={B} /></>,
  scatter: <><circle cx="5" cy="14" r="1.8" fill={B} /><circle cx="9" cy="9" r="1.8" fill={D} /><circle cx="13" cy="12" r="1.8" fill={B} /><circle cx="15" cy="5" r="1.8" fill={O} /><path d="M2 2 V18 H18" stroke={G} fill="none" /></>,
  pie: <><circle cx="10" cy="10" r="8" fill={B} /><path d="M10 10 V2 A8 8 0 0 1 17.6 12.5 Z" fill={D} /><path d="M10 10 L17.6 12.5 A8 8 0 0 1 9 18 Z" fill={O} /></>,
  donut: <><circle cx="10" cy="10" r="6" fill="none" stroke={B} strokeWidth="4" /><path d="M10 4 A6 6 0 0 1 15.7 11.9" stroke={D} strokeWidth="4" fill="none" /></>,
  treemap: <><rect x="2" y="2" width="9" height="16" fill={B} /><rect x="12" y="2" width="6" height="9" fill={D} /><rect x="12" y="12" width="6" height="6" fill={O} /></>,
  funnel: <><rect x="2" y="2" width="16" height="3.5" fill={B} /><rect x="4" y="6.5" width="12" height="3.5" fill={B} /><rect x="6" y="11" width="8" height="3.5" fill={B} /><rect x="8" y="15.5" width="4" height="3" fill={B} /></>,
  gauge: <><path d="M3 15 A7 7 0 0 1 17 15" stroke="#C8C6C4" strokeWidth="4" fill="none" /><path d="M3 15 A7 7 0 0 1 12.5 8.4" stroke={B} strokeWidth="4" fill="none" /></>,
  card: <><rect x="2" y="4" width="16" height="12" rx="1" fill="none" stroke={G} /><text x="10" y="13" fontSize="7" textAnchor="middle" fill={K} fontWeight="700">123</text></>,
  table: <><rect x="2" y="3" width="16" height="14" fill="none" stroke={G} /><rect x="2" y="3" width="16" height="3.5" fill={B} /><path d="M2 10 H18 M2 13.5 H18 M8 6.5 V17 M13 6.5 V17" stroke={G} strokeWidth=".8" /></>,
  matrix: <><rect x="2" y="3" width="16" height="14" fill="none" stroke={G} /><rect x="2" y="3" width="16" height="3.5" fill={B} /><rect x="2" y="3" width="5" height="14" fill={B} opacity=".45" /><path d="M2 10 H18 M2 13.5 H18 M7 3 V17 M12.5 6.5 V17" stroke={G} strokeWidth=".8" /></>,
  slicer: <><path d="M3 4 H17 L12 10 V16 L8 18 V10 Z" fill="none" stroke={G} strokeWidth="1.3" /><rect x="3" y="4" width="14" height="1.5" fill={B} /></>,
  textbox: <><rect x="2" y="3" width="16" height="14" fill="none" stroke={G} /><text x="10" y="14" fontSize="9" textAnchor="middle" fill={K} fontWeight="700">A</text></>,
  image: <><rect x="2" y="3" width="16" height="14" fill="none" stroke={G} /><circle cx="7" cy="8" r="1.8" fill={O} /><path d="M3 16 L8 11 L11 14 L14 10 L18 15 V16 Z" fill={B} /></>,
  unsupported: <><rect x="2" y="3" width="16" height="14" fill="none" stroke={G} strokeDasharray="2 2" /><text x="10" y="14" fontSize="9" textAnchor="middle" fill={G} fontWeight="700">?</text></>,
};

export function VisualIcon({ type, size = 20 }: { type: VisualType; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20">{VIS[type]}</svg>;
}

const P = (d: string, c = K, w = 1.2) => <path d={d} stroke={c} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;

/** UI glyphs (ribbon, rail, panes). 32 for large ribbon buttons, 16/20 elsewhere. */
const UI: Record<string, ReactNode> = {
  // left rail
  report: <><rect x="4" y="13" width="3" height="7" fill="none" stroke={K} strokeWidth="1.3" /><rect x="10.5" y="5" width="3" height="15" fill="none" stroke={K} strokeWidth="1.3" /><rect x="17" y="9" width="3" height="11" fill="none" stroke={K} strokeWidth="1.3" /></>,
  tableView: <><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke={K} strokeWidth="1.3" />{P('M3 9 H21 M3 14 H21 M9 4 V20 M15 4 V20', K, 1)}</>,
  model: <><rect x="2.5" y="3" width="8" height="7" fill="none" stroke={K} strokeWidth="1.3" /><rect x="13.5" y="14" width="8" height="7" fill="none" stroke={K} strokeWidth="1.3" /><rect x="13.5" y="3" width="8" height="7" fill="none" stroke={K} strokeWidth="1.3" />{P('M6.5 10 V17.5 H13.5 M10.5 6.5 H13.5', K, 1.2)}</>,
  dax: <><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke={K} strokeWidth="1.3" /><text x="12" y="16" fontSize="8" textAnchor="middle" fill={K} fontStyle="italic" fontWeight="600">DAX</text></>,
  // ribbon large (viewBox 32)
  getData: <><ellipse cx="13" cy="7" rx="8" ry="3" fill="none" stroke={K} strokeWidth="1.3" />{P('M5 7 V23 C5 25 21 25 21 23 V7', K, 1.3)}{P('M5 15 C5 17 21 17 21 15', K, 1)}<rect x="18" y="19" width="11" height="10" rx="1" fill="#fff" stroke={K} />{P('M23.5 21.5 V26.5 M21 24 H26', K)}</>,
  excel: <><rect x="9" y="4" width="20" height="24" rx="1.5" fill="#fff" stroke="#107C41" strokeWidth="1.3" />{P('M9 12 H29 M9 20 H29 M19 4 V28', '#107C41', 1)}<rect x="3" y="9" width="13" height="14" rx="1.5" fill="#107C41" /><text x="9.5" y="20" fontSize="10" textAnchor="middle" fill="#fff" fontWeight="700">X</text></>,
  sql: <><ellipse cx="16" cy="7" rx="10" ry="3.5" fill="#E8E8E8" stroke={G} />{P('M6 7 V25 C6 28 26 28 26 25 V7', G, 1.3)}{P('M6 13 C6 16 26 16 26 13 M6 19 C6 22 26 22 26 19', G, 1)}</>,
  enterData: <><rect x="4" y="6" width="24" height="20" rx="1" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="4" y="6" width="24" height="5" fill={B} />{P('M4 16 H28 M4 21 H28 M12 11 V26 M20 11 V26', G, .9)}</>,
  sample: <><rect x="4" y="5" width="24" height="22" rx="1.5" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="8" y="17" width="3" height="6" fill={B} /><rect x="13" y="12" width="3" height="11" fill={D} /><rect x="18" y="14" width="3" height="9" fill={O} /><rect x="23" y="9" width="2" height="14" fill={B} /></>,
  recent: <><circle cx="16" cy="16" r="11" fill="none" stroke={K} strokeWidth="1.3" />{P('M16 9 V16 L21 19', K, 1.4)}</>,
  transform: <><rect x="3" y="6" width="20" height="18" rx="1" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M3 12 H23 M3 18 H23 M10 6 V24', G, .9)}{P('M20 28 L29 19 L26 16 L17 25 L16 29 Z', K, 1.2)}</>,
  refresh: <>{P('M25 11 A10 10 0 1 0 26 19', K, 1.5)}{P('M26 4 V11 H19', K, 1.5)}</>,
  newVisual: <><rect x="3" y="4" width="26" height="24" rx="1" fill="none" stroke={K} strokeWidth="1.2" /><rect x="8" y="17" width="3" height="7" fill={B} /><rect x="14" y="10" width="3" height="14" fill={B} /><rect x="20" y="14" width="3" height="10" fill={B} /></>,
  textBox: <><rect x="3" y="6" width="26" height="20" rx="1" fill="none" stroke={K} strokeWidth="1.2" /><text x="16" y="22" fontSize="13" textAnchor="middle" fill={K} fontWeight="600">A</text></>,
  moreVisuals: <><rect x="4" y="4" width="10" height="10" rx="1" fill="none" stroke={K} strokeWidth="1.2" /><rect x="18" y="4" width="10" height="10" rx="1" fill="none" stroke={K} strokeWidth="1.2" /><rect x="4" y="18" width="10" height="10" rx="1" fill="none" stroke={K} strokeWidth="1.2" />{P('M23 18 V28 M18 23 H28', K, 1.4)}</>,
  measure: <><rect x="6" y="3" width="20" height="26" rx="2" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="9" y="6" width="14" height="5" fill="#E8E8E8" stroke={G} strokeWidth=".8" />{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={9.5 + c * 5} y={14 + r * 4.5} width="3" height="2.5" fill={G} />))}</>,
  quickMeasure: <><rect x="6" y="3" width="20" height="26" rx="2" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M17 7 L11 17 H16 L14 25 L21 14 H16 Z', '#D9B300', 1.2)}</>,
  publish: <>{P('M16 22 V6 M10 12 L16 6 L22 12', K, 1.5)}{P('M5 20 V27 H27 V20', K, 1.4)}</>,
  paste: <><rect x="6" y="5" width="18" height="23" rx="1.5" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="11" y="3" width="8" height="5" rx="1" fill="#fff" stroke={K} /><rect x="14" y="13" width="14" height="16" rx="1" fill="#fff" stroke={B} strokeWidth="1.2" /></>,
  newPage: <><path d="M7 3 H19 L25 9 V29 H7 Z" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M19 3 V9 H25', K)}{P('M16 14 V24 M11 19 H21', B, 1.6)}</>,
  relationships: <><rect x="2" y="4" width="11" height="9" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="19" y="19" width="11" height="9" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M7.5 13 V23.5 H19', K, 1.3)}</>,
  newColumn: <><rect x="4" y="5" width="24" height="22" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="18" y="5" width="10" height="22" fill={B} opacity=".35" />{P('M4 11 H28 M11 5 V27 M18 5 V27', G, .9)}</>,
  newTable: <><rect x="4" y="5" width="24" height="22" fill="#fff" stroke={K} strokeWidth="1.2" /><rect x="4" y="5" width="24" height="6" fill={B} />{P('M4 16 H28 M4 21 H28 M12 11 V27 M20 11 V27', G, .9)}</>,
  themes: <><circle cx="16" cy="16" r="11" fill="#fff" stroke={K} strokeWidth="1.2" /><circle cx="11" cy="12" r="2.5" fill={B} /><circle cx="17" cy="9.5" r="2.5" fill={O} /><circle cx="21.5" cy="14" r="2.5" fill="#1AAB40" /><circle cx="12" cy="19" r="2.5" fill="#744EC2" /></>,
  pageView: <><rect x="4" y="6" width="24" height="18" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M2 27 H30', G)}</>,
  mobile: <><rect x="10" y="3" width="12" height="26" rx="2" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M14 26 H18', K)}</>,
  info: <><circle cx="16" cy="16" r="11" fill="none" stroke={K} strokeWidth="1.3" />{P('M16 14 V23', K, 1.8)}<circle cx="16" cy="10" r="1.3" fill={K} /></>,
  docs: <><path d="M7 3 H20 L26 9 V29 H7 Z" fill="#fff" stroke={K} strokeWidth="1.2" />{P('M11 14 H22 M11 18 H22 M11 22 H18', G, 1)}</>,
  pause: <><circle cx="16" cy="16" r="11" fill="none" stroke={K} strokeWidth="1.3" />{P('M13 11 V21 M19 11 V21', K, 2)}</>,
  analyzer: <><circle cx="14" cy="14" r="8" fill="none" stroke={K} strokeWidth="1.3" />{P('M20 20 L27 27', K, 2)}<rect x="10" y="14" width="2" height="4" fill={B} /><rect x="13" y="11" width="2" height="7" fill={B} /><rect x="16" y="13" width="2" height="5" fill={B} /></>,
  sensitivity: <><path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill="#fff" stroke={K} strokeWidth="1.2" /></>,
  // small glyphs (viewBox 16)
  cut: <>{P('M4 2 L11 11 M12 2 L5 11', K, 1)}<circle cx="4" cy="12.5" r="2" fill="none" stroke={K} /><circle cx="12" cy="12.5" r="2" fill="none" stroke={K} /></>,
  copy: <><rect x="5" y="5" width="9" height="10" rx="1" fill="#fff" stroke={K} /><path d="M3 11 V2 H10" stroke={K} fill="none" /></>,
  painter: <><rect x="2" y="2" width="11" height="5" rx="1" fill="#fff" stroke={K} />{P('M13 4.5 H14.5 V9 H8 V11', K, 1)}<rect x="6.5" y="11" width="3" height="4" fill={K} /></>,
  chevronDown: P('M4 6 L8 10 L12 6', K, 1.2),
  chevronRight: P('M6 4 L10 8 L6 12', K, 1.2),
  chevronUp: P('M4 10 L8 6 L12 10', K, 1.2),
  collapseRight: P('M4 4 L8 8 L4 12 M9 4 L13 8 L9 12', K, 1.1),
  collapseLeft: P('M12 4 L8 8 L12 12 M7 4 L3 8 L7 12', K, 1.1),
  close: P('M4 4 L12 12 M12 4 L4 12', K, 1.1),
  search: <><circle cx="7" cy="7" r="4.5" fill="none" stroke={K} />{P('M10.5 10.5 L14 14', K, 1.2)}</>,
  more: <><circle cx="3.5" cy="8" r="1.1" fill={K} /><circle cx="8" cy="8" r="1.1" fill={K} /><circle cx="12.5" cy="8" r="1.1" fill={K} /></>,
  sigma: <text x="8" y="12.5" fontSize="12" textAnchor="middle" fill={K} fontWeight="600">Σ</text>,
  calendar: <><rect x="2" y="3" width="12" height="11" rx="1" fill="none" stroke={K} />{P('M2 6.5 H14 M5 1.5 V4 M11 1.5 V4', K, 1)}</>,
  tableSmall: <><rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke={K} />{P('M1.5 6 H14.5 M1.5 9.5 H14.5 M6 6 V13.5 M10 6 V13.5', K, .8)}</>,
  eye: <><path d="M1 8 C3 4 13 4 15 8 C13 12 3 12 1 8 Z" fill="none" stroke={K} /><circle cx="8" cy="8" r="2" fill={K} /></>,
  filter: P('M2 3 H14 L9.5 8.5 V13 L6.5 14.5 V8.5 Z', K, 1),
  focus: <>{P('M2 6 V2 H6 M10 2 H14 V6 M14 10 V14 H10 M6 14 H2 V10', K, 1.1)}</>,
  trash: <>{P('M2.5 4 H13.5 M6 4 V2.5 H10 V4 M4 4 L4.8 14 H11.2 L12 4', K, 1)}</>,
  sortAsc: <>{P('M4 2 V14 M1.5 11.5 L4 14 L6.5 11.5', K, 1)}<text x="12" y="7" fontSize="6" textAnchor="middle" fill={K}>A</text><text x="12" y="14" fontSize="6" textAnchor="middle" fill={K}>Z</text></>,
  undo: P('M5 4 L2 7 L5 10 M2 7 H10 C12.5 7 14 8.5 14 10.5 C14 12.5 12.5 14 10 14 H7', K, 1.1),
  redo: P('M11 4 L14 7 L11 10 M14 7 H6 C3.5 7 2 8.5 2 10.5 C2 12.5 3.5 14 6 14 H9', K, 1.1),
  save: <><path d="M2 2 H11.5 L14 4.5 V14 H2 Z" fill="none" stroke={K} /><rect x="4.5" y="2" width="6" height="4" fill="none" stroke={K} /><rect x="4" y="9" width="8" height="5" fill="none" stroke={K} /></>,
  plus: P('M8 3 V13 M3 8 H13', K, 1.2),
  user: <><circle cx="8" cy="5.5" r="3" fill="none" stroke={K} />{P('M2.5 14.5 C3 10.5 13 10.5 13.5 14.5', K, 1)}</>,
  winMin: P('M3 8 H13', K, 1),
  winMax: <rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke={K} />,
  winRestore: <><rect x="3.5" y="5.5" width="7" height="7" fill="none" stroke={K} />{P('M5.5 5.5 V3.5 H12.5 V10.5 H10.5', K, 1)}</>,
  build: <><rect x="2" y="2" width="12" height="12" fill="none" stroke={K} /><rect x="4" y="9" width="2" height="3" fill={K} /><rect x="7" y="6" width="2" height="6" fill={K} /><rect x="10" y="8" width="2" height="4" fill={K} /></>,
  brush: <>{P('M13.5 2.5 L7 9', K, 1.6)}{P('M7 9 C4 9 3.5 11 3 14 C6 13.5 8 13 7 9 Z', K, 1)}</>,
  analytics: <>{P('M2 2 V14 H14', K, 1)}{P('M3 11 L7 6 L10 9 L14 4', K, 1.1)}</>,
  calc: <><rect x="3" y="1.5" width="10" height="13" rx="1" fill="none" stroke={K} /><rect x="5" y="3.5" width="6" height="2.5" fill={K} /><circle cx="5.8" cy="9" r=".7" fill={K} /><circle cx="8" cy="9" r=".7" fill={K} /><circle cx="10.2" cy="9" r=".7" fill={K} /><circle cx="5.8" cy="11.7" r=".7" fill={K} /><circle cx="8" cy="11.7" r=".7" fill={K} /><circle cx="10.2" cy="11.7" r=".7" fill={K} /></>,
  pin: P('M10 2 L14 6 L11 7 L8 10 L8.5 13 L3 7.5 L6 8 L9 5 Z M5.5 10.5 L2 14', K, 1),
};

export function Icon({ name, size = 16, box }: { name: string; size?: number; box?: number }) {
  const big = ['getData', 'excel', 'sql', 'enterData', 'sample', 'recent', 'transform', 'refresh', 'newVisual', 'textBox', 'moreVisuals', 'measure', 'quickMeasure', 'publish', 'paste', 'newPage', 'relationships', 'newColumn', 'newTable', 'themes', 'pageView', 'mobile', 'info', 'docs', 'pause', 'analyzer', 'sensitivity'];
  const rail = ['report', 'tableView', 'model', 'dax'];
  const vb = box ?? (big.includes(name) ? 32 : rail.includes(name) ? 24 : 16);
  return <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} style={{ flexShrink: 0 }}>{UI[name]}</svg>;
}
