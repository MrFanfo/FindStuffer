const CACHE = 'findstuff-shell-6e56587361f97dc4';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-xryxG3xb.css","/assets/ProjectsView-BShSxGka.js","/assets/CompatibilityView-DjGlbTcY.js","/assets/TargetDetailView-qTFVgxSU.js","/assets/TargetEditor-DQplVs2z.js","/assets/AnalyticsView-vS3Phrvd.js","/assets/TargetChoices-ZW5zlgSu.js","/assets/InventoryManagementView-DjPuhVsO.js","/assets/AIScanInboxView-BnJq7T8D.js","/assets/DefaultRulesView-BFRwLQ2h.js","/assets/OffCategoryMappingsView-BytPDFNa.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-CnKMGTHt.js","/assets/useDeviceDraft-DlwUvuu8.js","/assets/extensionApi-B7Zs2WqE.js","/assets/HierarchyPicker-Y6I6NAWf.js","/assets/PrintQueueDialog-DMPU8zpR.js","/assets/DataView-Aq9a49Zq.js","/assets/ManageView-CmzVlPOo.js","/assets/PlacesView-DThrnCMC.js","/assets/PlaceTrees-Bb-t6T3e.js","/assets/ScanView-DaSf2YM8.js","/assets/ProjectDetailView-D5di1fTn.js","/assets/index-CZjLLUT2.js","/assets/index-Dd5qa-3d.js","/assets/ItemDetail-aHz8QRfh.js","/assets/index-BFKG2VlZ.js"];
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
