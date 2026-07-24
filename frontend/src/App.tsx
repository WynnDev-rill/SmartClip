import { useRef, useState } from "react";
import { CircleCheck, FileVideo, Info, Scissors, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteVideo, uploadVideo, type VideoMetadata } from "@/lib/api";
import { appVersion, getPlatform } from "@/lib/platform";

const MAX_SIZE = 500 * 1024 * 1024;
const ALLOWED = [".mp4", ".mov", ".mkv", ".webm"];
const formatBytes = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function App() {
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const platform = getPlatform();
  const isAndroid = platform === "Android (Capacitor)";

  const select = (file?: File) => {
    if (!file) return;
    const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!ALLOWED.includes(extension)) {
      setError("Choose an MP4, MOV, MKV, or WEBM video.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError(`Video must be smaller than ${formatBytes(MAX_SIZE)}.`);
      return;
    }
    setError("");
    setProgress(0);
    const upload = uploadVideo(file, setProgress);
    cancel.current = upload.cancel;
    upload.promise
      .then(setMetadata)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError(reason instanceof Error ? reason.message : "Upload failed.");
      })
      .finally(() => {
        setProgress(null);
        cancel.current = null;
      });
  };

  const remove = async () => {
    if (!metadata) return;
    setRemoving(true);
    setError("");
    try {
      await deleteVideo(metadata.id);
      setMetadata(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the video.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <main className="min-h-screen px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-8">
      <nav className="mx-auto flex max-w-6xl items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary"><Scissors size={20} /></span>
        <div><p className="font-semibold">SmartClip</p><p className="text-xs text-muted-foreground">Local video workspace</p></div>
      </nav>

      <section className="mx-auto mt-12 max-w-4xl text-center sm:mt-16">
        <p className="text-sm font-medium text-violet-400">PRIVATE • FAST • LOCAL</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Start with your video.</h1>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground">Prepare a recording for the local-first highlight workflow.</p>
        <div className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-white/[.04] p-4 shadow-2xl sm:p-8">
          {isAndroid ? (
            <div className="rounded-2xl border border-violet-400/30 bg-black/20 px-5 py-12">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><FileVideo /></span>
              <h2 className="mt-5 text-xl font-semibold">Android foundation is ready</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">On-device video selection and processing are not installed yet. This build never requires a remote website.</p>
            </div>
          ) : !metadata ? (
            <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); select(event.dataTransfer.files[0]); }} className="rounded-2xl border border-dashed border-violet-400/40 bg-black/20 px-5 py-16">
              <label className="sr-only" htmlFor="video-input">Choose a video file</label>
              <input id="video-input" ref={input} className="sr-only" type="file" accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm" onChange={(event) => select(event.target.files?.[0])} />
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><Upload /></span>
              <h2 className="mt-5 text-xl font-semibold">Drop your video here</h2>
              <p className="mt-2 text-sm text-muted-foreground">MP4, MOV, MKV, or WEBM • up to 500 MB</p>
              <Button className="mt-6" onClick={() => input.current?.click()}>Choose video</Button>
              {progress !== null && <div className="mx-auto mt-7 max-w-md" role="status" aria-live="polite"><div className="mb-2 flex justify-between text-sm"><span>Uploading…</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded bg-white/10"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><button className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white" onClick={() => cancel.current?.()}><X size={15} /> Cancel upload</button></div>}
            </div>
          ) : (
            <div className="text-left"><div className="flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-center"><span className="grid h-14 w-14 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><FileVideo /></span><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{metadata.filename}</h2><p className="text-sm text-muted-foreground">Ready for processing</p></div><Button variant="outline" disabled={removing} onClick={remove}><Trash2 size={16} />{removing ? "Removing…" : "Remove video"}</Button></div><dl className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-3">{[["Duration", `${metadata.duration.toFixed(1)} sec`], ["Resolution", metadata.resolution], ["Frame rate", `${metadata.frame_rate.toFixed(2)} fps`], ["Video codec", metadata.video_codec.toUpperCase()], ["Audio codec", metadata.audio_codec?.toUpperCase() ?? "None"], ["Container", metadata.container], ["File size", formatBytes(metadata.file_size)]].map(([label, value]) => <div key={label} className="rounded-xl bg-black/20 p-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl></div>
          )}
          {error && <p className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300" role="alert">{error}</p>}
        </div>
      </section>

      <section aria-labelledby="about-title" className="mx-auto mt-8 max-w-4xl rounded-3xl border border-white/10 bg-white/[.04] p-5 sm:p-7">
        <div className="flex items-center gap-3"><Info className="text-violet-300" size={20} /><div><h2 id="about-title" className="font-semibold">About this build</h2><p className="text-sm text-muted-foreground">Android local-first foundation</p></div></div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          {[["App version", appVersion], ["Platform", platform], ["Local-first status", "Foundation active"], ["Processing engine", "Not installed yet"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 rounded-xl bg-black/20 p-4"><dt className="text-muted-foreground">{label}</dt><dd className="flex items-center gap-2 text-right font-medium">{label === "Local-first status" && <CircleCheck className="text-emerald-400" size={15} />}{value}</dd></div>)}
        </dl>
      </section>
    </main>
  );
}
