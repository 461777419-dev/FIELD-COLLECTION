import React,{useState,useRef} from 'react';
export interface CompareImage {id:string;name:string;href:string}
export function ImageCompare({images,onClose,immediate=false}:{images:CompareImage[];onClose:()=>void;immediate?:boolean}){
  const [left,setLeft]=useState(images[0]?.id||''),[right,setRight]=useState(images[1]?.id||images[0]?.id||'');
  const [started,setStarted]=useState(immediate);
  const [camera,setCamera]=useState({zoom:1,x:0,y:0});
  const drag=useRef<{x:number;y:number;baseX:number;baseY:number}|null>(null);
  if(!started)return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/30 p-4" style={{pointerEvents:'auto'}}><div role="dialog" aria-label="选择对照图片" aria-modal="true" className="w-full max-w-2xl rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] p-5 text-[var(--ui-text)] shadow-2xl">
    <div className="mb-4 flex items-center justify-between"><strong>图片对照</strong><button aria-label="关闭对照" onClick={onClose}>关闭</button></div>
    <p className="mb-4 text-sm opacity-70">选择图片 1 和图片 2，再开始对照。</p>
    <div className="grid grid-cols-2 gap-4">{[left,right].map((id,index)=><label key={index} className="flex min-w-0 flex-col gap-3"><span>图片 {index+1}</span><select aria-label={`图片 ${index+1}`} value={id} onChange={event=>(index?setRight:setLeft)(event.target.value)} className="w-full rounded-xl border border-[var(--ui-border)] p-2">{images.map(image=><option key={image.id} value={image.id}>{image.name}</option>)}</select><img src={images.find(image=>image.id===id)?.href} alt={`图片 ${index+1} 预览`} className="h-48 w-full rounded-xl bg-black/5 object-contain"/></label>)}</div>
    <div className="mt-5 flex justify-end"><button disabled={!left||!right||left===right} onClick={()=>setStarted(true)} className="rounded-full bg-[var(--bp-accent-soft)] px-5 py-2">开始对照</button></div>
  </div></div>;
  return <div role="dialog" aria-label="参考图对照" className="fixed inset-3 z-[100] flex flex-col rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] p-4 text-[var(--ui-text)] shadow-2xl">
    <div className="mb-3 flex items-center justify-between"><strong>参考图对照</strong><div className="flex gap-4 text-sm"><span>滚轮同步缩放 · 按住拖动</span><button onClick={()=>setCamera({zoom:1,x:0,y:0})}>复位</button><button onClick={()=>{setLeft(right);setRight(left);}}>交换</button><button aria-label="关闭对照" onClick={onClose}>关闭</button></div></div>
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">{[left,right].map((id,index)=>{const image=images.find(item=>item.id===id);return <div key={index} className="flex min-h-0 flex-col gap-2">
      <select aria-label={index?'右侧图片':'左侧图片'} value={id} onChange={event=>(index?setRight:setLeft)(event.target.value)} className="rounded-xl border border-[var(--ui-border)] p-2">{images.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/10" style={{touchAction:'none',cursor:'grab'}} onWheel={event=>{event.preventDefault();setCamera(previous=>({...previous,zoom:Math.max(.1,Math.min(16,previous.zoom*Math.exp(-event.deltaY*.002)))}));}} onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,baseX:camera.x,baseY:camera.y};}} onPointerMove={event=>{const gesture=drag.current;if(!gesture)return;const x=gesture.baseX+event.clientX-gesture.x,y=gesture.baseY+event.clientY-gesture.y;setCamera(previous=>({...previous,x,y}));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
        {image&&<img alt={image.name} src={image.href} draggable={false} className="h-full w-full select-none object-contain" style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}/>}
      </div></div>;})}</div>
  </div>;
}
