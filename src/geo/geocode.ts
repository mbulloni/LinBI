// Offline geocoding for the map visuals: location names/codes → features of the bundled layers
// (countries, US states, Italian regions/provinces/municipalities) or world cities (points).
// Layers load lazily (separate chunks). See scripts/build-geo.mjs for the data.
import * as topojson from 'topojson-client';

export type PolyLayer = 'world' | 'us-states' | 'it-regions' | 'it-provinces' | 'it-municipalities';
export type GeoLayer = PolyLayer | 'cities';

export interface GeoFeature { type: 'Feature'; geometry: any; properties: { n: string; k: string[]; c: [number, number]; p?: string } }
export interface LoadedLayer { name: PolyLayer; fc: { type: 'FeatureCollection'; features: GeoFeature[] }; index: Map<string, number>; }

export const LAYER_LABEL: Record<GeoLayer, string> = {
  world: 'Paesi', 'us-states': 'Stati USA', 'it-regions': 'Regioni italiane', 'it-provinces': 'Province italiane',
  'it-municipalities': 'Comuni italiani', cities: 'Città',
};

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const LOAD: Record<PolyLayer, () => Promise<any>> = {
  world: () => import('./world.json?raw'),
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

/** Candidate layers from the column name (Power BI uses the column's data category; LinBI guesses it). */
function hinted(column: string): GeoLayer[] {
  const c = norm(column);
  if (/\b(country|countries|paese|paesi|nazione|nazioni|nation)\b/.test(c)) return ['world'];
  if (/\b(comune|comuni|citta|city|cities|town|localita|municipality)\b/.test(c)) return ['it-municipalities', 'cities'];
  if (/\b(provincia|province|prov|sigla)\b/.test(c)) return ['it-provinces', 'us-states'];
  if (/\b(regione|regioni|region|regions)\b/.test(c)) return ['it-regions', 'us-states', 'world'];
  if (/\b(state|states|stato)\b/.test(c)) return ['us-states', 'world', 'it-regions'];
  return [];
}
const ORDER: GeoLayer[] = ['world', 'it-regions', 'us-states', 'it-provinces', 'it-municipalities', 'cities'];

export interface Geocoded {
  layer: GeoLayer;
  /** location value → [lon, lat] and, for polygon layers, the feature name in the layer */
  hits: Map<string, { coord: [number, number]; feature?: string }>;
  missing: string[];
  poly?: LoadedLayer;
}

/** Picks the layer that recognizes most values (column-name hint first) and resolves each value.
 *  `polygons`: only polygon layers (filled map). */
export async function geocode(values: string[], column: string, polygons: boolean): Promise<Geocoded> {
  const distinct = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
  const hint = hinted(column).filter((l) => !polygons || l !== 'cities');
  const order = [...hint, ...ORDER.filter((l) => !hint.includes(l) && (!polygons || l !== 'cities'))];
  let best: Geocoded | null = null;
  for (const layer of order) {
    const hits = new Map<string, { coord: [number, number]; feature?: string }>();
    let poly: LoadedLayer | undefined;
    if (layer === 'cities') {
      const idx = await loadCities();
      for (const v of distinct) { const c = idx.get(norm(v)); if (c) hits.set(v, { coord: [c[1], c[2]] }); }
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
