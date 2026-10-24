// Rename LinBI → MiB-BI: on the first start the old settings folder (~/.config/linbi: credentials, Power BI
// profiles, caches, pbixray venv) moves to ~/.config/mib-bi. Secrets are encrypted with safeStorage, whose key
// depends on the application name: a child process started under the old name decrypts them (handed over through
// a pipe, never written in clear) and they are encrypted again under the new name once the app is ready.
const { app, safeStorage } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OLD_NAME = 'linbi';
const SECRET_FILES = ['credentials.json', 'powerbi.json', 'claude.json', 'web-credentials.json'];
const NEW_NAME = 'mib-bi';
const oldDir = () => path.join(app.getPath('appData'), OLD_NAME);
const newDir = () => path.join(app.getPath('appData'), NEW_NAME);

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
/** Every string of a JSON value (secrets are base64 strings at any depth). */
function strings(x, out = new Set()) {
  if (typeof x === 'string') out.add(x);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) strings(v, out);
  return out;
}
function replaceStrings(x, map) {
  if (typeof x === 'string') return map.has(x) ? map.get(x) : x;
  if (Array.isArray(x)) return x.map((v) => replaceStrings(v, map));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, replaceStrings(v, map)]));
  return x;
}

/** Child process (MIBBI_DECRYPT_OLD): decrypt the old secrets under the old name and print them. Returns true in the child. */
function childMode() {
  if (!process.env.MIBBI_DECRYPT_OLD) return false;
  app.setName(OLD_NAME);
  // Chromium's own files of the child stay in a throwaway folder, never in the new settings folder.
  app.setPath('userData', path.join(app.getPath('temp'), `mib-bi-migrate-${process.pid}`));
  app.whenReady().then(() => {
    const out = {};
    for (const f of SECRET_FILES) {
      const json = readJson(path.join(oldDir(), f));
      for (const s of strings(json)) {
        if (s.length < 16 || !/^[A-Za-z0-9+/]+=*$/.test(s)) continue;
        try { out[s] = safeStorage.decryptString(Buffer.from(s, 'base64')); } catch { /* not a secret */ }
      }
    }
    process.stdout.write('MIBBI_SECRETS' + JSON.stringify(out) + 'MIBBI_END');
    app.exit(0);
  });
  return true;
}

let pending = null;

/** Before the app is ready: move the old folder's content into the new one (Chromium may already have created
 *  the new folder with its own files: the old entries replace them). Skipped for tests with --user-data-dir. */
function moveOldConfig() {
  const from = oldDir(), to = newDir();
  if (!fs.existsSync(from) || app.commandLine.hasSwitch('user-data-dir')) return;
  try {
    const r = spawnSync(process.execPath, process.argv.slice(1), { env: { ...process.env, MIBBI_DECRYPT_OLD: '1' }, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    const m = /MIBBI_SECRETS(\{.*\})MIBBI_END/s.exec(r.stdout ?? '');
    if (m) pending = new Map(Object.entries(JSON.parse(m[1])));
    if (r.pid) fs.rmSync(path.join(app.getPath('temp'), `mib-bi-migrate-${r.pid}`), { recursive: true, force: true });
  } catch { /* secrets will be asked again */ }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name), dest = path.join(to, name);
    fs.rmSync(dest, { recursive: true, force: true });
    try { fs.renameSync(src, dest); } catch { fs.cpSync(src, dest, { recursive: true }); }
  }
  fs.rmSync(from, { recursive: true, force: true });
}

/** After ready: encrypt the moved secrets with the new key (entries that could not be decrypted are left: re-entered on use). */
function reencrypt() {
  if (!pending?.size || !safeStorage.isEncryptionAvailable()) { pending = null; return; }
  const map = new Map([...pending].map(([enc, plain]) => [enc, safeStorage.encryptString(plain).toString('base64')]));
  for (const f of SECRET_FILES) {
    const file = path.join(newDir(), f);
    const json = readJson(file);
    if (json) fs.writeFileSync(file, JSON.stringify(replaceStrings(json, map), null, 2), { mode: 0o600 });
  }
  pending = null;
}

module.exports = { childMode, moveOldConfig, reencrypt };
