package com.hisaabcheck.app.adapters

import com.google.android.gms.tasks.Task
import com.google.firebase.Firebase
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.firestore
import com.google.firebase.storage.StorageMetadata
import com.google.firebase.storage.storage
import com.hisaabcheck.app.Shop
import com.hisaabcheck.core.Checks
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.router.toRouteLogFields
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.suspendCancellableCoroutine

enum class PhotoResult { STORED, SKIPPED, FAILED }

/** [synced] is true on server acknowledgement of the bill, false if the server refuses it. */
class SavedBill(val billId: String, val synced: Deferred<Boolean>, val photo: Deferred<PhotoResult>)

data class BillSummary(val id: String, val supplierName: String, val invoiceDate: String, val total: Double, val status: String)

/** Firestore and Storage access for bills. Same document shapes and write order as web/src/adapters/store.ts. */
class BillStore {
    private val db get() = Firebase.firestore
    private val storage get() = Firebase.storage
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private companion object {
        /**
         * The newest save attempt per bill id, for attempts whose photo upload has not finished. In memory only: an
         * upload does not survive the process, so after a process death no earlier attempt can still link its photo.
         */
        val latestAttempt = ConcurrentHashMap<String, Any>()
        val attemptLock = Any()
    }

    fun save(shop: Shop, bill: ProcessedBill, billId: String? = null): SavedBill {
        val bills = db.collection("shops").document(shop.id).collection("bills")
        val billRef: DocumentReference = if (billId != null) bills.document(billId) else bills.document()

        val doc = HashMap<String, Any?>()
        bill.extraction?.let { doc.putAll(extractionFields(it)) }
        doc["checks"] = bill.checks?.let { checksMap(it) }
        doc["status"] = bill.status.wire
        doc["route"] = mapOf(
            "path" to bill.route.path.wire,
            "reason" to bill.route.reason.wire,
            "confidence" to bill.route.confidence,
            "promptVersion" to bill.route.promptVersion,
            "modelName" to bill.route.modelName,
        )
        doc["createdAt"] = FieldValue.serverTimestamp()

        // This save is now the bill's newest attempt; any earlier attempt's upload still running is superseded. Marking
        // it and queueing the write happen under one lock, so a superseded upload's imagePath write is either queued
        // before this set (which then clears it) or not made at all. Firestore applies one client's writes in order.
        val attempt = Any()
        val billTask = synchronized(attemptLock) {
            latestAttempt[billRef.id] = attempt
            // Bill first. The offline cache queues it; the task completes only on server acknowledgement or refusal.
            billRef.set(doc)
        }
        val synced = scope.async { try { billTask.awaitTask(); true } catch (e: CancellationException) { throw e } catch (e: Exception) { false } }

        // Route log is best-effort telemetry (counts and types only) and never affects the bill.
        try {
            val log = HashMap<String, Any>(toRouteLogFields(bill, billRef.id, shop.id, shop.caUid))
            log["createdAt"] = FieldValue.serverTimestamp()
            db.collection("routeLogs").document().set(log)
        } catch (e: Exception) { /* telemetry only */ }

        val image = bill.redactedImage
        val photo: Deferred<PhotoResult> = if (shop.storeImages && image != null) {
            // Each save uploads under its own new name: an owner may only add objects, never overwrite, so a retry
            // (with the boxes added in its own preview) must not depend on, or fall back to, an earlier attempt's photo.
            val imagePath = "shops/${shop.id}/bills/${billRef.id}-${System.currentTimeMillis().toString(36)}.jpg"
            scope.async {
                try {
                    val meta = StorageMetadata.Builder().setContentType("image/jpeg").build()
                    storage.reference.child(imagePath).putBytes(image, meta).awaitTask()
                    // Only the newest attempt may link its photo. A superseded upload stays in Storage, unreferenced,
                    // and is reported as not stored: no photo is better than one without the owner's later boxes.
                    val link = synchronized(attemptLock) {
                        if (latestAttempt[billRef.id] === attempt) billRef.update("imagePath", imagePath) else null
                    } ?: return@async PhotoResult.FAILED
                    link.awaitTask()
                    PhotoResult.STORED
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    PhotoResult.FAILED
                } finally {
                    // Forget the bill once its newest attempt has finished, so the map does not grow across bills.
                    latestAttempt.remove(billRef.id, attempt)
                }
            }
        } else {
            // No photo with this attempt: nothing to wait for, and any earlier upload is already superseded.
            latestAttempt.remove(billRef.id, attempt)
            CompletableDeferred(PhotoResult.SKIPPED)
        }

        return SavedBill(billRef.id, synced, photo)
    }

    /**
     * Writes the whole extraction (as save does), checks and editedAt; never status, route, createdAt or review keys.
     * Completes on server acknowledgement and throws on refusal. Offline it does not return until the connection is
     * back, so callers must not block navigation on it.
     */
    suspend fun updateFields(shopId: String, billId: String, e: Extraction, checks: Checks) {
        val fields = HashMap<String, Any?>(extractionFields(e))
        fields["checks"] = checksMap(checks)
        fields["editedAt"] = FieldValue.serverTimestamp()
        db.collection("shops").document(shopId).collection("bills").document(billId).update(fields).awaitTask()
    }

    fun watchRecent(shopId: String, max: Int = 20, onChange: (List<BillSummary>) -> Unit, onError: (Exception) -> Unit): ListenerRegistration =
        db.collection("shops").document(shopId).collection("bills")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(max.toLong())
            .addSnapshotListener { snap, err ->
                if (err != null) { onError(err); return@addSnapshotListener }
                if (snap != null) onChange(snap.documents.map { summary(it) })
            }

    private fun summary(d: DocumentSnapshot) = BillSummary(
        id = d.id,
        supplierName = d.getString("supplierName") ?: "",
        invoiceDate = d.getString("invoiceDate") ?: "",
        total = d.getDouble("total") ?: 0.0,
        status = d.getString("status") ?: "draft",
    )

    private fun checksMap(c: Checks) = mapOf(
        "total" to c.total, "gstin" to c.gstin, "taxSplit" to c.taxSplit, "date" to c.date, "required" to c.required,
    )

    /** The flattened extraction exactly as the web writes it; items and itemCount are omitted when null. */
    private fun extractionFields(e: Extraction): Map<String, Any> {
        val m = LinkedHashMap<String, Any>()
        m["supplierName"] = e.supplierName
        m["supplierGstin"] = e.supplierGstin
        m["invoiceNo"] = e.invoiceNo
        m["invoiceDate"] = e.invoiceDate
        m["placeOfSupply"] = e.placeOfSupply
        m["taxableValue"] = e.taxableValue
        m["cgst"] = e.cgst
        m["sgst"] = e.sgst
        m["igst"] = e.igst
        m["total"] = e.total
        m["confidence"] = e.confidence
        e.items?.let { items ->
            m["items"] = items.map {
                mapOf("description" to it.description, "hsn" to it.hsn, "qty" to it.qty, "rate" to it.rate, "amount" to it.amount)
            }
        }
        e.itemCount?.let { m["itemCount"] = it }
        return m
    }
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
