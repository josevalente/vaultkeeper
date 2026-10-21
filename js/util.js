// Small DOM, formatting and network helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// YYYY-MM-DD in the phone's local time zone (not UTC).
export const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE');

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Chilean style for both currencies: dot for thousands, comma for decimals ($320.156 · US$326,74).
// Grouping is done by hand: some browsers don't group 4-digit numbers in es-CL ("5000").
const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Round a suggested peso price to a step that fits its size: $100 under $5.000, $500 under
// $20.000, $1.000 above. (A fixed $500 step turned a $736 card into "$500" and its $550 minimum
// into "$1.000".) mode: 'round' | 'floor' (prices to pay) | 'ceil' (minimums).
export function roundCLP(n, mode = 'round') {
  if (n == null || !isFinite(n)) return null;
  const step = Math.abs(n) < 5000 ? 100 : Math.abs(n) < 20000 ? 500 : 1000;
  const r = Math[mode](n / step) * step;
  // A card worth $40 shouldn't read "$0": round those to $10 instead.
  return r === 0 && n > 0 && mode !== 'floor' ? Math.ceil(n / 10) * 10 : r;
}

export function fmtCLP(n, { sign = false } = {}) {
  if (n == null || isNaN(n)) return '—';
  const r = Math.round(n); // sign after rounding: never "−$0"
  const s = sign && r > 0 ? '+' : r < 0 ? '−' : '';
  return `${s}$${group(String(Math.abs(r)))}`;
}

export function fmtUSD(n, { sign = false } = {}) {
  if (n == null || isNaN(n)) return '—';
  const s = sign && n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${s}US$${group(String(Math.round(abs)))}`;
  const [i, d] = abs.toFixed(2).split('.');
  return `${s}US$${group(i)},${d}`;
}

export function fmtPct(n, { sign = true, digits = 1 } = {}) {
  if (n == null || isNaN(n) || !isFinite(n)) return '—';
  const s = sign && n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n * 100).toFixed(digits).replace('.', ',')}%`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function timeAgo(ts) {
  if (!ts) return 'nunca';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.round(hrs / 24)} d`;
}

// Parses amounts typed the Chilean way or the US way:
//   CLP: "12.500" / "$12.500" / "12500" / "12,500" → 12500 (pesos have no decimals: a separator
//        followed by exactly 3 digits is always thousands; the iPhone keypad only has a comma)
//   USD: "12,50" / "12.50" / "1,250.50" / "1.250,50" / "1.250" → decimal mark from the last
//        separator; a lone separator before exactly 3 digits is thousands, as fmtUSD writes it
export function parseAmount(str, currency = 'CLP') {
  if (typeof str === 'number') return str;
  let s = String(str || '').trim().replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    // Thousands when repeated ("1.234.567") or when a group of exactly 3 digits follows
    // ("12,500", "US$1.250"); otherwise it's the decimal mark ("12,5", "12.50"). In CLP a dot
    // is always thousands.
    const thousands = parts.length > 2 || parts[1].length === 3 || (currency === 'CLP' && sep === '.');
    s = thousands ? parts.join('') : parts.join('.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Runs fn over items with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = undefined;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// fresh: true = a refresh; a copy the service worker served because the network failed (header
// x-vk-from-cache) counts as a failure, so old prices are never stamped as just updated.
export async function fetchJSON(url, { timeout = 12000, retries = 1, headers, fresh = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (fresh && res.headers.get('x-vk-from-cache')) throw new Error('sin conexión (copia guardada)');
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

let toastTimer;
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
}

export function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const grams = (s) => new Set(Array.from({ length: Math.max(1, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const A = grams(a), B = grams(b);
  let inter = 0;
  A.forEach((g) => B.has(g) && inter++);
  return (2 * inter) / (A.size + B.size);
}

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Sheets close with a downward swipe: from the header, or from the content when it's scrolled to
// the top (so scrolling a long sheet never closes it by accident).
export function swipeToClose(wrap, close) {
  const sheet = wrap.querySelector('.sheet');
  const body = wrap.querySelector('.sheet-body');
  if (!sheet) return;
  let y0 = null, x0 = 0, dy = 0, t0 = 0, dragging = false, fromHead = false;
  sheet.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return (y0 = null);
      fromHead = !!e.target.closest('.sheet-head');
      // Inside horizontal scrollers or text fields the finger is doing something else.
      if (!fromHead && (body.scrollTop > 0 || e.target.closest('input, textarea, select, .chips-scroll, .rgrid, .tv'))) return (y0 = null);
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      dy = 0;
      t0 = Date.now();
      dragging = false;
    },
    { passive: true }
  );
  sheet.addEventListener(
    'touchmove',
    (e) => {
      if (y0 == null) return;
      const d = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
      if (!dragging) {
        if (d < -4 || dx > 12) return (y0 = null); // scrolling up or sideways: not a close gesture
        if (d < 10 || dx > d) return;
        if (!fromHead && body.scrollTop > 0) return (y0 = null);
        dragging = true;
        sheet.style.transition = 'none';
      }
      dy = Math.max(0, d);
      sheet.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (dy > 110 || (dy > 50 && Date.now() - t0 < 280)) {
      sheet.style.transform = 'translateY(100%)';
      close();
    } else sheet.style.transform = '';
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

// Full-screen picture of a card: double tap (or double click) to zoom in/out, swipe down or ✕ to close.
export function openImageViewer(src, alt = '') {
  const v = h(`
    <div class="img-viewer" role="dialog" aria-modal="true" aria-label="${esc(alt || 'Imagen')}">
      <button class="icon-btn iv-close" aria-label="Cerrar">✕</button>
      <div class="iv-scroll"><img src="${esc(src)}" alt="${esc(alt)}"></div>
      <p class="iv-hint">Doble toque para acercar · desliza hacia abajo para cerrar</p>
    </div>`);
  document.body.appendChild(v);
  requestAnimationFrame(() => v.classList.add('open'));
  const scroller = $('.iv-scroll', v), pic = $('img', v);
  const close = () => {
    v.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => v.remove(), 220);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  $('.iv-close', v).onclick = close;
  const toggleZoom = (x, y) => {
    const r = pic.getBoundingClientRect();
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    v.classList.toggle('zoom');
    if (v.classList.contains('zoom')) {
      const r2 = pic.getBoundingClientRect();
      scroller.scrollLeft = fx * r2.width - scroller.clientWidth / 2;
      scroller.scrollTop = fy * r2.height - scroller.clientHeight / 2;
    }
  };
  pic.addEventListener('dblclick', (e) => toggleZoom(e.clientX, e.clientY));
  let lastTap = 0, y0 = null, x0 = 0;
  scroller.addEventListener('touchstart', (e) => {
    y0 = e.touches.length === 1 && !v.classList.contains('zoom') ? e.touches[0].clientY : null;
    x0 = e.touches[0]?.clientX ?? 0;
  }, { passive: true });
  scroller.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (y0 != null && t.clientY - y0 > 90 && Math.abs(t.clientX - x0) < 80) return close();
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault();
      toggleZoom(t.clientX, t.clientY);
      lastTap = 0;
    } else lastTap = now;
  });
  return { close };
}

// Searchable list for long pickers (Yu-Gi-Oh has 1.000+ sets): a sheet with a search box and the
// options grouped ("Con cartas en tu vault" first). openSheet is passed in so it works in any vault.
// items: [{ id, label, sub, group }]; searching matches label, sub and code words in any order.
export function openPicker({ title, items, current, onPick, openSheet, placeholder = 'Buscar por nombre o código' }) {
  const body = h(`<div class="picker"><input class="input pk-q" type="search" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search" aria-label="${esc(placeholder)}"><div class="pk-list"></div></div>`);
  const s = openSheet({ title, body, cls: 'tall' });
  const q = $('.pk-q', body), list = $('.pk-list', body);
  const MAX = 300;
  const paint = () => {
    const words = norm(q.value).split(/\s+/).filter(Boolean);
    const seen = new Set();
    // Searching: each option once (a set you have cards from is listed in two groups).
    const hits = words.length ? items.filter((it) => words.every((w) => norm(`${it.label} ${it.sub || ''}`).includes(w)) && !seen.has(it.id) && seen.add(it.id)) : items;
    if (!hits.length) return (list.innerHTML = `<div class="empty"><p>Nada con “${esc(q.value)}”.</p></div>`);
    let html = '', group = null;
    for (const it of hits.slice(0, MAX)) {
      if (!words.length && it.group && it.group !== group) html += `<div class="pk-group">${esc((group = it.group))}</div>`;
      html += `<button class="pk-row ${it.id === current ? 'on' : ''}" data-id="${esc(it.id)}"><span><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.id === current ? '<em>✓</em>' : ''}</button>`;
    }
    if (hits.length > MAX) html += `<p class="muted tiny">y ${hits.length - MAX} más: escribe para acotar.</p>`;
    list.innerHTML = html;
  };
  q.oninput = paint;
  list.onclick = (e) => {
    const b = e.target.closest('.pk-row');
    if (!b) return;
    s.close();
    onPick(b.dataset.id);
  };
  paint();
  setTimeout(() => q.focus(), 300);
  return s;
}

