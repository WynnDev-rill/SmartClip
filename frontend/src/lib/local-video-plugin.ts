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
  cancelExport(): Promise<void>;
  openMedia(options: { uri: string }): Promise<void>;
  shareMedia(options: { uri: string; filename: string }): Promise<void>;
  addListener(
    event: "exportProgress",
    callback: (event: { state: "preparing" | "trimming" | "saving" | "completed"; progress?: number }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

// Capacitor warns and returns the existing proxy when a plugin name is registered
// repeatedly, so keep the single LocalVideoPicker registration in this module.
export const LocalVideoPlugin = registerPlugin<LocalVideoPlugin>("LocalVideoPicker");
