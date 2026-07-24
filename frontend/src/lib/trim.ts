import { registerPlugin } from "@capacitor/core";

export const MIN_CLIP_DURATION = 1;

export type TrimRange = { start: number; end: number };
export type ExportState = "idle" | "preparing" | "trimming" | "saving" | "completed" | "failed" | "cancelled";
export type ExportResult = { filename: string; duration: number; fileSize: number; uri: string; location: string };
export type ExportProgress = { state: Exclude<ExportState, "idle" | "failed" | "cancelled">; progress?: number };

interface LocalVideoPickerPlugin {
  exportClip(options: { uri: string; startMs: number; endMs: number }): Promise<ExportResult>;
  cancelExport(): Promise<void>;
  openMedia(options: { uri: string }): Promise<void>;
  shareMedia(options: { uri: string; filename: string }): Promise<void>;
  addListener(event: "exportProgress", callback: (event: ExportProgress) => void): Promise<{ remove(): Promise<void> }>;
}

export const NativeEditor = registerPlugin<LocalVideoPickerPlugin>("LocalVideoPicker");

export function validateTrim(range: TrimRange, sourceDuration: number): string | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end > sourceDuration || range.end <= range.start) return "Choose a start and end within the source duration.";
  if (range.end - range.start < MIN_CLIP_DURATION) return "The clip must be at least 1 second long.";
  return null;
}

export function presetRange(seconds: number | "full", duration: number): TrimRange {
  return { start: 0, end: seconds === "full" ? duration : Math.min(seconds, duration) };
}

export async function exportNativeClip(uri: string, range: TrimRange) {
  return NativeEditor.exportClip({ uri, startMs: Math.round(range.start * 1000), endMs: Math.round(range.end * 1000) });
}
