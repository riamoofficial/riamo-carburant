(() => {
'use strict';

const API = (window.RIAMO_API_BASE || '') + '/api';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const FUELS = { gazole: 'Gazole', e10: 'SP95-E10', sp95: 'SP95', sp98: 'SP98', e85: 'E85', gplc: 'GPLc' };
const KW = [[0, 'Toutes puissances'], [22, '22 kW et +'], [50, '50 kW et +'], [150, '150 kW et +']];
const FIRST_CUR = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'MAD', 'TND', 'DZD', 'XOF', 'XAF', 'TRY', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'RON', 'BRL', 'MXN', 'INR', 'CNY', 'AED'];
const MAX_PINS = 150, MAX_ALERTS = 10, CHECK_EVERY = 15 * 60 * 1000, RENOTIFY = 6 * 3600 * 1000;

const S = {
  mode: store.get('w_mode', 'fuel'),
  fuel: store.get('w_fuel', 'gazole'),
  radius: store.get('w_radius', 8),
  minKw: store.get('w_minkw', 0),
  cur: store.get('w_cur', 'EUR'),
  sort: 'price',
  items: [], pins: [], lastJ: null, selected: -1,
  lastCenter: null, centerLabel: '', ctrl: null, me: null, popup: null,
  rates: null, ratesInfo: null,
  alerts: store.get('w_alerts', []),
};
if (!FUELS[S.fuel]) S.fuel = 'gazole';

/* ---------- utilitaires ---------- */
function distKm(a, b, c, d) {
  const r = Math.PI / 180, dLa = (c - a) * r, dLo = (d - b) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
const fmtDist = k => k < 1 ? Math.round(k * 1000) + ' m' : k.toFixed(1) + ' km';
function setStatus(msg, kind) { const el = $('#status'); el.textContent = msg; el.className = kind || ''; }
function setNotes(notes = [], warnings = []) {
  $('#notes').innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('') + warnings.map(w => `<p class="warn">${esc(w)}</p>`).join('');
}
function netMessage(e) {
  if (e instanceof TypeError) return 'Serveur injoignable. Vérifiez votre connexion et que le serveur est lancé.';
  return e.message || 'Erreur inconnue.';
}
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 9000);
  t.onclick = () => { t.hidden = true; };
}
const parseNum = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/* ---------- devises ---------- */
const digitsCache = {};
function digits(cur) {
  if (digitsCache[cur] !== undefined) return digitsCache[cur];
  let d = 3;
  try { if (new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits === 0) d = 1; } catch (_) {}
  return (digitsCache[cur] = d);
}
// symbol=false : nombre seul (repères de la carte)
function money(v, cur, symbol = true) {
  const d = digits(cur);
  try {
    return new Intl.NumberFormat('fr-FR', symbol ? { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }
      : { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  } catch (_) { return v.toFixed(d) + (symbol ? ' ' + cur : ''); }
}
// Conversion via l'euro. Renvoie null si le taux est inconnu (on n'invente rien).
function conv(v, from, to) {
  from = from || 'EUR';
  if (from === to) return v;
  const r = S.rates;
  if (!r || !r[from] || !r[to]) return null;
  return v / r[from] * r[to];
}
// Prix d'une station dans la devise affichée (ou, à défaut, dans sa devise d'origine).
function view(it, key) {
  const p = key ? (it.prices || {})[key] : it.price;
  if (typeof p !== 'number') return null;
  const from = it.currency || 'EUR';
  const c = conv(p, from, S.cur);
  return c === null ? { v: p, cur: from, converted: false } : { v: c, cur: S.cur, converted: from !== S.cur };
}
async function loadRates() {
  try {
    const r = await fetch(API + '/rates');
    const j = await r.json();
    if (!r.ok || !j.rates) throw new Error('taux');
    S.rates = j.rates; S.ratesInfo = j; store.set('w_rates', { t: Date.now(), j });
  } catch (_) {
    const c = store.get('w_rates', null);   // dernier jeu de taux connu
    if (c && c.j && c.j.rates) { S.rates = c.j.rates; S.ratesInfo = { ...c.j, stale: true }; }
  }
  fillCurrencies();
}
function fillCurrencies() {
  const codes = S.rates ? Object.keys(S.rates) : ['EUR'];
  let names = null; try { names = new Intl.DisplayNames(['fr'], { type: 'currency' }); } catch (_) {}
  const first = FIRST_CUR.filter(c => codes.includes(c));
  const rest = codes.filter(c => !first.includes(c)).sort();
  const opt = c => { let n = ''; try { n = names ? names.of(c) : ''; } catch (_) {} return `<option value="${esc(c)}">${esc(c)}${n && n !== c ? ' · ' + esc(n) : ''}</option>`; };
  $('#fCur').innerHTML = first.concat(rest).map(opt).join('');
  if (!codes.includes(S.cur)) S.cur = 'EUR';
  $('#fCur').value = S.cur; $('#aCur').textContent = '(' + S.cur + ')';
  redrawPrices();
  if (S.mode === 'alert') renderAlerts();
}
$('#fCur').onchange = e => {
  S.cur = e.target.value; store.set('w_cur', S.cur); $('#aCur').textContent = '(' + S.cur + ')';
  redrawPrices();
};
function redrawPrices() {
  if (S.items.length && S.lastJ && S.mode === 'fuel') { render.noFit = true; render(S.lastJ); render.noFit = false; }
}
function rateNote() {
  const i = S.ratesInfo;
  if (!i || S.cur === 'EUR') return [];
  return [`Conversion indicative depuis l'euro (${i.source}${i.updated ? ', ' + String(i.updated).slice(0, 16) : ''}${i.stale ? ', taux enregistrés' : ''}). Les prix officiels sont publiés en euros.`];
}

/* ---------- carte ---------- */
if (typeof maplibregl === 'undefined') {
  setStatus('Carte indisponible : la bibliothèque MapLibre n\'a pas pu être chargée (réseau ?).', 'error');
  return;
}
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: store.get('w_center', [8, 47]),
  zoom: store.get('w_zoom', 3.8),
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.on('error', e => {
  if (e && e.error && /style|tiles?|Failed to fetch/i.test(String(e.error.message))) setStatus('Fond de carte momentanément indisponible. La liste reste utilisable.', 'error');
});
map.on('moveend', e => {
  const c = map.getCenter();
  store.set('w_center', [c.lng, c.lat]); store.set('w_zoom', map.getZoom());
  if (e.originalEvent && S.mode !== 'alert' && S.lastCenter && distKm(c.lat, c.lng, S.lastCenter.lat, S.lastCenter.lon) > Math.max(1.5, S.radius * 0.5)) $('#here').hidden = false;
});

/* ---------- commandes ---------- */
function fillControls() {
  const sel = $('#fSel'), fuel = S.mode !== 'ev';
  sel.previousSibling.textContent = fuel ? 'Carburant' : 'Puissance';
  sel.innerHTML = fuel
    ? Object.entries(FUELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
    : KW.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  sel.value = fuel ? S.fuel : S.minKw;
  const radii = fuel ? [3, 5, 8, 12, 18, 25] : [3, 5, 8, 12, 20, 30];
  if (!radii.includes(+S.radius)) S.radius = 8;
  $('#fRad').innerHTML = radii.map(r => `<option value="${r}">${r} km</option>`).join('');
  $('#fRad').value = S.radius;
  $('#fSort').hidden = !fuel;
  document.body.classList.toggle('mode-ev', S.mode === 'ev');
  document.body.classList.toggle('mode-alert', S.mode === 'alert');
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === S.mode));
}
$('#fSel').onchange = e => {
  if (S.mode === 'fuel') { S.fuel = e.target.value; store.set('w_fuel', S.fuel); } else { S.minKw = +e.target.value; store.set('w_minkw', S.minKw); }
  rerun();
};
$('#fRad').onchange = e => { S.radius = +e.target.value; store.set('w_radius', S.radius); rerun(); };
$('#fSort').onclick = () => {
  S.sort = S.sort === 'price' ? 'dist' : 'price';
  $('#fSort').textContent = S.sort === 'price' ? 'Prix ↑' : 'Distance ↑';
  rerun();
};
document.querySelectorAll('.modes button').forEach(b => b.onclick = () => {
  if (S.mode === b.dataset.mode) return;
  S.mode = b.dataset.mode; store.set('w_mode', S.mode);
  fillControls(); clearResults(); setNotes(); $('#here').hidden = true;
  if (S.mode === 'alert') { document.body.classList.remove('min'); setStatus(''); renderAlerts(); return; }
  if (S.lastCenter) rerun(); else setStatus('Saisissez une ville ou touchez le viseur pour vous localiser.');
});
function rerun() { if (S.lastCenter && S.mode !== 'alert') search(S.lastCenter.lat, S.lastCenter.lon); }
$('#grip').onclick = () => {
  document.body.classList.toggle('min');
  if (document.body.classList.contains('min')) document.documentElement.style.setProperty('--sheet-min', $('#sheet').offsetHeight + 'px');
};
$('#here').onclick = () => { const c = map.getCenter(); S.centerLabel = ''; search(c.lat, c.lng); };

/* ---------- recherche de stations / bornes ---------- */
async function search(lat, lon) {
  if (S.ctrl) S.ctrl.abort();
  S.ctrl = new AbortController();
  S.lastCenter = { lat, lon };
  $('#here').hidden = true;
  clearResults(); setNotes();
  setStatus('Recherche en cours…', 'busy');
  const p = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: S.radius });
  let path;
  if (S.mode === 'fuel') { p.set('fuel', S.fuel); p.set('sort', S.sort); path = '/fuel'; }
  else { p.set('minKw', S.minKw); path = '/ev'; }
  try {
    const r = await fetch(`${API}${path}?${p}`, { signal: S.ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || `Erreur serveur (${r.status}).`);
    S.items = j.stations || j.chargers || [];
    S.lastJ = j;
    render(j);
  } catch (e) {
    if (e.name === 'AbortError') return;
    setStatus(netMessage(e), 'error');
  }
}

