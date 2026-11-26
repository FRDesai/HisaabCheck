package com.hisaabcheck.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { HisaabCheckTheme { AppRoot((application as HisaabCheckApp).firebaseReady) } }
    }
}
