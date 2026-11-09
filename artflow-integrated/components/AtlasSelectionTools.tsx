import React, {useEffect,useRef,useState} from 'react';
import {Copy,Download} from 'lucide-react';
import type {Element,ImageElement} from '../types';
import {boardSelection,gallerySelection,type GalleryIdentity} from '../utils/atlas-selection';
import {selectionPng,copyCanvasElements} from '../utils/canvasClipboard';

interface Props {
  elements:Element[]; selectedIds:string[]; activeBoardId:string;
  setSelectedIds:(ids:string[])=>void; ready:boolean; suspended:boolean;
  onRevealSelection:(ids:string[])=>boolean;
}
interface ExportFile { file:File; url:string; galleryId?:string; boardFile?:string }
export function AtlasSelectionTools(props:Props) {
  const latest=useRef(props);latest.current=props;
  const catalog=useRef<GalleryIdentity[]>([]);
  const incoming=useRef<{ids:string[];revealKey:string|null}|null>(null);
  const lastRevealed=useRef<string|null>(null);
  const expected=useRef<string|null>(null);
  const lastSelection=useRef('[]');
  const selectionReady=useRef(false);
  const [exports,setExports]=useState<ExportFile[]>([]);
  const [message,setMessage]=useState('');
  const [preparing,setPreparing]=useState(false);
  const key=JSON.stringify(props.selectedIds);
  const apply=()=>{
    if(!latest.current.ready||latest.current.suspended||incoming.current===null)return;
    const ids=boardSelection(latest.current.elements,incoming.current.ids,catalog.current);
    expected.current=JSON.stringify(ids);lastSelection.current=expected.current;
    if(JSON.stringify(latest.current.selectedIds)!==expected.current)latest.current.setSelectedIds(ids);
    const revealKey=incoming.current.revealKey;
    if(revealKey&&revealKey!==lastRevealed.current&&ids.length&&latest.current.onRevealSelection(ids))lastRevealed.current=revealKey;
    incoming.current=null;selectionReady.current=true;
  };
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==parent)return;
      if(event.data?.type==='atlas:hydrate'){selectionReady.current=false;return;}
      if(event.data?.type==='atlas:editor-lock'){
        if(event.data.locked)selectionReady.current=false;
        else parent.postMessage({type:'atlas:selection-request'},location.origin);
        return;
      }
      if(event.data?.type!=='atlas:selection-apply'||!Array.isArray(event.data.ids))return;
      catalog.current=Array.isArray(event.data.catalog)?event.data.catalog:[];
      incoming.current={ids:event.data.ids,revealKey:event.data.reveal?`${event.data.author||''}:${event.data.clock||JSON.stringify(event.data.ids)}`:null};apply();
    };
    window.addEventListener('message',receive);
    return()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{apply();},[props.ready,props.suspended,props.elements]);
  useEffect(()=>{
    selectionReady.current=false;
    if(props.ready&&!props.suspended)parent.postMessage({type:'atlas:selection-request'},location.origin);
  },[props.ready,props.suspended,props.activeBoardId]);
  useEffect(()=>{
    if(!props.ready||props.suspended||incoming.current!==null||!selectionReady.current)return;
    if(expected.current===key){expected.current=null;return;}
    if(lastSelection.current===key)return;
    lastSelection.current=key;
    const ids=gallerySelection(props.elements,props.selectedIds,catalog.current);
    parent.postMessage({type:'atlas:selection-changed',ids,focusId:ids.at(-1)},location.origin);
  },[key,props.ready,props.suspended,props.activeBoardId]);
  useEffect(()=>{
    let cancelled=false;
    setExports([]);setMessage('');
    const selected=props.elements.filter((element):element is ImageElement=>props.selectedIds.includes(element.id)&&element.type==='image');
    if(!selected.length||!props.ready||props.suspended){setPreparing(false);return;}
    if(selected.length>100){setMessage('一次最多拖出 100 张图片');setPreparing(false);return;}
    setPreparing(true);
    void (async()=>{
      const prepared:ExportFile[]=[];
      for(const element of selected){
        if(cancelled)return;
        const raw=!element.grayscale&&(element.opacity??1)===1&&!element.rotation&&!element.borderRadius;
        let url=element.originalHref||element.href;
        let galleryId=/^\/media\/([a-f0-9-]{36})$/.exec(url)?.[1]||/^\/preview\/([a-f0-9-]{36})$/.exec(url)?.[1];
        let blob:Blob;
        if(raw){
          if(galleryId)url='/media/'+galleryId;
          const response=await fetch(url);if(!response.ok)throw Error('读取原图失败');
          blob=await response.blob();
        }else{blob=await selectionPng([element]);galleryId=undefined;}
        let boardFile=/^\/board-media\/([a-f0-9]{64}\.[a-z0-9]+)$/.exec(url)?.[1];
        if(!raw||(!galleryId&&!boardFile)){
          const response=await fetch('/api/board/media',{method:'POST',headers:{'Content-Type':blob.type},body:blob});
          if(!response.ok)throw Error('准备拖出文件失败');
          url=(await response.json()).url;
          boardFile=/^\/board-media\/(.+)$/.exec(url)?.[1];
        }
        const extension=raw?(boardFile?.split('.').at(-1)||blob.type.split('/')[1]?.replace('jpeg','jpg')||'png'):'png';
        const name=(element.name||'画板图片').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
        prepared.push({file:new File([blob],name.toLowerCase().endsWith('.'+extension)?name:name+'.'+extension,{type:blob.type}),url,galleryId,boardFile});
      }
      if(!cancelled)setExports(prepared);
    })().catch(error=>{if(!cancelled)setMessage(String(error));}).finally(()=>{if(!cancelled)setPreparing(false);});
    return()=>{cancelled=true;};
  },[props.elements,key,props.ready,props.suspended]);
  const selected=props.elements.filter(element=>props.selectedIds.includes(element.id)&&element.type==='image');
  const drag=(event:DragEvent)=>{
    if(!exports.length||preparing||props.suspended){event.preventDefault();setMessage(preparing?'正在准备原图，请稍后再拖动小图标':'图片尚未就绪，请重新选择后重试');return;}
    const native=!!((parent as Window & {__TAURI__?:unknown;__TAURI_INTERNALS__?:unknown}).__TAURI__||(parent as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__);
    if(native){
      event.preventDefault();
      parent.postMessage({type:'atlas:drag-out',ids:exports.flatMap(item=>item.galleryId?[item.galleryId]:[]),boardFiles:exports.flatMap(item=>item.boardFile?[item.boardFile]:[])},location.origin);
    }else{
      if(!event.dataTransfer)return;
      event.dataTransfer.effectAllowed='copy';
      for(const item of exports)event.dataTransfer.items.add(item.file);
      const item=exports[0];
      event.dataTransfer.setData('DownloadURL',`${item.file.type}:${item.file.name}:${new URL(item.url,location.origin).href}`);
      setMessage('浏览器拖出取决于接收软件；失败时请点“另存图片”');
    }
  };
  useEffect(()=>{
    const receive=(event:Event)=>{
      const {id,event:dragEvent}=(event as CustomEvent<{id:string;event:DragEvent}>).detail;
      if(!props.selectedIds.includes(id))return;
      drag(dragEvent);
    };
    window.addEventListener('atlas:image-drag-start',receive);
    return()=>window.removeEventListener('atlas:image-drag-start',receive);
  },[exports,preparing,props.suspended,key]);
  if(!selected.length||props.suspended)return null;
  return <span className="atlas-selection-tools">
    <button onClick={()=>void copyCanvasElements(selected).then(()=>setMessage('已复制图片')).catch(error=>setMessage(String(error)))} title="复制图片到外部软件"><Copy size={15}/>复制图片</button>
    <button disabled={!exports.length||preparing} onClick={()=>{for(const item of exports){const url=URL.createObjectURL(item.file);const a=document.createElement('a');a.href=url;a.download=item.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}}}><Download size={15}/>另存图片</button>
    {message&&<span className="atlas-selection-feedback" role="status">{message}</span>}
  </span>;
}
