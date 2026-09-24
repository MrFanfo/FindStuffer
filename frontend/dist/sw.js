const CACHE = 'findstuff-shell-0e02d4bdaa521253';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CenO1IQw.css","/assets/ProjectsView-vZYcnWiJ.js","/assets/CompatibilityView-HcXMLfQQ.js","/assets/TargetDetailView-OMmTSVqO.js","/assets/TargetEditor-70-wHhFV.js","/assets/AnalyticsView-ffSEBtdj.js","/assets/TargetChoices-D0X-RTUA.js","/assets/InventoryManagementView-B0IicB-7.js","/assets/AIScanInboxView-BYKr_atr.js","/assets/DefaultRulesView-BwOd3JY_.js","/assets/OffCategoryMappingsView-Bdlq7OL1.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-BfVltIeX.js","/assets/useDeviceDraft-e-1D_D3_.js","/assets/extensionApi-CWwHEX7q.js","/assets/HierarchyPicker-bxE9-tnC.js","/assets/PrintQueueDialog-DuJGvwGW.js","/assets/ManageView-DFRYMKdF.js","/assets/PlacesView-Cl8GKLCu.js","/assets/PlaceTrees-DZa4XEPi.js","/assets/DataView-COFJyU8w.js","/assets/ScanView-CGDre4u0.js","/assets/ProjectDetailView-Ckcpcz56.js","/assets/index-CZjLLUT2.js","/assets/index-C1p08yeD.js","/assets/ItemDetail-CwDURsIu.js","/assets/index-BFKG2VlZ.js"];
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
