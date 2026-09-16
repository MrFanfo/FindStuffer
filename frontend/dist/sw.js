const CACHE = 'findstuff-shell-015584781eafced4';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-n3R0HAHT.css","/assets/ProjectsView-BRmSPYUJ.js","/assets/CompatibilityView-DXqcTcm9.js","/assets/TargetDetailView-DGsylHle.js","/assets/TargetEditor-BbcGhX8d.js","/assets/AnalyticsView-CXoIhsva.js","/assets/TargetChoices-Pj52K9TF.js","/assets/InventoryManagementView-B0kEcI-G.js","/assets/AIScanInboxView-1aRveaFJ.js","/assets/DefaultRulesView-xGlRY5cI.js","/assets/OffCategoryMappingsView-g0avZ6Sy.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-hWNtrHWB.js","/assets/extensionApi-DS5hAygh.js","/assets/HierarchyPicker-C1QQwe8K.js","/assets/PrintQueueDialog-DxBt8-3r.js","/assets/DataView-B7qlTLU_.js","/assets/PlaceTrees-CzGZQPDF.js","/assets/ManageView-DS5Pun1z.js","/assets/PlacesView-CaZE5-cZ.js","/assets/ScanView-BF2rIE-j.js","/assets/ProjectDetailView-Bdm9Cf2R.js","/assets/index-CZjLLUT2.js","/assets/index-ClyUebmZ.js","/assets/ItemDetail-BvcUZOrb.js","/assets/index-BFKG2VlZ.js"];
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
    event.respondWith(caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      // A page from a newer build asks for hashed chunks this shell never
      // listed. Keep what we fetch so the view opens offline next time, and let
      // a real failure reject: a synthesized error response would reach a
      // dynamic import as an unparsable module and break the screen for good.
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }));
  }
});
