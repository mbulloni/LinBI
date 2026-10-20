// Publish to the Power BI service from Linux, through the public REST APIs (no Power BI Desktop):
//  - "push": Power BI Pro. A push dataset (tables, relationships, DAX measures) filled with the rows
//    of the DuckDB model, plus a thin report (.pbix with only the layout and a live connection to it).
//  - "fabric": workspaces on Fabric / Premium / PPU capacity. Semantic model (TMSL) and report
//    (report.json) created from their text definitions; the service builds and refreshes the model.
//    Local data is embedded in the M of each table (like "Immetti dati"), so no gateway is needed.
// Sign-in: OAuth 2.0 authorization code + PKCE in the system browser (loopback redirect http://localhost),
// or device code, against an Entra ID app registration (public client): the organization's own, or the
// one LinBI is distributed with (LINBI_PBI_CLIENT_ID / electron/pbi-app.json, multi-tenant).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const JSZip = require('jszip');
const http = require('http');
const { app, safeStorage, shell } = require('electron');
const db = require('./db.cjs');

// Endpoints can be redirected for tests (LINBI_PBI_* = local mock server).
const LOGIN = process.env.LINBI_PBI_LOGIN || 'https://login.microsoftonline.com';
const PBI = process.env.LINBI_PBI_API || 'https://api.powerbi.com/v1.0/myorg';
const FABRIC = process.env.LINBI_PBI_FABRIC || 'https://api.fabric.microsoft.com/v1';
const SCOPES = {
  pbi: 'https://analysis.windows.net/powerbi/api/.default',
  fabric: 'https://api.fabric.microsoft.com/.default',
  // SharePoint sources (sharepoint.cjs): same refresh token, Graph resource.
  graph: 'https://graph.microsoft.com/.default',
};

const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfgFile = () => path.join(app.getPath('userData'), 'powerbi.json');

// ---------- configuration and tokens ----------
// powerbi.json = { active, profiles: [{ id, name, clientId, tenant, refresh, account, lastWorkspace, ... }] }:
// one profile per Entra app/tenant, each with its own encrypted refresh token. loadCfg/saveCfg work on the
// active profile. The old flat file (a single app) becomes the first profile.

let refreshToken = null;
const tokens = new Map();
let pending = null;

function readFile() {
  let f;
  try { f = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { f = {}; }
  if (!Array.isArray(f.profiles)) {
    const old = f;
    f = { active: null, profiles: [] };
    if (old.clientId) { const id = crypto.randomUUID(); f.profiles.push({ id, name: 'Predefinito', ...old }); f.active = id; }
  }
  if (!f.profiles.some((p) => p.id === f.active)) f.active = f.profiles[0]?.id ?? null;
  return f;
}
function writeFile(f) {
  fs.writeFileSync(cfgFile(), JSON.stringify(f, null, 2), { mode: 0o600 });
}
function loadCfg() {
  const f = readFile();
  return f.profiles.find((p) => p.id === f.active) ?? {};
}
function saveCfg(patch) {
  const f = readFile();
  const p = f.profiles.find((x) => x.id === f.active);
  if (!p) throw new Error('Nessun profilo Power BI configurato.');
  Object.assign(p, patch);
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete p[k];
  writeFile(f);
  return p;
}

function storedRefresh() {
  if (refreshToken) return refreshToken;
  const enc = loadCfg().refresh;
  if (enc && safeStorage.isEncryptionAvailable()) {
    try { refreshToken = safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { /* sign in again */ }
  }
  return refreshToken;
}

function keepRefresh(rt) {
  refreshToken = rt;
  if (safeStorage.isEncryptionAvailable()) saveCfg({ refresh: safeStorage.encryptString(rt).toString('base64') });
}

function claims(idToken) {
  try { return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

/** Forgets the in-memory tokens and any sign-in in progress (another profile becomes active). */
function resetSession() {
  refreshToken = null;
  tokens.clear();
  pending = null;
}

/** App registration LinBI ships with (multi-tenant public client), used when no profile is configured. */
function builtinApp() {
  if (process.env.LINBI_PBI_CLIENT_ID) return process.env.LINBI_PBI_CLIENT_ID.trim();
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'pbi-app.json'), 'utf8')).clientId?.trim() || null; } catch { return null; }
}

/** Tenant for an e-mail address: its domain (Entra resolves verified domains), else the profile's. */
function tenantFor(email, cfg) {
  const d = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec(String(email ?? '').trim())?.[1];
  return d ? d.toLowerCase() : cfg.tenant || 'organizations';
}

