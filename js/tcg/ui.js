// Sheets and forms of the Magic / Yu-Gi-Oh vaults. Same look as the Pokémon vault (shared
// styles.css), own logic (js/tcg/store.js) so nothing of the Pokémon vault is touched.

import { h, esc, $, $$, swipeToClose, openImageViewer, fmtCLP, fmtUSD, fmtPct, fmtDate, localDate, parseAmount, toast, roundCLP, debounce } from '../util.js';
import { state, game, settings, usdclp, fx, fxOn, refreshFx, toUSD, toCLP, priceOf, itemValueUSD, itemGain, dealVerdict, maxPayUSD, addItems, recordSale, removeItem, save, channelById, CONDITIONS, condFactor, setPrint, GRADERS, inWish, toggleWish, setWishTarget, editBuy, knownEvents, todayEvent } from './store.js';

const CARD_BACK = 'icons/card-back.svg';
export const disp = () => settings().display;
export const money = (usd, opts) => (disp() === 'USD' ? fmtUSD(usd, opts) : fmtCLP(usd * usdclp(), opts));
export const moneyAlt = (usd, opts) => (disp() === 'USD' ? fmtCLP(usd * usdclp(), opts) : fmtUSD(usd, opts));
export const pctClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

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
  swipeToClose(wrap, close);
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

const bestUSD = (p) => Math.max(...p.finishes.map((f) => f.usd ?? -1));
export function printTile(p, { extra = '', badge = '', dim = false, itemId = '' } = {}) {
  return `
    <button class="tile ${dim ? 'dim' : ''}" data-id="${esc(p.id)}" ${itemId ? `data-item="${esc(itemId)}"` : ''}>
      <div class="tile-img"><img loading="lazy" src="${esc(p.image || CARD_BACK)}" alt="${esc(p.name)}" onerror="this.src='${CARD_BACK}'">${badge}</div>
      <div class="tile-meta">
        <div class="tile-name"><span>${esc(p.name)}</span></div>
        <div class="tile-sub">${[p.setCode && game.id === 'mtg' ? `${esc(p.setCode)} ${esc(p.number)}` : esc(p.number), esc(p.rarity)].filter(Boolean).join(' · ')}</div>
        ${extra}
      </div>
    </button>`;
}

export function itemTile(it) {
  const v = itemValueUSD(it);
  let extra;
  if (it.status !== 'held') {
    const g = it.exit.clp - it.costCLP;
    extra = `<div class="tile-val"><b>Vendida</b><em class="${pctClass(g)}">${fmtCLP(g, { sign: true })}</em></div>`;
  } else {
    const g = itemGain(it)?.pct ?? null;
    extra = `<div class="tile-val"><b>${v != null ? money(v) : '—'}</b>${g != null ? `<em class="${pctClass(g)}">${fmtPct(g, { digits: 0 })}</em>` : ''}</div>`;
  }
  const badge = (it.purpose === 'coleccion' ? '<span class="badge keep" title="Colección">★</span>' : '') + (it.graded ? `<span class="slab">${esc(it.graded.co)} ${esc(it.graded.grade)}</span>` : it.finish !== 'normal' && game.id === 'mtg' ? `<span class="slab">${esc(it.finishLabel)}</span>` : it.condition && it.condition !== 'NM' ? `<span class="slab cond">${esc(it.condition)}</span>` : '');
  return printTile({ ...it, id: it.printId }, { extra, badge, dim: it.status !== 'held', itemId: it.id });
}

// ───────────────────────── search

