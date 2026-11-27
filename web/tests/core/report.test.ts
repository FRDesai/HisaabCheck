import { describe, expect, it } from 'vitest';
import {
  buildReport, defaultReportRange, formatLongDate, formatRupees, formatShare, MAX_REPORT_MONTHS, monthLabel, parseReportRange,
} from '../../src/core/report/report';
import { CSV_HEADER, toCsv } from '../../src/core/export/csv';
import { exportable } from '../../src/core/export/rows';
import type { BillDoc } from '../../src/core/review/billDoc';
import type { Extraction } from '../../src/core/types';
import { makeBill } from '../billFixtures';

// Valid GSTINs (check character computed); makeBill's default '29ABCDE1234F1Z5' is NOT valid.
const G1 = '29ABCDE1234F1ZW', G2 = '27AAAAA1111A1ZW', G3 = '24BBBBB2222B1ZN', G4 = '07CCCCC3333C1Z4', G5 = '33DDDDD4444D1ZU', G6 = '19EEEEE5555E1Z5';

let n = 0;
const ap = (e: Partial<Extraction>, over: Partial<Omit<BillDoc, 'extraction'>> = {}) =>
  makeBill(`b${++n}`, { status: 'approved', ...over, extraction: e });

describe('buildReport', () => {
  it('handles no bills: every month zero, no suppliers, zero shares, zero totals', () => {
    const r = buildReport([], '2026-06-01', '2026-11-30');
    expect(r.months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(r.months.every((m) => m.bills === 0 && m.totalPaise === 0 && m.barPct === 0)).toBe(true);
    expect(r.suppliers).toEqual([]);
    expect(r.supplierCount).toBe(0);
    expect(r.tax).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 0, gstPaise: 0, taxablePaise: 0, totalPaise: 0, differencePaise: 0 });
    expect(r.counts).toEqual({ approved: 0, approvedAfterPaperCheck: 0, notApproved: 0 });
  });

  it('shows months with no bills as zero and sums the others', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-10', total: 118 }), ap({ invoiceDate: '2026-07-20', total: 236 }),
      ap({ invoiceDate: '2026-09-01', total: 59 })], '2026-07-01', '2026-09-30');
    expect(r.months.map((m) => [m.month, m.bills, m.totalPaise, m.barPct])).toEqual([
      ['2026-07', 2, 35400, 100], ['2026-08', 0, 0, 0], ['2026-09', 1, 5900, 17],
    ]);
    expect(r.months[0].label).toBe('July 2026');
  });

  it('includes the first and last day of the range and excludes bills outside it', () => {
    const bills = [ap({ invoiceDate: '2026-07-01', total: 1 }), ap({ invoiceDate: '2026-08-31', total: 2 }),
      ap({ invoiceDate: '2026-06-30', total: 100 }), ap({ invoiceDate: '2026-09-01', total: 100 })];
    const r = buildReport(bills, '2026-07-01', '2026-08-31');
    expect(r.counts.approved).toBe(2);
    expect(r.tax.totalPaise).toBe(300);
  });

  it('includes partial months at the edges of a range that does not start or end on a month boundary', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-15', total: 10 })], '2026-07-15', '2026-08-03');
    expect(r.months.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
  });

  it('leaves out unapproved bills dated in the range but counts them; out-of-range ones are not counted', () => {
    const bills = [ap({ invoiceDate: '2026-07-10', total: 100 }),
      makeBill('d', { status: 'draft', extraction: { invoiceDate: '2026-07-11', total: 500 } }),
      makeBill('m', { status: 'manual_entry', extraction: { invoiceDate: '2026-07-12', total: 500 } }),
      makeBill('r', { status: 'rejected', extraction: { invoiceDate: '2026-07-13', total: 500 } }),
      makeBill('out', { status: 'draft', extraction: { invoiceDate: '2026-08-01', total: 500 } })];
    const r = buildReport(bills, '2026-07-01', '2026-07-31');
    expect(r.counts).toEqual({ approved: 1, approvedAfterPaperCheck: 0, notApproved: 3 });
    expect(r.tax.totalPaise).toBe(10000);
    expect(r.months[0].bills).toBe(1);
  });

  it('counts bills approved after a paper check (non-empty approvedWithFailedChecks)', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-10' }, { approvedWithFailedChecks: ['total'] }),
      ap({ invoiceDate: '2026-07-11' }, { approvedWithFailedChecks: ['gstin', 'date'] }), ap({ invoiceDate: '2026-07-12' })],
    '2026-07-01', '2026-07-31');
    expect(r.counts.approved).toBe(3);
    expect(r.counts.approvedAfterPaperCheck).toBe(2);
  });

  it('adds in whole paise with no float drift', () => {
    const bills = [ap({ invoiceDate: '2026-07-01', total: 0.1, cgst: 0.1, sgst: 0.1, igst: 0.1, taxableValue: 0.1 }),
      ap({ invoiceDate: '2026-07-02', total: 0.2, cgst: 0.2, sgst: 0.2, igst: 0.2, taxableValue: 0.2 }),
      ap({ invoiceDate: '2026-07-03', total: 1.005, cgst: 0, sgst: 0, igst: 0, taxableValue: 1.005 })];
    const r = buildReport(bills, '2026-07-01', '2026-07-31');
    // 1.005 rupees is 100 paise, as toPaise (and so both exports) round it.
    expect(r.tax).toEqual({ cgstPaise: 30, sgstPaise: 30, igstPaise: 30, gstPaise: 90, taxablePaise: 130, totalPaise: 130, differencePaise: -90 });
    expect(r.months[0].totalPaise).toBe(130);
    expect(Number.isInteger(r.suppliers[0].totalPaise)).toBe(true);
    expect(formatRupees(r.tax.totalPaise)).toBe('₹1.30');
  });

  it('derives taxable value as total - tax when the stored taxable value is 0, as the exports do', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 0, total: 1180, cgst: 90, sgst: 90, igst: 0 }),
      ap({ invoiceDate: '2026-07-02', taxableValue: 500, total: 590, cgst: 0, sgst: 0, igst: 90 })], '2026-07-01', '2026-07-31');
    expect(r.tax.taxablePaise).toBe(100000 + 50000);
    expect(r.tax).toMatchObject({ cgstPaise: 9000, sgstPaise: 9000, igstPaise: 9000, gstPaise: 27000, totalPaise: 177000 });
  });

  it('excludes an approved bill with an invalid or missing date, as the export does', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-32', total: 100 }), ap({ invoiceDate: '', total: 100 }),
      ap({ invoiceDate: '2026-7-5', total: 100 }), ap({ invoiceDate: '2026-07-05', total: 1 })], '2026-07-01', '2026-07-31');
    expect(r.counts.approved).toBe(1);
    expect(r.tax.totalPaise).toBe(100);
  });

  it('spans a year boundary month by month', () => {
    const r = buildReport([ap({ invoiceDate: '2026-12-31', total: 10 }), ap({ invoiceDate: '2027-01-01', total: 20 })], '2026-11-01', '2027-02-28');
    expect(r.months.map((m) => [m.month, m.totalPaise])).toEqual([['2026-11', 0], ['2026-12', 1000], ['2027-01', 2000], ['2027-02', 0]]);
    expect(r.months[2].label).toBe('January 2027');
  });
});

