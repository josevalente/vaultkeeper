// Lote: value a pile of cards at the feria. Add them one by one, by burst scan or by search; see
// the total market value, the most you should offer for your target margin, and the verdict on
// what the seller asks. Then buy the whole lot (cost split by market value) or just add them.

import { h, esc, $, $$, fmtCLP, fmtUSD, fmtPct, parseAmount, localDate, toast } from '../util.js';
import { state, save, lotTotals, splitLot, addItems, setPrice, CONDITIONS, condFactor, marketUSD, channelById } from '../store.js';
import { getCard, img, variantLabel } from '../api.js';
import { scanFlow, openSearch, openSheet, openCardSheet, money, moneyAlt, pctClass, confirmSheet, eventField, cardTile, kindPill } from '../ui.js';
import { refreshFx } from '../fx.js';

const lot = () => state.lotDraft;

// A lot entry keeps the card brief + chosen version/condition; market comes from saved prices.
const entryUSD = (x) => {
  const m = marketUSD(x.card.id, x.variant);
  return m == null ? null : m * (x.card.kind === 'sealed' ? 1 : condFactor(x.condition));
};

async function addCard(brief, { review = null } = {}) {
  try {
    const { card, prices } = await getCard(brief.id);
    setPrice(card.id, prices);
    const variant = card.variants.find((v) => prices.tp?.[v]?.market != null) || card.variants[0] || 'normal';
    lot().items.push({ card: slim(card), variant, condition: card.kind === 'sealed' ? null : 'NM', review });
  } catch {
    lot().items.push({ card: slim(brief), variant: 'normal', condition: 'NM', review });
  }
}

const slim = (c) => ({ id: c.id, name: c.name, setName: c.setName, setId: c.setId, number: c.number, total: c.total, rarity: c.rarity, image: c.image, variants: c.variants || [], kind: c.kind, lang: c.lang, pid: c.pid });

