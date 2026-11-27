/**
 * Decides what to do with the browser's offline Firestore cache when someone signs in.
 * `recorded` is the uid last stored as the cache's owner (null or empty when none is stored).
 * 'keep': same user, use the cache. 'record': nothing recorded, remember this user. 'clear': another user's
 * data may be cached, so wipe it before anything is shown.
 */
export type CacheAction = 'keep' | 'record' | 'clear' | 'blocked';

/**
 * `reloadedAlready` is true when this page session has already cleared and reloaded once. A second 'clear' is then
 * 'blocked': the caller signs the user out with a message instead of reloading for ever.
 */
export function cacheActionOnSignIn(recorded: string | null, signedInUid: string, reloadedAlready = false): CacheAction {
  if (!recorded) return 'record';
  if (recorded === signedInUid) return 'keep';
  return reloadedAlready ? 'blocked' : 'clear';
}

/**
 * Whether the once-per-tab reload flag is cleared at this point. Only the 'clear' action keeps it, because that is
 * the moment the one reload is started. When nobody is signed in, and after the blocked notice is shown, it is
 * cleared so a later sign-in by someone else tries the wipe again instead of being blocked untried.
 */
export const clearsReloadMark = (at: CacheAction | 'no-user'): boolean => at !== 'clear';
