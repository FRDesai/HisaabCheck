import { describe, it, expect } from 'vitest';
import vectors from '../../../shared/test-vectors/pii.json';
import { runShield } from '../../src/core/shield/shield';
import { wordsFromLines } from '../helpers';

describe('runShield vectors', () => {
  for (const v of vectors as Array<{ name: string; lines: string[]; confidence?: number; types: string[]; gstinWords: number; uncertain: boolean }>) {
    it(v.name, () => {
      const r = runShield(wordsFromLines(v.lines, v.confidence ?? 95), 0.6);
      expect(r.matches.map((m) => m.type).sort()).toEqual([...v.types].sort());
      expect(r.gstinWordIndexes.length).toBe(v.gstinWords);
      expect(r.uncertain).toBe(v.uncertain);
    });
  }
  it('never puts a GSTIN word inside a PII match', () => {
    const r = runShield(wordsFromLines(['GSTIN 27AAPFU0939F1ZV PAN AAPFU0939F']), 0.6);
    const piiWords = r.matches.flatMap((m) => m.wordIndexes);
    expect(piiWords).not.toContain(r.gstinWordIndexes[0]);
  });
  it('maps a spaced aadhaar to all three words', () => {
    const r = runShield(wordsFromLines(['Aadhaar No 2341 2341 2346']), 0.6);
    expect(r.matches[0].wordIndexes).toEqual([2, 3, 4]);
  });
  it('never claims a GSTIN word with the near-miss matchers', () => {
    // GSTIN contains a PAN; neighbours are near-misses. Only the near-PAN word is claimed.
    const r = runShield(wordsFromLines(['27AAPFU0939F1ZV ABCDEI234F 2341-2341-2340']), 0.6);
    expect(r.gstinWordIndexes).toEqual([0]);
    expect(r.matches.flatMap((m) => m.wordIndexes)).not.toContain(0);
    expect(r.matches.map((m) => m.type)).toEqual(['POSSIBLE_ID', 'POSSIBLE_ID']);
  });
  it('hides a low-confidence look-alike mobile and still asks the human', () => {
    const r = runShield(wordsFromLines(['Contact 98450 1Z345'], 40), 0.6);
    expect(r.matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [1, 2] }]);
    expect(r.uncertainReasons.some((x) => x.startsWith('low_ocr_confidence'))).toBe(true);
  });
  it('keeps exact types ahead of near-misses', () => {
    const r = runShield(wordsFromLines(['PAN AAPFU0939F Mob 98450 12345 Aadhaar 2341-2341-2346']), 0.6);
    expect(r.matches.map((m) => m.type).sort()).toEqual(['AADHAAR', 'PAN', 'PHONE']);
  });
  it('a label is not satisfied past a visible digit-bearing word, even by an exact match of its kind', () => {
    expect(runShield(wordsFromLines(['PAN: 12345 AAPFU0939F']), 0.6).uncertain).toBe(true);
    expect(runShield(wordsFromLines(['PAN: AAPFU0939F']), 0.6).uncertain).toBe(false);
  });
  it('a near-miss satisfies only the label of its own kind', () => {
    expect(runShield(wordsFromLines(['PAN:', 'Mob: 9845O 12345']), 0.6).uncertain).toBe(true);
    expect(runShield(wordsFromLines(['Mob:', '9845O 12345']), 0.6).uncertain).toBe(false);
  });
});

