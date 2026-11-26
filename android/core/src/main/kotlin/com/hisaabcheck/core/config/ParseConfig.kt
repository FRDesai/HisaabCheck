package com.hisaabcheck.core.config

import com.hisaabcheck.core.Config
import com.hisaabcheck.core.RoutingMode
import com.hisaabcheck.core.shield.jsIsFinite
import com.hisaabcheck.core.shield.jsNumber
import com.hisaabcheck.core.shield.jsRound
import com.hisaabcheck.core.shield.jsTrim

// Port of web/src/core/config/parseConfig.ts. Number(), trim() and Math.round are JavaScript's (see JsSemantics.kt).

private val D = DEFAULT_REMOTE_VALUES

private fun num(v: String?, def: String, min: Double, max: Double): Double {
    if (v == null || jsTrim(v).isEmpty()) return jsNumber(def)
    val n = jsNumber(v)
    return if (n.jsIsFinite() && n >= min && n <= max) n else jsNumber(def)
}

fun parseConfig(values: Map<String, String>, isProd: Boolean): Config {
    val mode = values["routing_mode"]
    val routingMode = RoutingMode.entries.firstOrNull { it.wire == mode }
        ?: RoutingMode.entries.single { it.wire == D.getValue("routing_mode") }
    return Config(
        routingMode = routingMode,
        confidenceThreshold = num(values["confidence_threshold"], D.getValue("confidence_threshold"), 0.0, 1.0),
        consentOcrThreshold = num(values["consent_ocr_threshold"], D.getValue("consent_ocr_threshold"), 0.0, 1.0),
        totalToleranceInr = num(values["total_tolerance_inr"], D.getValue("total_tolerance_inr"), 0.0, 100.0),
        maxDeviceLineItems = jsRound(num(values["max_device_line_items"], D.getValue("max_device_line_items"), 0.0, 100.0)).toInt(),
        cloudModel = values["cloud_model"]?.let(::jsTrim)?.ifEmpty { null } ?: D.getValue("cloud_model"),
        extractionPromptVersion = values["extraction_prompt_version"]?.let(::jsTrim)?.ifEmpty { null } ?: D.getValue("extraction_prompt_version"),
        maskPii = if (isProd) true else (values["mask_pii"] ?: D.getValue("mask_pii")) != "false",
    )
}
