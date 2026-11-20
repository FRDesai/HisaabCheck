export type RowStatus = 'ok' | 'error';
export interface AccuracyRow {
  file: string; status: RowStatus; error?: string;
  deviceOk: number | null; // null = device model did not run or the call failed
  deviceMs: number | null; cloudOk: number | null; cloudMs: number | null; // null = cloud call failed
  piiMasked: number; piiLeft: number | null; // null = leak check did not complete
  uncertain: boolean;
}
export interface Selection { scored: number; skippedNoTruth: string[]; truthWithoutFile: string[] }
export interface Summary {
  devicePct: number | null; deviceBills: number; cloudPct: number | null; cloudBills: number; failed: number;
  leakChecked: number; leakTotal: number; leakedBills: number; unsure: number; total: number;
}

function pct(values: (number | null)[], fieldsPerBill: number): { pct: number | null; bills: number } {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return { pct: null, bills: 0 };
  return { pct: (v.reduce((s, x) => s + x, 0) / (v.length * fieldsPerBill)) * 100, bills: v.length };
}

// selection is accepted for call-site symmetry; coverage is displayed separately by the page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function summarize(rows: AccuracyRow[], fieldsPerBill: number, _selection: Selection): Summary {
  const d = pct(rows.map((r) => r.deviceOk), fieldsPerBill);
  const c = pct(rows.map((r) => r.cloudOk), fieldsPerBill);
  const checked = rows.filter((r) => r.piiLeft !== null);
  return {
    devicePct: d.pct, deviceBills: d.bills, cloudPct: c.pct, cloudBills: c.bills,
    failed: rows.filter((r) => r.status === 'error' || r.error !== undefined).length,
    leakChecked: checked.length,
    leakTotal: checked.reduce((s, r) => s + (r.piiLeft ?? 0), 0),
    leakedBills: checked.filter((r) => (r.piiLeft ?? 0) > 0).length,
    unsure: rows.filter((r) => r.uncertain).length,
    total: rows.length,
  };
}
