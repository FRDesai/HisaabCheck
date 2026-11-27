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

// Aadhaar-shaped (exact and near-miss alike), and not a piece of a longer digit run: that is left whole to LONG_RUN.
private val AADHAAR = Regex(
    "(?<!$D$JS_S_DOT_COMMA_HYPHEN?)$JS_B[2-9]$D{3}$JS_S_OR_HYPHEN?$D{4}$JS_S_OR_HYPHEN?$D{4}$JS_B(?!$JS_S_DOT_COMMA_HYPHEN?$D)",
)
private val IFSC = Regex("$JS_B[A-Z]{4}0[A-Z0-9]{6}$JS_B")

/**
 * An IFSC as OCR may read it: the fifth character (always 0) as O, Q or D, and/or one character of the bank code in
 * its first three places read as a digit look-alike (SB1N, I0BA). The branch code must hold at least 3 digits.
 */
private val NEAR_IFSC = Regex("$JS_B[A-Z0-9]{4}[0OQD][A-Z0-9]{6}$JS_B")
private const val MIN_NEAR_IFSC_BRANCH_DIGITS = 3

/** A mobile, with an optional country code (also in brackets: "(+91)", "(91)") or 0, and its first five digits possibly in brackets. */
private val MOBILE = Regex("(?<!$D)(?:\\(\\+?91\\)$JS_S_OR_HYPHEN?|\\+?91$JS_S_OR_HYPHEN?|0)?\\(?[6-9]$D{4}\\)?$JS_S_OR_HYPHEN?$D{5}(?!$D)")
private val LANDLINE = Regex("${JS_B}0$D{2,4}$JS_S_OR_HYPHEN?$D{3,4}$JS_S_OR_HYPHEN?$D{4}$JS_B")

/**
 * A landline with its STD code in brackets, matched with or without a label: ( [ { | open, ) ] } | close, one of the
 * two may be lost by OCR, and the leading 0 may be read as O. An STD code without its 0 needs both brackets.
 * (In a Java character class [ and ] are escaped; JavaScript reads them literally there.)
 */
private val PAREN_LANDLINE = Regex(
    "(?:[(\\[{|][0O]$D{2,4}[)\\]}|]?|[(\\[{|][1-9]$D{1,3}[)\\]}|]|(?<!$D)[0O]$D{2,4}[)\\]}|])" +
        "$JS_S_OR_HYPHEN?$D(?:$JS_S_OR_HYPHEN?$D){5,7}(?!$D)",
)

/** A landline without brackets or label: STD code, a hyphen (spaces around it allowed), 6 to 8 digits. */
private val HYPHEN_LANDLINE = Regex("(?<![0-9A-Z])0$D{2,4}$JS_S?-$JS_S?$D{6,8}(?!$D)")
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
//   LONG_RUN  /(?<!\d)\d{3,}(?:[\s.,-]\d{3,})*(?:[\s.,-]\d{2})?(?!\d)/g
//   LOOSE_RUN /(?<!\d)\d(?:[\s.,-]?\d){8,}(?!\d)/g   (any grouping: pieces LONG_RUN does not accept)
//   ANY_RUN   /\d(?:[\s.,-]?\d)*/g                  (every maximal run: a match inside one must not leave the rest visible)
private fun isDigit(c: Char) = c in '0'..'9'
private fun isRunSep(c: Char) = c == '.' || c == ',' || c == '-' || isJsWhitespace(c)

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

/** ASCII digits only, like t.replace(/\D/g, '').length. */
private fun digitCount(t: String): Int = t.count { it in '0'..'9' }

/*
 * What maskForRuns blanks out, in this order: dates (day-month-year or year-month-day with plausible day and month),
 * times, and amounts. An amount has grouping commas (at most 9 digits before its decimal part) or a decimal part with
 * at most 8 digits before it. An amount that is the third or later group of a digit run (two groups of 3 or more
 * digits, each followed by one space or hyphen, right before it) is not blanked: there it is the tail of an account.
 */
