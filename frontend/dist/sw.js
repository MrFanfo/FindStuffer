const CACHE = 'findstuff-shell-f8250d7ec51f6908';
const SHELL = ["/","/manifest.webmanifest","/icon.svg","/assets/index-CSd7U8j5.css","/assets/ProjectsView-BelJcjxW.js","/assets/CompatibilityView-T7ivcE15.js","/assets/TargetDetailView-Drt6ZZAX.js","/assets/TargetEditor-C3mFeRae.js","/assets/AnalyticsView-DJNZSUNZ.js","/assets/TargetChoices-Cn-6_Wnl.js","/assets/InventoryManagementView-C-Iw0-eG.js","/assets/AIScanInboxView-DWCkDv8I.js","/assets/DefaultRulesView-DP0o3SRr.js","/assets/OffCategoryMappingsView-CO04pPsi.js","/assets/strictJson-CiftuHHs.js","/assets/CategoryValueInputs-BvGPnyAg.js","/assets/useDeviceDraft-DOxrdijF.js","/assets/extensionApi-C0ZWvk9O.js","/assets/HierarchyPicker-D7C_aqfe.js","/assets/PrintQueueDialog-2bMcq1Ka.js","/assets/DataView-BQIZE5eu.js","/assets/ManageView-CNiLUUqS.js","/assets/PlacesView-Bc2eIfKH.js","/assets/PlaceTrees-jQK0h4IH.js","/assets/ScanView-CICn9UG-.js","/assets/ProjectDetailView-GPipO7AK.js","/assets/index-CZjLLUT2.js","/assets/index-DkLfl_Rm.js","/assets/ItemDetail-C02tgaef.js","/assets/index-BFKG2VlZ.js"];
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
