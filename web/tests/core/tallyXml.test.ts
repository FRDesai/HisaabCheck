import { describe, expect, it } from 'vitest';
import { DEFAULT_LEDGERS, tallyReady, toTallyMastersXml, toTallyVouchersXml, voucherEntries, xmlText } from '../../src/core/export/tallyXml';
import { gstinCheckChar } from '../../src/core/shield/gstin';
import { makeBill } from '../billFixtures';

const VALID_GSTIN = `29ABCDE1234F1Z${gstinCheckChar('29ABCDE1234F1Z')}`;
const signed = (b: ReturnType<typeof makeBill>) => voucherEntries(b, DEFAULT_LEDGERS).reduce((s, e) => s + (e.debit ? -e.paise : e.paise), 0);
const count = (xml: string, tag: string) => xml.split(tag).length - 1;

describe('xmlText', () => {
  it('escapes the five XML characters', () => expect(xmlText(`A&B <"x"> 'y'`)).toBe('A&amp;B &lt;&quot;x&quot;&gt; &apos;y&apos;'));
  it('drops characters XML 1.0 forbids and keeps tabs, new lines and non-Latin text', () => {
    expect(xmlText('a\u0000b\u0008c\u001Fd')).toBe('abcd');
    expect(xmlText('a\tb\nc')).toBe('a\tb\nc');
    expect(xmlText('श्री ट्रेडर्स 😀')).toBe('श्री ट्रेडर्स 😀');
    expect(xmlText('x\uD800y')).toBe('xy');
  });
});

describe('voucherEntries', () => {
  it('credits the supplier and debits purchase and CGST/SGST; sums to zero', () => {
    const b = makeBill('b1');
    expect(voucherEntries(b, DEFAULT_LEDGERS)).toEqual([
      { ledger: 'Acme Traders', debit: false, paise: 11800 },
      { ledger: 'Purchases', debit: true, paise: 10000 },
      { ledger: 'Input CGST', debit: true, paise: 900 },
      { ledger: 'Input SGST', debit: true, paise: 900 },
    ]);
    expect(signed(b)).toBe(0);
  });
  it('uses IGST only for an inter-state bill', () => {
    const b = makeBill('b2', { extraction: { cgst: 0, sgst: 0, igst: 18 } });
    expect(voucherEntries(b, DEFAULT_LEDGERS).map((e) => e.ledger)).toEqual(['Acme Traders', 'Purchases', 'Input IGST']);
    expect(signed(b)).toBe(0);
  });
  it('books a small gap to Round Off, on the side that balances', () => {
    const up = makeBill('r1', { extraction: { taxableValue: 99.6, total: 118 } });   // 0.40 more debit needed
    expect(voucherEntries(up, DEFAULT_LEDGERS).at(-1)).toEqual({ ledger: 'Round Off', debit: true, paise: 40 });
    expect(signed(up)).toBe(0);
    const down = makeBill('r2', { extraction: { taxableValue: 100.45, total: 118 } }); // 0.45 too much debit
    expect(voucherEntries(down, DEFAULT_LEDGERS).at(-1)).toEqual({ ledger: 'Round Off', debit: false, paise: 45 });
    expect(signed(down)).toBe(0);
  });
  it('derives the taxable value from total minus tax when it is missing', () => {
    const b = makeBill('t', { extraction: { taxableValue: 0 } });
    expect(voucherEntries(b, DEFAULT_LEDGERS)[1]).toEqual({ ledger: 'Purchases', debit: true, paise: 10000 });
    expect(signed(b)).toBe(0);
  });
  it('avoids float drift', () => {
    const b = makeBill('f', { extraction: { taxableValue: 0.1 + 0.2, cgst: 0.027, sgst: 0.027, igst: 0, total: 0.35 } });
    expect(signed(b)).toBe(0);
  });
  it('names a supplier with no name', () => {
    expect(voucherEntries(makeBill('n', { extraction: { supplierName: '  ' } }), DEFAULT_LEDGERS)[0].ledger).toBe('Unknown supplier');
  });
});

