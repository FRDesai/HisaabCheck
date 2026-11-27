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
/** JavaScript [\s.,-]. */
private const val JS_S_DOT_COMMA_HYPHEN = "[.,\\-$JS_WS_CLASS_BODY]"

/** JavaScript [\s.-]: what joins the groups of a digit run. */
private const val RUN_SEP = "[.\\-$JS_WS_CLASS_BODY]"

// Aadhaar-shaped (exact and near-miss alike), and not a piece of a longer digit run: that is left whole to LONG_RUN.
private val AADHAAR = Regex(
    "(?<!$D$JS_S_DOT_COMMA_HYPHEN?)$JS_B[2-9]$D{3}$JS_S_OR_HYPHEN?$D{4}$JS_S_OR_HYPHEN?$D{4}$JS_B(?!$JS_S_DOT_COMMA_HYPHEN?$D)",
)
private val IFSC = Regex("$JS_B[A-Z]{4}0[A-Z0-9]{6}$JS_B")

/** An IFSC whose fifth character (always 0) was read as O, Q or D; the branch code must hold at least 3 digits. */
private val NEAR_IFSC = Regex("$JS_B[A-Z]{4}[OQD][A-Z0-9]{6}$JS_B")
private const val MIN_NEAR_IFSC_BRANCH_DIGITS = 3
private val MOBILE = Regex("(?<!$D)(?:\\+?91$JS_S_OR_HYPHEN?|0)?[6-9]$D{4}$JS_S_OR_HYPHEN?$D{5}(?!$D)")
private val LANDLINE = Regex("${JS_B}0$D{2,4}$JS_S_OR_HYPHEN?$D{3,4}$JS_S_OR_HYPHEN?$D{4}$JS_B")
/** A landline with its STD code in parentheses (one of the two may be lost by OCR): matched with or without a label. */
private val PAREN_LANDLINE = Regex("(?:\\(0$D{2,4}\\)?|(?<!$D)0$D{2,4}\\))$JS_S_OR_HYPHEN?$D(?:$JS_S_OR_HYPHEN?$D){5,7}(?!$D)")
private val BANK = Regex("$JS_B$D(?:$JS_S_OR_HYPHEN?$D){8,17}$JS_B")

/*
 * Long digit runs are looked for in a copy of the line where amounts, dates and times are blanked out (see
 * maskForRuns), so they never join a run; nothing else excuses a run.
 * LONG_RUN: a number that may be a bank account even though no label was read (OCR mangles labels: "A/C" came back as
 * "AJC"). Contiguous digits, or groups of at least 3 digits (the last may have 2) joined by one space, hyphen or dot;
 * 9 or more digits in all (checked in code). Letters may touch it.
 */
//
// The three run patterns are scanned by hand here, not with java.util.regex: their unbounded group loops recurse once per
// digit in Java and overflow the stack on a long digit string (thousands of digits), which would crash the shield. Each
// scanner returns exactly the ranges the TypeScript pattern's matchAll returns (pinned by the differential corpus):
//   LONG_RUN  /(?<!\d)\d{3,}(?:[\s.-]\d{3,})*(?:[\s.-]\d{2})?(?!\d)/g
//   LOOSE_RUN /(?<!\d)\d(?:[\s.-]?\d){8,}(?!\d)/g   (any grouping: pieces LONG_RUN does not accept)
//   ANY_RUN   /\d(?:[\s.-]?\d)*/g                  (every maximal run: a match inside one must not leave the rest visible)
private fun isDigit(c: Char) = c in '0'..'9'
private fun isRunSep(c: Char) = c == '.' || c == '-' || isJsWhitespace(c)

/** End (exclusive) of the block of digits starting at [i]. */
private fun digitBlockEnd(t: String, i: Int): Int {
    var j = i
    while (j < t.length && isDigit(t[j])) j++
    return j
}

/** ANY_RUN: greedy, so each match is a maximal run of digits joined by single separators. */
private fun anyRuns(t: String): List<IntRange> {
    val out = mutableListOf<IntRange>()
    var i = 0
    while (i < t.length) {
        if (!isDigit(t[i])) { i++; continue }
        var j = i + 1
        while (j < t.length) {
            if (isDigit(t[j])) j++
            else if (isRunSep(t[j]) && j + 1 < t.length && isDigit(t[j + 1])) j += 2
            else break
        }
        out.add(i until j)
        i = j
    }
    return out
}

