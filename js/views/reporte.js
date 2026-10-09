// Reporte: real profit by month, by feria/evento and by sales channel, including expenses
// (entrada, transporte, fundas…). Export to CSV (Excel) for accounting.

import { h, esc, $, $$, fmtCLP, fmtDate, localDate, parseAmount, toast } from '../util.js';
import { state, report, summary, addExpense, removeExpense, EXPENSE_CATS, channelById } from '../store.js';
import { openSheet, eventField, pctClass, confirmSheet } from '../ui.js';
import { csv, shareFile } from '../backup.js';

let tab = 'mes';

export function renderReporte(root) {
  const r = report();
  const s = summary();
  const rows = tab === 'mes' ? r.months : tab === 'evento' ? r.events : r.channels;
  const label = (k) => (tab === 'mes' ? monthName(k) : tab === 'canal' ? channelById(k)?.name || k : k);

  root.innerHTML = `
    <div class="view-head rise">
      <h1>Reporte</h1>
      <p class="muted">Ganancia realizada (ventas − costo de lo vendido) menos gastos.</p>
    </div>
    <section class="hero rise" style="--d:1">
      <div class="hero-label">Ganancia neta realizada</div>
      <div class="hero-value ${pctClass(s.realNetCLP)}">${fmtCLP(s.realNetCLP, { sign: true })}</div>
      <div class="hero-stats">
        <div><span>Por ventas</span><b class="${pctClass(s.realCLP)}">${fmtCLP(s.realCLP, { sign: true })}</b></div>
        <div><span>Gastos</span><b>${fmtCLP(-s.expensesCLP)}</b></div>
        <div><span>Ventas</span><b>${s.exits}</b></div>
      </div>
    </section>

    <section class="panel rise" style="--d:2">
      <div class="panel-head"><h2>Detalle</h2><div class="seg small tabs"><button data-t="mes" class="${tab === 'mes' ? 'on' : ''}">Mes</button><button data-t="evento" class="${tab === 'evento' ? 'on' : ''}">Feria</button><button data-t="canal" class="${tab === 'canal' ? 'on' : ''}">Canal</button></div></div>
      ${
        rows.length
          ? `<div class="rep">${rows
              .map(
                (b) => `
        <div class="rep-row">
          <div class="rep-head"><b>${esc(label(b.key))}</b><b class="${pctClass(b.net)}">${fmtCLP(b.net, { sign: true })}</b></div>
          <div class="rep-grid">
            ${tab !== 'canal' ? `<div><span>Compras</span>${fmtCLP(b.buys)} <small>(${b.buyN})</small></div>` : ''}
            <div><span>Ventas</span>${fmtCLP(b.sales)} <small>(${b.saleN})</small></div>
            <div><span>Ganancia</span><em class="${pctClass(b.profit)}">${fmtCLP(b.profit, { sign: true })}</em></div>
            ${tab !== 'canal' ? `<div><span>Gastos</span>${fmtCLP(-b.expenses)}</div>` : ''}
          </div>
        </div>`
              )
              .join('')}</div>`
          : `<div class="empty"><p>${tab === 'evento' ? 'Indica la feria/evento al comprar, vender o registrar gastos para verla aquí.' : 'Aún no hay movimientos.'}</p></div>`
      }
    </section>

    <section class="panel rise" style="--d:3">
      <div class="panel-head"><h2>Gastos</h2><button class="chip-btn add-exp">+ Agregar gasto</button></div>
      <div class="tlist">${
        state.expenses.length
          ? [...state.expenses]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 50)
              .map((e) => `<div class="trow exp-row"><div class="trow-main"><b>${esc(e.cat)}</b><small>${fmtDate(e.date)}${e.event ? ` · ${esc(e.event)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</small></div><div class="trow-val"><b>${fmtCLP(e.amountCLP)}</b></div><button class="icon-btn rm" data-id="${esc(e.id)}" aria-label="Eliminar">✕</button></div>`)
              .join('')
          : '<p class="muted small">Entrada a la feria, transporte, fundas, envíos… todo lo que reste a tu ganancia.</p>'
      }</div>
    </section>

    <section class="panel rise" style="--d:4">
      <h2>Exportar a Excel</h2>
      <p class="muted small">Archivos CSV que abre Excel o Google Sheets.</p>
      <div class="btn-row"><button class="btn ghost csv-items">Inventario y ventas</button><button class="btn ghost csv-exp">Gastos</button></div>
    </section>`;

  $$('.tabs button', root).forEach((b) => (b.onclick = () => ((tab = b.dataset.t), renderReporte(root))));
  $('.add-exp', root).onclick = () => openExpenseForm();
  $$('.exp-row .rm', root).forEach((b) => (b.onclick = async () => {
    if (await confirmSheet('Eliminar gasto', '¿Eliminar este gasto?', 'Eliminar', true)) removeExpense(b.dataset.id);
  }));
  $('.csv-items', root).onclick = () => exportItems();
  $('.csv-exp', root).onclick = () => exportExpenses();
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (k) => (k && k.length === 7 ? `${MONTHS[Number(k.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} ${k.slice(0, 4)}` : 'Sin fecha');

export function openExpenseForm() {
  const body = h(`
    <form class="form">
      <label class="field"><span>Monto (CLP)</span><input class="input amount" inputmode="numeric" required placeholder="0"></label>
      <label class="field"><span>Tipo</span><select class="input cat">${EXPENSE_CATS.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      ${eventField()}
      <label class="field"><span>Nota</span><input class="input note" placeholder="Opcional"></label>
      <button class="btn primary" type="submit">Guardar gasto</button>
    </form>`);
  const s = openSheet({ title: 'Agregar gasto', body });
  body.onsubmit = (e) => {
    e.preventDefault();
    const amountCLP = parseAmount($('.amount', body).value, 'CLP');
    if (!(amountCLP > 0)) return toast('Ingresa el monto', 'err');
    addExpense({ date: $('.date', body).value || localDate(), amountCLP, cat: $('.cat', body).value, note: $('.note', body).value.trim(), event: $('.event', body).value.trim() });
    s.close();
    toast('Gasto guardado', 'ok');
  };
}

function exportItems() {
  const head = ['Carta', 'Expansión', 'Número', 'Tipo', 'Idioma', 'Versión', 'Estado', 'Gradeada', 'Destino', 'Fecha compra', 'Feria compra', 'Pagado', 'Moneda', 'TC compra', 'Costo CLP', 'Costo USD', 'Situación', 'Fecha salida', 'Canal', 'Feria venta', 'Recibido CLP', 'Ganancia CLP'];
  const rows = state.items.map((it) => [
    it.name, it.setName, it.number, it.kind === 'sealed' ? 'Sellado' : 'Carta', it.lang === 'ja' ? 'Japonés' : 'Inglés', it.variant, it.condition || '', it.graded ? `${it.graded.co} ${it.graded.grade}` : '', it.purpose,
    it.buy.date, it.buy.event || '', Math.round(it.buy.price * 100) / 100, it.buy.currency, it.buy.fx, Math.round(it.costCLP), Math.round(it.costUSD * 100) / 100,
    it.status === 'held' ? 'En vault' : it.status === 'sold' ? 'Vendida' : 'Intercambiada',
    it.exit?.date || '', it.exit?.channel ? channelById(it.exit.channel)?.name || it.exit.channel : '', it.exit?.event || '', it.exit ? Math.round(it.exit.clp) : '', it.exit ? Math.round(it.exit.clp - it.costCLP) : '',
  ]);
  shareFile(new File([csv([head, ...rows])], `vaultkeeper-inventario-${localDate()}.csv`, { type: 'text/csv' }));
}

function exportExpenses() {
  const rows = state.expenses.map((e) => [e.date, e.cat, e.event || '', e.note || '', e.amountCLP]);
  shareFile(new File([csv([['Fecha', 'Tipo', 'Feria / evento', 'Nota', 'Monto CLP'], ...rows])], `vaultkeeper-gastos-${localDate()}.csv`, { type: 'text/csv' }));
}
