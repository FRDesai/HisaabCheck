package com.hisaabcheck.app.adapters

import com.google.android.gms.tasks.Task
import com.google.firebase.Firebase
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.config.DEFAULT_REMOTE_VALUES
import com.hisaabcheck.core.config.parseConfig
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Reads routing settings from Remote Config; any failure falls back to the activated or bundled default values.
 * Masking is forced on in every build: a mask_pii value from the console can never turn it off on Android.
 */
class RemoteConfigSource {
    suspend fun load(): Config {
        val values: Map<String, String> = try {
            val rc = Firebase.remoteConfig
            rc.setConfigSettingsAsync(remoteConfigSettings {
                minimumFetchIntervalInSeconds = 30
                fetchTimeoutInSeconds = 3
            }).awaitTask()
            rc.setDefaultsAsync(DEFAULT_REMOTE_VALUES).awaitTask()
            try {
                withTimeoutOrNull(3500) { rc.fetchAndActivate().awaitTask() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) { /* activated or default values stay */ }
            DEFAULT_REMOTE_VALUES.keys.associateWith { rc.getString(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            DEFAULT_REMOTE_VALUES
        }
        return parseConfig(values, true)
    }
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
