// VaultKeeper — app shell: router, tab bar, price refresh, offline support.

import { $, $$, fmtCLP, pool, toast, localDate } from './util.js';
import { state, save, onChange, held, setPrice, pushHist, snapshot, actions, repairItems, computeAlerts } from './store.js';
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
import { renderMas } from './views/mas.js';

const ROUTES = {
  inicio: renderHome,
  coleccion: renderCollection,
  faltantes: renderChecklist,
  intercambio: renderTrade,
  ajustes: renderSettings,
  lote: renderLote,
  reporte: renderReporte,
  mas: renderMas,
};
// Sections reached from "Más" keep that tab highlighted.
const TAB_OF = { lote: 'mas', intercambio: 'mas', reporte: 'mas', ajustes: 'mas' };

const view = $('#view');
let current = null;

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?')[0];
  const fn = ROUTES[name] || renderHome;
  const changed = current !== name;
  current = ROUTES[name] ? name : 'inicio';
  $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.route === (TAB_OF[current] || current)));
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
      // Always the same source (TCGplayer market or mid) so the history never jumps between sources.
      held().forEach((it) => {
        const p = state.prices[it.cardId]?.tp?.[it.variant];
        pushHist(`${it.cardId}|${it.variant}`, p?.market ?? p?.mid ?? null);
      });
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

// "Volver arriba": appears after scrolling about two screens; sits above the sticky totals
// bar of Lote/Intercambio when there is one.
const toTop = $('.to-top');
function placeToTop() {
  const show = window.scrollY > Math.max(600, innerHeight * 1.5);
  toTop.classList.toggle('show', show);
  toTop.tabIndex = show ? 0 : -1;
  toTop.setAttribute('aria-hidden', String(!show)); // invisible = not there for VoiceOver either
  const bar = show && $('.balance', view);
  const top = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().top : null;
  toTop.style.bottom = top != null && top < innerHeight ? `${innerHeight - top + 10}px` : '';
  if (top != null && top < 160) toTop.classList.remove('show'), toTop.setAttribute('aria-hidden', 'true'); // a tall bar: don't climb onto the header
}
window.addEventListener('scroll', placeToTop, { passive: true });
toTop.onclick = () => {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
};

// iOS 26 bug in installed apps: at launch (sometimes for good) the viewport comes out shorter than
// the screen, so everything pinned to the bottom (tab bar, totals) floats up. iOS clips anything
// drawn below that line, so instead of pushing the bar down we stop adding the home-indicator
// inset that is already outside the page. Only on an installed iPhone/iPad, portrait.
function fixViewportGap() {
  let gap = 0;
  // Not while typing: the keyboard also shrinks the viewport on some iOS versions.
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  const iPhone = /iPhone|iPod/.test(navigator.userAgent);
  if (navigator.standalone && iPhone && !typing && matchMedia('(orientation: portrait)').matches && innerWidth === screen.width) gap = screen.height - innerHeight;
  document.documentElement.style.setProperty('--vgap', `${gap > 0 && gap < 120 ? gap : 0}px`);
}
fixViewportGap();
for (const ev of ['resize', 'orientationchange', 'pageshow']) window.addEventListener(ev, fixViewportGap);
document.addEventListener('visibilitychange', fixViewportGap);
document.addEventListener('focusout', () => setTimeout(fixViewportGap, 400)); // keyboard closed
[300, 1000, 2500].forEach((ms) => setTimeout(fixViewportGap, ms));

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
// Download the OCR once while there's signal, so scanning also works at a feria without internet.
if (navigator.onLine) setTimeout(() => import('./scan.js').then((m) => m.warmUpOCR()), 8000);
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
