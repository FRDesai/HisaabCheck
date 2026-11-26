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

    // ---- Kotlin-only pins of JavaScript semantics (a difference here would be a leak) ----

    private fun word(text: String, line: Int, confidence: Double = 95.0) = OcrWord(text, Box(0.0, 0.0, 10.0, 10.0), confidence, line)

    @Test
    fun mobileSplitByNoBreakSpaceIsFound() {
        // JavaScript \s matches U+00A0; Java's \s does not.
        val r = runShield(listOf(word("Mob:", 0), word("98450 12345", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.PHONE, listOf(1))), r.matches)
        assertFalse(r.uncertain)
    }

    @Test
    fun everyJavaScriptWhitespaceSeparatesAMobile() {
        val ws = "\t\n\u000B\u000C\r              " +
            "    　﻿"
        for (c in ws) {
            val r = runShield(listOf(word("98450${c}12345", 0)), 0.6)
            assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type }, "separator U+%04X".format(c.code))
        }
        // U+0085 and U+180E are not \s in JavaScript: the two halves are not one mobile.
        for (c in "\u0085᠎") {
            val r = runShield(listOf(word("98450${c}12345", 0)), 0.6)
            assertFalse(r.matches.any { it.type == PiiType.PHONE }, "separator U+%04X".format(c.code))
        }
    }

    @Test
    fun aadhaarSplitByNoBreakSpaceIsFound() {
        val r = runShield(listOf(word("2341 2341 2346", 0)), 0.6)
        assertEquals(listOf(PiiMatch(PiiType.AADHAAR, listOf(0))), r.matches)
    }

    @Test
    fun wordBoundaryIsAsciiOnly() {
        // In JavaScript \b sits between a non-ASCII letter and a digit; Unicode-aware \b (Android ICU) would not.
        val r = runShield(listOf(word("é9845012345", 0)), 0.6)
        assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type })
        val p = runShield(listOf(word("éAAPFU0939Fé", 0)), 0.6)
        assertEquals(listOf(PiiType.PAN), p.matches.map { it.type })
    }

    @Test
    fun nonAsciiDigitsAreNotDigits() {
        // JavaScript \d is ASCII only: Arabic-Indic digits next to a mobile do not block the (?<!\d) look-behind.
        val r = runShield(listOf(word("١9845012345١", 0)), 0.6)
        assertEquals(listOf(PiiType.PHONE), r.matches.map { it.type })
    }

    @Test
    fun upperCasingUsesFullRootMappings() {
        // Lower-case PAN is found after upper-casing; dotless i upper-cases to I in every locale (root mapping).
        val r = runShield(listOf(word("aapfu0939f", 0)), 0.6)
        assertEquals(listOf(PiiType.PAN), r.matches.map { it.type })
        // German sharp s upper-cases to two letters in JavaScript; the spans must follow the longer text.
        val s = runShield(listOf(word("straße", 0), word("AAPFU0939F", 0)), 0.6)
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
        val b = runShield(listOf(word("Account", -1), word("50100234567890", 0)), 0.6)
        assertTrue(b.matches.isEmpty())
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
