# CLAUDE.md — LinBI

Educational Power BI Desktop clone for Linux. Electron 44 + React 19 + TypeScript + Vite 8, DuckDB (`@duckdb/node-api`) as engine, ECharts for charts, zustand for state. UI text is Italian, mirroring Power BI's Italian localization.

## Commands
- `npm run dev` — Vite (5173) + Electron. `npm start` — production build + Electron. `npm run typecheck`.
- Electron's binary download may be blocked by npm 12 install-script policy: `node node_modules/electron/install.js`.
- Visual smoke test: `LINBI_SHOT=out.png LINBI_SCRIPT=steps.js npx electron . --no-sandbox` (store as `window.__linbi`, query builder as `window.__linbiQuery`, Power Query compiler as `window.__linbiPQ`; a returned value is printed as `SCRIPT_RESULT`; `LINBI_PBIT_OUT` skips the .pbit save dialog).

## Layout
- `electron/` (CommonJS): `main.cjs` window/IPC/dialogs, `db.cjs` DuckDB, `sample.cjs` Financials generator, `preload.cjs` → `window.api`.
- `src/store.ts` — all report state + actions; mutations go through `mut()` (undo snapshot of `report`).
- `src/query.ts` — visual → SQL. `core()` builds per-measure-table subqueries over a join tree (`joinTree`, `edgesFrom` encode Power BI filter direction), `finalize()` adds VARCHAR display cols (`cN`) next to raw keys (`k_cN`, used for sorting). Fan-out hops dedupe on `t0.rowid`.
- `src/components/ModelView.tsx` (diagram), `Relationships.tsx` (manage/edit dialogs, `activationConflict`).
- `src/visuals/catalog.ts` — visual types and their wells. `ChartVisual.tsx` (ECharts), `Others.tsx` (card/table/matrix/slicer/textbox).
- `src/panes/` — Filters, Visualizations (build + format), Data.
- Power Query (`src/pq/`): `Step` union in `types.ts`, stored on `TableMeta.steps`. `compile.ts` → SQL (one CTE per step, hidden `__r` ordinal; refs/merge/append inlined as subqueries, so `compileQuery` needs all query defs), `m.ts` → M (formula bar, Editor avanzato, `.pbit` via `pbit.ts#queryM`), `mexpr.ts` translates custom-column M formulas to SQL, `steps.ts` step names ("Rimosse colonne1"…). Every table load goes through `store.loadTable` → `api.materialize(name, sql)`. Editor state is `store.pq` (draft copies of all queries; `pqApply` = Chiudi e applica, reloads changed queries + dependents, renames tables in the report). UI: `components/PowerQuery.tsx` + `PowerQueryDialogs.tsx`.
- Power BI files: `electron/pbix/read_pbix.py` (run by main via `.venv-pbix` python or `LINBI_PYTHON`; `npm run setup:pbix`) writes `model.json` + Parquet into `~/.config/linbi/pbix-cache/<hash>`. `src/pbix/layout.ts` maps Report/Layout ↔ LinBI pages, `src/pbix/pbit.ts` builds .pbit parts (UTF-16LE, no BOM; jszip in main), `src/dax.ts` compiles DAX measures to SQL templates (`FieldRef.agg === 'measure'`).

## Gotchas
- pandas NaN must never reach model.json (JS JSON.parse fails): `json.dump(allow_nan=False)`.
- Old Report/Layout files keep visual geometry only in `config.layouts[0].position`.
- pbixray's public API lacks SortByColumn/measure FormatString: read via `model._metadata.source._db` (metadata.sqlitedb).
- `getRowObjectsJson()` returns BIGINT/HUGEINT as strings (e.g. `GROUPING()` → `"0"`): wrap with `Number()`.
- Relationships live in `report.relationships` (undo + saved in .lbix); `from` is always the many side. Old .lbix files get `relationships`/`modelLayout` defaulted in `open()`.
- `Omit<Step,'id'>` does not distribute over the union: use `NewStep` from `types.ts`.
- DuckDB `UNPIVOT` refuses mixed column types: the step carries `cast: true` (decided from the schema when created) to cast to VARCHAR first.
- Page is 1280×720 logical px, scaled with CSS transform; react-rnd gets `scale`.