function wipe() {
  S.pins.forEach(m => m && m.marker.remove()); S.pins = []; S.selected = -1;
  if (S.popup) { S.popup.remove(); S.popup = null; }
  $('#list').innerHTML = '';
}
function clearResults() { wipe(); S.items = []; S.lastJ = null; }

function tiers(vals) {
  const ps = vals.filter(v => typeof v === 'number').sort((a, b) => a - b);
  if (ps.length < 3) return () => 'g';
  const lo = ps[Math.floor(ps.length / 3)], hi = ps[Math.floor(ps.length * 2 / 3)];
  return p => p <= lo ? 'g' : p <= hi ? 'o' : 'r';
}
function evSummary(c) {
  return (c.connectors || []).map(k => `${k.count > 1 ? k.count + '× ' : ''}${k.type}${k.powerKw ? ' ' + k.powerKw + ' kW' : ''}`).join(' · ');
}

function render(j) {
  wipe();
  const items = S.items, fuel = S.mode === 'fuel';
  if (!items.length) {
    setStatus(fuel ? 'Aucune station trouvée ici. Augmentez le rayon ou déplacez la carte.' : 'Aucune borne trouvée ici. Augmentez le rayon, baissez la puissance minimale ou déplacez la carte.');
    setNotes(j.notes, j.warnings);
    return;
  }
  document.body.classList.remove('min');
  const views = fuel ? items.map(it => view(it)) : [];
  const tier = fuel ? tiers(views.map(v => v && v.cur === S.cur ? v.v : null)) : null;
  setStatus(fuel
    ? `${j.count} station${j.count > 1 ? 's' : ''} · ${j.pricedCount} avec prix (${FUELS[S.fuel]})`
    : `${j.count} borne${j.count > 1 ? 's' : ''} dans ${S.radius} km`);
  setNotes((j.notes || []).concat(fuel ? rateNote() : []), j.warnings);

  const list = $('#list'), bounds = new maplibregl.LngLatBounds();
  const frag = document.createDocumentFragment();
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'it'; li.dataset.i = i; li.tabIndex = 0;
    let val, cls = '';
    if (fuel) {
      const v = views[i];
      cls = v && v.cur === S.cur ? tier(v.v) : '';
      val = v ? `<div class="val ${cls}">${esc(money(v.v, v.cur))}</div>`
        : `<div class="val na">${it.hasPrice ? esc(FUELS[S.fuel]) + ' n/d' : 'Prix n/d'}</div>`;
    } else {
      val = `<div class="val kw">${it.maxPowerKw ? Math.round(it.maxPowerKw) + '<small>kW</small>' : '<small>?</small>'}</div>`;
    }
    const sub = fuel ? [it.address, it.city].filter(Boolean).join(', ') : (evSummary(it) || it.operator || '');
    li.innerHTML = `<div class="main"><strong>${esc(it.name)}</strong><span class="sub">${fmtDist(it.distanceKm)}${sub ? ' · ' + esc(sub) : ''}</span></div>${val}`;
    li.onclick = () => select(i, true);
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i, true); } };
    frag.appendChild(li);

    if (i < MAX_PINS) {
      const wrap = document.createElement('div'); wrap.className = 'mk';
      const b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-label', it.name);
      if (fuel) {
        if (views[i]) { b.className = 'pin ' + cls; b.textContent = money(views[i].v, views[i].cur, false); }
        else b.className = 'pin dot';
      } else {
        b.className = 'pin ev' + (it.maxPowerKw >= 50 ? ' fast' : '');
        b.textContent = '⚡' + (it.maxPowerKw ? Math.round(it.maxPowerKw) : '');
      }
      b.onclick = e => { e.stopPropagation(); select(i, true); };
      wrap.appendChild(b);
      const marker = new maplibregl.Marker({ element: wrap, anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(map);
      S.pins[i] = { marker, el: b };
      bounds.extend([it.lon, it.lat]);
    }
  });
  list.appendChild(frag);
  if (S.lastCenter) bounds.extend([S.lastCenter.lon, S.lastCenter.lat]);
  if (!bounds.isEmpty() && !render.noFit) map.fitBounds(bounds, { padding: { top: 140, bottom: Math.round(innerHeight * 0.5), left: 40, right: 40 }, maxZoom: 15, duration: 600 });
}

