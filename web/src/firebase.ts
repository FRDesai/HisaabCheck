import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getRemoteConfig } from 'firebase/remote-config';
import { DEFAULT_REMOTE_VALUES } from './core/config/defaults';

const env = import.meta.env;
export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});

if (env.VITE_APPCHECK_DEBUG === 'true') {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY), isTokenAutoRefreshEnabled: true });

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true, // extraction.items may be absent
});
export const storage = getStorage(app);
export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const rc = getRemoteConfig(app);
rc.settings.minimumFetchIntervalMillis = 30_000;
rc.defaultConfig = DEFAULT_REMOTE_VALUES;
