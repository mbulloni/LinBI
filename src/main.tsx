import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { setLocale } from './format';
import { globalOptions } from './options';

setLocale(globalOptions().locale ?? 'it-IT');

createRoot(document.getElementById('root')!).render(<App />);

// Exposed for scripted smoke tests (see LINBI_SCRIPT in electron/main.cjs).
import { useStore } from './store';
(window as any).__linbi = useStore;
import { buildVisualQuery } from './query';
(window as any).__linbiQuery = buildVisualQuery;
import { compileQuery } from './pq/compile';
import { inlineFromM, mToQuery, mToSteps } from './pq/mparse';
import { mToSql } from './pq/mexpr';
import { queryM } from './pbix/pbit';
import { TPL as QM_TPL } from './components/QuickMeasure';
(window as any).__linbiQM = QM_TPL;
(window as any).__linbiPQ = { compileQuery, mToSql, queryM, mToSteps, mToQuery, inlineFromM };
import * as dax from './dax';
(window as any).__linbiDax = dax;
import { runVisualQuery } from './visuals/useVisualData';
(window as any).__linbiRun = runVisualQuery;
