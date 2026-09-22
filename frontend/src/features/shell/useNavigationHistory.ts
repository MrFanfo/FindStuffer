import { useEffect, useRef } from "react";
import { api, type Item } from "../../api";

type Route = { view: string; item: string | null; location: string | null; category: number | null; mode: string; section: string | null; project: string | null; target: string | null };
export function useNavigationHistory(route: Route, apply: (route: Route, item: Item | null) => void, enabled: boolean) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const initialized = useRef(false);
  const applying = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let generation = 0;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const read = async () => {
      const current = ++generation;
      applying.current = true;
      const params = new URLSearchParams(window.location.search);
      const next: Route = { view: params.get('view') || (params.get('location') ? 'location' : params.get('item') ? 'inventory' : 'dashboard'), item: params.get('item'), location: params.get('location'), category: params.has('category') ? Number(params.get('category')) : null, mode: params.get('mode') || 'scan', section: params.get('section'), project: params.get('project'), target: params.get('target') };
      let item: Item | null = null;
      if (next.item) { try { item = await api.item(next.item); } catch { /* Offline details can be selected from the cache below. */ } }
      if (current !== generation) return;
      applyRef.current(next, item);
      const scroll = Number(window.history.state?.scroll || 0);
      const started = performance.now();
      const restoreScroll = () => {
        if (current !== generation) return;
        window.scrollTo({ top: scroll, behavior: "instant" });
        const pane = document.querySelector(".places-tree-pane");
        if (pane) pane.scrollTop = Number(window.history.state?.treeScroll || 0);
        if (Math.abs(window.scrollY - scroll) < 2 || performance.now() - started > 8000) applying.current = false;
        else window.setTimeout(restoreScroll, 80);
      };
      window.setTimeout(restoreScroll, 100);
    };
    if (!initialized.current) { initialized.current = true; void read(); }
    const pop = () => void read();
    // Browsers cap history.replaceState (Safari: 100 calls per 10s), so save the latest scroll at most every 400ms.
    let scrollTimer: number | null = null;
    const saveScroll = () => { scrollTimer = null; if (!applying.current) window.history.replaceState({ ...window.history.state, scroll: window.scrollY, treeScroll: document.querySelector('.places-tree-pane')?.scrollTop || 0 }, ''); };
    const scroll = () => { scrollTimer ??= window.setTimeout(saveScroll, 400); };
    window.addEventListener('popstate', pop);
    window.addEventListener('scroll', scroll, { passive: true, capture: true });
    return () => { generation++; if (scrollTimer !== null) window.clearTimeout(scrollTimer); window.history.scrollRestoration = previousScrollRestoration; window.removeEventListener('popstate', pop); window.removeEventListener('scroll', scroll, true); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || applying.current || !initialized.current) return;
    const params = new URLSearchParams(window.location.search);
    const keys = ["view", "item", "location", "category", "mode", "section", "project", "target"] as const;
    const current = keys.map((key) => params.get(key) || (key === "view" ? "dashboard" : key === "mode" ? "scan" : "")).join("|");
    const next = keys.map((key) => route[key] ?? "").join("|");
    if (current === next) return;
    Object.entries(route).forEach(([key, value]) => { if (value !== null && value !== '') params.set(key, String(value)); else params.delete(key); });
    window.history.pushState({ inventory: window.history.state?.inventory, treeScroll: window.history.state?.treeScroll || 0, scroll: route.item ? window.scrollY : 0 }, '', `?${params}`);
    if (!route.item && current.split('|')[0] !== route.view) window.scrollTo({ top: 0, behavior: "instant" });
  }, [enabled, route.view, route.item, route.location, route.category, route.mode, route.section, route.project, route.target]);
}
