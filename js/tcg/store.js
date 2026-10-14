// Storage + money logic of one non-Pokémon vault (Magic or Yu-Gi-Oh). Its cards live under their
// own key ('vaultkeeper:mtg:v1', 'vaultkeeper:ygo:v1') and never touch the Pokémon vault.
// Settings (currency, margin, sale channels, Claude key) are shared: they are READ from the
// Pokémon vault's settings and never written from here.

import { localDate, uid, roundCLP, daysBetween, clamp } from '../util.js';

export const CONDITIONS = {
  NM: { label: 'Near Mint', f: 1 },
  LP: { label: 'Lightly Played', f: 0.85 },
  MP: { label: 'Moderately Played', f: 0.7 },
  HP: { label: 'Heavily Played', f: 0.5 },
  DMG: { label: 'Dañada', f: 0.35 },
};
export const condFactor = (c) => CONDITIONS[c]?.f ?? 1;

const SHARED_DEFAULTS = { display: 'CLP', targetMargin: 30, dealPct: 25, channels: [{ id: 'feria', name: 'En la feria', feePct: 0, fixedCLP: 0 }], defaultChannel: 'feria', claudeKey: '', claudeModel: 'claude-opus-5-5' };

let KEY = '';
export let state = null;
export let game = null;

export function openVault(g) {
  game = g;
  KEY = `vaultkeeper:${g.id}:v1`;
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {}
  state = { version: 1, items: [], prices: {}, history: [], fx: null, lastRefresh: 0, ...(s || {}) };
  return state;
}

const subs = new Set();
export const onChange = (fn) => subs.add(fn);
export function save({ silent = false } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    alert('No queda espacio para guardar. Exporta un respaldo de este vault (Más → Respaldar).');
  }
  if (!silent) subs.forEach((f) => f());
}

// Shared settings and exchange rate, read from the Pokémon vault (never written).
function pokemon() {
  try {
    return JSON.parse(localStorage.getItem('vaultkeeper:v1') || 'null');
  } catch {
    return null;
  }
}
export function settings() {
  return { ...SHARED_DEFAULTS, ...(pokemon()?.settings || {}) };
}
// The freshest of this vault's own rate and the Pokémon vault's.
export function fx() {
  const p = pokemon()?.fx;
  const own = state?.fx;
  const best = [p, own].filter((x) => x?.usdclp > 100).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  return best || { usdclp: 950, at: 0, src: 'valor inicial' };
}
export const usdclp = () => fx().usdclp;

export const channelById = (id) => settings().channels.find((c) => c.id === id) || null;
const defaultChannel = () => channelById(settings().defaultChannel) || settings().channels[0] || { feePct: 0, fixedCLP: 0 };

export const toUSD = (amount, cur, rate = usdclp()) => (cur === 'USD' ? amount : amount / rate);
export const toCLP = (amount, cur, rate = usdclp()) => (cur === 'CLP' ? amount : amount * rate);

// ───────────────────────── prices + value

export function setPrint(p) {
  state.prices[p.id] = { at: Date.now(), f: Object.fromEntries(p.finishes.map((x) => [x.key, x.usd])) };
}
export const priceOf = (printId, finish) => state.prices[printId]?.f?.[finish] ?? null;

export function itemValueUSD(it) {
  if (it.graded?.clp) return it.graded.clp / usdclp();
  const m = priceOf(it.printId, it.finish);
  return m == null ? null : m * condFactor(it.condition);
}

// What a sale through the default channel leaves (percentage + fixed fee).
export function netUSD(valueUSD, ch = defaultChannel()) {
  return Math.max(0, valueUSD * (1 - (ch.feePct || 0) / 100) - (ch.fixedCLP || 0) / usdclp());
}
export function maxPayUSD(marketUSD) {
  if (!marketUSD) return null;
  return netUSD(marketUSD) / (1 + settings().targetMargin / 100);
}

