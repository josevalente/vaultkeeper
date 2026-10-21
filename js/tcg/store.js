// Storage + money logic of one non-Pokémon vault (Magic or Yu-Gi-Oh). Its cards live under their
// own key ('vaultkeeper:mtg:v1', 'vaultkeeper:ygo:v1') and never touch the Pokémon vault.
// Settings (currency, margin, sale channels, Claude key) are shared: they are READ from the
// Pokémon vault's settings and never written from here.

import { localDate, uid, roundCLP, daysBetween, clamp, norm, fmtCLP } from '../util.js';

export const CONDITIONS = {
  NM: { label: 'Near Mint', f: 1 },
  LP: { label: 'Lightly Played', f: 0.85 },
  MP: { label: 'Moderately Played', f: 0.7 },
  HP: { label: 'Heavily Played', f: 0.5 },
  DMG: { label: 'Dañada', f: 0.35 },
};
export const condFactor = (c) => CONDITIONS[c]?.f ?? 1;
export const GRADERS = ['PSA', 'BGS', 'CGC', 'TAG', 'ACE', 'Otra'];

const SHARED_DEFAULTS = { display: 'CLP', targetMargin: 30, dealPct: 25, channels: [{ id: 'feria', name: 'En la feria', feePct: 0, fixedCLP: 0 }], defaultChannel: 'feria', claudeKey: '', claudeModel: 'claude-opus-5-5', alertPct: 10 };

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
  state = { ...DEFAULTS(), ...(s || {}) };
  return state;
}
const DEFAULTS = () => ({ version: 1, items: [], prices: {}, priceHist: {}, history: [], wishlist: {}, alertsSeen: {}, sale: {}, lastEvent: null, lastBackup: 0, fx: null, lastRefresh: 0 });

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

// Every price seen also adds today's point to this phone's own history (for "subió / bajó X%").
export function setPrint(p) {
  state.prices[p.id] = { at: Date.now(), f: Object.fromEntries(p.finishes.map((x) => [x.key, x.usd])) };
  const d = localDate();
  for (const f of p.finishes) {
    if (f.usd == null) continue;
    const h = (state.priceHist[`${p.id}|${f.key}`] ||= []);
    if (h[h.length - 1]?.[0] === d) h[h.length - 1][1] = f.usd;
    else h.push([d, f.usd]);
    if (h.length > 120) h.splice(0, h.length - 120);
  }
}
export const priceOf = (printId, finish) => state.prices[printId]?.f?.[finish] ?? null;
// Cheapest priced finish (a wishlist target: any version will do).
export function minPriceUSD(printId) {
  const v = Object.values(state.prices[printId]?.f || {}).filter((x) => x != null);
  return v.length ? Math.min(...v) : null;
}

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

// The same printing, however it was found. Yu-Gi-Oh ids are "<card id>|<set code>|<rarity>", and
// YGOPRODeck gives one printing different card ids (alternate artworks): the set code + rarity
// ("LOB-EN005|ULTRA RARE") is what identifies it. Magic ids (Scryfall) are already unique.
export function pkey(id) {
  id = String(id || '');
  if (game?.id !== 'ygo') return id;
  const rest = id.slice(id.indexOf('|') + 1);
  return rest.replace(/\|/g, '') ? rest.toUpperCase() : id;
}
// Copies you hold of each printing: Map(pkey → n).
export function heldByPrint() {
  const m = new Map();
  for (const it of held()) m.set(pkey(it.printId), (m.get(pkey(it.printId)) || 0) + 1);
  return m;
}
export const ownedOf = (id) => heldByPrint().get(pkey(id)) || 0;

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

export function addItems({ print, finish, price, currency, fx: rate, date, qty = 1, condition = 'NM', graded = null, purpose = 'reventa', event = '', notes = '' }) {
  rate = rate || usdclp();
  event = canonicalEvent(event);
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
      graded,
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
  for (const k of Object.keys(state.wishlist)) if (pkey(k) === pkey(print.id)) delete state.wishlist[k]; // bought: no longer looking for it
  rememberEvent(event);
  snapshot();
  save();
  return created;
}

// Fixes a purchase already recorded (price, rate, date, condition, event, note).
export function editBuy(it, { price, currency, fx: rate, date, condition, graded, event, notes }) {
  it.buy = { ...it.buy, price, currency, fx: rate, date, event: canonicalEvent(event) };
  it.costUSD = toUSD(price, currency, rate);
  it.costCLP = toCLP(price, currency, rate);
  it.condition = condition;
  it.graded = graded;
  it.notes = notes;
  snapshot();
  save();
}

