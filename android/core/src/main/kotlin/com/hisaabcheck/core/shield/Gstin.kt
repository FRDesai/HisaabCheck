package com.hisaabcheck.core.shield

import kotlin.math.floor

// Port of web/src/core/shield/gstin.ts.

private const val CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** Whole-string match (JavaScript ^...$ without the m flag; Java's $ would also accept a trailing line break). */
private val SHAPE = Regex("[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")

/** Unanchored, for finding GSTINs in upper-cased text. */
val GSTIN_PATTERN: Regex = Regex("$JS_B[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$JS_B")

fun gstinCheckChar(first14: String): String {
    var sum = 0
    for (i in 0 until 14) {
        // first14[i] past the end is undefined in JavaScript, and indexOf of it is -1.
        val p = (if (i < first14.length) CHARS.indexOf(first14[i]) else -1) * (if (i % 2 != 0) 2 else 1)
        sum += floor(p / 36.0).toInt() + (p % 36) // Kotlin %, like JavaScript %, keeps the dividend's sign
    }
    return CHARS[(36 - (sum % 36)) % 36].toString()
}

/** Number(g.slice(0, 2)): NaN or a fraction for malformed input, exactly as JavaScript. */
fun gstinStateCode(g: String): Double = jsNumber(g.take(2))

private fun validState(code: Double): Boolean = (code >= 1 && code <= 38) || code == 97.0

fun isValidGstin(g: String): Boolean {
    if (!SHAPE.matches(g)) return false
    if (!validState(gstinStateCode(g))) return false
    return gstinCheckChar(g.substring(0, 14)) == g.substring(14, 15)
}

private val POS = Regex("^$JS_S*([0-9]{2})")

fun placeOfSupplyCode(pos: String?): Int? {
    val m = POS.find(pos ?: "") ?: return null
    return m.groupValues[1].toInt()
}
