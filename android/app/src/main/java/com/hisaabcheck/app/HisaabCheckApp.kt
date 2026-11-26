package com.hisaabcheck.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck

class HisaabCheckApp : Application() {
    /** False when the app was built without google-services.json: then no Firebase call may run. */
    var firebaseReady: Boolean = false
        private set

    override fun onCreate() {
        super.onCreate()
        firebaseReady = FirebaseApp.getApps(this).isNotEmpty()
        if (firebaseReady) {
            // Debug builds get the debug provider, release builds Play Integrity (see src/debug and src/release).
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(appCheckProviderFactory())
        }
    }
}