/** Entra errors explained: what to ask the organization's IT. */
function aadError(j) {
  const d = String(j.error_description ?? j.error ?? 'Accesso non riuscito').split('\r\n')[0];
  const code = /AADSTS(\d+)/.exec(d)?.[1];
  const hint = {
    '65001': "L'app LinBI non ha ancora il consenso nel tenant: accettare la richiesta di autorizzazioni, oppure chiedere all'amministratore IT di concederlo (Microsoft Entra › Applicazioni aziendali).",
    '90094': "Il tenant richiede l'approvazione dell'amministratore per le app esterne: chiedere all'IT di approvare LinBI (Applicazioni aziendali › Consenso amministratore) o di registrare un'app aziendale (Impostazioni app).",
    '90095': "Il tenant richiede l'approvazione dell'amministratore per le app esterne: inviare la richiesta di approvazione proposta da Microsoft.",
    '700016': "L'app non esiste in questo tenant: con un'app registrata solo in un'altra organizzazione serve un'app multi-tenant, o un'app registrata dall'IT del proprio tenant (Impostazioni app).",
    '7000218': "L'app deve consentire i flussi client pubblici (Autenticazione › Consenti flussi client pubblici: Sì).",
    '50011': "Manca l'URI di reindirizzamento: in Autenticazione aggiungere la piattaforma «App per dispositivi mobili e desktop» con http://localhost.",
    '500113': "Manca l'URI di reindirizzamento: in Autenticazione aggiungere la piattaforma «App per dispositivi mobili e desktop» con http://localhost.",
    '53003': "Bloccato da un criterio di accesso condizionale dell'organizzazione (es. solo dispositivi gestiti): chiedere all'IT.",
    '50105': "L'account non è assegnato all'app LinBI nel tenant: chiedere all'IT di assegnarlo.",
  }[code];
  return new Error(hint ? `${hint} (${d})` : d);
}

/** Profile to sign in with: the active one, or a new one on the built-in app. */
function ensureProfile() {
  const cfg = loadCfg();
  if (cfg.clientId) return cfg;
  const id = builtinApp();
  if (!id) throw new Error("Configurare prima l'app (Impostazioni app).");
  addProfile(id, 'organizations', 'Account aziendale');
  return loadCfg();
}

async function signedIn(j, tenantUsed) {
  const c = claims(j.id_token || '');
  tokens.set('pbi', { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 });
  keepRefresh(j.refresh_token);
  // Refreshes go to the account's own tenant (domain names and "organizations" resolve to it).
  saveCfg({ account: c.preferred_username || c.upn || c.email || c.name || 'account Microsoft', ...(c.tid ? { tenant: c.tid } : tenantUsed ? { tenant: tenantUsed } : {}) });
  return status();
}

let browserLogin = null;

/**
 * Sign-in in the system browser like Power BI Desktop: the user picks the work account (SSO when already
 * signed in), Entra redirects to a loopback port of LinBI with the code (PKCE, no secret, no code to type).
 */
async function loginBrowser(email) {
  const cfg = ensureProfile();
  const tenant = tenantFor(email, cfg);
  if (browserLogin) browserLogin.cancel();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const scope = `${SCOPES.pbi} offline_access openid profile`;
  let done;
  const result = new Promise((res, rej) => { done = { res, rej }; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>LinBI</title><body style="font-family:sans-serif;padding:40px">${ok ? '<h2>Accesso completato</h2><p>Tornare a LinBI: questa scheda si può chiudere.</p>' : `<h2>Accesso non riuscito</h2><p>${String(u.searchParams.get('error_description') ?? 'Risposta non valida').replace(/[<>&]/g, '')}</p>`}</body>`);
    if (u.searchParams.get('state') !== state) return;
    if (ok) done.res(u.searchParams.get('code'));
    else done.rej(aadError({ error: u.searchParams.get('error'), error_description: u.searchParams.get('error_description') }));
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const redirect = `http://localhost:${server.address().port}`;
  const timer = setTimeout(() => done.rej(new Error('Accesso annullato o scaduto.')), 5 * 60 * 1000);
  browserLogin = { cancel: () => done.rej(new Error('Accesso annullato.')) };
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: redirect, scope, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', ...(email?.includes('@') ? { login_hint: email.trim() } : {}) });
  try {
    const url = `${LOGIN}/${tenant}/oauth2/v2.0/authorize?${q}`;
    // Tests (mock server): follow the redirect with fetch instead of opening a browser.
    if (process.env.LINBI_PBI_BROWSER_FETCH) fetch(url).catch((e) => done.rej(e)); else await shell.openExternal(url);
    const code = await result;
    const { ok, j } = await form(`${LOGIN}/${tenant}/oauth2/v2.0/token`, { grant_type: 'authorization_code', client_id: cfg.clientId, code, redirect_uri: redirect, code_verifier: verifier, scope });
    if (!ok) throw aadError(j);
    return await signedIn(j, tenant);
  } finally {
    clearTimeout(timer);
    server.close();
    browserLogin = null;
  }
}

function loginBrowserCancel() { browserLogin?.cancel(); }

/** Public state for the dialog: active profile (configuration, signed-in account, last workspace) and all profiles. */
function status() {
  const f = readFile();
  const cfg = f.profiles.find((p) => p.id === f.active) ?? {};
  return {
    profileId: cfg.id ?? null, profileName: cfg.name ?? '',
    builtin: !!builtinApp(),
    clientId: cfg.clientId ?? '', tenant: cfg.tenant ?? 'organizations', account: storedRefresh() ? cfg.account ?? null : null, lastWorkspace: cfg.lastWorkspace ?? null, persistent: safeStorage.isEncryptionAvailable(),
    profiles: f.profiles.map((p) => ({ id: p.id, name: p.name, tenant: p.tenant ?? 'organizations', account: p.refresh ? p.account ?? null : null })),
  };
}

function checkApp(clientId, name) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId.trim())) throw new Error('ID applicazione (client) non valido: deve essere un GUID.');
  if (!String(name ?? '').trim()) throw new Error('Indicare un nome per il profilo.');
}

