const CACHE = 'findstuff-shell-642e56e8564c4fcb';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BjL_epLo.css","/assets/ProjectsView-lnGhRgPF.js","/assets/CompatibilityView-DgeJZYQd.js","/assets/TargetDetailView-B6N4KeCu.js","/assets/TargetEditor-DYOZsk9T.js","/assets/AnalyticsView-CKUV9rB8.js","/assets/TargetChoices-CXgkA8Bs.js","/assets/InventoryManagementView-nb6FOj2l.js","/assets/AIScanInboxView-C1ZngLfB.js","/assets/DefaultRulesView-D88aBBbI.js","/assets/OffCategoryMappingsView-DkUxpKnV.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Bmzet-ax.js","/assets/useDeviceDraft-DE523G91.js","/assets/extensionApi-C12DQPVn.js","/assets/HierarchyPicker-B18PwhWn.js","/assets/PrintQueueDialog-DxS_60uc.js","/assets/DataView-C1xJbkqU.js","/assets/PlaceTrees-BXZ60dEZ.js","/assets/ManageView-BAhNZ0g3.js","/assets/PlacesView-DEGGglgW.js","/assets/ScanView-OjW-qIN2.js","/assets/ProjectDetailView-DdZYimCl.js","/assets/index-CZjLLUT2.js","/assets/index-Bf_-EmgZ.js","/assets/ItemDetail-BEhS4i-2.js","/assets/index-BFKG2VlZ.js"];
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
