'use strict';
// Bornes de recharge : OpenStreetMap (sans clé) + Open Charge Map (optionnel, OCM_API_KEY).
const { fetchJson, haversineKm, num, clamp, round } = require('./util');
const { cached } = require('./cache');
const { overpass, aroundQuery, toPoint, osmAddress } = require('./overpass');

const HOUR = 3600 * 1000;
const SOCKETS = {
  type2: 'Type 2', type2_combo: 'CCS', type2_cable: 'Type 2 (câble)', chademo: 'CHAdeMO',
  type1: 'Type 1', type1_combo: 'CCS (T1)', tesla_supercharger: 'Tesla', tesla_destination: 'Tesla (dest.)',
  nacs: 'NACS', schuko: 'Schuko', typee: 'Prise E', cee_blue: 'CEE bleue', cee_red_16a: 'CEE 16A',
};

function normOsm(p) {
  const t = p.tags;
  const connectors = [];
  for (const [k, label] of Object.entries(SOCKETS)) {
    const raw = t['socket:' + k];
    if (!raw) continue;
    const count = parseInt(raw, 10) || 1;
    const kw = num((t[`socket:${k}:output`] || '').replace(/kw/i, ''));
    connectors.push({ type: label, count, powerKw: kw });
  }
  const maxKw = Math.max(0, ...connectors.map(c => c.powerKw || 0)) || num((t.charging_station_output || t.output || '').replace(/kw/i, ''));
  return {
    id: p.id, source: 'osm',
    name: t.name || t.operator || t.brand || 'Borne de recharge',
    operator: t.operator || t.network || t.brand || '',
    lat: p.lat, lon: p.lon, ...osmAddress(t),
    connectors, maxPowerKw: maxKw || null,
    points: parseInt(t.capacity, 10) || null,
    fee: t.fee || '', openingHours: t.opening_hours || '', access: t.access || '',
  };
}

function normOcm(r) {
  const a = r.AddressInfo || {};
  if (typeof a.Latitude !== 'number' || typeof a.Longitude !== 'number') return null;
  const connectors = (r.Connections || []).map(c => ({
    type: (c.ConnectionType && (c.ConnectionType.FormalName || c.ConnectionType.Title)) || 'Connecteur',
    count: c.Quantity || 1, powerKw: num(c.PowerKW),
  }));
  return {
    id: 'ocm-' + r.ID, source: 'ocm',
    name: a.Title || 'Borne de recharge',
    operator: (r.OperatorInfo && r.OperatorInfo.Title) || '',
    lat: a.Latitude, lon: a.Longitude,
    address: a.AddressLine1 || '', city: a.Town || '', postcode: a.Postcode || '',
    connectors, maxPowerKw: Math.max(0, ...connectors.map(c => c.powerKw || 0)) || null,
    points: r.NumberOfPoints || null,
    fee: r.UsageCost || '', openingHours: '', access: (r.UsageType && r.UsageType.Title) || '',
  };
}

async function osmChargers(cLat, cLon, rKm) {
  return cached(`osmev:${cLat.toFixed(2)}:${cLon.toFixed(2)}:${rKm}`, 3 * HOUR, async () => {
    const els = await overpass(aroundQuery('["amenity"="charging_station"]', cLat, cLon, Math.round(rKm * 1000), 1200));
    return els.map(toPoint).filter(Boolean).map(normOsm);
  });
}

async function ocmChargers(cLat, cLon, rKm, key) {
  return cached(`ocm:${cLat.toFixed(2)}:${cLon.toFixed(2)}:${rKm}`, 3 * HOUR, async () => {
    const u = `https://api.openchargemap.io/v3/poi/?output=json&compact=true&verbose=false&maxresults=500` +
      `&latitude=${cLat}&longitude=${cLon}&distance=${rKm}&distanceunit=KM`;
    const j = await fetchJson(u, { headers: { 'X-API-Key': key }, timeout: 25000 });
    return (Array.isArray(j) ? j : []).map(normOcm).filter(Boolean);
  });
}

async function searchEv({ lat, lon, radiusKm, minKw, limit }) {
  radiusKm = clamp(radiusKm, 1, 30);
  const fetchR = radiusKm + 3;
  const cLat = round(lat, 0.02), cLon = round(lon, 0.02);
  const key = process.env.OCM_API_KEY || '';
  const warnings = [], sources = [];

  const jobs = [osmChargers(cLat, cLon, fetchR)];
  if (key) jobs.push(ocmChargers(cLat, cLon, fetchR, key));
  const res = await Promise.allSettled(jobs);

  let osm = [], ocm = [];
  if (res[0].status === 'fulfilled') { osm = res[0].value.data; sources.push('OpenStreetMap'); }
  else warnings.push('OpenStreetMap : ' + res[0].reason.message);
  if (key) {
    if (res[1].status === 'fulfilled') { ocm = res[1].value.data; sources.push('Open Charge Map'); }
    else warnings.push('Open Charge Map : ' + res[1].reason.message);
  }
  if (!osm.length && !ocm.length && warnings.length) return { error: true, warnings };

  // Open Charge Map prioritaire ; on ajoute les bornes OSM situées à plus de 40 m d'une borne OCM.
  const extra = osm.filter(o => !ocm.some(c => haversineKm(o.lat, o.lon, c.lat, c.lon) < 0.04));
  let all = ocm.concat(extra).map(s => ({ ...s, distanceKm: +haversineKm(lat, lon, s.lat, s.lon).toFixed(2) }))
    .filter(s => s.distanceKm <= radiusKm);
  if (minKw > 0) all = all.filter(s => (s.maxPowerKw || 0) >= minKw);
  all.sort((a, b) => a.distanceKm - b.distanceKm);

  const notes = [];
  if (!key) notes.push("Source : OpenStreetMap. Ajoutez OCM_API_KEY pour compléter avec Open Charge Map.");
  return { count: all.length, radiusKm, sources, warnings, notes, chargers: all.slice(0, clamp(limit, 1, 300)) };
}

module.exports = { searchEv };
