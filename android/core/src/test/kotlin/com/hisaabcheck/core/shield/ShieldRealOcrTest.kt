package com.hisaabcheck.core.shield

import com.hisaabcheck.core.Box
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.readRepoJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Port of web/tests/core/shieldRealOcr.test.ts: real Tesseract.js words for synthetic, computer-rendered bills, with
 * ground truth, in three sets (the first 64 bills, 36 fresh bills from an independent re-review, and 30 bills with new
 * layouts from a third review). For each private number, looking at the OCR words overlapping it:
 * - a word is digit-like when it holds a digit, or at least 3 letters that are digit look-alikes (O I L S B Z) and those
 *   are more than half its letters; other words ("PAN:", "Account") are labels and do not count;
 * - NOT READ: no overlapping word is digit-like (OCR lost the number; there is nothing for the shield to hide). On a
 *   bill with no preview this is a silent leak too;
 * - HIDDEN: every digit-like overlapping word is in a match;
 * - PREVIEW, RELATED: not hidden, previewed, and a warning points at the number's own line (a missing-value warning on
 *   the line before also counts: that is its label), or OCR read too little of the bill;
 * - PREVIEW, UNRELATED: not hidden, previewed only because of a warning elsewhere;
 * - SILENT LEAK: not hidden and no preview.
 */
class ShieldRealOcrTest {
    private class Item(val kind: String, val private: Boolean, val value: String, val words: List<Int>)
    private class Bill(val name: String, val words: List<OcrWord>, val items: List<Item>)

    private data class Totals(val hidden: Int, val hiddenWithLabelVisible: Int, val related: Int, val unrelated: Int, val notRead: Int, val previewBills: Int)

    private class Result(val t: Totals, val leaks: List<String>, val notHidden: List<String>, val overHidden: Map<String, Int>, val gstinWordsInMatches: Int)

    private fun load(path: String): List<Bill> = readRepoJson(path).jsonObject.getValue("bills").jsonArray.map { b ->
        val o = b.jsonObject
        Bill(
            o.getValue("name").jsonPrimitive.content,
            o.getValue("words").jsonArray.map { w ->
                val a = w.jsonArray
                fun n(i: Int) = a[i].jsonPrimitive.double
                OcrWord(a[0].jsonPrimitive.content, Box(n(1), n(2), n(3), n(4)), n(5), a[6].jsonPrimitive.int)
            },
            o.getValue("items").jsonArray.map { it ->
                val a = it.jsonArray
                Item(a[0].jsonPrimitive.content, a[1].jsonPrimitive.int == 1, a[2].jsonPrimitive.content, (a[3] as JsonArray).map { i -> i.jsonPrimitive.int })
            },
        )
    }

    private fun evaluate(bills: List<Bill>): Result {
        var hidden = 0; var withLabel = 0; var related = 0; var unrelated = 0; var notRead = 0; var previewBills = 0; var gstinInMatches = 0
        val leaks = mutableListOf<String>()
        val notHidden = mutableListOf<String>()
        val over = sortedMapOf<String, Int>()
        for (b in bills) {
            val s = runShield(b.words, 0.6)
            val adequate = ocrAdequate(b.words)
            val previewed = s.uncertain || !adequate
            if (previewed) previewBills++
            val matched = s.matches.flatMap { it.wordIndexes }.toSet()
            gstinInMatches += s.gstinWordIndexes.count { it in matched }
            for (item in b.items) {
                if (!item.private) {
                    if (item.words.any { it in matched }) over[item.kind] = (over[item.kind] ?: 0) + 1
                    continue
                }
                val key = "${b.name} ${item.kind} ${item.value}"
                val digitWords = item.words.filter { digitLike(b.words[it].text) }
                if (digitWords.isEmpty()) {
                    notRead++
                    if (!previewed) leaks.add("$key (not read)")
                    continue
                }
                if (digitWords.all { it in matched }) {
                    hidden++
                    if (item.words.any { it !in matched }) withLabel++
                    continue
                }
                notHidden.add(key)
                if (!previewed) { leaks.add(key); continue }
                val lines = item.words.map { b.words[it].line }.toSet()
                val own = !adequate || s.uncertainReasons.any { x ->
                    val (k, n) = x.split(':')
                    val li = if (k == "low_ocr_confidence" || k == "partial_match") b.words[n.toInt()].line else n.toInt()
                    li in lines || (k == "label_without_value" && li + 1 in lines)
                }
                if (own) related++ else unrelated++
            }
        }
        return Result(Totals(hidden, withLabel, related, unrelated, notRead, previewBills), leaks, notHidden, over, gstinInMatches)
    }

