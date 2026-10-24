// Builds the offline geographic data used by the map visuals (src/geo/*.json).
// Usage: node scripts/build-geo.mjs <dir with openpolis limits_IT_*.geojson and NE populated places>
//   limits_IT_regions/provinces/municipalities.geojson: https://github.com/openpolis/geojson-italy (CC BY 4.0, ISTAT)
//   places.geojson: Natural Earth ne_10m_populated_places_simple (public domain)
//   ne_10m_admin_1_states_provinces.shp, ne_50m_admin_0_countries.shp: Natural Earth (public domain) → admin1, continents
//   <CC>.txt: GeoNames postal codes https://download.geonames.org/export/zip/ (CC BY 4.0) → postal.json
// Countries: world-atlas (Natural Earth, public domain); US states: us-atlas (US Census, public domain).
// GEO_ONLY=admin1,continents,postal limits the run to some layers (each also needs its source files).
// Every polygon layer is a TopoJSON with object "f" whose features have { n: name, k: [aliases], c: [lon, lat] }.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as topojson from 'topojson-client';

const require = createRequire(import.meta.url);
const countries = require('i18n-iso-countries');
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));
countries.registerLocale(require('i18n-iso-countries/langs/it.json'));

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-geo.mjs <raw dir>'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'src', 'geo');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mib-bi-geo-'));

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uniq = (a) => [...new Set(a.filter(Boolean).map(norm).filter(Boolean))];
const only = process.env.GEO_ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const mapshaper = path.join(root, 'node_modules', '.bin', 'mapshaper');
/** Shapefile → GeoJSON features (optionally through mapshaper commands such as -dissolve). */
function shp(file, ...cmds) {
  const outFile = path.join(tmp, path.basename(file) + '.geojson');
  execFileSync(mapshaper, [file, ...cmds, '-o', 'format=geojson', outFile], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(outFile, 'utf8')).features;
}

/** Writes features as simplified TopoJSON (mapshaper), adding inner points as `c`. */
function layer(name, features, simplify) {
  const gj = path.join(tmp, name + '.geojson');
  fs.writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features }));
  const target = path.join(out, name + '.json');
  execFileSync(mapshaper, [
    gj, '-simplify', simplify, 'keep-shapes', '-each', 'c=[+this.innerX.toFixed(4), +this.innerY.toFixed(4)]',
    '-rename-layers', 'f', '-o', 'format=topojson', 'quantization=100000', target,
  ], { stdio: 'inherit' });
  console.log(name, features.length, (fs.statSync(target).size / 1024).toFixed(0) + ' KB');
}

// --- World countries
if (want('world')) {
const world = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const EXTRA = { USA: ['USA', 'US', 'United States', 'United States of America', 'Stati Uniti', "Stati Uniti d'America", 'America'], GBR: ['UK', 'Great Britain', 'Regno Unito', 'England', 'Inghilterra', 'Gran Bretagna'], RUS: ['Russia'], KOR: ['South Korea', 'Corea del Sud', 'Korea'], PRK: ['North Korea', 'Corea del Nord'], CZE: ['Czech Republic', 'Czechia', 'Repubblica Ceca', 'Cechia'], NLD: ['Holland', 'Olanda'], CIV: ["Ivory Coast", "Costa d'Avorio"], VNM: ['Vietnam'], IRN: ['Iran'], SYR: ['Syria', 'Siria'], BOL: ['Bolivia'], VEN: ['Venezuela'], TZA: ['Tanzania'], LAO: ['Laos'], MDA: ['Moldova', 'Moldavia'], MKD: ['Macedonia', 'North Macedonia', 'Macedonia del Nord'], COD: ['DR Congo', 'Congo-Kinshasa'], COG: ['Congo', 'Congo-Brazzaville'], VAT: ['Vatican', 'Vaticano', 'Città del Vaticano'] };
const wf = topojson.feature(world, world.objects.countries).features.map((f) => {
  const num = String(f.id ?? '').padStart(3, '0');
  const a3 = countries.numericToAlpha3(num);
  const a2 = a3 ? countries.alpha3ToAlpha2(a3) : undefined;
  const names = a3 ? [countries.getName(a3, 'en'), countries.getName(a3, 'it'), ...(countries.getNames('en', { select: 'all' })[a2] ?? []), ...(countries.getNames('it', { select: 'all' })[a2] ?? [])] : [];
  const name = a3 ? countries.getName(a3, 'it') ?? f.properties.name : f.properties.name;
  return { type: 'Feature', geometry: f.geometry, properties: { n: name, k: uniq([f.properties.name, ...names, a2, a3, ...(EXTRA[a3] ?? [])]) } };
});
layer('world', wf, '12%');
}

// --- US states (FIPS → postal code)
if (want('us')) {
const FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR', '60': 'AS', '66': 'GU', '69': 'MP', '78': 'VI' };
const us = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/us-atlas/states-10m.json'), 'utf8'));
layer('us-states', topojson.feature(us, us.objects.states).features.map((f) => ({
  type: 'Feature', geometry: f.geometry,
  properties: { n: f.properties.name, k: uniq([f.properties.name, FIPS[f.id], FIPS[f.id] && 'US-' + FIPS[f.id]]) },
})), '10%');
}

