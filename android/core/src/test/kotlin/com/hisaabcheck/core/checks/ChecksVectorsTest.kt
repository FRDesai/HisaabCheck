package com.hisaabcheck.core.checks

import com.hisaabcheck.core.Checks
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.LineItem
import com.hisaabcheck.core.config.parseConfig
import com.hisaabcheck.core.readRepoJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.time.Instant

/** A bill object as checks.test.ts passes it to runChecks (no parsing, the JSON values as they are). */
internal fun extractionOf(o: Map<String, JsonElement>): Extraction {
    fun s(k: String) = o.getValue(k).jsonPrimitive.content
    fun d(k: String) = o.getValue(k).jsonPrimitive.double
    return Extraction(
        supplierName = s("supplierName"), supplierGstin = s("supplierGstin"), invoiceNo = s("invoiceNo"),
        invoiceDate = s("invoiceDate"), placeOfSupply = s("placeOfSupply"),
        items = o["items"]?.jsonArray?.map { el ->
            val it = el.jsonObject
            LineItem(it.getValue("description").jsonPrimitive.content, it.getValue("hsn").jsonPrimitive.content,
                it.getValue("qty").jsonPrimitive.double, it.getValue("rate").jsonPrimitive.double, it.getValue("amount").jsonPrimitive.double)
        },
        itemCount = o["itemCount"]?.jsonPrimitive?.double,
        taxableValue = d("taxableValue"), cgst = d("cgst"), sgst = d("sgst"), igst = d("igst"), total = d("total"), confidence = d("confidence"),
    )
}

/** Runs shared/test-vectors/bills.json exactly as web/tests/core/checks.test.ts does. */
class ChecksVectorsTest {
    private val cfg = parseConfig(emptyMap(), false)
    private val today = Instant.parse("2026-11-20T10:00:00+05:30")
    private val all: List<JsonObject> = readRepoJson("shared/test-vectors/bills.json").jsonArray.map { it.jsonObject }
    private val base: JsonObject = all[0].getValue("bill").jsonObject

    @Test
    fun fileHoldsAtLeast10Cases() {
        assertTrue(all.size >= 10, "bills.json holds ${all.size} cases")
    }

    @TestFactory
    fun vectors(): List<DynamicTest> = all.map { v ->
        DynamicTest.dynamicTest(v.getValue("name").jsonPrimitive.content) {
            val bill = LinkedHashMap<String, JsonElement>((v["bill"] ?: base).jsonObject)
            for ((k, value) in (v["patch"]?.jsonObject ?: JsonObject(emptyMap()))) {
                if (value is JsonNull) bill.remove(k) else bill[k] = value
            }
            val r = runChecks(extractionOf(bill), cfg, today)
            val c = v.getValue("checks").jsonObject
            fun b(k: String) = c.getValue(k).jsonPrimitive.boolean
            assertEquals(Checks(b("total"), b("gstin"), b("taxSplit"), b("date"), b("required")), r.checks, "checks")
            // vitest toBeCloseTo(x, 5): |actual - expected| < 10^-5 / 2
            val expectedScore = v.getValue("score").jsonPrimitive.double
            assertTrue(kotlin.math.abs(r.score - expectedScore) < 0.000005, "score ${r.score} vs $expectedScore")
            assertEquals(v.getValue("hardFail").jsonPrimitive.contentOrNull, r.hardFail?.wire, "hardFail")
            assertEquals(v.getValue("escalate").jsonPrimitive.boolean, r.escalate, "escalate")
        }
    }
}
