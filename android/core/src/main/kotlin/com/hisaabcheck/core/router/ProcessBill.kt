package com.hisaabcheck.core.router

import com.hisaabcheck.core.Availability
import com.hisaabcheck.core.BillStatus
import com.hisaabcheck.core.CheckResult
import com.hisaabcheck.core.Clock
import com.hisaabcheck.core.CloudModel
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.ConsentResult
import com.hisaabcheck.core.DeviceModel
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.Ocr
import com.hisaabcheck.core.OcrWord
import com.hisaabcheck.core.Painter
import com.hisaabcheck.core.PathTaken
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.RedactionPlan
import com.hisaabcheck.core.RouteInfo
import com.hisaabcheck.core.RoutingMode
import com.hisaabcheck.core.Step
import com.hisaabcheck.core.checks.runChecks
import com.hisaabcheck.core.config.CLOUD_COST_PER_CALL_USD
import com.hisaabcheck.core.config.DEVICE_TIMEOUT_MS
import com.hisaabcheck.core.extract.cloudPrompt
import com.hisaabcheck.core.extract.devicePrompt
import com.hisaabcheck.core.extract.parseExtraction
import com.hisaabcheck.core.redact.planRedaction
import com.hisaabcheck.core.shield.ocrAdequate
import com.hisaabcheck.core.shield.runShield
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive

class RouterDeps(
    val device: DeviceModel, val cloud: CloudModel, val ocr: Ocr, val painter: Painter,
    val config: Config, val clock: Clock, val deviceTimeoutMs: Long = DEVICE_TIMEOUT_MS,
)

interface RouterHooks {
    fun onStep(step: Step)
    suspend fun askConsent(redacted: ByteArray, plan: RedactionPlan): ConsentResult
}

private sealed interface OcrOutcome {
    class Ok(val words: List<OcrWord>) : OcrOutcome
    data object Failed : OcrOutcome
}

/**
 * Port of web/src/core/router/processBill.ts.
 *
 * Cancellation: every broad catch first calls ensureActive() on the cascade's own context, so a cancellation of the caller
 * always propagates and is never turned into device_error, ocr_error, redact_error or cloud_error. An exception (even a
 * CancellationException) thrown by an adapter while the caller is still active maps to the same reason as on the web.
 * The device timeout is the cascade's own timer ([withDeviceTimeout]) and is the only thing that yields device_timeout.
 *
 * OCR runs in a child started at once (UNDISPATCHED, like the web's eager promise); its failure is captured as an outcome,
 * so it never cancels the device read. On an exit before OCR is awaited (device pass, device_only) the OCR child is
 * cancelled right after "done" is reported and coroutineScope joins it, so nothing keeps running after processBill returns.
 */
suspend fun processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): ProcessedBill = coroutineScope {
    val ocrP: Deferred<OcrOutcome> = async(start = CoroutineStart.UNDISPATCHED) {
        try {
            OcrOutcome.Ok(deps.ocr.recognize(img))
        } catch (e: Exception) {
            ensureActive()
            OcrOutcome.Failed
        }
    }
    try {
        Cascade(img, deps, hooks, ocrP, coroutineContext).run()
    } finally {
        ocrP.cancel()
    }
}

