const CACHE = 'findstuff-shell-a9a8c2cbc92d35e9';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-DJJ2jAsJ.css","/assets/ProjectsView-DkT9ROtw.js","/assets/CompatibilityView-CLLMLazg.js","/assets/TargetDetailView-z1N0Ix8s.js","/assets/TargetEditor-DI-1yswh.js","/assets/AnalyticsView-pzACf87W.js","/assets/TargetChoices-BvCZrFEs.js","/assets/InventoryManagementView-DBXqKriy.js","/assets/AIScanInboxView-CeidZdSs.js","/assets/DefaultRulesView-BAA4L0V4.js","/assets/OffCategoryMappingsView-CM-iKJwX.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D6enX0p6.js","/assets/useDeviceDraft-DlXktnf2.js","/assets/extensionApi-DjSmEbJ9.js","/assets/PrintQueueDialog-l9421y_K.js","/assets/HierarchyPicker-Cufhyw1x.js","/assets/DataView-BHIKPVNw.js","/assets/ManageView-9GSlN5oS.js","/assets/PlaceTrees-CZapEduR.js","/assets/ScanView-pELbMizp.js","/assets/ProjectDetailView-Bq3T1t0Q.js","/assets/PlacesView-CLigNYAY.js","/assets/index-CZjLLUT2.js","/assets/index-GfFD823P.js","/assets/ItemDetail-CqwOGLNI.js","/assets/index-BFKG2VlZ.js"];
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
