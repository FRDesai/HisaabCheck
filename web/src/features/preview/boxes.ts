import type { Box } from '../../core/types';

export const normBox = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampBox(b: Box, w: number, h: number): Box {
  return { x0: clamp(b.x0, 0, w), y0: clamp(b.y0, 0, h), x1: clamp(b.x1, 0, w), y1: clamp(b.y1, 0, h) };
}

/** Pointer position (client px) to natural-image pixel coordinates, clamped to the image. */
export function pointToImage(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, naturalW: number, naturalH: number) {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clamp(((clientX - rect.left) / rect.width) * naturalW, 0, naturalW),
    y: clamp(((clientY - rect.top) / rect.height) * naturalH, 0, naturalH),
  };
}

export function boxToPercent(b: Box, naturalW: number, naturalH: number) {
  const n = normBox(b);
  const p = (v: number, d: number) => `${d ? (v / d) * 100 : 0}%`;
  return { left: p(n.x0, naturalW), top: p(n.y0, naturalH), width: p(n.x1 - n.x0, naturalW), height: p(n.y1 - n.y0, naturalH) };
}

export const bottomThird = (w: number, h: number): Box => ({ x0: 0, y0: Math.round(h * 0.66667), x1: w, y1: h });
