package com.hisaabcheck.app.adapters

import android.graphics.BitmapFactory
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.ondevice.DownloadStatus
import com.google.firebase.ai.ondevice.FirebaseAIOnDevice
import com.google.firebase.ai.ondevice.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.hisaabcheck.core.Availability
import com.hisaabcheck.core.DeviceModel
import com.hisaabcheck.core.ImageInput
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.collect

/**
 * Gemini Nano through Firebase AI Logic, in the mode that runs only on the phone.
 * The answer is accepted only when the SDK reports it came from the device.
 */
@OptIn(PublicPreviewAPI::class)
class FirebaseAiDevice : DeviceModel {
    private val model by lazy {
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = "gemini-3.5-flash-lite",
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE),
        )
    }

    override suspend fun availability(): Availability = try {
        when (FirebaseAIOnDevice.checkStatus()) {
            OnDeviceModelStatus.AVAILABLE -> Availability.AVAILABLE
            OnDeviceModelStatus.DOWNLOADABLE -> Availability.DOWNLOADABLE
            OnDeviceModelStatus.DOWNLOADING -> Availability.DOWNLOADING
            else -> Availability.UNAVAILABLE
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Availability.UNAVAILABLE
    }

    override suspend fun download(onProgress: (Double) -> Unit) {
        var total = 0L
        var completed = false
        FirebaseAIOnDevice.download().collect { status ->
            when (status) {
                is DownloadStatus.DownloadStarted -> { total = status.bytesToDownload; onProgress(0.0) }
                is DownloadStatus.DownloadInProgress ->
                    onProgress(if (total > 0) (status.totalBytesDownloaded.toDouble() / total).coerceIn(0.0, 1.0) else 0.0)
                is DownloadStatus.DownloadCompleted -> { completed = true; onProgress(1.0) }
                is DownloadStatus.DownloadFailed -> error("on-device model download failed")
                else -> Unit
            }
        }
        if (!completed) error("on-device model download ended without completing")
    }

    override suspend fun extract(image: ImageInput, prompt: String): String {
        val bitmap = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size) }
            ?: error("cannot decode image")
        val res = model.generateContent(content { image(bitmap); text(prompt) })
        // Fail closed: ONLY_ON_DEVICE already keeps the request on the phone; this refuses any answer not confirmed as the device's.
        if (res.inferenceSource != InferenceSource.ON_DEVICE) error("on-device model unavailable: response not from device")
        return res.text?.takeIf { it.isNotBlank() } ?: error("empty on-device answer")
    }
}
