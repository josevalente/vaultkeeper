// Tests for condition/graded valuation, max price, sale channels, expenses, lots, report and alerts.
// Run with:  node tests/features.test.mjs

import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k], key: (i) => Object.keys(mem)[i] ?? null, get length() { return Object.keys(mem).length; } };
globalThis.alert = () => {};
const S = await import('../js/store.js');
const { state } = S;
const U = await import('../js/util.js');
const { roundCLP } = U;

let pass = 0;
const test = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} esperado ${b}, obtuve ${a}`);
const reset = () => {
  Object.assign(state, { items: [], prices: {}, priceHist: {}, history: [], wishlist: {}, expenses: [], alertsSeen: {} });
  state.fx = { usdclp: 1000, eurusd: 1.1, at: Date.now(), src: 'test' };
  Object.assign(state.settings, { targetMargin: 30, alertPct: 10, defaultChannel: 'feria', display: 'CLP' });
  state.settings.channels = [{ id: 'feria', name: 'Feria', feePct: 0, fixedCLP: 0 }, { id: 'insta', name: 'Instagram', feePct: 0, fixedCLP: 0 }];
};
const card = (id, extra = {}) => ({ id, name: 'Carta ' + id, setId: 'x', setName: 'X', number: '1', total: 100, rarity: 'Rare', image: '', ...extra });

test('estado de la carta descuenta del precio Near Mint', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 100 } } });
  const [nm] = S.addItems({ card: card('a'), variant: 'holofoil', price: 10000, currency: 'CLP' });
  const [lp] = S.addItems({ card: card('a'), variant: 'holofoil', price: 10000, currency: 'CLP', condition: 'LP' });
  const [hp] = S.addItems({ card: card('a'), variant: 'holofoil', price: 10000, currency: 'CLP', condition: 'HP' });
  near(S.itemValueUSD(nm), 100);
  near(S.itemValueUSD(lp), 85);
  near(S.itemValueUSD(hp), 50);
  near(S.summary().valueUSD, 235);
});

test('gradeada usa el valor que ingresaste', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 100 } } });
  const [g] = S.addItems({ card: card('a'), variant: 'holofoil', price: 300000, currency: 'CLP', graded: { co: 'PSA', grade: '10', cert: '123', usd: 650 } });
  near(S.itemValueUSD(g), 650);
});

test('sellados no tienen estado', () => {
  reset();
  S.setPrice('sealed-1', { tp: { normal: { market: 145 } } });
  const [b] = S.addItems({ card: card('sealed-1', { kind: 'sealed' }), variant: 'normal', price: 100000, currency: 'CLP', condition: 'HP' });
  assert.equal(b.condition, null);
  assert.equal(b.purpose, 'reventa');
  near(S.itemValueUSD(b), 145);
});

test('precio máximo a pagar deja el margen objetivo después de la comisión', () => {
  reset();
  near(S.maxPayUSD(130, { feePct: 0, marginPct: 30 }), 100);
  near(S.maxPayUSD(100, { feePct: 10, marginPct: 20 }), 75);
  const m = S.maxPayUSD(326.74, { feePct: 13, marginPct: 30 });
  near((326.74 * 0.87) / m - 1, 0.3, 1e-9, 'margen resultante');
});

test('comisión del canal: porcentaje + monto fijo', () => {
  near(S.netOfChannel(100000, 'CLP', { feePct: 13, fixedCLP: 700 }), 86300);
  near(S.netOfChannel(100, 'USD', { feePct: 10, fixedCLP: 1000 }, 1000), 89);
  near(S.netOfChannel(500, 'CLP', { feePct: 0, fixedCLP: 700 }), 0, 1e-9, 'nunca negativo');
});

test('lote: total, oferta máxima y veredicto', () => {
  reset();
  const t = S.lotTotals([{ marketUSD: 80 }, { marketUSD: 50 }, { marketUSD: null }], 70000, 'CLP');
  near(t.marketUSD, 130);
  near(t.maxUSD, 100);
  assert.equal(t.maxCLP, 100000);
  assert.equal(t.verdict.label, 'Ganga'); // 70 vs 130
  near(t.profitUSD, 60);
  assert.equal(t.priced, 2);
});

test('lote: el pago se reparte según valor de mercado y suma exacto', () => {
  const parts = S.splitLot(90000, [60, 30, 0]);
  near(parts[0], 60000);
  near(parts[1], 30000);
  near(parts[2], 0);
  near(S.splitLot(10000, [0, 0]).reduce((a, b) => a + b, 0), 10000);
});

test('reporte por mes, evento y canal con gastos', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 100 } } });
  const [a, b] = S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP', date: '2026-10-04', event: 'Feria Persa', qty: 2 });
  S.recordExit(a, { kind: 'sale', price: 80000, currency: 'CLP', date: '2026-10-05', channel: 'insta', event: 'Feria Persa' });
  S.addExpense({ date: '2026-10-04', amountCLP: 5000, cat: 'Entrada feria', event: 'Feria Persa' });
  const r = S.report();
  const oct = r.months.find((m) => m.key === '2026-10');
  assert.equal(oct.buys, 100000);
  assert.equal(oct.sales, 80000);
  assert.equal(oct.profit, 30000);
  assert.equal(oct.expenses, 5000);
  assert.equal(oct.net, 25000);
  const ev = r.events.find((e) => e.name === 'Feria Persa');
  assert.equal(ev.net, 25000);
  assert.equal(r.channels.find((c) => c.key === 'insta').sales, 80000);
  assert.equal(S.summary().realNetCLP, 25000);
  assert.ok(b.status === 'held');
});

test('alertas: wishlist bajo la meta, movimiento >10% en 7 días, listo para vender', () => {
  reset();
  S.setPrice('w', { tp: { holofoil: { market: 40 }, normal: { market: 30 } } });
  state.wishlist.w = { id: 'w', name: 'Deseada', targetCLP: 35000 };
  S.setPrice('a', { tp: { holofoil: { market: 130 } } });
  const [it] = S.addItems({ card: card('a'), variant: 'holofoil', price: 100000, currency: 'CLP' });
  state.priceHist['a|holofoil'] = [['2026-09-28', 100], ['2026-10-01', 110], ['2026-10-08', 130]];
  const al = S.computeAlerts();
  assert.ok(al.some((x) => x.kind === 'wish'), 'wishlist: versión más barata 30 USD = 30.000 ≤ 35.000');
  assert.ok(al.some((x) => x.kind === 'up' && Math.round(x.change * 100) === 18), 'subió 18% vs el 01-10 (7 días antes)');
  assert.ok(al.some((x) => x.kind === 'sell' && x.itemId === it.id), '30% sobre la compra = margen objetivo');
  S.dismissAlert(al[0].key);
  assert.equal(S.computeAlerts().length, al.length - 1, 'descartada queda oculta');
});

test('comisión fija del canal en todas las estimaciones', () => {
  reset();
  state.settings.channels[0] = { id: 'feria', name: 'ML', feePct: 13, fixedCLP: 1000 };
  // US$10 a $1.000/US$ → neto = 10 × 0,87 − 1 = 7,7 USD; máximo para 30% = 7,7 / 1,3
  near(S.netEstimateUSD(10), 7.7);
  near(S.maxPayUSD(10), 7.7 / 1.3);
  near(S.dealVerdict(5, 10).profitUSD, 2.7);
  near(S.lotTotals([{ marketUSD: 10 }], null, 'CLP').maxUSD, 7.7 / 1.3, 1e-9, 'lote y ficha dan lo mismo');
});

test('precio mínimo del ranking respeta el estado de la copia', () => {
  reset();
  S.setPrice('h', { tp: { holofoil: { market: 10, low: 9 } } });
  S.addItems({ card: card('h'), variant: 'holofoil', price: 1000, currency: 'CLP', condition: 'HP' });
  const [r] = S.sellRanking();
  assert.equal(r.listCLP, 5000, 'HP = 50% de US$10');
  assert.ok(r.floorCLP <= r.listCLP, `mínimo ${r.floorCLP} no puede superar el de publicación ${r.listCLP}`);
});

test('carta barata: publicar y mínimo con redondeo acorde (Pikachu $500 → vale $736)', () => {
  reset();
  S.setPrice('p', { tp: { normal: { market: 0.736 } } });
  S.addItems({ card: card('p'), variant: 'normal', price: 500, currency: 'CLP' });
  const [r] = S.sellRanking();
  assert.equal(r.listCLP, 700, 'publicar ≈ valor de mercado');
  assert.equal(r.floorCLP, 600, 'mínimo = costo + 10% ($550) redondeado hacia arriba');
  assert.ok(r.floorCLP <= r.listCLP);
});

test('redondeo de precios en pesos según el tamaño', () => {
  assert.equal(roundCLP(736), 700);
  assert.equal(roundCLP(550, 'ceil'), 600);
  assert.equal(roundCLP(12340), 12500);
  assert.equal(roundCLP(12340, 'floor'), 12000);
  assert.equal(roundCLP(87654), 88000);
  assert.equal(roundCLP(null), null);
});

test('varias copias de la misma carta generan una sola alerta', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 130 } } });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 100000, currency: 'CLP', qty: 3 });
  state.priceHist['a|holofoil'] = [['2026-10-01', 100], ['2026-10-08', 130]];
  const al = S.computeAlerts();
  assert.equal(al.filter((x) => x.kind === 'up').length, 1);
  assert.equal(al.filter((x) => x.kind === 'sell').length, 1);
});

test('reporte: trueques aparte; compras sin trueques ni cargas iniciales', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 100 } } });
  const [a] = S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP', date: '2026-10-02' });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 99000, currency: 'CLP', date: '2026-10-02', source: 'Carga inicial' });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 70000, currency: 'CLP', date: '2026-10-02', source: 'Intercambio' });
  S.recordExit(a, { kind: 'trade', price: 100, currency: 'USD', fx: 1000, date: '2026-10-03' });
  const oct = S.report().months.find((m) => m.key === '2026-10');
  assert.equal(oct.buys, 50000);
  assert.equal(oct.sales, 0);
  assert.equal(oct.tradeN, 1);
  assert.equal(oct.profit, 50000, 'el trueque sí es ganancia realizada');
  const sm = S.summary();
  assert.equal(sm.exits, 0);
  assert.equal(sm.trades, 1);
});

test('el respaldo no lleva las API keys y al importar se mantienen las del teléfono', () => {
  reset();
  state.settings.claudeKey = 'sk-ant-secreta';
  state.settings.ptcgKey = 'ptcg-secreta';
  const dump = S.exportData();
  assert.ok(!dump.includes('secreta'));
  S.replaceAll(JSON.parse(dump));
  assert.equal(state.settings.claudeKey, 'sk-ant-secreta');
});

test('lista de venta: el precio sugerido no se congela', () => {
  reset();
  S.setPrice('a', { tp: { holofoil: { market: 20 } } });
  const [it] = S.addItems({ card: card('a'), variant: 'holofoil', price: 10000, currency: 'CLP' });
  S.setAsk(it, S.suggestedAskCLP(it));
  assert.equal(it.askCLP, undefined, 'sin cambios no se guarda');
  S.setPrice('a', { tp: { holofoil: { market: 35 } } });
  assert.equal(S.suggestedAskCLP(it), 35000, 'sigue al mercado');
  S.setAsk(it, 30000);
  assert.equal(it.askCLP, 30000, 'un precio cambiado sí se guarda');
});

test('feria recordada solo el mismo día', () => {
  reset();
  S.rememberEvent('Feria Persa');
  assert.equal(S.todayEvent(), 'Feria Persa');
  state.settings.lastEvent.date = '2020-01-01';
  assert.equal(S.todayEvent(), '');
});

test('montos tipeados con coma o punto de miles', () => {
  const { parseAmount } = U;
  assert.equal(parseAmount('12,500', 'CLP'), 12500, 'teclado del iPhone: coma de miles');
  assert.equal(parseAmount('1,000', 'CLP'), 1000);
  assert.equal(parseAmount('12.500', 'CLP'), 12500);
  assert.equal(parseAmount('$1.234.567', 'CLP'), 1234567);
  assert.equal(parseAmount('12,5', 'CLP'), 12.5);
  assert.equal(parseAmount('US$1.250', 'USD'), 1250, 'como lo escribe fmtUSD');
  assert.equal(parseAmount('12,50', 'USD'), 12.5);
  assert.equal(parseAmount('12.50', 'USD'), 12.5);
  assert.equal(parseAmount('1.250,50', 'USD'), 1250.5);
  assert.equal(parseAmount('1,250.50', 'USD'), 1250.5);
});

test('redondeo de cartas muy baratas y signo de $0', () => {
  assert.equal(roundCLP(38), 40, 'no "$0"');
  assert.equal(roundCLP(38, 'floor'), 0, 'pagar como máximo sí puede ser $0');
  assert.equal(U.fmtCLP(-0.4, { sign: true }), '$0');
});

test('Vender desde el ranking nunca rellena bajo el mínimo', () => {
  reset();
  S.setPrice('m', { tp: { holofoil: { market: 9.5 } } });
  S.addItems({ card: card('m'), variant: 'holofoil', price: 9000, currency: 'CLP' });
  const [r] = S.sellRanking({ includeKeep: true });
  assert.ok(r.underFloor, 'mercado bajo el mínimo');
  assert.ok(r.askCLP >= r.floorCLP, `rellena ${r.askCLP}, mínimo ${r.floorCLP}`);
});

test('el redondeo en el borde de $5.000 no inventa un mercado bajo el mínimo', () => {
  reset();
  S.setPrice('b', { tp: { holofoil: { market: 5.239 } } });
  S.addItems({ card: card('b'), variant: 'holofoil', price: 4590, currency: 'CLP' });
  const [r] = S.sellRanking({ includeKeep: true });
  assert.equal(r.underFloor, false, 'a mercado deja +14%');
  assert.ok(r.listCLP >= r.floorCLP, `publicar ${r.listCLP} ≥ mínimo ${r.floorCLP}`);
});

test('veredicto: con comisión fija una carta barata no es "Ganga"', () => {
  reset();
  state.settings.channels[0].fixedCLP = 1000;
  const v = S.dealVerdict(0.5, 1); // piden $500 por una carta de $1.000
  assert.equal(v.label, 'No deja ganancia');
  assert.equal(S.maxPayUSD(1), 0);
});

test('lote: la comisión fija solo cuenta por cartas con precio', () => {
  reset();
  state.settings.channels[0].fixedCLP = 1000;
  const two = S.lotTotals([{ marketUSD: 20 }, { marketUSD: 20 }]);
  const withUnpriced = S.lotTotals([{ marketUSD: 20 }, { marketUSD: 20 }, { marketUSD: 0 }, { marketUSD: 0 }, { marketUSD: 0 }]);
  assert.equal(withUnpriced.maxCLP, two.maxCLP);
  const cheap = S.lotTotals([{ marketUSD: 20 }, { marketUSD: 0.5 }]);
  const alone = S.lotTotals([{ marketUSD: 20 }]);
  assert.ok(cheap.maxCLP >= alone.maxCLP, 'una carta barata no resta del resto');
});

test('gradeada ingresada en pesos no cambia con el dólar', () => {
  reset();
  const [g] = S.addItems({ card: card('g'), variant: 'holofoil', price: 50000, currency: 'CLP', graded: { co: 'PSA', grade: '10', clp: 100000, usd: 100 } });
  state.fx.usdclp = 1250;
  near(S.itemValueUSD(g) * state.fx.usdclp, 100000, 1e-6);
});

test('intercambio solo por efectivo no da ingreso negativo', () => {
  const p = S.planTrade([10], [], 5, 0);
  assert.ok(p.proceeds[0] >= 0);
});

test('sin espacio: libera caché e historial de cartas que ya no tienes antes de rendirse', () => {
  reset();
  const [it] = S.addItems({ card: card('k'), variant: 'holofoil', price: 1000, currency: 'CLP' });
  state.priceHist['k|holofoil'] = [['2026-10-01', 1]];
  state.priceHist['vendida|holofoil'] = [['2026-10-01', 1]];
  localStorage.setItem('vkc:rar:sir', 'x'.repeat(100));
  const real = localStorage.setItem;
  let failOnce = true;
  localStorage.setItem = (k, v) => {
    if (k === 'vaultkeeper:v1' && failOnce) {
      failOnce = false;
      throw new Error('QuotaExceededError');
    }
    return real(k, v);
  };
  let alerted = false;
  globalThis.alert = () => (alerted = true);
  try {
    S.save({ silent: true });
  } finally {
    localStorage.setItem = real;
    globalThis.alert = () => {};
  }
  assert.equal(alerted, false, 'logró guardar después de liberar espacio');
  assert.equal(localStorage.getItem('vkc:rar:sir'), null, 'borró la caché');
  assert.ok(state.priceHist['k|holofoil'], 'conserva el historial de lo que tienes');
  assert.equal(state.priceHist['vendida|holofoil'], undefined);
  assert.ok(it);
});

test('eventos: mismo evento aunque se escriba distinto, renombrar, unir y quitar', () => {
  reset();
  S.setPrice('e', { tp: { holofoil: { market: 50 } } });
  const [a1] = S.addItems({ card: card('e'), variant: 'holofoil', price: 10000, currency: 'CLP', date: '2026-10-12', event: 'Feria Persa' });
  const [a2] = S.addItems({ card: card('e'), variant: 'holofoil', price: 20000, currency: 'CLP', date: '2026-10-13', event: '  feria   persa ' });
  assert.equal(a2.buy.event, 'Feria Persa', 'usa la forma ya escrita');
  S.recordExit(a1, { kind: 'sale', price: 30000, currency: 'CLP', date: '2026-10-13', fx: 1000, event: 'FERIA PERSA' });
  S.addExpense({ date: '2026-10-12', amountCLP: 5000, cat: 'Entrada feria', event: 'Feria persa' });
  let [ev] = S.report().events;
  assert.equal(S.report().events.length, 1);
  assert.equal(ev.name, 'Feria Persa');
  assert.equal(ev.buyN, 2);
  assert.equal(ev.saleN, 1);
  assert.equal(ev.from, '2026-10-12');
  assert.equal(ev.to, '2026-10-13');
  near(ev.net, 30000 - 10000 - 5000);
  // a typo creates a second event; merging it by renaming
  state.expenses.push({ id: 'x', date: '2026-10-13', amountCLP: 1000, cat: 'Comida', event: 'Feria Persa Biobio' });
  assert.equal(S.report().events.length, 2);
  const typo = S.report().events.find((e) => e.name === 'Feria Persa Biobio');
  S.renameEvent(typo.key, 'feria persa');
  assert.equal(S.report().events.length, 1, 'unidos');
  assert.equal(state.expenses.find((e) => e.id === 'x').event, 'Feria Persa');
  // rename only the spelling
  ev = S.report().events[0];
  S.renameEvent(ev.key, 'Feria Persa Biobío 2026');
  assert.equal(S.report().events[0].name, 'Feria Persa Biobío 2026');
  // sale event edited afterwards
  S.setExitEvent(a1, 'Instagram');
  assert.equal(a1.exit.event, 'Instagram');
  // remove an event everywhere
  S.removeEvent(S.eventKey('Feria Persa Biobío 2026'));
  assert.ok(state.items.every((it) => !it.buy.event));
  assert.equal(S.report().events.length, 1, 'solo queda Instagram');
});

console.log(`${pass} pruebas de funciones nuevas OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
