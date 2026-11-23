import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Settings2,Ungroup,Layers,Palette} from 'lucide-react';
import type {Element,GroupElement} from '../types';
import {groupColor} from '../utils/groupAppearance';
interface Props {element:GroupElement;zoom:number;onChange:(id:string,properties:Partial<Element>)=>void;onUngroup:()=>void;onMerge:()=>void}
export function GroupToolbar({element,zoom,onChange,onUngroup,onMerge}:Props){
  const [name,setName]=useState(element.name||'编组'),[note,setNote]=useState(element.groupNote||'');
  useEffect(()=>{setName(element.name||'编组');setNote(element.groupNote||'');},[element.id,element.name,element.groupNote]);
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12});
  const anchor=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const r=anchor.current?.getBoundingClientRect();if(!r)return;const height=panel.current?.offsetHeight||360;setPosition({left:Math.max(12,Math.min(r.left,innerWidth-300)),top:Math.max(12,Math.min(r.bottom+10,innerHeight-height-12))});};
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!anchor.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    place();window.addEventListener('resize',place);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open,zoom]);
  const commit=()=>{const nextName=name.trim()||'编组';if(nextName!==element.name||note!== (element.groupNote||''))onChange(element.id,{name:nextName,groupNote:note});};
  return <div data-group-toolbar style={{transform:`scale(${1/zoom})`,transformOrigin:'top left',width:172,color:'#765b70',fontSize:13,fontFamily:'system-ui,sans-serif'}}
    onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onKeyUp={event=>event.stopPropagation()}>
    <div className="canvas-action-surface">
      <label className="canvas-action-button" title="编组颜色"><Palette size={18} strokeWidth={1.7}/><input aria-label="编组颜色" type="color" value={groupColor(element)} onChange={event=>onChange(element.id,{groupColor:event.target.value})} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,cursor:'pointer'}}/></label>
      <button ref={anchor} className="canvas-action-button" aria-label="编组设置" title="编组设置" aria-expanded={open} onClick={()=>setOpen(!open)}><Settings2 size={18} strokeWidth={1.7}/></button>
      <button className="canvas-action-button" aria-label="取消编组" title="取消编组" onClick={onUngroup}><Ungroup size={18} strokeWidth={1.7}/></button>
      <button className="canvas-action-button" aria-label="合并编组为图片" title="合并编组为图片" onClick={onMerge}><Layers size={18} strokeWidth={1.7}/></button>
    </div>
    {open&&typeof document!=='undefined'&&createPortal(<div ref={panel} role="dialog" aria-label="编组设置" onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onKeyUp={event=>event.stopPropagation()}
      style={{position:'fixed',...position,zIndex:1000,width:288,maxWidth:'calc(100vw - 24px)',maxHeight:'calc(100vh - 24px)',overflowY:'auto',padding:14,boxSizing:'border-box',background:'#fffafd',color:'#765b70',font:'13px system-ui,sans-serif',border:'1px solid #eadce5',borderRadius:14,boxShadow:'0 8px 28px #765b7024',display:'grid',gap:8}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontWeight:600}}>编组设置<button aria-label="关闭编组设置" onClick={()=>setOpen(false)} style={{padding:'2px 6px'}}>×</button></div>
          <div role="group" aria-label="编组预设颜色" style={{display:'flex',gap:8}}>{['#477FA8','#53764C','#9B6E9D','#BE8547','#A65C63','#687787'].map(color=><button key={color} aria-label={`编组配色 ${color}`} title={color} onClick={()=>onChange(element.id,{groupColor:color})} style={{width:26,height:26,borderRadius:5,background:color,border:groupColor(element).toLowerCase()===color.toLowerCase()?'2px solid #152334':'2px solid transparent',boxShadow:'inset 0 0 0 1px #ffffff50'}}/>)}</div>
          <label htmlFor={'group-name-'+element.id}>名称</label><input id={'group-name-'+element.id} aria-label="编组名称" maxLength={100} value={name} onChange={event=>setName(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){commit();event.currentTarget.blur();}}} style={{padding:8,border:'1px solid #d8dee7',borderRadius:6,width:'100%',boxSizing:'border-box'}}/>
          <label htmlFor={'group-note-'+element.id}>备注</label><textarea id={'group-note-'+element.id} aria-label="编组备注" maxLength={2000} rows={3} value={note} onChange={event=>setNote(event.target.value)} onBlur={commit} placeholder="添加用途、灵感或整理说明" style={{padding:8,border:'1px solid #d8dee7',borderRadius:6,resize:'vertical',width:'100%',boxSizing:'border-box'}}/>
          <label style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={!!element.groupNoteCollapsed} onChange={event=>onChange(element.id,{groupNoteCollapsed:event.target.checked})}/>折叠框内备注</label>
          <button onClick={commit} style={{padding:7,borderRadius:6,border:'1px solid #c8d6e5',background:'#edf3f9'}}>保存名称与备注</button>
    </div>,document.body)}
  </div>;
}
