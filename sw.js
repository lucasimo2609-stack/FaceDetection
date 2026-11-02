// Service worker: rende l'app utilizzabile offline e installabile.
// Mette in cache SOLO i file dell'app (codice, libreria, modello): non vede
// e non memorizza mai immagini della fotocamera, che non passano dalla rete.

const VERSION = 'v1.1.0';
const SHELL_CACHE = `facs-shell-${VERSION}`;
const ASSET_CACHE = 'facs-assets-mediapipe-0.10.32';

const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'js/main.js',
  'js/analyzer.js',
  'js/camera.js',
  'js/charts.js',
  'js/emotions.js',
  'js/facs.js',
  'js/features.js',
  'js/headpose.js',
  'js/landmarker.js',
  'js/model.js',
  'js/model-data.js',
  'js/overlay.js',
  'js/privacy.js',
  'js/session.js',
  'js/states.js',
  'js/temporal.js',
  'js/ui.js',
  'js/util.js',
  'vendor/mediapipe/vision_bundle.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Libreria WebAssembly e modello: immutabili e pesanti → prima la cache.
  if (url.pathname.includes('/vendor/mediapipe/wasm/') || url.pathname.includes('/models/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Codice dell'app: prima la rete (aggiornamenti immediati), poi la cache.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});
