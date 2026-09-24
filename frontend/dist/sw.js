const CACHE = 'findstuff-shell-baa77af430a3aeae';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-Bg3I5RcN.css","/assets/ProjectsView-BldPwm3T.js","/assets/CompatibilityView-YrSGA3NK.js","/assets/TargetDetailView-C8DYORZo.js","/assets/TargetEditor-DWSdfNJB.js","/assets/AnalyticsView-CSA2LyCC.js","/assets/TargetChoices-CJEwGVGi.js","/assets/InventoryManagementView-Ckq9nkoK.js","/assets/AIScanInboxView-B2Z3IzLW.js","/assets/DefaultRulesView-iYW-qnjs.js","/assets/OffCategoryMappingsView-4mYyr1NI.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-cJslcsW8.js","/assets/useDeviceDraft-C35-7_tt.js","/assets/extensionApi-DDMa-Cyw.js","/assets/HierarchyPicker-Co1I5Nhx.js","/assets/PrintQueueDialog-CYzkQ8P1.js","/assets/DataView-SLCST7gn.js","/assets/ManageView-CdEZGxXg.js","/assets/PlacesView-CzfblBEQ.js","/assets/PlaceTrees-B-yOr3u3.js","/assets/ScanView-BtLkBbps.js","/assets/ProjectDetailView-aov1fC9C.js","/assets/index-CZjLLUT2.js","/assets/index-2gZIE0ZO.js","/assets/ItemDetail-nQMAf91_.js","/assets/index-BFKG2VlZ.js"];
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
