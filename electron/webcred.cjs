// Web/OData credentials (Power Query "Impostazioni origine dati"): per URL prefix (an origin or a
// full address), like Power BI. Kinds: basic (user + password), apikey (Power BI "API Web": the key
// goes in the query string under `name`), header (an HTTP header such as Authorization: Bearer …),
// oauth (Microsoft account token, see sharepoint.cjs). Secrets never go into reports: they are kept in
// <userData>/web-credentials.json encrypted with safeStorage, otherwise only for the session.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'web-credentials.json');
const session = new Map(); // prefix → secret
const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
const save = (s) => fs.writeFileSync(file(), JSON.stringify(s, null, 2), { mode: 0o600 });

const normPrefix = (p) => {
  const u = new URL(p);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Le credenziali Web valgono solo per indirizzi http(s).');
  const t = u.toString();
  return t.endsWith('/') ? t.slice(0, -1) : t;
};

function list() {
  return Object.entries(load()).map(([prefix, c]) => ({ prefix, kind: c.kind, user: c.user, name: c.name, persistent: !!c.secret }));
}

/** Saves credentials for `prefix`; returns whether they persist across sessions. */
function set(prefix, cred) {
  const key = normPrefix(prefix);
  const s = load();
  const entry = { kind: cred.kind, ...(cred.user ? { user: cred.user } : {}), ...(cred.name ? { name: cred.name } : {}) };
  session.set(key, cred.secret ?? '');
  if (cred.secret && safeStorage.isEncryptionAvailable()) entry.secret = safeStorage.encryptString(cred.secret).toString('base64');
  s[key] = entry;
  save(s);
  return !!entry.secret;
}

function remove(prefix) {
  const s = load();
  delete s[prefix];
  session.delete(prefix);
  save(s);
}

/** Credentials of the longest prefix matching `url` (with the secret), or null. */
function forUrl(url) {
  const s = load();
  const match = Object.keys(s).filter((p) => url === p || url.startsWith(p.endsWith('/') ? p : p + '/') || url.startsWith(p + '?')).sort((a, b) => b.length - a.length)[0];
  if (!match) return null;
  const c = s[match];
  let secret = session.get(match);
  if (secret === undefined && c.secret && safeStorage.isEncryptionAvailable()) {
    try { secret = safeStorage.decryptString(Buffer.from(c.secret, 'base64')); session.set(match, secret); } catch { /* re-enter */ }
  }
  return { prefix: match, ...c, secret: secret ?? '' };
}

/** URL and headers for a request to `url` with its stored credentials. */
async function apply(url, headers = {}) {
  const c = forUrl(url);
  if (!c) return { url, headers };
  if (c.kind === 'basic') return { url, headers: { ...headers, Authorization: 'Basic ' + Buffer.from(`${c.user ?? ''}:${c.secret}`).toString('base64') } };
  if (c.kind === 'apikey') { const u = new URL(url); u.searchParams.set(c.name || 'api_key', c.secret); return { url: u.toString(), headers }; }
  if (c.kind === 'header') return { url, headers: { ...headers, [c.name || 'Authorization']: c.secret } };
  if (c.kind === 'oauth') return { url, headers: { ...headers, Authorization: 'Bearer ' + await require('./sharepoint.cjs').token(c.prefix) } };
  return { url, headers };
}

module.exports = { list, set, remove, forUrl, apply, normPrefix };
