// All app data lives in one JSON document in localStorage (per device).
// Use Ajustes → Exportar respaldo to move it to another phone.

import { localDate, uid, daysBetween, clamp, fmtCLP } from './util.js';
import { rarityInfo } from './rarity.js';

const KEY = 'vaultkeeper:v1';

// Where you sell and what each place costs you. Mercado Libre's fee depends on the category and
// listing type: check yours in Mercado Libre and adjust it in Ajustes.
const DEFAULT_CHANNELS = () => [
  { id: 'feria', name: 'En la feria', feePct: 0, fixedCLP: 0 },
  { id: 'insta', name: 'Instagram / WhatsApp', feePct: 0, fixedCLP: 0 },
  { id: 'ml', name: 'Mercado Libre', feePct: 13, fixedCLP: 0 },
  { id: 'fb', name: 'Facebook Marketplace', feePct: 0, fixedCLP: 0 },
  { id: 'otro', name: 'Otro', feePct: 0, fixedCLP: 0 },
];

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
    targetMargin: 30, // % de ganancia que buscas al revender ("paga como máximo")
    alertPct: 10, // avisar si una carta del vault se mueve más que esto en 7 días
    channels: DEFAULT_CHANNELS(),
    defaultChannel: 'feria',
    lastBackup: 0,
    scanLang: 'en',
  },
  alertsSeen: {},
  expenses: [],
  lotDraft: { items: [], ask: '', askCur: 'CLP' },
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
  // Before sale channels existed there was one global "comisión al revender": keep it as the
  // fee of the default channel so estimates don't change after the update.
  if (s.settings && !s.settings.channels && s.settings.feePct > 0) {
    s.settings.channels = DEFAULT_CHANNELS();
    s.settings.channels[0].feePct = s.settings.feePct;
  }
  return { ...d, ...s, settings: { ...d.settings, ...s.settings }, fx: { ...d.fx, ...s.fx }, tradeDraft: { ...d.tradeDraft, ...s.tradeDraft }, lotDraft: { ...d.lotDraft, ...s.lotDraft } };
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
  const keys = { claudeKey: state.settings?.claudeKey || '', ptcgKey: state.settings?.ptcgKey || '' };
  const fresh = merge(data);
  if (!fresh.settings.claudeKey) fresh.settings.claudeKey = keys.claudeKey;
  if (!fresh.settings.ptcgKey) fresh.settings.ptcgKey = keys.ptcgKey;
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, fresh);
  save();
}

// Backups leave out the API keys: they get shared through WhatsApp/Files and shouldn't carry secrets.
export function exportData() {
  const { claudeKey, ptcgKey, ...settings } = state.settings;
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 1);
}

// ───────────────────────── Prices

const pickPrice = (o) => (o ? o.market ?? o.mid ?? o.low ?? null : null);

export function setPrice(cardId, p) {
  state.prices[cardId] = { ...p, at: Date.now() };
}

// Market value in USD for one copy, plus where it came from:
//  1) TCGplayer for that exact version (market → mid → low)
//  2) TCGplayer of the only listed version, when there is just one (unambiguous)
//  3) Cardmarket trend (EUR→USD)
// Never borrows another version's price when several exist (a reverse holo isn't the normal card).
export function priceOf(cardId, variant) {
  const p = state.prices[cardId];
  if (!p) return null;
  const tp = p.tp || {};
  if (variant && pickPrice(tp[variant])) return { usd: pickPrice(tp[variant]), src: 'tcgplayer' };
  const keys = Object.keys(tp).filter((k) => pickPrice(tp[k]));
  if ((!variant || !tp[variant]) && keys.length === 1) return { usd: pickPrice(tp[keys[0]]), src: 'tcgplayer-otra-version' };
  const eur = p.cm?.trend || p.cm?.avg;
  if (eur) return { usd: eur * state.fx.eurusd, src: 'cardmarket' };
  return null;
}

export function marketUSD(cardId, variant) {
  return priceOf(cardId, variant)?.usd ?? null;
}

