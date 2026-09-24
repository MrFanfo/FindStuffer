const CACHE = 'findstuff-shell-e3c706abe4e8ef70';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CTuI0fpT.css","/assets/ProjectsView-z_mbsA1W.js","/assets/CompatibilityView-KNdzzP-S.js","/assets/TargetDetailView-BI1g7TEN.js","/assets/TargetEditor-pX0SE2ST.js","/assets/AnalyticsView-QFcGT7B3.js","/assets/TargetChoices-BX72_r8x.js","/assets/InventoryManagementView-p-LXiBsX.js","/assets/AIScanInboxView-D3EcVrQa.js","/assets/DefaultRulesView-C-y3E311.js","/assets/OffCategoryMappingsView-DEXg1kq8.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-VKOGXepv.js","/assets/useDeviceDraft-D5OTjBU4.js","/assets/extensionApi-CjPfB57W.js","/assets/PrintQueueDialog-BFVLZ1Lz.js","/assets/HierarchyPicker-S0rNPVXK.js","/assets/DataView-BsWim5p6.js","/assets/ManageView-0lC0ZQNz.js","/assets/PlacesView-D3L3kze9.js","/assets/PlaceTrees-BkMrUik7.js","/assets/ScanView-DfpdQqum.js","/assets/ProjectDetailView-CZ3rZme6.js","/assets/index-CZjLLUT2.js","/assets/index-CV4BZt5L.js","/assets/ItemDetail-DCELl1TQ.js","/assets/index-BFKG2VlZ.js"];
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
