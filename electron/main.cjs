const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const JSZip = require('jszip');
const db = require('./db.cjs');
const pbip = require('./pbip.cjs');
const connect = require('./connect.cjs');
const powerbi = require('./powerbi.cjs');
const claude = require('./claude.cjs');
const scripts = require('./scripts.cjs');
const remote = require('./remote.cjs');
const { ensureSample, ensureDims } = require('./sample.cjs');

app.commandLine.appendSwitch('no-sandbox');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 650,
    frame: false,
    backgroundColor: '#ffffff',
    title: 'LinBI',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (process.env.LINBI_SHOT) screenshotMode(process.env.LINBI_SHOT, process.env.LINBI_SCRIPT);
  // `linbi report.lbix` / double click on a report file: open it once the UI is ready.
  const arg = process.argv.slice(1).find((a) => /\.(lbix|pbix|pbit|pbip)$/i.test(a) && fs.existsSync(a));
  if (arg) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.send('file:openArg', path.resolve(arg)), 300));
  win.on('maximize', () => win.webContents.send('win:state', true));
  win.on('unmaximize', () => win.webContents.send('win:state', false));
}

// Wraps handlers so errors reach the renderer as { error } instead of rejecting.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: await fn(...args) };
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });
}

handle('db:query', (sql) => db.query(sql));
handle('db:queryAs', (sql) => db.queryAs(sql));
handle('db:setRole', (tables) => db.setRole(tables));
handle('db:preview', (file, sheet) => db.preview(file, sheet));
handle('db:import', (file, table, sheet) => db.importFile(file, table, sheet));
handle('db:materialize', (table, sql) => db.materialize(table, sql));
handle('db:sourceExpr', (source) => (source.inline ? db.inlineExpr(source.inline) : source.db ? connect.sourceExpr(source) : source.web || source.odata || source.folder || source.sharepoint ? remote.sourceExpr(source) : db.sourceExpr(source.path, source.sheet)));
handle('remote:clearCache', () => remote.clearCache());
const webcred = require('./webcred.cjs');
handle('webcred:list', () => webcred.list());
handle('webcred:set', (prefix, cred) => webcred.set(prefix, cred));
handle('webcred:remove', (prefix) => webcred.remove(prefix));
handle('sharepoint:lists', (site) => require('./sharepoint.cjs').lists(site));
handle('pbi:labels', () => powerbi.labels());
// Origini recenti: data files used to load tables (most recent first, existing files only).
const recentFile = () => path.join(app.getPath('userData'), 'recent-sources.json');
const readRecent = () => { try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')); } catch { return []; } };
handle('recent:list', () => readRecent().filter((p) => fs.existsSync(p)).slice(0, 10));
handle('recent:add', (p) => { fs.writeFileSync(recentFile(), JSON.stringify([p, ...readRecent().filter((x) => x !== p)].slice(0, 20))); });
handle('file:openDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('db:connect', (c, password, remember) => connect.connect(c, password, remember));
handle('db:forget', (c) => connect.forget(c));

// Power BI service (electron/powerbi.cjs): progress lines go to the renderer as 'pbi:progress'.
handle('claude:status', () => claude.status());
handle('claude:configure', (key, model) => claude.configure(key, model));
handle('claude:ask', (question, schema) => claude.ask(question, schema));
handle('script:run', (lang, script, csv, w, h) => scripts.run(lang, script, csv, w, h));
handle('script:paths', (p) => (p ? scripts.setPaths(p) : scripts.paths()));
handle('pbi:status', () => powerbi.status());
handle('pbi:configure', (clientId, tenant, name) => powerbi.configure(clientId, tenant, name));
handle('pbi:addProfile', (clientId, tenant, name) => powerbi.addProfile(clientId, tenant, name));
handle('pbi:selectProfile', (id) => powerbi.selectProfile(id));
handle('pbi:removeProfile', () => powerbi.removeProfile());
handle('pbi:signOut', () => powerbi.signOut());
handle('pbi:loginStart', (email) => powerbi.loginStart(typeof email === 'string' ? email : undefined));
handle('pbi:loginBrowser', (email) => powerbi.loginBrowser(typeof email === 'string' ? email : undefined));
handle('pbi:loginBrowserCancel', () => powerbi.loginBrowserCancel());
handle('pbi:loginWait', () => powerbi.loginWait());
handle('pbi:loginCancel', () => powerbi.loginCancel());
handle('pbi:workspaces', () => powerbi.workspaces());
handle('pbi:publish', (mode, spec) => {
  const progress = (msg, frac) => win.webContents.send('pbi:progress', msg, frac ?? null);
  return mode === 'fabric' ? powerbi.publishFabric(spec, progress) : powerbi.publishPush(spec, progress);
});
handle('shell:open', (url) => {
  if (!/^https:\/\//.test(url)) throw new Error('URL non valido');
  return shell.openExternal(url);
});
handle('db:calcColumn', (table, column, expr, replace) => db.addCalcColumn(table, column, expr, replace));
handle('db:dropColumn', (table, column) => db.dropColumn(table, column));
handle('db:drop', (table) => db.dropTable(table));
handle('db:createEmpty', (table, columns) => db.createEmpty(table, columns));
handle('data:sample', () => {
  const dir = app.getPath('userData');
  return { financials: ensureSample(dir), ...ensureDims(dir) };
});

const FILTERS = {
  csv: [{ name: 'Testo/CSV', extensions: ['csv', 'txt', 'tsv'] }],
  excel: [{ name: 'Cartella di lavoro di Excel', extensions: ['xlsx'] }],
  json: [{ name: 'JSON', extensions: ['json', 'ndjson', 'jsonl'] }],
  parquet: [{ name: 'Parquet', extensions: ['parquet'] }],
  sqlite: [{ name: 'Database SQLite', extensions: ['sqlite', 'sqlite3', 'db'] }],
  any: [{ name: 'Tutti i file di dati', extensions: ['csv', 'txt', 'tsv', 'xlsx', 'json', 'ndjson', 'jsonl', 'parquet'] }],
  lbix: [{ name: 'File LinBI', extensions: ['lbix'] }],
  report: [{ name: 'Report (LinBI, Power BI)', extensions: ['lbix', 'pbix', 'pbit', 'pbip'] }, { name: 'File LinBI', extensions: ['lbix'] }, { name: 'File Power BI', extensions: ['pbix', 'pbit', 'pbip'] }],
  powerbi: [{ name: 'File Power BI', extensions: ['pbix', 'pbit', 'pbip'] }],
  pbip: [{ name: 'Progetto di Power BI', extensions: ['pbip'] }],
  pbit: [{ name: 'Modello di Power BI', extensions: ['pbit'] }],
  theme: [{ name: 'File di tema JSON', extensions: ['json'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  pbiviz: [{ name: 'Oggetto visivo di Power BI', extensions: ['pbiviz'] }],
};

// Custom visual (.pbiviz = zip with package.json + resources/<guid>.pbiviz.json). LINBI_PBIVIZ_PATH skips the dialog.
handle('cv:import', async () => {
  const file = process.env.LINBI_PBIVIZ_PATH
    || await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS.pbiviz }).then((r) => (r.canceled ? null : r.filePaths[0]));
  if (!file) return null;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const json = async (name) => JSON.parse((await zip.file(name).async('string')).replace(/^\uFEFF/, ''));
  const res = Object.keys(zip.files).find((n) => /^resources\/[^/]+\.pbiviz\.json$/.test(n));
  if (!res) throw new Error('Il file non contiene un oggetto visivo di Power BI (resources/*.pbiviz.json).');
  const pbiviz = await json(res);
  const guid = pbiviz.visual?.guid;
  if (!guid || !pbiviz.content?.js) throw new Error("Pacchetto .pbiviz non valido: mancano guid o codice dell'oggetto visivo.");
  return { guid, pbiviz, ...(zip.file('package.json') ? { package: await json('package.json') } : {}) };
});

handle('dialog:openData', async (kind) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS[kind] || FILTERS.any });
  return r.canceled ? null : r.filePaths[0];
});

// .lbix: a zip with report.json and one Parquet file per table (data embedded like a .pbix).
// `embed` lists the tables to export; plain JSON .lbix files (older versions) still open.
handle('file:save', async (content, existingPath, embed) => {
  let target = existingPath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'Report.lbix', filters: FILTERS.lbix });
    if (r.canceled) return null;
    target = r.filePath.endsWith('.lbix') ? r.filePath : r.filePath + '.lbix';
  }
  if (!embed) { fs.writeFileSync(target, content); return target; }
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'linbi-'));
  try {
    const zip = new JSZip();
    zip.file('report.json', content);
    for (const e of embed) {
      const file = path.join(tmp, path.basename(e.file));
      await db.exportParquet(e.table, file);
      zip.file(e.file, fs.readFileSync(file));
    }
    const out = target + '.tmp';
    fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
    fs.renameSync(out, target);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return target;
});

