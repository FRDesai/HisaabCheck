package com.hisaabcheck.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.File

val repoRoot: File = File(requireNotNull(System.getProperty("repoRoot")) { "repoRoot system property is not set" })

private val strictJson = Json { isLenient = false }

fun readRepoJson(relative: String): JsonElement = strictJson.parseToJsonElement(File(repoRoot, relative).readText())

fun readTestResourceJson(name: String): JsonElement {
    val stream = requireNotNull(Thread.currentThread().contextClassLoader.getResourceAsStream(name)) { "missing test resource $name" }
    return strictJson.parseToJsonElement(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
}

/** Port of web/tests/helpers.ts wordsFromLines: splits each line on spaces; each word gets a 10px-per-char box on its own row. */
fun wordsFromLines(lines: List<String>, confidence: Double = 95.0): List<OcrWord> {
    val out = mutableListOf<OcrWord>()
    lines.forEachIndexed { li, line ->
        var x = 0.0
        for (text in line.split(' ').filter { it.isNotEmpty() }) {
            out.add(OcrWord(text, Box(x, li * 20.0, x + text.length * 10.0, li * 20.0 + 16), confidence, li))
            x += text.length * 10.0 + 10
        }
    }
    return out
}
