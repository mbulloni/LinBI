/**
 * Power BI enhanced report format (PBIR) → legacy Report/Layout JSON, so parseLayout() reads both.
 * PBIR keeps one JSON file per page (pages/<id>/page.json) and per visual
 * (pages/<id>/visuals/<id>/visual.json); field expressions already use SourceRef.Entity.
 */

type Files = Record<string, string>;

const parse = (s: string | undefined) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

/** queryState { Role: { projections: [{ field, queryRef, active }] } } → legacy projections + prototypeQuery. */
function convertQuery(query: any) {
  const projections: Record<string, { queryRef: string; active?: boolean }[]> = {};
  const select: any[] = [];
  const seen = new Set<string>();
  for (const [role, st] of Object.entries<any>(query?.queryState ?? {})) {
    for (const p of st?.projections ?? []) {
      const ref = p.queryRef ?? p.nativeQueryRef ?? JSON.stringify(p.field);
      (projections[role] ??= []).push({ queryRef: ref, ...(p.active ? { active: true } : {}) });
      if (!seen.has(ref) && p.field) { seen.add(ref); select.push({ ...p.field, Name: ref }); }
    }
  }
  const sort = query?.sortDefinition?.sort?.[0];
  return {
    projections,
    prototypeQuery: {
      Version: 2, From: [], Select: select,
      ...(sort?.field ? { OrderBy: [{ Direction: /asc/i.test(sort.direction ?? '') ? 1 : 2, Expression: sort.field }] } : {}),
    },
  };
}

export function pbirToLayout(files: Files): string {
  const report = parse(files['report.json']) ?? {};
  const pagesMeta = parse(files['pages/pages.json']) ?? {};
  const pageIds = new Set<string>();
  for (const k of Object.keys(files)) {
    const m = /^pages\/([^/]+)\/page\.json$/.exec(k);
    if (m) pageIds.add(m[1]);
  }
  const order: string[] = (pagesMeta.pageOrder ?? []).filter((id: string) => pageIds.has(id));
  for (const id of pageIds) if (!order.includes(id)) order.push(id);

  const sections = order.map((id, ordinal) => {
    const page = parse(files[`pages/${id}/page.json`]) ?? {};
    const visualContainers = Object.keys(files)
      .filter((k) => k.startsWith(`pages/${id}/visuals/`) && k.endsWith('/visual.json'))
      .map((k) => parse(files[k]))
      .filter((v) => v?.visual && !v.isHidden)
      .map((v) => {
        const pos = v.position ?? {};
        const q = convertQuery(v.visual.query);
        return {
          x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0, width: pos.width ?? 200, height: pos.height ?? 150,
          config: JSON.stringify({
            name: v.name,
            singleVisual: {
              visualType: v.visual.visualType,
              ...q,
              objects: v.visual.objects ?? {},
              vcObjects: v.visual.visualContainerObjects ?? {},
            },
          }),
          filters: JSON.stringify(v.filterConfig?.filters ?? []),
        };
      });
    return {
      name: id, displayName: page.displayName ?? id, ordinal, width: page.width ?? 1280, height: page.height ?? 720,
      config: JSON.stringify({ objects: page.objects ?? {}, ...(page.visibility === 'HiddenInViewMode' ? { visibility: 1 } : {}) }),
      filters: JSON.stringify(page.filterConfig?.filters ?? []),
      visualContainers,
    };
  });
  const custom = report.themeCollection?.customTheme?.name;
  return JSON.stringify({
    sections,
    config: JSON.stringify({ themeCollection: custom ? { customTheme: { name: custom } } : {} }),
    filters: JSON.stringify(report.filterConfig?.filters ?? []),
  });
}
