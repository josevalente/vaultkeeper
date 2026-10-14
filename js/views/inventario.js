// Subir inventario: load the cards you already have by photographing binder pages. Each photo is
// split into its pockets (3×3 by default), every pocket is identified (Claude reads the whole page in
// one call; without it, the on-device OCR reads pocket by pocket), and you approve or fix each one
// before they go into the vault.

import { h, esc, $, $$, fmtCLP, parseAmount, localDate, toast, uid } from '../util.js';
import { state, save, addItems, setPrice, marketUSD, condFactor, CONDITIONS, rememberEvent, splitLot } from '../store.js';
import { getCard, img, variantLabel, findByNumber, searchByName, searchCatalog } from '../api.js';
import { identify } from '../scan.js';
import { openSearch, openSheet, openCardSheet, money, confirmSheet, eventField, cardTile } from '../ui.js';
import { refreshFx, fxOn } from '../fx.js';

const LAYOUTS = { '3x3': [3, 3, '9 bolsillos (3×3)'], '2x2': [2, 2, '4 bolsillos (2×2)'], '4x3': [4, 3, '12 bolsillos (4×3)'], '1x1': [1, 1, '1 carta'] };
const draft = () => (state.invDraft ||= { items: [], layout: '3x3', pages: 0 });
const thumbs = new Map(); // pocket crops, in memory only (big)
let busy = null; // { page, done, total, msg }

const slim = (c) => ({ id: c.id, name: c.name, setName: c.setName, setId: c.setId, number: c.number, total: c.total, rarity: c.rarity, image: c.image, variants: c.variants || [], kind: c.kind, lang: c.lang, pid: c.pid });
const pending = (x) => x.card.id.startsWith('pendiente-');
const valueUSD = (x) => {
  const m = marketUSD(x.card.id, x.variant);
  return m == null ? null : m * (x.card.kind === 'sealed' ? 1 : condFactor(x.condition));
};

async function loadCard(brief) {
  try {
    const { card, prices } = await getCard(brief.id);
    setPrice(card.id, prices);
    return { card: slim(card), variant: card.variants.find((v) => prices.tp?.[v]?.market != null) || card.variants[0] || 'normal', condition: 'NM' };
  } catch {
    return { card: slim(brief), variant: 'normal', condition: 'NM' };
  }
}

