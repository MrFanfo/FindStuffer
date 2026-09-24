const CACHE = 'findstuff-shell-ed643dab9e8104b7';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-Cw3-1uhj.css","/assets/ProjectsView-Bfdrp1HB.js","/assets/CompatibilityView-Ck6H4wNP.js","/assets/TargetDetailView-BwvhMYdf.js","/assets/TargetEditor-B0Z7ZFtl.js","/assets/AnalyticsView-WXwGrTrq.js","/assets/TargetChoices-BMUbPfFr.js","/assets/InventoryManagementView-BLx_RUHR.js","/assets/AIScanInboxView-DbyCwK_K.js","/assets/DefaultRulesView-2SeANPUg.js","/assets/OffCategoryMappingsView-BkeY_382.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Raclj86A.js","/assets/useDeviceDraft-Bf51iR5w.js","/assets/extensionApi-oCPjxrI2.js","/assets/HierarchyPicker-DHM2AiWL.js","/assets/PrintQueueDialog-Cefeci1z.js","/assets/DataView-CpeSQnv0.js","/assets/ManageView-0Ed8Q0_-.js","/assets/PlacesView-BuBmKs78.js","/assets/PlaceTrees-CSCH2lzh.js","/assets/ScanView-Bv4sGqbP.js","/assets/ProjectDetailView-CQHGje6j.js","/assets/index-CZjLLUT2.js","/assets/index-BQRZxy9Z.js","/assets/ItemDetail-BtqVVp4O.js","/assets/index-BFKG2VlZ.js"];
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