/** LOOSE_RUN: a maximal run is followed by a non-digit, so it matches whole when it holds 9 or more digits; its suffixes hold fewer. */
private fun looseRuns(t: String): List<IntRange> = anyRuns(t).filter { r -> (r.first..r.last).count { isDigit(t[it]) } >= MIN_RUN_DIGITS }

/** LONG_RUN: greedy whole blocks (a shorter block would leave a digit next), 3+ digit groups, then an optional 2-digit group. */
private fun longRuns(t: String): List<IntRange> {
    val out = mutableListOf<IntRange>()
    var i = 0
    while (i < t.length) {
        if (!isDigit(t[i]) || (i > 0 && isDigit(t[i - 1]))) { i++; continue }
        val first = digitBlockEnd(t, i)
        if (first - i < 3) { i = first; continue }
        var e = first
        while (e < t.length && isRunSep(t[e])) {
            val m = digitBlockEnd(t, e + 1)
            val len = m - (e + 1)
            if (len >= 3) { e = m; continue }
            if (len == 2) e = m
            break
        }
        out.add(i until e)
        i = e
    }
    return out
}
private const val MIN_RUN_DIGITS = 9

// What maskForRuns blanks out, in this order. An amount keeps fewer than 9 digits before its decimal point, or uses
// grouping commas; a longer number with a decimal part is not an amount on these bills and stays in the run.
private val RUN_MASKS = listOf(
    Regex("(?<!$D|$D[.,/\\-])$D{1,4}[\\-/.]$D{1,2}[\\-/.]$D{1,4}(?!$D|[.,/\\-]$D)"), // date
    Regex("(?<!$D|$D[.,:])$D{1,2}:$D{2}(?::$D{2})?(?!$D|[.,:]$D)"), // time
    Regex("(?<!$D|$D[.,])$D{1,3}(?:,$D{2,3})+(?:\\.$D{1,2})?(?!$D|[.,]$D)"), // amount with grouping commas
    Regex("(?<!$D|$D[.,])$D{1,8}[.,]$D{1,2}(?!$D|[.,]$D)"), // amount with a decimal part
)

/** The line with every date, time and amount replaced by '~' (same length, so spans still line up). */
private fun maskForRuns(text: String): String = RUN_MASKS.fold(text) { t, re -> re.replace(t) { m -> "~".repeat(m.value.length) } }

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

/** Table-border characters OCR glues to the start or end of a cell's word (JavaScript: /^[|[\]!]+|[|[\]!]+$/g). */
private fun dropBorderEdges(t: String): String = t.trim { it == '|' || it == '[' || it == ']' || it == '!' }

/** A money value: grouping commas and/or a 2-digit decimal part, under 9 integer digits without commas. Used with matches(). */
private val AMOUNT_SHAPE = Regex("$D{1,3}(?:,$D{2,3})+(?:\\.$D{2})?|$D{1,8}\\.$D{2}")

/** A GSTIN, possibly misread: 14 to 16 letters and digits starting with the 2-digit state code. Used with matches(). */
private val GSTIN_SHAPE = Regex("$D{2}[A-Z0-9]{12,14}")
private const val MIN_GSTIN_SHAPE_LETTERS = 4

