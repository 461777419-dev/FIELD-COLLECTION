import React, {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Save,Download,Settings2,FolderOpen,Contrast} from 'lucide-react';
import type {Board,Element} from '../types';
import {createNewBoard} from '../utils/canvasUtils';
import type {CanvasViewportStore} from '../utils/viewport-store';
import {composeExportPng} from '../capabilities/canvas-export/compose';
import {getElementBounds} from '../utils/canvasUtils';
import {durableAtlasValue} from '../utils/atlas-document';
import {mergeAtlasSync} from '../utils/atlas-sync';
import {createCanvasNavigatorModel,fitCanvasViewport} from '../utils/canvasNavigator';
import {AtlasSelectionTools} from './AtlasSelectionTools';

interface Props {
  dirty:boolean; boards: Board[]; activeBoardId:string; elements:Element[]; selectedIds:string[];
  setSelectedIds:(ids:string[])=>void;
  setBoards: React.Dispatch<React.SetStateAction<Board[]>>;
  setActiveBoardId:(id:string)=>void; addElements:(elements:Element[])=>void;
  onSave:()=>Promise<boolean>; viewportStore:CanvasViewportStore;
  onRestored:()=>void; onOpenSettings:()=>void;
  savedBaseline:Board[];
  onGrayscale:()=>void;
  onHydrated:(boards:Board[],dirty:boolean,baseline:Board[])=>void;
}
export function AtlasBoard(props:Props) {
  const integrated = location.pathname.startsWith('/board/');
  const latest = useRef(props); latest.current=props;
  const [ready,setReady]=useState(false),[status,setStatus]=useState('正在读取本地画板…');
  const [busy,setBusy]=useState(false);
  const [suspended,setSuspended]=useState(false);
  const [links,setLinks]=useState<{boardId:string;folderId:string;name:string;directory:string}[]>([]);
  const catalogBusy=useRef(false);
  const autoBusy=useRef(false);
  const synced=useRef<{boards:Board[];activeBoardId:string;revision:string}|null>(null);
  const knownBoardIds=useRef<string[]>([]);
  const autoSyncRef=useRef<()=>Promise<void>>(async()=>{});
  const [syncError,setSyncError]=useState(false);
  const syncRef=useRef<()=>Promise<void>>(async()=>{});
  const linksRef=useRef(links);linksRef.current=links;
  const baseline = useRef<Board[] | null>(null);
  const sourcePoint=useRef<{x:number;y:number}|null>(null);
  const takeSnapshot=async()=>{
    const current=latest.current,viewport=current.viewportStore.getLive();
    return durableAtlasValue({boards:current.boards.map(board=>board.id===current.activeBoardId?{...board,...viewport}:board),activeBoardId:current.activeBoardId,dirty:current.dirty,savedBaseline:current.dirty?current.savedBaseline:undefined});
  };
  useEffect(()=>{
    if (!integrated) return;
    document.documentElement.classList.add('doro-board');
    let mounted=true;
    fetch('/api/board/document').then(r=>{if(!r.ok)throw Error('工程读取失败');return r.json();}).then(doc=>{
      if(!mounted)return;
      if(doc.boards?.length){latest.current.setBoards(doc.boards);latest.current.setActiveBoardId(doc.activeBoardId || doc.boards[0].id); baseline.current=doc.boards;knownBoardIds.current=doc.boards.map((board:Board)=>board.id);latest.current.onRestored();}
      else { baseline.current=latest.current.boards; latest.current.onRestored(); }
      setStatus(doc.boards?'本地画板已恢复':'新画板 · 尚未保存');setReady(true);
      parent.postMessage({type:'atlas:ready'},location.origin);
    }).catch(error=>setStatus(String(error)+'，请重新加载后再编辑'));
    const receive=async(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==parent)return;
      if(event.data?.type==='atlas:editor-lock')setSuspended(!!event.data.locked);
      if(event.data?.type==='atlas:sync-catalog')void syncRef.current().catch(error=>setStatus(error.message));
      if(event.data?.type==='atlas:request-snapshot'){
        try{parent.postMessage({type:'atlas:snapshot',requestId:event.data.requestId,snapshot:await takeSnapshot()},location.origin);}
        catch(error){parent.postMessage({type:'atlas:snapshot-error',requestId:event.data.requestId,message:String(error)},location.origin);}
      }
      if(event.data?.type==='atlas:hydrate'){
        const snapshot=event.data.snapshot;
        if(!Array.isArray(snapshot?.boards)||!snapshot.boards.length)return;
        knownBoardIds.current=snapshot.boards.map((board:Board)=>board.id);
        latest.current.setBoards(snapshot.boards);latest.current.setActiveBoardId(snapshot.activeBoardId);
        const active=snapshot.boards.find((board:Board)=>board.id===snapshot.activeBoardId);
        if(active)latest.current.viewportStore.syncDocument({zoom:active.zoom,panOffset:active.panOffset});
        latest.current.onHydrated(snapshot.boards,!!snapshot.dirty,snapshot.savedBaseline || snapshot.boards);
        setStatus(snapshot.dirty?'编辑已移回 · 请保存':'工作区已恢复');
        setTimeout(()=>parent.postMessage({type:'atlas:hydrated',requestId:event.data.requestId},location.origin),0);
      }
      if(event.data?.type==='atlas:close-transfer'){
        // Acknowledged handoff: this iframe is about to be removed, without discarding edits.
        window.dispatchEvent(new Event('atlas-transfer-complete'));
      }
      if(event.data?.type==='atlas:save'){const ok=await latest.current.onSave();setStatus(ok?'已保存到本地图库':'保存失败');parent.postMessage({type:'atlas:saved',ok},location.origin);}
      if(event.data?.type!=='atlas:add')return;
      try {
        const ids=event.data.ids;
        const items=Array.isArray(ids) ? (await fetch('/api/state').then(r=>r.json())).images.filter((image:{id:string})=>ids.includes(image.id)) : event.data.images;
        if(!Array.isArray(items)||items.length>100)throw Error('素材数量无效');
        const viewport=latest.current.viewportStore.getLive();
        const point=sourcePoint.current;sourcePoint.current=null;
        const baseX=((point?.x ?? innerWidth/2)-viewport.panOffset.x)/viewport.zoom;
        const baseY=((point?.y ?? innerHeight/2)-viewport.panOffset.y)/viewport.zoom;
        const additions:Element[]=[];
        for(const [index,item] of items.entries()){
          if(!/^[a-f0-9-]{36}$/.test(item.id))throw Error('素材编号无效');
          if(String(item.type||'').startsWith('video/')){
            additions.push({id:crypto.randomUUID(),type:'video',name:item.name,href:'/media/'+item.id,mimeType:item.type,width:360,height:240,x:baseX-180+(index%3)*400,y:baseY-120+Math.floor(index/3)*340,rotation:0});continue;
          }
          if(item.hasPreview===false)continue;
          const image=new Image();image.src='/canvas-image/'+item.id;await image.decode();
          const scale=Math.min(1,360/image.naturalWidth,300/image.naturalHeight);
          additions.push({id:crypto.randomUUID(),type:'image',name:item.name,href:'/preview/'+item.id,originalHref:'/media/'+item.id,mimeType:item.type || 'image/png',width:image.naturalWidth*scale,height:image.naturalHeight*scale,x:baseX-180+(index%3)*42,y:baseY-120+Math.floor(index/3)*42,rotation:0});
        }
        if(!latest.current.elements.length&&additions.length){
          const fit=fitCanvasViewport(createCanvasNavigatorModel(additions).contentBounds,{width:innerWidth,height:innerHeight},120);
          if(fit)latest.current.viewportStore.syncDocument(fit);
        }
        latest.current.addElements(additions);setStatus('已添加 '+additions.length+' 张图库素材 · 请保存');
        parent.postMessage({type:'atlas:added'},location.origin);
      }catch(error){setStatus('添加失败：'+String(error));parent.postMessage({type:'atlas:add-failed',message:String(error)},location.origin);}
    };
    window.addEventListener('message',receive);
    const dragOver=(event:DragEvent)=>{if(event.dataTransfer?.types.includes('application/x-journal-images')){event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';}};
    const drop=(event:DragEvent)=>{const raw=event.dataTransfer?.getData('application/x-journal-images');if(!raw)return;event.preventDefault();event.stopImmediatePropagation();try{sourcePoint.current={x:event.clientX,y:event.clientY};void receive({origin:location.origin,source:parent,data:{type:'atlas:add',ids:JSON.parse(raw)}} as MessageEvent);}catch{setStatus('拖入素材无效');}};
    const paste=(event:ClipboardEvent)=>{if((event.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]'))return;try{const data=JSON.parse(event.clipboardData?.getData('text/plain') || '');if(data.type!=='atlas-images')return;event.preventDefault();event.stopImmediatePropagation();void receive({origin:location.origin,source:parent,data:{type:'atlas:add',ids:data.ids}} as MessageEvent);}catch{}};
    window.addEventListener('dragover',dragOver,true);window.addEventListener('drop',drop,true);window.addEventListener('paste',paste,true);
    return()=>{mounted=false;window.removeEventListener('message',receive);window.removeEventListener('dragover',dragOver,true);window.removeEventListener('drop',drop,true);window.removeEventListener('paste',paste,true);};
  },[integrated]);
  useEffect(()=>{
    if(!integrated||!ready)return;
    parent.postMessage({type:'atlas:state',count:props.elements.length},location.origin);
  },[props.boards,ready,integrated]);
  useEffect(()=>{
    if(!integrated||!ready)return;
    // Keep the owning window's recovery snapshot current, including camera-only changes.
    let timer:ReturnType<typeof setTimeout>;
    const send=()=>{clearTimeout(timer);timer=setTimeout(()=>{void takeSnapshot().then(snapshot=>parent.postMessage({type:'atlas:snapshot-update',snapshot},location.origin)).catch(()=>{});},160);};
    send();const off=props.viewportStore.subscribeRender(send);
    return()=>{clearTimeout(timer);off();};
  },[props.boards,props.activeBoardId,props.dirty,ready,integrated]);
  const syncCatalog=async()=>{
    if(catalogBusy.current||suspended)return;
    catalogBusy.current=true;
    const names=new Map(latest.current.boards.map(board=>[board.id,board.name]));
    try{
      const response=await fetch('/api/board/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({boards:latest.current.boards.map(({id,name,linkedFolderName})=>({id,name,linkedFolderName}))})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'目录同步失败');
      const archived=latest.current.boards.filter(board=>data.archivedIds?.includes(board.id));
      if(archived.length){
        const snapshot=await durableAtlasValue(archived);
        const recovery=await fetch('/api/board/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({boards:snapshot})});
        if(!recovery.ok)throw Error('文件夹已删除，当前编辑备份失败；内容仍保留，请勿关闭');
        setStatus('对应文件夹已删除 · 当前画板编辑已存入恢复备份');
        if(!data.links.length){
          const replacement=createNewBoard('画板 1');
          const created=await fetch('/api/board/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({boards:[replacement]})});
          if(!created.ok)throw Error('创建替代画板失败，当前编辑仍保留');
          data.links=(await created.json()).links;
        }
      }
      linksRef.current=data.links;setLinks(data.links);
      latest.current.setBoards(previous=>{
        let changed=false;
        const next=previous.filter(board=>!data.archivedIds?.includes(board.id)).map(board=>{const link=data.links.find((item:{boardId:string})=>item.boardId===board.id);if(link&&(link.name!==board.name||board.linkedFolderName!==link.name)&&names.get(board.id)===board.name){changed=true;return {...board,name:link.name,linkedFolderName:link.name};}return board;});
        if(next.length!==previous.length)changed=true;
        for(const link of data.links)if(!next.some(board=>board.id===link.boardId)){changed=true;next.push({...createNewBoard(link.name),id:link.boardId,linkedFolderName:link.name});}
        return changed?next:previous;
      });
      if(archived.some(board=>board.id===latest.current.activeBoardId)&&data.links[0])latest.current.setActiveBoardId(data.links[0].boardId);
      parent.postMessage({type:'atlas:collected',silent:true},location.origin);
    }finally{catalogBusy.current=false;}
  };
  syncRef.current=async()=>{if(ready&&!suspended)await syncCatalog();};
  const catalogKey=props.boards.map(board=>board.id+':'+board.name).join('|');
  useEffect(()=>{
    if(!integrated||!ready||suspended)return;
    const timer=setTimeout(()=>{void syncCatalog().catch(error=>setStatus('目录同步失败：'+error.message));},450);
    const focus=()=>{void syncCatalog().catch(error=>setStatus(error.message));};
    window.addEventListener('focus',focus);
    return()=>{clearTimeout(timer);window.removeEventListener('focus',focus);};
  },[catalogKey,ready,integrated,suspended]);
  autoSyncRef.current=async()=>{
    if(autoBusy.current||!ready||suspended)return;
    autoBusy.current=true;
    const sent=latest.current.boards;
    const camera=latest.current.viewportStore.getLive();
    try{
      if(synced.current?.boards===sent&&synced.current.activeBoardId===latest.current.activeBoardId){
        const response=await fetch('/api/board/revision');
        if(!response.ok)throw Error('无法检查素材变化');
        if((await response.json()).revision===synced.current.revision)return;
      }
      const snapshot=await durableAtlasValue({boards:sent.map(({operationHistory,...board})=>({...board,operationHistory:[],operationHistoryIndex:-1})),activeBoardId:latest.current.activeBoardId});
      const request=async(confirmedDeleteIds?:string[])=>{
        const response=await fetch('/api/board/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...snapshot,confirmedDeleteIds,deletedBoardIds:knownBoardIds.current.filter(id=>!sent.some(board=>board.id===id))})});
        const data=await response.json();if(!response.ok)throw Error(data.error||'素材同步失败');return data;
      };
      let data=await request();
      if(data.needsConfirmation){
        const names=[...new Set(data.affected.map((board:{name:string})=>board.name))].join('、');
        if(!window.confirm('此素材也被以下画板引用：'+names+'。继续删除会同步移除并放入图集回收站，是否继续？')){
          latest.current.setBoards(current=>current.map(board=>{
            const missing=data.restore.filter((item:{boardId:string;element:Element})=>item.boardId===board.id&&!board.elements.some(element=>element.id===item.element.id)).map((item:{element:Element})=>item.element);
            return missing.length?{...board,elements:[...board.elements,...missing]}:board;
          }));
          setStatus('已取消联动删除');return;
        }
        data=await request(data.deleteIds);
      }
      const received=data.boards as Board[];knownBoardIds.current=received.map(board=>board.id);
      const active=received.find(board=>board.id===latest.current.activeBoardId);
      const nowCamera=latest.current.viewportStore.getLive();
      let fitted:ReturnType<typeof fitCanvasViewport>=null;
      if(active&&data.fitBoardIds?.includes(active.id)&&JSON.stringify(camera)===JSON.stringify(nowCamera)){
        fitted=fitCanvasViewport(createCanvasNavigatorModel(active.elements).contentBounds,{width:innerWidth,height:innerHeight},120);
        if(fitted)latest.current.viewportStore.syncDocument(fitted);
      }
      latest.current.setBoards(current=>{
        const merged=mergeAtlasSync(current,sent,received);
        const next=fitted?merged.map(board=>board.id===active?.id?{...board,...fitted}:board):merged;
        // A newer local edit must trigger another sync rather than being marked clean.
        if(current===sent)synced.current={boards:next,activeBoardId:snapshot.activeBoardId,revision:data.revision};
        return next;
      });
      linksRef.current=data.links;setLinks(data.links);
      setSyncError(false);setStatus('素材已自动同步 · 删除进入回收站');
      if(data.changed)parent.postMessage({type:'atlas:collected',silent:true},location.origin);
    }catch(error){setSyncError(true);setStatus('自动同步失败：'+String(error)+' · 将自动重试');}
    finally{autoBusy.current=false;}
  };
  useEffect(()=>{
    if(!integrated||!ready||suspended)return;
    const timer=setTimeout(()=>void autoSyncRef.current(),650);
    return()=>clearTimeout(timer);
  },[props.boards,ready,integrated,suspended]);
  useEffect(()=>{
    if(!integrated||!ready||suspended)return;
    const timer=setInterval(()=>void autoSyncRef.current(),2500);
    const focus=()=>void autoSyncRef.current();window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};
  },[ready,integrated,suspended]);
  if(!integrated)return null;
  const save=async()=>{setBusy(true);try{const ok=await props.onSave();if(ok)baseline.current=props.boards;setStatus(ok?'已保存到本地图库':'保存失败，请重试');}finally{setBusy(false);}};
  const exportImage=async()=>{
    setBusy(true);
    try {
      const all=props.elements;
      const boxes=all.map(el=>getElementBounds(el,all));
      const width=Math.max(...boxes.map(b=>b.x+b.width))-Math.min(...boxes.map(b=>b.x));
      const height=Math.max(...boxes.map(b=>b.y+b.height))-Math.min(...boxes.map(b=>b.y));
      if(width>10000||height>10000||width*height>16000000)throw Error('画板尺寸过大，请缩小内容或分批导出');
      const composed=await composeExportPng({elements:all,background:'#fff9fc',selectionIds:[]},false);
      if(!composed)throw Error('请先添加内容');
      const url=URL.createObjectURL(composed.blob);const a=document.createElement('a');a.href=url;a.download='画板.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus('PNG 已导出');
    }catch(error){setStatus(String(error));}finally{setBusy(false);}
  };
  const actions = <div className="doro-actions" role="toolbar" aria-label="图集画板操作">
      <AtlasSelectionTools elements={props.elements} selectedIds={props.selectedIds} activeBoardId={props.activeBoardId} setSelectedIds={props.setSelectedIds} ready={ready} suspended={suspended}/>
      {syncError&&<button onClick={()=>void autoSyncRef.current()}>重试同步</button>}
      <span className="doro-save-state" role="status" title={status}>{props.dirty ? '未保存 · '+status : status}</span>
      <button disabled={!ready||busy||suspended||!props.elements.length} onClick={props.onGrayscale} title="有选区时切换选中内容的去色；没有选区时切换整张画板。Ctrl+Z 撤销，原图不变。"><Contrast size={15}/>{props.elements.length>0&&props.elements.filter(element=>!element.isLocked&&(!props.selectedIds.length||props.selectedIds.includes(element.id))).every(element=>element.grayscale)?'恢复色彩':'一键去色'}</button>
      <button disabled={!ready||busy||suspended} onClick={async()=>{try{const link=linksRef.current.find(item=>item.boardId===props.activeBoardId);if(!link)throw Error('请先同步目录');const r=await fetch('/api/folders/'+link.folderId+'/open',{method:'POST'});if(!r.ok)throw Error((await r.json()).error);}catch(error){setStatus(String(error));}}} title={links.find(item=>item.boardId===props.activeBoardId)?.directory||'打开对应的本地文件夹'}><FolderOpen size={15}/>本地目录</button>
      <button className="atlas-save" disabled={!ready||busy||suspended} onClick={save}><Save size={15}/>保存画板</button>
      <button disabled={!ready||busy||!props.elements.length} onClick={()=>exportImage()}><Download size={15}/>导出 PNG</button>
    </div>;
  const host = window.parent !== window ? window.parent.document.getElementById('boardActionsHost') : null;
  return <>
    {host ? createPortal(actions,host) : actions}
    {ready && !props.elements.length && <div className="doro-empty">
      <img src="/assets/doro/board-icon.png" alt="Doro 拿着画笔与画板"/>
      <span className="doro-eyebrow">DORO'S LITTLE STUDIO</span>
      <h1>把灵感，放在一起</h1>
      <p>从图集添加参考图，或将文件拖入画布。<br/>在这张小小的画板上，整理你的下一次创作。</p>
      <div><button onClick={()=>parent.postMessage({type:'atlas:gallery'},location.origin)}><FolderOpen size={16}/>去图集挑选素材</button><button onClick={()=>parent.postMessage({type:'atlas:ai-settings'},location.origin)}><Settings2 size={16}/>AI 设置</button></div>
    </div>}
    {!ready && <div className="doro-loading" role="status">{status}</div>}
    <div className="doro-help">滚轮：缩放 · 空格拖动：平移 · Shift：多选 · Ctrl+S：保存 · Ctrl+Z：撤销</div>
  </>;
}

