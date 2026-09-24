const CACHE = 'findstuff-shell-18ef08da6c599a3f';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BPVPhHuf.css","/assets/ProjectsView-BUnZUAYs.js","/assets/CompatibilityView-B_p25oFx.js","/assets/TargetDetailView-DLGdhWH2.js","/assets/TargetEditor-CGN9us3v.js","/assets/AnalyticsView-BrDGFfcZ.js","/assets/TargetChoices-SPi8xfVX.js","/assets/InventoryManagementView-ILEzmCia.js","/assets/AIScanInboxView-Dj2F4-WF.js","/assets/DefaultRulesView-DX3fGHcI.js","/assets/OffCategoryMappingsView-DBnsENvC.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Dvy4APzN.js","/assets/useDeviceDraft-BJeKKMkz.js","/assets/extensionApi-CxS42WiU.js","/assets/HierarchyPicker-Bc1vXYSN.js","/assets/PrintQueueDialog-Bi7yavFS.js","/assets/DataView-4_GXgaqO.js","/assets/ManageView-glG9KqQC.js","/assets/PlacesView-BKvQFC9u.js","/assets/PlaceTrees-DpG_D3YF.js","/assets/ScanView-CJKcfsDS.js","/assets/ProjectDetailView-DaP3Kpxd.js","/assets/index-CZjLLUT2.js","/assets/index-H5Zht1B1.js","/assets/ItemDetail-CJO0OXuM.js","/assets/index-BFKG2VlZ.js"];
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
