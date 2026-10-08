// Shared UI: bottom sheets, card tiles, card detail, buy/sell forms, search, scan flow.

import { h, esc, $, $$, fmtCLP, fmtUSD, fmtPct, fmtDate, localDate, parseAmount, toast, debounce, timeAgo } from './util.js';
import { state, save, addItems, recordExit, removeItem, snapshot, ownedCount, marketUSD, setPrice, pushHist, dealVerdict, defaultPurpose, toUSD, toCLP, itemValueUSD } from './store.js';
import { getCard, img, variantLabel, tcgplayerUrl, searchByName, findByNumber } from './api.js';
import { rarityInfo, raritySymbol } from './rarity.js';
import { refreshFx } from './fx.js';
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

function priceTable(prices, variant) {
  const p = prices.tp?.[variant];
  const fx = state.fx.usdclp;
  const cm = prices.cm;
  const mom = cm?.avg7 && cm?.avg30 ? cm.avg7 / cm.avg30 - 1 : null;
  if (!p && !cm) return `<div class="empty small"><p>Sin precio de mercado para esta carta.</p></div>`;
  return `
    <div class="price-hero">
      <div><div class="label">TCGplayer market</div><div class="big">${p?.market != null ? fmtUSD(p.market) : '—'}</div><div class="muted">${p?.market != null ? fmtCLP(p.market * fx) : ''}</div></div>
      ${cm ? `<div class="cm"><div class="label">Cardmarket</div><div>€${(cm.trend ?? cm.avg ?? 0).toFixed(2)}</div>${mom != null ? `<div class="${pctClass(mom)} small">${arrow(mom)} ${fmtPct(mom)} 7d/30d</div>` : ''}</div>` : ''}
    </div>
    ${p ? `<div class="kv3"><div><span>Bajo</span><b>${fmtUSD(p.low)}</b></div><div><span>Medio</span><b>${fmtUSD(p.mid)}</b></div><div><span>Alto</span><b>${fmtUSD(p.high)}</b></div></div>` : ''}`;
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
        <a class="btn ghost" target="_blank" rel="noopener" href="${esc(tcgplayerUrl(prices, variant, card))}">TCGplayer ↗</a>
      </div>
    </div>
    <p class="muted tiny">Precios ${prices.src === 'pokemontcg.io' ? 'vía pokemontcg.io' : 'vía TCGdex'} · actualizados ${timeAgo(state.prices[card.id]?.at)} · TC ${fmtCLP(state.fx.usdclp)}</p>`;

  const pricesEl = $('.prices', body);
  const verdictEl = $('.verdict', body);
  const askIn = $('.ask', body);
  const renderPrices = () => (pricesEl.innerHTML = priceTable(prices, variant));
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

// ───────────────────────── buy

export function openBuyForm(card, prices, { variant, ask = '', askCur = 'CLP' } = {}) {
  const fxLabel = () => `TC ${fmtCLP(state.fx.usdclp)} · ${esc(state.fx.src)} · ${timeAgo(state.fx.at)}`;
  const purpose = defaultPurpose(card.rarity);
  const body = h(`
    <form class="form">
      <div class="mini-card">${cardTile(card)}</div>
      ${card.variants.length > 1 ? `<label class="field"><span>Versión</span><select class="input variant">${card.variants.map((v) => `<option value="${esc(v)}" ${v === variant ? 'selected' : ''}>${esc(variantLabel(v))}${prices.tp?.[v]?.market ? ` · ${fmtUSD(prices.tp[v].market)}` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Precio pagado (por unidad)</span>
        <div class="money-in"><input class="input price" inputmode="decimal" required placeholder="0" value="${ask ? (askCur === 'CLP' ? Math.round(ask) : ask) : ''}">
        <div class="seg cur"><button type="button" data-c="CLP" class="${askCur === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${askCur === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <div class="fxline muted small"><span class="fxl">${fxLabel()}</span> <button type="button" class="link fxr">actualizar</button></div>
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
  const renderSum = () => {
    const amount = parseAmount(priceIn.value, cur);
    const qty = Math.max(1, parseInt($('.qty', body).value) || 1);
    if (!amount) return (sum.innerHTML = '');
    const usd = toUSD(amount, cur), clp = toCLP(amount, cur);
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
  const doFx = async (force) => {
    $('.fxl', body).textContent = 'Actualizando tipo de cambio…';
    await refreshFx({ force });
    $('.fxl', body).innerHTML = fxLabel();
    renderSum();
  };
  $('.fxr', body).onclick = () => doFx(true);
  doFx(false);
  renderSum();

  body.onsubmit = (e) => {
    e.preventDefault();
    const amount = parseAmount(priceIn.value, cur);
    if (!amount || amount <= 0) return toast('Ingresa el precio pagado', 'err');
    const v = getVariant();
    setPrice(card.id, prices);
    const created = addItems({
      card, variant: v, price: amount, currency: cur, date: $('.date', body).value || localDate(),
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
  const gain = v != null ? v - item.costUSD : null;
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
          ? `<div class="kv"><span>${item.exit.kind === 'trade' ? 'Intercambiada por' : 'Vendida en'}</span><b>${item.exit.currency === 'CLP' ? fmtCLP(item.exit.price) : fmtUSD(item.exit.price)} · ${fmtDate(item.exit.date)}</b></div>
             <div class="kv"><span>Resultado</span><b class="${pctClass(item.exit.clp - item.costCLP)}">${fmtCLP(item.exit.clp - item.costCLP, { sign: true })} (${fmtPct((item.exit.clp - item.costCLP) / item.costCLP)})</b></div>`
          : `<div class="kv"><span>Valor hoy</span><b>${v != null ? `${money(v)} <em class="muted">${moneyAlt(v)}</em>` : 'sin precio'}</b></div>
             ${gain != null ? `<div class="kv"><span>Ganancia</span><b class="${pctClass(gain)}">${arrow(gain)} ${money(gain, { sign: true })} (${fmtPct(gain / item.costUSD)})</b></div>` : ''}`}
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
      <div class="buy-sum"></div>
      <button class="btn primary" type="submit">Registrar venta</button>
    </form>`);
  const s = openSheet({ title: 'Vender', body });
  let cur = 'CLP';
  const sum = $('.buy-sum', body);
  const render = () => {
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return (sum.innerHTML = '');
    const clp = toCLP(p, cur), fee = state.settings.feePct / 100;
    const net = clp * (1 - fee);
    const g = net - item.costCLP;
    sum.innerHTML = `
      <div class="kv"><span>Tu costo</span><b>${fmtCLP(item.costCLP)}</b></div>
      ${fee ? `<div class="kv"><span>Comisión ${state.settings.feePct}%</span><b>${fmtCLP(-clp * fee)}</b></div>` : ''}
      <div class="kv"><span>Ganancia</span><b class="${pctClass(g)}">${fmtCLP(g, { sign: true })} (${fmtPct(g / item.costCLP)})</b></div>`;
  };
  $$('.cur button', body).forEach((b) => (b.onclick = () => {
    cur = b.dataset.c;
    $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  $('.price', body).oninput = render;
  render();
  body.onsubmit = (e) => {
    e.preventDefault();
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return toast('Ingresa el precio', 'err');
    const net = p * (1 - state.settings.feePct / 100);
    recordExit(item, { kind: 'sale', price: net, currency: cur, date: $('.date', body).value || localDate() });
    snapshot();
    save();
    s.close();
    toast('Venta registrada', 'ok');
  };
}
