package com.hisaabcheck.core.shield

import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.PiiMatch
import com.hisaabcheck.core.PiiType
import com.hisaabcheck.core.ShieldResult
import java.util.TreeMap

// Port of web/src/core/shield/shield.ts. Every pattern is the TypeScript one with \b, \d, \s written as the explicit
// JavaScript classes (JS_B, [0-9], JS_S); see JsSemantics.kt.

private class Span(val word: Int, val start: Int, val end: Int)
private class Line(val text: String, val spans: List<Span>)

/**
 * The lines with a non-negative index, in ascending order. JavaScript keeps them in an array: a missing index is a
 * hole that forEach skips, which behaves exactly like an empty line here. A negative index becomes a plain property
 * that lines.map(...) drops, so words on a negative line are never scanned; they are dropped here too.
 */
private fun buildLines(words: List<OcrWord>): TreeMap<Int, Line> {
    val texts = TreeMap<Int, StringBuilder>()
    val spans = HashMap<Int, MutableList<Span>>()
    words.forEachIndexed { i, w ->
        if (w.line < 0) return@forEachIndexed
        val text = texts.getOrPut(w.line) { StringBuilder() }
        if (text.isNotEmpty()) text.append(' ')
        val start = text.length
        text.append(w.text.uppercase()) // root-locale full mapping, like String.prototype.toUpperCase
        spans.getOrPut(w.line) { mutableListOf() }.add(Span(i, start, text.length))
    }
    val lines = TreeMap<Int, Line>()
    for ((li, text) in texts) lines[li] = Line(text.toString(), spans.getValue(li))
    return lines
}

private fun wordsIn(line: Line, start: Int, end: Int): List<Int> = line.spans.filter { it.start < end && it.end > start }.map { it.word }

private const val D = "[0-9]"
private val PAN = Regex("$JS_B[A-Z]{3}[ABCFGHLJPT][A-Z]$D{4}[A-Z]$JS_B")
private val AADHAAR = Regex("$JS_B[2-9]$D{3}$JS_S_OR_HYPHEN?$D{4}$JS_S_OR_HYPHEN?$D{4}$JS_B")
private val IFSC = Regex("$JS_B[A-Z]{4}0[A-Z0-9]{6}$JS_B")
private val MOBILE = Regex("(?<!$D)(?:\\+?91$JS_S_OR_HYPHEN?|0)?[6-9]$D{4}$JS_S_OR_HYPHEN?$D{5}(?!$D)")
private val LANDLINE = Regex("${JS_B}0$D{2,4}$JS_S_OR_HYPHEN?$D{3,4}$JS_S_OR_HYPHEN?$D{4}$JS_B")
private val BANK = Regex("$JS_B$D(?:$JS_S_OR_HYPHEN?$D){8,17}$JS_B")

// Aadhaar-shaped but failing Verhoeff, and not a piece of a longer digit run (that is left whole to LONG_RUN).
private val NEAR_AADHAAR =
    Regex("(?<!$D$JS_S_OR_HYPHEN?)$JS_B[2-9]$D{3}$JS_S_OR_HYPHEN?$D{4}$JS_S_OR_HYPHEN?$D{4}$JS_B(?!$JS_S_OR_HYPHEN?$D)")

/*
 * A digit run that may be a bank account even though no label was read (OCR mangles labels: "A/C" came back as "AJC").
 * Contiguous digits, or groups of at least 3 digits (the last may have 2) joined by one space or hyphen; 9 to 18 digits
 * in all (checked in code). Letters may touch it. Not a money value or a time: no digit followed by ".", "," or ":"
 * just before it, and no ".", "," or ":" followed by a digit just after it.
 */
private val LONG_RUN = Regex("(?<!$D|$D[.,:])$D{3,}(?:$JS_S_OR_HYPHEN$D{3,})*(?:$JS_S_OR_HYPHEN$D{2})?(?!$D|[.,:]$D)")

/** The same edges, any grouping (the separators BANK tolerates): a run OCR may have split in pieces LONG_RUN does not accept. */
private val LOOSE_RUN = Regex("(?<!$D|$D[.,:])$D(?:$JS_S_OR_HYPHEN?$D){8,17}(?!$D|[.,:]$D)")
private const val MIN_RUN_DIGITS = 9
private const val MAX_RUN_DIGITS = 18

/** ASCII digits only, like t.replace(/\D/g, '').length. */
private fun digitCount(t: String): Int = t.count { it in '0'..'9' }
private val NEAR_PAN = Regex("$JS_B[A-Z0-9]{10}$JS_B")

// Digit look-alikes, used to un-confuse OCR misreads.
private val TO_DIGIT = mapOf('O' to '0', 'I' to '1', 'L' to '1', 'S' to '5', 'B' to '8', 'Z' to '2')
private val TO_LETTER = mapOf('0' to 'O', '1' to 'I', '5' to 'S', '8' to 'B', '2' to 'Z')
private val PAN_SHAPE = Regex("[A-Z]{5}$D{4}[A-Z]") // used with matches(): ^...$

