package com.hisaabcheck.core

import com.hisaabcheck.core.checks.runChecks
import com.hisaabcheck.core.config.parseConfig
import com.hisaabcheck.core.extract.parseExtraction
import com.hisaabcheck.core.redact.planRedaction
import com.hisaabcheck.core.shield.ocrAdequate
import com.hisaabcheck.core.shield.runShield
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Replays the corpora in src/test/resources/differential/, made by running the web's TypeScript core on seeded random
 * inputs (src/test/differential/generate.ts). Every output must be identical, numbers bit for bit (-0 included).
 */
class DifferentialTest {
    private fun cases(name: String) = readTestResourceJson("differential/$name").jsonArray.map { it.jsonObject }

    /** The generator writes numbers as JavaScript String(n), with "-0" kept. */
    private fun jsNum(e: JsonElement): Double = when (val s = e.jsonPrimitive.content) {
        "NaN" -> Double.NaN
        "Infinity" -> Double.POSITIVE_INFINITY
        "-Infinity" -> Double.NEGATIVE_INFINITY
        else -> s.toDouble()
    }

    /** Bitwise equality: -0.0 differs from 0.0, NaN equals NaN. */
    private fun same(a: Double, b: Double) = a.toRawBits() == b.toRawBits() || (a.isNaN() && b.isNaN())

    private fun <T> checkAll(name: String, all: List<JsonObject>, one: (JsonObject) -> T?) {
        val failures = mutableListOf<String>()
        all.forEachIndexed { i, c -> one(c)?.let { failures.add("case $i: $it") } }
        assertTrue(failures.isEmpty(), "$name: ${failures.size} of ${all.size} cases differ from the TypeScript core:\n" + failures.take(15).joinToString("\n"))
    }

    @Test
    fun shieldAdequacyAndRedactionMatchTypeScript() {
        val all = cases("shield.json")
        assertTrue(all.size >= 1700, "shield corpus holds ${all.size} cases")
        checkAll("shield", all) { c ->
            val words = c.getValue("words").jsonArray.map { w ->
                val a = w.jsonArray
                OcrWord(a[0].jsonPrimitive.content, Box(a[3].jsonPrimitive.double, a[4].jsonPrimitive.double, a[5].jsonPrimitive.double, a[6].jsonPrimitive.double),
                    jsNum(a[2]), a[1].jsonPrimitive.int)
            }
            val r = runShield(words, c.getValue("threshold").jsonPrimitive.double)
            val expectedMatches = c.getValue("matches").jsonArray.map { m ->
                PiiMatch(PiiType.valueOf(m.jsonObject.getValue("type").jsonPrimitive.content), m.jsonObject.getValue("wordIndexes").jsonArray.map { it.jsonPrimitive.int })
            }
            val expected = ShieldResult(
                c.getValue("gstinWordIndexes").jsonArray.map { it.jsonPrimitive.int }, expectedMatches,
                c.getValue("uncertain").jsonPrimitive.boolean, c.getValue("uncertainReasons").jsonArray.map { it.jsonPrimitive.content },
            )
            val plan = planRedaction(words, r, 1000, 120)
            val expectedBoxes = c.getValue("boxes").jsonArray.map { b -> b.jsonArray.map { jsNum(it) } }
            val boxesSame = plan.boxes.size == expectedBoxes.size && plan.boxes.zip(expectedBoxes).all { (b, e) ->
                listOf(b.x0, b.y0, b.x1, b.y1).zip(e).all { (x, y) -> same(x, y) }
            }
            val types = c.getValue("piiTypes").jsonArray.map { PiiType.valueOf(it.jsonPrimitive.content) }
            val adequate = c.getValue("adequate").jsonPrimitive.boolean
            when {
                r != expected -> "words=${words.map { "${it.text}@${it.line}" }} expected $expected got $r"
                !boxesSame -> "boxes expected $expectedBoxes got ${plan.boxes}"
                plan.piiTypes != types || plan.piiMasked != expectedMatches.size -> "plan types expected $types got ${plan.piiTypes}"
                ocrAdequate(words) != adequate -> "ocrAdequate expected $adequate"
                else -> null
            }
        }
    }

