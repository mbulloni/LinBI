// Database sources that DuckDB cannot attach (Get Data › Database): each driver streams a query into a typed CSV
// that DuckDB turns into a Parquet cache (userData/db-cache), read by the Power Query compiler like any file.
// Adapter: open(c, secret) → handle, list(h) → [{ schema, table, view }], query(h, sql, limit, onColumns, onRow),
// select(schema, table) → SQL text, close(h). onColumns gets [{ name, type }] with DuckDB types.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().replace('T', ' ').replace('Z', '') : null);
const bq = (s) => '`' + String(s).replace(/`/g, '``') + '`';
const dq = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const sq = (s) => '[' + String(s).replace(/]/g, ']]') + ']';

// ---------- SQL Server / Azure SQL / Synapse / Fabric SQL endpoint (tedious, pure JS) ----------

function mssqlType(col) {
  const t = String(col.type?.declaration ?? col.type?.name ?? '').toLowerCase();
  if (t === 'bit') return 'BOOLEAN';
  if (t === 'tinyint' || t === 'smallint') return 'SMALLINT';
  if (t === 'int') return 'INTEGER';
  if (t === 'bigint') return 'BIGINT';
  if (t === 'decimal' || t === 'numeric') return `DECIMAL(${Math.min(col.precision || 18, 38)},${col.scale ?? 0})`;
  if (t === 'money') return 'DECIMAL(19,4)';
  if (t === 'smallmoney') return 'DECIMAL(10,4)';
  if (t === 'float') return 'DOUBLE';
  if (t === 'real') return 'FLOAT';
  if (t === 'date') return 'DATE';
  if (t === 'time') return 'TIME';
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') return 'TIMESTAMP';
  if (t === 'datetimeoffset') return 'TIMESTAMPTZ';
  if (t === 'binary' || t === 'varbinary' || t === 'image' || t === 'udt' || t === 'timestamp') return 'BLOB';
  return 'VARCHAR';
}

const sqlserver = {
  label: 'SQL Server', port: '1433',
  async open(c, secret) {
    const sql = require('mssql');
    const [server, inst] = (c.host || 'localhost').split('\\');
    const auth = c.auth || 'sql';
    const authentication = auth === 'windows' ? { type: 'ntlm', options: { domain: c.domain || '', userName: c.user || '', password: secret ?? '' } }
      : auth === 'entra' ? { type: 'azure-active-directory-password', options: { userName: c.user, password: secret ?? '', clientId: c.clientId || undefined, tenantId: c.tenant || undefined } }
        : auth === 'token' ? { type: 'azure-active-directory-access-token', options: { token: secret } }
          : { type: 'default', options: { userName: c.user || '', password: secret ?? '' } };
    const pool = new sql.ConnectionPool({
      server, port: c.port ? Number(c.port) : inst ? undefined : 1433, database: c.database || undefined,
      authentication, connectionTimeout: 20000, requestTimeout: 0,
      options: { encrypt: c.encrypt !== false, trustServerCertificate: !!c.trustCert, instanceName: inst || undefined, useUTC: true, enableArithAbort: true },
    });
    await pool.connect();
    return pool;
  },
  async list(pool) {
    const r = await pool.request().query(`SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t, TABLE_TYPE AS k FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA') ORDER BY 1, 2`);
    return r.recordset.map((x) => ({ schema: x.s, table: x.t, view: x.k === 'VIEW' }));
  },
  select: (schema, table) => `SELECT * FROM ${sq(schema)}.${sq(table)}`,
  query(pool, text, limit, onColumns, onRow) {
    return new Promise((resolve, reject) => {
      const req = pool.request();
      req.stream = true;
      let cols = null, n = 0, stopped = false;
      req.on('recordset', (meta) => {
        cols = Object.values(meta).sort((a, b) => a.index - b.index).map((m) => ({ name: m.name, type: mssqlType(m) }));
        onColumns(cols);
      });
      req.on('row', (row) => {
        if (stopped) return;
        onRow(cols.map((c) => row[c.name]));
        if (limit && ++n >= limit) { stopped = true; req.cancel(); }
      });
      req.on('error', (e) => (stopped && /cancel/i.test(e.message) ? resolve() : reject(e)));
      req.on('done', () => resolve());
      req.query(limit ? `SELECT TOP ${limit} * FROM (${text}) AS q` : text);
    });
  },
  close: (pool) => pool.close(),
};

