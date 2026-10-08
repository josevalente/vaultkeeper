// Shared UI: bottom sheets, card tiles, card detail, buy/sell forms, search, scan flow.

import { h, esc, $, $$, fmtCLP, fmtUSD, fmtPct, fmtDate, localDate, parseAmount, toast, debounce, timeAgo } from './util.js';
import { state, save, addItems, recordExit, removeItem, snapshot, ownedCount, marketUSD, setPrice, pushHist, dealVerdict, defaultPurpose, toUSD, toCLP, itemValueUSD } from './store.js';
import { getCard, img, variantLabel, tcgplayerUrl, searchByName, findByNumber, getHistory } from './api.js';
import { renderPriceChart } from './chart.js';
import { rarityInfo, raritySymbol } from './rarity.js';
import { refreshFx, fxOn } from './fx.js';
import { openScanner } from './scan.js';

// ───────────────────────── money in the user's display currency

export const disp = () => state.settings.display;
export function money(usd, { sign = false } = {}) {
  return disp() === 'USD' ? fmtUSD(usd, { sign }) : fmtCLP(usd * state.fx.usdclp, { sign });
}
export function moneyAlt(usd, { sign = false } = {}) {
  return disp() === 'USD' ? fmtCLP(usd * state.fx.usdclp, { sign }) : fmtUSD(usd, { sign });
}
export const pctClass = (v) => (v > 0.0005 ? 'pos' : v < -0.0005 ? 'neg' : 'flat');
export const arrow = (v) => (v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '•');

// ───────────────────────── sheets

export function openSheet({ title, body, onClose, cls = '' }) {
  const wrap = h(`
    <div class="sheet-wrap ${cls}">
      <div class="sheet-backdrop"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="sheet-head"><div class="grab"></div><h2>${esc(title)}</h2><button class="icon-btn close" aria-label="Cerrar">✕</button></header>
        <div class="sheet-body"></div>
      </section>
    </div>`);
  const bodyEl = $('.sheet-body', wrap);
  if (body) bodyEl.append(body);
  $('#sheets').appendChild(wrap);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!$('#sheets').children.length) document.body.classList.remove('has-sheet');
    }, 260);
    onClose?.();
  };
  $('.close', wrap).onclick = close;
  $('.sheet-backdrop', wrap).onclick = close;
  return { wrap, body: bodyEl, close };
}

export function confirmSheet(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    const body = h(`<div><p class="muted">${esc(text)}</p><div class="btn-row"><button class="btn ghost no">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'} yes">${esc(okLabel)}</button></div></div>`);
    let done = false;
    const s = openSheet({ title, body, onClose: () => !done && resolve(false) });
    $('.no', body).onclick = () => s.close();
    $('.yes', body).onclick = () => {
      done = true;
      resolve(true);
      s.close();
    };
  });
}

// ───────────────────────── tiles

export function cardTile(c, { sub = '', badge = '', dim = false, extra = '' } = {}) {
  const r = rarityInfo(c.rarity);
  return `
    <button class="tile ${dim ? 'dim' : ''}" data-id="${esc(c.id)}" ${c.itemId ? `data-item="${esc(c.itemId)}"` : ''}>
      <div class="tile-img"><img loading="lazy" src="${esc(img(c.image))}" alt="${esc(c.name)}" onerror="this.src='icons/card-back.svg'">${badge}</div>
      <div class="tile-meta">
        <div class="tile-name">${c.rarity ? raritySymbol(r.key, 14) : ''}<span>${esc(c.name)}</span></div>
        <div class="tile-sub">${sub || `${esc(c.setName || '')} · ${esc(c.number)}${c.total ? '/' + esc(c.total) : ''}`}</div>
        ${extra}
      </div>
    </button>`;
}

export function rarityChip(r, { active = false, count = null } = {}) {
  return `<button class="rchip ${active ? 'on' : ''}" data-r="${esc(r.key)}">${raritySymbol(r.key, 18)}<span>${esc(r.label)}</span>${count != null ? `<em>${count}</em>` : ''}</button>`;
}

// ───────────────────────── scan → pick a card

export async function scanFlow({ onPick, title } = {}) {
  const r = await openScanner({ title });
  if (!r) return;
  if (r.manual) return openSearch({ onPick });
  const { info, cands } = r;
  if (cands.length === 1 && cands[0].number && info.number) return onPick(cands[0]);
  openCandidates(r, onPick);
}