/** At most this many look-alike swaps for a near-PAN; real misreads are 1 to 2 characters, invoice numbers need more. */
private const val MAX_NEAR_PAN_SWAPS = 2
private const val MIN_NEAR_MOBILE_DIGIT_SHARE = 0.7

/** The PII types a label can name (all but POSSIBLE_ID), in the key order of the TypeScript LABELS object. */
private val LABELS: List<Pair<PiiType, Regex>> = listOf(
    PiiType.PAN to Regex("${JS_B}PAN$JS_B"),
    PiiType.AADHAAR to Regex("${JS_B}AADHAA?R$JS_B"),
    PiiType.IFSC to Regex("${JS_B}IFSC$JS_B"),
    PiiType.PHONE to Regex("$JS_B(?:MOB(?:ILE)?|PH(?:ONE)?|TEL|CELL|CONTACT)$JS_B"),
    // A/C also as OCR reads it: the slash as | \ 1 I J L ! 7 (lower-case l is upper-cased to L before matching).
    PiiType.BANK_ACCOUNT to Regex(
        "${JS_B}ACC(?:OUNT|T)?\\.?$JS_S*(?:NO|NUMBER)$JS_B|${JS_B}ACC$JS_S*#|${JS_B}ACCOUNT$JS_B|${JS_B}ACCT$JS_B" +
            "|${JS_B}A/C(?:$JS_S*(?:NO|NUMBER)$JS_B)?|${JS_B}A[|\\\\1IJL!7]C$JS_B(?:$JS_S*(?:NO|NUMBER)$JS_B)?" +
            "|$JS_B(?:AC|CA)$JS_S*NO$JS_B",
    ),
)
private val PARTIAL = Regex("$JS_B[A-Z]{5}$D{1,3}$JS_B")
private val PII_LIKE = Regex("$D{3,}|[A-Z]{3,}$D")

private fun label(type: PiiType): Regex = LABELS.first { it.first == type }.second

private fun hasLabel(text: String, type: PiiType): Boolean = label(type).containsMatchIn(text)

/** A 10-character token that is PAN-shaped after at most MAX_NEAR_PAN_SWAPS look-alike swaps (0 swaps = PAN shape with an unusual 4th letter). */
private fun isNearPan(t: String): Boolean {
    var swaps = 0
    val fixed = buildString {
        t.forEachIndexed { i, ch ->
            val wantDigit = i in 5..8
            val sub = if (wantDigit) TO_DIGIT[ch] else TO_LETTER[ch]
            if (sub != null) { swaps++; append(sub) } else append(ch)
        }
    }
    return swaps <= MAX_NEAR_PAN_SWAPS && PAN_SHAPE.matches(fixed)
}

private fun toDigits(text: String): String = buildString(text.length) { for (c in text) append(TO_DIGIT[c] ?: c) }

/** The original run had at least one look-alike letter and is mostly digits. */
private fun isNearMobile(original: String): Boolean {
    val alnum = original.count { it in 'A'..'Z' || it in '0'..'9' }
    val digits = original.count { it in '0'..'9' }
    return original.any { it in "OILSBZ" } && alnum > 0 && digits.toDouble() / alnum >= MIN_NEAR_MOBILE_DIGIT_SHARE
}

/** A word that could be (part of) a private number: any digit at all (OCR may split a number into short pieces). */
private fun suspicious(t: String): Boolean = t.any { it in '0'..'9' }

private class Meta(val kind: PiiType, val li: Int, val start: Int)

