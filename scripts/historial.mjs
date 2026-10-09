// Daily TCGplayer price history storage (fed by scripts/tcgcsv-diario.mjs).
// Neither TCGplayer nor TCGdex publish history, so the daily workflow builds it: one point per
// day, kept daily for 120 days and weekly after that.
//
// Storage: data/hist/<productId % 256>.json — all series of a shard share one `days` axis:
//   { "v": 1, "days": [20369, 20370, …],            // days since 1970-01-01 (UTC)
//     "s": { "717605|holofoil": [8480, 8512, null, …] } }   // market price in US cents

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const SHARDS = 256;
const DAILY_DAYS = 120;
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

// rows: [{ pid, variant, market }] for today. Cards at or above `min` USD start being tracked;
// once tracked, a card stays tracked even if it drops under the threshold.
export async function updateHistory(dir, rows, today, { min = 5, updated } = {}) {
  await mkdir(dir, { recursive: true });
  const shards = [];
  for (let n = 0; n < SHARDS; n++) {
    try {
      shards[n] = JSON.parse(await readFile(join(dir, `${n}.json`), 'utf8'));
    } catch {
      shards[n] = { v: 1, days: [], s: {} };
    }
  }
  const tracked = new Set(shards.flatMap((sh) => Object.keys(sh.s)));
  const perShard = Array.from({ length: SHARDS }, () => ({}));
  let kept = 0;
  for (const r of rows) {
    if (r.market == null) continue;
    const key = `${r.pid}|${r.variant}`;
    if (r.market < min && !tracked.has(key)) continue;
    perShard[r.pid % SHARDS][key] = Math.round(r.market * 100);
    kept++;
  }
  if (kept < 1000) throw new Error(`solo ${kept} precios para el historial: algo falló, no lo sobrescribo`);
  let series = 0, bytes = 0;
  for (let n = 0; n < SHARDS; n++) {
    const sh = compact(addDay(shards[n], today, perShard[n]), today);
    series += Object.keys(sh.s).length;
    const txt = JSON.stringify(sh);
    bytes += txt.length;
    await writeFile(join(dir, `${n}.json`), txt);
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ v: 1, updated, day: today, shards: SHARDS, min, series, dailyDays: DAILY_DAYS }, null, 1));
  return { kept, series, bytes };
}
