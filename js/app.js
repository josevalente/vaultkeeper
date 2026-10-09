// VaultKeeper — app shell: router, tab bar, price refresh, offline support.

import { $, $$, fmtCLP, pool, toast, localDate } from './util.js';
import { state, save, onChange, held, setPrice, pushHist, marketUSD, snapshot, actions, repairItems, computeAlerts } from './store.js';
import { getCard } from './api.js';
import { refreshFx } from './fx.js';
import { scanFlow, openCardSheet } from './ui.js';
import { renderHome } from './views/home.js';
import { renderCollection } from './views/collection.js';
import { renderChecklist } from './views/checklist.js';
import { renderTrade } from './views/trade.js';
import { renderSettings } from './views/settings.js';
import { renderLote } from './views/lote.js';
import { renderReporte } from './views/reporte.js';

const ROUTES = {
  inicio: renderHome,
  coleccion: renderCollection,
  faltantes: renderChecklist,
  intercambio: renderTrade,
  ajustes: renderSettings,
  lote: renderLote,
  reporte: renderReporte,
};

const view = $('#view');
let current = null;

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?')[0];
  const fn = ROUTES[name] || renderHome;
  const changed = current !== name;
  current = ROUTES[name] ? name : 'inicio';
  $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.route === current));
  $('.gear').classList.toggle('on', current === 'ajustes');
  view.dataset.view = current;
  view._resize = null;
  fn(view);
  if (changed) {
    window.scrollTo({ top: 0 });
    $('#sheets').innerHTML = '';
    document.body.classList.remove('has-sheet');
  }
  renderFx();
}

function renderFx() {
  $('.fxchip').textContent = `US$1 = ${fmtCLP(state.fx.usdclp)}`;
}

// Re-render the visible view whenever data changes (sheets live outside #view).
onChange(() => {
  const y = window.scrollY;
  route();
  window.scrollTo({ top: y });
});

// ───────────────────────── prices

let refreshing = false;

const SIX_H = 6 * 3600000;

function setStatus(msg, progress) {
  const bar = $('.statusbar');
  bar.hidden = !msg;
  $('.statusbar span').textContent = msg || '';
  $('.statusbar i').style.width = `${Math.round((progress || 0) * 100)}%`;
}

async function refreshPrices({ force = false } = {}) {
  if (refreshing) return;
  if (!navigator.onLine) {
    if (force) toast('Sin conexión: usando los últimos precios guardados');
    return;
  }
  const ids = [...new Set([...held().map((i) => i.cardId), ...Object.keys(state.wishlist)])];
  const stale = ids.filter((id) => force || !state.prices[id] || Date.now() - state.prices[id].at > SIX_H);
  refreshing = true;
  try {
    await refreshFx();
    if (stale.length) {
      let done = 0;
      setStatus(`Actualizando precios 0/${stale.length}`, 0);
      await pool(stale, 4, async (id) => {
        const { card, prices } = await getCard(id, { fresh: true });
        setPrice(id, prices);
        repairItems(card, prices);
        done++;
        setStatus(`Actualizando precios ${done}/${stale.length}`, done / stale.length);
      });
      held().forEach((it) => pushHist(`${it.cardId}|${it.variant}`, marketUSD(it.cardId, it.variant)));
      state.lastRefresh = Date.now();
    }
    const last = state.history[state.history.length - 1];
    if (stale.length || !last || last.d !== localDate()) {
      snapshot();
      save();
    }
    if (force) toast('Precios actualizados', 'ok');
    // App icon badge = pending alerts (iOS 16.4+ when installed on the home screen).
    navigator.setAppBadge?.(computeAlerts().length).catch?.(() => {});
  } catch (e) {
    console.warn(e);
    toast('No pude actualizar todos los precios', 'err');
  } finally {
    refreshing = false;
    setStatus('');
  }
}
actions.refreshPrices = refreshPrices;

// ───────────────────────── boot

$('.scan-fab').onclick = () => scanFlow({ title: 'Escanear carta', onPick: (c) => openCardSheet(c.id) });

window.addEventListener('hashchange', route);
let rz;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => view._resize?.(), 150);
});
window.addEventListener('online', () => {
  document.body.classList.remove('offline');
  refreshPrices();
});
window.addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPrices();
});

route();
refreshPrices();
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
