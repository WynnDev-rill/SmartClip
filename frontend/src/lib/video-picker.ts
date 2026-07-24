import { Capacitor, registerPlugin } from "@capacitor/core";

export const ACCEPTED_EXTENSIONS = ["mp4", "mov", "mkv", "webm"] as const;

export interface LocalVideoMetadata {
  filename: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  resolution: string;
  mimeType: string;
  uri: string;
  orientation: "Portrait" | "Landscape" | "Square";
  source: "Android native" | "Browser preview";
}

interface NativeVideoPickerPlugin {
  chooseVideo(): Promise<Omit<LocalVideoMetadata, "orientation" | "source">>;
}

const NativeVideoPicker = registerPlugin<NativeVideoPickerPlugin>("LocalVideoPicker");

export const isSupportedVideo = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number]);
};

const complete = (
  value: Omit<LocalVideoMetadata, "orientation" | "source">,
  source: LocalVideoMetadata["source"],
): LocalVideoMetadata => ({
  ...value,
  resolution: resolutionLabel(value.width, value.height),
  orientation: value.width === value.height ? "Square" : value.width > value.height ? "Landscape" : "Portrait",
  source,
});

function resolutionLabel(width: number, height: number) {
  const shortEdge = Math.min(width, height);
  if (shortEdge >= 2160) return "Ultra HD (2160p)";
  if (shortEdge >= 1440) return "Quad HD (1440p)";
  if (shortEdge >= 1080) return "Full HD (1080p)";
  if (shortEdge >= 720) return "HD (720p)";
  return `${width} × ${height}`;
}

export async function chooseNativeVideo(): Promise<LocalVideoMetadata> {
  const result = await NativeVideoPicker.chooseVideo();
  if (!isSupportedVideo(result.filename)) throw new Error("Unsupported format. Choose an MP4, MOV, MKV, or WEBM video.");
  if (!result.duration || !result.width || !result.height) throw new Error("The video is missing required duration or resolution metadata.");
  return complete(result, "Android native");
}

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function readBrowserVideo(file: File): Promise<LocalVideoMetadata> {
  if (!isSupportedVideo(file.name)) throw new Error("Unsupported format. Choose an MP4, MOV, MKV, or WEBM video.");
  const uri = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => reject(new Error("This browser could not read the selected video's metadata."));
      video.src = uri;
    });
    if (!Number.isFinite(dimensions.duration) || !dimensions.width || !dimensions.height) throw new Error("The video is missing required metadata.");
    return complete({ filename: file.name, fileSize: file.size, duration: dimensions.duration, width: dimensions.width, height: dimensions.height, resolution: `${dimensions.width} × ${dimensions.height}`, mimeType: file.type || "Unknown", uri }, "Browser preview");
  } catch (error) {
    URL.revokeObjectURL(uri);
    throw error;
  }
}

export function releaseBrowserVideo(video: LocalVideoMetadata | null) {
  if (video?.source === "Browser preview") URL.revokeObjectURL(video.uri);
}