    @Test
    fun parseExtractionMatchesTypeScript() {
        val all = cases("parse.json")
        assertTrue(all.size >= 1550, "parse corpus holds ${all.size} cases")
        checkAll("parse", all) { c ->
            val raw = c.getValue("raw").jsonPrimitive.content
            val got = parseExtraction(raw)
            val exp = c.getValue("expected")
            if (exp is JsonNull) return@checkAll if (got == null) null else "raw=$raw expected null got $got"
            if (got == null) return@checkAll "raw=$raw expected $exp got null"
            val o = exp.jsonObject
            val diffs = mutableListOf<String>()
            fun s(k: String, v: String) { if (o.getValue(k).jsonPrimitive.content != v) diffs.add("$k=$v") }
            fun n(k: String, v: Double) { if (!same(jsNum(o.getValue(k)), v)) diffs.add("$k=$v") }
            s("supplierName", got.supplierName); s("supplierGstin", got.supplierGstin); s("invoiceNo", got.invoiceNo)
            s("invoiceDate", got.invoiceDate); s("placeOfSupply", got.placeOfSupply)
            n("taxableValue", got.taxableValue); n("cgst", got.cgst); n("sgst", got.sgst); n("igst", got.igst); n("total", got.total)
            n("confidence", got.confidence)
            val ic = o.getValue("itemCount")
            if ((ic is JsonNull) != (got.itemCount == null) || (got.itemCount != null && !same(jsNum(ic), got.itemCount))) diffs.add("itemCount=${got.itemCount}")
            val items = o.getValue("items")
            if ((items is JsonNull) != (got.items == null)) diffs.add("items=${got.items}")
            else if (got.items != null) {
                val ei = items.jsonArray.map { it.jsonObject }
                val ok = ei.size == got.items.size && ei.zip(got.items).all { (e, g) ->
                    e.getValue("description").jsonPrimitive.content == g.description && e.getValue("hsn").jsonPrimitive.content == g.hsn &&
                        same(jsNum(e.getValue("qty")), g.qty) && same(jsNum(e.getValue("rate")), g.rate) && same(jsNum(e.getValue("amount")), g.amount)
                }
                if (!ok) diffs.add("items=${got.items}")
            }
            if (diffs.isEmpty()) null else "raw=$raw expected $o differs in $diffs"
        }
    }

    @Test
    fun parseConfigMatchesTypeScript() {
        val all = cases("config.json")
        assertTrue(all.size >= 600)
        checkAll("config", all) { c ->
            val values = c.getValue("values").jsonObject.mapValues { it.value.jsonPrimitive.content }
            val got = parseConfig(values, c.getValue("isProd").jsonPrimitive.boolean)
            val e = c.getValue("expected").jsonObject
            val ok = e.getValue("routingMode").jsonPrimitive.content == got.routingMode.wire &&
                same(jsNum(e.getValue("confidenceThreshold")), got.confidenceThreshold) &&
                same(jsNum(e.getValue("consentOcrThreshold")), got.consentOcrThreshold) &&
                same(jsNum(e.getValue("totalToleranceInr")), got.totalToleranceInr) &&
                // Config.maxDeviceLineItems is an Int (the Task 1 contract), which has no -0: compare numerically (-0 == 0).
                // Nothing observes the sign: the prompt prints `${-0}` as "0" and comparisons treat -0 as 0.
                jsNum(e.getValue("maxDeviceLineItems")) == got.maxDeviceLineItems.toDouble() &&
                e.getValue("cloudModel").jsonPrimitive.content == got.cloudModel &&
                e.getValue("extractionPromptVersion").jsonPrimitive.content == got.extractionPromptVersion &&
                e.getValue("maskPii").jsonPrimitive.boolean == got.maskPii
            if (ok) null else "values=$values expected $e got $got"
        }
    }

