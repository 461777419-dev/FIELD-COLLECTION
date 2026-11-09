import type { Element } from '../types';

export interface GalleryIdentity { id: string; contentHash?: string }
export function galleryIdFor(element: Element, catalog: GalleryIdentity[]): string | null {
  if (element.type !== 'image' && element.type !== 'video') return null;
  const href = (element.type === 'image' ? element.originalHref : '') || element.href || '';
  const id = /^\/(?:media|preview|canvas-image)\/([a-f0-9-]{36})$/.exec(href)?.[1];
  if (id) return id;
  const hash = /^\/board-media\/([a-f0-9]{64})\./.exec(href)?.[1];
  return hash ? catalog.find(image => image.contentHash === hash)?.id || null : null;
}
export function boardSelection(elements: Element[], ids: string[], catalog: GalleryIdentity[]): string[] {
  const selected = new Set(ids);
  return elements.filter(element => selected.has(galleryIdFor(element, catalog) || '')).map(element => element.id);
}
export function gallerySelection(elements: Element[], ids: string[], catalog: GalleryIdentity[]): string[] {
  const selected = new Set(ids);
  return [...new Set(elements.filter(element => selected.has(element.id)).map(element => galleryIdFor(element, catalog)).filter((id): id is string => !!id))];
}