describe('buildReport difference (total - taxable - GST)', () => {
  const R = ['2026-07-01', '2026-07-31'] as const;
  it('is zero when taxable value plus GST equals the total', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118 })], ...R);
    expect(r.tax.differencePaise).toBe(0);
  });
  it('is a small positive figure for per-bill round-off, summed over bills', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 100.2, cgst: 9, sgst: 9, igst: 0, total: 118.5 }),
      ap({ invoiceDate: '2026-07-02', taxableValue: 100.3, cgst: 9, sgst: 9, igst: 0, total: 118.5 })], ...R);
    expect(r.tax.differencePaise).toBe(30 + 20);
    expect(r.tax.totalPaise - r.tax.taxablePaise - r.tax.gstPaise).toBe(r.tax.differencePaise);
  });
  it('can be a larger gap, for example a bill approved after a paper check', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 150 }, { approvedWithFailedChecks: ['total'] })], ...R);
    expect(r.tax.differencePaise).toBe(3200);
  });
  it('is negative when taxable value plus GST exceeds the total', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 100 })], ...R);
    expect(r.tax.differencePaise).toBe(-1800);
  });
  it('is zero when the taxable value was not read (derived as total - tax)', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', taxableValue: 0, cgst: 9, sgst: 9, igst: 0, total: 118 })], ...R);
    expect(r.tax.differencePaise).toBe(0);
  });
});

