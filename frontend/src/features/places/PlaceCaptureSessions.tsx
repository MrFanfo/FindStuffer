import { useEffect, useRef, useState } from "react";
import { api, type Item, type LocationNode } from "../../api";
import { Icon } from "../../components/Icon";
import { categoryLabel } from "../../domain/inventory";
import { uid } from "../inventory/formula";

type LocalAIScan = {
  id: string;
  preview: string;
  status: "uploading" | "queued" | "error";
  error?: string;
};

export function AIScanSession({ location, onClose }: {
  location: LocationNode;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const pulseTimerRef = useRef<number | null>(null);
  const [scans, setScans] = useState<LocalAIScan[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState(false);
  const uploading = scans.filter((entry) => entry.status === "uploading").length;
  const queued = scans.filter((entry) => entry.status === "queued").length;

  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        if (!stopped) setError("Live camera is unavailable. You can still use your phone’s camera below.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Live camera is unavailable. You can still use your phone’s camera below.");
    } else {
      void startCamera();
    }
    return () => {
      stopped = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewsRef.current.clear();
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  function flash() {
    setPulse(true);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setPulse(false);
      pulseTimerRef.current = null;
    }, 260);
  }

  function queue(blob: Blob, width?: number, height?: number, originalSizeBytes?: number) {
    const id = uid("ai-scan");
    const preview = URL.createObjectURL(blob);
    previewsRef.current.add(preview);
    setScans((current) => [{ id, preview, status: "uploading" as const }, ...current].slice(0, 12));
    flash();
    void api.createAiScan(location.public_id, blob, width, height, originalSizeBytes).then(() => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? { ...entry, status: "queued" } : entry));
    }).catch((reason) => {
      if (!mountedRef.current) return;
      setScans((current) => current.map((entry) => entry.id === id ? {
        ...entry,
        status: "error",
        error: reason instanceof Error ? reason.message : "Upload failed",
      } : entry));
    });
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = Math.max(0, (video.videoWidth - sourceSize) / 2);
    const sourceY = Math.max(0, (video.videoHeight - sourceSize) / 2);
    const width = Math.max(1, Math.min(1280, sourceSize));
    const height = width;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(
      video,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.78),
    );
    queue(blob, width, height, blob.size);
  }

  async function choosePhoto(file: File) {
    try {
      const resized = await prepareAiScanPhoto(file);
      queue(resized.blob, resized.width, resized.height, file.size);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare photo");
    }
  }

  return (
    <div className="quick-photo-backdrop ai-scan-backdrop" role="dialog" aria-modal="true" aria-label="AI scan mode">
      <section className="quick-photo-sheet ai-scan-sheet">
        <button className="icon-button ai-scan-close" onClick={onClose} aria-label="Close AI scan mode"><Icon name="close" /></button>
        <div className={`quick-photo-camera ai-scan-camera ${pulse ? "pulsing" : ""}`}>
          <video ref={videoRef} playsInline muted />
          {!cameraReady && <div className="ai-camera-placeholder"><Icon name="camera" size={38} /><strong>{error ? "Camera unavailable" : "Opening camera…"}</strong></div>}
          <div className="ai-scan-target">
            <div className="ai-scan-frame" aria-hidden="true"><span>One item</span></div>
            <button className="primary ai-overlay-shutter" disabled={!cameraReady} onClick={() => void snap()} aria-label="Photograph item"><Icon name="camera" size={22} />Snap Item</button>
          </div>
        </div>
        {error && <div className="inline-alert">{error}</div>}
        <div className="ai-scan-status"><div><strong>{queued}</strong><span>sent to Inbox</span></div><div><strong>{uploading}</strong><span>{uploading === 1 ? "Uploading 1 photo" : `Uploading ${uploading} photos`}</span></div>{uploading > 0 && <small>AI processing continues in the background.</small>}</div>
        {scans.length > 0 && <div className="ai-scan-strip">{scans.map((entry) => <div className={entry.status} key={entry.id}><img src={entry.preview} alt="AI scan capture" /><span>{entry.status === "uploading" ? "Sending" : entry.status === "queued" ? "Queued" : "Failed"}</span>{entry.error && <small>{entry.error}</small>}</div>)}</div>}
        <div className="ai-scan-controls"><label className="secondary button-with-icon"><Icon name="camera" size={18} />Choose photo<input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void choosePhoto(file); }} /></label><button onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}

