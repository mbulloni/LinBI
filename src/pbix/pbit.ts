/**
 * Export to a Power BI template (.pbit): the official text-based package Power BI Desktop
 * produces with File → Export → Power BI template. It carries model schema (TOM JSON),
 * Power Query (M) per table, relationships, DAX measures and the report layout; Power BI
 * reloads the data from the sources when the template is opened.
 */
import type { ColumnMeta, Report, TableMeta } from '../types';
import { appendSteps, mName, mStr } from '../pq/m';
import { buildLayout } from './layout';

export interface PbitPart { path: string; utf16?: string; utf8bom?: string; dataUrl?: string; }

function tomType(duck: string): { dataType: string; m: string } {
  const t = duck.toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT)$/.test(t)) return { dataType: 'int64', m: 'Int64.Type' };
  if (/^(FLOAT|REAL|DOUBLE)$/.test(t)) return { dataType: 'double', m: 'type number' };
  if (t.startsWith('DECIMAL')) return { dataType: 'decimal', m: 'Currency.Type' };
  if (t === 'BOOLEAN') return { dataType: 'boolean', m: 'type logical' };
  if (t === 'DATE') return { dataType: 'dateTime', m: 'type date' };
  if (t.startsWith('TIMESTAMP')) return { dataType: 'dateTime', m: 'type datetime' };
  return { dataType: 'string', m: 'type text' };
}

/** Power Query expression of the source ("Origine" + header/type steps); keeps the original M of Power BI tables. */
function sourceM(t: Pick<TableMeta, 'source'>, columns: ColumnMeta[]): string {
  if (t.source.m) return t.source.m;
  if (t.source.ref) return `let\n    Origine = ${mName(t.source.ref)}\nin\n    Origine`;
  const d = t.source.db;
  if (d) {
    const server = mStr(d.port ? `${d.host || 'localhost'}:${d.port}` : d.host || 'localhost');
    const origin = d.kind === 'mysql' ? `MySQL.Database(${server}, ${mStr(d.database ?? '')}, [ReturnSingleDatabase=true])`
      : d.kind === 'postgres' ? `PostgreSQL.Database(${server}, ${mStr(d.database ?? '')})`
        : `Odbc.DataSource(${mStr(`driver={SQLite3 ODBC Driver};database=${d.file}`)}, [HierarchicalNavigation=true])`;
    const nav = d.kind === 'sqlite' ? `Origine{[Name=${mStr(d.table)},Kind="Table"]}[Data]` : `Origine{[Schema=${mStr(d.schema)},Item=${mStr(d.table)}]}[Data]`;
    return `let\n    Origine = ${origin},\n    ${mName(d.table)} = ${nav}\nin\n    ${mName(d.table)}`;
  }
  const p = t.source.path;
  const ext = p.split('.').pop()!.toLowerCase();
  const types = `{${columns.map((c) => `{${mStr(c.name)}, ${tomType(c.type).m}}`).join(', ')}}`;
  const typed = (prev: string) => columns.length
    ? `    #"Modificato tipo" = Table.TransformColumnTypes(${prev}, ${types})\nin\n    #"Modificato tipo"`
    : `    Fine = ${prev}\nin\n    Fine`;
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    return `let\n    Origine = Csv.Document(File.Contents(${mStr(p)}), [Delimiter="${ext === 'tsv' ? '#(tab)' : ','}", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n` +
      `    #"Intestazioni alzate di livello" = Table.PromoteHeaders(Origine, [PromoteAllScalars=true]),\n${typed('#"Intestazioni alzate di livello"')}`;
  }
  if (ext === 'xlsx') {
    const item = t.source.sheet ? `{[Item=${mStr(t.source.sheet)},Kind="Sheet"]}[Data]` : '{0}[Data]';
    return `let\n    Origine = Excel.Workbook(File.Contents(${mStr(p)}), null, true),\n    Foglio = Origine${item},\n` +
      `    #"Intestazioni alzate di livello" = Table.PromoteHeaders(Foglio, [PromoteAllScalars=true]),\n${typed('#"Intestazioni alzate di livello"')}`;
  }
  if (ext === 'parquet') return `let\n    Origine = Parquet.Document(File.Contents(${mStr(p)}))\nin\n    Origine`;
  if (ext === 'json') return `let\n    Origine = Table.FromRecords(Json.Document(File.Contents(${mStr(p)}))),\n${typed('Origine')}`;
  return `let\n    Origine = Csv.Document(File.Contents(${mStr(p)}))\nin\n    Origine`;
}

