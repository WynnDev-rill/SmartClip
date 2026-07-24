import { describe, expect, it } from "vitest";
import {
  applyPreset,
  coverCrop,
  defaultLayout,
  facecamOutput,
  normalizeRect,
  selectQuality,
  validateLayout,
  validateRect,
} from "./layout";
describe("vertical composition math", () => {
  it("normalizes crops into bounds and prevents zero size", () => {
    expect(normalizeRect({ x: -2, y: 0.99, width: 0, height: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 0.02,
      height: 1,
    });
    expect(validateRect({ x: 0, y: 0, width: 0, height: 1 })).toMatch(/small/);
  });
  it("calculates aspect-safe smart crop focal positions", () => {
    const crop = coverCrop(1920, 1080, 1080, 1920, 1, 0.5);
    expect(crop.width).toBeCloseTo(0.3164, 3);
    expect(crop.x + crop.width).toBe(1);
    expect(crop.height).toBe(1);
  });
  it("applies every preset", () => {
    expect(applyPreset("gameplay-full").mode).toBe("smart-crop");
    expect(applyPreset("fit-background").mode).toBe("fit-background");
    expect(applyPreset("gameplay-top-facecam-bottom").facecamOutput.y).toBe(
      0.7,
    );
    expect(applyPreset("facecam-top-gameplay-bottom").facecamOutput.y).toBe(0);
    expect(applyPreset("gameplay-facecam-corner").mode).toBe("manual-overlay");
  });
  it("selects quality without silently forcing upscale", () => {
    expect(selectQuality("auto", 3840, 2160, 8).width).toBe(1080);
    expect(selectQuality("auto", 1280, 720, 8).width).toBe(720);
    expect(selectQuality("1080p", 1280, 720).warning).toMatch(/upscale/);
  });
  it("positions all facecam choices within output", () => {
    for (const p of [
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const)
      expect(validateRect(facecamOutput(p))).toBeNull();
  });
  it("rejects invalid active regions", () => {
    expect(
      validateLayout({
        ...defaultLayout(),
        mode: "manual-overlay",
        facecamCrop: { x: 0.9, y: 0, width: 0.2, height: 0.2 },
      }),
    ).toMatch(/inside/);
  });
});
