const CACHE = 'findstuff-shell-ef0ba26033c4164d';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CenO1IQw.css","/assets/ProjectsView-C1geVMCh.js","/assets/CompatibilityView-9QNjQbKh.js","/assets/TargetDetailView-Cr0BwifT.js","/assets/TargetEditor-FECYtmk9.js","/assets/AnalyticsView-DiqsNeVH.js","/assets/TargetChoices-CBGy66vs.js","/assets/InventoryManagementView-t55JijxG.js","/assets/AIScanInboxView-wNNvq7WE.js","/assets/DefaultRulesView-D_wEVABc.js","/assets/OffCategoryMappingsView-DhmlV2yf.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DCwMbTMz.js","/assets/useDeviceDraft-D6jW_SAY.js","/assets/extensionApi-B5FJzpLW.js","/assets/HierarchyPicker-xxLCZ0Kj.js","/assets/PrintQueueDialog-CUraIZJF.js","/assets/ManageView-DQua2sjP.js","/assets/PlacesView-BKnEXfrf.js","/assets/PlaceTrees-ajXAW43I.js","/assets/DataView-DHJeZxcN.js","/assets/ScanView-CIYQNwK-.js","/assets/ProjectDetailView-B0M7Eo73.js","/assets/index-CZjLLUT2.js","/assets/index-szO4-6Cq.js","/assets/ItemDetail-Dg2jetwF.js","/assets/index-BFKG2VlZ.js"];
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
