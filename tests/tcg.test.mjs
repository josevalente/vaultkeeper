// Tests for the Magic / Yu-Gi-Oh vaults (js/tcg/store.js): separate storage, value, sales, ranking.
// Run with:  node tests/tcg.test.mjs

import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k], key: (i) => Object.keys(mem)[i] ?? null, get length() { return Object.keys(mem).length; } };
globalThis.alert = () => {};

// A Pokémon vault with its own cards and the shared settings.
const POKEMON = JSON.stringify({ items: [{ id: 'p1', status: 'held', name: 'Pikachu' }], settings: { display: 'CLP', targetMargin: 30, dealPct: 25, channels: [{ id: 'feria', name: 'Feria', feePct: 0, fixedCLP: 0 }, { id: 'ml', name: 'Mercado Libre', feePct: 13, fixedCLP: 0 }], defaultChannel: 'feria' }, fx: { usdclp: 1000, at: Date.now(), src: 'test' } });
mem['vaultkeeper:v1'] = POKEMON;

const S = await import('../js/tcg/store.js');
const { GAMES } = await import('../js/tcg/games.js');
const V = await import('../js/vaults.js');

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
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `esperado ${b}, obtuve ${a}`);
const print = (id, usd, foil = null) => ({ id, cardKey: id, name: 'Lightning Bolt', setName: 'Magic 2010', setCode: 'M10', number: '146', rarity: 'Común', image: '', imageLarge: '', finishes: [{ key: 'normal', label: 'Normal', usd }, ...(foil != null ? [{ key: 'foil', label: 'Foil', usd: foil }] : [])] });

test('cada vault guarda en su propia clave y no toca el de Pokémon', () => {
  S.openVault(GAMES.mtg);
  S.addItems({ print: print('a', 10), finish: 'normal', price: 5000, currency: 'CLP' });
  assert.ok(mem['vaultkeeper:mtg:v1'], 'Magic tiene su clave');
  assert.equal(mem['vaultkeeper:v1'], POKEMON, 'Pokémon intacto');
  S.openVault(GAMES.ygo);
  assert.equal(S.state.items.length, 0, 'Yu-Gi-Oh empieza vacío');
  S.openVault(GAMES.mtg);
  assert.equal(S.state.items.length, 1, 'Magic conserva su carta');
});

test('valor por acabado (normal / foil) y estado', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  const [n] = S.addItems({ print: print('b', 10, 30), finish: 'normal', price: 5000, currency: 'CLP' });
  const [f] = S.addItems({ print: print('b', 10, 30), finish: 'foil', price: 5000, currency: 'CLP', condition: 'LP' });
  near(S.itemValueUSD(n), 10);
  near(S.itemValueUSD(f), 30 * 0.85);
});

test('carta sin precio cuenta a su costo (sin ganancia inventada por el dólar)', () => {
  S.openVault(GAMES.ygo);
  S.state.items = [];
  S.addItems({ print: { ...print('c', null), finishes: [{ key: 'normal', label: 'UR', usd: null }] }, finish: 'normal', price: 20000, currency: 'CLP', fx: 900 });
  const s = S.summary();
  assert.equal(s.missing, 1);
  near(s.valueCLP, 20000);
  near(s.gainCLP, 0);
});

test('ajustes compartidos se leen de Pokémon: margen y comisión del canal', () => {
  S.openVault(GAMES.mtg);
  near(S.maxPayUSD(13), 10); // 13 / 1,3 con canal sin comisión
  const v = S.dealVerdict(9, 13); // 30% bajo mercado pero sobre... no: 9 < 10 → ganga
  assert.equal(v.label, 'Ganga');
  assert.equal(S.dealVerdict(11.5, 13).label, 'Precio justo', 'sobre el máximo: a lo más Precio justo');
});

test('venta descuenta la comisión del canal elegido', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  const [it] = S.addItems({ print: print('d', 50), finish: 'normal', price: 30000, currency: 'CLP' });
  S.recordSale(it, { gross: 50000, currency: 'CLP', fx: 1000, channel: 'ml' });
  near(it.exit.clp, 43500);
  near(S.summary().realCLP, 13500);
  assert.equal(mem['vaultkeeper:v1'], POKEMON);
});

