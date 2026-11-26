import { describe, expect, it } from 'vitest';
import { cacheActionOnSignIn } from '../../src/core/session/cacheOwner';

describe('cacheActionOnSignIn', () => {
  it('keeps the cache when the same user signs in again', () => {
    expect(cacheActionOnSignIn('uid-a', 'uid-a')).toBe('keep');
  });
  it('clears the cache when a different user signs in', () => {
    expect(cacheActionOnSignIn('uid-a', 'uid-b')).toBe('clear');
  });
  it('records the user when nothing is recorded yet', () => {
    expect(cacheActionOnSignIn(null, 'uid-a')).toBe('record');
  });
  it('treats an empty stored value as nothing recorded', () => {
    expect(cacheActionOnSignIn('', 'uid-a')).toBe('record');
  });
  it('is case sensitive, as uids are', () => {
    expect(cacheActionOnSignIn('uid-a', 'UID-A')).toBe('clear');
  });
  it('blocks a second automatic clear in the same page session, so a failed write cannot loop', () => {
    expect(cacheActionOnSignIn('uid-a', 'uid-b', true)).toBe('blocked');
  });
  it('still keeps and records after a reload has happened', () => {
    expect(cacheActionOnSignIn('uid-a', 'uid-a', true)).toBe('keep');
    expect(cacheActionOnSignIn(null, 'uid-a', true)).toBe('record');
  });
});
