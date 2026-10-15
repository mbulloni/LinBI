import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './icons';

export function TitleBar() {
  const { filePath, dirty, past, future, undo, redo, save, sourceName } = useStore();
  const [max, setMax] = useState(false);
  useEffect(() => api.win.onState(setMax), []);
  const name = filePath ? filePath.split('/').pop()!.replace(/\.lbix$/, '') : sourceName ?? 'Senza titolo';
  const title = `${name}${dirty ? ' *' : ''} - LinBI`;
  useEffect(() => api.win.setTitle(title), [title]);

  return (
    <div className="titlebar" onDoubleClick={(e) => e.target === e.currentTarget && api.win.maximize()}>
      <div className="appicon">
        <svg width="20" height="20" viewBox="0 0 20 20">
          <rect x="2" y="2" width="16" height="16" rx="3" fill="#252423" />
          <rect x="5" y="10" width="2.4" height="5" rx=".6" fill="#F2C811" />
          <rect x="8.8" y="6" width="2.4" height="9" rx=".6" fill="#F2C811" />
          <rect x="12.6" y="8" width="2.4" height="7" rx=".6" fill="#F2C811" />
        </svg>
      </div>
      <div className="qa">
        <button title="Salva (Ctrl+S)" onClick={() => save()}><Icon name="save" /></button>
        <button title="Annulla (Ctrl+Z)" disabled={!past.length} onClick={undo}><Icon name="undo" /></button>
        <button title="Ripeti (Ctrl+Y)" disabled={!future.length} onClick={redo}><Icon name="redo" /></button>
      </div>
      <div className="title">{title}</div>
      <div className="search"><Icon name="search" size={14} /><input placeholder="Cerca" /></div>
      <div className="user"><Icon name="user" size={16} />Accedi</div>
      <div className="winbtns">
        <button onClick={() => api.win.minimize()} title="Riduci a icona"><Icon name="winMin" /></button>
        <button onClick={() => api.win.maximize()} title={max ? 'Ripristina' : 'Ingrandisci'}><Icon name={max ? 'winRestore' : 'winMax'} /></button>
        <button className="close" onClick={() => api.win.close()} title="Chiudi"><Icon name="close" /></button>
      </div>
    </div>
  );
}
