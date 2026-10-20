// Offline geocoding for the map visuals: location names/codes → features of the bundled layers
// (continents, countries, states/provinces of every country, US states, Italian regions/provinces/municipalities)
// or points (world cities, postal codes of IT/US and main European countries).
// Layers load lazily (separate chunks). See scripts/build-geo.mjs for the data.
import * as topojson from 'topojson-client';

export type PolyLayer = 'world' | 'continents' | 'admin1' | 'us-states' | 'it-regions' | 'it-provinces' | 'it-municipalities';
export type GeoLayer = PolyLayer | 'cities' | 'postal';

export interface GeoFeature { type: 'Feature'; geometry: any; properties: { n: string; k: string[]; c: [number, number]; p?: string } }
export interface LoadedLayer { name: PolyLayer; fc: { type: 'FeatureCollection'; features: GeoFeature[] }; index: Map<string, number>; }

export const LAYER_LABEL: Record<GeoLayer, string> = {
  world: 'Paesi', 'us-states': 'Stati USA', 'it-regions': 'Regioni italiane', 'it-provinces': 'Province italiane',
  'it-municipalities': 'Comuni italiani', cities: 'Città', continents: 'Continenti', admin1: 'Stati e province', postal: 'Codici postali',
};

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const LOAD: Record<PolyLayer, () => Promise<any>> = {
  world: () => import('./world.json?raw'),
  continents: () => import('./continents.json?raw'),
  admin1: () => import('./admin1.json?raw'),
  'us-states': () => import('./us-states.json?raw'),
  'it-regions': () => import('./it-regions.json?raw'),
  'it-provinces': () => import('./it-provinces.json?raw'),
  'it-municipalities': () => import('./it-municipalities.json?raw'),
};

const layers = new Map<PolyLayer, Promise<LoadedLayer>>();
export function loadLayer(name: PolyLayer): Promise<LoadedLayer> {
  let p = layers.get(name);
  if (!p) {
    p = LOAD[name]().then((m) => {
      const topo = JSON.parse(m.default);
      const fc = topojson.feature(topo, topo.objects.f) as unknown as LoadedLayer['fc'];
      const index = new Map<string, number>();
      fc.features.forEach((f, i) => { for (const k of f.properties.k) if (!index.has(k)) index.set(k, i); });
      return { name, fc, index };
    });
    layers.set(name, p);
  }
  return p;
}

type City = [string, number, number, string, number, string, string]; // name, lon, lat, iso2, population, admin1, ascii name
let cities: Promise<Map<string, City>> | null = null;
function loadCities() {
  cities ??= import('./cities.json?raw').then((m) => {
    const list = JSON.parse(m.default) as City[];
    const index = new Map<string, City>();
    // Sorted by population: the first city with a name wins ("Paris" = Paris, France).
    for (const c of list) for (const k of [c[0], c[6], `${c[0]} ${c[3]}`]) { const n = norm(k); if (n && !index.has(n)) index.set(n, c); }
    return index;
  });
  return cities;
}

/** Postal codes: country → [code, lon, lat]; index by code (several countries may share one). */
type PostalHit = [string, number, number]; // iso2, lon, lat
let postal: Promise<Map<string, PostalHit[]>> | null = null;
function loadPostal() {
  postal ??= import('./postal.json?raw').then((m) => {
    const data = JSON.parse(m.default) as Record<string, [string, number, number][]>;
    const index = new Map<string, PostalHit[]>();
    for (const [cc, list] of Object.entries(data)) for (const [code, lon, lat] of list) {
      const k = norm(code);
      const hit: PostalHit = [cc, lon, lat];
      (index.get(k) ?? index.set(k, []).get(k)!).push(hit);
      index.set(`${k} ${cc.toLowerCase()}`, [hit]);
    }
    return index;
  });
  return postal;
}
/** Postal code variants: as written, then its first part ("SW1A 1AA" → SW1A, "1000-001" → 1000, "1012 AB" → 1012). */
const postalKeys = (v: string) => { const k = norm(v); const first = k.split(' ')[0]; return first !== k ? [k, first] : [k]; };

/** Power BI data category (Strumenti colonna › Categoria dati) → layers, most likely first. */
const BY_CATEGORY: Record<string, GeoLayer[]> = {
  Country: ['world'], Continent: ['continents'], StateOrProvince: ['it-regions', 'us-states', 'admin1', 'it-provinces'],
  County: ['it-provinces', 'admin1'], City: ['it-municipalities', 'cities'], Place: ['cities', 'it-municipalities'], Address: ['cities', 'it-municipalities'],
  PostalCode: ['postal'],
};
export const GEO_CATEGORIES = Object.keys(BY_CATEGORY);

