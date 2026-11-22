'use strict';
// Taux de change indicatifs, base EUR. Sans clé API. Open ER-API (≈160 devises), repli Frankfurter (BCE).
const { fetchJson } = require('./util');
const { cached } = require('./cache');

async function getRates() {
  const { data, cache } = await cached('rates:EUR', 6 * 3600 * 1000, async () => {
    try {
      const j = await fetchJson('https://open.er-api.com/v6/latest/EUR', { timeout: 12000 });
      if (j && j.result === 'success' && j.rates && j.rates.EUR)
        return { base: 'EUR', rates: j.rates, updated: j.time_last_update_utc || null, source: 'open.er-api.com' };
    } catch (_) { /* repli */ }
    const j = await fetchJson('https://api.frankfurter.dev/v1/latest?base=EUR', { timeout: 12000 });
    if (!j || !j.rates) throw new Error('Taux de change invalides');
    return { base: 'EUR', rates: { EUR: 1, ...j.rates }, updated: j.date || null, source: 'frankfurter.dev (BCE)' };
  });
  return { ...data, stale: cache === 'stale' };
}
module.exports = { getRates };
