// Power Query parameters: #[Nome] in source paths/URLs and filter values is replaced by the
// parameter's current value (kept in sync with Report.pqParams by the store).
import type { PQParam, TableMeta } from '../types';

let params: PQParam[] = [];
export const setParams = (list: PQParam[] | undefined) => { params = list ?? []; };
export const PARAM_RE = /#\[([^\]]+)\]/g;

export function resolveText(s: string): string {
  return s.replace(PARAM_RE, (_m, name: string) => {
    const p = params.find((x) => x.name === name.trim());
    if (!p) throw new Error(`Expression.Error: il parametro "${name}" non esiste (Gestisci parametri).`);
    return p.value;
  });
}

export function resolveSource(source: TableMeta['source']): TableMeta['source'] {
  if (!/#\[/.test(JSON.stringify(source))) return source;
  return {
    ...source,
    path: resolveText(source.path),
    ...(source.web ? { web: { ...source.web, url: resolveText(source.web.url) } } : {}),
    ...(source.odata ? { odata: { url: resolveText(source.odata.url) } } : {}),
    ...(source.folder ? { folder: { ...source.folder, path: resolveText(source.folder.path) } } : {}),
  };
}
