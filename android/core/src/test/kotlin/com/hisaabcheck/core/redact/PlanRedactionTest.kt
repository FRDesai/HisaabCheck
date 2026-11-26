package com.hisaabcheck.core.redact

import com.hisaabcheck.core.Box
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.PiiMatch
import com.hisaabcheck.core.PiiType
import com.hisaabcheck.core.ShieldResult
import com.hisaabcheck.core.shield.runShield
import com.hisaabcheck.core.wordsFromLines
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of web/tests/core/planRedaction.test.ts. */
class PlanRedactionTest {
    @Test
    fun `unions the words of one match and pads, clamped to the image`() {
        val words = wordsFromLines(listOf("Aadhaar No 2341 2341 2346"))
        val plan = planRedaction(words, runShield(words, 0.6), 1000, 1000)
        assertEquals(1, plan.boxes.size)
        val first = words[2].bbox
        val last = words[4].bbox
        assertEquals(Box(if (first.x0 - 4 < 0) 0.0 else first.x0 - 4, 0.0, last.x1 + 4, last.y1 + 4), plan.boxes[0])
        assertEquals(listOf(PiiType.AADHAAR), plan.piiTypes)
        assertEquals(1, plan.piiMasked)
    }

    @Test
    fun `produces no boxes for a GSTIN-only bill`() {
        val words = wordsFromLines(listOf("GSTIN 27AAPFU0939F1ZV"))
        assertEquals(emptyList<Box>(), planRedaction(words, runShield(words, 0.6), 1000, 1000).boxes)
    }

    @Test
    fun `lists each type once`() {
        val words = wordsFromLines(listOf("PAN AAPFU0939F", "PAN BBBPB1234C"))
        val plan = planRedaction(words, runShield(words, 0.6), 1000, 1000)
        assertEquals(listOf(PiiType.PAN), plan.piiTypes)
        assertEquals(2, plan.piiMasked)
    }

    // ---- Kotlin-only pins of JavaScript semantics ----

    private fun w(x0: Double, y0: Double, x1: Double, y1: Double) = OcrWord("x", Box(x0, y0, x1, y1), 95.0, 0)

    @Test
    fun clampsToTheImageOnEverySide() {
        val words = listOf(w(2.0, 1.0, 98.0, 49.0))
        val plan = planRedaction(words, ShieldResult(emptyList(), listOf(PiiMatch(PiiType.PAN, listOf(0))), false, emptyList()), 100, 50)
        assertEquals(listOf(Box(0.0, 0.0, 100.0, 50.0)), plan.boxes)
        val custom = planRedaction(words, ShieldResult(emptyList(), listOf(PiiMatch(PiiType.PAN, listOf(0))), false, emptyList()), 100, 50, pad = 1.0)
        assertEquals(listOf(Box(1.0, 0.0, 99.0, 50.0)), custom.boxes)
    }

    @Test
    fun typesKeepFirstSeenOrder() {
        val words = listOf(w(0.0, 0.0, 1.0, 1.0))
        val matches = listOf(PiiType.PHONE, PiiType.PAN, PiiType.PHONE, PiiType.IFSC).map { PiiMatch(it, listOf(0)) }
        val plan = planRedaction(words, ShieldResult(emptyList(), matches, false, emptyList()), 10, 10)
        assertEquals(listOf(PiiType.PHONE, PiiType.PAN, PiiType.IFSC), plan.piiTypes)
        assertEquals(4, plan.piiMasked)
    }

    @Test
    fun emptyWordListGivesTheJavaScriptInfiniteBox() {
        // Math.min(...[]) is Infinity and Math.max(...[]) is -Infinity in JavaScript.
        val plan = planRedaction(emptyList(), ShieldResult(emptyList(), listOf(PiiMatch(PiiType.PAN, emptyList())), false, emptyList()), 10, 10)
        assertEquals(
            listOf(Box(Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY)),
            plan.boxes,
        )
    }

    @Test
    fun nanCoordinatesPropagateLikeJavaScriptMathMinMax() {
        val words = listOf(w(Double.NaN, 5.0, 8.0, 9.0), w(1.0, 2.0, 3.0, 4.0))
        val plan = planRedaction(words, ShieldResult(emptyList(), listOf(PiiMatch(PiiType.PAN, listOf(0, 1))), false, emptyList()), 100, 100)
        val b = plan.boxes.single()
        assertTrue(b.x0.isNaN())
        assertEquals(Box(b.x0, 0.0, 12.0, 13.0), b)
    }
}
