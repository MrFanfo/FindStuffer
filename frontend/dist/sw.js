const CACHE = 'findstuff-shell-fa0bb291d9bd5416';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BSsMAI6L.css","/assets/CompatibilityView-CDZa4GbT.js","/assets/AnalyticsView-2T8g2DR3.js","/assets/TargetChoices-B7qOsX7C.js","/assets/InventoryManagementView-BigBI1rh.js","/assets/AIScanInboxView-Cero8Yhy.js","/assets/DefaultRulesView-d6RY3eVs.js","/assets/OffCategoryMappingsView-qfSWcjdO.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DIZ2GjCV.js","/assets/extensionApi-qYmXnJ-j.js","/assets/HierarchyPicker-CAqRndUH.js","/assets/PrintQueueDialog-ChAaIx6J.js","/assets/DataView-BnXexrJ7.js","/assets/PlaceTrees-B7h5GKYy.js","/assets/ManageView-CVPptu6z.js","/assets/PlacesView-J1OXcV9B.js","/assets/ProjectsView-CGxMrAIK.js","/assets/ScanView-CcgYHplk.js","/assets/index-CZjLLUT2.js","/assets/index-BNjTKeaZ.js","/assets/ItemDetail-CnThUx-0.js","/assets/index-BFKG2VlZ.js"];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  // Keep the preceding build for tabs still running its JavaScript.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('findstuff-shell-') && key !== CACHE).slice(0, -1).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/') ));
  } else {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)).catch(() => new Response('Asset unavailable. Reconnect and reload Findstuff.', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
  }
});
