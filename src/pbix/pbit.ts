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

export function buildPbitParts(report: Report, tables: TableMeta[]): PbitPart[] {
  const { layout, resources } = buildLayout(report.pages, report.reportFilters);
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
