import { describe, expect, it } from "vitest";
import { isSupportedVideo } from "./video-picker";

describe("supported local video formats", () => {
  it.each(["clip.mp4", "clip.MOV", "clip.mkv", "clip.webm"])("accepts %s", name => expect(isSupportedVideo(name)).toBe(true));
  it("rejects unsupported extensions", () => expect(isSupportedVideo("clip.avi")).toBe(false));
});
