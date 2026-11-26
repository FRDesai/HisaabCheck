import { describe, expect, it } from 'vitest';
import { allowedActions, approvalBlockers, confirmationItems, failedChecks, needsConfirmation, taxableMismatch, validRejectNote } from '../../src/core/review/decision';
import { makeBill } from '../billFixtures';
import { runChecks } from '../../src/core/checks/checks';
import { parseConfig } from '../../src/core/config/parseConfig';
import { gstinCheckChar } from '../../src/core/shield/gstin';
import type { Extraction } from '../../src/core/types';

const ok = { total: true, gstin: true, taxSplit: true, date: true, required: true };

describe('allowedActions', () => {
  it('open bills can be edited, approved, rejected', () => {
    expect(allowedActions('draft')).toEqual(['edit', 'approve', 'reject']);
    expect(allowedActions('manual_entry')).toEqual(['edit', 'approve', 'reject']);
  });
  it('reviewed bills can only be reopened', () => {
    expect(allowedActions('approved')).toEqual(['reopen']);
    expect(allowedActions('rejected')).toEqual(['reopen']);
  });
});

describe('failedChecks', () => {
  it('lists failed checks in a fixed order', () => expect(failedChecks({ ...ok, date: false, total: false })).toEqual(['total', 'date']));
  it('treats missing checks as all failed', () => expect(failedChecks(null)).toEqual(['total', 'gstin', 'taxSplit', 'date', 'required']));
  it('is empty when all pass', () => expect(failedChecks(ok)).toEqual([]));
});

describe('approvalBlockers', () => {
  it('blocks on required and date only', () => {
    expect(approvalBlockers(ok)).toEqual([]);
    expect(approvalBlockers({ ...ok, total: false, gstin: false, taxSplit: false })).toEqual([]);
    expect(approvalBlockers({ ...ok, required: false })).toEqual(['required']);
    expect(approvalBlockers({ ...ok, date: false, required: false })).toEqual(['date', 'required']);
    expect(approvalBlockers(null)).toEqual(['date', 'required']);
  });
});

describe('needsConfirmation', () => {
  it('lists failed total, gstin, taxSplit', () => {
    expect(needsConfirmation(ok)).toEqual([]);
    expect(needsConfirmation({ ...ok, gstin: false, taxSplit: false, date: false })).toEqual(['gstin', 'taxSplit']);
    expect(needsConfirmation(null)).toEqual(['total', 'gstin', 'taxSplit']);
  });
});

describe('validRejectNote', () => {
  it('needs 1 to 500 characters after trimming', () => {
    expect(validRejectNote('')).toBe(false);
    expect(validRejectNote('   ')).toBe(false);
    expect(validRejectNote('Photo is blurred')).toBe(true);
    expect(validRejectNote('x'.repeat(500))).toBe(true);
    expect(validRejectNote('x'.repeat(501))).toBe(false);
  });
});

describe('taxableMismatch', () => {
  const ex = (over: Partial<Extraction>) => makeBill('t', { extraction: over }).extraction;
  const items = [{ description: 'Rice', hsn: '1006', qty: 1, rate: 100, amount: 100 }];
  it('is false when taxable value + tax = total', () => expect(taxableMismatch(ex({}))).toBe(false));
  it('catches a wrong stored taxable value even when the line items add up (probe: 90)', () => {
    const e = ex({ items, taxableValue: 90, supplierGstin: `29ABCDE1234F1Z${gstinCheckChar('29ABCDE1234F1Z')}` });
    expect(runChecks(e, parseConfig({}, true), new Date('2026-11-26T06:00:00Z')).checks).toEqual(ok); // the checks do not see it
    expect(taxableMismatch(e)).toBe(true);
  });
  it('derives a stored 0 as total - tax, so it passes (probe: 0)', () => {
    expect(taxableMismatch(ex({ items, taxableValue: 0 }))).toBe(false);
  });
  it('allows a gap of exactly 1 rupee and refuses anything over', () => {
    expect(taxableMismatch(ex({ taxableValue: 99 }))).toBe(false);
    expect(taxableMismatch(ex({ taxableValue: 101 }))).toBe(false);
    expect(taxableMismatch(ex({ taxableValue: 98.99 }))).toBe(true);
    expect(taxableMismatch(ex({ taxableValue: 101.01 }))).toBe(true);
  });
  it('is true when the derived taxable value is negative', () => {
    expect(taxableMismatch(ex({ taxableValue: 0, cgst: 80, sgst: 80, total: 118 }))).toBe(true);
  });
});

describe('confirmationItems', () => {
  const ex = (over: Partial<Extraction>) => makeBill('t', { extraction: over }).extraction;
  it('lists the failed soft checks, then taxable when it does not add up', () => {
    expect(confirmationItems(ok, ex({}))).toEqual([]);
    expect(confirmationItems({ ...ok, gstin: false }, ex({}))).toEqual(['gstin']);
    expect(confirmationItems(ok, ex({ taxableValue: 90 }))).toEqual(['taxable']);
    expect(confirmationItems({ ...ok, total: false, taxSplit: false, date: false }, ex({ taxableValue: 90 }))).toEqual(['total', 'taxSplit', 'taxable']);
  });
});
