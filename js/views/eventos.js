// Eventos: every feria/event you bought, sold or spent at, with its result, and the tools to keep
// the list clean (rename, merge duplicates typed differently, remove).

import { h, esc, $, $$, fmtCLP, fmtDate, toast } from '../util.js';
import { state, report, eventKey, renameEvent, removeEvent, knownEvents } from '../store.js';
import { openSheet, cardTile, pctClass, confirmSheet, openItemSheet } from '../ui.js';
import { showEventInCollection } from './collection.js';

const when = (e) => (e.from && e.to && e.from !== e.to ? `${fmtDate(e.from)} → ${fmtDate(e.to)}` : e.from ? fmtDate(e.from) : '');

export function renderEventos(root) {
  const events = report().events.sort((a, b) => (b.to || '').localeCompare(a.to || '') || b.buys + b.sales - (a.buys + a.sales));
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Eventos</h1>
      <p class="muted">Cada feria o evento donde compraste, vendiste o tuviste gastos. Toca uno para ver qué pasó ahí, corregir su nombre o unirlo con otro.</p>
    </div>
    <section class="panel rise" style="--d:1">
      ${
        events.length
          ? `<div class="ev-list">${events
              .map(
                (e) => `<button class="ev-row" data-k="${esc(e.key)}">
              <div class="ev-main"><b>${esc(e.name)}</b><small>${[when(e), `${e.buyN} compra${e.buyN === 1 ? '' : 's'}`, `${e.saleN} venta${e.saleN === 1 ? '' : 's'}`, e.tradeN ? `${e.tradeN} trueque${e.tradeN === 1 ? '' : 's'}` : '', e.expenses ? `gastos ${fmtCLP(e.expenses)}` : ''].filter(Boolean).join(' · ')}</small></div>
              <div class="ev-val"><b class="${pctClass(e.net)}">${fmtCLP(e.net, { sign: true })}</b><small>neto</small></div>
            </button>`
              )
              .join('')}</div>`
          : `<div class="empty"><p>Aún no hay eventos. Escribe la feria al comprar, vender o anotar un gasto (por ejemplo “Feria Persa 12-oct”) y aparecerá aquí.</p></div>`
      }
    </section>`;
  $$('.ev-row', root).forEach((b) => (b.onclick = () => openEventSheet(b.dataset.k, () => renderEventos(root))));
}

function openEventSheet(key, refresh) {
  const e = report().events.find((x) => x.key === key);
  if (!e) return;
  const at = (x) => x?.event && eventKey(x.event) === key;
  const bought = state.items.filter((it) => at(it.buy));
  const sold = state.items.filter((it) => at(it.exit));
  const expenses = state.expenses.filter(at);
  const tiles = (list) => `<div class="grid grid-tight">${list.map((it) => cardTile({ ...it, id: it.cardId, itemId: it.id })).join('')}</div>`;
  const variants = Object.keys(e.names);
  const body = h(`
    <div class="form">
      <p class="muted small">${esc(when(e))}${variants.length > 1 ? ` · escrito de ${variants.length} formas: ${variants.map((v) => `“${esc(v)}”`).join(', ')}` : ''}</p>
      <div class="rep-grid">
        <div><span>Compras</span>${fmtCLP(e.buys)} <small>(${e.buyN})</small></div>
        <div><span>Ventas</span>${fmtCLP(e.sales)} <small>(${e.saleN})</small></div>
        <div><span>Gastos</span>${fmtCLP(-e.expenses)}</div>
        <div><span>Ganancia neta</span><b class="${pctClass(e.net)}">${fmtCLP(e.net, { sign: true })}</b></div>
      </div>
      <p class="muted tiny">Ganancia neta = lo que dejaron las ventas y trueques de este evento (contra su costo) menos sus gastos.</p>
      ${bought.length ? `<h3 class="ev-h">Compradas aquí (${bought.length})</h3>${tiles(bought)}` : ''}
      ${sold.length ? `<h3 class="ev-h">Vendidas o intercambiadas aquí (${sold.length})</h3>${tiles(sold)}` : ''}
      ${expenses.length ? `<h3 class="ev-h">Gastos</h3>${expenses.map((x) => `<div class="kv"><span>${esc(x.cat)}${x.note ? ` · ${esc(x.note)}` : ''}</span><b>${fmtCLP(x.amountCLP)}</b></div>`).join('')}` : ''}
      <button class="btn ghost full incol">Ver en Colección</button>
      <div class="btn-row"><button class="btn ghost rename">Renombrar o unir</button><button class="btn ghost danger remove">Quitar evento</button></div>
    </div>`);
  const s = openSheet({ title: e.name, body, cls: 'tall' });
  body.addEventListener('click', (ev) => {
    const t = ev.target.closest('.tile');
    if (!t) return;
    const it = state.items.find((x) => x.id === t.dataset.item);
    if (it) (s.close(), openItemSheet(it));
  });
  $('.incol', body).onclick = () => (s.close(), showEventInCollection(key));
  $('.rename', body).onclick = () => (s.close(), openRename(e, refresh));
  $('.remove', body).onclick = async () => {
    const n = bought.length + sold.length + expenses.length;
    const ok = await confirmSheet('Quitar evento', `Se quita “${e.name}” de ${n} registro${n === 1 ? '' : 's'} (compras, ventas y gastos). Los registros se mantienen, solo quedan sin evento.`, 'Quitar');
    if (!ok) return;
    removeEvent(key);
    s.close();
    toast('Evento quitado', 'ok');
    refresh();
  };
}

function openRename(e, refresh) {
  const others = knownEvents().filter((x) => eventKey(x) !== e.key);
  const id = 'evr' + Math.random().toString(36).slice(2, 7);
  const body = h(`
    <form class="form">
      <label class="field"><span>Nuevo nombre</span><input class="input to" list="${id}" value="${esc(e.name)}" autocomplete="off" required><datalist id="${id}">${others.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <p class="muted small merge-hint">Si escribes el nombre de otro evento, se unen en uno solo.</p>
      <button class="btn primary" type="submit">Guardar</button>
    </form>`);
  const s = openSheet({ title: 'Renombrar o unir', body });
  const input = $('.to', body), hint = $('.merge-hint', body);
  input.oninput = () => {
    const other = others.find((x) => eventKey(x) === eventKey(input.value));
    hint.innerHTML = other ? `<b>Se unirá con “${esc(other)}”</b>: sus compras, ventas y gastos quedan en un solo evento.` : 'Si escribes el nombre de otro evento, se unen en uno solo.';
  };
  body.onsubmit = (ev) => {
    ev.preventDefault();
    const merged = others.some((x) => eventKey(x) === eventKey(input.value));
    const n = renameEvent(e.key, input.value);
    s.close();
    toast(merged ? `Eventos unidos (${n} registro${n === 1 ? '' : 's'})` : 'Evento renombrado', 'ok');
    refresh();
  };
}
