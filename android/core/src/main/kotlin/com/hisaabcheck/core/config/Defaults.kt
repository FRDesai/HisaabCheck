package com.hisaabcheck.core.config

val DEFAULT_REMOTE_VALUES: Map<String, String> = mapOf(
    "routing_mode" to "smart", "confidence_threshold" to "0.8", "consent_ocr_threshold" to "0.6",
    "total_tolerance_inr" to "1", "max_device_line_items" to "10", "cloud_model" to "gemini-3.5-flash-lite",
    "extraction_prompt_version" to "v1", "mask_pii" to "true",
)
const val CLOUD_COST_PER_CALL_USD = 0.0003
const val DEVICE_TIMEOUT_MS = 8000L
const val MIN_OCR_WORDS = 15
const val MIN_OCR_MEDIAN_CONFIDENCE = 50.0
