import { registerPlugin } from "@capacitor/core";

export interface LocalVideoPlugin {
  chooseVideo(): Promise<{
    filename: string;
    fileSize: number;
    duration: number;
    width: number;
    height: number;
    resolution: string;
    mimeType: string;
    uri: string;
  }>;
  exportClip(options: { uri: string; startMs: number; endMs: number }): Promise<{
    filename: string;
    duration: number;
    fileSize: number;
    uri: string;
    location: string;
  }>;
  exportComposition(options: { uri: string; startMs: number; endMs: number; layout: unknown; quality: "auto" | "720p" | "1080p"; outputWidth: number; outputHeight: number }): Promise<{
    filename: string; duration: number; fileSize: number; uri: string; location: string; width: number; height: number;
  }>;
  cancelExport(): Promise<void>;
  analyzeVideo(options: { uri: string; intervalMs?: number; maxDurationMs?: number }): Promise<{
    points: Array<{ timeMs: number; audio: number; motion: number; scene: number }>;
    availability: { audio: boolean; motion: boolean; scene: boolean };
  }>;
  cancelAnalysis(): Promise<void>;
  openMedia(options: { uri: string }): Promise<void>;
  shareMedia(options: { uri: string; filename: string }): Promise<void>;
  addListener(
    event: "exportProgress",
    callback: (event: { state: "preparing" | "trimming" | "rendering" | "saving" | "completed"; progress?: number }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(
    event: "analysisProgress",
    callback: (event: { state: "preparing" | "analyzing audio" | "analyzing motion" | "finding boundaries" | "scoring candidates" | "completed" | "cancelled" | "failed" }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

// Capacitor warns and returns the existing proxy when a plugin name is registered
// repeatedly, so keep the single LocalVideoPicker registration in this module.
export const LocalVideoPlugin = registerPlugin<LocalVideoPlugin>("LocalVideoPicker");
