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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of web/src/core/extract/parse.ts. Number(), String(number), trim() and \s are JavaScript's (see JsSemantics.kt).

/** A JSON number. parseJson stores numbers as JsonPrimitive(Double), whose content Double.toString round-trips. */
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
    // JSON.parse, not kotlinx: kotlinx reads unquoted literals leniently even in strict mode (01, +1, abc) and refuses
    // nesting deeper than its limit, while JSON.parse accepts exactly the JSON grammar at any depth.
    val o = parseJson(body) as? JsonObject ?: return null
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

/**
 * JSON.parse: the JSON text [s] as a JsonElement, or null where JSON.parse throws (ECMA-404 grammar exactly; whitespace
 * is only space, tab, LF and CR). Iterative, so any nesting depth is fine. A duplicate key keeps the last value.
 */
internal fun parseJson(s: String): JsonElement? {
    var i = 0
    val n = s.length
    fun ws() { while (i < n && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++ }
    fun hex(c: Char): Int = when (c) { in '0'..'9' -> c - '0'; in 'a'..'f' -> c - 'a' + 10; in 'A'..'F' -> c - 'A' + 10; else -> -1 }
    fun string(): String? { // at '"'
        i++
        val out = StringBuilder()
        while (i < n) {
            val c = s[i]
            when {
                c == '"' -> { i++; return out.toString() }
                c == '\\' -> {
                    if (i + 1 >= n) return null
                    when (val e = s[i + 1]) {
                        '"', '\\', '/' -> { out.append(e); i += 2 }
                        'b' -> { out.append('\b'); i += 2 }
                        'f' -> { out.append('\u000C'); i += 2 }
                        'n' -> { out.append('\n'); i += 2 }
                        'r' -> { out.append('\r'); i += 2 }
                        't' -> { out.append('\t'); i += 2 }
                        'u' -> {
                            if (i + 5 >= n) return null
                            var code = 0
                            for (k in 2..5) { val h = hex(s[i + k]); if (h < 0) return null; code = code * 16 + h }
                            out.append(code.toChar()) // lone surrogates are kept, as in JavaScript
                            i += 6
                        }
                        else -> return null
                    }
                }
                c < ' ' -> return null
                else -> { out.append(c); i++ }
            }
        }
        return null
    }
    fun digits(): Boolean { val from = i; while (i < n && s[i] in '0'..'9') i++; return i > from }
    fun number(): Double? {
        val from = i
        if (i < n && s[i] == '-') i++
        if (i < n && s[i] == '0') i++ else if (!(i < n && s[i] in '1'..'9' && digits())) return null
        if (i < n && s[i] == '.') { i++; if (!digits()) return null }
        if (i < n && (s[i] == 'e' || s[i] == 'E')) { i++; if (i < n && (s[i] == '+' || s[i] == '-')) i++; if (!digits()) return null }
        return s.substring(from, i).toDouble() // a JSON number literal parses the same in Java and JavaScript (correctly rounded)
    }
    fun literal(w: String): Boolean = s.startsWith(w, i).also { if (it) i += w.length }

    class Container(val obj: LinkedHashMap<String, JsonElement>?, val arr: MutableList<JsonElement>?) { var key = "" }
    val stack = ArrayDeque<Container>()

    // Reads `"key" :` inside an object; leaves i at the start of the value.
    fun key(c: Container): Boolean {
        ws(); if (i >= n || s[i] != '"') return false
        c.key = string() ?: return false
        ws(); if (i >= n || s[i] != ':') return false
        i++; return true
    }

    while (true) {
        // A value is expected at i.
        ws()
        if (i >= n) return null
        var value: JsonElement? = null
        when (s[i]) {
            '{' -> {
                i++; ws()
                if (i < n && s[i] == '}') { i++; value = JsonObject(emptyMap()) } else {
                    val c = Container(LinkedHashMap(), null); stack.addLast(c); if (!key(c)) return null
                }
            }
            '[' -> {
                i++; ws()
                if (i < n && s[i] == ']') { i++; value = JsonArray(emptyList()) } else stack.addLast(Container(null, mutableListOf()))
            }
            '"' -> value = JsonPrimitive(string() ?: return null)
            't' -> { if (!literal("true")) return null; value = JsonPrimitive(true) }
            'f' -> { if (!literal("false")) return null; value = JsonPrimitive(false) }
            'n' -> { if (!literal("null")) return null; value = JsonNull }
            else -> value = JsonPrimitive(number() ?: return null)
        }
        if (value == null) continue // a container was opened
        // A value just ended: store it, then close containers or move to the next element.
        var v: JsonElement = value
        while (true) {
            val top = stack.lastOrNull()
            if (top == null) { ws(); return if (i == n) v else null }
            if (top.obj != null) top.obj[top.key] = v else top.arr!!.add(v)
            ws()
            if (i >= n) return null
            val c = s[i]
            if (c == ',') {
                i++
                if (top.obj != null && !key(top)) return null
                break
            }
            if (top.obj != null && c == '}') { i++; stack.removeLast(); v = JsonObject(top.obj); continue }
            if (top.arr != null && c == ']') { i++; stack.removeLast(); v = JsonArray(top.arr); continue }
            return null
        }
    }
}
