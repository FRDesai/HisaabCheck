package com.hisaabcheck.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * On Android, masking can never be turned off in any build: every parseConfig call in the app must pass the literal
 * `true` as its second argument (so a mask_pii of "false" from Remote Config is ignored), and RemoteConfigSource must not
 * depend on the build type. The installed APK is a debug build, so a BuildConfig check would leave masking switchable.
 */
class MaskingAlwaysOnTest {
    private val appSrc = File(repoRoot, "android/app/src")

    private fun kotlinFiles(dir: File): List<File> =
        dir.walkTopDown()
            .onEnter { it.name != "build" && it.name != ".gradle" }
            .filter { it.isFile && it.extension == "kt" }
            .toList()

    /** The top-level arguments of the call whose opening parenthesis is at [open], or null if it never closes. */
    private fun callArguments(text: String, open: Int): List<String>? {
        val args = mutableListOf<String>()
        var depth = 0
        var start = open + 1
        for (i in open until text.length) {
            when (text[i]) {
                '(', '[', '{' -> depth++
                ')', ']', '}' -> {
                    depth--
                    if (depth == 0) {
                        args.add(text.substring(start, i).trim())
                        return args.filter { it.isNotEmpty() }
                    }
                }
                ',' -> if (depth == 1) {
                    args.add(text.substring(start, i).trim())
                    start = i + 1
                }
            }
        }
        return null
    }

    @Test
    fun everyParseConfigCallInTheAppForcesMaskingOn() {
        val call = Regex("""\bparseConfig\s*\(""")
        val files = kotlinFiles(appSrc)
        assertTrue(files.size >= 5, "expected at least 5 Kotlin files under android/app/src, scanned ${files.size}")
        var calls = 0
        val offenders = mutableListOf<String>()
        for (f in files) {
            val text = f.readText()
            for (m in call.findAll(text)) {
                calls++
                val args = callArguments(text, m.range.last)
                val second = args?.getOrNull(1)?.replace(Regex("""\s+"""), " ")
                val ok = args != null && args.size == 2 && (second == "true" || second == "isProd = true")
                if (!ok) offenders.add("${f.relativeTo(repoRoot).invariantSeparatorsPath}: parseConfig(${args?.joinToString(", ")})")
            }
        }
        assertTrue(calls >= 1, "no parseConfig call found under android/app/src; the scan is not looking at the app")
        assertEquals(emptyList<String>(), offenders, "parseConfig must be called with the literal true as its second argument")
    }

    @Test
    fun remoteConfigSourceDoesNotDependOnTheBuildType() {
        val files = kotlinFiles(appSrc).filter { it.name == "RemoteConfigSource.kt" }
        assertEquals(1, files.size, "expected exactly one RemoteConfigSource.kt under android/app/src, found $files")
        assertFalse(files[0].readText().contains("BuildConfig"), "RemoteConfigSource must not mention BuildConfig")
    }

    @Test
    fun theArgumentReaderSplitsOnlyTopLevelCommas() {
        val text = "x = parseConfig(mapOf(\"a\" to \"b\", \"c\" to \"d\"), true)"
        assertEquals(listOf("mapOf(\"a\" to \"b\", \"c\" to \"d\")", "true"), callArguments(text, text.indexOf('(')))
    }
}
