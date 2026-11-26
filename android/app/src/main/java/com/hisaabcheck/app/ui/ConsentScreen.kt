package com.hisaabcheck.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.session.SessionViewModel

/**
 * Wording is the web's ConsentPage (CONSENT_VERSION 2026-11-v1), changed only for who is addressed:
 * "your clients" -> "your shop", "this computer" -> "this phone", and the photo-storage switch belongs to the CA.
 */
@Composable
fun ConsentScreen(vm: SessionViewModel) {
    val ui by vm.ui.collectAsState()
    val buttonModifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Before you start", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        Text(
            "HisaabCheck processes bill photos you upload to extract supplier, invoice and tax details for your shop.",
            style = MaterialTheme.typography.bodyLarge,
        )
        listOf(
            "Bills are read on this phone when possible.",
            "If a bill needs the cloud, PAN, Aadhaar, phone and bank numbers are blacked out first.",
            "Photos are not stored unless your CA turns that on for your shop. Data is kept in India (Mumbai).",
            "You can withdraw consent by signing out and asking us to delete your data.",
        ).forEach { Text("•  $it", style = MaterialTheme.typography.bodyLarge) }
        LiveError(ui.error)
        Button(onClick = { vm.agree() }, enabled = !ui.busy, modifier = buttonModifier) {
            Text(if (ui.busy) "Saving..." else "I agree")
        }
        OutlinedButton(onClick = { vm.signOut() }, enabled = !ui.busy, modifier = buttonModifier) { Text("Sign out") }
    }
}
