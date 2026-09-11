const CACHE = 'findstuff-shell-ca8273504a4ca9e8';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-ChMqediy.css","/assets/CompatibilityView-DAB7wL4a.js","/assets/AnalyticsView-E3D6W0QS.js","/assets/TargetChoices-wL7IwS1s.js","/assets/InventoryManagementView-t91YJOSC.js","/assets/AIScanInboxView-zsEaB_kp.js","/assets/DefaultRulesView-CkNcogdj.js","/assets/OffCategoryMappingsView-Cq0PmcL2.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-sff_bP7b.js","/assets/extensionApi-BsKCUSDV.js","/assets/HierarchyPicker-r6TUmn9D.js","/assets/PrintQueueDialog-DUsOuqGg.js","/assets/DataView-C_-kxLot.js","/assets/PlaceTrees-D2-Hl_MZ.js","/assets/ManageView-_arN9u19.js","/assets/PlacesView-CB--_-O_.js","/assets/ScanView-GTCEYmip.js","/assets/ProjectsView-Bva9DS4g.js","/assets/index-CZjLLUT2.js","/assets/index-B4f43nXa.js","/assets/ItemDetail-CPvduv10.js","/assets/index-BFKG2VlZ.js"];
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
