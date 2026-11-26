package com.hisaabcheck.app.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.session.SessionViewModel

/** The Activity behind a Compose context, or null if there is none. */
internal fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/** An error line announced politely. The container stays in place so a new message is read out. */
@Composable
internal fun LiveError(message: String?) {
    Box(modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        if (message != null) Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    }
}

private val buttonModifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)

@Composable
fun SignInScreen(vm: SessionViewModel) {
    val ui by vm.ui.collectAsState()
    val context = LocalContext.current
    var phone by rememberSaveable { mutableStateOf("+91") }
    var code by rememberSaveable { mutableStateOf("") }

    fun send() {
        val activity = context.findActivity()
        if (activity == null) vm.showError("Could not open the phone check on this screen. Please close the app and open it again.")
        else vm.sendCode(activity, phone)
    }

    Column(
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Sign in", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        if (!ui.codeSent) {
            Text("Enter your phone number. We will send you an SMS with a 6-digit code.", style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.filter { ch -> ch.isDigit() || ch == '+' || ch == ' ' || ch == '-' }.take(20) },
                label = { Text("Phone number") },
                singleLine = true,
                isError = ui.error != null,
                enabled = !ui.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth(),
            )
            LiveError(ui.error)
            Button(onClick = { send() }, enabled = !ui.busy, modifier = buttonModifier) {
                Text(if (ui.busy) "Sending..." else "Send code")
            }
        } else {
            Text("We sent a 6-digit code by SMS to ${ui.phone}.", style = MaterialTheme.typography.bodyLarge)
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.filter { ch -> ch in '0'..'9' }.take(6) },
                label = { Text("6-digit code") },
                singleLine = true,
                isError = ui.error != null,
                enabled = !ui.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            LiveError(ui.error)
            Button(onClick = { vm.verifyCode(code) }, enabled = !ui.busy, modifier = buttonModifier) {
                Text(if (ui.busy) "Checking..." else "Verify")
            }
            TextButton(onClick = { send() }, enabled = !ui.busy, modifier = buttonModifier) { Text("Send code again") }
            TextButton(
                onClick = { code = ""; vm.changeNumber() },
                enabled = !ui.busy,
                modifier = buttonModifier,
            ) { Text("Use a different number") }
        }
    }
}
