# Findstuff 1.7.5

Findstuff 1.7.5 improves live QR and barcode scanning on iPhone and other
mobile browsers with capability-aware camera controls.

## Improved

- Requests the rear camera at a high preferred resolution and enables
  continuous autofocus when the browser exposes it.
- Adds tap-to-focus with a visible focus target on supported cameras.
- Adds pinch zoom and a zoom slider when camera zoom is available.
- Adds a flashlight toggle when the active camera exposes torch control.
- Enlarges the scanning target and gives QR codes first priority.
- Reduces the decoding retry interval for faster recognition.
- Clearly reports whether tap focus, continuous focus, or no manual camera
  focus control is available in the current Safari session.

Unsupported camera controls stay hidden, and failed camera constraint changes
show a useful explanation instead of interrupting scanning.

## Verification

- Added tests for full and limited mobile camera capability sets.
- Passed frontend unit tests, strict TypeScript checks, architecture limits,
  mobile/desktop end-to-end flows, production build, and bundle budgets.
