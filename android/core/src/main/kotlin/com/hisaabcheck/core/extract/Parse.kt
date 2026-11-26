package com.hisaabcheck.core.extract

import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.LineItem
import com.hisaabcheck.core.shield.JS_S
import com.hisaabcheck.core.shield.JS_WS_CLASS_BODY
import com.hisaabcheck.core.shield.isJsWhitespace
import com.hisaabcheck.core.shield.jsIsFinite
import com.hisaabcheck.core.shield.jsNumber
import com.hisaabcheck.core.shield.jsNumberToString
import com.hisaabcheck.core.shield.jsTrim
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of web/src/core/extract/parse.ts. Number(), String(number), trim() and \s are JavaScript's (see JsSemantics.kt).

private val json = Json { isLenient = false }

/** A JSON number (kotlinx keeps its literal text; the strict check below guarantees the JSON number grammar). */
private fun JsonElement?.jsonNumber(): Double? =
    if (this is JsonPrimitive && this !is JsonNull && !isString && content != "true" && content != "false") content.toDouble() else null

private fun JsonElement?.jsonString(): String? = if (this is JsonPrimitive && isString) content else null

private val MONEY_NOISE = Regex("[\u20B9,$JS_WS_CLASS_BODY]|[Rr][Ss]\\.?") // /[\u20B9,\s]|Rs\.?/gi; the i flag only affects R and s

private fun toNum(v: JsonElement?): Double {
    v.jsonNumber()?.let { return if (it.jsIsFinite()) it else 0.0 }
    v.jsonString()?.let { s ->
        val t = jsTrim(s).let { if (it.endsWith("/-")) it.dropLast(2) else it } // .replace(/\/-$/, '')
        val n = jsNumber(t.replace(MONEY_NOISE, ""))
        return if (n.jsIsFinite()) n else 0.0
    }
    return 0.0
}

// Count as a finite non-negative number, or null so the key is omitted.
private fun toCount(v: JsonElement?): Double? {
    val n = v.jsonNumber() ?: v.jsonString()?.let { jsNumber(jsTrim(it)) } ?: Double.NaN
    return if (n.jsIsFinite() && n >= 0) n else null
}

private fun toStr(v: JsonElement?): String = v.jsonString()?.let(::jsTrim) ?: v.jsonNumber()?.let(::jsNumberToString) ?: ""

private val TRAILING_COMMA = Regex(",$JS_S*([}\\]])")

fun parseExtraction(raw: String): Extraction? {
    val start = raw.indexOf('{')
    val end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    val body = raw.substring(start, end + 1).replace(TRAILING_COMMA, "\$1")
    // JSON.parse accepts exactly the JSON grammar; kotlinx also reads unquoted literals leniently (01, +1, abc),
    // so the text is checked against the grammar first.
    if (!isStrictJson(body)) return null
    val o = try { json.parseToJsonElement(body) } catch (_: Exception) { return null }
    if (o !is JsonObject) return null
    val rawItems = o["items"]
    val items = if (rawItems is JsonArray) {
        rawItems.filterIsInstance<JsonObject>().map { it ->
            LineItem(description = toStr(it["description"]), hsn = toStr(it["hsn"]), qty = toNum(it["qty"]), rate = toNum(it["rate"]), amount = toNum(it["amount"]))
        }
    } else null
    return Extraction(
        supplierName = toStr(o["supplierName"]),
        supplierGstin = toStr(o["supplierGstin"]).uppercase().filterNot(::isJsWhitespace),
        invoiceNo = toStr(o["invoiceNo"]),
        invoiceDate = toStr(o["invoiceDate"]),
        placeOfSupply = toStr(o["placeOfSupply"]),
        items = items,
        itemCount = toCount(o["itemCount"]),
        taxableValue = toNum(o["taxableValue"]), cgst = toNum(o["cgst"]), sgst = toNum(o["sgst"]), igst = toNum(o["igst"]),
        total = toNum(o["total"]), confidence = Math.min(1.0, Math.max(0.0, toNum(o["confidence"]))),
    )
}

/** True when [s] is one JSON text exactly as JSON.parse accepts it (ECMA-404). Iterative, so deep nesting is fine. */
internal fun isStrictJson(s: String): Boolean {
    var i = 0
    val n = s.length
    fun ws() { while (i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++ }
    fun isHex(c: Char) = c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'
    fun string(): Boolean { // at '"'
        i++
        while (i < n) {
            val c = s[i]
            when {
                c == '"' -> { i++; return true }
                c == '\\' -> {
                    if (i + 1 >= n) return false
                    val e = s[i + 1]
                    if (e == 'u') {
                        if (i + 5 >= n || !(1..4).all { isHex(s[i + 1 + it]) }) return false
                        i += 6
                    } else if (e in "\"\\/bfnrt") i += 2 else return false
                }
                c < ' ' -> return false
                else -> i++
            }
        }
        return false
    }
    fun digits(): Boolean { val from = i; while (i < n && s[i] in '0'..'9') i++; return i > from }
    fun number(): Boolean {
        if (i < n && s[i] == '-') i++
        if (i < n && s[i] == '0') i++ else if (!(i < n && s[i] in '1'..'9' && digits())) return false
        if (i < n && s[i] == '.') { i++; if (!digits()) return false }
        if (i < n && (s[i] == 'e' || s[i] == 'E')) { i++; if (i < n && (s[i] == '+' || s[i] == '-')) i++; if (!digits()) return false }
        return true
    }
    fun literal(w: String): Boolean = s.startsWith(w, i).also { if (it) i += w.length }
    val stack = ArrayDeque<Char>()

    // Reads `"key" :` inside an object; leaves i at the start of the value.
    fun key(): Boolean {
        ws(); if (i >= n || s[i] != '"' || !string()) return false
        ws(); if (i >= n || s[i] != ':') return false
        i++; return true
    }

    ws()
    while (true) {
        // A value is expected at i.
        ws()
        if (i >= n) return false
        var scalarDone = true
        when (s[i]) {
            '{' -> {
                i++; ws()
                if (i < n && s[i] == '}') i++ else { stack.addLast('{'); if (!key()) return false; scalarDone = false }
            }
            '[' -> {
                i++; ws()
                if (i < n && s[i] == ']') i++ else { stack.addLast('['); scalarDone = false }
            }
            '"' -> if (!string()) return false
            't' -> if (!literal("true")) return false
            'f' -> if (!literal("false")) return false
            'n' -> if (!literal("null")) return false
            else -> if (!number()) return false
        }
        if (!scalarDone) continue
        // A value just ended: close containers or move to the next element.
        while (true) {
            ws()
            if (stack.isEmpty()) return i == n
            if (i >= n) return false
            val top = stack.last()
            val c = s[i]
            if (c == ',') {
                i++
                if (top == '{' && !key()) return false
                break
            }
            if ((top == '{' && c == '}') || (top == '[' && c == ']')) { i++; stack.removeLast(); continue }
            return false
        }
    }
}
