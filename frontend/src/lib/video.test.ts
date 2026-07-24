import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_SIZE_BYTES, validateVideo } from "./video";

describe("validateVideo", () => {
  it("accepts supported video files", () => expect(validateVideo(new File(["x"], "clip.mp4"))).toBeNull());
  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateVideo(new File(["x"], "clip.avi"))).toMatch(/MP4/);
    expect(validateVideo(new File([], "clip.webm"))).toMatch(/empty/);
    const large = new File(["x"], "large.mov");
    Object.defineProperty(large, "size", { value: MAX_UPLOAD_SIZE_BYTES + 1 });
    expect(validateVideo(large)).toMatch(/2 GB/);
  });
});
