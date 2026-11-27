package com.hisaabcheck.core.shield

import com.hisaabcheck.core.Box
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.PiiMatch
import com.hisaabcheck.core.PiiType
import com.hisaabcheck.core.wordsFromLines
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of every non-vector test in web/tests/core/shield.test.ts (same names, same values). */
class ShieldTest {
    @Test
    fun `never puts a GSTIN word inside a PII match`() {
        val r = runShield(wordsFromLines(listOf("GSTIN 27AAPFU0939F1ZV PAN AAPFU0939F")), 0.6)
        val piiWords = r.matches.flatMap { it.wordIndexes }
        assertFalse(r.gstinWordIndexes[0] in piiWords)
    }

    @Test
    fun `maps a spaced aadhaar to all three words`() {
        val r = runShield(wordsFromLines(listOf("Aadhaar No 2341 2341 2346")), 0.6)
        assertEquals(listOf(2, 3, 4), r.matches[0].wordIndexes)
    }

    @Test
    fun `never claims a GSTIN word with the near-miss matchers`() {
        val r = runShield(wordsFromLines(listOf("27AAPFU0939F1ZV ABCDEI234F 2341-2341-2340")), 0.6)
        assertEquals(listOf(0), r.gstinWordIndexes)
        assertFalse(0 in r.matches.flatMap { it.wordIndexes })
        assertEquals(listOf(PiiType.POSSIBLE_ID, PiiType.POSSIBLE_ID), r.matches.map { it.type })
    }

