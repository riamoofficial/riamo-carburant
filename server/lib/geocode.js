'use strict';
// Recherche d'adresses / villes dans le monde : Photon (principal), Nominatim (repli).
const { fetchJson, num, makeThrottle, HttpError } = require('./util');
const { cached } = require('./cache');

const DAY = 24 * 3600 * 1000;
const nominatimGate = makeThrottle(1100); // règle d'usage : 1 requête/seconde
const LANGS = new Set(['fr', 'en', 'de', 'it']);

function photonLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street && street !== p.name ? street : '', p.postcode, p.city !== p.name ? p.city : '', p.state, p.country];
  return parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

async function photonSearch(q, lang, lat, lon) {
  let u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=${lang}`;
  if (lat !== null && lon !== null) u += `&lat=${lat}&lon=${lon}`;
  const j = await fetchJson(u, { timeout: 12000 });
  return (j.features || []).map(f => {
    const [lo, la] = f.geometry.coordinates, p = f.properties || {};
    return { label: photonLabel(p), lat: la, lon: lo, country: p.countrycode || '', type: p.osm_value || '', extent: p.extent || null };
  }).filter(r => r.label);
}

async function nominatimSearch(q, lang) {
  await nominatimGate();
  const j = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&accept-language=${lang}&q=${encodeURIComponent(q)}`, { timeout: 15000 });
  return j.map(r => ({
    label: r.display_name, lat: num(r.lat), lon: num(r.lon),
    country: ((r.address && r.address.country_code) || '').toUpperCase(), type: r.type || '',
    extent: r.boundingbox ? [num(r.boundingbox[2]), num(r.boundingbox[1]), num(r.boundingbox[3]), num(r.boundingbox[0])] : null,
  })).filter(r => r.lat !== null && r.lon !== null);
}

async function geocode({ q, lang, lat, lon }) {
  q = String(q || '').trim().slice(0, 200);
  if (q.length < 2) throw new HttpError(400, 'Saisissez au moins 2 caractères.', 'short_query');
  lang = LANGS.has(lang) ? lang : 'fr';
  // Biais de proximité arrondi (~11 km) pour que le cache serve plusieurs personnes.
  const bl = lat !== null && lon !== null ? Math.round(lat * 10) / 10 : null;
  const bo = lat !== null && lon !== null ? Math.round(lon * 10) / 10 : null;
  const { data } = await cached(`geo:${lang}:${bl}:${bo}:${q.toLowerCase()}`, DAY, async () => {
    try {
      const r = await photonSearch(q, lang, bl, bo);
      if (r.length) return r;
    } catch (_) { /* repli ci-dessous */ }
    return nominatimSearch(q, lang);
  });
  return { results: data };
}

async function reverse({ lat, lon, lang }) {
  lang = LANGS.has(lang) ? lang : 'fr';
  const rl = lat.toFixed(3), ro = lon.toFixed(3);
  const { data } = await cached(`rev:${lang}:${rl}:${ro}`, 7 * DAY, async () => {
    try {
      await nominatimGate();
      const j = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=${lang}&lat=${rl}&lon=${ro}`, { timeout: 12000 });
      if (j && j.display_name) return { label: j.display_name, country: ((j.address && j.address.country_code) || '').toUpperCase() };
    } catch (_) {}
    const j = await fetchJson(`https://photon.komoot.io/reverse?lat=${rl}&lon=${ro}&lang=${lang}`, { timeout: 12000 });
    const p = j.features && j.features[0] && j.features[0].properties;
    return { label: p ? photonLabel(p) : 'Position inconnue', country: (p && p.countrycode) || '' };
  });
  return data;
}

module.exports = { geocode, reverse };
