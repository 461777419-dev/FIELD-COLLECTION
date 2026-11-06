import type { Board } from '../types';
import type { CanvasViewport } from './viewport-store';

// Persist transient blob URLs once; gallery /media references remain references.
async function durable(value: unknown, cache: Map<string, string>): Promise<unknown> {
  if (typeof value === 'string' && (value.startsWith('blob:') || /^data:(?:image|video|audio)\/[\w.+-]+;base64,/.test(value))) {
    if (cache.has(value)) return cache.get(value);
    const blob = await fetch(value).then(r => r.blob());
    const response = await fetch('/api/board/media', {method:'POST',headers:{'Content-Type':blob.type},body:blob});
    if (!response.ok) throw Error('无法保存导入的素材');
    const {url} = await response.json(); cache.set(value,url); return url;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item=>durable(item,cache)));
  if (value && typeof value === 'object') {
    const result: Record<string,unknown> = {};
    for (const [key,item] of Object.entries(value)) result[key] = await durable(item,cache);
    return result;
  }
  return value;
}
const blobCache = new Map<string,string>();
export function durableAtlasValue<T>(value:T):Promise<T> {return durable(value,blobCache) as Promise<T>;}
export async function saveAtlasDocument(boards: Board[], activeBoardId: string, viewport: CanvasViewport) {
  const snapshot = boards.map(board=>board.id === activeBoardId ? {...board,...viewport} : board);
  const body = await durable({boards:snapshot,activeBoardId},blobCache);
  const response = await fetch('/api/board/document',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if (!response.ok) throw Error('工程写入失败，请保留页面后重试');
}