function openCandidates({ info, cands, shot }, onPick) {
  const read = [info.name, info.number && `${info.number}/${info.total || '?'}`].filter(Boolean).join(' · ');
  const noKey = !state.settings.claudeKey;
  const body = h(`
    <div>
      <div class="shot-row">
        ${shot ? `<img class="shot" src="${shot}" alt="Foto capturada">` : ''}
        <div>
          <p class="small">${read ? `Leí <b>${esc(read)}</b>` : '<b>No pude leer el nombre ni el número.</b>'} <span class="muted">(${info.via === 'claude' ? 'Claude' : 'OCR'})</span></p>
          ${cands.length ? `<p class="muted small">Toca la carta que coincide con la tuya.</p>` : `<p class="muted small">Acerca la carta para que llene el marco, evita reflejos de la funda y enfoca bien el número de abajo a la izquierda.</p>`}
        </div>
      </div>
      ${noKey && (!cands.length || !info.number) ? `<div class="tip"><b>Tip:</b> el OCR del teléfono falla con fundas, brillos y full-arts. Con una API key de Claude en Ajustes el reconocimiento es mucho más preciso. <a href="#/ajustes">Configurar</a></div>` : ''}
      ${cands.length ? `<div class="grid grid-tight">${cands.slice(0, 60).map((c) => cardTile(c)).join('')}</div>` : ''}
      <div class="btn-row"><button class="btn ghost search">Buscar por nombre</button><button class="btn ghost again">Escanear de nuevo</button></div>
    </div>`);
  const s = openSheet({ title: cands.length ? 'Elige tu carta' : 'No la reconocí', body, cls: cands.length ? 'tall' : '' });
  body.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) {
      s.close();
      onPick(cands.find((c) => c.id === t.dataset.id));
    }
  });
  $('.search', body).onclick = () => {
    s.close();
    openSearch({ onPick, initial: info.name || '' });
  };
  $('.again', body).onclick = () => {
    s.close();
    scanFlow({ onPick });
  };
}

export function openSearch({ onPick, initial = '', title = 'Buscar carta' } = {}) {
  const body = h(`
    <div>
      <div class="search-row">
        <input class="input" type="search" placeholder="Nombre (ej: Umbreon ex)" value="${esc(initial)}" autocomplete="off" enterkeyhint="search">
        <input class="input num" inputmode="text" placeholder="N° 161/131" autocomplete="off">
      </div>
      <div class="results"><div class="empty small"><p>Escribe el nombre, y si quieres el número impreso abajo a la izquierda.</p></div></div>
    </div>`);
  const s = openSheet({ title, body });
  const [nameIn, numIn] = $$('input', body);
  const results = $('.results', body);
  let seq = 0;
  const go = debounce(async () => {
    const q = nameIn.value.trim();
    const num = numIn.value.trim();
    if (q.length < 2 && !num) return;
    const my = ++seq;
    results.innerHTML = `<div class="loading">Buscando…</div>`;
    try {
      let list;
      const m = num.match(/^([A-Z]{0,3}\d{1,3})\s*(?:\/\s*([A-Z]{0,3}\d{1,3}))?$/i);
      if (m) list = await findByNumber(m[1], m[2], q);
      else list = await searchByName(q);
      if (my !== seq) return;
      results.innerHTML = list.length ? `<div class="grid grid-tight">${list.map((c) => cardTile(c)).join('')}</div>` : `<div class="empty"><p>Sin resultados.</p></div>`;
      results.onclick = (e) => {
        const t = e.target.closest('.tile');
        if (!t) return;
        s.close();
        onPick(list.find((c) => c.id === t.dataset.id));
      };
    } catch (e) {
      results.innerHTML = `<div class="empty"><p>Error de conexión. Intenta otra vez.</p></div>`;
    }
  }, 380);
  nameIn.oninput = go;
  numIn.oninput = go;
  if (initial) go();
  setTimeout(() => nameIn.focus(), 300);
  return s;
}

// ───────────────────────── card detail (from the API)

const eurToCLP = (eur) => eur * state.fx.eurusd * state.fx.usdclp;

// Cardmarket trend: the European market, in euros (with its peso equivalent).
function cardmarketBlock(cm) {
  if (!cm) return '';
  const mom = cm.avg7 && cm.avg30 ? cm.avg7 / cm.avg30 - 1 : null;
  const ref = cm.trend ?? cm.avg;
  return `<div class="cm"><div class="label">Cardmarket · Europa</div><div>€${ref != null ? ref.toFixed(2) : '—'}</div>${ref != null ? `<div class="muted small">≈ ${fmtCLP(eurToCLP(ref))}</div>` : ''}${mom != null ? `<div class="${pctClass(mom)} small">${arrow(mom)} ${fmtPct(mom)} 7d vs 30d</div>` : ''}</div>`;
}

