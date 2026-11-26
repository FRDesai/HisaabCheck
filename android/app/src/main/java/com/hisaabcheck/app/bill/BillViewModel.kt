package com.hisaabcheck.app.bill

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.hisaabcheck.app.BuildConfig
import com.hisaabcheck.app.Shop
import com.hisaabcheck.app.adapters.BillStore
import com.hisaabcheck.app.adapters.BillSummary
import com.hisaabcheck.app.adapters.BitmapPainter
import com.hisaabcheck.app.adapters.FirebaseAiCloud
import com.hisaabcheck.app.adapters.FirebaseAiDevice
import com.hisaabcheck.app.adapters.ImageLoader
import com.hisaabcheck.app.adapters.MlKitOcr
import com.hisaabcheck.app.adapters.PhotoResult
import com.hisaabcheck.app.adapters.RemoteConfigSource
import com.hisaabcheck.core.Availability
import com.hisaabcheck.core.Checks
import com.hisaabcheck.core.Clock
import com.hisaabcheck.core.Config
import com.hisaabcheck.core.ConsentResult
import com.hisaabcheck.core.Extraction
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.ProcessedBill
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.RedactionPlan
import com.hisaabcheck.core.Step
import com.hisaabcheck.core.checks.runChecks
import com.hisaabcheck.core.config.parseConfig
import com.hisaabcheck.core.router.RouterDeps
import com.hisaabcheck.core.router.RouterHooks
import com.hisaabcheck.core.router.processBill
import java.math.BigDecimal
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

sealed interface BillScreen {
    data object Home : BillScreen
    data class Processing(val step: Step) : BillScreen
    data class Preview(val redacted: ByteArray, val plan: RedactionPlan) : BillScreen
    data class Result(val billId: String, val bill: ProcessedBill) : BillScreen
    data class Failed(val message: String) : BillScreen
}

enum class SyncState { PENDING, SAVED, FAILED }

sealed interface EditState {
    data object Idle : EditState
    data object Saving : EditState
    data object Saved : EditState
    data class Error(val message: String) : EditState
}

/** What the result screen shows besides the bill itself. Field keys are the web's (supplierName ... total). */
data class ResultInfo(
    val sync: SyncState = SyncState.PENDING,
    val photo: PhotoResult? = null,
    val checks: Checks? = null,
    val text: Map<String, String> = emptyMap(),
    val invalid: Set<String> = emptySet(),
    val edit: EditState = EditState.Idle,
    val canRetryCloud: Boolean = false,
)

val TEXT_KEYS = listOf("supplierName", "supplierGstin", "invoiceNo", "invoiceDate", "placeOfSupply")
val NUMBER_KEYS = listOf("taxableValue", "cgst", "sgst", "igst", "total")

private val EMPTY_EXTRACTION = Extraction(
    supplierName = "", supplierGstin = "", invoiceNo = "", invoiceDate = "", placeOfSupply = "",
    taxableValue = 0.0, cgst = 0.0, sgst = 0.0, igst = 0.0, total = 0.0, confidence = 0.0,
)

/** Mirrors web parseAmount: commas, the rupee sign and spaces allowed; digits with an optional decimal part; 0 or more. */
internal fun parseAmount(s: String): Double? {
    val t = s.filter { it != ',' && it != '\u20B9' && !it.isWhitespace() }
    if (!AMOUNT.matches(t)) return null
    val n = t.toDoubleOrNull() ?: return null
    return if (n.isFinite() && n >= 0) n else null
}
private val AMOUNT = Regex("^(\\d+(\\.\\d+)?|\\.\\d+)$")

internal fun amountText(d: Double): String = BigDecimal.valueOf(d).stripTrailingZeros().toPlainString()

internal fun toFormText(e: Extraction): Map<String, String> = mapOf(
    "supplierName" to e.supplierName, "supplierGstin" to e.supplierGstin, "invoiceNo" to e.invoiceNo,
    "invoiceDate" to e.invoiceDate, "placeOfSupply" to e.placeOfSupply,
    "taxableValue" to amountText(e.taxableValue), "cgst" to amountText(e.cgst), "sgst" to amountText(e.sgst),
    "igst" to amountText(e.igst), "total" to amountText(e.total),
)

class BillViewModel(private val shop: Shop, app: Application) : AndroidViewModel(app) {
    private val isProd = !BuildConfig.DEBUG
    private val store = BillStore()
    private val device = FirebaseAiDevice()
    private val cloud = FirebaseAiCloud()
    private val ocr = MlKitOcr()
    private val painter = BitmapPainter()

