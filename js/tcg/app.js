// Magic / Yu-Gi-Oh vaults (otros.html?juego=mtg|ygo): Inicio, Colección, Más + scanner/search.
// A separate app from the Pokémon vault: its own storage key, same look, shared settings.

import { h, $, $$, esc, fmtCLP, fmtUSD, fmtPct, fmtDate, timeAgo, toast, norm } from '../util.js';
import { renderPortfolioChart } from '../chart.js';
import { gameById } from './games.js';
import { openVault, state, onChange, settings, usdclp, summary, sellRanking, refreshPrices, refreshFx, itemValueUSD, itemGain, exportVault, importVault, computeAlerts, dismissAlert, wishPrint, backupDue, backedUp, eventKey, eventReport, renameEvent, removeEvent, knownEvents } from './store.js';
import { openSearch, openPrintSheet, openItemSheet, openSellForm, openSheet, confirmSheet, itemTile, printTile, money, pctClass, disp } from './ui.js';
import { openSaleList } from './salelist.js';
import { readCard } from './scan.js';
import { renderFaltantes } from './faltantes.js';
import { vaultListHTML, wireVaultList, setLastVault, paintVaultPill } from '../vaults.js';

const g = gameById(new URLSearchParams(location.search).get('juego'));
if (!g) {
  location.replace('index.html#/inicio');
  throw new Error('Juego desconocido');
}
openVault(g);
setLastVault(g.id);
document.title = `VaultKeeper · ${g.short}`;
paintVaultPill($('.vault-pill'), g.id);
$('.vault-pill').onclick = () => openVaultSheet();

const view = $('#view');
let current = null, range = 'all', includeKeep = false, showAll = false;

// ───────────────────────── Inicio

