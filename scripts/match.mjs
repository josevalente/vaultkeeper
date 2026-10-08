// Matching helpers between TCGdex (cards/sets) and TCGCSV (TCGplayer products/prices).
// Shared by scripts/precios-faltantes.mjs and tests/match.test.mjs.

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/♀/g, ' f')
    .replace(/♂/g, ' m')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "ME: 30th Celebration" → "30th celebration"; "SV10: Destined Rivals" → "destined rivals"
export const normSetName = (s) => norm(String(s || '').replace(/^[A-Za-z0-9.]+:\s*/, '').replace(/\bpokemon\b/gi, '')).replace(/\bpromos\b/g, 'promo');

// "Mew ex - 152/128" → "mew ex"; "Metagross (Delta Species)" → "metagross"
export const normCardName = (s) => norm(String(s || '').replace(/\s+-\s+[A-Z]*\d+[A-Za-z]?(\/[A-Z]*\d+)?.*$/, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ''));

const tokens = (s) => new Set(s.split(' ').filter(Boolean));
export function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  A.forEach((t) => B.has(t) && i++);
  return i / (A.size + B.size - i);
}

// "152/128" → "152", "TG05/TG30" → "TG5", "004" → "4"
export function numberKey(n) {
  const head = String(n || '').split('/')[0].trim().toUpperCase();
  const m = head.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : head;
}

// TCGplayer sub-type → the variant keys the app uses (same as TCGdex pricing keys)
export const variantKey = (subTypeName) => norm(subTypeName).replace(/ /g, '-') || 'normal';

export function daysApart(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

// Best TCGCSV group for a TCGdex set: release dates within 10 days, then name similarity.
export function matchGroup(set, groups) {
  let best = null;
  for (const g of groups) {
    if (set.releaseDate && g.publishedOn && daysApart(set.releaseDate, g.publishedOn.slice(0, 10)) > 10) continue;
    const a = normSetName(set.name), b = normSetName(g.name);
    // Promo sets are named differently on each side ("MEP Black Star Promos" / "ME: Mega Evolution
    // Promo"); same release date + both promo is a strong enough signal.
    const sim = jaccard(a, b) + (/\bpromo\b/.test(a) && /\bpromo\b/.test(b) ? 0.5 : 0);
    if (!best || sim > best.sim) best = { g, sim };
  }
  return best && best.sim >= 0.5 ? best.g : null;
}

// Words one side may add to the same card name ("Palkia" ↔ "Palkia LV.X", "Gengar" ↔ "Gengar Prime").
const SUFFIX = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'break', 'prime', 'legend', 'lv', 'x', 'g', 'star', 'delta', 'species', 'team', 'plasma']);
export const nameOk = (a, b) => {
  const x = normCardName(a), y = normCardName(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short && long.startsWith(short + ' ')) return long.slice(short.length).trim().split(' ').every((w) => SUFFIX.has(w));
  return false;
};

// tcgdexCards: [{id, localId, name, image}] ; products: TCGCSV products ; prices: TCGCSV price rows.
// A number match only counts when the names also agree (Classic Collection reprints keep the
// original printed number, e.g. Charizard 4/102 is card 001 in TCGdex). Otherwise match by name
// when it is unique inside the set.
export function matchCards(tcgdexCards, products, prices) {
  const priceBy = new Map();
  for (const r of prices) {
    if (r.marketPrice == null && r.midPrice == null && r.lowPrice == null) continue;
    const list = priceBy.get(r.productId) || [];
    list.push(r);
    priceBy.set(r.productId, list);
  }
  const singles = products
    .map((p) => {
      const ext = Object.fromEntries((p.extendedData || []).map((e) => [e.name, e.value]));
      return { p, number: ext.Number || '', rarity: ext.Rarity || null };
    })
    .filter((x) => x.number && priceBy.has(x.p.productId));
  const byNum = new Map();
  const byName = new Map();
  for (const x of singles) {
    const k = numberKey(x.number);
    byNum.set(k, [...(byNum.get(k) || []), x]);
    const nk = normCardName(x.p.name);
    byName.set(nk, [...(byName.get(nk) || []), x]);
  }
  const out = {};
  const used = new Set();
  const take = (c, x, how) => {
    used.add(x.p.productId);
    const tp = {};
    for (const r of priceBy.get(x.p.productId)) {
      tp[variantKey(r.subTypeName)] = { low: r.lowPrice ?? null, mid: r.midPrice ?? null, high: r.highPrice ?? null, market: r.marketPrice ?? null, pid: x.p.productId };
    }
    out[c.id] = { name: c.name, tcgplayerName: x.p.name, tp, variants: Object.keys(tp), rarity: x.rarity, printed: x.number, how };
  };
  // Several products for one card (e.g. "Meganium - 001" and "Meganium - 001 [Staff]", or a
  // "(Cosmos Holo)" edition): the base product is the one without a bracketed edition.
  const one = (list) => {
    if (list.length === 1) return list[0];
    const base = list.filter((x) => !/[([]/.test(x.p.name));
    return base.length === 1 ? base[0] : null;
  };
  // pass 1: number + name
  for (const c of tcgdexCards) {
    const hit = one((byNum.get(numberKey(c.localId)) || []).filter((x) => !used.has(x.p.productId) && nameOk(c.name, x.p.name)));
    if (hit) take(c, hit, 'numero');
  }
  // pass 2: unique name
  for (const c of tcgdexCards) {
    if (out[c.id]) continue;
    const exact = (byName.get(normCardName(c.name)) || []).filter((x) => !used.has(x.p.productId));
    const loose = exact.length ? exact : singles.filter((x) => !used.has(x.p.productId) && nameOk(c.name, x.p.name));
    const hit = one(loose);
    if (hit) take(c, hit, 'nombre');
  }
  // pass 3: split cards sharing a name (LEGEND halves): TCGdex order ↔ "(Top)" before "(Bottom)"
  const byNameLeft = new Map();
  for (const c of tcgdexCards.filter((c) => !out[c.id])) {
    const nk = normCardName(c.name);
    byNameLeft.set(nk, [...(byNameLeft.get(nk) || []), c]);
  }
  const isTop = (x) => (/\(top\)/i.test(x.p.name) ? 0 : 1);
  for (const [nk, cs] of byNameLeft) {
    const ps = (byName.get(nk) || []).filter((x) => !used.has(x.p.productId));
    if (cs.length < 2 || ps.length !== cs.length || !ps.every((x) => /\((top|bottom)\)/i.test(x.p.name))) continue;
    ps.sort((a, b) => isTop(a) - isTop(b));
    cs.sort((a, b) => String(a.localId).localeCompare(String(b.localId), undefined, { numeric: true }));
    cs.forEach((c, i) => take(c, ps[i], 'mitad'));
  }
  return out;
}
