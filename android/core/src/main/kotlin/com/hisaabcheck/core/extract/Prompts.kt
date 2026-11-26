package com.hisaabcheck.core.extract

import com.hisaabcheck.core.Config

// Port of web/src/core/extract/prompts.ts. The text must stay identical to the web's.

private const val FIELDS =
    "supplierName, supplierGstin (15 characters), invoiceNo, invoiceDate (YYYY-MM-DD), placeOfSupply (as printed, e.g. \"29-Karnataka\"), " +
        "itemCount (number of line items), taxableValue, cgst, sgst, igst, total (numbers in rupees, no commas or symbols), " +
        "confidence (0 to 1, how sure you are)"
private const val RULES = "Use 0 for a missing tax and \"\" for missing text. Return ONLY one JSON object, no prose, no code fences."

private class PromptVersion(val device: (Int) -> String, val cloud: () -> String)

private val V1 = PromptVersion(
    device = { max ->
        "You read Indian GST purchase bills. Read this bill and return JSON with keys: $FIELDS. " +
            "If itemCount is $max or fewer, also include \"items\": [{description, hsn, qty, rate, amount}]; otherwise omit \"items\". $RULES"
    },
    cloud = {
        "You read Indian GST purchase bills. Some private numbers are blacked out; ignore them. Return JSON with keys: $FIELDS, " +
            "and \"items\": [{description, hsn, qty, rate, amount}] for every line item. $RULES"
    },
)
private val VERSIONS = mapOf("v1" to V1)

/**
 * The names an empty JavaScript object inherits from Object.prototype. In the web, VERSIONS[name] for one of these is
 * not undefined, so `?? V1` does not apply and calling `.device`/`.cloud` on it throws a TypeError.
 */
private val OBJECT_PROTOTYPE_NAMES = setOf(
    "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__",
    "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString",
)

private fun pick(cfg: Config): PromptVersion {
    val v = cfg.extractionPromptVersion
    VERSIONS[v]?.let { return it }
    check(v !in OBJECT_PROTOTYPE_NAMES) { "prompt version '$v' is not a prompt set (the web throws a TypeError here)" }
    return V1
}

fun devicePrompt(cfg: Config): String = pick(cfg).device(cfg.maxDeviceLineItems)
fun cloudPrompt(cfg: Config): String = pick(cfg).cloud()