describe('runShield long digit runs (bank accounts without a recognised label)', () => {
  const word = (text: string, confidence: number, x: number) => ({ text, confidence, line: 0, bbox: { x0: x, y0: 0, x1: x + text.length * 10, y1: 16 } });
  it('hides the account in the exact OCR reading from the first real run', () => {
    // Tesseract read "A/C No: 50100234567891" as AJC (92), No: (93), 50100234567891 (92).
    const r = runShield([word('AJC', 92, 0), word('No:', 93, 40), word('50100234567891', 92, 80)], 0.6);
    expect(r.matches).toEqual([{ type: 'BANK_ACCOUNT', wordIndexes: [2] }]);
    expect(r.uncertain).toBe(false);
  });
  it('hides a grouped unlabelled account as one match over every group', () => {
    const r = runShield(wordsFromLines(['Beneficiary 5010 0234 5678 91']), 0.6);
    expect(r.matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [1, 2, 3, 4] }]);
  });
  it('never redacts a GSTIN next to a long digit run', () => {
    const r = runShield(wordsFromLines(['GSTIN 27AAPFU0939F1ZV 50100234567891']), 0.6);
    expect(r.gstinWordIndexes).toEqual([1]);
    expect(r.matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [2] }]);
  });
  it('does not count a run twice when an exact matcher already claimed it', () => {
    expect(runShield(wordsFromLines(['A/c No: 50100234567891']), 0.6).matches).toEqual([{ type: 'BANK_ACCOUNT', wordIndexes: [2] }]);
    expect(runShield(wordsFromLines(['Mob: 98450 12345']), 0.6).matches).toEqual([{ type: 'PHONE', wordIndexes: [1, 2] }]);
  });
  it('a hidden long run between a label and its value still means the value may have been missed', () => {
    const r = runShield(wordsFromLines(['PAN: 101002345678 AAPFU0939F']), 0.6);
    expect(r.matches.map((m) => m.type)).toEqual(['PAN', 'POSSIBLE_ID']);
    expect(r.uncertainReasons).toEqual(['label_without_value:0']);
  });
  it('asks the human when unclaimed pieces of one digit run hold 9 or more digits', () => {
    const r = runShield(wordsFromLines(['Beneficiary 50100 2 34567891']), 0.6);
    expect(r.matches).toEqual([]);
    expect(r.uncertainReasons).toEqual(['long_digit_run:0']);
  });
  it('hides a short leftover of a longer digit run instead of leaving it visible', () => {
    const r = runShield(wordsFromLines(['Ref 2341 2341 2340 5']), 0.6);
    expect(r.matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [1, 2, 3] }, { type: 'POSSIBLE_ID', wordIndexes: [4] }]);
    expect(r.uncertain).toBe(false);
  });
  it('leaves amounts, dates and times alone', () => {
    for (const line of ['Total 12345678.00', 'Total 1,23,45,678.00', 'Date: 02-11-2026 10:30', 'Amount 5010023,78']) {
      const r = runShield(wordsFromLines([line]), 0.6);
      expect([line, r.matches, r.uncertain]).toEqual([line, [], false]);
    }
  });
});

describe('runShield round 2: no partial claims, landlines in parentheses, no excuses for long runs', () => {
  const digitWordsHidden = (line: string) => {
    const words = wordsFromLines([line]);
    const r = runShield(words, 0.6);
    const hidden = new Set(r.matches.flatMap((m) => m.wordIndexes));
    return words.every((w, i) => !/\d/.test(w.text) || hidden.has(i) || r.gstinWordIndexes.includes(i));
  };
  it('no matcher leaves part of a longer digit run visible', () => {
    for (const line of ['98450 12345 6789', 'Ref 2341 2341 2340 5', 'Pay 50 1002 3456 7891', 'Pay 2341 2341 2346 3196 76', 'Account Number: 6437 6326 5127 3196 76']) {
      expect([line, digitWordsHidden(line)]).toEqual([line, true]);
    }
  });
  it('a valid aadhaar inside a longer run is not reported as aadhaar', () => {
    expect(runShield(wordsFromLines(['Pay 2341 2341 2346 3196 76']), 0.6).matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [1, 2, 3, 4, 5] }]);
    expect(runShield(wordsFromLines(['Aadhaar: 2341 2341 2346.']), 0.6).matches.map((m) => m.type)).toEqual(['AADHAAR']);
  });
  it('the leftover of a run never takes a GSTIN word', () => {
    const r = runShield(wordsFromLines(['98450 12345 27AAPFU0939F1ZV']), 0.6);
    expect(r.gstinWordIndexes).toEqual([2]);
    expect(r.matches).toEqual([{ type: 'PHONE', wordIndexes: [0, 1] }]);
  });
  it('a parenthesised landline is a phone with or without a label', () => {
    expect(runShield(wordsFromLines(['(080) 7229 7102']), 0.6).matches).toEqual([{ type: 'PHONE', wordIndexes: [0, 1, 2] }]);
    expect(runShield(wordsFromLines(['Tel: (0821) 2293 658']), 0.6)).toMatchObject({ matches: [{ type: 'PHONE', wordIndexes: [1, 2, 3] }], uncertain: false });
  });
  it('long runs are hidden whatever surrounds them', () => {
    for (const line of ['Pay to 50100234567891.00', 'Pay to 1:50100234567891', 'Ref 5010.0234.5678.91', 'Ref 1234567890123456789']) {
      expect([line, digitWordsHidden(line)]).toEqual([line, true]);
    }
  });
  it('an IFSC with a look-alike fifth character is an IFSC and satisfies its label', () => {
    expect(runShield(wordsFromLines(['IFSC: SBINO115094']), 0.6)).toMatchObject({ matches: [{ type: 'IFSC', wordIndexes: [1] }], uncertain: false });
  });
  it('amount- and GSTIN-shaped words do not ask on their own, other low-confidence words still do', () => {
    expect(runShield(wordsFromLines(['Total |8,517.00', 'Tax [3,098.00', 'Due 1,15,840.00', 'Net 3436.00', 'GSTIN 24KBSFKo70911ZX'], 40), 0.6).uncertainReasons).toEqual([]);
    // Joined to another digit group, an amount-shaped word is no longer excused.
    expect(runShield(wordsFromLines(['Pay 4133 52147555.00'], 40), 0.6).uncertainReasons).toContain('low_ocr_confidence:2');
    expect(runShield(wordsFromLines(['[735500 |25742500'], 40), 0.6).uncertainReasons).toEqual(['low_ocr_confidence:0', 'low_ocr_confidence:1']);
  });
});

