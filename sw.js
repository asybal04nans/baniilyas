/* Service worker Bani Ilyas: halaman tetap bisa dibuka saat sinyal lemah. Data (Apps Script) tidak pernah disimpan. */
const VERSI = 'bani-ilyas-v1';
const INTI = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(INTI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API Google dan sumber luar langsung ke jaringan
  if (req.mode === 'navigate') {
    // halaman: utamakan jaringan (agar pembaruan langsung tampil), cadangan dari simpanan
    e.respondWith(
      fetch(req).then((res) => {
        const salinan = res.clone();
        caches.open(VERSI).then((c) => c.put('index.html', salinan));
        return res;
      }).catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }
  // berkas lain: dari simpanan dulu, perbarui di belakang layar
  e.respondWith(
    caches.match(req).then((ada) => {
      const baru = fetch(req).then((res) => {
        if (res && res.ok) { const salinan = res.clone(); caches.open(VERSI).then((c) => c.put(req, salinan)); }
        return res;
      }).catch(() => ada);
      return ada || baru;
    })
  );
});
