// Sale list as a link: the cards (name, picture, price, condition) go compressed inside the URL
// itself (venta.html#v1.…), so a QR works without any server — whoever scans it sees the list.
// Shared by the app (to build the link) and venta.html (to read it).

const B64 = { '+': '-', '/': '_' };
const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/[+/]/g, (c) => B64[c]).replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// Pictures as short keys: TCGdex "https://assets.tcgdex.net/en/sv/sv03.5/199" → "t:sv/sv03.5/199",
// TCGplayer "tcgp:699872" → "p:699872".
export function imageKey(image) {
  const s = String(image || '');
  if (s.startsWith('tcgp:')) return 'p:' + s.slice(5);
  const m = s.match(/^https:\/\/assets\.tcgdex\.net\/en\/(.+)$/);
  if (m) return 't:' + m[1];
  return s.startsWith('https://') ? 'u:' + s : '';
}
export function imageURL(key, big = false) {
  if (!key) return 'icons/card-back.svg';
  if (key.startsWith('p:')) return `https://tcgplayer-cdn.tcgplayer.com/product/${key.slice(2)}_${big ? '400w' : '200w'}.jpg`;
  if (key.startsWith('t:')) return `https://assets.tcgdex.net/en/${key.slice(2)}/${big ? 'high' : 'low'}.webp`;
  if (key.startsWith('u:')) return key.slice(2);
  return 'icons/card-back.svg';
}

// data: { t: title, f: footer, d: date, c: [[name, set, imageKey, priceCLP, condition], …] }
export async function encodeSale(data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === 'function') {
    try {
      return 'v1.' + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch {}
  }
  return 'j1.' + toB64url(json); // older browsers: same data, not compressed
}

export async function decodeSale(s) {
  const [kind, body] = [s.slice(0, 3), s.slice(3)];
  const bytes = fromB64url(body);
  const raw = kind === 'v1.' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

export function saleURL(code) {
  const base = location.href.split('#')[0].replace(/[^/]*$/, '');
  return `${base}venta.html#${code}`;
}