// Same rules as the Pokémon vault: a price without profit is never a "Ganga", one over your max is
// at most "Precio justo".
export function dealVerdict(askUSD, marketUSD) {
  if (!askUSD || !marketUSD) return null;
  const off = 1 - askUSD / marketUSD;
  const profitUSD = netUSD(marketUSD) - askUSD;
  const max = maxPayUSD(marketUSD);
  let label, cls;
  if (off >= settings().dealPct / 100) (label = 'Ganga'), (cls = 'deal-hot');
  else if (off >= 0.1) (label = 'Buen precio'), (cls = 'deal-good');
  else if (off >= -0.05) (label = 'Precio justo'), (cls = 'deal-fair');
  else (label = 'Caro'), (cls = 'deal-bad');
  const positive = cls === 'deal-hot' || cls === 'deal-good';
  if (profitUSD <= 0 && positive) (label = 'No deja ganancia'), (cls = 'deal-bad');
  else if (max != null && askUSD > max && positive) (label = 'Precio justo'), (cls = 'deal-fair');
  return { off, profitUSD, label, cls };
}

export const held = () => state.items.filter((it) => it.status === 'held');

export function itemGain(it, { net = false } = {}) {
  const v = itemValueUSD(it);
  if (v == null) return null;
  const val = net ? netUSD(v) : v;
  const usd = val - it.costUSD, clp = val * usdclp() - it.costCLP;
  const inUSD = settings().display === 'USD';
  const base = inUSD ? it.costUSD : it.costCLP;
  return { usd, clp, pct: base > 0 ? (inUSD ? usd : clp) / base : null };
}

// ───────────────────────── items

export function addItems({ print, finish, price, currency, fx: rate, date, qty = 1, condition = 'NM', purpose = 'reventa', event = '', notes = '' }) {
  rate = rate || usdclp();
  const f = print.finishes.find((x) => x.key === finish) || print.finishes[0];
  setPrint(print);
  const created = [];
  for (let i = 0; i < qty; i++) {
    const it = {
      id: uid(),
      printId: print.id,
      cardKey: print.cardKey,
      name: print.name,
      setName: print.setName,
      setCode: print.setCode,
      number: print.number,
      rarity: print.rarity,
      image: print.image,
      imageLarge: print.imageLarge,
      finish: f.key,
      finishLabel: f.label,
      condition,
      purpose,
      notes,
      status: 'held',
      buy: { price, currency, fx: rate, date: date || localDate(), event },
      costUSD: toUSD(price, currency, rate),
      costCLP: toCLP(price, currency, rate),
      addedAt: Date.now(),
    };
    state.items.push(it);
    created.push(it);
  }
  snapshot();
  save();
  return created;
}

export function recordSale(it, { gross, currency, fx: rate, date, channel, event = '' }) {
  rate = rate || usdclp();
  const ch = channelById(channel) || { id: '', feePct: 0, fixedCLP: 0 };
  const net = Math.max(0, gross * (1 - (ch.feePct || 0) / 100) - (currency === 'CLP' ? ch.fixedCLP || 0 : (ch.fixedCLP || 0) / rate));
  it.status = 'sold';
  it.exit = { kind: 'sale', gross, price: net, currency, fx: rate, date: date || localDate(), channel: ch.id, feePct: ch.feePct || 0, fixedCLP: ch.fixedCLP || 0, event, usd: toUSD(net, currency, rate), clp: toCLP(net, currency, rate) };
  snapshot();
  save();
}

export function removeItem(it) {
  state.items = state.items.filter((x) => x.id !== it.id);
  snapshot();
  save();
}

// ───────────────────────── summary, chart, ranking

export function summary() {
  const rate = usdclp();
  let valueUSD = 0, valueCLP = 0, costUSD = 0, costCLP = 0, missing = 0, n = 0;
  for (const it of held()) {
    n++;
    const v = itemValueUSD(it);
    if (v == null) missing++;
    // No price yet: counts at cost in both currencies (no fake gain from the dollar moving).
    valueUSD += v ?? it.costUSD;
    valueCLP += v != null ? v * rate : it.costCLP;
    costUSD += it.costUSD;
    costCLP += it.costCLP;
  }
  const sold = state.items.filter((it) => it.status === 'sold');
  const realCLP = sold.reduce((a, it) => a + it.exit.clp - it.costCLP, 0);
  return { n, valueUSD, valueCLP, costUSD, costCLP, gainCLP: valueCLP - costCLP, gainUSD: valueUSD - costUSD, missing, exits: sold.length, realCLP };
}

