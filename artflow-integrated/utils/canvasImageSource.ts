import type { ImageElement } from '../types';

// Choose enough physical pixels for this image, independent of the camera's
// arbitrary world zoom and the global full-original memory admission budget.
export function canvasImageSource(element: ImageElement, zoom: number, dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1): string | null {
  const galleryId = /^\/preview\/([a-f0-9-]{36})$/.exec(element.href)?.[1];
  const original = element.originalHref || element.href;
  const source = galleryId ? `/canvas-image/${galleryId}` : /^\/board-media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(original) ? original : null;
  if (!source) return null;
  const demand = Math.max(element.width, element.height) * zoom * Math.max(1, dpr);
  const edge = [512, 1024, 2048, 4096, 8192].find(size => size >= demand) || 8192;
  return `${source}?edge=${edge}`;
}
