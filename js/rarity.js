// Rarity catalogue matching the official English symbols (see the client's chart).
// `api` is the exact rarity string TCGdex uses; matching is case-insensitive.

const GOLD = '#e2b33c';
const INK = '#111';

function starPath(cx, cy, r, points = 5, inner = 0.45) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI / points) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}

const star = (cx, cy, r, fill, stroke) =>
  `<path d="${starPath(cx, cy, r)}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"` : ''}/>`;

const disk = (fill = '#fff') => `<circle cx="12" cy="12" r="11.5" fill="${fill}"/>`;

const GLYPHS = {
  common: disk() + `<circle cx="12" cy="12" r="4.2" fill="${INK}"/>`,
  uncommon: disk() + `<path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" fill="${INK}"/>`,
  rare: disk() + star(12, 12.6, 6.4, INK),
  double: disk() + star(8.6, 10.3, 4.6, INK) + star(15.4, 14.2, 4.6, INK),
  ultra: disk(INK) + star(8.6, 10.6, 4.6, '#fff') + star(15.4, 13.8, 4.6, '#fff'),
  illus: disk() + star(12, 12.6, 6.6, GOLD),
  sir: disk() + star(8.4, 9.6, 4.4, GOLD) + star(15.6, 14.6, 4.4, GOLD),
  hyper: disk() + star(12, 7.6, 3.6, GOLD) + star(7.6, 15.2, 3.6, GOLD) + star(16.4, 15.2, 3.6, GOLD),
  mega: disk() + `<path d="M12 4.5C12.8 9.6 14.4 11.2 19.5 12 14.4 12.8 12.8 14.4 12 19.5 11.2 14.4 9.6 12.8 4.5 12 9.6 11.2 11.2 9.6 12 4.5Z" fill="${GOLD}"/>`,
  ace: disk() + star(12, 12.6, 6.6, '#d61fd0'),
  shiny: disk() + star(12, 12.6, 6.2, 'none', GOLD),
  shinyultra: disk() + star(8.6, 10.2, 4.3, 'none', GOLD) + star(15.4, 14.4, 4.3, 'none', GOLD),
  promo: disk() + star(12, 12.8, 8.2, INK) + `<text x="12" y="14.3" font-size="4.2" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">PROMO</text>`,
  // No official symbol known for these three: own glyphs, clearly different from the rest.
  pika: disk() + `<path d="M13.6 4.5 7.8 13h3.6l-1.2 6.5 6-8.8h-3.7z" fill="#f2c200" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>`,
  futur: disk('#111') + `<path d="M12 4.2 18.8 8.1v7.8L12 19.8l-6.8-3.9V8.1Z" fill="none" stroke="#5eead4" stroke-width="1.4"/>` + star(12, 12.4, 4.2, '#a78bfa'),
  classic: disk('#1d1b16') + `<circle cx="12" cy="12" r="9.2" fill="none" stroke="${GOLD}" stroke-width="1"/><text x="12" y="15" font-size="7.6" font-weight="800" text-anchor="middle" fill="${GOLD}" font-family="Georgia,serif">CC</text>`,
  secret: `<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2"/><text x="12" y="15.2" font-size="8.5" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial,sans-serif">?</text>`,
  other: `<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
};

export const RARITIES = [
  { key: 'illus', label: 'Illustration Rare', jp: 'AR', api: 'Illustration rare', tier: 6 },
  { key: 'sir', label: 'Special Illustration Rare', jp: 'SAR', api: 'Special illustration rare', tier: 8 },
  { key: 'hyper', label: 'Hyper Rare', jp: 'UR', api: 'Hyper rare', tier: 7 },
  { key: 'mega', label: 'Mega Hyper Rare', jp: 'MUR', api: 'Mega Hyper Rare', tier: 9 },
  { key: 'ultra', label: 'Ultra Rare', jp: 'SR', api: 'Ultra Rare', tier: 5 },
  { key: 'double', label: 'Double Rare', jp: 'RR', api: 'Double rare', tier: 4 },
  { key: 'shinyultra', label: 'Shiny Ultra Rare', jp: 'SSR', api: 'Shiny Ultra Rare', tier: 6 },
  { key: 'shiny', label: 'Shiny Rare', jp: 'S', api: 'Shiny rare', tier: 5 },
  { key: 'ace', label: 'ACE SPEC Rare', jp: 'ACE', api: 'ACE SPEC Rare', tier: 4 },
  { key: 'secret', label: 'Secret Rare', jp: '—', api: 'Secret Rare', tier: 6 },
  { key: 'futur', label: 'Futuristic Rare', jp: '', api: 'Futuristic Rare', tier: 8 },
  { key: 'classic', label: 'Classic Collection', jp: '', api: 'Classic Collection', tier: 7 },
  { key: 'pika', label: 'Pikachu Rare', jp: '', api: 'Pikachu Rare', tier: 4 },
  { key: 'promo', label: 'Promo', jp: 'PROMO', api: 'Promo', tier: 3 },
  { key: 'rare', label: 'Rare', jp: 'R', api: 'Rare', tier: 3 },
  { key: 'uncommon', label: 'Uncommon', jp: 'U', api: 'Uncommon', tier: 2 },
  { key: 'common', label: 'Common', jp: 'C', api: 'Common', tier: 1 },
];

const BY_API = new Map(RARITIES.map((r) => [r.api.toLowerCase(), r]));
const BY_KEY = new Map(RARITIES.map((r) => [r.key, r]));

export function rarityInfo(apiName) {
  if (!apiName) return { key: 'other', label: 'Sin rareza', jp: '', api: '', tier: 0 };
  return BY_API.get(String(apiName).toLowerCase()) || { key: 'other', label: apiName, jp: '', api: apiName, tier: 2 };
}

export const rarityByKey = (k) => BY_KEY.get(k);

export function raritySymbol(apiNameOrKey, size = 20) {
  const r = BY_KEY.get(apiNameOrKey) || rarityInfo(apiNameOrKey);
  const g = GLYPHS[r.key] || GLYPHS.other;
  return `<svg class="rsym" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${g}</svg>`;
}

export const sameRarity = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
