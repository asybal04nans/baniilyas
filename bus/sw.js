/* Service worker Bus Santri: halaman bisa dibuka saat sinyal lemah. Data (Apps Script) tidak pernah disimpan. */
const VERSI = 'bus-santri-v1';
const INTI = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSI).then(c => c.addAll(INTI)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Apps Script langsung ke jaringan
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(VERSI).then(ch => ch.put('index.html', c)); return res; })
      .catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(ada => {
    const baru = fetch(req).then(res => { if (res && res.ok) { const c = res.clone(); caches.open(VERSI).then(ch => ch.put(req, c)); } return res; }).catch(() => ada);
    return ada || baru;
  }));
});
