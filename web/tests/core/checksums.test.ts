import { describe, it, expect } from 'vitest';
import { isValidGstin, gstinCheckChar, gstinStateCode, placeOfSupplyCode } from '../../src/core/shield/gstin';
import { isValidVerhoeff } from '../../src/core/shield/verhoeff';

describe('GSTIN', () => {
  it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '07AAACR5055K1Z9', '33ABCDE1234F1Z7'])('accepts %s', (g) => {
    expect(isValidGstin(g)).toBe(true);
  });
  it.each(['29AAGCB7383J1Z5', '27AAPFU0939F1Z', '99AAPFU0939F1ZV', '27aapfu0939f1zv0'])('rejects %s', (g) => {
    expect(isValidGstin(g)).toBe(false);
  });
  it('computes the check character', () => expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V'));
  it('reads state code', () => expect(gstinStateCode('29AAGCB7383J1Z4')).toBe(29));
  it('parses place of supply', () => {
    expect(placeOfSupplyCode('29-Karnataka')).toBe(29);
    expect(placeOfSupplyCode(' 07 Delhi')).toBe(7);
    expect(placeOfSupplyCode('Karnataka')).toBeNull();
  });
});

describe('Verhoeff', () => {
  it.each(['234123412346', '498765432102', '567812345678'])('accepts %s', (d) => expect(isValidVerhoeff(d)).toBe(true));
  it.each(['234123412340', '234123412341'])('rejects %s', (d) => expect(isValidVerhoeff(d)).toBe(false));
});
