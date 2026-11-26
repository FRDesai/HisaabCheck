package com.hisaabcheck.core.router

import com.hisaabcheck.core.Clock
import com.hisaabcheck.core.CloudModel
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.ConsentResult
import com.hisaabcheck.core.DeviceModel
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.Ocr
import com.hisaabcheck.core.Painter
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.RedactionPlan
import com.hisaabcheck.core.Step
import com.hisaabcheck.core.config.DEVICE_TIMEOUT_MS

class RouterDeps(
    val device: DeviceModel, val cloud: CloudModel, val ocr: Ocr, val painter: Painter,
    val config: Config, val clock: Clock, val deviceTimeoutMs: Long = DEVICE_TIMEOUT_MS,
)

interface RouterHooks {
    fun onStep(step: Step)
    suspend fun askConsent(redacted: ByteArray, plan: RedactionPlan): ConsentResult
}

suspend fun processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): ProcessedBill = TODO("Task 5")
