export type Rect = { x: number; y: number; width: number; height: number };
export type CompositionMode =
  | "smart-crop"
  | "fit-background"
  | "split"
  | "manual-overlay";
export type FacecamPosition =
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type Quality = "auto" | "720p" | "1080p";
export type Layout = {
  mode: CompositionMode;
  gameplayCrop: Rect;
  facecamCrop: Rect;
  facecamOutput: Rect;
  focalX: number;
  focalY: number;
  zoom: number;
  cornerRadius: number;
  blur: number;
  facecamPosition: FacecamPosition;
};

export const MIN_REGION = 0.02;
export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export function normalizeRect(rect: Rect): Rect {
  const width = clamp(
    Number.isFinite(rect.width) ? rect.width : MIN_REGION,
    MIN_REGION,
    1,
  );
  const height = clamp(
    Number.isFinite(rect.height) ? rect.height : MIN_REGION,
    MIN_REGION,
    1,
  );
  return {
    x: clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 1 - width),
    y: clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 1 - height),
    width,
    height,
  };
}
export function validateRect(rect: Rect, name = "Crop"): string | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
    return `${name} region contains invalid values.`;
  if (rect.width < MIN_REGION || rect.height < MIN_REGION)
    return `${name} region is too small.`;
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  )
    return `${name} region must stay inside the source.`;
  return null;
}
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focalX = 0.5,
  focalY = 0.5,
  zoom = 1,
): Rect {
  if (
    [sourceWidth, sourceHeight, targetWidth, targetHeight].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  )
    throw new Error("Invalid source or output dimensions.");
  const sourceAspect = sourceWidth / sourceHeight,
    targetAspect = targetWidth / targetHeight;
  let width = sourceAspect > targetAspect ? targetAspect / sourceAspect : 1;
  let height = sourceAspect > targetAspect ? 1 : sourceAspect / targetAspect;
  width /= clamp(zoom, 1, 4);
  height /= clamp(zoom, 1, 4);
  return normalizeRect({
    x: clamp(focalX) - width / 2,
    y: clamp(focalY) - height / 2,
    width,
    height,
  });
}
export function containSize(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
  );
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}
export function facecamOutput(position: FacecamPosition): Rect {
  if (position === "top") return { x: 0, y: 0, width: 1, height: 0.3 };
  if (position === "bottom") return { x: 0, y: 0.7, width: 1, height: 0.3 };
  const left = position.endsWith("left"),
    top = position.startsWith("top");
  return {
    x: left ? 0.04 : 0.62,
    y: top ? 0.04 : 0.74,
    width: 0.34,
    height: 0.22,
  };
}
export const defaultLayout = (): Layout => ({
  mode: "smart-crop",
  gameplayCrop: { x: 0, y: 0, width: 1, height: 1 },
  facecamCrop: { x: 0.7, y: 0, width: 0.3, height: 0.3 },
  facecamOutput: facecamOutput("top-right"),
  focalX: 0.5,
  focalY: 0.5,
  zoom: 1,
  cornerRadius: 12,
  blur: 0,
  facecamPosition: "top-right",
});
export type Preset =
  | "gameplay-full"
  | "gameplay-top-facecam-bottom"
  | "facecam-top-gameplay-bottom"
  | "gameplay-facecam-corner"
  | "fit-background";
export function applyPreset(preset: Preset, current = defaultLayout()): Layout {
  const base = { ...current };
  if (preset === "gameplay-full")
    return {
      ...base,
      mode: "smart-crop",
      facecamOutput: { x: 0, y: 0, width: MIN_REGION, height: MIN_REGION },
    };
  if (preset === "fit-background")
    return { ...base, mode: "fit-background", blur: 0 };
  if (preset === "gameplay-top-facecam-bottom")
    return {
      ...base,
      mode: "split",
      facecamPosition: "bottom",
      facecamOutput: facecamOutput("bottom"),
    };
  if (preset === "facecam-top-gameplay-bottom")
    return {
      ...base,
      mode: "split",
      facecamPosition: "top",
      facecamOutput: facecamOutput("top"),
    };
  return {
    ...base,
    mode: "manual-overlay",
    facecamPosition: "top-right",
    facecamOutput: facecamOutput("top-right"),
  };
}
export function selectQuality(
  quality: Quality,
  sourceWidth: number,
  sourceHeight: number,
  deviceMemoryGb?: number,
) {
  const sourceLong = Math.max(sourceWidth, sourceHeight);
  if (quality === "720p")
    return {
      width: 720,
      height: 1280,
      warning: sourceLong < 1280 ? "Output may upscale the source." : undefined,
    };
  if (quality === "1080p")
    return {
      width: 1080,
      height: 1920,
      warning:
        sourceLong < 1920
          ? "1080p will upscale beyond source quality."
          : undefined,
    };
  const use1080 =
    sourceLong >= 1920 && (deviceMemoryGb === undefined || deviceMemoryGb >= 4);
  return {
    width: use1080 ? 1080 : 720,
    height: use1080 ? 1920 : 1280,
    warning: sourceLong < 1280 ? "Output may upscale the source." : undefined,
  };
}
export function validateLayout(layout: Layout): string | null {
  if (!Number.isFinite(layout.focalX)) return "Focal X must be a finite number.";
  if (!Number.isFinite(layout.focalY)) return "Focal Y must be a finite number.";
  if (!Number.isFinite(layout.zoom) || layout.zoom <= 0) return "Zoom must be a positive finite number.";
  return (
    validateRect(layout.gameplayCrop, "Gameplay") ||
    (layout.mode === "split" || layout.mode === "manual-overlay"
      ? validateRect(layout.facecamCrop, "Facecam") ||
        validateRect(layout.facecamOutput, "Facecam output")
      : null)
  );
}
export function normalizeLayout(layout: Layout): Layout {
  const usesFacecam = layout.mode === "split" || layout.mode === "manual-overlay";
  return { ...layout, gameplayCrop: normalizeRect(layout.gameplayCrop), facecamCrop: usesFacecam ? normalizeRect(layout.facecamCrop) : defaultLayout().facecamCrop, facecamOutput: usesFacecam ? normalizeRect(layout.facecamOutput) : defaultLayout().facecamOutput, focalX: clamp(Number.isFinite(layout.focalX) ? layout.focalX : .5), focalY: clamp(Number.isFinite(layout.focalY) ? layout.focalY : .5), zoom: clamp(Number.isFinite(layout.zoom) ? layout.zoom : 1, 1, 4), cornerRadius: Math.max(0, Number.isFinite(layout.cornerRadius) ? layout.cornerRadius : 0), blur: Math.max(0, Number.isFinite(layout.blur) ? layout.blur : 0) };
}
