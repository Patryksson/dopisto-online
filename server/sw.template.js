// Service worker: základ aplikace se uloží do zařízení, takže opakované načtení je okamžité
// a menu se zobrazí i bez připojení (hra samotná ale potřebuje server).
const VERSION = '__VERSION__';
const CACHE = 'dopisto-' + VERSION;
const SHELL = __SHELL__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('dopisto-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || (url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.js')) return;

  // Stránka: nejdřív síť (aktuální verze), při výpadku uložená kopie.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; })
      .catch(() => caches.match('/')));
    return;
  }
  // Soubory: nejdřív uložená kopie, na pozadí obnovit.
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
