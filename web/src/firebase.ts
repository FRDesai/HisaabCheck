import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getRemoteConfig } from 'firebase/remote-config';
import { DEFAULT_REMOTE_VALUES } from './core/config/defaults';
import { EMULATOR_APP_CONFIG, EMULATOR_HOST, EMULATOR_PORTS, shouldUseEmulators } from './core/config/emulatorMode';

const env = import.meta.env;
/** Dev only (see core/config/emulatorMode.ts). `import.meta.env.DEV` is `false` in a production build, so this is too. */
export const USE_EMULATORS = import.meta.env.DEV && shouldUseEmulators(env);

export const app = initializeApp(USE_EMULATORS ? EMULATOR_APP_CONFIG : {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});

if (env.VITE_APPCHECK_DEBUG === 'true' && !env.PROD) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
// The emulators need no App Check token, and there is no reCAPTCHA key locally.
if (!USE_EMULATORS) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true, // extraction.items may be absent
});
export const storage = getStorage(app);
if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`);
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage);
}
// Remote Config and AI Logic have no emulator: in emulator mode Remote Config falls back to the bundled defaults and
// every cloud AI call fails (the bill becomes manual entry).
export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const rc = getRemoteConfig(app);
rc.settings.minimumFetchIntervalMillis = 30_000;
rc.settings.fetchTimeoutMillis = 3000; // config is loaded before every bill; the SDK default is 60 s
rc.defaultConfig = DEFAULT_REMOTE_VALUES;
