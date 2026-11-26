import type { BillStatus, Checks, Extraction, LineItem, PathTaken, Reason, RouteInfo } from '../types';

/** A bill as the review and export screens use it. Built only by toBillDoc, so every field has a safe value. */
export interface BillDoc {
  id: string; extraction: Extraction; checks: Checks | null; status: BillStatus; route: RouteInfo | null;
  imagePath: string | null; createdAt: Date | null; reviewedAt: Date | null; reviewedBy: string | null;
  rejectNote: string; approvedWithFailedChecks: string[];
}

const STATUSES: readonly string[] = ['draft', 'approved', 'rejected', 'manual_entry'];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const validDate = (d: unknown): Date | null => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

/** A Firestore Timestamp (anything with toDate()), or a Date. */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return validDate(v);
  const o = obj(v);
  return o && typeof o.toDate === 'function' ? validDate((o.toDate as () => unknown)()) : null;
}

function toItems(v: unknown): LineItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(obj).filter((i): i is Record<string, unknown> => i !== null)
    .map((i) => ({ description: str(i.description), hsn: str(i.hsn), qty: num(i.qty), rate: num(i.rate), amount: num(i.amount) }));
}

function toChecks(v: unknown): Checks | null {
  const o = obj(v);
  if (!o) return null;
  return { total: o.total === true, gstin: o.gstin === true, taxSplit: o.taxSplit === true, date: o.date === true, required: o.required === true };
}

function toRoute(v: unknown): RouteInfo | null {
  const o = obj(v);
  if (!o || (o.path !== 'device' && o.path !== 'cloud') || typeof o.reason !== 'string') return null;
  return { path: o.path as PathTaken, reason: o.reason as Reason, confidence: num(o.confidence), promptVersion: str(o.promptVersion), modelName: str(o.modelName) };
}

/** Tolerant reader: a bill document with missing or wrong-typed fields still becomes a usable BillDoc. */
export function toBillDoc(id: string, data: Record<string, unknown>): BillDoc {
  const extraction: Extraction = {
    supplierName: str(data.supplierName), supplierGstin: str(data.supplierGstin), invoiceNo: str(data.invoiceNo),
    invoiceDate: str(data.invoiceDate), placeOfSupply: str(data.placeOfSupply),
    taxableValue: num(data.taxableValue), cgst: num(data.cgst), sgst: num(data.sgst), igst: num(data.igst), total: num(data.total),
    confidence: num(data.confidence),
  };
  const items = toItems(data.items);
  if (items) extraction.items = items;
  if (typeof data.itemCount === 'number' && Number.isFinite(data.itemCount)) extraction.itemCount = data.itemCount;
  return {
    id, extraction, checks: toChecks(data.checks),
    status: STATUSES.includes(data.status as string) ? (data.status as BillStatus) : 'draft',
    route: toRoute(data.route),
    imagePath: typeof data.imagePath === 'string' && data.imagePath ? data.imagePath : null,
    createdAt: toDate(data.createdAt), reviewedAt: toDate(data.reviewedAt),
    reviewedBy: typeof data.reviewedBy === 'string' ? data.reviewedBy : null,
    rejectNote: str(data.rejectNote),
    approvedWithFailedChecks: Array.isArray(data.approvedWithFailedChecks)
      ? data.approvedWithFailedChecks.filter((s): s is string => typeof s === 'string') : [],
  };
}

/** Who produced the fields: the on-device model, the cloud model, or nobody (manual entry). */
export function readBy(route: RouteInfo | null): 'device' | 'cloud' | 'manual' {
  if (!route) return 'manual';
  if (route.path === 'cloud') return 'cloud';
  return route.reason === 'passed' ? 'device' : 'manual';
}
