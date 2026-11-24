import React,{useState,useRef,useEffect} from 'react';
import type {Element,FrameElement,PathElement,Point} from '../types';
import {CanvasElement} from './CanvasElement';
import {generateId,getElementBounds} from '../utils/canvasUtils';

export function SlidePresentation({frame,elements,index,total,onNext,onPrev,onExit,onKeep}:{frame:FrameElement;elements:Element[];index:number;total:number;onNext:()=>void;onPrev:()=>void;onExit:()=>void;onKeep:(elements:Element[])=>void}){
  const [mode,setMode]=useState<'view'|'pen'|'laser'>('view');
  const [color,setColor]=useState('#e74b64'),[width,setWidth]=useState(5);
  const [notes,setNotes]=useState<PathElement[]>([]),[laser,setLaser]=useState<Point|null>(null),[exiting,setExiting]=useState(false);
  const drawing=useRef<string|null>(null);
  const svgRef=useRef<SVGSVGElement>(null);
  const toPoint=(event:React.PointerEvent<SVGSVGElement>)=>{const matrix=svgRef.current?.getScreenCTM();if(!matrix)return null;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:point.x,y:point.y};};
  const finish=()=>{drawing.current=null;setLaser(null);};
  const exit=()=>{finish();if(notes.length)setExiting(true);else onExit();};
  const keep=()=>{if(notes.length)onKeep(notes);setNotes([]);setExiting(false);onExit();};
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();exit();}};
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[notes,onExit]);
  const content=elements.filter(element=>{
    if(element.type==='frame'||element.isVisible===false)return false;
    const seen=new Set<string>();let current:Element|undefined=element;
    while(current?.parentId){if(seen.has(current.id)||current.isVisible===false)return false;seen.add(current.id);if(current.parentId===frame.id)return true;current=elements.find(item=>item.id===current!.parentId);}
    const bounds=getElementBounds(element,elements);
    return bounds.x>=frame.x&&bounds.y>=frame.y&&bounds.x+bounds.width<=frame.x+frame.width&&bounds.y+bounds.height<=frame.y+frame.height;
  });
  return <div role="region" aria-label="幻灯片演示" className="absolute inset-0 z-[80] flex flex-col bg-black">
    <div className="min-h-0 flex-1 p-4"><svg ref={svgRef} className="h-full w-full" style={{touchAction:'none',cursor:mode==='pen'?'crosshair':mode==='laser'?'none':'default'}} onPointerDown={event=>{
      if(event.button!==0||mode==='view')return;
      const point=toPoint(event);if(!point||point.x<frame.x||point.y<frame.y||point.x>frame.x+frame.width||point.y>frame.y+frame.height)return;
      event.currentTarget.setPointerCapture(event.pointerId);
      if(mode==='laser'){setLaser(point);return;}
      const id=generateId();drawing.current=id;setNotes(previous=>[...previous,{id,type:'path',name:'演示批注',parentId:frame.id,x:0,y:0,points:[point],strokeColor:color,strokeWidth:width,opacity:1}]);
    }} onPointerMove={event=>{const point=toPoint(event);if(!point)return;if(mode==='laser'){setLaser(point);return;}if(drawing.current)setNotes(previous=>previous.map(note=>note.id===drawing.current?{...note,points:[...note.points,point]}:note));}} onPointerUp={finish} onPointerCancel={finish} onPointerLeave={()=>{if(!drawing.current)setLaser(null);}} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet">
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} fill={frame.backgroundColor||'#fff'}/>
      <g pointerEvents="none">{content.map(element=><CanvasElement key={element.id} element={element} elements={elements} selectedElementIds={[]} zoom={1} editingElement={null} croppingState={null} aiRotationState={null} setEditingElement={()=>{}}/>)}</g>
      {notes.filter(note=>note.parentId===frame.id).map(note=><path key={note.id} d={note.points.map((point,i)=>`${i?'L':'M'} ${point.x} ${point.y}`).join(' ')} stroke={note.strokeColor} strokeWidth={note.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"/>)}
      {laser&&mode==='laser'&&<circle cx={laser.x} cy={laser.y} r={6} fill="#ff3654" stroke="white" strokeWidth={2} pointerEvents="none"/>}
    </svg></div>
    <div className="flex flex-wrap items-center justify-center gap-4 p-3 text-sm text-white"><button aria-label="退出演示" onClick={exit}>退出</button><button aria-label="上一个" onClick={()=>{finish();onPrev();}}>←</button><span>{index+1} / {total} · {frame.name}</span><button aria-label="下一个" onClick={()=>{finish();onNext();}}>→</button><button aria-pressed={mode==='pen'} onClick={()=>setMode(mode==='pen'?'view':'pen')}>批注笔</button><button aria-pressed={mode==='laser'} onClick={()=>setMode(mode==='laser'?'view':'laser')}>激光笔</button><input aria-label="批注颜色" type="color" value={color} onChange={event=>setColor(event.target.value)}/><input aria-label="批注粗细" type="range" min="2" max="20" value={width} onChange={event=>setWidth(Number(event.target.value))}/><button disabled={!notes.some(note=>note.parentId===frame.id)} onClick={()=>setNotes(previous=>{const last=previous.findLastIndex(note=>note.parentId===frame.id);return previous.filter((_,i)=>i!==last);})}>撤销批注</button><button disabled={!notes.length} onClick={keep}>保留批注并退出</button></div>
    {exiting&&<div role="dialog" aria-label="处理演示批注" className="absolute inset-0 z-10 grid place-items-center bg-black/70"><div className="rounded-2xl bg-white p-6 text-gray-800"><p className="mb-4">本次有 {notes.length} 条批注，退出前如何处理？</p><div className="flex gap-4"><button onClick={keep}>保留到画板</button><button onClick={()=>{setNotes([]);onExit();}}>丢弃并退出</button><button onClick={()=>setExiting(false)}>继续演示</button></div></div></div>}
  </div>;
}
