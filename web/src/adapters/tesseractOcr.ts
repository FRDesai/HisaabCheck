import type { Worker } from 'tesseract.js';
import type { Ocr } from '../core/types';

// Lazy import keeps tesseract.js out of the first bundle.
let worker: Promise<Worker> | null = null;
const getWorker = () => (worker ??= import('tesseract.js').then((t) => t.createWorker('eng')));

export const tesseractOcr: Ocr = {
  async recognize(image) {
    const { data } = await (await getWorker()).recognize(image);
    return data.lines.flatMap((line, li) => line.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, line: li })));
  },
};
export const warmUpOcr = () => void getWorker();
