package com.hisaabcheck.core.checks

import com.hisaabcheck.core.config.parseConfig
import com.hisaabcheck.core.readRepoJson
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.time.Instant

/** Port of the non-vector part of web/tests/core/checks.test.ts ("date check in IST"), plus Kotlin-only pins. */
class ChecksTest {
    private val cfg = parseConfig(emptyMap(), false)
    private val base = extractionOf(readRepoJson("shared/test-vectors/bills.json").jsonArray[0].jsonObject.getValue("bill").jsonObject)

    @TestFactory
    fun `date check in IST`(): List<DynamicTest> = listOf(
        listOf("just after IST midnight accepts today (IST date)", "2026-11-21T02:00:00+05:30", "2026-11-21", true),
        listOf("just after IST midnight rejects tomorrow", "2026-11-21T02:00:00+05:30", "2026-11-22", false),
        listOf("exact 3-year boundary accepted", "2026-11-20T10:00:00+05:30", "2023-11-20", true),
        listOf("older than 3 years rejected", "2026-11-20T10:00:00+05:30", "2023-11-19", false),
        listOf("impossible calendar date rejected", "2026-11-20T10:00:00+05:30", "2026-02-30", false),
    ).map { (name, now, invoiceDate, expected) ->
        DynamicTest.dynamicTest(name as String) {
            val r = runChecks(base.copy(invoiceDate = invoiceDate as String), cfg, Instant.parse(now as String))
            assertEquals(expected, r.checks.date)
        }
    }

    // ---- Kotlin-only pins of JavaScript behaviour ----

    @Test
    fun weightsMatchTheWeb() {
        assertEquals(Weights(total = 0.35, gstin = 0.25, taxSplit = 0.15, date = 0.1, required = 0.1, model = 0.05), WEIGHTS)
    }

    @Test
    fun dateWithTrailingNewlineIsRejectedLikeJavaScriptDollar() {
        val today = Instant.parse("2026-11-20T04:30:00Z")
        assertFalse(runChecks(base.copy(invoiceDate = "2026-11-02\n"), cfg, today).checks.date)
        assertTrue(runChecks(base.copy(invoiceDate = "2026-11-02"), cfg, today).checks.date)
    }

    @Test
    fun leapDayAndBadMonthOrDay() {
        val today = Instant.parse("2026-11-20T04:30:00Z")
        assertTrue(runChecks(base.copy(invoiceDate = "2024-02-29"), cfg, today).checks.date)
        assertFalse(runChecks(base.copy(invoiceDate = "2025-02-29"), cfg, today).checks.date)
        assertFalse(runChecks(base.copy(invoiceDate = "2026-13-01"), cfg, today).checks.date)
        assertFalse(runChecks(base.copy(invoiceDate = "2026-00-10"), cfg, today).checks.date)
        assertFalse(runChecks(base.copy(invoiceDate = "2026-11-00"), cfg, today).checks.date)
        // Non-ASCII digits are not \d in JavaScript.
        assertFalse(runChecks(base.copy(invoiceDate = "2026-11-0\u0662"), cfg, today).checks.date)
    }

    @Test
    fun negativeZeroTaxesCountAsZero() {
        // JavaScript: -0 === 0. A boxed Kotlin comparison would get this wrong.
        val e = base.copy(items = null, taxableValue = 1500.0, cgst = -0.0, sgst = -0.0, igst = 0.0, total = 1500.0)
        assertTrue(runChecks(e, cfg, Instant.parse("2026-11-20T04:30:00Z")).checks.taxSplit)
    }

    @Test
    fun emptyItemsFallBackToTaxableValue() {
        val e = base.copy(items = emptyList(), taxableValue = 1500.0)
        assertTrue(runChecks(e, cfg, Instant.parse("2026-11-20T04:30:00Z")).checks.total)
    }

    @Test
    fun nanConfidenceGivesNanScoreAndDoesNotEscalateLikeJavaScript() {
        // JavaScript: NaN < 0.8 is false, so a passing bill with a NaN confidence is not escalated.
        // parseExtraction never yields a NaN confidence (it clamps a finite number), so this cannot come from a model.
        val r = runChecks(base.copy(confidence = Double.NaN), cfg, Instant.parse("2026-11-20T04:30:00Z"))
        assertTrue(r.score.isNaN())
        assertFalse(r.escalate)
    }
}
