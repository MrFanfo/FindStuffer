const CACHE = 'findstuff-shell-2b64768f373cff1d';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BaEiKAL4.css","/assets/ProjectsView-B0nNPR7b.js","/assets/CompatibilityView-Bu4k_cDk.js","/assets/TargetDetailView-D5M18yDu.js","/assets/TargetEditor-hUs-8c84.js","/assets/AnalyticsView-DmqO67_y.js","/assets/TargetChoices-BFyFkGyp.js","/assets/InventoryManagementView-loWmxbc8.js","/assets/AIScanInboxView-BJGKem8T.js","/assets/DefaultRulesView-C6NFPGiF.js","/assets/OffCategoryMappingsView-D6UJ04rl.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CULjmQPo.js","/assets/extensionApi-DXB1fSPT.js","/assets/HierarchyPicker-Dr4rxyIW.js","/assets/PrintQueueDialog-ChZ4sNTt.js","/assets/DataView-BfH7as-q.js","/assets/PlaceTrees-B7YLVvq2.js","/assets/ManageView-B3UVtZhm.js","/assets/PlacesView-6n1eJp1i.js","/assets/ScanView-CejJ7ghS.js","/assets/ProjectDetailView-BH-N5TGp.js","/assets/index-CZjLLUT2.js","/assets/index-7JFPJ3Vs.js","/assets/ItemDetail-C7w95q5-.js","/assets/index-BFKG2VlZ.js"];
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
