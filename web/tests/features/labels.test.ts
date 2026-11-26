import { describe, expect, it } from 'vitest';
import { badgeText, badgeTone, CHECK_MSG, FIELD_CHECK, FIELDS, REASON } from '../../src/features/result/labels';

describe('labels', () => {
  it('badge text follows the route', () => {
    expect(badgeText({ path: 'device', reason: 'passed' })).toBe('Read on device');
    expect(badgeText({ path: 'cloud', reason: 'total_mismatch' })).toBe('Checked in cloud: total mismatch');
    expect(badgeText({ path: 'device', reason: 'cloud_error' })).toBe('Manual entry: cloud unavailable');
    expect(badgeText(null)).toBe('Manual entry');
  });
  it('badge tone is green for device, blue for cloud, amber otherwise', () => {
    expect(badgeTone({ path: 'device', reason: 'passed' })).toBe('bg-emerald-100 text-emerald-900');
    expect(badgeTone({ path: 'cloud', reason: 'low_confidence' })).toBe('bg-sky-100 text-sky-900');
    expect(badgeTone({ path: 'device', reason: 'ocr_error' })).toBe('bg-amber-100 text-amber-900');
    expect(badgeTone(null)).toBe('bg-amber-100 text-amber-900');
  });
  it('covers the ten fields and five checks', () => {
    expect(FIELDS.map(([k]) => k)).toEqual(['supplierName', 'supplierGstin', 'invoiceNo', 'invoiceDate', 'placeOfSupply', 'taxableValue', 'cgst', 'sgst', 'igst', 'total']);
    expect(Object.keys(CHECK_MSG).sort()).toEqual(['date', 'gstin', 'required', 'taxSplit', 'total']);
    expect(FIELD_CHECK.supplierGstin).toBe('gstin');
    expect(REASON.redact_error).toBe('could not hide private numbers safely');
  });
});
