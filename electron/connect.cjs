// Database sources (Get Data › Database): MySQL/MariaDB, PostgreSQL, SQLite through DuckDB's
// scanner extensions (ATTACH … READ_ONLY). Passwords never go into reports: they are kept in
// <userData>/credentials.json, encrypted with Electron safeStorage (system keyring) when available,
// otherwise only for the current session — like Power BI's data source credentials.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const db = require('./db.cjs');

const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const session = new Map();
const attached = new Map();

const credFile = () => path.join(app.getPath('userData'), 'credentials.json');

/** Identity of a connection (no password): also the key of its stored credentials. */
function keyOf(c) {
  if (c.kind === 'sqlite') return `sqlite://${c.file}`;
  return `${c.kind}://${c.user ?? ''}@${c.host ?? 'localhost'}:${c.port ?? ''}/${c.database ?? ''}`;
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(credFile(), 'utf8')); } catch { return {}; }
}

function savePassword(c, password) {
  const key = keyOf(c);
  session.set(key, password);
  if (!safeStorage.isEncryptionAvailable()) return false;
  const store = loadStore();
  store[key] = safeStorage.encryptString(password).toString('base64');
  fs.writeFileSync(credFile(), JSON.stringify(store, null, 2), { mode: 0o600 });
  return true;
}

function passwordOf(c) {
  const key = keyOf(c);
  if (session.has(key)) return session.get(key);
  const enc = loadStore()[key];
  if (enc && safeStorage.isEncryptionAvailable()) {
    try { const p = safeStorage.decryptString(Buffer.from(enc, 'base64')); session.set(key, p); return p; } catch { /* re-ask */ }
  }
  return undefined;
}

function forget(c) {
  const key = keyOf(c);
  session.delete(key);
  const store = loadStore();
  if (key in store) { delete store[key]; fs.writeFileSync(credFile(), JSON.stringify(store, null, 2), { mode: 0o600 }); }
}

/** ATTACHes the database once per session; returns its DuckDB alias. */
async function attach(c, password) {
  const key = keyOf(c);
  if (attached.has(key)) return attached.get(key);
  const alias = 'src_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
  let dsn, type;
  if (c.kind === 'sqlite') {
    if (!fs.existsSync(c.file)) throw new Error(`File SQLite non trovato: ${c.file}`);
    dsn = c.file; type = 'sqlite';
  } else {
    const pw = password ?? passwordOf(c);
    if (pw === undefined && c.user) {
      const err = new Error(`Credenziali mancanti per ${key}. Ricollegarsi da Ottieni dati › Database.`);
      err.code = 'NO_CREDENTIALS';
      throw err;
    }
    const parts = { host: c.host || 'localhost', port: c.port || undefined, user: c.user || undefined, password: pw, [c.kind === 'postgres' ? 'dbname' : 'database']: c.database || undefined };
    dsn = Object.entries(parts).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${String(v).includes(' ') ? `'${String(v).replace(/'/g, "\\'")}'` : v}`).join(' ');
    type = c.kind;
  }
  await db.query(`INSTALL ${type}; LOAD ${type};`);
  await db.query(`ATTACH ${ql(dsn)} AS ${qi(alias)} (TYPE ${type}, READ_ONLY)`);
  attached.set(key, alias);
  return alias;
}

/** Connects (validating credentials) and lists the user tables/views. */
async function connect(c, password, remember) {
  const key = keyOf(c);
  if (attached.has(key)) { await db.query(`DETACH ${qi(attached.get(key))}`).catch(() => {}); attached.delete(key); }
  const alias = await attach(c, password ?? undefined);
  if (password) { if (remember) savePassword(c, password); else session.set(key, password); }
  const r = await db.query(`SELECT schema_name AS s, table_name AS t, estimated_size AS n FROM duckdb_tables() WHERE database_name = ${ql(alias)}
    UNION ALL SELECT schema_name, view_name, NULL FROM duckdb_views() WHERE database_name = ${ql(alias)} AND NOT internal ORDER BY 1, 2`);
  let rows = r.rows;
  if (!rows.length) {
    // Some scanners only expose information_schema.
    const s = await db.query(`SELECT table_schema AS s, table_name AS t, NULL AS n FROM information_schema.tables WHERE table_catalog = ${ql(alias)}
      AND table_schema NOT IN ('information_schema', 'pg_catalog', 'mysql', 'performance_schema', 'sys') ORDER BY 1, 2`);
    rows = s.rows;
  }
  if (c.kind === 'mysql' && c.database) rows = rows.filter((x) => x.s === c.database);
  return { alias, tables: rows.map((x) => ({ schema: x.s, table: x.t, rows: x.n === null ? null : Number(x.n) })), stored: safeStorage.isEncryptionAvailable() };
}

/** SQL of a database table source (used by the Power Query compiler). */
async function sourceExpr(source) {
  const c = source.db;
  const alias = await attach(c);
  return `${qi(alias)}.${qi(c.schema)}.${qi(c.table)}`;
}

module.exports = { connect, sourceExpr, forget, keyOf };
