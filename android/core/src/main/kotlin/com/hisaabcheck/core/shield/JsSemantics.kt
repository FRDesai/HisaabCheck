package com.hisaabcheck.core.shield

import java.math.BigDecimal
import java.math.BigInteger
import java.math.MathContext
import java.math.RoundingMode
import kotlin.math.floor

/*
 * JavaScript semantics the TypeScript core relies on, written out so the Kotlin port gives the same answers on the JVM
 * and on Android (whose java.util.regex is ICU: there \d, \w, \s and \b are Unicode-aware, unlike JavaScript's).
 * Regular expressions in this module therefore never use \d, \w, \s, \b, $, flags or Unicode classes; they use the
 * explicit classes below.
 */

/** The characters JavaScript's \s matches (WhiteSpace plus LineTerminator), as regex escapes for a character class. */
internal const val JS_WS_CLASS_BODY =
    "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

/** JavaScript \s. */
internal const val JS_S = "[$JS_WS_CLASS_BODY]"

/** JavaScript [\s-]. */
internal const val JS_S_OR_HYPHEN = "[\\-$JS_WS_CLASS_BODY]"

/** JavaScript \b (ASCII word characters only). */
internal const val JS_B = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"

internal fun isJsWhitespace(c: Char): Boolean = when (c) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF' -> true
    else -> c in '\u2000'..'\u200A'
}

/** String.prototype.trim. Kotlin's trim() differs: it keeps U+FEFF and removes U+001C to U+001F. */
internal fun jsTrim(s: String): String = s.trim(::isJsWhitespace)

private val DECIMAL = Regex("[+\\-]?(?:Infinity|(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+\\-]?[0-9]+)?)")
private val HEX = Regex("0[xX][0-9a-fA-F]+")
private val OCTAL = Regex("0[oO][0-7]+")
private val BINARY = Regex("0[bB][01]+")

/** Number(string): StringToNumber of ECMAScript. NaN where JavaScript gives NaN. */
internal fun jsNumber(s: String): Double {
    val t = jsTrim(s)
    if (t.isEmpty()) return 0.0
    return when {
        DECIMAL.matches(t) -> when (t) {
            "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
            "-Infinity" -> Double.NEGATIVE_INFINITY
            else -> t.toDouble() // the pattern admits only plain decimal literals, which parse identically
        }
        HEX.matches(t) -> BigInteger(t.substring(2), 16).toDouble()
        OCTAL.matches(t) -> BigInteger(t.substring(2), 8).toDouble()
        BINARY.matches(t) -> BigInteger(t.substring(2), 2).toDouble()
        else -> Double.NaN
    }
}

/** Number.isFinite for a number. */
internal fun Double.jsIsFinite(): Boolean = !isNaN() && !isInfinite()

/** Math.round: the nearest integer, ties toward positive infinity (2.5 -> 3, -2.5 -> -2). */
internal fun jsRound(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    val f = floor(x)
    return if (x - f >= 0.5) f + 1 else f // x - floor(x) is exact for every finite double
}

/** String(n) for a number: ECMAScript Number::toString (shortest round-tripping digits, JavaScript layout). */
internal fun jsNumberToString(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d == 0.0) return "0" // +0 and -0
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    if (d < 0) return "-" + jsNumberToString(-d)
    val (digits, n) = shortestDigits(d)
    val k = digits.length
    return when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val e = n - 1
            val exp = if (e >= 0) "e+$e" else "e-${-e}"
            if (k == 1) digits + exp else digits[0] + "." + digits.substring(1) + exp
        }
    }
}

/** The fewest decimal digits s (no trailing zeros) and exponent n with s x 10^(n-k) == d, nearest to d on a tie. */
private fun shortestDigits(d: Double): Pair<String, Int> {
    val exact = BigDecimal(d)
    for (p in 1..17) {
        val candidates = listOf(RoundingMode.HALF_EVEN, RoundingMode.FLOOR, RoundingMode.CEILING)
            .map { exact.round(MathContext(p, it)) }
            .filter { it.toDouble() == d }
        val best = candidates.minByOrNull { it.subtract(exact).abs() } ?: continue
        val stripped = best.stripTrailingZeros()
        val digits = stripped.unscaledValue().toString()
        return digits to (digits.length - stripped.scale())
    }
    error("no round-tripping representation for $d")
}