// Small text files (themes): open/save with a dialog.
handle('file:readText', async (kind) => {
  const r = process.env.LINBI_OPEN_PATH ? { canceled: false, filePaths: [process.env.LINBI_OPEN_PATH] }
    : await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS[kind] || FILTERS.any });
  if (r.canceled) return null;
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') };
});
handle('file:saveText', async (content, defaultPath, kind) => {
  const r = process.env.LINBI_SAVE_PATH ? { canceled: false, filePath: process.env.LINBI_SAVE_PATH }
    : await dialog.showSaveDialog(win, { defaultPath, filters: FILTERS[kind] || FILTERS.any });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, content);
  return r.filePath;
});

handle('file:open', async (kind) => {
  // LINBI_OPEN_PATH (scripted tests) skips the dialog.
  const r = process.env.LINBI_OPEN_PATH ? { canceled: false, filePaths: [process.env.LINBI_OPEN_PATH] }
    : await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS[kind] || FILTERS.report });
  if (r.canceled) return null;
  return readReport(r.filePaths[0]);
});
handle('file:openAt', (file) => readReport(file));

async function readReport(file) {
  if (/\.(pbix|pbit|pbip)$/i.test(file)) return { path: file, powerbi: true };
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { path: file, content: buf.toString('utf8') };
  // Embedded data: unpack the Parquet files next to each other in the user cache.
  const stat = fs.statSync(file);
  const key = crypto.createHash('sha1').update(file + stat.mtimeMs + stat.size).digest('hex').slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'lbix-data', key);
  const zip = await JSZip.loadAsync(buf);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === 'report.json' || name.includes('..')) continue;
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, await entry.async('nodebuffer'));
  }
  return { path: file, content: await zip.file('report.json').async('string'), dataDir: dir };
}

