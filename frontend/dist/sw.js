const CACHE = 'findstuff-shell-7145c6b32bc08ff8';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BJelguDv.css","/assets/ProjectsView-CqMZFi3B.js","/assets/CompatibilityView-DHXjYmye.js","/assets/TargetDetailView-DjBlSNps.js","/assets/TargetEditor-BrgVIwbm.js","/assets/AnalyticsView-Dosu7vee.js","/assets/TargetChoices-JTmkLpu-.js","/assets/InventoryManagementView-CS2pNrew.js","/assets/AIScanInboxView-DRP1TcSb.js","/assets/DefaultRulesView-BkaL1Btv.js","/assets/OffCategoryMappingsView-DF3Wnjye.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DxAaiaRl.js","/assets/useDeviceDraft-CHZvTtqT.js","/assets/extensionApi-D-7i53kp.js","/assets/HierarchyPicker-xLQ2G8jV.js","/assets/PrintQueueDialog-CQnbTu1I.js","/assets/DataView-9Jfmkj9Z.js","/assets/ManageView-DAXDOs0P.js","/assets/PlacesView-Dx_7smYv.js","/assets/PlaceTrees-CCektyPv.js","/assets/ScanView-Bvlva4In.js","/assets/ProjectDetailView-GRYcv4I7.js","/assets/index-CZjLLUT2.js","/assets/index-DalaamIU.js","/assets/ItemDetail-D_Fjl7Qt.js","/assets/index-BFKG2VlZ.js"];
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
