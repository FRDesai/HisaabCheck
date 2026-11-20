import { describe, it, expect } from 'vitest';
import { routeStats } from '../../src/core/stats/routeStats';

const log = (billId: string, path: 'device' | 'cloud', reason: string, piiMasked = 0, piiTypes: string[] = [], estCostUsd = 0) =>
  ({ billId, path, reason, piiMasked, piiTypes, estCostUsd }) as never;

describe('routeStats', () => {
  it('aggregates paths, reasons, PII and cost saved', () => {
    const s = routeStats([
      log('a', 'device', 'passed'),
      log('b', 'device', 'passed'),
      log('c', 'cloud', 'total_mismatch', 2, ['PAN', 'PHONE'], 0.0003),
      log('d', 'device', 'user_kept_local', 1, ['PAN']),
    ], 0.0003);
    expect(s).toMatchObject({ total: 4, device: 3, cloud: 1, readOnDevice: 2, manual: 1, devicePct: 50, piiTotal: 3, costUsd: 0.0003 });
    expect(s.reasons).toEqual({ passed: 2, total_mismatch: 1, user_kept_local: 1 });
    expect(s.piiByType).toEqual({ PAN: 2, PHONE: 1 });
    expect(s.savedUsd).toBeCloseTo(0.0009);
  });
  it('handles no logs', () => expect(routeStats([], 0.0003)).toMatchObject({ total: 0, devicePct: 0, readOnDevice: 0, manual: 0 }));
  it('counts device logs with non-passed reasons as manual, not read on device', () => {
    const s = routeStats([log('a', 'device', 'ocr_error'), log('b', 'device', 'no_device_model'), log('c', 'device', 'passed')], 0.0003);
    expect(s).toMatchObject({ readOnDevice: 1, manual: 2, device: 3, devicePct: 33 });
  });
  it('de-duplicates by billId keeping the first occurrence', () => {
    const s = routeStats([log('a', 'device', 'passed'), log('a', 'cloud', 'total_mismatch', 1, ['PAN'], 0.0003), log('b', 'device', 'passed')], 0.0003);
    expect(s).toMatchObject({ total: 2, device: 2, cloud: 0, piiTotal: 0, costUsd: 0 });
  });
  it('sums cost on failed-cloud device logs and never shows negative savings', () => {
    const s = routeStats([log('a', 'device', 'cloud_error', 0, [], 0.0003), log('b', 'cloud', 'x', 0, [], 0.0009)], 0.0003);
    expect(s.costUsd).toBeCloseTo(0.0012);
    expect(s.savedUsd).toBe(0);
  });
});
