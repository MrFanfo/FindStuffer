const CACHE = 'findstuff-shell-cb253455fe0db581';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-e5rZ_0ey.css","/assets/ProjectsView-BxtJGEyg.js","/assets/CompatibilityView-uKXhFdPy.js","/assets/TargetDetailView-D1ubvaY0.js","/assets/TargetEditor-Crlrp91f.js","/assets/AnalyticsView-BxhTV61h.js","/assets/TargetChoices-dBm6uzio.js","/assets/InventoryManagementView-DLtTdzGx.js","/assets/AIScanInboxView-CmXXngPP.js","/assets/DefaultRulesView-CVDDGNEk.js","/assets/OffCategoryMappingsView-Dk76uocP.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CEmd4oSm.js","/assets/useDeviceDraft-e5TRPFBJ.js","/assets/extensionApi-BxV4eVw-.js","/assets/PrintQueueDialog-TK-MEt00.js","/assets/HierarchyPicker-B_ZZ4Gts.js","/assets/DataView-DzIkS2-F.js","/assets/ManageView-BNah0k_B.js","/assets/PlaceTrees-BsEWrxcH.js","/assets/ScanView-Dxz65RTZ.js","/assets/ProjectDetailView-CrDfU1zR.js","/assets/PlacesView-Bjg7OqyP.js","/assets/index-CZjLLUT2.js","/assets/index-CB4K-gpv.js","/assets/ItemDetail-CyfQWsyx.js","/assets/index-BFKG2VlZ.js"];
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
