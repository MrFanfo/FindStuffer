const CACHE = 'findstuff-shell-f4d39ddc808913ed';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CnEg_mP1.css","/assets/ProjectsView-C96lWYDE.js","/assets/CompatibilityView-DElIqchM.js","/assets/TargetDetailView-CO_YK0VL.js","/assets/TargetEditor-C973lU-D.js","/assets/AnalyticsView-Csur5bkv.js","/assets/TargetChoices-mB-vCS6J.js","/assets/InventoryManagementView-1T6WWPal.js","/assets/AIScanInboxView-Cd5mPNRl.js","/assets/DefaultRulesView-C52YL99r.js","/assets/OffCategoryMappingsView-BMR67SFL.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D4PFCcoO.js","/assets/useDeviceDraft-CJt2O2qA.js","/assets/extensionApi-BoOccoW6.js","/assets/HierarchyPicker-DOrIEiE8.js","/assets/PrintQueueDialog-Bbp67wGs.js","/assets/ManageView-5exrFsde.js","/assets/PlacesView-CicRcp4y.js","/assets/PlaceTrees-BMZyMpP2.js","/assets/DataView-CYkb4EKH.js","/assets/ScanView-CtKUxcKs.js","/assets/ProjectDetailView-CjE6HH3w.js","/assets/index-CZjLLUT2.js","/assets/index-BMBqJtFt.js","/assets/ItemDetail-KM5mM2OS.js","/assets/index-BFKG2VlZ.js"];
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