// Inicio: the wishlist one tap away. items: [{ id, name, image, usd, hit }] (newest first).
export function wishPanelHTML(items, { money }) {
  const priced = items.filter((x) => x.usd != null);
  const hits = items.filter((x) => x.hit).length;
  const sub = items.length
    ? [`${items.length} carta${items.length === 1 ? '' : 's'}`, priced.length ? `~${money(priced.reduce((a, x) => a + x.usd, 0))}` : '', hits ? `${hits} bajo tu meta` : ''].filter(Boolean).join(' · ')
    : 'Toca ♡ en cualquier carta para guardarla aquí';
  return `
    <section class="panel wish-panel rise" style="--d:1">
      <button class="wish-head" aria-label="Abrir mi wishlist"><span class="heart">♥</span><div><b>Mi wishlist</b><small class="${hits ? 'pos' : ''}">${esc(sub)}</small></div><em aria-hidden="true">›</em></button>
      ${items.length ? `<div class="wish-strip">${items.slice(0, 12).map((x) => `<button class="${x.hit ? 'hit' : ''}" data-id="${esc(x.id)}" aria-label="${esc(x.name)}"><img src="${esc(x.image || 'icons/card-back.svg')}" alt="" loading="lazy" onerror="this.src='icons/card-back.svg'"></button>`).join('')}${items.length > 12 ? `<button class="more-n" aria-label="Ver todas">+${items.length - 12}</button>` : ''}</div>` : ''}
    </section>`;
}

// "×3" on a card's picture when you hold more than one copy of it.
export const qtyBadge = (n) => (n > 1 ? `<span class="qty-badge" title="Tienes ${n} copias" aria-label="${n} copias">×${n}</span>` : '');
// Copies held of each card: Map(cardKey → n).
export function heldCounts(items, key) {
  const m = new Map();
  for (const it of items) if (it.status === 'held') m.set(it[key], (m.get(it[key]) || 0) + 1);
  return m;
}
