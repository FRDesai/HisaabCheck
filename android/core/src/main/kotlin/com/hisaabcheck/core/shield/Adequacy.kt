package com.hisaabcheck.core.shield

import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.config.MIN_OCR_MEDIAN_CONFIDENCE
import com.hisaabcheck.core.config.MIN_OCR_WORDS

// Port of web/src/core/shield/adequacy.ts.

/**
 * True only when OCR read enough of the bill, well enough, for "the shield found nothing" to mean
 * "there is nothing to hide". When false, the caller must treat the shield as uncertain (human preview).
 */
fun ocrAdequate(words: List<OcrWord>): Boolean {
    if (words.size < MIN_OCR_WORDS) return false
    // Number.isFinite: NaN and both infinities count as 0.
    val c = words.map { if (it.confidence.jsIsFinite()) it.confidence else 0.0 }.sorted()
    val mid = c.size shr 1
    val median = if (c.size % 2 != 0) c[mid] else (c[mid - 1] + c[mid]) / 2
    return median >= MIN_OCR_MEDIAN_CONFIDENCE
}
