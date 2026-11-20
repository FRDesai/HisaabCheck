import { describe, it, expect } from 'vitest';
import { toRouteLog, ROUTE_LOG_KEYS } from '../../src/core/router/routeLog';
import type { ProcessedBill } from '../../src/core/types';

const p: ProcessedBill = {
  status: 'draft', checks: null, redactedImage: new Blob(['x']),
  extraction: { supplierName: 'Ravi', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '1', invoiceDate: '2026-11-02', placeOfSupply: '', taxableValue: 1, cgst: 0, sgst: 0, igst: 0, total: 1, confidence: 1 },
  route: { path: 'cloud', reason: 'total_mismatch', confidence: 0.6, promptVersion: 'v1', modelName: 'gemini-3.1-flash-lite' },
  piiTypes: ['PAN'], piiMasked: 1, latencyMs: 4200, estCostUsd: 0.0003,
};

describe('toRouteLog', () => {
  it('contains only allowed keys and no bill content', () => {
    const log = toRouteLog(p, { billId: 'b1', shopId: 's1', caUid: 'u1' }, new Date('2026-11-20'));
    expect(Object.keys(log).sort()).toEqual([...ROUTE_LOG_KEYS].sort());
    const s = JSON.stringify(log);
    expect(s).not.toContain('29AAGCB7383J1Z4');
    expect(s).not.toContain('Ravi');
    expect(log).toMatchObject({ path: 'cloud', reason: 'total_mismatch', piiMasked: 1, piiTypes: ['PAN'], platform: 'web' });
  });
});
