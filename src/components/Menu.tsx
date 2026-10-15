import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Floating context/drop-down menu anchored to a point; closes on outside click or Escape. */
export function Menu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => window.addEventListener('mousedown', down));
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
    if (r.bottom > window.innerHeight) el.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
  });
  return createPortal(
    <div className="dropdown" ref={ref} style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>{children}</div>,
    document.body,
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on} />;
}
