import { isIsoDate, istMonth, monthRange } from '../dates';
import { billAmounts, exportable, notApprovedInRange } from '../export/rows';
import type { BillDoc } from '../review/billDoc';
import { isValidGstin } from '../shield/gstin';

/** Longest range the report accepts, in calendar months (the page must stay one page). */
export const MAX_REPORT_MONTHS = 24;
/** Months in the default range, ending with the current IST month. */
export const DEFAULT_REPORT_MONTHS = 6;
export const TOP_SUPPLIERS = 5;

export interface ReportMonth { month: string; label: string; bills: number; totalPaise: number; /** 0..100, relative to the largest month. */ barPct: number }
export interface ReportSupplier {
  key: string; name: string; /** The valid GSTIN the group is keyed by, or '' for a group keyed by name. */ gstin: string;
  bills: number; totalPaise: number; /** Share of all purchases in tenths of a percent (333 = 33.3%). */ sharePermille: number;
}
export interface ReportTax { cgstPaise: number; sgstPaise: number; igstPaise: number; gstPaise: number; taxablePaise: number; totalPaise: number; /** total - taxable - GST: per-bill round-off and bills approved after a paper check. May be negative. */ differencePaise: number }
export interface ReportCounts { approved: number; /** Approved with a non-empty approvedWithFailedChecks. */ approvedAfterPaperCheck: number; /** Dated in range, not approved, left out. */ notApproved: number }
export interface ReportModel {
  from: string; to: string; months: ReportMonth[]; suppliers: ReportSupplier[]; /** All suppliers in the period, not only the top 5. */ supplierCount: number;
  tax: ReportTax; counts: ReportCounts;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 'YYYY-MM' as "July 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** 'YYYY-MM-DD' as "27 November 2026". */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Whole paise as rupees with Indian grouping: only integers are formatted, so no float drift. */
export function formatRupees(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN', { useGrouping: true, maximumFractionDigits: 0 });
  return `${paise < 0 ? '-' : ''}₹${rupees}.${String(abs % 100).padStart(2, '0')}`;
}

/** Tenths of a percent as "33.3%". */
export function formatShare(permille: number): string {
  const abs = Math.abs(Math.round(permille));
  return `${permille < 0 && abs > 0 ? '-' : ''}${Math.floor(abs / 10)}.${abs % 10}%`;
}

const addMonths = (month: string, k: number): string => {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
};
const monthsBetween = (fromMonth: string, toMonth: string): string[] => {
  const out: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) out.push(m);
  return out;
};

/** Six whole calendar months, the last being the current IST month. */
export function defaultReportRange(now: Date): { from: string; to: string } {
  const last = istMonth(now);
  return { from: monthRange(addMonths(last, 1 - DEFAULT_REPORT_MONTHS)).from, to: monthRange(last).to };
}

export type ParsedRange = { ok: true; from: string; to: string } | { ok: false; message: string };

/** The report's range from the URL. Neither date given means the default range. */
export function parseReportRange(from: string | null, to: string | null, now: Date): ParsedRange {
  if (!from && !to) return { ok: true, ...defaultReportRange(now) };
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) return { ok: false, message: 'The report needs a From and a To date, both real dates written YYYY-MM-DD.' };
  if (from > to) return { ok: false, message: 'The From date is after the To date.' };
  if (monthsBetween(from.slice(0, 7), to.slice(0, 7)).length > MAX_REPORT_MONTHS) {
    return { ok: false, message: `Choose a period of at most ${MAX_REPORT_MONTHS} months.` };
  }
  return { ok: true, from, to };
}

const permille = (part: number, whole: number): number => (whole > 0 ? Math.round((part * 1000) / whole) : 0);

function supplierKey(b: BillDoc): { key: string; gstin: string } {
  const g = b.extraction.supplierGstin.trim().toUpperCase();
  if (isValidGstin(g)) return { key: `g:${g}`, gstin: g };
  return { key: `n:${b.extraction.supplierName.trim().replace(/\s+/g, ' ').toLowerCase()}`, gstin: '' };
}

/** The whole report for approved bills dated from..to (both included), from every bill read for that range. */
export function buildReport(bills: BillDoc[], from: string, to: string): ReportModel {
  const approved = exportable(bills, from, to);
  const months = new Map<string, { bills: number; totalPaise: number }>(monthsBetween(from.slice(0, 7), to.slice(0, 7)).map((m) => [m, { bills: 0, totalPaise: 0 }]));
  const groups = new Map<string, Omit<ReportSupplier, 'sharePermille'>>();
  const tax: ReportTax = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, gstPaise: 0, taxablePaise: 0, totalPaise: 0, differencePaise: 0 };
  let afterPaperCheck = 0;

  for (const b of approved) {
    const a = billAmounts(b.extraction);
    const m = months.get(b.extraction.invoiceDate.slice(0, 7));
    if (m) { m.bills += 1; m.totalPaise += a.total; }
    const { key, gstin } = supplierKey(b);
    const g = groups.get(key) ?? { key, gstin, name: b.extraction.supplierName.trim() || 'Unnamed supplier', bills: 0, totalPaise: 0 };
    g.bills += 1; g.totalPaise += a.total;
    groups.set(key, g);
    tax.cgstPaise += a.cgst; tax.sgstPaise += a.sgst; tax.igstPaise += a.igst; tax.taxablePaise += a.taxable; tax.totalPaise += a.total;
    if (b.approvedWithFailedChecks.length > 0) afterPaperCheck += 1;
  }
  tax.gstPaise = tax.cgstPaise + tax.sgstPaise + tax.igstPaise;
  tax.differencePaise = tax.totalPaise - tax.taxablePaise - tax.gstPaise;

  const maxMonth = Math.max(0, ...[...months.values()].map((m) => m.totalPaise));
  const sorted = [...groups.values()].sort((x, y) => y.totalPaise - x.totalPaise || y.bills - x.bills || cmp(x.key, y.key));
  return {
    from, to,
    months: [...months].map(([month, m]) => ({ month, label: monthLabel(month), ...m, barPct: maxMonth > 0 ? Math.round((Math.max(0, m.totalPaise) * 100) / maxMonth) : 0 })),
    suppliers: sorted.slice(0, TOP_SUPPLIERS).map((s) => ({ ...s, sharePermille: permille(s.totalPaise, tax.totalPaise) })),
    supplierCount: sorted.length,
    tax,
    counts: { approved: approved.length, approvedAfterPaperCheck: afterPaperCheck, notApproved: notApprovedInRange(bills, from, to) },
  };
}
