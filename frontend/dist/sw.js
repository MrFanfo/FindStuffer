const CACHE = 'findstuff-shell-7786f069f03c162e';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BnkiU5dy.css","/assets/ProjectsView-CoQVEH3v.js","/assets/CompatibilityView-DU6a2RDk.js","/assets/TargetDetailView-Dz5rclxP.js","/assets/TargetEditor-uPd714Ac.js","/assets/AnalyticsView-Ceow4wMO.js","/assets/TargetChoices-CvCZT3ea.js","/assets/InventoryManagementView-CT9YMdvf.js","/assets/AIScanInboxView-DArQLCz8.js","/assets/DefaultRulesView-x7Vsrse0.js","/assets/OffCategoryMappingsView-DbInrq1r.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-B9QQgmxK.js","/assets/useDeviceDraft-BUnAKAza.js","/assets/extensionApi-D-BllxW5.js","/assets/HierarchyPicker-DlZCLQFg.js","/assets/PrintQueueDialog-BOyOp2tM.js","/assets/DataView-BXfcGiyT.js","/assets/ManageView-DMvzU_lp.js","/assets/PlacesView-BVHO6cHD.js","/assets/PlaceTrees-BAChXqc3.js","/assets/ScanView-DdcbphsJ.js","/assets/ProjectDetailView-D_A3iODH.js","/assets/index-CZjLLUT2.js","/assets/index-7vZmHwKA.js","/assets/ItemDetail-C0fhe_HD.js","/assets/index-BFKG2VlZ.js"];
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
