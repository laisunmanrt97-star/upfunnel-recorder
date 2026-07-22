const CACHE = 'snaprec-v8'
const ASSETS = [
  '/style.css',
  '/manifest.json',
  '/assets/icon-192.svg',
  '/assets/icon-512.svg',
  '/assets/upfunnel-logo-horizontal-blanco-transparente.png',
  '/assets/chart.umd.min.js',
  '/assets/Inter-variable.woff2',
  '/js/tools.js',
  '/js/devices.js',
  '/js/bubble.js',
  '/js/stats.js',
  '/js/dashboard.js',
  '/js/crop.js',
  '/js/recorder.js',
  '/js/capture.js',
  '/js/app.js',
  '/js/sw-register.js',
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
      Promise.all(keys.filter((k) => k.startsWith('snaprec-') && k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // El documento siempre pasa por nginx para que Basic Auth pueda revocarse.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request))
    return
  }

  if (url.origin !== self.location.origin) return
  const path = stripQuery(e.request.url)
  e.respondWith(
    caches.match(path).then((r) => r || fetch(e.request))
  )
})
