'use strict';
// Test hors-ligne : on remplace fetch() par de fausses réponses et on vérifie la normalisation + la fusion.
process.env.CACHE_DIR = require('os').tmpdir() + '/riamo-selftest-' + Date.now();
const assert = require('assert');

const calls = [];
global.fetch = async (url, opts = {}) => {
  url = String(url); calls.push(url);
  const json = d => ({ ok: true, status: 200, json: async () => d });
  if (url.includes('interpreter')) {
    const q = decodeURIComponent(opts.body);
    const m = q.match(/around:\d+,([-\d.]+),([-\d.]+)/); let dl = m ? parseFloat(m[1]) - 48.86 : 0, dn = m ? parseFloat(m[2]) - 2.35 : 0; if (Math.abs(dl) < 0.5) { dl = 0; dn = 0; }
    if (q.includes('"fuel"')) return json({ elements: [
      { type: 'node', id: 1, lat: 48.8570 + dl, lon: 2.3525 + dn, tags: { amenity: 'fuel', name: 'Total Test', brand: 'Total', 'fuel:diesel': 'yes' } },
      { type: 'way', id: 2, center: { lat: 48.8700, lon: 2.3700 }, tags: { amenity: 'fuel', name: 'Sans prix', 'fuel:octane_95': 'yes' } },
    ] });
    return json({ elements: [
      { type: 'node', id: 10, lat: 48.8580, lon: 2.3530, tags: { amenity: 'charging_station', name: 'Borne A', capacity: '4', 'socket:type2': '2', 'socket:type2:output': '22 kW', 'socket:type2_combo': '2', 'socket:type2_combo:output': '150 kW' } },
      { type: 'node', id: 11, lat: 48.8590, lon: 2.3540, tags: { amenity: 'charging_station', 'socket:type2': '1' } },
    ] });
  }
  if (url.includes('data.economie.gouv.fr')) return json({ results: [
    { id: 777, geom: { lat: 48.85705, lon: 2.35252 }, adresse: '1 rue Test', ville: 'Paris', cp: '75001', gazole_prix: 1.789, gazole_maj: '2026-11-22', e10_prix: 1.7 },
  ] });
  if (url.includes('open.er-api.com')) return json({ result: 'success', rates: { EUR: 1, USD: 1.08, CHF: 0.95 }, time_last_update_utc: 'test' });
  if (url.includes('photon.komoot.io/api')) return json({ features: [{ geometry: { coordinates: [2.35, 48.85] }, properties: { name: 'Paris', country: 'France', countrycode: 'FR', osm_value: 'city' } }] });
  throw new Error('URL inattendue ' + url);
};

const { handle } = require('./lib/router');
(async () => {
  let r = await handle('/api/fuel', { lat: '48.8566', lon: '2.3522', radius: '5', fuel: 'gazole' });
  assert.strictEqual(r.status, 200);
  const b = r.body;
  assert.strictEqual(b.count, 2, 'France + OSM fusionnés (la station 1 absorbée)');
  assert.strictEqual(b.stations[0].price, 1.789, 'prix officiel conservé');
  assert.strictEqual(b.stations[0].name, 'Total Test', 'nom repris d\'OSM');
  assert.strictEqual(b.stations[1].price, null, 'jamais de faux prix');
  assert.strictEqual(b.stations[1].hasPrice, false);

  r = await handle('/api/ev', { lat: '48.8566', lon: '2.3522', radius: '5', minKw: '50' });
  assert.strictEqual(r.body.count, 1);
  assert.strictEqual(r.body.chargers[0].maxPowerKw, 150);

  assert.strictEqual(b.stations[0].currency, 'EUR');
  assert.strictEqual(b.stations[1].currency, null);
  r = await handle('/api/rates', {});
  assert.strictEqual(r.body.rates.USD, 1.08);

  r = await handle('/api/geocode', { q: 'paris' });
  assert.strictEqual(r.body.results[0].label, 'Paris, France');

  r = await handle('/api/fuel', { lat: 'abc', lon: '2' });
  assert.strictEqual(r.status, 400);
  r = await handle('/api/nope', {});
  assert.strictEqual(r.status, 404);

  // Pays sans source officielle (Japon) : stations OSM seulement, avec note claire.
  r = await handle('/api/fuel', { lat: '35.68', lon: '139.69', radius: '5' });
  assert.strictEqual(r.body.pricedCount, 0);
  assert.ok(r.body.notes[0].includes('Prix indisponibles'));
  console.log('OK : tous les tests passent (' + calls.length + ' appels simulés)');
})().catch(e => { console.error('ÉCHEC :', e); process.exit(1); });