export function openSearch({ initial = '', onPick } = {}) {
  const body = h(`
    <div>
      <div class="search-row tcg"><input class="input q" type="search" placeholder="${esc(game.placeholder)}" value="${esc(initial)}" autocomplete="off" aria-label="Buscar carta"></div>
      <div class="results"><p class="muted small">${game.id === 'mtg' ? 'Escribe el nombre en inglés o el código del set y el número (abajo a la izquierda de la carta).' : 'Escribe el nombre en inglés o el código impreso bajo la imagen (ej. LOB-EN001).'}</p></div>
    </div>`);
  const s = openSheet({ title: `Buscar · ${game.short}`, body, cls: 'tall' });
  const q = $('.q', body), results = $('.results', body);
  let seq = 0, list = [];
  const run = debounce(async () => {
    const v = q.value.trim();
    if (v.length < 2) return;
    const my = ++seq;
    results.innerHTML = '<div class="loading">Buscando…</div>';
    try {
      list = await game.search(v);
    } catch {
      list = [];
    }
    if (my !== seq) return;
    results.innerHTML = list.length
      ? `<p class="muted small">${list.length} ${list.length === 1 ? 'impresión' : 'impresiones'} · toca la tuya</p><div class="grid grid-tight">${list.map((p) => printTile(p, { extra: `<div class="tile-val"><b>${bestUSD(p) >= 0 ? fmtUSD(bestUSD(p)) : 's/p'}</b></div>` })).join('')}</div>`
      : `<div class="empty"><p>${navigator.onLine ? 'No encontré esa carta. Revisa el nombre (en inglés) o prueba con el código.' : 'Sin conexión: la búsqueda necesita internet.'}</p></div>`;
  }, 350);
  q.oninput = run;
  results.onclick = (e) => {
    const t = e.target.closest('.tile');
    const p = t && list.find((x) => x.id === t.dataset.id);
    if (!p) return;
    if (onPick) s.close(); // picking for something else; just looking: the results stay under the card
    (onPick || openPrintSheet)(p);
  };
  setTimeout(() => q.focus(), 300);
  if (initial) run();
}

// ───────────────────────── one printing: prices, verdict at the feria, buy

const shopLink = (p) => p.link || (game.id === 'mtg' ? `https://scryfall.com/search?q=${encodeURIComponent(`!"${p.name}" e:${p.setCode} cn:${p.number}`)}` : `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(p.name + ' ' + p.setCode)}`);