describe('report totals match the CSV export', () => {
  it('equals the column sums of the CSV for the same bills and range', () => {
    const bills = [
      ap({ invoiceDate: '2026-07-01', taxableValue: 100.2, cgst: 9, sgst: 9, igst: 0, total: 118.5 }),
      ap({ invoiceDate: '2026-07-15', taxableValue: 0, cgst: 0, sgst: 0, igst: 18, total: 118 }),
      ap({ invoiceDate: '2026-07-31', taxableValue: 50.55, cgst: 4.5, sgst: 4.5, igst: 0, total: 60 }),
      ap({ invoiceDate: '2026-08-01', total: 999 }), // outside the range
      makeBill('draft1', { status: 'draft', extraction: { invoiceDate: '2026-07-10', total: 777 } }), // not approved
    ];
    const from = '2026-07-01', to = '2026-07-31';
    const r = buildReport(bills, from, to);
    const csv = toCsv(exportable(bills, from, to)).replace(/^\uFEFF/, '').trim().split('\r\n');
    const col = (name: (typeof CSV_HEADER)[number]) => {
      const i = CSV_HEADER.indexOf(name);
      return csv.slice(1).reduce((a, line) => a + Math.round(Number(line.split(',')[i]) * 100), 0);
    };
    expect(csv.length - 1).toBe(r.counts.approved);
    expect(r.tax.taxablePaise).toBe(col('Taxable value'));
    expect(r.tax.cgstPaise).toBe(col('CGST'));
    expect(r.tax.sgstPaise).toBe(col('SGST'));
    expect(r.tax.igstPaise).toBe(col('IGST'));
    expect(r.tax.totalPaise).toBe(col('Total'));
    expect(r.tax.gstPaise).toBe(col('CGST') + col('SGST') + col('IGST'));
  });
});

describe('buildReport suppliers', () => {
  const R = ['2026-07-01', '2026-07-31'] as const;

  it('groups by a valid GSTIN even when the names differ', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', supplierGstin: G1, supplierName: 'Sharma Traders', total: 100 }),
      ap({ invoiceDate: '2026-07-02', supplierGstin: ` ${G1.toLowerCase()} `, supplierName: 'SHARMA TRADERS PVT', total: 50 })], ...R);
    expect(r.suppliers).toHaveLength(1);
    expect(r.suppliers[0]).toMatchObject({ name: 'Sharma Traders', gstin: G1, bills: 2, totalPaise: 15000, sharePermille: 1000 });
  });

  it('groups by trimmed, case-insensitive name (inner spaces collapsed) when the GSTIN is not valid', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', supplierGstin: '29ABCDE1234F1Z5', supplierName: 'Acme  Traders', total: 100 }),
      ap({ invoiceDate: '2026-07-02', supplierGstin: '', supplierName: '  acme traders ', total: 100 }),
      ap({ invoiceDate: '2026-07-03', supplierGstin: 'junk', supplierName: 'ACME TRADERS', total: 100 })], ...R);
    expect(r.suppliers).toHaveLength(1);
    expect(r.suppliers[0]).toMatchObject({ name: 'Acme  Traders', gstin: '', bills: 3, totalPaise: 30000 });
  });

  it('keeps a valid-GSTIN group apart from a name group with the same name', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', supplierGstin: G2, supplierName: 'Acme', total: 100 }),
      ap({ invoiceDate: '2026-07-02', supplierGstin: '', supplierName: 'Acme', total: 50 })], ...R);
    expect(r.suppliers.map((s) => [s.gstin, s.totalPaise])).toEqual([[G2, 10000], ['', 5000]]);
  });

  it('shows the top 5 of more than 5 suppliers, counts all of them, and shares sum to about 100%', () => {
    const gs = [G1, G2, G3, G4, G5, G6];
    const bills = gs.map((g, i) => ap({ invoiceDate: '2026-07-01', supplierGstin: g, supplierName: `S${i}`, total: (i + 1) * 100 }));
    bills.push(ap({ invoiceDate: '2026-07-02', supplierGstin: '', supplierName: 'Cash', total: 1 }));
    const r = buildReport(bills, ...R);
    expect(r.supplierCount).toBe(7);
    expect(r.suppliers.map((s) => s.name)).toEqual(['S5', 'S4', 'S3', 'S2', 'S1']);
    // Grand total 2101 rupees: S5 = 600/2101 = 28.56% -> 286 tenths.
    expect(r.suppliers.map((s) => s.sharePermille)).toEqual([286, 238, 190, 143, 95]);
    expect(r.suppliers.reduce((a, s) => a + s.sharePermille, 0)).toBeLessThan(1000);
  });

  it('gives shares that sum to about 100% (each rounded to 0.1%)', () => {
    const r = buildReport([G1, G2, G3].map((g) => ap({ invoiceDate: '2026-07-01', supplierGstin: g, total: 100 })), ...R);
    expect(r.suppliers.map((s) => s.sharePermille)).toEqual([333, 333, 333]);
    expect(r.suppliers.map((s) => s.gstin)).toEqual([G3, G2, G1]); // tie: by key, which is the GSTIN
  });

  it('breaks ties deterministically: total, then bills, then grouping key (lower-cased name or GSTIN)', () => {
    const bills = [
      ap({ invoiceDate: '2026-07-01', supplierGstin: '', supplierName: 'Zeta', total: 100 }),
      ap({ invoiceDate: '2026-07-01', supplierGstin: '', supplierName: 'Beta', total: 50 }),
      ap({ invoiceDate: '2026-07-02', supplierGstin: '', supplierName: 'Beta', total: 50 }),
      ap({ invoiceDate: '2026-07-01', supplierGstin: '', supplierName: 'alpha', total: 100 }),
    ];
    const a = buildReport(bills, ...R).suppliers.map((s) => s.name);
    const b = buildReport([...bills].reverse(), ...R).suppliers.map((s) => s.name);
    expect(a).toEqual(['Beta', 'alpha', 'Zeta']);
    expect(b).toEqual(a);
  });

  it('gives a 0 share, never NaN, when the purchase total is zero', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', total: 0, cgst: 0, sgst: 0, taxableValue: 0 })], ...R);
    expect(r.suppliers[0].sharePermille).toBe(0);
    expect(formatShare(r.suppliers[0].sharePermille)).toBe('0.0%');
    expect(r.months[0].barPct).toBe(0);
  });

  it('names a supplier with no name and no valid GSTIN "Unnamed supplier"', () => {
    const r = buildReport([ap({ invoiceDate: '2026-07-01', supplierGstin: '', supplierName: '  ' })], ...R);
    expect(r.suppliers[0].name).toBe('Unnamed supplier');
  });
});

