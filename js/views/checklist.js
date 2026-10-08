// Faltantes: pick a rarity (e.g. Illustration Rare / Special Illustration Rare) and see every
// card that exists with it, which ones you already own and what the missing ones cost.

import { esc, $, $$, fmtUSD, fmtCLP, pool } from '../util.js';
import { state } from '../store.js';
import { RARITIES, rarityByKey, raritySymbol } from '../rarity.js';
import { listByRarity, cachedQuickPrice, quickPrice } from '../api.js';
import { cardTile, openCardSheet, money } from '../ui.js';

const FEATURED = ['illus', 'sir', 'hyper', 'mega', 'ultra', 'shinyultra', 'shiny', 'double', 'ace', 'promo'];
const ui = { rarity: 'illus', set: 'all', show: 'missing', sort: 'set' };
const lists = new Map();
let loadingPrices = false;

export function renderChecklist(root) {
  const r = rarityByKey(ui.rarity);
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Faltantes</h1>
      <p class="muted">Elige una rareza: te muestro todas las cartas que existen con ella, cuáles tienes y cuáles te faltan.</p>
    </div>
    <div class="rgrid rise" style="--d:1">
      ${FEATURED.map((k) => {
        const x = rarityByKey(k);
        return `<button class="rcard ${ui.rarity === k && ui.show !== 'wish' ? 'on' : ''}" data-r="${k}">${raritySymbol(k, 26)}<span>${esc(x.label)}</span><em>${esc(x.jp)}</em></button>`;
      }).join('')}
      <button class="rcard wishbtn ${ui.show === 'wish' ? 'on' : ''}" data-wish="1"><span class="heart">♥</span><span>Wishlist</span><em>${Object.keys(state.wishlist).length}</em></button>
    </div>
    <div class="cl-body rise" style="--d:2"></div>`;

  $$('.rcard', root).forEach((b) => (b.onclick = () => {
    if (b.dataset.wish) ui.show = 'wish';
    else {
      ui.rarity = b.dataset.r;
      ui.set = 'all';
      if (ui.show === 'wish') ui.show = 'missing';
    }
    renderChecklist(root);
  }));

  const body = $('.cl-body', root);
  if (ui.show === 'wish') return renderWish(body);

  if (lists.has(r.api)) return renderList(body, r, lists.get(r.api));
  body.innerHTML = `<div class="loading">Cargando todas las ${esc(r.label)}…</div>`;
  listByRarity(r.api)
    .then((list) => {
      lists.set(r.api, list);
      if (ui.rarity === r.key) renderList(body, r, list);
    })
    .catch(() => (body.innerHTML = `<div class="empty"><p>No pude cargar la lista. Revisa tu conexión.</p></div>`));
}

function ownedIds() {
  return new Set(state.items.filter((it) => it.status === 'held').map((it) => it.cardId));
}

function renderList(body, r, full) {
  const owned = ownedIds();
  const sets = new Map();
  full.forEach((c) => {
    const s = sets.get(c.setId) || { id: c.setId, name: c.setName, idx: c.setIdx, n: 0, have: 0 };
    s.n++;
    if (owned.has(c.id)) s.have++;
    sets.set(c.setId, s);
  });
  const setList = [...sets.values()].sort((a, b) => b.idx - a.idx);
  if (ui.set !== 'all' && !sets.has(ui.set)) ui.set = 'all';

  const scope = ui.set === 'all' ? full : full.filter((c) => c.setId === ui.set);
  const have = scope.filter((c) => owned.has(c.id)).length;
  let list = scope.filter((c) => (ui.show === 'missing' ? !owned.has(c.id) : ui.show === 'have' ? owned.has(c.id) : true));

  const price = (c) => cachedQuickPrice(c.id);
  const sorters = {
    set: (a, b) => b.setIdx - a.setIdx || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }),
    priceAsc: (a, b) => (price(a) ?? 1e9) - (price(b) ?? 1e9),
    priceDesc: (a, b) => (price(b) ?? -1) - (price(a) ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[ui.sort]);
  const missingScope = scope.filter((c) => !owned.has(c.id));
  const priced = missingScope.map(price).filter((p) => p != null);
  const unpriced = list.filter((c) => price(c) == null).length;
  const pct = scope.length ? have / scope.length : 0;

  body.innerHTML = `
    <div class="progress-card">
      <div class="pc-top">${raritySymbol(r.key, 30)}<div><b>${esc(r.label)}</b><span class="muted small">${ui.set === 'all' ? `${setList.length} expansiones` : esc(sets.get(ui.set).name)}</span></div></div>
      <div class="pc-num"><b>${have}</b> / ${scope.length}<span>${Math.round(pct * 100)}%</span></div>
      <div class="bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="muted small">Te faltan ${missingScope.length}${priced.length ? ` · completar costaría ~${money(priced.reduce((a, b) => a + b, 0))}${priced.length < missingScope.length ? ` (${priced.length} con precio)` : ''}` : ''}</div>
    </div>
    <div class="filter-row">
      <select class="input setsel small">
        <option value="all">Todas las expansiones (${full.length})</option>
        ${setList.map((s) => `<option value="${esc(s.id)}" ${ui.set === s.id ? 'selected' : ''}>${esc(s.name)} — ${s.have}/${s.n}</option>`).join('')}
      </select>
      <div class="seg small show">
        <button data-s="missing" class="${ui.show === 'missing' ? 'on' : ''}">Me faltan</button>
        <button data-s="have" class="${ui.show === 'have' ? 'on' : ''}">Tengo</button>
        <button data-s="all" class="${ui.show === 'all' ? 'on' : ''}">Todas</button>
      </div>
      <select class="input sortsel small">
        ${[['set', 'Expansión (reciente)'], ['priceAsc', 'Más baratas primero'], ['priceDesc', 'Más caras primero'], ['name', 'Nombre']].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${unpriced ? `<button class="btn ghost full loadp">${loadingPrices ? 'Cargando precios…' : `Cargar precios de ${unpriced} carta${unpriced === 1 ? '' : 's'}`}</button>` : ''}
    <div class="grid">${list.length ? list.map((c) => tile(c, owned)).join('') : `<div class="empty wide"><p>${ui.show === 'missing' ? '¡Las tienes todas! 🎉' : 'Nada aquí todavía.'}</p></div>`}</div>`;

  $('.setsel', body).onchange = (e) => ((ui.set = e.target.value), renderList(body, r, full));
  $('.sortsel', body).onchange = (e) => ((ui.sort = e.target.value), renderList(body, r, full));
  $$('.show button', body).forEach((b) => (b.onclick = () => ((ui.show = b.dataset.s), renderList(body, r, full))));
  $('.grid', body).onclick = (e) => {
    const t = e.target.closest('.tile');
    if (t) openCardSheet(t.dataset.id);
  };
  $('.loadp', body)?.addEventListener('click', async (e) => {
    if (loadingPrices) return;
    loadingPrices = true;
    const btn = e.currentTarget;
    const todo = list.filter((c) => price(c) == null);
    let done = 0;
    btn.textContent = `Cargando precios… 0/${todo.length}`;
    await pool(todo, 6, async (c) => {
      const p = await quickPrice(c.id).catch(() => null);
      done++;
      btn.textContent = `Cargando precios… ${done}/${todo.length}`;
      const el = body.querySelector(`.tile[data-id="${CSS.escape(c.id)}"] .tile-val b`);
      if (el) el.textContent = p != null ? money(p) : 's/p';
    });
    loadingPrices = false;
    if (body.isConnected) renderList(body, r, full);
  });
}

function tile(c, owned) {
  const has = owned.has(c.id);
  const p = cachedQuickPrice(c.id);
  const wish = !!state.wishlist[c.id];
  const badge = has ? `<span class="badge have">✓</span>` : wish ? `<span class="badge wish">♥</span>` : '';
  return cardTile({ ...c, rarity: rarityByKey(ui.rarity).api }, { dim: !has, badge, extra: `<div class="tile-val"><b>${p != null ? money(p) : '·'}</b></div>` });
}

function renderWish(body) {
  const owned = ownedIds();
  const list = Object.values(state.wishlist).sort((a, b) => b.addedAt - a.addedAt);
  const priced = list.map((c) => cachedQuickPrice(c.id)).filter((p) => p != null);
  body.innerHTML = `
    <div class="progress-card">
      <div class="pc-top"><span class="heart big">♥</span><div><b>Wishlist</b><span class="muted small">Cartas que quieres conseguir</span></div></div>
      <div class="muted small">${list.length} carta${list.length === 1 ? '' : 's'}${priced.length ? ` · ~${money(priced.reduce((a, b) => a + b, 0))}` : ''}</div>
    </div>
    <div class="grid">${
      list.length
        ? list.map((c) => cardTile(c, { badge: owned.has(c.id) ? `<span class="badge have">✓</span>` : '', extra: `<div class="tile-val"><b>${cachedQuickPrice(c.id) != null ? money(cachedQuickPrice(c.id)) : '·'}</b></div>` })).join('')
        : `<div class="empty wide"><p>Toca ♡ Wishlist en cualquier carta para guardarla aquí.</p></div>`
    }</div>`;
  $('.grid', body).onclick = (e) => {
    const t = e.target.closest('.tile');
    if (t) openCardSheet(t.dataset.id);
  };
}