// ---- Power BI files -------------------------------------------------------

/** Python with pbixray: LINBI_PYTHON, the project's .venv-pbix, ~/.config/linbi/pbix-venv (installed app), or python3. */
function pythonBin() {
  if (process.env.LINBI_PYTHON) return process.env.LINBI_PYTHON;
  for (const venv of [path.join(__dirname, '..', '.venv-pbix', 'bin', 'python'), path.join(app.getPath('userData'), 'pbix-venv', 'bin', 'python')]) {
    if (fs.existsSync(venv)) return venv;
  }
  return 'python3';
}
const SETUP_PBIX = app.isPackaged
  ? 'python3 -m venv ~/.config/linbi/pbix-venv && ~/.config/linbi/pbix-venv/bin/pip install pbixray pyarrow'
  : 'npm run setup:pbix (nella cartella del progetto)';

handle('pbix:read', (file) => new Promise((resolve, reject) => {
  if (/\.pbip$/i.test(file)) { try { return resolve(pbip.read(file)); } catch (e) { return reject(new Error('Lettura del progetto Power BI non riuscita: ' + e.message)); } }
  const stat = fs.statSync(file);
  // Packaged app: Python cannot read inside app.asar (electron/pbix is unpacked by electron-builder).
  const script = path.join(__dirname, 'pbix', 'read_pbix.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  // The reader's own content is part of the key: a newer LinBI re-reads files it extracted before.
  const key = crypto.createHash('sha1').update(file + stat.mtimeMs + stat.size).update(fs.readFileSync(script)).digest('hex').slice(0, 16);
  const outdir = path.join(app.getPath('userData'), 'pbix-cache', key);
  const cached = path.join(outdir, 'model.json');
  if (fs.existsSync(cached)) return resolve(JSON.parse(fs.readFileSync(cached, 'utf8')));
  execFile(pythonBin(), [script, file, outdir], { maxBuffer: 1 << 26, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
    if (err) {
      const msg = String(stderr || err.message);
      if (msg.includes('PBIXRAY_MISSING')) {
        return reject(new Error(`Per leggere i file .pbix serve la libreria Python "pbixray". Eseguire in un terminale: ${SETUP_PBIX}`));
      }
      if (err.code === 'ENOENT') return reject(new Error('Python 3 non trovato. Installare python3 oppure impostare LINBI_PYTHON.'));
      return reject(new Error('Lettura del file Power BI non riuscita: ' + msg.trim().split('\n').slice(-3).join(' ')));
    }
    resolve(JSON.parse(fs.readFileSync(cached, 'utf8')));
  });
}));

handle('pbit:save', async (parts, suggested) => {
  // LINBI_PBIT_OUT (scripted tests) skips the save dialog.
  const r = process.env.LINBI_PBIT_OUT ? { canceled: false, filePath: process.env.LINBI_PBIT_OUT }
    : await dialog.showSaveDialog(win, { defaultPath: suggested || 'Report.pbit', filters: FILTERS.pbit });
  if (r.canceled) return null;
  const target = r.filePath.toLowerCase().endsWith('.pbit') ? r.filePath : r.filePath + '.pbit';
  const zip = new JSZip();
  for (const p of parts) {
    // No folder entries: Power BI packages list files only.
    const opts = { createFolders: false };
    if (p.utf16 !== undefined) zip.file(p.path, Buffer.from(p.utf16, 'utf16le'), opts);
    else if (p.utf8bom !== undefined) zip.file(p.path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(p.utf8bom, 'utf8')]), opts);
    else if (p.utf8 !== undefined) zip.file(p.path, Buffer.from(p.utf8, 'utf8'), opts);
    else if (p.dataUrl) zip.file(p.path, Buffer.from(p.dataUrl.split(',')[1], 'base64'), opts);
  }
  fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return target;
});

