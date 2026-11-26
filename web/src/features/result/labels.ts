import type { Checks, Extraction, Reason, RouteInfo } from '../../core/types';
import type { FieldKey } from './fields';

export const REASON: Record<Reason, string> = {
  passed: '', total_mismatch: 'total mismatch', invalid_gstin: 'invalid GSTIN', low_confidence: 'low confidence',
  device_timeout: 'on-device read too slow', device_error: 'on-device error', invalid_json: 'unreadable answer',
  no_device_model: 'no on-device AI', cloud_only_mode: 'cloud-only mode', cloud_error: 'cloud unavailable',
  ocr_error: 'could not check for private numbers', user_kept_local: 'kept on device',
  redact_error: 'could not hide private numbers safely',
};
export const CHECK_MSG: Record<keyof Checks, string> = { total: 'Items + tax ≠ total', gstin: 'GSTIN invalid', taxSplit: 'Tax split does not match states', date: 'Date invalid or in the future', required: 'Required field missing' };
export const EMPTY_EXTRACTION: Extraction = { supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '', taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 };
export const FIELDS: Array<[FieldKey, string, 'text' | 'number']> = [
  ['supplierName', 'Supplier', 'text'], ['supplierGstin', 'Supplier GSTIN', 'text'], ['invoiceNo', 'Invoice no.', 'text'],
  ['invoiceDate', 'Invoice date', 'text'], ['placeOfSupply', 'Place of supply', 'text'], ['taxableValue', 'Taxable value', 'number'],
  ['cgst', 'CGST', 'number'], ['sgst', 'SGST', 'number'], ['igst', 'IGST', 'number'], ['total', 'Total', 'number'],
];
export const FIELD_CHECK: Partial<Record<FieldKey, keyof Checks>> = { supplierGstin: 'gstin', invoiceDate: 'date', total: 'total', cgst: 'taxSplit', sgst: 'taxSplit', igst: 'taxSplit' };

type Route = Pick<RouteInfo, 'path' | 'reason'> | null;
const onDevice = (r: Route) => r !== null && r.path === 'device' && r.reason === 'passed';

export function badgeText(route: Route): string {
  if (!route) return 'Manual entry';
  if (onDevice(route)) return 'Read on device';
  return route.path === 'cloud' ? `Checked in cloud: ${REASON[route.reason]}` : `Manual entry: ${REASON[route.reason]}`;
}
export function badgeTone(route: Route): string {
  if (onDevice(route)) return 'bg-emerald-100 text-emerald-900';
  return route?.path === 'cloud' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900';
}
