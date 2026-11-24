import type {Element,Point} from '../types';
import {getElementBounds,rotatePoint,isPointInPolygon} from './canvasUtils';

// CSS cursor pixels are independent of the canvas camera. The dot is the hotspot.
const eraserCursorSvg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M6 22 18 5a3 3 0 0 1 4-.5l6 4a3 3 0 0 1 .5 4L17 28H9Z" fill="#fffafd" stroke="#594251" stroke-width="1.7" stroke-linejoin="round"/><path d="m12 14 10 7 6.5-8.5a3 3 0 0 0-.5-4l-6-4a3 3 0 0 0-4 .5Z" fill="#edcfe1"/><path d="m12 14 10 7" fill="none" stroke="#594251" stroke-width="1.7"/><circle cx="6" cy="26" r="2.5" fill="#594251" stroke="#fffafd" stroke-width="1.5"/></svg>';
export const ERASER_CURSOR=`url("data:image/svg+xml,${encodeURIComponent(eraserCursorSvg)}") 6 26, default`;

export const eraserDiameter = (size = 20) => Math.min(99, Math.max(12, size));
export function eraserCursor(size = 20): string {
  const diameter = eraserDiameter(size), center = Math.round(diameter / 2) + 2, extent = diameter + 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${extent}" height="${extent}"><circle cx="${center}" cy="${center}" r="${diameter/2}" fill="#edcfe1" fill-opacity=".15" stroke="#594251"/><circle cx="${center}" cy="${center}" r="1.5" fill="#594251" stroke="white" stroke-width=".7"/><g transform="translate(${diameter-4} ${diameter-4}) scale(.8)">${eraserCursorSvg.replace(/^<svg[^>]*>|<\/svg>$/g,'')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${center} ${center}, default`;
}

const distance=(p:Point,a:Point,b:Point)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
const cross=(a:Point,b:Point,p:Point)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
function touches(a:Point,b:Point,c:Point,d:Point,radius:number){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(((abC<0&&abD>0)||(abC>0&&abD<0))&&((cdA<0&&cdB>0)||(cdA>0&&cdB<0)))return true;
  return Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<=radius;
}
/** Whole-object eraser. Sweep between samples so fast pointer movements do not skip objects. */
export function eraseElementIds(elements:Element[],from:Point,to:Point,radius:number):Set<string>{
  const byId=new Map(elements.map(element=>[element.id,element]));
  const editable=(element:Element)=>{let current:Element|undefined=element;const seen=new Set<string>();while(current){if(current.isLocked||current.isVisible===false||seen.has(current.id))return false;seen.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}return true;};
  const result=new Set<string>();
  for(const element of elements){
    if(!['path','shape','text','arrow','line'].includes(element.type)||!editable(element))continue;
    const bounds=getElementBounds(element,elements),center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    const rotation='rotation'in element?element.rotation||0:0;
    const a=rotation?rotatePoint(from,center,-rotation):from,b=rotation?rotatePoint(to,center,-rotation):to;
    let points:Point[],filled=false,closed=false;
    let tolerance=radius;
    if(element.type==='path'||element.type==='arrow'||element.type==='line'){
      points=element.points;tolerance+=(element.strokeWidth||0)/2;
      if(element.type==='path'){closed=!!element.closed;filled=!!element.fillColor&&!['transparent','none'].includes(element.fillColor);}
    }else if(element.type==='shape'||element.type==='text'){
      const {x,y,width:w,height:h}=element;
      filled=element.type==='text'||!['transparent','none',''].includes(element.fillColor||'');closed=true;
      if(element.type==='shape')tolerance+=(element.strokeWidth||0)/2;
      points=element.type==='shape'&&element.shapeType==='circle'?Array.from({length:64},(_,i)=>({x:x+w/2+Math.cos(i*Math.PI/32)*w/2,y:y+h/2+Math.sin(i*Math.PI/32)*h/2})):
        element.type==='shape'&&element.shapeType==='triangle'?[{x:x+w/2,y},{x:x+w,y:y+h},{x,y:y+h}]:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
    }else continue;
    const hit=points.length===1?distance(points[0],a,b)<=tolerance:
      points.some((p,i)=>{const next=points[i+1]||(closed?points[0]:null);return next&&touches(a,b,p,next,tolerance);})||
      (filled&&(isPointInPolygon(a,points)||isPointInPolygon(b,points)));
    if(hit)result.add(element.id);
  }
  return result;
}

/** Area erasure preserves editable objects; only the swept region becomes transparent. */
export function eraseElements(elements:Element[],from:Point,to:Point,radius:number,mode:'area'|'object'='area',gestureId='erase'):Element[]{
  const ids=eraseElementIds(elements,from,to,radius);
  if(!ids.size)return elements;
  if(mode==='object')return elements.filter(element=>!ids.has(element.id));
  return elements.map(element=>{
    if(!ids.has(element.id))return element;
    const bounds=getElementBounds(element,elements),center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    const rotation='rotation' in element?element.rotation||0:0;
    const a=rotation?rotatePoint(from,center,-rotation):from,b=rotation?rotatePoint(to,center,-rotation):to;
    const strokes=element.erasures||[],last=strokes.at(-1);
    const continuous=last?.gestureId===gestureId&&last.radius===radius;
    const stroke=continuous?{...last,points:[...last.points,b]}:{points:[a,b],radius,bounds,gestureId};
    return {...element,erasures:[...(continuous?strokes.slice(0,-1):strokes),stroke]};
  });
}
