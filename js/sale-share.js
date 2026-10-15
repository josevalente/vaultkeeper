// Sharing a sale list, the same in every vault: a picture of the cards with their prices, and a QR
// whose link (venta.html) shows the list to the buyer. No vault data is read here: each vault
// passes its own cards, title and footer.

import { h, esc, $, fmtCLP, toast } from './util.js';
import { encodeSale, saleURL } from './venta-link.js';

export async function shareFile(file, { title = '', text = '' } = {}) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false; // user closed the sheet
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1500);
  return true;
}

function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
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
// rows: [{ name, sub, image (big picture URL), price (CLP), code (shown when there's no picture) }]
async function renderImage(rows, { title, foot }, suffix = '') {
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
  g.fillText(title + suffix, pad, pad + 56);
  const imgs = await Promise.all(rows.map((r) => loadImg(r.image)));
  rows.forEach((r, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = pad + 110 + Math.floor(i / cols) * (ch + textH + gap);
    g.fillStyle = '#1b2030';
    g.fillRect(x, y, cw, ch);
    if (imgs[i]) {
      const im = imgs[i];
      const s = Math.min(cw / im.width, ch / im.height);
      g.drawImage(im, x + (cw - im.width * s) / 2, y + (ch - im.height * s) / 2, im.width * s, im.height * s);
    } else {
      // No picture (offline, or a site that doesn't allow it: YGOPRODeck): the name in the frame.
      g.strokeStyle = '#e2b33c';
      g.lineWidth = 3;
      g.strokeRect(x + 10, y + 10, cw - 20, ch - 20);
      g.fillStyle = '#f3efe4';
      g.font = '800 34px Figtree, sans-serif';
      g.textAlign = 'center';
      const words = r.name.split(/\s+/), lines = [];
      for (const w of words) {
        const cur = lines[lines.length - 1];
        if (cur && g.measureText(`${cur} ${w}`).width <= cw - 50) lines[lines.length - 1] = `${cur} ${w}`;
        else lines.push(w);
      }
      const shown = lines.slice(0, 5);
      shown.forEach((l, k) => g.fillText(l, x + cw / 2, y + ch / 2 - ((shown.length - 1) * 42) / 2 + k * 42, cw - 40));
      if (r.code) {
        g.fillStyle = '#b4b1a6';
        g.font = '600 24px Figtree, sans-serif';
        g.fillText(r.code, x + cw / 2, y + ch - 40, cw - 40);
      }
      g.textAlign = 'left';
    }
    g.fillStyle = '#f3efe4';
    g.font = '700 30px Figtree, sans-serif';
    g.fillText(r.name.length > 20 ? r.name.slice(0, 19) + '…' : r.name, x, y + ch + 40);
    g.fillStyle = '#b4b1a6';
    g.font = '500 22px Figtree, sans-serif';
    g.fillText(r.sub.length > 30 ? r.sub.slice(0, 29) + '…' : r.sub, x, y + ch + 72);
    g.fillStyle = '#e2b33c';
    g.font = '800 34px Figtree, sans-serif';
    g.fillText(fmtCLP(r.price), x, y + ch + 110);
  });
  if (foot) {
    g.fillStyle = '#b4b1a6';
    g.font = '600 28px Figtree, sans-serif';
    g.fillText(foot, pad, H - 40);
  }
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// 24 cards per image (iPhone limits canvas size); several images if needed.
export async function shareSaleImage(rows, { title, foot }) {
  const pages = [];
  for (let i = 0; i < rows.length; i += 24) pages.push(rows.slice(i, i + 24));
  const files = [];
  for (const [n, pg] of pages.entries()) {
    const blob = await renderImage(pg, { title, foot }, pages.length > 1 ? ` (${n + 1}/${pages.length})` : '');
    if (!blob) throw new Error('no se pudo crear la imagen');
    files.push(new File([blob], `lista-de-venta${pages.length > 1 ? '-' + (n + 1) : ''}.png`, { type: 'image/png' }));
  }
  if (files.length > 1 && navigator.canShare?.({ files })) await navigator.share({ files, title }).catch(() => {});
  else for (const f of files) await shareFile(f, { title });
}

// ───────────────────────── QR: the buyer scans it and sees the list (venta.html)

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLib;
const loadQR = () =>
  (qrLib ||= new Promise((res, rej) => {
    if (window.qrcode) return res(window.qrcode);
    const sc = document.createElement('script');
    sc.src = QR_LIB;
    sc.onload = () => res(window.qrcode);
    sc.onerror = () => ((qrLib = null), rej(new Error('necesito internet la primera vez para crear el QR')));
    document.head.appendChild(sc);
  }));

// data: { t: title, f: footer, d: date, c: [[name, set, imageKey, priceCLP, condition], …] }
export async function openSaleQR(data, { openSheet }) {
  const n = data.c.length;
  const body = h(`<div class="qr-box"><div class="loading">Creando el QR…</div></div>`);
  openSheet({ title: 'QR de la lista', body });
  let url, qr;
  try {
    url = saleURL(await encodeSale(data));
    const lib = await loadQR();
    // A QR holds ~2.300 characters; past that it's too dense for a phone camera anyway.
    if (url.length > 2300) throw new Error(`son demasiadas cartas para un QR (${n}); marca menos o comparte la imagen`);
    qr = lib(0, url.length > 1400 ? 'L' : 'M');
    qr.addData(url);
    qr.make();
  } catch (err) {
    body.innerHTML = `<div class="empty"><p>No pude crear el QR: ${esc(err.message)}.</p></div>`;
    return;
  }
  body.innerHTML = `
    <div class="qr-code" role="img" aria-label="Código QR de la lista de venta">${qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true })}</div>
    <p class="small qr-cap"><b>${esc(data.t)}</b><br>${n} carta${n === 1 ? '' : 's'} · quien lo escanee con la cámara ve las fotos y tus precios. No necesita la app.</p>
    <div class="btn-row"><button class="btn primary qr-share">Compartir link</button><button class="btn ghost qr-copy">Copiar link</button></div>
    <button class="btn ghost full qr-save">Guardar imagen del QR</button>
    <p class="muted tiny">El link lleva la lista adentro: si cambias precios o cartas, crea un QR nuevo.</p>`;
  $('.qr-share', body).onclick = async () => {
    try {
      if (navigator.share) return await navigator.share({ title: data.t, text: data.t, url });
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast('Link copiado', 'ok');
  };
  $('.qr-copy', body).onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado: pégalo en WhatsApp o Instagram', 'ok');
    } catch {
      toast('No pude copiarlo; usa Compartir link', 'err');
    }
  };
  $('.qr-save', body).onclick = async () => {
    const im = new Image();
    im.src = qr.createDataURL(10, 4);
    await im.decode().catch(() => {});
    const c = document.createElement('canvas');
    const pad = 40;
    c.width = im.width + pad * 2;
    c.height = im.height + pad * 2 + 70;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = false;
    x.drawImage(im, pad, pad);
    x.fillStyle = '#111';
    x.font = 'bold 28px sans-serif';
    x.textAlign = 'center';
    x.fillText(data.t.slice(0, 40), c.width / 2, c.height - 34);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (blob) await shareFile(new File([blob], 'qr-lista-de-venta.png', { type: 'image/png' }), { title: data.t });
  };
}