    private class Set(val path: String, val privateCount: Int, val mustHide: List<String>, val totals: Totals, val overHidden: Map<String, Int>)

    private val sets = listOf(
        Set(
            "shared/test-vectors/ocr-real.json", 310,
            listOf(
                "hard00 LANDLINE (080) 7229 7102", "hard05 LANDLINE (080) 9788 6897", "hard10 LANDLINE (0821) 2293 658",
                "hard15 LANDLINE (044) 2557 7502", "hard13 BANK 6437 6326 5127 3196 76",
            ),
            Totals(hidden = 305, hiddenWithLabelVisible = 7, related = 5, unrelated = 0, notRead = 0, previewBills = 49),
            mapOf("AMOUNT" to 6, "EWAY" to 64, "HSN" to 6),
        ),
        Set(
            "shared/test-vectors/ocr-real-fresh.json", 198,
            listOf(
                "fresh30 BANK 8613 5061 1962", "fresh25 BANK 7552 7265 7128 9010", "fresh26 LANDLINE [044] 43087740",
                "fresh18 PHONE (+91) 9738994895", "fresh26 PHONE (+91) 8115403259", "fresh10 BANK 41335 35554 52147555",
                "fresh03 LANDLINE 040 - 83294496", "fresh15 LANDLINE 0484 - 3103832", "fresh21 LANDLINE 044 - 85526798", "fresh27 LANDLINE 080 - 56598603",
            ),
            Totals(hidden = 192, hiddenWithLabelVisible = 6, related = 3, unrelated = 0, notRead = 3, previewBills = 29),
            mapOf("AMOUNT" to 3, "HSN" to 1, "REF" to 36),
        ),
        Set(
            "shared/test-vectors/ocr-real-review3.json", 213,
            listOf(
                "rev3_03 LANDLINE 53850487", "rev3_07 LANDLINE 41055215", "rev3_13 LANDLINE 71302080", "rev3_17 LANDLINE 11708862",
                "rev3_23 LANDLINE 4003447", "rev3_27 LANDLINE 93855903", "rev3_12 LANDLINE 0712-8629 768",
            ),
            Totals(hidden = 191, hiddenWithLabelVisible = 11, related = 11, unrelated = 1, notRead = 10, previewBills = 27),
            mapOf("AMOUNT" to 23, "GSTIN" to 1, "HSN" to 7),
        ),
    )

    @Test
    fun `both sets hold the expected private numbers`() {
        for (s in sets) assertEquals(s.privateCount, load(s.path).sumOf { b -> b.items.count { it.private } }, s.path)
    }

    @Test
    fun `never leaks a private number silently`() {
        for (s in sets) assertEquals(emptyList<String>(), evaluate(load(s.path)).leaks, s.path)
    }

    @Test
    fun `never puts a GSTIN word in a match`() {
        for (s in sets) assertEquals(0, evaluate(load(s.path)).gstinWordsInMatches, s.path)
    }

    @Test
    fun `hides the numbers the reviews found leaking`() {
        for (s in sets) {
            val bills = load(s.path)
            val all = bills.flatMap { b -> b.items.map { "${b.name} ${it.kind} ${it.value}" } }
            val r = evaluate(bills)
            for (v in s.mustHide) {
                assertTrue(v in all, v)
                assertFalse(v in r.notHidden, v)
            }
        }
    }

    @Test
    fun `pins the totals (a change here is a regression or an improvement to explain)`() {
        for (s in sets) {
            val r = evaluate(load(s.path))
            assertEquals(s.totals, r.t, s.path)
            assertEquals(s.overHidden, r.overHidden, s.path)
        }
    }

    @Test
    fun `counts digit look-alike words as digits and labels as labels`() {
        assertEquals(listOf(true, true, true, false, false, false, false), listOf("5OIOO", "SBIN", "9845", "PAN:", "Account", "@ybl", "Mob:").map(::digitLike))
    }

    private companion object {
        fun digitLike(t: String): Boolean {
            if (t.any { it in '0'..'9' }) return true
            val letters = t.filter { it in 'A'..'Z' || it in 'a'..'z' }
            val n = letters.count { it.uppercaseChar() in "OILSBZ" }
            return n >= 3 && n * 2 > letters.length
        }
    }
}
