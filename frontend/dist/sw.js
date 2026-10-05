const CACHE = 'findstuff-shell-d260363c38715ae3';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-B0d8kXsz.css","/assets/ProjectsView-iXoh0T8e.js","/assets/CompatibilityView-DF8d5JSy.js","/assets/TargetDetailView-D9A9SodA.js","/assets/TargetEditor-C14sFZHO.js","/assets/AnalyticsView-CGaSqKka.js","/assets/TargetChoices-BrBl2YUC.js","/assets/InventoryManagementView-DAS5hYLl.js","/assets/AIScanInboxView-Yq3bF5-n.js","/assets/DefaultRulesView-Bw-iEuNH.js","/assets/OffCategoryMappingsView-CRFJo0FH.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D38uWQAP.js","/assets/useDeviceDraft-DZnPGva8.js","/assets/extensionApi-0uocZNxK.js","/assets/PrintQueueDialog-TE-tQ0K0.js","/assets/HierarchyPicker-B0cFQe5h.js","/assets/DataView-5B6WHhOt.js","/assets/ManageView-1otZBLLf.js","/assets/PlaceTrees-CeEAajWu.js","/assets/ScanView-BEh-kOqM.js","/assets/ProjectDetailView-zCHP8r3Q.js","/assets/PlacesView-pK6Ztc6C.js","/assets/index-CZjLLUT2.js","/assets/index-Q-yl0POF.js","/assets/ItemDetail-eVEY2VFk.js","/assets/index-BFKG2VlZ.js"];
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
