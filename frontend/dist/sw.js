const CACHE = 'findstuff-shell-6565c74d33038d41';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-Dtl-BOSy.css","/assets/ProjectsView-gsEsh0W7.js","/assets/CompatibilityView-ByBNx20S.js","/assets/TargetDetailView-Cuft_NpF.js","/assets/TargetEditor-DRsia9r_.js","/assets/AnalyticsView-BvwVU1Y5.js","/assets/TargetChoices-CHdqQ43r.js","/assets/InventoryManagementView-DN_UiBSX.js","/assets/AIScanInboxView-B2JPCiez.js","/assets/DefaultRulesView-B4-rLYME.js","/assets/OffCategoryMappingsView-D3h2ksj7.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DeLwXSvd.js","/assets/useDeviceDraft-YMqKArLA.js","/assets/extensionApi-BI0i9uKp.js","/assets/HierarchyPicker-CguGt8Ze.js","/assets/PrintQueueDialog-BdK44ISw.js","/assets/DataView-CZBlQnYk.js","/assets/ManageView-BbJqDvkf.js","/assets/PlacesView-OsJekuKm.js","/assets/PlaceTrees-BsJ6QCU1.js","/assets/ScanView-C0u3J56y.js","/assets/ProjectDetailView-gGTKEpcs.js","/assets/index-CZjLLUT2.js","/assets/index-BZDHT1Eq.js","/assets/ItemDetail-BYLN2eRH.js","/assets/index-BFKG2VlZ.js"];
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
