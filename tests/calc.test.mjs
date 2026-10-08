// Calculation audit for VaultKeeper. Run with:  node tests/calc.test.mjs
// Covers amount parsing, FX conversion, cost basis, portfolio value, realized P/L,
// price fallbacks, deal verdicts, sell suggestions and trade accounting.

import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
globalThis.alert = () => {};

const { parseAmount, fmtCLP, fmtUSD, fmtPct } = await import('../js/util.js');
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
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} esperado ${b}, obtuve ${a}`);

function reset({ fx = 1000, fee = 0, display = 'CLP' } = {}) {
  state.items = [];
  state.prices = {};
  state.priceHist = {};
  state.history = [];
  state.fx = { usdclp: fx, eurusd: 1.1, at: Date.now(), src: 'test' };
  state.settings.feePct = fee;
  state.settings.display = display;
  state.settings.dealPct = 25;
  state.settings.minUSD = 15;
}
const card = (id, rarity = 'Rare') => ({ id, name: 'Test ' + id, setId: 'x', setName: 'X', number: '1', total: 100, rarity, image: '' });
const price = (id, tp, cm) => S.setPrice(id, { tp, cm });

// ─────────────── parsing
test('parseAmount CLP', () => {
  assert.equal(parseAmount('12.500', 'CLP'), 12500);
  assert.equal(parseAmount('$ 1.250.000', 'CLP'), 1250000);
  assert.equal(parseAmount('12500', 'CLP'), 12500);
  assert.equal(parseAmount('240.000', 'CLP'), 240000);
  assert.equal(parseAmount('12,5', 'CLP'), 12.5);
  assert.ok(isNaN(parseAmount('', 'CLP')));
  assert.ok(isNaN(parseAmount('abc', 'CLP')));
});
test('parseAmount USD', () => {
  assert.equal(parseAmount('12.50', 'USD'), 12.5);
  assert.equal(parseAmount('12,50', 'USD'), 12.5);
  assert.equal(parseAmount('1,250.50', 'USD'), 1250.5);
  assert.equal(parseAmount('1.250,50', 'USD'), 1250.5);
  assert.equal(parseAmount('1,250', 'USD'), 1250);
  assert.equal(parseAmount('US$ 326.74', 'USD'), 326.74);
  assert.equal(parseAmount('979,85', 'USD'), 979.85); // exchange-rate field
});
test('formatting', () => {
  assert.equal(fmtCLP(320156.4), '$320.156');
  assert.equal(fmtCLP(-5000, { sign: true }), '−$5.000');
  assert.equal(fmtUSD(326.74), 'US$326.74');
  assert.equal(fmtUSD(10000), 'US$10,000');
  assert.equal(fmtPct(0.274), '+27,4%');
});

// ─────────────── FX conversion & cost basis
test('toUSD / toCLP round trip', () => {
  reset({ fx: 979.85 });
  near(S.toUSD(240000, 'CLP'), 240000 / 979.85);
  near(S.toCLP(S.toUSD(240000, 'CLP'), 'USD'), 240000, 1e-6);
  near(S.toCLP(100, 'USD', 950), 95000);
});
test('purchase in CLP keeps exact pesos; USD cost uses the rate of that moment', () => {
  reset({ fx: 1000 });
  const [it] = S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP', date: '2026-10-01' });
  assert.equal(it.costCLP, 50000);
  near(it.costUSD, 50);
  assert.equal(it.buy.fx, 1000);
  state.fx.usdclp = 900; // dollar moves later: the stored cost must not change
  assert.equal(it.costCLP, 50000);
  near(it.costUSD, 50);
});
test('purchase in USD with an explicit (historical) rate', () => {
  reset({ fx: 1000 });
  const [it] = S.addItems({ card: card('b'), variant: 'normal', price: 20, currency: 'USD', fx: 950, date: '2026-09-01' });
  near(it.costUSD, 20);
  near(it.costCLP, 19000);
});
test('quantity creates one item per copy at the unit price', () => {
  reset();
  const list = S.addItems({ card: card('c'), variant: 'normal', price: 10000, currency: 'CLP', qty: 3 });
  assert.equal(list.length, 3);
  near(S.summary().costCLP, 30000);
});

// ─────────────── prices
test('price fallback order', () => {
  reset();
  price('p', { holofoil: { market: 100, mid: 120, low: 90 }, 'reverse-holofoil': { market: 5 } });
  near(S.marketUSD('p', 'holofoil'), 100);
  near(S.marketUSD('p', 'reverse-holofoil'), 5);
  assert.equal(S.marketUSD('p', 'normal'), null, 'no debe tomar el precio de otra versión cuando hay varias');
  price('q', { holofoil: { market: null, mid: 40, low: 30 } });
  near(S.marketUSD('q', 'holofoil'), 40, 1e-9, 'sin market usa mid');
  price('r', { holofoil: { market: 70 } });
  near(S.marketUSD('r', 'normal'), 70, 1e-9, 'una sola versión listada: se usa');
  price('s', {}, { trend: 10, avg: 9 });
  near(S.marketUSD('s', 'holofoil'), 11, 1e-9, 'Cardmarket EUR→USD');
  assert.equal(S.marketUSD('nada', 'holofoil'), null);
});

// ─────────────── portfolio
test('summary: value, gain and % in both currencies', () => {
  reset({ fx: 1000 });
  price('a', { holofoil: { market: 80 } });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  state.fx.usdclp = 1100;
  const s = S.summary();
  near(s.costCLP, 50000);
  near(s.costUSD, 50);
  near(s.valueUSD, 80);
  near(s.valueCLP, 88000);
  near(s.gainCLP, 38000);
  near(s.pctCLP, 0.76);
  near(s.gainUSD, 30);
  near(s.pctUSD, 0.6);
});
test('summary: copies without price count at cost in both currencies (no phantom FX gain)', () => {
  reset({ fx: 1000 });
  S.addItems({ card: card('nop'), variant: 'normal', price: 50000, currency: 'CLP' });
  state.fx.usdclp = 1200;
  const s = S.summary();
  assert.equal(s.missing, 1);
  near(s.valueCLP, 50000);
  near(s.gainCLP, 0);
  near(s.gainUSD, 0);
});
test('sale with fee: realized P/L and removal from the vault', () => {
  reset({ fx: 1000, fee: 10 });
  price('a', { holofoil: { market: 80 } });
  const [it] = S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  const gross = 90000, net = gross * 0.9;
  S.recordExit(it, { kind: 'sale', price: net, gross, feePct: 10, currency: 'CLP', date: '2026-10-08' });
  const s = S.summary();
  assert.equal(s.n, 0);
  near(s.realCLP, 31000);
  near(s.realUSD, 81 - 50);
  assert.equal(it.exit.gross, 90000);
});
test('sale in USD at a different rate than the purchase', () => {
  reset({ fx: 1000 });
  const [it] = S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  S.recordExit(it, { kind: 'sale', price: 60, currency: 'USD', fx: 950, date: '2026-10-08' });
  near(it.exit.clp, 57000);
  near(S.summary().realCLP, 7000);
  near(S.summary().realUSD, 10);
});
test('daily snapshot stores CLP value at that day rate', () => {
  reset({ fx: 1000 });
  price('a', { holofoil: { market: 80 } });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  const h = state.history.at(-1);
  near(h.cc, 50000);
  near(h.vc, 80000);
  near(h.v, 80);
  assert.equal(state.history.length, 1, 'un punto por día');
  S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  assert.equal(state.history.length, 1, 'mismo día reemplaza el punto');
  near(state.history.at(-1).cc, 100000);
});

// ─────────────── deals & selling
test('deal verdict thresholds', () => {
  reset({ fx: 1000, fee: 0 });
  assert.equal(S.dealVerdict(75, 100).label, 'Ganga');
  assert.equal(S.dealVerdict(85, 100).label, 'Buen precio');
  assert.equal(S.dealVerdict(103, 100).label, 'Precio justo');
  assert.equal(S.dealVerdict(120, 100).label, 'Caro');
  near(S.dealVerdict(240000 / 1000, 326.74).profitUSD, 86.74);
  state.settings.feePct = 10;
  near(S.dealVerdict(200, 300).profitUSD, 70, 1e-9, 'ganancia descuenta comisión');
  assert.equal(S.dealVerdict(5, 10).belowRange, true);
});
test('sell suggestion: list at market, floor covers cost +10% after fee', () => {
  reset({ fx: 1000, fee: 10 });
  price('a', { holofoil: { market: 120, low: 50 } });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP' });
  const [r] = S.sellRanking();
  assert.equal(r.listCLP, 120000);
  assert.ok(r.floorCLP * 0.9 >= 50000 * 1.1, `piso ${r.floorCLP} no cubre costo+10% neto`);
  near(r.gainCLP, 120 * 0.9 * 1000 - 50000);
  assert.equal(r.profitable, true);
});
test('collection items are excluded from the sell ranking unless asked', () => {
  reset();
  price('a', { holofoil: { market: 120 } });
  S.addItems({ card: card('a'), variant: 'holofoil', price: 50000, currency: 'CLP', purpose: 'coleccion' });
  assert.equal(S.sellRanking().length, 0);
  assert.equal(S.sellRanking({ includeKeep: true }).length, 1);
});

// ─────────────── placeholder data repair
test('copy bought as placeholder "Normal" moves to the only priced version; rarity filled', () => {
  reset();
  const [it] = S.addItems({ card: { ...card('n'), rarity: null }, variant: 'normal', price: 10000, currency: 'CLP' });
  S.repairItems({ id: 'n', rarity: 'Classic Collection' }, { tp: { holofoil: { market: 139.24 } } });
  assert.equal(it.variant, 'holofoil');
  assert.equal(it.rarity, 'Classic Collection');
  const [it2] = S.addItems({ card: card('m'), variant: 'normal', price: 10000, currency: 'CLP' });
  S.repairItems({ id: 'm', rarity: 'Rare' }, { tp: { holofoil: { market: 1 }, 'reverse-holofoil': { market: 2 } } });
  assert.equal(it2.variant, 'normal', 'con varias versiones no adivina');
});

// ─────────────── trades
const sum = (a) => a.reduce((x, y) => x + y, 0);
const invariant = (plan, paid, recv) => near(sum(plan.proceeds) - sum(plan.basis), recv - paid, 1e-9, 'Σventas − Σcostos = efectivo neto');
test('trade: cards for cards', () => {
  const plan = S.planTrade([60, 40], [150]);
  near(sum(plan.proceeds), 100);
  near(plan.proceeds[0], 60);
  near(plan.basis[0], 100);
  invariant(plan, 0, 0);
});
test('trade: I add cash', () => {
  const plan = S.planTrade([100], [80, 40], 20, 0);
  near(sum(plan.basis), 120);
  near(plan.basis[0], 80);
  invariant(plan, 20, 0);
});
test('trade: they add cash (less than my cards)', () => {
  const plan = S.planTrade([100], [70], 0, 30);
  near(plan.proceeds[0], 100);
  near(plan.basis[0], 70);
  invariant(plan, 0, 30);
});
test('trade: they pay more cash than my cards are worth', () => {
  const plan = S.planTrade([50], [10], 0, 80);
  near(plan.basis[0], 0);
  near(plan.proceeds[0], 80);
  invariant(plan, 0, 80);
});
test('trade: cards for cash only is a sale', () => {
  const plan = S.planTrade([60, 40], [], 0, 90);
  near(plan.proceeds[0], 54);
  near(plan.proceeds[1], 36);
  invariant(plan, 0, 90);
});
test('trade: buying cards with cash only', () => {
  const plan = S.planTrade([], [30, 10], 50, 0);
  near(plan.basis[0], 37.5);
  invariant(plan, 50, 0);
});
test('trade: received card without price splits basis evenly when none is priced', () => {
  const plan = S.planTrade([100], [0, 0]);
  near(plan.basis[0], 50);
  invariant(plan, 0, 0);
});

console.log(`${pass} pruebas OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
