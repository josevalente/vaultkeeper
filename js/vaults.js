// Vaults: one per card game, never mixed. Pokémon is the original app (index.html, its own
// storage key 'vaultkeeper:v1'); the other games live in otros.html with their own keys.
// This module only knows which vaults exist, which ones the user chose and the last one opened —
// it never reads or writes the cards of any vault except to count them.
//
// To add a game: one entry here (+ its adapter in js/tcg/games.js). Nothing is chosen by default:
// the first time, elegir.html asks which games the user wants to manage.

export const VAULTS = [
  { id: 'pokemon', name: 'Pokémon', short: 'Pokémon', key: 'vaultkeeper:v1', href: 'index.html#/inicio', icon: '◓', color: '#e2b33c', desc: 'Precios TCGplayer, rarezas y faltantes (IR, SIR…), lotes, intercambios, japonesas y sellados.' },
  { id: 'mtg', name: 'Magic: The Gathering', short: 'Magic', key: 'vaultkeeper:mtg:v1', href: 'otros.html?juego=mtg', icon: '✺', color: '#e8743b', desc: 'Precios TCGplayer por impresión: normal, foil y etched.' },
  { id: 'ygo', name: 'Yu-Gi-Oh!', short: 'Yu-Gi-Oh', key: 'vaultkeeper:ygo:v1', href: 'otros.html?juego=ygo', icon: '◬', color: '#a78bfa', desc: 'Precio de referencia por impresión (código + rareza).' },
];
const CHOSEN = 'vaultkeeper:juegos'; // games the user chose to manage
const LEGACY = 'vaultkeeper:vaults'; // earlier: extra games next to an always-on Pokémon
const LAST = 'vaultkeeper:lastVault';

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export const vaultById = (id) => VAULTS.find((v) => v.id === id) || null;

// Read-only peek at a vault's storage: cards held, and whether it has any record at all.
const itemsOf = (v) => {
  try {
    return JSON.parse(read(v.key) || 'null')?.items || [];
  } catch {
    return [];
  }
};
export const countItems = (v) => itemsOf(v).filter((it) => it.status === 'held').length;
export const hasData = (v) => itemsOf(v).length > 0;

// The chosen games, or null if the user hasn't chosen yet. People who used the app before this
// question existed keep what they had: Pokémon (if it has cards or they turned on other games)
// plus the games they had turned on.
function chosen() {
  try {
    const c = JSON.parse(read(CHOSEN) || 'null');
    if (Array.isArray(c)) return c;
    const legacy = JSON.parse(read(LEGACY) || 'null');
    if (Array.isArray(legacy)) return ['pokemon', ...legacy];
  } catch {}
  return VAULTS.some(hasData) ? VAULTS.filter(hasData).map((v) => v.id) : null;
}

export const choseVaults = () => chosen() != null;

// Vaults to show: the chosen ones, plus any that has records (its history never hides).
export function enabledVaults() {
  const ids = chosen() || [];
  return VAULTS.filter((v) => ids.includes(v.id) || hasData(v));
}
export function setEnabled(ids) {
  write(CHOSEN, JSON.stringify([...new Set(ids)].filter((id) => vaultById(id))));
}

export const lastVault = () => read(LAST) || enabledVaults()[0]?.id || null;
export const setLastVault = (id) => write(LAST, id);

export function goToVault(id) {
  setLastVault(id);
  location.href = vaultById(id).href;
}

// Header pill that says which vault you're in (tap = switch). Colors and names come from VAULTS.
export function vaultPillHTML(current) {
  const v = vaultById(current);
  return v ? `<span class="vp-ico" aria-hidden="true">${v.icon}</span><span class="vp-name">${v.short}</span><span class="vp-caret" aria-hidden="true">▾</span>` : '';
}
export function paintVaultPill(el, current) {
  const v = vaultById(current);
  if (!el || !v) return;
  el.innerHTML = vaultPillHTML(current);
  el.style.setProperty('--vault', v.color);
  el.setAttribute('aria-label', `Vault actual: ${v.name}. Toca para cambiar de vault`);
  document.documentElement.style.setProperty('--vault', v.color);
  document.documentElement.dataset.vault = v.id;
}

// Sheet body (HTML) listing the vaults; `current` is highlighted. The caller wires the clicks
// with wireVaultList so it works with either app's openSheet.
export function vaultListHTML(current) {
  const on = enabledVaults().map((v) => v.id);
  return `
    <div class="vault-list">
      ${VAULTS.map((v) => {
        const n = countItems(v);
        const visible = on.includes(v.id);
        const locked = hasData(v) || (visible && on.length === 1) || v.id === current; // never hide the open one, the last one or one with records
        return `<div class="vault-row ${v.id === current ? 'on' : ''}" style="--vault:${v.color}">
          <button class="vault-go" data-v="${v.id}" ${visible ? '' : 'hidden'}><span class="vault-ico">${v.icon}</span><div><b>${v.name}</b><small>${n} carta${n === 1 ? '' : 's'} en el vault${v.id === current ? ' · <strong>estás aquí</strong>' : ''}</small></div><em>${v.id === current ? '✓' : '›'}</em></button>
          <label class="switch vault-sw"><input type="checkbox" data-v="${v.id}" ${visible ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${visible ? (hasData(v) ? 'Activo (tiene registros)' : v.id === current ? 'Activo (abierto)' : 'Activo') : `Activar ${v.short}`}</span></label>
        </div>`;
      }).join('')}
      <p class="muted tiny">Cada juego tiene su propio vault: sus cartas, compras, ventas y gráfico nunca se mezclan. Los ajustes (moneda, margen, canales de venta, API key de Claude) son los mismos para todos.</p>
    </div>`;
}

export function wireVaultList(root, current, { onToggle } = {}) {
  root.querySelectorAll('.vault-go').forEach((b) => (b.onclick = () => (b.dataset.v === current ? null : goToVault(b.dataset.v))));
  root.querySelectorAll('.vault-sw input').forEach(
    (i) =>
      (i.onchange = () => {
        const ids = enabledVaults().map((v) => v.id).filter((id) => id !== i.dataset.v);
        if (i.checked) ids.push(i.dataset.v);
        setEnabled(ids);
        onToggle?.();
      })
  );
}
