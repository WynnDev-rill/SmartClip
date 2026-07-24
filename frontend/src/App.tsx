import { useRef, useState } from "react";
import { CircleCheck, FileVideo, Info, LoaderCircle, Scissors, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appVersion, getPlatform } from "@/lib/platform";
import { chooseNativeVideo, isNativeAndroid, readBrowserVideo, releaseBrowserVideo, type LocalVideoMetadata } from "@/lib/video-picker";

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, "0")}`;

export default function App() {
  const input = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<LocalVideoMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const native = isNativeAndroid();

  const runSelection = async (file?: File) => {
    setError(""); setLoading(true);
    try {
      const selected = native ? await chooseNativeVideo() : file ? await readBrowserVideo(file) : null;
      if (selected) { releaseBrowserVideo(video); setVideo(selected); }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The selected video could not be read.";
      setError(/cancel/i.test(message) ? "Video selection was cancelled. No file was changed." : /permission|denied/i.test(message) ? "Permission was not granted. Please allow access in the system picker." : message);
    } finally { setLoading(false); if (input.current) input.current.value = ""; }
  };

  const remove = () => { releaseBrowserVideo(video); setVideo(null); setError(""); };

  return <main className="min-h-screen px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-8">
    <nav className="mx-auto flex max-w-5xl items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary"><Scissors size={20}/></span><div><p className="font-semibold">SmartClip</p><p className="text-xs text-muted-foreground">Private, on-device workspace</p></div></nav>
    <section className="mx-auto mt-12 max-w-3xl text-center sm:mt-16">
      <p className="text-sm font-medium text-violet-400">PRIVATE • FAST • LOCAL</p><h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Choose your video.</h1>
      <p className="mx-auto mt-5 max-w-xl text-muted-foreground">Your video stays on this device. SmartClip reads only the metadata needed to prepare the next step.</p>
      <div className="mt-9 rounded-3xl border border-white/10 bg-white/[.04] p-4 shadow-2xl sm:p-7">
        {!video ? <div className="rounded-2xl border border-dashed border-violet-400/40 bg-black/20 px-5 py-14">
          <input aria-label="Choose a video file" ref={input} className="sr-only" type="file" accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm" onCancel={() => setError("Video selection was cancelled. No file was changed.")} onChange={e => runSelection(e.target.files?.[0])}/>
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><Upload/></span><h2 className="mt-5 text-xl font-semibold">Select one local video</h2><p className="mt-2 text-sm text-muted-foreground">MP4, MOV, MKV, or WEBM</p>
          <Button className="mt-6 active:scale-[.97] transition-transform" disabled={loading} onClick={() => native ? runSelection() : input.current?.click()}>{loading ? <><LoaderCircle className="animate-spin" size={17}/> Reading metadata…</> : "Choose Video"}</Button>
          <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">{native ? "Android's system picker provides a durable content URI; no broad storage permission is requested." : "Browser fallback: metadata support depends on your browser and is not equivalent to Android native metadata."}</p>
        </div> : <article className="metadata-enter text-left"><div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><FileVideo/></span><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{video.filename}</h2><p className="text-sm text-emerald-300">Metadata ready • {video.source}</p></div><Button variant="outline" className="active:scale-[.97] transition-transform" onClick={remove}><Trash2 size={16}/>Remove Video</Button></div>
          <dl className="grid grid-cols-2 gap-3 pt-5 sm:grid-cols-3">{[["File size",formatBytes(video.fileSize)],["Duration",formatDuration(video.duration)],["Width",`${video.width} px`],["Height",`${video.height} px`],["Resolution",video.resolution],["Orientation",video.orientation],["MIME type",video.mimeType],["Local URI",video.uri]].map(([label,value])=><div key={label} className={`${label === "Local URI" ? "col-span-2 sm:col-span-3" : ""} min-w-0 rounded-xl bg-black/20 p-4`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm font-medium">{value}</dd></div>)}</dl>
        </article>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      </div>
    </section>
    <section className="mx-auto mt-8 max-w-3xl rounded-3xl border border-white/10 bg-white/[.04] p-5"><div className="flex items-center gap-3"><Info className="text-violet-300" size={20}/><h2 className="font-semibold">Local-first status</h2></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">{[["App version",appVersion],["Platform",getPlatform()],["Video access",native ? "Native system picker" : "Browser fallback"]].map(([label,value])=><div key={label} className="rounded-xl bg-black/20 p-4"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 flex items-center gap-2 font-medium">{label === "Video access" && <CircleCheck className="text-emerald-400" size={15}/ >}{value}</dd></div>)}</dl></section>
  </main>;
}
