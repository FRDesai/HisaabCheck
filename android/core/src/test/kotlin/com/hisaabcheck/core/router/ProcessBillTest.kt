package com.hisaabcheck.core.router

import com.hisaabcheck.core.Availability
import com.hisaabcheck.core.BillStatus
import com.hisaabcheck.core.Box
import com.hisaabcheck.core.CloudModel
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.ConsentResult
import com.hisaabcheck.core.DeviceModel
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.Ocr
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.Painter
import com.hisaabcheck.core.PathTaken
import com.hisaabcheck.core.PiiType
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.RedactionPlan
import com.hisaabcheck.core.RoutingMode
import com.hisaabcheck.core.Step
import com.hisaabcheck.core.config.parseConfig
import com.hisaabcheck.core.wordsFromLines
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/** Port of web/tests/core/processBill.test.ts, plus Kotlin-only cancellation and OCR-lifecycle pins. */
@OptIn(ExperimentalCoroutinesApi::class)
class ProcessBillTest {
    private val RAW = "raw".toByteArray()
    private val REDACTED = "redacted".toByteArray()
    private val CONSENTED = "consented".toByteArray()
    private val IMG = ImageInput(RAW, 1000, 1000)
    private val GOOD = "{\"supplierName\":\"Ravi Traders\",\"supplierGstin\":\"29AAGCB7383J1Z4\",\"invoiceNo\":\"4521\"," +
        "\"invoiceDate\":\"2026-11-02\",\"placeOfSupply\":\"29-Karnataka\",\"taxableValue\":1500,\"cgst\":135,\"sgst\":135," +
        "\"igst\":0,\"total\":1770,\"confidence\":0.9}"
    private val BAD_TOTAL = GOOD.replace("\"total\":1770", "\"total\":1870")
    // Benign words on other lines so the default OCR read is "adequate" (>= MIN_OCR_WORDS, confident) and finds no PII.
    private val PADDING = listOf("Ravi Traders Kirana Store", "Thank you for shopping with us", "Rice Sugar Tea Dal Oil Soap",
        "Goods once sold will not be taken back")
    private fun padded(vararg lines: String) = wordsFromLines(lines.toList() + PADDING)

    private data class Opts(
        val avail: Availability? = null, val deviceOut: String? = null, val deviceThrows: Boolean = false, val deviceDelayMs: Long = 0,
        val cloudOut: String? = null, val cloudThrows: Boolean = false, val ocrWords: List<OcrWord>? = null, val ocrThrows: Boolean = false,
        val config: (Config) -> Config = { it }, val availThrows: Boolean = false, val paintThrows: Boolean = false,
        val paintReturnsInput: Boolean = false,
        // Kotlin-only: suspension points for the cancellation pins. Each runs at the start of its adapter call.
        val availGate: suspend () -> Unit = {}, val deviceGate: suspend () -> Unit = {}, val ocrGate: suspend () -> Unit = {},
        val paintGate: suspend () -> Unit = {}, val cloudGate: suspend () -> Unit = {},
        val deviceTimeoutMs: Long = 50,
    )

    private class Calls {
        var device = 0
        val cloud = mutableListOf<ByteArray>()
        var paint = 0
        var ocr = 0
    }

    private inner class FakeHooks : RouterHooks {
        val steps = mutableListOf<Step>()
        val consentCalls = mutableListOf<Pair<ByteArray, RedactionPlan>>()
        /** Like vitest's mockImplementationOnce: each queued answer is used once, then the default applies. */
        val once = ArrayDeque<suspend (ByteArray, RedactionPlan) -> ConsentResult>()
        override fun onStep(step: Step) { steps += step }
        override suspend fun askConsent(redacted: ByteArray, plan: RedactionPlan): ConsentResult {
            consentCalls += redacted to plan
            val f = once.removeFirstOrNull() ?: return ConsentResult.Send(CONSENTED)
            return f(redacted, plan)
        }
    }

    private inner class Fixture(val deps: RouterDeps, val hooks: FakeHooks, val calls: Calls)

