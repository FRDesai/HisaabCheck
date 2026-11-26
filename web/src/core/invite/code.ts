/** 31 characters: no I, L, O, 0 or 1, which are easy to misread. Must match the pattern in firebase/firestore.rules. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
// 248 = 8 * 31, the largest multiple of 31 that fits in a byte; bytes at or above it are skipped so every character is equally likely.
const LIMIT = 248;

/** An 8-character invite code from random bytes, or null if fewer than 8 usable bytes were given. */
export function inviteCode(bytes: Uint8Array): string | null {
  let out = '';
  for (const b of bytes) {
    if (b >= LIMIT) continue;
    out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
    if (out.length === LENGTH) return out;
  }
  return null;
}
