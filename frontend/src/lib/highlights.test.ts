import { describe, expect, it } from "vitest";
import { analyzeHighlights, confidenceLabel, detectPeaks, durationBounds, MODE_CONFIG, normalize, scoreCandidate, suppressOverlaps, type HighlightCandidate, type SignalPoint } from "./highlights";

const points = (count = 100): SignalPoint[] => Array.from({ length: count }, (_, i) => ({ timeMs: i * 1000, audio: i >= 30 && i <= 55 ? 8 - Math.abs(42-i)/8 : .2, motion: i >= 28 && i <= 56 ? 7 - Math.abs(42-i)/9 : .1, scene: i === 27 || i === 58 ? 5 : 0 }));

describe("highlight engine", () => {
  it("normalizes finite signals deterministically", () => { expect(normalize([2, 4, 6])).toEqual([0, .5, 1]); expect(normalize([3, 3])).toEqual([1, 1]); });
  it("detects local activity peaks", () => expect(detectPeaks([{timeMs:0,audio:0,motion:0,scene:0},{timeMs:1,audio:1,motion:1,scene:0},{timeMs:2,audio:0,motion:0,scene:0}])).toEqual([1]));
  it("uses flexible duration categories", () => { expect(durationBounds("30-plus").preferredMax).toBe(50_000); expect(durationBounds("60-plus").hardMax).toBe(120_000); });
  it("defines mode thresholds and limits", () => { expect(MODE_CONFIG.conservative).toMatchObject({threshold:70,max:3}); expect(MODE_CONFIG.aggressive).toMatchObject({threshold:45,max:8}); });
  it("maps confidence labels", () => { expect([49,50,70,85].map(confidenceLabel)).toEqual(["Low","Medium","High","Very High"]); });
  it("scores deterministically and penalizes signal failure", () => { const normalized=points(70).map((p)=>({...p,audio:Math.min(1,p.audio/8),motion:Math.min(1,p.motion/7),scene:Math.min(1,p.scene/5)})); const full=scoreCandidate(normalized,20_000,65_000,42,"30-plus",true); const partial=scoreCandidate(normalized,20_000,65_000,42,"30-plus",true,{audio:false,motion:true,scene:true}); expect(full.score).toBe(scoreCandidate(normalized,20_000,65_000,42,"30-plus",true).score); expect(partial.score).toBeLessThan(full.score); });
  it("finds a naturally completed candidate", () => { const result=analyzeHighlights({points:points(),durationMs:100_000,durationMode:"30-plus",detectionMode:"aggressive"}); expect(result.length).toBeGreaterThan(0); expect(result[0].naturalEnding).toBe(true); expect(result[0].durationMs).toBeGreaterThanOrEqual(20_000); });
  it("returns no highlight for flat low activity", () => expect(analyzeHighlights({points:Array.from({length:50},(_,i)=>({timeMs:i*1000,audio:0,motion:0,scene:0})),durationMs:50_000,durationMode:"auto",detectionMode:"aggressive"})).toEqual([]));
  it("rejects over-limit sources", () => expect(analyzeHighlights({points:points(),durationMs:3_600_001,durationMode:"auto",detectionMode:"balanced"})).toEqual([]));
  it("suppresses duplicate and highly overlapping windows", () => { const base: HighlightCandidate={id:"a",startMs:0,endMs:40_000,durationMs:40_000,score:80,confidence:"High",reasons:[],signalBreakdown:{} as HighlightCandidate["signalBreakdown"],peakTimeMs:20_000,endingExtended:false,naturalEnding:true}; expect(suppressOverlaps([base,{...base,id:"b",score:70,startMs:1000,endMs:41000}])).toHaveLength(1); });
  it("respects maximum candidate counts", () => { for (const mode of ["conservative","balanced","aggressive"] as const) expect(analyzeHighlights({points:points(600),durationMs:600_000,durationMode:"auto",detectionMode:mode}).length).toBeLessThanOrEqual(MODE_CONFIG[mode].max); });
});
