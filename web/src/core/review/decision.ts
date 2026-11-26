import type { BillStatus, Checks } from '../types';

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

export function validRejectNote(note: string): boolean {
  const n = note.trim().length;
  return n >= 1 && n <= REJECT_NOTE_MAX;
}
