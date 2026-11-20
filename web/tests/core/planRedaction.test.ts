import { describe, it, expect } from 'vitest';
import { planRedaction } from '../../src/core/redact/planRedaction';
import { runShield } from '../../src/core/shield/shield';
import { wordsFromLines } from '../helpers';

describe('planRedaction', () => {
  it('unions the words of one match and pads, clamped to the image', () => {
    const words = wordsFromLines(['Aadhaar No 2341 2341 2346']);
    const plan = planRedaction(words, runShield(words, 0.6), 1000, 1000);
    expect(plan.boxes).toHaveLength(1);
    const first = words[2].bbox, last = words[4].bbox;
    expect(plan.boxes[0]).toEqual({ x0: first.x0 - 4 < 0 ? 0 : first.x0 - 4, y0: 0, x1: last.x1 + 4, y1: last.y1 + 4 });
    expect(plan.piiTypes).toEqual(['AADHAAR']);
    expect(plan.piiMasked).toBe(1);
  });
  it('produces no boxes for a GSTIN-only bill', () => {
    const words = wordsFromLines(['GSTIN 27AAPFU0939F1ZV']);
    expect(planRedaction(words, runShield(words, 0.6), 1000, 1000).boxes).toEqual([]);
  });
  it('lists each type once', () => {
    const words = wordsFromLines(['PAN AAPFU0939F', 'PAN BBBPB1234C']);
    const plan = planRedaction(words, runShield(words, 0.6), 1000, 1000);
    expect(plan.piiTypes).toEqual(['PAN']);
    expect(plan.piiMasked).toBe(2);
  });
});
