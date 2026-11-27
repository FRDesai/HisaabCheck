package com.hisaabcheck.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.adapters.BillSummary
import com.hisaabcheck.app.bill.BillScreen
import com.hisaabcheck.app.bill.BillViewModel
import com.hisaabcheck.core.Availability
import java.util.Locale

@Composable
fun HomeScreen(vm: BillViewModel, shopName: String, onSignOut: () -> Unit, signingOut: Boolean = false) {
    val context = LocalContext.current
    val screen by vm.screen.collectAsState()
    val ai by vm.aiStatus.collectAsState()
    val progress by vm.downloadProgress.collectAsState()
    val downloadError by vm.downloadError.collectAsState()
    val recent by vm.recent.collectAsState()
    var pendingUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    var launching by remember { mutableStateOf(false) }
    var cameraError by rememberSaveable { mutableStateOf(false) }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
        val uri = pendingUri
        pendingUri = null
        launching = false
        if (uri != null) { if (taken) vm.onPhoto(uri) else vm.discardCapture(uri) }
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.onPhoto(uri)
    }
    val scope = rememberCoroutineScope()
    val aiChecked by vm.aiChecked.collectAsState()
    val canStart = screen !is BillScreen.Processing

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = shopName,
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                TextButton(onClick = onSignOut, enabled = !signingOut, modifier = Modifier.heightIn(min = 48.dp)) { SignOutLabel(signingOut) }
            }
        }
        (screen as? BillScreen.Failed)?.let { failed ->
            item {
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                    Column(
                        modifier = Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Assertive },
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(failed.message, color = MaterialTheme.colorScheme.onErrorContainer)
                        Button(onClick = { vm.retry() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (vm.canRetry) "Try again" else "Back") }
                    }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        if (launching) return@Button
                        launching = true
                        cameraError = false
                        scope.launch {
                            var uri: Uri? = null
                            try {
                                uri = vm.newCaptureUri()
                                pendingUri = uri
                                camera.launch(uri)
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                pendingUri = null
                                launching = false
                                uri?.let { vm.discardCapture(it) }
                                cameraError = true
                            }
                        }
                    },
                    enabled = canStart && !launching,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                ) { Text("Snap bill") }
                OutlinedButton(
                    onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = canStart && !launching,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                ) { Text("Pick from gallery") }
                if (cameraError) {
                    Text(
                        "The camera could not be opened. You can pick a photo from the gallery instead.",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
        }
        item {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
                Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = if (!aiChecked) "Checking on-device AI\u2026" else when (ai) {
                            Availability.AVAILABLE -> "On-device AI ready"
                            Availability.DOWNLOADABLE -> "On-device AI can be downloaded"
                            Availability.DOWNLOADING -> "Downloading\u2026"
                            Availability.UNAVAILABLE -> "No on-device AI on this phone \u2014 bills are read in the cloud with private numbers hidden"
                        },
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    if (aiChecked && ai == Availability.DOWNLOADABLE) {
                        Button(onClick = { vm.downloadModel() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Download on-device AI") }
                    }
                    if (ai == Availability.DOWNLOADING) {
                        val p = progress
                        if (p == null) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        else LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth())
                    }
                    if (downloadError) {
                        Text("The download did not finish. Check your connection and try again.", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
        item {
            Text("Recent bills", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        }
        if (recent.isEmpty()) {
            item { Text("No bills yet. Snap or pick a photo of a bill to start.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else {
            items(recent, key = { it.id }) { RecentRow(it) }
        }
    }
}

@Composable
private fun RecentRow(b: BillSummary) {
    Surface(tonalElevation = 1.dp, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp)
                .semantics(mergeDescendants = true) {},
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(b.supplierName.ifBlank { "Unnamed bill" }, fontWeight = FontWeight.Medium)
                Text(
                    listOf(b.invoiceDate.ifBlank { "No date" }, statusLabel(b.status)).joinToString("  \u00B7  "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (b.status == "rejected" && b.rejectNote.isNotBlank()) {
                    Text("Your CA's note: ${b.rejectNote}", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "Take a new photo of this bill if your CA asks for one.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(String.format(Locale.US, "\u20B9%,.2f", b.total), fontWeight = FontWeight.Medium)
        }
    }
}

private fun statusLabel(status: String) = when (status) {
    "draft" -> "Waiting for review"
    "approved" -> "Approved"
    "rejected" -> "Rejected"
    "manual_entry" -> "Manual entry"
    else -> status
}
