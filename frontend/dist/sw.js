const CACHE = 'findstuff-shell-73481818282cde2c';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-B0aUji_7.css","/assets/ProjectsView-D6KfMgGs.js","/assets/CompatibilityView-AO_715eL.js","/assets/TargetDetailView-BoiWnbgI.js","/assets/TargetEditor-CeSRJNbf.js","/assets/AnalyticsView-kLmub-WG.js","/assets/TargetChoices-Cz_KZoQX.js","/assets/InventoryManagementView-B7t_dmlx.js","/assets/AIScanInboxView-BLyM3Xbc.js","/assets/DefaultRulesView-Bfu3__4r.js","/assets/OffCategoryMappingsView-55O5igqI.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D8XNPk_W.js","/assets/useDeviceDraft-DsuFAsyz.js","/assets/extensionApi-WibDszUG.js","/assets/PrintQueueDialog-BOVINdYB.js","/assets/HierarchyPicker-DhulpuNK.js","/assets/DataView-DUA8sH7Q.js","/assets/ManageView-nwfM7Kt1.js","/assets/PlaceTrees-D3wWudVB.js","/assets/ScanView-B8RXauHT.js","/assets/ProjectDetailView-CSXjCcaV.js","/assets/PlacesView-fvGkJrK8.js","/assets/index-CZjLLUT2.js","/assets/index-AFqovbj9.js","/assets/ItemDetail-DGNaPGtd.js","/assets/index-BFKG2VlZ.js"];
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
