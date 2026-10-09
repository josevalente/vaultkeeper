// Más: the less frequent sections, one tap away from the tab bar.

import { $, timeAgo } from '../util.js';
import { state, summary } from '../store.js';
import { backupNow } from '../backup.js';

export function renderMas(root) {
  const s = summary();
  const lot = state.lotDraft?.items?.length || 0;
  const trade = (state.tradeDraft?.give?.length || 0) + (state.tradeDraft?.get?.length || 0);
  root.innerHTML = `
    <div class="view-head rise"><h1>Más</h1></div>
    <nav class="menu rise" style="--d:1">
      <a href="#/lote"><span class="m-ico">▦</span><div><b>Lote</b><small>Varias cartas a la vez: valor total y oferta máxima${lot ? ` · ${lot} en curso` : ''}</small></div><em>›</em></a>
      <a href="#/intercambio"><span class="m-ico">⇄</span><div><b>Intercambio</b><small>Tus cartas vs. las del otro, valorizadas${trade ? ` · ${trade} en curso` : ''}</small></div><em>›</em></a>
      <a href="#/reporte"><span class="m-ico">∑</span><div><b>Reporte y gastos</b><small>Ganancia neta por mes, feria y canal · exportar a Excel${s.expensesCLP ? '' : ''}</small></div><em>›</em></a>
      <button class="backup"><span class="m-ico">☁</span><div><b>Respaldar en iCloud</b><small>${state.settings.lastBackup ? `Último: ${timeAgo(state.settings.lastBackup)}` : 'Aún no tienes respaldo'}</small></div><em>›</em></button>
      <a href="#/ajustes"><span class="m-ico">⚙</span><div><b>Ajustes</b><small>Moneda, canales de venta, margen, Claude, datos</small></div><em>›</em></a>
    </nav>`;
  $('.backup', root).onclick = () => backupNow();
}
