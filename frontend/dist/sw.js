const CACHE = 'findstuff-shell-10a06c7c036cb2b6';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CGBz3avl.css","/assets/ProjectsView-CgMuQvha.js","/assets/CompatibilityView-9bbKrWeH.js","/assets/TargetDetailView-AvJd35PY.js","/assets/TargetEditor-BdB7psZw.js","/assets/AnalyticsView-Bwc-Sir5.js","/assets/TargetChoices-DXnzPk0b.js","/assets/InventoryManagementView-BGZB36H-.js","/assets/AIScanInboxView-BOzvNaLf.js","/assets/DefaultRulesView-CPQr7XOJ.js","/assets/OffCategoryMappingsView-D-jHm3q4.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-C40jrm6n.js","/assets/useDeviceDraft-b3_1ucPP.js","/assets/extensionApi-BBD3zPIJ.js","/assets/PrintQueueDialog-v3tg29mT.js","/assets/HierarchyPicker-XHnh_Me3.js","/assets/DataView-CURhVvX-.js","/assets/ManageView-CNJ2030x.js","/assets/PlacesView-DzzleMc9.js","/assets/PlaceTrees-D11LZWfZ.js","/assets/ScanView-BhSLOmOd.js","/assets/ProjectDetailView-Dutg6iZr.js","/assets/index-CZjLLUT2.js","/assets/index-C5w2HDOA.js","/assets/ItemDetail-CcmFzM_y.js","/assets/index-BFKG2VlZ.js"];
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