function renderHome(root) {
  const s = summary();
  const inUSD = disp() === 'USD';
  const F = inUSD
    ? { value: fmtUSD(s.valueUSD), alt: fmtCLP(s.valueCLP), cost: fmtUSD(s.costUSD), gain: fmtUSD(s.gainUSD, { sign: true }), pct: s.costUSD ? s.gainUSD / s.costUSD : 0, gv: s.gainUSD }
    : { value: fmtCLP(s.valueCLP), alt: fmtUSD(s.valueUSD), cost: fmtCLP(s.costCLP), gain: fmtCLP(s.gainCLP, { sign: true }), pct: s.costCLP ? s.gainCLP / s.costCLP : 0, gv: s.gainCLP };
  const all = sellRanking({ includeKeep });
  const ranking = showAll ? all : all.filter((r) => r.profitable).slice(0, 5);
  const alerts = computeAlerts();
  const first = !state.items.length;
  root.innerHTML = `
    ${
      first
        ? `<section class="panel welcome rise"><h2>Tu vault de ${esc(g.short)}</h2>
          <ol class="steps">
            <li><b>Busca o escanea una carta</b> con el botón central: ves su precio TCGplayer en pesos${g.id === 'mtg' ? ' (normal y foil)' : ' por impresión'}.</li>
            <li><b>En la feria</b>, escribe cuánto piden: te digo si es ganga y cuánto pagar como máximo.</li>
            <li><b>Registra la compra</b>: el valor, el gráfico y las recomendaciones se arman solos. Este vault es independiente de los otros juegos.</li>
          </ol>
          <button class="btn primary full go-search">Buscar mi primera carta</button></section>`
        : `<section class="hero rise">
      <div class="hero-label">Valor del vault · ${esc(g.short)}</div>
      <div class="hero-value">${F.value}</div>
      <div class="hero-alt">${F.alt} · ${s.n} carta${s.n === 1 ? '' : 's'}</div>
      <div class="hero-stats">
        <div><span>Invertido</span><b>${F.cost}</b></div>
        <div><span>Ganancia</span><b class="${pctClass(F.gv)}">${F.gain}<small>${fmtPct(F.pct)}</small></b></div>
        <div><span>Realizada</span><b class="${pctClass(s.realCLP)}">${fmtCLP(s.realCLP, { sign: true })}<small>${s.exits} venta${s.exits === 1 ? '' : 's'}</small></b></div>
      </div>
      <div class="hero-foot"><span>${state.lastRefresh ? `Precios ${timeAgo(state.lastRefresh)}` : 'Precios: se actualizan solos'}${s.missing ? ` · ${s.missing} sin precio` : ''}</span><button class="link refresh">Actualizar ↻</button></div>
    </section>
    ${
      alerts.length
        ? `<section class="panel alerts rise" style="--d:1"><div class="panel-head"><h2>Novedades</h2><span class="badge-count">${alerts.length}</span></div>${alerts
            .slice(0, 6)
            .map((a) => `<div class="alert-row ${a.kind}" data-print="${esc(a.printId)}" data-item="${esc(a.itemId || '')}"><img src="${esc(a.image || 'icons/card-back.svg')}" alt="" onerror="this.src='icons/card-back.svg'"><div><b>${esc(a.name)}</b><small>${esc(a.text)}</small></div><button class="icon-btn dismiss" data-key="${esc(a.key)}" aria-label="Descartar">✕</button></div>`)
            .join('')}${alerts.length > 6 ? `<p class="muted tiny">y ${alerts.length - 6} más…</p>` : ''}</section>`
        : ''
    }
    ${backupDue() ? `<div class="notice rise"><b>${state.lastBackup ? `Tu último respaldo de ${esc(g.short)} fue ${timeAgo(state.lastBackup)}` : `Aún no respaldas tu vault de ${esc(g.short)}`}</b>. Tus datos viven solo en este teléfono. <button class="link do-backup">Respaldar ahora</button></div>` : ''}
    <section class="panel rise" style="--d:1">
      <div class="panel-head"><h2>Costo vs. valor</h2><div class="seg small ranges">${[['30', '1M'], ['90', '3M'], ['all', 'Todo']].map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="chart-box"></div>
    </section>
    <section class="panel rise" style="--d:2">
      <div class="panel-head"><h2>Recomendadas para vender</h2><label class="switch small"><input type="checkbox" class="keep" ${includeKeep ? 'checked' : ''}><span>Incluir colección</span></label></div>
      <ol class="rank">${
        ranking.length
          ? ranking
              .map(
                (r, i) => `<li class="rank-row" data-item="${esc(r.it.id)}"><span class="rank-n">${i + 1}</span><img src="${esc(r.it.image || 'icons/card-back.svg')}" alt="" loading="lazy" onerror="this.src='icons/card-back.svg'">
              <div class="rank-main"><div class="rank-name">${esc(r.it.name)} <small>${esc(r.it.setName)}${r.it.finishLabel !== 'Normal' ? ` · ${esc(r.it.finishLabel)}` : ''}</small></div>
              <div class="rank-why">${r.G.pct == null ? 'te costó $0' : `${Math.round(r.G.pct * 100)}% sobre tu compra`}</div>
              <div class="rank-list">${r.underFloor ? `Publica a ${fmtCLP(r.floorCLP)} o más · el mercado está en ~${fmtCLP(r.listCLP)}` : r.listCLP === r.floorCLP ? `Publica a ~${fmtCLP(r.listCLP)} (tu mínimo)` : `Publica a ~${fmtCLP(r.listCLP)} · no bajes de ${fmtCLP(r.floorCLP)}`}</div></div>
              <div class="rank-side"><b class="${pctClass(r.G.clp)}">${inUSD ? fmtUSD(r.G.usd, { sign: true }) : fmtCLP(r.G.clp, { sign: true })}</b><button class="pill-btn sell" data-item="${esc(r.it.id)}">Vender</button></div></li>`
              )
              .join('')
          : `<li class="empty"><p>${all.length ? 'Ninguna carta de reventa está sobre tu costo todavía.' : 'Aún no hay cartas de reventa con precio.'}</p></li>`
      }</ol>
      ${all.length > ranking.length || showAll ? `<button class="btn ghost full more">${showAll ? 'Mostrar top 5' : `Mostrar todas (${all.length})`}</button>` : ''}
    </section>`
    }`;
  $('.go-search', root)?.addEventListener('click', () => openSearch());
  $('.refresh', root)?.addEventListener('click', () => refresh({ force: true }));
  $$('.ranges button', root).forEach((b) => (b.onclick = () => ((range = b.dataset.r), renderHome(root))));
  $('.keep', root)?.addEventListener('change', (e) => ((includeKeep = e.target.checked), renderHome(root)));
  $('.more', root)?.addEventListener('click', () => ((showAll = !showAll), renderHome(root)));
  $('.do-backup', root)?.addEventListener('click', () => backup());
  $('.alerts', root)?.addEventListener('click', (e) => {
    const d = e.target.closest('.dismiss');
    if (d) return dismissAlert(d.dataset.key);
    const row = e.target.closest('.alert-row');
    if (!row) return;
    const it = row.dataset.item && state.items.find((x) => x.id === row.dataset.item);
    const w = state.wishlist[row.dataset.print];
    if (it) openItemSheet(it);
    else if (w) openPrintSheet(wishPrint(w));
  });
  const box = $('.chart-box', root);
  if (box) {
    let rows = state.history;
    if (range !== 'all') {
      const from = new Date(Date.now() - Number(range) * 86400000).toLocaleDateString('sv-SE');
      rows = rows.filter((r) => r.d >= from);
    }
    const pts = rows.map((r) => ({ d: r.d, cost: inUSD ? r.cu : r.cc, value: inUSD ? r.v : r.vc }));
    const draw = () => (pts.length ? renderPortfolioChart(box, pts, { currency: disp(), fmt: (n) => (inUSD ? fmtUSD(n) : fmtCLP(n)) }) : (box.innerHTML = '<div class="empty"><p>El gráfico se arma solo: cada día guarda un punto de costo y valor.</p></div>'));
    requestAnimationFrame(draw);
    root._resize = draw;
  }
  $('.rank', root)?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-item]')?.dataset.item;
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    const r = sellRanking().find((x) => x.it.id === id);
    if (e.target.closest('.sell')) openSellForm(it, { suggestCLP: r?.askCLP });
    else openItemSheet(it);
  });
}

