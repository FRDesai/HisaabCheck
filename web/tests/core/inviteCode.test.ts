import { describe, it, expect } from 'vitest';
import { INVITE_ALPHABET, inviteCode } from '../../src/core/invite/code';

describe('inviteCode', () => {
  it('has 31 characters without I, L, O, 0, 1', () => {
    expect(INVITE_ALPHABET).toHaveLength(31);
    expect(INVITE_ALPHABET).not.toMatch(/[ILO01]/);
  });
  it('maps byte % 31 to the alphabet, deterministically', () => {
    expect(inviteCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]))).toBe('ABCDEFGH');
    expect(inviteCode(Uint8Array.from([30, 31, 32, 61, 62, 93, 100, 247]))).toBe('9AB9AAH9');
  });
  it('skips bytes of 248 or more', () => {
    expect(inviteCode(Uint8Array.from([255, 0, 248, 1, 249, 2, 250, 3, 251, 4, 252, 5, 253, 6, 254, 7]))).toBe('ABCDEFGH');
  });
  it('keeps only the first 8 usable characters', () => {
    expect(inviteCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe('ABCDEFGH');
  });
  it('is null with fewer than 8 usable bytes', () => {
    expect(inviteCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6]))).toBeNull();
    expect(inviteCode(Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 1, 2]))).toBeNull();
    expect(inviteCode(new Uint8Array(0))).toBeNull();
  });
  it('always matches the rules pattern', () => {
    for (let i = 0; i < 50; i++) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      const c = inviteCode(b);
      if (c) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    }
    expect(inviteCode(Uint8Array.from([0, 30, 61, 92, 123, 154, 185, 216]))).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
});
