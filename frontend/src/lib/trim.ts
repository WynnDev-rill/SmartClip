import { LocalVideoPlugin } from "./local-video-plugin";

export const MIN_CLIP_DURATION = 1;

export type TrimRange = { start: number; end: number };
export type ExportState = "idle" | "preparing" | "trimming" | "rendering" | "saving" | "completed" | "failed" | "cancelled";
export type ExportResult = { filename: string; duration: number; fileSize: number; uri: string; location: string; width?: number; height?: number };
export type ExportProgress = { state: Exclude<ExportState, "idle" | "failed" | "cancelled">; progress?: number };

export const NativeEditor = LocalVideoPlugin;

export function validateTrim(range: TrimRange, sourceDuration: number): string | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > sourceDuration || range.end <= range.start) return "Choose a start and end within the source duration.";
  if (range.end - range.start < MIN_CLIP_DURATION) return "The clip must be at least 1 second long.";
  return null;
}

export function presetRange(seconds: number | "full", duration: number): TrimRange {
  return { start: 0, end: seconds === "full" ? duration : Math.min(seconds, duration) };
}
export function trimPayload(range: TrimRange) {
  return { startMs: Math.round(range.start * 1000), endMs: Math.round(range.end * 1000) };
}

export async function exportNativeClip(uri: string, range: TrimRange) {
  return NativeEditor.exportClip({ uri, ...trimPayload(range) });
}
