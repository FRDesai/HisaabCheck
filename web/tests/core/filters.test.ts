import { describe, expect, it } from 'vitest';
import { billMonth, countsByFilter, filterBills, hasFailedCheck, monthsOf, nextToReview } from '../../src/core/review/filters';
import { makeBill } from '../billFixtures';

const failing = { total: false, gstin: true, taxSplit: true, date: true, required: true };
const bills = [
  makeBill('d1'),                                                                 // draft, passing, Nov
  makeBill('d2', { checks: failing }),                                             // draft, failed check, Nov
  makeBill('m1', { status: 'manual_entry', checks: null, extraction: { invoiceDate: '' }, createdAt: new Date('2026-10-31T19:00:00Z') }), // IST 1 Nov
  makeBill('a1', { status: 'approved', extraction: { invoiceDate: '2026-10-20' } }),
  makeBill('a2', { status: 'approved', checks: failing }),
  makeBill('r1', { status: 'rejected', rejectNote: 'blurred', extraction: { invoiceDate: '2026-10-02' } }),
];
const ids = (b: { id: string }[]) => b.map((x) => x.id);

describe('filterBills', () => {
  it('to_review = draft and manual entry', () => expect(ids(filterBills(bills, 'to_review', null))).toEqual(['d1', 'd2', 'm1']));
  it('failed_checks = open bills with a failed or missing check', () => expect(ids(filterBills(bills, 'failed_checks', null))).toEqual(['d2', 'm1']));
  it('manual_entry', () => expect(ids(filterBills(bills, 'manual_entry', null))).toEqual(['m1']));
  it('approved and rejected', () => {
    expect(ids(filterBills(bills, 'approved', null))).toEqual(['a1', 'a2']);
    expect(ids(filterBills(bills, 'rejected', null))).toEqual(['r1']);
  });
  it('all keeps the given order', () => expect(ids(filterBills(bills, 'all', null))).toEqual(['d1', 'd2', 'm1', 'a1', 'a2', 'r1']));
  it('month narrows by invoice month', () => {
    expect(ids(filterBills(bills, 'all', '2026-10'))).toEqual(['a1', 'r1']);
    expect(ids(filterBills(bills, 'approved', '2026-11'))).toEqual(['a2']);
  });
});

describe('billMonth', () => {
  it('uses the invoice date when valid', () => expect(billMonth(makeBill('x'))).toBe('2026-11'));
  it('falls back to the IST month the bill was created', () => expect(billMonth(bills[2])).toBe('2026-11'));
  it('is null with neither', () => expect(billMonth(makeBill('x', { extraction: { invoiceDate: '31/12' }, createdAt: null }))).toBeNull());
});

describe('monthsOf', () => {
  it('lists distinct months, newest first', () => expect(monthsOf(bills)).toEqual(['2026-11', '2026-10']));
  it('is empty for no bills', () => expect(monthsOf([])).toEqual([]));
});

describe('countsByFilter', () => {
  it('counts every filter', () => expect(countsByFilter(bills, null)).toEqual({ to_review: 3, failed_checks: 2, manual_entry: 1, approved: 2, rejected: 1, all: 6 }));
  it('respects the month', () => expect(countsByFilter(bills, '2026-10')).toEqual({ to_review: 0, failed_checks: 0, manual_entry: 0, approved: 1, rejected: 1, all: 2 }));
});

describe('hasFailedCheck', () => {
  it('is true for null checks or any false check', () => {
    expect(hasFailedCheck(makeBill('x'))).toBe(false);
    expect(hasFailedCheck(makeBill('x', { checks: null }))).toBe(true);
    expect(hasFailedCheck(makeBill('x', { checks: failing }))).toBe(true);
  });
});

describe('nextToReview', () => {
  it('picks the next open bill after the current one', () => expect(nextToReview(bills, 'd1')).toBe('d2'));
  it('skips reviewed bills', () => expect(nextToReview(bills, 'd2')).toBe('m1'));
  it('wraps to an earlier open bill', () => expect(nextToReview(bills, 'm1')).toBe('d1'));
  it('never returns the current bill', () => expect(nextToReview([makeBill('only')], 'only')).toBeNull());
  it('starts from the top when the current bill is not in the list', () => expect(nextToReview(bills, 'zzz')).toBe('d1'));
  it('is null when nothing is open', () => expect(nextToReview([bills[3], bills[5]], 'a1')).toBeNull());
});
