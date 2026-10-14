// Fills TCGplayer prices that TCGdex doesn't have yet (usually brand-new sets), using TCGCSV,
// a public daily mirror of TCGplayer's catalog. Writes data/precios-extra.json, which the app
// reads as its third price source. Runs daily from .github/workflows/precios.yml.
//
// With --imgs it also writes data/imagenes.json: the TCGplayer product of every TCGdex card that
// has no picture (whole promo sets like "MEP Black Star Promos", McDonald's promos…), so the app
// can show TCGplayer's image instead of a blank card.
//
//   node scripts/precios-faltantes.mjs [--out data/precios-extra.json] [--sets 15] [--imgs data/imagenes.json]

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { matchGroup, matchCards, normSetName } from './match.mjs';

const TD = 'https://api.tcgdex.net/v2/en';
const CSV = 'https://tcgcsv.com/tcgplayer/3'; // 3 = Pokémon
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const OUT = arg('--out', 'data/precios-extra.json');
const IMGS = arg('--imgs', null);
const RECENT = Number(arg('--sets', 15));
// TCGCSV usage guidelines: identify the app, pause between requests, pull at most once a day.
const UA = 'VaultKeeper/1.0.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      if (url.startsWith(CSV)) await sleep(150);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1500 * i));
    }
  }
}

const hasTcgplayer = (card) => Object.entries(card?.pricing?.tcgplayer || {}).some(([k, v]) => v && typeof v === 'object' && (v.marketPrice ?? v.midPrice ?? v.lowPrice) != null);

async function main() {
  const [all, pocket] = await Promise.all([get(`${TD}/sets`), get(`${TD}/series/tcgp`)]);
  const groupsRes = await get(`${CSV}/groups`);
  const csvUpdated = await fetch('https://tcgcsv.com/last-updated.txt', { headers: { 'User-Agent': UA } }).then((r) => r.text()).catch(() => null);
  const pocketIds = new Set((pocket?.sets || []).map((s) => s.id));
  const sets = all.filter((s) => !pocketIds.has(s.id)).slice(-RECENT);
  const groups = groupsRes.results || groupsRes;

  const out = { updated: new Date().toISOString(), tcgcsvUpdated: csvUpdated?.trim() || null, source: 'tcgcsv.com (precios TCGplayer)', sets: {}, cards: {} };
  for (const s of sets) {
    const set = await get(`${TD}/sets/${encodeURIComponent(s.id)}`);
    const cards = set?.cards || [];
    if (!cards.length) continue;
    // Sample a few cards: if none has TCGplayer prices, TCGdex hasn't priced this set yet.
    const idx = [...new Set([0, Math.floor(cards.length / 3), Math.floor((2 * cards.length) / 3), cards.length - 1])];
    const sample = await Promise.all(idx.map((i) => get(`${TD}/cards/${encodeURIComponent(cards[i].id)}`).catch(() => null)));
    if (sample.some(hasTcgplayer)) continue;

    const g = matchGroup(set, groups);
    if (!g) {
      console.log(`· ${set.id} "${set.name}": sin precio en TCGdex y sin grupo TCGCSV equivalente`);
      continue;
    }
    const products = await get(`${CSV}/${g.groupId}/products`);
    const prices = await get(`${CSV}/${g.groupId}/prices`);
    const matched = matchCards(cards, products.results || [], prices.results || []);
    const n = Object.keys(matched).length;
    if (!n) {
      console.log(`· ${set.id} "${set.name}": el grupo "${g.name}" no tiene cartas equivalentes, lo ignoro`);
      continue;
    }
    for (const [id, m] of Object.entries(matched)) {
      const c = cards.find((x) => x.id === id);
      out.cards[id] = { ...m, setId: set.id, number: c.localId, image: c.image || null };
    }
    out.sets[set.id] = { name: set.name, releaseDate: set.releaseDate, tcgcsvGroup: g.groupId, tcgcsvName: g.name, cards: cards.length, matched: n };
    console.log(`✓ ${set.id} "${set.name}" ↔ ${g.groupId} "${g.name}" (${normSetName(g.name)}): ${n}/${cards.length} cartas con precio`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Escribí ${OUT}: ${Object.keys(out.cards).length} cartas de ${Object.keys(out.sets).length} expansiones.`);

  // Images are a bonus: a failure here never blocks the prices.
  if (IMGS) await images(all.filter((s) => !pocketIds.has(s.id)), groups, out).catch((e) => console.warn(`! imágenes: ${e.message}`));
}

async function images(sets, groups, extra) {
  const prev = JSON.parse(await readFile(IMGS, 'utf8').catch(() => 'null'));
  const res = { updated: new Date().toISOString(), cards: {} };
  // Already matched for prices: their TCGplayer product is known.
  for (const [id, e] of Object.entries(extra.cards)) {
    if (e.image) continue;
    const pid = Object.values(e.tp || {}).find((v) => v.pid)?.pid;
    if (pid) res.cards[id] = pid;
  }
  let missing = 0, failed = 0;
  for (const s of sets) {
    const set = await get(`${TD}/sets/${encodeURIComponent(s.id)}`).catch(() => null);
    const cards = (set?.cards || []).filter((c) => !c.image && !res.cards[c.id]);
    if (!cards.length) continue;
    missing += cards.length;
    const g = matchGroup(set, groups);
    if (!g) continue;
    try {
      const products = await get(`${CSV}/${g.groupId}/products`);
      const prices = await get(`${CSV}/${g.groupId}/prices`);
      const matched = matchCards(cards, products?.results || [], prices?.results || []);
      for (const [id, m] of Object.entries(matched)) {
        const pid = Object.values(m.tp).find((v) => v.pid)?.pid;
        if (pid) res.cards[id] = pid;
      }
    } catch (e) {
      failed++;
      console.warn(`! imágenes ${set.id}: ${e.message}`);
    }
  }
  // Keep what a failed group had yesterday, and never replace the file with a much smaller one.
  for (const [id, pid] of Object.entries(prev?.cards || {})) res.cards[id] ??= pid;
  const n = Object.keys(res.cards).length, before = Object.keys(prev?.cards || {}).length;
  if (n < before * 0.8) return console.warn(`! imágenes: ${n} vs ${before} antes, mantengo el archivo anterior`);
  await mkdir(dirname(IMGS), { recursive: true });
  await writeFile(IMGS, JSON.stringify(res) + '\n');
  console.log(`Escribí ${IMGS}: ${n} cartas sin imagen en TCGdex con imagen de TCGplayer (de ${missing} sin imagen; ${failed} grupos fallaron).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
