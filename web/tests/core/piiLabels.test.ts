import { describe, it, expect } from 'vitest';
import { piiLabel } from '../../src/core/shield/piiLabels';

describe('piiLabel', () => {
  it('names POSSIBLE_ID for people', () => expect(piiLabel('POSSIBLE_ID')).toBe('Possible ID number'));
  it('names the other types', () => expect(['PAN', 'AADHAAR', 'BANK_ACCOUNT'].map(piiLabel)).toEqual(['PAN', 'Aadhaar', 'Bank account']));
  it('passes unknown strings through', () => {
    expect(piiLabel('GSTIN')).toBe('GSTIN');
    expect(piiLabel('toString')).toBe('toString');
  });
});
