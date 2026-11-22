'use strict';
// Stations-service : sources de prix officielles (quand elles existent) + repli OpenStreetMap.
// Règle d'or : on n'invente JAMAIS de prix. Pas de source officielle => prices = {} et hasPrice = false.
const { fetchJson, haversineKm, num, clamp, round } = require('./util');
const { cached } = require('./cache');
const { overpass, aroundQuery, toPoint, osmAddress } = require('./overpass');

const FUEL_KEYS = ['gazole', 'e10', 'sp95', 'sp98', 'e85', 'gplc'];
const MIN = 60 * 1000, HOUR = 60 * MIN;

/* ------------------------------ OpenStreetMap ------------------------------ */
const OSM_FUEL_TAGS = {
  gazole: 'fuel:diesel', sp95: 'fuel:octane_95', sp98: 'fuel:octane_98',
  e10: 'fuel:e10', e85: 'fuel:e85', gplc: 'fuel:lpg',
};

function normOsm(p) {
  const t = p.tags;
  const fuels = FUEL_KEYS.filter(k => t[OSM_FUEL_TAGS[k]] === 'yes');
  return {
    id: p.id, source: 'osm',
    name: t.name || t.brand || t.operator || 'Station-service',
    brand: t.brand || t.operator || '',
    lat: p.lat, lon: p.lon,
    ...osmAddress(t),
    openingHours: t.opening_hours || '',
    fuels, prices: {}, updated: null, currency: null,
  };
}

async function osmStations(cLat, cLon, rKm) {
  const { data, cache } = await cached(`osmfuel:${cLat.toFixed(2)}:${cLon.toFixed(2)}:${rKm}`, 6 * HOUR, async () => {
    const els = await overpass(aroundQuery('["amenity"="fuel"]', cLat, cLon, Math.round(rKm * 1000)));
    return els.map(toPoint).filter(Boolean).map(normOsm);
  });
  return { stations: data, cache };
}

/* ------------------------------ France (officiel) ------------------------------ */
const FR_API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
const FR_BBOX = { s: 41.2, n: 51.3, w: -5.5, e: 9.8 };

function normFr(r) {
  let lat = r.geom && num(r.geom.lat), lon = r.geom && num(r.geom.lon);
  if (lat === null || lon === null) { lat = num(r.latitude); lon = num(r.longitude); if (Math.abs(lat) > 90) { lat /= 1e5; lon /= 1e5; } }
  if (lat === null || lon === null) return null;
  const prices = {}, updated = {};
  for (const k of FUEL_KEYS) {
    const p = num(r[k + '_prix']);
    if (p !== null && p > 0 && p < 10) { prices[k] = p; updated[k] = r[k + '_maj'] || null; }
  }
  return {
    id: 'fr-' + r.id, source: 'fr',
    name: 'Station-service', brand: '',
    lat, lon, address: r.adresse || '', city: r.ville || '', postcode: r.cp || '',
    openingHours: r.horaires_automate_24_24 === 'Oui' ? '24/7 (automate)' : '',
    fuels: Object.keys(prices), prices, updated, currency: 'EUR',
  };
}

async function franceStations(cLat, cLon, rKm) {
  const { data, cache } = await cached(`fr:${cLat.toFixed(2)}:${cLon.toFixed(2)}:${rKm}`, 10 * MIN, async () => {
    const where = `within_distance(geom, geom'POINT(${cLon} ${cLat})', ${Math.round(rKm * 1000)}m)`;
    const out = [], LIMIT = 100;
    for (let off = 0; off < 1000; off += LIMIT) {
      const j = await fetchJson(`${FR_API}?where=${encodeURIComponent(where)}&limit=${LIMIT}&offset=${off}`);
      const rs = j.results || [];
      out.push(...rs);
      if (rs.length < LIMIT) break;
    }
    return out.map(normFr).filter(Boolean);
  });
  return { stations: data, cache };
}

/* ------------------------------ Espagne (officiel, MINETUR) ------------------------------ */
const ES_URL = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const ES_BBOX = { s: 27.4, n: 43.9, w: -18.3, e: 4.5 };
const ES_MAP = {
  gazole: 'Precio Gasoleo A', sp95: 'Precio Gasolina 95 E5', e10: 'Precio Gasolina 95 E10',
  sp98: 'Precio Gasolina 98 E5', gplc: 'Precio Gases licuados del petróleo',
};

async function spainAll() {
  return cached('es:all', 1 * HOUR, async () => {
    const j = await fetchJson(ES_URL, { timeout: 45000 });
    const date = j.Fecha || null;
    return (j.ListaEESSPrecio || []).map(r => {
      const lat = num(r['Latitud']), lon = num(r['Longitud (WGS84)']);
      if (lat === null || lon === null) return null;
      const prices = {};
      for (const [k, f] of Object.entries(ES_MAP)) { const p = num(r[f]); if (p !== null && p > 0 && p < 10) prices[k] = p; }
      return {
        id: 'es-' + r['IDEESS'], source: 'es',
        name: r['Rótulo'] || 'Estación de servicio', brand: r['Rótulo'] || '',
        lat, lon, address: r['Dirección'] || '', city: r['Localidad'] || r['Municipio'] || '', postcode: r['C.P.'] || '',
        openingHours: r['Horario'] || '', fuels: Object.keys(prices), prices, updated: date, currency: 'EUR',
      };
    }).filter(Boolean);
  });
}
async function spainStations(cLat, cLon, rKm) {
  const { data, cache } = await spainAll();
  return { stations: data.filter(s => haversineKm(cLat, cLon, s.lat, s.lon) <= rKm), cache };
}

