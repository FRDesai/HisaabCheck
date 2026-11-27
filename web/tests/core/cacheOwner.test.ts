import { describe, expect, it } from 'vitest';
import { cacheActionOnSignIn, clearsReloadMark } from '../../src/core/session/cacheOwner';

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

describe('clearsReloadMark', () => {
  it('clears the once-per-tab flag when nobody is signed in, after keep or record, and after the blocked notice', () => {
    expect(clearsReloadMark('no-user')).toBe(true);
    expect(clearsReloadMark('keep')).toBe(true);
    expect(clearsReloadMark('record')).toBe(true);
    expect(clearsReloadMark('blocked')).toBe(true);
  });
  it('keeps the flag only when a reload was just started for a wipe', () => {
    expect(clearsReloadMark('clear')).toBe(false);
  });
  it('lets a later different user try the wipe again after one interrupted reload', () => {
    // After an interrupted reload the flag is set, so a different user is blocked once...
    expect(cacheActionOnSignIn('uid-a', 'uid-b', true)).toBe('blocked');
    // ...and blocking clears the flag, so the next sign-in tries the wipe instead of being blocked untried.
    expect(clearsReloadMark('blocked')).toBe(true);
    expect(cacheActionOnSignIn('uid-a', 'uid-c', false)).toBe('clear');
  });
});
