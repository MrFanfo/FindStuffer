const CACHE = 'findstuff-shell-050f6b6bf31bbe61';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BkX-UpvX.css","/assets/ProjectsView-COjGLkiV.js","/assets/CompatibilityView-DLr0xUgc.js","/assets/TargetDetailView-jaFqmupX.js","/assets/TargetEditor-QOsgMq58.js","/assets/AnalyticsView-DA-sR7pm.js","/assets/TargetChoices-NvQI07fn.js","/assets/InventoryManagementView-DPhVGnga.js","/assets/AIScanInboxView-B15tcjmn.js","/assets/DefaultRulesView-D1gfZTwl.js","/assets/OffCategoryMappingsView-a0D0qyBh.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-Dul-TqF_.js","/assets/useDeviceDraft-CcGOyQCb.js","/assets/extensionApi-rMmGIPvx.js","/assets/PrintQueueDialog-CAAHBikt.js","/assets/HierarchyPicker-7MjV3aiT.js","/assets/DataView-BAwU07xP.js","/assets/ManageView-fbZYILR1.js","/assets/PlacesView-CjyaQYUp.js","/assets/PlaceTrees-Bk4JC92M.js","/assets/ScanView-BFanghJ9.js","/assets/ProjectDetailView-CLHTycqe.js","/assets/index-CZjLLUT2.js","/assets/index-BgTGddkQ.js","/assets/ItemDetail-CJDbw5kZ.js","/assets/index-BFKG2VlZ.js"];
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
