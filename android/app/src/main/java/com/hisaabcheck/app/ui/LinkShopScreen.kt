package com.hisaabcheck.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.session.SessionViewModel

@Composable
fun LinkShopScreen(vm: SessionViewModel) {
    val ui by vm.ui.collectAsState()
    val signingOut by vm.signingOut.collectAsState()
    var code by rememberSaveable { mutableStateOf("") }
    val buttonModifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    Column(
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Link your shop", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        Text("Type the 8-character code your CA read out to you.", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.take(16) },
            label = { Text("Invite code") },
            singleLine = true,
            isError = ui.error != null,
            enabled = !ui.busy,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Ascii,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        LiveError(ui.error)
        Button(onClick = { vm.linkShop(code) }, enabled = !ui.busy, modifier = buttonModifier) {
            Text(if (ui.busy) "Linking..." else "Link shop")
        }
        TextButton(onClick = { vm.signOut() }, enabled = !ui.busy && !signingOut, modifier = buttonModifier) { SignOutLabel(signingOut) }
    }
}
