package com.hisaabcheck.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge-to-edge is enforced from Android 15; AppRoot insets its content once, at the top.
        enableEdgeToEdge()
        setContent { HisaabCheckTheme { AppRoot((application as HisaabCheckApp).firebaseReady) } }
    }
}