private const val AFTER_TWO_GROUPS = "(?<!$D{3}$JS_S_OR_HYPHEN$D{3,40}$JS_S_OR_HYPHEN)"
private val DATE_MASK = Regex(
    "(?<!$D|$D[.,/\\-])(?:(?:0?[1-9]|[12]$D|3[01])[\\-/.](?:0?[1-9]|1[0-2])[\\-/.](?:$D{4}|$D{2})" +
        "|$D{4}[\\-/.](?:0?[1-9]|1[0-2])[\\-/.](?:0?[1-9]|[12]$D|3[01]))(?!$D|[.,/\\-]$D)",
)
private val TIME_MASK = Regex("(?<!$D|$D[.,:])$D{1,2}:$D{2}(?::$D{2})?(?!$D|[.,:]$D)")

/*
 * The comma-amount pattern, /(?<!\d|\d[.,])AFTER_TWO_GROUPS\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?!\d|[.,]\d)/g, is scanned by
 * hand: its group loop recurses once per group in java.util.regex and overflows the stack on a long comma list. Every
 * digit block it can use is taken whole (a shorter piece leaves a digit next, which nothing after it accepts), and
 * fewer groups never help (the end would be followed by a comma and a digit), so the greedy reading is the only match.
 */
private fun isSepOrHyphen(c: Char) = c == '-' || isJsWhitespace(c)

/** True when (?<!\d|\d[.,]) and AFTER_TWO_GROUPS both hold at [i]. */
private fun amountMayStartAt(t: String, i: Int): Boolean {
    if (i >= 1 && isDigit(t[i - 1])) return false
    if (i >= 2 && (t[i - 1] == '.' || t[i - 1] == ',') && isDigit(t[i - 2])) return false
    if (i >= 1 && isSepOrHyphen(t[i - 1])) {
        var b = i - 1
        while (b > 0 && isDigit(t[b - 1])) b--
        val len = (i - 1) - b
        if (len in 3..40 && b >= 4 && isSepOrHyphen(t[b - 1]) && isDigit(t[b - 2]) && isDigit(t[b - 3]) && isDigit(t[b - 4])) return false
    }
    return true
}

/** End (exclusive) of a comma amount starting at [i], or -1 (the comma-amount pattern above, matched at [i]). */
private fun commaAmountEnd(t: String, i: Int): Int {
    val first = digitBlockEnd(t, i)
    if (first - i !in 1..3) return -1
    var e = first
    var groups = 0
    while (e < t.length && t[e] == ',') {
        val m = digitBlockEnd(t, e + 1)
        if (m - (e + 1) !in 2..3) break
        e = m
        groups++
    }
    if (groups == 0) return -1
    fun endOk(k: Int) = !(k < t.length && isDigit(t[k])) && !(k + 1 < t.length && (t[k] == '.' || t[k] == ',') && isDigit(t[k + 1]))
    if (e + 1 < t.length && t[e] == '.' && isDigit(t[e + 1])) {
        val m = digitBlockEnd(t, e + 1)
        return if (m - (e + 1) <= 2 && endOk(m)) m else -1
    }
    return if (endOk(e)) e else -1
}

/** Replaces every comma-amount match like String.replace with the /g pattern and [transform]. */
private fun replaceCommaAmounts(t: String, transform: (String) -> String): String {
    val out = StringBuilder()
    var i = 0
    var copied = 0
    while (i < t.length) {
        if (isDigit(t[i]) && amountMayStartAt(t, i)) {
            val end = commaAmountEnd(t, i)
            if (end > 0) {
                out.append(t, copied, i).append(transform(t.substring(i, end)))
                copied = end
                i = end
                continue
            }
        }
        i++
    }
    return out.append(t, copied, t.length).toString()
}

/** AMOUNT_SHAPE's first alternative, /^\d{1,3}(?:,\d{2,3})+(?:\.\d{2})?$/, by hand for the same reason. */
private fun isCommaAmountShape(s: String): Boolean {
    val first = digitBlockEnd(s, 0)
    if (first !in 1..3) return false
    var e = first
    var groups = 0
    while (e < s.length && s[e] == ',') {
        val m = digitBlockEnd(s, e + 1)
        if (m - (e + 1) !in 2..3) return false
        e = m
        groups++
    }
    if (groups == 0) return false
    if (e == s.length) return true
    return s[e] == '.' && digitBlockEnd(s, e + 1) == s.length && s.length - (e + 1) == 2
}
private val DECIMAL_AMOUNT_MASK = Regex("(?<!$D|$D[.,])$AFTER_TWO_GROUPS$D{1,8}[.,]$D{1,2}(?!$D|[.,]$D)")
private const val MAX_COMMA_AMOUNT_DIGITS = 9
private const val DATE_TIME_MARK = '~'
private const val COMMA_AMOUNT_MARK = '='
private const val DECIMAL_AMOUNT_MARK = '#'