    @Test
    fun runChecksMatchesTypeScript() {
        val all = cases("checks.json")
        assertTrue(all.size >= 1200)
        val base = parseConfig(emptyMap(), false)
        checkAll("checks", all) { c ->
            val b = c.getValue("bill").jsonObject
            fun s(k: String) = b.getValue(k).jsonPrimitive.content
            val e = Extraction(
                supplierName = s("supplierName"), supplierGstin = s("supplierGstin"), invoiceNo = s("invoiceNo"), invoiceDate = s("invoiceDate"),
                placeOfSupply = s("placeOfSupply"),
                items = (b.getValue("items") as? kotlinx.serialization.json.JsonArray)?.map { el ->
                    val i = el.jsonObject
                    LineItem(i.getValue("description").jsonPrimitive.content, i.getValue("hsn").jsonPrimitive.content,
                        i.getValue("qty").jsonPrimitive.double, i.getValue("rate").jsonPrimitive.double, jsNum(i.getValue("amount")))
                },
                taxableValue = jsNum(b.getValue("taxableValue")), cgst = jsNum(b.getValue("cgst")), sgst = jsNum(b.getValue("sgst")),
                igst = jsNum(b.getValue("igst")), total = jsNum(b.getValue("total")), confidence = jsNum(b.getValue("confidence")),
            )
            val cfg = base.copy(confidenceThreshold = jsNum(c.getValue("confidenceThreshold")), totalToleranceInr = jsNum(c.getValue("totalToleranceInr")))
            val r = runChecks(e, cfg, Instant.parse(c.getValue("today").jsonPrimitive.content))
            val ch = c.getValue("checks").jsonObject
            fun f(k: String) = ch.getValue(k).jsonPrimitive.boolean
            val expected = CheckResult(
                Checks(f("total"), f("gstin"), f("taxSplit"), f("date"), f("required")), jsNum(c.getValue("score")),
                c.getValue("hardFail").jsonPrimitive.contentOrNull?.let { w -> Reason.entries.single { it.wire == w } },
                c.getValue("escalate").jsonPrimitive.boolean,
            )
            if (r.checks == expected.checks && same(r.score, expected.score) && r.hardFail == expected.hardFail && r.escalate == expected.escalate) null
            else "bill=$b today=${c["today"]} expected $expected got $r"
        }
    }

    @Test
    fun corporaAreLargeEnoughToMeanSomething() {
        val shield = cases("shield.json")
        assertTrue(shield.count { it.getValue("matches").jsonArray.isNotEmpty() } > 1000)
        assertTrue(shield.count { !it.getValue("uncertain").jsonPrimitive.boolean } > 100)
        val parse = cases("parse.json")
        assertTrue(parse.count { it.getValue("expected") is JsonNull } > 300)
        assertTrue(parse.count { it.getValue("expected") !is JsonNull } > 1000)
    }

    @Test
    fun corporaHoldEveryEdgeCategory() {
        fun cats(name: String) = cases(name).mapNotNull { it["cat"]?.jsonPrimitive?.content }.groupingBy { it }.eachCount()
        val shield = cats("shield.json")
        for (c in listOf("negative_line", "surrogates_emoji", "lone_surrogates", "case_mapping", "foreign_digits", "confidence_extremes", "long_lines", "empty_words", "long_digit_runs", "digit_run_edges", "real_ocr", "real_ocr_fresh", "round3_edges", "real_ocr_review3", "round4_edges")) {
            assertTrue((shield[c] ?: 0) >= 10, "shield edge category $c has ${shield[c] ?: 0} cases")
        }
        val parse = cats("parse.json")
        for (c in listOf("unicode_escapes", "lone_surrogates", "astral_raw", "astral_escaped", "duplicate_keys", "deep_nesting", "foreign_digits")) {
            assertTrue((parse[c] ?: 0) >= 20, "parse edge category $c has ${parse[c] ?: 0} cases")
        }
    }

    /** (category, text) of every edge case: the joined word texts for the shield, the raw model reply for the parser. */
    private fun edgeTexts(name: String): List<Pair<String, String>> = cases(name).mapNotNull { c ->
        val cat = c["cat"]?.jsonPrimitive?.content ?: return@mapNotNull null
        val text = c["raw"]?.jsonPrimitive?.content ?: c.getValue("words").jsonArray.joinToString(" ") { it.jsonArray[0].jsonPrimitive.content }
        cat to text
    }

    @Test
    fun everyNamedCodePointReallyOccursInItsCategory() {
        val failures = presenceFailures(edgeTexts("shield.json"), edgeTexts("parse.json"))
        assertTrue(failures.isEmpty(), failures.joinToString("\n"))
    }

