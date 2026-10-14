// Public page of a shared sale list (venta.html#v1.…): the buyer sees the cards, their pictures and
// prices. Everything comes from the link; nothing is stored and no account is needed.

import { decodeSale, imageURL } from './venta-link.js';
import { esc, fmtCLP, fmtDate, openImageViewer } from './util.js';

const grid = document.querySelector('.venta-grid');
(async () => {
  const code = location.hash.slice(1);
  let data;
  try {
    data = await decodeSale(code);
  } catch {
    grid.innerHTML = '<div class="empty wide"><p>Este link de venta está incompleto o dañado. Pídele al vendedor que lo comparta de nuevo.</p></div>';
    return;
  }
  const cards = data.c || [];
  document.title = data.t || 'Cartas en venta';
  document.querySelector('.venta-title').textContent = data.t || 'Cartas en venta';
  document.querySelector('.venta-meta').textContent = `${cards.length} carta${cards.length === 1 ? '' : 's'}${data.d ? ` · lista del ${fmtDate(data.d)}` : ''}`;
  document.querySelector('.venta-foot').textContent = data.f || '';
  grid.innerHTML = cards
    .map(
      ([name, set, img, price, cond], i) => `
      <button class="tile" data-i="${i}">
        <div class="tile-img"><img loading="lazy" src="${esc(imageURL(img))}" alt="${esc(name)}" onerror="this.src='icons/card-back.svg'">${cond && cond !== 'NM' ? `<span class="slab cond">${esc(cond)}</span>` : ''}</div>
        <div class="tile-meta">
          <div class="tile-name"><span>${esc(name)}</span></div>
          <div class="tile-sub">${esc(set || '')}</div>
          <div class="tile-val"><b>${fmtCLP(price)}</b></div>
        </div>
      </button>`
    )
    .join('');
  grid.onclick = (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    const [name, , img] = cards[Number(t.dataset.i)];
    openImageViewer(imageURL(img, true), name);
  };
})();