export function openPrintSheet(p) {
  setPrint(p);
  save({ silent: true });
  let finish = (p.finishes.find((f) => f.usd != null) || p.finishes[0]).key;
  let askCur = 'CLP', cond = 'NM';
  const owned = state.items.filter((it) => it.status === 'held' && it.printId === p.id).length;
  const wished = inWish(p.id);
  const body = h(`
    <div class="card-detail">
      <div class="cd-top">
        <button class="cd-zoom" aria-label="Ver la imagen en grande"><img class="cd-img" src="${esc(p.imageLarge || p.image || CARD_BACK)}" alt="${esc(p.name)}" onerror="this.src='${CARD_BACK}'"><span class="zoom-hint" aria-hidden="true">⤢</span></button>
        <div class="cd-info">
          <h3>${esc(p.name)}</h3>
          <div class="muted">${esc(p.setName)}${p.number ? ` · ${esc(game.id === 'mtg' ? `${p.setCode} ${p.number}` : p.number)}` : ''}</div>
          ${p.rarity ? `<div class="rline"><span>${esc(p.rarity)}</span></div>` : ''}
          ${owned ? `<div class="owned-pill">Tienes ${owned} en tu vault</div>` : ''}
          <button class="heart-btn ${wished ? 'on' : ''}" aria-pressed="${wished}" aria-label="${wished ? 'Quitar de la wishlist' : 'Agregar a la wishlist'}">${wished ? '♥' : '♡'}</button>
        </div>
      </div>
      ${p.finishes.length > 1 ? `<div class="seg finishes">${p.finishes.map((f) => `<button data-f="${esc(f.key)}" class="${f.key === finish ? 'on' : ''}">${esc(f.label)}</button>`).join('')}</div>` : ''}
      <div class="price-hero pr"></div>
      <div class="deal">
        <div class="label">¿Cuánto piden en la feria?</div>
        <div class="money-in"><input class="input ask" inputmode="decimal" placeholder="0"><div class="seg cur"><button data-c="CLP" class="on">CLP</button><button data-c="USD">USD</button></div></div>
        <div class="verdict"></div>
        <div class="label">Estado de la carta</div>
        <div class="seg conds">${Object.keys(CONDITIONS).map((k) => `<button data-c="${k}" class="${k === 'NM' ? 'on' : ''}" title="${esc(CONDITIONS[k].label)}">${k}</button>`).join('')}</div>
        <div class="maxpay"></div>
      </div>
      <div class="btn-col">
        <button class="btn primary buy">Registrar compra</button>
        <div class="btn-row">
          <button class="btn ghost wish">${wished ? '♥ En wishlist' : '♡ Wishlist'}</button>
          <a class="btn ghost" target="_blank" rel="noopener" href="${esc(shopLink(p))}">${/tcgplayer/.test(shopLink(p)) ? 'TCGplayer' : 'Scryfall'} ↗</a>
        </div>
        <label class="field wish-target" ${wished ? '' : 'hidden'}><span>Avísame si baja de (CLP)</span><input class="input target" inputmode="numeric" placeholder="Ej: 25.000" value="${state.wishlist[p.id]?.targetCLP ? Math.round(state.wishlist[p.id].targetCLP) : ''}"></label>
      </div>
      <p class="muted tiny">${game.id === 'mtg' ? 'Precio TCGplayer (EE.UU.) vía Scryfall, se actualiza a diario.' : 'Precio de referencia de esta impresión (código + rareza) vía YGOPRODeck; revisa ventas recientes si es una carta cara.'} TC ${fmtCLP(usdclp())}.</p>
    </div>`);
  const s = openSheet({ title: p.name, body, cls: 'tall' });
  $('.cd-zoom', body).onclick = () => openImageViewer((p.imageLarge || p.image || CARD_BACK).replace('/normal/', '/large/'), p.name);
  const market = () => priceOf(p.id, finish);
  const render = () => {
    const m0 = market();
    $('.pr', body).innerHTML = m0 != null ? `<div><div class="label">${game.id === 'mtg' ? 'TCGplayer' : 'Referencia'} · ${esc(p.finishes.find((f) => f.key === finish)?.label || '')}</div><div class="big">${fmtUSD(m0)}</div><div class="muted small">${fmtCLP(m0 * usdclp())}</div></div>` : '<div><div class="label">Precio</div><div class="big">—</div><div class="muted small">Sin precio para esta versión</div></div>';
    const m = m0 == null ? null : m0 * condFactor(cond);
    const mp = maxPayUSD(m);
    const mpCLP = mp == null ? null : roundCLP(mp * usdclp(), 'floor');
    $('.maxpay', body).innerHTML = mp == null ? '' : mpCLP > 0 ? `<div class="maxpay-box"><span>Paga como máximo</span><b>${fmtCLP(mpCLP)}</b><small>para ganar ${settings().targetMargin}% al revender${cond !== 'NM' ? ` · estado ${cond} (${Math.round(condFactor(cond) * 100)}% del NM)` : ''}</small></div>` : `<div class="maxpay-box warn"><span>No conviene para revender</span><small>Con la comisión de tu canal habitual no deja ganancia a ningún precio.</small></div>`;
    const amount = parseAmount($('.ask', body).value, askCur);
    if (!amount || !m) return ($('.verdict', body).innerHTML = m ? '' : '<p class="muted small">Sin precio de mercado para comparar.</p>');
    const v = dealVerdict(toUSD(amount, askCur), m);
    $('.verdict', body).innerHTML = `
      <div class="verdict-box ${v.cls}">
        <div class="vb-label">${v.label}</div>
        <div class="vb-main">${v.off >= 0 ? `${fmtPct(v.off, { sign: false })} bajo mercado` : `${fmtPct(-v.off, { sign: false })} sobre mercado`}</div>
        <div class="vb-sub">Si la revendes a mercado: <b class="${pctClass(v.profitUSD)}">${money(v.profitUSD, { sign: true })}</b></div>
        ${mpCLP > 0 && toCLP(amount, askCur) > mpCLP ? `<div class="vb-warn">Sobre tu máximo (${fmtCLP(mpCLP)}): a este precio no llegas a tu ${settings().targetMargin}%.</div>` : ''}
      </div>`;
  };
  $$('.finishes button', body).forEach((b) => (b.onclick = () => ((finish = b.dataset.f), $$('.finishes button', body).forEach((x) => x.classList.toggle('on', x === b)), render())));
  $$('.cur button', body).forEach((b) => (b.onclick = () => ((askCur = b.dataset.c), $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b)), render())));
  $$('.conds button', body).forEach((b) => (b.onclick = () => ((cond = b.dataset.c), $$('.conds button', body).forEach((x) => x.classList.toggle('on', x === b)), render())));
  $('.ask', body).oninput = render;
  $('.buy', body).onclick = () => (s.close(), openBuyForm(p, { finish, condition: cond, ask: $('.ask', body).value, askCur }));
  // Wishlist: the heart next to the card and the button below do the same.
  const wish = () => {
    const on = toggleWish(p);
    $('.wish', body).textContent = on ? '♥ En wishlist' : '♡ Wishlist';
    const heart = $('.heart-btn', body);
    heart.textContent = on ? '♥' : '♡';
    heart.classList.toggle('on', on);
    heart.setAttribute('aria-pressed', String(on));
    heart.setAttribute('aria-label', on ? 'Quitar de la wishlist' : 'Agregar a la wishlist');
    $('.wish-target', body).hidden = !on;
    toast(on ? 'Agregada a tu wishlist ♥' : 'Quitada de tu wishlist');
    onWishChange?.();
  };
  $('.wish', body).onclick = wish;
  $('.heart-btn', body).onclick = wish;
  $('.target', body).onchange = (e) => {
    const v = parseAmount(e.target.value, 'CLP');
    setWishTarget(p.id, v);
    toast(v > 0 ? `Te aviso si baja de ${fmtCLP(v)}` : 'Aviso quitado');
  };
  render();
}
// Faltantes repaints its hearts when the wishlist changes from a card sheet.
let onWishChange = null;
export const setWishListener = (fn) => (onWishChange = fn);

