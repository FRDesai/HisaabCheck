import { isValidGstin } from '../shield/gstin';
import type { BillDoc } from '../review/billDoc';
import { paiseToText, toPaise } from './rows';

export interface TallyLedgers { purchase: string; cgst: string; sgst: string; igst: string; roundOff: string }
/** Ledger names used in the export. The masters file creates them, so they need not exist in the company. */
export const DEFAULT_LEDGERS: TallyLedgers = { purchase: 'Purchases', cgst: 'Input CGST', sgst: 'Input SGST', igst: 'Input IGST', roundOff: 'Round Off' };
const PARENT = { supplier: 'Sundry Creditors', purchase: 'Purchase Accounts', tax: 'Duties & Taxes', roundOff: 'Indirect Expenses' } as const;
/** A gap up to ₹1 is rounding; anything larger means the bill's amounts do not add up. */
const MAX_ROUND_OFF_PAISE = 100;

export interface VoucherEntry { ledger: string; debit: boolean; paise: number }

/** Escapes text for XML and drops characters XML 1.0 does not allow. */
export function xmlText(s: string): string {
  return s.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const supplierLedger = (b: BillDoc): string => b.extraction.supplierName.trim() || 'Unknown supplier';

function amounts(b: BillDoc) {
  const e = b.extraction;
  const total = toPaise(e.total), cgst = toPaise(e.cgst), sgst = toPaise(e.sgst), igst = toPaise(e.igst);
  const tax = cgst + sgst + igst;
  const taxable = e.taxableValue > 0 ? toPaise(e.taxableValue) : total - tax;
  return { total, cgst, sgst, igst, taxable, roundOff: total - taxable - tax };
}

/** Ledger entries of one purchase voucher, in whole paise. Credits minus debits is always zero. */
export function voucherEntries(b: BillDoc, l: TallyLedgers): VoucherEntry[] {
  const a = amounts(b);
  const out: VoucherEntry[] = [{ ledger: supplierLedger(b), debit: false, paise: a.total }, { ledger: l.purchase, debit: true, paise: a.taxable }];
  if (a.cgst > 0) out.push({ ledger: l.cgst, debit: true, paise: a.cgst });
  if (a.sgst > 0) out.push({ ledger: l.sgst, debit: true, paise: a.sgst });
  if (a.igst > 0) out.push({ ledger: l.igst, debit: true, paise: a.igst });
  if (a.roundOff !== 0) out.push({ ledger: l.roundOff, debit: a.roundOff > 0, paise: Math.abs(a.roundOff) });
  return out;
}

/** Splits bills into those that make a sound voucher and those whose amounts are more than ₹1 apart. */
export function tallyReady(bills: BillDoc[]): { ok: BillDoc[]; unbalanced: BillDoc[] } {
  const ok: BillDoc[] = [], unbalanced: BillDoc[] = [];
  for (const b of bills) {
    const a = amounts(b);
    (a.total > 0 && a.taxable >= 0 && Math.abs(a.roundOff) <= MAX_ROUND_OFF_PAISE ? ok : unbalanced).push(b);
  }
  return { ok, unbalanced };
}

const envelope = (report: string, messages: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>`
  + `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME></REQUESTDESC><REQUESTDATA>\n${messages.join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;

const message = (inner: string): string => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE>`;

function entryXml(e: VoucherEntry): string {
  const amount = e.debit ? `-${paiseToText(e.paise)}` : paiseToText(e.paise);
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlText(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

/** One Purchase voucher per bill (accounting mode). Pass only bills from tallyReady().ok. */
export function toTallyVouchersXml(bills: BillDoc[], ledgers: TallyLedgers = DEFAULT_LEDGERS): string {
  return envelope('Vouchers', bills.map((b) => {
    const date = b.extraction.invoiceDate.replace(/-/g, '');
    return message(`<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE>`
      + `<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><REFERENCE>${xmlText(b.extraction.invoiceNo)}</REFERENCE><REFERENCEDATE>${date}</REFERENCEDATE>`
      + `<PARTYLEDGERNAME>${xmlText(supplierLedger(b))}</PARTYLEDGERNAME><ISINVOICE>No</ISINVOICE><NARRATION>${xmlText(`HisaabCheck bill ${b.id}`)}</NARRATION>`
      + `${voucherEntries(b, ledgers).map(entryXml).join('')}</VOUCHER>`);
  }));
}

const ledgerXml = (name: string, parent: string, extra = ''): string =>
  message(`<LEDGER NAME="${xmlText(name)}" ACTION="Create"><NAME.LIST><NAME>${xmlText(name)}</NAME></NAME.LIST><PARENT>${xmlText(parent)}</PARENT>${extra}</LEDGER>`);

/** Ledgers the vouchers need: one per supplier (Tally names ignore case), plus purchase, tax and round-off. Import this file first. */
export function toTallyMastersXml(bills: BillDoc[], ledgers: TallyLedgers = DEFAULT_LEDGERS): string {
  const suppliers = new Map<string, { name: string; gstin: string }>();
  for (const b of bills) {
    const name = supplierLedger(b), key = name.toLowerCase();
    const gstin = isValidGstin(b.extraction.supplierGstin) ? b.extraction.supplierGstin : '';
    const seen = suppliers.get(key);
    if (!seen) suppliers.set(key, { name, gstin }); else if (!seen.gstin && gstin) seen.gstin = gstin;
  }
  return envelope('All Masters', [
    ledgerXml(ledgers.purchase, PARENT.purchase),
    ledgerXml(ledgers.cgst, PARENT.tax), ledgerXml(ledgers.sgst, PARENT.tax), ledgerXml(ledgers.igst, PARENT.tax),
    ledgerXml(ledgers.roundOff, PARENT.roundOff),
    ...[...suppliers.values()].map((s) => ledgerXml(s.name, PARENT.supplier, s.gstin ? `<PARTYGSTIN>${xmlText(s.gstin)}</PARTYGSTIN>` : '')),
  ]);
}
