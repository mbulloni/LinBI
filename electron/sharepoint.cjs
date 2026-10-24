// SharePoint Online sources (Power Query "Cartella SharePoint" = SharePoint.Files, "Elenco SharePoint Online" =
// SharePoint.Tables), read through Microsoft Graph with the Microsoft account of Home › Pubblica (same Entra
// app: it needs the delegated Graph permissions Sites.Read.All and Files.Read.All). Files are downloaded into
// userData/remote-cache/sp-<hash>/ and combined like a local folder; list items become a JSON file.
// MIBBI_GRAPH redirects Graph to a mock server and MIBBI_GRAPH_TOKEN skips sign-in (tests only).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const GRAPH = process.env.MIBBI_GRAPH || 'https://graph.microsoft.com/v1.0';
const TTL = 10 * 60 * 1000;
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const cacheDir = (key) => { const d = path.join(app.getPath('userData'), 'remote-cache', 'sp-' + hash(key)); fs.mkdirSync(d, { recursive: true }); return d; };

async function token() {
  if (process.env.MIBBI_GRAPH_TOKEN) return process.env.MIBBI_GRAPH_TOKEN;
  try { return await require('./powerbi.cjs').token('graph'); } catch (e) {
    throw new Error(`SharePoint: accedere con l'account Microsoft (Home › Pubblica › Accedi) con un'app Entra che abbia i permessi Microsoft Graph Sites.Read.All e Files.Read.All. ${e.message}`);
  }
}

async function graph(url, raw = false) {
  const r = await fetch(url.startsWith('http') ? url : GRAPH + url, { headers: { Authorization: 'Bearer ' + await token() } });
  if (r.status === 401 || r.status === 403) throw new Error(`SharePoint: accesso negato (${r.status}). Verificare i permessi dell'account o dell'app Entra (Sites.Read.All, Files.Read.All).`);
  if (r.status === 404) throw new Error('SharePoint: sito, cartella o elenco non trovato.');
  if (!r.ok) throw new Error(`SharePoint: errore ${r.status} ${r.statusText}`);
  return raw ? r : r.json();
}

/** All pages of a Graph collection (value + @odata.nextLink). */
async function all(url) {
  const out = [];
  for (let next = url, n = 0; next && n < 500; n++) { const j = await graph(next); out.push(...(j.value ?? [])); next = j['@odata.nextLink']; }
  return out;
}

/** https://contoso.sharepoint.com/sites/Vendite → Graph site id. */
async function siteId(siteUrl) {
  let u;
  try { u = new URL(siteUrl); } catch { throw new Error(`URL del sito SharePoint non valido: ${siteUrl}`); }
  if (u.protocol !== 'https:') throw new Error('Il sito SharePoint deve essere un indirizzo https://.');
  const p = u.pathname.replace(/\/+$/, '');
  const j = await graph(p && p !== '/' ? `/sites/${u.hostname}:${encodeURI(p)}` : `/sites/${u.hostname}`);
  return j.id;
}

const fresh = (f) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < TTL;

/** Files of every document library of the site (optionally under `folder`, with extension `ext`), downloaded. */
async function filesDir(sp) {
  const ext = String(sp.ext || 'csv').replace(/^\./, '').toLowerCase();
  const dir = cacheDir(`${sp.site}|${sp.folder ?? ''}|${ext}`);
  const stamp = path.join(dir, '.stamp');
  if (fresh(stamp)) return { dir, ext };
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const id = await siteId(sp.site);
  // Folder filter as written in Power BI ("Shared Documents/Dati" or the full URL of the folder).
  const want = sp.folder ? decodeURIComponent(sp.folder.replace(/^https?:\/\/[^/]+/, '')).replace(/^\/+|\/+$/g, '').toLowerCase() : '';
  const site = decodeURIComponent(new URL(sp.site).pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
  let n = 0;
  for (const d of await all(`/sites/${id}/drives`)) {
    const lib = decodeURIComponent(new URL(d.webUrl).pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
    for (const it of await all(`/drives/${d.id}/root/delta?$select=id,name,file,parentReference,@microsoft.graph.downloadUrl,deleted`)) {
      if (!it.file || it.deleted || !it.name.toLowerCase().endsWith('.' + ext)) continue;
      const rel = decodeURIComponent((it.parentReference?.path ?? '').replace(/^\/drives\/[^/]+\/root:?/, '')).replace(/^\/+|\/+$/g, '');
      const full = [lib, rel].filter(Boolean).join('/').toLowerCase();
      const relToSite = full.startsWith(site + '/') ? full.slice(site.length + 1) : full;
      if (want && !(full === want || full.startsWith(want + '/') || relToSite === want || relToSite.startsWith(want + '/'))) continue;
      const url = it['@microsoft.graph.downloadUrl'];
      const r = url ? await fetch(url) : await graph(`/drives/${d.id}/items/${it.id}/content`, true);
      if (!r.ok) throw new Error(`SharePoint: download di ${it.name} non riuscito (${r.status}).`);
      // Same name in different folders: keep both (Source.Name shows the file name).
      let name = it.name, k = 2;
      while (fs.existsSync(path.join(dir, name))) name = it.name.replace(/(\.\w+)$/, ` (${k++})$1`);
      fs.writeFileSync(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
      n++;
    }
  }
  if (!n) throw new Error(`SharePoint: nessun file .${ext} trovato${sp.folder ? ` nella cartella ${sp.folder}` : ''}.`);
  fs.writeFileSync(stamp, '');
  return { dir, ext };
}

/** Items of a SharePoint list (fields only, system columns removed) as a JSON file. */
async function listFile(sp) {
  const file = path.join(cacheDir(`${sp.site}|list|${sp.list}`), 'items.json');
  if (fresh(file)) return file;
  const id = await siteId(sp.site);
  const lists = await all(`/sites/${id}/lists?$select=id,displayName,name`);
  const l = lists.find((x) => x.displayName === sp.list || x.name === sp.list) ?? lists.find((x) => x.displayName?.toLowerCase() === String(sp.list).toLowerCase());
  if (!l) throw new Error(`SharePoint: l'elenco "${sp.list}" non esiste nel sito. Elenchi disponibili: ${lists.map((x) => x.displayName).join(', ')}`);
  const SYSTEM = /^(@odata|_|ContentType|Attachments|Edit|LinkTitle|LinkTitleNoMenu|DocIcon|ItemChildCount|FolderChildCount|AppAuthor|AppEditor|ComplianceAssetId|_UIVersionString)/;
  const items = await all(`/sites/${id}/lists/${l.id}/items?$expand=fields&$top=999`);
  const rows = items.map((x) => Object.fromEntries(Object.entries(x.fields ?? {}).filter(([k, v]) => !SYSTEM.test(k) && (v === null || typeof v !== 'object'))));
  fs.writeFileSync(file, JSON.stringify(rows));
  return file;
}

/** Names of the lists of a site (dialog suggestions). */
async function lists(site) {
  const id = await siteId(site);
  return (await all(`/sites/${id}/lists?$select=displayName,list`)).filter((x) => !x.list?.hidden).map((x) => x.displayName);
}

module.exports = { filesDir, listFile, lists, token };
