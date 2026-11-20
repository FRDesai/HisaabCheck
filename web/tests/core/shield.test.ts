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
});

