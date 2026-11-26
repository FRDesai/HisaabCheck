package com.hisaabcheck.core.shield

import com.hisaabcheck.core.readRepoJson
import com.hisaabcheck.core.wordsFromLines
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

/** Runs shared/test-vectors/pii.json exactly as web/tests/core/shield.test.ts does. */
class ShieldVectorsTest {
    private val vectors: List<JsonObject> = readRepoJson("shared/test-vectors/pii.json").jsonArray.map { it.jsonObject }

    @Test
    fun fileHoldsAtLeast55Cases() {
        assertTrue(vectors.size >= 55, "pii.json holds ${vectors.size} cases")
    }

    @TestFactory
    fun vectors(): List<DynamicTest> = vectors.map { v ->
        val name = v.getValue("name").jsonPrimitive.content
        DynamicTest.dynamicTest(name) {
            val lines = v.getValue("lines").jsonArray.map { it.jsonPrimitive.content }
            val confidence = v["confidence"]?.jsonPrimitive?.double ?: 95.0
            val r = runShield(wordsFromLines(lines, confidence), 0.6)
            val expectedTypes = v.getValue("types").jsonArray.map { it.jsonPrimitive.content }.sorted()
            assertEquals(expectedTypes, r.matches.map { it.type.name }.sorted(), "types")
            assertEquals(v.getValue("gstinWords").jsonPrimitive.int, r.gstinWordIndexes.size, "gstinWords")
            assertEquals(v.getValue("uncertain").jsonPrimitive.boolean, r.uncertain, "uncertain ${r.uncertainReasons}")
        }
    }
}
