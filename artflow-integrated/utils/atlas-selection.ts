import type { Element, Rect } from '../types';
import type { CanvasViewport } from './viewport-store';

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
  const byId = new Map(elements.map(element => [element.id, element]));
  return [...new Set(ids.map(id => byId.get(id)).filter((element): element is Element => !!element).map(element => galleryIdFor(element, catalog)).filter((id): id is string => !!id))];
}

/** Keep the current scale unless the linked selection cannot fit on screen. */
export function linkedSelectionViewport(bounds: Rect, current: CanvasViewport, size: {width:number;height:number}): CanvasViewport | null {
  if(size.width<=100||size.height<=100||bounds.width<=0||bounds.height<=0)return null;
  const padding=50;
  const left=bounds.x*current.zoom+current.panOffset.x,top=bounds.y*current.zoom+current.panOffset.y;
  if(left>=padding&&top>=padding&&left+bounds.width*current.zoom<=size.width-padding&&top+bounds.height*current.zoom<=size.height-padding)return null;
  const zoom=Math.min(current.zoom,(size.width-padding*2)/bounds.width,(size.height-padding*2)/bounds.height);
  return {zoom,panOffset:{x:size.width/2-(bounds.x+bounds.width/2)*zoom,y:size.height/2-(bounds.y+bounds.height/2)*zoom}};
}
