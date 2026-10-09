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

export function fmtCLP(n, { sign = false } = {}) {
  if (n == null || isNaN(n)) return '—';
  const s = sign && n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}$${group(String(Math.round(Math.abs(n))))}`;
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
//   CLP: "12.500" / "$12.500" / "12500" → 12500 (dot = thousands, comma = decimals)
//   USD: "12,50" / "12.50" / "1,250.50" / "1.250,50" → decimal mark detected from the last separator
export function parseAmount(str, currency = 'CLP') {
  if (typeof str === 'number') return str;
  let s = String(str || '').trim().replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    // "1,250" (USD thousands) vs "12,5" (decimal)
    s = parts.length > 2 || (currency === 'USD' && parts[1].length === 3) ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    // CLP: dots are thousands. USD: a single dot is the decimal point unless there are several.
    if (currency === 'CLP' || parts.length > 2) s = parts.join('');
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

export async function fetchJSON(url, { timeout = 12000, retries = 1, headers } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