/** Saves the app of the active profile (creating the first profile); changing app or tenant signs out. */
function configure(clientId, tenant, name) {
  checkApp(clientId, name);
  const f = readFile();
  const cfg = f.profiles.find((p) => p.id === f.active);
  const app = { clientId: clientId.trim(), tenant: tenant.trim() || 'organizations', name: name.trim() };
  if (!cfg) return addProfile(clientId, tenant, name);
  if (cfg.clientId !== app.clientId || (cfg.tenant ?? 'organizations') !== app.tenant) {
    signOut();
    saveCfg({ ...app, lastWorkspace: undefined, pushRelationships: undefined });
  } else saveCfg({ name: app.name });
  return status();
}

/** New profile (another app/tenant), made active. */
function addProfile(clientId, tenant, name) {
  checkApp(clientId, name);
  const f = readFile();
  const id = crypto.randomUUID();
  f.profiles.push({ id, name: name.trim(), clientId: clientId.trim(), tenant: tenant.trim() || 'organizations' });
  f.active = id;
  writeFile(f);
  resetSession();
  return status();
}

function selectProfile(id) {
  const f = readFile();
  if (!f.profiles.some((p) => p.id === id)) throw new Error('Profilo non trovato.');
  if (f.active !== id) { f.active = id; writeFile(f); resetSession(); }
  return status();
}

/** Deletes the active profile with its saved sign-in; the next one becomes active. */
function removeProfile() {
  const f = readFile();
  f.profiles = f.profiles.filter((p) => p.id !== f.active);
  f.active = f.profiles[0]?.id ?? null;
  writeFile(f);
  resetSession();
  return status();
}

function signOut() {
  refreshToken = null;
  tokens.clear();
  if (loadCfg().id) saveCfg({ refresh: undefined, account: undefined });
}

