// All app data lives in one JSON document in localStorage (per device).
// Use Ajustes → Exportar respaldo to move it to another phone.

import { localDate, uid, daysBetween, clamp } from './util.js';
import { rarityInfo } from './rarity.js';

const KEY = 'vaultkeeper:v1';

const DEFAULTS = () => ({
  version: 1,
  settings: {
    display: 'CLP',
    claudeKey: '',
    claudeModel: 'claude-opus-5-5',
    ptcgKey: '',
    dealPct: 25, // % bajo mercado para considerar "ganga"
    minUSD: 15, // rango medio-alto: ignora cartas bajo este valor
    feePct: 0, // comisión/costos al revender
    keepRarities: ['illustration rare', 'special illustration rare', 'hyper rare', 'mega hyper rare'],
  },
  fx: { usdclp: 950, eurusd: 1.08, at: 0, src: 'valor inicial' },
  items: [],
  prices: {},
  priceHist: {},
  history: [],
  wishlist: {},
  trades: [],
  tradeDraft: { give: [], get: [], cash: 0, cashCur: 'CLP', cashDir: 'pay' },
  lastRefresh: 0,
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch (e) {
    console.warn('No se pudo leer el almacenamiento', e);
  }
  return DEFAULTS();
}

function merge(s) {
  const d = DEFAULTS();
  return { ...d, ...s, settings: { ...d.settings, ...s.settings }, fx: { ...d.fx, ...s.fx }, tradeDraft: { ...d.tradeDraft, ...s.tradeDraft } };
}

export const state = load();

// Late-bound app actions (set by app.js) so views can trigger them without import cycles.
export const actions = {};

const subs = new Set();
export const onChange = (fn) => (subs.add(fn), () => subs.delete(fn));

export function save({ silent = false } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    alert('No queda espacio para guardar. Exporta un respaldo y limpia datos antiguos.');
  }
  if (!silent) subs.forEach((f) => f());
}

export function replaceAll(data) {
  const fresh = merge(data);
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh);
  save();
}

export function exportData() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 1);
}

// ───────────────────────── Prices

const pickPrice = (o) => (o ? o.market ?? o.mid ?? o.low ?? null : null);

export function setPrice(cardId, p) {
  state.prices[cardId] = { ...p, at: Date.now() };
}

export function marketUSD(cardId, variant) {
  const p = state.prices[cardId];
  if (!p) return null;
  const tp = p.tp || {};
  if (variant && pickPrice(tp[variant])) return pickPrice(tp[variant]);
  for (const k of Object.keys(tp)) {
    const x = pickPrice(tp[k]);
    if (x) return x;
  }
  const eur = p.cm?.trend || p.cm?.avg;
  return eur ? eur * state.fx.eurusd : null;
}

export function pushHist(key, value) {
  if (!value) return;
  const h = (state.priceHist[key] ||= []);
  const d = localDate();
  if (h.length && h[h.length - 1][0] === d) h[h.length - 1][1] = value;
  else h.push([d, value]);
  if (h.length > 240) h.splice(0, h.length - 240);
}

// ───────────────────────── Items

export const held = () => state.items.filter((it) => it.status === 'held');
export const ownedCount = (cardId) => state.items.filter((it) => it.status === 'held' && it.cardId === cardId).length;
export const itemValueUSD = (it) => marketUSD(it.cardId, it.variant);

export function defaultPurpose(rarity) {
  return state.settings.keepRarities.includes(String(rarity || '').toLowerCase()) ? 'coleccion' : 'reventa';
}

export function toUSD(amount, currency, fx = state.fx.usdclp) {
  return currency === 'USD' ? amount : amount / fx;
}
export function toCLP(amount, currency, fx = state.fx.usdclp) {
  return currency === 'CLP' ? amount : amount * fx;
}

export function addItems({ card, variant, price, currency, date, purpose, notes, source, qty = 1, fx }) {
  fx = fx || state.fx.usdclp;
  const created = [];
  for (let i = 0; i < qty; i++) {
    const it = {
      id: uid(),
      cardId: card.id,
      name: card.name,
      setId: card.setId,
      setName: card.setName,
      number: card.number,
      total: card.total,
      rarity: card.rarity,
      image: card.image,
      variant,
      buy: { price, currency, fx, date, source: source || '' },
      costUSD: toUSD(price, currency, fx),
      costCLP: toCLP(price, currency, fx),
      marketAtBuy: marketUSD(card.id, variant),
      purpose: purpose || defaultPurpose(card.rarity),
      notes: notes || '',
      status: 'held',
      addedAt: Date.now(),
    };
    state.items.push(it);
    created.push(it);
  }
  snapshot();
  save();
  return created;
}

export function recordExit(item, { kind, price, currency, date, fx, tradeId }) {
  fx = fx || state.fx.usdclp;
  item.status = kind === 'trade' ? 'traded' : 'sold';
  item.exit = { kind, price, currency, fx, date, tradeId, usd: toUSD(price, currency, fx), clp: toCLP(price, currency, fx) };
}

export function removeItem(id) {
  state.items = state.items.filter((it) => it.id !== id);
  snapshot();
  save();
}

// ───────────────────────── Portfolio

