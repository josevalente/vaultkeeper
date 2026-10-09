// One daily pass over TCGCSV (TCGplayer's catalog, English + Japanese Pokémon) that produces:
//  · data/hist/*.json            price history of every card/product worth US$5+ (see historial.mjs)
//  · data/catalogo/jp.json       Japanese singles worth US$2+ (name, number, set, rarity, prices)
//  · data/catalogo/sellados.json sealed products (boxes, ETBs, packs…) worth US$3+, EN and JP
//
//   node scripts/tcgcsv-diario.mjs --data data
//
// Robust by design: a set that fails to download is skipped (its previous catalog entries are
// kept), the history is written even if a catalog looks incomplete, and an incomplete catalog
// never replaces the previous one. Products already in a catalog stay there even if their price
// drops under the threshold, so cards in someone's vault keep getting prices.
//
// TCGCSV usage guidelines: identify the app, ~150 ms between requests, once a day, < 10,000 requests.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { variantKey } from './match.mjs';
import { updateHistory } from './historial.mjs';

const CSV = 'https://tcgcsv.com/tcgplayer';
const UA = 'VaultKeeper/1.0.0';
const CATEGORIES = { 3: 'en', 85: 'jp' };
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const DATA = arg('--data', 'data');
const MIN_HIST = 5, MIN_JP = 2, MIN_SEALED = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      await sleep(150);
      requests++;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

async function readJSON(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// Not collectible products we don't want in the sealed catalog.
const NOT_SEALED = /code card|online code|digital|deck box|playmat|sleeves?\b|binder|portfolio|coin\b|pin\b|figure|plush/i;

async function main() {
  const updated = (await fetch('https://tcgcsv.com/last-updated.txt', { headers: { 'User-Agent': UA } }).then((r) => r.text())).trim();
  const today = Math.floor(Date.parse(updated.replace(/\+0000$/, 'Z')) / 86400000);
  if (!Number.isFinite(today)) throw new Error(`fecha de TCGCSV inválida: ${updated}`);

  const prevJp = await readJSON(join(DATA, 'catalogo', 'jp.json'));
  const prevSealed = await readJSON(join(DATA, 'catalogo', 'sellados.json'));
  const keepJp = new Set((prevJp?.items || []).map((e) => e.p));
  const keepSealed = new Set((prevSealed?.items || []).map((e) => e.p));

  const hist = [];
  const jp = { updated, groups: {}, items: [] };
  const sealed = { updated, groups: {}, items: [] };
  const failedGroups = new Set();
  let groupsTotal = 0;
  for (const [cat, lang] of Object.entries(CATEGORIES)) {
    const groups = (await get(`${CSV}/${cat}/groups`)).results;
    for (const g of groups) {
      groupsTotal++;
      let products, prices;
      try {
        products = (await get(`${CSV}/${cat}/${g.groupId}/products`)).results || [];
        prices = (await get(`${CSV}/${cat}/${g.groupId}/prices`)).results || [];
      } catch (e) {
        console.warn(`! salto ${g.name}: ${e.message}`);
        failedGroups.add(g.groupId);
        continue;
      }
      const byPid = new Map();
      for (const r of prices) {
        const v = variantKey(r.subTypeName);
        hist.push({ pid: r.productId, variant: v, market: r.marketPrice });
        if (r.marketPrice == null && r.lowPrice == null) continue;
        const t = byPid.get(r.productId) || {};
        t[v] = [r.marketPrice, r.lowPrice]; // [market, lowest listing]
        byPid.set(r.productId, t);
      }
      for (const p of products) {
        const t = byPid.get(p.productId);
        if (!t) continue;
        const ext = Object.fromEntries((p.extendedData || []).map((e) => [e.name, e.value]));
        const top = Math.max(...Object.values(t).map((x) => x[0] ?? x[1] ?? 0));
        const item = { p: p.productId, n: p.name, g: g.groupId, t };
        if (ext.Number) {
          if (lang !== 'jp' || (top < MIN_JP && !keepJp.has(p.productId))) continue;
          item.no = ext.Number;
          if (ext.Rarity) item.r = ext.Rarity;
          jp.items.push(item);
          jp.groups[g.groupId] = { n: g.name, d: g.publishedOn?.slice(0, 10) };
        } else if ((top >= MIN_SEALED || keepSealed.has(p.productId)) && !NOT_SEALED.test(p.name)) {
          item.l = lang;
          sealed.items.push(item);
          sealed.groups[g.groupId] = { n: g.name, d: g.publishedOn?.slice(0, 10), l: lang };
        }
      }
    }
  }
  if (failedGroups.size > groupsTotal * 0.2) throw new Error(`fallaron ${failedGroups.size} de ${groupsTotal} expansiones: no publico nada hoy`);

  // 1) History first: it doesn't depend on the catalogs.
  const h = await updateHistory(join(DATA, 'hist'), hist, today, { min: MIN_HIST, updated });

  // 2) Catalogs: carry over what couldn't be downloaded today; never replace with something smaller.
  await mkdir(join(DATA, 'catalogo'), { recursive: true });
  const carry = (fresh, prev) => {
    if (!prev) return;
    const have = new Set(fresh.items.map((e) => e.p));
    for (const e of prev.items) {
      if (failedGroups.has(e.g) && !have.has(e.p)) {
        fresh.items.push(e);
        fresh.groups[e.g] ||= prev.groups[e.g];
      }
    }
  };
  carry(jp, prevJp);
  carry(sealed, prevSealed);
  for (const [name, cat, prev, min] of [['jp', jp, prevJp, 500], ['sellados', sealed, prevSealed, 200]]) {
    if (cat.items.length < min || (prev && cat.items.length < prev.items.length * 0.8)) {
      console.warn(`! catálogo ${name} incompleto (${cat.items.length} vs ${prev?.items.length ?? 0} antes): mantengo el anterior`);
      continue;
    }
    await writeFile(join(DATA, 'catalogo', `${name}.json`), JSON.stringify(cat));
    console.log(`  ${name}: ${cat.items.length} productos`);
  }
  console.log(`TCGCSV ${updated} · ${requests} pedidos · ${failedGroups.size} expansiones saltadas`);
  console.log(`  historial: ${h.kept} precios hoy, ${h.series} series, ${(h.bytes / 1e6).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