    @Test
    fun presenceCheckCatchesAMisEscapedConstant() {
        // The bug this guards against: a five-hex-digit escape read as U+1F60 followed by the digit 0 instead of U+1F600.
        val emoji = cpString(0x1F600)
        val wrong = cpString(0x1F60) + "0"
        val shield = edgeTexts("shield.json").map { (c, t) -> c to t.replace(emoji, wrong) }
        val parse = edgeTexts("parse.json").map { (c, t) -> c to t.replace(emoji, wrong).replace(Regex(Regex.escape(escaped(emoji)), RegexOption.IGNORE_CASE), Regex.escapeReplacement(escaped(wrong))) }
        val failures = presenceFailures(shield, parse)
        assertTrue(failures.any { it.startsWith("surrogates_emoji: U+1F600") }, failures.toString())
        assertTrue(failures.any { it.startsWith("astral_raw: U+1F600") }, failures.toString())
        assertTrue(failures.any { it.startsWith("astral_escaped: U+1F600") }, failures.toString())
        // A missing ligature is caught too.
        val noLigature = edgeTexts("shield.json").map { (c, t) -> c to t.replace(cpString(0xFB01), "fi") }
        assertTrue(presenceFailures(noLigature, edgeTexts("parse.json")).any { it.startsWith("case_mapping: U+FB01") })
    }

    private companion object {
        fun cpString(vararg cps: Int): String = buildString { for (c in cps) appendCodePoint(c) }

        /** JSON escape form of every UTF-16 unit of [s]: backslash, u, four lower-case hex digits. */
        fun escaped(s: String): String = s.map { 92.toChar().toString() + "u" + "%04x".format(it.code) }.joinToString("")

        fun hasLoneSurrogate(t: String): Boolean {
            var i = 0
            while (i < t.length) {
                val c = t[i]
                if (Character.isHighSurrogate(c) && i + 1 < t.length && Character.isLowSurrogate(t[i + 1])) { i += 2; continue }
                if (Character.isSurrogate(c)) return true
                i++
            }
            return false
        }

        /** Which named code points are missing (or too rare) in their categories; empty when every check holds. */
        fun presenceFailures(shield: List<Pair<String, String>>, parse: List<Pair<String, String>>): List<String> {
            val out = mutableListOf<String>()
            fun need(cases: List<Pair<String, String>>, cat: String, label: String, min: Int, test: (String) -> Boolean) {
                val n = cases.count { it.first == cat && test(it.second) }
                if (n < min) out.add("$cat: $label occurs in $n cases, need at least $min")
            }
            val astral = listOf("U+1F600" to cpString(0x1F600), "U+1F1EE U+1F1F3" to cpString(0x1F1EE, 0x1F1F3), "U+1D7CF" to cpString(0x1D7CF))
            for ((label, s) in astral) {
                need(shield, "surrogates_emoji", label, 10) { it.contains(s) }
                need(parse, "astral_raw", "$label raw", 8) { it.contains(s) }
                need(parse, "astral_escaped", "$label escaped pair", 8) { it.contains(escaped(s), ignoreCase = true) }
            }
            for ((label, cp) in listOf("U+FB01" to 0xFB01, "U+0131" to 0x131, "U+017F" to 0x17F, "U+00DF" to 0xDF)) {
                need(shield, "case_mapping", label, 10) { it.contains(cpString(cp)) }
            }
            need(parse, "unicode_escapes", "an escaped astral pair", 10) { t -> astral.any { t.contains(escaped(it.second), ignoreCase = true) } }
            need(parse, "foreign_digits", "an astral pair", 10) { t -> astral.any { t.contains(it.second) || t.contains(escaped(it.second), ignoreCase = true) } }
            need(shield, "lone_surrogates", "a lone surrogate", 15, ::hasLoneSurrogate)
            val loneEscape = Regex(92.toChar().toString().repeat(2) + "u[dD][89a-fA-F][0-9a-fA-F]{2}")
            need(parse, "lone_surrogates", "a lone surrogate (raw or escaped)", 40) { hasLoneSurrogate(it) || loneEscape.containsMatchIn(it) }
            return out
        }
    }
}
