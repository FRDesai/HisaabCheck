import type { OcrWord } from '../src/core/types';

/** Splits each line on spaces; each word gets a 10px-per-char box on its own row. */
export function wordsFromLines(lines: string[], confidence = 95): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((line, li) => {
    let x = 0;
    for (const text of line.split(' ').filter(Boolean)) {
      out.push({ text, confidence, line: li, bbox: { x0: x, y0: li * 20, x1: x + text.length * 10, y1: li * 20 + 16 } });
      x += text.length * 10 + 10;
    }
  });
  return out;
}
