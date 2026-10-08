// USD→CLP exchange rate. Online: mindicador.cl (dólar observado, Banco Central)
// with open.er-api.com as backup. Offline: the last rate saved on the phone.

import { fetchJSON, localDate } from './util.js';
import { state, save } from './store.js';

const MAX_AGE = 6 * 3600000;

export async function refreshFx({ force = false } = {}) {
  const fx = state.fx;
  if (!force && fx.manual) return fx; // a rate the user fixed stays until they press "Actualizar"
  if (!force && fx.at && Date.now() - fx.at < MAX_AGE) return fx;
  if (!navigator.onLine) return fx;
  let usdclp = null, src = null, eurusd = null;
  try {
    const m = await fetchJSON('https://mindicador.cl/api/dolar', { timeout: 6000, retries: 0 });
    const v = m?.serie?.[0]?.valor;
    if (v > 100 && v < 5000) (usdclp = v), (src = 'mindicador.cl · dólar observado');
  } catch {
    /* try the next source */
  }
  try {
    const e = await fetchJSON('https://open.er-api.com/v6/latest/USD', { timeout: 6000, retries: 0 });
    if (e?.rates?.EUR) eurusd = 1 / e.rates.EUR;
    if (!usdclp && e?.rates?.CLP > 100 && e.rates.CLP < 5000) (usdclp = e.rates.CLP), (src = 'open.er-api.com');
  } catch {
    /* keep the saved rate */
  }
  if (usdclp) {
    state.fx = { ...fx, usdclp, eurusd: eurusd || fx.eurusd, at: Date.now(), src, manual: false };
    save();
  }
  return state.fx;
}

export function setManualFx(value) {
  state.fx = { ...state.fx, usdclp: value, at: Date.now(), src: 'manual', manual: true };
  save();
}

// Rate for a past date (purchases/sales registered later).
// 1) mindicador.cl dólar observado (walks back over weekends/holidays) — official, but slow at times;
// 2) currency-api (jsdelivr CDN, daily market rate) if mindicador doesn't answer within ~7 s.
// Cached per date; null only if both fail (the form then shows today's rate with a warning).
export async function fxOn(isoDate) {
  if (!isoDate || isoDate >= localDate()) return null;
  state.fxHist ||= {};
  const hit = state.fxHist[isoDate];
  if (hit) return { usdclp: hit.v, src: hit.src || `dólar observado ${hit.d}` };
  if (!navigator.onLine) return null;
  const d = new Date(isoDate + 'T12:00:00');
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(d.getTime() - i * 86400000);
    return `${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}`;
  });
  const official = Promise.all(
    days.map((dd) =>
      fetchJSON(`https://mindicador.cl/api/dolar/${dd}`, { timeout: 7000, retries: 0 })
        .then((r) => r?.serie?.[0]?.valor)
        .catch(() => null)
    )
  ).then((vals) => {
    const i = vals.findIndex((v) => v > 100 && v < 5000);
    return i >= 0 ? { v: vals[i], src: `dólar observado ${days[i]}` } : null;
  });
  const market = fetchJSON(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${isoDate}/v1/currencies/usd.min.json`, { timeout: 7000, retries: 1 })
    .then((r) => (r?.usd?.clp > 100 && r.usd.clp < 5000 ? { v: r.usd.clp, src: `mercado ${isoDate}` } : null))
    .catch(() => null);
  const got = (await official) || (await market);
  if (!got) return null;
  state.fxHist[isoDate] = got;
  save({ silent: true });
  return { usdclp: got.v, src: got.src };
}