/** Full M of a query: source followed by its applied steps (Editor avanzato, .pbit partitions). */
export function queryM(t: Pick<TableMeta, 'source' | 'steps'>, sourceColumns: ColumnMeta[]): string {
  return appendSteps(sourceM(t, sourceColumns), t.steps ?? []);
}

const mExpression = (t: TableMeta) => queryM(t, t.steps?.length ? t.sourceColumns ?? [] : t.columns);

export function buildModelSchema(report: Report, tables: TableMeta[]) {
  const numeric = (t: string) => ['int64', 'double', 'decimal'].includes(t);
  // Power BI "measure tables": only measures, exported with one hidden placeholder column.
  const measureOnly = [...new Set(report.measures.map((m) => m.table))].filter((n) => !tables.some((t) => t.name === n));
  const measuresOf = (table: string) => report.measures.filter((m) => m.table === table).map((m) => ({
    name: m.name, expression: m.expression.split('\n'), lineageTag: crypto.randomUUID(),
    ...(m.formatString ? { formatString: m.formatString } : {}),
  }));
  return {
    name: crypto.randomUUID(),
    compatibilityLevel: 1550,
    model: {
      culture: 'it-IT',
      dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
      defaultPowerBIDataSourceVersion: 'powerBI_V3',
      sourceQueryCulture: 'it-IT',
      tables: tables.map((t) => ({
        name: t.name,
        lineageTag: crypto.randomUUID(),
        columns: t.columns.map((c) => {
          const tt = tomType(c.type);
          const calc = t.calcColumns?.find((x) => x.name === c.name);
          // Calculated columns keep their DAX; columns of a calculated table come from its expression.
          const kind = calc ? { type: 'calculated', isDataTypeInferred: true, expression: calc.expression.split('\n') }
            : t.source.dax ? { type: 'calculatedTableColumn', isNameInferred: true, isDataTypeInferred: true, sourceColumn: `[${c.name}]` }
              : { sourceColumn: c.name };
          return {
            name: c.name, dataType: tt.dataType, ...kind, lineageTag: crypto.randomUUID(),
            summarizeBy: numeric(tt.dataType) ? 'sum' : 'none',
            ...(tt.dataType === 'dateTime' ? { formatString: tt.m === 'type date' ? 'Short Date' : 'General Date' } : {}),
            ...(t.sortBy?.[c.name] ? { sortByColumn: t.sortBy[c.name] } : {}),
            annotations: [{ name: 'SummarizationSetBy', value: 'Automatic' }],
          };
        }),
        partitions: [{
          name: `${t.name}-${crypto.randomUUID().slice(0, 8)}`, mode: 'import',
          source: t.source.dax ? { type: 'calculated', expression: t.source.dax.split('\n') } : { type: 'm', expression: mExpression(t).split('\n') },
        }],
        measures: measuresOf(t.name),
        annotations: [{ name: 'PBI_ResultType', value: 'Table' }],
      })).concat(measureOnly.map((name) => ({
        name,
        lineageTag: crypto.randomUUID(),
        columns: [{ name: 'Colonna1', dataType: 'string', sourceColumn: 'Colonna1', lineageTag: crypto.randomUUID(), summarizeBy: 'none', isHidden: true, annotations: [{ name: 'SummarizationSetBy', value: 'Automatic' }] }] as any[],
        partitions: [{ name: `${name}-${crypto.randomUUID().slice(0, 8)}`, mode: 'import', source: { type: 'm', expression: ['let', '    Origine = Table.FromRows({}, type table [Colonna1 = text])', 'in', '    Origine'] } }],
        measures: measuresOf(name),
        annotations: [{ name: 'PBI_ResultType', value: 'Table' }],
      }))),
      relationships: report.relationships.map((r) => ({
        name: crypto.randomUUID(),
        fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn,
        ...(r.active ? {} : { isActive: false }),
        ...(r.crossFilter === 'both' || r.cardinality === 'oneToOne' ? { crossFilteringBehavior: 'bothDirections' } : {}),
        ...(r.cardinality === 'oneToOne' ? { fromCardinality: 'one' } : {}),
        ...(r.cardinality === 'manyToMany' ? { toCardinality: 'many' } : {}),
      })),
      annotations: [
        { name: 'PBI_QueryOrder', value: JSON.stringify(tables.map((t) => t.name)) },
        { name: '__PBI_TimeIntelligenceEnabled', value: '0' },
      ],
    },
  };
}