export function renderLote(root) {
  const L = lot();
  const ask = parseAmount(L.ask, L.askCur);
  const T = lotTotals(L.items.map((x) => ({ marketUSD: entryUSD(x) })), ask > 0 ? ask : null, L.askCur);
  const ch = channelById(state.settings.defaultChannel);
  const off = T.verdict ? T.verdict.off : null;

  root.innerHTML = `
    <div class="view-head rise">
      <h1>Lote</h1>
      <p class="muted">Arma el lote que te ofrecen y te digo cuánto vale y cuánto pagar como máximo para ganar ${state.settings.targetMargin}% vendiendo ${esc(ch?.name || '')}.</p>
    </div>

    <section class="quick rise" style="--d:1">
      <button class="qa burst"><span class="qa-ico">◎◎</span><b>Escanear en ráfaga</b><small>Varias cartas seguidas</small></button>
      <button class="qa one"><span class="qa-ico">◎</span><b>Escanear una</b><small>o buscar por nombre</small></button>
    </section>

    <section class="panel rise" style="--d:2">
      <div class="panel-head"><h2>${L.items.length} carta${L.items.length === 1 ? '' : 's'}</h2>${L.items.length ? '<button class="link clear">Vaciar</button>' : ''}</div>
      <div class="tlist">${L.items.map((x, i) => row(x, i)).join('') || `<p class="muted small">Agrega cartas con la cámara o con Buscar.</p>`}</div>
      <button class="btn ghost full search">⌕ Agregar buscando</button>
    </section>

    <section class="balance rise" style="--d:3">
      <div class="bal-row"><div><span>Valor de mercado</span><b>${money(T.marketUSD)}</b><small class="muted">${moneyAlt(T.marketUSD)}${T.priced < L.items.length ? ` · ${L.items.length - T.priced} sin precio` : ''}</small></div>
      <div class="r"><span>Paga como máximo</span><b class="gold">${fmtCLP(T.maxCLP)}</b><small class="muted">${fmtUSD(T.maxUSD)}</small></div></div>
      <div class="label">¿Cuánto piden por todo?</div>
      <div class="money-in"><input class="input ask" inputmode="decimal" placeholder="0" value="${esc(L.ask)}"><div class="seg cur"><button data-c="CLP" class="${L.askCur === 'CLP' ? 'on' : ''}">CLP</button><button data-c="USD" class="${L.askCur === 'USD' ? 'on' : ''}">USD</button></div></div>
      ${T.verdict ? `<div class="verdict-box ${T.verdict.cls}"><div class="vb-label">${T.verdict.label}</div><div class="vb-main">${off >= 0 ? `${fmtPct(off, { sign: false })} bajo mercado` : `${fmtPct(-off, { sign: false })} sobre mercado`}</div><div class="vb-sub">Si lo revendes todo a mercado: <b class="${pctClass(T.profitUSD)}">${money(T.profitUSD, { sign: true })}</b>${ask > T.maxCLP && L.askCur === 'CLP' ? ` · ofrece ${fmtCLP(T.maxCLP)} o menos` : ''}</div></div>` : ''}
      <div class="btn-row"><button class="btn ghost addonly" ${L.items.length ? '' : 'disabled'}>Solo agregar</button><button class="btn primary buy" ${L.items.length ? '' : 'disabled'}>Comprar el lote</button></div>
    </section>`;

  // conditions / remove / review
  $$('.trow', root).forEach((r) => {
    const i = Number(r.dataset.i);
    $('.cond', r)?.addEventListener('change', (e) => ((L.items[i].condition = e.target.value), save()));
    $('.var', r)?.addEventListener('change', (e) => ((L.items[i].variant = e.target.value), save()));
    $('.rm', r).onclick = () => (L.items.splice(i, 1), save());
    $('.fix', r)?.addEventListener('click', () => fixEntry(i));
    $('.open', r).onclick = () => openCardSheet(L.items[i].card.id);
  });
  $('.clear', root)?.addEventListener('click', async () => {
    if (await confirmSheet('Vaciar lote', '¿Quitar todas las cartas del lote?', 'Vaciar', true)) {
      state.lotDraft = { items: [], ask: '', askCur: 'CLP' };
      save();
    }
  });
  $('.ask', root).onchange = (e) => ((L.ask = e.target.value), save());
  $$('.cur button', root).forEach((b) => (b.onclick = () => ((L.askCur = b.dataset.c), save())));

  const pick = async (c) => {
    await addCard(c);
    save();
  };
  $('.one', root).onclick = () => scanFlow({ title: 'Carta del lote', onPick: pick });
  $('.search', root).onclick = () => openSearch({ onPick: pick });
  $('.burst', root).onclick = () =>
    scanFlow({
      title: 'Lote en ráfaga',
      burst: true,
      onBurst: async (results) => {
        toast(`Agregando ${results.length} carta${results.length === 1 ? '' : 's'}…`);
        for (const r of results) {
          if (!r.cands?.length) {
            L.items.push({ card: { id: 'pendiente-' + Math.random().toString(36).slice(2, 7), name: 'Sin reconocer', setName: 'Toca “Elegir” para buscarla', number: '', image: '', variants: [] }, variant: 'normal', condition: 'NM', review: { shot: r.shot, cands: [], info: r.info || {} } });
            continue;
          }
          const sure = r.cands.length === 1 && r.info?.number;
          await addCard(r.cands[0], { review: sure ? null : { shot: r.shot, cands: r.cands.slice(0, 30), info: r.info } });
        }
        save();
      },
    });
  $('.addonly', root).onclick = () => finish(false);
  $('.buy', root).onclick = () => finish(true);
}

function row(x, i) {
  const v = entryUSD(x);
  const sealed = x.card.kind === 'sealed';
  return `
    <div class="trow lot-row ${x.review ? 'review' : ''}" data-i="${i}">
      <img class="open" src="${esc(img(x.card.image))}" alt="" onerror="this.src='icons/card-back.svg'">
      <div class="trow-main">
        <b>${esc(x.card.name)}</b>
        <small>${esc(x.card.setName || '')}${x.card.number ? ` · ${esc(x.card.number)}` : ''} ${kindPill(x.card)}</small>
        <div class="lot-ctrls">
          ${x.card.variants?.length > 1 ? `<select class="input small var">${x.card.variants.map((k) => `<option value="${esc(k)}" ${k === x.variant ? 'selected' : ''}>${esc(variantLabel(k))}</option>`).join('')}</select>` : ''}
          ${sealed ? '' : `<select class="input small cond">${Object.keys(CONDITIONS).map((k) => `<option ${k === x.condition ? 'selected' : ''}>${k}</option>`).join('')}</select>`}
          ${x.review ? `<button class="chip-btn fix">${x.review.cands?.length ? '¿Es esta? Cambiar' : 'Elegir'}</button>` : ''}
        </div>
      </div>
      <div class="trow-val"><b>${v != null ? money(v) : '—'}</b><small>${v != null ? moneyAlt(v) : 'sin precio'}</small></div>
      <button class="icon-btn rm" aria-label="Quitar">✕</button>
    </div>`;
}

