// Daily TCGplayer price history (from TCGCSV) for every Pokémon card worth US$5 or more.
// Neither TCGplayer nor TCGdex publish history, so the daily workflow builds it: one point per
// day, kept daily for 120 days and weekly after that.
//
// Storage: data/hist/<productId % 256>.json — all series of a shard share one `days` axis:
//   { "v": 1, "days": [20369, 20370, …],            // days since 1970-01-01 (UTC)
//     "s": { "717605|holofoil": [8480, 8512, null, …] } }   // market price in US cents
//
//   node scripts/historial.mjs --dir data/hist [--min 5]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { variantKey } from './match.mjs';

const CSV = 'https://tcgcsv.com/tcgplayer/3';
const UA = 'VaultKeeper/1.0.0';
const SHARDS = 256;
const DAILY_DAYS = 120;
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const DIR = arg('--dir', 'data/hist');
const MIN = Number(arg('--min', 5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      await sleep(150); // TCGCSV usage guidelines
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

const dayOf = (iso) => Math.floor(Date.parse(iso) / 86400000);
const isoWeek = (day) => Math.floor((day + 3) / 7); // Monday-based week number

// Older than DAILY_DAYS → keep only the last available day of each week.
export function compact(shard, today) {
  const keep = shard.days.map((d, i) => d >= today - DAILY_DAYS || i === shard.days.length - 1 || isoWeek(shard.days[i + 1]) !== isoWeek(d));
  shard.days = shard.days.filter((_, i) => keep[i]);
  for (const k of Object.keys(shard.s)) {
    shard.s[k] = shard.s[k].filter((_, i) => keep[i]);
    if (shard.s[k].every((v) => v == null)) delete shard.s[k];
  }
  return shard;
}

export function addDay(shard, day, values) {
  let i = shard.days.indexOf(day);
  if (i < 0) {
    shard.days.push(day);
    for (const k of Object.keys(shard.s)) shard.s[k].push(null);
    i = shard.days.length - 1;
  }
  for (const [k, cents] of Object.entries(values)) {
    if (!shard.s[k]) shard.s[k] = new Array(shard.days.length).fill(null);
    shard.s[k][i] = cents;
  }
  return shard;
}

async function main() {
  const updated = (await fetch('https://tcgcsv.com/last-updated.txt', { headers: { 'User-Agent': UA } }).then((r) => r.text())).trim();
  const today = dayOf(updated.replace(/\+0000$/, 'Z'));
  if (!Number.isFinite(today)) throw new Error(`fecha de TCGCSV inválida: ${updated}`);
  await mkdir(DIR, { recursive: true });

  const shards = [];
  for (let n = 0; n < SHARDS; n++) {
    try {
      shards[n] = JSON.parse(await readFile(join(DIR, `${n}.json`), 'utf8'));
    } catch {
      shards[n] = { v: 1, days: [], s: {} };
    }
  }
  const tracked = new Set(shards.flatMap((sh) => Object.keys(sh.s)));

  const groups = (await get(`${CSV}/groups`)).results;
  const perShard = Array.from({ length: SHARDS }, () => ({}));
  let rows = 0, kept = 0;
  for (const g of groups) {
    const prices = (await get(`${CSV}/${g.groupId}/prices`)).results || [];
    for (const p of prices) {
      rows++;
      if (p.marketPrice == null) continue;
      const key = `${p.productId}|${variantKey(p.subTypeName)}`;
      // Once a card is tracked it stays tracked, even if it drops under the threshold.
      if (p.marketPrice < MIN && !tracked.has(key)) continue;
      perShard[p.productId % SHARDS][key] = Math.round(p.marketPrice * 100);
      kept++;
    }
  }
  if (kept < 1000) throw new Error(`solo ${kept} precios: algo falló, no sobrescribo el historial`);

  let series = 0, bytes = 0;
  for (let n = 0; n < SHARDS; n++) {
    const sh = compact(addDay(shards[n], today, perShard[n]), today);
    series += Object.keys(sh.s).length;
    const txt = JSON.stringify(sh);
    bytes += txt.length;
    await writeFile(join(DIR, `${n}.json`), txt);
  }
  await writeFile(join(DIR, 'meta.json'), JSON.stringify({ v: 1, updated, day: today, shards: SHARDS, min: MIN, series, dailyDays: DAILY_DAYS }, null, 1));
  console.log(`Historial ${updated}: ${kept} precios hoy (de ${rows}), ${series} series, ${(bytes / 1e6).toFixed(1)} MB en ${SHARDS} archivos.`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('historial.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
