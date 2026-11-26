import { billAmounts } from '../export/rows';
import type { BillStatus, Checks, Extraction } from '../types';

export type ReviewAction = 'edit' | 'approve' | 'reject' | 'reopen';
const CHECK_ORDER: readonly (keyof Checks)[] = ['total', 'gstin', 'taxSplit', 'date', 'required'];
export const REJECT_NOTE_MAX = 500;

export function allowedActions(status: BillStatus): ReviewAction[] {
  return status === 'draft' || status === 'manual_entry' ? ['edit', 'approve', 'reject'] : ['reopen'];
}

/** Failed checks in a fixed order. Missing checks (null) count as all failed. */
export function failedChecks(checks: Checks | null): (keyof Checks)[] {
  return CHECK_ORDER.filter((k) => !checks || !checks[k]);
}

/** Checks that must pass before a bill can be approved: an approved bill must be exportable by date. */
export function approvalBlockers(checks: Checks | null): Array<'date' | 'required'> {
  return failedChecks(checks).filter((k): k is 'date' | 'required' => k === 'date' || k === 'required');
}

/** Failed checks the CA may override by confirming the bill against the paper copy. */
export function needsConfirmation(checks: Checks | null): Array<'total' | 'gstin' | 'taxSplit'> {
  return failedChecks(checks).filter((k): k is 'total' | 'gstin' | 'taxSplit' => k === 'total' || k === 'gstin' || k === 'taxSplit');
}

/** A gap up to ₹1 is rounding; the exports book it to Round Off. */
export const MAX_ROUND_OFF_PAISE = 100;

/**
 * True when the taxable value both exports use does not add up: total - taxable - tax is more than ₹1,
 * or the derived taxable value is negative. The checks compare line items with the total when a bill has
 * them, so this catches a wrong taxable value they do not see.
 */
export function taxableMismatch(e: Extraction): boolean {
  const a = billAmounts(e);
  return a.taxable < 0 || Math.abs(a.roundOff) > MAX_ROUND_OFF_PAISE;
}

export type ConfirmItem = 'total' | 'gstin' | 'taxSplit' | 'taxable';
/** Everything the CA must confirm against the paper copy before approving: failed soft checks, then the taxable value. */
export function confirmationItems(checks: Checks | null, e: Extraction): ConfirmItem[] {
  return [...needsConfirmation(checks), ...(taxableMismatch(e) ? ['taxable' as const] : [])];
}

export function validRejectNote(note: string): boolean {
  const n = note.trim().length;
  return n >= 1 && n <= REJECT_NOTE_MAX;
}
