const CACHE = 'snaprec-v2'
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/assets/icon-192.svg',
  '/assets/icon-512.svg',
  '/js/tools.js',
  '/js/devices.js',
  '/js/bubble.js',
  '/js/stats.js',
  '/js/dashboard.js',
  '/js/crop.js',
  '/js/recorder.js',
  '/js/capture.js',
  '/js/app.js',
]

function stripQuery (url) {
  const u = new URL(url)
  u.search = ''
  return u.href
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const path = stripQuery(e.request.url)
  if (path.startsWith('https://cdn.')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
    return
  }
  e.respondWith(
    caches.match(path).then((r) => r || fetch(e.request))
  )
})