// Power BI project: parts use __BASE__ for the project name chosen in the dialog.
handle('pbip:save', async (parts, suggested) => {
  const r = process.env.LINBI_PBIP_OUT ? { canceled: false, filePath: process.env.LINBI_PBIP_OUT }
    : await dialog.showSaveDialog(win, { defaultPath: suggested || 'Report.pbip', filters: FILTERS.pbip });
  if (r.canceled) return null;
  const target = r.filePath.toLowerCase().endsWith('.pbip') ? r.filePath : r.filePath + '.pbip';
  const base = path.basename(target, path.extname(target));
  const sub = (s) => s.split('__BASE__').join(base);
  return pbip.write(target, parts.map((p) => ({ ...p, path: sub(p.path), ...(p.text !== undefined ? { text: sub(p.text) } : {}) })));
});

// PDF export: the renderer lays out every page (print CSS, 1280×720 each) and Chromium prints it.
handle('pdf:print', async (suggested) => {
  const r = process.env.LINBI_PDF_OUT ? { canceled: false, filePath: process.env.LINBI_PDF_OUT }
    : await dialog.showSaveDialog(win, { defaultPath: suggested || 'Report.pdf', filters: FILTERS.pdf });
  if (r.canceled) return null;
  const target = r.filePath.toLowerCase().endsWith('.pdf') ? r.filePath : r.filePath + '.pdf';
  const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  fs.writeFileSync(target, data);
  return target;
});

ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win.close());
ipcMain.on('win:title', (_e, title) => win.setTitle(title));

// Dev aid: LINBI_SHOT=out.png [LINBI_SCRIPT=steps.js] runs a script in the page, captures it, exits.
function screenshotMode(out, scriptFile) {
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    if (scriptFile) {
      try {
        const result = await win.webContents.executeJavaScript(fs.readFileSync(scriptFile, 'utf8'));
        if (result !== undefined) console.log('SCRIPT_RESULT ' + JSON.stringify(result));
      } catch (e) {
        console.error('script error', e);
      }
    }
    await wait(2500);
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    app.quit();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