// Cheapest priced version (for wishlist targets, where any version will do).
export function minMarketUSD(cardId) {
  const tp = state.prices[cardId]?.tp || {};
  const vals = Object.keys(tp).map((k) => pickPrice(tp[k])).filter((v) => v != null);
  return vals.length ? Math.min(...vals) : marketUSD(cardId);
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

// Copies registered while TCGdex still had placeholder data get the real version and rarity:
// if the copy's version has no price and the card has exactly one priced version, that's the one
// (e.g. bought as "Normal" but TCGplayer only lists the Holofoil).
export function repairItems(card, prices) {
  const tp = prices.tp || {};
  const priced = Object.keys(tp).filter((k) => (tp[k]?.market ?? tp[k]?.mid ?? tp[k]?.low) != null);
  for (const it of held()) {
    if (it.cardId !== card.id) continue;
    if (!tp[it.variant] && priced.length === 1) it.variant = priced[0];
    if (!it.rarity && card.rarity) it.rarity = card.rarity;
  }
}
export const ownedCount = (cardId) => state.items.filter((it) => it.status === 'held' && it.cardId === cardId).length;
// Card condition → share of the Near Mint price. TCGplayer's market price is for Near Mint;
// these factors are the usual market discounts (approximate, same for every card).
export const CONDITIONS = {
  NM: { label: 'Near Mint', f: 1 },
  LP: { label: 'Lightly Played', f: 0.85 },
  MP: { label: 'Moderately Played', f: 0.7 },
  HP: { label: 'Heavily Played', f: 0.5 },
  DMG: { label: 'Dañada', f: 0.35 },
};
export const GRADERS = ['PSA', 'CGC', 'BGS', 'TAG', 'ACE', 'Otra'];
export const condFactor = (c) => CONDITIONS[c]?.f ?? 1;
export const isSealed = (it) => String(it.cardId || it.id || '').startsWith('sealed-');

// Value of one copy: a graded copy uses the value you set (no free source for slab prices);
// otherwise the market price of its version × its condition.
export function itemValueUSD(it) {
  if (it.graded?.usd) return it.graded.usd;
  const m = marketUSD(it.cardId, it.variant);
  return m == null ? null : m * (isSealed(it) ? 1 : condFactor(it.condition));
}

// Highest price that still leaves `marginPct` profit after the sale fee.
export function maxPayUSD(marketUSDv, { feePct = feeNow(), fixedCLP = fixedNow(), marginPct = state.settings.targetMargin } = {}) {
  if (!marketUSDv) return null;
  const net = marketUSDv * (1 - feePct / 100) - fixedCLP / state.fx.usdclp;
  return Math.max(0, net) / (1 + marginPct / 100);
}

// What you'd actually receive selling at `valueUSD` through your usual channel (% + fixed fee).
export function netEstimateUSD(valueUSD) {
  return Math.max(0, valueUSD * (1 - feeNow() / 100) - fixedNow() / state.fx.usdclp);
}

export const channelById = (id) => state.settings.channels.find((c) => c.id === id) || state.settings.channels[0];
// Fee (%) used for every estimate: the one of the channel you usually sell through.
export const feeNow = () => channelById(state.settings.defaultChannel)?.feePct || 0;
export const fixedNow = () => channelById(state.settings.defaultChannel)?.fixedCLP || 0;

export function defaultPurpose(rarity) {
  return state.settings.keepRarities.includes(String(rarity || '').toLowerCase()) ? 'coleccion' : 'reventa';
}

export function toUSD(amount, currency, fx = state.fx.usdclp) {
  return currency === 'USD' ? amount : amount / fx;
}
export function toCLP(amount, currency, fx = state.fx.usdclp) {
  return currency === 'CLP' ? amount : amount * fx;
}

export function addItems({ card, variant, price, currency, date, purpose, notes, source, qty = 1, fx, condition = 'NM', graded = null, event = '' }) {
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
      kind: card.kind || 'card',
      lang: card.lang || 'en',
      pid: card.pid || null,
      condition: card.kind === 'sealed' ? null : condition,
      graded,
      buy: { price, currency, fx, date, source: source || '', event: event || '' },
      costUSD: toUSD(price, currency, fx),
      costCLP: toCLP(price, currency, fx),
      marketAtBuy: marketUSD(card.id, variant) == null ? null : marketUSD(card.id, variant) * (card.kind === 'sealed' ? 1 : condFactor(condition)),
      purpose: purpose || (card.kind === 'sealed' ? 'reventa' : defaultPurpose(card.rarity)),
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

// `price` is what you actually receive (net of fees). `gross`/`feePct` are kept for reference.
export function recordExit(item, { kind, price, currency, date, fx, tradeId, gross, feePct = 0, fixedCLP = 0, channel = '', event = '' }) {
  fx = fx || state.fx.usdclp;
  item.status = kind === 'trade' ? 'traded' : 'sold';
  item.exit = { kind, price, gross: gross ?? price, feePct, fixedCLP, channel, event, currency, fx, date, tradeId, usd: toUSD(price, currency, fx), clp: toCLP(price, currency, fx) };
}

// Net amount you receive from a sale through a channel (percentage fee + fixed fee in CLP).
export function netOfChannel(gross, currency, channel, fx = state.fx.usdclp) {
  const pct = channel?.feePct || 0;
  const fixed = channel?.fixedCLP || 0;
  const net = gross * (1 - pct / 100) - (currency === 'CLP' ? fixed : fixed / fx);
  return Math.max(0, net);
}

// ───────────────────────── Expenses (entrada a la feria, transporte, fundas, envíos…)

export const EXPENSE_CATS = ['Entrada feria', 'Transporte', 'Insumos (fundas, toploaders)', 'Envíos', 'Comida', 'Otro'];
export function addExpense({ date, amountCLP, cat, note = '', event = '' }) {
  state.expenses.push({ id: uid(), date, amountCLP, cat, note, event, addedAt: Date.now() });
  save();
}
export function removeExpense(id) {
  state.expenses = state.expenses.filter((e) => e.id !== id);
  save();
}

export function removeItem(id) {
  state.items = state.items.filter((it) => it.id !== id);
  snapshot();
  save();
}

// ───────────────────────── Portfolio

export function summary() {
  const fx = state.fx.usdclp;
  // Copies without a market price count at their cost in BOTH currencies (no phantom FX gain).
  let costUSD = 0, costCLP = 0, valueUSD = 0, valueCLP = 0, n = 0, missing = 0;
  for (const it of state.items) {
    if (it.status !== 'held') continue;
    n++;
    costUSD += it.costUSD;
    costCLP += it.costCLP;
    const v = itemValueUSD(it);
    if (v == null) {
      missing++;
      valueUSD += it.costUSD;
      valueCLP += it.costCLP;
    } else {
      valueUSD += v;
      valueCLP += v * fx;
    }
  }
  let realUSD = 0, realCLP = 0, exits = 0, trades = 0;
  for (const it of state.items) {
    if (it.status === 'held' || !it.exit) continue;
    if (it.exit.kind === 'trade') trades++;
    else exits++;
    realUSD += it.exit.usd - it.costUSD;
    realCLP += it.exit.clp - it.costCLP;
  }
  const expensesCLP = state.expenses.reduce((a, e) => a + (e.amountCLP || 0), 0);
  return {
    n, missing, exits, trades, costUSD, costCLP, valueUSD, valueCLP, realUSD, realCLP,
    expensesCLP,
    realNetCLP: realCLP - expensesCLP,
    realNetUSD: realUSD - expensesCLP / fx,
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
  const row = { d: localDate(), cu: s.costUSD, cc: s.costCLP, v: s.valueUSD, vc: s.valueCLP, fx: state.fx.usdclp };
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
  const fee = feeNow() / 100;
  const today = localDate();
  return held()
    .filter((it) => includeKeep || it.purpose !== 'coleccion')
    .map((it) => {
      const v = itemValueUSD(it);
      if (v == null) return null;
      const net = netEstimateUSD(v);
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
      // Lowest asking price that still leaves +10% over cost after the channel's fees; never under
      // the cheapest listing for a copy in the same condition (graded copies have no listing).
      const lowSame = it.graded ? 0 : (p?.low || 0) * (isSealed(it) ? 1 : condFactor(it.condition));
      const floorCLP = Math.ceil(Math.max((it.costCLP * 1.1 + fixedNow()) / (1 - fee || 1), lowSame * fx) / 500) * 500;
      return { it, v, gainUSD, gainCLP, gainPct, profitable: gainDisp > 0, mom, days, score, reasons, listCLP, floorCLP };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// ───────────────────────── Report (por mes, por feria/evento y por canal)

export function report() {
  const months = new Map(), events = new Map(), channels = new Map();
  const bucket = (map, key) => {
    if (!map.has(key)) map.set(key, { key, buys: 0, buyN: 0, sales: 0, saleN: 0, tradeN: 0, profit: 0, expenses: 0 });
    return map.get(key);
  };
  // Only real purchases count as "Compras" (not cards received in trades or loaded without buying).
  const bought = (it) => it.buy.source !== 'Intercambio' && it.buy.source !== 'Carga inicial';
  for (const it of state.items) {
    const m = (it.buy.date || '').slice(0, 7);
    if (m && bought(it)) {
      const b = bucket(months, m);
      b.buys += it.costCLP;
      b.buyN++;
    }
    if (it.buy.event && bought(it)) {
      const e = bucket(events, it.buy.event);
      e.buys += it.costCLP;
      e.buyN++;
    }
    if (it.status !== 'held' && it.exit) {
      const profit = it.exit.clp - it.costCLP;
      const targets = [bucket(months, (it.exit.date || '').slice(0, 7))];
      if (it.exit.event) targets.push(bucket(events, it.exit.event));
      if (it.exit.kind === 'sale') targets.push(bucket(channels, it.exit.channel || 'sin canal'));
      for (const b of targets) {
        if (it.exit.kind === 'trade') b.tradeN++;
        else {
          b.sales += it.exit.clp;
          b.saleN++;
        }
        b.profit += profit; // realized either way
      }
    }
  }
  for (const e of state.expenses) {
    bucket(months, (e.date || '').slice(0, 7)).expenses += e.amountCLP;
    if (e.event) bucket(events, e.event).expenses += e.amountCLP;
  }
  const fin = (m) => [...m.values()].map((b) => ({ ...b, net: b.profit - b.expenses }));
  return {
    months: fin(months).sort((a, b) => b.key.localeCompare(a.key)),
    events: fin(events).sort((a, b) => b.buys + b.sales - (a.buys + a.sales)),
    channels: fin(channels).sort((a, b) => b.sales - a.sales),
  };
}

// The feria you're at: proposed again for the rest of the same day.
export function rememberEvent(name) {
  if (!name) return;
  state.settings.lastEvent = { name, date: localDate() };
}
export const todayEvent = () => (state.settings.lastEvent?.date === localDate() ? state.settings.lastEvent.name : '');

// Sale list: the market price is suggested; only a price you changed is remembered on the copy.
export function suggestedAskCLP(it) {
  const v = itemValueUSD(it);
  return v == null ? null : Math.round((v * state.fx.usdclp) / 500) * 500;
}
export function setAsk(it, p) {
  if (p > 0 && p !== suggestedAskCLP(it)) it.askCLP = p;
  else delete it.askCLP;
}

export const knownEvents = () =>
  [...new Set([...state.items.flatMap((it) => [it.buy.event, it.exit?.event]), ...state.expenses.map((e) => e.event)].filter(Boolean))].slice(-30).reverse();

// ───────────────────────── Lot (lote en la feria)

// items: [{ marketUSD }] already adjusted for condition. Returns totals and the max offer that keeps
// the target margin after the default channel's fee.
export function lotTotals(items, askAmount, askCur) {
  const fx = state.fx.usdclp;
  const ch = channelById(state.settings.defaultChannel);
  const marketUSDv = items.reduce((a, x) => a + (x.marketUSD || 0), 0);
  const netUSD = marketUSDv * (1 - (ch?.feePct || 0) / 100) - ((ch?.fixedCLP || 0) * items.length) / fx;
  const maxUSD = Math.max(0, netUSD / (1 + state.settings.targetMargin / 100));
  const askUSD = askAmount ? toUSD(askAmount, askCur) : null;
  return {
    marketUSD: marketUSDv,
    marketCLP: marketUSDv * fx,
    maxUSD,
    maxCLP: Math.floor((maxUSD * fx) / 500) * 500,
    askUSD,
    verdict: askUSD ? dealVerdict(askUSD, marketUSDv) : null,
    profitUSD: askUSD != null ? netUSD - askUSD : null,
    priced: items.filter((x) => x.marketUSD).length,
  };
}

// Split what you paid for a lot across its cards, proportional to their market value.
export function splitLot(totalPaid, marketValues) {
  const sum = marketValues.reduce((a, b) => a + (b || 0), 0);
  return marketValues.map((v) => (sum ? (totalPaid * (v || 0)) / sum : totalPaid / (marketValues.length || 1)));
}

// ───────────────────────── Alerts (shown in Inicio + app icon badge)

export function computeAlerts() {
  const fx = state.fx.usdclp;
  const out = [];
  const pct = state.settings.alertPct / 100;
  for (const w of Object.values(state.wishlist)) {
    if (!w.targetCLP) continue;
    const m = minMarketUSD(w.id);
    if (m != null && m * fx <= w.targetCLP) out.push({ key: `wish:${w.id}`, kind: 'wish', cardId: w.id, name: w.name, image: w.image, text: `Bajó a ${fmtCLP(m * fx)} (tu meta: ${fmtCLP(w.targetCLP)})` });
  }
  for (const it of held()) {
    const hist = state.priceHist[`${it.cardId}|${it.variant}`];
    if (hist?.length >= 2) {
      const last = hist[hist.length - 1];
      const from = new Date(new Date(last[0] + 'T12:00:00').getTime() - 7 * 86400000).toLocaleDateString('sv-SE');
      const ref = [...hist].reverse().find(([d]) => d <= from) || hist[0];
      if (ref !== last && ref[1]) {
        const ch = last[1] / ref[1] - 1;
        if (Math.abs(ch) >= pct) out.push({ key: `move:${it.cardId}|${it.variant}:${ch > 0 ? 'up' : 'down'}`, kind: ch > 0 ? 'up' : 'down', cardId: it.cardId, itemId: it.id, name: it.name, image: it.image, change: ch, text: `${ch > 0 ? 'Subió' : 'Bajó'} ${Math.round(Math.abs(ch) * 100)}% desde el ${ref[0].slice(8, 10)}-${ref[0].slice(5, 7)}` });
      }
    }
    if (it.purpose !== 'coleccion') {
      const v = itemValueUSD(it);
      if (v != null && it.costCLP > 0) {
        const g = (netEstimateUSD(v) * fx) / it.costCLP - 1;
        if (g >= state.settings.targetMargin / 100) out.push({ key: `sell:${it.id}`, kind: 'sell', cardId: it.cardId, itemId: it.id, name: it.name, image: it.image, text: `Ya rinde ${Math.round(g * 100)}% sobre tu compra: buen momento para vender` });
      }
    }
  }
  // Several copies of the same card → one alert. A dismissed alert stays hidden for 7 days.
  const now = Date.now();
  const seen = new Set();
  return out.filter((a) => {
    const k = a.kind === 'sell' ? `sell:${a.cardId}` : a.key;
    if (seen.has(k)) return false;
    seen.add(k);
    return !(state.alertsSeen[a.key] && now - state.alertsSeen[a.key] < 7 * 86400000);
  });
}

export function dismissAlert(key) {
  state.alertsSeen[key] = Date.now();
  for (const [k, t] of Object.entries(state.alertsSeen)) if (Date.now() - t > 30 * 86400000) delete state.alertsSeen[k];
  save();
}

// ───────────────────────── Trades

// giveUSD: market value of each card you hand over. getUSD: market value of each card you get.
// paidUSD / recvUSD: cash on top. Returns proceeds per given card and cost basis per received card.
// Invariant: Σproceeds − Σbasis = recvUSD − paidUSD (the cash is all that changes hands besides cards).
export function planTrade(giveUSD, getUSD, paidUSD = 0, recvUSD = 0) {
  const G = giveUSD.reduce((a, b) => a + b, 0);
  const C = getUSD.reduce((a, b) => a + b, 0);
  let proceeds, basis;
  if (!getUSD.length) {
    proceeds = recvUSD - paidUSD; // cards for cash = a sale
    basis = 0;
  } else {
    basis = G + paidUSD - recvUSD;
    proceeds = G + Math.max(0, -basis); // cash beyond the cards' value is extra proceeds
    basis = Math.max(0, basis);
  }
  const split = (total, parts, sum) => parts.map((v) => (sum ? (total * v) / sum : total / (parts.length || 1)));
  return { proceeds: split(proceeds, giveUSD, G), basis: split(basis, getUSD, C) };
}

// ───────────────────────── Deals

export function dealVerdict(askUSD, marketUSDv) {
  const s = state.settings;
  if (!marketUSDv || !askUSD) return null;
  const off = 1 - askUSD / marketUSDv;
  const profitUSD = netEstimateUSD(marketUSDv) - askUSD;
  let label, cls;
  if (off >= s.dealPct / 100) (label = 'Ganga'), (cls = 'deal-hot');
  else if (off >= 0.1) (label = 'Buen precio'), (cls = 'deal-good');
  else if (off >= -0.05) (label = 'Precio justo'), (cls = 'deal-fair');
  else (label = 'Caro'), (cls = 'deal-bad');
  return { off, profitUSD, label, cls, belowRange: marketUSDv < s.minUSD };
}

export const isKeeperRarity = (r) => rarityInfo(r).tier >= 6;
