import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DialogManager } from "./components/DialogManager";
import App from "./App";
import "./styles.css";

const isDevTunnel = window.location.hostname.endsWith(".devtunnels.ms");
const isPerfRun = new URLSearchParams(window.location.search).has("perf");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DialogManager /><ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator && !isPerfRun) {
  if (isDevTunnel) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
  } else {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/manifest.webmanifest";
    document.head.appendChild(manifest);

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        const offerUpdate = () => {
          if (!registration.waiting || !navigator.serviceWorker.controller) return;
          const banner = document.createElement("button");
          banner.className = "update-ready";
          banner.textContent = "Findstuff updated · Reload when ready";
          banner.onclick = () => {
            navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
            registration.waiting?.postMessage("ACTIVATE_UPDATE");
          };
          document.body.appendChild(banner);
        };
        offerUpdate();
        registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", offerUpdate));
        const update = () => void registration.update();
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(update, { timeout: 5000 });
        } else {
          globalThis.setTimeout(update, 1200);
        }
      }).catch((error: unknown) => console.warn("Offline shell could not be installed", error));
    });
  }
}