async function form(url, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

/** Starts the device code flow: the user types `user_code` at `verification_uri` in any browser. */
async function loginStart(email) {
  const cfg = ensureProfile();
  const tenant = tenantFor(email, cfg);
  const { ok, j } = await form(`${LOGIN}/${tenant}/oauth2/v2.0/devicecode`, {
    client_id: cfg.clientId, scope: `${SCOPES.pbi} offline_access openid profile`,
  });
  if (!ok) throw aadError(j);
  pending = { device: j.device_code, tenant, interval: (j.interval || 5) * 1000, until: Date.now() + (j.expires_in || 900) * 1000 };
  return { userCode: j.user_code, verificationUri: j.verification_uri, message: j.message };
}

/** Waits for the user to complete the sign-in started by loginStart(). */
async function loginWait() {
  const cfg = loadCfg();
  const p = pending;
  if (!p) throw new Error('Nessun accesso in corso.');
  while (Date.now() < p.until && pending === p) {
    await sleep(p.interval);
    const { ok, j } = await form(`${LOGIN}/${p.tenant}/oauth2/v2.0/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: cfg.clientId, device_code: p.device,
    });
    if (pending !== p) break; // cancelled, or another profile selected meanwhile
    if (ok) {
      pending = null;
      return signedIn(j, p.tenant);
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { p.interval += 5000; continue; }
    pending = null;
    throw aadError(j);
  }
  throw new Error('Accesso annullato o scaduto.');
}

function loginCancel() { pending = null; }

async function token(kind) {
  const t = tokens.get(kind);
  if (t && t.until > Date.now()) return t.token;
  const rt = storedRefresh();
  if (!rt) throw new Error('Accedere a Power BI prima di pubblicare.');
  const cfg = loadCfg();
  const { ok, j } = await form(`${LOGIN}/${cfg.tenant || 'organizations'}/oauth2/v2.0/token`, {
    grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: rt, scope: `${SCOPES[kind]} offline_access`,
  });
  // Fabric and Power BI are the same Entra resource: a Power BI token also works for Fabric APIs.
  if (!ok && kind === 'fabric' && j.error !== 'invalid_grant') return token('pbi');
  if (!ok) {
    if (j.error === 'invalid_grant') signOut();
    throw new Error(`Token ${kind === 'fabric' ? 'Fabric' : kind === 'graph' ? 'Microsoft Graph' : 'Power BI'} non ottenuto: ${j.error_description?.split('\r\n')[0] || j.error}`);
  }
  if (j.refresh_token) keepRefresh(j.refresh_token);
  tokens.set(kind, { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 });
  return j.access_token;
}

// ---------- REST helpers ----------

async function call(kind, method, url, body, extra = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Bearer ${await token(kind)}` };
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(url, { method, headers, body: payload });
    if ((r.status === 429 || r.status === 503) && attempt < 8) {
      await sleep(Math.min(60, Number(r.headers.get('Retry-After')) || 2 ** attempt) * 1000);
      continue;
    }
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text }; }
    if (!r.ok) {
      const e = j?.error;
      const msg = e?.pbi?.error?.details?.[0]?.detail?.value || e?.message || j?.message || e?.code || j?.errorCode || text.slice(0, 300) || r.statusText;
      const err = new Error(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}: ${r.status} ${msg}`);
      err.status = r.status;
      throw err;
    }
    return extra.raw ? { status: r.status, headers: r.headers, json: j } : j;
  }
}

/** Fabric long-running operation: 202 + Location, poll until Succeeded, then fetch /result. */
async function fabricLro(method, url, body) {
  const r = await call('fabric', method, url, body, { raw: true });
  if (r.status !== 202) return r.json;
  const loc = r.headers.get('Location');
  if (!loc) return null;
  let wait = Number(r.headers.get('Retry-After')) || 2;
  for (let i = 0; i < 300; i++) {
    await sleep(wait * 1000);
    const op = await call('fabric', 'GET', loc, undefined, { raw: true });
    const st = op.json?.status;
    if (st === 'Succeeded') {
      try { return await call('fabric', 'GET', loc.replace(/\/?$/, '/result')); } catch { return null; }
    }
    if (st === 'Failed') throw new Error(`Operazione Fabric non riuscita: ${op.json?.error?.message || JSON.stringify(op.json?.error)}`);
    wait = Number(op.headers.get('Retry-After')) || wait;
  }
  throw new Error('Operazione Fabric troppo lunga: controllare l\'area di lavoro nel browser.');
}

const group = (ws) => (ws ? `${PBI}/groups/${ws}` : PBI);

/** Every workspace the account can see (paged), the personal one first, then by name. */
async function workspaces() {
  const out = [];
  for (let skip = 0; ; skip += 5000) {
    const r = await call('pbi', 'GET', `${PBI}/groups?$top=5000&$skip=${skip}`);
    const page = r.value ?? [];
    out.push(...page.map((g) => ({ id: g.id, name: g.name, dedicated: !!g.isOnDedicatedCapacity, readOnly: !!g.isReadOnly })));
    if (page.length < 5000) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return [{ id: '', name: 'Area di lavoro personale', dedicated: false }, ...out];
}

// ---------- Ottieni dati › Power BI (servizio) ----------

/** Reports and semantic models of a workspace ('' = Area di lavoro personale). */
async function serviceItems(ws) {
  const [rep, ds] = await Promise.all([call('pbi', 'GET', `${group(ws)}/reports`), call('pbi', 'GET', `${group(ws)}/datasets`)]);
  return {
    reports: (rep.value ?? []).filter((r) => r.reportType !== 'PaginatedReport').map((r) => ({ id: r.id, name: r.name, datasetId: r.datasetId ?? null })),
    datasets: (ds.value ?? []).map((d) => ({ id: d.id, name: d.name, owner: d.configuredBy ?? null })),
  };
}

const safeFile = (n) => String(n).replace(/[^\p{L}\p{N} ._-]+/gu, '_').slice(0, 80) || 'report';

/** Downloads a report as .pbix (Export), like "Scarica questo file" in the service. */
async function downloadReport(ws, id, name, progress) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id)) || (ws && !/^[0-9a-f-]{36}$/i.test(String(ws)))) throw new Error('Identificativo non valido.');
  progress?.(`Download di «${name}» dal servizio…`, null);
  const r = await fetch(`${group(ws)}/reports/${id}/Export?downloadType=IncludeModel`, { headers: { Authorization: `Bearer ${await token('pbi')}` } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const hint = r.status === 403 ? "Il download del file .pbix non è consentito (impostazione del tenant o dell'area di lavoro, oppure etichetta di riservatezza)." :
      r.status === 404 ? 'Report non trovato.' : /Export.*not supported|PBIX.*not|NotSupported/i.test(text) ? 'Questo report non può essere scaricato come .pbix (creato nel servizio, con aggiornamento incrementale o modello di grandi dimensioni): caricare invece il suo modello semantico.' : '';
    throw new Error(`${hint ? hint + ' ' : ''}(${r.status} ${text.slice(0, 200)})`);
  }
  const dir = path.join(app.getPath('userData'), 'pbi-downloads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeFile(name)}-${String(id).slice(0, 8)}.pbix`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

/** One DAX query on a semantic model (executeQueries); rows keyed by output column. */
async function daxRows(ws, id, query) {
  const r = await call('pbi', 'POST', `${group(ws)}/datasets/${id}/executeQueries`, { queries: [{ query }], serializerSettings: { includeNulls: true } });
  const res = r.results?.[0];
  if (res?.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
  return res?.tables?.[0]?.rows ?? [];
}

const TOM_TYPE = { text: 'string', string: 'string', int64: 'int64', integer: 'int64', 'whole number': 'int64', double: 'double', decimal: 'decimal', currency: 'decimal', datetime: 'dateTime', date: 'dateTime', boolean: 'boolean', 'true/false': 'boolean' };
const col = (row, name) => row[`[${name}]`] ?? row[name];

/**
 * A semantic model as read_pbix.py output: schema from the INFO.VIEW DAX functions, rows of every table
 * with EVALUATE (the service returns at most 100,000 rows / 1,000,000 values per query).
 */
async function datasetModel(ws, id, name, progress) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id)) || (ws && !/^[0-9a-f-]{36}$/i.test(String(ws)))) throw new Error('Identificativo non valido.');
  const out = { file: `powerbi://${ws || 'me'}/${id}`, kind: 'pbix', tables: [], relationships: [], measures: [], layout: null, resources: {}, customVisuals: [], parameters: [], warnings: [],
    model: { hierarchies: [], folders: [], dateTables: {}, calcGroups: [], roles: [] } };
  progress?.(`Lettura dello schema di «${name}»…`, 0);
  const tables = (await daxRows(ws, id, 'EVALUATE INFO.VIEW.TABLES()')).filter((t) => !/^(LocalDateTable_|DateTableTemplate_)/.test(col(t, 'Name')) && col(t, 'IsPrivate') !== true);
  const columns = await daxRows(ws, id, 'EVALUATE INFO.VIEW.COLUMNS()');
  const measures = await daxRows(ws, id, 'EVALUATE INFO.VIEW.MEASURES()').catch(() => []);
  const rels = await daxRows(ws, id, 'EVALUATE INFO.VIEW.RELATIONSHIPS()').catch(() => []);
  const dir = path.join(app.getPath('userData'), 'pbi-downloads', `${String(id).slice(0, 8)}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const names = new Set(tables.map((t) => col(t, 'Name')));
  let i = 0;
  for (const t of tables) {
    const tn = col(t, 'Name');
    const cols = columns.filter((c) => col(c, 'Table') === tn && !/^RowNumber-/.test(col(c, 'Name')));
    const real = cols.filter((c) => !/rownumber/i.test(String(col(c, 'Type') ?? '')));
    const isCalcGroup = !!col(t, 'CalculationGroupPrecedence') || col(t, 'CalculationGroup') === true;
    const onlyMeasures = real.length > 0 && real.every((c) => col(c, 'IsHidden') === true) && measures.some((m) => col(m, 'Table') === tn);
    progress?.(`Tabella ${tn}…`, i++ / Math.max(1, tables.length));
    if (onlyMeasures) continue;
    const meta = {
      name: tn, parquet: null, rows: 0, m: null,
      columns: real.map((c) => ({ name: col(c, 'Name'), dataType: TOM_TYPE[String(col(c, 'DataType') ?? 'string').toLowerCase()] ?? 'string' })),
      sortBy: Object.fromEntries(real.filter((c) => col(c, 'SortByColumn')).map((c) => [col(c, 'Name'), col(c, 'SortByColumn')])),
      dataCategory: Object.fromEntries(real.filter((c) => col(c, 'DataCategory') && !['Uncategorized', 'Regular'].includes(col(c, 'DataCategory'))).map((c) => [col(c, 'Name'), col(c, 'DataCategory')])),
    };
    if (isCalcGroup) { out.tables.push(meta); continue; }
    let rows;
    try { rows = await daxRows(ws, id, `EVALUATE '${tn.replace(/'/g, "''")}'`); } catch (e) { out.warnings.push(`Tabella ${tn}: ${e.message}`); out.tables.push(meta); continue; }
    if (rows.length >= 100000) out.warnings.push(`Tabella ${tn}: caricate le prime ${rows.length.toLocaleString('it-IT')} righe (limite delle query del servizio).`);
    if (rows.length) {
      const strip = (k) => { const m = /\[([^\]]*(?:\]\][^\]]*)*)\]$/.exec(k); return m ? m[1].replace(/]]/g, ']') : k; };
      const json = path.join(dir, `${i}.json`);
      fs.writeFileSync(json, rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [strip(k), v])))).join('\n'));
      const pq = path.join(dir, `${i}.parquet`);
      await db.query(`COPY (SELECT * FROM read_json_auto('${json.replace(/'/g, "''")}', format = 'newline_delimited')) TO '${pq.replace(/'/g, "''")}' (FORMAT parquet)`);
      fs.unlinkSync(json);
      meta.parquet = pq;
      meta.rows = rows.length;
    }
    out.tables.push(meta);
  }
  for (const m of measures) {
    const tn = col(m, 'Table');
    out.measures.push({ table: tn, name: col(m, 'Name'), expression: col(m, 'Expression') ?? '', formatString: col(m, 'FormatString') ?? '' });
    if (col(m, 'DisplayFolder')) out.model.folders.push({ table: tn, name: col(m, 'Name'), folder: col(m, 'DisplayFolder') });
  }
  for (const r of rels) {
    const ft = col(r, 'FromTable'), tt = col(r, 'ToTable');
    if (!names.has(ft) || !names.has(tt)) continue;
    const fc = String(col(r, 'FromCardinality') ?? 'Many').toLowerCase(), tc = String(col(r, 'ToCardinality') ?? 'One').toLowerCase();
    out.relationships.push({
      fromTable: ft, fromColumn: col(r, 'FromColumn'), toTable: tt, toColumn: col(r, 'ToColumn'),
      cardinality: fc === 'one' && tc === 'one' ? 'oneToOne' : fc === 'many' && tc === 'many' ? 'manyToMany' : fc === 'one' ? 'oneToMany' : 'manyToOne',
      crossFilter: /both/i.test(String(col(r, 'CrossFilteringBehavior') ?? '')) ? 'both' : 'single',
      active: col(r, 'IsActive') !== false,
    });
  }
  out.warnings.push('Modello caricato dal servizio Power BI in modalità importazione: per aggiornare i dati ricaricarlo da Ottieni dati › Power BI.');
  progress?.('Modello letto.', 1);
  return out;
}

