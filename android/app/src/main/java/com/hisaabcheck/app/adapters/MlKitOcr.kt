package com.hisaabcheck.app.adapters

import android.graphics.BitmapFactory
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.hisaabcheck.core.Box
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.Ocr
import com.hisaabcheck.core.OcrWord
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/** On-device text recognition. Words are returned in reading order with boxes in image pixels. Text is never logged. */
class MlKitOcr : Ocr {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    override suspend fun recognize(image: ImageInput): List<OcrWord> {
        val bitmap = BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size) ?: error("cannot decode image")
        val result = recognizer.process(InputImage.fromBitmap(bitmap, 0)).awaitTask()
        val words = ArrayList<OcrWord>()
        var line = 0
        for (block in result.textBlocks) {
            for (l in block.lines) {
                for (el in l.elements) {
                    // A word without a box cannot be painted over: fail so the cloud path stays closed.
                    val r = el.boundingBox ?: error("OCR word without a bounding box")
                    words += OcrWord(
                        text = el.text,
                        bbox = Box(r.left.toDouble(), r.top.toDouble(), r.right.toDouble(), r.bottom.toDouble()),
                        confidence = el.confidence * 100.0,
                        line = line,
                    )
                }
                line++
            }
        }
        return words
    }
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
