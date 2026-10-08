// USD→CLP exchange rate. Online: mindicador.cl (dólar observado, Banco Central)
// with open.er-api.com as backup. Offline: the last rate saved on the phone.

import { fetchJSON } from './util.js';
import { state, save } from './store.js';

const MAX_AGE = 6 * 3600000;

export async function refreshFx({ force = false } = {}) {
  const fx = state.fx;
  if (!force && fx.at && Date.now() - fx.at < MAX_AGE) return fx;
  if (!navigator.onLine) return fx;
  let usdclp = null, src = null, eurusd = null;
  try {
    const m = await fetchJSON('https://mindicador.cl/api/dolar', { timeout: 6000, retries: 0 });
    const v = m?.serie?.[0]?.valor;
    if (v > 100) (usdclp = v), (src = 'mindicador.cl · dólar observado');
  } catch {
    /* try the next source */
  }
  try {
    const e = await fetchJSON('https://open.er-api.com/v6/latest/USD', { timeout: 6000, retries: 0 });
    if (e?.rates?.EUR) eurusd = 1 / e.rates.EUR;
    if (!usdclp && e?.rates?.CLP) (usdclp = e.rates.CLP), (src = 'open.er-api.com');
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
