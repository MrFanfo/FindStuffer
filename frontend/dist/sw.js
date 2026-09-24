const CACHE = 'findstuff-shell-4096c1ac9362157e';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CL1rFwM1.css","/assets/ProjectsView-DhgOZ58x.js","/assets/CompatibilityView-CJu4vDR1.js","/assets/TargetDetailView-CvMB4Mv1.js","/assets/TargetEditor-C-VqMcLk.js","/assets/AnalyticsView-DyVVg5OJ.js","/assets/TargetChoices-C2hr_nPW.js","/assets/InventoryManagementView-BaJZGFfn.js","/assets/AIScanInboxView-CHUR1UdH.js","/assets/DefaultRulesView-AQsG2SfY.js","/assets/OffCategoryMappingsView-BRSETZcX.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CLVDo0z5.js","/assets/useDeviceDraft-I3VIOydI.js","/assets/extensionApi-CZkoeJkn.js","/assets/HierarchyPicker-nI5AgE5T.js","/assets/PrintQueueDialog-BV6mvhj1.js","/assets/DataView-D9a3rSz4.js","/assets/ManageView-DXL8-vfQ.js","/assets/PlacesView-Boj6Bci3.js","/assets/PlaceTrees-ApasuNXO.js","/assets/ScanView-BBdx6JH5.js","/assets/ProjectDetailView-DGswWBTY.js","/assets/index-CZjLLUT2.js","/assets/index-BCMfrA_R.js","/assets/ItemDetail-3fge1RHK.js","/assets/index-BFKG2VlZ.js"];
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
