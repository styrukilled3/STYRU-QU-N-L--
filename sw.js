const V = 'dong-tien-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: mở nhanh từ cache, cập nhật ngầm cho lần sau
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(V).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