// ---------- data access ----------

const isInt = (t) => /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT)$/i.test(t);
const isNum = (t) => isInt(t) || /^(FLOAT|REAL|DOUBLE)$/i.test(t) || /^DECIMAL/i.test(t);
const isTs = (t) => /^TIMESTAMP/i.test(t);

async function* chunks(table, columns, size) {
  const cols = columns.map(qi).join(', ');
  for (let off = 0; ; off += size) {
    const r = await db.query(`SELECT ${cols} FROM ${qi(table)} LIMIT ${size} OFFSET ${off}`);
    if (!r.rows.length) return;
    yield r.rows;
    if (r.rows.length < size) return;
  }
}

async function columnTypes(table) {
  const d = await db.describe(table);
  return { rows: d.rowCount, types: Object.fromEntries(d.columns.map((c) => [c.name, c.type])) };
}

// ---------- push dataset (Power BI Pro) ----------

function pushValue(v, type) {
  if (v === null || v === undefined) return null;
  if (isNum(type)) return Number(v);
  if (type === 'BOOLEAN') return v === true || v === 'true';
  if (isTs(type)) return String(v).replace(' ', 'T');
  return v;
}

const MAX_PUSH_ROWS = 5_000_000;
const ROWS_PER_POST = 10_000;

/** spec: { workspace, name, schema (push dataset definition), thinParts (report package parts) } */
async function publishPush(spec, progress) {
  const base = group(spec.workspace);
  const schema = { ...spec.schema, name: spec.name, defaultMode: 'Push' };
  let total = 0;
  for (const t of schema.tables) total += t.rows ?? 0;
  for (const t of schema.tables) {
    if ((t.rows ?? 0) > MAX_PUSH_ROWS) throw new Error(`La tabella "${t.name}" ha ${t.rows} righe: i dataset push ne accettano al massimo 5 milioni per tabella. Usare un'area di lavoro con capacità (modello completo).`);
  }
  if (total > 1_000_000) progress(`Attenzione: ${total.toLocaleString('it-IT')} righe in totale. Il servizio accetta circa 1 milione di righe all'ora per dataset push: il caricamento verrà rallentato dai limiti di velocità.`);
  const clean = { ...schema, tables: schema.tables.map(({ rows, virtual, ...t }) => t) };

  progress('Ricerca del dataset esistente…');
  const existing = ((await call('pbi', 'GET', `${base}/datasets`)).value ?? []).find((d) => d.name === spec.name && d.addRowsAPIEnabled);
  let datasetId = existing?.id;
  if (existing) {
    // Tables and relationships cannot be added to an existing push dataset: recreate it if they changed.
    const cur = (await call('pbi', 'GET', `${base}/datasets/${datasetId}/tables`)).value ?? [];
    const same = cur.length === clean.tables.length && clean.tables.every((t) => cur.some((c) => c.name === t.name));
    const relKey = crypto.createHash('sha1').update(JSON.stringify(clean.relationships ?? [])).digest('hex');
    if (!same || (loadCfg().pushRelationships ?? {})[datasetId] !== relKey) {
      progress('Struttura cambiata: ricreazione del dataset (i report collegati vengono ripubblicati).');
      await call('pbi', 'DELETE', `${base}/datasets/${datasetId}`);
      datasetId = null;
    } else {
      for (const t of clean.tables) {
        progress(`Aggiornamento schema e misure: ${t.name}`);
        await call('pbi', 'PUT', `${base}/datasets/${datasetId}/tables/${encodeURIComponent(t.name)}`, t);
      }
    }
  }
  if (!datasetId) {
    progress('Creazione del dataset push…');
    datasetId = (await call('pbi', 'POST', `${base}/datasets?defaultRetentionPolicy=None`, clean)).id;
    const relKey = crypto.createHash('sha1').update(JSON.stringify(clean.relationships ?? [])).digest('hex');
    saveCfg({ pushRelationships: { ...(loadCfg().pushRelationships ?? {}), [datasetId]: relKey } });
  }

  let sent = 0;
  for (const t of schema.tables) {
    if (t.virtual) continue;
    if (existing && datasetId === existing.id) await call('pbi', 'DELETE', `${base}/datasets/${datasetId}/tables/${encodeURIComponent(t.name)}/rows`);
    const { types } = await columnTypes(t.name);
    const cols = t.columns.map((c) => c.name);
    for await (const rows of chunks(t.name, cols, ROWS_PER_POST)) {
      const out = rows.map((r) => Object.fromEntries(cols.map((c) => [c, pushValue(r[c], types[c])])));
      await call('pbi', 'POST', `${base}/datasets/${datasetId}/tables/${encodeURIComponent(t.name)}/rows`, { rows: out });
      sent += rows.length;
      progress(`Righe inviate: ${sent.toLocaleString('it-IT')} / ${total.toLocaleString('it-IT')} (${t.name})`, sent / Math.max(1, total));
      // 120 POST rows requests per minute per dataset.
      await sleep(500);
    }
  }

  progress('Pubblicazione del report…');
  const report = await publishThinReport(spec, base, datasetId, progress);
  saveCfg({ lastWorkspace: spec.workspace });
  return { datasetId, reportId: report?.id ?? null, webUrl: report?.webUrl ?? null, warnings: report ? [] : ['Report non creato: aprire il dataset nel browser e scegliere "Crea report".'] };
}

