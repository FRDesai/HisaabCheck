package com.hisaabcheck.core.extract

import com.hisaabcheck.core.LineItem
import com.hisaabcheck.core.config.parseConfig
import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of web/tests/core/parse.test.ts (parseExtraction and prompts). */
class ParseTest {
    // JSON.stringify(base) of the web test, key order kept.
    private val baseFields = listOf(
        "\"supplierName\":\"Ravi Traders\"", "\"supplierGstin\":\"29AAGCB7383J1Z4\"", "\"invoiceNo\":\"4521\"",
        "\"invoiceDate\":\"2026-11-02\"", "\"placeOfSupply\":\"29-Karnataka\"", "\"taxableValue\":1500", "\"cgst\":135",
        "\"sgst\":135", "\"igst\":0", "\"total\":1770", "\"confidence\":0.9",
    )
    private val base = "{" + baseFields.joinToString(",") + "}"

    /** JSON.stringify({ ...base, key: value }): an existing key keeps its place, a new key goes last. */
    private fun baseWith(key: String, json: String): String {
        val fields = baseFields.toMutableList()
        val i = fields.indexOfFirst { it.startsWith("\"$key\":") }
        if (i >= 0) fields[i] = "\"$key\":$json" else fields.add("\"$key\":$json")
        return "{" + fields.joinToString(",") + "}"
    }

    @Test
    fun `parses plain JSON`() = assertEquals(1770.0, parseExtraction(base)?.total)

    @Test
    fun `strips code fences and prose`() {
        assertEquals("4521", parseExtraction("Here you go:\n```json\n$base\n```")?.invoiceNo)
    }

    @Test
    fun `removes trailing commas`() {
        assertEquals(5.0, parseExtraction("{\"supplierName\":\"A\",\"total\":5,}")?.total)
    }

    @Test
    fun `coerces numeric strings with commas and rupee sign`() {
        assertEquals(1770.0, parseExtraction(baseWith("total", "\"\u20B91,770.00\""))?.total)
    }

    @Test
    fun `defaults missing fields`() {
        val e = parseExtraction("{\"total\": 10}")!!
        assertEquals("", e.supplierGstin)
        assertEquals(0.0, e.cgst)
        assertNull(e.items)
    }

    @Test
    fun `upper-cases and trims the GSTIN`() {
        assertEquals("29AAGCB7383J1Z4", parseExtraction(baseWith("supplierGstin", "\" 29aagcb7383j1z4 \""))?.supplierGstin)
    }

    @Test
    fun `skips null and non-object items without throwing`() {
        assertDoesNotThrow { parseExtraction("{\"total\":5,\"items\":[null]}") }
        assertEquals(emptyList<LineItem>(), parseExtraction("{\"total\":5,\"items\":[null]}")?.items)
    }

    @Test
    fun `skips string items and keeps valid object items`() {
        assertDoesNotThrow { parseExtraction("{\"total\":5,\"items\":[\"Rice\"]}") }
        val e = parseExtraction("{\"total\":5,\"items\":[\"Rice\", {\"description\":\"Dal\",\"amount\":\"10\"}]}")!!
        assertEquals(1, e.items!!.size)
        assertEquals(LineItem("Dal", "", 0.0, 0.0, 10.0), e.items[0])
    }

    @Test
    fun `parses amounts with a trailing slash-dash`() {
        assertEquals(1770.0, parseExtraction("{\"total\":\"1770/-\"}")?.total)
        assertEquals(1770.0, parseExtraction("{\"total\":\"\u20B91,770/-\"}")?.total)
    }

    @Test
    fun `omits itemCount when it is null`() {
        assertNull(parseExtraction("{\"total\":5,\"itemCount\":null}")!!.itemCount)
    }

    @Test
    fun `parses numeric-string itemCount`() {
        assertEquals(14.0, parseExtraction("{\"total\":5,\"itemCount\":\"14\"}")?.itemCount)
    }

    @Test
    fun `omits itemCount when it is not a number`() {
        assertNull(parseExtraction("{\"total\":5,\"itemCount\":\"many\"}")!!.itemCount)
    }

    @Test
    fun `returns null for garbage`() = assertNull(parseExtraction("sorry, cannot read"))

    @Test
    fun `parses items`() {
        val e = parseExtraction(baseWith("items", "[{\"description\":\"Rice\",\"hsn\":\"1006\",\"qty\":\"2\",\"rate\":50,\"amount\":\"100\"}]"))!!
        assertEquals(listOf(LineItem("Rice", "1006", 2.0, 50.0, 100.0)), e.items)
    }

