const CACHE = 'findstuff-shell-20116e5644482eff';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-xryxG3xb.css","/assets/ProjectsView-CRWaT1SM.js","/assets/CompatibilityView-DvIez3N0.js","/assets/TargetDetailView-Bo--NbWv.js","/assets/TargetEditor-keH9NSaO.js","/assets/AnalyticsView-gT9Zo7qK.js","/assets/TargetChoices-DHkGICV6.js","/assets/InventoryManagementView-DVmXRz9d.js","/assets/AIScanInboxView-DS_BQixR.js","/assets/DefaultRulesView-B9OzCKKE.js","/assets/OffCategoryMappingsView-CIPJBR-U.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-DbXHWVm7.js","/assets/useDeviceDraft-D0qYGeAr.js","/assets/extensionApi-DSqN2Up6.js","/assets/HierarchyPicker-DCoZ_r22.js","/assets/PrintQueueDialog-BiW_pUi3.js","/assets/DataView-DU-Wq6Wm.js","/assets/ManageView-BpzItYz7.js","/assets/PlacesView-DwBmPseF.js","/assets/PlaceTrees-xoxRKKWO.js","/assets/ScanView-KxPBzOMW.js","/assets/ProjectDetailView-DyhoXZ2e.js","/assets/index-CZjLLUT2.js","/assets/index-BBaesnYo.js","/assets/ItemDetail-JFG38H0U.js","/assets/index-BFKG2VlZ.js"];
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
