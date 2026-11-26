package com.hisaabcheck.core.shield

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/** Port of web/tests/core/checksums.test.ts. */
class ChecksumsTest {
    @ParameterizedTest(name = "accepts {0}")
    @ValueSource(strings = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAACR5055K1Z9", "33ABCDE1234F1Z7"])
    fun `GSTIN accepts`(g: String) = assertTrue(isValidGstin(g))

    @ParameterizedTest(name = "rejects {0}")
    @ValueSource(strings = ["29AAGCB7383J1Z5", "27AAPFU0939F1Z", "99AAPFU0939F1ZV", "27aapfu0939f1zv0"])
    fun `GSTIN rejects`(g: String) = assertFalse(isValidGstin(g))

    @Test
    fun `computes the check character`() = assertEquals("V", gstinCheckChar("27AAPFU0939F1Z"))

    @Test
    fun `reads state code`() = assertEquals(29.0, gstinStateCode("29AAGCB7383J1Z4"))

    @Test
    fun `parses place of supply`() {
        assertEquals(29, placeOfSupplyCode("29-Karnataka"))
        assertEquals(7, placeOfSupplyCode(" 07 Delhi"))
        assertNull(placeOfSupplyCode("Karnataka"))
    }

    @ParameterizedTest(name = "accepts {0}")
    @ValueSource(strings = ["234123412346", "498765432102", "567812345678"])
    fun `Verhoeff accepts`(d: String) = assertTrue(isValidVerhoeff(d))

    @ParameterizedTest(name = "rejects {0}")
    @ValueSource(strings = ["234123412340", "234123412341"])
    fun `Verhoeff rejects`(d: String) = assertFalse(isValidVerhoeff(d))

    // ---- Kotlin-only pins of JavaScript semantics ----

    @Test
    fun gstinWithTrailingNewlineIsRejectedLikeJavaScriptDollar() {
        // Java's $ also matches before a final line terminator; JavaScript's does not.
        assertFalse(isValidGstin("27AAPFU0939F1ZV\n"))
    }

    @Test
    fun gstinStateCodeIsJavaScriptNumber() {
        assertEquals(7.0, gstinStateCode(" 7"))
        assertEquals(0.0, gstinStateCode(""))
        assertTrue(gstinStateCode("AB").isNaN())
        assertEquals(1.0, gstinStateCode("1."))
        assertEquals(0.5, gstinStateCode(".5"))
    }

    @Test
    fun checkCharOfShortOrOddInputFollowsJavaScript() {
        // first14[i] is undefined past the end and indexOf gives -1; JavaScript % keeps the dividend's sign.
        assertEquals("Z", gstinCheckChar(""))
        assertEquals("D", gstinCheckChar("27aapfu0939f1z"))
    }

    @Test
    fun placeOfSupplySkipsJavaScriptWhitespaceOnly() {
        assertEquals(29, placeOfSupplyCode("\u00A0\u3000\uFEFF29"))
        assertNull(placeOfSupplyCode("\u008529"))
        assertNull(placeOfSupplyCode("\u0662\u0669"))
        assertNull(placeOfSupplyCode(null))
        assertNull(placeOfSupplyCode("x\n29"))
    }

    @Test
    fun verhoeffNeedsAsciiDigits() {
        assertFalse(isValidVerhoeff(""))
        assertFalse(isValidVerhoeff("23412341234\u0666"))
        assertFalse(isValidVerhoeff("234123412346\n"))
    }
}
