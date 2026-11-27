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
 * Wording is the web's ConsentPage, changed for the owner: "your clients" -> "your shop", "this computer" -> "this phone",
 * the photo-storage switch belongs to the CA, plus a line that the CA can see the bills, and deletion is asked of the CA.
 * Because it differs from the CA statement, it is recorded as its own version (see CONSENT_VERSION).
 */
@Composable
fun ConsentScreen(vm: SessionViewModel) {
    val ui by vm.ui.collectAsState()
    val signingOut by vm.signingOut.collectAsState()
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
            "Your CA can see the bills you send and the details read from them.",
            "If a bill needs the cloud, PAN, Aadhaar, phone and bank numbers are blacked out first.",
            "Photos are not stored unless your CA turns that on for your shop. Saved bill data is stored in India (Mumbai). Bills read in the cloud are processed by Google's Gemini service.",
            "You can withdraw consent by signing out and asking your CA to delete your data.",
        ).forEach { Text("\u2022  $it", style = MaterialTheme.typography.bodyLarge) }
        LiveError(ui.error)
        Button(onClick = { vm.agree() }, enabled = !ui.busy, modifier = buttonModifier) {
            Text(if (ui.busy) "Saving..." else "I agree")
        }
        OutlinedButton(onClick = { vm.signOut() }, enabled = !ui.busy && !signingOut, modifier = buttonModifier) { SignOutLabel(signingOut) }
    }
}
