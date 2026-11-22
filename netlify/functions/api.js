'use strict';
// Fonction Netlify (optionnelle) : mêmes routes /api/* que server.js.
const { handle } = require('../../server/lib/router');

exports.handler = async (event) => {
  let p = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : '/' + p);
  const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'])) || 'netlify';
  const r = await handle(p, event.queryStringParameters || {}, ip);
  return {
    statusCode: r.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...r.headers },
    body: JSON.stringify(r.body),
  };
};