// ---------- Oracle (node-oracledb thin mode, no Instant Client) ----------

function oracleType(m) {
  const oracledb = require('oracledb');
  const t = m.dbType;
  if (t === oracledb.DB_TYPE_NUMBER) return m.scale === 0 && m.precision && m.precision <= 18 ? 'BIGINT' : m.scale > 0 && m.precision ? `DECIMAL(${Math.min(m.precision, 38)},${m.scale})` : 'DOUBLE';
  if (t === oracledb.DB_TYPE_BINARY_FLOAT || t === oracledb.DB_TYPE_BINARY_DOUBLE) return 'DOUBLE';
  if (t === oracledb.DB_TYPE_DATE || t === oracledb.DB_TYPE_TIMESTAMP || t === oracledb.DB_TYPE_TIMESTAMP_LTZ) return 'TIMESTAMP';
  if (t === oracledb.DB_TYPE_TIMESTAMP_TZ) return 'TIMESTAMPTZ';
  if (t === oracledb.DB_TYPE_RAW || t === oracledb.DB_TYPE_BLOB || t === oracledb.DB_TYPE_LONG_RAW) return 'BLOB';
  if (t === oracledb.DB_TYPE_BOOLEAN) return 'BOOLEAN';
  return 'VARCHAR';
}

const oracle = {
  label: 'Oracle Database', port: '1521',
  async open(c, secret) {
    const oracledb = require('oracledb');
    oracledb.fetchAsString = [oracledb.CLOB];
    oracledb.fetchAsBuffer = [oracledb.BLOB];
    const connectString = c.host?.includes('/') || c.host?.includes('(') ? c.host : `${c.host || 'localhost'}:${c.port || 1521}/${c.database || 'FREEPDB1'}`;
    return oracledb.getConnection({ user: c.user, password: secret ?? '', connectString });
  },
  async list(conn) {
    const r = await conn.execute(`SELECT owner, table_name, 0 FROM all_tables WHERE owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y')
      UNION ALL SELECT owner, view_name, 1 FROM all_views WHERE owner NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y') ORDER BY 1, 2`);
    return r.rows.map(([s, t, v]) => ({ schema: s, table: t, view: v === 1 }));
  },
  select: (schema, table) => `SELECT * FROM ${dq(schema)}.${dq(table)}`,
  async query(conn, text, limit, onColumns, onRow) {
    const sql = limit ? `SELECT * FROM (${text}) WHERE ROWNUM <= ${limit}` : text;
    const rs = (await conn.execute(sql, [], { resultSet: true, fetchArraySize: 5000 })).resultSet;
    onColumns(rs.metaData.map((m) => ({ name: m.name, type: oracleType(m) })));
    for (;;) {
      const rows = await rs.getRows(5000);
      for (const r of rows) onRow(r);
      if (rows.length < 5000) break;
    }
    await rs.close();
  },
  close: (conn) => conn.close(),
};

// ---------- ClickHouse (HTTP) ----------

function clickhouseType(t) {
  const s = t.replace(/^Nullable\((.*)\)$/, '$1').replace(/^LowCardinality\((.*)\)$/, '$1').replace(/^Nullable\((.*)\)$/, '$1');
  if (/^U?Int(8|16|32)$/.test(s)) return 'INTEGER';
  if (/^U?Int(64|128|256)$/.test(s)) return 'BIGINT';
  if (/^Float/.test(s)) return 'DOUBLE';
  const d = /^Decimal(?:\d+)?\((\d+),\s*(\d+)\)/.exec(s);
  if (d) return `DECIMAL(${Math.min(+d[1], 38)},${d[2]})`;
  if (/^Date(32)?$/.test(s)) return 'DATE';
  if (/^DateTime/.test(s)) return 'TIMESTAMP';
  if (s === 'Bool') return 'BOOLEAN';
  return 'VARCHAR';
}

