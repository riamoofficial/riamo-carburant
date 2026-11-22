'use strict';
// Routeur indépendant du serveur : utilisé par server.js (Termux/VPS) et par la fonction Netlify.
const { HttpError, num, clamp, parseCoords } = require('./util');
const { searchFuel, FUEL_KEYS } = require('./fuel');
const { searchEv } = require('./ev');
const { geocode, reverse } = require('./geocode');
const { getRates } = require('./rates');
const cache = require('./cache');

const startedAt = Date.now();

// Limiteur simple : 90 requêtes / minute / IP.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), w = hits.get(ip) || [];
  const recent = w.filter(t => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 90;
}

async function handle(pathname, q, ip = 'local') {
  try {
    if (rateLimited(ip)) throw new HttpError(429, 'Trop de requêtes. Réessayez dans une minute.', 'rate_limited');

    switch (pathname) {
      case '/api/health':
        return ok({ status: 'ok', node: process.version, uptimeS: Math.round((Date.now() - startedAt) / 1000), ocm: !!process.env.OCM_API_KEY, cacheDir: cache.DIR });

      case '/api/config':
        return ok({ ocm: !!process.env.OCM_API_KEY, fuels: FUEL_KEYS });

      case '/api/fuel': {
        const { lat, lon } = parseCoords(q);
        const fuel = FUEL_KEYS.includes(q.fuel) ? q.fuel : 'gazole';
        const r = await searchFuel({
          lat, lon, fuel,
          radiusKm: clamp(num(q.radius, 8), 1, 25),
          sort: q.sort === 'dist' ? 'dist' : 'price',
          limit: num(q.limit, 150),
        });
        if (r.error) throw new HttpError(502, 'Aucune source disponible pour le moment. ' + r.warnings.join(' | '), 'upstream');
        return ok(r);
      }

      case '/api/ev': {
        const { lat, lon } = parseCoords(q);
        const r = await searchEv({
          lat, lon,
          radiusKm: clamp(num(q.radius, 8), 1, 30),
          minKw: clamp(num(q.minKw, 0), 0, 400),
          limit: num(q.limit, 200),
        });
        if (r.error) throw new HttpError(502, 'Aucune source disponible pour le moment. ' + r.warnings.join(' | '), 'upstream');
        return ok(r);
      }

      case '/api/rates':
        return ok(await getRates(), 3600);

      case '/api/geocode':
        return ok(await geocode({ q: q.q, lang: q.lang, lat: num(q.lat), lon: num(q.lon) }), 3600);

      case '/api/reverse': {
        const { lat, lon } = parseCoords(q);
        return ok(await reverse({ lat, lon, lang: q.lang }), 3600);
      }

      default:
        throw new HttpError(404, 'Route inconnue.', 'not_found');
    }
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 && e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('[api]', pathname, e && e.stack || e);
    return { status, headers: {}, body: { error: { code: e.code || 'internal', message: status === 500 ? 'Erreur interne du serveur.' : e.message } } };
  }
}

const ok = (body, maxAge = 60) => ({ status: 200, headers: { 'Cache-Control': `public, max-age=${maxAge}` }, body });

module.exports = { handle };
