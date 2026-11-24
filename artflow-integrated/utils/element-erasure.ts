import type {Element, ErasureStroke, Rect} from '../types';

export const erasurePath = (stroke: ErasureStroke) => stroke.points.map((point,index)=>`${index?'L':'M'} ${Number(point.x)||0} ${Number(point.y)||0}`).join(' ');
export const erasureScale = (stroke: ErasureStroke, bounds: Rect) => ({x:Math.max(1,bounds.width)/Math.max(1,stroke.bounds.width),y:Math.max(1,bounds.height)/Math.max(1,stroke.bounds.height)});
export function erasureTransform(stroke: ErasureStroke, bounds: Rect): string {
  const scale=erasureScale(stroke,bounds);
  return `translate(${bounds.x} ${bounds.y}) scale(${scale.x} ${scale.y}) translate(${-stroke.bounds.x} ${-stroke.bounds.y})`;
}
export const erasurePadding = (element: Element) => Math.max(32,'strokeWidth' in element ? element.strokeWidth*4 : 32);

/** Apply only to an isolated element layer so holes never erase objects below it. */
export function drawErasureStrokes(ctx:CanvasRenderingContext2D,element:Element,bounds:Rect):void {
  ctx.save();
  ctx.globalCompositeOperation='destination-out';
  ctx.globalAlpha=1;ctx.strokeStyle='black';ctx.lineCap='round';ctx.lineJoin='round';
  for(const stroke of element.erasures||[]){
    const scale=erasureScale(stroke,bounds);
    ctx.save();ctx.translate(bounds.x,bounds.y);ctx.scale(scale.x,scale.y);ctx.translate(-stroke.bounds.x,-stroke.bounds.y);
    ctx.lineWidth=stroke.radius*2;ctx.beginPath();
    stroke.points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));
    ctx.stroke();ctx.restore();
  }
  ctx.restore();
}

/** Generated numeric geometry only. Shared by thumbnails and SVG rasterization. */
export function maskElementSvg(content:string,element:Element,bounds:Rect,id:string,offsetX=0,offsetY=0):string {
  if(!element.erasures?.length)return content;
  const pad=erasurePadding(element),x=bounds.x-pad,y=bounds.y-pad,w=Math.max(1,bounds.width)+pad*2,h=Math.max(1,bounds.height)+pad*2;
  const paths=element.erasures.map(stroke=>`<path transform="${erasureTransform(stroke,bounds)}" d="${erasurePath(stroke)}" stroke="black" stroke-width="${stroke.radius*2}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`).join('');
  return `<g transform="translate(${offsetX} ${offsetY})"><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" style="mask-type:luminance"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>${paths}</mask></defs><g mask="url(#${id})"><g transform="translate(${-offsetX} ${-offsetY})">${content}</g></g></g>`;
}