/** Candidate layers from the column's data category, else from its name. */
function hinted(column: string, category?: string): GeoLayer[] {
  if (category && BY_CATEGORY[category]) return BY_CATEGORY[category];
  const c = norm(column);
  if (/\b(cap|zip|zipcode|postal|postcode|plz|codice postale|cod postale|code postal|cp)\b/.test(c)) return ['postal'];
  if (/\b(continent|continente|continenti|continents)\b/.test(c)) return ['continents'];
  if (/\b(country|countries|paese|paesi|nazione|nazioni|nation)\b/.test(c)) return ['world'];
  if (/\b(comune|comuni|citta|city|cities|town|localita|municipality)\b/.test(c)) return ['it-municipalities', 'cities'];
  if (/\b(provincia|province|prov|sigla|county|contea)\b/.test(c)) return ['it-provinces', 'us-states', 'admin1'];
  if (/\b(regione|regioni|region|regions|land|lander)\b/.test(c)) return ['it-regions', 'us-states', 'admin1', 'world'];
  if (/\b(state|states|stato|stati|bundesland)\b/.test(c)) return ['us-states', 'admin1', 'world', 'it-regions'];
  return [];
}
const ORDER: GeoLayer[] = ['world', 'continents', 'it-regions', 'us-states', 'it-provinces', 'admin1', 'it-municipalities', 'cities', 'postal'];
const POINTS = new Set<GeoLayer>(['cities', 'postal']);

export interface Geocoded {
  layer: GeoLayer;
  /** location value → [lon, lat] and, for polygon layers, the feature name in the layer */
  hits: Map<string, { coord: [number, number]; feature?: string }>;
  missing: string[];
  poly?: LoadedLayer;
}

/** Picks the layer that recognizes most values (column-name hint first) and resolves each value.
 *  `polygons`: only polygon layers (filled map). */
export async function geocode(values: string[], column: string, polygons: boolean, category?: string): Promise<Geocoded> {
  const distinct = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
  const hint = hinted(column, category).filter((l) => !polygons || !POINTS.has(l));
  const order = [...hint, ...ORDER.filter((l) => !hint.includes(l) && (!polygons || !POINTS.has(l)))];
  let best: Geocoded | null = null;
  for (const layer of order) {
    const hits = new Map<string, { coord: [number, number]; feature?: string }>();
    let poly: LoadedLayer | undefined;
    if (layer === 'cities') {
      const idx = await loadCities();
      for (const v of distinct) { const c = idx.get(norm(v)); if (c) hits.set(v, { coord: [c[1], c[2]] }); }
    } else if (layer === 'postal') {
      // Postal codes are only tried when hinted or when the values look like codes (digits, letters+digits).
      if (!hint.includes('postal') && !distinct.every((v) => /^[A-Z0-9][A-Z0-9 -]{2,9}$/i.test(String(v)) && /\d/.test(String(v)))) continue;
      const idx = await loadPostal();
      const lists = distinct.map((v) => { for (const k of postalKeys(String(v))) { const l = idx.get(k); if (l) return l; } return undefined; });
      // Shared codes (e.g. 10115 in DE and US): the country that matches most values wins.
      const votes = new Map<string, number>();
      for (const l of lists) for (const cc of new Set(l?.map((h) => h[0]) ?? [])) votes.set(cc, (votes.get(cc) ?? 0) + 1);
      const top = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
      distinct.forEach((v, i) => { const l = lists[i]; const h = l?.find((x) => x[0] === top) ?? l?.[0]; if (h) hits.set(v, { coord: [h[1], h[2]] }); });
    } else {
      poly = await loadLayer(layer);
      for (const v of distinct) {
        const i = poly.index.get(norm(v));
        if (i !== undefined) { const f = poly.fc.features[i]; hits.set(v, { coord: f.properties.c, feature: f.properties.n }); }
      }
    }
    if (!best || hits.size > best.hits.size) best = { layer, hits, poly, missing: [] };
    // A hinted layer that recognizes most values wins; otherwise keep looking for a better one.
    if (hits.size === distinct.length || (hint.includes(layer) && hits.size >= distinct.length * 0.8)) break;
  }
  best ??= { layer: 'world', hits: new Map(), missing: [] };
  best.missing = distinct.filter((v) => !best!.hits.has(v));
  return best;
}
