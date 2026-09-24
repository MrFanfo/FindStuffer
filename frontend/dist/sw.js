const CACHE = 'findstuff-shell-5c6576bcc9c359b0';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CSd7U8j5.css","/assets/ProjectsView-BcYGDJz8.js","/assets/CompatibilityView-D7SBOSXl.js","/assets/TargetDetailView-CB_bNXl4.js","/assets/TargetEditor-C5AykDyr.js","/assets/AnalyticsView-CrdJxQKg.js","/assets/TargetChoices-CjrdRIQ6.js","/assets/InventoryManagementView-CNrRdaBl.js","/assets/AIScanInboxView-DdmMdCih.js","/assets/DefaultRulesView-UTAnmuFR.js","/assets/OffCategoryMappingsView-C4tubLvn.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-G-Rd-LeR.js","/assets/useDeviceDraft-4MWYnKxo.js","/assets/extensionApi-v7V9Uwjv.js","/assets/HierarchyPicker-CGeju0ma.js","/assets/PrintQueueDialog-COpmELhM.js","/assets/DataView-BK2yuO2T.js","/assets/ManageView-DxD2tCXm.js","/assets/PlacesView-BRivaUDg.js","/assets/PlaceTrees-B_mMUYZw.js","/assets/ScanView-rfGEGhHw.js","/assets/ProjectDetailView-D3id3Y6b.js","/assets/index-CZjLLUT2.js","/assets/index-Ce-sVzCQ.js","/assets/ItemDetail-DCHx4Wxy.js","/assets/index-BFKG2VlZ.js"];
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
