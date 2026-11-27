import { describe, it, expect } from 'vitest';
import first from '../../../shared/test-vectors/ocr-real.json';
import fresh from '../../../shared/test-vectors/ocr-real-fresh.json';
import { runShield } from '../../src/core/shield/shield';
import { ocrAdequate } from '../../src/core/shield/adequacy';
import type { OcrWord } from '../../src/core/types';

/*
 * Real Tesseract.js words for synthetic, computer-rendered bills, with ground truth (two sets: the first 64 bills, and
 * 36 fresh bills from an independent re-review). For each private number, looking at the OCR words overlapping it:
 * - a word is digit-like when it holds a digit, or at least 3 letters that are digit look-alikes (O I L S B Z) and
 *   those are more than half its letters; other words ("PAN:", "Account") are labels and do not count;
 * - NOT READ: no overlapping word is digit-like (OCR lost the number; there is nothing for the shield to hide);
 * - HIDDEN: every digit-like overlapping word is in a match;
 * - PREVIEW, RELATED: not hidden, the bill is previewed, and a warning points at the number's own line (a missing-value
 *   warning on the line before also counts: that is its label), or OCR read too little of the bill;
 * - PREVIEW, UNRELATED: not hidden, previewed only because of a warning elsewhere on the bill;
 * - SILENT LEAK: not hidden and no preview.
 */
type Item = [kind: string, priv: number, value: string, words: number[], note?: string];
type Bill = { name: string; words: Array<[string, number, number, number, number, number, number]>; items: Item[] };
type Totals = { hidden: number; hiddenWithLabelVisible: number; related: number; unrelated: number; notRead: number; previewBills: number };

const LOOKALIKES = /[OILSBZ]/gi;
function digitLike(t: string): boolean {
  if (/\d/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const n = (letters.match(LOOKALIKES) ?? []).length;
  return n >= 3 && n * 2 > letters.length;
}

function evaluate(bills: Bill[]) {
  const t: Totals = { hidden: 0, hiddenWithLabelVisible: 0, related: 0, unrelated: 0, notRead: 0, previewBills: 0 };
  const leaks: string[] = [];
  const notHidden: string[] = [];
  const overHidden: Record<string, number> = {};
  let gstinWordsInMatches = 0;
  for (const b of bills) {
    const words: OcrWord[] = b.words.map(([text, x0, y0, x1, y1, confidence, line]) => ({ text, confidence, line, bbox: { x0, y0, x1, y1 } }));
    const r = runShield(words, 0.6);
    const adequate = ocrAdequate(words);
    const preview = r.uncertain || !adequate;
    if (preview) t.previewBills++;
    const matched = new Set(r.matches.flatMap((m) => m.wordIndexes));
    gstinWordsInMatches += r.gstinWordIndexes.filter((i) => matched.has(i)).length;
    for (const [kind, priv, value, idx] of b.items) {
      if (!priv) {
        if (idx.some((i) => matched.has(i))) overHidden[kind] = (overHidden[kind] ?? 0) + 1;
        continue;
      }
      const key = `${b.name} ${kind} ${value}`;
      const digitWords = idx.filter((i) => digitLike(words[i].text));
      if (digitWords.length === 0) { t.notRead++; continue; }
      if (digitWords.every((i) => matched.has(i))) {
        t.hidden++;
        if (idx.some((i) => !matched.has(i))) t.hiddenWithLabelVisible++;
        continue;
      }
      notHidden.push(key);
      if (!preview) { leaks.push(key); continue; }
      const lines = new Set(idx.map((i) => words[i].line));
      const own = !adequate || r.uncertainReasons.some((x) => {
        const [k, n] = x.split(':');
        const li = k === 'low_ocr_confidence' || k === 'partial_match' ? words[Number(n)].line : Number(n);
        return lines.has(li) || (k === 'label_without_value' && lines.has(li + 1));
      });
      if (own) t.related++; else t.unrelated++;
    }
  }
  return { t, leaks, notHidden, overHidden, gstinWordsInMatches };
}

const sets: Array<{ name: string; bills: Bill[]; privateCount: number; mustHide: string[]; totals: Totals; overHidden: Record<string, number> }> = [
  {
    name: 'first 64 bills', bills: (first as { bills: Bill[] }).bills, privateCount: 310,
    mustHide: ['hard00 LANDLINE (080) 7229 7102', 'hard05 LANDLINE (080) 9788 6897', 'hard10 LANDLINE (0821) 2293 658',
      'hard15 LANDLINE (044) 2557 7502', 'hard13 BANK 6437 6326 5127 3196 76'],
    totals: { hidden: 305, hiddenWithLabelVisible: 7, related: 5, unrelated: 0, notRead: 0, previewBills: 47 },
    overHidden: { EWAY: 64, HSN: 6, AMOUNT: 6 },
  },
  {
    name: '36 fresh bills', bills: (fresh as { bills: Bill[] }).bills, privateCount: 198,
    mustHide: ['fresh30 BANK 8613 5061 1962', 'fresh25 BANK 7552 7265 7128 9010', 'fresh26 LANDLINE [044] 43087740',
      'fresh18 PHONE (+91) 9738994895', 'fresh26 PHONE (+91) 8115403259', 'fresh10 BANK 41335 35554 52147555',
      'fresh03 LANDLINE 040 - 83294496', 'fresh15 LANDLINE 0484 - 3103832', 'fresh21 LANDLINE 044 - 85526798', 'fresh27 LANDLINE 080 - 56598603'],
    totals: { hidden: 192, hiddenWithLabelVisible: 6, related: 3, unrelated: 0, notRead: 3, previewBills: 27 },
    overHidden: { REF: 36, AMOUNT: 3, HSN: 1 },
  },
];

for (const s of sets) {
  describe(`shield on real Tesseract output: ${s.name}`, () => {
    const r = evaluate(s.bills);
    it('holds the expected bills and private numbers', () => {
      expect(s.bills.flatMap((b) => b.items).filter((i) => i[1]).length).toBe(s.privateCount);
    });
    it('never leaks a private number silently', () => {
      expect(r.leaks).toEqual([]);
    });
    it('never puts a GSTIN word in a match', () => {
      expect(r.gstinWordsInMatches).toBe(0);
    });
    it('hides the numbers the reviews found leaking', () => {
      const all = s.bills.flatMap((b) => b.items.map((i) => `${b.name} ${i[0]} ${i[2]}`));
      for (const v of s.mustHide) {
        expect(all).toContain(v);
        expect(r.notHidden).not.toContain(v);
      }
    });
    it('pins the totals (a change here is a regression or an improvement to explain)', () => {
      expect({ ...r.t, overHidden: r.overHidden }).toEqual({ ...s.totals, overHidden: s.overHidden });
    });
  });
}

describe('real-OCR scoring', () => {
  it('counts digit look-alike words as digits and labels as labels', () => {
    expect(['5OIOO', 'SBIN', '9845', 'PAN:', 'Account', '@ybl', 'Mob:'].map(digitLike)).toEqual([true, true, true, false, false, false, false]);
  });
});