// One point per day: cost and value of what you hold.
export function snapshot() {
  const s = summary();
  const d = localDate();
  const pt = { d, cu: s.costUSD, v: s.valueUSD, cc: s.costCLP, vc: s.valueCLP };
  const last = state.history[state.history.length - 1];
  if (last?.d === d) state.history[state.history.length - 1] = pt;
  else state.history.push(pt);
}

export function sellRanking() {
  const rate = usdclp();
  const ch = defaultChannel();
  const fee = (ch.feePct || 0) / 100;
  return held()
    .filter((it) => it.purpose !== 'coleccion')
    .map((it) => {
      const v = itemValueUSD(it);
      if (v == null) return null;
      const G = itemGain(it, { net: true });
      const days = daysBetween(it.buy.date || localDate(), localDate());
      const score = clamp(G.pct ?? 0, -1, 3) * 50 + Math.log10(1 + Math.max(G.clp / rate, 0)) * 22 + Math.min(days / 30, 5) * 2 - (G.clp <= 0 ? 60 : 0);
      const rawList = v * rate;
      const rawFloor = (it.costCLP * 1.1 + (ch.fixedCLP || 0)) / (1 - fee || 1);
      const floorCLP = roundCLP(rawFloor, 'ceil');
      const underFloor = rawList < rawFloor;
      const listCLP = underFloor ? roundCLP(rawList) : Math.max(roundCLP(rawList), floorCLP);
      return { it, v, G, score, listCLP, floorCLP, underFloor, askCLP: Math.max(listCLP, floorCLP), profitable: G.clp > 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// ───────────────────────── prices refresh (every 6 h) + exchange rate of this vault

export async function refreshPrices({ force = false } = {}) {
  const ids = [...new Set(held().map((it) => it.printId))].filter((id) => force || !state.prices[id] || Date.now() - state.prices[id].at > 6 * 3600000);
  if (!ids.length) return { done: 0, failed: 0 };
  let got = {};
  try {
    got = await game.refresh(ids);
  } catch (e) {
    console.warn(e);
  }
  for (const p of Object.values(got)) if (ids.includes(p.id)) setPrint(p);
  const failed = ids.filter((id) => !got[id]).length;
  if (failed < ids.length) state.lastRefresh = Date.now();
  snapshot();
  save();
  return { done: ids.length - failed, failed };
}

export async function refreshFx() {
  if (Date.now() - (fx().at || 0) < 3 * 3600000) return;
  try {
    const r = await fetch('https://mindicador.cl/api/dolar', { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
    const v = r?.serie?.[0]?.valor;
    if (v > 100 && v < 5000) state.fx = { usdclp: v, at: Date.now(), src: 'mindicador.cl · dólar observado' };
  } catch {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
      const v = r?.rates?.CLP;
      if (v > 100 && v < 5000) state.fx = { usdclp: v, at: Date.now(), src: 'open.er-api.com' };
    } catch {}
  }
  save({ silent: true });
}

// Backup of this vault only (the API key is never included: settings aren't stored here).
export const exportVault = () => JSON.stringify({ game: game.id, ...state, exportedAt: new Date().toISOString() }, null, 1);
export function importVault(data) {
  if (data.game && data.game !== game.id) throw new Error(`Ese respaldo es del vault ${data.game}, no de ${game.short}`);
  const { game: _g, exportedAt, ...rest } = data;
  state = { version: 1, items: [], prices: {}, history: [], fx: null, lastRefresh: 0, ...rest };
  save();
}


// Dólar observado of a past date (purchases/sales with an earlier date), cached in this vault.
export async function fxOn(iso) {
  if (!iso || iso >= localDate()) return null;
  state.fxHist ||= {};
  if (state.fxHist[iso]) return state.fxHist[iso];
  if (!navigator.onLine) return null;
  const d = new Date(iso + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const t = new Date(d.getTime() - i * 86400000);
    const dd = `${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}`;
    try {
      const r = await fetch(`https://mindicador.cl/api/dolar/${dd}`, { signal: AbortSignal.timeout(7000) }).then((x) => x.json());
      const v = r?.serie?.[0]?.valor;
      if (v > 100 && v < 5000) {
        state.fxHist[iso] = { usdclp: v, src: `dólar observado ${dd}` };
        save({ silent: true });
        return state.fxHist[iso];
      }
    } catch {}
  }
  return null;
}