    private val _screen = MutableStateFlow<BillScreen>(BillScreen.Home)
    val screen: StateFlow<BillScreen> = _screen.asStateFlow()
    private val _aiStatus = MutableStateFlow(Availability.UNAVAILABLE)
    val aiStatus: StateFlow<Availability> = _aiStatus.asStateFlow()
    private val _recent = MutableStateFlow<List<BillSummary>>(emptyList())
    val recent: StateFlow<List<BillSummary>> = _recent.asStateFlow()
    private val _downloadProgress = MutableStateFlow<Float?>(null)
    val downloadProgress: StateFlow<Float?> = _downloadProgress.asStateFlow()
    private val _downloadError = MutableStateFlow(false)
    val downloadError: StateFlow<Boolean> = _downloadError.asStateFlow()
    private val _info = MutableStateFlow(ResultInfo())
    val info: StateFlow<ResultInfo> = _info.asStateFlow()

    // The original photo lives only here, in memory. It goes to processBill (inside the ImageInput) and nowhere else.
    private var photo: ImageInput? = null
    private var billId: String? = null
    private var config: Config? = null
    private var editBase: Extraction = EMPTY_EXTRACTION
    private var job: Job? = null
    private var editJob: Job? = null
    private var consent: CompletableDeferred<ConsentResult>? = null
    private var runId = 0
    private var recentListener: ListenerRegistration? = null

    init {
        try {
            recentListener = store.watchRecent(shop.id, 20, onChange = { _recent.value = it }, onError = { })
        } catch (e: Exception) {
            // Firebase not ready: the list stays empty.
        }
        refreshAvailability()
    }

    private fun refreshAvailability() {
        viewModelScope.launch { _aiStatus.value = device.availability() }
    }

