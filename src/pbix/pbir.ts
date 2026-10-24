/**
 * Power BI enhanced report format (PBIR) → legacy Report/Layout JSON, so parseLayout() reads both.
 * PBIR keeps one JSON file per page (pages/<id>/page.json) and per visual
 * (pages/<id>/visuals/<id>/visual.json); field expressions already use SourceRef.Entity.
 * Bookmarks: bookmarks/bookmarks.json (order, groups) + bookmarks/<name>.bookmark.json (same state as legacy).
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

/** PBIR bookmarks → legacy config.bookmarks (groups hold their bookmarks in `children`). */
function bookmarksOf(files: Files): any[] {
  const one = (name: string) => { const b = parse(files[`bookmarks/${name}.bookmark.json`]); if (!b) return null; const { $schema: _s, ...rest } = b; return rest; };
  const meta = parse(files['bookmarks/bookmarks.json']);
  const out: any[] = [];
  const used = new Set<string>();
  for (const it of meta?.items ?? []) {
    if (Array.isArray(it.children)) {
      const children = it.children.map((n: string) => { used.add(n); return one(n); }).filter(Boolean);
      out.push({ name: it.name, displayName: it.displayName ?? it.name, children });
    } else if (it.name) { used.add(it.name); const b = one(it.name); if (b) out.push(b); }
  }
  // Bookmark files not listed in bookmarks.json are kept too.
  for (const k of Object.keys(files)) {
    const m = /^bookmarks\/(.+)\.bookmark\.json$/.exec(k);
    if (m && !used.has(m[1])) { const b = one(m[1]); if (b) out.push(b); }
  }
  return out;
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
      .filter((v) => v?.visual || v?.visualGroup)
      .map((v) => {
        const pos = v.position ?? {};
        const pos0 = { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0, width: pos.width ?? 200, height: pos.height ?? 150 };
        const parent = v.parentGroupName ? { parentGroupName: v.parentGroupName } : {};
        // Groups (Selection pane) and hidden visuals are kept: bookmarks show/hide them.
        if (!v.visual) {
          return { ...pos0, config: JSON.stringify({ name: v.name, ...parent, singleVisualGroup: { displayName: v.visualGroup.displayName ?? v.name, groupMode: 0, ...(v.isHidden ? { isHidden: true } : {}) } }), filters: '[]' };
        }
        const q = convertQuery(v.visual.query);
        // Mobile layout: visuals/<id>/mobile.json { position } → legacy layouts entry id 1.
        const mob = parse(files[`pages/${id}/visuals/${v.name}/mobile.json`])?.position;
        return {
          ...pos0,
          config: JSON.stringify({
            name: v.name,
            layouts: [{ id: 0, position: pos0 }, ...(mob ? [{ id: 1, position: mob }] : [])],
            ...parent,
            singleVisual: {
              visualType: v.visual.visualType,
              ...q,
              objects: v.visual.objects ?? {},
              vcObjects: v.visual.visualContainerObjects ?? {},
              ...(v.visual.syncGroup ? { syncGroup: v.visual.syncGroup } : {}),
              ...(v.isHidden ? { display: { mode: 'hidden' } } : {}),
            },
          }),
          filters: JSON.stringify(v.filterConfig?.filters ?? []),
        };
      });
    return {
      name: id, displayName: page.displayName ?? id, ordinal, width: page.width ?? 1280, height: page.height ?? 720,
      config: JSON.stringify({
        objects: page.objects ?? {}, ...(page.visibility === 'HiddenInViewMode' ? { visibility: 1 } : {}),
        ...(page.type === 'Tooltip' ? { type: 1 } : {}),
        // visualInteractions [{source, target, type: DataFilter|HighlightFilter|NoFilter}] = legacy relationships.
        ...(Array.isArray(page.visualInteractions) ? { relationships: page.visualInteractions } : {}),
        // Drill-through page: PBIR pageBinding has the legacy shape (parameters with fieldExpr).
        ...(page.pageBinding ? { pageBinding: { ...page.pageBinding, type: page.pageBinding.type === 'Drillthrough' || page.pageBinding.type === 0 ? 'Drillthrough' : page.pageBinding.type } } : {}),
      }),
      filters: JSON.stringify(page.filterConfig?.filters ?? []),
      visualContainers,
    };
  });
  const custom = report.themeCollection?.customTheme?.name;
  return JSON.stringify({
    sections,
    config: JSON.stringify({ themeCollection: custom ? { customTheme: { name: custom } } : {}, bookmarks: bookmarksOf(files) }),
    filters: JSON.stringify(report.filterConfig?.filters ?? []),
  });
}