private class Cascade(
    val img: ImageInput, val deps: RouterDeps, val hooks: RouterHooks, val ocrP: Deferred<OcrOutcome>, val ctx: CoroutineContext,
) {
    val cfg = deps.config
    val clock = deps.clock
    val started = clock.now().toEpochMilli()
    var ext: Extraction? = null
    var res: CheckResult? = null
    var plan = RedactionPlan(emptyList(), emptyList(), 0)
    var cloudCalled = false
    var redacted: ByteArray? = null

    /** onStep only from this coroutine and never once the caller has cancelled. */
    fun step(s: Step) {
        ctx.ensureActive()
        hooks.onStep(s)
    }

    fun finish(path: PathTaken, reason: Reason, status: BillStatus): ProcessedBill {
        step(Step.DONE)
        val r = res
        val bill = ProcessedBill(
            status = status, extraction = ext, checks = r?.checks,
            route = RouteInfo(path, reason, r?.score ?: 0.0, cfg.extractionPromptVersion,
                if (path == PathTaken.CLOUD) cfg.cloudModel else "gemini-nano"),
            piiTypes = plan.piiTypes, piiMasked = plan.piiMasked,
            latencyMs = clock.now().toEpochMilli() - started,
            estCostUsd = if (cloudCalled) CLOUD_COST_PER_CALL_USD else 0.0,
            redactedImage = redacted,
        )
        // Only on a real exit: if onStep threw above, the web's enclosing catch carries on and may still need the OCR.
        // The OCR child is not awaited on the device-pass and device_only exits, so stop it; coroutineScope then waits for
        // it to wind down before processBill returns.
        ocrP.cancel()
        return bill
    }

    suspend fun run(): ProcessedBill {
        step(Step.AVAILABILITY)
        var reason: Reason? = null
        if (cfg.routingMode == RoutingMode.CLOUD_ONLY) reason = Reason.CLOUD_ONLY_MODE
        else {
            var avail = Availability.UNAVAILABLE
            try { avail = deps.device.availability() } catch (e: Exception) { ctx.ensureActive() /* treat as unavailable */ }
            if (avail != Availability.AVAILABLE) reason = Reason.NO_DEVICE_MODEL
        }

        if (reason == null) {
            step(Step.DEVICE_READ)
            try {
                val prompt = devicePrompt(cfg)
                val raw = withDeviceTimeout(deps.deviceTimeoutMs) { deps.device.extract(img, prompt) }
                if (raw == null) reason = Reason.DEVICE_TIMEOUT
                else {
                    val e = parseExtraction(raw)
                    ext = e
                    if (e == null) reason = Reason.INVALID_JSON
                    else {
                        step(Step.CHECKING)
                        val r = runChecks(e, cfg, clock.now())
                        res = r
                        if (!r.escalate) return finish(PathTaken.DEVICE, Reason.PASSED, BillStatus.DRAFT)
                        reason = r.hardFail ?: Reason.LOW_CONFIDENCE
                    }
                }
            } catch (e: Exception) {
                ctx.ensureActive()
                reason = Reason.DEVICE_ERROR
            }
        }
        // Every path that gets here has set a reason (the device pass returned above).
        val why: Reason = reason

        if (cfg.routingMode == RoutingMode.DEVICE_ONLY) return finish(PathTaken.DEVICE, why, BillStatus.MANUAL_ENTRY)

        step(Step.REDACTING)
        val ocr = ocrP.await()
        if (ocr !is OcrOutcome.Ok) return finish(PathTaken.DEVICE, Reason.OCR_ERROR, BillStatus.MANUAL_ENTRY)
        var toSend: ByteArray = img.bytes
        if (cfg.maskPii) {
            val shield = runShield(ocr.words, cfg.consentOcrThreshold)
            plan = planRedaction(ocr.words, shield, img.width, img.height)
            // "The shield found nothing" only means "nothing to hide" if OCR actually read the bill.
            val needsPreview = shield.uncertain || !ocrAdequate(ocr.words)
            try {
                toSend = deps.painter.paint(img, plan.boxes)
                if (needsPreview) {
                    step(Step.AWAITING_CONSENT)
                    when (val c = hooks.askConsent(toSend, plan)) {
                        is ConsentResult.Keep -> return finish(PathTaken.DEVICE, Reason.USER_KEPT_LOCAL, BillStatus.MANUAL_ENTRY)
                        is ConsentResult.Send -> toSend = c.image
                    }
                }
            } catch (e: Exception) {
                ctx.ensureActive()
                return finish(PathTaken.DEVICE, Reason.REDACT_ERROR, BillStatus.MANUAL_ENTRY)
            }
            // Fail closed: never send the original image when masking is on (reference identity, as the web's Blob check).
            if (toSend === img.bytes) return finish(PathTaken.DEVICE, Reason.REDACT_ERROR, BillStatus.MANUAL_ENTRY)
            redacted = toSend
        }
        // With masking off (dev only) nothing was redacted, so redactedImage stays null and is never stored.

        step(Step.CLOUD_READ)
        val raw: String
        try {
            cloudCalled = true
            raw = deps.cloud.extract(ImageInput(toSend, img.width, img.height), cloudPrompt(cfg), cfg.cloudModel)
        } catch (e: Exception) {
            ctx.ensureActive()
            return finish(PathTaken.DEVICE, Reason.CLOUD_ERROR, BillStatus.MANUAL_ENTRY)
        }
        val cloudExt = parseExtraction(raw) ?: return finish(PathTaken.DEVICE, Reason.CLOUD_ERROR, BillStatus.MANUAL_ENTRY)
        ext = cloudExt
        step(Step.CHECKING)
        res = runChecks(cloudExt, cfg, clock.now())
        return finish(PathTaken.CLOUD, why, BillStatus.DRAFT)
    }
}
