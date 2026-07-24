import { describe, expect, it } from "vitest";
import { presetRange, validateTrim } from "./trim";

describe("trim ranges", () => {
  it("accepts a valid range", () => expect(validateTrim({ start: 2, end: 12 }, 20)).toBeNull());
  it.each([{ start: -1, end: 2 }, { start: 2, end: 2 }, { start: 3, end: 2 }, { start: 0, end: 21 }, { start: 1, end: 1.5 }])("rejects invalid range $start–$end", range => expect(validateTrim(range, 20)).not.toBeNull());
  it("creates bounded duration presets", () => {
    expect(presetRange(10, 8)).toEqual({ start: 0, end: 8 });
    expect(presetRange(15, 60)).toEqual({ start: 0, end: 15 });
    expect(presetRange(30, 60)).toEqual({ start: 0, end: 30 });
    expect(presetRange("full", 60)).toEqual({ start: 0, end: 60 });
  });
});
