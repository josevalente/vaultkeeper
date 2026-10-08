// Intercambio: your cards (valued at TCGplayer market) vs. the other person's cards
// (scanned or searched, valued the same way), plus any cash on top.

import { h, esc, $, $$, fmtCLP, fmtUSD, fmtPct, parseAmount, uid, localDate, toast } from '../util.js';
import { state, save, held, itemValueUSD, recordExit, addItems, snapshot, setPrice, toUSD, marketUSD } from '../store.js';
import { img, variantLabel } from '../api.js';
import { openSheet, cardTile, scanFlow, openSearch, openCardSheet, money, moneyAlt, pctClass, confirmSheet } from '../ui.js';

const d = () => state.tradeDraft;

function totals() {
  const t = d();
  const give = t.give.map((id) => state.items.find((x) => x.id === id)).filter((x) => x && x.status === 'held');
  const giveUSD = give.reduce((s, it) => s + (itemValueUSD(it) ?? it.costUSD), 0);
  const getUSD = t.get.reduce((s, g) => s + (g.marketUSD || 0), 0);
  const cashUSD = toUSD(t.cash || 0, t.cashCur);
  const mine = giveUSD + (t.cashDir === 'pay' ? cashUSD : 0);
  const theirs = getUSD + (t.cashDir === 'receive' ? cashUSD : 0);
  return { give, giveUSD, getUSD, cashUSD, mine, theirs, diff: theirs - mine };
}

export function renderTrade(root) {
  const t = d();
  const T = totals();
  const big = Math.max(T.mine, T.theirs) || 1;
  const pct = T.diff / big;
  const verdict = !T.mine && !T.theirs ? null : Math.abs(pct) <= 0.05 ? ['Intercambio justo', 'deal-fair'] : T.diff > 0 ? ['A tu favor', 'deal-good'] : ['En tu contra', 'deal-bad'];
  const share = T.mine + T.theirs ? (T.mine / (T.mine + T.theirs)) * 100 : 50;

  root.innerHTML = `
    <div class="view-head rise">
      <h1>Intercambio</h1>
      <p class="muted">Tu pool valorizado vs. las cartas del otro, ambos a precio TCGplayer.</p>
    </div>

    <section class="panel rise" style="--d:1">
      <div class="panel-head"><h2>Yo doy</h2><b>${money(T.giveUSD)}</b></div>
      <div class="tlist">${T.give.map((it) => row(it.image, it.name, `${it.setName} · ${variantLabel(it.variant)}`, itemValueUSD(it) ?? it.costUSD, `g:${it.id}`)).join('') || `<p class="muted small">Elige cartas de tu vault.</p>`}</div>
      <button class="btn ghost full pick-mine">+ Agregar de mi vault</button>
    </section>

    <section class="panel rise" style="--d:2">
      <div class="panel-head"><h2>Yo recibo</h2><b>${money(T.getUSD)}</b></div>
      <div class="tlist">${t.get.map((g, i) => row(g.card.image, g.card.name, `${g.card.setName} · ${variantLabel(g.variant)}`, g.marketUSD, `r:${i}`)).join('') || `<p class="muted small">Escanea o busca las cartas que te ofrecen.</p>`}</div>
      <div class="btn-row"><button class="btn ghost scan-theirs">◎ Escanear</button><button class="btn ghost search-theirs">⌕ Buscar</button></div>
    </section>

    <section class="panel rise" style="--d:3">
      <div class="panel-head"><h2>Dinero extra</h2></div>
      <div class="seg cashdir"><button data-d="pay" class="${t.cashDir === 'pay' ? 'on' : ''}">Yo pongo</button><button data-d="receive" class="${t.cashDir === 'receive' ? 'on' : ''}">Me pagan</button></div>
      <div class="money-in"><input class="input cash" inputmode="decimal" placeholder="0" value="${t.cash || ''}"><div class="seg cur"><button data-c="CLP" class="${t.cashCur === 'CLP' ? 'on' : ''}">CLP</button><button data-c="USD" class="${t.cashCur === 'USD' ? 'on' : ''}">USD</button></div></div>
    </section>

    <section class="balance rise" style="--d:4">
      <div class="bal-row"><div><span>Tú entregas</span><b>${money(T.mine)}</b></div><div class="r"><span>Recibes</span><b>${money(T.theirs)}</b></div></div>
      <div class="bal-bar"><i style="width:${share.toFixed(1)}%"></i></div>
      ${verdict ? `<div class="verdict-box ${verdict[1]}"><div class="vb-label">${verdict[0]}</div><div class="vb-main">${money(T.diff, { sign: true })} <small>${moneyAlt(T.diff, { sign: true })} · ${fmtPct(pct)}</small></div></div>` : ''}
      <div class="btn-row"><button class="btn ghost clear">Limpiar</button><button class="btn primary confirm" ${T.give.length || t.get.length ? '' : 'disabled'}>Confirmar intercambio</button></div>
    </section>`;

  root.querySelectorAll('.rm').forEach((b) => (b.onclick = () => {
    const [k, v] = b.dataset.k.split(':');
    if (k === 'g') t.give = t.give.filter((id) => id !== v);
    else t.get.splice(Number(v), 1);
    save();
  }));
  root.querySelectorAll('.setval').forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.k.split(':')[1]);
    const v = parseAmount(prompt('Sin precio en TCGplayer. ¿Cuánto vale (CLP)?') || '', 'CLP');
    if (v > 0) {
      t.get[i].marketUSD = toUSD(v, 'CLP');
      save();
    }
  }));
  $('.pick-mine', root).onclick = () => pickMine();
  const addTheirs = (c) =>
    openCardSheet(c.id, {
      pickLabel: 'Agregar a lo que recibo',
      onPick: ({ card, prices, variant }) => {
        setPrice(card.id, prices);
        const m = prices.tp?.[variant]?.market ?? prices.tp?.[variant]?.mid ?? marketUSD(card.id, variant);
        t.get.push({ card, variant, marketUSD: m || 0 });
        save();
      },
    });
  $('.scan-theirs', root).onclick = () => scanFlow({ title: 'Carta que recibes', onPick: addTheirs });
  $('.search-theirs', root).onclick = () => openSearch({ onPick: addTheirs });
  $$('.cashdir button', root).forEach((b) => (b.onclick = () => ((t.cashDir = b.dataset.d), save())));
  $$('.cur button', root).forEach((b) => (b.onclick = () => ((t.cashCur = b.dataset.c), (t.cash = parseAmount($('.cash', root).value, t.cashCur) || 0), save())));
  $('.cash', root).onchange = (e) => ((t.cash = parseAmount(e.target.value, t.cashCur) || 0), save());
  $('.clear', root).onclick = () => {
    state.tradeDraft = { give: [], get: [], cash: 0, cashCur: 'CLP', cashDir: 'pay' };
    save();
  };
  $('.confirm', root).onclick = () => confirmTrade();
}

