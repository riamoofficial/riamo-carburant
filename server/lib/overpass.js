'use strict';
// OpenStreetMap via Overpass, avec bascule automatique entre plusieurs miroirs publics.
const { fetchJson } = require('./util');

const MIRRORS = (process.env.OVERPASS_URLS ||
  'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter')
  .split(',').map(s => s.trim()).filter(Boolean);

async function overpass(query) {
  let last;
  for (const url of MIRRORS) {
    try {
      const j = await fetchJson(url, {
        method: 'POST', timeout: 28000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!j || !Array.isArray(j.elements)) throw new Error('Réponse Overpass invalide');
      return j.elements;
    } catch (e) { last = e; }
  }
  throw new Error('OpenStreetMap (Overpass) indisponible : ' + (last ? last.message : 'inconnu'));
}

// filter ex. '["amenity"="fuel"]' ; points + surfaces (centre) autour d'un point.
function aroundQuery(filter, lat, lon, radiusM, limit = 900) {
  return `[out:json][timeout:25];(node${filter}(around:${radiusM},${lat},${lon});way${filter}(around:${radiusM},${lat},${lon}););out tags center ${limit};`;
}

function toPoint(el) {
  const lat = el.lat ?? (el.center && el.center.lat);
  const lon = el.lon ?? (el.center && el.center.lon);
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { id: 'osm-' + el.type[0] + el.id, lat, lon, tags: el.tags || {} };
}

function osmAddress(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return { address: street, city: t['addr:city'] || '', postcode: t['addr:postcode'] || '' };
}

module.exports = { overpass, aroundQuery, toPoint, osmAddress };
