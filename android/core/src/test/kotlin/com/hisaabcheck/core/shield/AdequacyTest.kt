package com.hisaabcheck.core.shield

import com.hisaabcheck.core.config.MIN_OCR_MEDIAN_CONFIDENCE
import com.hisaabcheck.core.config.MIN_OCR_WORDS
import com.hisaabcheck.core.wordsFromLines
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of web/tests/core/adequacy.test.ts. */
class AdequacyTest {
    private fun words(n: Int, confidence: Double = 95.0) = wordsFromLines(listOf((0 until n).joinToString(" ") { "word$it" }), confidence)

    @Test
    fun `uses the agreed thresholds`() {
        assertEquals(15, MIN_OCR_WORDS)
        assertEquals(50.0, MIN_OCR_MEDIAN_CONFIDENCE)
    }

    @Test
    fun `is false for no words`() = assertFalse(ocrAdequate(emptyList()))

    @Test
    fun `is false for 14 words and true for 15`() {
        assertFalse(ocrAdequate(words(14)))
        assertTrue(ocrAdequate(words(15)))
    }

    @Test
    fun `is false when the median confidence is below 50`() {
        assertFalse(ocrAdequate(words(30, 49.0)))
        val mixed = words(10, 95.0) + words(11, 20.0) // median is a low one
        assertFalse(ocrAdequate(mixed))
    }

    @Test
    fun `is true for enough words with a median of 50 or more`() {
        assertTrue(ocrAdequate(words(20, 50.0)))
        assertTrue(ocrAdequate(words(11, 95.0) + words(10, 20.0)))
    }

    @Test
    fun `treats non-finite confidences as zero`() {
        assertFalse(ocrAdequate(words(20, Double.NaN)))
    }

    @Test
    fun infiniteConfidencesCountAsZero() {
        // Number.isFinite(Infinity) is false, so Infinity counts as 0, not as a high confidence.
        assertFalse(ocrAdequate(words(20, Double.POSITIVE_INFINITY)))
        assertTrue(ocrAdequate(words(11, 95.0) + words(10, Double.POSITIVE_INFINITY)))
        assertFalse(ocrAdequate(words(10, 95.0) + words(11, Double.POSITIVE_INFINITY)))
    }

    @Test
    fun evenCountUsesTheMeanOfTheMiddleTwo() {
        // 16 words: eight at 40 and eight at 60 give a median of 50.
        assertTrue(ocrAdequate(words(8, 40.0) + words(8, 60.0)))
        assertFalse(ocrAdequate(words(8, 40.0) + words(8, 59.0)))
    }
}
