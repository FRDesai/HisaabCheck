package com.hisaabcheck.core

import java.time.Instant

enum class PathTaken(val wire: String) { DEVICE("device"), CLOUD("cloud") }
enum class Reason(val wire: String) {
    PASSED("passed"), TOTAL_MISMATCH("total_mismatch"), INVALID_GSTIN("invalid_gstin"), LOW_CONFIDENCE("low_confidence"),
    DEVICE_TIMEOUT("device_timeout"), DEVICE_ERROR("device_error"), INVALID_JSON("invalid_json"),
    NO_DEVICE_MODEL("no_device_model"), CLOUD_ONLY_MODE("cloud_only_mode"), CLOUD_ERROR("cloud_error"),
    OCR_ERROR("ocr_error"), USER_KEPT_LOCAL("user_kept_local"), REDACT_ERROR("redact_error")
}
enum class BillStatus(val wire: String) { DRAFT("draft"), APPROVED("approved"), REJECTED("rejected"), MANUAL_ENTRY("manual_entry") }
enum class RoutingMode(val wire: String) { SMART("smart"), DEVICE_ONLY("device_only"), CLOUD_ONLY("cloud_only") }
enum class Availability { AVAILABLE, DOWNLOADABLE, DOWNLOADING, UNAVAILABLE }
/** POSSIBLE_ID: a near-miss of PAN, Aadhaar or mobile; hidden as a precaution. The enum names are the wire strings. */
enum class PiiType { PAN, AADHAAR, PHONE, BANK_ACCOUNT, IFSC, POSSIBLE_ID }

data class LineItem(val description: String, val hsn: String, val qty: Double, val rate: Double, val amount: Double)
data class Extraction(
    val supplierName: String, val supplierGstin: String, val invoiceNo: String, val invoiceDate: String, val placeOfSupply: String,
    val items: List<LineItem>? = null, val itemCount: Double? = null,
    val taxableValue: Double, val cgst: Double, val sgst: Double, val igst: Double, val total: Double, val confidence: Double,
)
data class Checks(val total: Boolean, val gstin: Boolean, val taxSplit: Boolean, val date: Boolean, val required: Boolean)
data class CheckResult(val checks: Checks, val score: Double, val hardFail: Reason?, val escalate: Boolean)

data class Config(
    val routingMode: RoutingMode, val confidenceThreshold: Double, val consentOcrThreshold: Double,
    val totalToleranceInr: Double, val maxDeviceLineItems: Int, val cloudModel: String,
    val extractionPromptVersion: String, val maskPii: Boolean,
)

data class Box(val x0: Double, val y0: Double, val x1: Double, val y1: Double)
/** confidence is on the 0–100 scale the web OCR uses. */
data class OcrWord(val text: String, val bbox: Box, val confidence: Double, val line: Int)
data class PiiMatch(val type: PiiType, val wordIndexes: List<Int>)
data class ShieldResult(val gstinWordIndexes: List<Int>, val matches: List<PiiMatch>, val uncertain: Boolean, val uncertainReasons: List<String>)
data class RedactionPlan(val boxes: List<Box>, val piiTypes: List<PiiType>, val piiMasked: Int)

/** A bill photo as JPEG bytes. Identity (===) of [bytes] is how the cascade proves the original was never sent. */
class ImageInput(val bytes: ByteArray, val width: Int, val height: Int)

interface DeviceModel {
    suspend fun availability(): Availability
    suspend fun download(onProgress: (Double) -> Unit)
    suspend fun extract(image: ImageInput, prompt: String): String
}
interface CloudModel { suspend fun extract(redacted: ImageInput, prompt: String, model: String): String }
interface Ocr { suspend fun recognize(image: ImageInput): List<OcrWord> }
interface Painter { suspend fun paint(image: ImageInput, boxes: List<Box>): ByteArray }
fun interface Clock { fun now(): Instant }

data class RouteInfo(val path: PathTaken, val reason: Reason, val confidence: Double, val promptVersion: String, val modelName: String)
class ProcessedBill(
    val status: BillStatus, val extraction: Extraction?, val checks: Checks?, val route: RouteInfo,
    val piiTypes: List<PiiType>, val piiMasked: Int, val latencyMs: Long, val estCostUsd: Double, val redactedImage: ByteArray?,
)
enum class Step { AVAILABILITY, DEVICE_READ, CHECKING, REDACTING, AWAITING_CONSENT, CLOUD_READ, DONE }
sealed interface ConsentResult {
    class Send(val image: ByteArray) : ConsentResult
    data object Keep : ConsentResult
}
