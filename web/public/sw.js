/* [10 Nov] Service worker Inbox Affiliate (PWA): tampilan (CSS/JS/ikon) dari cache supaya cepat dibuka; halaman & data chat SELALU dari jaringan
   (network-first, tidak pernah disimpan: isinya rahasia & berubah terus). Offline: halaman → offline.html, API → {ok:false, offline:true}. */
const VERSI = 'affiliate-v2';
const ASET = ['/app.css?v=18', '/app.js?v=14', '/offline.html', '/manifest.webmanifest', '/img/prepare.png', '/img/prepare-bulat.png',
  '/img/ikon-192.png', '/img/ikon-512.png', '/img/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSI).then(c => c.addAll(ASET)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;               // POST (kirim, ganti sandi) & font Google: langsung ke jaringan
  if (u.pathname === '/api.php') {
    e.respondWith(fetch(r).catch(() => new Response(JSON.stringify({ ok: false, offline: true, pesan: 'Tidak ada koneksi' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (u.pathname === '/media.php') return;                                         // media chat: tidak disimpan di HP
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/offline.html'))); return; }
  if (/\.(css|js|png|webmanifest)$/.test(u.pathname)) {                            // aset tampilan: cache dulu, simpan versi baru
    e.respondWith(caches.match(r).then(ada => ada || fetch(r).then(x => { if (x.ok) { const y = x.clone(); caches.open(VERSI).then(c => c.put(r, y)); } return x; })));
  }
});