const clickhouse = {
  label: 'ClickHouse', port: '8123',
  async open(c, secret) {
    const { createClient } = require('@clickhouse/client');
    const url = /^https?:/.test(c.host || '') ? c.host : `${c.encrypt ? 'https' : 'http'}://${c.host || 'localhost'}:${c.port || 8123}`;
    const client = createClient({ url, username: c.user || 'default', password: secret ?? '', database: c.database || 'default', request_timeout: 0 });
    await client.ping().then((r) => { if (!r.success) throw r.error; });
    return client;
  },
  async list(client) {
    const r = await (await client.query({ query: `SELECT database, name, engine LIKE '%View' FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') ORDER BY 1, 2`, format: 'JSONCompact' })).json();
    return r.data.map(([s, t, v]) => ({ schema: s, table: t, view: !!v }));
  },
  select: (schema, table) => `SELECT * FROM ${bq(schema)}.${bq(table)}`,
  async query(client, text, limit, onColumns, onRow) {
    const rs = await client.query({ query: limit ? `SELECT * FROM (${text}) LIMIT ${limit}` : text, format: 'JSONCompactEachRowWithNamesAndTypes' });
    let names = null, k = 0;
    for await (const rows of rs.stream()) {
      for (const r of rows) {
        const v = r.json();
        if (k === 0) names = v;
        else if (k === 1) onColumns(names.map((n, i) => ({ name: n, type: clickhouseType(v[i]) })));
        else onRow(v);
        k++;
      }
    }
  },
  close: (client) => client.close(),
};

// ---------- MongoDB (collections → tables, nested fields flattened as a.b, arrays as JSON text) ----------

function flatten(doc, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(doc)) {
    const key = prefix + k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v._bsontype === undefined) flatten(v, key + '.', out);
    else out[key] = v;
  }
  return out;
}

const ISO_DATETIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/;

function mongoType(values) {
  const vs = values.filter((v) => v !== null && v !== undefined);
  if (!vs.length) return 'VARCHAR';
  if (vs.every((v) => typeof v === 'boolean')) return 'BOOLEAN';
  if (vs.every((v) => typeof v === 'number' && Number.isInteger(v)) || vs.every((v) => v?._bsontype === 'Long')) return 'BIGINT';
  if (vs.every((v) => typeof v === 'number' || ['Double', 'Int32', 'Long', 'Decimal128'].includes(v?._bsontype))) return 'DOUBLE';
  if (vs.every((v) => v instanceof Date)) return 'TIMESTAMP';
  if (vs.every((v) => typeof v === 'string' && ISO_DATETIME.test(v))) return 'TIMESTAMP';
  return 'VARCHAR';
}

