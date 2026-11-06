import type { Element } from '../types';
import { durableAtlasValue } from './atlas-document';
import { composeExportPng } from '../capabilities/canvas-export/compose';

export async function selectionPng(elements: Element[]): Promise<Blob> {
  const single = elements.length === 1 ? elements[0] : null;
  if (single?.type === 'image' && !single.grayscale && (single.opacity ?? 1) === 1 && !single.rotation && !single.borderRadius) {
    const galleryId = /^\/preview\/([a-f0-9-]{36})$/.exec(single.href)?.[1];
    const src = galleryId ? `/canvas-image/${galleryId}` : single.originalHref || single.href;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建图片');
    context.drawImage(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('图片转换失败')), 'image/png'));
  }
  const result = await composeExportPng({ elements, background: '', selectionIds: [] }, false);
  if (!result) throw Error('没有可复制的内容');
  return result.blob;
}

export async function copyCanvasElements(elements: Element[]): Promise<void> {
  if (!elements.length) return;
  const data = { type: 'artflow-elements', elements };
  const text = (location.pathname.startsWith('/board/') ? durableAtlasValue(data) : Promise.resolve(data))
    .then(value => new Blob([JSON.stringify(value)], { type: 'text/plain' }));
  if (elements.some(element => element.type === 'image')) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw Error('当前环境不支持图片剪贴板，请使用本地预览或桌面版');
    // Start the clipboard write in the click/key gesture; preparation is asynchronous.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': selectionPng(elements), 'text/plain': text })]);
  } else {
    await navigator.clipboard.writeText(await (await text).text());
  }
}
