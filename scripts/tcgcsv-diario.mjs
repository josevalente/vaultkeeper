// One daily pass over TCGCSV (TCGplayer's catalog, English + Japanese Pokémon) that produces:
//  · data/hist/*.json           price history of every card/product worth US$5+ (see historial.mjs)
//  · data/catalogo/jp.json      Japanese singles worth US$2+ (name, number, set, rarity, prices)
//  · data/catalogo/sellados.json sealed products (boxes, ETBs, packs…) worth US$3+, EN and JP
//
//   node scripts/tcgcsv-diario.mjs --data data
//
// TCGCSV usage guidelines: identify the app, ~150 ms between requests, once a day, < 10,000 requests.

import { writeFile, mkdir } from 'node:fs/promises';
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

// Not collectible products we don't want in the sealed catalog.
const NOT_SEALED = /code card|online code|digital|deck box|playmat|sleeves?\b|binder|portfolio|coin\b|pin\b|figure|plush/i;

async function main() {
  const updated = (await fetch('https://tcgcsv.com/last-updated.txt', { headers: { 'User-Agent': UA } }).then((r) => r.text())).trim();
  const today = Math.floor(Date.parse(updated.replace(/\+0000$/, 'Z')) / 86400000);
  if (!Number.isFinite(today)) throw new Error(`fecha de TCGCSV inválida: ${updated}`);

  const hist = [];
  const jp = { updated, groups: {}, items: [] };
  const sealed = { updated, groups: {}, items: [] };
  for (const [cat, lang] of Object.entries(CATEGORIES)) {
    const groups = (await get(`${CSV}/${cat}/groups`)).results;
    for (const g of groups) {
      const [products, prices] = [(await get(`${CSV}/${cat}/${g.groupId}/products`)).results || [], (await get(`${CSV}/${cat}/${g.groupId}/prices`)).results || []];
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
          if (lang !== 'jp' || top < MIN_JP) continue;
          item.no = ext.Number;
          if (ext.Rarity) item.r = ext.Rarity;
          jp.items.push(item);
          jp.groups[g.groupId] = { n: g.name, d: g.publishedOn?.slice(0, 10) };
        } else if (top >= MIN_SEALED && !NOT_SEALED.test(p.name)) {
          item.l = lang;
          sealed.items.push(item);
          sealed.groups[g.groupId] = { n: g.name, d: g.publishedOn?.slice(0, 10), l: lang };
        }
      }
    }
  }
  if (jp.items.length < 500 || sealed.items.length < 200) throw new Error(`catálogo incompleto (jp ${jp.items.length}, sellados ${sealed.items.length}), no publico`);

  await mkdir(join(DATA, 'catalogo'), { recursive: true });
  const jpTxt = JSON.stringify(jp), sTxt = JSON.stringify(sealed);
  await writeFile(join(DATA, 'catalogo', 'jp.json'), jpTxt);
  await writeFile(join(DATA, 'catalogo', 'sellados.json'), sTxt);
  const h = await updateHistory(join(DATA, 'hist'), hist, today, { min: MIN_HIST, updated });
  console.log(`TCGCSV ${updated} · ${requests} pedidos`);
  console.log(`  japonesas: ${jp.items.length} cartas (${(jpTxt.length / 1e6).toFixed(2)} MB)`);
  console.log(`  sellados:  ${sealed.items.length} productos (${(sTxt.length / 1e6).toFixed(2)} MB)`);
  console.log(`  historial: ${h.kept} precios hoy, ${h.series} series, ${(h.bytes / 1e6).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
