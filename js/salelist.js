// "Lista de venta": pick cards you're selling, set the asking price, and share it as an image
// (WhatsApp / Instagram) or as text.

import { h, esc, $, $$, fmtCLP, parseAmount, toast } from './util.js';
import { state, save, held, itemValueUSD, suggestedAskCLP, setAsk } from './store.js';
import { img } from './api.js';
import { openSheet } from './ui.js';
import { shareFile, shareSaleImage, openSaleQR as openSaleQRShared } from './sale-share.js';
import { imageKey } from './venta-link.js';

export function openSaleList() {
  const list = held()
    .filter((it) => it.purpose !== 'coleccion')
    .sort((a, b) => (itemValueUSD(b) ?? 0) - (itemValueUSD(a) ?? 0));
  const price = (it) => it.askCLP || suggestedAskCLP(it);
  const sel = new Set(list.filter((it) => price(it)).map((it) => it.id));
  const body = h(`
    <div>
      <p class="muted small">Marca lo que vendes y ajusta el precio. Sin cambios, se usa el precio de mercado del día (se actualiza solo); si lo cambias, ese precio queda guardado en la carta.</p>
      <label class="field"><span>Título</span><input class="input sl-title" value="${esc(state.settings.saleTitle || 'Cartas Pokémon en venta')}"></label>
      <label class="field"><span>Contacto / nota al pie</span><input class="input sl-foot" placeholder="Ej: @micuenta · envíos a todo Chile" value="${esc(state.settings.saleFoot || '')}"></label>
      <div class="sl-list">${
        list.length
          ? list
              .map(
                (it) => `
        <div class="sl-row" data-id="${esc(it.id)}">
          <input type="checkbox" class="sl-on" ${sel.has(it.id) ? 'checked' : ''}>
          <img src="${esc(img(it.image))}" alt="" onerror="this.src='icons/card-back.svg'">
          <div class="sl-main"><b>${esc(it.name)}</b><small>${esc(it.setName)}${it.number ? ` · ${esc(it.number)}` : ''}${it.condition && it.condition !== 'NM' ? ` · ${esc(it.condition)}` : ''}${it.graded ? ` · ${esc(it.graded.co)} ${esc(it.graded.grade)}` : ''}</small></div>
          <input class="input sl-price ${it.askCLP ? 'fixed' : ''}" inputmode="numeric" value="${price(it) ?? ''}" placeholder="$" title="${it.askCLP ? 'Precio fijado por ti' : 'Precio de mercado de hoy'}">
        </div>`
              )
              .join('')
          : `<div class="empty"><p>No tienes cartas marcadas para reventa.</p></div>`
      }</div>
      <div class="btn-row"><button class="btn primary sl-img">Compartir imagen</button><button class="btn ghost sl-txt">Copiar texto</button></div>
      <button class="btn ghost full sl-qr">▦ QR para compartir</button>
    </div>`);
  openSheet({ title: 'Lista de venta', body, cls: 'tall' });

  const chosen = () =>
    $$('.sl-row', body)
      .filter((r) => $('.sl-on', r).checked)
      .map((r) => {
        const it = state.items.find((x) => x.id === r.dataset.id);
        const p = parseAmount($('.sl-price', r).value, 'CLP');
        setAsk(it, p); // remembered only if it differs from today's market price
        return { it, p };
      })
      .filter((x) => x.p > 0);
  const remember = () => {
    state.settings.saleTitle = $('.sl-title', body).value.trim();
    state.settings.saleFoot = $('.sl-foot', body).value.trim();
    save({ silent: true });
  };

  $('.sl-txt', body).onclick = async () => {
    const rows = chosen();
    remember();
    if (!rows.length) return toast('Marca al menos una carta con precio', 'err');
    const txt = [`*${state.settings.saleTitle || 'Cartas en venta'}*`, ...rows.map(({ it, p }) => `• ${it.name} (${it.setName}${it.number ? ' ' + it.number : ''}${it.condition && it.condition !== 'NM' ? ', ' + it.condition : ''}) — ${fmtCLP(p)}`), state.settings.saleFoot || ''].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      toast('Texto copiado: pégalo en WhatsApp o Instagram', 'ok');
    } catch {
      await shareFile(new File([txt], 'lista-de-venta.txt', { type: 'text/plain' }));
    }
  };
  $('.sl-qr', body).onclick = () => {
    const rows = chosen();
    remember();
    if (!rows.length) return toast('Marca al menos una carta con precio', 'err');
    openSaleQR(rows);
  };
  $('.sl-img', body).onclick = async (e) => {
    const rows = chosen();
    remember();
    if (!rows.length) return toast('Marca al menos una carta con precio', 'err');
    e.target.textContent = 'Armando imagen…';
    try {
      const sub = (it) => `${it.setName}${it.condition && it.condition !== 'NM' ? ' · ' + it.condition : ''}${it.graded ? ' · ' + it.graded.co + ' ' + it.graded.grade : ''}`;
      await shareSaleImage(rows.map(({ it, p }) => ({ name: it.name, sub: sub(it), image: img(it.image, 'high'), price: p })), { title: state.settings.saleTitle || 'Cartas en venta', foot: state.settings.saleFoot });
    } catch (err) {
      toast(`No pude crear la imagen: ${err.message}`, 'err');
    } finally {
      e.target.textContent = 'Compartir imagen';
    }
  };
}

// QR of the chosen cards (the buyer scans it and sees the list in venta.html).
export function openSaleQR(rows) {
  return openSaleQRShared(
    {
      t: state.settings.saleTitle || 'Cartas en venta',
      f: state.settings.saleFoot || '',
      d: new Date().toLocaleDateString('sv-SE'),
      c: rows.map(({ it, p }) => [it.name, `${it.setName || ''}${it.number ? ` · ${it.number}` : ''}`, imageKey(it.image), Math.round(p), it.graded ? `${it.graded.co} ${it.graded.grade}` : it.condition || 'NM']),
    },
    { openSheet }
  );
}