async function zipParts(parts, substitutions) {
  const zip = new JSZip();
  const sub = (s) => Object.entries(substitutions).reduce((a, [k, v]) => a.split(k).join(v), s);
  for (const p of parts) {
    const opts = { createFolders: false };
    if (p.utf16 !== undefined) zip.file(p.path, Buffer.from(sub(p.utf16), 'utf16le'), opts);
    else if (p.utf8bom !== undefined) zip.file(p.path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sub(p.utf8bom), 'utf8')]), opts);
    else if (p.utf8 !== undefined) zip.file(p.path, Buffer.from(sub(p.utf8), 'utf8'), opts);
    else if (p.dataUrl) zip.file(p.path, Buffer.from(p.dataUrl.split(',')[1], 'base64'), opts);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Thin report: .pbix with the layout and a live connection; imported, then bound to the dataset. */
async function publishThinReport(spec, base, datasetId, progress) {
  const pbix = await zipParts(spec.thinParts, { __DATASET_ID__: datasetId, __REPORT_ID__: crypto.randomUUID(), __WORKSPACE_ID__: spec.workspace || '' });
  if (process.env.LINBI_PBI_THIN_OUT) fs.writeFileSync(process.env.LINBI_PBI_THIN_OUT, pbix);
  try {
    const fd = new FormData();
    fd.append('file', new Blob([pbix]), `${spec.name}.pbix`);
    const imp = await call('pbi', 'POST', `${base}/imports?datasetDisplayName=${encodeURIComponent(spec.name + '.pbix')}&nameConflict=CreateOrOverwrite`, fd);
    let st = imp;
    for (let i = 0; i < 120 && st.importState !== 'Succeeded'; i++) {
      if (st.importState === 'Failed') throw new Error(st.error?.details || st.error?.code || 'importazione non riuscita');
      await sleep(2000);
      st = await call('pbi', 'GET', `${base}/imports/${imp.id}`);
    }
    const report = st.reports?.[0];
    if (!report) throw new Error('importazione senza report');
    await call('pbi', 'POST', `${base}/reports/${report.id}/Rebind`, { datasetId });
    return report;
  } catch (e) {
    progress(`Importazione .pbix del report non riuscita (${e.message}). Tentativo con l'API Fabric…`);
  }
  // Fallback: Fabric item definition API (report.json + definition.pbir bound to the dataset).
  if (!spec.workspace) return null;
  try {
    const r = await upsertFabricReport(spec.workspace, spec.name, spec.reportParts, datasetId, progress);
    return { id: r.id, webUrl: `https://app.powerbi.com/groups/${spec.workspace}/reports/${r.id}` };
  } catch (e) {
    progress(`Report non creato: ${e.message}`);
    return null;
  }
}

