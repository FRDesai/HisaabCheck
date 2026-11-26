package com.hisaabcheck.core.router

import kotlinx.coroutines.withTimeoutOrNull

/**
 * Port of web/src/core/router/timeout.ts. Runs [block] with the cascade's own timer and returns null if [ms] elapses first
 * (the web rejects with TimeoutError; here null plays that role, since the device read never returns null).
 *
 * Unlike the web, the slow read is cancelled rather than left running. A cancellation of the caller is NOT turned into null:
 * withTimeoutOrNull only swallows the TimeoutCancellationException of its own timer, so the caller's CancellationException
 * (and a timeout raised inside [block] by some other timer) still propagates out of here.
 */
internal suspend fun <T : Any> withDeviceTimeout(ms: Long, block: suspend () -> T): T? = withTimeoutOrNull(ms) { block() }
