import type {Element,FrameElement,ImageElement,Point} from '../types';
import {generateId} from './canvasUtils';

export function presentationElements(name:string,slides:{href:string;width:number;height:number}[],anchor:Point):Element[]{
  const elements:Element[]=[];
  let y=anchor.y;
  slides.forEach((slide,index)=>{
    if(!(slide.href.startsWith('data:image/png;base64,')||/^\/board-media\/[a-f0-9]{64}\.png$/.test(slide.href))||!Number.isFinite(slide.width)||!Number.isFinite(slide.height)||slide.width<=0||slide.height<=0)throw Error('PPT 页面数据无效');
    const width=1200,height=width*slide.height/slide.width,id=generateId();
    const frame:FrameElement={id,type:'frame',name:`${name} · ${index+1}`,x:anchor.x,y,width,height,backgroundColor:'#ffffff'};
    const image:ImageElement={id:generateId(),parentId:id,type:'image',name:`${name} · 第 ${index+1} 页`,x:anchor.x,y,width,height,href:slide.href,originalHref:slide.href,originalPixelWidth:slide.width,originalPixelHeight:slide.height,mimeType:'image/png'};
    // The existing slide panel reads frames from front to back (reverse z-order).
    elements.unshift(frame,image);y+=height+100;
  });
  return elements;
}