const mongodb = {
  label: 'MongoDB', port: '27017',
  async open(c, secret) {
    const { MongoClient } = require('mongodb');
    const url = /^mongodb(\+srv)?:/.test(c.host || '') ? c.host
      : `mongodb://${c.user ? `${encodeURIComponent(c.user)}:${encodeURIComponent(secret ?? '')}@` : ''}${c.host || 'localhost'}:${c.port || 27017}/?authSource=${encodeURIComponent(c.authDb || 'admin')}`;
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    return { client, db: client.db(c.database || 'test') };
  },
  async list(h) {
    const cs = await h.db.listCollections({}, { nameOnly: true }).toArray();
    return cs.filter((x) => !x.name.startsWith('system.')).map((x) => ({ schema: h.db.databaseName, table: x.name, view: x.type === 'view' }));
  },
  // the "SQL" of a collection is its name (an optional JSON filter after a newline)
  select: (schema, table) => table,
  async query(h, text, limit, onColumns, onRow) {
    const [coll, filter] = text.split('\n');
    const sample = (await h.db.collection(coll).find(filter ? JSON.parse(filter) : {}).limit(1000).toArray()).map((d) => flatten(d));
    const names = [...new Set(sample.flatMap((d) => Object.keys(d)))];
    const cols = names.map((n) => ({ name: n, type: mongoType(sample.map((d) => d[n])) }));
    onColumns(cols);
    const cur = h.db.collection(coll).find(filter ? JSON.parse(filter) : {});
    if (limit) cur.limit(limit);
    for await (const d of cur) {
      const f = flatten(d);
      onRow(names.map((n) => {
        const v = f[n];
        if (v === undefined || v === null) return null;
        if (v._bsontype === 'ObjectId') return v.toHexString();
        if (v._bsontype === 'Decimal128' || v._bsontype === 'Long') return Number(v.toString());
        if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) return JSON.stringify(v);
        return v;
      }));
    }
  },
  close: (h) => h.client.close(),
};

// ---------- Microsoft Access (.mdb/.accdb, pure JS reader) ----------

function accessType(t) {
  return { boolean: 'BOOLEAN', byte: 'SMALLINT', integer: 'SMALLINT', long: 'INTEGER', bigint: 'BIGINT', single: 'FLOAT', double: 'DOUBLE',
    currency: 'DECIMAL(19,4)', numeric: 'DOUBLE', datetime: 'TIMESTAMP', datetimeextended: 'TIMESTAMP', binary: 'BLOB', ole: 'BLOB' }[t] || 'VARCHAR';
}

const access = {
  label: 'Microsoft Access', port: '',
  async open(c) {
    const { default: MDBReader } = await import('mdb-reader');
    if (!fs.existsSync(c.file || '')) throw new Error(`File Access non trovato: ${c.file}`);
    return new MDBReader(fs.readFileSync(c.file));
  },
  async list(r) { return r.getTableNames().map((t) => ({ schema: '', table: t, view: false })); },
  select: (schema, table) => table,
  async query(r, text, limit, onColumns, onRow) {
    const t = r.getTable(text);
    const cols = t.getColumns();
    onColumns(cols.map((c) => ({ name: c.name, type: accessType(c.type) })));
    for (const row of t.getData({ rowLimit: limit || undefined })) onRow(cols.map((c) => row[c.name]));
  },
  close: () => {},
};

// ---------- Snowflake ----------

function snowflakeType(c) {
  const t = c.getType().toLowerCase();
  if (t === 'number' || t === 'fixed') return c.getScale() ? `DECIMAL(${Math.min(c.getPrecision(), 38)},${c.getScale()})` : 'BIGINT';
  if (t === 'real') return 'DOUBLE';
  if (t === 'boolean') return 'BOOLEAN';
  if (t === 'date') return 'DATE';
  if (t === 'time') return 'TIME';
  if (t.startsWith('timestamp')) return t === 'timestamp_tz' ? 'TIMESTAMPTZ' : 'TIMESTAMP';
  if (t === 'binary') return 'BLOB';
  return 'VARCHAR';
}

