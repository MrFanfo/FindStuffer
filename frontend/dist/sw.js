const CACHE = 'findstuff-shell-2a7d836f3cabfdb7';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BpVU0oXX.css","/assets/ProjectsView-k7ynaLPL.js","/assets/CompatibilityView-Dbv3kbw7.js","/assets/TargetDetailView-VaqvTFuf.js","/assets/TargetEditor-CpXTaPXI.js","/assets/AnalyticsView-DxN6xLv7.js","/assets/TargetChoices-DAUcGDZ9.js","/assets/InventoryManagementView-CrlejRvm.js","/assets/AIScanInboxView-DEXVFSph.js","/assets/DefaultRulesView-DmaGiu67.js","/assets/OffCategoryMappingsView-C0wCBbQN.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CrvmASNJ.js","/assets/useDeviceDraft-CoP_BO30.js","/assets/extensionApi-DqYwAY-I.js","/assets/HierarchyPicker-C1x_ipSc.js","/assets/PrintQueueDialog-lCZT-d3T.js","/assets/DataView-BAQFq2E8.js","/assets/PlaceTrees-Bc-j4NLB.js","/assets/ManageView-fTeTVcP1.js","/assets/PlacesView-B_yjX256.js","/assets/ScanView-BnNKsRU-.js","/assets/ProjectDetailView-CcZVZk9J.js","/assets/index-CZjLLUT2.js","/assets/index-BnePckCJ.js","/assets/ItemDetail-CjOhRcdS.js","/assets/index-BFKG2VlZ.js"];
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
