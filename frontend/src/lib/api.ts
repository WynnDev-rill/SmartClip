import type { VideoMetadata } from "@/lib/video";

export type Health = { status: string; service: string };
const API_URL = import.meta.env.VITE_API_URL ?? "/api";

export async function getHealth(): Promise<Health> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new Error("Health check failed");
  return response.json() as Promise<Health>;
}

function apiError(response: XMLHttpRequest): string {
  try { return JSON.parse(response.responseText).error?.message ?? "Upload failed."; }
  catch { return "Upload failed. Please try again."; }
}

export function uploadVideo(file: File, onProgress: (percent: number) => void) {
  const request = new XMLHttpRequest();
  const promise = new Promise<VideoMetadata>((resolve, reject) => {
    request.open("POST", `${API_URL}/videos/upload`);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
    request.onload = () => request.status >= 200 && request.status < 300
      ? resolve(JSON.parse(request.responseText) as VideoMetadata)
      : reject(new Error(apiError(request)));
    request.onerror = () => reject(new Error("Could not connect to SmartClip."));
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    const body = new FormData(); body.append("file", file); request.send(body);
  });
  return { promise, cancel: () => request.abort() };
}

export async function deleteVideo(videoId: string): Promise<void> {
  const response = await fetch(`${API_URL}/videos/${videoId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not remove the video.");
}
