const CACHE = 'findstuff-shell-0788a6e0081223f8';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-xryxG3xb.css","/assets/ProjectsView-BuAaru_N.js","/assets/CompatibilityView-BKLPyCg_.js","/assets/TargetDetailView-CUN3vvEB.js","/assets/TargetEditor-C-KXw72E.js","/assets/AnalyticsView-CL3oFyXN.js","/assets/TargetChoices-yomhjosu.js","/assets/InventoryManagementView-BTn-N7ml.js","/assets/AIScanInboxView-DnX5UydM.js","/assets/DefaultRulesView-JSAyrTQ5.js","/assets/OffCategoryMappingsView-Crt4bQMn.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-BChji9WS.js","/assets/useDeviceDraft-BwcPYcle.js","/assets/extensionApi-DPXmQDzb.js","/assets/HierarchyPicker-BiASZEXV.js","/assets/PrintQueueDialog-BK3AxI1C.js","/assets/DataView-iCG0z8Vw.js","/assets/ManageView-PxLsSOEn.js","/assets/PlacesView-DFj7EtMf.js","/assets/PlaceTrees-B8sl9ps7.js","/assets/ScanView-_NZp7HTR.js","/assets/ProjectDetailView-CKds3qX0.js","/assets/index-CZjLLUT2.js","/assets/index-bE7Pd_zi.js","/assets/ItemDetail-Lc6R0w-B.js","/assets/index-BFKG2VlZ.js"];
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