    @Test
    fun `hides a low-confidence look-alike mobile and still asks the human`() {
        val r = runShield(wordsFromLines(listOf("Contact 98450 1Z345"), 40.0), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(1, 2))), r.matches)
        assertTrue(r.uncertainReasons.any { it.startsWith("low_ocr_confidence") })
    }

    @Test
    fun `keeps exact types ahead of near-misses`() {
        val r = runShield(wordsFromLines(listOf("PAN AAPFU0939F Mob 98450 12345 Aadhaar 2341-2341-2346")), 0.6)
        assertEquals(listOf("AADHAAR", "PAN", "PHONE"), r.matches.map { it.type.name }.sorted())
    }

    @Test
    fun `a label is not satisfied past a visible digit-bearing word, even by an exact match of its kind`() {
        assertTrue(runShield(wordsFromLines(listOf("PAN: 12345 AAPFU0939F")), 0.6).uncertain)
        assertFalse(runShield(wordsFromLines(listOf("PAN: AAPFU0939F")), 0.6).uncertain)
    }

    @Test
    fun `a near-miss satisfies only the label of its own kind`() {
        assertTrue(runShield(wordsFromLines(listOf("PAN:", "Mob: 9845O 12345")), 0.6).uncertain)
        assertFalse(runShield(wordsFromLines(listOf("Mob:", "9845O 12345")), 0.6).uncertain)
    }

    // ---- runShield long digit runs (bank accounts without a recognised label)

    private fun boxed(text: String, confidence: Double, x: Double) = OcrWord(text, Box(x, 0.0, x + text.length * 10, 16.0), confidence, 0)

    @Test
    fun `hides the account in the exact OCR reading from the first real run`() {
        // Tesseract read "A/C No: 50100234567891" as AJC (92), No: (93), 50100234567891 (92).
        val r = runShield(listOf(boxed("AJC", 92.0, 0.0), boxed("No:", 93.0, 40.0), boxed("50100234567891", 92.0, 80.0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.BANK_ACCOUNT, listOf(2))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun `hides a grouped unlabelled account as one match over every group`() {
        val r = runShield(wordsFromLines(listOf("Beneficiary 5010 0234 5678 91")), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(1, 2, 3, 4))), r.matches)
    }

    @Test
    fun `never redacts a GSTIN next to a long digit run`() {
        val r = runShield(wordsFromLines(listOf("GSTIN 27AAPFU0939F1ZV 50100234567891")), 0.6)
        assertEquals(listOf(1), r.gstinWordIndexes)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(2))), r.matches)
    }

    @Test
    fun `does not count a run twice when an exact matcher already claimed it`() {
        assertEquals(listOf(PiiMatch(PiiType.BANK_ACCOUNT, listOf(2))), runShield(wordsFromLines(listOf("A/c No: 50100234567891")), 0.6).matches)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(1, 2))), runShield(wordsFromLines(listOf("Mob: 98450 12345")), 0.6).matches)
    }

    @Test
    fun `a hidden long run between a label and its value still means the value may have been missed`() {
        val r = runShield(wordsFromLines(listOf("PAN: 101002345678 AAPFU0939F")), 0.6)
        assertEquals(listOf(PiiType.PAN, PiiType.POSSIBLE_ID), r.matches.map { it.type })
        assertEquals(listOf("label_without_value:0"), r.uncertainReasons)
    }

    @Test
    fun `asks the human when unclaimed pieces of one digit run hold 9 or more digits`() {
        val r = runShield(wordsFromLines(listOf("Beneficiary 50100 2 34567891")), 0.6)
        assertEquals(emptyList<PiiMatch>(), r.matches)
        assertEquals(listOf("long_digit_run:0"), r.uncertainReasons)
    }

    @Test
    fun `hides a short leftover of a longer digit run instead of leaving it visible`() {
        val r = runShield(wordsFromLines(listOf("Ref 2341 2341 2340 5")), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(1, 2, 3)), PiiMatch(PiiType.POSSIBLE_ID, listOf(4))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun `leaves amounts, dates and times alone`() {
        for (line in listOf("Total 12345678.00", "Total 1,23,45,678.00", "Date: 02-11-2026 10:30", "Amount 5010023,78", "61369305 5787.00")) {
            val r = runShield(wordsFromLines(listOf(line)), 0.6)
            assertEquals(emptyList<PiiMatch>(), r.matches, line)
            assertFalse(r.uncertain, line)
        }
    }

    // Kotlin-only pins for the long-run rule (each value checked against the TypeScript core).

    @Test
    fun longRunGroupsSplitByJavaScriptWhitespaceAreOneRun() {
        // U+00A0 and U+2007 are JavaScript \s; the groups form one run and are hidden together.
        val r = runShield(listOf(word("5010\u00A00234\u20075678\u00A091", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), r.matches)
        // U+0085 is not: the pieces are too short to be a run.
        val n = runShield(listOf(word("50100\u00852345", 0)), 0.6)
        assertTrue(n.matches.isEmpty())
        assertFalse(n.uncertain)
    }

    @Test
    fun longRunEdgesAreAsciiDigitsOnly() {
        // Arabic-Indic and full-width digits are not \d in JavaScript: they neither extend nor block the run.
        val r = runShield(listOf(word("\u0661101002345678\uFF11", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), r.matches)
        // Eight ASCII digits with a ninth foreign digit are not a run.
        val n = runShield(listOf(word("10100234\u0665", 0)), 0.6)
        assertTrue(n.matches.isEmpty())
        assertFalse(n.uncertain)
    }

    @Test
    fun bankLabelAcceptsABackslashForTheSlash() {
        val r = runShield(listOf(word("A\\C", 0), word("No:", 0), word("50100234567891", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.BANK_ACCOUNT, listOf(2))), r.matches)
        assertFalse(r.uncertain)
        // A look-alike inside a longer word is not a label.
        assertEquals(listOf(PiiType.POSSIBLE_ID), runShield(listOf(word("ALCOHOL", 0), word("50100234567891", 0)), 0.6).matches.map { it.type })
    }

    // ---- runShield round 2: no partial claims, landlines in parentheses, no excuses for long runs

    private fun digitWordsHidden(line: String): Boolean {
        val words = wordsFromLines(listOf(line))
        val r = runShield(words, 0.6)
        val hidden = r.matches.flatMap { it.wordIndexes }.toSet()
        return words.indices.all { i -> words[i].text.none { it in '0'..'9' } || i in hidden || i in r.gstinWordIndexes }
    }

    @Test
    fun `no matcher leaves part of a longer digit run visible`() {
        for (line in listOf("98450 12345 6789", "Ref 2341 2341 2340 5", "Pay 50 1002 3456 7891", "Pay 2341 2341 2346 3196 76", "Account Number: 6437 6326 5127 3196 76")) {
            assertTrue(digitWordsHidden(line), line)
        }
    }

    @Test
    fun `a valid aadhaar inside a longer run is not reported as aadhaar`() {
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(1, 2, 3, 4, 5))), runShield(wordsFromLines(listOf("Pay 2341 2341 2346 3196 76")), 0.6).matches)
        assertEquals(listOf(PiiType.AADHAAR), runShield(wordsFromLines(listOf("Aadhaar: 2341 2341 2346.")), 0.6).matches.map { it.type })
    }

    @Test
    fun `the leftover of a run never takes a GSTIN word`() {
        val r = runShield(wordsFromLines(listOf("98450 12345 27AAPFU0939F1ZV")), 0.6)
        assertEquals(listOf(2), r.gstinWordIndexes)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(0, 1))), r.matches)
    }

    @Test
    fun `a parenthesised landline is a phone with or without a label`() {
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(0, 1, 2))), runShield(wordsFromLines(listOf("(080) 7229 7102")), 0.6).matches)
        val r = runShield(wordsFromLines(listOf("Tel: (0821) 2293 658")), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(1, 2, 3))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun `long runs are hidden whatever surrounds them`() {
        for (line in listOf("Pay to 50100234567891.00", "Pay to 1:50100234567891", "Ref 5010.0234.5678.91", "Ref 1234567890123456789")) {
            assertTrue(digitWordsHidden(line), line)
        }
    }

    @Test
    fun `an IFSC with a look-alike fifth character is an IFSC and satisfies its label`() {
        val r = runShield(wordsFromLines(listOf("IFSC: SBINO115094")), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.IFSC, listOf(1))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun `amount- and GSTIN-shaped words do not ask on their own, other low-confidence words still do`() {
        assertEquals(emptyList<String>(), runShield(wordsFromLines(listOf("|8,517.00 [3,098.00 1,15,840.00 3436.00 24KBSFKo70911ZX"), 40.0), 0.6).uncertainReasons)
        assertEquals(listOf("low_ocr_confidence:0", "low_ocr_confidence:1"), runShield(wordsFromLines(listOf("[735500 |25742500"), 40.0), 0.6).uncertainReasons)
    }

    // Kotlin-only pins for round 2 (each value checked against the TypeScript core).

    @Test
    fun runsAreJoinedByJavaScriptWhitespaceAndDotsOnly() {
        // U+3000 (JavaScript \s) and dots join groups into one run; U+0085 does not.
        val joined = runShield(listOf(word("5010\u30000234.5678\u300091", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), joined.matches)
        val apart = runShield(listOf(word("50100\u0085234.5678", 0)), 0.6)
        assertTrue(apart.matches.isEmpty())
        assertFalse(apart.uncertain)
    }

    @Test
    fun masksUseAsciiDigitsOnly() {
        // A full-width digit is not \d: "1\uFF12,345.00" is no amount mask for its "1", and the decimal tail still masks.
        val r = runShield(listOf(word("50100234567891\uFF15.00", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), r.matches)
        val a = runShield(listOf(word("Total", 0), word("1\u0662,345.00", 0)), 0.6)
        assertTrue(a.matches.isEmpty())
    }

    @Test
    fun borderEdgesAreTrimmedLikeTheJavaScriptPattern() {
        // Only edges: a border character inside the word keeps it from being an amount.
        assertEquals(emptyList<String>(), runShield(listOf(word("|[8,517.00]!", 0, 40.0)), 0.6).uncertainReasons)
        assertEquals(listOf("low_ocr_confidence:0"), runShield(listOf(word("|8,517.00|5", 0, 40.0)), 0.6).uncertainReasons)
    }

    @Test
    fun veryLongDigitStringsDoNotOverflowTheStack() {
        // java.util.regex recursed once per digit on the run patterns; the hand scanners do not (values from TypeScript).
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), runShield(listOf(word("1".repeat(100000), 0)), 0.6).matches)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(0))), runShield(listOf(word(List(20000) { "123" }.joinToString("-"), 0)), 0.6).matches)
        val dots = runShield(listOf(word(List(30000) { "1" }.joinToString("."), 0)), 0.6)
        assertTrue(dots.matches.isEmpty())
        assertEquals(listOf("long_digit_run:0"), dots.uncertainReasons)
        val tail = runShield(listOf(word("9845012345", 0), word(List(20000) { "12" }.joinToString("-"), 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(0)), PiiMatch(PiiType.POSSIBLE_ID, listOf(1))), tail.matches)
    }

    // ---- Kotlin-only pins of JavaScript semantics (a difference here would be a leak) ----

    private fun word(text: String, line: Int, confidence: Double = 95.0) = OcrWord(text, Box(0.0, 0.0, 10.0, 10.0), confidence, line)

    @Test
    fun mobileSplitByNoBreakSpaceIsFound() {
        // JavaScript \s matches U+00A0; Java's \s does not.
        val r = runShield(listOf(word("Mob:", 0), word("98450\u00A012345", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(1))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun everyJavaScriptWhitespaceSeparatesAMobile() {
        val ws = "\t\n\u000B\u000C\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A" +
            "\u2028\u2029\u202F\u205F\u3000\uFEFF"
        for (c in ws) {
            val r = runShield(listOf(word("98450${c}12345", 0)), 0.6)
            assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type }, "separator U+%04X".format(c.code))
        }
        // U+0085 and U+180E are not \s in JavaScript: the two halves are not one mobile.
        for (c in "\u0085\u180E") {
            val r = runShield(listOf(word("98450${c}12345", 0)), 0.6)
            assertFalse(r.matches.any { it.type == PiiType.PHONE }, "separator U+%04X".format(c.code))
        }
    }

    @Test
    fun aadhaarSplitByNoBreakSpaceIsFound() {
        val r = runShield(listOf(word("2341\u00A02341\u00A02346", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.AADHAAR, listOf(0))), r.matches)
    }

    @Test
    fun wordBoundaryIsAsciiOnly() {
        // In JavaScript \b sits between a non-ASCII letter and a digit; Unicode-aware \b (Android ICU) would not.
        val r = runShield(listOf(word("\u00E99845012345", 0)), 0.6)
        assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type })
        val p = runShield(listOf(word("\u00E9AAPFU0939F\u00E9", 0)), 0.6)
        assertEquals(listOf(PiiType.PAN), p.matches.map { it.type })
    }

    @Test
    fun nonAsciiDigitsAreNotDigits() {
        // JavaScript \d is ASCII only: Arabic-Indic digits next to a mobile do not block the (?<!\d) look-behind.
        val r = runShield(listOf(word("\u06619845012345\u0661", 0)), 0.6)
        assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type })
    }

    @Test
    fun upperCasingUsesFullRootMappings() {
        // Lower-case PAN is found after upper-casing; dotless i upper-cases to I in every locale (root mapping).
        val r = runShield(listOf(word("aapfu0939f", 0)), 0.6)
        assertEquals(listOf(PiiType.PAN), r.matches.map { it.type })
        // German sharp s upper-cases to two letters in JavaScript; the spans must follow the longer text.
        val s = runShield(listOf(word("stra\u00DFe", 0), word("AAPFU0939F", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PAN, listOf(1))), s.matches)
    }

    @Test
    fun sparseLinesBehaveAsEmptyLines() {
        // Line 5 has a label and line 6 its value; lines 0 to 4 do not exist (holes in the JavaScript array).
        val r = runShield(listOf(word("Bank", 5), word("Account", 5), word("50100234567890", 6)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.BANK_ACCOUNT, listOf(2))), r.matches)
        assertFalse(r.uncertain)
        // A label on the last line with nothing after it (the next line is a hole) is uncertain.
        assertEquals(listOf("label_without_value:7"), runShield(listOf(word("PAN", 7)), 0.6).uncertainReasons)
    }

    @Test
    fun wordsAreGroupedByLineIndexNotByOrder() {
        val r = runShield(listOf(word("98450", 1), word("Ref", 0), word("12345", 1)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(0, 2))), r.matches)
    }

    @Test
    fun emptyWordTextAddsNoSeparator() {
        // JavaScript: `if (line.text) line.text += ' '` - an empty first word leaves the text empty, so no space is added.
        val r = runShield(listOf(word("", 0), word("AAPFU0939F", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PAN, listOf(1))), r.matches)
    }

    @Test
    fun negativeLineIndexesAreInvisibleLikeJavaScriptArrayProperties() {
        // JavaScript stores lines[-1] as a plain property: forEach/map never visit it, so its words are not scanned.
        // OCR never produces negative lines; this pins the reproduction (see the task report).
        val r = runShield(listOf(word("AAPFU0939F", -1)), 0.6)
        assertTrue(r.matches.isEmpty())
        assertFalse(r.uncertain)
        // buildLines returns lines.map(...), a new array without the "-1" property, so line 0 does not see it as its
        // previous line either: a bank label there does not arm the bank matcher on line 0.
        // The number is still hidden, by the long-digit-run rule, but not as a labelled bank account.
        val b = runShield(listOf(word("Account", -1), word("50100234567890", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.POSSIBLE_ID, listOf(1))), b.matches)
        assertFalse(b.uncertain)
    }

    @Test
    fun reasonsKeepJavaScriptOrder() {
        // Per line: label reasons in key order PAN, AADHAAR, IFSC, PHONE, BANK_ACCOUNT, then word reasons.
        val r = runShield(wordsFromLines(listOf("Account IFSC PAN ABCDE12", "Mob")), 0.6)
        assertEquals(
            listOf("label_without_value:0", "label_without_value:0", "label_without_value:0", "partial_match:3", "label_without_value:1"),
            r.uncertainReasons,
        )
    }

    @Test
    fun matchesKeepJavaScriptOrderAndGstinWordsKeepInsertionOrder() {
        val r = runShield(wordsFromLines(listOf("29AAGCB7383J1Z4 Mob 98450 12345", "27AAPFU0939F1ZV PAN AAPFU0939F")), 0.6)
        assertEquals(listOf(0, 4), r.gstinWordIndexes)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(2, 3)), PiiMatch(PiiType.PAN, listOf(6))), r.matches)
    }

    @Test
    fun nanConfidenceIsNeverLow() {
        // JavaScript: NaN < 60 is false.
        val r = runShield(listOf(word("Ref1234", 0, Double.NaN)), 0.6)
        assertFalse(r.uncertain)
        val low = runShield(listOf(word("Ref1234", 0, 10.0)), 0.6)
        assertEquals(listOf("low_ocr_confidence:0"), low.uncertainReasons)
    }
}
