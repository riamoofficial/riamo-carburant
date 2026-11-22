'use strict';
// Mini lecteur de .env (aucune dépendance). Les variables déjà définies gagnent.
const fs = require('fs');
const path = require('path');
(function load() {
  try {
    const f = path.join(__dirname, '..', '..', '.env');
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch (_) { /* pas de .env : normal */ }
})();
