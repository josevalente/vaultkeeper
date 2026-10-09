// "Lista de venta": pick cards you're selling, set the asking price, and share it as an image
// (WhatsApp / Instagram) or as text.

import { h, esc, $, $$, fmtCLP, parseAmount, toast } from './util.js';
import { state, save, held, itemValueUSD, suggestedAskCLP, setAsk } from './store.js';
import { img } from './api.js';
import { openSheet } from './ui.js';
import { shareFile } from './backup.js';

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
  $('.sl-img', body).onclick = async (e) => {
    const rows = chosen();
    remember();
    if (!rows.length) return toast('Marca al menos una carta con precio', 'err');
    e.target.textContent = 'Armando imagen…';
    try {
      // 24 cards per image (iPhone limits canvas size); several images if needed.
      const pages = [];
      for (let i = 0; i < rows.length; i += 24) pages.push(rows.slice(i, i + 24));
      const files = [];
      for (const [n, pg] of pages.entries()) {
        const blob = await renderImage(pg, pages.length > 1 ? ` (${n + 1}/${pages.length})` : '');
        if (!blob) throw new Error('no se pudo crear la imagen');
        files.push(new File([blob], `lista-de-venta${pages.length > 1 ? '-' + (n + 1) : ''}.png`, { type: 'image/png' }));
      }
      if (files.length > 1 && navigator.canShare?.({ files })) await navigator.share({ files, title: state.settings.saleTitle }).catch(() => {});
      else for (const f of files) await shareFile(f, { title: state.settings.saleTitle });
    } catch (err) {
      toast(`No pude crear la imagen: ${err.message}`, 'err');
    } finally {
      e.target.textContent = 'Compartir imagen';
    }
  };
}

function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    // Separate URL from the <img> tags so the service worker doesn't hand the canvas a cached
    // no-CORS (opaque) copy, which would block drawing it.
    im.src = src + (src.includes('?') ? '&' : '?') + 'cors=1';
  });
}

// 1080-wide image: 3 cards per row, name + price under each.
async function renderImage(rows, suffix = '') {
  const W = 1080, cols = 3, gap = 28, pad = 48, cw = (W - pad * 2 - gap * (cols - 1)) / cols, ch = cw * (88 / 63), textH = 120;
  const nRows = Math.ceil(rows.length / cols);
  const H = pad + 120 + nRows * (ch + textH + gap) + 80;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0f16';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e2b33c';
  g.font = '700 54px Unbounded, Figtree, sans-serif';
  g.fillText((state.settings.saleTitle || 'Cartas en venta') + suffix, pad, pad + 56);
  const imgs = await Promise.all(rows.map(({ it }) => loadImg(img(it.image, 'high'))));
  rows.forEach(({ it, p }, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = pad + 110 + Math.floor(i / cols) * (ch + textH + gap);
    g.fillStyle = '#1b2030';
    g.fillRect(x, y, cw, ch);
    if (imgs[i]) {
      const im = imgs[i];
      const s = Math.min(cw / im.width, ch / im.height);
      g.drawImage(im, x + (cw - im.width * s) / 2, y + (ch - im.height * s) / 2, im.width * s, im.height * s);
    }
    g.fillStyle = '#f3efe4';
    g.font = '700 30px Figtree, sans-serif';
    const name = it.name.length > 20 ? it.name.slice(0, 19) + '…' : it.name;
    g.fillText(name, x, y + ch + 40);
    g.fillStyle = '#b4b1a6';
    g.font = '500 22px Figtree, sans-serif';
    const sub = `${it.setName}${it.condition && it.condition !== 'NM' ? ' · ' + it.condition : ''}${it.graded ? ' · ' + it.graded.co + ' ' + it.graded.grade : ''}`;
    g.fillText(sub.length > 30 ? sub.slice(0, 29) + '…' : sub, x, y + ch + 72);
    g.fillStyle = '#e2b33c';
    g.font = '800 34px Figtree, sans-serif';
    g.fillText(fmtCLP(p), x, y + ch + 110);
  });
  if (state.settings.saleFoot) {
    g.fillStyle = '#b4b1a6';
    g.font = '600 28px Figtree, sans-serif';
    g.fillText(state.settings.saleFoot, pad, H - 40);
  }
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

