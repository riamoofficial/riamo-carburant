'use strict';
const UA = process.env.USER_AGENT || 'RiamoCarburant/2.0 (+https://github.com/riamoofficial/riamo-carburant)';

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}

const toRad = d => (d * Math.PI) / 180;
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
// Accepte "1,799" ou "1.799" ; renvoie null si invalide.
function num(v, def = null) {
  if (v === null || v === undefined || v === '') return def;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round = (n, step) => Math.round(n / step) * step;

async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  const res = await fetch(url, {
    method, body,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status} (${new URL(url).host})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

function parseCoords(q) {
  const lat = num(q.lat), lon = num(q.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    throw new HttpError(400, 'Paramètres lat/lon invalides.', 'bad_coords');
  return { lat, lon };
}

// Limiteur d'appels sortants (Nominatim : 1 requête/seconde maximum).
function makeThrottle(gapMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gapMs;
    if (wait) await new Promise(r => setTimeout(r, wait));
  };
}

module.exports = { UA, HttpError, haversineKm, num, clamp, round, fetchJson, parseCoords, makeThrottle };
