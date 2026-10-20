// Esplora Q&A: opened by a button with action Q&A; the answer is not added to the report.
import { useState } from 'react';
import type { Visual } from '../types';
import { defaultFormat, useStore } from '../store';
import { Icon } from '../components/icons';
import { QnaVisual } from './QnaVisual';

export function QnaExplorer() {
  const open = useStore((s) => s.qnaExplorer);
  const set = useStore((s) => s.set);
  const [v, setV] = useState<Visual>(() => ({ id: 'qna-explorer', type: 'qna', x: 0, y: 0, w: 860, h: 520, z: 0, fields: {}, format: defaultFormat('qna') }));
  if (!open) return null;
  const close = () => set({ qnaExplorer: false });
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="dialog" style={{ width: 900, height: Math.min(640, window.innerHeight * 0.86) }}>
        <div className="dh"><h2>Esplora Q&amp;A</h2><button onClick={close}><Icon name="close" /></button></div>
        <div className="db" style={{ position: "relative", display: "block", paddingBottom: 20 }}>
          <QnaVisual v={v} selected onChange={(patch) => setV((x) => ({ ...x, ...patch }))} />
        </div>
      </div>
    </div>
  );
}
