package com.hisaabcheck.core.config

import com.hisaabcheck.core.Config
import com.hisaabcheck.core.RoutingMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Port of web/tests/core/parseConfig.test.ts. */
class ParseConfigTest {
    @Test
    fun `uses bundled defaults for an empty map`() {
        assertEquals(
            Config(
                routingMode = RoutingMode.SMART, confidenceThreshold = 0.8, consentOcrThreshold = 0.6,
                totalToleranceInr = 1.0, maxDeviceLineItems = 10, cloudModel = "gemini-3.5-flash-lite",
                extractionPromptVersion = "v1", maskPii = true,
            ),
            parseConfig(emptyMap(), false),
        )
    }

    @Test
    fun `reads valid overrides`() {
        val c = parseConfig(mapOf("routing_mode" to "device_only", "confidence_threshold" to "0.7", "max_device_line_items" to "5"), false)
        assertEquals(RoutingMode.DEVICE_ONLY, c.routingMode)
        assertEquals(0.7, c.confidenceThreshold)
        assertEquals(5, c.maxDeviceLineItems)
    }

    @Test
    fun `falls back per key on invalid values`() {
        val c = parseConfig(mapOf("routing_mode" to "yolo", "confidence_threshold" to "7", "total_tolerance_inr" to "abc"), false)
        assertEquals(RoutingMode.SMART, c.routingMode)
        assertEquals(0.8, c.confidenceThreshold)
        assertEquals(1.0, c.totalToleranceInr)
    }

    @Test
    fun `allows mask_pii=false only outside prod`() {
        assertFalse(parseConfig(mapOf("mask_pii" to "false"), false).maskPii)
        assertTrue(parseConfig(mapOf("mask_pii" to "false"), true).maskPii)
    }

    // ---- Kotlin-only pins of JavaScript semantics ----

    @Test
    fun maxDeviceLineItemsRoundsTiesUpLikeJavaScriptMathRound() {
        assertEquals(3, parseConfig(mapOf("max_device_line_items" to "2.5"), false).maxDeviceLineItems)
        assertEquals(4, parseConfig(mapOf("max_device_line_items" to "3.5"), false).maxDeviceLineItems)
        assertEquals(2, parseConfig(mapOf("max_device_line_items" to "2.4999999999999996"), false).maxDeviceLineItems)
        assertEquals(0, parseConfig(mapOf("max_device_line_items" to "0.49999999999999994"), false).maxDeviceLineItems)
        assertEquals(100, parseConfig(mapOf("max_device_line_items" to "99.5"), false).maxDeviceLineItems)
        assertEquals(10, parseConfig(mapOf("max_device_line_items" to "100.5"), false).maxDeviceLineItems)
    }

    @Test
    fun numbersAreReadWithJavaScriptNumber() {
        assertEquals(0.5, parseConfig(mapOf("confidence_threshold" to " .5 "), false).confidenceThreshold)
        assertEquals(1.0, parseConfig(mapOf("confidence_threshold" to "0x1"), false).confidenceThreshold)
        assertEquals(0.1, parseConfig(mapOf("confidence_threshold" to "1e-1"), false).confidenceThreshold)
        assertEquals(0.7, parseConfig(mapOf("confidence_threshold" to " 0.7﻿"), false).confidenceThreshold)
        assertEquals(0.8, parseConfig(mapOf("confidence_threshold" to ""), false).confidenceThreshold)
        assertEquals(0.8, parseConfig(mapOf("confidence_threshold" to " 　"), false).confidenceThreshold)
        assertEquals(0.8, parseConfig(mapOf("confidence_threshold" to "0.7d"), false).confidenceThreshold)
        assertEquals(0.8, parseConfig(mapOf("confidence_threshold" to "NaN"), false).confidenceThreshold)
        assertEquals(1.0, parseConfig(mapOf("total_tolerance_inr" to "Infinity"), false).totalToleranceInr)
        assertEquals(0.8, parseConfig(mapOf("confidence_threshold" to "0.7\u001C"), false).confidenceThreshold)
        assertEquals(5.0, parseConfig(mapOf("total_tolerance_inr" to "0b101"), false).totalToleranceInr)
        assertEquals(8.0, parseConfig(mapOf("total_tolerance_inr" to "0o10"), false).totalToleranceInr)
        assertEquals(1.0, parseConfig(mapOf("total_tolerance_inr" to "-0x5"), false).totalToleranceInr)
        assertEquals(1.0, parseConfig(mapOf("total_tolerance_inr" to "1_0"), false).totalToleranceInr)
        assertEquals(-0.0, parseConfig(mapOf("total_tolerance_inr" to "-0"), false).totalToleranceInr)
    }

    @Test
    fun textValuesAreTrimmedAndEmptyFallsBack() {
        val c = parseConfig(mapOf("cloud_model" to "  ", "extraction_prompt_version" to " v2 "), false)
        assertEquals("gemini-3.5-flash-lite", c.cloudModel)
        assertEquals("v2", c.extractionPromptVersion)
        assertEquals("m", parseConfig(mapOf("cloud_model" to "﻿m "), false).cloudModel)
    }

    @Test
    fun routingModeAndMaskPiiAreExact() {
        assertEquals(RoutingMode.SMART, parseConfig(mapOf("routing_mode" to " cloud_only"), false).routingMode)
        assertEquals(RoutingMode.CLOUD_ONLY, parseConfig(mapOf("routing_mode" to "cloud_only"), false).routingMode)
        assertTrue(parseConfig(mapOf("mask_pii" to "FALSE"), false).maskPii)
        assertTrue(parseConfig(mapOf("mask_pii" to " false"), false).maskPii)
    }
}