// ───────────────────────── Colección

const ui = { q: '', status: 'held', rarity: '', purpose: 'all', event: '', sort: 'value' };
const atEvent = (it, key) => [it.buy?.event, it.exit?.event].some((e) => e && eventKey(e) === key);
function renderCollection(root) {
  const base = state.items.filter((it) => (ui.status === 'all' ? true : ui.status === 'held' ? it.status === 'held' : it.status !== 'held'));
  const rarities = [...new Set(base.map((it) => it.rarity).filter(Boolean))].sort();
  if (ui.rarity && !rarities.includes(ui.rarity)) ui.rarity = '';
  const events = eventReport();
  if (ui.event && !events.some((e) => e.key === ui.event)) ui.event = '';
  const val = (it) => itemValueUSD(it) ?? it.costUSD;
  let list = base.filter((it) => (!ui.rarity || it.rarity === ui.rarity) && (ui.purpose === 'all' || it.purpose === ui.purpose) && (!ui.event || atEvent(it, ui.event)) && (!ui.q || norm(`${it.name} ${it.setName} ${it.setCode} ${it.number}`).includes(norm(ui.q))));
  const sorters = { value: (a, b) => val(b) - val(a), gain: (a, b) => (itemGain(b)?.pct ?? 0) - (itemGain(a)?.pct ?? 0), date: (a, b) => (b.buy.date || '').localeCompare(a.buy.date || '') || b.addedAt - a.addedAt, name: (a, b) => a.name.localeCompare(b.name) };
  list.sort(sorters[ui.sort]);
  const total = list.reduce((s, it) => s + (it.status === 'held' ? val(it) : 0), 0);
  root.innerHTML = `
    <div class="view-head rise"><h1>Colección</h1><p class="muted">${esc(g.short)} · ${list.length} ítem${list.length === 1 ? '' : 's'}${ui.status !== 'out' ? ` · ${money(total)}` : ''}</p><button class="btn ghost sale-list">Lista de venta para compartir</button></div>
    <div class="filters rise" style="--d:1">
      <input class="input" type="search" placeholder="Buscar en tu vault" value="${esc(ui.q)}">
      <div class="filter-row">
        <div class="seg small status">${[['held', 'En vault'], ['out', 'Vendidas'], ['all', 'Todas']].map(([k, l]) => `<button data-s="${k}" class="${ui.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg small purpose">${[['all', 'Todo'], ['reventa', 'Reventa'], ['coleccion', 'Colección']].map(([k, l]) => `<button data-p="${k}" class="${ui.purpose === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${events.length ? `<select class="input small evsel" aria-label="Filtrar por evento"><option value="">Todos los eventos</option>${events.map((e) => `<option value="${esc(e.key)}" ${ui.event === e.key ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : ''}
        ${rarities.length ? `<select class="input small rar" aria-label="Rareza"><option value="">Todas las rarezas</option>${rarities.map((r) => `<option ${ui.rarity === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>` : ''}
        <select class="input small sort">${[['value', 'Mayor valor'], ['gain', 'Mayor ganancia %'], ['date', 'Más recientes'], ['name', 'Nombre']].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="grid rise" style="--d:2">${list.length ? list.map(itemTile).join('') : `<div class="empty wide"><p>${state.items.length ? 'Nada con estos filtros.' : 'Aún no tienes cartas en este vault. Toca el botón central para buscar o escanear.'}</p></div>`}</div>`;
  const search = $('input[type=search]', root);
  search.oninput = () => {
    ui.q = search.value;
    const pos = search.selectionStart;
    renderCollection(root);
    const s2 = $('input[type=search]', root);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  $$('.status button', root).forEach((b) => (b.onclick = () => ((ui.status = b.dataset.s), renderCollection(root))));
  $$('.purpose button', root).forEach((b) => (b.onclick = () => ((ui.purpose = b.dataset.p), renderCollection(root))));
  $('.evsel', root)?.addEventListener('change', (e) => ((ui.event = e.target.value), renderCollection(root)));
  $('.sale-list', root).onclick = () => openSaleList();
  $('.rar', root)?.addEventListener('change', (e) => ((ui.rarity = e.target.value), renderCollection(root)));
  $('.sort', root).onchange = (e) => ((ui.sort = e.target.value), renderCollection(root));
  $('.grid', root).onclick = (e) => {
    const t = e.target.closest('.tile');
    const it = t && state.items.find((x) => x.id === t.dataset.item);
    if (it) openItemSheet(it);
  };
}

// ───────────────────────── Más

function renderMas(root) {
  root.innerHTML = `
    <div class="view-head rise"><h1>Más</h1></div>
    <section class="panel rise" style="--d:1"><h2>Vaults</h2>${vaultListHTML(g.id)}</section>
    <nav class="menu rise" style="--d:2">
      <a href="#/eventos"><span class="m-ico">⚑</span><div><b>Eventos</b><small>${(() => { const n = eventReport().length; return n ? `${n} feria${n === 1 ? '' : 's'} · resultado de cada una, renombrar o unir` : 'Resultado por feria: compras y ventas'; })()}</small></div><em>›</em></a>
      <button class="backup"><span class="m-ico">☁</span><div><b>Respaldar este vault</b><small>${state.lastBackup ? `Último: ${timeAgo(state.lastBackup)} · ` : ''}Archivo con tus cartas de ${esc(g.short)} (no incluye las de otros juegos)</small></div><em>›</em></button>
      <label class="import"><span class="m-ico">⤒</span><div><b>Importar respaldo</b><small>Reemplaza el vault de ${esc(g.short)} por el del archivo</small></div><em>›</em><input type="file" accept="application/json,.json" hidden></label>
      <a href="index.html#/ajustes?volver=${g.id}" class="to-settings"><span class="m-ico">⚙</span><div><b>Ajustes</b><small>Moneda, margen, canales y API key de Claude son comunes a todos los vaults: se cambian en Pokémon → Ajustes</small></div><em>›</em></a>
    </nav>`;
  wireVaultList(root, g.id, { onToggle: () => renderMas(root) });
  $('.backup', root).onclick = () => backup().then(() => renderMas(root));
  $('.import input', root).onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      importVault(JSON.parse(await f.text()));
      toast('Respaldo importado', 'ok');
    } catch (err) {
      toast(`No pude importarlo: ${err.message}`, 'err');
    }
  };
}

async function backup() {
  const file = new File([exportVault()], `vaultkeeper-${g.id}-${new Date().toLocaleDateString('sv-SE')}.json`, { type: 'application/json' });
  const { shareFile } = await import('../sale-share.js');
  if (await shareFile(file, { title: `Respaldo VaultKeeper ${g.short}`, text: 'Guárdalo en Archivos → iCloud Drive' })) {
    backedUp();
    toast('Respaldo listo', 'ok');
  }
}

// ───────────────────────── Eventos (Más): result of each feria, rename / merge, remove

const when = (e) => (e.from && e.to && e.from !== e.to ? `${fmtDate(e.from)} → ${fmtDate(e.to)}` : e.from ? fmtDate(e.from) : '');
function renderEventos(root) {
  const events = eventReport();
  root.innerHTML = `
    <button class="back-btn" aria-label="Volver a Más"><span aria-hidden="true">‹</span> Más</button>
    <div class="view-head rise">
      <h1>Eventos</h1>
      <p class="muted">Cada feria o evento donde compraste o vendiste cartas de ${esc(g.short)}. Toca uno para ver qué pasó ahí, corregir su nombre o unirlo con otro.</p>
    </div>
    <section class="panel rise" style="--d:1">${
      events.length
        ? `<div class="ev-list">${events
            .map(
              (e) => `<button class="ev-row" data-k="${esc(e.key)}">
            <div class="ev-main"><b>${esc(e.name)}</b><small>${[when(e), `${e.buyN} compra${e.buyN === 1 ? '' : 's'}`, `${e.saleN} venta${e.saleN === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small></div>
            <div class="ev-val"><b class="${pctClass(e.net)}">${fmtCLP(e.net, { sign: true })}</b><small>ganancia</small></div>
          </button>`
            )
            .join('')}</div>`
        : '<div class="empty"><p>Aún no hay eventos. Escribe la feria al comprar o vender (por ejemplo “Feria Persa 12-oct”) y aparecerá aquí.</p></div>'
    }</section>`;
  $('.back-btn', root).onclick = () => (location.hash = '#/mas');
  $$('.ev-row', root).forEach((b) => (b.onclick = () => openEventSheet(b.dataset.k, () => renderEventos(root))));
}

function openEventSheet(key, refresh) {
  const e = eventReport().find((x) => x.key === key);
  if (!e) return;
  const at = (x) => x?.event && eventKey(x.event) === key;
  const bought = state.items.filter((it) => at(it.buy));
  const sold = state.items.filter((it) => it.status !== 'held' && at(it.exit));
  const tiles = (list) => `<div class="grid grid-tight">${list.map((it) => printTile({ ...it, id: it.printId }, { itemId: it.id })).join('')}</div>`;
  const variants = Object.keys(e.names);
  const body = h(`
    <div class="form">
      <p class="muted small">${esc(when(e))}${variants.length > 1 ? ` · escrito de ${variants.length} formas: ${variants.map((v) => `“${esc(v)}”`).join(', ')}` : ''}</p>
      <div class="rep-grid">
        <div><span>Compras</span>${fmtCLP(e.buys)} <small>(${e.buyN})</small></div>
        <div><span>Ventas</span>${fmtCLP(e.sales)} <small>(${e.saleN})</small></div>
        <div><span>Ganancia</span><b class="${pctClass(e.net)}">${fmtCLP(e.net, { sign: true })}</b></div>
      </div>
      <p class="muted tiny">Ganancia = lo que dejaron las ventas de este evento contra lo que te costaron esas cartas.</p>
      ${bought.length ? `<h3 class="ev-h">Compradas aquí (${bought.length})</h3>${tiles(bought)}` : ''}
      ${sold.length ? `<h3 class="ev-h">Vendidas aquí (${sold.length})</h3>${tiles(sold)}` : ''}
      <button class="btn ghost full incol">Ver en Colección</button>
      <div class="btn-row"><button class="btn ghost rename">Renombrar o unir</button><button class="btn ghost danger remove">Quitar evento</button></div>
    </div>`);
  const s = openSheet({ title: e.name, body, cls: 'tall' });
  body.addEventListener('click', (ev) => {
    const it = state.items.find((x) => x.id === ev.target.closest('.tile')?.dataset.item);
    if (it) (s.close(), openItemSheet(it));
  });
  $('.incol', body).onclick = () => {
    s.close();
    Object.assign(ui, { event: key, status: 'all', rarity: '', purpose: 'all', q: '' });
    location.hash = '#/coleccion';
  };
  $('.rename', body).onclick = () => (s.close(), openRename(e, refresh));
  $('.remove', body).onclick = async () => {
    const n = bought.length + sold.length;
    if (!(await confirmSheet('Quitar evento', `Se quita “${e.name}” de ${n} registro${n === 1 ? '' : 's'} (compras y ventas). Los registros se mantienen, solo quedan sin evento.`, 'Quitar'))) return;
    removeEvent(key);
    s.close();
    toast('Evento quitado', 'ok');
    refresh();
  };
}

function openRename(e, refresh) {
  const others = knownEvents().filter((x) => eventKey(x) !== e.key);
  const body = h(`
    <form class="form">
      <label class="field"><span>Nuevo nombre</span><input class="input to" list="evr-list" value="${esc(e.name)}" autocomplete="off" required><datalist id="evr-list">${others.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <p class="muted small merge-hint">Si escribes el nombre de otro evento, se unen en uno solo.</p>
      <button class="btn primary" type="submit">Guardar</button>
    </form>`);
  const s = openSheet({ title: 'Renombrar o unir', body });
  const input = $('.to', body), hint = $('.merge-hint', body);
  input.oninput = () => {
    const other = others.find((x) => eventKey(x) === eventKey(input.value));
    hint.innerHTML = other ? `<b>Se unirá con “${esc(other)}”</b>: sus compras y ventas quedan en un solo evento.` : 'Si escribes el nombre de otro evento, se unen en uno solo.';
  };
  body.onsubmit = (ev) => {
    ev.preventDefault();
    const merged = others.some((x) => eventKey(x) === eventKey(input.value));
    const n = renameEvent(e.key, input.value);
    s.close();
    toast(merged ? `Eventos unidos (${n} registro${n === 1 ? '' : 's'})` : 'Evento renombrado', 'ok');
    refresh();
  };
}

function openVaultSheet() {
  const body = document.createElement('div');
  const paint = () => ((body.innerHTML = vaultListHTML(g.id)), wireVaultList(body, g.id, { onToggle: paint }));
  paint();
  openSheet({ title: 'Vaults', body });
}

// ───────────────────────── router, scanner, prices

const ROUTES = { inicio: renderHome, coleccion: renderCollection, faltantes: renderFaltantes, mas: renderMas, eventos: renderEventos };
const TAB_OF = { eventos: 'mas' };
function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?')[0];
  const changed = current !== name;
  current = ROUTES[name] ? name : 'inicio';
  $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.route === (TAB_OF[current] || current)));
  view._resize = null;
  ROUTES[current](view);
  if (changed) {
    window.scrollTo({ top: 0 });
    $('#sheets').innerHTML = '';
    document.body.classList.remove('has-sheet');
  }
  $('.fxchip').innerHTML = `<span class="fx-k">US$1 = </span>${fmtCLP(usdclp())}`;
}
onChange(() => {
  const y = window.scrollY;
  route();
  window.scrollTo({ top: y });
});
window.addEventListener('hashchange', route);
let rz;
window.addEventListener('resize', () => (clearTimeout(rz), (rz = setTimeout(() => view._resize?.(), 150))));

async function scan() {
  const { openScanner } = await import('../scan.js');
  const r = await openScanner({ title: `Escanear ${g.short}`, read: readCard });
  if (!r) return;
  if (r.manual) return openSearch();
  const { info, cands } = r;
  if (cands.length === 1 && info.number) return openPrintSheet(cands[0]);
  if (!cands.length) return openSearch({ initial: info.name || info.number || '' });
  // Several printings: let the user pick (same search sheet, prefilled).
  const body = document.createElement('div');
  body.innerHTML = `<p class="small">Leí <b>${esc([info.name, info.number].filter(Boolean).join(' · ') || '—')}</b> <span class="muted">(${info.via === 'claude' ? 'Claude' : 'OCR'})</span>. Toca tu impresión:</p><div class="grid grid-tight">${cands.slice(0, 60).map((p) => `<button class="tile" data-id="${esc(p.id)}"><div class="tile-img"><img loading="lazy" src="${esc(p.image || 'icons/card-back.svg')}" alt=""></div><div class="tile-meta"><div class="tile-name"><span>${esc(p.name)}</span></div><div class="tile-sub">${esc([g.id === 'mtg' ? `${p.setCode} ${p.number}` : p.number, p.rarity].filter(Boolean).join(' · '))}</div></div></button>`).join('')}</div>`;
  const s = openSheet({ title: 'Elige tu carta', body, cls: 'tall' });
  body.onclick = (e) => {
    const t = e.target.closest('.tile');
    const p = t && cands.find((x) => x.id === t.dataset.id);
    if (p) (s.close(), openPrintSheet(p));
  };
}
$('.scan-fab').onclick = () => openScanChoice();
function openScanChoice() {
  const body = document.createElement('div');
  body.className = 'btn-col';
  body.innerHTML = `<button class="btn primary cam">Escanear con la cámara</button><button class="btn ghost find">Buscar por nombre o código</button><p class="muted tiny">${settings().claudeKey ? 'Lee con Claude (tu API key de Ajustes).' : 'Sin API key de Claude lee el código impreso con el OCR del teléfono; con buena luz y la carta llenando el marco.'}</p>`;
  const s = openSheet({ title: g.short, body });
  $('.cam', body).onclick = () => (s.close(), scan());
  $('.find', body).onclick = () => (s.close(), openSearch());
}

async function refresh({ force = false } = {}) {
  if (!navigator.onLine) return force && toast('Sin conexión: uso los últimos precios guardados');
  await refreshFx();
  const r = await refreshPrices({ force });
  if (force) toast(r.failed ? `${r.failed} de ${r.done + r.failed} precios no se pudieron actualizar` : 'Precios actualizados', r.failed ? 'err' : 'ok');
  route();
}

window.addEventListener('online', () => (document.body.classList.remove('offline'), refresh()));
window.addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

route();
refresh();
if (navigator.onLine) setTimeout(() => import('../scan.js').then((m) => m.warmUpOCR()), 8000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
