// Inicio: vault value, cost vs. value chart, and the "what to sell" ranking.

import { h, esc, $, $$, fmtCLP, fmtUSD, fmtPct, timeAgo } from '../util.js';
import { state, save, summary, sellRanking, actions, computeAlerts, dismissAlert } from '../store.js';
import { renderPortfolioChart } from '../chart.js';
import { img, variantLabel } from '../api.js';
import { money, moneyAlt, disp, pctClass, arrow, openItemSheet, openSellForm, scanFlow, openCardSheet, openSearch } from '../ui.js';
import { backupNow, backupDue, isInstalled } from '../backup.js';

let range = 'all';
let showAll = false;
let includeKeep = false;

const RANGES = [
  ['7', '1S'],
  ['30', '1M'],
  ['90', '3M'],
  ['all', 'Todo'],
];

function figures(s) {
  const usd = disp() === 'USD';
  const f = usd ? (n, o) => fmtUSD(n, o) : (n, o) => fmtCLP(n, o);
  return {
    f,
    value: usd ? s.valueUSD : s.valueCLP,
    cost: usd ? s.costUSD : s.costCLP,
    gain: usd ? s.gainUSD : s.gainCLP,
    pct: usd ? s.pctUSD : s.pctCLP,
    real: usd ? s.realNetUSD : s.realNetCLP,
    exp: usd ? s.expensesCLP / state.fx.usdclp : s.expensesCLP,
    alt: usd ? fmtCLP(s.valueCLP) : fmtUSD(s.valueUSD),
  };
}

function chartPoints() {
  const usd = disp() === 'USD';
  let rows = state.history;
  if (range !== 'all') {
    const from = new Date(Date.now() - Number(range) * 86400000).toLocaleDateString('sv-SE');
    rows = rows.filter((r) => r.d >= from);
  }
  return rows.map((r) => ({ d: r.d, cost: usd ? r.cu : r.cc, value: usd ? r.v : r.vc ?? r.v * r.fx }));
}

