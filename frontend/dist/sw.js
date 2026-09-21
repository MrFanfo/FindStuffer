const CACHE = 'findstuff-shell-ed42a90ef897dda6';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BpVU0oXX.css","/assets/ProjectsView-D3Ap7D9J.js","/assets/CompatibilityView-BF5CYX6m.js","/assets/TargetDetailView-BUotj9io.js","/assets/TargetEditor-BVkuH8du.js","/assets/AnalyticsView-CDfUEwLH.js","/assets/TargetChoices-CD4E-jnl.js","/assets/InventoryManagementView-BQZjkqWt.js","/assets/AIScanInboxView-BMAmcO6O.js","/assets/DefaultRulesView-C39K0bCG.js","/assets/OffCategoryMappingsView-iguKBBoE.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DlVzfVvd.js","/assets/useDeviceDraft-DakNA0fL.js","/assets/extensionApi-C3zR3ol9.js","/assets/HierarchyPicker-C3BwbXs_.js","/assets/PrintQueueDialog-BulY7bQi.js","/assets/DataView-7Km5bdvi.js","/assets/PlaceTrees-DWbPy2x0.js","/assets/ManageView-CYQK6Lty.js","/assets/PlacesView-CUOyWR1I.js","/assets/ScanView-Cu0kUYiM.js","/assets/ProjectDetailView-CuFpMMpu.js","/assets/index-CZjLLUT2.js","/assets/index-BwQRK_Kj.js","/assets/ItemDetail-C98ujbF3.js","/assets/index-BFKG2VlZ.js"];
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
