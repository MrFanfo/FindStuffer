import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "../../components/Icon";

type NumericRange = { min: number; max: number; step?: number };
type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  pointsOfInterest?: unknown;
  torch?: boolean;
  zoom?: NumericRange;
};
type CameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
  torch?: boolean;
  zoom?: number;
};
type CameraFeatures = {
  continuousFocus: boolean;
  tapFocus: boolean;
  tapFocusMode: "single-shot" | "manual" | null;
  torch: boolean;
  zoom: NumericRange | null;
};

const EMPTY_FEATURES: CameraFeatures = {
  continuousFocus: false,
  tapFocus: false,
  tapFocusMode: null,
  torch: false,
  zoom: null,
};

export function cameraFeatures(capabilities: CameraCapabilities): CameraFeatures {
  const focusModes = capabilities.focusMode || [];
  const zoom = capabilities.zoom;
  const tapFocusMode = focusModes.includes("single-shot")
    ? "single-shot"
    : focusModes.includes("manual") ? "manual" : null;
  return {
    continuousFocus: focusModes.includes("continuous"),
    tapFocus: Boolean(capabilities.pointsOfInterest) && tapFocusMode !== null,
    tapFocusMode,
    torch: capabilities.torch === true,
    zoom: zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.max > zoom.min
      ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 }
      : null,
  };
}

async function applyCameraConstraints(track: MediaStreamTrack, values: CameraConstraintSet) {
  await track.applyConstraints({ advanced: [values] });
}

