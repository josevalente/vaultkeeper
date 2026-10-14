// Card data + prices for the non-Pokémon vaults. Each game is an adapter with the same shape:
//   search(q)        → prints matching a name, a set code + number, or a printed code
//   refresh(ids)     → { [printId]: { finishKey: usd } } with today's prices
//   rarities         → labels shown in the app
//   claudeHint       → what to read on the card when Claude identifies a photo
//   ocr              → where the on-device OCR reads a code that identifies the print
// A "print" is one printing of a card: { id, cardKey, name, setName, setCode, number, rarity,
// image, imageLarge, finishes: [{ key, label, usd }] }. Prices are TCGplayer market (US$).

import { fetchJSON, norm, similarity } from '../util.js';

const SF = 'https://api.scryfall.com';
const YG = 'https://db.ygoprodeck.com/api/v7';

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

// ───────────────────────── Magic: The Gathering (Scryfall, prices from TCGplayer)

const MTG_RARITY = { common: 'Común', uncommon: 'Infrecuente', rare: 'Rara', mythic: 'Mítica', special: 'Especial', bonus: 'Bonus' };
const MTG_FINISH = { nonfoil: ['normal', 'Normal', 'usd'], foil: ['foil', 'Foil', 'usd_foil'], etched: ['etched', 'Etched foil', 'usd_etched'] };

function mtgPrint(c) {
  const face = c.image_uris || c.card_faces?.[0]?.image_uris || {};
  return {
    id: c.id,
    cardKey: c.oracle_id || c.name,
    name: c.name,
    setName: c.set_name,
    setCode: String(c.set || '').toUpperCase(),
    number: c.collector_number,
    rarity: MTG_RARITY[c.rarity] || c.rarity,
    lang: c.lang,
    released: c.released_at,
    image: face.small || face.normal || '',
    imageLarge: face.normal || face.large || face.small || '',
    finishes: (c.finishes || ['nonfoil']).map((f) => {
      const [key, label, field] = MTG_FINISH[f] || [f, f, null];
      return { key, label, usd: num(c.prices?.[field]) };
    }),
    link: c.purchase_uris?.tcgplayer || c.scryfall_uri,
  };
}

