const CACHE = 'findstuff-shell-004911a3b851f3c9';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BhNAAfBk.css","/assets/ProjectsView-DDabNKgC.js","/assets/CompatibilityView-D50maZdl.js","/assets/TargetDetailView-BwBaTgU9.js","/assets/TargetEditor-DFU2IPfj.js","/assets/AnalyticsView-ND8CTsPg.js","/assets/TargetChoices-B-cYqgW5.js","/assets/InventoryManagementView-DUwggCQe.js","/assets/AIScanInboxView-D72zxtAj.js","/assets/DefaultRulesView-DuSMtU4A.js","/assets/OffCategoryMappingsView-COeXQ2if.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CEHaZHvT.js","/assets/useDeviceDraft-BZjfqqep.js","/assets/extensionApi-C0w6-AcY.js","/assets/HierarchyPicker--GXTdCjy.js","/assets/PrintQueueDialog-DM32B9Q1.js","/assets/DataView-BU6J5Po9.js","/assets/ManageView-B6xYSDen.js","/assets/PlacesView-BynNMf_V.js","/assets/PlaceTrees-Ln9OcSi5.js","/assets/ScanView-BI93njpK.js","/assets/ProjectDetailView-CpPF5rKE.js","/assets/index-CZjLLUT2.js","/assets/index-BaSwrBLZ.js","/assets/ItemDetail-Cj9F_pX7.js","/assets/index-BFKG2VlZ.js"];
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
