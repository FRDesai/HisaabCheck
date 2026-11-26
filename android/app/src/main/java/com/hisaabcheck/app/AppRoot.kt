package com.hisaabcheck.app

import androidx.compose.foundation.isSystemInDarkTheme
import android.app.Activity
import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hisaabcheck.app.bill.BillScreen
import com.hisaabcheck.app.bill.BillViewModel
import com.hisaabcheck.app.session.SessionState
import com.hisaabcheck.app.session.SessionViewModel
import com.hisaabcheck.app.ui.ConsentScreen
import com.hisaabcheck.app.ui.HomeScreen
import com.hisaabcheck.app.ui.LinkShopScreen
import com.hisaabcheck.app.ui.PreviewScreen
import com.hisaabcheck.app.ui.ProcessingScreen
import com.hisaabcheck.app.ui.ResultScreen
import com.hisaabcheck.app.ui.SignInScreen
import com.hisaabcheck.core.ConsentResult
import androidx.compose.ui.unit.dp

@Composable
fun HisaabCheckTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme(), content = content)
}

@Composable
fun AppRoot(firebaseReady: Boolean) {
    Surface(modifier = Modifier.fillMaxSize()) {
        // The background runs under the system bars; every screen's content is kept clear of the status bar,
        // navigation bar, display cutout and keyboard here, once. The padding consumes those insets, so a screen's own
        // imePadding() adds nothing on top of it.
        Box(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
            if (!firebaseReady) {
                // SessionViewModel is never created here: its constructor calls FirebaseAuth.getInstance().
                Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = "Firebase is not set up. Add google-services.json and rebuild.",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            } else {
                SessionRoot()
            }
        }
    }
}

@Composable
private fun SessionRoot() {
    // Activity-scoped (default owner), so it survives rotation.
    val vm: SessionViewModel = viewModel()
    val state by vm.state.collectAsState()
    val loadError by vm.loadError.collectAsState()
    when (val s = state) {
        SessionState.Loading -> LoadingScreen(loadError, onRetry = vm::retry, onSignOut = vm::signOut)
        SessionState.SignedOut -> SignInScreen(vm)
        is SessionState.NeedsConsent -> ConsentScreen(vm)
        is SessionState.NeedsShop -> LinkShopScreen(vm)
        is SessionState.Ready -> BillRoot(s.shop, onSignOut = vm::signOut)
    }
}

@Composable
private fun LoadingScreen(loadError: String?, onRetry: () -> Unit, onSignOut: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (loadError == null) {
            CircularProgressIndicator()
        } else {
            Text(loadError, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
            Button(onClick = onRetry) { Text("Try again") }
            OutlinedButton(onClick = onSignOut) { Text("Sign out") }
        }
    }
}

@Composable
private fun BillRoot(shop: Shop, onSignOut: () -> Unit) {
    val context = LocalContext.current
    val application = context.applicationContext as Application
    // The key matters: a later sign-in to another shop must not reuse a view model that holds this shop.
    val vm: BillViewModel = viewModel(key = "bill-${shop.id}", factory = BillViewModel.Factory(shop, application))
    val screen by vm.screen.collectAsState()

    // Entering starts "Recent bills" (a no-op if it is already running, as after a rotation).
    // Whenever the session leaves Ready (sign-out or otherwise) the bill stops, the photo is dropped and the listener is
    // removed. A rotation also leaves composition, but the activity is only being recreated: keep the running bill then.
    DisposableEffect(vm) {
        vm.startRecent()
        onDispose {
            if ((context as? Activity)?.isChangingConfigurations != true) {
                vm.done()
                vm.stopRecent()
            }
        }
    }

    val signOut = {
        vm.done()
        onSignOut()
    }

    when (val sc = screen) {
        is BillScreen.Home, is BillScreen.Failed -> {
            if (sc is BillScreen.Failed) BackHandler { vm.done() }
            HomeScreen(vm, shop.shopName, onSignOut = signOut)
        }
        is BillScreen.Processing -> {
            BackHandler { vm.done() }
            ProcessingScreen(sc.step)
        }
        // The preview handles its own Back (it means Keep). Only the redacted image goes in.
        is BillScreen.Preview -> PreviewScreen(
            redacted = sc.redacted,
            onSend = { vm.onConsent(ConsentResult.Send(it)) },
            onKeep = { vm.onConsent(ConsentResult.Keep) },
        )
        is BillScreen.Result -> {
            BackHandler { vm.done() }
            ResultScreen(vm, sc)
        }
    }
}
