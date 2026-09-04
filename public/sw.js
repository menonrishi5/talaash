// Minimal service worker. It exists only so the app meets Android/Chrome's
// "installable" criteria (add-to-home-screen with its own launch icon,
// no browser chrome) — it deliberately does no caching, so it can never
// serve a stale build after a deploy. Vite's own hashed filenames + normal
// HTTP caching handle performance; this file's only job is to be present
// and register a fetch listener.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // No respondWith() — every request falls through to the network exactly
  // as if this file didn't exist.
})
