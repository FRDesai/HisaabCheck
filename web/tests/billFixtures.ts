import type { BillDoc } from '../src/core/review/billDoc';
import type { Extraction } from '../src/core/types';

/** A passing draft bill; override any part. */
export function makeBill(id: string, over: Partial<Omit<BillDoc, 'extraction'>> & { extraction?: Partial<Extraction> } = {}): BillDoc {
  const { extraction, ...rest } = over;
  return {
    id, status: 'draft', checks: { total: true, gstin: true, taxSplit: true, date: true, required: true },
    route: { path: 'device', reason: 'passed', confidence: 0.95, promptVersion: 'v1', modelName: 'gemini-nano' },
    imagePath: null, createdAt: new Date('2026-11-10T06:00:00Z'), reviewedAt: null, reviewedBy: null, rejectNote: '', approvedWithFailedChecks: [],
    ...rest,
    extraction: { supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: `INV-${id}`, invoiceDate: '2026-11-05', placeOfSupply: '29',
      taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9, ...extraction },
  };
}