const mtg = {
  id: 'mtg',
  name: 'Magic: The Gathering',
  short: 'Magic',
  rarities: Object.values(MTG_RARITY),
  claudeHint: 'This is a Magic: The Gathering card. Read the card name (top left), and from the bottom-left corner the set code (3–5 letters, e.g. "MKM") and the collector number (e.g. "123" from "123/286").',
  placeholder: 'Nombre (Lightning Bolt) o set + número (MKM 123)',
  async search(q) {
    q = q.trim();
    if (q.length < 2) return [];
    // "MKM 123" or "mkm/123" → that exact printing
    const code = q.match(/^([a-z0-9]{2,6})[\s/#-]+(\d+[a-z★]?)$/i);
    if (code) {
      const c = await fetchJSON(`${SF}/cards/${code[1].toLowerCase()}/${encodeURIComponent(code[2].toLowerCase())}`, { retries: 1 }).catch(() => null);
      if (c?.object === 'card') return [mtgPrint(c)];
    }
    const r = await fetchJSON(`${SF}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`, { retries: 1, timeout: 15000 }).catch(() => null);
    let list = (r?.data || []).map(mtgPrint);
    if (!list.length) {
      // A misspelled name (OCR): Scryfall's fuzzy match finds the card, then all its printings.
      const f = await fetchJSON(`${SF}/cards/named?fuzzy=${encodeURIComponent(q)}`, { retries: 0 }).catch(() => null);
      if (f?.prints_search_uri) list = ((await fetchJSON(f.prints_search_uri, { retries: 1 }).catch(() => null))?.data || []).map(mtgPrint);
    }
    // The exact name first, then English printings (the market the prices come from), newest first.
    const exact = (p) => (norm(p.name) === norm(q) ? 0 : 1);
    const priced = (p) => (p.finishes.some((f) => f.usd != null) ? 0 : 1); // "The List" etc. have no price
    return list.sort((a, b) => exact(a) - exact(b) || (a.lang === 'en' ? 0 : 1) - (b.lang === 'en' ? 0 : 1) || priced(a) - priced(b)).slice(0, 120);
  },
  // Up to 75 cards per request.
  async refresh(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 75) {
      const res = await fetch(`${SF}/cards/collection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const c of (await res.json()).data || []) out[c.id] = mtgPrint(c);
    }
    return out;
  },
  // Bottom-left: "123/286 R" over "MKM • EN" (modern frames).
  ocr: { box: [0, 0.9, 0.5, 0.1], whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ •' },
  parseCode(text) {
    const t = text.toUpperCase();
    const n = t.match(/\b(\d{1,4})\s*\/\s*\d{1,4}\b/) || t.match(/\b(\d{1,4})\b/);
    const set = (t.match(/\b([A-Z0-9]{3,5})\b(?=\s*[•·.]?\s*(EN|ES|JP|DE|FR|IT|PT)?\b)/g) || []).find((s) => /[A-Z]/.test(s) && !/^(EN|ES)$/.test(s));
    return n && set ? `${set} ${Number(n[1])}` : null;
  },
};

// ───────────────────────── Yu-Gi-Oh! (YGOPRODeck: one price per printing = set code + rarity)

function ygoPrints(c) {
  const img = c.card_images?.[0] || {};
  const base = { cardKey: String(c.id), name: c.name, image: img.image_url_small || '', imageLarge: img.image_url || img.image_url_small || '' };
  const sets = c.card_sets || [];
  if (!sets.length) {
    return [{ ...base, id: `${c.id}|`, setName: 'Sin edición TCG', setCode: '', number: '', rarity: '', finishes: [{ key: 'normal', label: 'Normal', usd: num(c.card_prices?.[0]?.tcgplayer_price) }] }];
  }
  return sets.map((s) => ({
    ...base,
    id: `${c.id}|${s.set_code}|${s.set_rarity}`,
    setName: s.set_name,
    setCode: s.set_code,
    number: s.set_code,
    rarity: s.set_rarity,
    finishes: [{ key: 'normal', label: s.set_rarity_code ? s.set_rarity_code.replace(/[()]/g, '') : 'Normal', usd: num(s.set_price) || null }],
  }));
}

const ygo = {
  id: 'ygo',
  name: 'Yu-Gi-Oh!',
  short: 'Yu-Gi-Oh',
  rarities: ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare', 'Ultimate Rare', 'Ghost Rare', 'Starlight Rare', "Collector's Rare", 'Quarter Century Secret Rare', 'Prismatic Secret Rare'],
  claudeHint: 'This is a Yu-Gi-Oh! card. Read the card name (top), and the set code printed just below the artwork on the right (e.g. "LOB-EN001"); put that code in collector_number and its prefix ("LOB") in set_code.',
  placeholder: 'Nombre (Dark Magician) o código (LOB-EN001)',
  async search(q) {
    q = q.trim();
    if (q.length < 2) return [];
    let list = [];
    const code = q.toUpperCase().match(/^[A-Z0-9]{2,5}-[A-Z]{0,2}\d{2,3}$/);
    // OCR often reads O as 0 in the prefix ("L0B-EN005"): try that variant too.
    for (const c0 of code ? [...new Set([code[0], code[0].replace(/^([^-]*)/, (p) => p.replace(/0/g, 'O'))])] : []) {
      const s = await fetchJSON(`${YG}/cardsetsinfo.php?setcode=${encodeURIComponent(c0)}`, { retries: 0 }).catch(() => null);
      if (s?.id) {
        const c = await fetchJSON(`${YG}/cardinfo.php?id=${s.id}`, { retries: 1 }).catch(() => null);
        list = (c?.data || []).flatMap(ygoPrints).filter((p) => p.setCode.toUpperCase() === c0);
        if (list.length) break;
      }
    }
    if (!list.length) {
      const r = await fetchJSON(`${YG}/cardinfo.php?fname=${encodeURIComponent(q)}&num=40&offset=0`, { retries: 1, timeout: 15000 }).catch(() => null);
      const cards = (r?.data || []).sort((a, b) => similarity(norm(b.name), norm(q)) - similarity(norm(a.name), norm(q)));
      list = cards.flatMap(ygoPrints);
    }
    return list.slice(0, 150);
  },
  async refresh(ids) {
    const out = {};
    const cardIds = [...new Set(ids.map((id) => id.split('|')[0]))];
    for (let i = 0; i < cardIds.length; i += 40) {
      const r = await fetchJSON(`${YG}/cardinfo.php?id=${cardIds.slice(i, i + 40).join(',')}`, { retries: 1, timeout: 15000 });
      for (const c of r?.data || []) for (const p of ygoPrints(c)) out[p.id] = p;
    }
    return out;
  },
  // Set code under the artwork, right side ("LOB-EN001").
  ocr: { box: [0.5, 0.68, 0.48, 0.08], whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' },
  parseCode(text) {
    const m = text.toUpperCase().replace(/\s+/g, '').match(/([A-Z0-9]{2,5})-([A-Z]{0,2})(\d{2,3})/);
    return m ? `${m[1]}-${m[2]}${m[3]}` : null;
  },
};

export const GAMES = { mtg, ygo };
export const gameById = (id) => GAMES[id] || null;
