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
  it('does not ask for a short leftover next to a hidden run', () => {
    const r = runShield(wordsFromLines(['Ref 2341 2341 2340 5']), 0.6);
    expect(r.matches).toEqual([{ type: 'POSSIBLE_ID', wordIndexes: [1, 2, 3] }]);
    expect(r.uncertain).toBe(false);
  });
  it('leaves amounts, dates and times alone', () => {
    for (const line of ['Total 50100234567.00', 'Total 1,23,45,678.00', 'Date: 02-11-2026 10:30', 'Amount 5010023456,78']) {
      const r = runShield(wordsFromLines([line]), 0.6);
      expect([line, r.matches, r.uncertain]).toEqual([line, [], false]);
    }
  });
});
