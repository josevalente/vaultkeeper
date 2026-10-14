// Faltantes: pick a rarity (e.g. Illustration Rare / Special Illustration Rare) and see every
// card that exists with it, which ones you already own and what the missing ones cost.

import { esc, $, $$, fmtUSD, fmtCLP, pool, norm, openPicker } from '../util.js';
import { state } from '../store.js';
import { RARITIES, rarityByKey, raritySymbol } from '../rarity.js';
import { listByRarity, cachedQuickPrice, quickPrice, getSets, setCards } from '../api.js';
import { cardTile, openCardSheet, openSearch, openSheet, money } from '../ui.js';

const FEATURED = ['illus', 'sir', 'hyper', 'mega', 'ultra', 'shinyultra', 'shiny', 'double', 'ace', 'futur', 'classic', 'pika', 'promo'];
// by: 'rareza' (default, as before) or 'set' (one expansion, every card in it).
const ui = { rarity: 'illus', set: 'all', show: 'missing', sort: 'set', q: '', by: 'rareza', setId: '' };

// Search inside the rarity list: by name ("totodile") and/or number ("048", "48", "048/089").
const numKey = (s) => String(s || '').split('/')[0].replace(/^0+(?=\d)/, '').toUpperCase();
function matchesQuery(c, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(`${c.name} ${c.setName}`);
  return words.every((w) => hay.includes(w) || (/\d/.test(w) && numKey(c.number) === numKey(w)));
}
const lists = new Map();
let loadingPrices = false;

