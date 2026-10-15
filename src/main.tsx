import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Exposed for scripted smoke tests (see LINBI_SCRIPT in electron/main.cjs).
import { useStore } from './store';
(window as any).__linbi = useStore;
import { buildVisualQuery } from './query';
(window as any).__linbiQuery = buildVisualQuery;
import { compileQuery } from './pq/compile';
import { mToSql } from './pq/mexpr';
import { queryM } from './pbix/pbit';
(window as any).__linbiPQ = { compileQuery, mToSql, queryM };
