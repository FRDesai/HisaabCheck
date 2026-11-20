import { describe, it, expect } from 'vitest';
import { ocrAdequate } from '../../src/core/shield/adequacy';
import { MIN_OCR_MEDIAN_CONFIDENCE, MIN_OCR_WORDS } from '../../src/core/config/defaults';
import { wordsFromLines } from '../helpers';

const words = (n: number, confidence = 95) => wordsFromLines([Array.from({ length: n }, (_, i) => `word${i}`).join(' ')], confidence);

describe('ocrAdequate', () => {
  it('uses the agreed thresholds', () => {
    expect(MIN_OCR_WORDS).toBe(15);
    expect(MIN_OCR_MEDIAN_CONFIDENCE).toBe(50);
  });
  it('is false for no words', () => expect(ocrAdequate([])).toBe(false));
  it('is false for 14 words and true for 15', () => {
    expect(ocrAdequate(words(14))).toBe(false);
    expect(ocrAdequate(words(15))).toBe(true);
  });
  it('is false when the median confidence is below 50', () => {
    expect(ocrAdequate(words(30, 49))).toBe(false);
    const mixed = [...words(10, 95), ...words(11, 20)]; // median is a low one
    expect(ocrAdequate(mixed)).toBe(false);
  });
  it('is true for enough words with a median of 50 or more', () => {
    expect(ocrAdequate(words(20, 50))).toBe(true);
    expect(ocrAdequate([...words(11, 95), ...words(10, 20)])).toBe(true);
  });
  it('treats non-finite confidences as zero', () => {
    expect(ocrAdequate(words(20, Number.NaN))).toBe(false);
  });
});
