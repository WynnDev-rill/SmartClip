import { type ChangeEvent, useRef, useState } from "react";
import {
  CircleCheck,
  FileVideo,
  Info,
  LoaderCircle,
  Scissors,
  Share2,
  Trash2,
  Upload,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LayoutEditor } from "@/components/LayoutEditor";
import { AutomaticHighlights } from "@/components/AutomaticHighlights";
import type { HighlightCandidate } from "@/lib/highlights";
import {
  coverCrop,
  defaultLayout,
  selectQuality,
  validateLayout,
  type Layout,
  type Quality,
} from "@/lib/layout";
import { appVersion, getPlatform } from "@/lib/platform";
import {
  chooseNativeVideo,
  isNativeAndroid,
  readBrowserVideo,
  releaseBrowserVideo,
  type LocalVideoMetadata,
} from "@/lib/video-picker";
import {
  exportNativeClip,
  NativeEditor,
  presetRange,
  validateTrim,
  type ExportResult,
  type ExportState,
  type TrimRange,
} from "@/lib/trim";

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export default function App() {
  const input = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<LocalVideoMetadata | null>(null);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 });
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [quality, setQuality] = useState<Quality>("auto");
  const [error, setError] = useState("");
  const [state, setState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<ExportResult>();
  const native = isNativeAndroid();
  const runSelection = async (file?: File) => {
    setError("");
    setLoading(true);
    try {
      const selected = native
        ? await chooseNativeVideo()
        : file
          ? await readBrowserVideo(file)
          : null;
      if (selected) {
        releaseBrowserVideo(video);
        setVideo(selected);
        setRange({ start: 0, end: selected.duration });
        setResult(undefined);
        setState("idle");
      }
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "The selected video could not be read.";
      setError(
        /cancel/i.test(message)
          ? "Video selection was cancelled. No file was changed."
          : /permission|denied/i.test(message)
            ? "Permission was not granted. Please allow access in the system picker."
            : message,
      );
    } finally {
      setLoading(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = () => {
    releaseBrowserVideo(video);
    setVideo(null);
    setError("");
    setResult(undefined);
    setState("idle");
  };
  const handleBrowserSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void runSelection(file);
    else {
      setLoading(false);
      setError("");
    }
  };
  const update = (key: keyof TrimRange, value: number) => {
    setRange((current) =>
      key === "start"
        ? { ...current, start: Math.min(value, current.end) }
        : { ...current, end: Math.max(value, current.start) },
    );
    setResult(undefined);
  };
  const exportClip = async () => {
    if (!video) return;
    const validation = validateTrim(range, video.duration);
    if (validation) {
      setError(validation);
      return;
    }
    if (!native) {
      setError(
        "Native export is Android-only. The browser trim controls are for UI testing; no file was exported.",
      );
      setState("failed");
      return;
    }
    setError("");
    setResult(undefined);
    setState("preparing");
    setProgress(undefined);
    const listener = await NativeEditor.addListener(
      "exportProgress",
      (event) => {
        setState(event.state);
        setProgress(event.progress);
      },
    );
    try {
      const exported = await exportNativeClip(video.uri, range);
      setResult(exported);
      setState("completed");
      setProgress(100);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Local export failed.";
      const cancelled = /cancel/i.test(message);
      setState(cancelled ? "cancelled" : "failed");
      setError(
        cancelled ? "Export cancelled. No gallery item was saved." : message,
      );
    } finally {
      await listener.remove();
    }
  };
  const exportVertical = async () => {
    if (!video) return;
    const validation =
      validateTrim(range, video.duration) || validateLayout(layout);
    if (validation) {
      setError(validation);
      return;
    }
    if (!native) {
      setError(
        "Native composition export is Android-only. The browser editor previews real layout calculations; no file was exported and no backend was called.",
      );
      setState("failed");
      return;
    }
    const output = selectQuality(
      quality,
      video.width,
      video.height,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    );
    setError("");
    setResult(undefined);
    setState("preparing");
    setProgress(undefined);
    const listener = await NativeEditor.addListener(
      "exportProgress",
      (event) => {
        setState(event.state);
        setProgress(event.progress);
      },
    );
    try {
      const exported = await NativeEditor.exportComposition({
        uri: video.uri,
        startMs: Math.round(range.start * 1000),
        endMs: Math.round(range.end * 1000),
        layout: { ...layout, gameplayCrop: layout.mode === "smart-crop" ? coverCrop(video.width, video.height, output.width, output.height, layout.focalX, layout.focalY, layout.zoom) : layout.gameplayCrop },
        quality,
        outputWidth: output.width,
        outputHeight: output.height,
      });
      setResult(exported);
      setState("completed");
      setProgress(100);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Local composition failed.";
      const cancelled = /cancel/i.test(message);
      setState(cancelled ? "cancelled" : "failed");
      setError(
        cancelled ? "Export cancelled. No gallery item was saved." : message,
      );
    } finally {
      await listener.remove();
    }
  };
  const exportCandidates = async (candidates: HighlightCandidate[]) => {
    if (!video || !native) throw new Error("Candidate export is Android-only.");
    const output = selectQuality(quality, video.width, video.height, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
    for (const candidate of candidates) {
      await NativeEditor.exportComposition({ uri: video.uri, startMs: candidate.startMs, endMs: candidate.endMs, layout: { ...layout, gameplayCrop: layout.mode === "smart-crop" ? coverCrop(video.width, video.height, output.width, output.height, layout.focalX, layout.focalY, layout.zoom) : layout.gameplayCrop }, quality, outputWidth: output.width, outputHeight: output.height });
    }
  };
  const busy = ["preparing", "trimming", "rendering", "saving"].includes(state);
  const validation = video ? validateTrim(range, video.duration) : null;

  return (
    <main className="min-h-screen px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-8">
      <nav className="mx-auto flex max-w-5xl items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary">
          <Scissors size={20} />
        </span>
        <div>
          <p className="font-semibold">SmartClip</p>
          <p className="text-xs text-muted-foreground">
            Private, on-device workspace
          </p>
        </div>
      </nav>
      <section className="mx-auto mt-12 max-w-3xl text-center">
        <p className="text-sm font-medium text-violet-400">
          PRIVATE • FAST • LOCAL
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          Trim your moment.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
          Select, trim, and save an MP4 without uploading your video.
        </p>
        <div className="mt-9 rounded-3xl border border-white/10 bg-white/[.04] p-4 shadow-2xl sm:p-7">
          {!video ? (
            <div className="rounded-2xl border border-dashed border-violet-400/40 bg-black/20 px-5 py-14">
              <input
                aria-label="Choose a video file"
                ref={input}
                className="sr-only"
                type="file"
                accept=".mp4,.mov,.mkv,.webm,video/*"
                onChange={handleBrowserSelection}
              />
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
                <Upload />
              </span>
              <h2 className="mt-5 text-xl font-semibold">
                Select one local video
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                MP4, MOV, MKV, or WEBM
              </p>
              <Button
                className="mt-6 active:scale-[.97]"
                disabled={loading}
                onClick={() =>
                  native ? runSelection() : input.current?.click()
                }
              >
                {loading ? (
                  <>
                    <LoaderCircle className="animate-spin" size={17} /> Reading
                    metadata…
                  </>
                ) : (
                  "Choose Video"
                )}
              </Button>
              <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">
                {native
                  ? "Android's system picker grants access to this item; no broad storage permission is requested."
                  : "Browser fallback: trim UI testing only. Native export is Android-only and no backend is called."}
              </p>
            </div>
          ) : (
            <article className="metadata-enter text-left">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center">
                <span className="grid h-14 w-14 place-items-center rounded-xl bg-violet-400/10 text-violet-300">
                  <FileVideo />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">
                    {video.filename}
                  </h2>
                  <p className="text-sm text-emerald-300">
                    Metadata ready • {video.source}
                  </p>
                </div>
                <Button variant="outline" disabled={busy} onClick={remove}>
                  <Trash2 size={16} />
                  Remove Video
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 py-5 sm:grid-cols-4">
                {[
                  ["File size", formatBytes(video.fileSize)],
                  ["Duration", formatDuration(video.duration)],
                  ["Width", `${video.width} px`],
                  ["Height", `${video.height} px`],
                  ["Resolution", video.resolution],
                  ["Orientation", video.orientation],
                  ["MIME type", video.mimeType],
                  ["Local URI", video.uri],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className={`${label === "Local URI" ? "col-span-2 sm:col-span-4" : ""} rounded-xl bg-black/20 p-3`}
                  >
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-all text-sm font-medium">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <section
                aria-label="Trim editor"
                className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Trim editor</h3>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setRange(presetRange("full", video.duration))
                    }
                  >
                    Reset
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Source", video.duration],
                    ["Start", range.start],
                    ["End", range.end],
                    ["Selected", Math.max(0, range.end - range.start)],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 font-mono text-lg">
                        {formatDuration(Number(value))}
                      </p>
                    </div>
                  ))}
                </div>
                <label className="mt-5 block text-sm">
                  Start time
                  <input
                    aria-label="Start time"
                    className="mt-2 w-full accent-violet-500"
                    type="range"
                    min="0"
                    max={video.duration}
                    step="0.1"
                    value={range.start}
                    disabled={busy}
                    onChange={(event) =>
                      update("start", Number(event.target.value))
                    }
                  />
                </label>
                <label className="mt-4 block text-sm">
                  End time
                  <input
                    aria-label="End time"
                    className="mt-2 w-full accent-violet-500"
                    type="range"
                    min="0"
                    max={video.duration}
                    step="0.1"
                    value={range.end}
                    disabled={busy}
                    onChange={(event) =>
                      update("end", Number(event.target.value))
                    }
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(
                    [
                      [10, "First 10 seconds"],
                      [15, "15 seconds"],
                      [30, "30 seconds"],
                      ["full", "Full duration"],
                    ] as const
                  ).map(([length, label]) => (
                    <Button
                      key={label}
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setRange(presetRange(length, video.duration))
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {validation && (
                  <p className="mt-3 text-sm text-amber-300">{validation}</p>
                )}
                <div className="mt-5 flex gap-3">
                  <Button
                    disabled={busy || Boolean(validation)}
                    onClick={exportClip}
                  >
                    <Scissors size={17} />
                    Export Clip
                  </Button>
                  {busy && (
                    <Button
                      variant="outline"
                      onClick={() => NativeEditor.cancelExport()}
                    >
                      <X size={17} />
                      Cancel
                    </Button>
                  )}
                </div>
                {busy && (
                  <div className="mt-5" aria-live="polite">
                    <div className="flex justify-between text-sm capitalize">
                      <span>{state}…</span>
                      <span>
                        {progress === undefined
                          ? "Working locally"
                          : `${progress}%`}
                      </span>
                    </div>
                    {progress !== undefined && (
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full bg-violet-500 transition-[width] duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>
              <AutomaticHighlights uri={video.uri} durationSeconds={video.duration} native={native} disabled={busy}
                onAdjust={(candidate) => { setRange({ start: candidate.startMs / 1000, end: candidate.endMs / 1000 }); document.querySelector('[aria-label="Trim editor"]')?.scrollIntoView({ behavior: "smooth" }); }}
                onExport={exportCandidates} />
              <LayoutEditor
                video={video}
                disabled={busy}
                onChange={(nextLayout, nextQuality) => {
                  setLayout(nextLayout);
                  setQuality(nextQuality);
                  setResult(undefined);
                }}
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  disabled={
                    busy ||
                    Boolean(validation) ||
                    Boolean(validateLayout(layout))
                  }
                  onClick={exportVertical}
                >
                  <FileVideo size={17} />
                  Export Vertical MP4
                </Button>
                <span className="self-center text-xs text-muted-foreground">
                  Composition re-encodes locally; trim-only export remains
                  available above.
                </span>
              </div>
              {result && (
                <section className="completion-enter mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.07] p-5">
                  <h3 className="flex items-center gap-2 font-semibold text-emerald-300">
                    <CircleCheck size={19} />
                    Export completed
                  </h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Filename</dt>
                      <dd className="break-all">{result.filename}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Duration</dt>
                      <dd>{formatDuration(result.duration)}</dd>
                    </div>
                    {result.width && (
                      <div>
                        <dt className="text-muted-foreground">Resolution</dt>
                        <dd>
                          {result.width} × {result.height}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">File size</dt>
                      <dd>{formatBytes(result.fileSize)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Saved to</dt>
                      <dd>{result.location}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() =>
                        NativeEditor.openMedia({ uri: result.uri })
                      }
                    >
                      <ExternalLink size={16} />
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        NativeEditor.shareMedia({
                          uri: result.uri,
                          filename: result.filename,
                        })
                      }
                    >
                      <Share2 size={16} />
                      Share
                    </Button>
                  </div>
                </section>
              )}
            </article>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300"
            >
              {error}
            </p>
          )}
        </div>
      </section>
      <section className="mx-auto mt-8 max-w-3xl rounded-3xl border border-white/10 bg-white/[.04] p-5">
        <div className="flex items-center gap-3">
          <Info className="text-violet-300" size={20} />
          <h2 className="font-semibold">Local-first status</h2>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["App version", appVersion],
            ["Platform", getPlatform()],
            [
              "Video access",
              native ? "Native system picker" : "Browser fallback",
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-black/20 p-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 flex items-center gap-2 font-medium">
                {label === "Video access" && (
                  <CircleCheck className="text-emerald-400" size={15} />
                )}
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