/** Power BI project (.pbip): legacy report.json + TMSL model.bim, text files suited to git. */
export function buildPbipParts(report: Report, tables: TableMeta[]): { path: string; text?: string; dataUrl?: string }[] {
  const { layout, resources } = buildLayout(report.pages, report.reportFilters, report.theme);
  const j = (o: unknown) => JSON.stringify(o, null, 2);
  const platform = (type: string) => ({
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
    metadata: { type, displayName: '__BASE__' },
    config: { version: '2.0', logicalId: crypto.randomUUID() },
  });
  return [
    { path: '__BASE__.pbip', text: j({ version: '1.0', artifacts: [{ report: { path: '__BASE__.Report' } }], settings: { enableAutoRecovery: true } }) },
    { path: '__BASE__.Report/definition.pbir', text: j({ version: '1.0', datasetReference: { byPath: { path: '../__BASE__.SemanticModel' } } }) },
    { path: '__BASE__.Report/report.json', text: j(JSON.parse(layout)) },
    ...Object.entries(resources).map(([n, d]) => ({ path: `__BASE__.Report/StaticResources/RegisteredResources/${n}`, dataUrl: d })),
    { path: '__BASE__.SemanticModel/definition.pbism', text: j({ version: '1.0', settings: {} }) },
    { path: '__BASE__.SemanticModel/model.bim', text: j(buildModelSchema(report, tables)) },
    // Microsoft Fabric Git integration metadata.
    { path: '__BASE__.Report/.platform', text: j(platform('Report')) },
    { path: '__BASE__.SemanticModel/.platform', text: j(platform('SemanticModel')) },
    { path: '.gitignore', text: '**/.pbi/localSettings.json\n**/.pbi/cache.abf\n' },
  ];
}