function select(i, fly) {
  const it = S.items[i]; if (!it) return;
  document.querySelectorAll('.it.sel').forEach(e => e.classList.remove('sel'));
  S.pins.forEach(p => p && p.el.classList.remove('sel'));
  const li = $(`.it[data-i="${i}"]`); if (li) { li.classList.add('sel'); li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  if (S.pins[i]) S.pins[i].el.classList.add('sel');
  S.selected = i;
  if (fly) map.easeTo({ center: [it.lon, it.lat], offset: [0, -Math.round(innerHeight * 0.12)], duration: 400 });
  if (S.popup) S.popup.remove();
  S.popup = new maplibregl.Popup({ offset: 22, maxWidth: '280px', focusAfterOpen: false })
    .setLngLat([it.lon, it.lat]).setHTML(popupHtml(it)).addTo(map);
}

function popupHtml(it) {
  const addr = [it.address, [it.postcode, it.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  let h = `<h3>${esc(it.name)}</h3>`;
  if (addr) h += `<p>${esc(addr)}</p>`;
  if (S.mode === 'fuel') {
    if (it.brand && it.brand !== it.name) h += `<p>${esc(it.brand)}</p>`;
    const rows = Object.keys(FUELS).filter(k => it.prices && typeof it.prices[k] === 'number');
    if (rows.length) {
      h += '<table>' + rows.map(k => {
        const v = view(it, k);
        const orig = v.converted ? ` <span style="font-weight:400;color:#52636D">(${esc(money(it.prices[k], it.currency || 'EUR'))})</span>` : '';
        return `<tr><td>${FUELS[k]}</td><td>${esc(money(v.v, v.cur))}${orig}</td></tr>`;
      }).join('') + '</table>';
    } else {
      h += '<p>Prix non disponible (source ouverte indisponible dans ce pays).</p>';
      if (it.fuels && it.fuels.length) h += `<p>Carburants : ${esc(it.fuels.map(k => FUELS[k]).join(', '))}</p>`;
    }
    if (typeof it.updated === 'string') h += `<p>Mise à jour : ${esc(it.updated)}</p>`;
    if (it.openingHours) h += `<p>Horaires : ${esc(it.openingHours)}</p>`;
  } else {
    if (it.operator) h += `<p>${esc(it.operator)}</p>`;
    if (it.connectors && it.connectors.length) h += '<table>' + it.connectors.map(c => `<tr><td>${c.count > 1 ? c.count + '× ' : ''}${esc(c.type)}</td><td>${c.powerKw ? c.powerKw + ' kW' : ''}</td></tr>`).join('') + '</table>';
    else h += '<p>Connecteurs non renseignés.</p>';
    if (it.points) h += `<p>Points de charge : ${it.points}</p>`;
    if (it.fee) h += `<p>Tarif : ${esc(it.fee === 'yes' ? 'payant' : it.fee === 'no' ? 'gratuit' : it.fee)}</p>`;
    if (it.access) h += `<p>Accès : ${esc(it.access)}</p>`;
    if (it.openingHours) h += `<p>Horaires : ${esc(it.openingHours)}</p>`;
  }
  const la = +it.lat, lo = +it.lon;
  h += `<a class="go" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${la},${lo}">Itinéraire</a>`;
  return h;
}

/* ---------- géolocalisation ---------- */
function setMe(lat, lon) {
  if (!S.me) { const el = document.createElement('div'); el.className = 'me'; S.me = new maplibregl.Marker({ element: el }); }
  S.me.setLngLat([lon, lat]).addTo(map);
}
function locate() {
  if (!navigator.geolocation) return setStatus('La géolocalisation n\'est pas prise en charge par ce navigateur.', 'error');
  if (!window.isSecureContext) return setStatus('La géolocalisation exige HTTPS ou http://localhost.', 'error');
  if (S.mode === 'alert') { S.mode = 'fuel'; store.set('w_mode', 'fuel'); fillControls(); }
  setStatus('Recherche de votre position…', 'busy');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    setMe(lat, lon); S.centerLabel = '';
    map.jumpTo({ center: [lon, lat], zoom: 12.5 });
    search(lat, lon);
    placeName(lat, lon);
  }, err => {
    setStatus(err.code === 1 ? 'Localisation refusée. Autorisez-la dans les réglages du navigateur, ou saisissez une ville.'
      : err.code === 3 ? 'Délai dépassé. Sortez à découvert ou saisissez une ville.' : 'Position indisponible. Saisissez une ville.', 'error');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
async function placeName(lat, lon) {
  try {
    const r = await fetch(`${API}/reverse?lat=${lat}&lon=${lon}`);
    if (!r.ok) return;
    const j = await r.json();
    if (j.label) { S.centerLabel = j.label.split(',').slice(0, 2).join(','); $('#q').placeholder = 'Près de : ' + S.centerLabel; }
  } catch (_) {}
}
$('#locate').onclick = locate;

/* ---------- recherche d'adresses (monde) ---------- */
const qEl = $('#q'), sugg = $('#sugg');
let tmr = null, gctrl = null, results = [];
function hideSugg() { sugg.hidden = true; sugg.innerHTML = ''; }
function pick(r) {
  hideSugg(); S.centerLabel = r.label.split(',').slice(0, 2).join(',');
  qEl.value = S.centerLabel; $('#clr').hidden = false; qEl.blur();
  if (S.mode === 'alert') { S.mode = 'fuel'; store.set('w_mode', 'fuel'); fillControls(); }
  map.jumpTo({ center: [r.lon, r.lat], zoom: 12.5 });
  search(r.lat, r.lon);
}
async function lookup(q) {
  if (gctrl) gctrl.abort(); gctrl = new AbortController();
  const c = map.getCenter();
  try {
    const r = await fetch(`${API}/geocode?q=${encodeURIComponent(q)}&lat=${c.lat.toFixed(2)}&lon=${c.lng.toFixed(2)}`, { signal: gctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'Recherche indisponible.');
    results = j.results || [];
    if (!results.length) { sugg.innerHTML = '<li><button type="button" disabled>Aucun résultat</button></li>'; sugg.hidden = false; return; }
    sugg.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('');
    sugg.hidden = false;
  } catch (e) {
    if (e.name === 'AbortError') return;
    sugg.innerHTML = `<li><button type="button" disabled>${esc(netMessage(e))}</button></li>`; sugg.hidden = false;
  }
}
qEl.addEventListener('input', () => {
  const v = qEl.value.trim(); $('#clr').hidden = !qEl.value;
  clearTimeout(tmr);
  if (v.length < 2) return hideSugg();
  tmr = setTimeout(() => lookup(v), 350);
});
qEl.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); clearTimeout(tmr);
  if (results.length && !sugg.hidden) return pick(results[0]);
  const v = qEl.value.trim(); if (v.length >= 2) { await lookup(v); if (results[0]) pick(results[0]); }
});
sugg.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pick(results[+b.dataset.i]); });
$('#clr').onclick = () => { qEl.value = ''; $('#clr').hidden = true; hideSugg(); qEl.focus(); };
document.addEventListener('click', e => { if (!e.target.closest('.top')) hideSugg(); });

