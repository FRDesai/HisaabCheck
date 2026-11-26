package com.hisaabcheck.core

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class NoPreferModesTest {
    private val repoRoot = File(requireNotNull(System.getProperty("repoRoot")) { "repoRoot system property is not set" })

    private fun kotlinFiles(dir: File): List<File> =
        dir.walkTopDown()
            .onEnter { it.name != "build" && it.name != ".gradle" }
            .filter { it.isFile && it.extension == "kt" }
            .toList()

    @Test
    fun noKotlinSourceUnderAndroidNamesTheBannedInferenceModes() {
        val needle = "PREFER" + "_"
        val files = kotlinFiles(File(repoRoot, "android"))
        assertTrue(files.size >= 5, "expected at least 5 Kotlin files under android/, scanned ${files.size}")
        val offenders = files.filter { it.readText().contains(needle) }.map { it.relativeTo(repoRoot).path }
        assertTrue(offenders.isEmpty(), "banned text found in: $offenders")
    }

    @Test
    fun coreMainImportsNoAndroidOrGoogleCode() {
        val banned = listOf("import android", "import androidx", "import com.google")
        val files = kotlinFiles(File(repoRoot, "android/core/src/main"))
        assertTrue(files.isNotEmpty(), "no Kotlin files found under android/core/src/main")
        val offenders = files.filter { f -> val text = f.readText(); banned.any { text.contains(it) } }
            .map { it.relativeTo(repoRoot).path }
        assertTrue(offenders.isEmpty(), "platform imports found in: $offenders")
    }
}
