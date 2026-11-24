import React,{useEffect,useLayoutEffect,useRef} from 'react';

export function ToolSettingsPopover({x,y,title,onClose,children,anchorRef}:{x:number;y:number;title:string;onClose:()=>void;children:React.ReactNode;anchorRef?:React.RefObject<HTMLElement|null>}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const menu=ref.current;if(!menu)return;
    menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))}px`;
    menu.focus();
  },[x,y]);
  useEffect(()=>{
    const close=(event:Event)=>{if(!ref.current?.contains(event.target as Node)&&!anchorRef?.current?.contains(event.target as Node))onClose();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};
    const docs=[document,...(window.parent!==window?[window.parent.document]:[])];
    docs.forEach(doc=>{doc.addEventListener('pointerdown',close,true);doc.addEventListener('keydown',key,true);});
    window.addEventListener('blur',onClose);window.addEventListener('resize',onClose);
    return()=>{docs.forEach(doc=>{doc.removeEventListener('pointerdown',close,true);doc.removeEventListener('keydown',key,true);});window.removeEventListener('blur',onClose);window.removeEventListener('resize',onClose);};
  },[onClose,anchorRef]);
  return <div ref={ref} data-bp-tool-menu="" role="dialog" aria-label={title} tabIndex={-1} onContextMenu={event=>event.preventDefault()} className="fixed z-[100] w-64 max-w-[calc(100vw-16px)] overflow-y-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] p-4 text-sm text-[var(--ui-text)] shadow-xl outline-none" style={{left:x,top:y,maxHeight:'calc(100vh - 16px)'}}>
    <div className="mb-3 flex items-center justify-between"><strong>{title}</strong><button aria-label={`关闭${title}`} onClick={onClose} className="h-7 w-7 rounded-full hover:bg-[var(--ui-hover)]">×</button></div>
    {children}
  </div>;
}