    @Test
    fun `device prompt mentions the item limit`() {
        assertTrue(devicePrompt(parseConfig(emptyMap(), false).copy(maxDeviceLineItems = 7)).contains("7 or fewer"))
    }

    @Test
    fun `cloud prompt always asks for items`() = assertTrue(cloudPrompt(parseConfig(emptyMap(), false)).contains("\"items\""))

    // ---- Kotlin-only pins of JavaScript semantics ----

    @Test
    fun promptsAreExactlyTheWebText() {
        val cfg = parseConfig(emptyMap(), false)
        val fields = "supplierName, supplierGstin (15 characters), invoiceNo, invoiceDate (YYYY-MM-DD), placeOfSupply (as printed, e.g. " +
            "\"29-Karnataka\"), itemCount (number of line items), taxableValue, cgst, sgst, igst, total (numbers in rupees, no commas or " +
            "symbols), confidence (0 to 1, how sure you are)"
        val rules = "Use 0 for a missing tax and \"\" for missing text. Return ONLY one JSON object, no prose, no code fences."
        assertEquals(
            "You read Indian GST purchase bills. Read this bill and return JSON with keys: $fields. If itemCount is 10 or fewer, also " +
                "include \"items\": [{description, hsn, qty, rate, amount}]; otherwise omit \"items\". $rules",
            devicePrompt(cfg),
        )
        assertEquals(
            "You read Indian GST purchase bills. Some private numbers are blacked out; ignore them. Return JSON with keys: $fields, and " +
                "\"items\": [{description, hsn, qty, rate, amount}] for every line item. $rules",
            cloudPrompt(cfg),
        )
        // An unknown version falls back to v1.
        assertEquals(devicePrompt(cfg), devicePrompt(cfg.copy(extractionPromptVersion = "v9")))
    }

    @Test
    fun promptVersionNamingAnObjectPrototypeMemberThrowsLikeJavaScript() {
        // VERSIONS['toString'] is a function, not undefined, so `?? V1` does not apply and `.device` is not callable.
        val cfg = parseConfig(emptyMap(), false)
        for (v in listOf("toString", "constructor", "__proto__", "hasOwnProperty", "valueOf")) {
            assertThrows(IllegalStateException::class.java) { devicePrompt(cfg.copy(extractionPromptVersion = v)) }
            assertThrows(IllegalStateException::class.java) { cloudPrompt(cfg.copy(extractionPromptVersion = v)) }
        }
    }

    @Test
    fun numbersAsTextFollowJavaScriptStringOfNumber() {
        // toStr(number) is String(v): 4521 not 4521.0, 1e21 as 1e+21.
        val e = parseExtraction("{\"invoiceNo\":4521,\"supplierName\":1.5,\"invoiceDate\":1e21,\"placeOfSupply\":29.0,\"supplierGstin\":1e-7}")!!
        assertEquals("4521", e.invoiceNo)
        assertEquals("1.5", e.supplierName)
        assertEquals("1e+21", e.invoiceDate)
        assertEquals("29", e.placeOfSupply)
        assertEquals("1E-7", e.supplierGstin)
        val h = parseExtraction("{\"items\":[{\"hsn\":1006,\"description\":-0}]}")!!
        assertEquals(LineItem("0", "1006", 0.0, 0.0, 0.0), h.items!![0])
    }

    @Test
    fun amountStringsFollowJavaScriptNumber() {
        fun total(json: String) = parseExtraction("{\"total\":$json}")!!.total
        assertEquals(0.0, total("\"\""))
        assertEquals(16.0, total("\"0x10\""))
        assertEquals(1000.0, total("\"1e3\""))
        assertEquals(0.0, total("\"Infinity\""))
        assertEquals(0.0, total("\"12abc\""))
        assertEquals(1770.0, total("\"Rs. 1,770\""))
        assertEquals(1770.0, total("\"rs1770\""))
        assertEquals(1770.0, total("\"1\u00A0770\""))
        assertEquals(0.0, total("\"1770/-/-\""))
        assertEquals(0.0, total("1e400"))
        assertEquals(0.0, total("true"))
        assertEquals(0.0, total("null"))
        assertEquals(0.0, total("[5]"))
        assertEquals(0.5, total("\".5\""))
        assertEquals(5.0, total("\"5.\""))
        assertEquals(-5.0, total("\"-5\""))
        assertEquals(-5.0, total("\"- 5\""))
    }

