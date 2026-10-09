// Tests for condition/graded valuation, max price, sale channels, expenses, lots, report and alerts.
// Run with:  node tests/features.test.mjs

import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
globalThis.alert = () => {};
const S = await import('../js/store.js');
const { state } = S;

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
  const ev = r.events.find((e) => e.key === 'Feria Persa');
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

console.log(`${pass} pruebas de funciones nuevas OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
