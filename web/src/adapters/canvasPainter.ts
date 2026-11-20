import type { Painter } from '../core/types';
export const canvasPainter: Painter = {
  async paint(image, boxes) {
    const bmp = await createImageBitmap(image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    ctx.fillStyle = '#000';
    for (const b of boxes) ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  },
};
