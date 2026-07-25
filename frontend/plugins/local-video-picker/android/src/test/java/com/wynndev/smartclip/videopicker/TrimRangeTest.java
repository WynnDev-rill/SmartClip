package com.wynndev.smartclip.videopicker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class TrimRangeTest {
    @Test public void acceptsCommonAndVeryLongRanges() {
        assertNull(TrimRange.validationCode(0L, 1_366_000L, 1_366_000L));
        assertNull(TrimRange.validationCode(0L, 1_000L, 1_366_000L));
        assertNull(TrimRange.validationCode(0L, 10_000L, 1_366_000L));
        assertNull(TrimRange.validationCode(0L, 30_000L, 1_366_000L));
        assertNull(TrimRange.validationCode(3_600_000_000L, 3_600_010_000L, 7_200_000_000L));
    }

    @Test public void toleratesAndClampsSmallMetadataMismatch() {
        assertNull(TrimRange.validationCode(0L, 1_366_040L, 1_365_980L));
    }

    @Test public void returnsSpecificInvalidRangeCodes() {
        assertEquals("invalid_end", TrimRange.validationCode(0L, 0L, 20_000L));
        assertEquals("clip_too_short", TrimRange.validationCode(0L, 999L, 20_000L));
        assertEquals("invalid_start", TrimRange.validationCode(-1L, 2_000L, 20_000L));
        assertEquals("invalid_end", TrimRange.validationCode(0L, 21_000L, 20_000L));
    }
}
