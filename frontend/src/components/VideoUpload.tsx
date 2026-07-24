import { useRef, useState } from "react";
import { CheckCircle2, Film, Trash2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteVideo, uploadVideo } from "@/lib/api";
import { formatBytes, formatDuration, validateVideo, type VideoMetadata } from "@/lib/video";

export function VideoUpload() {
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [error, setError] = useState("");

  async function select(file?: File) {
    if (!file) return;
    const validation = validateVideo(file);
    if (validation) { setError(validation); return; }
    setError(""); setProgress(0);
    const upload = uploadVideo(file, setProgress); cancel.current = upload.cancel;
    try { setMetadata(await upload.promise); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Upload failed."); }
    finally { setProgress(null); cancel.current = null; if (input.current) input.current.value = ""; }
  }

  async function remove() {
    if (!metadata) return;
    try { await deleteVideo(metadata.video_id); setMetadata(null); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove the video."); }
  }

  return <section id="upload" className="relative mx-auto max-w-4xl px-5 py-16 lg:px-8" aria-labelledby="upload-title">
    <div className="mb-7 text-center"><p className="mb-2 text-sm font-medium text-violet-400">LOCAL VIDEO UPLOAD</p><h2 id="upload-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Bring in your footage.</h2><p className="mt-3 text-sm text-muted-foreground">MP4, MOV, MKV, or WEBM · Up to 2 GB · Automatically removed after 24 hours</p></div>
    {!metadata && <Card className={`upload-drop p-5 sm:p-8 ${dragging ? "border-primary bg-primary/10" : ""}`} onDragEnter={(e) => {e.preventDefault(); setDragging(true)}} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(e) => {e.preventDefault(); setDragging(false); void select(e.dataTransfer.files[0])}}>
      <button type="button" disabled={progress !== null} onClick={() => input.current?.click()} className="flex min-h-60 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/20 px-4 text-center transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-violet-300"><UploadCloud /></span><strong className="text-lg">Drop your video here</strong><span className="mt-2 text-sm text-muted-foreground">or choose a file from this device</span><span className="mt-5 rounded-full bg-white/[.07] px-5 py-2 text-sm font-medium">Choose video</span>
      </button><input ref={input} className="sr-only" type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm" onChange={(e) => void select(e.target.files?.[0])} aria-label="Choose a video to upload" />
      {progress !== null && <div className="mt-6" role="status" aria-live="polite"><div className="mb-2 flex justify-between text-sm"><span>Uploading securely…</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-300" style={{width: `${progress}%`}} /></div><Button className="mt-4 w-full sm:w-auto" variant="outline" onClick={() => cancel.current?.()}><X size={16}/> Cancel upload</Button></div>}
    </Card>}
    {metadata && <Card className="metadata-enter overflow-hidden p-6 sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-center gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-400"><Film /></span><div className="min-w-0"><div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 size={15}/> Upload complete</div><h3 className="mt-1 truncate text-lg font-semibold">{metadata.original_filename}</h3></div></div><Button variant="outline" onClick={() => void remove()}><Trash2 size={16}/> Remove Video</Button></div><dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["File size",formatBytes(metadata.file_size_bytes)],["Duration",formatDuration(metadata.duration_seconds)],["Resolution",metadata.resolution],["Frame rate",`${metadata.frame_rate} fps`],["Video",metadata.video_codec],["Audio",metadata.audio_codec ?? "None"]].map(([label,value])=><div key={label} className="rounded-xl bg-white/[.04] p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium uppercase">{value}</dd></div>)}</dl></Card>}
    <p className="mt-4 min-h-6 text-center text-sm text-rose-400" role="alert" aria-live="assertive">{error}</p>
  </section>;
}
