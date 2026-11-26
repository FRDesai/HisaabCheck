package com.hisaabcheck.core.shield

import com.hisaabcheck.core.PiiType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Port of web/tests/core/piiLabels.test.ts. */
class PiiLabelsTest {
    @Test
    fun `names POSSIBLE_ID for people`() = assertEquals("Possible ID number", piiLabel("POSSIBLE_ID"))

    @Test
    fun `names the other types`() = assertEquals(listOf("PAN", "Aadhaar", "Bank account"), listOf("PAN", "AADHAAR", "BANK_ACCOUNT").map(::piiLabel))

    @Test
    fun `passes unknown strings through`() {
        assertEquals("GSTIN", piiLabel("GSTIN"))
        assertEquals("toString", piiLabel("toString"))
    }

    @Test
    fun labelTableMatchesTheWeb() {
        assertEquals(
            mapOf(PiiType.PAN to "PAN", PiiType.AADHAAR to "Aadhaar", PiiType.PHONE to "Phone", PiiType.BANK_ACCOUNT to "Bank account",
                PiiType.IFSC to "IFSC", PiiType.POSSIBLE_ID to "Possible ID number"),
            PII_LABEL,
        )
        assertEquals("pan", piiLabel("pan"))
        assertEquals("__proto__", piiLabel("__proto__"))
    }
}