function priceTable(prices, variant) {
  const p = prices.tp?.[variant];
  const fx = state.fx.usdclp;
  const cm = prices.cm;
  if (!p && !cm) return `<div class="empty small"><p>Sin precio de mercado para esta carta.</p></div>`;
  // Market = recent sales. Low / median = what is listed for sale right now. The highest listing is
  // left out on purpose: it's usually a stale, absurd ask (e.g. US$10,000) and only misleads.
  return `
    <button class="price-hero hist-open" aria-label="Ver historial de precio">
      <div><div class="label">TCGplayer market</div><div class="big">${p?.market != null ? fmtUSD(p.market) : '—'}</div><div class="muted">${p?.market != null ? fmtCLP(p.market * fx) : ''}</div><div class="hist-link">Ver historial ›</div></div>
      ${cardmarketBlock(cm)}
    </button>
    ${p ? `<div class="kv2"><div><span>Más barata publicada</span><b>${fmtUSD(p.low)}</b><small>${p.low != null ? fmtCLP(p.low * fx) : ''}</small></div><div><span>Mediana publicada</span><b>${fmtUSD(p.mid)}</b><small>${p.mid != null ? fmtCLP(p.mid * fx) : ''}</small></div></div>
    <p class="muted tiny">Market = promedio de ventas recientes. Las otras dos son precios publicados hoy (lo que piden, no lo que se pagó).</p>` : ''}`;
}

// Price history sheet: TCGplayer daily market (workflow) + what this phone recorded + Cardmarket averages.
export async function openPriceHistory(card, prices, variant) {
  const body = h(`<div class="hist"><div class="loading">Cargando historial…</div></div>`);
  const s = openSheet({ title: 'Historial de precio', body, cls: 'tall' });
  const pid = prices.tp?.[variant]?.pid;
  const remote = await getHistory(pid, variant).catch(() => []);
  const local = (state.priceHist[`${card.id}|${variant}`] || []).map(([d, v]) => ({ d, v }));
  const byDay = new Map(local.map((p) => [p.d, p.v]));
  remote.forEach((p) => byDay.set(p.d, p.v)); // the workflow's daily value wins over the phone's
  const all = [...byDay.entries()].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d));
  const fx = state.fx.usdclp;
  let range = 'all';
  const cm = prices.cm;
  const cmRow = (lbl, eur) => (eur != null ? `<div><span>${lbl}</span><b>€${eur.toFixed(2)}</b><small>≈ ${fmtCLP(eurToCLP(eur))}</small></div>` : '');
  const change = (pts, days) => {
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1];
    const from = new Date(new Date(last.d + 'T12:00:00').getTime() - days * 86400000).toISOString().slice(0, 10);
    const ref = [...pts].reverse().find((p) => p.d <= from);
    return ref ? last.v / ref.v - 1 : null;
  };
  const paint = () => {
    const from = range === 'all' ? '' : new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10);
    const pts = all.filter((p) => p.d >= from);
    const c7 = change(all, 7), c30 = change(all, 30);
    body.innerHTML = `
      <div class="hist-head">
        <img src="${esc(img(card.image))}" alt="" onerror="this.src='icons/card-back.svg'">
        <div><b>${esc(card.name)}</b><div class="muted small">${esc(card.setName)} · ${esc(card.number)} · ${esc(variantLabel(variant))}</div></div>
      </div>
      <div class="panel-head"><h2>TCGplayer market (USD)</h2><div class="seg small ranges">${[['30', '1M'], ['90', '3M'], ['all', 'Todo']].map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${pts.length ? `<div class="chart-box hist-chart"></div>` : `<div class="empty"><p>Todavía no hay puntos guardados para esta carta.</p></div>`}
      <div class="kv2">
        <div><span>Cambio 7 días</span><b class="${c7 == null ? '' : pctClass(c7)}">${c7 == null ? '—' : `${arrow(c7)} ${fmtPct(c7)}`}</b></div>
        <div><span>Cambio 30 días</span><b class="${c30 == null ? '' : pctClass(c30)}">${c30 == null ? '—' : `${arrow(c30)} ${fmtPct(c30)}`}</b></div>
      </div>
      <p class="muted tiny">${all.length ? `${all.length} punto${all.length === 1 ? '' : 's'} desde el ${esc(fmtDate(all[0].d))}. ` : ''}El historial diario de TCGplayer se empezó a guardar el 08-10-2026 (cartas desde US$5) y suma un punto por día; lo que consultas en este teléfono también se agrega. TCGplayer no publica historial anterior: para eso usa su página.</p>
      ${cm ? `<h2>Cardmarket · Europa (EUR)</h2><div class="kv2 kv4">${cmRow('Promedio 30 días', cm.avg30)}${cmRow('Promedio 7 días', cm.avg7)}${cmRow('Promedio ayer', cm.avg1 ?? null)}${cmRow('Tendencia', cm.trend)}</div>` : ''}
      <a class="btn ghost full" target="_blank" rel="noopener" href="${esc(tcgplayerUrl(prices, variant, card))}">Ver gráfico completo en TCGplayer ↗</a>`;
    const box = $('.hist-chart', body);
    if (box) requestAnimationFrame(() => renderPriceChart(box, pts, { fmt: (v) => fmtUSD(v), fmtAlt: (v) => fmtCLP(v * fx) }));
    $$('.ranges button', body).forEach((b) => (b.onclick = () => ((range = b.dataset.r), paint())));
  };
  paint();
  return s;
}