describe('report ranges', () => {
  it('defaults to six whole calendar months ending with the current IST month', () => {
    expect(defaultReportRange(new Date('2026-11-27T10:00:00Z'))).toEqual({ from: '2026-06-01', to: '2026-11-30' });
  });
  it('uses the IST month at a month boundary', () => {
    // 30 Nov 19:00 UTC is 1 Dec 00:30 IST.
    expect(defaultReportRange(new Date('2026-11-30T19:00:00Z'))).toEqual({ from: '2026-07-01', to: '2026-12-31' });
    // 31 Jan 18:29 UTC is still 31 Jan IST.
    expect(defaultReportRange(new Date('2027-01-31T18:29:00Z'))).toEqual({ from: '2026-08-01', to: '2027-01-31' });
  });
  it('crosses a year boundary and ends on a leap-year February', () => {
    expect(defaultReportRange(new Date('2028-02-10T00:00:00Z'))).toEqual({ from: '2027-09-01', to: '2028-02-29' });
  });

  const now = new Date('2026-11-27T10:00:00Z');
  it('parses a valid range, and falls back to the default when neither date is given', () => {
    expect(parseReportRange('2026-04-01', '2026-09-30', now)).toEqual({ ok: true, from: '2026-04-01', to: '2026-09-30' });
    expect(parseReportRange('2026-04-01', '2026-04-01', now)).toEqual({ ok: true, from: '2026-04-01', to: '2026-04-01' });
    expect(parseReportRange(null, null, now)).toEqual({ ok: true, from: '2026-06-01', to: '2026-11-30' });
  });
  it('refuses invalid, missing-one, reversed and over-long ranges', () => {
    for (const [f, t] of [['2026-02-30', '2026-03-31'], ['2026-04-01', null], [null, '2026-04-01'], ['abc', '2026-04-01'], ['2026-09-30', '2026-04-01']] as const) {
      const p = parseReportRange(f, t, now);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.message.length).toBeGreaterThan(0);
    }
    expect(parseReportRange('2020-01-01', '2026-12-31', now).ok).toBe(false);
  });
  it('accepts a 24-month range and refuses a 25-month range', () => {
    expect(MAX_REPORT_MONTHS).toBe(24);
    expect(parseReportRange('2025-01-01', '2026-12-31', now)).toEqual({ ok: true, from: '2025-01-01', to: '2026-12-31' });
    const p = parseReportRange('2025-01-01', '2027-01-31', now);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain('24');
  });
});

describe('report formatting', () => {
  it('formats paise as rupees with lakh and crore grouping', () => {
    expect(formatRupees(0)).toBe('₹0.00');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(99999)).toBe('₹999.99');
    expect(formatRupees(10000000)).toBe('₹1,00,000.00');
    expect(formatRupees(1234567891)).toBe('₹1,23,45,678.91');
    expect(formatRupees(123456789012)).toBe('₹1,23,45,67,890.12');
    expect(formatRupees(-150)).toBe('-₹1.50');
  });
  it('formats shares, dates and months', () => {
    expect(formatShare(1000)).toBe('100.0%');
    expect(formatShare(333)).toBe('33.3%');
    expect(formatShare(5)).toBe('0.5%');
    expect(formatShare(0)).toBe('0.0%');
    // A negative value cannot print "-1.-5%" or "-1.5%" with a wrong sign.
    expect(formatShare(-5)).toBe('-0.5%');
    expect(formatShare(-333)).toBe('-33.3%');
    expect(formatLongDate('2026-11-27')).toBe('27 November 2026');
    expect(formatLongDate('2026-01-01')).toBe('1 January 2026');
    expect(monthLabel('2027-02')).toBe('February 2027');
  });
});
