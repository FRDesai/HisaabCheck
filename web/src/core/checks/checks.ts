import type { CheckResult, Checks, Config, Extraction, Reason } from '../types';
import { gstinStateCode, isValidGstin, placeOfSupplyCode } from '../shield/gstin';

export const WEIGHTS = { total: 0.35, gstin: 0.25, taxSplit: 0.15, date: 0.1, required: 0.1, model: 0.05 } as const;

function totalOk(e: Extraction, tol: number): boolean {
  const tax = e.cgst + e.sgst + e.igst;
  const base = e.items && e.items.length > 0 ? e.items.reduce((s, i) => s + i.amount, 0) : e.taxableValue;
  return e.total > 0 && Math.abs(base + tax - e.total) <= tol;
}

function taxSplitOk(e: Extraction, gstinValid: boolean): boolean {
  if (!gstinValid) return false;
  const allZero = e.cgst === 0 && e.sgst === 0 && e.igst === 0;
  const split = e.cgst > 0 && Math.abs(e.cgst - e.sgst) <= 1 && e.igst === 0;
  const igstOnly = e.cgst === 0 && e.sgst === 0 && e.igst > 0;
  const pos = placeOfSupplyCode(e.placeOfSupply);
  if (pos === null) return allZero || split || igstOnly;
  const sameState = pos === gstinStateCode(e.supplierGstin);
  return allZero || (sameState ? split : igstOnly);
}

const IST_OFFSET_MS = 5.5 * 3600e3;

/** IST calendar date (YYYY-MM-DD) for the given instant. */
function istDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function dateOk(d: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return false;
  const todayStr = istDate(today);
  const minStr = `${Number(todayStr.slice(0, 4)) - 3}${todayStr.slice(4)}`;
  return d <= todayStr && d >= minStr;
}

export function runChecks(e: Extraction, cfg: Config, today: Date): CheckResult {
  const gstin = isValidGstin(e.supplierGstin);
  const checks: Checks = {
    total: totalOk(e, cfg.totalToleranceInr),
    gstin,
    taxSplit: taxSplitOk(e, gstin),
    date: dateOk(e.invoiceDate, today),
    required: [e.supplierName, e.supplierGstin, e.invoiceNo, e.invoiceDate].every((s) => s.length > 0) && e.total > 0,
  };
  let score = WEIGHTS.model * e.confidence;
  for (const k of Object.keys(checks) as (keyof Checks)[]) if (checks[k]) score += WEIGHTS[k];
  const hardFail: Reason | null = !checks.total ? 'total_mismatch' : !checks.gstin ? 'invalid_gstin' : null;
  return { checks, score, hardFail, escalate: hardFail !== null || score < cfg.confidenceThreshold };
}
