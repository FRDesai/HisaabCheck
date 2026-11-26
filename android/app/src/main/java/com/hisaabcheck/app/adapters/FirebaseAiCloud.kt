package com.hisaabcheck.app.adapters

import android.graphics.BitmapFactory
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.hisaabcheck.core.CloudModel
import com.hisaabcheck.core.ImageInput

/** Gemini in the cloud, in the mode that runs only in the cloud. It sends exactly the (already painted) bytes it is given. */
@OptIn(PublicPreviewAPI::class)
class FirebaseAiCloud : CloudModel {
    private val models = HashMap<String, com.google.firebase.ai.GenerativeModel>()

    override suspend fun extract(redacted: ImageInput, prompt: String, model: String): String {
        val g = synchronized(models) {
            models.getOrPut(model) {
                Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                    modelName = model,
                    generationConfig = generationConfig {
                        responseMimeType = "application/json"
                        temperature = 0f
                    },
                    onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
                )
            }
        }
        val bitmap = BitmapFactory.decodeByteArray(redacted.bytes, 0, redacted.bytes.size) ?: error("cannot decode image")
        val res = g.generateContent(content { image(bitmap); text(prompt) })
        return res.text?.takeIf { it.isNotBlank() } ?: error("empty cloud answer")
    }
}