describe('runShield round 3: decimal tails, brackets, prefixes, narrower excuses', () => {
  const allDigitWordsHidden = (lines: string[], confidence = 95) => {
    const words = wordsFromLines(lines, confidence);
    const r = runShield(words, 0.6);
    const hidden = new Set(r.matches.flatMap((m) => m.wordIndexes));
    return words.every((w, i) => !/\d/.test(w.text) || hidden.has(i) || r.gstinWordIndexes.includes(i));
  };
  it('hides the numbers the re-review found leaking, every digit-bearing word of them', () => {
    for (const line of ['Pay to 8613 5061 1962.00', 'Pay to 7552 7265 7128 9010.00', 'Office [044] 43087740', 'Office 080 - 23456789',
      'Call (+91) 9738994895', 'call (+91) 8115403259', '{080} 2345 6789', '(O80) 2345 6789', '(80) 2345 6789', '(98450) 12345']) {
      expect([line, allDigitWordsHidden([line])]).toEqual([line, true]);
    }
  });
  it('the bracketed country code is part of the phone match', () => {
    expect(runShield(wordsFromLines(['Call (+91) 9738994895']), 0.6).matches).toEqual([{ type: 'PHONE', wordIndexes: [1, 2] }]);
  });
  it('a two-group number with a 4-digit decimal tail asks; a rate next to an HSN code does not', () => {
    expect(runShield(wordsFromLines(['Pay to 50100234 5678.00']), 0.6).uncertainReasons).toEqual(['long_digit_run:0']);
    expect(runShield(wordsFromLines(['Copper Wire 18842067 784.00 10,976.00']), 0.6)).toMatchObject({ matches: [], uncertain: false });
  });
  it('a decimal tail joined to a hidden run is hidden with it; an amount with grouping commas is not', () => {
    const r = runShield(wordsFromLines(['Pay to 41335535554 52147555.00']), 0.6);
    expect(r.matches.flatMap((m) => m.wordIndexes).sort()).toEqual([2, 3]);
    expect(runShield(wordsFromLines(['Mob 9845012345 1,250.00']), 0.6).matches).toEqual([{ type: 'PHONE', wordIndexes: [1] }]);
  });
  it('a GSTIN excuses a low-confidence word only with its skeleton (one OCR insertion and Z read as 7 allowed)', () => {
    for (const w of ['27STWPDOS512F1ZE', '090NGFH3466G372', '24KBSFKo70911ZX']) {
      expect([w, runShield(wordsFromLines([`GSTIN ${w}`], 40), 0.6).uncertainReasons]).toEqual([w, []]);
    }
    for (const w of ['12ABCPE1234F99', '29ABCPE12F34Z5X']) {
      expect([w, runShield(wordsFromLines([`Ref ${w}`], 40), 0.6).uncertain]).toEqual([w, true]);
    }
  });
  it('a comma amount with more than 9 integer digits is not blanked', () => {
    expect(runShield(wordsFromLines(['Ref 5010 0234 1,23,45,67,890.00']), 0.6).uncertain).toBe(true);
    expect(runShield(wordsFromLines(['Total 12,34,56,789.00']), 0.6)).toMatchObject({ matches: [], uncertain: false });
  });
  it('dates are blanked only when the day and month are plausible', () => {
    expect(runShield(wordsFromLines(['Date 31-12-2026 Due 2026-12-31 On 02.11.26']), 0.6)).toMatchObject({ matches: [], uncertain: false });
    expect(runShield(wordsFromLines(['Ref 5010-02-3456 7891']), 0.6).uncertainReasons).toEqual(['long_digit_run:0']);
  });
});

