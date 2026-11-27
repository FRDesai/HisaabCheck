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
 * Port of web/tests/core/shieldRealOcr.test.ts: real Tesseract.js words for 64 synthetic, computer-rendered bills, with
 * ground truth. A private number is HIDDEN when every overlapping OCR word that holds a digit is in a match, PREVIEW when
 * it is not hidden but the bill goes to the human preview, and a SILENT LEAK otherwise.
 */
class ShieldRealOcrTest {
    private class Item(val kind: String, val private: Boolean, val value: String, val words: List<Int>)
    private class Bill(val name: String, val words: List<OcrWord>, val items: List<Item>)

    private val bills: List<Bill> = readRepoJson("shared/test-vectors/ocr-real.json").jsonObject.getValue("bills").jsonArray.map { b ->
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

    private class Result(
        val hidden: Int, val preview: Int, val leaks: List<String>, val previewBills: Int, val gstinWordsInMatches: Int,
        val notHidden: List<String>, val overHidden: Map<String, Int>,
    )

    private val r: Result = run {
        var hidden = 0
        var preview = 0
        var previewBills = 0
        var gstinInMatches = 0
        val leaks = mutableListOf<String>()
        val notHidden = mutableListOf<String>()
        val over = sortedMapOf<String, Int>()
        for (b in bills) {
            val s = runShield(b.words, 0.6)
            val previewed = s.uncertain || !ocrAdequate(b.words)
            if (previewed) previewBills++
            val matched = s.matches.flatMap { it.wordIndexes }.toSet()
            gstinInMatches += s.gstinWordIndexes.count { it in matched }
            for (item in b.items) {
                if (!item.private) {
                    if (item.words.any { it in matched }) over[item.kind] = (over[item.kind] ?: 0) + 1
                    continue
                }
                val digitWords = item.words.filter { i -> b.words[i].text.any { it in '0'..'9' } }
                if (digitWords.isNotEmpty() && digitWords.all { it in matched }) {
                    hidden++
                } else {
                    notHidden.add("${b.name} ${item.kind} ${item.value}")
                    if (previewed) preview++ else leaks.add("${b.name} ${item.kind} ${item.value}")
                }
            }
        }
        Result(hidden, preview, leaks, previewBills, gstinInMatches, notHidden, over)
    }

    @Test
    fun `holds 64 bills and 310 private numbers`() {
        assertEquals(64, bills.size)
        assertEquals(310, bills.sumOf { b -> b.items.count { it.private } })
    }

    @Test
    fun `never leaks a private number silently`() {
        assertEquals(emptyList<String>(), r.leaks)
    }

    @Test
    fun `never puts a GSTIN word in a match`() {
        assertEquals(0, r.gstinWordsInMatches)
    }

    @Test
    fun `hides the unlabelled parenthesised landlines and the 18-digit account tail`() {
        val all = bills.flatMap { b -> b.items.map { "${b.name} ${it.kind} ${it.value}" } }
        for (v in listOf(
            "hard00 LANDLINE (080) 7229 7102", "hard05 LANDLINE (080) 9788 6897", "hard10 LANDLINE (0821) 2293 658",
            "hard15 LANDLINE (044) 2557 7502", "hard13 BANK 6437 6326 5127 3196 76",
        )) {
            assertTrue(v in all, v)
            assertFalse(v in r.notHidden, v)
        }
    }

    @Test
    fun `pins the totals (a change here is a regression or an improvement to explain)`() {
        assertEquals(
            listOf(304, 6, 46, mapOf("AMOUNT" to 4, "EWAY" to 64, "HSN" to 6)),
            listOf(r.hidden, r.preview, r.previewBills, r.overHidden),
        )
    }
}
