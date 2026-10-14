// Más: the less frequent sections, one tap away from the tab bar.

import { $, timeAgo } from '../util.js';
import { state, summary, report } from '../store.js';
import { backupNow } from '../backup.js';
import { openSheet } from '../ui.js';
import { enabledVaults, vaultListHTML, wireVaultList } from '../vaults.js';

export function renderMas(root) {
  const s = summary();
  const nEv = report().events.length;
  const lot = state.lotDraft?.items?.length || 0;
  const trade = (state.tradeDraft?.give?.length || 0) + (state.tradeDraft?.get?.length || 0);
  root.innerHTML = `
    <div class="view-head rise"><h1>Más</h1></div>
    <nav class="menu rise" style="--d:1">
      <button class="vaults"><span class="m-ico">◫</span><div><b>Vaults</b><small>${enabledVaults().length > 1 ? `${enabledVaults().map((v) => v.short).join(' · ')} — cambiar de juego` : 'Agrega otros juegos (Magic, Yu-Gi-Oh) en vaults separados'}</small></div><em>›</em></button>
      <a href="#/inventario"><span class="m-ico">⊞</span><div><b>Subir inventario</b><small>Foto de cada página de tu carpeta: reconozco las cartas y tú apruebas${state.invDraft?.items?.length ? ` · ${state.invDraft.items.length} en revisión` : ''}</small></div><em>›</em></a>
      <a href="#/lote"><span class="m-ico">▦</span><div><b>Lote</b><small>Varias cartas a la vez: valor total y oferta máxima${lot ? ` · ${lot} en curso` : ''}</small></div><em>›</em></a>
      <a href="#/intercambio"><span class="m-ico">⇄</span><div><b>Intercambio</b><small>Tus cartas vs. las del otro, valorizadas${trade ? ` · ${trade} en curso` : ''}</small></div><em>›</em></a>
      <a href="#/reporte"><span class="m-ico">∑</span><div><b>Reporte y gastos</b><small>Ganancia neta por mes, feria y canal · exportar a Excel${s.expensesCLP ? '' : ''}</small></div><em>›</em></a>
      <a href="#/eventos"><span class="m-ico">⚑</span><div><b>Eventos</b><small>${nEv ? `${nEv} feria${nEv === 1 ? '' : 's'} · resultado de cada una, renombrar o unir` : 'Resultado por feria: compras, ventas y gastos'}</small></div><em>›</em></a>
      <button class="backup"><span class="m-ico">☁</span><div><b>Respaldar en iCloud</b><small>${state.settings.lastBackup ? `Último: ${timeAgo(state.settings.lastBackup)}` : 'Aún no tienes respaldo'}</small></div><em>›</em></button>
      <a href="#/ajustes"><span class="m-ico">⚙</span><div><b>Ajustes</b><small>Moneda, canales de venta, margen, Claude, datos</small></div><em>›</em></a>
    </nav>`;
  $('.backup', root).onclick = () => backupNow();
  $('.vaults', root).onclick = () => openVaults(() => renderMas(root));
}

// Pokémon, Magic, Yu-Gi-Oh: separate vaults, never mixed. Switch or turn them on here.
export function openVaults(onChange) {
  const body = document.createElement('div');
  const paint = () => {
    body.innerHTML = vaultListHTML('pokemon');
    wireVaultList(body, 'pokemon', { onToggle: () => (paint(), onChange?.()) });
  };
  paint();
  openSheet({ title: 'Vaults', body });
}
