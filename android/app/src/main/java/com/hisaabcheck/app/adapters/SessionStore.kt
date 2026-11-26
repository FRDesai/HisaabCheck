package com.hisaabcheck.app.adapters

import com.google.android.gms.tasks.Task
import com.google.firebase.Firebase
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source
import com.google.firebase.firestore.firestore
import com.hisaabcheck.app.Shop
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/** The owner statement differs from the CA statement on the web (2026-11-v1), so it has its own version. */
const val CONSENT_VERSION = "2026-11-v1-owner"

private const val INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
private const val INVITE_LENGTH = 8
private const val WRITE_TIMEOUT_MS = 15_000L

enum class SessionFailure { BadCodeFormat, UnknownCode, AlreadyUsed, CodeNoLongerWorks, NoConnection, Other }

/** A failure the screens can explain in plain words. It never carries a phone number, uid or code. */
class SessionException(val failure: SessionFailure, cause: Throwable? = null) : Exception(failure.name, cause)

/** Trim, drop spaces and hyphens, upper-case. */
fun normaliseInviteCode(raw: String): String =
    raw.trim().filter { it != ' ' && it != '-' }.uppercase()

fun isValidInviteCode(code: String): Boolean =
    code.length == INVITE_LENGTH && code.all { it in INVITE_ALPHABET }

/** Firestore access for the owner's user document, consent and shop link. */
class SessionStore {
    private val db get() = Firebase.firestore

    /**
     * Creates users/{uid} as an owner if it is missing (the create is queued, not awaited, like the web).
     * Returns the consent version stored on the user document, or null if there is none.
     */
    suspend fun ensureUser(uid: String, phone: String): String? {
        val ref = db.collection("users").document(uid)
        val snap = try { ref.get().awaitTask() } catch (e: CancellationException) { throw e } catch (e: Exception) { throw mapFailure(e) }
        if (snap.exists()) return snap.getString("consentVersion")
        ref.set(mapOf("role" to "owner", "phone" to phone, "createdAt" to FieldValue.serverTimestamp()))
            .addOnFailureListener { /* surfaced later by recordConsent */ }
        return null
    }

    /** Sets consentVersion and consentAt (server time). Leaves role and every other field alone. */
    suspend fun recordConsent(uid: String) {
        val ref = db.collection("users").document(uid)
        val consent = mapOf("consentVersion" to CONSENT_VERSION, "consentAt" to FieldValue.serverTimestamp())
        try {
            val snap = ref.get().awaitTask()
            if (snap.exists() && snap.getString("consentVersion") == CONSENT_VERSION) return
            // If the create from ensureUser was lost, create now. Rules allow only role 'owner'.
            val data: Map<String, Any> = if (snap.exists()) consent else consent + ("role" to "owner")
            withTimeoutOrNull(WRITE_TIMEOUT_MS) { ref.set(data, SetOptions.merge()).awaitTask() }
                ?: throw SessionException(SessionFailure.NoConnection)
        } catch (e: SessionException) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw mapFailure(e)
        }
    }

    /**
     * The shop whose ownerUid is this user, or null when the server says there is none. The server is asked first:
     * an offline query would otherwise return an empty cached result and look like "no shop". If the server cannot
     * be reached, a cached hit is accepted; an empty cache is NoConnection, never "no shop".
     */
    suspend fun findShop(uid: String): Shop? {
        val query = db.collection("shops").whereEqualTo("ownerUid", uid).limit(1)
        try {
            return query.get(Source.SERVER).awaitTask().documents.firstOrNull()?.let { toShop(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val cached = try {
                query.get(Source.CACHE).awaitTask().documents.firstOrNull()?.let { toShop(it) }
            } catch (e2: CancellationException) {
                throw e2
            } catch (e2: Exception) {
                null
            }
            if (cached != null) return cached
            throw SessionException(SessionFailure.NoConnection, e)
        }
    }

    /**
     * Links the user to the shop the invite code names: read invites/{code} by id, then ONE update of
     * shops/{shopId} with exactly ownerUid and claimedWith, then read the shop.
     */
    suspend fun linkShop(uid: String, rawCode: String): Shop {
        val code = normaliseInviteCode(rawCode)
        if (!isValidInviteCode(code)) throw SessionException(SessionFailure.BadCodeFormat)
        try {
            val invite = db.collection("invites").document(code).get(Source.SERVER).awaitTask()
            if (!invite.exists()) throw SessionException(SessionFailure.UnknownCode)
            val shopId = invite.getString("shopId") ?: throw SessionException(SessionFailure.UnknownCode)
            val shopRef = db.collection("shops").document(shopId)
            val done = withTimeoutOrNull(WRITE_TIMEOUT_MS) {
                try {
                    shopRef.update(mapOf("ownerUid" to uid, "claimedWith" to code)).awaitTask()
                } catch (e: FirebaseFirestoreException) {
                    if (e.code == FirebaseFirestoreException.Code.NOT_FOUND) throw SessionException(SessionFailure.CodeNoLongerWorks, e)
                    if (e.code != FirebaseFirestoreException.Code.PERMISSION_DENIED) throw e
                    // A refusal. If a retry finds we already own this shop, the earlier write went through.
                    val mine = try {
                        shopRef.get().awaitTask().getString("ownerUid") == uid
                    } catch (e2: CancellationException) {
                        throw e2
                    } catch (e2: Exception) {
                        false
                    }
                    if (!mine) throw SessionException(SessionFailure.AlreadyUsed, e)
                }
                true
            } ?: throw SessionException(SessionFailure.NoConnection)
            check(done)
            return toShop(shopRef.get().awaitTask()) ?: throw SessionException(SessionFailure.Other)
        } catch (e: SessionException) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw mapFailure(e)
        }
    }

    private fun toShop(d: DocumentSnapshot): Shop? {
        if (!d.exists()) return null
        val caUid = d.getString("caUid") ?: return null
        return Shop(id = d.id, caUid = caUid, shopName = d.getString("shopName") ?: "", storeImages = d.getBoolean("storeImages") ?: false)
    }

    private fun mapFailure(e: Exception): SessionException {
        if (e is SessionException) return e
        if (e is FirebaseFirestoreException) {
            return when (e.code) {
                FirebaseFirestoreException.Code.UNAVAILABLE,
                FirebaseFirestoreException.Code.DEADLINE_EXCEEDED -> SessionException(SessionFailure.NoConnection, e)
                else -> SessionException(SessionFailure.Other, e)
            }
        }
        return SessionException(SessionFailure.Other, e)
    }
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