// --- Italy (openpolis / ISTAT)
if (want('italy')) {
const it = (f) => JSON.parse(fs.readFileSync(path.join(src, `limits_IT_${f}.geojson`), 'utf8')).features;
const variants = (n) => [n, ...n.split('/'), n.replace(/-/g, ' '), n.split('/')[0].replace(/-/g, ' ')];
layer('it-regions', it('regions').map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {
  n: f.properties.reg_name.split('/')[0], k: uniq([...variants(f.properties.reg_name), f.properties.reg_iso_3166_2, f.properties.reg_istat_code]),
} })), '6%');
layer('it-provinces', it('provinces').map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {
  n: f.properties.prov_name.split('/')[0], k: uniq([...variants(f.properties.prov_name), f.properties.prov_acr, f.properties.prov_iso_3166_2, 'provincia di ' + f.properties.prov_name]),
} })), '5%');
layer('it-municipalities', it('municipalities').map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {
  n: f.properties.name, p: f.properties.prov_acr,
  k: uniq([...variants(f.properties.name), f.properties.com_istat_code, f.properties.com_catasto_code, `${f.properties.name} ${f.properties.prov_acr}`]),
} })), '2%');
}

// --- World cities (points): [name, lon, lat, iso2, population, admin1]
if (want('cities')) {
const places = JSON.parse(fs.readFileSync(path.join(src, 'places.geojson'), 'utf8')).features
  .map((f) => f.properties)
  .sort((a, b) => (b.pop_max ?? 0) - (a.pop_max ?? 0))
  .map((p) => [p.name, +(+p.longitude).toFixed(4), +(+p.latitude).toFixed(4), p.iso_a2, p.pop_max ?? 0, p.adm1name ?? '', p.nameascii !== p.name ? p.nameascii : '']);
fs.writeFileSync(path.join(out, 'cities.json'), JSON.stringify(places));
console.log('cities', places.length, (fs.statSync(path.join(out, 'cities.json')).size / 1024).toFixed(0) + ' KB');
}

// --- States/provinces of every country (Natural Earth admin-1); p = ISO2 country
const admin1 = path.join(src, 'ne_10m_admin_1_states_provinces.shp');
if (want('admin1') && fs.existsSync(admin1)) {
  layer('admin1', shp(admin1).filter((f) => f.geometry).map((f) => {
    const p = f.properties;
    const names = [p.name, p.name_en, p.name_it, p.name_de, p.name_fr, p.name_es, p.name_pt, p.name_nl, p.name_local, p.gn_name, p.woe_name, ...(p.name_alt ?? '').split('|')].filter(Boolean);
    return { type: 'Feature', geometry: f.geometry, properties: {
      n: p.name_it || p.name, p: p.iso_a2,
      k: uniq([...names, p.iso_3166_2, p.iso_3166_2?.replace('-', ' '), ...names.map((n) => `${n} ${p.iso_a2}`), ...names.map((n) => `${n} ${p.admin}`)]),
    } };
  }), '4%');
}

// --- Continents (countries dissolved by CONTINENT)
const admin0 = path.join(src, 'ne_50m_admin_0_countries.shp');
if (want('continents') && fs.existsSync(admin0)) {
  const IT = { Africa: 'Africa', Antarctica: 'Antartide', Asia: 'Asia', Europe: 'Europa', 'North America': 'Nord America', 'South America': 'Sud America', Oceania: 'Oceania' };
  const ALT = { 'North America': ['America del Nord', 'Nordamerica', 'NA'], 'South America': ['America del Sud', 'Sudamerica', 'SA'], Europe: ['EU', 'EMEA Europa'], Oceania: ['Australia e Oceania', 'Australasia'], Antarctica: ['Antartica'] };
  layer('continents', shp(admin0, '-dissolve', 'CONTINENT').filter((f) => IT[f.properties.CONTINENT]).map((f) => {
    const c = f.properties.CONTINENT;
    return { type: 'Feature', geometry: f.geometry, properties: { n: IT[c], k: uniq([c, IT[c], ...(ALT[c] ?? [])]) } };
  }), '10%');
}

// --- Postal codes (points), GeoNames: { CC: [[code, lon, lat], …] }, one point per code (mean of its places)
const postalFiles = fs.readdirSync(src).filter((f) => /^[A-Z]{2}\.txt$/.test(f));
if (want('postal') && postalFiles.length) {
  const outp = {};
  for (const f of postalFiles) {
    const by = new Map();
    for (const line of fs.readFileSync(path.join(src, f), 'utf8').split('\n')) {
      const c = line.split('\t');
      if (c.length < 11 || !c[1]) continue;
      // Portugal: CP4 (the part before "-"); lookups of full codes fall back to the first part.
      const code = (f.startsWith('PT') ? c[1].split('-')[0] : c[1]).trim().toUpperCase(), lat = +c[9], lon = +c[10];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const e = by.get(code) ?? { lat: 0, lon: 0, n: 0 };
      e.lat += lat; e.lon += lon; e.n++;
      by.set(code, e);
    }
    outp[f.slice(0, 2)] = [...by].map(([code, e]) => [code, +(e.lon / e.n).toFixed(3), +(e.lat / e.n).toFixed(3)]);
  }
  fs.writeFileSync(path.join(out, 'postal.json'), JSON.stringify(outp));
  console.log('postal', Object.entries(outp).map(([k, v]) => `${k} ${v.length}`).join(', '), (fs.statSync(path.join(out, 'postal.json')).size / 1024).toFixed(0) + ' KB');
}
fs.rmSync(tmp, { recursive: true });