export async function openCardSheet(cardId, { onPick, pickLabel = 'Agregar al intercambio', ask } = {}) {
  const body = h(`<div class="card-detail"><div class="loading">Cargando precios…</div></div>`);
  const s = openSheet({ title: 'Carta', body, cls: 'tall' });
  let data;
  try {
    data = await getCard(cardId, { fresh: navigator.onLine });
  } catch (e) {
    body.innerHTML = `<div class="empty"><p>No pude cargar la carta. ¿Estás sin conexión?</p></div>`;
    return;
  }
  const { card, prices } = data;
  setPrice(card.id, prices);
  // Every card you look at adds a point to this phone's own price history.
  for (const [k, v] of Object.entries(prices.tp || {})) pushHist(`${card.id}|${k}`, v?.market ?? v?.mid ?? null);
  save({ silent: true });
  const r = rarityInfo(card.rarity);
  const owned = ownedCount(card.id);
  const inWish = !!state.wishlist[card.id];
  let variant = card.variants.find((v) => prices.tp?.[v]?.market != null) || card.variants[0] || 'normal';
  let askCur = 'CLP';

  body.innerHTML = `
    <div class="cd-top">
      <img class="cd-img" src="${esc(img(card.image, 'high'))}" alt="${esc(card.name)}" onerror="this.src='icons/card-back.svg'">
      <div class="cd-info">
        <h3>${esc(card.name)}</h3>
        <div class="muted">${esc(card.setName)} · ${esc(card.number)}/${esc(card.total ?? '?')}</div>
        <div class="rline">${raritySymbol(r.key, 20)} <span>${esc(r.label)}</span>${r.jp ? `<em class="jp">${esc(r.jp)}</em>` : ''}</div>
        ${card.illustrator ? `<div class="muted small">Ilustración: ${esc(card.illustrator)}</div>` : ''}
        ${owned ? `<div class="owned-pill">Tienes ${owned} en tu vault</div>` : ''}
      </div>
    </div>
    ${card.variants.length > 1 ? `<div class="seg variants">${card.variants.map((v) => `<button data-v="${esc(v)}" class="${v === variant ? 'on' : ''}">${esc(variantLabel(v))}</button>`).join('')}</div>` : ''}
    <div class="prices"></div>
    <div class="deal">
      <div class="label">¿Cuánto piden en la feria?</div>
      <div class="money-in">
        <input class="input ask" inputmode="decimal" placeholder="0" value="${ask ? esc(ask) : ''}">
        <div class="seg cur"><button data-c="CLP" class="on">CLP</button><button data-c="USD">USD</button></div>
      </div>
      <div class="verdict"></div>
    </div>
    <div class="btn-col">
      ${onPick ? `<button class="btn primary pick">${esc(pickLabel)}</button>` : `<button class="btn primary buy">Registrar compra</button>`}
      <div class="btn-row">
        <button class="btn ghost wish">${inWish ? '♥ En wishlist' : '♡ Wishlist'}</button>
        <a class="btn ghost tcgp" target="_blank" rel="noopener" href="${esc(tcgplayerUrl(prices, variant, card))}">TCGplayer ↗</a>
      </div>
    </div>
    <p class="muted tiny">Precios ${prices.src === 'pokemontcg.io' ? 'vía pokemontcg.io' : prices.src === 'tcgcsv' ? `TCGplayer vía TCGCSV (TCGdex aún no los tiene) · del ${esc(fmtDate(String(prices.srcUpdated || '').slice(0, 10)))}` : 'vía TCGdex'} · consultados ${timeAgo(state.prices[card.id]?.at)} · TC ${fmtCLP(state.fx.usdclp)}${card.printed && !String(card.printed).startsWith(String(card.number)) ? ` · impreso ${esc(card.printed)}` : ''}</p>`;

  const pricesEl = $('.prices', body);
  const verdictEl = $('.verdict', body);
  const askIn = $('.ask', body);
  const renderPrices = () => {
    pricesEl.innerHTML = priceTable(prices, variant);
    $('.hist-open', pricesEl)?.addEventListener('click', () => openPriceHistory(card, prices, variant));
    $('.tcgp', body).href = tcgplayerUrl(prices, variant, card);
  };
  const renderVerdict = () => {
    const amount = parseAmount(askIn.value, askCur);
    const m = prices.tp?.[variant]?.market ?? marketUSD(card.id, variant);
    if (!amount || !m) return (verdictEl.innerHTML = m ? '' : `<p class="muted small">Sin precio de mercado para comparar.</p>`);
    const v = dealVerdict(toUSD(amount, askCur), m);
    verdictEl.innerHTML = `
      <div class="verdict-box ${v.cls}">
        <div class="vb-label">${v.label}</div>
        <div class="vb-main">${v.off >= 0 ? `${fmtPct(v.off, { sign: false })} bajo mercado` : `${fmtPct(-v.off, { sign: false })} sobre mercado`}</div>
        <div class="vb-sub">Si la revendes a mercado: <b class="${pctClass(v.profitUSD)}">${money(v.profitUSD, { sign: true })}</b></div>
        ${v.belowRange ? `<div class="vb-warn">Ojo: vale menos de ${fmtUSD(state.settings.minUSD)} (bajo tu rango objetivo).</div>` : ''}
      </div>`;
  };
  renderPrices();
  renderVerdict();

  $$('.variants button', body).forEach((b) => (b.onclick = () => {
    variant = b.dataset.v;
    $$('.variants button', body).forEach((x) => x.classList.toggle('on', x === b));
    renderPrices();
    renderVerdict();
  }));
  $$('.cur button', body).forEach((b) => (b.onclick = () => {
    askCur = b.dataset.c;
    $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b));
    renderVerdict();
  }));
  askIn.oninput = renderVerdict;

  $('.wish', body).onclick = (e) => {
    if (state.wishlist[card.id]) delete state.wishlist[card.id];
    else state.wishlist[card.id] = { id: card.id, name: card.name, setName: card.setName, number: card.number, total: card.total, rarity: card.rarity, image: card.image, addedAt: Date.now() };
    save();
    e.target.textContent = state.wishlist[card.id] ? '♥ En wishlist' : '♡ Wishlist';
  };
  $('.buy', body)?.addEventListener('click', () => {
    s.close();
    openBuyForm(card, prices, { variant, ask: parseAmount(askIn.value, askCur) || '', askCur });
  });
  $('.pick', body)?.addEventListener('click', () => {
    s.close();
    onPick({ card, prices, variant });
  });
}

