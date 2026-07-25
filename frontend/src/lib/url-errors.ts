import type { TranslationKey } from "@/i18n";

export const urlErrorKeys = {
  youtube_bot_challenge: "youtubeBotChallenge",
  youtube_client_blocked: "youtubeClientBlocked",
  po_token_required: "poTokenRequired",
  unsupported_url: "unsupportedUrl",
  video_unavailable: "videoUnavailable",
  private_video: "privateVideo",
  login_required: "loginRequired",
  age_restricted: "ageRestricted",
  geo_restricted: "geoRestricted",
  extractor_failure: "extractorFailure",
  extractor_outdated: "extractorOutdated",
  inspection_timeout: "inspectionTimeout",
  network_failure: "networkFailure",
  malformed_metadata: "malformedMetadata",
} as const;

type Translator = (key: TranslationKey) => string;

export const localizedJobFailure = (
  code: string | null | undefined,
  fallback: string | null | undefined,
  t: Translator,
) =>
  code && code in urlErrorKeys
    ? t(urlErrorKeys[code as keyof typeof urlErrorKeys])
    : fallback || t("processingFailed");
