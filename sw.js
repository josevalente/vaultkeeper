// VaultKeeper service worker: works offline at the feria with the last saved data.
const VERSION = 'vk-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/api.js', 'js/fx.js', 'js/scan.js', 'js/chart.js', 'js/rarity.js', 'js/ui.js',
  'js/views/home.js', 'js/views/collection.js', 'js/views/checklist.js', 'js/views/trade.js', 'js/views/settings.js',
  'icons/favicon.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/card-back.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vk-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cacheFirst = async (req, name) => {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
};

const networkFirst = async (req, name, timeout = 8000) => {
  const cache = await caches.open(name);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
};

const staleWhileRevalidate = async (req, name) => {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || net;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) return e.respondWith(networkFirst(req, VERSION, 3500));
  if (url.hostname === 'assets.tcgdex.net' || url.hostname === 'images.pokemontcg.io') return e.respondWith(cacheFirst(req, 'vk-img'));
  if (/^(api\.tcgdex\.net|api\.pokemontcg\.io|mindicador\.cl|open\.er-api\.com)$/.test(url.hostname)) return e.respondWith(networkFirst(req, 'vk-data'));
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) return e.respondWith(cacheFirst(req, 'vk-lib'));
});
