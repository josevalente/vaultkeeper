// Card data + TCGplayer market prices.
// Primary: TCGdex (free, CORS, includes TCGplayer USD + Cardmarket EUR with 7/30-day averages).
// Fallback for prices: pokemontcg.io (same TCGplayer feed).

import { fetchJSON, similarity, pool } from './util.js';
import { state } from './store.js';

const TD = 'https://api.tcgdex.net/v2/en';
const PTCG = 'https://api.pokemontcg.io/v2';

export const PLACEHOLDER = 'icons/card-back.svg';

export function img(image, q = 'low') {
  return image ? `${image}/${q}.webp` : PLACEHOLDER;
}

export function variantLabel(k) {
  return (
    {
      normal: 'Normal',
      holofoil: 'Holo',
      'reverse-holofoil': 'Reverse Holo',
      '1st-edition-holofoil': '1ª Ed. Holo',
      '1st-edition-normal': '1ª Ed.',
      '1st-edition': '1ª Ed.',
      unlimited: 'Unlimited',
      'unlimited-holofoil': 'Unlimited Holo',
    }[k] || k
  );
}

// ───────────────────────── local cache

function cacheGet(key, ttlMs) {
  try {
    const raw = localStorage.getItem('vkc:' + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (ttlMs && Date.now() - t > ttlMs) return null;
    return v;
  } catch {
    return null;
  }
}
function cacheSet(key, v) {
  try {
    localStorage.setItem('vkc:' + key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* cache is best-effort */
  }
}

// ───────────────────────── sets

let setsPromise;
export function getSets() {
  if (!setsPromise) {
    setsPromise = (async () => {
      const cached = cacheGet('sets', 3 * 86400000);
      if (cached) return cached;
      const [all, pocket] = await Promise.all([fetchJSON(`${TD}/sets`, { retries: 2 }), fetchJSON(`${TD}/series/tcgp`).catch(() => null)]);
      const pocketIds = new Set((pocket?.sets || []).map((s) => s.id));
      const sets = (all || [])
        .filter((s) => !pocketIds.has(s.id))
        .map((s, idx) => ({ id: s.id, name: s.name, official: s.cardCount?.official, total: s.cardCount?.total, logo: s.logo, idx }));
      cacheSet('sets', sets);
      return sets;
    })().catch((e) => {
      setsPromise = null;
      const stale = cacheGet('sets');
      if (stale) return stale;
      throw e;
    });
  }
  return setsPromise;
}

export async function setMap() {
  const sets = await getSets();
  return new Map(sets.map((s) => [s.id, s]));
}

const setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('-'));

async function decorate(list) {
  const map = await setMap();
  return (list || [])
    .map((c) => {
      const setId = setIdOf(c.id);
      const s = map.get(setId);
      if (!s) return null; // TCG Pocket or unknown → skip
      return { id: c.id, name: c.name, number: c.localId, image: c.image, setId, setName: s.name, total: s.official, setIdx: s.idx };
    })
    .filter(Boolean);
}

// ───────────────────────── card + prices

function normPrices(c) {
  const tp = {};
  const t = c.pricing?.tcgplayer;
  if (t) {
    for (const [k, v] of Object.entries(t)) {
      if (!v || typeof v !== 'object') continue;
      tp[k] = { low: v.lowPrice ?? null, mid: v.midPrice ?? null, high: v.highPrice ?? null, market: v.marketPrice ?? null, pid: v.productId };
    }
  }
  let cm = null;
  const m = c.pricing?.cardmarket;
  if (m) {
    const holo = m.avg == null && m['avg-holo'] != null;
    const g = (k) => (holo ? m[`${k}-holo`] : m[k]) ?? null;
    cm = { avg: g('avg'), low: g('low'), trend: g('trend') || null, avg7: g('avg7'), avg30: g('avg30'), pid: m.idProduct };
  }
  return { tp, cm };
}

function normCard(c) {
  const variants = new Set();
  const v = c.variants || {};
  if (v.normal) variants.add('normal');
  if (v.holo) variants.add('holofoil');
  if (v.reverse) variants.add('reverse-holofoil');
  if (v.firstEdition) variants.add('1st-edition-holofoil');
  return {
    id: c.id,
    name: c.name,
    number: c.localId,
    total: c.set?.cardCount?.official,
    setId: c.set?.id,
    setName: c.set?.name,
    setLogo: c.set?.logo,
    rarity: c.rarity,
    image: c.image,
    illustrator: c.illustrator,
    variants: [...variants],
  };
}

async function ptcgPrices(card) {
  const headers = state.settings.ptcgKey ? { 'X-Api-Key': state.settings.ptcgKey } : undefined;
  const num = String(card.number).replace(/^0+(?=\d)/, '');
  const q = `name:"${card.name.replace(/"/g, '')}" number:${num}`;
  const res = await fetchJSON(`${PTCG}/cards?q=${encodeURIComponent(q)}&select=id,set,tcgplayer&pageSize=20`, { headers, retries: 2, timeout: 10000 });
  const hit = (res?.data || []).find((d) => d.set?.printedTotal == card.total) || res?.data?.[0];
  const tp = {};
  for (const [k, v] of Object.entries(hit?.tcgplayer?.prices || {})) {
    const key = k.replace(/([A-Z])/g, '-$1').toLowerCase();
    tp[key] = { low: v.low ?? null, mid: v.mid ?? null, high: v.high ?? null, market: v.market ?? null };
  }
  return { tp, url: hit?.tcgplayer?.url };
}

const cardMem = new Map();

export async function getCard(id, { fresh = false } = {}) {
  if (!fresh && cardMem.has(id)) return cardMem.get(id);
  const raw = await fetchJSON(`${TD}/cards/${encodeURIComponent(id)}`, { retries: 2 });
  if (!raw) throw new Error('Carta no encontrada');
  const card = normCard(raw);
  const prices = normPrices(raw);
  if (!Object.keys(prices.tp).length) {
    try {
      const alt = await ptcgPrices(card);
      if (Object.keys(alt.tp).length) Object.assign(prices, { tp: alt.tp, url: alt.url, src: 'pokemontcg.io' });
    } catch {
      /* fallback is optional */
    }
  }
  if (!card.variants.length) card.variants = Object.keys(prices.tp);
  for (const k of Object.keys(prices.tp)) if (!card.variants.includes(k)) card.variants.push(k);
  const out = { card, prices };
  cardMem.set(id, out);
  return out;
}

export function tcgplayerUrl(prices, variant, card) {
  const pid = prices?.tp?.[variant]?.pid || Object.values(prices?.tp || {}).find((v) => v.pid)?.pid;
  if (pid) return `https://www.tcgplayer.com/product/${pid}`;
  if (prices?.url) return prices.url;
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(`${card.name} ${card.number}`)}`;
}

// ───────────────────────── search

export async function searchByName(q) {
  q = q.trim();
  if (q.length < 2) return [];
  const list = await fetchJSON(`${TD}/cards?name=${encodeURIComponent(q)}`, { retries: 1 });
  const out = await decorate(list);
  const base = (n) => String(n || '').toLowerCase().replace(/\b(ex|v|vmax|vstar|gx)\b/g, '').trim();
  const sim = (c) => Math.round(similarity(base(c.name), base(q)) * 4);
  return out.sort((a, b) => sim(b) - sim(a) || b.setIdx - a.setIdx).slice(0, 150);
}

// Number as printed on the card ("199/165", "TG05/TG30"). Name is optional and used to rank.
export async function findByNumber(number, total, name, { nameFallback = true } = {}) {
  number = String(number || '').trim().toUpperCase();
  if (!number) return name ? searchByName(name) : [];
  const variantsOfNum = new Set([number, number.replace(/^0+(?=\d)/, ''), number.padStart(3, '0')]);
  const lists = await pool([...variantsOfNum], 3, (n) => fetchJSON(`${TD}/cards?localId=${encodeURIComponent(n)}`));
  const seen = new Set();
  let cands = (await decorate(lists.flat().filter(Boolean))).filter((c) => !seen.has(c.id) && seen.add(c.id));
  const numEq = (a, b) => a.toUpperCase().replace(/^0+(?=\d)/, '') === b.replace(/^0+(?=\d)/, '');
  cands = cands.filter((c) => numEq(String(c.number), number));
  const totalNum = parseInt(String(total || '').replace(/\D/g, ''), 10);
  if (totalNum) {
    const byTotal = cands.filter((c) => c.total === totalNum);
    if (byTotal.length) cands = byTotal;
  }
  // Name similarity in coarse buckets (OCR is noisy), then newest set first.
  const base = (n) => String(n || '').toLowerCase().replace(/\b(ex|v|vmax|vstar|gx)\b/g, '').trim();
  const sim = (c) => Math.round(similarity(base(c.name), base(name)) * 4);
  if (name) cands.sort((a, b) => sim(b) - sim(a) || b.setIdx - a.setIdx);
  else cands.sort((a, b) => b.setIdx - a.setIdx);
  if (!cands.length && name && nameFallback) return searchByName(name);
  return cands.slice(0, 40);
}

// All cards of one set (brief), cached — used to match an OCR'd name inside the sets that share a printed total.
export async function setCards(setId) {
  const key = 'set:' + setId;
  const cached = cacheGet(key, 7 * 86400000);
  if (cached) return cached;
  const s = await fetchJSON(`${TD}/sets/${encodeURIComponent(setId)}`, { retries: 1 });
  const out = await decorate(s?.cards || []);
  cacheSet(key, out);
  return out;
}

export async function listByRarity(apiRarity) {
  const key = 'rar:' + apiRarity.toLowerCase();
  const cached = cacheGet(key, 2 * 86400000);
  if (cached) return cached;
  const list = await fetchJSON(`${TD}/cards?rarity=${encodeURIComponent('eq:' + apiRarity)}`, { retries: 2, timeout: 20000 });
  const out = await decorate(list);
  cacheSet(key, out);
  return out;
}

// Price lookup with a 12 h cache, used by the checklist ("¿cuánto cuesta lo que me falta?").
export async function quickPrice(id) {
  const key = 'qp:' + id;
  const cached = cacheGet(key, 12 * 3600000);
  if (cached !== null && cached !== undefined) return cached;
  const { prices } = await getCard(id);
  const tp = prices.tp || {};
  let best = null;
  for (const v of Object.values(tp)) {
    const m = v.market ?? v.mid ?? v.low;
    if (m != null && (best == null || m > best)) best = m;
  }
  if (best == null && prices.cm) best = (prices.cm.trend || prices.cm.avg || 0) * state.fx.eurusd || null;
  cacheSet(key, best);
  return best;
}

export const cachedQuickPrice = (id) => cacheGet('qp:' + id, 12 * 3600000);
