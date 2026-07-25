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
import { UrlWorkflow } from "@/components/UrlWorkflow";
import type { HighlightCandidate } from "@/lib/highlights";
import {
  coverCrop,
  defaultLayout,
  normalizeLayout,
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
import { AppShell, type Destination, EmptyState, StatusBadge } from "@/components/AppShell";
import { useI18n } from "@/i18n";
import { DownloadsScreen, ProjectsScreen, SettingsScreen, readStored, type DownloadItem, type HistoryItem } from "@/components/LibraryScreens";

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export default function App() {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<"local" | "url">("local");
  const [video, setVideo] = useState<LocalVideoMetadata | null>(null);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 });
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [quality, setQuality] = useState<Quality>("auto");
  const [error, setError] = useState("");
  const [state, setState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<ExportResult>();
  const [destination, setDestination] = useState<Destination>("home");
  const [history, setHistory] = useState<HistoryItem[]>(() => readStored("smartclip.history"));
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => readStored("smartclip.downloads"));
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
        const item: HistoryItem = { id: `${Date.now()}`, title: selected.filename, source: "Device", status: "draft", date: new Date().toISOString() };
        setHistory((old) => { const next = [item, ...old].slice(0, 30); localStorage.setItem("smartclip.history", JSON.stringify(next)); return next; });
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
    let listener: Awaited<ReturnType<typeof NativeEditor.addListener>> | undefined;
    try {
      listener = await NativeEditor.addListener("exportProgress", (event) => { setState(event.state); setProgress(event.progress); });
      const exported = await Promise.race([exportNativeClip(video.uri, range), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Export stalled. Try again after closing other video apps.")), 10 * 60_000))]);
      setResult(exported);
      setState("completed");
      setProgress(100);
      const item: DownloadItem = { id: exported.uri, filename: exported.filename, date: new Date().toISOString(), size: formatBytes(exported.fileSize), source: "Device", uri: exported.uri };
      setDownloads((old) => { const next = [item, ...old.filter(x => x.id !== item.id)]; localStorage.setItem("smartclip.downloads", JSON.stringify(next)); return next; });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Local export failed.";
      const cancelled = /cancel/i.test(message);
      setState(cancelled ? "cancelled" : "failed");
      setError(
        cancelled ? "Export cancelled. No gallery item was saved." : message,
      );
    } finally {
      await listener?.remove();
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
    const normalized = normalizeLayout(layout);
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
    let listener: Awaited<ReturnType<typeof NativeEditor.addListener>> | undefined;
    try {
      listener = await NativeEditor.addListener("exportProgress", (event) => { setState(event.state); setProgress(event.progress); });
      const gameplayCrop = normalized.mode === "smart-crop" ? coverCrop(video.width, video.height, output.width, output.height, normalized.focalX, normalized.focalY, normalized.zoom) : normalized.gameplayCrop;
      const exported = await Promise.race([NativeEditor.exportComposition({
        uri: video.uri,
        startMs: Math.round(range.start * 1000),
        endMs: Math.round(range.end * 1000),
        layout: { ...normalized, gameplayCrop },
        quality,
        outputWidth: output.width,
        outputHeight: output.height,
      }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Export stalled. Try again after closing other video apps.")), 10 * 60_000))]);
      setResult(exported);
      setState("completed");
      setProgress(100);
      const item: DownloadItem = { id: exported.uri, filename: exported.filename, date: new Date().toISOString(), size: formatBytes(exported.fileSize), resolution: `${exported.width} × ${exported.height}`, source: "Device", uri: exported.uri };
      setDownloads((old) => { const next = [item, ...old.filter(x => x.id !== item.id)]; localStorage.setItem("smartclip.downloads", JSON.stringify(next)); return next; });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Local composition failed.";
      const cancelled = /cancel/i.test(message);
      setState(cancelled ? "cancelled" : "failed");
      setError(
        cancelled ? "Export cancelled. No gallery item was saved." : message,
      );
    } finally {
      await listener?.remove();
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

  const clearHistory = () => { localStorage.removeItem("smartclip.history"); setHistory([]); };
  const deleteDownload = (id: string) => setDownloads((old) => { const next = old.filter(x => x.id !== id); localStorage.setItem("smartclip.downloads", JSON.stringify(next)); return next; });

  if (destination !== "home") return <AppShell destination={destination} onNavigate={setDestination} title={t(destination)}>{destination === "projects" ? <ProjectsScreen items={history} onClear={clearHistory}/> : destination === "downloads" ? <DownloadsScreen items={downloads} onDelete={deleteDownload}/> : <SettingsScreen/>}</AppShell>;

  return (
    <AppShell destination={destination} onNavigate={setDestination} title={video ? t("localEditor") : t("home")}>
      <section className="mx-auto max-w-3xl text-left">
        <header className="dashboard-header"><p>{t("createClip")}</p><h1>SmartClip</h1><span>{t("homeDetail")}</span></header>
        <div aria-label="Source mode" className="source-grid">
          <button className={`rounded-2xl border p-4 ${sourceMode === "local" ? "border-violet-400 bg-violet-400/10" : "border-white/10 bg-white/[.04]"}`} onClick={() => setSourceMode("local")}><strong>{t("fromDevice")}</strong><span className="mt-1 block text-xs text-muted-foreground">{t("localPrivate")}</span></button>
          <button className={`rounded-2xl border p-4 ${sourceMode === "url" ? "border-violet-400 bg-violet-400/10" : "border-white/10 bg-white/[.04]"}`} onClick={() => setSourceMode("url")}><strong>{t("pasteUrl")}</strong><span className="mt-1 block text-xs text-muted-foreground">{t("serverPrivate")}</span></button>
        </div>
        <div className="workflow-card">
          {sourceMode === "url" ? <UrlWorkflow /> : !video ? (
            <div className="rounded-2xl border border-dashed border-violet-400/40 bg-black/20 px-5 py-14">
              <input
                aria-label={t("chooseFile")}
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
                {t("selectVideo")}
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
                    <LoaderCircle className="animate-spin" size={17} /> {t("readingMetadata")}
                  </>
                ) : (
                  t("chooseVideo")
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
                    {t("metadataReady")} • {video.source}
                  </p>
                </div>
                <Button variant="outline" disabled={busy} onClick={remove}>
                  <Trash2 size={16} />
                  {t("removeVideo")}
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 py-5 sm:grid-cols-4">
                {[
                  [t("fileSize"), formatBytes(video.fileSize)],
                  [t("duration"), formatDuration(video.duration)],
                  [t("width"), `${video.width} px`],
                  [t("height"), `${video.height} px`],
                  [t("resolution"), video.resolution],
                  [t("orientation"), video.orientation],
                  ["MIME type", video.mimeType],
                  [t("localUri"), video.uri],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className={`${label === t("localUri") ? "col-span-2 sm:col-span-4" : ""} rounded-xl bg-black/20 p-3`}
                  >
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-all text-sm font-medium">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <section
                aria-label={t("trimEditor")}
                className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{t("trimEditor")}</h3>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setRange(presetRange("full", video.duration))
                    }
                  >
                    {t("reset")}
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    [t("source"), video.duration],
                    [t("start"), range.start],
                    [t("end"), range.end],
                    [t("selected"), Math.max(0, range.end - range.start)],
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
                  {t("startTime")}
                  <input
                    aria-label={t("startTime")}
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
                  {t("endTime")}
                  <input
                    aria-label={t("endTime")}
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
                      [10, t("first10")],
                      [15, t("seconds15")],
                      [30, t("seconds30")],
                      ["full", t("fullDuration")],
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
                    {t("exportClip")}
                  </Button>
                  {busy && (
                    <Button
                      variant="outline"
                      onClick={() => NativeEditor.cancelExport()}
                    >
                      <X size={17} />
                      {t("cancel")}
                    </Button>
                  )}
                </div>
                {busy && (
                  <div className="mt-5" aria-live="polite">
                    <div className="flex justify-between text-sm capitalize">
                      <span>{state}…</span>
                      <span>
                        {progress === undefined
                          ? t("workingLocally")
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
                onAdjust={(candidate) => { setRange({ start: candidate.startMs / 1000, end: candidate.endMs / 1000 }); document.querySelector(`[aria-label="${t("trimEditor")}"]`)?.scrollIntoView({ behavior: "smooth" }); }}
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
                  {t("exportVertical")}
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
                    {t("exportCompleted")}
                  </h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">{t("filename")}</dt>
                      <dd className="break-all">{result.filename}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("duration")}</dt>
                      <dd>{formatDuration(result.duration)}</dd>
                    </div>
                    {result.width && (
                      <div>
                        <dt className="text-muted-foreground">{t("resolution")}</dt>
                        <dd>
                          {result.width} × {result.height}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">{t("fileSize")}</dt>
                      <dd>{formatBytes(result.fileSize)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("savedTo")}</dt>
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
                      {t("open")}
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
                      {t("share")}
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
      <section className="mx-auto mt-6 max-w-3xl surface-card p-5">
        <div className="flex items-center gap-3">
          <Info className="text-violet-300" size={20} />
          <h2 className="font-semibold">{t("localStatus")}</h2>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          {[
            [t("appVersion"), appVersion],
            [t("platform"), getPlatform()],
            [
              t("videoAccess"),
              native ? t("nativePicker") : t("browserFallback"),
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-black/20 p-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 flex items-center gap-2 font-medium">
                {label === t("videoAccess") && (
                  <CircleCheck className="text-emerald-400" size={15} />
                )}
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {!video && sourceMode === "local" && <section className="mx-auto mt-6 max-w-3xl"><div className="section-heading"><h2>{t("recentActivity")}</h2><button onClick={() => setDestination("projects")}>{t("viewAll")}</button></div>{history.length ? <div className="card-list">{history.slice(0,3).map(item => <article className="library-card" key={item.id}><div className="min-w-0 flex-1"><h3 className="truncate">{item.title}</h3><p>{item.source} · {new Date(item.date).toLocaleDateString(locale)} · Last action: video selected</p></div><StatusBadge tone="neutral">Draft</StatusBadge></article>)}</div> : <EmptyState title={t("noRecent")} detail={t("noRecentDetail")}/>}</section>}
    </AppShell>
  );
}
