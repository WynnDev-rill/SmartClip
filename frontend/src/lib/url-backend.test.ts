import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError, SmartClipBackendClient, isPublicHttpUrl } from "./url-backend";

describe("URL backend client", () => {
  afterEach(() => vi.restoreAllMocks());
  it("validates only HTTP URLs", () => { expect(isPublicHttpUrl("https://example.com/v")).toBe(true); expect(isPublicHttpUrl("file:///secret")).toBe(false); expect(isPublicHttpUrl("nope")).toBe(false); });
  it("reports missing configuration without a request", async () => { const fetch = vi.spyOn(globalThis, "fetch"); await expect(new SmartClipBackendClient("https://service", "").inspect("https://example.com")).rejects.toThrow("not configured"); expect(fetch).not.toHaveBeenCalled(); });
  it("adds authentication and parses inspection", async () => { vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ title:"Video", qualityOptions:[], warnings:[], separateAudioVideo:false }), { status:200 })); const result=await new SmartClipBackendClient("https://service", "private-test-token").inspect("https://example.com"); expect(result.title).toBe("Video"); expect(fetch).toHaveBeenCalledWith("https://service/api/url/inspect", expect.objectContaining({ headers: expect.objectContaining({ Authorization:"Bearer private-test-token" }) })); });
  it("maps authentication and conflict errors without leaking the token", async () => { for (const [status,text] of [[401,"authentication"],[409,"Another URL"]] as const) { vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({detail:{message:"bad"}}),{status})); const error=await new SmartClipBackendClient("https://service","very-secret").createJob({url:"https://example.com",durationMode:"auto",detectionMode:"balanced",outputQuality:"auto",layoutMode:"smart-crop",maximumCandidates:1}).catch((e: BackendError)=>e) as BackendError; expect(error.message).toContain(text); expect(error.message).not.toContain("very-secret"); } });
});