// Burst results that weren't certain: show the capture and the candidates to choose from.
function fixEntry(i) {
  const L = lot();
  const x = L.items[i];
  const cands = x.review?.cands || [];
  const body = h(`
    <div>
      <div class="shot-row">${x.review?.shot ? `<img class="shot" src="${x.review.shot}" alt="">` : ''}<p class="muted small">Toca la carta correcta${cands.length ? '' : ' o búscala'}.</p></div>
      ${cands.length ? `<div class="grid grid-tight">${cands.map((c) => cardTile(c)).join('')}</div>` : ''}
      <button class="btn ghost full search">⌕ Buscar</button>
    </div>`);
  const s = openSheet({ title: 'Elegir carta', body, cls: 'tall' });
  const replace = async (c) => {
    L.items.splice(i, 1);
    const before = L.items.length;
    await addCard(c);
    L.items.splice(i, 0, L.items.splice(before, 1)[0]); // keep position
    save();
  };
  body.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (t) {
      s.close();
      replace(cands.find((c) => c.id === t.dataset.id));
    }
  });
  $('.search', body).onclick = () => (s.close(), openSearch({ onPick: replace, initial: x.review?.info?.name || '' }));
}

async function finish(paid) {
  const L = lot();
  const ready = L.items.filter((x) => !x.card.id.startsWith('pendiente-'));
  if (!ready.length) return toast('No hay cartas reconocidas en el lote', 'err');
  if (L.items.some((x) => x.review)) {
    if (!(await confirmSheet('Revisar lote', 'Hay cartas que el escáner no reconoció con seguridad (marcadas en amarillo). ¿Seguir igual?', 'Seguir'))) return;
  }
  await refreshFx();
  const fx = state.fx.usdclp;
  const values = ready.map((x) => entryUSD(x) || 0);
  const body = h(`
    <form class="form">
      ${
        paid
          ? `<label class="field"><span>Pagaste por todo</span><div class="money-in"><input class="input price" inputmode="decimal" required value="${esc(L.ask || '')}"><div class="seg cur"><button type="button" data-c="CLP" class="${L.askCur === 'CLP' ? 'on' : ''}">CLP</button><button type="button" data-c="USD" class="${L.askCur === 'USD' ? 'on' : ''}">USD</button></div></div></label>
             <p class="muted small">Se reparte entre las ${ready.length} cartas según su valor de mercado (las sin precio quedan con costo 0).</p>`
          : `<p class="muted small">Se agregan con costo = valor de mercado de hoy (útil para cargar cartas que ya tenías). Puedes editar cada compra después.</p>`
      }
      <label class="field"><span>Fecha</span><input class="input date" type="date" value="${localDate()}"></label>
      ${eventField()}
      <div class="field"><span>Destino</span><div class="seg purpose"><button type="button" data-p="auto" class="on">Según rareza</button><button type="button" data-p="reventa">Todo reventa</button><button type="button" data-p="coleccion">Todo colección</button></div></div>
      <button class="btn primary" type="submit">${paid ? 'Registrar compra' : 'Agregar al vault'}</button>
    </form>`);
  const s = openSheet({ title: paid ? 'Comprar el lote' : 'Agregar sin compra', body });
  let cur = L.askCur, dest = 'auto';
  $$('.cur button', body).forEach((b) => (b.onclick = () => ((cur = b.dataset.c), $$('.cur button', body).forEach((x) => x.classList.toggle('on', x === b)))));
  $$('.purpose button', body).forEach((b) => (b.onclick = () => ((dest = b.dataset.p), $$('.purpose button', body).forEach((x) => x.classList.toggle('on', x === b)))));
  body.onsubmit = (e) => {
    e.preventDefault();
    const total = paid ? parseAmount($('.price', body).value, cur) : null;
    if (paid && !(total > 0)) return toast('Ingresa cuánto pagaste', 'err');
    const shares = paid ? splitLot(total, values) : values.map((v) => (cur === 'CLP' ? v * fx : v));
    const curUsed = paid ? cur : 'CLP';
    const event = $('.event', body).value.trim();
    ready.forEach((x, i) => {
      addItems({
        card: x.card, variant: x.variant, price: paid ? shares[i] : values[i] * fx, currency: curUsed, fx, date: $('.date', body).value || localDate(),
        purpose: dest === 'auto' ? undefined : dest, condition: x.condition || 'NM', event, source: paid ? 'Lote' : 'Carga inicial', notes: paid ? `Lote de ${ready.length}` : 'Agregada sin compra (costo = mercado)',
      });
    });
    state.lotDraft = { items: L.items.filter((x) => x.card.id.startsWith('pendiente-')), ask: '', askCur: 'CLP' };
    save();
    s.close();
    toast(`${ready.length} carta${ready.length === 1 ? '' : 's'} en el vault`, 'ok');
    location.hash = '#/coleccion';
  };
}
