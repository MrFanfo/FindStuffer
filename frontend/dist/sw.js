const CACHE = 'findstuff-shell-f0c2312055203378';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-BmJc6G9M.css","/assets/ProjectsView-BECIjfiV.js","/assets/CompatibilityView-BMNCCsCH.js","/assets/TargetDetailView-MsGiPCmE.js","/assets/TargetEditor-CLlILig4.js","/assets/AnalyticsView-V5TUX6ns.js","/assets/TargetChoices-AdQ0sPWj.js","/assets/InventoryManagementView-BArAcaCt.js","/assets/AIScanInboxView-ClBzb5-p.js","/assets/DefaultRulesView-DJo0oRtR.js","/assets/OffCategoryMappingsView-kQny2qIa.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-ByvUDUnb.js","/assets/useDeviceDraft-XmKggb8o.js","/assets/extensionApi-C7DL0lVQ.js","/assets/HierarchyPicker-Dwg499st.js","/assets/PrintQueueDialog-DAl5ft3U.js","/assets/DataView-DIHYkhFW.js","/assets/ManageView-CKrIgpiO.js","/assets/PlacesView-CUsnn6IQ.js","/assets/PlaceTrees-BpSAE5VB.js","/assets/ScanView-C2xnXgw1.js","/assets/ProjectDetailView-h4ueY06E.js","/assets/index-CZjLLUT2.js","/assets/index-BrIrRIGy.js","/assets/ItemDetail-BEf4M253.js","/assets/index-BFKG2VlZ.js"];
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
