package com.hisaabcheck.app.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.adapters.PhotoResult
import com.hisaabcheck.app.bill.BillScreen
import com.hisaabcheck.app.bill.BillViewModel
import com.hisaabcheck.app.bill.EditState
import com.hisaabcheck.app.bill.SyncState
import com.hisaabcheck.core.Checks
import com.hisaabcheck.core.PathTaken
import com.hisaabcheck.core.Reason
import com.hisaabcheck.core.RouteInfo
import com.hisaabcheck.core.shield.piiLabel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val REASON: Map<Reason, String> = mapOf(
    Reason.PASSED to "", Reason.TOTAL_MISMATCH to "total mismatch", Reason.INVALID_GSTIN to "invalid GSTIN",
    Reason.LOW_CONFIDENCE to "low confidence", Reason.DEVICE_TIMEOUT to "on-device read too slow",
    Reason.DEVICE_ERROR to "on-device error", Reason.INVALID_JSON to "unreadable answer",
    Reason.NO_DEVICE_MODEL to "no on-device AI", Reason.CLOUD_ONLY_MODE to "cloud-only mode",
    Reason.CLOUD_ERROR to "cloud unavailable", Reason.OCR_ERROR to "could not check for private numbers",
    Reason.USER_KEPT_LOCAL to "kept on device", Reason.REDACT_ERROR to "could not hide private numbers safely",
)

// Field keys, labels and order as in the web's FIELDS.
private val FIELDS: List<Triple<String, String, Boolean>> = listOf(
    Triple("supplierName", "Supplier", false), Triple("supplierGstin", "Supplier GSTIN", false),
    Triple("invoiceNo", "Invoice no.", false), Triple("invoiceDate", "Invoice date", false),
    Triple("placeOfSupply", "Place of supply", false), Triple("taxableValue", "Taxable value", true),
    Triple("cgst", "CGST", true), Triple("sgst", "SGST", true), Triple("igst", "IGST", true), Triple("total", "Total", true),
)

private fun failedFor(key: String, c: Checks?): Boolean = c != null && when (key) {
    "supplierGstin" -> !c.gstin
    "invoiceDate" -> !c.date
    "total" -> !c.total
    "cgst", "sgst", "igst" -> !c.taxSplit
    else -> false
}

private fun checkMessages(c: Checks?): List<String> {
    if (c == null) return emptyList()
    return buildList {
        if (!c.total) add("Items + tax \u2260 total")
        if (!c.gstin) add("GSTIN invalid")
        if (!c.taxSplit) add("Tax split does not match states")
        if (!c.date) add("Date invalid or in the future")
        if (!c.required) add("Required field missing")
    }
}

private fun badgeText(r: RouteInfo): String = when {
    r.path == PathTaken.DEVICE && r.reason == Reason.PASSED -> "Read on device"
    r.path == PathTaken.CLOUD -> "Checked in cloud: ${REASON[r.reason]}"
    else -> "Manual entry: ${REASON[r.reason]}"
}

@Composable
fun ResultScreen(vm: BillViewModel, state: BillScreen.Result) {
    val info by vm.info.collectAsState()
    val bill = state.bill
    val route = bill.route
    // Fixed colour pairs keep the contrast the same in light and dark themes.
    val (badgeBg, badgeFg) = when {
        route.path == PathTaken.DEVICE && route.reason == Reason.PASSED -> Color(0xFFD1FAE5) to Color(0xFF064E3B)
        route.path == PathTaken.CLOUD -> Color(0xFFE0F2FE) to Color(0xFF0C4A6E)
        else -> Color(0xFFFEF3C7) to Color(0xFF78350F)
    }
    var showSent by rememberSaveable { mutableStateOf(false) }
    val sent by produceState<ImageBitmap?>(null, bill.redactedImage) {
        val bytes = bill.redactedImage
        value = if (bytes == null) null else withContext(Dispatchers.Default) {
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }
    val saving = info.edit == EditState.Saving

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Result", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Surface(color = badgeBg, shape = RoundedCornerShape(50)) {
            Text(
                badgeText(route),
                color = badgeFg,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (bill.piiMasked > 0) {
            Text(
                "${bill.piiMasked} private number(s) hidden: ${bill.piiTypes.joinToString(", ") { piiLabel(it.name) }}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // Failed checks are always written out, so colour is never the only signal.
        for (m in checkMessages(info.checks)) {
            Text("\u26A0 $m", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        for ((key, label, numeric) in FIELDS) {
            val bad = key in info.invalid
            val failed = failedFor(key, info.checks)
            OutlinedTextField(
                value = info.text[key].orEmpty(),
                onValueChange = { vm.editField(key, it) },
                label = { Text(label) },
                isError = bad || failed,
                enabled = !saving,
                singleLine = true,
                supportingText = when {
                    bad -> { { Text(if (numeric) "Enter a number, 0 or more" else "Invalid value") } }
                    failed -> { { Text("Please check this value") } }
                    else -> null
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (numeric) KeyboardType.Decimal else KeyboardType.Text,
                    capitalization = if (key == "supplierGstin") KeyboardCapitalization.Characters else KeyboardCapitalization.None,
                ),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
        }
        Button(
            onClick = { vm.saveEdits(info.text) },
            enabled = !saving,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        ) {
            Text(
                when (info.edit) {
                    EditState.Saving -> "Saving\u2026"
                    EditState.Saved -> "Saved \u2713"
                    EditState.SavedLocally -> "Saved on this phone"
                    else -> "Save changes"
                },
            )
        }
        if (info.edit == EditState.SavedLocally) {
            Text(
                "Saved on this phone. It will be sent when you are back online.",
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        (info.edit as? EditState.Error)?.let {
            Text(it.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
        }
        if (info.invalid.isNotEmpty()) {
            Text(
                "Some values are not valid, so nothing was saved. Fix the marked fields and try again.",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
        when (info.sync) {
            SyncState.PENDING -> Text("Will sync when online", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            SyncState.SAVED -> Text("Saved", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            SyncState.FAILED -> Text(
                "Not saved \u2014 the server refused this bill",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
        when (info.photo) {
            PhotoResult.STORED -> Text("Photo stored")
            PhotoResult.FAILED -> Text("Photo not stored", color = MaterialTheme.colorScheme.error)
            else -> {}
        }
        sent?.let { img ->
            TextButton(onClick = { showSent = !showSent }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (showSent) "Hide what the cloud saw" else "Show what the cloud saw")
            }
            if (showSent) {
                Image(img, contentDescription = "Bill image with private numbers blacked out, as it was prepared for the cloud", modifier = Modifier.fillMaxWidth())
            }
        }
        if (info.canRetryCloud) {
            OutlinedButton(onClick = { vm.retry() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Retry cloud") }
        }
        OutlinedButton(onClick = { vm.done() }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Done") }
    }
}
