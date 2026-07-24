import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { analyzeHighlights, type DetectionMode, type DurationMode, type HighlightCandidate } from "@/lib/highlights";
import { NativeEditor } from "@/lib/trim";
import { SegmentedControl, StatusBadge } from "./AppShell";

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${Math.floor(ms % 60_000 / 1000).toString().padStart(2, "0")}`;
export interface AutomaticHighlightsProps {
  uri: string; durationSeconds: number; native: boolean; disabled: boolean;
  onAdjust(candidate: HighlightCandidate): void;
  onExport(candidates: HighlightCandidate[]): Promise<void>;
}

export function AutomaticHighlights({ uri, durationSeconds, native, disabled, onAdjust, onExport }: AutomaticHighlightsProps) {
  const [durationMode, setDurationMode] = useState<DurationMode>("auto");
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("balanced");
  const [phase, setPhase] = useState("idle");
  const [candidates, setCandidates] = useState<HighlightCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const chosen = useMemo(() => candidates.filter((c) => selected.has(c.id)), [candidates, selected]);
  const analyze = async () => {
    if (!native) { setMessage("Automatic video analysis is Android-only. Browser tests use mocked signals; no backend is called."); return; }
    if (durationSeconds > 3600) { setMessage("Videos longer than the 60-minute analysis limit are not supported."); return; }
    setMessage(""); setCandidates([]); setSelected(new Set()); setPhase("preparing");
    const listener = await NativeEditor.addListener("analysisProgress", (event) => setPhase(event.state));
    try {
      const signals = await NativeEditor.analyzeVideo({ uri, intervalMs: 1000, maxDurationMs: 3_600_000 });
      setPhase("scoring candidates");
      const found = analyzeHighlights({ points: signals.points, availability: signals.availability, durationMs: durationSeconds * 1000, durationMode, detectionMode });
      setCandidates(found); setPhase("completed");
      if (!found.length) setMessage("No strong highlight found.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Analysis failed.";
      setPhase(/cancel/i.test(text) ? "cancelled" : "failed"); setMessage(text);
    } finally { await listener.remove(); }
  };
  const exportMany = async () => {
    for (const candidate of chosen) {
      setStatuses((s) => ({ ...s, [candidate.id]: "Exporting…" }));
      try { await onExport([candidate]); setStatuses((s) => ({ ...s, [candidate.id]: "Exported" })); }
      catch { setStatuses((s) => ({ ...s, [candidate.id]: "Failed" })); }
    }
  };
  return <section aria-label="Automatic Highlights" className="mt-5 rounded-2xl border border-violet-400/20 bg-black/20 p-4 sm:p-5">
    <h3 className="font-semibold">Automatic Highlights</h3>
    <p className="mt-1 text-xs text-muted-foreground">Deterministic, on-device activity analysis. “Viral Confidence” is a heuristic highlight score—not a virality prediction.</p>
    <div className="mt-4 grid gap-5">
      <SegmentedControl<DurationMode> label="Target duration" value={durationMode} onChange={setDurationMode} options={[["30-plus","30+ sec"],["60-plus","60+ sec"],["auto","Auto"]]}/>
      <SegmentedControl<DetectionMode> label="Detection mode" value={detectionMode} onChange={setDetectionMode} options={[["conservative","Conservative"],["balanced","Balanced"],["aggressive","Aggressive"]]}/>
    </div>
    <div className="mt-4 flex flex-wrap gap-2"><Button disabled={disabled || !["idle", "completed", "failed", "cancelled"].includes(phase)} onClick={analyze}>Analyze Video</Button><Button variant="outline" disabled={["idle", "completed", "failed", "cancelled"].includes(phase)} onClick={() => NativeEditor.cancelAnalysis()}>Cancel Analysis</Button></div>
    {phase !== "idle" && <p aria-live="polite" className="mt-3 text-sm capitalize">Analysis: {phase}</p>}
    {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
    {candidates.length > 0 && <><div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setSelected(new Set(candidates.map((c) => c.id)))}>Select all</Button><Button variant="outline" onClick={() => setSelected(new Set())}>Clear selection</Button><Button disabled={!chosen.length} onClick={exportMany}>Export selected</Button></div>
      <div className="mt-3 grid gap-3">{candidates.map((candidate, index) => <article key={candidate.id} className={`rounded-xl border p-4 ${selected.has(candidate.id) ? "border-violet-400 bg-violet-400/[.06]" : "border-white/10"}`}>
        <div className="flex justify-between gap-3"><h4 className="font-semibold">Candidate {index + 1}</h4><StatusBadge tone="accent">Score {candidate.score}/100</StatusBadge></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`Highlight score ${candidate.score} out of 100`}><div className="h-full rounded-full bg-violet-400" style={{width: `${candidate.score}%`}}/></div>
        <p className="mt-1 font-mono text-sm">{clock(candidate.startMs)} – {clock(candidate.endMs)} · {clock(candidate.durationMs)}</p><p className="text-sm text-violet-300">Viral Confidence: {candidate.confidence}</p>
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Select candidate ${index + 1}`} checked={selected.has(candidate.id)} onChange={() => setSelected((old) => { const next = new Set(old); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next; })}/>Select</label><Button variant="outline" onClick={() => onAdjust(candidate)}>Preview</Button><Button variant="outline" onClick={() => onAdjust(candidate)}>Adjust manually</Button><Button onClick={() => onExport([candidate])}>Export</Button></div>{statuses[candidate.id] && <p className="mt-2 text-xs">{statuses[candidate.id]}</p>}
      </article>)}</div></>}
  </section>;
}