export function summary() {
  const fx = state.fx.usdclp;
  let costUSD = 0, costCLP = 0, valueUSD = 0, n = 0, missing = 0;
  for (const it of state.items) {
    if (it.status !== 'held') continue;
    n++;
    costUSD += it.costUSD;
    costCLP += it.costCLP;
    const v = itemValueUSD(it);
    if (v == null) {
      missing++;
      valueUSD += it.costUSD;
    } else valueUSD += v;
  }
  let realUSD = 0, realCLP = 0, exits = 0;
  for (const it of state.items) {
    if (it.status === 'held' || !it.exit) continue;
    exits++;
    realUSD += it.exit.usd - it.costUSD;
    realCLP += it.exit.clp - it.costCLP;
  }
  const valueCLP = valueUSD * fx;
  return {
    n, missing, exits, costUSD, costCLP, valueUSD, valueCLP, realUSD, realCLP,
    gainUSD: valueUSD - costUSD,
    gainCLP: valueCLP - costCLP,
    pctUSD: costUSD ? (valueUSD - costUSD) / costUSD : 0,
    pctCLP: costCLP ? (valueCLP - costCLP) / costCLP : 0,
  };
}

// One point per day: what the vault cost vs. what it was worth that day.
export function snapshot() {
  const s = summary();
  if (!s.n && !state.history.length) return;
  const row = { d: localDate(), cu: s.costUSD, cc: s.costCLP, v: s.valueUSD, fx: state.fx.usdclp };
  const h = state.history;
  if (h.length && h[h.length - 1].d === row.d) h[h.length - 1] = row;
  else h.push(row);
}

// ───────────────────────── Sell recommendations

export function momentum(it) {
  const cm = state.prices[it.cardId]?.cm;
  if (cm?.avg7 && cm?.avg30) return cm.avg7 / cm.avg30 - 1;
  const hist = state.priceHist[`${it.cardId}|${it.variant}`];
  if (hist && hist.length >= 3) {
    const last = hist[hist.length - 1];
    const ref = hist.find(([d]) => daysBetween(d, last[0]) <= 30) || hist[0];
    if (ref !== last && ref[1]) return last[1] / ref[1] - 1;
  }
  return null;
}

export function sellRanking({ includeKeep = false } = {}) {
  const fx = state.fx.usdclp;
  const fee = state.settings.feePct / 100;
  const today = localDate();
  return held()
    .filter((it) => includeKeep || it.purpose !== 'coleccion')
    .map((it) => {
      const v = itemValueUSD(it);
      if (v == null) return null;
      const net = v * (1 - fee);
      const gainUSD = net - it.costUSD;
      const gainCLP = net * fx - it.costCLP;
      // Judge profit in the currency the user thinks in (FX may have moved since the purchase).
      const gainPct = state.settings.display === 'USD' ? (it.costUSD > 0 ? gainUSD / it.costUSD : 0) : it.costCLP > 0 ? gainCLP / it.costCLP : 0;
      const gainDisp = state.settings.display === 'USD' ? gainUSD : gainCLP / fx;
      const mom = momentum(it);
      const days = daysBetween(it.buy.date || today, today);
      let score = clamp(gainPct, -1, 3) * 50 + Math.log10(1 + Math.max(gainDisp, 0)) * 22;
      if (mom != null) score += mom < 0 ? Math.min(-mom, 0.3) * 90 : -Math.min(mom, 0.3) * 40;
      score += Math.min(days / 30, 5) * 2;
      if (gainDisp <= 0) score -= 60;

      const reasons = [];
      if (gainDisp > 0) reasons.push(`${Math.round(gainPct * 100)}% sobre tu compra`);
      else reasons.push('Aún bajo tu costo');
      if (mom != null && mom <= -0.03) reasons.push(`precio bajando ${Math.round(-mom * 100)}% (7d vs 30d)`);
      if (mom != null && mom >= 0.05) reasons.push(`subiendo ${Math.round(mom * 100)}%: podría esperar`);
      if (days >= 60) reasons.push(`${days} días en el vault`);

      const p = state.prices[it.cardId]?.tp?.[it.variant];
      const listCLP = Math.round((v * fx) / 500) * 500;
      const floorCLP = Math.round(Math.max(it.costCLP * 1.1, (p?.low || 0) * fx) / 500) * 500;
      return { it, v, gainUSD, gainCLP, gainPct, profitable: gainDisp > 0, mom, days, score, reasons, listCLP, floorCLP };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// ───────────────────────── Deals

export function dealVerdict(askUSD, marketUSDv) {
  const s = state.settings;
  if (!marketUSDv || !askUSD) return null;
  const off = 1 - askUSD / marketUSDv;
  const profitUSD = marketUSDv * (1 - s.feePct / 100) - askUSD;
  let label, cls;
  if (off >= s.dealPct / 100) (label = 'Ganga'), (cls = 'deal-hot');
  else if (off >= 0.1) (label = 'Buen precio'), (cls = 'deal-good');
  else if (off >= -0.05) (label = 'Precio justo'), (cls = 'deal-fair');
  else (label = 'Caro'), (cls = 'deal-bad');
  return { off, profitUSD, label, cls, belowRange: marketUSDv < s.minUSD };
}

export const isKeeperRarity = (r) => rarityInfo(r).tier >= 6;