export function buildPbitParts(report: Report, tables: TableMeta[]): PbitPart[] {
  const { layout, resources } = buildLayout(report.pages, report.reportFilters, report.theme);
  const diagram = {
    version: '1.1.0',
    diagrams: [{
      ordinal: 0, scrollPosition: { x: 0, y: 0 },
      nodes: tables.map((t, i) => ({
        location: report.modelLayout[t.name] ?? { x: 40 + (i % 4) * 280, y: 40 + Math.floor(i / 4) * 380 },
        nodeIndex: t.name, size: { height: 300, width: 234 }, zIndex: i,
      })),
      name: 'Tutte le tabelle', zoomValue: 100, pinKeyFieldsToTop: false, showExtraHeaderInfo: false, hideKeyFieldsWhenCollapsed: false, tablesLocked: false,
    }],
    selectedDiagram: 'Tutte le tabelle', defaultDiagram: 'Tutte le tabelle',
  };
  const contentTypes = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" /><Default Extension="png" ContentType="" /><Default Extension="jpg" ContentType="" /><Default Extension="gif" ContentType="" />' +
    '<Override PartName="/Version" ContentType="" /><Override PartName="/DataModelSchema" ContentType="" /><Override PartName="/DiagramLayout" ContentType="" />' +
    '<Override PartName="/Report/Layout" ContentType="" /><Override PartName="/Settings" ContentType="application/json" /><Override PartName="/Metadata" ContentType="application/json" /></Types>';
  return [
    { path: 'Version', utf16: '1.28' },
    { path: '[Content_Types].xml', utf8bom: contentTypes },
    { path: 'DataModelSchema', utf16: JSON.stringify(buildModelSchema(report, tables)) },
    { path: 'DiagramLayout', utf16: JSON.stringify(diagram) },
    { path: 'Report/Layout', utf16: layout },
    { path: 'Settings', utf16: JSON.stringify({ Version: 4, ReportSettings: {}, QueriesSettings: { TypeDetectionEnabled: true, RelationshipImportEnabled: true, Version: '2.128.184.0' } }) },
    { path: 'Metadata', utf16: JSON.stringify({ Version: 5, AutoCreatedRelationships: [], CreatedFrom: 'Cloud', CreatedFromRelease: '2025.10' }) },
    ...Object.entries(resources).map(([n, d]) => ({ path: `Report/StaticResources/RegisteredResources/${n}`, dataUrl: d })),
  ];
}

// ---------- Power BI service publishing (electron/powerbi.cjs) ----------

const PUSH_TYPES: Record<string, string> = { int64: 'Int64', double: 'Double', decimal: 'Double', boolean: 'Boolean', dateTime: 'DateTime', string: 'String' };

/** Push dataset definition (Power BI Pro): calculated columns and tables travel as plain data,
 *  measure-only tables get a hidden placeholder column, `rows` is used for limits and progress. */
export function buildPushSchema(report: Report, tables: TableMeta[]) {
  const warnings: string[] = [];
  const measuresOf = (table: string) => report.measures.filter((m) => m.table === table)
    .map((m) => ({ name: m.name, expression: m.expression, ...(m.formatString ? { formatString: m.formatString } : {}) }));
  const measureOnly = [...new Set(report.measures.map((m) => m.table))].filter((n) => !tables.some((t) => t.name === n));
  const calc = tables.filter((t) => t.calcColumns?.length || t.source.dax).map((t) => t.name);
  if (calc.length) warnings.push(`Colonne e tabelle calcolate pubblicate come valori fissi (${calc.join(', ')}): vengono ricalcolate a ogni nuova pubblicazione.`);
  const relationships = report.relationships.filter((r) => {
    if (!r.active) { warnings.push(`Relazione inattiva ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] non supportata dai dataset push: omessa.`); return false; }
    if (r.cardinality === 'manyToMany') { warnings.push(`Relazione molti-a-molti ${r.fromTable} → ${r.toTable} non supportata dai dataset push: omessa.`); return false; }
    return true;
  }).map((r) => ({
    name: r.id, fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn,
    crossFilteringBehavior: r.crossFilter === 'both' || r.cardinality === 'oneToOne' ? 'BothDirections' : 'OneDirection',
  }));
  const schema = {
    tables: [
      ...tables.map((t) => ({
        name: t.name,
        rows: t.rowCount,
        columns: t.columns.map((c) => {
          const tt = tomType(c.type);
          return {
            name: c.name, dataType: PUSH_TYPES[tt.dataType],
            ...(tt.dataType === 'dateTime' ? { formatString: tt.m === 'type date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:nn:ss' } : {}),
            ...(t.sortBy?.[c.name] ? { sortByColumn: t.sortBy[c.name] } : {}),
            summarizeBy: ['int64', 'double', 'decimal'].includes(tt.dataType) ? 'sum' : 'none',
          };
        }),
        measures: measuresOf(t.name),
      })),
      ...measureOnly.map((name) => ({ name, rows: 0, virtual: true, columns: [{ name: 'Colonna1', dataType: 'String', isHidden: true }], measures: measuresOf(name) })),
    ],
    relationships,
  };
  return { schema, warnings };
}