/** [t] without a final decimal part: one of [points], then 1 or 2 digits, at the very end (JavaScript /[.]\d{1,2}$/). */
private fun dropDecimals(t: String, points: String): String {
    val p = t.length - 3
    for (k in intArrayOf(p, p + 1)) {
        if (k >= 0 && t[k] in points && (k + 1 until t.length).all { isDigit(t[it]) }) return t.substring(0, k)
    }
    return t
}

/** Digits before the decimal part of an amount with grouping commas (its decimal point is a dot). */
private fun integerDigits(amount: String): Int = digitCount(dropDecimals(amount, "."))

/** Digits before the decimal part of an amount without grouping commas (a dot or a comma). */
private fun decimalIntegerDigits(amount: String): Int = digitCount(dropDecimals(amount, ".,"))

/** The line with dates and times replaced by '~', comma amounts by '=' and decimal amounts by '#' (same length, so spans still line up). */
private fun maskForRuns(text: String, decimalAmounts: Boolean = true): String {
    fun blank(mark: Char) = { m: MatchResult -> mark.toString().repeat(m.value.length) }
    val t = replaceCommaAmounts(TIME_MASK.replace(DATE_MASK.replace(text, blank(DATE_TIME_MARK)), blank(DATE_TIME_MARK))) { m ->
        if (integerDigits(m) <= MAX_COMMA_AMOUNT_DIGITS) COMMA_AMOUNT_MARK.toString().repeat(m.length) else m
    }
    return if (decimalAmounts) DECIMAL_AMOUNT_MASK.replace(t, blank(DECIMAL_AMOUNT_MARK)) else t
}

private const val MIN_JOINED_TAIL_DIGITS = 4

/**
 * In masked text: a digit group of 3 or more joined by one space or hyphen to a blanked decimal amount without grouping
 * commas right after it (an amount with grouping commas is never the tail of an account).
 */
private val GROUP_THEN_AMOUNT = Regex("(?<!$D)$D{3,}$JS_S_OR_HYPHEN#+")
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

/** A money value without grouping commas: under 9 integer digits and a 2-digit decimal part. Used with matches(). */
private val DECIMAL_AMOUNT_SHAPE = Regex("$D{1,8}\\.$D{2}")

/** AMOUNT_SHAPE of the TypeScript core: grouping commas and/or a 2-digit decimal part, under 9 integer digits without commas. */
private fun isAmountShape(s: String): Boolean = isCommaAmountShape(s) || DECIMAL_AMOUNT_SHAPE.matches(s)

/** The GSTIN skeleton: state code, PAN (5 letters, 4 digits, letter), entity code, Z, check character. Used with matches(). */
private val GSTIN_SKELETON = Regex("$D{2}[A-Z]{5}$D{4}[A-Z][A-Z0-9]Z[A-Z0-9]")

/** Per position of a GSTIN: D wants a digit, L a letter, Z the letter Z, A either. */
private const val GSTIN_CLASSES = "DDLLLLLDDDDLAZA"

/**
 * True when the word has the GSTIN skeleton once digit/letter look-alikes are swapped for what each position wants
 * (Z also read as 2 or 7). A 16-character word qualifies when dropping one character (an OCR insertion) leaves one.
 */
private fun hasGstinSkeleton(s: String): Boolean {
    fun fits(w: String): Boolean = w.length == GSTIN_CLASSES.length && GSTIN_SKELETON.matches(buildString {
        w.forEachIndexed { i, c ->
            append(
                when (GSTIN_CLASSES[i]) {
                    'D' -> TO_DIGIT[c] ?: c
                    'L' -> TO_LETTER[c] ?: c
                    'Z' -> if (c == '2' || c == '7') 'Z' else c
                    else -> c
                },
            )
        }
    })
    if (s.length == GSTIN_CLASSES.length + 1) return s.indices.any { i -> fits(s.removeRange(i, i + 1)) }
    return fits(s)
}

