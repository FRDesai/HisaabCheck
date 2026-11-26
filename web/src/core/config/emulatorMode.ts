/**
 * Local "emulator mode" (development only): Auth, Firestore and Storage talk to the Firebase emulators, App Check is
 * skipped, and a dev-only test sign-in is offered. A production build can never turn it on: the caller also guards on
 * `import.meta.env.DEV`, which Vite replaces with `false` there, so the whole branch is dropped from the bundle.
 */
export const EMULATOR_PROJECT_ID = 'demo-hisaabcheck';
export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, storage: 9199 } as const; // as in firebase/firebase.json

/** Dummy web config: a `demo-` project id makes the emulators accept it without a real project. */
export const EMULATOR_APP_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: EMULATOR_PROJECT_ID,
  storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
  messagingSenderId: '0',
  appId: '1:0:web:0',
};

export function shouldUseEmulators(env: { DEV: boolean; VITE_USE_EMULATORS?: string }): boolean {
  return env.DEV === true && env.VITE_USE_EMULATORS === 'true';
}
