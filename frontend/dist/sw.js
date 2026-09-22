const CACHE = 'findstuff-shell-1fe88274bfbd6d2c';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-2C_TQG7p.css","/assets/ProjectsView-CBUpaBjE.js","/assets/CompatibilityView-6yqC39BW.js","/assets/TargetDetailView-DrSegeDh.js","/assets/TargetEditor-C-oqWu3A.js","/assets/AnalyticsView-BZguP9JV.js","/assets/TargetChoices-GN1h0dYR.js","/assets/InventoryManagementView-BNp407cZ.js","/assets/AIScanInboxView-CDvPnzrx.js","/assets/DefaultRulesView-C_0yP-A5.js","/assets/OffCategoryMappingsView-u4u7obOl.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Cm1uhsXU.js","/assets/useDeviceDraft-BD0nzreH.js","/assets/extensionApi-Duaeg3x2.js","/assets/HierarchyPicker-CrVVPKLQ.js","/assets/PrintQueueDialog-Djku-R8i.js","/assets/DataView-Dtnr4ZE9.js","/assets/PlaceTrees-CBJxjoiM.js","/assets/ManageView-e_lLdZMQ.js","/assets/PlacesView-DiWUIyns.js","/assets/ScanView-DF5entrI.js","/assets/ProjectDetailView-BjIjhCsZ.js","/assets/index-CZjLLUT2.js","/assets/index-C9EED-Et.js","/assets/ItemDetail-1q-Z8INc.js","/assets/index-BFKG2VlZ.js"];
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