// Exchange rate of the chosen date: today's, or the dólar observado of a past day.
function fxForDate(body, onUpdate) {
  const label = $('.fxl', body), dateIn = $('.date', body);
  let cur = { usdclp: usdclp(), src: fx().src };
  const load = async () => {
    const d = dateIn?.value || localDate();
    label.textContent = 'Buscando tipo de cambio…';
    if (d < localDate()) {
      const hst = await fxOn(d);
      cur = hst ? { usdclp: hst.usdclp, src: hst.src } : { usdclp: usdclp(), src: fx().src, note: 'no encontré el de esa fecha, uso el actual' };
    } else {
      await refreshFx();
      cur = { usdclp: usdclp(), src: fx().src };
    }
    label.innerHTML = `TC ${fmtCLP(cur.usdclp)} · ${esc(cur.src)}${cur.note ? ` <b class="neg">· ${esc(cur.note)}</b>` : ''}`;
    onUpdate?.();
  };
  const get = () => cur.usdclp;
  get.ready = load();
  dateIn?.addEventListener('change', () => (get.ready = load()));
  return get;
}

// The feria you're at today is proposed again; the ones you used before are suggested.
const eventInput = (value = null) => {
  const id = 'ev' + Math.random().toString(36).slice(2, 7);
  return `<label class="field"><span>Feria / evento (opcional)</span><input class="input event" list="${id}" value="${esc(value ?? todayEvent())}" placeholder="Ej: Feria Persa 12-oct" autocomplete="off"><datalist id="${id}">${knownEvents().map((e) => `<option value="${esc(e)}">`).join('')}</datalist></label>`;
};