fun runShield(words: List<OcrWord>, consentOcrThreshold: Double): ShieldResult {
    val lines = buildLines(words)
    val gstinWords = LinkedHashSet<Int>()
    val claimed = HashSet<Int>()
    val matches = mutableListOf<PiiMatch>()
    // kind: which label a match can satisfy. Exact matches use their own type; a POSSIBLE_ID uses the type it nearly is.
    val meta = mutableListOf<Meta>()
    val reasons = mutableListOf<String>()
    // Words hidden only because they are a long digit run: for label checks they still count as a possibly missed value.
    val longRunWords = HashSet<Int>()

    // `searchText`, if given, is a same-length transform of the line (look-alike swaps); `ok` gets the ORIGINAL text.
    fun find(li: Int, re: Regex, type: PiiType, kind: PiiType, ok: (String) -> Boolean = { true }, searchText: String? = null): List<Int> {
        val found = mutableListOf<Int>()
        val line = lines.getValue(li)
        // findAll is Matcher.find repeated from the previous match's end: the same iteration as matchAll with the g flag
        // (no pattern here can match the empty string).
        for (m in re.findAll(searchText ?: line.text)) {
            val start = m.range.first
            val end = m.range.last + 1
            val idx = wordsIn(line, start, end)
            val original = line.text.substring(start, end)
            if (idx.any { it in claimed || it in gstinWords } || !ok(original)) continue
            claimed.addAll(idx)
            matches.add(PiiMatch(type, idx))
            meta.add(Meta(kind, li, start))
            found.addAll(idx)
        }
        return found
    }

    for (line in lines.values) {
        for (m in GSTIN_PATTERN.findAll(line.text)) gstinWords.addAll(wordsIn(line, m.range.first, m.range.last + 1))
    }

    for ((li, line) in lines) {
        val prev = lines[li - 1]?.text ?: ""
        find(li, AADHAAR, PiiType.AADHAAR, PiiType.AADHAAR, { s -> isValidVerhoeff(s.filterNot { it == '-' || isJsWhitespace(it) }) })
        find(li, IFSC, PiiType.IFSC, PiiType.IFSC)
        find(li, PAN, PiiType.PAN, PiiType.PAN)
        find(li, MOBILE, PiiType.PHONE, PiiType.PHONE)
        if (hasLabel(line.text, PiiType.PHONE)) find(li, LANDLINE, PiiType.PHONE, PiiType.PHONE)
        if (hasLabel(line.text, PiiType.BANK_ACCOUNT) || hasLabel(prev, PiiType.BANK_ACCOUNT)) find(li, BANK, PiiType.BANK_ACCOUNT, PiiType.BANK_ACCOUNT)
        // Near-misses, after every exact matcher so a real type always wins. Over-redaction is harmless; a miss is a leak.
        find(li, NEAR_AADHAAR, PiiType.POSSIBLE_ID, PiiType.AADHAAR) // Aadhaar-shaped but failing Verhoeff (valid ones were claimed above)
        find(li, NEAR_PAN, PiiType.POSSIBLE_ID, PiiType.PAN, ::isNearPan)
        find(li, MOBILE, PiiType.POSSIBLE_ID, PiiType.PHONE, ::isNearMobile, toDigits(line.text))
        // Last: any other run that could be a bank account is hidden too. A miss is a leak; this only hides a reference
        // number or two from the model, and the maths checks never use such numbers.
        val n = { t: String -> digitCount(t) >= MIN_RUN_DIGITS && digitCount(t) <= MAX_RUN_DIGITS }
        longRunWords.addAll(find(li, LONG_RUN, PiiType.POSSIBLE_ID, PiiType.BANK_ACCOUNT, n))
    }

    val nearMissWords = matches.filter { it.type == PiiType.POSSIBLE_ID }.flatMap { it.wordIndexes }.toHashSet()
    // Unclaimed digit-bearing words of line `li` whose span lies within [from, to): something that may be a missed value.
    fun suspiciousIn(li: Int, from: Int, to: Int): Boolean {
        val line = lines[li] ?: return false
        return line.spans.any { s -> s.start >= from && s.end <= to && (s.word !in claimed || s.word in longRunWords) && suspicious(line.text.substring(s.start, s.end)) }
    }

    for ((li, line) in lines) {
        // Each label occurrence needs its own value of the SAME kind, after it on the line or on the next line, and that
        // value must be the first suspicious thing after the label: a visible digit-bearing word in between means the
        // label's real value may have been missed, so a later match does not count.
        for ((type, re) in LABELS) {
            val occ = re.findAll(line.text).toList()
            occ.forEachIndexed { k, o ->
                val from = o.range.last + 1
                val to = occ.getOrNull(k + 1)?.range?.first ?: Int.MAX_VALUE // Infinity
                val last = k == occ.size - 1
                val ok = meta.any { m ->
                    m.kind == type && (
                        (m.li == li && m.start >= from && m.start < to && !suspiciousIn(li, from, m.start)) ||
                            (last && m.li.toLong() == li.toLong() + 1 && !suspiciousIn(li, from, Int.MAX_VALUE) && !suspiciousIn(li + 1, 0, m.start))
                        )
                }
                if (!ok) reasons.add("label_without_value:$li")
            }
        }
        // A digit run whose visible (unclaimed, non-GSTIN) pieces still hold enough digits to be an account number.
        for (m in LOOSE_RUN.findAll(line.text)) {
            val from = m.range.first
            val to = m.range.last + 1
            val visible = line.spans.filter { it.start < to && it.end > from && it.word !in claimed && it.word !in gstinWords }
                .sumOf { digitCount(line.text.substring(maxOf(it.start, from), minOf(it.end, to))) }
            if (visible >= MIN_RUN_DIGITS) reasons.add("long_digit_run:$li")
        }
        for (s in line.spans) {
            // A near-miss is hidden, but a low-confidence read of it still asks the human (it may be something else).
            if (s.word in gstinWords || (s.word in claimed && s.word !in nearMissWords)) continue
            val t = line.text.substring(s.start, s.end)
            if (PARTIAL.containsMatchIn(t)) reasons.add("partial_match:${s.word}")
            else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.containsMatchIn(t)) reasons.add("low_ocr_confidence:${s.word}")
        }
    }

    return ShieldResult(gstinWords.toList(), matches, reasons.isNotEmpty(), reasons)
}
