export type DurationMode = "30-plus" | "60-plus" | "auto";
export type DetectionMode = "conservative" | "balanced" | "aggressive";
export type Confidence = "Very High" | "High" | "Medium" | "Low";

export interface SignalPoint { timeMs: number; audio: number; motion: number; scene: number }
export interface SignalAvailability { audio: boolean; motion: boolean; scene: boolean }
export interface ScoreBreakdown {
  audioStrength: number; motionStrength: number; sceneRelevance: number;
  continuity: number; cleanStart: number; cleanEnd: number;
  durationSuitability: number; incompleteEndingPenalty: number;
  repetitionPenalty: number; lowActivityPenalty: number; signalFailurePenalty: number;
}
export interface HighlightCandidate {
  id: string; startMs: number; endMs: number; durationMs: number; score: number;
  confidence: Confidence; reasons: string[]; signalBreakdown: ScoreBreakdown;
  peakTimeMs: number; endingExtended: boolean; naturalEnding: boolean;
}
export interface AnalysisInput { points: SignalPoint[]; durationMs: number; durationMode: DurationMode; detectionMode: DetectionMode; availability?: SignalAvailability }

export const MODE_CONFIG = {
  conservative: { threshold: 70, max: 3, leadMs: 10_000, cooldownMs: 6_000 },
  balanced: { threshold: 55, max: 5, leadMs: 7_000, cooldownMs: 4_000 },
  aggressive: { threshold: 45, max: 8, leadMs: 4_000, cooldownMs: 3_000 },
} as const;

export function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const finite = values.map((v) => Number.isFinite(v) ? v : 0);
  const min = Math.min(...finite), max = Math.max(...finite);
  if (max === min) return finite.map(() => max > 0 ? 1 : 0);
  return finite.map((v) => (v - min) / (max - min));
}

export function normalizeSignals(points: SignalPoint[]): SignalPoint[] {
  const audio = normalize(points.map((p) => p.audio));
  const motion = normalize(points.map((p) => p.motion));
  const scene = normalize(points.map((p) => p.scene));
  return points.map((p, i) => ({ timeMs: p.timeMs, audio: audio[i], motion: motion[i], scene: scene[i] }));
}

const activity = (p: SignalPoint) => p.audio * .45 + p.motion * .4 + p.scene * .15;
export function detectPeaks(points: SignalPoint[], minimum = .55): number[] {
  return points.map(activity).map((value, i) => ({ value, i }))
    .filter(({ value, i }, _x, all) => value >= minimum && value >= (all[i - 1]?.value ?? -1) && value > (all[i + 1]?.value ?? -1))
    .map(({ i }) => i);
}

export function durationBounds(mode: DurationMode) {
  if (mode === "30-plus") return { preferredMin: 30_000, preferredMax: 50_000, hardMin: 20_000, hardMax: 75_000 };
  if (mode === "60-plus") return { preferredMin: 60_000, preferredMax: 90_000, hardMin: 45_000, hardMax: 120_000 };
  return { preferredMin: 20_000, preferredMax: 90_000, hardMin: 15_000, hardMax: 105_000 };
}

function nearestIndex(points: SignalPoint[], time: number) { return points.reduce((best, p, i) => Math.abs(p.timeMs - time) < Math.abs(points[best].timeMs - time) ? i : best, 0); }
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

export function adjustNaturalWindow(points: SignalPoint[], peakIndex: number, mode: DurationMode, detectionMode: DetectionMode, durationMs: number) {
  const bounds = durationBounds(mode), config = MODE_CONFIG[detectionMode], peak = points[peakIndex];
  let start = Math.max(0, peak.timeMs - Math.max(config.leadMs, bounds.preferredMin * .45));
  let end = Math.min(durationMs, peak.timeMs + Math.max(config.cooldownMs, bounds.preferredMin * .55));
  const before = points.slice(0, peakIndex).reverse().find((p) => p.timeMs >= start - config.leadMs && (activity(p) < .25 || p.scene > .75));
  if (before) start = Math.max(0, before.timeMs + (before.scene > .75 ? 750 : 0));
  const minimumEnd = start + bounds.preferredMin;
  end = Math.max(end, minimumEnd);
  const after = points.slice(peakIndex + 1).find((p) => p.timeMs >= minimumEnd && (activity(p) < .28 || p.scene > .78));
  if (after) end = Math.min(durationMs, after.timeMs + (after.scene > .78 ? 750 : config.cooldownMs));
  end = Math.min(end, start + bounds.hardMax, durationMs);
  let endIndex = nearestIndex(points, end), endingExtended = false;
  const incomplete = endIndex > 0 && activity(points[endIndex]) > .58 && activity(points[endIndex]) >= activity(points[endIndex - 1]);
  if (incomplete) {
    const safe = points.slice(endIndex + 1).find((p) => p.timeMs <= start + bounds.hardMax && (activity(p) < .3 || p.scene > .8));
    if (safe) { end = Math.min(durationMs, safe.timeMs + config.cooldownMs); endIndex = nearestIndex(points, end); endingExtended = true; }
  }
  const naturalEnding = !(activity(points[endIndex]) > .62 && end < durationMs - 500);
  return { startMs: Math.round(start), endMs: Math.round(end), endingExtended, naturalEnding };
}

