// Colección: every copy you own (or sold), filterable by rarity, purpose and status.

import { esc, $, $$, fmtPct, norm, fmtCLP, fmtUSD } from '../util.js';
import { state, itemValueUSD } from '../store.js';
import { RARITIES, rarityInfo } from '../rarity.js';
import { cardTile, rarityChip, money, pctClass, openItemSheet, disp } from '../ui.js';

const ui = { q: '', rarity: null, status: 'held', purpose: 'all', sort: 'value' };

export function renderCollection(root) {
  const all = state.items;
  const base = all.filter((it) => (ui.status === 'all' ? true : ui.status === 'held' ? it.status === 'held' : it.status !== 'held'));
  const counts = {};
  base.forEach((it) => {
    const k = rarityInfo(it.rarity).key;
    counts[k] = (counts[k] || 0) + 1;
  });
  const present = RARITIES.filter((r) => counts[r.key]);
  if (counts.other) present.push({ key: 'other', label: 'Otras' });

  let list = base.filter((it) => {
    if (ui.rarity && rarityInfo(it.rarity).key !== ui.rarity) return false;
    if (ui.purpose !== 'all' && it.purpose !== ui.purpose) return false;
    if (ui.q && !norm(`${it.name} ${it.setName} ${it.number}`).includes(norm(ui.q))) return false;
    return true;
  });
  const val = (it) => itemValueUSD(it) ?? it.costUSD;
  const sorters = {
    value: (a, b) => val(b) - val(a),
    gain: (a, b) => (val(b) - b.costUSD) / b.costUSD - (val(a) - a.costUSD) / a.costUSD,
    date: (a, b) => (b.buy.date || '').localeCompare(a.buy.date || '') || b.addedAt - a.addedAt,
    name: (a, b) => a.name.localeCompare(b.name),
    rarity: (a, b) => rarityInfo(b.rarity).tier - rarityInfo(a.rarity).tier,
  };
  list.sort(sorters[ui.sort]);
  const totalV = list.reduce((s, it) => s + (it.status === 'held' ? val(it) : 0), 0);

  root.innerHTML = `
    <div class="view-head rise">
      <h1>Colección</h1>
      <p class="muted">${list.length} carta${list.length === 1 ? '' : 's'}${ui.status !== 'out' ? ` · ${money(totalV)}` : ''}</p>
    </div>
    <div class="filters rise" style="--d:1">
      <input class="input" type="search" placeholder="Buscar en tu vault" value="${esc(ui.q)}">
      <div class="chips-scroll">
        <button class="rchip ${!ui.rarity ? 'on' : ''}" data-r=""><span>Todas</span><em>${base.length}</em></button>
        ${present.map((r) => rarityChip(r, { active: ui.rarity === r.key, count: counts[r.key] })).join('')}
      </div>
      <div class="filter-row">
        <div class="seg small status">
          <button data-s="held" class="${ui.status === 'held' ? 'on' : ''}">En vault</button>
          <button data-s="out" class="${ui.status === 'out' ? 'on' : ''}">Vendidas</button>
          <button data-s="all" class="${ui.status === 'all' ? 'on' : ''}">Todas</button>
        </div>
        <div class="seg small purpose">
          <button data-p="all" class="${ui.purpose === 'all' ? 'on' : ''}">Todo</button>
          <button data-p="reventa" class="${ui.purpose === 'reventa' ? 'on' : ''}">Reventa</button>
          <button data-p="coleccion" class="${ui.purpose === 'coleccion' ? 'on' : ''}">Colección</button>
        </div>
        <select class="input sort small">
          ${[['value', 'Mayor valor'], ['gain', 'Mayor ganancia %'], ['date', 'Más recientes'], ['rarity', 'Rareza'], ['name', 'Nombre']]
            .map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </div>
    </div>
    <div class="grid rise" style="--d:2">
      ${list.length ? list.map(tile).join('') : `<div class="empty wide"><p>${all.length ? 'Nada con estos filtros.' : 'Aún no tienes cartas. Toca el botón central para escanear.'}</p></div>`}
    </div>`;

  const search = $('input[type=search]', root);
  search.oninput = () => {
    ui.q = search.value;
    const pos = search.selectionStart;
    renderCollection(root);
    const s2 = $('input[type=search]', root);
    s2.focus();
    s2.setSelectionRange(pos, pos);
  };
  $$('.chips-scroll .rchip', root).forEach((b) => (b.onclick = () => ((ui.rarity = b.dataset.r || null), renderCollection(root))));
  $$('.status button', root).forEach((b) => (b.onclick = () => ((ui.status = b.dataset.s), (ui.rarity = null), renderCollection(root))));
  $$('.purpose button', root).forEach((b) => (b.onclick = () => ((ui.purpose = b.dataset.p), renderCollection(root))));
  $('.sort', root).onchange = (e) => ((ui.sort = e.target.value), renderCollection(root));
  $('.grid', root).onclick = (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    const it = state.items.find((x) => x.id === t.dataset.item);
    if (it) openItemSheet(it);
  };
}

function tile(it) {
  const v = itemValueUSD(it);
  let extra;
  if (it.status !== 'held') {
    const g = it.exit.clp - it.costCLP;
    extra = `<div class="tile-val"><b>${it.exit.kind === 'trade' ? 'Intercambiada' : 'Vendida'}</b><em class="${pctClass(g)}">${fmtCLP(g, { sign: true })}</em></div>`;
  } else {
    const usd = disp() === 'USD';
    const g = v != null ? (usd ? (v - it.costUSD) / it.costUSD : (v * state.fx.usdclp - it.costCLP) / it.costCLP) : null;
    extra = `<div class="tile-val"><b>${v != null ? money(v) : '—'}</b>${g != null ? `<em class="${pctClass(g)}">${fmtPct(g, { digits: 0 })}</em>` : ''}</div>`;
  }
  const badge = it.purpose === 'coleccion' ? `<span class="badge keep" title="Colección">★</span>` : '';
  return cardTile({ ...it, id: it.cardId, itemId: it.id }, { extra, badge, dim: it.status !== 'held' });
}
