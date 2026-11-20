import { describe, it, expect } from 'vitest';
import { summarize, type AccuracyRow } from '../../src/core/accuracy/summary';

const sel = { scored: 0, skippedNoTruth: [], truthWithoutFile: [] };
const row = (o: Partial<AccuracyRow> = {}): AccuracyRow => ({
  file: 'a.jpg', status: 'ok', deviceOk: 7, deviceMs: 10, cloudOk: 7, cloudMs: 10, piiMasked: 2, piiLeft: 0, uncertain: false, ...o,
});

describe('summarize', () => {
  it('handles empty rows', () => {
    const s = summarize([], 7, sel);
    expect(s).toMatchObject({ devicePct: null, cloudPct: null, total: 0, leakChecked: 0, leakTotal: 0, leakedBills: 0, failed: 0, unsure: 0 });
  });
  it('device pct is null when no device rows ran', () => {
    const s = summarize([row({ deviceOk: null, deviceMs: null })], 7, sel);
    expect(s.devicePct).toBeNull();
    expect(s.deviceBills).toBe(0);
    expect(s.cloudPct).toBe(100);
  });
  it('averages mixed null/number device rows over non-null only', () => {
    const s = summarize([row({ deviceOk: 7 }), row({ deviceOk: null }), row({ deviceOk: 0 })], 7, sel);
    expect(s.deviceBills).toBe(2);
    expect(s.devicePct).toBe(50);
  });
  it('counts failed rows and excludes them from leakChecked', () => {
    const s = summarize([row(), row({ status: 'error', error: 'boom', piiLeft: null, deviceOk: null, cloudOk: null })], 7, sel);
    expect(s.failed).toBe(1);
    expect(s.leakChecked).toBe(1);
    expect(s.total).toBe(2);
  });
  it('counts a row with a failed call as failed', () => {
    const s = summarize([row({ cloudOk: null, cloudMs: null, error: 'cloud failed' })], 7, sel);
    expect(s.failed).toBe(1);
    expect(s.cloudPct).toBeNull();
  });
  it('all checked and zero leaks vs one unchecked bill', () => {
    const a = summarize([row(), row()], 7, sel);
    expect(a.leakChecked === a.total && a.total > 0 && a.leakTotal === 0).toBe(true);
    const b = summarize([row(), row({ piiLeft: null, status: 'error' })], 7, sel);
    expect(b.leakChecked).toBe(1);
    expect(b.leakChecked === b.total).toBe(false);
  });
  it('distinguishes leakedBills from leakTotal and counts unsure', () => {
    const s = summarize([row({ piiLeft: 3, uncertain: true }), row({ piiLeft: 1 }), row({ piiLeft: 0 })], 7, sel);
    expect(s.leakTotal).toBe(4);
    expect(s.leakedBills).toBe(2);
    expect(s.unsure).toBe(1);
  });
});
