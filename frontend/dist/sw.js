const CACHE = 'findstuff-shell-0702682d5ecf402f';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BaEiKAL4.css","/assets/ProjectsView-Cvfy8xSs.js","/assets/CompatibilityView-CLjbXmZ0.js","/assets/TargetDetailView-DrnP01fr.js","/assets/TargetEditor-C98LaaFW.js","/assets/AnalyticsView-CyxQ0tlM.js","/assets/TargetChoices-qe97rMH2.js","/assets/InventoryManagementView-Y8Bbolz9.js","/assets/AIScanInboxView-fyiXOkmS.js","/assets/DefaultRulesView-C3bwSzaK.js","/assets/OffCategoryMappingsView-CO_MjBzG.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Dq7vSIK_.js","/assets/extensionApi-TElkvTLr.js","/assets/HierarchyPicker-8zV8jhhg.js","/assets/PrintQueueDialog-hHhGQb_0.js","/assets/DataView-BkHSUWKr.js","/assets/PlaceTrees-Zquef3Pp.js","/assets/ManageView-HZ6lW5QK.js","/assets/PlacesView-DyVI9KUb.js","/assets/ScanView-CAXf7nG3.js","/assets/ProjectDetailView-RRDN-vwW.js","/assets/index-CZjLLUT2.js","/assets/index-D4hXViXg.js","/assets/ItemDetail-CYrQp_09.js","/assets/index-BFKG2VlZ.js"];
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
