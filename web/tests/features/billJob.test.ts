import { describe, it, expect } from 'vitest';
import { retryPatch, saveTarget } from '../../src/features/upload/billJob';

describe('cascade retry keeps the bill id', () => {
  it('a retry after a saved manual-entry bill keeps its billId and clears the rest', () => {
    const p = retryPatch({ billId: 'bill1' });
    expect(p).toEqual({ step: 'queued', error: undefined, result: undefined, sync: undefined, photo: undefined, billId: 'bill1' });
  });
  it('the re-run is saved under the same billId', () => {
    const job = { billId: 'bill1', ...retryPatch({ billId: 'bill1' }) };
    expect(saveTarget(job)).toBe('bill1');
  });
  it('a first run, or a retry of a run that never saved, gets a fresh id', () => {
    expect(saveTarget({})).toBeUndefined();
    expect(saveTarget({ ...retryPatch({}) })).toBeUndefined();
  });
});
