import { describe, expect, it } from "vitest";
import { translate, type Locale, type TranslationKey } from "@/i18n";
import { localizedJobFailure } from "@/lib/url-errors";

const translator = (locale: Locale) => (key: TranslationKey) => translate(locale, key);

describe("asynchronous URL job error localization", () => {
  it("localizes an Indonesian anti-bot failure instead of using backend English", () => {
    const message = localizedJobFailure(
      "youtube_bot_challenge",
      "YouTube rejected the server request because of an anti-bot check.",
      translator("id"),
    );
    expect(message).toContain("YouTube menolak permintaan");
    expect(message).not.toContain("rejected the server");
  });

  it.each([
    ["age_restricted", "dibatasi usia"],
    ["geo_restricted", "wilayah server"],
  ])("localizes Indonesian %s jobs", (code, expected) => {
    expect(localizedJobFailure(code, "Raw English backend message", translator("id"))).toContain(
      expected,
    );
  });

  it("uses the English translation in English mode", () => {
    expect(
      localizedJobFailure("age_restricted", "Raw backend message", translator("en")),
    ).toBe("This video is age restricted.");
  });

  it("uses the backend message only for an unknown code", () => {
    expect(localizedJobFailure("future_error", "Future safe message", translator("id"))).toBe(
      "Future safe message",
    );
  });
});