// Graded copy (PSA, BGS…): its value is typed by you, in pesos, so it doesn't drift with the dollar.
const gradedFields = (g = null) => `
      <label class="switch"><input type="checkbox" class="is-graded" ${g ? 'checked' : ''}><span>Carta gradeada (PSA, BGS, CGC…)</span></label>
      <div class="graded-box" ${g ? '' : 'hidden'}>
        <div class="row2">
          <label class="field"><span>Empresa</span><select class="input g-co">${GRADERS.map((x) => `<option ${g?.co === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="field"><span>Nota</span><input class="input g-grade" inputmode="decimal" placeholder="10" value="${esc(g?.grade || '')}"></label>
        </div>
        <label class="field"><span>N° de certificado (opcional)</span><input class="input g-cert" value="${esc(g?.cert || '')}"></label>
        <label class="field"><span>Valor de la gradeada (CLP)</span><input class="input g-value" inputmode="numeric" placeholder="Revisa ventas recientes de esa nota" value="${g?.clp ? Math.round(g.clp) : ''}"></label>
        <p class="muted tiny">No hay una fuente gratuita confiable de precios de gradeadas: ingresa el valor tú (por ejemplo, ventas recientes en eBay de esa nota).</p>
      </div>`;
function readGraded(body) {
  if (!$('.is-graded', body)?.checked) return null;
  const clp = parseAmount($('.g-value', body).value, 'CLP');
  return { co: $('.g-co', body).value, grade: $('.g-grade', body).value.trim(), cert: $('.g-cert', body).value.trim(), clp: clp > 0 ? clp : null };
}
const wireGraded = (body) => $('.is-graded', body)?.addEventListener('change', (e) => ($('.graded-box', body).hidden = !e.target.checked));

export function openBuyForm(p, { finish, condition = 'NM', ask = '', askCur = 'CLP' } = {}) {
  const body = h(`
    <form class="form">
      <div class="mini-card">${printTile(p)}</div>
      ${p.finishes.length > 1 ? `<label class="field"><span>Versión</span><select class="input finish">${p.finishes.map((f) => `<option value="${esc(f.key)}" ${f.key === finish ? 'selected' : ''}>${esc(f.label)}${f.usd != null ? ` · ${fmtUSD(f.usd)}` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Precio pagado (por unidad)</span>
        <div class="money-in"><input class="input price" inputmode="decimal" required placeholder="0" value="${esc(ask)}"><div class="seg cur"><button type="button" data-c="CLP" class="${askCur === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${askCur === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <div class="fxline muted small"><span class="fxl"></span></div>
      <div class="row2">
        <label class="field"><span>Cantidad</span><input class="input qty" type="number" min="1" max="50" value="1" inputmode="numeric"></label>
        <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      </div>
      <div class="field"><span>Estado</span><div class="seg conds">${Object.keys(CONDITIONS).map((k) => `<button type="button" data-c="${k}" class="${k === condition ? 'on' : ''}">${k}</button>`).join('')}</div></div>
      ${gradedFields()}
      <div class="field"><span>Destino</span><div class="seg purpose"><button type="button" data-p="reventa" class="on">Para revender</button><button type="button" data-p="coleccion">Para mi colección</button></div></div>
      ${eventInput()}
      <label class="field"><span>Nota</span><input class="input notes" placeholder="Ej: puesto 12, con funda"></label>
      <button class="btn primary" type="submit">Guardar en el vault</button>
    </form>`);
  const s = openSheet({ title: 'Registrar compra', body, cls: 'tall' });
  let cur = askCur, cond = condition, purpose = 'reventa';
  const seg = (sel, attr, set) => $$(`${sel} button`, body).forEach((b) => (b.onclick = () => (set(b.dataset[attr]), $$(`${sel} button`, body).forEach((x) => x.classList.toggle('on', x === b)))));
  seg('.cur', 'c', (v) => (cur = v));
  seg('.conds', 'c', (v) => (cond = v));
  seg('.purpose', 'p', (v) => (purpose = v));
  wireGraded(body);
  const rate = fxForDate(body);
  body.onsubmit = async (e) => {
    e.preventDefault();
    const price = parseAmount($('.price', body).value, cur);
    if (!price || price <= 0) return toast('Ingresa el precio pagado', 'err');
    if (body.dataset.saving) return;
    body.dataset.saving = '1';
    $('[type=submit]', body).textContent = 'Guardando…';
    await rate.ready;
    const created = addItems({ print: p, finish: $('.finish', body)?.value || finish || p.finishes[0].key, price, currency: cur, fx: rate(), date: $('.date', body).value, qty: Math.max(1, parseInt($('.qty', body).value) || 1), condition: cond, graded: readGraded(body), purpose, event: $('.event', body).value.trim(), notes: $('.notes', body).value.trim() });
    s.close();
    toast(`${p.name} guardada en el vault${created.length > 1 ? ` (×${created.length})` : ''}`, 'ok');
  };
}

// ───────────────────────── a copy you own (or sold)

export function openItemSheet(it) {
  const v = itemValueUSD(it);
  const usd = disp() === 'USD';
  const G = itemGain(it), N = itemGain(it, { net: true });
  const sold = it.status !== 'held';
  const ch = channelById(settings().defaultChannel);
  const hasFee = (ch?.feePct || 0) > 0 || (ch?.fixedCLP || 0) > 0;
  const fmtG = (g) => (usd ? fmtUSD(g.usd, { sign: true }) : fmtCLP(g.clp, { sign: true }));
  const body = h(`
    <div class="card-detail">
      <div class="cd-top">
        <button class="cd-zoom" aria-label="Ver la imagen en grande"><img class="cd-img" src="${esc(it.imageLarge || it.image || CARD_BACK)}" alt="${esc(it.name)}" onerror="this.src='${CARD_BACK}'"><span class="zoom-hint" aria-hidden="true">⤢</span></button>
        <div class="cd-info">
          <h3>${esc(it.name)}</h3>
          <div class="muted">${esc(it.setName)}${it.number ? ` · ${esc(game.id === 'mtg' ? `${it.setCode} ${it.number}` : it.number)}` : ''}</div>
          <div class="muted small">${[it.rarity, it.finishLabel !== 'Normal' ? it.finishLabel : '', it.condition !== 'NM' ? it.condition : '', it.graded ? `${it.graded.co} ${it.graded.grade}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="tag ${it.purpose === 'coleccion' ? 'coleccion' : 'reventa'}">${it.purpose === 'coleccion' ? 'Colección' : 'Reventa'}</div>
        </div>
      </div>
      <div class="kvs">
        <div class="kv"><span>Pagaste</span><b>${it.buy.currency === 'CLP' ? fmtCLP(it.buy.price) : fmtUSD(it.buy.price)} <em class="muted">${it.buy.currency === 'CLP' ? fmtUSD(it.costUSD) : fmtCLP(it.costCLP)}</em></b></div>
        <div class="kv"><span>Fecha / TC</span><b>${fmtDate(it.buy.date)} · ${fmtCLP(it.buy.fx)}</b></div>
        ${it.buy.event ? `<div class="kv"><span>Evento</span><b>${esc(it.buy.event)}</b></div>` : ''}
        ${it.notes ? `<div class="kv"><span>Nota</span><b>${esc(it.notes)}</b></div>` : ''}
        ${
          sold
            ? `<div class="kv"><span>Vendida${it.exit.channel ? ` en ${esc(channelById(it.exit.channel)?.name || it.exit.channel)}` : ''}</span><b>${it.exit.currency === 'CLP' ? fmtCLP(it.exit.price) : fmtUSD(it.exit.price)} · ${fmtDate(it.exit.date)}</b></div>
               <div class="kv"><span>Resultado</span><b class="${pctClass(it.exit.clp - it.costCLP)}">${fmtCLP(it.exit.clp - it.costCLP, { sign: true })} (${fmtPct((it.exit.clp - it.costCLP) / it.costCLP)})</b></div>`
            : `<div class="kv"><span>Valor hoy</span><b>${v != null ? `${money(v)} <em class="muted">${moneyAlt(v)}</em>` : 'sin precio'}</b></div>
               ${G ? `<div class="kv"><span>Ganancia${hasFee ? ' a mercado' : ''}</span><b class="${pctClass(G.clp)}">${fmtG(G)} (${fmtPct(G.pct)})</b></div>` : ''}
               ${G && hasFee ? `<div class="kv"><span>Si vendes en ${esc(ch?.name || 'tu canal')}</span><b class="${pctClass(N.clp)}">${fmtG(N)} (${fmtPct(N.pct)}) <em class="muted">neto de comisión</em></b></div>` : ''}`
        }
      </div>
      <div class="btn-col">
        ${sold ? '<button class="btn primary editsale">Editar venta (precio, canal, evento)</button>' : `<button class="btn primary sell">Registrar venta</button>
        <div class="btn-row"><button class="btn ghost toggle">${it.purpose === 'coleccion' ? 'Mover a reventa' : 'Mover a colección'}</button><button class="btn ghost prices">Ver precios</button></div>`}
        <div class="btn-row"><button class="btn ghost edit">Editar compra</button><button class="btn ghost danger del">Eliminar</button></div>
      </div>
    </div>`);
  const s = openSheet({ title: sold ? 'Carta vendida' : 'En tu vault', body, cls: 'tall' });
  $('.cd-zoom', body).onclick = () => openImageViewer((it.imageLarge || it.image || CARD_BACK).replace('/normal/', '/large/'), it.name);
  $('.sell', body)?.addEventListener('click', () => (s.close(), openSellForm(it)));
  $('.editsale', body)?.addEventListener('click', () => (s.close(), openSellForm(it, { edit: true })));
  $('.edit', body).onclick = () => (s.close(), openEditBuy(it));
  $('.prices', body)?.addEventListener('click', async (e) => {
    e.target.textContent = 'Cargando…';
    let p = null;
    try {
      if (navigator.onLine) p = (await game.refresh([it.printId]))[it.printId];
    } catch {}
    s.close();
    openPrintSheet(p || printOf(it));
  });
  $('.toggle', body)?.addEventListener('click', () => {
    it.purpose = it.purpose === 'coleccion' ? 'reventa' : 'coleccion';
    save();
    s.close();
  });
  $('.del', body).onclick = async () => {
    if (!(await confirmSheet('Eliminar', `¿Eliminar ${it.name} de tu vault? No se puede deshacer.`, 'Eliminar', true))) return;
    removeItem(it);
    s.close();
    toast('Eliminada', 'ok');
  };
}

// An owned copy as a print (offline, or before its prices are fetched again).
const FINISH_LABEL = { normal: 'Normal', foil: 'Foil', etched: 'Etched foil' };
function printOf(it) {
  const keys = Object.keys(state.prices[it.printId]?.f || { [it.finish]: null });
  return { id: it.printId, cardKey: it.cardKey, name: it.name, setName: it.setName, setCode: it.setCode, number: it.number, rarity: it.rarity, image: it.image, imageLarge: it.imageLarge, finishes: keys.map((k) => ({ key: k, label: k === it.finish ? it.finishLabel : FINISH_LABEL[k] || k, usd: priceOf(it.printId, k) })) };
}

function openEditBuy(it) {
  const body = h(`
    <form class="form">
      <label class="field"><span>Precio pagado</span>
        <div class="money-in"><input class="input price" inputmode="decimal" value="${it.buy.currency === 'CLP' ? Math.round(it.buy.price) : it.buy.price}"><div class="seg cur"><button type="button" data-c="CLP" class="${it.buy.currency === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${it.buy.currency === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <div class="row2">
        <label class="field"><span>Tipo de cambio usado</span><input class="input fx" inputmode="decimal" value="${String(it.buy.fx).replace('.', ',')}"></label>
        <label class="field"><span>Fecha</span><input class="input date" type="date" value="${esc(it.buy.date)}"></label>
      </div>
      <div class="field"><span>Estado</span><div class="seg conds">${Object.keys(CONDITIONS).map((k) => `<button type="button" data-c="${k}" class="${k === (it.condition || 'NM') ? 'on' : ''}">${k}</button>`).join('')}</div></div>
      ${gradedFields(it.graded)}
      ${eventInput(it.buy.event || '')}
      <label class="field"><span>Nota</span><input class="input notes" value="${esc(it.notes || '')}"></label>
      <button class="btn primary" type="submit">Guardar cambios</button>
    </form>`);
  const s = openSheet({ title: 'Editar compra', body, cls: 'tall' });
  let cur = it.buy.currency, cond = it.condition || 'NM';
  const seg = (sel, set) => $$(`${sel} button`, body).forEach((b) => (b.onclick = () => (set(b.dataset.c), $$(`${sel} button`, body).forEach((x) => x.classList.toggle('on', x === b)))));
  seg('.cur', (v) => (cur = v));
  seg('.conds', (v) => (cond = v));
  wireGraded(body);
  // A new date brings that day's dólar observado.
  $('.date', body).addEventListener('change', async (e) => {
    const r = e.target.value < localDate() ? await fxOn(e.target.value) : await refreshFx().then(() => ({ usdclp: usdclp() }));
    if (r) $('.fx', body).value = String(r.usdclp).replace('.', ',');
  });
  body.onsubmit = (e) => {
    e.preventDefault();
    const price = parseAmount($('.price', body).value, cur);
    const rate = parseAmount($('.fx', body).value, 'USD');
    if (!price || !rate) return toast('Revisa precio y tipo de cambio', 'err');
    editBuy(it, { price, currency: cur, fx: rate, date: $('.date', body).value || it.buy.date, condition: cond, graded: readGraded(body), event: $('.event', body).value, notes: $('.notes', body).value.trim() });
    s.close();
    toast('Compra actualizada', 'ok');
  };
}

export function openSellForm(it, { suggestCLP, edit = false } = {}) {
  const v = itemValueUSD(it);
  const sx = settings();
  const ex = edit ? it.exit : null; // editing: start from what was recorded
  const suggest = ex ? (ex.currency === 'USD' ? String(ex.gross).replace('.', ',') : Math.round(ex.gross)) : suggestCLP || (v ? roundCLP(v * usdclp()) : '');
  const curNow = ex?.currency || 'CLP';
  const chNow = ex ? ex.channel || '' : sx.defaultChannel;
  const body = h(`
    <form class="form">
      <div class="mini-card">${printTile({ ...it, id: it.printId })}</div>
      <label class="field"><span>Precio de venta</span>
        <div class="money-in"><input class="input price" inputmode="decimal" required value="${suggest}"><div class="seg cur"><button type="button" data-c="CLP" class="${curNow === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${curNow === 'USD' ? 'on' : ''}">USD</button></div></div>
      </label>
      <label class="field"><span>Dónde la vendes</span><select class="input channel">${ex && !sx.channels.some((c) => c.id === chNow) ? '<option value="" selected>Sin canal</option>' : ''}${sx.channels.map((c) => `<option value="${esc(c.id)}" ${c.id === chNow ? 'selected' : ''}>${esc(c.name)}${c.feePct || c.fixedCLP ? ` · ${c.feePct ? c.feePct + '%' : ''}${c.fixedCLP ? ` + ${fmtCLP(c.fixedCLP)}` : ''}` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Fecha</span><input class="input date" type="date" value="${ex?.date || localDate()}"></label>
      <div class="fxline muted small"><span class="fxl"></span></div>
      ${eventInput(ex ? ex.event || '' : null)}
      <div class="buy-sum"></div>
      <button class="btn primary" type="submit">${ex ? 'Guardar cambios' : 'Registrar venta'}</button>
    </form>`);
  const s = openSheet({ title: ex ? 'Editar venta' : 'Vender', body, cls: 'tall' });
  let cur = curNow;
  const sum = $('.buy-sum', body);
  const render = () => {
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return (sum.innerHTML = '');
    const r = rate(), ch = channelById($('.channel', body).value) || { feePct: 0, fixedCLP: 0, name: 'Sin canal' };
    const gross = toCLP(p, cur, r);
    const net = Math.max(0, gross * (1 - (ch.feePct || 0) / 100) - (ch.fixedCLP || 0));
    const g = net - it.costCLP;
    sum.innerHTML = `
      <div class="kv"><span>Tu costo</span><b>${fmtCLP(it.costCLP)}</b></div>
      ${gross !== net ? `<div class="kv"><span>Comisión ${esc(ch.name)}</span><b>${fmtCLP(net - gross)}</b></div>` : ''}
      <div class="kv"><span>Recibes</span><b>${fmtCLP(net)}</b></div>
      <div class="kv"><span>Ganancia</span><b class="${pctClass(g)}">${fmtCLP(g, { sign: true })} (${fmtPct(g / it.costCLP)})</b></div>`;
  };
  const rate = fxForDate(body, render);
  $$('.cur button', body).forEach((b) => (b.onclick = () => ((cur = b.dataset.c), $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b)), render())));
  $('.price', body).oninput = render;
  $('.channel', body).onchange = render;
  render();
  body.onsubmit = async (e) => {
    e.preventDefault();
    const p = parseAmount($('.price', body).value, cur);
    if (!p) return toast('Ingresa el precio', 'err');
    if (body.dataset.saving) return;
    body.dataset.saving = '1';
    $('[type=submit]', body).textContent = 'Guardando…';
    await rate.ready;
    recordSale(it, { gross: p, currency: cur, fx: rate(), date: $('.date', body).value, channel: $('.channel', body).value, event: $('.event', body).value.trim() });
    s.close();
    toast(ex ? 'Venta actualizada' : 'Venta registrada', 'ok');
  };
}
