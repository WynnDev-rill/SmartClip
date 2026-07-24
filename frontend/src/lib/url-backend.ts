export type HealthResponse = { status: string; ffmpeg?: boolean; ffprobe?: boolean; ytdlp?: boolean };
export type InspectRequest = { url: string };
export type InspectResponse = { title: string; uploader?: string | null; duration?: number | null; thumbnailUrl?: string | null; sourceWidth?: number | null; sourceHeight?: number | null; estimatedFilesize?: number | null; qualityOptions: string[]; extractor?: string | null; warnings: string[]; separateAudioVideo: boolean };
export type CreateJobRequest = InspectRequest & { durationMode: "30-plus" | "60-plus" | "auto"; detectionMode: "conservative" | "balanced" | "aggressive"; outputQuality: "auto" | "720p" | "1080p"; layoutMode: "smart-crop" | "fit-background"; maximumCandidates: number };
export type CreateJobResponse = { jobId: string; state: string; createdAt: string; statusUrl: string };
export type JobState = "queued" | "inspecting" | "downloading" | "analyzing" | "generating candidates" | "rendering" | "completed" | "failed" | "cancelled" | "expired";
export type JobStatus = { jobId: string; state: JobState; phase: string; progress?: number | null; message?: string; createdAt: string; expiresAt?: string | null; candidateCount: number; errorCode?: string | null; errorMessage?: string | null };
export type CandidateResult = { id: string; startMs: number; endMs: number; durationMs: number; score: number; confidence: string; reasons: string[]; filename: string; resolution: string; size: number; expiresAt: string; downloadUrl: string };
export type ResultsResponse = { jobId: string; candidates: CandidateResult[] };
export type BackendErrorResponse = { detail?: { code?: string; message?: string } };

const defaultUrl = "https://smartclip-url-service.onrender.com";
export const backendConfig = {
  baseUrl: (import.meta.env.VITE_SMARTCLIP_BACKEND_URL || defaultUrl).replace(/\/$/, ""),
  token: import.meta.env.VITE_SMARTCLIP_API_TOKEN || "",
};
export const isBackendConfigured = () => Boolean(backendConfig.token && backendConfig.token !== "replace-with-your-private-token");

export class BackendError extends Error { constructor(message: string, public status?: number, public code?: string) { super(message); } }
const friendly = (status: number, code?: string, fallback?: string) => {
  if (status === 401) return "SmartClip server authentication is not configured correctly.";
  if (status === 409) return "Another URL video is currently being processed. Try again after it finishes.";
  if (status === 410 || code === "expired") return "These temporary clips have expired. Generate them again.";
  const messages: Record<string, string> = { unsafe_url: "Enter a valid public video URL.", duration_too_long: "This source is too long to process.", source_too_large: "This source is too large to process.", login_required: "This video requires a login and cannot be processed.", drm: "DRM-protected videos are not supported.", job_not_found: "The processing service restarted and this job is no longer available.", inspection_failed: "This public video is unavailable or unsupported." };
  return (code && messages[code]) || fallback || "The SmartClip server could not complete this request.";
};

export class SmartClipBackendClient {
  constructor(private baseUrl = backendConfig.baseUrl, private token = backendConfig.token) {}
  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 75_000): Promise<T> {
    if (!this.token || this.token === "replace-with-your-private-token") throw new BackendError("URL processing is not configured. Add SMARTCLIP_API_TOKEN at build time.");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: init.signal || controller.signal, headers: { Authorization: `Bearer ${this.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
      let body: unknown; try { body = await response.json(); } catch { if (response.ok) throw new BackendError("The server returned a malformed response.", response.status); }
      if (!response.ok) { const detail = (body as BackendErrorResponse | undefined)?.detail; throw new BackendError(friendly(response.status, detail?.code, detail?.message), response.status, detail?.code); }
      return body as T;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new BackendError("Waking the private processing server. This may take up to a minute. Retry if it does not respond.");
      throw new BackendError("No internet connection, or the SmartClip server is waking. Please retry.");
    } finally { clearTimeout(timer); }
  }
  inspect(url: string, signal?: AbortSignal) { return this.request<InspectResponse>("/api/url/inspect", { method: "POST", body: JSON.stringify({ url }), signal }); }
  createJob(body: CreateJobRequest) { return this.request<CreateJobResponse>("/api/jobs", { method: "POST", body: JSON.stringify(body) }); }
  status(id: string, signal?: AbortSignal) { return this.request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}`, { signal }, 30_000); }
  cancel(id: string) { return this.request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
  results(id: string) { return this.request<ResultsResponse>(`/api/jobs/${encodeURIComponent(id)}/results`); }
  fileUrl(id: string, filename: string) { return `${this.baseUrl}/api/files/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`; }
  getTokenForNativeDownload() { return this.token; }
}
export const backendClient = new SmartClipBackendClient();
export const isPublicHttpUrl = (value: string) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname); } catch { return false; } };
