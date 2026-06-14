// Minimal service worker — present only to satisfy PWA installability.
// No offline caching: the app needs the network (signaling) to be useful anyway.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