/**
 * A low-confidence word that is only an amount (not next to a word that is a bare digit group) or only a GSTIN, once
 * border characters are dropped, does not ask on its own.
 */
private fun harmlessShape(t: String, joinedToDigits: Boolean): Boolean {
    val s = dropBorderEdges(t)
    return (isAmountShape(s) && integerDigits(s) <= MAX_COMMA_AMOUNT_DIGITS && !joinedToDigits) || hasGstinSkeleton(s)
}

/** IFSC look-alike check on an 11-character NEAR_IFSC match. */
private fun isNearIfsc(t: String): Boolean {
    val bank = t.substring(0, 4)
    val odd = bank.filter { it !in 'A'..'Z' }
    return odd.length <= 1 && odd.all { it in TO_LETTER } && bank[3] in 'A'..'Z' && digitCount(t.substring(5)) >= MIN_NEAR_IFSC_BRANCH_DIGITS
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
        find(li, NEAR_IFSC, PiiType.IFSC, PiiType.IFSC, ::isNearIfsc)
        find(li, PAN, PiiType.PAN, PiiType.PAN)
        find(li, MOBILE, PiiType.PHONE, PiiType.PHONE)
        find(li, PAREN_LANDLINE, PiiType.PHONE, PiiType.PHONE)
        find(li, HYPHEN_LANDLINE, PiiType.PHONE, PiiType.PHONE)
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
        for (m in anyRuns(maskForRuns(line.text, decimalAmounts = false))) {
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
        val masked = maskForRuns(line.text)
        for (m in looseRuns(masked)) {
            val from = m.first
            val to = m.last + 1
            val visible = line.spans.filter { it.start < to && it.end > from && it.word !in claimed && it.word !in gstinWords }
                .sumOf { digitCount(line.text.substring(maxOf(it.start, from), minOf(it.end, to))) }
            if (visible >= MIN_RUN_DIGITS) reasons.add("long_digit_run:$li")
        }
        // A digit group joined to a decimal amount: a two-group account with a decimal tail cannot be told from an HSN code
        // next to an amount whose commas OCR dropped, so when the amount has 4 or more integer digits (an account's groups
        // do; a rate of 784.00 next to an HSN code does not), the two make 9 or more digits and nothing of them is hidden, ask.
        for (m in GROUP_THEN_AMOUNT.findAll(masked)) {
            val from = m.range.first
            val groupEnd = from + digitCount(m.value)
            var to = m.range.last + 1
            while (to < masked.length && masked[to] == DECIMAL_AMOUNT_MARK) to++
            val tail = decimalIntegerDigits(line.text.substring(groupEnd + 1, to))
            val inRange = line.spans.filter { it.start < to && it.end > from && it.word !in gstinWords }
            if (tail >= MIN_JOINED_TAIL_DIGITS && (groupEnd - from) + tail >= MIN_RUN_DIGITS && inRange.none { it.word in claimed }) {
                reasons.add("long_digit_run:$li")
            }
        }
        fun bareDigits(k: Int): Boolean {
            if (k < 0 || k >= line.spans.size) return false
            val w = dropBorderEdges(line.text.substring(line.spans[k].start, line.spans[k].end))
            return w.isNotEmpty() && w.all(::isDigit)
        }
        line.spans.forEachIndexed { k, s ->
            // A near-miss is hidden, but a low-confidence read of it still asks the human (it may be something else).
            if (s.word in gstinWords || (s.word in claimed && s.word !in nearMissWords)) return@forEachIndexed
            val t = line.text.substring(s.start, s.end)
            if (PARTIAL.containsMatchIn(t)) {
                reasons.add("partial_match:${s.word}")
            } else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.containsMatchIn(t) && !harmlessShape(t, bareDigits(k - 1) || bareDigits(k + 1))) {
                reasons.add("low_ocr_confidence:${s.word}")
            }
        }
    }

    return ShieldResult(gstinWords.toList(), matches, reasons.isNotEmpty(), reasons)
}
