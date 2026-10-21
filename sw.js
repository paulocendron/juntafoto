const CACHE_NAME = 'juntafoto-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js?v=5',
  './style.css?v=5',
  './manifest.json'
];

// Instala e faz cache dos assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Remove caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Estratégia: network first (sempre pega a versão mais nova; usa o cache só se estiver offline)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Não intercepta chamadas à API do Cloudinary nem requisições que não sejam GET
  if (event.request.method !== 'GET' || url.hostname.includes('cloudinary.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Só faz cache de respostas válidas e do mesmo origin
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
