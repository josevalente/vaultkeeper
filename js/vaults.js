// Vaults: one per card game, never mixed. Pokémon is the original app (index.html, its own
// storage key 'vaultkeeper:v1'); Magic and Yu-Gi-Oh live in otros.html with their own keys.
// This module only knows which vaults exist, which ones the user turned on and the last one
// opened — it never reads or writes the cards of any vault except to count them.

export const VAULTS = [
  { id: 'pokemon', name: 'Pokémon', short: 'Pokémon', key: 'vaultkeeper:v1', href: 'index.html#/inicio', icon: '◓' },
  { id: 'mtg', name: 'Magic: The Gathering', short: 'Magic', key: 'vaultkeeper:mtg:v1', href: 'otros.html?juego=mtg', icon: '✺' },
  { id: 'ygo', name: 'Yu-Gi-Oh!', short: 'Yu-Gi-Oh', key: 'vaultkeeper:ygo:v1', href: 'otros.html?juego=ygo', icon: '◬' },
];
const ENABLED = 'vaultkeeper:vaults';
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

export const vaultById = (id) => VAULTS.find((v) => v.id === id) || VAULTS[0];

// Turned-on vaults (Pokémon always). A vault with any record (even only sales) stays visible.
export function enabledVaults() {
  let on = [];
  try {
    on = JSON.parse(read(ENABLED) || '[]');
  } catch {}
  return VAULTS.filter((v) => v.id === 'pokemon' || on.includes(v.id) || hasData(v));
}
export const choseVaults = () => read(ENABLED) != null; // the first-run question was answered
export function setEnabled(ids) {
  write(ENABLED, JSON.stringify([...new Set(ids)].filter((id) => id !== 'pokemon')));
}

export const lastVault = () => read(LAST) || 'pokemon';
export const setLastVault = (id) => write(LAST, id);

// Read-only peek at a vault's storage: cards held, and whether it has any record at all.
const itemsOf = (v) => {
  try {
    return JSON.parse(read(v.key) || 'null')?.items || [];
  } catch {
    return [];
  }
};
export const countItems = (v) => itemsOf(v).filter((it) => it.status === 'held').length;
const hasData = (v) => itemsOf(v).length > 0;

export function goToVault(id) {
  setLastVault(id);
  location.href = vaultById(id).href;
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
        return `<div class="vault-row ${v.id === current ? 'on' : ''}">
          <button class="vault-go" data-v="${v.id}" ${visible ? '' : 'hidden'}><span class="vault-ico">${v.icon}</span><div><b>${v.name}</b><small>${n} carta${n === 1 ? '' : 's'} en el vault${v.id === current ? ' · abierto ahora' : ''}</small></div><em>${v.id === current ? '✓' : '›'}</em></button>
          ${v.id === 'pokemon' ? '' : `<label class="switch vault-sw"><input type="checkbox" data-v="${v.id}" ${visible ? 'checked' : ''} ${hasData(v) ? 'disabled' : ''}><span>${visible ? (hasData(v) ? 'Activo (tiene registros)' : 'Activo') : `Activar ${v.short}`}</span></label>`}
        </div>`;
      }).join('')}
      <p class="muted tiny">Cada juego tiene su propio vault: sus cartas, compras, ventas y gráfico nunca se mezclan. Los ajustes (moneda, margen, canales de venta, API key de Claude) son los mismos para todos y se cambian en el vault de Pokémon → Ajustes.</p>
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