// ───────────────────────── exchange rate for an operation date

// Today → latest saved/fetched rate. Past date → dólar observado of that day (mindicador),
// falling back to today's rate with a visible note when it can't be fetched.
function fxForDate(body, onUpdate) {
  const label = $('.fxl', body);
  const dateIn = $('.date', body);
  let cur = { usdclp: state.fx.usdclp, src: state.fx.src, at: state.fx.at };
  const paint = () => {
    const stale = !cur.at && !cur.past;
    label.innerHTML = `TC ${fmtCLP(cur.usdclp)} · ${esc(cur.src)}${cur.past ? '' : ` · ${timeAgo(cur.at)}`}${stale ? ' <b class="neg">· sin actualizar, revisa o fíjalo en Ajustes</b>' : ''}${cur.note ? ` <b class="neg">· ${esc(cur.note)}</b>` : ''}`;
  };
  const load = async (force = false) => {
    const d = dateIn?.value || localDate();
    label.textContent = 'Buscando tipo de cambio…';
    if (d < localDate()) {
      const h = await fxOn(d);
      cur = h ? { usdclp: h.usdclp, src: h.src, past: true } : { usdclp: state.fx.usdclp, src: state.fx.src, at: state.fx.at, note: 'no encontré el de esa fecha, uso el actual' };
    } else {
      await refreshFx({ force });
      cur = { usdclp: state.fx.usdclp, src: state.fx.src, at: state.fx.at };
    }
    paint();
    onUpdate?.();
  };
  const get = () => cur.usdclp;
  get.ready = Promise.resolve();
  const run = (force) => (get.ready = load(force));
  dateIn?.addEventListener('change', () => run());
  $('.fxr', body)?.addEventListener('click', () => run(true));
  paint();
  run();
  return get;
}

// ───────────────────────── buy