export function recordSale(it, { gross, currency, fx: rate, date, channel, event = '' }) {
  rate = rate || usdclp();
  event = canonicalEvent(event);
  const ch = channelById(channel) || { id: '', feePct: 0, fixedCLP: 0 };
  const net = Math.max(0, gross * (1 - (ch.feePct || 0) / 100) - (currency === 'CLP' ? ch.fixedCLP || 0 : (ch.fixedCLP || 0) / rate));
  it.status = 'sold';
  it.exit = { kind: 'sale', gross, price: net, currency, fx: rate, date: date || localDate(), channel: ch.id, feePct: ch.feePct || 0, fixedCLP: ch.fixedCLP || 0, event, usd: toUSD(net, currency, rate), clp: toCLP(net, currency, rate) };
  delete it.askCLP;
  rememberEvent(event);
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

export function sellRanking({ includeKeep = false } = {}) {
  const rate = usdclp();
  const ch = defaultChannel();
  const fee = (ch.feePct || 0) / 100;
  return held()
    .filter((it) => includeKeep || it.purpose !== 'coleccion')
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
  pruneHist();
  const ids = [...new Set([...held().map((it) => it.printId), ...Object.keys(state.wishlist)])].filter((id) => force || !state.prices[id] || Date.now() - state.prices[id].at > 6 * 3600000);
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
  state = { ...DEFAULTS(), ...rest };
  save();
}
export const backupDue = () => state.items.length > 0 && Date.now() - (state.lastBackup || 0) > 7 * 86400000;
export function backedUp() {
  state.lastBackup = Date.now();
  save({ silent: true });
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

// Price history and prices only for what you hold or want (cards you just looked at fade out).
function pruneHist() {
  const keep = new Set([...held().map((it) => it.printId), ...Object.keys(state.wishlist)]);
  for (const k of Object.keys(state.priceHist)) if (!keep.has(k.slice(0, k.lastIndexOf('|')))) delete state.priceHist[k];
  for (const [id, p] of Object.entries(state.prices)) if (!keep.has(id) && Date.now() - p.at > 30 * 86400000) delete state.prices[id];
}

// ───────────────────────── wishlist

const wishKeyOf = (id) => Object.keys(state.wishlist).find((k) => pkey(k) === pkey(id));
export const inWish = (id) => !!wishKeyOf(id);
export function toggleWish(p) {
  const k = wishKeyOf(p.id);
  if (k) delete state.wishlist[k];
  else {
    setPrint(p);
    state.wishlist[p.id] = { id: p.id, name: p.name, setName: p.setName, setCode: p.setCode, number: p.number, rarity: p.rarity, image: p.image, imageLarge: p.imageLarge, link: p.link || '', finishes: p.finishes.map(({ key, label }) => ({ key, label })), addedAt: Date.now() };
  }
  save({ silent: true });
  return !!state.wishlist[p.id];
}
export function setWishTarget(id, clp) {
  const w = state.wishlist[wishKeyOf(id)];
  if (!w) return;
  w.targetCLP = clp > 0 ? clp : null;
  save({ silent: true });
}
// A wished print with its last known prices, ready for the card sheet.
export const wishPrint = (w) => ({ ...w, finishes: w.finishes.map((f) => ({ ...f, usd: priceOf(w.id, f.key) })) });

// ───────────────────────── Novedades (Inicio): wishlist under its target, big price moves, ready to sell

export function computeAlerts() {
  const rate = usdclp();
  const sx = settings();
  const pct = (sx.alertPct ?? 10) / 100;
  const out = [];
  for (const w of Object.values(state.wishlist)) {
    if (!w.targetCLP) continue;
    const m = minPriceUSD(w.id);
    if (m != null && m * rate <= w.targetCLP) out.push({ key: `wish:${w.id}`, kind: 'wish', printId: w.id, name: w.name, image: w.image, text: `Bajó a ${fmtCLP(m * rate)} (tu meta: ${fmtCLP(w.targetCLP)})` });
  }
  for (const it of held()) {
    const hist = state.priceHist[`${it.printId}|${it.finish}`];
    if (!it.graded && hist?.length >= 2) {
      const last = hist[hist.length - 1];
      const from = new Date(new Date(last[0] + 'T12:00:00').getTime() - 7 * 86400000).toLocaleDateString('sv-SE');
      const ref = [...hist].reverse().find(([d]) => d <= from) || hist[0];
      if (ref !== last && ref[1]) {
        const ch = last[1] / ref[1] - 1;
        if (Math.abs(ch) >= pct) out.push({ key: `move:${it.printId}|${it.finish}:${ch > 0 ? 'up' : 'down'}`, kind: ch > 0 ? 'up' : 'down', printId: it.printId, itemId: it.id, name: it.name, image: it.image, text: `${ch > 0 ? 'Subió' : 'Bajó'} ${Math.round(Math.abs(ch) * 100)}% desde el ${ref[0].slice(8, 10)}-${ref[0].slice(5, 7)}` });
      }
    }
    if (it.purpose !== 'coleccion') {
      const g = itemGain(it, { net: true })?.pct;
      if (g != null && g >= sx.targetMargin / 100) out.push({ key: `sell:${it.id}`, kind: 'sell', printId: it.printId, itemId: it.id, name: it.name, image: it.image, text: `Ya rinde ${Math.round(g * 100)}% sobre tu compra: buen momento para vender` });
    }
  }
  // Several copies of the same card → one alert. A dismissed alert stays hidden for 7 days.
  const now = Date.now();
  const seen = new Set();
  return out.filter((a) => {
    const k = a.kind === 'sell' ? `sell:${a.printId}` : a.key;
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

// ───────────────────────── sale list: the market price is suggested; a price you change stays on the copy

export function suggestedAskCLP(it) {
  const v = itemValueUSD(it);
  return v == null ? null : roundCLP(v * usdclp());
}
export function setAsk(it, p) {
  if (p > 0 && p !== suggestedAskCLP(it)) it.askCLP = p;
  else delete it.askCLP;
}

// ───────────────────────── events (ferias): free text, the same however it's typed

export const eventKey = (name) => norm(name).replace(/\s+/g, ' ').trim();
const eventRefs = () => state.items.flatMap((it) => [it.buy, it.exit].filter((x) => x?.event));
// Most recent first, one spelling per event.
export function knownEvents() {
  const seen = new Map();
  for (const r of eventRefs()) {
    const k = eventKey(r.event);
    seen.delete(k);
    seen.set(k, r.event);
  }
  return [...seen.values()].slice(-30).reverse();
}
// The spelling already in use, so "feria persa" doesn't start a second feria.
export function canonicalEvent(name) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const k = eventKey(name);
  return knownEvents().find((e) => eventKey(e) === k) || name;
}
// The feria you're at: proposed again for the rest of the same day.
export function rememberEvent(name) {
  if (name) state.lastEvent = { name, date: localDate() };
}
export const todayEvent = () => (state.lastEvent?.date === localDate() ? state.lastEvent.name : '');

// Compras, ventas and result of each event (result = what its sales left against their cost).
export function eventReport() {
  const map = new Map();
  const ev = (name, date) => {
    const k = eventKey(name);
    if (!map.has(k)) map.set(k, { key: k, names: {}, buys: 0, buyN: 0, sales: 0, saleN: 0, net: 0, from: '', to: '' });
    const b = map.get(k);
    b.names[name] = (b.names[name] || 0) + 1;
    if (date && (!b.from || date < b.from)) b.from = date;
    if (date && date > b.to) b.to = date;
    return b;
  };
  for (const it of state.items) {
    if (it.buy.event) {
      const b = ev(it.buy.event, it.buy.date);
      b.buys += it.costCLP;
      b.buyN++;
    }
    if (it.status !== 'held' && it.exit?.event) {
      const b = ev(it.exit.event, it.exit.date);
      b.sales += it.exit.clp;
      b.saleN++;
      b.net += it.exit.clp - it.costCLP;
    }
  }
  return [...map.values()]
    .map((b) => ({ ...b, name: Object.entries(b.names).sort((x, y) => y[1] - x[1])[0][0] }))
    .sort((a, b) => (b.to || '').localeCompare(a.to || '') || b.buys + b.sales - (a.buys + a.sales));
}
// Renames an event everywhere; another event's name merges both.
export function renameEvent(key, to) {
  to = String(to || '').trim().replace(/\s+/g, ' ');
  if (!to) return 0;
  const target = eventKey(to) === key ? to : canonicalEvent(to);
  let n = 0;
  for (const r of eventRefs()) if (eventKey(r.event) === key) (r.event = target), n++;
  if (state.lastEvent && eventKey(state.lastEvent.name) === key) state.lastEvent.name = target;
  save();
  return n;
}
// Removes an event from every purchase and sale (the records stay).
export function removeEvent(key) {
  let n = 0;
  for (const r of eventRefs()) if (eventKey(r.event) === key) (r.event = ''), n++;
  if (state.lastEvent && eventKey(state.lastEvent.name) === key) state.lastEvent = null;
  save();
  return n;
}
