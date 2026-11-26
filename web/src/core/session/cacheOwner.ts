/**
 * Decides what to do with the browser's offline Firestore cache when someone signs in.
 * `recorded` is the uid last stored as the cache's owner (null or empty when none is stored).
 * 'keep': same user, use the cache. 'record': nothing recorded, remember this user. 'clear': another user's
 * data may be cached, so wipe it before anything is shown.
 */
export type CacheAction = 'keep' | 'record' | 'clear';

export function cacheActionOnSignIn(recorded: string | null, signedInUid: string): CacheAction {
  if (!recorded) return 'record';
  return recorded === signedInUid ? 'keep' : 'clear';
}
