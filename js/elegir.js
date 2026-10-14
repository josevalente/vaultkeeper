// First launch: which card games does the user want to manage? Built from VAULTS, so a new game
// shows up here as soon as it's added to js/vaults.js. Nothing is selected by default.

import { VAULTS, setEnabled, goToVault, enabledVaults } from './vaults.js';

const list = document.querySelector('.choose-list');
const start = document.querySelector('.start');
const picked = new Set(enabledVaults().map((v) => v.id)); // coming back here keeps what was chosen

list.innerHTML = VAULTS.map(
  (v) => `<button class="choose-card" data-v="${v.id}" style="--vault:${v.color}" aria-pressed="false">
    <span class="cc-ico" aria-hidden="true">${v.icon}</span>
    <span class="cc-text"><b>${v.name}</b><small>${v.desc}</small></span>
    <span class="cc-check" aria-hidden="true">✓</span>
  </button>`
).join('');

const paint = () => {
  list.querySelectorAll('.choose-card').forEach((b) => {
    const on = picked.has(b.dataset.v);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const n = picked.size;
  start.disabled = !n;
  start.textContent = n ? `Empezar con ${VAULTS.filter((v) => picked.has(v.id)).map((v) => v.short).join(' + ')}` : 'Elige al menos uno';
};
list.onclick = (e) => {
  const b = e.target.closest('.choose-card');
  if (!b) return;
  picked.has(b.dataset.v) ? picked.delete(b.dataset.v) : picked.add(b.dataset.v);
  paint();
};
start.onclick = () => {
  const ids = VAULTS.map((v) => v.id).filter((id) => picked.has(id)); // keep the list's order
  setEnabled(ids);
  try {
    sessionStorage.setItem('vk:session', '1');
  } catch {}
  goToVault(ids[0]);
};
paint();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