test('ranking: Vender nunca bajo el mínimo', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  S.addItems({ print: print('e', 9.5), finish: 'normal', price: 9000, currency: 'CLP' });
  S.addItems({ print: print('f', 30), finish: 'normal', price: 9000, currency: 'CLP' });
  const r = S.sellRanking();
  assert.ok(r.every((x) => x.askCLP >= x.floorCLP));
  assert.equal(r[0].it.printId, 'f', 'la de más ganancia primero');
});

test('respaldo: no se importa el de otro juego', () => {
  S.openVault(GAMES.mtg);
  assert.throws(() => S.importVault({ game: 'ygo', items: [] }));
  const before = S.state.items.length;
  S.importVault(JSON.parse(S.exportVault()));
  assert.equal(S.state.items.length, before);
});

test('vaults: activar, contar y último abierto', () => {
  S.openVault(GAMES.ygo);
  S.state.items = [];
  S.save({ silent: true });
  assert.deepEqual(V.enabledVaults().map((v) => v.id), ['pokemon', 'mtg'], 'Magic aparece porque tiene cartas');
  V.setEnabled(['ygo']);
  assert.deepEqual(V.enabledVaults().map((v) => v.id), ['pokemon', 'mtg', 'ygo']);
  assert.equal(V.countItems(V.vaultById('pokemon')), 1);
  V.setLastVault('ygo');
  assert.equal(V.lastVault(), 'ygo');
});

test('primer inicio: nada elegido por defecto; los usuarios anteriores conservan lo suyo', () => {
  const saved = { ...mem };
  for (const k of Object.keys(mem)) delete mem[k];
  assert.equal(V.choseVaults(), false, 'sin datos ni elección: se pregunta');
  assert.deepEqual(V.enabledVaults(), [], 'ningún juego por defecto');
  V.setEnabled(['ygo', 'mtg', 'ygo', 'inventado']);
  assert.deepEqual(V.enabledVaults().map((v) => v.id), ['mtg', 'ygo'], 'solo los elegidos, sin Pokémon');
  assert.equal(V.lastVault(), 'mtg');
  // someone who used the app before the question: Pokémon + the games they had turned on
  for (const k of Object.keys(mem)) delete mem[k];
  mem['vaultkeeper:vaults'] = JSON.stringify(['ygo']);
  assert.deepEqual(V.enabledVaults().map((v) => v.id), ['pokemon', 'ygo']);
  for (const k of Object.keys(mem)) delete mem[k];
  mem['vaultkeeper:v1'] = POKEMON;
  assert.equal(V.choseVaults(), true, 'con cartas de Pokémon no se vuelve a preguntar');
  assert.deepEqual(V.enabledVaults().map((v) => v.id), ['pokemon']);
  for (const k of Object.keys(mem)) delete mem[k];
  Object.assign(mem, saved);
});

test('Faltantes: cada juego trae sus dimensiones', () => {
  for (const g of [GAMES.mtg, GAMES.ygo]) {
    assert.ok(g.rarityKeys.length >= 4, `${g.id}: rarezas`);
    for (const f of ['sets', 'setCards', 'rarityCards']) assert.equal(typeof g[f], 'function', `${g.id}.${f}`);
    assert.ok(g.rarityScope);
  }
  assert.ok(GAMES.mtg.treatments.includes('Borderless'), 'Magic filtra por marco');
});

test('lectura de códigos impresos', () => {
  assert.equal(GAMES.mtg.parseCode('123/286 R\nMKM • EN'), 'MKM 123');
  assert.equal(GAMES.ygo.parseCode('LOB-EN005'), 'LOB-EN005');
  assert.equal(GAMES.ygo.parseCode('L0B -EN005'), 'L0B-EN005');
  assert.equal(GAMES.ygo.parseCode('nada'), null);
});

test('wishlist: el corazón guarda la carta, se sale al comprarla y avisa bajo la meta', () => {
  S.openVault(GAMES.ygo);
  S.state.items = [];
  S.state.wishlist = {};
  S.state.alertsSeen = {};
  const p = print('w1', 20); // US$20 → $20.000 con TC 1000
  assert.equal(S.toggleWish(p), true);
  assert.ok(S.inWish('w1'));
  assert.equal(S.computeAlerts().filter((a) => a.kind === 'wish').length, 0, 'sin meta no avisa');
  S.setWishTarget('w1', 25000);
  const a = S.computeAlerts().find((x) => x.kind === 'wish');
  assert.ok(a && /20\.000/.test(a.text), 'bajo la meta avisa');
  S.dismissAlert(a.key);
  assert.equal(S.computeAlerts().filter((x) => x.kind === 'wish').length, 0, 'descartada se oculta');
  assert.equal(S.wishPrint(S.state.wishlist.w1).finishes[0].usd, 20, 'la ficha trae el último precio');
  S.addItems({ print: p, finish: 'normal', price: 15000, currency: 'CLP' });
  assert.ok(!S.inWish('w1'), 'comprada sale de la wishlist');
  assert.equal(S.toggleWish(print('w2', 5)), true);
  assert.equal(S.toggleWish(print('w2', 5)), false, 'segundo toque la quita');
});

