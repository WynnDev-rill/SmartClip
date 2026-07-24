export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ["mp4", "mov", "mkv", "webm"];

export type VideoMetadata = {
  video_id: string;
  original_filename: string;
  file_size_bytes: number;
  duration_seconds: number;
  width: number;
  height: number;
  resolution: string;
  frame_rate: number;
  video_codec: string;
  audio_codec: string | null;
  container: string;
  status: "uploaded";
};

export function validateVideo(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !ACCEPTED_EXTENSIONS.includes(extension)) return "Choose an MP4, MOV, MKV, or WEBM video.";
  if (file.size === 0) return "The selected video is empty.";
  if (file.size > MAX_UPLOAD_SIZE_BYTES) return "The selected video is larger than 2 GB.";
  return null;
}

export const formatBytes = (bytes: number) => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
};