    private fun setup(o: Opts = Opts()): Fixture {
        val calls = Calls()
        val deps = RouterDeps(
            device = object : DeviceModel {
                override suspend fun availability(): Availability {
                    o.availGate()
                    if (o.availThrows) throw IllegalStateException("avail")
                    return o.avail ?: Availability.AVAILABLE
                }
                override suspend fun download(onProgress: (Double) -> Unit) {}
                override suspend fun extract(image: ImageInput, prompt: String): String {
                    calls.device++
                    o.deviceGate()
                    if (o.deviceDelayMs > 0) delay(o.deviceDelayMs)
                    if (o.deviceThrows) throw IllegalStateException("boom")
                    return o.deviceOut ?: GOOD
                }
            },
            cloud = object : CloudModel {
                override suspend fun extract(redacted: ImageInput, prompt: String, model: String): String {
                    calls.cloud += redacted.bytes
                    o.cloudGate()
                    if (o.cloudThrows) throw IllegalStateException("net")
                    return o.cloudOut ?: GOOD
                }
            },
            ocr = object : Ocr {
                override suspend fun recognize(image: ImageInput): List<OcrWord> {
                    calls.ocr++
                    o.ocrGate()
                    if (o.ocrThrows) throw IllegalStateException("ocr")
                    return o.ocrWords ?: padded("PAN: AAPFU0939F")
                }
            },
            painter = object : Painter {
                override suspend fun paint(image: ImageInput, boxes: List<Box>): ByteArray {
                    calls.paint++
                    o.paintGate()
                    if (o.paintThrows) throw IllegalStateException("paint")
                    return if (o.paintReturnsInput) image.bytes else REDACTED
                }
            },
            config = o.config(parseConfig(emptyMap(), false)),
            clock = { Instant.parse("2026-11-20T04:30:00Z") }, // 2026-11-20T10:00:00+05:30
            deviceTimeoutMs = o.deviceTimeoutMs,
        )
        return Fixture(deps, FakeHooks(), calls)
    }

    private fun neverRaw(calls: Calls) = assertTrue(calls.cloud.none { it === RAW }, "the cloud received the original image")
    private fun assertCloud(calls: Calls, vararg expected: ByteArray) {
        assertEquals(expected.size, calls.cloud.size)
        expected.forEachIndexed { i, b -> assertSame(b, calls.cloud[i]) }
        neverRaw(calls)
    }

    // ---- Ported one for one from processBill.test.ts ----

