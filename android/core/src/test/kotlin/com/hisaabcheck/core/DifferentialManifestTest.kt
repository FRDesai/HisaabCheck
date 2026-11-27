package com.hisaabcheck.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

/**
 * Staleness guard for the differential corpora: src/test/resources/differential/manifest.json holds the SHA-256 of the
 * raw bytes of every TypeScript source the corpora were generated from, and of the generator. If any of them changes,
 * DifferentialTest would still pass against old output, so this test fails until the corpora are regenerated.
 */
class DifferentialManifestTest {
    private val manifest: JsonObject = readTestResourceJson("differential/manifest.json").jsonObject
    private val entries: List<Pair<String, String>> = manifest.getValue("files").jsonArray.map {
        it.jsonObject.getValue("path").jsonPrimitive.content to it.jsonObject.getValue("sha256").jsonPrimitive.content
    }

    companion object {
        const val REGENERATE = "cd web && npx vite-node ../android/core/src/test/differential/generate.ts"

        private fun sha256(f: File): String = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }

        /** One message per manifest file under [root] whose raw bytes no longer hash to the recorded value. */
        fun staleFiles(root: File, entries: List<Pair<String, String>>): List<String> = entries.mapNotNull { (path, expected) ->
            val f = File(root, path)
            when {
                !f.isFile -> "$path is missing"
                sha256(f) != expected -> "$path changed (manifest sha256 $expected, now ${sha256(f)})"
                else -> null
            }
        }

        fun failureMessage(stale: List<String>): String =
            "The differential corpora are stale; they were generated from different TypeScript sources:\n  " +
                stale.joinToString("\n  ") + "\nRegenerate them from the repository root with:\n  $REGENERATE\n" +
                "then run ./gw :core:test and commit android/core/src/test/resources/differential/."
    }

    @Test
    fun corporaWereGeneratedFromTheCurrentSources() {
        val stale = staleFiles(repoRoot, entries)
        assertTrue(stale.isEmpty()) { failureMessage(stale) }
    }

    @Test
    fun manifestRecordsTheRegenerateCommand() {
        assertEquals(REGENERATE, manifest.getValue("regenerate").jsonPrimitive.content)
        assertEquals(entries.map { it.first }.sorted(), entries.map { it.first }, "manifest paths are sorted")
    }

    @Test
    fun manifestCoversTheGeneratorAndEverySourceItReaches() {
        val paths = entries.map { it.first }.toSet()
        val generator = "android/core/src/test/differential/generate.ts"
        assertTrue(generator in paths, "the generator itself must be hashed")
        // Follow relative imports from the generator through the web sources; every file reached must be in the manifest.
        val importRe = Regex("""from '(\.{1,2}/[^']+)'""")
        val seen = mutableSetOf<String>()
        val todo = ArrayDeque(listOf(generator))
        while (todo.isNotEmpty()) {
            val path = todo.removeFirst()
            if (!seen.add(path)) continue
            val file = File(repoRoot, path)
            for (m in importRe.findAll(file.readText())) {
                val target = File(file.parentFile, m.groupValues[1] + ".ts").canonicalFile.relativeTo(repoRoot.canonicalFile).invariantSeparatorsPath
                if (target.startsWith("web/src/core/")) todo.add(target)
            }
        }
        // Shared data files the generator reads (the real-OCR bills) are inputs too.
        for (m in Regex("shared/test-vectors/[A-Za-z0-9-]+[.]json").findAll(File(repoRoot, generator).readText())) seen.add(m.value)
        assertEquals(seen.sorted(), paths.sorted(), "manifest files versus the files the generator reaches")
    }

    @Test
    fun guardReportsAChangedByteAndHowToRegenerate() {
        // Copy every hashed file into a scratch tree, change one byte of one source, and run the guard on the copy.
        val tmp = Files.createTempDirectory("manifest-guard").toFile()
        try {
            for ((path, _) in entries) File(repoRoot, path).copyTo(File(tmp, path))
            assertTrue(staleFiles(tmp, entries).isEmpty(), "an exact copy is not stale")
            val victim = File(tmp, "web/src/core/shield/shield.ts")
            val bytes = victim.readBytes()
            bytes[bytes.size / 2] = (bytes[bytes.size / 2] + 1).toByte()
            victim.writeBytes(bytes)
            val stale = staleFiles(tmp, entries)
            assertEquals(1, stale.size, stale.toString())
            assertTrue(stale[0].startsWith("web/src/core/shield/shield.ts changed"), stale[0])
            val message = failureMessage(stale)
            assertTrue(message.contains(REGENERATE), message)
            println(message)
            // A line-ending change is a change too: raw bytes are hashed.
            File(tmp, "web/src/core/types.ts").let { it.writeBytes(String(it.readBytes()).replace("\n", "\r\n").toByteArray()) }
            assertEquals(2, staleFiles(tmp, entries).size)
            File(tmp, "web/src/core/config/defaults.ts").delete()
            assertTrue(staleFiles(tmp, entries).any { it == "web/src/core/config/defaults.ts is missing" })
        } finally {
            tmp.deleteRecursively()
        }
    }
}