/* ------------------------------ Autriche (officiel, E-Control) ------------------------------ */
const AT_BBOX = { s: 46.3, n: 49.1, w: 9.5, e: 17.2 };
const AT_FUELS = { DIE: 'gazole', SUP: 'sp95' };

async function austriaStations(cLat, cLon) {
  const { data, cache } = await cached(`at:${cLat.toFixed(2)}:${cLon.toFixed(2)}`, 15 * MIN, async () => {
    const byId = new Map();
    for (const [code, key] of Object.entries(AT_FUELS)) {
      const j = await fetchJson(`https://api.e-control.at/sprit/1.0/search/gas-stations/by-address?latitude=${cLat}&longitude=${cLon}&fuelType=${code}&includeClosed=false`);
      for (const s of Array.isArray(j) ? j : []) {
        const loc = s.location || {};
        const lat = num(loc.latitude), lon = num(loc.longitude);
        if (lat === null || lon === null) continue;
        const id = 'at-' + s.id;
        const st = byId.get(id) || {
          id, source: 'at', name: s.name || 'Tankstelle', brand: s.name || '', lat, lon,
          address: loc.address || '', city: loc.city || '', postcode: loc.postalCode || '',
          openingHours: '', fuels: [], prices: {}, updated: null, currency: 'EUR',
        };
        const pr = (s.prices || []).find(x => x.fuelType === code && num(x.amount) > 0);
        if (pr) { st.prices[key] = num(pr.amount); st.fuels = Object.keys(st.prices); }
        byId.set(id, st);
      }
    }
    return [...byId.values()];
  });
  return { stations: data, cache };
}

/* ------------------------------ Registre des sources de prix ------------------------------ */
// Pour ajouter un pays : un objet { id, label, bbox, fetch(cLat,cLon,rKm) } renvoyant { stations, cache }.
const PROVIDERS = [
  { id: 'fr', label: 'data.economie.gouv.fr (France)', bbox: FR_BBOX, fetch: franceStations },
  { id: 'es', label: 'MINETUR (Espagne)', bbox: ES_BBOX, fetch: spainStations },
  { id: 'at', label: 'E-Control (Autriche)', bbox: AT_BBOX, fetch: austriaStations },
];
const inBox = (b, lat, lon, m = 0.25) => lat >= b.s - m && lat <= b.n + m && lon >= b.w - m && lon <= b.e + m;

/* ------------------------------ Recherche principale ------------------------------ */
async function searchFuel({ lat, lon, radiusKm, fuel, sort, limit }) {
  radiusKm = clamp(radiusKm, 1, 25);
  const fetchR = radiusKm + 3;                       // marge : le centre est arrondi pour le cache
  const cLat = round(lat, 0.02), cLon = round(lon, 0.02);
  const warnings = [], sources = [];

  const active = PROVIDERS.filter(p => inBox(p.bbox, lat, lon));
  const jobs = [osmStations(cLat, cLon, fetchR), ...active.map(p => p.fetch(cLat, cLon, fetchR))];
  const res = await Promise.allSettled(jobs);

  let osm = [];
  if (res[0].status === 'fulfilled') { osm = res[0].value.stations; sources.push('OpenStreetMap'); }
  else warnings.push('OpenStreetMap : ' + res[0].reason.message);

  let priced = [];
  active.forEach((p, i) => {
    const r = res[i + 1];
    if (r.status === 'fulfilled') { priced.push(...r.value.stations); sources.push(p.label); }
    else warnings.push(`${p.label} : ${r.reason.message}`);
  });

  if (!osm.length && !priced.length && warnings.length)
    return { error: true, warnings };

  // Fusion : une station "avec prix" absorbe l'entrée OSM située à moins de 120 m (nom, enseigne, horaires).
  const used = new Set();
  for (const s of priced) {
    let best = null, bd = 0.12;
    for (const o of osm) {
      if (used.has(o.id)) continue;
      const d = haversineKm(s.lat, s.lon, o.lat, o.lon);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      used.add(best.id);
      if (s.name === 'Station-service' || !s.name) s.name = best.name;
      s.brand = s.brand || best.brand;
      s.openingHours = s.openingHours || best.openingHours;
    }
  }
  let all = priced.concat(osm.filter(o => !used.has(o.id)));

  all = all.map(s => {
    const price = s.prices[fuel] ?? null;
    return { ...s, price, hasPrice: Object.keys(s.prices).length > 0, distanceKm: +haversineKm(lat, lon, s.lat, s.lon).toFixed(2) };
  }).filter(s => s.distanceKm <= radiusKm);

  all.sort((a, b) => {
    if (sort === 'price') {
      if ((a.price === null) !== (b.price === null)) return a.price === null ? 1 : -1;
      if (a.price !== null && a.price !== b.price) return a.price - b.price;
    }
    return a.distanceKm - b.distanceKm;
  });

  const pricedCount = all.filter(s => s.hasPrice).length;
  const notes = [];
  if (all.length && pricedCount === 0)
    notes.push("Prix indisponibles dans cette zone : source ouverte officielle non disponible. Les stations viennent d'OpenStreetMap.");
  else if (pricedCount && pricedCount < all.length)
    notes.push('Certaines stations (OpenStreetMap) sont affichées sans prix.');

  return {
    count: all.length, pricedCount, fuel, radiusKm, sources, warnings, notes,
    stations: all.slice(0, clamp(limit, 1, 300)),
  };
}

module.exports = { searchFuel, FUEL_KEYS, PROVIDERS };
