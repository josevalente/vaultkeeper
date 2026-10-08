// Tests for the TCGdex ↔ TCGCSV matching used by scripts/precios-faltantes.mjs.
// Run with:  node tests/match.test.mjs   (no network; runs in the daily workflow before publishing)

import assert from 'node:assert/strict';
import { normCardName, normSetName, numberKey, variantKey, matchGroup, matchCards, nameOk } from '../scripts/match.mjs';

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

const product = (productId, name, number, rarity = 'Rare') => ({
  productId,
  name,
  extendedData: [
    ...(number ? [{ name: 'Number', value: number }] : []),
    { name: 'Rarity', value: rarity },
  ],
});
const price = (productId, subTypeName, marketPrice, lowPrice = marketPrice, midPrice = marketPrice) => ({ productId, subTypeName, marketPrice, lowPrice, midPrice, highPrice: null });

test('normalización de nombres', () => {
  assert.equal(normCardName('Mew ex - 152/128'), 'mew ex');
  assert.equal(normCardName('Metagross (Delta Species)'), 'metagross');
  assert.equal(normCardName('Meganium - 001 [Staff]'), 'meganium');
  assert.equal(normCardName('Drifloon - 005 (Cosmos Holo)'), 'drifloon');
  assert.equal(normCardName('Nidoran♀'), normCardName('Nidoran F'));
  assert.equal(normCardName('Pikachu & Zekrom GX'), 'pikachu and zekrom gx');
  assert.equal(normSetName('ME: 30th Celebration'), '30th celebration');
  assert.equal(normSetName('MEP Black Star Promos'), 'mep black star promo');
});

test('nombres equivalentes y no equivalentes', () => {
  assert.ok(nameOk('Palkia', 'Palkia LV.X'));
  assert.ok(nameOk('Gengar', 'Gengar (Prime)'));
  assert.ok(nameOk('Genesect EX', 'Genesect EX (Team Plasma)'));
  assert.ok(!nameOk('Pikachu at the Museum', 'Pikachu - 093'));
  assert.ok(!nameOk('Mew ex', 'Mewtwo ex'));
  assert.ok(!nameOk('Charizard', 'Charmander'));
});

test('números y versiones', () => {
  assert.equal(numberKey('152/128'), '152');
  assert.equal(numberKey('004'), '4');
  assert.equal(numberKey('TG05/TG30'), 'TG5');
  assert.equal(variantKey('Holofoil'), 'holofoil');
  assert.equal(variantKey('Reverse Holofoil'), 'reverse-holofoil');
  assert.equal(variantKey('1st Edition Holofoil'), '1st-edition-holofoil');
});

test('grupo TCGCSV correcto por fecha y nombre', () => {
  const groups = [
    { groupId: 1, name: 'ME: 30th Celebration', publishedOn: '2026-09-16T00:00:00' },
    { groupId: 2, name: 'ME: 30th Celebration Classic Collection', publishedOn: '2026-09-16T00:00:00' },
    { groupId: 3, name: 'ME: Mega Evolution Promo', publishedOn: '2025-09-26T00:00:00' },
    { groupId: 4, name: 'ME01: Mega Evolution', publishedOn: '2025-09-26T00:00:00' },
  ];
  assert.equal(matchGroup({ name: '30th Celebration', releaseDate: '2026-09-16' }, groups).groupId, 1);
  assert.equal(matchGroup({ name: '30th Classic Collection', releaseDate: '2026-09-16' }, groups).groupId, 2);
  assert.equal(matchGroup({ name: 'MEP Black Star Promos', releaseDate: '2025-09-26' }, groups).groupId, 3);
  assert.equal(matchGroup({ name: 'Pitch Black', releaseDate: '2026-07-17' }, groups), null, 'sin fecha cercana no cruza');
});

test('cruce de cartas: número + nombre, reimpresiones, mitades y ediciones', () => {
  const tcgdex = [
    { id: 's-152', localId: '152', name: 'Mew ex' },
    { id: 's-066', localId: '066', name: 'Mew ex' },
    { id: 'c-001', localId: '001', name: 'Charizard' },
    { id: 'c-004', localId: '004', name: 'Genesect EX' },
    { id: 'c-019', localId: '019', name: 'Darkrai & Cresselia LEGEND' },
    { id: 'c-020', localId: '020', name: 'Darkrai & Cresselia LEGEND' },
    { id: 'p-001', localId: '001', name: 'Meganium' },
    { id: 'p-m', localId: 'Museum', name: 'Pikachu at the Museum' },
  ];
  const products = [
    product(10, 'Mew ex - 152/128', '152/128', 'Special Illustration Rare'),
    product(11, 'Mew ex - 066/128', '066/128', 'Double Rare'),
    product(20, 'Charizard', '4/102', 'Classic Collection'), // original number, not 001
    product(21, 'Genesect EX (Team Plasma)', '11/101', 'Classic Collection'),
    product(22, 'Darkrai & Cresselia Legend (Bottom)', '100/102', 'Classic Collection'),
    product(23, 'Darkrai & Cresselia Legend (Top)', '99/102', 'Classic Collection'),
    product(30, 'Meganium - 001', '001', 'Promo'),
    product(31, 'Meganium - 001 [Staff]', '001', 'Promo'),
    product(40, 'Pikachu - 093', '093', 'Promo'),
    product(50, 'Elite Trainer Box', null), // sealed product: ignored
  ];
  const prices = [
    price(10, 'Holofoil', 84.8),
    price(11, 'Holofoil', 2.88),
    price(20, 'Holofoil', 139.24),
    price(21, 'Holofoil', 30),
    price(22, 'Holofoil', 10),
    price(23, 'Holofoil', 12),
    price(30, 'Holofoil', 28.29),
    price(31, 'Holofoil', 124.98),
    price(40, 'Holofoil', 5),
    price(50, 'Normal', 50),
  ];
  const m = matchCards(tcgdex, products, prices);
  assert.equal(m['s-152'].tp.holofoil.market, 84.8);
  assert.equal(m['s-152'].rarity, 'Special Illustration Rare');
  assert.equal(m['s-066'].tp.holofoil.market, 2.88);
  assert.equal(m['c-001'].tp.holofoil.market, 139.24, 'Charizard Classic por nombre, no por número');
  assert.equal(m['c-001'].printed, '4/102');
  assert.equal(m['c-004'].tp.holofoil.pid, 21);
  assert.equal(m['c-019'].tp.holofoil.pid, 23, 'LEGEND: 019 = Top');
  assert.equal(m['c-020'].tp.holofoil.pid, 22, 'LEGEND: 020 = Bottom');
  assert.equal(m['p-001'].tp.holofoil.pid, 30, 'la versión base, no la [Staff]');
  assert.equal(m['p-m'], undefined, 'Pikachu at the Museum no es Pikachu 093');
  assert.deepEqual(m['s-152'].variants, ['holofoil']);
});

console.log(`${pass} pruebas de cruce OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
