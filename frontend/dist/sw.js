const CACHE = 'findstuff-shell-17fb7be929deddc2';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-C5ZDXvfp.css","/assets/CompatibilityView-DF0sVazH.js","/assets/AnalyticsView-DwdIuvqb.js","/assets/InventoryManagementView-BTtVmQpL.js","/assets/AIScanInboxView-LlLqIdPH.js","/assets/DefaultRulesView-BYYzCIS7.js","/assets/OffCategoryMappingsView-QLAvjWnS.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-BN9nYA6N.js","/assets/extensionApi-uAdBopRH.js","/assets/HierarchyPicker-DxhhvxjH.js","/assets/PrintQueueDialog-CVDKss5s.js","/assets/DataView-DLBNxErz.js","/assets/PlacesView-CzmgWchD.js","/assets/ManageView-GzpAfJh6.js","/assets/PlaceTrees-B_QBAQwH.js","/assets/ProjectsView-BIa90Oks.js","/assets/ScanView-B-s-FUFo.js","/assets/index-CZjLLUT2.js","/assets/index-DqS1M-Ja.js","/assets/ItemDetail-Ch0MSEo9.js","/assets/index-BFKG2VlZ.js"];
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
