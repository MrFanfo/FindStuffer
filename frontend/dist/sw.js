const CACHE = 'findstuff-shell-7e0e6bb13e7833b7';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CQYucfm-.css","/assets/ProjectsView-DWPLlYC4.js","/assets/CompatibilityView-C9ZY98t4.js","/assets/TargetDetailView-5qB4x2He.js","/assets/TargetEditor-DacV6oeq.js","/assets/AnalyticsView-B2lkgYlJ.js","/assets/TargetChoices-DJD3b3eK.js","/assets/InventoryManagementView-CzozpSS7.js","/assets/AIScanInboxView-ByT1m_XX.js","/assets/DefaultRulesView-DN8qGn7s.js","/assets/OffCategoryMappingsView-DC5015h9.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-iYI_oRwV.js","/assets/useDeviceDraft-CAHIkcS5.js","/assets/extensionApi-Dg5dekPA.js","/assets/HierarchyPicker-ria6fvKh.js","/assets/PrintQueueDialog-DrpZQmRm.js","/assets/DataView-D75CR4yB.js","/assets/ManageView-BJULxaDW.js","/assets/PlacesView-CChD7xoJ.js","/assets/PlaceTrees-C9mej9gM.js","/assets/ScanView-BRk3mHQ_.js","/assets/ProjectDetailView-BXPpMXmu.js","/assets/index-CZjLLUT2.js","/assets/index-D4dzgd9g.js","/assets/ItemDetail-6vsR5-hb.js","/assets/index-BFKG2VlZ.js"];
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