export function scoreCandidate(points: SignalPoint[], startMs: number, endMs: number, peakIndex: number, mode: DurationMode, naturalEnding: boolean, availability: SignalAvailability = { audio: true, motion: true, scene: true }): { score: number; breakdown: ScoreBreakdown; reasons: string[] } {
  const window = points.filter((p) => p.timeMs >= startMs && p.timeMs <= endMs), peak = points[peakIndex];
  const first = window.slice(0, Math.max(1, Math.ceil(window.length * .15))), last = window.slice(-Math.max(1, Math.ceil(window.length * .15)));
  const active = window.map(activity), bounds = durationBounds(mode), duration = endMs - startMs;
  const suitability = duration >= bounds.preferredMin && duration <= bounds.preferredMax ? 1 : Math.max(0, 1 - Math.min(Math.abs(duration - bounds.preferredMin), Math.abs(duration - bounds.preferredMax)) / bounds.preferredMin);
  const components = {
    audioStrength: availability.audio ? peak.audio * 22 : 0,
    motionStrength: availability.motion ? peak.motion * 20 : 0,
    sceneRelevance: availability.scene ? Math.min(1, mean(window.map((p) => p.scene)) * 2) * 8 : 0,
    continuity: Math.min(1, mean(active) * 1.8) * 14,
    cleanStart: Math.max(0, 1 - mean(first.map(activity))) * 8,
    cleanEnd: Math.max(0, 1 - mean(last.map(activity))) * 12,
    durationSuitability: suitability * 10,
    incompleteEndingPenalty: naturalEnding ? 0 : -25,
    repetitionPenalty: active.length > 3 && Math.max(...active) - Math.min(...active) < .08 ? -8 : 0,
    lowActivityPenalty: mean(active) < .25 ? -15 : 0,
    signalFailurePenalty: -(3 - Object.values(availability).filter(Boolean).length) * 6,
  };
  const score = Math.max(0, Math.min(100, Math.round(Object.values(components).reduce((a, b) => a + b, 0))));
  const reasons = [peak.audio > .65 && availability.audio ? "Strong audio energy" : "", peak.motion > .65 && availability.motion ? "High visual activity" : "", mean(window.map((p) => p.scene)) > .25 && availability.scene ? "Relevant scene changes" : "", naturalEnding ? "Activity settles at a natural ending" : ""].filter(Boolean);
  if (Object.values(availability).some((v) => !v)) reasons.push("Confidence reduced because a signal was unavailable");
  return { score, breakdown: components, reasons };
}

export function confidenceLabel(score: number): Confidence { return score >= 85 ? "Very High" : score >= 70 ? "High" : score >= 50 ? "Medium" : "Low"; }
export function overlapRatio(a: HighlightCandidate, b: HighlightCandidate) { const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs)); return overlap / Math.min(a.durationMs, b.durationMs); }
export function suppressOverlaps(candidates: HighlightCandidate[]) {
  return [...candidates].sort((a, b) => b.score - a.score || a.startMs - b.startMs).reduce<HighlightCandidate[]>((kept, candidate) => {
    if (!kept.some((other) => overlapRatio(other, candidate) >= .65 || (Math.abs(other.peakTimeMs - candidate.peakTimeMs) < 3_000))) kept.push(candidate);
    return kept;
  }, []);
}

export function analyzeHighlights(input: AnalysisInput): HighlightCandidate[] {
  if (input.durationMs <= 0 || input.durationMs > 3_600_000 || input.points.length < 3) return [];
  const points = normalizeSignals(input.points), availability = input.availability ?? { audio: true, motion: true, scene: true }, config = MODE_CONFIG[input.detectionMode];
  const candidates = detectPeaks(points, input.detectionMode === "aggressive" ? .45 : input.detectionMode === "balanced" ? .52 : .62).map((peakIndex) => {
    const adjusted = adjustNaturalWindow(points, peakIndex, input.durationMode, input.detectionMode, input.durationMs);
    const scored = scoreCandidate(points, adjusted.startMs, adjusted.endMs, peakIndex, input.durationMode, adjusted.naturalEnding, availability);
    return { id: `highlight-${points[peakIndex].timeMs}`, ...adjusted, durationMs: adjusted.endMs - adjusted.startMs, score: scored.score, confidence: confidenceLabel(scored.score), reasons: scored.reasons, signalBreakdown: scored.breakdown, peakTimeMs: points[peakIndex].timeMs };
  }).filter((c) => c.naturalEnding && c.score >= config.threshold && c.durationMs >= durationBounds(input.durationMode).hardMin);
  return suppressOverlaps(candidates).slice(0, config.max).sort((a, b) => a.startMs - b.startMs);
}