const snowflake = {
  label: 'Snowflake', port: '',
  async open(c, secret) {
    const sf = require('snowflake-sdk');
    sf.configure({ logLevel: 'ERROR' });
    const account = (c.host || '').replace(/^https?:\/\//, '').replace(/\.snowflakecomputing\.com.*$/, '');
    const conn = sf.createConnection({ account, username: c.user, password: c.auth === 'keypair' ? undefined : secret, privateKey: c.auth === 'keypair' ? secret : undefined,
      authenticator: c.auth === 'keypair' ? 'SNOWFLAKE_JWT' : c.auth === 'browser' ? 'EXTERNALBROWSER' : 'SNOWFLAKE',
      warehouse: c.warehouse || undefined, database: c.database || undefined, role: c.role || undefined });
    await (c.auth === 'browser' ? conn.connectAsync() : new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res()))));
    return conn;
  },
  async list(conn) {
    const rows = await snowflake.rows(conn, `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema <> 'INFORMATION_SCHEMA' ORDER BY 1, 2`);
    return rows.map((r) => ({ schema: r.TABLE_SCHEMA, table: r.TABLE_NAME, view: r.TABLE_TYPE === 'VIEW' }));
  },
  rows: (conn, sqlText) => new Promise((res, rej) => conn.execute({ sqlText, complete: (e, _s, rows) => (e ? rej(e) : res(rows)) })),
  select: (schema, table) => `SELECT * FROM ${dq(schema)}.${dq(table)}`,
  query(conn, text, limit, onColumns, onRow) {
    return new Promise((resolve, reject) => {
      conn.execute({
        sqlText: limit ? `SELECT * FROM (${text}) LIMIT ${limit}` : text, streamResult: true,
        complete: (e, stmt) => {
          if (e) return reject(e);
          const cols = stmt.getColumns();
          onColumns(cols.map((c) => ({ name: c.getName(), type: snowflakeType(c) })));
          stmt.streamRows().on('data', (r) => onRow(cols.map((c) => r[c.getName()]))).on('error', reject).on('end', resolve);
        },
      });
    });
  },
  close: (conn) => new Promise((res) => conn.destroy(() => res())),
};

// ---------- Google BigQuery (service account key file or application default credentials) ----------

function bigqueryType(f) {
  const t = f.type;
  if (f.mode === 'REPEATED' || t === 'RECORD' || t === 'STRUCT' || t === 'JSON') return 'VARCHAR';
  return { INTEGER: 'BIGINT', INT64: 'BIGINT', FLOAT: 'DOUBLE', FLOAT64: 'DOUBLE', NUMERIC: 'DECIMAL(38,9)', BIGNUMERIC: 'DOUBLE', BOOLEAN: 'BOOLEAN',
    BOOL: 'BOOLEAN', DATE: 'DATE', DATETIME: 'TIMESTAMP', TIMESTAMP: 'TIMESTAMPTZ', TIME: 'TIME', BYTES: 'BLOB' }[t] || 'VARCHAR';
}

/** BigQuery values: wrapped dates/timestamps ({ value }), NUMERIC as Big objects, records/arrays as JSON text. */
function bigqueryValue(v) {
  if (!v || typeof v !== 'object' || v instanceof Date || Buffer.isBuffer(v)) return v;
  if ('value' in v) return v.value;
  if (v.constructor?.name === 'Big' || typeof v.toFixed === 'function') return v.toString();
  return JSON.stringify(v);
}

const bigquery = {
  label: 'Google BigQuery', port: '',
  async open(c) {
    const { BigQuery } = require('@google-cloud/bigquery');
    return new BigQuery({ projectId: c.database || undefined, keyFilename: c.file || undefined, apiEndpoint: c.host || undefined });
  },
  async list(bqc) {
    const [datasets] = await bqc.getDatasets();
    const out = [];
    // anonymous result datasets (leading "_", or job UUIDs in the emulator) are not user data
    for (const ds of datasets.filter((d) => !d.id.startsWith('_') && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(d.id))) {
      const [tables] = await ds.getTables();
      for (const t of tables) out.push({ schema: ds.id, table: t.id, view: t.metadata?.type === 'VIEW' });
    }
    return out;
  },
  select: (schema, table) => `SELECT * FROM ${bq(schema)}.${bq(table)}`,
  async query(bqc, text, limit, onColumns, onRow) {
    const [job] = await bqc.createQueryJob({ query: limit ? `SELECT * FROM (${text}) LIMIT ${limit}` : text });
    let pageToken, first = true, fields;
    do {
      const [rows, next, resp] = await job.getQueryResults({ maxResults: 10000, pageToken, autoPaginate: false });
      if (first) { fields = resp.schema.fields; onColumns(fields.map((f) => ({ name: f.name, type: bigqueryType(f) }))); first = false; }
      for (const r of rows) onRow(fields.map((f) => bigqueryValue(r[f.name])));
      pageToken = next?.pageToken;
    } while (pageToken);
  },
  close: () => {},
};

