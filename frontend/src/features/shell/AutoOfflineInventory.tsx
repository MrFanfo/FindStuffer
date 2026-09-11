import { useEffect } from 'react';
import { downloadOfflineInventory } from '../../offline';

export function AutoOfflineInventory({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (navigator.onLine && document.visibilityState !== 'hidden') {
        void downloadOfflineInventory(() => undefined).catch(() => undefined);
      }
    };
    refresh();
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);
  return null;
}
