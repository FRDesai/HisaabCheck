package com.hisaabcheck.core.router

import com.hisaabcheck.core.BillStatus
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.PathTaken
import com.hisaabcheck.core.PiiType
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.RouteInfo
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of web/tests/core/routeLog.test.ts, plus pins for the Firestore field types the security rules require. */
class RouteLogTest {
    private val p = ProcessedBill(
        status = BillStatus.DRAFT, checks = null, redactedImage = "x".toByteArray(),
        extraction = Extraction(supplierName = "Ravi", supplierGstin = "29AAGCB7383J1Z4", invoiceNo = "1", invoiceDate = "2026-11-02",
            placeOfSupply = "", taxableValue = 1.0, cgst = 0.0, sgst = 0.0, igst = 0.0, total = 1.0, confidence = 1.0),
        route = RouteInfo(path = PathTaken.CLOUD, reason = Reason.TOTAL_MISMATCH, confidence = 0.6, promptVersion = "v1",
            modelName = "gemini-3.1-flash-lite"),
        piiTypes = listOf(PiiType.PAN), piiMasked = 1, latencyMs = 4200, estCostUsd = 0.0003,
    )

    @Test
    fun `contains only allowed keys and no bill content`() {
        // createdAt is the one key the store adds (server timestamp); every other key of the web's list is here.
        val log = toRouteLogFields(p, "b1", "s1", "u1")
        assertEquals((ROUTE_LOG_KEYS - "createdAt").sorted(), log.keys.sorted())
        val s = log.toString()
        assertFalse(s.contains("29AAGCB7383J1Z4"))
        assertFalse(s.contains("Ravi"))
        assertEquals("cloud", log["path"])
        assertEquals("total_mismatch", log["reason"])
        assertEquals(1, log["piiMasked"])
        assertEquals(listOf("PAN"), log["piiTypes"])
        assertEquals("android", log["platform"])
    }

    @Test
    fun `route log keys are the web's 13 names in the web's order`() {
        assertEquals(
            listOf("billId", "shopId", "caUid", "platform", "path", "reason", "piiMasked", "piiTypes",
                "latencyMs", "estCostUsd", "modelName", "promptVersion", "createdAt"),
            ROUTE_LOG_KEYS,
        )
    }

    @Test
    fun `fields have the exact values and the Kotlin types Firestore rules need`() {
        val log = toRouteLogFields(p, "b1", "s1", "u1")
        assertEquals(12, log.size)
        assertEquals(ROUTE_LOG_KEYS - "createdAt", log.keys.toList())
        assertEquals("b1", log["billId"])
        assertEquals("s1", log["shopId"])
        assertEquals("u1", log["caUid"])
        assertEquals("gemini-3.1-flash-lite", log["modelName"])
        assertEquals("v1", log["promptVersion"])
        // piiMasked must be a Kotlin Int (a Firestore integer), not a Double.
        assertTrue(log["piiMasked"] is Int)
        assertTrue(log["latencyMs"] is Long)
        assertEquals(4200L, log["latencyMs"])
        assertTrue(log["estCostUsd"] is Double)
        assertEquals(0.0003, log["estCostUsd"])
        val types = log["piiTypes"] as List<*>
        assertTrue(types.all { it is String })
        for (k in listOf("billId", "shopId", "caUid", "platform", "path", "reason", "modelName", "promptVersion")) {
            assertTrue(log[k] is String, k)
        }
    }

    @Test
    fun `every path and reason is written as its wire string and every PII type by its name`() {
        for (path in PathTaken.entries) for (reason in Reason.entries) {
            val q = ProcessedBill(BillStatus.MANUAL_ENTRY, null, null, RouteInfo(path, reason, 0.0, "v1", "gemini-nano"),
                PiiType.entries.toList(), PiiType.entries.size, 0, 0.0, null)
            val log = toRouteLogFields(q, "b", "s", "u")
            assertEquals(path.wire, log["path"])
            assertEquals(reason.wire, log["reason"])
            assertEquals(listOf("PAN", "AADHAAR", "PHONE", "BANK_ACCOUNT", "IFSC", "POSSIBLE_ID"), log["piiTypes"])
        }
    }
}
