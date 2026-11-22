'use strict';
// Cache à deux niveaux : mémoire + fichiers JSON. Avec "stale-if-error" :
// si la source en ligne tombe, on renvoie la dernière donnée connue (marquée stale).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const serverless = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DIR = process.env.CACHE_DIR || (serverless ? '/tmp/riamo-cache' : path.join(__dirname, '..', '..', '.cache'));
const MAX_MEM = 300;
const mem = new Map();
const inflight = new Map();

try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) {}

const fileOf = k => path.join(DIR, crypto.createHash('sha1').update(k).digest('hex') + '.json');

function readEntry(k) {
  let e = mem.get(k);
  if (e) return e;
  try { e = JSON.parse(fs.readFileSync(fileOf(k), 'utf8')); mem.set(k, e); return e; } catch (_) { return null; }
}
function writeEntry(k, data) {
  const e = { t: Date.now(), data };
  if (mem.size >= MAX_MEM) mem.delete(mem.keys().next().value);
  mem.set(k, e);
  fs.writeFile(fileOf(k), JSON.stringify(e), () => {});
}

// producer() doit renvoyer des données JSON-sérialisables.
async function cached(key, ttlMs, producer) {
  const e = readEntry(key);
  if (e && Date.now() - e.t < ttlMs) return { data: e.data, cache: 'hit', ageMs: Date.now() - e.t };
  if (inflight.has(key)) return inflight.get(key); // fusionne les requêtes identiques simultanées
  const p = (async () => {
    try {
      const data = await producer();
      writeEntry(key, data);
      return { data, cache: 'miss', ageMs: 0 };
    } catch (err) {
      if (e) return { data: e.data, cache: 'stale', ageMs: Date.now() - e.t, error: err.message };
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

function prune(maxAgeMs = 7 * 864e5) {
  fs.readdir(DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const p = path.join(DIR, f);
      fs.stat(p, (e, s) => { if (!e && Date.now() - s.mtimeMs > maxAgeMs) fs.unlink(p, () => {}); });
    }
  });
}

module.exports = { cached, prune, DIR };