function row(image, name, sub, usd, key) {
  return `
    <div class="trow">
      <img src="${esc(img(image))}" alt="" onerror="this.src='icons/card-back.svg'">
      <div class="trow-main"><b>${esc(name)}</b><small>${esc(sub)}</small></div>
      ${usd ? `<div class="trow-val"><b>${money(usd)}</b><small>${moneyAlt(usd)}</small></div>` : `<button class="chip-btn setval" data-k="${esc(key)}">Fijar valor</button>`}
      <button class="icon-btn rm" data-k="${esc(key)}" aria-label="Quitar">✕</button>
    </div>`;
}

function pickMine() {
  const t = d();
  const mine = held().sort((a, b) => (itemValueUSD(b) ?? 0) - (itemValueUSD(a) ?? 0));
  const sel = new Set(t.give);
  const body = h(`
    <div>
      ${mine.length ? `<div class="grid grid-tight pickgrid">${mine.map((it) => cardTile({ ...it, id: it.cardId, itemId: it.id }, { badge: `<span class="badge check ${sel.has(it.id) ? 'on' : ''}">✓</span>`, extra: `<div class="tile-val"><b>${money(itemValueUSD(it) ?? it.costUSD)}</b></div>` })).join('')}</div>` : `<div class="empty"><p>Tu vault está vacío.</p></div>`}
      <button class="btn primary full done">Listo</button>
    </div>`);
  const s = openSheet({ title: 'Elige lo que entregas', body, cls: 'tall' });
  $('.pickgrid', body)?.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const id = tile.dataset.item;
    sel.has(id) ? sel.delete(id) : sel.add(id);
    tile.querySelector('.badge').classList.toggle('on', sel.has(id));
  });
  $('.done', body).onclick = () => {
    t.give = [...sel];
    save();
    s.close();
  };
}

async function confirmTrade() {
  const t = d();
  const T = totals();
  const ok = await confirmSheet(
    'Confirmar intercambio',
    `Entregas ${T.give.length} carta(s) y recibes ${t.get.length}. Las tuyas salen del vault valorizadas a mercado; las que recibes entran con ese valor como costo.`,
    'Confirmar'
  );
  if (!ok) return;
  const id = uid();
  const date = localDate();
  T.give.forEach((it) => recordExit(it, { kind: 'trade', price: itemValueUSD(it) ?? it.costUSD, currency: 'USD', date, tradeId: id }));
  // Cost basis of what you receive = market value you handed over + cash you paid − cash you got.
  const basisUSD = Math.max(0, T.giveUSD + (t.cashDir === 'pay' ? T.cashUSD : -T.cashUSD));
  const sumGet = T.getUSD || t.get.length || 1;
  const created = [];
  t.get.forEach((g) => {
    const share = T.getUSD ? (g.marketUSD || 0) / sumGet : 1 / sumGet;
    created.push(
      ...addItems({ card: g.card, variant: g.variant, price: basisUSD * share, currency: 'USD', date, source: 'Intercambio', notes: 'Recibida en intercambio' })
    );
  });
  state.trades.push({ id, date, give: T.give.map((x) => x.id), get: created.map((x) => x.id), cash: t.cash, cashCur: t.cashCur, cashDir: t.cashDir, giveUSD: T.giveUSD, getUSD: T.getUSD });
  state.tradeDraft = { give: [], get: [], cash: 0, cashCur: 'CLP', cashDir: 'pay' };
  snapshot();
  save();
  toast('Intercambio registrado', 'ok');
}
