// Pure job-state helpers for useBillProcessor (kept free of React/Firebase so they can be unit-tested).

/** State reset for a cascade retry. The billId is KEPT so the re-run overwrites the same bill doc (no orphan, no second log). */
export function retryPatch(job: { billId?: string }) {
  return { step: 'queued' as const, error: undefined, result: undefined, sync: undefined, photo: undefined, billId: job.billId };
}

/** The bill id to save a finished run under: the job's existing id after a retry, otherwise undefined (fresh auto-id). */
export const saveTarget = (job: { billId?: string }): string | undefined => job.billId;
