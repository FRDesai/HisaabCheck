import type { OcrWord } from '../types';
import { MIN_OCR_MEDIAN_CONFIDENCE, MIN_OCR_WORDS } from '../config/defaults';

/**
 * True only when OCR read enough of the bill, well enough, for "the shield found nothing" to mean
 * "there is nothing to hide". When false, the caller must treat the shield as uncertain (human preview).
 */
export function ocrAdequate(words: OcrWord[]): boolean {
  if (words.length < MIN_OCR_WORDS) return false;
  const c = words.map((w) => (Number.isFinite(w.confidence) ? w.confidence : 0)).sort((a, b) => a - b);
  const mid = c.length >> 1;
  const median = c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2;
  return median >= MIN_OCR_MEDIAN_CONFIDENCE;
}