test('Novedades: precio que se mueve en 7 días y carta lista para vender', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  S.state.alertsSeen = {};
  const p = print('m1', 10);
  S.addItems({ print: p, finish: 'normal', price: 5000, currency: 'CLP', fx: 1000 });
  const d = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');
  S.state.priceHist['m1|normal'] = [[d(10), 10], [d(0), 13]];
  const kinds = S.computeAlerts().map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['sell', 'up'], 'subió 30% y rinde 100% sobre la compra');
  S.state.items[0].purpose = 'coleccion';
  assert.deepEqual(S.computeAlerts().map((a) => a.kind), ['up'], 'colección no se recomienda vender');
});

test('editar compra recalcula el costo; gradeada usa su valor en pesos', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  const [it] = S.addItems({ print: print('e1', 10), finish: 'normal', price: 5000, currency: 'CLP', fx: 1000 });
  S.editBuy(it, { price: 8, currency: 'USD', fx: 900, date: '2026-01-02', condition: 'LP', graded: { co: 'PSA', grade: '10', cert: '', clp: 60000 }, event: 'Feria', notes: 'x' });
  near(it.costCLP, 7200);
  near(it.costUSD, 8);
  assert.equal(it.condition, 'LP');
  near(S.itemValueUSD(it), 60, 1e-9); // 60.000 / 1000
});

test('eventos: misma feria escrita distinto, resultado, renombrar y quitar', () => {
  S.openVault(GAMES.ygo);
  S.state.items = [];
  S.state.lastEvent = null;
  const [a] = S.addItems({ print: print('v1', 10), finish: 'normal', price: 4000, currency: 'CLP', fx: 1000, event: 'Feria Persa' });
  S.addItems({ print: print('v2', 10), finish: 'normal', price: 3000, currency: 'CLP', fx: 1000, event: 'feria  persa' });
  assert.equal(S.state.items[1].buy.event, 'Feria Persa', 'se escribe igual que la primera');
  assert.equal(S.todayEvent(), 'Feria Persa', 'se propone de nuevo hoy');
  S.recordSale(a, { gross: 9000, currency: 'CLP', fx: 1000, channel: 'feria', event: 'Feria Persa' });
  const [e] = S.eventReport();
  assert.equal(e.buyN, 2);
  assert.equal(e.saleN, 1);
  near(e.net, 5000);
  assert.equal(S.renameEvent(e.key, 'Feria Persa Biobío'), 3);
  assert.equal(S.eventReport()[0].name, 'Feria Persa Biobío');
  S.removeEvent(S.eventReport()[0].key);
  assert.equal(S.eventReport().length, 0);
});

test('lista de venta: el precio cambiado queda en la carta, el de mercado no', () => {
  S.openVault(GAMES.mtg);
  S.state.items = [];
  const [it] = S.addItems({ print: print('s1', 10), finish: 'normal', price: 5000, currency: 'CLP', fx: 1000 });
  S.setAsk(it, S.suggestedAskCLP(it));
  assert.equal(it.askCLP, undefined);
  S.setAsk(it, 12000);
  assert.equal(it.askCLP, 12000);
});

const L = await import('../js/venta-link.js');
test('QR: fotos de Scryfall y YGOPRODeck como claves cortas', () => {
  const sf = 'https://cards.scryfall.io/normal/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg?1562404626';
  assert.equal(L.imageKey(sf), 's:6da045f8-6278-4c84-9d39-025adf0789c1');
  assert.equal(L.imageURL('s:6da045f8-6278-4c84-9d39-025adf0789c1'), 'https://cards.scryfall.io/small/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg');
  assert.equal(L.imageKey('https://images.ygoprodeck.com/images/cards/46986414.jpg'), 'y:46986414');
  assert.equal(L.imageURL('y:46986414', true), 'https://images.ygoprodeck.com/images/cards/46986414.jpg');
});

console.log(`${pass} pruebas de vaults OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
