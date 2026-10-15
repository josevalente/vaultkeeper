// VaultKeeper service worker: works offline at the feria with the last saved data.
const VERSION = 'vk-v29';
const SHELL = [
  './', 'index.html', 'otros.html', 'elegir.html', 'venta.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/api.js', 'js/fx.js', 'js/scan.js', 'js/chart.js', 'js/rarity.js', 'js/ui.js',
  'js/views/home.js', 'js/views/collection.js', 'js/views/checklist.js', 'js/views/trade.js', 'js/views/settings.js', 'js/views/lote.js', 'js/views/reporte.js', 'js/views/mas.js', 'js/views/eventos.js', 'js/views/inventario.js', 'js/backup.js', 'js/salelist.js', 'js/sale-share.js', 'js/vaults.js', 'js/elegir.js', 'js/venta.js', 'js/venta-link.js',
  'js/tcg/app.js', 'js/tcg/games.js', 'js/tcg/store.js', 'js/tcg/ui.js', 'js/tcg/scan.js', 'js/tcg/faltantes.js', 'js/tcg/salelist.js',
  'icons/favicon.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/card-back.svg',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

// The whole shell of a version is downloaded together (bypassing the HTTP cache, so GitHub Pages'
// 10-minute cache can't slip an old file into a new version) and served together: a slow network
// can never mix new and old modules (a blank screen). The page offers to reload when it's ready.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll([...SHELL_URLS].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vk-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Marks a response served from the saved copy because the network failed, so the app doesn't
// stamp old prices as "just updated".
const fromCache = (res) => {
  const headers = new Headers(res.headers);
  headers.set('x-vk-from-cache', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

// Each page answers with itself (otros.html?juego=mtg → otros.html, elegir.html → elegir.html);
// index.html only for a page that isn't cached (offline, unknown path).
const shellFirst = async (req) => {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    try {
      return await fetch(req);
    } catch {
      return (await cache.match(new URL('index.html', self.registration.scope).href)) || Response.error();
    }
  }
  return fetch(req);
};

const cacheFirst = async (req, name) => {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
};

// Card images: cached copy first (fast, works offline), refreshed in the background once it's a
// week old. <img> responses from other sites are "opaque" (status unknown), so a broken download
// (403, a captive portal at the feria) is replaced on the next refresh instead of staying forever.
// A full storage never breaks an image that did download; the cache keeps the newest ~1500.
const IMG_TTL = 7 * 86400000;
const IMG_MAX = 3000; // entries (each image has a timestamp entry too)
const stampKey = (req) => new Request(req.url + (req.url.includes('?') ? '&' : '?') + '__vk_ts');
const trimImages = async (cache) => {
  const keys = await cache.keys();
  if (keys.length > IMG_MAX) await Promise.all(keys.slice(0, keys.length - IMG_MAX).map((k) => cache.delete(k)));
};
const imageCache = async (req) => {
  const cache = await caches.open('vk-img');
  const hit = await cache.match(req);
  const refresh = () =>
    fetch(req)
      .then(async (res) => {
        if (res.ok || res.type === 'opaque') {
          try {
            await cache.put(req, res.clone());
            await cache.put(stampKey(req), new Response(String(Date.now())));
            if (Math.random() < 0.05) trimImages(cache);
          } catch {
            trimImages(cache); // storage full: make room for next time, still show this one
          }
        }
        return res;
      })
      .catch(() => hit || Response.error());
  if (!hit) return refresh();
  const stamp = await cache.match(stampKey(req));
  const at = stamp ? Number(await stamp.text()) : 0;
  if ((hit.type !== 'opaque' && !hit.ok) || Date.now() - at > IMG_TTL) refresh();
  return hit;
};

// Network first with a time limit; the saved copy if the network is slow or down. A response that
// arrives after the time limit is still saved, so a big file (the Japanese catalog on 3G) gets
// cached for next time instead of being thrown away.
const networkFirst = async (req, name, timeout = 8000) => {
  const cache = await caches.open(name);
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  net.catch(() => {}); // a late failure after we answered from the cache is fine
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return fromCache(hit);
    return net; // nothing saved yet: wait for the network after all
  }
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate' || SHELL_URLS.has(url.origin + url.pathname)) return e.respondWith(shellFirst(req));
    return e.respondWith(networkFirst(req, VERSION, 3500));
  }
  if (/^(assets\.tcgdex\.net|images\.pokemontcg\.io|tcgplayer-cdn\.tcgplayer\.com|cards\.scryfall\.io|images\.ygoprodeck\.com)$/.test(url.hostname)) return e.respondWith(imageCache(req));
  if (url.hostname === 'raw.githubusercontent.com') return e.respondWith(networkFirst(req, 'vk-data', 20000)); // daily data files, up to ~1 MB
  if (/^(api\.tcgdex\.net|api\.pokemontcg\.io|mindicador\.cl|open\.er-api\.com|api\.scryfall\.com|db\.ygoprodeck\.com)$/.test(url.hostname)) return e.respondWith(networkFirst(req, 'vk-data'));
  // Libraries, fonts and the OCR engine + language data (versioned URLs: they never change).
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|tessdata\.projectnaptha\.com)$/.test(url.hostname)) return e.respondWith(cacheFirst(req, 'vk-lib'));
});