function touchDistance(touches: ReactTouchEvent["touches"]) {
  if (touches.length < 2) return 0;
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

export function CameraScanner({ videoRef, onCode }: {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  onCode: (code: string) => Promise<boolean | void>;
}) {
  const recentCodes = useRef<Map<string, number>>(new Map());
  const onCodeRef = useRef(onCode);
  const flashTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(1);
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(true);
  const [flashCode, setFlashCode] = useState("");
  const [features, setFeatures] = useState<CameraFeatures>(EMPTY_FEATURES);
  const [featuresReady, setFeaturesReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [notice, setNotice] = useState("");
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2600);
  }

  async function setCameraZoom(nextValue: number) {
    const track = trackRef.current;
    const range = features.zoom;
    if (!track || !range) return;
    const next = Math.min(range.max, Math.max(range.min, nextValue));
    zoomRef.current = next;
    setZoom(next);
    try {
      await applyCameraConstraints(track, { zoom: next });
    } catch {
      showNotice("Zoom is exposed by this camera but Safari could not change it.");
    }
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track || !features.torch) return;
    const next = !torch;
    try {
      await applyCameraConstraints(track, { torch: next });
      setTorch(next);
    } catch {
      showNotice("The flashlight is not available in this Safari camera session.");
    }
  }

  async function focusCamera(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || event.pointerType === "touch" && pinchRef.current) return;
    const track = trackRef.current;
    if (!track || !features.tapFocus) {
      showNotice("Tap-to-focus is not exposed by Safari on this camera. Continuous autofocus is still active when available.");
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setFocusPoint({ x, y });
    try {
      await applyCameraConstraints(track, {
        focusMode: features.tapFocusMode || "single-shot",
        pointsOfInterest: [{ x, y }],
      });
      window.setTimeout(() => setFocusPoint(null), 850);
    } catch {
      setFocusPoint(null);
      showNotice("Safari did not accept manual focus here. Continuous autofocus remains enabled.");
    }
  }

  function startPinch(event: ReactTouchEvent<HTMLDivElement>) {
    const distance = touchDistance(event.touches);
    if (distance && features.zoom) pinchRef.current = { distance, zoom: zoomRef.current };
  }

  function updatePinch(event: ReactTouchEvent<HTMLDivElement>) {
    const pinch = pinchRef.current;
    const distance = touchDistance(event.touches);
    if (!pinch || !distance || !features.zoom) return;
    event.preventDefault();
    const span = features.zoom.max - features.zoom.min;
    void setCameraZoom(pinch.zoom + ((distance / pinch.distance) - 1) * span * 0.55);
  }

  useEffect(() => {
    if (!active) return;
    if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
      setAvailable(false);
      setActive(false);
      return;
    }
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    void (async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (stopped || !videoRef.current) return;
      const hints = new Map();
      // QR is first so location/item labels are attempted before retail formats.
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 90,
        delayBetweenScanSuccess: 220,
      });
      controls = await reader.decodeFromConstraints({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }, videoRef.current, (result, _error, nextControls) => {
        const text = result?.getText().trim();
        if (!text || stopped) return;
        const now = Date.now();
        if (now - (recentCodes.current.get(text) || 0) < 1200) return;
        recentCodes.current.set(text, now);
        setFlashCode(text);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashCode(""), 650);
        void onCodeRef.current(text).then((shouldContinue) => {
          if (shouldContinue === false && !stopped) {
            stopped = true;
            nextControls.stop();
            setActive(false);
          }
        });
      });
      const stream = videoRef.current.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks()[0] || null;
      trackRef.current = track;
      if (track) {
        const nextFeatures = cameraFeatures(track.getCapabilities() as CameraCapabilities);
        setFeatures(nextFeatures);
        const initialZoom = track.getSettings().zoom || nextFeatures.zoom?.min || 1;
        zoomRef.current = initialZoom;
        setZoom(initialZoom);
        if (nextFeatures.continuousFocus) {
          await applyCameraConstraints(track, { focusMode: "continuous" }).catch(() => undefined);
        }
      }
      setFeaturesReady(true);
      setAvailable(true);
    })().catch(() => {
      if (!stopped) {
        setAvailable(false);
        setActive(false);
      }
    });
    return () => {
      stopped = true;
      controls?.stop();
      trackRef.current = null;
      setFeatures(EMPTY_FEATURES);
      setFeaturesReady(false);
      setTorch(false);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, [active, videoRef]);

  return (
    <div className={`camera-box ${active ? "active" : ""} ${flashCode ? "recognized" : ""}`}>
      <div
        className="camera-viewport"
        onPointerUp={(event) => void focusCamera(event)}
        onTouchStart={startPinch}
        onTouchMove={updatePinch}
        onTouchEnd={() => { pinchRef.current = null; }}
      >
        <video ref={videoRef} playsInline muted />
        {!active && <div className="camera-idle"><span><Icon name="scan" size={38} /></span><strong>Ready to scan</strong><small>Keep the code inside the frame</small></div>}
        {flashCode && <div className="scan-success"><Icon name="check" size={24} /><span>Recognized</span></div>}
        <div className="scan-frame" aria-hidden="true" />
        {focusPoint && <span className="camera-focus-ring" style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }} aria-hidden="true" />}
        {notice && <small className="camera-capability-notice" role="status">{notice}</small>}
      </div>
      <div className="camera-live-controls">
        {active && features.zoom && <label className="camera-zoom"><Icon name="search" size={15} /><input aria-label="Camera zoom" type="range" min={features.zoom.min} max={features.zoom.max} step={features.zoom.step || 0.1} value={zoom} onChange={(event) => void setCameraZoom(Number(event.target.value))} /><output>{zoom.toFixed(1)}×</output></label>}
        {active && features.torch && <button type="button" className={torch ? "camera-tool active" : "camera-tool"} onClick={() => void toggleTorch()} aria-pressed={torch}><Icon name="spark" size={16} />Flashlight</button>}
        <button type="button" className={active ? "camera-stop" : "secondary button-with-icon"} onClick={() => { setAvailable(true); setActive(!active); }}>
          {active ? <><Icon name="close" size={17} />End session</> : <><Icon name="camera" size={17} />Open camera</>}
        </button>
      </div>
      {active && <small className="camera-focus-support">{!featuresReady ? "Preparing camera controls…" : features.tapFocus ? "Tap the code to focus" : features.continuousFocus ? "Continuous autofocus active · manual tap focus unavailable" : "Manual focus is not available in this browser"}</small>}
      {!available && <small className="camera-warning">Camera access is blocked or unavailable. Try Snap code, or allow camera access in Safari.</small>}
    </div>
  );
}
