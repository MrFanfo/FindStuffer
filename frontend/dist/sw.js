const CACHE = 'findstuff-shell-00e2512edcbfba34';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BjL_epLo.css","/assets/ProjectsView-C2vAd-wo.js","/assets/CompatibilityView-BoZgChKB.js","/assets/TargetDetailView-BU_ZnYZI.js","/assets/TargetEditor-CWXzKg7N.js","/assets/AnalyticsView-CmgoOz3R.js","/assets/TargetChoices-CkTrzk3Y.js","/assets/InventoryManagementView-DKlW2zJf.js","/assets/AIScanInboxView-C0sCyvP3.js","/assets/DefaultRulesView-BvxAcnyJ.js","/assets/OffCategoryMappingsView-Cn-5831f.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-D73JkTj2.js","/assets/useDeviceDraft-Dmv6M89W.js","/assets/extensionApi-JFCsrsjg.js","/assets/HierarchyPicker-Dn1HXW_H.js","/assets/PrintQueueDialog-CK2gWamW.js","/assets/DataView-e0jgwF1W.js","/assets/PlaceTrees-rwjfIriL.js","/assets/ManageView-CCEBDr1n.js","/assets/PlacesView-bxst34iN.js","/assets/ScanView-Be86ukPy.js","/assets/ProjectDetailView-COpBveI1.js","/assets/index-CZjLLUT2.js","/assets/index-BHMlt4eq.js","/assets/ItemDetail--Gs1NLQJ.js","/assets/index-BFKG2VlZ.js"];
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