export function renderInventario(root) {
  const D = draft();
  const items = D.items;
  const ready = items.filter((x) => !pending(x));
  const toReview = items.filter((x) => x.review && !x.ok).length;
  const total = ready.reduce((a, x) => a + (valueUSD(x) || 0), 0);
  root.innerHTML = `
    <div class="view-head rise">
      <h1>Subir inventario</h1>
      <p class="muted">Saca una foto a cada página de tu carpeta: reconozco las cartas de cada bolsillo y tú apruebas o corriges antes de agregarlas al vault.</p>
    </div>
    <section class="panel rise" style="--d:1">
      <label class="field"><span>Bolsillos por página</span><select class="input layout">${Object.entries(LAYOUTS).map(([k, [, , l]]) => `<option value="${k}" ${D.layout === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btn-row">
        <label class="btn primary inv-cam">📷 Foto de la página<input type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn ghost inv-lib">Elegir fotos<input type="file" accept="image/*" multiple hidden></label>
      </div>
      <p class="muted tiny">Pon la página derecha y llena el encuadre, con luz pareja y sin reflejos de las fundas. ${state.settings.claudeKey ? 'Claude lee la página completa en una sola consulta.' : 'Sin API key de Claude, el OCR del teléfono lee bolsillo por bolsillo (más lento y menos preciso).'}</p>
      ${busy ? `<div class="inv-progress"><b>${esc(busy.msg)}</b><div class="bar"><i style="width:${Math.round((busy.done / Math.max(1, busy.total)) * 100)}%"></i></div></div>` : ''}
    </section>
    ${
      items.length
        ? `<section class="panel rise" style="--d:2">
      <div class="panel-head"><h2>${ready.length} carta${ready.length === 1 ? '' : 's'}${toReview ? ` · <span class="warn-t">${toReview} por revisar</span>` : ''}</h2><button class="link clear">Vaciar</button></div>
      <p class="muted small">Las marcadas en amarillo no las reconocí con seguridad: toca ✓ si está bien o “Cambiar”. Quita los bolsillos vacíos.</p>
      <div class="tlist">${items.map(row).join('')}</div>
    </section>
    <section class="panel rise" style="--d:3">
      <div class="kv"><span>Valor de mercado</span><b>${money(total)}</b></div>
      <button class="btn primary full add" ${ready.length ? '' : 'disabled'}>Agregar ${ready.length} al vault</button>
    </section>`
        : ''
    }`;

  $('.layout', root).onchange = (e) => ((D.layout = e.target.value), save({ silent: true }));
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) await readPage(f, root);
  };
  $('.inv-cam input', root).onchange = onFiles;
  $('.inv-lib input', root).onchange = onFiles;
  $('.clear', root)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Vaciar', '¿Quitar todas las cartas escaneadas (no se agregó nada al vault)?', 'Vaciar', true))) return;
    state.invDraft = { items: [], layout: D.layout, pages: 0 };
    thumbs.clear();
    save();
  });
  $$('.inv-row', root).forEach((r) => {
    const x = items.find((y) => y.uid === r.dataset.uid);
    if (!x) return;
    $('.ok', r)?.addEventListener('click', () => ((x.ok = true), save()));
    $('.fix', r)?.addEventListener('click', () => fixEntry(x));
    $('.rm', r).onclick = () => ((D.items = D.items.filter((y) => y !== x)), thumbs.delete(x.uid), save());
    $('.cond', r)?.addEventListener('change', (e) => ((x.condition = e.target.value), save({ silent: true })));
    $('.var', r)?.addEventListener('change', (e) => ((x.variant = e.target.value), save()));
    $('.open', r).onclick = () => !pending(x) && openCardSheet(x.card.id);
  });
  $('.add', root)?.addEventListener('click', () => finish(root));
}

function row(x) {
  const v = valueUSD(x);
  const doubt = x.review && !x.ok;
  return `
    <div class="trow inv-row ${doubt ? 'review' : ''}" data-uid="${esc(x.uid)}">
      <img class="open" src="${esc(thumbs.get(x.uid) || img(x.card.image))}" alt="" onerror="this.src='icons/card-back.svg'">
      <div class="trow-main">
        <b>${esc(x.card.name)}</b>
        <small>Pág. ${x.page} · bolsillo ${x.pos}${x.card.setName ? ` · ${esc(x.card.setName)}` : ''}${x.card.number ? ` ${esc(x.card.number)}` : ''}</small>
        <div class="lot-ctrls">
          ${x.card.variants?.length > 1 ? `<select class="input small var">${x.card.variants.map((k) => `<option value="${esc(k)}" ${k === x.variant ? 'selected' : ''}>${esc(variantLabel(k))}</option>`).join('')}</select>` : ''}
          ${pending(x) ? '' : `<select class="input small cond">${Object.keys(CONDITIONS).map((k) => `<option ${k === x.condition ? 'selected' : ''}>${k}</option>`).join('')}</select>`}
          ${doubt && !pending(x) ? '<button class="chip-btn ok">✓ Está bien</button>' : ''}
          <button class="chip-btn fix">${pending(x) ? 'Elegir' : 'Cambiar'}</button>
        </div>
      </div>
      <div class="trow-val"><b>${v != null ? money(v) : '—'}</b></div>
      <button class="icon-btn rm" aria-label="Quitar">✕</button>
    </div>`;
}

// ───────────────────────── reading one page

async function loadPhoto(file) {
  const src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, 3200 / Math.max(src.width, src.height)); // keep detail: each pocket is a small part
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c;
}

// The pockets of a page, left to right and top to bottom, with a small inset (the sleeve's edge).
function pockets(page, cols, rows) {
  const out = [];
  const cw = page.width / cols, ch = page.height / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ix = cw * 0.04, iy = ch * 0.03;
      const cell = document.createElement('canvas');
      cell.width = Math.round(cw - ix * 2);
      cell.height = Math.round(ch - iy * 2);
      cell.getContext('2d').drawImage(page, c * cw + ix, r * ch + iy, cell.width, cell.height, 0, 0, cell.width, cell.height);
      out.push(cell);
    }
  return out;
}
// An empty pocket is almost one flat color (the sleeve or the binder page); a card never is.
function isEmptyPocket(cell) {
  const t = document.createElement('canvas');
  t.width = 48;
  t.height = 64;
  const x = t.getContext('2d', { willReadFrequently: true });
  x.drawImage(cell, 0, 0, 48, 64);
  const d = x.getImageData(0, 0, 48, 64).data;
  let sum = 0, sq = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += g;
    sq += g * g;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) < 14;
}

const smallThumb = (canvas) => {
  const t = document.createElement('canvas');
  const s = 160 / canvas.width;
  t.width = 160;
  t.height = Math.round(canvas.height * s);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.7);
};

async function readPage(file, root) {
  if (busy) return toast('Espera: sigo leyendo la página anterior');
  const D = draft();
  const [cols, rows] = LAYOUTS[D.layout] || LAYOUTS['3x3'];
  const page = ++D.pages;
  const repaint = () => root.isConnected && renderInventario(root);
  busy = { page, done: 0, total: cols * rows, msg: `Página ${page}: preparando la foto…` };
  repaint();
  try {
    const photo = await loadPhoto(file);
    const cells = pockets(photo, cols, rows);
    let found = null;
    if (state.settings.claudeKey && navigator.onLine && cells.length > 1) {
      busy.msg = `Página ${page}: Claude está leyendo la página completa…`;
      repaint();
      found = await claudeReadPage(photo, cols, rows).catch((e) => (console.warn(e), null));
    }
    for (const [i, cell] of cells.entries()) {
      busy.done = i;
      busy.msg = `Página ${page}: carta ${i + 1} de ${cells.length}…`;
      repaint();
      const res = found ? await fromClaude(found[i]) : isEmptyPocket(cell) ? { info: { empty: true }, cands: [] } : await identify(cell, true, () => {}).catch(() => ({ info: {}, cands: [] }));
      const e = { uid: uid(), page, pos: i + 1, review: null, ok: false };
      thumbs.set(e.uid, smallThumb(cell));
      if (!res?.cands?.length) {
        // An empty pocket or a card I couldn't read: you choose it or remove it.
        if (res?.info?.empty) continue;
        Object.assign(e, { card: { id: 'pendiente-' + e.uid, name: 'Sin reconocer', setName: '', number: '', image: '', variants: [] }, variant: 'normal', condition: 'NM', review: { cands: [], info: res?.info || {} } });
      } else {
        const sure = res.cands.length === 1 && res.info?.number && !res.info?.uncertain;
        Object.assign(e, await loadCard(res.cands[0]), { review: sure ? null : { cands: res.cands.slice(0, 30), info: res.info } });
      }
      draft().items.push(e);
      save({ silent: true });
    }
    toast(`Página ${page} leída: revisa las marcadas en amarillo`, 'ok');
  } catch (err) {
    toast(`No pude leer la foto: ${err.message}`, 'err');
  } finally {
    busy = null;
    save();
    repaint();
  }
}

// One Claude call for the whole page: the name and printed number of each pocket.
const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    pockets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position: { type: 'integer', description: '1-based, left to right, top to bottom' },
          empty: { type: 'boolean' },
          name: { type: 'string' },
          number: { type: 'string', description: 'Collector number before the slash, empty if unreadable' },
          set_total: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['position', 'empty', 'name', 'number', 'set_total', 'language'],
        additionalProperties: false,
      },
    },
  },
  required: ['pockets'],
  additionalProperties: false,
};
let sdk;
async function claudeReadPage(photo, cols, rows) {
  sdk ||= import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm');
  const { default: Anthropic } = await sdk;
  const client = new Anthropic({ apiKey: state.settings.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60000 });
  const c = document.createElement('canvas');
  const s = Math.min(1, 2000 / Math.max(photo.width, photo.height));
  c.width = Math.round(photo.width * s);
  c.height = Math.round(photo.height * s);
  c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.88).split(',')[1];
  const msg = await client.messages.create({
    model: state.settings.claudeModel || 'claude-opus-5-5',
    max_tokens: 6000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PAGE_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
      { type: 'text', text: `This is a binder page of Pokémon TCG cards, ${cols} columns × ${rows} rows (${cols * rows} pockets). For every pocket, left to right and top to bottom, report the card name and the collector number printed at the bottom (e.g. 199 of "199/165"), or empty=true if the pocket has no card. Report exactly what is printed; leave a field empty rather than guessing.` },
    ] }],
  });
  const out = JSON.parse(msg.content.find((b) => b.type === 'text')?.text || '{}');
  const list = Array.from({ length: cols * rows }, (_, i) => out.pockets?.find((p) => p.position === i + 1) || null);
  return list;
}
async function fromClaude(p) {
  if (!p) return { info: {}, cands: [] };
  if (p.empty) return { info: { empty: true }, cands: [] };
  const info = { name: p.name, number: p.number, total: p.set_total, via: 'claude' };
  if (p.language === 'ja') {
    const cands = await searchCatalog('jp', p.name, p.number, p.set_total).catch(() => []);
    return { info: { ...info, uncertain: true }, cands };
  }
  let cands = p.number ? await findByNumber(p.number, p.set_total, p.name, { nameFallback: false }).catch(() => []) : [];
  if (!cands.length && p.name) cands = await searchByName(p.name).catch(() => []);
  return { info, cands };
}

// ───────────────────────── fixing one pocket

function fixEntry(x) {
  const cands = x.review?.cands || [];
  const body = h(`
    <div>
      <div class="shot-row">${thumbs.get(x.uid) ? `<img class="shot" src="${esc(thumbs.get(x.uid))}" alt="">` : ''}<p class="muted small">Toca la carta correcta${cands.length ? '' : ' o búscala'}.</p></div>
      ${cands.length ? `<div class="grid grid-tight">${cands.map((c) => cardTile(c)).join('')}</div>` : ''}
      <button class="btn ghost full search">⌕ Buscar</button>
    </div>`);
  const s = openSheet({ title: `Página ${x.page} · bolsillo ${x.pos}`, body, cls: 'tall' });
  const replace = async (c) => {
    Object.assign(x, await loadCard(c), { review: null, ok: true });
    save();
  };
  body.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) (s.close(), replace(cands.find((c) => c.id === t.dataset.id)));
  });
  $('.search', body).onclick = () => (s.close(), openSearch({ onPick: replace, initial: x.review?.info?.name || '' }));
}

// ───────────────────────── into the vault

async function finish(root) {
  const D = draft();
  const ready = D.items.filter((x) => !pending(x));
  if (!ready.length) return;
  const doubts = ready.filter((x) => x.review && !x.ok).length;
  if (doubts && !(await confirmSheet('Revisar', `${doubts} carta${doubts === 1 ? '' : 's'} sin revisar (en amarillo). ¿Agregar igual?`, 'Agregar igual'))) return;
  await refreshFx();
  const values = ready.map((x) => valueUSD(x) || 0);
  const body = h(`
    <form class="form">
      <div class="field"><span>Costo de cada carta</span><div class="seg cost"><button type="button" data-k="market" class="on">Valor de mercado de hoy</button><button type="button" data-k="paid">Pagué un total</button></div></div>
      <label class="field paid-box" hidden><span>Total que pagaste por todas</span><input class="input total" inputmode="decimal" placeholder="Ej: 150.000"></label>
      <p class="muted small cost-hint">Con “valor de mercado” la ganancia parte de cero hoy. Con “pagué un total”, se reparte entre las cartas según su valor.</p>
      <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      ${eventField('', 'Evento (opcional)')}
      <div class="field"><span>Destino</span><div class="seg purpose"><button type="button" data-p="auto" class="on">Según rareza</button><button type="button" data-p="reventa">Reventa</button><button type="button" data-p="coleccion">Colección</button></div></div>
      <button class="btn primary" type="submit">Agregar ${ready.length} al vault</button>
    </form>`);
  const s = openSheet({ title: 'Agregar al vault', body });
  let cost = 'market', dest = 'auto';
  $$('.cost button', body).forEach((b) => (b.onclick = () => {
    cost = b.dataset.k;
    $$('.cost button', body).forEach((x) => x.classList.toggle('on', x === b));
    $('.paid-box', body).hidden = cost !== 'paid';
  }));
  $$('.purpose button', body).forEach((b) => (b.onclick = () => ((dest = b.dataset.p), $$('.purpose button', body).forEach((x) => x.classList.toggle('on', x === b)))));
  body.onsubmit = async (e) => {
    e.preventDefault();
    if (body.dataset.saving) return;
    const total = cost === 'paid' ? parseAmount($('.total', body).value, 'CLP') : null;
    if (cost === 'paid' && !(total > 0)) return toast('Ingresa el total que pagaste', 'err');
    body.dataset.saving = '1';
    $('[type=submit]', body).textContent = 'Guardando…';
    const date = $('.date', body).value || localDate();
    const fx = (date < localDate() ? (await fxOn(date))?.usdclp : null) || state.fx.usdclp;
    const shares = cost === 'paid' ? splitLot(total, values) : null;
    const event = $('.event', body).value.trim();
    rememberEvent(event);
    ready.forEach((x, i) =>
      addItems({
        card: x.card, variant: x.variant, price: shares ? shares[i] : values[i] * fx, currency: 'CLP', fx, date, condition: x.condition || 'NM',
        purpose: dest === 'auto' ? undefined : dest, event, source: 'Carga inicial', notes: shares ? `Inventario (${ready.length} cartas, ${fmtCLP(total)})` : 'Inventario: costo = mercado al cargarla',
      })
    );
    // Unrecognized pockets stay so you can still choose them.
    D.items = D.items.filter(pending);
    ready.forEach((x) => thumbs.delete(x.uid));
    save();
    s.close();
    toast(`${ready.length} carta${ready.length === 1 ? '' : 's'} agregada${ready.length === 1 ? '' : 's'} al vault`, 'ok');
    if (!D.items.length) location.hash = '#/coleccion';
  };
}