describe('tallyReady', () => {
  it('leaves out bills whose amounts are more than ₹1 apart', () => {
    const good = makeBill('g'); const edge = makeBill('e', { extraction: { taxableValue: 99, total: 118 } });
    const bad = makeBill('x', { extraction: { taxableValue: 90, total: 118 } });
    const neg = makeBill('n', { extraction: { taxableValue: 0, cgst: 80, sgst: 80, total: 118 } });
    const r = tallyReady([good, edge, bad, neg]);
    expect(r.ok.map((b) => b.id)).toEqual(['g', 'e']);
    expect(r.unbalanced.map((b) => b.id)).toEqual(['x', 'n']);
  });
  it('leaves out a bill with a negative tax component even when the sum balances', () => {
    const b = makeBill('m', { extraction: { cgst: 18.5, sgst: -0.5 } });
    expect(tallyReady([b])).toEqual({ ok: [], unbalanced: [b] });
  });
  it('leaves out a bill without a valid invoice date', () => {
    const bad = ['', '2026-02-30', '05-11-2026'].map((d, i) => makeBill(`d${i}`, { extraction: { invoiceDate: d } }));
    expect(tallyReady(bad).ok).toEqual([]);
    expect(tallyReady(bad).unbalanced).toHaveLength(3);
  });
});

describe('toTallyVouchersXml', () => {
  const xml = toTallyVouchersXml([makeBill('b1', { extraction: { invoiceNo: 'A&1' } }), makeBill('b2', { extraction: { invoiceDate: '2026-11-09' } })]);
  it('is one import envelope for vouchers', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(count(xml, '<ENVELOPE>')).toBe(1);
    expect(count(xml, '</ENVELOPE>')).toBe(1);
  });
  it('has one Purchase voucher per bill with date, reference and narration', () => {
    expect(count(xml, '<VOUCHER VCHTYPE="Purchase" ACTION="Create"')).toBe(2);
    expect(xml).toContain('<DATE>20261105</DATE>');
    expect(xml).toContain('<DATE>20261109</DATE>');
    expect(xml).toContain('<REFERENCE>A&amp;1</REFERENCE>');
    expect(xml).toContain('<PARTYLEDGERNAME>Acme Traders</PARTYLEDGERNAME>');
    expect(xml).toContain('<NARRATION>HisaabCheck bill b1</NARRATION>');
  });
  it('writes credits positive and debits negative', () => {
    expect(xml).toContain('<LEDGERNAME>Acme Traders</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>118.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Purchases</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Input CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-9.00</AMOUNT>');
  });
  it('every voucher in the file sums to zero', () => {
    for (const v of xml.split('<VOUCHER ').slice(1)) {
      const amounts = [...v.matchAll(/<AMOUNT>(-?\d+)\.(\d{2})<\/AMOUNT>/g)].map((m) => (m[1].startsWith('-') ? -1 : 1) * (Math.abs(Number(m[1])) * 100 + Number(m[2])));
      expect(amounts.reduce((s, a) => s + a, 0)).toBe(0);
    }
  });
});

describe('toTallyMastersXml', () => {
  const bills = [
    makeBill('a', { extraction: { supplierName: 'Acme Traders', supplierGstin: VALID_GSTIN } }),
    makeBill('b', { extraction: { supplierName: 'ACME TRADERS ', supplierGstin: '' } }),
    makeBill('c', { extraction: { supplierName: 'Shah & Sons', supplierGstin: 'NOT-A-GSTIN' } }),
  ];
  const xml = toTallyMastersXml(bills);
  it('is one import envelope for masters', () => expect(xml).toContain('<REPORTNAME>All Masters</REPORTNAME>'));
  it('creates each supplier once, ignoring case and spaces, under Sundry Creditors', () => {
    expect(count(xml, '<PARENT>Sundry Creditors</PARENT>')).toBe(2);
    expect(xml).toContain('<LEDGER NAME="Acme Traders" ACTION="Create">');
    expect(xml).toContain('<LEDGER NAME="Shah &amp; Sons" ACTION="Create">');
  });
  it('adds the GSTIN only when it is valid', () => {
    expect(xml).toContain(`<PARTYGSTIN>${VALID_GSTIN}</PARTYGSTIN>`);
    expect(count(xml, '<PARTYGSTIN>')).toBe(1);
  });
  it('creates the purchase, tax and round-off ledgers', () => {
    for (const n of ['Purchases', 'Input CGST', 'Input SGST', 'Input IGST', 'Round Off']) expect(xml).toContain(`<LEDGER NAME="${n}" ACTION="Create">`);
    expect(xml).toContain('<PARENT>Purchase Accounts</PARENT>');
    expect(count(xml, '<PARENT>Duties &amp; Taxes</PARENT>')).toBe(3);
    expect(xml).toContain('<PARENT>Indirect Expenses</PARENT>');
  });
});