export function QuickPhotoSession({ title, items, onDone, onClose }: {
  title: string;
  items: Item[];
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState("");
  const remaining = items.filter((item) => !captured.has(item.public_id) && !skipped.has(item.public_id));
  const current = remaining[index] || remaining[0] || null;
  const upcoming = remaining.filter((item) => item.public_id !== current?.public_id).slice(0, 3);
  useEffect(() => {
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (!stopped) setError("Camera access is blocked or unavailable.");
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) setError("Camera is not available in this browser.");
    else void startCamera();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);
  async function finish() {
    await onDone();
  }
  function videoCropRect(video: HTMLVideoElement) {
    const frame = frameRef.current;
    if (!frame) {
      const side = Math.min(video.videoWidth, video.videoHeight);
      return { sx: (video.videoWidth - side) / 2, sy: (video.videoHeight - side) / 2, side };
    }
    const videoBox = video.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const renderedScale = Math.max(videoBox.width / video.videoWidth, videoBox.height / video.videoHeight);
    const renderedWidth = video.videoWidth * renderedScale;
    const renderedHeight = video.videoHeight * renderedScale;
    const offsetX = videoBox.left + (videoBox.width - renderedWidth) / 2;
    const offsetY = videoBox.top + (videoBox.height - renderedHeight) / 2;
    const sx = (frameBox.left - offsetX) / renderedScale;
    const sy = (frameBox.top - offsetY) / renderedScale;
    const side = frameBox.width / renderedScale;
    const clampedSide = Math.max(1, Math.min(side, video.videoWidth, video.videoHeight));
    return {
      sx: Math.max(0, Math.min(video.videoWidth - clampedSide, sx)),
      sy: Math.max(0, Math.min(video.videoHeight - clampedSide, sy)),
      side: clampedSide,
    };
  }
  function showPulse(message: string) {
    setPulse(message);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      setPulse("");
      pulseTimerRef.current = null;
    }, 520);
  }
  async function skipCurrent() {
    if (!current || busy) return;
    showPulse("Skipped");
    setSkipped((currentSet) => new Set(currentSet).add(current.public_id));
    setIndex(0);
    if (remaining.length <= 1) await finish();
  }
  async function capture() {
    if (!current || !videoRef.current || busy) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;
    setBusy(true);
    setError("");
    showPulse("Captured");
    try {
      const crop = videoCropRect(video);
      const scale = Math.min(1, 1200 / crop.side);
      const width = Math.max(1, Math.round(crop.side * scale));
      const height = width;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(video, crop.sx, crop.sy, crop.side, crop.side, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture photo")), "image/jpeg", 0.86),
      );
      await api.uploadPhoto(current, blob, width, height);
      showPulse("Uploaded");
      setCaptured((currentSet) => new Set(currentSet).add(current.public_id));
      setIndex(0);
      if (remaining.length <= 1) await finish();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo upload failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-photo-backdrop" role="dialog" aria-modal="true" aria-label="Quick photo mode">
      <section className="quick-photo-sheet">
        <header><div><p className="eyebrow">QUICK PHOTOS</p><h2>{title}</h2><span>{current ? `${captured.size + skipped.size + 1} of ${items.length}` : "All photos done"}</span></div><button className="icon-button" onClick={onClose} aria-label="Close quick photo mode"><Icon name="close" /></button></header>
        <div className={`quick-photo-camera ${pulse ? "pulsing" : ""}`}><video ref={videoRef} playsInline muted />{current && <div ref={frameRef} className="thumbnail-frame" aria-hidden="true"><span>Thumbnail crop</span></div>}{pulse && <div className="quick-photo-pulse"><Icon name={pulse === "Skipped" ? "chevron" : "check"} size={24} /><span>{pulse}</span></div>}{!current && <div><Icon name="check" size={38} /><strong>All set</strong></div>}</div>
        {current ? <div className="quick-photo-item"><strong>{current.name}</strong><small>{categoryLabel(current) || "Uncategorised"} · {current.location_path}</small></div> : <button className="primary wide" onClick={() => void finish()}>Done</button>}
        {upcoming.length > 0 && <div className="quick-photo-queue"><strong>Next</strong>{upcoming.map((item) => <span key={item.public_id}>{item.name}</span>)}</div>}
        {error && <div className="inline-alert">{error}</div>}
        {current && <div className="quick-photo-controls"><button className="secondary" disabled={busy} onClick={() => void skipCurrent()}>Skip</button><button className="primary quick-shutter" disabled={busy || Boolean(error)} onClick={() => void capture()}><Icon name="camera" size={22} />{busy ? "Uploading..." : "Take photo"}</button></div>}
      </section>
    </div>
  );
}

async function prepareAiScanPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const bitmap = await createImageBitmap(file);
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - sourceSize) / 2);
    const sourceY = Math.max(0, (bitmap.height - sourceSize) / 2);
    const size = Math.max(1, Math.min(1280, sourceSize));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare photo");
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("Could not prepare photo")),
        "image/jpeg",
        0.78,
      ),
    );
    return { blob, width: size, height: size };
  } finally {
    bitmap.close();
  }
}
