const CACHE = "picbooth-v25";
const ASSETS = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/apple-touch-icon.png", "/app-icon-192.png", "/app-icon-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
