import type { Box, OcrWord, PiiType, RedactionPlan, ShieldResult } from '../types';

export function planRedaction(words: OcrWord[], shield: ShieldResult, width: number, height: number, pad = 4): RedactionPlan {
  const boxes: Box[] = shield.matches.map((m) => {
    const bs = m.wordIndexes.map((i) => words[i].bbox);
    return {
      x0: Math.max(0, Math.min(...bs.map((b) => b.x0)) - pad),
      y0: Math.max(0, Math.min(...bs.map((b) => b.y0)) - pad),
      x1: Math.min(width, Math.max(...bs.map((b) => b.x1)) + pad),
      y1: Math.min(height, Math.max(...bs.map((b) => b.y1)) + pad),
    };
  });
  const piiTypes = [...new Set(shield.matches.map((m) => m.type))] as PiiType[];
  return { boxes, piiTypes, piiMasked: shield.matches.length };
}
