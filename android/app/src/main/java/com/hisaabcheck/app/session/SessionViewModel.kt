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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

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

    /** Set when a signed-in user's state could not be worked out (for example offline). State stays Loading; call [retry]. */
    private val _loadError = MutableStateFlow<String?>(null)
    val loadError: StateFlow<String?> = _loadError.asStateFlow()

    // Kept here so a rotation does not lose them. No Activity is kept.
    private var verificationId: String? = null
    private var resendToken: PhoneAuthProvider.ForceResendingToken? = null
    private var pendingPhone: String? = null

    private var resolveJob: Job? = null
    private var actionJob: Job? = null
    private var activeUid: String? = null

    private val authListener = FirebaseAuth.AuthStateListener { onUser(it.currentUser) }

    /** Holds no Activity or Composable. */
    private val callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
        override fun onVerificationCompleted(credential: PhoneAuthCredential) {
            signIn(credential, afterCode = false)
        }

        override fun onVerificationFailed(e: FirebaseException) {
            _ui.update { it.copy(busy = false, error = sendError(e)) }
        }

        override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
            verificationId = id
            resendToken = token
            _ui.update { it.copy(codeSent = true, phone = pendingPhone.orEmpty(), busy = false, error = null) }
        }
    }

    init {
        auth.addAuthStateListener(authListener)
    }

    override fun onCleared() {
        auth.removeAuthStateListener(authListener)
    }

    // ---- sign-in -------------------------------------------------------------------------------------------

    /** Sends the SMS code. [activity] is used for this call only (the SDK may open a reCAPTCHA page with it). */
    fun sendCode(activity: Activity, rawPhone: String) {
        if (_ui.value.busy) return
        val phone = rawPhone.filter { it != ' ' && it != '-' }
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
        try {
            PhoneAuthProvider.verifyPhoneNumber(builder.build())
        } catch (e: Exception) {
            _ui.update { it.copy(busy = false, error = "Could not send the code. Please try again.") }
        }
    }

    fun verifyCode(rawCode: String) {
        if (_ui.value.busy) return
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
        _ui.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                auth.signInWithCredential(credential).awaitTask()
                // The auth listener now moves the state on; the screen is replaced.
                _ui.update { it.copy(busy = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, error = if (afterCode) codeError(e) else sendError(e)) }
            }
        }
    }

    fun signOut() {
        actionJob?.cancel()
        auth.signOut() // the listener resets the state to SignedOut
    }

    // ---- consent and link ----------------------------------------------------------------------------------

    fun agree() {
        val s = _state.value as? SessionState.NeedsConsent ?: return
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try {
                store.recordConsent(s.uid)
                advance(s.uid)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(busy = false, error = consentError(e)) }
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
                _ui.update { it.copy(busy = false, error = linkError(e)) }
            }
        }
    }

    /** Try again after [loadError]. */
    fun retry() {
        val user = auth.currentUser ?: return
        resolve(user)
    }

    // ---- state machine -------------------------------------------------------------------------------------

    private fun onUser(user: FirebaseUser?) {
        if (user == null) {
            resolveJob?.cancel()
            actionJob?.cancel()
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
                val consent = store.ensureUser(uid, phone)
                if (consent != CONSENT_VERSION) {
                    _state.value = SessionState.NeedsConsent(uid)
                    _ui.update { SessionUi() }
                } else {
                    advance(uid)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _loadError.value = loadErrorText(e)
            }
        }
    }

    /** After consent: look for the linked shop and set the next state. */
    private suspend fun advance(uid: String) {
        val shop = store.findShop(uid)
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
