import { describe, expect, it, vi } from 'vitest';
import { retryWithDelays } from '../../src/core/session/retry';

describe('retryWithDelays', () => {
  it('retries after each delay and stops at the first success', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const onDone = vi.fn();
    retryWithDelays(async () => { calls++; if (calls < 3) throw new Error('denied'); return 7; }, [1500, 5000], onDone);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(3);
    expect(onDone).toHaveBeenCalledWith(7);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
    vi.useRealTimers();
  });
  it('gives up after the last delay and never reports a value', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const onDone = vi.fn();
    retryWithDelays(async () => { calls++; throw new Error('denied'); }, [1500, 5000], onDone);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(3);
    expect(onDone).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('stops when cancelled, including a pending timer and a late answer', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const onDone = vi.fn();
    const cancel = retryWithDelays(async () => { calls++; throw new Error('denied'); }, [1500, 5000], onDone);
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('does not report a success that arrives after cancel', async () => {
    let resolve!: (n: number) => void;
    const onDone = vi.fn();
    const cancel = retryWithDelays(() => new Promise<number>((r) => { resolve = r; }), [1500], onDone);
    cancel();
    resolve(1);
    await Promise.resolve();
    expect(onDone).not.toHaveBeenCalled();
  });
});