/** Report part of a publication: report.json and images, paths relative to the report item. */
export function buildReportParts(report: Report): { path: string; text?: string; dataUrl?: string }[] {
  const { layout, resources } = buildLayout(report.pages, report.reportFilters, report.theme);
  return [
    { path: 'report.json', text: layout },
    ...Object.entries(resources).map(([n, d]) => ({ path: `StaticResources/RegisteredResources/${n}`, dataUrl: d })),
  ];
}

/** Thin report (.pbix without data model): layout + live connection to a dataset of the service.
 *  __DATASET_ID__ / __REPORT_ID__ / __WORKSPACE_ID__ are filled in once the dataset exists. */
export function buildThinPbixParts(report: Report): (PbitPart & { utf8?: string })[] {
  const { layout, resources } = buildLayout(report.pages, report.reportFilters, report.theme);
  const contentTypes = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="json" ContentType="" /><Default Extension="png" ContentType="" /><Default Extension="jpg" ContentType="" /><Default Extension="gif" ContentType="" />' +
    '<Override PartName="/Version" ContentType="" /><Override PartName="/Connections" ContentType="" />' +
    '<Override PartName="/Report/Layout" ContentType="" /><Override PartName="/Settings" ContentType="" /><Override PartName="/Metadata" ContentType="" /></Types>';
  const connections = {
    Version: 3,
    Connections: [{
      Name: 'EntityDataSource',
      ConnectionString: 'Data Source=pbiazure://api.powerbi.com/;Initial Catalog=__DATASET_ID__;Integrated Security=ClaimsToken',
      ConnectionType: 'pbiServiceXmlaStyleLive',
      PbiServiceModelId: null,
      PbiModelVirtualServerName: 'sobe_wowvirtualserver',
      PbiModelDatabaseName: '__DATASET_ID__',
    }],
    RemoteArtifacts: [{ DatasetId: '__DATASET_ID__', ReportId: '__REPORT_ID__' }],
    OriginalWorkspaceObjectId: '__WORKSPACE_ID__',
  };
  return [
    { path: 'Version', utf16: '1.28' },
    { path: '[Content_Types].xml', utf8bom: contentTypes },
    { path: 'Connections', utf8: JSON.stringify(connections) },
    { path: 'Report/Layout', utf16: layout },
    { path: 'Settings', utf16: JSON.stringify({ Version: 4, ReportSettings: {}, QueriesSettings: { TypeDetectionEnabled: true, RelationshipImportEnabled: true, Version: '2.128.184.0' } }) },
    { path: 'Metadata', utf16: JSON.stringify({ Version: 5, AutoCreatedRelationships: [], CreatedFrom: 'Cloud', CreatedFromRelease: '2025.10' }) },
    ...Object.entries(resources).map(([n, d]) => ({ path: `Report/StaticResources/RegisteredResources/${n}`, dataUrl: d })),
  ];
}

/** Full semantic model for Fabric: TMSL plus the tables whose data is embedded in their M
 *  (all of them, or only the non-database ones when `keepDb`). Calculated objects keep their DAX. */
export function buildFabricModel(report: Report, tables: TableMeta[], keepDb: boolean) {
  const model = buildModelSchema(report, tables);
  const warnings: string[] = [];
  const embed = tables.filter((t) => !t.source.dax && !(keepDb && t.source.db && t.source.db.kind !== 'sqlite')).map((t) => ({
    table: t.name,
    columns: t.columns.filter((c) => !t.calcColumns?.some((x) => x.name === c.name)).map((c) => ({ name: c.name, m: tomType(c.type).m })),
  }));
  const kept = tables.filter((t) => keepDb && t.source.db && t.source.db.kind !== 'sqlite').map((t) => t.name);
  if (kept.length) warnings.push(`Tabelle collegate al database (${kept.join(', ')}): il servizio deve poter raggiungere il server, altrimenti serve un gateway dati locale.`);
  return { model, embed, warnings };
}
