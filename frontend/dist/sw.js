const CACHE = 'findstuff-shell-d8555c5fbe7573bd';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BDUcZ8fD.css","/assets/ProjectsView-PJJlSQL6.js","/assets/CompatibilityView-CgXFwGuM.js","/assets/TargetDetailView-BkcJb-Sq.js","/assets/TargetEditor-BHrPWIMQ.js","/assets/AnalyticsView-CE78XYAK.js","/assets/TargetChoices-CRBGipRm.js","/assets/InventoryManagementView-KMZZwkOg.js","/assets/AIScanInboxView-DOvgR4zZ.js","/assets/DefaultRulesView-7jTc-35I.js","/assets/OffCategoryMappingsView-BCPy2xle.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D8UbAtuT.js","/assets/useDeviceDraft-DktylBRi.js","/assets/extensionApi-CeGISXEW.js","/assets/HierarchyPicker-CJsupr2H.js","/assets/PrintQueueDialog-DdUgkj0n.js","/assets/DataView-C1NtVDSG.js","/assets/ManageView-BYsrUvzV.js","/assets/PlacesView-B0n3vyx6.js","/assets/PlaceTrees-DignSuxO.js","/assets/ScanView-DX3-DbMp.js","/assets/ProjectDetailView-COWtnge2.js","/assets/index-CZjLLUT2.js","/assets/index-B0NKyHy6.js","/assets/ItemDetail-DzDHOHRq.js","/assets/index-BFKG2VlZ.js"];
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
