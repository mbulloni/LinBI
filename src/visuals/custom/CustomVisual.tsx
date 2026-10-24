// Custom visual (.pbiviz) host: the package's code runs in a sandboxed iframe (scripts only, opaque
// origin, CSP from the package's WebAccess privilege) with the runtime in host.js; MiB-BI sends the
// DataView built from the visual's query and applies selections, persisted properties and filters.
import { useEffect, useMemo, useRef, useState } from 'react';
import hostJs from './host.js?raw';
import { useStore } from '../../store';
import { api } from '../../api';
import { NULL_KEY, qi } from '../../query';
import { PALETTE } from '../../format';
import { STYLE_THEME } from '../pbistyle';
import { customName, customPkg } from '../catalog';
import type { VisualData } from '../useVisualData';
import type { CustomVisualPkg, Visual } from '../../types';
import { buildDataView, webAccess, type Pred } from './dataview';
import { jsonFilterToFilters, persist } from './objects';

/** Old Power BI sandboxes provided jQuery and lodash as globals; bundles of that era still expect them. */
async function legacyLibs(js: string): Promise<string[]> {
  const out: string[] = [];
  if (/window\.(\$|jQuery)(?![\w$])/.test(js)) out.push((await import('jquery/dist/jquery.min.js?raw')).default);
  if (/window\._(?![\w$])/.test(js)) out.push((await import('lodash/lodash.min.js?raw')).default);
  return out;
}

function pageHtml(pkg: CustomVisualPkg): string {
  const net = webAccess(pkg);
  const origins = net === 'any' ? 'https: wss:' : net === 'none' ? '' : net.join(' ');
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${net === 'any' ? 'https:' : ''}`,
    "style-src 'unsafe-inline' https:", 'img-src data: blob: https: http:', 'font-src data: https:', 'media-src data: blob: https:',
    `connect-src ${origins || "'none'"}`, 'worker-src blob:',
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:'Segoe UI','Segoe UI Web',wf_segoe-ui_normal,'Noto Sans',Arial,sans-serif;font-size:11px;color:#252423;background:transparent}
#v{position:absolute;inset:0;overflow:hidden}
#mib-bi-tt{position:fixed;display:none;z-index:99999;pointer-events:none;background:#fff;color:#252423;border:1px solid #c8c6c4;box-shadow:0 2px 6px rgba(0,0,0,.18);padding:6px 8px;font-size:11px;max-width:260px}
#mib-bi-tt .h{font-weight:600;margin-bottom:3px}#mib-bi-tt .r{display:flex;gap:8px;align-items:center;white-space:nowrap}#mib-bi-tt .r span{flex:1;color:#605e5c}#mib-bi-tt i{width:8px;height:8px;display:inline-block}</style>
</head><body><div id="v"></div><script>${hostJs}</script></body></html>`;
}

