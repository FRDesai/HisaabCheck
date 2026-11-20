import { describe, expect, it } from 'vitest';
import { normBox, pointToImage, boxToPercent, clampBox, bottomThird } from '../../src/features/preview/boxes';

describe('boxes', () => {
  it('normalises reversed corners', () => {
    expect(normBox({ x0: 10, y0: 20, x1: 2, y1: 5 })).toEqual({ x0: 2, y0: 5, x1: 10, y1: 20 });
  });
  it('maps a pointer to natural image coordinates', () => {
    expect(pointToImage(150, 60, { left: 100, top: 10, width: 200, height: 100 }, 1000, 500)).toEqual({ x: 250, y: 250 });
  });
  it('clamps points to the image', () => {
    expect(pointToImage(0, 0, { left: 100, top: 10, width: 200, height: 100 }, 1000, 500)).toEqual({ x: 0, y: 0 });
    expect(clampBox({ x0: -5, y0: 2, x1: 2000, y1: 600 }, 1000, 500)).toEqual({ x0: 0, y0: 2, x1: 1000, y1: 500 });
  });
  it('gives zero-size rect safe percentages', () => {
    expect(boxToPercent({ x0: 100, y0: 50, x1: 300, y1: 100 }, 1000, 500)).toEqual({ left: '10%', top: '10%', width: '20%', height: '10%' });
    expect(boxToPercent({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 0)).toEqual({ left: '0%', top: '0%', width: '0%', height: '0%' });
  });
  it('bottom third', () => {
    expect(bottomThird(900, 300)).toEqual({ x0: 0, y0: 200, x1: 900, y1: 300 });
  });
});
