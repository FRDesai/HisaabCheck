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
    expect(s).toMatchObject({ total: 4, device: 3, cloud: 1, readOnDevice: 2, manual: 1, devicePct: 50, piiTotal: 2, sentToCloud: 1, costUsd: 0.0003 });
    expect(s.reasons).toEqual({ passed: 2, total_mismatch: 1, user_kept_local: 1 });
    expect(s.piiByType).toEqual({ PAN: 1, PHONE: 1 });
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
  it('counts PII only for logs where an image was sent (estCostUsd > 0)', () => {
    const s = routeStats([
      log('a', 'device', 'user_kept_local', 1, ['PAN'], 0),
      log('b', 'device', 'cloud_error', 2, ['PHONE', 'PAN'], 0.0003),
      log('c', 'cloud', 'total_mismatch', 1, ['GSTIN'], 0.0003),
    ], 0.0003);
    expect(s).toMatchObject({ sentToCloud: 2, piiTotal: 3 });
    expect(s.piiByType).toEqual({ PHONE: 1, PAN: 1, GSTIN: 1 });
  });
  it('keeps readOnDevice + cloud + manual === total on a mixed sample', () => {
    const s = routeStats([
      log('a', 'device', 'passed'), log('b', 'cloud', 'x', 0, [], 0.0003), log('c', 'device', 'cloud_error', 0, [], 0.0003),
      log('d', 'device', 'redact_error'), log('e', 'device', 'passed'), log('f', 'cloud', 'cloud_only_mode', 0, [], 0.0003),
    ], 0.0003);
    expect(s.readOnDevice + s.cloud + s.manual).toBe(s.total);
    expect(s).toMatchObject({ readOnDevice: 2, cloud: 2, manual: 2, total: 6 });
  });
  it('treats logs without a billId as unique', () => {
    const noId = (reason: string) => ({ path: 'device', reason, piiMasked: 0, piiTypes: [], estCostUsd: 0 }) as never;
    expect(routeStats([noId('passed'), noId('passed'), log('a', 'device', 'passed'), log('a', 'device', 'passed')], 0.0003).total).toBe(3);
  });
});
