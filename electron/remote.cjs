// Web, OData and Folder sources (Power Query "Web", "Feed OData", "Cartella").
// Web and OData data are downloaded into userData/remote-cache (reused for 10 minutes; Aggiorna
// clears the cache) and read by DuckDB like local files. A folder combines every file with the
// chosen extension (columns aligned by name) and adds Source.Name, like "Combina file".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const db = require('./db.cjs');
const webcred = require('./webcred.cjs');

const TTL = 10 * 60 * 1000;
const dir = () => { const d = path.join(app.getPath('userData'), 'remote-cache'); fs.mkdirSync(d, { recursive: true }); return d; };
const ql = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`URL non valido: ${url}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Sono supportati solo indirizzi http:// e https://.');
  return u;
}

const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < TTL;

/** Format of a web file: explicit, from the URL extension, or from the Content-Type. */
function formatOf(url, contentType, explicit) {
  if (explicit) return explicit;
  const ext = path.extname(new URL(url).pathname).toLowerCase().replace('.', '');
  if (['csv', 'txt', 'tsv'].includes(ext)) return 'csv';
  if (['json', 'ndjson', 'jsonl'].includes(ext)) return 'json';
  if (ext === 'parquet') return 'parquet';
  if (ext === 'xlsx') return 'xlsx';
  if (/json/.test(contentType ?? '')) return 'json';
  if (/spreadsheetml/.test(contentType ?? '')) return 'xlsx';
  if (/parquet/.test(contentType ?? '')) return 'parquet';
  return 'csv';
}

async function get(url) {
  checkUrl(url);
  // Stored credentials of the URL (Impostazioni origine dati): basic, API key, header, Microsoft account.
  const req = await webcred.apply(url, { 'User-Agent': 'MiB-BI' });
  const r = await fetch(req.url, { headers: req.headers, redirect: 'follow' });
  if (r.status === 401 || r.status === 403) {
    const has = !!webcred.forUrl(url);
    throw new Error(`WEB_AUTH: ${has ? 'le credenziali salvate non sono valide' : 'il server richiede l\'autenticazione'} (${r.status}) per ${url}. Impostarle in Trasforma dati › Impostazioni origine dati.`);
  }
  if (!r.ok) throw new Error(`Web.Contents: il server ha risposto ${r.status} ${r.statusText} per ${url}`);
  return r;
}

/** Downloads a web file into the cache; returns its local path. */
async function webFile(url, format) {
  const base = path.join(dir(), hash(url + '|' + (format ?? '')));
  const known = ['csv', 'json', 'parquet', 'xlsx'].map((e) => `${base}.${e}`).find(fresh);
  if (known) return known;
  const r = await get(url);
  const fmt = formatOf(url, r.headers.get('content-type'), format);
  const file = `${base}.${fmt}`;
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

/** OData feed: every page (value + @odata.nextLink) into one JSON array. */
async function odataFile(url) {
  const file = path.join(dir(), hash('odata|' + url) + '.json');
  if (fresh(file)) return file;
  const rows = [];
  for (let next = url, pages = 0; next && pages < 1000; pages++) {
    const r = await get(next);
    const j = await r.json();
    const list = Array.isArray(j) ? j : Array.isArray(j.value) ? j.value : Array.isArray(j.d?.results) ? j.d.results : null;
    if (!list) throw new Error('OData.Feed: la risposta non contiene un elenco "value".');
    // Navigation/metadata properties are not columns.
    for (const x of list) rows.push(Object.fromEntries(Object.entries(x).filter(([k, v]) => !k.includes('@') && k !== '__metadata' && (v === null || typeof v !== 'object'))));
    next = j['@odata.nextLink'] ?? j['odata.nextLink'] ?? j.d?.__next ?? null;
    if (next) next = new URL(next, url).toString();
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  return file;
}

function folderExpr(folder, ext) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`Folder.Files: cartella non trovata: ${folder}`);
  const e = String(ext || 'csv').replace(/^\./, '').toLowerCase();
  const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.' + e));
  if (!files.length) throw new Error(`La cartella non contiene file .${e}.`);
  const glob = path.join(folder, `*.${e}`);
  const read = e === 'parquet' ? `read_parquet(${ql(glob)}, union_by_name = true, filename = true)`
    : ['json', 'jsonl', 'ndjson'].includes(e) ? `read_json_auto(${ql(glob)}, union_by_name = true, filename = true)`
      : `read_csv_auto(${ql(glob)}, union_by_name = true, filename = true)`;
  return `(SELECT regexp_extract(filename, '[^/]+$') AS "Source.Name", * EXCLUDE (filename) FROM ${read})`;
}

async function sourceExpr(source) {
  if (source.web) return db.sourceExpr(await webFile(source.web.url, source.web.format), source.sheet);
  if (source.odata) return db.sourceExpr(await odataFile(source.odata.url));
  if (source.folder) return folderExpr(source.folder.path, source.folder.ext);
  if (source.sharepoint) {
    const sp = require('./sharepoint.cjs');
    if (source.sharepoint.list) return db.sourceExpr(await sp.listFile(source.sharepoint));
    const { dir, ext } = await sp.filesDir(source.sharepoint);
    return folderExpr(dir, ext);
  }
  throw new Error('Origine non riconosciuta');
}

function clearCache() {
  // Files and SharePoint folders (sp-*).
  try { for (const f of fs.readdirSync(dir())) fs.rmSync(path.join(dir(), f), { force: true, recursive: true }); } catch { /* nothing cached */ }
}

module.exports = { sourceExpr, clearCache };
