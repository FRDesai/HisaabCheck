package com.hisaabcheck.core.extract

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test

class TmpProbeTest {
    @Test
    fun probe() {
        val body = "{\"a\":" + "[".repeat(5000) + "]".repeat(5000) + "}"
        println("PROBE strict=" + isStrictJson(body))
        try { Json { isLenient = false }.parseToJsonElement(body); println("PROBE kotlinx ok") } catch (t: Throwable) { println("PROBE kotlinx " + t) }
    }
}
