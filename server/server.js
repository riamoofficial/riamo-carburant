'use strict';
require('./lib/env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/router');
const { prune } = require('./lib/cache');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const BLOCKED = new Set(['server', 'node_modules', 'netlify', 'package.json', 'package-lock.json']);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send(res, 400, {}, 'Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p.startsWith('.') || BLOCKED.has(p))) return send(res, 404, {}, 'Not found');
  const file = path.join(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, {}, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Introuvable');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const cors = ALLOW_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') return send(res, 204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' }, '');
    if (req.method !== 'GET') return send(res, 405, cors, '');
    const q = Object.fromEntries(url.searchParams);
    const ip = req.socket.remoteAddress || 'local';
    const r = await handle(url.pathname, q, ip);
    return send(res, r.status, { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...r.headers }, JSON.stringify(r.body));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {}, '');
  serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Riamo Carburant : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/world.html`);
  console.log(`Open Charge Map : ${process.env.OCM_API_KEY ? 'clé détectée' : 'pas de clé (OpenStreetMap seul)'}`);
  prune();
});
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
process.on('SIGINT', () => process.exit(0));
