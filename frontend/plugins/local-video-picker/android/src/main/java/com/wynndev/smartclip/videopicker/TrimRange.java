package com.wynndev.smartclip.videopicker;

final class TrimRange {
    static final long MINIMUM_MS = 1_000L;
    static final long DURATION_TOLERANCE_MS = 500L;
    final long startMs;
    final long endMs;

    TrimRange(long startMs, long endMs) { this.startMs = startMs; this.endMs = endMs; }

    static String validationCode(Long startMs, Long endMs, long durationMs) {
        if (startMs == null || startMs < 0 || startMs >= durationMs) return "invalid_start";
        if (endMs == null || endMs <= startMs || endMs > durationMs + DURATION_TOLERANCE_MS) return "invalid_end";
        if (Math.min(endMs, durationMs) - startMs < MINIMUM_MS) return "clip_too_short";
        return null;
    }
}