// ---------- Fabric item definitions (capacity workspaces) ----------

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function pbirByConnection(datasetId) {
  return JSON.stringify({
    version: '1.0',
    datasetReference: {
      byPath: null,
      byConnection: {
        connectionString: `Data Source=pbiazure://api.powerbi.com/;Initial Catalog=${datasetId};semanticmodelid=${datasetId}`,
        pbiServiceModelId: null, pbiModelVirtualServerName: 'sobe_wowvirtualserver', pbiModelDatabaseName: datasetId,
        name: 'EntityDataSource', connectionType: 'pbiServiceXmlaStyleLive',
      },
    },
  }, null, 2);
}

async function upsertFabricReport(ws, name, reportParts, datasetId, progress) {
  const parts = [
    { path: 'definition.pbir', payload: b64(pbirByConnection(datasetId)), payloadType: 'InlineBase64' },
    ...reportParts.map((p) => ({ path: p.path, payload: p.text !== undefined ? b64(p.text) : p.dataUrl.split(',')[1], payloadType: 'InlineBase64' })),
  ];
  const list = (await call('fabric', 'GET', `${FABRIC}/workspaces/${ws}/reports`)).value ?? [];
  const cur = list.find((r) => r.displayName === name);
  if (cur) {
    progress('Aggiornamento del report…');
    await fabricLro('POST', `${FABRIC}/workspaces/${ws}/reports/${cur.id}/updateDefinition`, { definition: { parts } });
    return cur;
  }
  progress('Creazione del report…');
  return fabricLro('POST', `${FABRIC}/workspaces/${ws}/reports`, { displayName: name, definition: { parts } });
}

/** M of a table snapshot: rows as deflate-compressed JSON, like Power BI "Immetti dati". */
async function embeddedM(table, columns) {
  const { types } = await columnTypes(table);
  const rows = [];
  for await (const chunk of chunks(table, columns.map((c) => c.name), 50_000)) {
    for (const r of chunk) {
      rows.push(columns.map((c) => {
        const v = r[c.name];
        if (v === null || v === undefined) return null;
        return isTs(types[c.name]) ? String(v).replace(' ', 'T') : String(v);
      }));
    }
  }
  const data = zlib.deflateRawSync(Buffer.from(JSON.stringify(rows), 'utf8'), { level: 9 }).toString('base64');
  const name = (n) => `#"${n.replace(/"/g, '""')}"`;
  const str = (s) => `"${s.replace(/"/g, '""')}"`;
  const m = [
    'let',
    `    Origine = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${data}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${columns.map((c) => `${name(c.name)} = _t`).join(', ')}]),`,
    // Values were serialised with "." decimals and ISO dates: convert with an invariant culture.
    `    #"Modificato tipo" = Table.TransformColumnTypes(Origine, {${columns.map((c) => `{${str(c.name)}, ${c.m}}`).join(', ')}}, "en-US")`,
    'in',
    '    #"Modificato tipo"',
  ];
  return { lines: m, bytes: data.length };
}

