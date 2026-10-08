// Tests for the price-history storage (scripts/historial.mjs). Run: node tests/historial.test.mjs

import assert from 'node:assert/strict';
import { addDay, compact } from '../scripts/historial.mjs';

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

test('agregar días alinea todas las series', () => {
  const sh = { v: 1, days: [], s: {} };
  addDay(sh, 100, { a: 500 });
  addDay(sh, 101, { a: 510, b: 2000 });
  assert.deepEqual(sh.days, [100, 101]);
  assert.deepEqual(sh.s.a, [500, 510]);
  assert.deepEqual(sh.s.b, [null, 2000], 'serie nueva parte con null');
  addDay(sh, 102, { b: 2100 });
  assert.deepEqual(sh.s.a, [500, 510, null], 'serie sin dato hoy recibe null');
});

test('el mismo día dos veces reemplaza, no duplica', () => {
  const sh = { v: 1, days: [], s: {} };
  addDay(sh, 200, { a: 100 });
  addDay(sh, 200, { a: 120 });
  assert.deepEqual(sh.days, [200]);
  assert.deepEqual(sh.s.a, [120]);
});

test('compactar: diario los últimos 120 días, semanal antes', () => {
  const sh = { v: 1, days: [], s: {} };
  const today = 20000;
  for (let d = today - 200; d <= today; d++) addDay(sh, d, { a: d });
  compact(sh, today);
  const recent = sh.days.filter((d) => d >= today - 120);
  assert.equal(recent.length, 121, 'todos los días recientes');
  const old = sh.days.filter((d) => d < today - 120);
  const weeks = new Set(old.map((d) => Math.floor((d + 3) / 7)));
  assert.equal(old.length, weeks.size, 'un punto por semana en lo antiguo');
  assert.equal(sh.s.a.length, sh.days.length, 'serie alineada con days');
  sh.days.forEach((d, i) => assert.equal(sh.s.a[i], d, 'cada valor sigue con su día'));
});

test('series sin ningún dato se eliminan', () => {
  const sh = { v: 1, days: [10, 11], s: { a: [null, null], b: [1, 2] } };
  compact(sh, 11);
  assert.equal(sh.s.a, undefined);
  assert.deepEqual(sh.s.b, [1, 2]);
});

console.log(`${pass} pruebas de historial OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
