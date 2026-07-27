import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const isDevTunnel = window.location.hostname.endsWith(".devtunnels.ms");
const isPerfRun = new URLSearchParams(window.location.search).has("perf");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
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
        const update = () => void registration.update();
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(update, { timeout: 5000 });
        } else {
          globalThis.setTimeout(update, 1200);
        }
      });
    });
  }
}
