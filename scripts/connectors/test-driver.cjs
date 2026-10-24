// node scripts/connectors/test-driver.cjs '<connection json>' <secret> [table-or-sql...]
// Opens the driver, lists tables, fetches each given table (schema.table) or statement into Parquet through DuckDB
// and prints row counts, column types and the first rows.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { ADAPTERS, fetchToParquet } = require('../../electron/drivers.cjs');
const db = require('../../electron/db.cjs');
(async () => {
  const c = JSON.parse(process.argv[2]);
  const secret = process.argv[3] === '-' ? undefined : process.argv[3];
  const a = ADAPTERS[c.kind];
  let t = Date.now();
  const h = await a.open(c, secret);
  const tables = await a.list(h);
  console.log(`open+list ${Date.now() - t} ms:`, tables.map((x) => `${x.schema}.${x.table}${x.view ? ' (vista)' : ''}`).join(', '));
  for (const spec of process.argv.slice(4)) {
    const sql = /^(select|with)\s/i.test(spec) ? spec : (() => { const [s, ...r] = spec.split('.'); return a.select(s, r.join('.')); })();
    const file = path.join(os.tmpdir(), `mib-bi-drv-${Date.now()}.parquet`);
    t = Date.now();
    const r = await fetchToParquet(a, h, sql, file, db);
    const q = await db.query(`SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${file}')`);
    const d = await db.query(`DESCRIBE SELECT * FROM read_parquet('${file}')`);
    const head = await db.query(`SELECT * FROM read_parquet('${file}') LIMIT 3`);
    console.log(`\n== ${spec}: ${r.rows} righe lette, ${q.rows[0].n} nel Parquet, ${Date.now() - t} ms, ${fs.statSync(file).size} byte`);
    console.log('   tipi:', d.rows.map((x) => `${x.column_name}:${x.column_type}`).join(', '));
    for (const row of head.rows) console.log('  ', JSON.stringify(row));
    fs.rmSync(file);
  }
  await a.close(h);
  process.exit(0);
})().catch((e) => { console.error('ERRORE', e.message); process.exit(1); });