    fun downloadModel() {
        if (_aiStatus.value != Availability.DOWNLOADABLE) return
        _aiStatus.value = Availability.DOWNLOADING
        _downloadProgress.value = null
        _downloadError.value = false
        viewModelScope.launch {
            try {
                device.download { _downloadProgress.value = it.toFloat().coerceIn(0f, 1f) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _downloadError.value = true
            }
            _downloadProgress.value = null
            _aiStatus.value = device.availability()
        }
    }

    fun onPhoto(uri: Uri) {
        if (job?.isActive == true) return
        val id = ++runId
        _screen.value = BillScreen.Processing(Step.AVAILABILITY)
        job = viewModelScope.launch {
            try {
                val img = try {
                    ImageLoader.load(getApplication(), uri)
                } finally {
                    discardCameraFile(uri)
                }
                photo = img
                billId = null
                cascade(img, id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(id, photo != null)
            }
        }
    }

    /** Re-runs the cascade for the same photo and saves under the same bill id. */
    fun retry() {
        val img = photo
        if (img == null) {
            // Nothing to re-run (the photo never loaded): go back to the start.
            if (job?.isActive != true) { _screen.value = BillScreen.Home }
            return
        }
        if (job?.isActive == true) return
        val id = ++runId
        _screen.value = BillScreen.Processing(Step.AVAILABILITY)
        job = viewModelScope.launch {
            try {
                cascade(img, id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(id, true)
            }
        }
    }

    private fun fail(id: Int, canRetry: Boolean) {
        if (id != runId) return
        _screen.value = BillScreen.Failed(
            if (canRetry) "Something went wrong while reading this bill. Your photo is still here, so you can try again."
            else "We could not open that photo. Please try again with another one.",
        )
    }

    private suspend fun cascade(img: ImageInput, id: Int) {
        val cfg = RemoteConfigSource(isProd).load()
        config = cfg
        val deps = RouterDeps(device, cloud, ocr, painter, cfg, Clock { Instant.now() })
        val hooks = object : RouterHooks {
            override fun onStep(step: Step) {
                if (id == runId) _screen.value = BillScreen.Processing(step)
            }

            override suspend fun askConsent(redacted: ByteArray, plan: RedactionPlan): ConsentResult {
                val waiting = CompletableDeferred<ConsentResult>()
                consent = waiting
                _screen.value = BillScreen.Preview(redacted, plan)
                try {
                    return waiting.await()
                } finally {
                    if (consent === waiting) consent = null
                }
            }
        }
        val result = processBill(img, deps, hooks)
        // Saved before the result screen is shown, so a captured bill is never lost. Only the redacted image is stored.
        val saved = store.save(shop, result, billId)
        billId = saved.billId
        editBase = result.extraction ?: EMPTY_EXTRACTION
        _info.value = ResultInfo(
            checks = result.checks,
            text = toFormText(editBase),
            canRetryCloud = result.route.reason == Reason.CLOUD_ERROR,
        )
        _screen.value = BillScreen.Result(saved.billId, result)
        viewModelScope.launch {
            val ok = try { saved.synced.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { false }
            if (id == runId) _info.value = _info.value.copy(sync = if (ok) SyncState.SAVED else SyncState.FAILED)
        }
        viewModelScope.launch {
            val p = try { saved.photo.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { PhotoResult.FAILED }
            if (id == runId) _info.value = _info.value.copy(photo = p)
        }
    }

    /** Answers the Preview. Send carries the redacted image with any extra boxes already painted. */
    fun onConsent(result: ConsentResult) {
        val waiting = consent ?: return
        _screen.value = BillScreen.Processing(if (result is ConsentResult.Send) Step.CLOUD_READ else Step.DONE)
        waiting.complete(result)
    }

    fun editField(key: String, value: String) {
        val cur = _info.value
        if (cur.edit == EditState.Saving) return
        _info.value = cur.copy(text = cur.text + (key to value), invalid = cur.invalid - key, edit = EditState.Idle)
    }

    fun saveEdits(fields: Map<String, String>) {
        val id = billId ?: return
        if (_info.value.edit == EditState.Saving) return
        val invalid = LinkedHashSet<String>()
        val textOf = { k: String -> fields[k].orEmpty() }
        val amounts = HashMap<String, Double>()
        for (k in NUMBER_KEYS) {
            val n = parseAmount(textOf(k))
            if (n == null) invalid.add(k) else amounts[k] = n
        }
        if (invalid.isNotEmpty()) {
            _info.value = _info.value.copy(text = fields, invalid = invalid, edit = EditState.Idle)
            return
        }
        val value = editBase.copy(
            supplierName = textOf("supplierName").trim(),
            supplierGstin = textOf("supplierGstin").trim().uppercase(),
            invoiceNo = textOf("invoiceNo").trim(),
            invoiceDate = textOf("invoiceDate").trim(),
            placeOfSupply = textOf("placeOfSupply").trim(),
            taxableValue = amounts.getValue("taxableValue"), cgst = amounts.getValue("cgst"), sgst = amounts.getValue("sgst"),
            igst = amounts.getValue("igst"), total = amounts.getValue("total"),
        )
        val run = runId
        _info.value = _info.value.copy(text = fields, invalid = emptySet(), edit = EditState.Saving)
        editJob = viewModelScope.launch {
            try {
                val checks = runChecks(value, config ?: parseConfig(emptyMap(), isProd), Instant.now()).checks
                // An offline write is queued and never acknowledged, so stop waiting after a while.
                val done = withTimeoutOrNull(15_000) { store.updateFields(shop.id, id, value, checks); true }
                if (run != runId) return@launch
                if (done == true) {
                    editBase = value
                    _info.value = _info.value.copy(checks = checks, text = toFormText(value), edit = EditState.Saved)
                } else {
                    _info.value = _info.value.copy(edit = EditState.Error(CONNECTION_MESSAGE))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (run != runId) return@launch
                val denied = e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
                _info.value = _info.value.copy(edit = EditState.Error(if (denied) REVIEWED_MESSAGE else CONNECTION_MESSAGE))
            }
        }
    }

    /** Back to Home. Cancels any work, frees a waiting preview and drops the photo from memory. */
    fun done() {
        runId++
        job?.cancel()
        editJob?.cancel()
        consent?.cancel()
        job = null
        editJob = null
        consent = null
        photo = null
        billId = null
        config = null
        editBase = EMPTY_EXTRACTION
        _info.value = ResultInfo()
        _screen.value = BillScreen.Home
        refreshAvailability()
    }

    override fun onCleared() {
        job?.cancel()
        editJob?.cancel()
        consent?.cancel()
        consent = null
        photo = null
        recentListener?.remove()
        recentListener = null
    }

    /** A camera capture is a temporary file of ours: remove it once it has been read. */
    private fun discardCameraFile(uri: Uri) {
        try {
            val app = getApplication<Application>()
            if (uri.authority == "${app.packageName}.fileprovider") app.contentResolver.delete(uri, null, null)
        } catch (e: Exception) {
            // best effort
        }
    }

    class Factory(private val shop: Shop, private val app: Application) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = BillViewModel(shop, app) as T
    }

    private companion object {
        const val CONNECTION_MESSAGE = "Could not save your changes. Check your connection and try again."
        const val REVIEWED_MESSAGE = "Your CA has already reviewed this bill, so it can no longer be changed here."
    }
}