const MAX_EMBED = 32 * 1024 * 1024;

/** spec: { workspace, name, model (TMSL), embed: [{ table, columns: [{name, m}] }], reportParts, refresh } */
async function publishFabric(spec, progress) {
  if (!spec.workspace) throw new Error('Il modello completo richiede un\'area di lavoro su capacità Fabric, Premium o Premium Per User.');
  const ws = spec.workspace;
  const model = spec.model;
  for (const e of spec.embed) {
    progress(`Incorporamento dati: ${e.table}`);
    const { lines, bytes } = await embeddedM(e.table, e.columns);
    if (bytes > MAX_EMBED) throw new Error(`La tabella "${e.table}" è troppo grande da incorporare (${(bytes / 1048576).toFixed(0)} MB compressi). Usare un'origine raggiungibile dal servizio o un dataset push.`);
    const t = model.model.tables.find((x) => x.name === e.table);
    t.partitions[0].source = { type: 'm', expression: lines };
  }
  const parts = [
    { path: 'definition.pbism', payload: b64(JSON.stringify({ version: '1.0', settings: {} })), payloadType: 'InlineBase64' },
    { path: 'model.bim', payload: b64(JSON.stringify(model)), payloadType: 'InlineBase64' },
  ];
  progress('Ricerca del modello semantico esistente…');
  const list = (await call('fabric', 'GET', `${FABRIC}/workspaces/${ws}/semanticModels`)).value ?? [];
  let sm = list.find((m) => m.displayName === spec.name);
  if (sm) {
    progress('Aggiornamento della definizione del modello semantico…');
    await fabricLro('POST', `${FABRIC}/workspaces/${ws}/semanticModels/${sm.id}/updateDefinition`, { definition: { parts } });
  } else {
    progress('Creazione del modello semantico…');
    sm = await fabricLro('POST', `${FABRIC}/workspaces/${ws}/semanticModels`, { displayName: spec.name, definition: { parts } });
    if (!sm?.id) sm = ((await call('fabric', 'GET', `${FABRIC}/workspaces/${ws}/semanticModels`)).value ?? []).find((m) => m.displayName === spec.name);
  }
  if (!sm?.id) throw new Error('Modello semantico creato ma non trovato nell\'area di lavoro.');

  const warnings = [];
  progress('Aggiornamento dei dati nel servizio…');
  try {
    await call('pbi', 'POST', `${PBI}/groups/${ws}/datasets/${sm.id}/refreshes`, { notifyOption: 'NoNotification' });
    for (let i = 0; i < 360; i++) {
      await sleep(5000);
      const h = (await call('pbi', 'GET', `${PBI}/groups/${ws}/datasets/${sm.id}/refreshes?$top=1`)).value?.[0];
      if (!h || h.status === 'Unknown') continue;
      if (h.status === 'Completed') { progress('Dati aggiornati.'); break; }
      let detail = h.serviceExceptionJson ?? '';
      try { const x = JSON.parse(detail); detail = x.errorDescription || x.errorCode || detail; } catch { /* raw */ }
      warnings.push(`Aggiornamento dei dati non riuscito: ${detail || h.status}. Se il modello usa database, impostare le credenziali (o un gateway) in Impostazioni › Modello semantico › Credenziali origine dati.`);
      break;
    }
  } catch (e) {
    warnings.push(`Aggiornamento dei dati non avviato: ${e.message}`);
  }

  const report = await upsertFabricReport(ws, spec.name, spec.reportParts, sm.id, progress);
  saveCfg({ lastWorkspace: ws });
  return { datasetId: sm.id, reportId: report?.id ?? null, webUrl: report?.id ? `https://app.powerbi.com/groups/${ws}/reports/${report.id}` : null, warnings };
}

/** Sensitivity labels available to the signed-in user (Microsoft Purview, Graph InformationProtectionPolicy.Read). */
async function labels() {
  const graph = process.env.LINBI_GRAPH || 'https://graph.microsoft.com/v1.0';
  const t = await token('graph');
  const tenant = claims(t).tid ?? '';
  for (const url of [`${graph}/me/security/informationProtection/sensitivityLabels`, `${graph.replace('/v1.0', '/beta')}/me/security/informationProtection/sensitivityLabels`]) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 404 || r.status === 400) continue;
    if (!r.ok) throw new Error(`Etichette di riservatezza non disponibili (${r.status}): servono il permesso Microsoft Graph InformationProtectionPolicy.Read e una licenza Microsoft Purview.`);
    const j = await r.json();
    return (j.value ?? []).filter((l) => l.isActive !== false).map((l) => ({ id: l.id, name: l.displayName ?? l.name, color: l.color || undefined, description: l.description || l.tooltip || undefined, tenant }));
  }
  throw new Error('Etichette di riservatezza non disponibili per questo account.');
}

module.exports = {
  loginBrowser, loginBrowserCancel, serviceItems, downloadReport, datasetModel, status, configure, addProfile, selectProfile, removeProfile, signOut, loginStart, loginWait, loginCancel, workspaces, publishPush, publishFabric, token, labels };
