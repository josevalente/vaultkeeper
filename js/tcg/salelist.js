// "Lista de venta" of a Magic / Yu-Gi-Oh vault: pick the cards you're selling, set the asking price,
// and share it as an image, as text or as a QR (same as the Pokémon vault, with this vault's cards).

import { h, esc, $, $$, fmtCLP, parseAmount, toast } from '../util.js';
import { state, game, save, held, itemValueUSD, suggestedAskCLP, setAsk } from './store.js';
import { openSheet } from './ui.js';
import { shareFile, shareSaleImage, openSaleQR } from '../sale-share.js';
import { imageKey } from '../venta-link.js';

const code = (it) => (game.id === 'mtg' ? `${it.setCode} ${it.number}` : it.number);
const label = (it) => (it.graded ? `${it.graded.co} ${it.graded.grade}` : [it.finish !== 'normal' && game.id === 'mtg' ? it.finishLabel : '', it.condition && it.condition !== 'NM' ? it.condition : ''].filter(Boolean).join(' · '));

// QR of some cards ([{ it, p }]): from the sale list, or one card from its sheet.
export function openSaleQRFor(rows) {
  const t = state.sale.title || `Cartas de ${game.short} en venta`;
  return openSaleQR({ t, f: state.sale.foot || '', d: new Date().toLocaleDateString('sv-SE'), c: rows.map(({ it, p }) => [it.name, [it.setName, code(it)].filter(Boolean).join(' · '), imageKey(it.imageLarge || it.image), Math.round(p), label(it) || 'NM']) }, { openSheet });
}

export function openSaleList() {
  const list = held()
    .filter((it) => it.purpose !== 'coleccion')
    .sort((a, b) => (itemValueUSD(b) ?? 0) - (itemValueUSD(a) ?? 0));
  const price = (it) => it.askCLP || suggestedAskCLP(it);
  const sel = new Set(list.filter((it) => price(it)).map((it) => it.id));
  const title = () => state.sale.title || `Cartas de ${game.short} en venta`;
  const body = h(`
    <div>
      <p class="muted small">Marca lo que vendes y ajusta el precio. Sin cambios, se usa el precio de mercado del día (se actualiza solo); si lo cambias, ese precio queda guardado en la carta.</p>
      <label class="field"><span>Título</span><input class="input sl-title" value="${esc(title())}"></label>
      <label class="field"><span>Contacto / nota al pie</span><input class="input sl-foot" placeholder="Ej: @micuenta · envíos a todo Chile" value="${esc(state.sale.foot || '')}"></label>
      <div class="sl-list">${
        list.length
          ? list
              .map(
                (it) => `
        <div class="sl-row" data-id="${esc(it.id)}">
          <input type="checkbox" class="sl-on" ${sel.has(it.id) ? 'checked' : ''} aria-label="Incluir ${esc(it.name)}">
          <img src="${esc(it.image || 'icons/card-back.svg')}" alt="" onerror="this.src='icons/card-back.svg'">
          <div class="sl-main"><b>${esc(it.name)}</b><small>${esc([it.setName, code(it), label(it)].filter(Boolean).join(' · '))}</small></div>
          <input class="input sl-price ${it.askCLP ? 'fixed' : ''}" inputmode="numeric" value="${price(it) ?? ''}" placeholder="$" title="${it.askCLP ? 'Precio fijado por ti' : 'Precio de mercado de hoy'}" aria-label="Precio de ${esc(it.name)}">
        </div>`
              )
              .join('')
          : `<div class="empty"><p>No tienes cartas de ${esc(game.short)} marcadas para reventa.</p></div>`
      }</div>
      <div class="btn-row"><button class="btn primary sl-img">Compartir imagen</button><button class="btn ghost sl-txt">Copiar texto</button></div>
      <button class="btn ghost full sl-qr">▦ QR para compartir</button>
    </div>`);
  openSheet({ title: 'Lista de venta', body, cls: 'tall' });

  const chosen = () => {
    const rows = $$('.sl-row', body)
      .filter((r) => $('.sl-on', r).checked)
      .map((r) => {
        const it = state.items.find((x) => x.id === r.dataset.id);
        const p = parseAmount($('.sl-price', r).value, 'CLP');
        setAsk(it, p); // remembered only if it differs from today's market price
        return { it, p };
      })
      .filter((x) => x.p > 0);
    state.sale = { title: $('.sl-title', body).value.trim(), foot: $('.sl-foot', body).value.trim() };
    save({ silent: true });
    if (!rows.length) toast('Marca al menos una carta con precio', 'err');
    return rows;
  };

  $('.sl-txt', body).onclick = async () => {
    const rows = chosen();
    if (!rows.length) return;
    const txt = [`*${title()}*`, ...rows.map(({ it, p }) => `• ${it.name} (${[it.setName, code(it), label(it)].filter(Boolean).join(', ')}) — ${fmtCLP(p)}`), state.sale.foot || ''].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      toast('Texto copiado: pégalo en WhatsApp o Instagram', 'ok');
    } catch {
      await shareFile(new File([txt], 'lista-de-venta.txt', { type: 'text/plain' }));
    }
  };
  $('.sl-qr', body).onclick = () => {
    const rows = chosen();
    if (rows.length) openSaleQRFor(rows);
  };
  $('.sl-img', body).onclick = async (e) => {
    const rows = chosen();
    if (!rows.length) return;
    e.target.textContent = 'Armando imagen…';
    try {
      await shareSaleImage(rows.map(({ it, p }) => ({ name: it.name, sub: [it.setName, label(it)].filter(Boolean).join(' · '), image: it.imageLarge || it.image, price: p, code: code(it) })), { title: title(), foot: state.sale.foot });
    } catch (err) {
      toast(`No pude crear la imagen: ${err.message}`, 'err');
    } finally {
      e.target.textContent = 'Compartir imagen';
    }
  };
}