export function openBuyForm(card, prices, { variant, ask = '', askCur = 'CLP' } = {}) {
  const purpose = defaultPurpose(card.rarity);
  const body = h(`
    <form class="form">
      <div class="mini-card">${cardTile(card)}</div>
      ${card.variants.length > 1 ? `<label class="field"><span>Versión</span><select class="input variant">${card.variants.map((v) => `<option value="${esc(v)}" ${v === variant ? 'selected' : ''}>${esc(variantLabel(v))}${prices.tp?.[v]?.market ? ` · ${fmtUSD(prices.tp[v].market)}` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Precio pagado (por unidad)</span>
        <div class="money-in"><input class="input price" inputmode="decimal" required placeholder="0" value="${ask ? (askCur === 'CLP' ? Math.round(ask) : ask) : ''}">
        <div class="seg cur"><button type="button" data-c="CLP" class="${askCur === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${askCur === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <div class="fxline muted small"><span class="fxl"></span> <button type="button" class="link fxr">actualizar</button></div>
      <div class="row2">
        <label class="field"><span>Cantidad</span><input class="input qty" type="number" min="1" max="50" value="1" inputmode="numeric"></label>
        <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      </div>
      <div class="field"><span>Destino</span>
        <div class="seg purpose"><button type="button" data-p="reventa" class="${purpose === 'reventa' ? 'on' : ''}">Para revender</button><button type="button" data-p="coleccion" class="${purpose === 'coleccion' ? 'on' : ''}">Para mi colección</button></div>
      </div>
      <label class="field"><span>Dónde / nota</span><input class="input notes" placeholder="Ej: Feria Persa Bío Bío, puesto 12"></label>
      <div class="buy-sum"></div>
      <button class="btn primary" type="submit">Guardar en el vault</button>
    </form>`);
  const s = openSheet({ title: 'Registrar compra', body, cls: 'tall' });
  let cur = askCur, dest = purpose;
  const priceIn = $('.price', body);
  const sum = $('.buy-sum', body);
  const getVariant = () => $('.variant', body)?.value || variant || card.variants[0];
  let fxNow = () => state.fx.usdclp;
  const renderSum = () => {
    const amount = parseAmount(priceIn.value, cur);
    const qty = Math.max(1, parseInt($('.qty', body).value) || 1);
    if (!amount) return (sum.innerHTML = '');
    const usd = toUSD(amount, cur, fxNow()), clp = toCLP(amount, cur, fxNow());
    const m = prices.tp?.[getVariant()]?.market ?? marketUSD(card.id, getVariant());
    const v = m ? dealVerdict(usd, m) : null;
    sum.innerHTML = `
      <div class="kv"><span>Costo</span><b>${fmtCLP(clp * qty)} · ${fmtUSD(usd * qty)}</b></div>
      ${m ? `<div class="kv"><span>Mercado hoy</span><b>${fmtUSD(m * qty)} <em class="${v.cls}">${v.label}</em></b></div>` : ''}`;
  };
  $$('.cur button', body).forEach((b) => (b.onclick = () => {
    cur = b.dataset.c;
    $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b));
    renderSum();
  }));
  $$('.purpose button', body).forEach((b) => (b.onclick = () => {
    dest = b.dataset.p;
    $$('.purpose button', body).forEach((x) => x.classList.toggle('on', x === b));
  }));
  priceIn.oninput = renderSum;
  $('.qty', body).oninput = renderSum;
  $('.variant', body)?.addEventListener('change', renderSum);
  fxNow = fxForDate(body, renderSum);
  renderSum();

  body.onsubmit = async (e) => {
    e.preventDefault();
    const amount = parseAmount(priceIn.value, cur);
    if (!amount || amount <= 0) return toast('Ingresa el precio pagado', 'err');
    if (body.dataset.saving) return; // avoid a double tap saving the purchase twice
    body.dataset.saving = '1';
    body.querySelector('[type=submit]').textContent = 'Guardando…';
    await fxNow.ready; // never save with a rate that is still loading
    const v = getVariant();
    setPrice(card.id, prices);
    const created = addItems({
      card, variant: v, price: amount, currency: cur, fx: fxNow(), date: $('.date', body).value || localDate(),
      purpose: dest, notes: $('.notes', body).value.trim(), qty: Math.max(1, parseInt($('.qty', body).value) || 1),
    });
    pushHist(`${card.id}|${v}`, marketUSD(card.id, v));
    if (state.wishlist[card.id]) delete state.wishlist[card.id];
    save();
    s.close();
    toast(`${card.name} guardada en el vault${created.length > 1 ? ` (×${created.length})` : ''}`, 'ok');
  };
}

// ───────────────────────── item (owned copy)

