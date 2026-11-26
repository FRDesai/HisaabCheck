import { describe, expect, it } from 'vitest';
import { allowedActions, approvalBlockers, failedChecks, needsConfirmation, validRejectNote } from '../../src/core/review/decision';

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
