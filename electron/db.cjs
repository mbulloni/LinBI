// DuckDB engine: plays the role of VertiPaq. One in-memory database per session.
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');

let conn = null;

async function connection() {
  if (!conn) {
    const instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
  }
  return conn;
}

const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') return 'csv';
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return 'json';
  if (ext === '.parquet') return 'parquet';
  if (ext === '.xlsx') return 'excel';
  throw new Error('Formato file non supportato: ' + ext);
}

async function sourceExpr(file, sheet) {
  const kind = kindOf(file);
  if (kind === 'csv') return `read_csv_auto(${ql(file)})`;
  if (kind === 'json') return `read_json_auto(${ql(file)})`;
  if (kind === 'parquet') return `read_parquet(${ql(file)})`;
  const c = await connection();
  await c.run('INSTALL excel; LOAD excel;');
  return sheet ? `read_xlsx(${ql(file)}, sheet = ${ql(sheet)})` : `read_xlsx(${ql(file)})`;
}

async function query(sql) {
  const c = await connection();
  const reader = await c.runAndReadAll(sql);
  return { columns: reader.columnNames(), rows: reader.getRowObjectsJson() };
}

async function preview(file, sheet) {
  const expr = await sourceExpr(file, sheet);
  return query(`SELECT * FROM ${expr} LIMIT 50`);
}

async function describe(table) {
  const res = await query(`DESCRIBE ${qi(table)}`);
  const count = await query(`SELECT COUNT(*) AS n FROM ${qi(table)}`);
  return {
    name: table,
    rowCount: Number(count.rows[0].n),
    columns: res.rows.map((r) => ({ name: r.column_name, type: r.column_type })),
  };
}

async function importFile(file, tableName, sheet) {
  const expr = await sourceExpr(file, sheet);
  const c = await connection();
  await c.run(`CREATE OR REPLACE TABLE ${qi(tableName)} AS SELECT * FROM ${expr}`);
  return describe(tableName);
}

// Power Query result (SQL compiled by src/pq/compile.ts) materialised as a model table.
async function materialize(tableName, sql) {
  const c = await connection();
  await c.run(`CREATE OR REPLACE TABLE ${qi(tableName)} AS ${sql}`);
  return describe(tableName);
}

async function dropTable(name) {
  const c = await connection();
  await c.run(`DROP TABLE IF EXISTS ${qi(name)}`);
}

// Empty typed table: schema-only imports (.pbit whose sources are not reachable).
const TOM_TYPES = { int64: 'BIGINT', double: 'DOUBLE', decimal: 'DOUBLE', boolean: 'BOOLEAN', dateTime: 'TIMESTAMP', string: 'VARCHAR' };
async function createEmpty(table, columns) {
  const c = await connection();
  const cols = columns.map((x) => `${qi(x.name)} ${TOM_TYPES[x.dataType] || 'VARCHAR'}`).join(', ');
  await c.run(`CREATE OR REPLACE TABLE ${qi(table)} (${cols || '"_" VARCHAR'})`);
  return describe(table);
}

module.exports = { query, preview, importFile, materialize, sourceExpr, dropTable, createEmpty, kindOf };