export function openItemSheet(item) {
  const v = itemValueUSD(item);
  // Same formula as Inicio/Colección: CLP gain is measured against what you paid in pesos.
  const gainUSD = v != null ? v - item.costUSD : null;
  const gainCLP = v != null ? v * state.fx.usdclp - item.costCLP : null;
  const usdMode = disp() === 'USD';
  const gain = usdMode ? gainUSD : gainCLP;
  const gainPct = gain == null ? null : usdMode ? gainUSD / item.costUSD : gainCLP / item.costCLP;
  const fmtGain = (n) => (usdMode ? fmtUSD(n, { sign: true }) : fmtCLP(n, { sign: true }));
  const r = rarityInfo(item.rarity);
  const sold = item.status !== 'held';
  const body = h(`
    <div class="card-detail">
      <div class="cd-top">
        <img class="cd-img" src="${esc(img(item.image, 'high'))}" alt="${esc(item.name)}" onerror="this.src='icons/card-back.svg'">
        <div class="cd-info">
          <h3>${esc(item.name)}</h3>
          <div class="muted">${esc(item.setName)} · ${esc(item.number)}/${esc(item.total ?? '?')}</div>
          <div class="rline">${raritySymbol(r.key, 20)} <span>${esc(r.label)}</span></div>
          <div class="muted small">${esc(variantLabel(item.variant))}</div>
          <div class="tag ${item.purpose}">${item.purpose === 'coleccion' ? 'Colección' : 'Reventa'}</div>
        </div>
      </div>
      <div class="kvs">
        <div class="kv"><span>Pagaste</span><b>${item.buy.currency === 'CLP' ? fmtCLP(item.buy.price) : fmtUSD(item.buy.price)} <em class="muted">${item.buy.currency === 'CLP' ? fmtUSD(item.costUSD) : fmtCLP(item.costCLP)}</em></b></div>
        <div class="kv"><span>Fecha / TC</span><b>${fmtDate(item.buy.date)} · ${fmtCLP(item.buy.fx)}</b></div>
        ${item.buy.source || item.notes ? `<div class="kv"><span>Nota</span><b>${esc(item.notes || item.buy.source)}</b></div>` : ''}
        ${sold
          ? `<div class="kv"><span>${item.exit.kind === 'trade' ? 'Intercambiada por' : item.exit.feePct ? `Vendida (neto, −${item.exit.feePct}% comisión)` : 'Vendida en'}</span><b>${item.exit.currency === 'CLP' ? fmtCLP(item.exit.price) : fmtUSD(item.exit.price)} · ${fmtDate(item.exit.date)}</b></div>
             <div class="kv"><span>Resultado</span><b class="${pctClass(item.exit.clp - item.costCLP)}">${fmtCLP(item.exit.clp - item.costCLP, { sign: true })} (${fmtPct((item.exit.clp - item.costCLP) / item.costCLP)})</b></div>`
          : `<div class="kv"><span>Valor hoy</span><b>${v != null ? `${money(v)} <em class="muted">${moneyAlt(v)}</em>` : 'sin precio'}</b></div>
             ${gain != null ? `<div class="kv"><span>Ganancia</span><b class="${pctClass(gain)}">${arrow(gain)} ${fmtGain(gain)} (${fmtPct(gainPct)})</b></div>` : ''}`}
      </div>
      <div class="btn-col">
        ${sold ? '' : `<button class="btn primary sell">Registrar venta</button>
        <div class="btn-row"><button class="btn ghost toggle">${item.purpose === 'coleccion' ? 'Mover a reventa' : 'Mover a colección'}</button><button class="btn ghost prices">Ver precios</button></div>`}
        <div class="btn-row"><button class="btn ghost edit">Editar compra</button><button class="btn ghost danger del">Eliminar</button></div>
      </div>
    </div>`);
  const s = openSheet({ title: sold ? 'Carta vendida' : 'En tu vault', body, cls: 'tall' });
  $('.sell', body)?.addEventListener('click', () => (s.close(), openSellForm(item)));
  $('.prices', body)?.addEventListener('click', () => (s.close(), openCardSheet(item.cardId)));
  $('.toggle', body)?.addEventListener('click', () => {
    item.purpose = item.purpose === 'coleccion' ? 'reventa' : 'coleccion';
    save();
    s.close();
    toast(item.purpose === 'coleccion' ? 'Marcada para tu colección' : 'Marcada para reventa');
  });
  $('.edit', body).onclick = () => (s.close(), openEditBuy(item));
  $('.del', body).onclick = async () => {
    if (await confirmSheet('Eliminar carta', `¿Eliminar ${item.name} del vault? Esto no se puede deshacer.`, 'Eliminar', true)) {
      removeItem(item.id);
      s.close();
      toast('Eliminada');
    }
  };
}

