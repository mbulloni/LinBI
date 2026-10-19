// Builds the offline geographic data used by the map visuals (src/geo/*.json).
// Usage: node scripts/build-geo.mjs <dir with openpolis limits_IT_*.geojson and NE populated places>
//   limits_IT_regions/provinces/municipalities.geojson: https://github.com/openpolis/geojson-italy (CC BY 4.0, ISTAT)
//   places.geojson: Natural Earth ne_10m_populated_places_simple (public domain)
// Countries: world-atlas (Natural Earth, public domain); US states: us-atlas (US Census, public domain).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linbi-geo-'));

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uniq = (a) => [...new Set(a.filter(Boolean).map(norm).filter(Boolean))];

/** Writes features as simplified TopoJSON (mapshaper), adding inner points as `c`. */
function layer(name, features, simplify) {
  const gj = path.join(tmp, name + '.geojson');
  fs.writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features }));
  const target = path.join(out, name + '.json');
  execFileSync(path.join(root, 'node_modules', '.bin', 'mapshaper'), [
    gj, '-simplify', simplify, 'keep-shapes', '-each', 'c=[+this.innerX.toFixed(4), +this.innerY.toFixed(4)]',
    '-rename-layers', 'f', '-o', 'format=topojson', 'quantization=100000', target,
  ], { stdio: 'inherit' });
  console.log(name, features.length, (fs.statSync(target).size / 1024).toFixed(0) + ' KB');
}

// --- World countries
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

// --- US states (FIPS → postal code)
const FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR', '60': 'AS', '66': 'GU', '69': 'MP', '78': 'VI' };
const us = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/us-atlas/states-10m.json'), 'utf8'));
layer('us-states', topojson.feature(us, us.objects.states).features.map((f) => ({
  type: 'Feature', geometry: f.geometry,
  properties: { n: f.properties.name, k: uniq([f.properties.name, FIPS[f.id], FIPS[f.id] && 'US-' + FIPS[f.id]]) },
})), '10%');

// --- Italy (openpolis / ISTAT)
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

// --- World cities (points): [name, lon, lat, iso2, population, admin1]
const places = JSON.parse(fs.readFileSync(path.join(src, 'places.geojson'), 'utf8')).features
  .map((f) => f.properties)
  .sort((a, b) => (b.pop_max ?? 0) - (a.pop_max ?? 0))
  .map((p) => [p.name, +(+p.longitude).toFixed(4), +(+p.latitude).toFixed(4), p.iso_a2, p.pop_max ?? 0, p.adm1name ?? '', p.nameascii !== p.name ? p.nameascii : '']);
fs.writeFileSync(path.join(out, 'cities.json'), JSON.stringify(places));
console.log('cities', places.length, (fs.statSync(path.join(out, 'cities.json')).size / 1024).toFixed(0) + ' KB');
fs.rmSync(tmp, { recursive: true });
