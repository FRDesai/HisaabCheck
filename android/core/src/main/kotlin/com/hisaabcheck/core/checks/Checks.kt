package com.hisaabcheck.core.checks

import com.hisaabcheck.core.CheckResult
import com.hisaabcheck.core.Checks
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.shield.gstinStateCode
import com.hisaabcheck.core.shield.isValidGstin
import com.hisaabcheck.core.shield.jsNumber
import com.hisaabcheck.core.shield.jsNumberToString
import com.hisaabcheck.core.shield.placeOfSupplyCode
import java.time.Instant
import java.time.LocalDate
import kotlin.math.abs

// Port of web/src/core/checks/checks.ts. Sums run in the same order as the TypeScript so the doubles are identical.

data class Weights(val total: Double, val gstin: Double, val taxSplit: Double, val date: Double, val required: Double, val model: Double)

val WEIGHTS = Weights(total = 0.35, gstin = 0.25, taxSplit = 0.15, date = 0.1, required = 0.1, model = 0.05)

private fun totalOk(e: Extraction, tol: Double): Boolean {
    val tax = e.cgst + e.sgst + e.igst
    val base = if (e.items != null && e.items.isNotEmpty()) e.items.fold(0.0) { s, i -> s + i.amount } else e.taxableValue
    return e.total > 0 && abs(base + tax - e.total) <= tol
}

private fun taxSplitOk(e: Extraction, gstinValid: Boolean): Boolean {
    if (!gstinValid) return false
    // Primitive Double comparisons, so -0.0 == 0.0 as in JavaScript.
    val allZero = e.cgst == 0.0 && e.sgst == 0.0 && e.igst == 0.0
    val split = e.cgst > 0 && abs(e.cgst - e.sgst) <= 1 && e.igst == 0.0
    val igstOnly = e.cgst == 0.0 && e.sgst == 0.0 && e.igst > 0
    val pos = placeOfSupplyCode(e.placeOfSupply) ?: return allZero || split || igstOnly
    val sameState = pos.toDouble() == gstinStateCode(e.supplierGstin)
    return allZero || (if (sameState) split else igstOnly)
}

private const val IST_OFFSET_MS = 19_800_000L // 5.5 * 3600e3
private const val JS_DATE_LIMIT_MS = 8_640_000_000_000_000L

/** new Date(ms).toISOString(): a 4-digit year in 0..9999, otherwise a signed 6-digit year; throws outside the Date range. */
private fun jsIsoDate(ms: Long): String {
    if (ms > JS_DATE_LIMIT_MS || ms < -JS_DATE_LIMIT_MS) throw IllegalArgumentException("Invalid time value") // RangeError
    val d = LocalDate.ofEpochDay(Math.floorDiv(ms, 86_400_000L))
    val y = d.year
    val year = if (y in 0..9999) y.toString().padStart(4, '0') else (if (y < 0) "-" else "+") + abs(y).toString().padStart(6, '0')
    return "$year-${d.monthValue.toString().padStart(2, '0')}-${d.dayOfMonth.toString().padStart(2, '0')}"
}

/** IST calendar date (YYYY-MM-DD) for the given instant: new Date(now + IST).toISOString().slice(0, 10). */
private fun istDate(now: Instant): String = jsIsoDate(Math.addExact(now.toEpochMilli(), IST_OFFSET_MS)).take(10)

private val ISO_DATE = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}") // used with matches(): /^\d{4}-\d{2}-\d{2}$/

/** new Date(`${d}T00:00:00Z`) is a valid date whose ISO form starts with d: a real proleptic-Gregorian calendar date. */
private fun isRealDate(d: String): Boolean = try {
    LocalDate.of(d.substring(0, 4).toInt(), d.substring(5, 7).toInt(), d.substring(8, 10).toInt())
    true
} catch (_: java.time.DateTimeException) {
    false
}

private fun dateOk(d: String, today: Instant): Boolean {
    if (!ISO_DATE.matches(d)) return false
    if (!isRealDate(d)) return false
    val todayStr = istDate(today)
    val minStr = jsNumberToString(jsNumber(todayStr.take(4)) - 3) + todayStr.drop(4)
    return d <= todayStr && d >= minStr
}

fun runChecks(e: Extraction, cfg: Config, today: Instant): CheckResult {
    val gstin = isValidGstin(e.supplierGstin)
    val checks = Checks(
        total = totalOk(e, cfg.totalToleranceInr),
        gstin = gstin,
        taxSplit = taxSplitOk(e, gstin),
        date = dateOk(e.invoiceDate, today),
        required = listOf(e.supplierName, e.supplierGstin, e.invoiceNo, e.invoiceDate).all { it.isNotEmpty() } && e.total > 0,
    )
    // Key order of the Checks object: total, gstin, taxSplit, date, required.
    var score = WEIGHTS.model * e.confidence
    if (checks.total) score += WEIGHTS.total
    if (checks.gstin) score += WEIGHTS.gstin
    if (checks.taxSplit) score += WEIGHTS.taxSplit
    if (checks.date) score += WEIGHTS.date
    if (checks.required) score += WEIGHTS.required
    val hardFail = if (!checks.total) Reason.TOTAL_MISMATCH else if (!checks.gstin) Reason.INVALID_GSTIN else null
    return CheckResult(checks, score, hardFail, hardFail != null || score < cfg.confidenceThreshold)
}