function openEditBuy(item) {
  const body = h(`
    <form class="form">
      <label class="field"><span>Precio pagado</span>
        <div class="money-in"><input class="input price" inputmode="decimal" value="${item.buy.currency === 'CLP' ? Math.round(item.buy.price) : item.buy.price}">
        <div class="seg cur"><button type="button" data-c="CLP" class="${item.buy.currency === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${item.buy.currency === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <div class="row2">
        <label class="field"><span>Tipo de cambio usado</span><input class="input fx" inputmode="decimal" value="${String(item.buy.fx).replace('.', ',')}"></label>
        <label class="field"><span>Fecha</span><input class="input date" type="date" value="${esc(item.buy.date)}"></label>
      </div>
      <label class="field"><span>Nota</span><input class="input notes" value="${esc(item.notes)}"></label>
      <button class="btn primary" type="submit">Guardar cambios</button>
    </form>`);
  const s = openSheet({ title: 'Editar compra', body });
  let cur = item.buy.currency;
  $('.date', body).addEventListener('change', async (e) => {
    const h = e.target.value < localDate() ? await fxOn(e.target.value) : await refreshFx().then(() => ({ usdclp: state.fx.usdclp }));
    if (h) $('.fx', body).value = String(h.usdclp).replace('.', ',');
  });
  $$('.cur button', body).forEach((b) => (b.onclick = () => {
    cur = b.dataset.c;
    $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b));
  }));
  body.onsubmit = (e) => {
    e.preventDefault();
    const price = parseAmount($('.price', body).value, cur);
    const fx = parseAmount($('.fx', body).value, 'USD');
    if (!price || !fx) return toast('Revisa precio y tipo de cambio', 'err');
    item.buy = { ...item.buy, price, currency: cur, fx, date: $('.date', body).value };
    item.costUSD = toUSD(price, cur, fx);
    item.costCLP = toCLP(price, cur, fx);
    item.notes = $('.notes', body).value.trim();
    snapshot();
    save();
    s.close();
    toast('Compra actualizada', 'ok');
  };
}

// ───────────────────────── sell

export function openSellForm(item, { suggestCLP } = {}) {
  const v = itemValueUSD(item);
  const suggest = suggestCLP || (v ? Math.round((v * state.fx.usdclp) / 500) * 500 : '');
  const body = h(`
    <form class="form">
      <div class="mini-card">${cardTile({ ...item, id: item.cardId })}</div>
      <label class="field"><span>Precio de venta</span>
        <div class="money-in"><input class="input price" inputmode="decimal" required value="${suggest}">
        <div class="seg cur"><button type="button" data-c="CLP" class="on">CLP</button><button type="button" data-c="USD">USD</button></div></div>
      </label>
      <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      <div class="fxline muted small"><span class="fxl"></span> <button type="button" class="link fxr">actualizar</button></div>
      <div class="buy-sum"></div>
      <button class="btn primary" type="submit">Registrar venta</button>
    </form>`);
  const s = openSheet({ title: 'Vender', body });
  let cur = 'CLP';
  let fxNow = () => state.fx.usdclp;
  const sum = $('.buy-sum', body);
  const render = () => {
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return (sum.innerHTML = '');
    const fx = fxNow(), fee = state.settings.feePct / 100;
    const netCLP = toCLP(p, cur, fx) * (1 - fee), netUSD = toUSD(p, cur, fx) * (1 - fee);
    const g = netCLP - item.costCLP, gu = netUSD - item.costUSD;
    sum.innerHTML = `
      <div class="kv"><span>Tu costo</span><b>${fmtCLP(item.costCLP)} <em class="muted">${fmtUSD(item.costUSD)}</em></b></div>
      ${fee ? `<div class="kv"><span>Comisión ${state.settings.feePct}%</span><b>${fmtCLP(-toCLP(p, cur, fx) * fee)}</b></div>` : ''}
      <div class="kv"><span>Recibes</span><b>${fmtCLP(netCLP)} <em class="muted">${fmtUSD(netUSD)}</em></b></div>
      <div class="kv"><span>Ganancia</span><b class="${pctClass(g)}">${fmtCLP(g, { sign: true })} (${fmtPct(g / item.costCLP)}) <em class="muted">${fmtUSD(gu, { sign: true })}</em></b></div>`;
  };
  $$('.cur button', body).forEach((b) => (b.onclick = () => {
    cur = b.dataset.c;
    $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  $('.price', body).oninput = render;
  fxNow = fxForDate(body, render);
  render();
  body.onsubmit = async (e) => {
    e.preventDefault();
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return toast('Ingresa el precio', 'err');
    if (body.dataset.saving) return;
    body.dataset.saving = '1';
    body.querySelector('[type=submit]').textContent = 'Guardando…';
    await fxNow.ready;
    const feePct = state.settings.feePct;
    const net = p * (1 - feePct / 100);
    recordExit(item, { kind: 'sale', price: net, gross: p, feePct, currency: cur, fx: fxNow(), date: $('.date', body).value || localDate() });
    snapshot();
    save();
    s.close();
    toast('Venta registrada', 'ok');
  };
}
