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
import kotlinx.serialization.json.doubleOrNull
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
        assertTrue(all.size >= 2500)
        checkAll("shield", all) { c ->
            val words = c.getValue("words").jsonArray.map { w ->
                val a = w.jsonArray
                OcrWord(a[0].jsonPrimitive.content, Box(a[3].jsonPrimitive.double, a[4].jsonPrimitive.double, a[5].jsonPrimitive.double, a[6].jsonPrimitive.double),
                    a[2].jsonPrimitive.doubleOrNull ?: Double.NaN, a[1].jsonPrimitive.int)
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
        assertTrue(all.size >= 2000)
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
}
