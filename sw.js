// Service worker de base. Si Monetag (Push) te donne son propre sw.js, REMPLACE ce fichier par le leur.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
