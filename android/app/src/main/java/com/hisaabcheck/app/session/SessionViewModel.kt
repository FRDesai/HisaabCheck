package com.hisaabcheck.app.session

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import com.google.firebase.firestore.firestore
import com.google.firebase.Firebase
import com.hisaabcheck.app.Shop
import com.hisaabcheck.app.adapters.CONSENT_VERSION
import com.hisaabcheck.app.adapters.SessionException
import com.hisaabcheck.app.adapters.SessionFailure
import com.hisaabcheck.app.adapters.SessionStore
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

private const val PENDING_WAIT_MS = 5_000L
private const val WIPE_STEP_MS = 5_000L

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class NeedsConsent(val uid: String) : SessionState
    data class NeedsShop(val uid: String) : SessionState
    data class Ready(val uid: String, val shop: Shop) : SessionState
}

/** What the current session screen shows besides [SessionState]: sign-in step, busy flag and the error line. */
data class SessionUi(
    val codeSent: Boolean = false,
    /** The number the code was sent to, as typed; shown on the code step. */
    val phone: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

class SessionViewModel(private val store: SessionStore = SessionStore()) : ViewModel() {
    private val auth get() = FirebaseAuth.getInstance()

    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    private val _ui = MutableStateFlow(SessionUi())
    val ui: StateFlow<SessionUi> = _ui.asStateFlow()

    /**
     * Non-null when a signed-in user's state could not be worked out (for example offline). [state] then stays
     * [SessionState.Loading]. The wiring MUST, while state is Loading and this is non-null, render: the message,
     * a "Try again" button calling [retry], and a "Sign out" button calling [signOut]. Otherwise the owner is stuck.
     */
    private val _loadError = MutableStateFlow<String?>(null)
    val loadError: StateFlow<String?> = _loadError.asStateFlow()

    // Kept here so a rotation does not lose them. No Activity is kept.
    private var verificationId: String? = null
    private var resendToken: PhoneAuthProvider.ForceResendingToken? = null
    private var pendingPhone: String? = null

    private var resolveJob: Job? = null
    private var actionJob: Job? = null
    private var signInJob: Job? = null
    private var watchdog: Job? = null
    private var activeUid: String? = null

    /** Wipes Firestore's on-device cache after the session ends. Work for the next user waits for it, up to its timeouts. */
    private var clearJob: Job? = null
    /** True from the moment the session has ended (or the app starts signed out) until the wipe has been started. */
    private var wipePending = false
    private var signOutJob: Job? = null

    private val _confirmSignOut = MutableStateFlow(false)
    /**
     * True when changes made offline have not been sent and the owner must choose. The wiring shows "Some changes have not
     * been sent yet because you are offline. If you sign out now they will be lost." with "Stay signed in" (calls
     * [cancelSignOut]) and "Sign out anyway" (calls [confirmSignOut]).
     */
    val confirmSignOut: StateFlow<Boolean> = _confirmSignOut.asStateFlow()

    private val authListener = FirebaseAuth.AuthStateListener { onUser(it.currentUser) }

    /** Holds no Activity or Composable. */
    private val callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
        override fun onVerificationCompleted(credential: PhoneAuthCredential) {
            watchdog?.cancel()
            if (_state.value !is SessionState.SignedOut) return
            signIn(credential, afterCode = false)
        }

        override fun onVerificationFailed(e: FirebaseException) {
            watchdog?.cancel()
            _ui.update { it.copy(busy = false, error = sendError(e)) }
        }

        override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
            watchdog?.cancel()
            verificationId = id
            resendToken = token
            _ui.update { it.copy(codeSent = true, phone = pendingPhone.orEmpty(), busy = false, error = null) }
        }
    }

    init {
        auth.addAuthStateListener(authListener)
        // A process that died between sign-out and the wipe must not leave the last owner's cache for the next one.
        if (auth.currentUser == null) wipePending = true
    }

    override fun onCleared() {
        watchdog?.cancel()
        auth.removeAuthStateListener(authListener)
    }

    // ---- sign-in -------------------------------------------------------------------------------------------

    /** Sends the SMS code. [activity] is used for this call only (the SDK may open a reCAPTCHA page with it). */
    fun sendCode(activity: Activity, rawPhone: String) {
        if (_ui.value.busy) return
        var phone = rawPhone.filter { it != ' ' && it != '-' }
        if (phone.startsWith("+910")) phone = "+91" + phone.substring(4) // a trunk zero typed after +91
        if (!Regex("^\\+[1-9][0-9]{7,14}$").matches(phone)) {
            _ui.update { it.copy(error = "Enter the number with the country code, like +91 98765 43210.") }
            return
        }
        // Reuse the resend token only when the number is unchanged.
        val token = if (phone == pendingPhone) resendToken else null
        pendingPhone = phone
        _ui.update { it.copy(busy = true, error = null) }
        val builder = PhoneAuthOptions.newBuilder(auth)
            .setPhoneNumber(phone)
            .setTimeout(60L, TimeUnit.SECONDS)
            .setActivity(activity)
            .setCallbacks(callbacks)
        if (token != null) builder.setForceResendingToken(token)
        // If no callback ever arrives (Activity stopped, reCAPTCHA page abandoned), do not leave the owner stuck.
        watchdog?.cancel()
        watchdog = viewModelScope.launch {
            delay(70_000)
            _ui.update {
                if (it.busy) it.copy(busy = false, error = "That took too long. Check your connection and try again.") else it
            }
        }
        try {
            PhoneAuthProvider.verifyPhoneNumber(builder.build())
        } catch (e: Exception) {
            watchdog?.cancel()
            _ui.update { it.copy(busy = false, error = "Could not send the code. Please try again.") }
        }
    }

    fun verifyCode(rawCode: String) {
        if (_ui.value.busy || signInJob?.isActive == true) return
        val code = rawCode.trim()
        val id = verificationId
        if (code.length != 6 || !code.all { it in '0'..'9' }) {
            _ui.update { it.copy(error = "Enter the 6 digits from the SMS.") }
            return
        }
        if (id == null) {
            _ui.update { it.copy(codeSent = false, error = "Please ask for a new code.") }
            return
        }
        signIn(PhoneAuthProvider.getCredential(id, code), afterCode = true)
    }

    /** Back to the number step, keeping nothing of the old verification. */
    fun changeNumber() {
        verificationId = null
        resendToken = null
        pendingPhone = null
        _ui.update { SessionUi() }
    }

    /** For screens to show a plain error, for example when no Activity is available. */
    fun showError(message: String) {
        _ui.update { it.copy(error = message) }
    }

    private fun signIn(credential: PhoneAuthCredential, afterCode: Boolean) {
        if (signInJob?.isActive == true) return // one sign-in at a time
        _ui.update { it.copy(busy = true, error = null) }
        signInJob = viewModelScope.launch {
            try {
                awaitWipe()
                auth.signInWithCredential(credential).awaitTask()
                // The auth listener now moves the state on; the screen is replaced.
                _ui.update { it.copy(busy = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ensureActive()
                if (_state.value !is SessionState.SignedOut) return@launch // a late failure must not land on a later screen
                _ui.update { it.copy(busy = false, error = if (afterCode) codeError(e) else sendError(e)) }
            }
        }
    }

    /**
     * Signs out. Changes made offline and not yet sent would be lost with the cache, so this first waits up to 5 seconds
     * for them; if they are still pending it signs nobody out and sets [confirmSignOut] instead.
     */
    fun signOut() {
        if (signOutJob?.isActive == true) return
        signOutJob = viewModelScope.launch {
            val settled = withTimeoutOrNull(PENDING_WAIT_MS) {
                try { Firebase.firestore.waitForPendingWrites().awaitTask(); true } catch (e: CancellationException) { throw e } catch (e: Exception) { false }
            } ?: false
            if (settled) endSession() else _confirmSignOut.value = true
        }
    }

    /** "Sign out anyway": pending changes are given up. */
    fun confirmSignOut() {
        _confirmSignOut.value = false
        endSession()
    }

    /** "Stay signed in". */
    fun cancelSignOut() {
        _confirmSignOut.value = false
    }

    private fun endSession() {
        actionJob?.cancel()
        signInJob?.cancel()
        auth.signOut() // the listener resets the state to SignedOut and marks the wipe as pending
    }

    /**
     * The wiring calls this when the signed-out screen is on screen. Compose has by then removed the screens of the old
     * session (and run their dispose effects, which stop the "Recent bills" listener), so nothing listens on the
     * Firestore instance that is about to be terminated. Safe to call many times.
     */
    fun onSignedOutShown() = startWipeIfPending()

    private fun startWipeIfPending() {
        if (!wipePending) return
        wipePending = false
        val previous = clearJob
        clearJob = viewModelScope.launch {
            previous?.join()
            // Each step is bounded; a failed or timed-out wipe must not keep the next owner from signing in.
            try {
                val db = Firebase.firestore
                val stopped = withTimeoutOrNull(WIPE_STEP_MS) { db.terminate().awaitTask(); true } ?: false
                if (stopped) withTimeoutOrNull(WIPE_STEP_MS) { db.clearPersistence().awaitTask() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Nothing more can be done here; the next session end or start tries again.
            }
        }
    }

    /** Work for a new session starts only after the wipe of the last one (bounded), however the last one ended. */
    private suspend fun awaitWipe() {
        startWipeIfPending()
        clearJob?.join()
    }

    // ---- consent and link ----------------------------------------------------------------------------------

    fun agree() {
        val s = _state.value as? SessionState.NeedsConsent ?: return
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try {
                store.recordConsent(s.uid)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ensureActive()
                _ui.update { it.copy(busy = false, error = consentError(e)) }
                return@launch
            }
            // Consent is saved. A failure from here on is a load problem, not a consent problem.
            try {
                advance(s.uid)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ensureActive()
                _state.value = SessionState.Loading
                _ui.update { SessionUi() }
                _loadError.value = loadErrorText(e)
            }
        }
    }

    fun linkShop(rawCode: String) {
        val s = _state.value as? SessionState.NeedsShop ?: return
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try {
                val shop = store.linkShop(s.uid, rawCode)
                _state.value = SessionState.Ready(s.uid, shop)
                _ui.update { it.copy(busy = false, error = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ensureActive()
                _ui.update { it.copy(busy = false, error = linkError(e)) }
            }
        }
    }

    /** Try again after [loadError]: works the signed-in user's state out again. See [loadError] for what the wiring must show. */
    fun retry() {
        val user = auth.currentUser ?: return
        resolve(user)
    }

    // ---- state machine -------------------------------------------------------------------------------------

    private fun onUser(user: FirebaseUser?) {
        if (user == null) {
            resolveJob?.cancel()
            actionJob?.cancel()
            if (activeUid != null) wipePending = true // a signed-in user went away, however it happened
            activeUid = null
            _loadError.value = null
            _state.value = SessionState.SignedOut
            _ui.update { SessionUi() }
            verificationId = null
            resendToken = null
            pendingPhone = null
            return
        }
        if (user.uid == activeUid) return // same user, nothing new to work out
        activeUid = user.uid
        resolve(user)
    }

    private fun resolve(user: FirebaseUser) {
        val uid = user.uid
        val phone = user.phoneNumber.orEmpty()
        resolveJob?.cancel()
        _state.value = SessionState.Loading
        _loadError.value = null
        resolveJob = viewModelScope.launch {
            try {
                awaitWipe()
                val consent = store.ensureUser(uid, phone)
                ensureActive()
                if (consent != CONSENT_VERSION) {
                    _state.value = SessionState.NeedsConsent(uid)
                    _ui.update { SessionUi() }
                } else {
                    advance(uid)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ensureActive() // a cancelled or superseded job must not write state
                _loadError.value = loadErrorText(e)
            }
        }
    }

    /** After consent: look for the linked shop and set the next state. */
    private suspend fun advance(uid: String) {
        val shop = store.findShop(uid)
        currentCoroutineContext().ensureActive()
        _state.value = if (shop == null) SessionState.NeedsShop(uid) else SessionState.Ready(uid, shop)
        _ui.update { SessionUi() }
    }

    // ---- plain-words errors (no values are included) -------------------------------------------------------

    private fun sendError(e: Exception): String = when (e) {
        is FirebaseAuthInvalidCredentialsException ->
            "That phone number does not look right. Enter it with the country code, like +91 98765 43210."
        is FirebaseTooManyRequestsException -> "Too many attempts. Please wait a while and try again."
        is FirebaseNetworkException -> "No connection. Check your internet and try again."
        else -> "Could not send the code. Please try again."
    }

    private fun codeError(e: Exception): String = when {
        e is FirebaseAuthInvalidCredentialsException && e.errorCode == "ERROR_SESSION_EXPIRED" ->
            "That code has expired. Tap Send code again for a new one."
        e is FirebaseAuthInvalidCredentialsException -> "That code is not right. Check the SMS and try again."
        e is FirebaseTooManyRequestsException -> "Too many attempts. Please wait a while and try again."
        e is FirebaseNetworkException -> "No connection. Check your internet and try again."
        else -> "Could not sign you in. Please try again."
    }

    private fun consentError(e: Exception): String =
        if ((e as? SessionException)?.failure == SessionFailure.NoConnection)
            "No connection. Check your internet and try again."
        else "Could not save your consent. Please try again."

    private fun linkError(e: Exception): String = when ((e as? SessionException)?.failure) {
        SessionFailure.BadCodeFormat -> "That code does not look right. It has 8 letters and numbers."
        SessionFailure.UnknownCode -> "We could not find that code. Check it with your CA and try again."
        SessionFailure.CodeNoLongerWorks -> "This code no longer works. Ask your CA for a new code."
        SessionFailure.AlreadyUsed -> "This code has already been used or is more than 7 days old. Ask your CA for a new code."
        SessionFailure.NoConnection -> "No connection. Check your internet and try again."
        else -> "Could not link your shop. Please try again."
    }

    private fun loadErrorText(e: Exception): String =
        if ((e as? SessionException)?.failure == SessionFailure.NoConnection)
            "No connection. Check your internet and try again."
        else "Could not load your account. Please try again."
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
