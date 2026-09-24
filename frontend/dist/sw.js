const CACHE = 'findstuff-shell-87b7e2be1a9f81a4';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BkX-UpvX.css","/assets/ProjectsView-DF8ifq62.js","/assets/CompatibilityView-BCBoJZ5Z.js","/assets/TargetDetailView-Zq-4Qh3k.js","/assets/TargetEditor-YCpH4cLp.js","/assets/AnalyticsView-BoVct4cO.js","/assets/TargetChoices-BMon_kuP.js","/assets/InventoryManagementView-B6v9owTe.js","/assets/AIScanInboxView-DJvM3JUJ.js","/assets/DefaultRulesView-DKwFzatK.js","/assets/OffCategoryMappingsView-CmLZU_pj.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-C1gjsaDB.js","/assets/useDeviceDraft-GY4hobmh.js","/assets/extensionApi-CjZg_xQg.js","/assets/PrintQueueDialog-dUg6TeHo.js","/assets/HierarchyPicker-GfcQXxxs.js","/assets/DataView-nEYNlO4K.js","/assets/ManageView-BZ7kx_uY.js","/assets/PlacesView-Ccyju-ph.js","/assets/PlaceTrees-BFVT-lnx.js","/assets/ScanView-D8GNdPKz.js","/assets/ProjectDetailView-C2rH1NHy.js","/assets/index-CZjLLUT2.js","/assets/index-CBLNXFsl.js","/assets/ItemDetail-qvLF2wio.js","/assets/index-BFKG2VlZ.js"];
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