export function CustomVisual({ v, data }: { v: Visual; data: VisualData }) {
  const pkg = customPkg(v.custom);
  const tables = useStore((s) => s.tables);
  const measures = useStore((s) => s.report.measures);
  const cross = useStore((s) => s.crossFilter);
  const editing = useStore((s) => s.selectedVisualId === v.id);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => (pkg ? pageHtml(pkg) : ''), [pkg]);
  const dv = useMemo(() => (pkg && data.items.length && !data.error ? buildDataView(pkg, v, data.items, data.rows, tables, measures) : null),
    [pkg, data.items, data.rows, data.error, v.style?.objects, v.fields, tables, measures]);
  const jsonFilters = useMemo(() => Object.values(v.jsonFilters ?? {}).map((x: any) => x.filter).filter(Boolean), [v.jsonFilters]);
  // Latest values for the message handler (registered once per iframe).
  const live = useRef({ v, tables });
  live.current = { v, tables };

  useEffect(() => {
    if (!pkg) return;
    setReady(false); setError(null);
    const onMessage = async (e: MessageEvent) => {
      const win = ref.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data ?? {};
      const s = useStore.getState();
      const cur = live.current.v;
      if (m.type === 'loaded') {
        const theme = STYLE_THEME.theme;
        win.postMessage({
          type: 'init', js: pkg.pbiviz.content?.js ?? '', css: pkg.pbiviz.content?.css ?? '', libs: await legacyLibs(pkg.pbiviz.content?.js ?? ''),
          strings: pkg.pbiviz.stringResources ?? {},
          pkg: { guid: pkg.guid, apiVersion: pkg.pbiviz.apiVersion, net: webAccess(pkg) === 'none' ? 'none' : 'web' },
          palette: { dataColors: [...PALETTE], background: theme?.background ?? '#FFFFFF', foreground: theme?.foreground ?? '#252423' },
        }, '*');
      } else if (m.type === 'ready') setReady(true);
      else if (m.type === 'error') setError(String(m.message ?? 'errore'));
      else if (m.type === 'warn') console.warn(`[${customName(pkg)}]`, m.message);
      else if (m.type === 'select') {
        const first: Pred | undefined = (m.sel as Pred[][] | undefined)?.find((x) => x.length)?.[0];
        if (!first) { if (s.crossFilter?.visualId === cur.id) s.setCross(null); return; }
        s.setCross({ visualId: cur.id, table: first.t, column: first.c, value: first.v === null ? NULL_KEY : first.v, ...(first.part ? { datePart: first.part as any } : {}) });
      } else if (m.type === 'persist') {
        const objects = persist(cur.style?.objects, m.changes);
        if (JSON.stringify(objects) !== JSON.stringify(cur.style?.objects ?? {})) s.updateVisual(cur.id, { style: { ...cur.style, objects } }, false);
      } else if (m.type === 'filter') {
        const all = { ...(cur.jsonFilters ?? {}) };
        if (!m.filter || m.remove || (Array.isArray(m.filter) && !m.filter.length)) delete all[m.key];
        else {
          // Advanced (range) filters: resolved against the column's distinct values.
          const list = Array.isArray(m.filter) ? m.filter : [m.filter];
          const distinct: Record<string, string[]> = {};
          for (const f of list) {
            const t = Array.isArray(f?.target) ? f.target[0] : f?.target;
            if (!f?.conditions || !t?.table || !t?.column) continue;
            const res = await api.queryAs(`SELECT DISTINCT CAST(${qi(t.column)} AS VARCHAR) AS v FROM ${qi(t.table)} WHERE ${qi(t.column)} IS NOT NULL`);
            distinct[t.table + '\u0001' + t.column] = res.rows.map((r) => String(r.v));
          }
          all[m.key] = { filter: m.filter, resolved: jsonFilterToFilters(m.filter, live.current.tables, (t, c) => distinct[t + '\u0001' + c]) };
        }
        s.updateVisual(cur.id, { jsonFilters: Object.keys(all).length ? all : undefined });
      } else if (m.type === 'url') {
        api.openExternal(String(m.url)).catch(() => s.notify('Indirizzo non consentito: solo collegamenti https.'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pkg, html]);

  // Clicking inside the iframe does not reach the page: selecting the visual follows its focus.
  useEffect(() => {
    const onBlur = () => setTimeout(() => { if (document.activeElement === ref.current) useStore.getState().selectVisual(v.id); }, 0);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [v.id]);

  // Like Power BI, the visual is updated once its query has run (not with an empty view while loading).
  const pending = data.loading || (data.items.length > 0 && !dv && !data.error);
  useEffect(() => {
    if (!ready || pending) return;
    setError(null);
    ref.current?.contentWindow?.postMessage({ type: 'update', dv, jsonFilters, edit: editing }, '*');
  }, [ready, pending, dv, jsonFilters, editing]);

  // Another visual's cross-filter (or none) clears this visual's own selection state.
  useEffect(() => {
    if (ready && cross?.visualId !== v.id) ref.current?.contentWindow?.postMessage({ type: 'clearSelection' }, '*');
  }, [ready, cross?.visualId, v.id]);

  if (!pkg) return <div className="vc-error"><b>Oggetto visivo personalizzato mancante</b><span>Il pacchetto {v.custom} non è nel report: importarlo con «Importa un oggetto visivo da un file».</span></div>;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <iframe ref={ref} title={customName(pkg)} sandbox="allow-scripts" srcDoc={html}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'transparent' }} />
      {error && <div className="vc-error" style={{ position: 'absolute', inset: 0, background: 'var(--bg, #fff)' }}><b>Errore dell'oggetto visivo «{customName(pkg)}»</b><span>{error}</span></div>}
    </div>
  );
}