// ---------- Azure Databricks / Databricks SQL warehouse ----------

const databricks = {
  label: 'Databricks', port: '',
  async open(c, secret) {
    const { DBSQLClient } = require('@databricks/sql');
    const client = new DBSQLClient();
    await client.connect({ host: (c.host || '').replace(/^https?:\/\//, ''), path: c.httpPath, token: secret });
    const session = await client.openSession(c.database ? { initialCatalog: c.database } : {});
    return { client, session };
  },
  async list(h) {
    const op = await h.session.executeStatement(`SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema <> 'information_schema' ORDER BY 1, 2`);
    const rows = await op.fetchAll(); await op.close();
    return rows.map((r) => ({ schema: r.table_schema, table: r.table_name, view: /VIEW/i.test(r.table_type) }));
  },
  select: (schema, table) => `SELECT * FROM ${bq(schema)}.${bq(table)}`,
  async query(h, text, limit, onColumns, onRow) {
    const op = await h.session.executeStatement(limit ? `SELECT * FROM (${text}) LIMIT ${limit}` : text);
    const schema = await op.getSchema();
    const map = (t) => ({ BOOLEAN_TYPE: 'BOOLEAN', TINYINT_TYPE: 'INTEGER', SMALLINT_TYPE: 'INTEGER', INT_TYPE: 'INTEGER', BIGINT_TYPE: 'BIGINT', FLOAT_TYPE: 'FLOAT',
      DOUBLE_TYPE: 'DOUBLE', DECIMAL_TYPE: 'DOUBLE', DATE_TYPE: 'DATE', TIMESTAMP_TYPE: 'TIMESTAMP', BINARY_TYPE: 'BLOB' }[t] || 'VARCHAR');
    const cols = schema.columns.map((c) => ({ name: c.columnName, type: map(c.typeDesc.types[0].primitiveEntry?.type) }));
    onColumns(cols);
    while (await op.hasMoreRows()) for (const r of await op.fetchChunk({ maxRows: 10000 })) onRow(cols.map((c) => r[c.name]));
    await op.close();
  },
  close: async (h) => { await h.session.close(); await h.client.close(); },
};

// ---------- ODBC (any driver installed in unixODBC: SAP HANA, Db2, Teradata, Informix, Vertica, Exasol…) ----------

function odbcType(c) {
  // ODBC SQL type codes (sql.h)
  const t = c.dataType;
  if (t === -7) return 'BOOLEAN';
  if (t === -6 || t === 5) return 'SMALLINT';
  if (t === 4) return 'INTEGER';
  if (t === -5) return 'BIGINT';
  if (t === 2 || t === 3) return c.columnSize && c.columnSize <= 38 ? `DECIMAL(${c.columnSize},${Math.max(0, c.decimalDigits || 0)})` : 'DOUBLE';
  if (t === 6 || t === 8) return 'DOUBLE';
  if (t === 7) return 'FLOAT';
  if (t === 91 || t === 9) return 'DATE';
  if (t === 92 || t === 10) return 'TIME';
  if (t === 93 || t === 11) return 'TIMESTAMP';
  if (t === -2 || t === -3 || t === -4) return 'BLOB';
  return 'VARCHAR';
}

const odbc = {
  label: 'ODBC', port: '',
  async open(c, secret) {
    let lib;
    try { lib = require('odbc'); } catch (e) { throw new Error('Il modulo ODBC non è disponibile: installare unixODBC (sudo apt install unixodbc) e il driver ODBC del database.'); }
    const base = c.host || '';
    const cs = /=/.test(base) ? base : `DSN=${base}`;
    return lib.connect(cs + (c.user ? `;UID=${c.user}` : '') + (secret ? `;PWD=${secret}` : ''));
  },
  async list(conn) {
    const rows = [...await conn.tables(null, null, null, 'TABLE'), ...await conn.tables(null, null, null, 'VIEW')];
    return rows.map((r) => ({ schema: r.TABLE_SCHEM ?? '', table: r.TABLE_NAME, view: r.TABLE_TYPE === 'VIEW' }));
  },
  select: (schema, table) => `SELECT * FROM ${schema ? dq(schema) + '.' : ''}${dq(table)}`,
  async query(conn, text, limit, onColumns, onRow) {
    const cur = await conn.query(text, { cursor: true, fetchSize: 5000 });
    let first = true, n = 0;
    try {
      for (;;) {
        const rows = await cur.fetch();
        if (first) {
          onColumns(rows.columns.map((c) => ({ name: c.name, type: odbcType(c) })));
          first = false;
        }
        for (const r of rows) {
          onRow(rows.columns.map((c) => r[c.name]));
          if (limit && ++n >= limit) return;
        }
        if (!rows.length || cur.noData) return;
      }
    } finally { await cur.close().catch(() => {}); }
  },
  close: (conn) => conn.close(),
};

// ---------- Azure Data Explorer (Kusto) and Dataverse: REST with the Microsoft account of LinBI ----------

// LINBI_MS_TOKEN (tests against mock servers) replaces the Entra token.
const msToken = (resource) => process.env.LINBI_MS_TOKEN || require('./powerbi.cjs').token(`${resource.replace(/\/$/, '')}/.default`);
const httpsUrl = (h) => (/^https?:\/\//.test(h) ? h : `https://${h}`).replace(/\/$/, '');

function kustoType(t) {
  // ColumnType (Kusto names) or DataType (.NET names in REST v1)
  return { bool: 'BOOLEAN', boolean: 'BOOLEAN', int: 'INTEGER', int32: 'INTEGER', sbyte: 'INTEGER', int16: 'INTEGER', long: 'BIGINT', int64: 'BIGINT',
    real: 'DOUBLE', double: 'DOUBLE', single: 'DOUBLE', decimal: 'DOUBLE', sqldecimal: 'DOUBLE', datetime: 'TIMESTAMP', date: 'TIMESTAMP' }[String(t).toLowerCase()] || 'VARCHAR';
}

const kusto = {
  label: 'Azure Data Explorer', port: '',
  async open(c) {
    const url = httpsUrl(c.host);
    return { url, db: c.database, token: await msToken(url) };
  },
  async run(h, csl, mgmt = false) {
    const r = await fetch(`${h.url}/v1/rest/${mgmt ? 'mgmt' : 'query'}`, { method: 'POST', headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ db: h.db, csl }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Azure Data Explorer: ${j.error?.['@message'] || j.error?.message || r.status}`);
    return j.Tables[0];
  },
  async list(h) {
    const t = await kusto.run(h, '.show tables', true);
    const i = t.Columns.findIndex((c) => c.ColumnName === 'TableName');
    return t.Rows.map((r) => ({ schema: h.db, table: r[i], view: false }));
  },
  select: (schema, table) => `['${String(table).replace(/'/g, "\\'")}']`,
  async query(h, text, limit, onColumns, onRow) {
    const t = await kusto.run(h, limit ? `${text}\n| take ${limit}` : text);
    onColumns(t.Columns.map((c) => ({ name: c.ColumnName, type: kustoType(c.DataType || c.ColumnType) })));
    for (const r of t.Rows) onRow(r.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)));
  },
  close: () => {},
};

const dataverse = {
  label: 'Dataverse', port: '',
  async open(c) {
    const url = httpsUrl(c.host);
    return { url, token: await msToken(url) };
  },
  async get(h, path) {
    const r = await fetch(path.startsWith('http') ? path : `${h.url}/api/data/v9.2/${path}`, { headers: { Authorization: `Bearer ${h.token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=5000' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Dataverse: ${j.error?.message || r.status}`);
    return j;
  },
  async list(h) {
    const j = await dataverse.get(h, "EntityDefinitions?$select=LogicalName,EntitySetName&$filter=IsValidForAdvancedFind eq true and IsPrivate eq false");
    return j.value.map((e) => ({ schema: 'dbo', table: e.EntitySetName, view: false })).sort((a, b) => a.table.localeCompare(b.table));
  },
  select: (schema, table) => table,
  async query(h, text, limit, onColumns, onRow) {
    let next = `${text}${limit ? `?$top=${limit}` : ''}`, cols = null, n = 0;
    while (next) {
      const j = await dataverse.get(h, next);
      const rows = j.value.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.includes('@'))));
      if (!cols) { const names = [...new Set(rows.flatMap((r) => Object.keys(r)))]; cols = names.map((name) => ({ name, type: mongoType(rows.map((r) => r[name])) })); onColumns(cols); }
      for (const r of rows) {
        onRow(cols.map((c) => (c.type === 'TIMESTAMP' && typeof r[c.name] === 'string' ? new Date(r[c.name]) : r[c.name] ?? null)));
        if (limit && ++n >= limit) return;
      }
      next = j['@odata.nextLink'];
    }
    if (!cols) onColumns([]);
  },
  close: () => {},
};

const ADAPTERS = { sqlserver, oracle, clickhouse, mongodb, access, snowflake, bigquery, databricks, odbc, kusto, dataverse };

// ---------- CSV bridge ----------

function csvValue(v, type) {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '\\N';
  if (type === 'BLOB') return Buffer.isBuffer(v) ? '"' + [...v].map((b) => '\\x' + b.toString(16).padStart(2, '0')).join('') + '"' : '\\N';
  if (v instanceof Date) {
    if (type === 'DATE') return iso(v)?.slice(0, 10) ?? '\\N';
    if (type === 'TIME') return iso(v)?.slice(11) ?? '\\N';
    return iso(v) ?? '\\N';
  }
  if (type === 'BOOLEAN') return v === true || v === 1 || v === '1' || v === 'true' ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '"' + String(v).replace(/"/g, '""') + '"';
}

/** Runs `sql` on the adapter and writes a Parquet file through a typed CSV. Returns { columns, rows }. */
async function fetchToParquet(adapter, handle, sql, file, db, limit = 0) {
  const tmp = file + '.csv';
  const out = fs.createWriteStream(tmp, { encoding: 'utf8' });
  let cols = null, rows = 0, buf = [];
  const flush = () => { if (buf.length) { out.write(buf.join('')); buf = []; } };
  await adapter.query(handle, sql, limit, (c) => {
    // DuckDB column names must be unique: repeat names get a suffix like Power Query does (Column.1)
    const seen = new Map();
    cols = c.map((x) => { const k = x.name || 'Colonna'; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return { ...x, name: n ? `${k}.${n}` : k }; });
  }, (r) => {
    buf.push(r.map((v, i) => csvValue(v, cols[i].type)).join(',') + '\n');
    rows++;
    if (buf.length >= 5000) flush();
  });
  flush();
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  if (!cols) throw new Error('La query non ha restituito colonne.');
  const struct = '{' + cols.map((c) => `'${c.name.replace(/'/g, "''")}': '${c.type}'`).join(', ') + '}';
  const q = (p) => "'" + p.replace(/'/g, "''") + "'";
  await db.query(`COPY (SELECT * FROM read_csv(${q(tmp)}, columns = ${struct}, header = false, nullstr = '\\N', quote = '"', escape = '"', delim = ',', auto_detect = false, max_line_size = 100000000)) TO ${q(file)} (FORMAT parquet)`);
  fs.rmSync(tmp, { force: true });
  return { columns: cols, rows };
}

const cacheKey = (key, sql) => crypto.createHash('sha1').update(key + '\u0001' + sql).digest('hex').slice(0, 20);

module.exports = { ADAPTERS, fetchToParquet, cacheKey, mssqlType };
