import { describe, expect, it } from 'vitest';
import { isIsoDate, istDate, istMonth, monthRange } from '../../src/core/dates';

describe('dates', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isIsoDate('2026-11-05')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('05-11-2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
  it('gives the IST calendar date and month', () => {
    expect(istDate(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11-01'); // 00:30 IST next day
    expect(istMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    expect(istDate(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10-31');
  });
  it('gives the first and last day of a month', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
