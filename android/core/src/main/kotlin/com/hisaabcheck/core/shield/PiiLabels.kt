package com.hisaabcheck.core.shield

import com.hisaabcheck.core.PiiType

// Port of web/src/core/shield/piiLabels.ts.

val PII_LABEL: Map<PiiType, String> = linkedMapOf(
    PiiType.PAN to "PAN", PiiType.AADHAAR to "Aadhaar", PiiType.PHONE to "Phone", PiiType.BANK_ACCOUNT to "Bank account",
    PiiType.IFSC to "IFSC", PiiType.POSSIBLE_ID to "Possible ID number",
)

/** Display name for a PII type; unknown strings (e.g. old or malformed logs) are shown as-is. */
fun piiLabel(type: String): String = PiiType.entries.firstOrNull { it.name == type }?.let { PII_LABEL.getValue(it) } ?: type