/** A low-confidence word that is only an amount or a GSTIN (once border characters are dropped) does not ask on its own. */
private fun harmlessShape(t: String): Boolean {
    val s = dropBorderEdges(t)
    return AMOUNT_SHAPE.matches(s) || (GSTIN_SHAPE.matches(s) && s.count { it in 'A'..'Z' } >= MIN_GSTIN_SHAPE_LETTERS)
}

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

    // `hits` are match ranges in the line (or in a same-length transform of it), in matchAll order; `ok` gets the ORIGINAL text.
    fun findIn(li: Int, hits: Sequence<IntRange>, type: PiiType, kind: PiiType, ok: (String) -> Boolean): List<Int> {
        val found = mutableListOf<Int>()
        val line = lines.getValue(li)
        for (range in hits) {
            val start = range.first
            val end = range.last + 1
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

    // `searchText`, if given, is a same-length transform of the line (look-alike swaps); `ok` gets the ORIGINAL text.
    fun find(li: Int, re: Regex, type: PiiType, kind: PiiType, ok: (String) -> Boolean = { true }, searchText: String? = null): List<Int> =
        // findAll is Matcher.find repeated from the previous match's end: the same iteration as matchAll with the g flag
        // (no pattern here can match the empty string).
        findIn(li, re.findAll(searchText ?: lines.getValue(li).text).map { it.range }, type, kind, ok)

    for (line in lines.values) {
        for (m in GSTIN_PATTERN.findAll(line.text)) gstinWords.addAll(wordsIn(line, m.range.first, m.range.last + 1))
    }

    for ((li, line) in lines) {
        val prev = lines[li - 1]?.text ?: ""
        val runText = maskForRuns(line.text)
        find(li, AADHAAR, PiiType.AADHAAR, PiiType.AADHAAR, { s -> isValidVerhoeff(s.filterNot { it == '-' || isJsWhitespace(it) }) })
        find(li, IFSC, PiiType.IFSC, PiiType.IFSC)
        find(li, NEAR_IFSC, PiiType.IFSC, PiiType.IFSC, { s -> digitCount(s.substring(5)) >= MIN_NEAR_IFSC_BRANCH_DIGITS })
        find(li, PAN, PiiType.PAN, PiiType.PAN)
        find(li, MOBILE, PiiType.PHONE, PiiType.PHONE)
        find(li, PAREN_LANDLINE, PiiType.PHONE, PiiType.PHONE)
        if (hasLabel(line.text, PiiType.PHONE)) find(li, LANDLINE, PiiType.PHONE, PiiType.PHONE)
        if (hasLabel(line.text, PiiType.BANK_ACCOUNT) || hasLabel(prev, PiiType.BANK_ACCOUNT)) find(li, BANK, PiiType.BANK_ACCOUNT, PiiType.BANK_ACCOUNT)
        // Near-misses, after every exact matcher so a real type always wins. Over-redaction is harmless; a miss is a leak.
        find(li, AADHAAR, PiiType.POSSIBLE_ID, PiiType.AADHAAR) // Aadhaar-shaped but failing Verhoeff (valid ones were claimed above)
        find(li, NEAR_PAN, PiiType.POSSIBLE_ID, PiiType.PAN, ::isNearPan)
        find(li, MOBILE, PiiType.POSSIBLE_ID, PiiType.PHONE, ::isNearMobile, toDigits(line.text))
        // Last: any other run that could be a bank account is hidden too. A miss is a leak; this only hides a reference
        // number or two from the model, and the maths checks never use such numbers.
        longRunWords.addAll(findIn(li, longRuns(runText).asSequence(), PiiType.POSSIBLE_ID, PiiType.BANK_ACCOUNT) { t -> digitCount(t) >= MIN_RUN_DIGITS })
    }

    // No match may leave the rest of its digit run visible: the unclaimed digit-bearing words of a run that holds a
    // match are hidden too, as one POSSIBLE_ID per run (simpler than widening a match and changing its type).
    for (line in lines.values) {
        for (m in anyRuns(maskForRuns(line.text))) {
            val from = m.first
            val to = m.last + 1
            val inRun = line.spans.filter { it.start < to && it.end > from && it.word !in gstinWords }
            if (inRun.none { it.word in claimed }) continue
            val rest = inRun.filter { it.word !in claimed && suspicious(line.text.substring(maxOf(it.start, from), minOf(it.end, to))) }.map { it.word }
            if (rest.isEmpty()) continue
            claimed.addAll(rest)
            longRunWords.addAll(rest)
            matches.add(PiiMatch(PiiType.POSSIBLE_ID, rest))
        }
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
        for (m in looseRuns(maskForRuns(line.text))) {
            val from = m.first
            val to = m.last + 1
            val visible = line.spans.filter { it.start < to && it.end > from && it.word !in claimed && it.word !in gstinWords }
                .sumOf { digitCount(line.text.substring(maxOf(it.start, from), minOf(it.end, to))) }
            if (visible >= MIN_RUN_DIGITS) reasons.add("long_digit_run:$li")
        }
        for (s in line.spans) {
            // A near-miss is hidden, but a low-confidence read of it still asks the human (it may be something else).
            if (s.word in gstinWords || (s.word in claimed && s.word !in nearMissWords)) continue
            val t = line.text.substring(s.start, s.end)
            if (PARTIAL.containsMatchIn(t)) reasons.add("partial_match:${s.word}")
            else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.containsMatchIn(t) && !harmlessShape(t)) reasons.add("low_ocr_confidence:${s.word}")
        }
    }

    return ShieldResult(gstinWords.toList(), matches, reasons.isNotEmpty(), reasons)
}
