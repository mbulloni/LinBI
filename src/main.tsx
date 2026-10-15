import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Exposed for scripted smoke tests (see LINBI_SCRIPT in electron/main.cjs).
import { useStore } from './store';
(window as any).__linbi = useStore;
import { buildVisualQuery } from './query';
(window as any).__linbiQuery = buildVisualQuery;
