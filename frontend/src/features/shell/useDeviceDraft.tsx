import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readDeviceDraft, removeDeviceDraft, writeDeviceDraft } from "../../offline";

type DraftStatus = "loading" | "ready" | "saving" | "saved" | "error";
export function useDeviceDraft<T>(key: string, initial: T, restore?: (saved: T) => T) {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<DraftStatus>("loading");
  const [restored, setRestored] = useState(false);
  const revision = useRef(0);
  const loaded = useRef(false);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    let active = true;
    void readDeviceDraft<T>(key).then((saved) => {
      if (!active) return;
      if (saved !== null && revision.current === 0) {
        const next = restoreRef.current ? restoreRef.current(saved) : saved;
        latest.current = next; setValue(next); setRestored(true);
      }
      loaded.current = true; setStatus(saved === null ? "ready" : "saved");
    }).catch(() => { if (active) { loaded.current = true; setStatus("error"); } });
    return () => { active = false; };
  }, [key]);
  const set: Dispatch<SetStateAction<T>> = useCallback((update) => {
    const next = typeof update === "function" ? (update as (previous: T) => T)(latest.current) : update;
    latest.current = next; setValue(next);
    const current = ++revision.current;
    setStatus("saving");
    writes.current = writes.current.catch(() => undefined).then(() => writeDeviceDraft(key, next));
    void writes.current.then(() => { if (current === revision.current) setStatus("saved"); })
      .catch(() => { if (current === revision.current) setStatus("error"); });
  }, [key]);
  const clear = useCallback(async (next?: T) => {
    const current = ++revision.current;
    writes.current = writes.current.catch(() => undefined).then(() => removeDeviceDraft(key));
    try {
      await writes.current;
      if (current === revision.current) {
        const replacement = next === undefined ? initialRef.current : next;
        latest.current = replacement; setValue(replacement); setRestored(false); setStatus("ready");
      }
    } catch { setStatus("error"); }
  }, [key]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (status === "saving" || status === "error") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);
  return { value, set, status, restored, clear };
}

export function draftField<T, K extends keyof T>(draft: { value: T; set: Dispatch<SetStateAction<T>> }, key: K): [T[K], Dispatch<SetStateAction<T[K]>>] {
  return [draft.value[key], (update) => draft.set((previous) => ({ ...previous, [key]: typeof update === "function" ? (update as (value: T[K]) => T[K])(previous[key]) : update }))];
}

export function DraftNotice({ draft, onDiscard }: { draft: { status: DraftStatus; restored: boolean }; onDiscard?: () => void }) {
  if (draft.status === "ready" || draft.status === "loading") return null;
  return <div className={`draft-notice ${draft.status === "error" ? "error" : ""}`} role="status"><span>{draft.status === "error" ? "Draft could not be saved on this device. Keep this page open and try again." : draft.status === "saving" ? "Saving draft on this device…" : draft.restored ? "Your unfinished draft is restored · saved on this device" : "Draft saved on this device"}</span>{onDiscard && <button type="button" onClick={onDiscard}>Discard draft</button>}</div>;
}
