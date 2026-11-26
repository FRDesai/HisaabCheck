package com.hisaabcheck.core.redact

import com.hisaabcheck.core.Box
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.RedactionPlan
import com.hisaabcheck.core.ShieldResult

// Port of web/src/core/redact/planRedaction.ts.

/** Math.min(...xs): Infinity for none, NaN if any is NaN (java.lang.Math.min propagates NaN the same way). */
private fun jsMin(xs: List<Double>): Double = xs.fold(Double.POSITIVE_INFINITY) { a, b -> Math.min(a, b) }

/** Math.max(...xs): -Infinity for none, NaN if any is NaN. */
private fun jsMax(xs: List<Double>): Double = xs.fold(Double.NEGATIVE_INFINITY) { a, b -> Math.max(a, b) }

fun planRedaction(words: List<OcrWord>, shield: ShieldResult, width: Int, height: Int, pad: Double = 4.0): RedactionPlan {
    val boxes = shield.matches.map { m ->
        val bs = m.wordIndexes.map { words[it].bbox }
        Box(
            x0 = Math.max(0.0, jsMin(bs.map { it.x0 }) - pad),
            y0 = Math.max(0.0, jsMin(bs.map { it.y0 }) - pad),
            x1 = Math.min(width.toDouble(), jsMax(bs.map { it.x1 }) + pad),
            y1 = Math.min(height.toDouble(), jsMax(bs.map { it.y1 }) + pad),
        )
    }
    val piiTypes = shield.matches.map { it.type }.distinct() // first-seen order, like [...new Set(...)]
    return RedactionPlan(boxes, piiTypes, shield.matches.size)
}