/* ====================================================================
   ALERTES DE PRIX (carburant, monde entier)
   Une alerte = carburant + prix max + devise + lieu + rayon.
   Vérifiée à l'ouverture, puis toutes les 15 min tant que la page est ouverte.
   ==================================================================== */
const saveAlerts = () => store.set('w_alerts', S.alerts);

async function notify(title, body, tag) {
  toast(title + ' — ' + body);                      // toujours visible dans l'appli
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) {              // obligatoire sur Android (new Notification() y est refusé)
      await reg.showNotification(title, { body, tag, icon: 'logo.png', badge: 'logo.png', vibrate: [200, 100, 200] });
    } else {
      new Notification(title, { body, tag, icon: 'logo.png' });
    }
  } catch (_) { /* le toast a déjà informé */ }
}

async function checkAlert(a) {
  const p = new URLSearchParams({ lat: a.lat, lon: a.lon, radius: a.radius, fuel: a.fuel, sort: 'price', limit: 60 });
  const r = await fetch(`${API}/fuel?${p}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Erreur ' + r.status);
  let best = null;
  for (const s of j.stations || []) {
    if (typeof s.price !== 'number') continue;
    const v = conv(s.price, s.currency || 'EUR', a.currency);
    if (v === null) continue;                        // taux inconnu : on ne compare pas
    if (!best || v < best.v) best = { v, name: s.name, addr: s.city || s.address || '' };
  }
  a.last = { at: Date.now(), best: best ? best.v : null, name: best ? best.name : '', noPrice: !best };
  if (best && best.v <= a.max) {
    const again = !a.notifiedAt || Date.now() - a.notifiedAt > RENOTIFY || best.v < (a.notifiedPrice || Infinity) - 0.005;
    if (again) {
      a.notifiedAt = Date.now(); a.notifiedPrice = best.v;
      await notify(`${FUELS[a.fuel]} à ${money(best.v, a.currency)}`, `${best.name}${best.addr ? ' (' + best.addr + ')' : ''} · alerte ≤ ${money(a.max, a.currency)} · ${a.label}`, 'alert-' + a.id);
    }
  }
}
let checking = false;
async function checkAll(manual) {
  if (checking || !S.alerts.length) { if (manual && !S.alerts.length) toast('Aucune alerte à vérifier.'); return; }
  checking = true;
  try {
    if (!S.rates) await loadRates();
    for (const a of S.alerts) {
      try { await checkAlert(a); } catch (e) { a.last = { at: Date.now(), error: e.message }; }
      await new Promise(r => setTimeout(r, 400));
    }
    saveAlerts();
    if (S.mode === 'alert') renderAlerts();
    if (manual) toast('Alertes vérifiées.');
  } finally { checking = false; }
}

function renderAlerts() {
  const where = S.lastCenter ? (S.centerLabel || `${S.lastCenter.lat.toFixed(3)}, ${S.lastCenter.lon.toFixed(3)}`) : '';
  $('#aWhere').innerHTML = where
    ? `Lieu de l'alerte : <b>${esc(where)}</b> (dernière recherche).`
    : 'Cherchez d\'abord une ville ou touchez le viseur : l\'alerte surveillera ce lieu.';
  const f = $('#aFuel'); f.innerHTML = Object.entries(FUELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''); f.value = S.fuel;
  const rad = $('#aRad'); rad.innerHTML = [3, 5, 8, 12, 18, 25].map(r => `<option value="${r}">${r} km</option>`).join(''); rad.value = S.radius;
  $('#aCur').textContent = '(' + S.cur + ')';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#aPerm').hidden = perm === 'granted' || perm === 'unsupported';
  $('#aHint').textContent = (perm === 'denied' ? 'Notifications bloquées dans le navigateur : les alertes s\'affichent seulement dans l\'appli. ' : '')
    + 'Les alertes sont vérifiées à l\'ouverture puis toutes les 15 minutes tant que Riamo est ouvert. Elles ne tournent pas quand l\'appli est fermée. Prix disponibles : France, Espagne, Autriche.';
  $('#aList').innerHTML = S.alerts.length ? S.alerts.map(a => {
    const l = a.last, hit = l && l.best !== null && l.best !== undefined && l.best <= a.max;
    const state = !l ? 'Pas encore vérifiée.' : l.error ? 'Erreur : ' + esc(l.error)
      : l.noPrice ? 'Aucun prix dans cette zone.'
      : `Meilleur prix : ${esc(money(l.best, a.currency))}${l.name ? ' (' + esc(l.name) + ')' : ''}`;
    return `<li class="${hit ? 'hit' : ''}"><div class="main"><strong>${esc(FUELS[a.fuel])} ≤ ${esc(money(a.max, a.currency))}</strong><span class="sub">${esc(a.label)} · ${a.radius} km</span><span class="sub">${state}</span></div><button type="button" data-del="${esc(a.id)}" aria-label="Supprimer l'alerte">Supprimer</button></li>`;
  }).join('') : '';
}
$('#aAdd').onclick = async () => {
  if (!S.lastCenter) return toast('Cherchez d\'abord une ville ou touchez le viseur.');
  if (S.alerts.length >= MAX_ALERTS) return toast(`Maximum ${MAX_ALERTS} alertes. Supprimez-en une.`);
  const max = parseNum($('#aMax').value);
  if (max === null || max <= 0) return toast('Entrez un prix valide, par exemple 1,750.');
  const a = {
    id: Date.now().toString(36), fuel: $('#aFuel').value, max, currency: S.cur, radius: +$('#aRad').value,
    lat: S.lastCenter.lat, lon: S.lastCenter.lon,
    label: S.centerLabel || `${S.lastCenter.lat.toFixed(2)}, ${S.lastCenter.lon.toFixed(2)}`,
  };
  S.alerts.push(a); saveAlerts(); $('#aMax').value = '';
  if ('Notification' in window && Notification.permission === 'default') await askPermission();
  renderAlerts();
  checkAll(false);
};
async function askPermission() {
  try {
    const res = await Notification.requestPermission();
    if ('serviceWorker' in navigator && res === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) await navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  } catch (_) {}
}
$('#aPerm').onclick = async () => { await askPermission(); renderAlerts(); };
$('#aCheck').onclick = () => checkAll(true);
$('#aList').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'); if (!b) return;
  S.alerts = S.alerts.filter(a => a.id !== b.dataset.del); saveAlerts(); renderAlerts();
});
let lastCheck = 0;
function maybeCheck() { if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_EVERY - 60000) { lastCheck = Date.now(); checkAll(false); } }
document.addEventListener('visibilitychange', maybeCheck);
setInterval(maybeCheck, 60000);

/* ---------- démarrage ---------- */
fillControls();
fillCurrencies();
$('#aCur').textContent = '(' + S.cur + ')';
if (S.mode === 'alert') { renderAlerts(); setStatus(''); }
else setStatus('Saisissez une ville ou touchez le viseur pour vous localiser.');
loadRates().then(maybeCheck);
})();
