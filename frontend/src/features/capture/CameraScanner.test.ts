import { describe, expect, it } from "vitest";

import { cameraFeatures } from "./CameraScanner";

describe("cameraFeatures", () => {
  it("exposes focus, zoom, and torch controls only when the camera reports them", () => {
    expect(cameraFeatures({
      focusMode: ["continuous", "single-shot"],
      pointsOfInterest: true,
      torch: true,
      zoom: { min: 1, max: 5, step: 0.5 },
    })).toEqual({
      continuousFocus: true,
      tapFocus: true,
      tapFocusMode: "single-shot",
      torch: true,
      zoom: { min: 1, max: 5, step: 0.5 },
    });
  });

  it("keeps unsupported iPhone camera controls hidden", () => {
    expect(cameraFeatures({ facingMode: ["environment"] })).toEqual({
      continuousFocus: false,
      tapFocus: false,
      tapFocusMode: null,
      torch: false,
      zoom: null,
    });
  });
});
