const CACHE = 'findstuff-shell-391b60664ce67dc1';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-xryxG3xb.css","/assets/ProjectsView-C_jSKbZB.js","/assets/CompatibilityView-Cu4hD9ic.js","/assets/TargetDetailView-8j_b4sUm.js","/assets/TargetEditor-CMEkb5a0.js","/assets/AnalyticsView-Cl8NWze_.js","/assets/TargetChoices-Bbl9Ks-a.js","/assets/InventoryManagementView-U7c5Q_In.js","/assets/AIScanInboxView-DNK3sHCz.js","/assets/DefaultRulesView-DD78Ie3P.js","/assets/OffCategoryMappingsView-kW64Y6hV.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-BdrC55Bc.js","/assets/useDeviceDraft-DAmCfVPl.js","/assets/extensionApi-DBfqVCvM.js","/assets/HierarchyPicker-HgB7Si4l.js","/assets/PrintQueueDialog-CCmGCM1e.js","/assets/DataView-Bq9FcIt6.js","/assets/ManageView-RCWDQw_C.js","/assets/PlacesView-ulpeAj0C.js","/assets/PlaceTrees-DviPQXYj.js","/assets/ScanView-CmruZzVS.js","/assets/ProjectDetailView-BLhFJ4Lw.js","/assets/index-CZjLLUT2.js","/assets/index-Cc41ReBq.js","/assets/ItemDetail-UkcOEHtk.js","/assets/index-BFKG2VlZ.js"];
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