    @Test
    fun `saves a passing device read without touching the cloud`() = runTest {
        val f = setup()
        val calls = f.calls
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.PASSED, r.route.reason)
        assertEquals(BillStatus.DRAFT, r.status)
        assertEquals(0, calls.cloud.size)
        assertEquals(0.0, r.estCostUsd)
    }

    @Test
    fun `escalates a total mismatch with the redacted image`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(PathTaken.CLOUD, r.route.path)
        assertEquals(Reason.TOTAL_MISMATCH, r.route.reason)
        assertCloud(f.calls, REDACTED)
        assertEquals(listOf(PiiType.PAN), r.piiTypes)
        assertEquals(1, r.piiMasked)
        assertSame(REDACTED, r.redactedImage)
        assertTrue(r.estCostUsd > 0)
    }

    @ParameterizedTest(name = "goes to cloud when device is {0}")
    @ValueSource(strings = ["unavailable", "downloadable", "downloading"])
    fun `goes to cloud when device is`(avail: String) = runTest {
        val f = setup(Opts(avail = Availability.valueOf(avail.uppercase())))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.NO_DEVICE_MODEL, r.route.reason)
        assertEquals(0, f.calls.device)
        neverRaw(f.calls)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `cloud_only mode skips the device`() = runTest {
        val f = setup(Opts(config = { it.copy(routingMode = RoutingMode.CLOUD_ONLY) }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.CLOUD_ONLY_MODE, r.route.reason)
        assertEquals(0, f.calls.device)
        neverRaw(f.calls)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `device_only mode saves failures as manual entry and never calls cloud`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, config = { it.copy(routingMode = RoutingMode.DEVICE_ONLY) }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.TOTAL_MISMATCH, r.route.reason)
        assertEquals(1870.0, r.extraction?.total)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `device_only with no model is manual entry`() = runTest {
        val f = setup(Opts(avail = Availability.UNAVAILABLE, config = { it.copy(routingMode = RoutingMode.DEVICE_ONLY) }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertNull(r.extraction)
        assertEquals(Reason.NO_DEVICE_MODEL, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `times out the device read`() = runTest {
        val f = setup(Opts(deviceDelayMs = 200))
        assertEquals(Reason.DEVICE_TIMEOUT, processBill(IMG, f.deps, f.hooks).route.reason)
        neverRaw(f.calls)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `handles a device error`() = runTest {
        val f = setup(Opts(deviceThrows = true))
        assertEquals(Reason.DEVICE_ERROR, processBill(IMG, f.deps, f.hooks).route.reason)
        neverRaw(f.calls)
    }

    @Test
    fun `handles invalid device JSON`() = runTest {
        val f = setup(Opts(deviceOut = "no idea"))
        assertEquals(Reason.INVALID_JSON, processBill(IMG, f.deps, f.hooks).route.reason)
        neverRaw(f.calls)
    }

    @Test
    fun `asks consent when OCR is unsure and sends the consented image`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = padded("PAN No: ____")))
        val r = processBill(IMG, f.deps, f.hooks)
        assertTrue(f.hooks.consentCalls.any { it.first === REDACTED })
        assertCloud(f.calls, CONSENTED)
        assertSame(CONSENTED, r.redactedImage)
        assertTrue(Step.AWAITING_CONSENT in f.hooks.steps)
    }

    @Test
    fun `keeps the bill local when the user declines`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = padded("PAN No: ____")))
        f.hooks.once += { _, _ -> ConsentResult.Keep }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.USER_KEPT_LOCAL, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `saves manual entry on cloud error, keeping device fields`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, cloudThrows = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(Reason.CLOUD_ERROR, r.route.reason)
        assertEquals(1870.0, r.extraction?.total)
        neverRaw(f.calls)
    }

    @Test
    fun `treats an unparsable cloud answer as a cloud error, keeping device fields`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, cloudOut = "not json"))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.CLOUD_ERROR, r.route.reason)
        assertEquals(1870.0, r.extraction?.total)
        assertTrue(r.estCostUsd > 0)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `blocks the cloud when OCR fails`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrThrows = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.OCR_ERROR, r.route.reason)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `keeps a failing cloud read as a draft with red checks`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, cloudOut = BAD_TOTAL))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.DRAFT, r.status)
        assertEquals(false, r.checks?.total)
        neverRaw(f.calls)
    }

    @Test
    fun `treats a throwing availability check as no device model`() = runTest {
        val f = setup(Opts(availThrows = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.NO_DEVICE_MODEL, r.route.reason)
        assertEquals(0, f.calls.device)
        assertCloud(f.calls, REDACTED)
        neverRaw(f.calls)
    }

    @Test
    fun `throwing availability in device_only mode is manual entry`() = runTest {
        val f = setup(Opts(availThrows = true, config = { it.copy(routingMode = RoutingMode.DEVICE_ONLY) }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertNull(r.extraction)
        assertEquals(Reason.NO_DEVICE_MODEL, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `returns manual entry when the painter rejects`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, paintThrows = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.REDACT_ERROR, r.route.reason)
        assertEquals(1870.0, r.extraction?.total)
        assertEquals(0, f.calls.cloud.size)
        assertEquals(Step.DONE, f.hooks.steps.last())
    }

    @Test
    fun `returns manual entry when askConsent rejects`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = padded("PAN No: ____")))
        f.hooks.once += { _, _ -> throw IllegalStateException("ui") }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.REDACT_ERROR, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
        assertEquals(Step.DONE, f.hooks.steps.last())
    }

    @Test
    fun `fails closed when the painter returns the original image`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, paintReturnsInput = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.REDACT_ERROR, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
        assertNull(r.redactedImage)
    }

    @Test
    fun `fails closed when consent hands back the original image`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = padded("PAN No: ____")))
        f.hooks.once += { _, _ -> ConsentResult.Send(RAW) }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.REDACT_ERROR, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `reports steps in order for an escalated bill`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL))
        processBill(IMG, f.deps, f.hooks)
        assertEquals(
            listOf(Step.AVAILABILITY, Step.DEVICE_READ, Step.CHECKING, Step.REDACTING, Step.CLOUD_READ, Step.CHECKING, Step.DONE),
            f.hooks.steps,
        )
    }

    @Test
    fun `shows the preview before any cloud call when OCR read nothing`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = emptyList()))
        var cloudCallsAtConsent = -1
        f.hooks.once += { _, _ -> cloudCallsAtConsent = f.calls.cloud.size; ConsentResult.Send(CONSENTED) }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(1, f.hooks.consentCalls.size)
        assertTrue(Step.AWAITING_CONSENT in f.hooks.steps)
        assertEquals(0, cloudCallsAtConsent)
        assertCloud(f.calls, CONSENTED)
        assertSame(CONSENTED, r.redactedImage)
        neverRaw(f.calls)
    }

    @Test
    fun `shows the preview when OCR read only a few confident non-PII words`() = runTest {
        val f = setup(Opts(avail = Availability.UNAVAILABLE, ocrWords = wordsFromLines(listOf("Ravi Traders", "Thank you"))))
        var cloudCallsAtConsent = -1
        f.hooks.once += { _, _ -> cloudCallsAtConsent = f.calls.cloud.size; ConsentResult.Send(CONSENTED) }
        processBill(IMG, f.deps, f.hooks)
        assertTrue(f.hooks.consentCalls.any { it.first === REDACTED })
        assertEquals(0, cloudCallsAtConsent)
        assertCloud(f.calls, CONSENTED)
    }

    @Test
    fun `shows the preview when OCR confidence is low across the bill`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = wordsFromLines(PADDING, 30.0)))
        f.hooks.once += { _, _ -> ConsentResult.Keep }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(1, f.hooks.consentCalls.size)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.USER_KEPT_LOCAL, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `keeps a bill with too little OCR text local when the user declines`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = emptyList()))
        f.hooks.once += { _, _ -> ConsentResult.Keep }
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertEquals(PathTaken.DEVICE, r.route.path)
        assertEquals(Reason.USER_KEPT_LOCAL, r.route.reason)
        assertEquals(1870.0, r.extraction?.total)
        assertEquals(0, f.calls.cloud.size)
        assertNull(r.redactedImage)
    }

    @Test
    fun `does not ask for consent when OCR is adequate and the shield is sure`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL))
        processBill(IMG, f.deps, f.hooks)
        assertEquals(0, f.hooks.consentCalls.size)
        neverRaw(f.calls)
    }

    @Test
    fun `with masking off (dev only) calls the cloud but never labels the original as redacted`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, config = { it.copy(maskPii = false) }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(1, f.calls.cloud.size)
        assertSame(RAW, f.calls.cloud[0])
        assertEquals(0, f.calls.paint)
        assertEquals(PathTaken.CLOUD, r.route.path)
        assertEquals(Reason.TOTAL_MISMATCH, r.route.reason)
        assertNull(r.redactedImage)
        assertEquals(0, f.hooks.consentCalls.size)
    }

    // ---- Kotlin-only pins: cancellation, timeout, OCR lifecycle, model name ----

    private class Outcome {
        var result: ProcessedBill? = null
        var cancellation: CancellationException? = null
        var otherError: Throwable? = null
    }

    /** Starts processBill, runs until it reaches [reached], cancels the caller, and returns what came back. */
    private fun TestScope.cancelWhen(f: Fixture, reached: () -> Boolean): Outcome {
        val out = Outcome()
        val job = launch {
            try {
                out.result = processBill(IMG, f.deps, f.hooks)
            } catch (e: CancellationException) {
                out.cancellation = e
                throw e
            } catch (e: Throwable) {
                out.otherError = e
            }
        }
        runCurrent()
        assertTrue(reached(), "processBill did not reach the suspension point")
        val stepsAtCancel = f.hooks.steps.toList()
        job.cancel()
        advanceUntilIdle()
        assertTrue(job.isCompleted)
        assertNull(out.result, "a ProcessedBill was returned after cancellation")
        assertNull(out.otherError)
        assertNotNull(out.cancellation, "cancellation did not propagate")
        assertEquals(stepsAtCancel, f.hooks.steps, "onStep was called after cancellation")
        assertFalse(Step.DONE in f.hooks.steps)
        neverRaw(f.calls)
        return out
    }

    @Test
    fun `cancelling during the availability check propagates`() = runTest {
        val f = setup(Opts(availGate = { awaitCancellation() }))
        cancelWhen(f) { f.hooks.steps == listOf(Step.AVAILABILITY) }
        assertEquals(0, f.calls.device)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `cancelling during the device read propagates and is not a device timeout`() = runTest {
        var deviceCancelled = false
        var ocrCancelled = false
        val f = setup(Opts(
            deviceGate = { try { awaitCancellation() } finally { deviceCancelled = true } },
            ocrGate = { try { awaitCancellation() } finally { ocrCancelled = true } },
        ))
        cancelWhen(f) { f.calls.device == 1 }
        assertEquals(0L, currentTime)
        assertTrue(deviceCancelled)
        assertTrue(ocrCancelled)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `cancelling during the device read after some time propagates`() = runTest {
        val f = setup(Opts(deviceGate = { awaitCancellation() }, deviceTimeoutMs = 8000))
        val out = Outcome()
        val job = launch {
            try { out.result = processBill(IMG, f.deps, f.hooks) } catch (e: CancellationException) { out.cancellation = e; throw e }
        }
        testScheduler.advanceTimeBy(7999)
        runCurrent()
        job.cancel()
        advanceUntilIdle()
        assertNull(out.result)
        assertNotNull(out.cancellation)
        assertEquals(0, f.calls.cloud.size)
        assertFalse(Step.DONE in f.hooks.steps)
    }

    @Test
    fun `cancelling during OCR propagates`() = runTest {
        var ocrCancelled = false
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrGate = { try { awaitCancellation() } finally { ocrCancelled = true } }))
        cancelWhen(f) { f.hooks.steps.lastOrNull() == Step.REDACTING }
        assertTrue(ocrCancelled)
        assertEquals(0, f.calls.paint)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `cancelling during painting propagates`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, paintGate = { awaitCancellation() }))
        cancelWhen(f) { f.calls.paint == 1 }
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `cancelling during askConsent propagates`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrWords = padded("PAN No: ____")))
        f.hooks.once += { _, _ -> awaitCancellation() }
        cancelWhen(f) { f.hooks.consentCalls.size == 1 }
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `cancelling during the cloud read propagates`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, cloudGate = { awaitCancellation() }))
        cancelWhen(f) { f.calls.cloud.size == 1 }
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `the device timeout runs on virtual time and does not wait for the slow read`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, deviceDelayMs = 60_000, deviceTimeoutMs = 8000))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.DEVICE_TIMEOUT, r.route.reason)
        assertEquals(8000L, currentTime)
        // The timed-out read left no device fields; the extraction is the cloud's.
        assertEquals(1770.0, r.extraction?.total)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `a read that finishes just inside the timeout is not a timeout`() = runTest {
        val f = setup(Opts(deviceDelayMs = 49))
        assertEquals(Reason.PASSED, processBill(IMG, f.deps, f.hooks).route.reason)
    }

    @Test
    fun `a timeout inside the device adapter is a device error, not the cascade's own timeout`() = runTest {
        val f = setup(Opts(deviceGate = { withTimeout(10) { awaitCancellation() } }))
        assertEquals(Reason.DEVICE_ERROR, processBill(IMG, f.deps, f.hooks).route.reason)
    }

    @Test
    fun `a CancellationException thrown by the device adapter while the caller is active is a device error`() = runTest {
        val f = setup(Opts(deviceGate = { throw CancellationException("adapter gave up") }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.DEVICE_ERROR, r.route.reason)
        assertCloud(f.calls, REDACTED)
    }

    @Test
    fun `a CancellationException thrown by the OCR adapter while the caller is active is an OCR error`() = runTest {
        val f = setup(Opts(deviceOut = BAD_TOTAL, ocrGate = { throw CancellationException("ocr gave up") }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.OCR_ERROR, r.route.reason)
        assertEquals(0, f.calls.cloud.size)
    }

    @Test
    fun `OCR starts at once, before the availability check`() = runTest {
        var ocrAtAvailability = -1
        lateinit var f: Fixture
        f = setup(Opts(availGate = { ocrAtAvailability = f.calls.ocr }))
        processBill(IMG, f.deps, f.hooks)
        assertEquals(1, ocrAtAvailability)
    }

    @Test
    fun `a failing OCR does not cancel the device read`() = runTest {
        val f = setup(Opts(deviceDelayMs = 30, ocrThrows = true))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.PASSED, r.route.reason)
        assertEquals(BillStatus.DRAFT, r.status)
    }

    @Test
    fun `a device pass cancels a still-running OCR instead of waiting for it`() = runTest {
        var ocrCancelled = false
        val f = setup(Opts(ocrGate = { try { awaitCancellation() } finally { ocrCancelled = true } }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(Reason.PASSED, r.route.reason)
        assertTrue(ocrCancelled)
        assertEquals(Step.DONE, f.hooks.steps.last())
        assertEquals(1, f.hooks.steps.count { it == Step.DONE })
    }

    @Test
    fun `device_only mode cancels a still-running OCR`() = runTest {
        var ocrCancelled = false
        val f = setup(Opts(deviceOut = BAD_TOTAL, config = { it.copy(routingMode = RoutingMode.DEVICE_ONLY) },
            ocrGate = { try { awaitCancellation() } finally { ocrCancelled = true } }))
        val r = processBill(IMG, f.deps, f.hooks)
        assertEquals(BillStatus.MANUAL_ENTRY, r.status)
        assertTrue(ocrCancelled)
    }

    @Test
    fun `model name is the cloud model on the cloud path and gemini-nano otherwise`() = runTest {
        val cloud = setup(Opts(deviceOut = BAD_TOTAL))
        assertEquals("gemini-3.5-flash-lite", processBill(IMG, cloud.deps, cloud.hooks).route.modelName)
        val device = setup()
        val r = processBill(IMG, device.deps, device.hooks)
        assertEquals("gemini-nano", r.route.modelName)
        assertEquals("v1", r.route.promptVersion)
        val none = setup(Opts(avail = Availability.UNAVAILABLE, config = { it.copy(routingMode = RoutingMode.DEVICE_ONLY) }))
        assertEquals(0.0, processBill(IMG, none.deps, none.hooks).route.confidence)
        val err = setup(Opts(deviceOut = BAD_TOTAL, cloudThrows = true))
        assertEquals("gemini-nano", processBill(IMG, err.deps, err.hooks).route.modelName)
    }

    @Test
    fun `latency is measured with the injected clock`() = runTest {
        var t = 1_000L
        val f = setup(Opts(deviceOut = BAD_TOTAL))
        val deps = RouterDeps(f.deps.device, f.deps.cloud, f.deps.ocr, f.deps.painter, f.deps.config,
            { Instant.ofEpochMilli(t).also { t += 250 } }, f.deps.deviceTimeoutMs)
        val r = processBill(IMG, deps, f.hooks)
        // Clock reads: start, device checks, cloud checks, finish.
        assertEquals(750L, r.latencyMs)
    }
}
