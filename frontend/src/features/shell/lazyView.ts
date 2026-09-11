import { lazy, type ComponentType } from "react";

const RELOADED = "findstuff-chunk-reload";
const ATTEMPTS = 3;

function flag(read: true): boolean;
function flag(read: false, value?: boolean): void;
function flag(read: boolean, value = false) {
  // Private windows and blocked site data make sessionStorage throw on access.
  try {
    if (read) return sessionStorage.getItem(RELOADED) === "1";
    if (value) sessionStorage.setItem(RELOADED, "1");
    else sessionStorage.removeItem(RELOADED);
  } catch {
    return false;
  }
}

/**
 * Wrap a view's dynamic import so a single failed chunk never strands the
 * screen. Publishing new hashed assets, a dropped Wi-Fi frame or a Pi busy
 * serving photos can all reject one import, and React.lazy caches that
 * rejection for the life of the page: without this the section stays broken
 * until a manual reload. Retry briefly, then reload once to pick up the
 * current index.html, and only surface the error screen if that also fails.
 */
export function lazyView<Props>(load: () => Promise<ComponentType<Props>>) {
  return lazy(async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const component = await load();
        flag(false);
        return { default: component };
      } catch (error) {
        if (attempt < ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          continue;
        }
        if (flag(true)) throw error;
        flag(false, true);
        location.reload();
        // Hold the Suspense fallback rather than flashing an error mid-reload.
        return new Promise<never>(() => {});
      }
    }
  });
}
