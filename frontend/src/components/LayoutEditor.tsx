import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "./ui/button";
import {
  applyPreset,
  coverCrop,
  defaultLayout,
  facecamOutput,
  normalizeRect,
  selectQuality,
  validateLayout,
  type CompositionMode,
  type Layout,
  type Preset,
  type Quality,
  type Rect,
} from "@/lib/layout";
import type { LocalVideoMetadata } from "@/lib/video-picker";
import { useI18n } from "@/i18n";

type Props = {
  video: LocalVideoMetadata;
  disabled?: boolean;
  onChange(layout: Layout, quality: Quality): void;
};
const modes: [CompositionMode, string][] = [
  ["smart-crop", "Smart Crop"],
  ["fit-background", "Fit + Background"],
  ["split", "Split Layout"],
  ["manual-overlay", "Manual Overlay"],
];
const presets: [Preset, string][] = [
  ["gameplay-full", "Gameplay full"],
  ["gameplay-top-facecam-bottom", "Gameplay top + facecam bottom"],
  ["facecam-top-gameplay-bottom", "Facecam top + gameplay bottom"],
  ["gameplay-facecam-corner", "Gameplay full + facecam corner"],
  ["fit-background", "Fit gameplay + solid background"],
];

export function LayoutEditor({ video, disabled, onChange }: Props) {
  const { t } = useI18n();
  const [layout, setLayoutState] = useState(defaultLayout);
  const [quality, setQuality] = useState<Quality>("auto");
  const [selected, setSelected] = useState<
    "gameplayCrop" | "facecamCrop" | "facecamOutput"
  >("gameplayCrop");
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    rect: Rect;
    resize: boolean;
  } | null>(null);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    onChange(next, quality);
  };
  const qualityInfo = selectQuality(
    quality,
    video.width,
    video.height,
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  );
  const previewCrop = useMemo(
    () =>
      layout.mode === "smart-crop"
        ? coverCrop(
            video.width,
            video.height,
            9,
            16,
            layout.focalX,
            layout.focalY,
            layout.zoom,
          )
        : layout.gameplayCrop,
    [layout, video],
  );
  const begin = (event: PointerEvent, key: typeof selected) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(key);
    const rect = layout[key];
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      rect,
      resize: (event.target as HTMLElement).dataset.resize === "true",
    };
  };
  const move = (event: PointerEvent) => {
    const start = gesture.current,
      bounds = canvas.current?.getBoundingClientRect();
    if (!start || !bounds) return;
    const dx = (event.clientX - start.x) / bounds.width,
      dy = (event.clientY - start.y) / bounds.height;
    const rect = start.resize
      ? normalizeRect({
          ...start.rect,
          width: start.rect.width + dx,
          height: start.rect.height + dy,
        })
      : normalizeRect({
          ...start.rect,
          x: start.rect.x + dx,
          y: start.rect.y + dy,
        });
    setLayout({ ...layout, [selected]: rect });
  };
  const end = () => {
    gesture.current = null;
  };
  const sourceStyle = (rect: Rect) => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });
  const chooseQuality = (next: Quality) => {
    setQuality(next);
    onChange(layout, next);
  };
  const error = validateLayout(layout);
  return (
    <section
      aria-label="Layout editor"
      className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">9:16 layout editor</h3>
          <p className="text-xs text-muted-foreground">
            Drag regions to move; drag the square handle to resize.
          </p>
        </div>
        <span className="rounded-full border border-emerald-400/30 px-3 py-1 text-xs text-emerald-300">
          Safe output frame
        </span>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(180px,260px)_1fr]">
        <div
          ref={canvas}
          className="relative mx-auto aspect-[9/16] w-full max-w-[260px] touch-none overflow-hidden rounded-xl border-2 border-violet-300 bg-slate-900"
          aria-label="9:16 composition preview"
        >
          {video.uri.startsWith("blob:") && (
            <video
              className="h-full w-full object-cover opacity-60"
              src={video.uri}
              muted
              playsInline
            />
          )}
          <div
            className="absolute inset-2 border border-dashed border-white/40"
            aria-hidden="true"
          />
          <div
            className="absolute border-2 border-cyan-300 bg-cyan-300/10"
            style={sourceStyle(
              layout.mode === "smart-crop"
                ? { x: 0, y: 0, width: 1, height: 1 }
                : previewCrop,
            )}
          >
            <span className="bg-cyan-950/80 px-1 text-[10px]">GAMEPLAY</span>
          </div>
          {(layout.mode === "split" || layout.mode === "manual-overlay") && (
            <div
              onPointerDown={(e) => begin(e, "facecamOutput")}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute cursor-move border-2 border-fuchsia-300 bg-fuchsia-300/20"
              style={{
                ...sourceStyle(layout.facecamOutput),
                borderRadius: `${layout.cornerRadius}px`,
              }}
            >
              <span className="bg-fuchsia-950/80 px-1 text-[10px]">
                FACECAM
              </span>
              <i
                data-resize="true"
                className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 rounded-sm bg-fuchsia-300"
              />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Composition mode
            </p>
            <div className="flex flex-wrap gap-2">
              {modes.map(([value, label]) => (
                <Button
                  key={value}
                  variant={layout.mode === value ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => setLayout({ ...layout, mode: value })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Quick presets</p>
            <div className="flex flex-wrap gap-2">
              {presets.map(([value, label]) => (
                <Button
                  key={value}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setLayout(applyPreset(value, layout))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div
            className="relative aspect-video overflow-hidden rounded-xl bg-slate-800"
            aria-label="Source crop regions"
          >
            {video.uri.startsWith("blob:") && (
              <video
                className="h-full w-full object-contain"
                src={video.uri}
                muted
                playsInline
              />
            )}
            {(["gameplayCrop", "facecamCrop"] as const).map((key) => (
              <div
                key={key}
                onPointerDown={(e) => begin(e, key)}
                onPointerMove={move}
                onPointerUp={end}
                className={`absolute touch-none cursor-move border-2 ${key === "gameplayCrop" ? "border-cyan-300" : "border-fuchsia-300"}`}
                style={sourceStyle(
                  key === "gameplayCrop" && layout.mode === "smart-crop"
                    ? previewCrop
                    : layout[key],
                )}
              >
                <span className="bg-black/70 px-1 text-[10px]">
                  {key === "gameplayCrop" ? "GAMEPLAY" : "FACECAM"}
                </span>
                <i
                  data-resize="true"
                  className="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 bg-white"
                />
              </div>
            ))}
          </div>
          {layout.mode === "smart-crop" && (
            <>
              <Range
                label={t("horizontalFocalPosition")}
                value={layout.focalX}
                onChange={(value) => setLayout({ ...layout, focalX: value })}
              />
              <Range
                label={t("verticalFocalPosition")}
                value={layout.focalY}
                onChange={(value) => setLayout({ ...layout, focalY: value })}
              />
              <Range
                label={t("zoom")}
                value={layout.zoom}
                min={1}
                max={4}
                onChange={(value) => setLayout({ ...layout, zoom: value })}
              />
            </>
          )}
          {layout.mode === "fit-background" && (
            <p className="text-xs text-muted-foreground">Android export currently uses a solid background. Blur is deferred until the renderer has a tested two-pass background effect.</p>
          )}
          {(layout.mode === "split" || layout.mode === "manual-overlay") && (
            <>
              <p className="text-xs text-amber-300">Preview controls are available, but Android export for facecam compositing is not yet supported.</p>
              <label className="block text-sm">
                Facecam position
                <select
                  className="ml-2 rounded bg-slate-800 p-2"
                  value={layout.facecamPosition}
                  onChange={(e) => {
                    const facecamPosition = e.target
                      .value as Layout["facecamPosition"];
                    setLayout({
                      ...layout,
                      facecamPosition,
                      facecamOutput: facecamOutput(facecamPosition),
                    });
                  }}
                >
                  {[
                    "top",
                    "bottom",
                    "top-left",
                    "top-right",
                    "bottom-left",
                    "bottom-right",
                  ].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <Range
                label="Corner radius"
                value={layout.cornerRadius}
                min={0}
                max={48}
                onChange={(value) =>
                  setLayout({ ...layout, cornerRadius: value })
                }
              />
            </>
          )}
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("exportQuality")}</p>
            <div className="flex gap-2">
              {(["auto", "720p", "1080p"] as Quality[]).map((value) => (
                <Button
                  key={value}
                  variant={quality === value ? "default" : "outline"}
                  onClick={() => chooseQuality(value)}
                >
                  {value === "auto" ? t("auto") : value}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {qualityInfo.width} × {qualityInfo.height} H.264/AAC
              {qualityInfo.warning && (
                <span className="text-amber-300"> • {qualityInfo.warning}</span>
              )}
            </p>
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </div>
      </div>
    </section>
  );
}
function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full accent-violet-500"
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
