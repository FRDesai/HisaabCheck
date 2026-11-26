import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../src/core/config/parseConfig';

describe('parseConfig', () => {
  it('uses bundled defaults for an empty map', () => {
    expect(parseConfig({}, false)).toEqual({
      routingMode: 'smart', confidenceThreshold: 0.8, consentOcrThreshold: 0.6,
      totalToleranceInr: 1, maxDeviceLineItems: 10, cloudModel: 'gemini-3.5-flash-lite',
      extractionPromptVersion: 'v1', maskPii: true,
    });
  });
  it('reads valid overrides', () => {
    const c = parseConfig({ routing_mode: 'device_only', confidence_threshold: '0.7', max_device_line_items: '5' }, false);
    expect(c.routingMode).toBe('device_only');
    expect(c.confidenceThreshold).toBe(0.7);
    expect(c.maxDeviceLineItems).toBe(5);
  });
  it('falls back per key on invalid values', () => {
    const c = parseConfig({ routing_mode: 'yolo', confidence_threshold: '7', total_tolerance_inr: 'abc' }, false);
    expect(c.routingMode).toBe('smart');
    expect(c.confidenceThreshold).toBe(0.8);
    expect(c.totalToleranceInr).toBe(1);
  });
  it('allows mask_pii=false only outside prod', () => {
    expect(parseConfig({ mask_pii: 'false' }, false).maskPii).toBe(false);
    expect(parseConfig({ mask_pii: 'false' }, true).maskPii).toBe(true);
  });
});
