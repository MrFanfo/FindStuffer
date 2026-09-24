const CACHE = 'findstuff-shell-57c18d44924047a6';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-X0F4OWHK.css","/assets/ProjectsView-BfpzjYoi.js","/assets/CompatibilityView-DZfJEpSq.js","/assets/TargetDetailView-DFsRladx.js","/assets/TargetEditor-CcjXylwF.js","/assets/AnalyticsView-BQ09bjlS.js","/assets/TargetChoices-DgOhNjxO.js","/assets/InventoryManagementView-D1qgHabH.js","/assets/AIScanInboxView-1BToMAVz.js","/assets/DefaultRulesView-u3a34Yhh.js","/assets/OffCategoryMappingsView-CXpohTIF.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CopSuyQi.js","/assets/useDeviceDraft-zP2zt_V2.js","/assets/extensionApi-B4a-5ltu.js","/assets/HierarchyPicker-CKKJq-Ra.js","/assets/PrintQueueDialog-C4HEyuat.js","/assets/ManageView-CTiIyuW7.js","/assets/PlacesView-KWtI2_JU.js","/assets/PlaceTrees-DV5WFerD.js","/assets/DataView-DlpX-pTs.js","/assets/ScanView-DSenE3kq.js","/assets/ProjectDetailView-ec_Pao2P.js","/assets/index-CZjLLUT2.js","/assets/index-DBDgJrlT.js","/assets/ItemDetail-Cezie3tK.js","/assets/index-BFKG2VlZ.js"];
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