    @Test
    fun itemCountFollowsJavaScriptRules() {
        fun count(json: String) = parseExtraction("{\"itemCount\":$json}")!!.itemCount
        assertEquals(0.0, count("\"\""))
        assertEquals(0.0, count("\"  \""))
        assertNull(count("-1"))
        assertNull(count("true"))
        assertNull(count("\"Infinity\""))
        assertEquals(2.5, count("2.5"))
        assertEquals(16.0, count("\" 0x10 \""))
    }

    @Test
    fun confidenceIsClamped() {
        assertEquals(1.0, parseExtraction("{\"confidence\":7}")!!.confidence)
        assertEquals(0.0, parseExtraction("{\"confidence\":-3}")!!.confidence)
        assertEquals(0.0, parseExtraction("{\"confidence\":\"x\"}")!!.confidence)
    }

    @Test
    fun rejectsWhatJsonParseRejects() {
        for (bad in listOf(
            "{\"total\":01}", "{\"total\":1.}", "{\"total\":+1}", "{\"total\":abc}", "{total:1}", "{'total':1}",
            "{\"total\":.5}", "{\"total\":NaN}", "{\"total\":Infinity}", "{\"a\":\"x\ty\"}", "{\"a\":\"\\x41\"}",
            "{\"a\":\"\\u12G4\"}", "{\"total\":1} {\"total\":2}", "{\"a\":[1,,2]}", "{\"a\":1 /* c */}", "{\"a\":tru}",
            "{\"a\":1\u00A0}", "{\"a\":-}", "{\"a\":1e}", "{\"a\":[}",
        )) {
            assertNull(parseExtraction(bad), bad)
        }
    }

    @Test
    fun acceptsWhatJsonParseAccepts() {
        assertEquals(2.0, parseExtraction("{\"total\":1,\"total\":2}")?.total, "last duplicate key wins")
        assertEquals("A/B", parseExtraction("{\"supplierName\":\"A\\/B\"}")?.supplierName)
        assertEquals("\uD800", parseExtraction("{\"supplierName\":\"\\uD800\"}")?.supplierName)
        assertEquals(-0.0, parseExtraction("{\"total\":-0}")?.total)
        assertEquals(1.0E-5, parseExtraction("{\"total\":1E-5}")?.total)
        assertNotNull(parseExtraction("{\r\n\t \"a\" : [ ] , \"b\" : { } }"))
        assertNotNull(parseExtraction("{\"a\":" + "[".repeat(5000) + "]".repeat(5000) + "}"))
        // The trailing-comma rewrite turns "{,}" into "{}".
        assertEquals(0.0, parseExtraction("{,}")?.total)
    }

    @Test
    fun trailingCommaRemovalUsesJavaScriptWhitespace() {
        assertEquals(5.0, parseExtraction("{\"total\":5,\u00A0}")?.total)
        assertEquals(5.0, parseExtraction("{\"total\":5,\u3000\n}")?.total)
        // It also rewrites inside strings, exactly as the web does.
        assertEquals("a}", parseExtraction("{\"supplierName\":\"a,}\"}")?.supplierName)
    }

    @Test
    fun gstinWhitespaceRemovalUsesJavaScriptWhitespace() {
        assertEquals("29AAGCB7383J1Z4", parseExtraction("{\"supplierGstin\":\"29AAG\u00A0CB7383\u2009J1Z4\uFEFF\"}")?.supplierGstin)
    }

    @Test
    fun textIsTrimmedWithJavaScriptWhitespace() {
        // JavaScript trim removes U+FEFF but not U+001C to U+001F; Kotlin's trim() does the opposite.
        assertEquals("Ravi", parseExtraction("{\"supplierName\":\"\\uFEFF Ravi\\u3000\"}")?.supplierName)
        assertEquals("\u001CRavi\u001F", parseExtraction("{\"supplierName\":\"\\u001CRavi\\u001F\"}")?.supplierName)
    }

    @Test
    fun outerBracesArePickedLikeTheWeb() {
        assertNull(parseExtraction("}{"))
        assertNull(parseExtraction("{"))
        assertNotNull(parseExtraction("x {} y"))
        assertNull(parseExtraction("[1, 2]"))
    }
}
