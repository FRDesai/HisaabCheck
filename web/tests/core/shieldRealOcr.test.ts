import { describe, it, expect } from 'vitest';
import data from '../../../shared/test-vectors/ocr-real.json';
import { runShield } from '../../src/core/shield/shield';
import { ocrAdequate } from '../../src/core/shield/adequacy';
import type { OcrWord } from '../../src/core/types';

/*
 * Real Tesseract.js words for 64 synthetic, computer-rendered bills, with ground truth. A private number is HIDDEN when
 * every overlapping OCR word that holds a digit is in a match (a visible "PAN:" next to it does not count; a visible
 * "+91" does), PREVIEW when it is not hidden but the bill goes to the human preview, and a SILENT LEAK otherwise.
 */
type Item = [kind: string, priv: number, value: string, words: number[]];
type Bill = { name: string; words: Array<[string, number, number, number, number, number, number]>; items: Item[] };
const bills = (data as { bills: Bill[] }).bills;

function evaluate() {
  const out = { hidden: 0, preview: 0, leaks: [] as string[], previewBills: 0, gstinWordsInMatches: 0, notHidden: [] as string[], overHidden: {} as Record<string, number> };
  for (const b of bills) {
    const words: OcrWord[] = b.words.map(([text, x0, y0, x1, y1, confidence, line]) => ({ text, confidence, line, bbox: { x0, y0, x1, y1 } }));
    const r = runShield(words, 0.6);
    const preview = r.uncertain || !ocrAdequate(words);
    if (preview) out.previewBills++;
    const matched = new Set(r.matches.flatMap((m) => m.wordIndexes));
    out.gstinWordsInMatches += r.gstinWordIndexes.filter((i) => matched.has(i)).length;
    for (const [kind, priv, value, idx] of b.items) {
      if (!priv) {
        if (idx.some((i) => matched.has(i))) out.overHidden[kind] = (out.overHidden[kind] ?? 0) + 1;
        continue;
      }
      const digitWords = idx.filter((i) => /\d/.test(words[i].text));
      if (digitWords.length > 0 && digitWords.every((i) => matched.has(i))) out.hidden++;
      else {
        out.notHidden.push(`${b.name} ${kind} ${value}`);
        if (preview) out.preview++;
        else out.leaks.push(`${b.name} ${kind} ${value}`);
      }
    }
  }
  return out;
}

describe('shield on real Tesseract output (64 synthetic rendered bills)', () => {
  const r = evaluate();
  it('holds 64 bills and 310 private numbers', () => {
    expect(bills.length).toBe(64);
    expect(bills.flatMap((b) => b.items).filter((i) => i[1]).length).toBe(310);
  });
  it('never leaks a private number silently', () => {
    expect(r.leaks).toEqual([]);
  });
  it('never puts a GSTIN word in a match', () => {
    expect(r.gstinWordsInMatches).toBe(0);
  });
  it('hides the unlabelled parenthesised landlines and the 18-digit account tail', () => {
    for (const v of ['hard00 LANDLINE (080) 7229 7102', 'hard05 LANDLINE (080) 9788 6897', 'hard10 LANDLINE (0821) 2293 658',
      'hard15 LANDLINE (044) 2557 7502', 'hard13 BANK 6437 6326 5127 3196 76']) {
      expect(bills.flatMap((b) => b.items.map((i) => `${b.name} ${i[0]} ${i[2]}`))).toContain(v);
      expect(r.notHidden).not.toContain(v);
    }
  });
  it('pins the totals (a change here is a regression or an improvement to explain)', () => {
    expect({ hidden: r.hidden, preview: r.preview, previewBills: r.previewBills, overHidden: r.overHidden })
      .toEqual({ hidden: 304, preview: 6, previewBills: 46, overHidden: { EWAY: 64, HSN: 6, AMOUNT: 4 } });
  });
});
