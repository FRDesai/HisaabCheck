import type { ImageInput } from '../core/types';
export async function resizeImage(file: Blob, maxSide = 1600): Promise<ImageInput> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), mimeType: 'image/jpeg', width, height };
}