export function renderChecklist(root) {
  if (ui.by === 'set') return renderBySet(root);
  const r = rarityByKey(ui.rarity);
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Faltantes</h1>
      <p class="muted">Elige una rareza: te muestro todas las cartas que existen con ella, cuáles tienes y cuáles te faltan.</p>
      ${bySelect()}
    </div>
    <div class="rgrid rise" style="--d:1">
      ${FEATURED.map((k) => {
        const x = rarityByKey(k);
        return `<button class="rcard ${ui.rarity === k && ui.show !== 'wish' ? 'on' : ''}" data-r="${k}">${raritySymbol(k, 26)}<span>${esc(x.label)}</span>${x.jp ? `<em>${esc(x.jp)}</em>` : ''}</button>`;
      }).join('')}
      <button class="rcard wishbtn ${ui.show === 'wish' ? 'on' : ''}" data-wish="1"><span class="heart">♥</span><span>Wishlist</span><em>${Object.keys(state.wishlist).length}</em></button>
    </div>
    <div class="cl-body rise" style="--d:2"></div>`;

  wireBy(root);
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

// "Ver por": rarity (as always) or one expansion.
const bySelect = () => `<label class="by-row"><span>Ver por</span><select class="input small bysel"><option value="rareza" ${ui.by === 'rareza' ? 'selected' : ''}>Rareza</option><option value="set" ${ui.by === 'set' ? 'selected' : ''}>Expansión / set</option></select></label>`;
function wireBy(root) {
  $('.bysel', root).onchange = (e) => {
    ui.by = e.target.value;
    ui.q = '';
    if (ui.show === 'wish') ui.show = 'missing';
    renderChecklist(root);
  };
}

// One expansion: every card in it (all rarities), which you have and what the rest costs.
async function renderBySet(root) {
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Faltantes</h1>
      <p class="muted">Elige una expansión: te muestro todas sus cartas, cuáles tienes y cuáles te faltan.</p>
      ${bySelect()}
    </div>
    <div class="cl-sets rise" style="--d:1"><div class="loading">Cargando expansiones…</div></div>
    <div class="cl-body rise" style="--d:2"></div>`;
  wireBy(root);
  const box = $('.cl-sets', root), body = $('.cl-body', root);
  let sets;
  try {
    sets = (await getSets()).slice().sort((a, b) => b.idx - a.idx);
  } catch {
    box.innerHTML = '<div class="empty"><p>No pude cargar las expansiones. Revisa tu conexión.</p></div>';
    return;
  }
  if (!root.isConnected) return;
  // The ones you have cards from first, then all of them (newest first).
  const mine = new Set(state.items.filter((it) => it.status === 'held').map((it) => String(it.cardId).slice(0, String(it.cardId).lastIndexOf('-'))));
  if (!ui.setId || !sets.some((s) => s.id === ui.setId)) ui.setId = (sets.find((s) => mine.has(s.id)) || sets[0]).id;
  const set = sets.find((s) => s.id === ui.setId);
  // A searchable list (200+ expansions): the ones you have cards from first.
  box.innerHTML = `<div class="field"><span>Expansión</span><button class="input picker-btn setpick" aria-haspopup="dialog"><b>${esc(set.name)}</b><small>${set.total ? `${set.total} carta${set.total === 1 ? '' : 's'}` : ''}</small><em aria-hidden="true">▾</em></button></div>`;
  const item = (s, group) => ({ id: s.id, label: s.name, sub: `${s.id.toUpperCase()}${s.total ? ` · ${s.total} carta${s.total === 1 ? '' : 's'}` : ''}`, group });
  $('.setpick', box).onclick = () =>
    openPicker({
      title: 'Elegir expansión',
      openSheet,
      current: ui.setId,
      items: [...sets.filter((s) => mine.has(s.id)).map((s) => item(s, 'Con cartas en tu vault')), ...sets.map((s) => item(s, 'Todas (más recientes primero)'))],
      onPick: (id) => ((ui.setId = id), (ui.q = ''), renderBySet(root)),
    });
  const r = { key: 'set', label: set.name, api: null, logo: set.logo };
  const key = 'set:' + set.id;
  if (lists.has(key)) return renderList(body, r, lists.get(key));
  body.innerHTML = `<div class="loading">Cargando las cartas de ${esc(set.name)}…</div>`;
  setCards(set.id)
    .then((list) => {
      lists.set(key, list);
      if (ui.by === 'set' && ui.setId === set.id && body.isConnected) renderList(body, r, list);
    })
    .catch(() => (body.innerHTML = `<div class="empty"><p>No pude cargar esa expansión. Revisa tu conexión.</p></div>`));
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
  if (ui.q) list = list.filter((c) => matchesQuery(c, ui.q));
  // Nothing with these filters: say how many match in the rest of this rarity.
  const elsewhere = ui.q && !list.length ? full.filter((c) => matchesQuery(c, ui.q)).length : 0;

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
      <div class="pc-top">${r.key === 'set' ? (r.logo ? `<img class="pc-logo" src="${esc(r.logo)}.png" alt="" onerror="this.remove()">` : '') : raritySymbol(r.key, 30)}<div><b>${esc(r.label)}</b><span class="muted small">${r.key === 'set' ? `${full.length} cartas en la expansión` : ui.set === 'all' ? `${setList.length} expansiones` : esc(sets.get(ui.set).name)}</span></div></div>
      <div class="pc-num"><b>${have}</b> / ${scope.length}<span>${Math.round(pct * 100)}%</span></div>
      <div class="bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="muted small">Te faltan ${missingScope.length}${priced.length ? ` · completar costaría ~${money(priced.reduce((a, b) => a + b, 0))}${priced.length < missingScope.length ? ` (${priced.length} con precio)` : ''}` : ''}</div>
    </div>
    <input class="input cl-search" type="search" placeholder="Buscar por nombre o número (ej: Totodile, 048)" value="${esc(ui.q)}" autocomplete="off" aria-label="Buscar en ${esc(r.label)}">
    <div class="filter-row">
      <select class="input setsel small" ${r.key === 'set' ? 'hidden' : ''}>
        <option value="all">Todas las expansiones (${full.length})</option>
        ${setList.map((s) => `<option value="${esc(s.id)}" ${ui.set === s.id ? 'selected' : ''}>${esc(s.name)} — ${s.have}/${s.n}</option>`).join('')}
      </select>
      <div class="seg small show">
        <button data-s="missing" class="${ui.show === 'missing' ? 'on' : ''}">Me faltan</button>
        <button data-s="have" class="${ui.show === 'have' ? 'on' : ''}">Tengo</button>
        <button data-s="all" class="${ui.show === 'all' ? 'on' : ''}">Todas</button>
      </div>
      <select class="input sortsel small">
        ${[['set', r.key === 'set' ? 'Número' : 'Expansión (reciente)'], ['priceAsc', 'Más baratas primero'], ['priceDesc', 'Más caras primero'], ['name', 'Nombre']].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${unpriced ? `<button class="btn ghost full loadp">${loadingPrices ? 'Cargando precios…' : `Cargar precios de ${unpriced} carta${unpriced === 1 ? '' : 's'}`}</button>` : ''}
    ${ui.q && list.length ? `<p class="muted small">${list.length} resultado${list.length === 1 ? '' : 's'} para “${esc(ui.q)}”</p>` : ''}
    <div class="grid">${
      list.length
        ? list.map((c) => tile(c, owned)).join('')
        : ui.q
          ? `<div class="empty wide"><p>Nada con “${esc(ui.q)}”${ui.show === 'missing' ? ' entre las que te faltan' : ui.show === 'have' ? ' entre las que tienes' : ''}${ui.set !== 'all' ? ' en esta expansión' : ''}.</p>
              ${elsewhere ? `<button class="btn ghost widen">Ver ${elsewhere} en todas las expansiones y estados</button>` : ''}
              <button class="btn ghost anyr">Buscar “${esc(ui.q)}” en todas las cartas</button></div>`
          : `<div class="empty wide"><p>${ui.show === 'missing' ? '¡Las tienes todas! 🎉' : 'Nada aquí todavía.'}</p></div>`
    }</div>`;

  const search = $('.cl-search', body);
  search.oninput = () => {
    ui.q = search.value.trim() ? search.value : '';
    const pos = search.selectionStart;
    renderList(body, r, full);
    const s2 = $('.cl-search', body);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  $('.widen', body)?.addEventListener('click', () => ((ui.set = 'all'), (ui.show = 'all'), renderList(body, r, full)));
  $('.anyr', body)?.addEventListener('click', () => openSearch({ onPick: (c) => openCardSheet(c.id), initial: ui.q, stay: true }));

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
  return cardTile({ ...c, rarity: ui.by === 'set' ? c.rarity : rarityByKey(ui.rarity).api }, { dim: !has, badge, extra: `<div class="tile-val"><b>${p != null ? money(p) : '·'}</b></div>` });
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
