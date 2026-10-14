// Faltantes for the Magic / Yu-Gi-Oh vaults, with the dimensions each game's collectors use most:
//  · by expansion / set (complete it) — the default;
//  · by rarity (Mítica, Starlight, Quarter Century…) across the recent main sets;
//  · Magic also filters by special frame (Borderless, Showcase, Extended art).
// Same look as the Pokémon Faltantes; which ones you have comes from this vault only.

import { $, $$, esc, fmtUSD, norm, openPicker } from '../util.js';
import { state, game } from './store.js';
import { printTile, openPrintSheet, openSheet, money } from './ui.js';

const ui = { by: 'set', setId: '', rarity: '', show: 'missing', q: '', rar: '', treat: '', sort: 'num' };
const bestUSD = (p) => {
  const v = p.finishes.map((f) => f.usd).filter((x) => x != null);
  return v.length ? Math.min(...v) : null; // the cheapest finish: what completing it costs at least
};
const ownedIds = () => new Set(state.items.filter((it) => it.status === 'held').map((it) => it.printId));
const numKey = (p) => parseInt(String(p.number || p.setCode).replace(/^.*?(\d+)\D*$/, '$1'), 10) || 0;

export function renderFaltantes(root) {
  const keys = game.rarityKeys;
  ui.rarity ||= keys[0][0];
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Faltantes</h1>
      <p class="muted">${ui.by === 'set' ? `Elige ${game.id === 'mtg' ? 'una expansión' : 'un set'}: todas sus cartas, cuáles tienes y cuáles te faltan.` : `Elige una rareza: todas las cartas con ella ${esc(game.rarityScope)}.`}</p>
      <label class="by-row"><span>Ver por</span><select class="input small bysel"><option value="set" ${ui.by === 'set' ? 'selected' : ''}>${game.id === 'mtg' ? 'Expansión' : 'Set'}</option><option value="rareza" ${ui.by === 'rareza' ? 'selected' : ''}>Rareza</option></select></label>
    </div>
    ${ui.by === 'rareza' ? `<div class="rgrid tcg-rgrid rise" style="--d:1">${keys.map(([k, l]) => `<button class="rcard ${ui.rarity === k ? 'on' : ''}" data-r="${esc(k)}"><span>${esc(l)}</span></button>`).join('')}</div>` : '<div class="cl-sets rise" style="--d:1"><div class="loading">Cargando expansiones…</div></div>'}
    <div class="cl-body rise" style="--d:2"></div>`;
  $('.bysel', root).onchange = (e) => ((ui.by = e.target.value), (ui.q = ''), (ui.rar = ''), (ui.treat = ''), renderFaltantes(root));
  $$('.rcard', root).forEach((b) => (b.onclick = () => ((ui.rarity = b.dataset.r), (ui.q = ''), renderFaltantes(root))));
  const body = $('.cl-body', root);
  if (ui.by === 'rareza') return load(body, game.rarityCards(ui.rarity), { title: keys.find(([k]) => k === ui.rarity)?.[1] || ui.rarity, sub: game.rarityScope, mode: 'rareza' });
  renderSetPicker(root, body);
}

async function renderSetPicker(root, body) {
  const box = $('.cl-sets', root);
  let sets;
  try {
    sets = await game.sets();
  } catch {
    box.innerHTML = '<div class="empty"><p>No pude cargar la lista. Revisa tu conexión.</p></div>';
    return;
  }
  if (!root.isConnected) return;
  // Sets you have cards from first.
  const mine = new Set(state.items.filter((it) => it.status === 'held').map((it) => (game.id === 'mtg' ? String(it.setCode || '').toLowerCase() : it.setName)));
  if (!ui.setId || !sets.some((x) => x.id === ui.setId)) ui.setId = (sets.find((x) => mine.has(x.id)) || sets[0]).id;
  const set = sets.find((x) => x.id === ui.setId);
  // A searchable list (Yu-Gi-Oh has 1.000+ sets): by name or code, the ones you have cards from first.
  const word = game.id === 'mtg' ? 'expansión' : 'set';
  box.innerHTML = `<div class="field"><span>${game.id === 'mtg' ? 'Expansión' : 'Set'}</span><button class="input picker-btn setpick" aria-haspopup="dialog"><b>${esc(set.name)}</b><small>${[set.code, `${set.count} carta${set.count === 1 ? '' : 's'}`, set.date?.slice(0, 4)].filter(Boolean).map(esc).join(' · ')}</small><em aria-hidden="true">▾</em></button></div>`;
  const item = (x, group) => ({ id: x.id, label: x.name, sub: [x.code, `${x.count} carta${x.count === 1 ? '' : 's'}`, x.date?.slice(0, 4)].filter(Boolean).join(' · '), group });
  $('.setpick', box).onclick = () =>
    openPicker({
      title: `Elegir ${word}`,
      openSheet,
      current: ui.setId,
      placeholder: game.id === 'mtg' ? 'Buscar: nombre o código (ej: Duskmourn, DSK)' : 'Buscar: nombre o código (ej: Legend of Blue Eyes, LOB)',
      items: [...sets.filter((x) => mine.has(x.id)).map((x) => item(x, 'Con cartas en tu vault')), ...sets.map((x) => item(x, 'Todas (más recientes primero)'))],
      onPick: (id) => ((ui.setId = id), (ui.q = ''), (ui.rar = ''), (ui.treat = ''), renderFaltantes(root)),
    });
  load(body, game.setCards(set.id), { title: set.name, sub: `${set.code || ''}${set.date ? ` · ${set.date.slice(0, 4)}` : ''}`, mode: 'set' });
}

function load(body, promise, meta) {
  body.innerHTML = `<div class="loading">Cargando las cartas de ${esc(meta.title)}…</div>`;
  promise
    .then((list) => body.isConnected && renderList(body, list, meta))
    .catch(() => (body.innerHTML = '<div class="empty"><p>No pude cargar las cartas. Revisa tu conexión e intenta otra vez.</p></div>'));
}

function renderList(body, full, meta) {
  const owned = ownedIds();
  const scope = full.filter((p) => (!ui.rar || p.rarity === ui.rar) && (!ui.treat || p.treatment === ui.treat));
  const have = scope.filter((p) => owned.has(p.id)).length;
  let list = scope.filter((p) => (ui.show === 'missing' ? !owned.has(p.id) : ui.show === 'have' ? owned.has(p.id) : true));
  if (ui.q) {
    const words = norm(ui.q).split(/\s+/).filter(Boolean);
    list = list.filter((p) => words.every((w) => norm(`${p.name} ${p.setName} ${p.setCode} ${p.number}`).includes(w)));
  }
  const sorters = {
    num: (a, b) => (meta.mode === 'rareza' ? (b.released || '').localeCompare(a.released || '') : 0) || numKey(a) - numKey(b),
    asc: (a, b) => (bestUSD(a) ?? 1e9) - (bestUSD(b) ?? 1e9),
    desc: (a, b) => (bestUSD(b) ?? -1) - (bestUSD(a) ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[ui.sort]);
  const missing = scope.filter((p) => !owned.has(p.id));
  const priced = missing.map(bestUSD).filter((v) => v != null);
  const pct = scope.length ? have / scope.length : 0;
  // Rarest first, in the order collectors use (Mítica → Común; Starlight → Common).
  const rank = (r) => {
    const i = game.rarityKeys.findIndex(([k, l]) => k === r || l === r);
    return i < 0 ? 99 : i;
  };
  const rarities = [...new Set(full.map((p) => p.rarity).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
  const treats = game.treatments ? [...new Set(full.map((p) => p.treatment))].filter(Boolean) : [];
  const chips = (items, cur, cls, allLabel) => (items.length > 1 ? `<div class="chips-scroll ${cls}"><button class="rchip ${!cur ? 'on' : ''}" data-v=""><span>${allLabel}</span></button>${items.map((v) => `<button class="rchip ${cur === v ? 'on' : ''}" data-v="${esc(v)}"><span>${esc(v)}</span><em>${full.filter((p) => (cls === 'f-rar' ? p.rarity : p.treatment) === v).length}</em></button>`).join('')}</div>` : '');
  body.innerHTML = `
    <div class="progress-card">
      <div class="pc-top"><div><b>${esc(meta.title)}</b><span class="muted small">${esc(meta.sub || '')}</span></div></div>
      <div class="pc-num"><b>${have}</b> / ${scope.length}<span>${Math.round(pct * 100)}%</span></div>
      <div class="bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="muted small">Te faltan ${missing.length}${priced.length ? ` · completar costaría ~${money(priced.reduce((a, b) => a + b, 0))}${priced.length < missing.length ? ` (${priced.length} con precio)` : ''}` : ''}</div>
    </div>
    ${meta.mode === 'set' ? chips(rarities, ui.rar, 'f-rar', 'Todas las rarezas') : ''}
    ${chips(treats, ui.treat, 'f-treat', 'Todos los marcos')}
    <input class="input cl-search" type="search" placeholder="Buscar por nombre o número" value="${esc(ui.q)}" autocomplete="off" aria-label="Buscar">
    <div class="filter-row">
      <div class="seg small show">${[['missing', 'Me faltan'], ['have', 'Tengo'], ['all', 'Todas']].map(([k, l]) => `<button data-s="${k}" class="${ui.show === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select class="input small sortsel">${[['num', meta.mode === 'set' ? 'Número' : 'Más recientes'], ['asc', 'Más baratas primero'], ['desc', 'Más caras primero'], ['name', 'Nombre']].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${ui.q && list.length ? `<p class="muted small">${list.length} resultado${list.length === 1 ? '' : 's'}</p>` : ''}
    <div class="grid">${
      list.length
        ? list.map((p) => printTile(p, { dim: !owned.has(p.id), badge: owned.has(p.id) ? '<span class="badge have">✓</span>' : '', extra: `<div class="tile-val"><b>${bestUSD(p) != null ? fmtUSD(bestUSD(p)) : '·'}</b></div>` })).join('')
        : `<div class="empty wide"><p>${ui.q ? `Nada con “${esc(ui.q)}”.` : ui.show === 'missing' ? '¡Las tienes todas! 🎉' : 'Nada aquí todavía.'}</p></div>`
    }</div>`;
  const rerender = () => renderList(body, full, meta);
  $$('.f-rar .rchip', body).forEach((b) => (b.onclick = () => ((ui.rar = b.dataset.v), rerender())));
  $$('.f-treat .rchip', body).forEach((b) => (b.onclick = () => ((ui.treat = b.dataset.v), rerender())));
  $$('.show button', body).forEach((b) => (b.onclick = () => ((ui.show = b.dataset.s), rerender())));
  $('.sortsel', body).onchange = (e) => ((ui.sort = e.target.value), rerender());
  const search = $('.cl-search', body);
  search.oninput = () => {
    ui.q = search.value.trim() ? search.value : '';
    const pos = search.selectionStart;
    rerender();
    const s2 = $('.cl-search', body);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  $('.grid', body).onclick = (e) => {
    const t = e.target.closest('.tile');
    const p = t && full.find((x) => x.id === t.dataset.id);
    if (p) openPrintSheet(p);
  };
}