export function renderHome(root) {
  const s = summary();
  const F = figures(s);
  const ranking = sellRanking({ includeKeep });
  const winners = ranking.filter((r) => r.profitable);
  const top = showAll ? ranking : winners.slice(0, 5);

  const alerts = computeAlerts();
  navigator.setAppBadge?.(alerts.length).catch?.(() => {});
  const notices = [];
  if (!isInstalled() && !state.settings.hideInstallTip)
    notices.push(`<div class="notice"><b>Instala la app en tu iPhone</b>: Safari → Compartir → “Agregar a inicio”. Así funciona sin conexión y iOS no borra tus datos. Ojo: los datos de Safari y de la app instalada son distintos; si ya tienes cartas aquí, haz un respaldo y luego impórtalo en la app instalada (Ajustes). <button class="link hide-install">Entendido</button></div>`);
  if (backupDue())
    notices.push(`<div class="notice"><b>${state.settings.lastBackup ? `Tu último respaldo fue ${timeAgo(state.settings.lastBackup)}` : 'Aún no tienes respaldo'}</b>. Tus datos viven solo en este teléfono. <button class="link do-backup">Respaldar en iCloud</button></div>`);

  root.innerHTML = `
    ${notices.join('')}
    ${
      alerts.length
        ? `<section class="panel alerts rise"><div class="panel-head"><h2>Novedades</h2><span class="badge-count">${alerts.length}</span></div>${alerts
            .slice(0, 6)
            .map(
              (a) => `<div class="alert-row ${a.kind}" data-card="${esc(a.cardId)}" data-item="${esc(a.itemId || '')}"><img src="${esc(img(a.image))}" alt="" onerror="this.src='icons/card-back.svg'"><div><b>${esc(a.name)}</b><small>${esc(a.text)}</small></div><button class="icon-btn dismiss" data-key="${esc(a.key)}" aria-label="Descartar">✕</button></div>`
            )
            .join('')}${alerts.length > 6 ? `<p class="muted tiny">y ${alerts.length - 6} más…</p>` : ''}</section>`
        : ''
    }
    <section class="hero rise">
      <div class="hero-label">Valor del vault</div>
      <div class="hero-value">${F.f(F.value)}</div>
      <div class="hero-alt">${F.alt} · ${s.n} carta${s.n === 1 ? '' : 's'}</div>
      <div class="hero-stats">
        <div><span>Invertido</span><b>${F.f(F.cost)}</b></div>
        <div><span>Ganancia</span><b class="${pctClass(F.gain)}">${arrow(F.gain)} ${F.f(F.gain, { sign: true })}<small>${fmtPct(F.pct)}</small></b></div>
        <div><span>Realizada neta</span><b class="${pctClass(F.real)}">${F.f(F.real, { sign: true })}<small>${s.exits} venta${s.exits === 1 ? '' : 's'}${s.expensesCLP ? ` · gastos ${F.f(F.exp)}` : ''}</small></b></div>
      </div>
      <div class="hero-foot">
        <span>${state.lastRefresh ? `Precios TCGplayer ${timeAgo(state.lastRefresh)}` : "Precios TCGplayer: se actualizan solos"}${s.missing ? ` · ${s.missing} sin precio` : ''}</span>
        <button class="link refresh">Actualizar ↻</button>
      </div>
    </section>

    <section class="quick rise" style="--d:1">
      <button class="qa scan"><span class="qa-ico">◎</span><b>Evaluar en feria</b><small>Foto → precio y veredicto</small></button>
      <a class="qa" href="#/lote"><span class="qa-ico">▦</span><b>Evaluar un lote</b><small>Varias cartas, oferta máxima</small></a>
      <button class="qa find"><span class="qa-ico">⌕</span><b>Buscar</b><small>Inglés, japonesas, sellados</small></button>
      <a class="qa" href="#/reporte"><span class="qa-ico">∑</span><b>Reporte y gastos</b><small>Ganancia por feria y mes</small></a>
    </section>

    <section class="panel rise" style="--d:2">
      <div class="panel-head">
        <h2>Costo vs. valor</h2>
        <div class="seg small ranges">${RANGES.map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="legend"><span><i class="sw sw-value"></i>Valor de mercado</span><span><i class="sw sw-cost"></i>Costo de compra</span></div>
      <div class="chart-box"></div>
      <details class="table-view"><summary>Ver como tabla</summary><div class="tv"></div></details>
    </section>

    <section class="panel rise" style="--d:3">
      <div class="panel-head">
        <h2>Recomendadas para vender</h2>
        <label class="switch small"><input type="checkbox" class="keep" ${includeKeep ? 'checked' : ''}><span>Incluir colección</span></label>
      </div>
      <p class="muted small">Ordenadas por ganancia sobre tu compra, monto y tendencia del precio (si va bajando, conviene vender antes).</p>
      <ol class="rank">${top.length ? top.map((r, i) => rankRow(r, i)).join('') : `<li class="empty"><p>${!s.n ? 'Tu vault está vacío. Escanea tu primera carta.' : ranking.length ? 'Ninguna carta de reventa está sobre tu costo todavía.' : 'Aún no hay cartas de reventa con precio.'}</p></li>`}</ol>
      ${ranking.length > top.length || showAll ? `<button class="btn ghost full more">${showAll ? 'Mostrar top 5' : `Mostrar todas (${ranking.length})`}</button>` : ''}
    </section>`;

  const pts = chartPoints();
  const box = $('.chart-box', root);
  if (pts.length) {
    const draw = () => renderPortfolioChart(box, pts, { currency: disp(), fmt: (n) => F.f(n) });
    requestAnimationFrame(draw);
    root._resize = draw;
    $('.tv', root).innerHTML = `<table><thead><tr><th>Fecha</th><th>Costo</th><th>Valor</th><th>%</th></tr></thead><tbody>${pts
      .slice()
      .reverse()
      .map((p) => `<tr><td>${esc(p.d)}</td><td>${F.f(p.cost)}</td><td>${F.f(p.value)}</td><td class="${pctClass(p.value - p.cost)}">${fmtPct(p.cost ? (p.value - p.cost) / p.cost : 0)}</td></tr>`)
      .join('')}</tbody></table>`;
  } else {
    box.innerHTML = `<div class="empty"><p>El gráfico se arma solo: cada día que la app actualiza precios guarda un punto de costo y valor.</p></div>`;
  }

  $$('.ranges button', root).forEach((b) => (b.onclick = () => ((range = b.dataset.r), renderHome(root))));
  $('.keep', root).onchange = (e) => ((includeKeep = e.target.checked), renderHome(root));
  $('.more', root)?.addEventListener('click', () => ((showAll = !showAll), renderHome(root)));
  $('.refresh', root).onclick = () => actions.refreshPrices?.({ force: true });
  $('.do-backup', root)?.addEventListener('click', () => backupNow());
  $('.hide-install', root)?.addEventListener('click', () => {
    state.settings.hideInstallTip = true;
    save({ silent: true });
    renderHome(root);
  });
  $('.alerts', root)?.addEventListener('click', (e) => {
    const d = e.target.closest('.dismiss');
    if (d) return dismissAlert(d.dataset.key);
    const row = e.target.closest('.alert-row');
    if (!row) return;
    const it = row.dataset.item && state.items.find((x) => x.id === row.dataset.item);
    if (it) openItemSheet(it);
    else openCardSheet(row.dataset.card);
  });
  $('.scan', root).onclick = () => scanFlow({ title: 'Evaluar en feria', onPick: (c) => openCardSheet(c.id) });
  $('.find', root).onclick = () => openSearch({ onPick: (c) => openCardSheet(c.id) });

  $('.rank', root).addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (!row) return;
    const r = ranking.find((x) => x.it.id === row.dataset.item);
    if (e.target.closest('.sell')) openSellForm(r.it, { suggestCLP: r.listCLP });
    else openItemSheet(r.it);
  });
}

function rankRow(r, i) {
  const it = r.it;
  return `
    <li class="rank-row" data-item="${esc(it.id)}">
      <span class="rank-n">${i + 1}</span>
      <img src="${esc(img(it.image))}" alt="" loading="lazy" onerror="this.src='icons/card-back.svg'">
      <div class="rank-main">
        <div class="rank-name">${esc(it.name)} <small>${esc(it.setName)} · ${esc(variantLabel(it.variant))}</small></div>
        <div class="rank-why">${r.reasons.map(esc).join(' · ')}</div>
        <div class="rank-list">Publica a ~${fmtCLP(r.listCLP)} · mínimo ${fmtCLP(r.floorCLP)}</div>
      </div>
      <div class="rank-side">
        <b class="${pctClass(r.profitable ? 1 : -1)}">${disp() === 'USD' ? fmtUSD(r.gainUSD, { sign: true }) : fmtCLP(r.gainCLP, { sign: true })}</b>
        <small>${fmtPct(r.gainPct)}</small>
        <button class="chip-btn sell">Vender</button>
      </div>
    </li>`;
}
