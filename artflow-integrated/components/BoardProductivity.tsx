import React,{useState,useRef,useMemo,useEffect} from 'react';
import {createPortal} from 'react-dom';
import type {Board,Element,ImageElement} from '../types';
import type {CanvasViewport,CanvasViewportStore} from '../utils/viewport-store';
import {durableAtlasValue} from '../utils/atlas-document';
import {getElementBounds} from '../utils/canvasUtils';
import {ImageCompare,type CompareImage} from './ImageCompare';
import {exportPortableProject,importPortableProject} from '../utils/portable-project';

interface Props{boards:Board[];activeBoardId:string;selectedIds:string[];setBoards:React.Dispatch<React.SetStateAction<Board[]>>;setActiveBoardId:(id:string)=>void;setSelectedIds:(ids:string[])=>void;viewportStore:CanvasViewportStore;disabled:boolean;onExportPng:()=>void}
interface Version{id:string;createdAt:number;reason:string;name:string;count:number}
interface Pair{kind:string;a:{id:string;name:string};b:{id:string;name:string}}
async function json(url:string,body?:unknown){const response=await fetch(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'操作失败');return value;}
export function BoardProductivity(props:Props){
  const [exportOpen,setExportOpen]=useState(false);
  const [picking,setPicking]=useState(false),[picked,setPicked]=useState<string[]>([]);
  const [markers,setMarkers]=useState<{x:number;y:number;number:number}[]>([]);
  const pickingBoard=useRef('');
  const [open,setOpen]=useState(false),[tab,setTab]=useState('find'),[query,setQuery]=useState('');
  const [versions,setVersions]=useState<Version[]>([]),[pairs,setPairs]=useState<Pair[]>([]),[scanNote,setScanNote]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[compare,setCompare]=useState<CompareImage[]|null>(null);
  const [returnTo,setReturnTo]=useState<{boardId:string;viewport:CanvasViewport}|null>(null);
  const input=useRef<HTMLInputElement>(null),latest=useRef(props);latest.current=props;
  const active=props.boards.find(board=>board.id===props.activeBoardId);
  const images=(active?.elements||[]).filter((element):element is ImageElement=>element.type==='image');
  const run=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setNotice('');try{await task();}catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const snapshot=async(board:Board,manual=true)=>json('/api/board/history',{board:await durableAtlasValue(board),manual});
  useEffect(()=>{
    const backup=async()=>{const current=latest.current;if(current.disabled)return;const board=current.boards.find(item=>item.id===current.activeBoardId);if(!board)return;try{await snapshot(board,false);}catch{setNotice('自动备份失败，请检查本地服务并手动备份');}};
    const timer=setInterval(()=>void backup(),5*60*1000);return()=>clearInterval(timer);
  },[]);
  const loadHistory=async()=>{const value=await json('/api/board/history?board='+encodeURIComponent(props.activeBoardId));setVersions(value.items);};
  useEffect(()=>{if(open&&tab==='history')void run(loadHistory);},[open,tab,props.activeBoardId]);
  const results=useMemo(()=>{
    const text=query.trim().toLowerCase();if(!text)return [];
    const found:{board:Board;element:Element}[]=[];
    for(const board of props.boards)for(const element of board.elements){
      const content=[board.name,element.name,'text'in element?element.text:'','groupNote'in element?element.groupNote:'',...(element.tags||[])].join(' ').toLowerCase();
      if(content.includes(text)&&element.isVisible!==false)found.push({board,element});if(found.length>=100)return found;
    }return found;
  },[props.boards,query]);
  const locate=(board:Board,element:Element)=>{
    setReturnTo({boardId:props.activeBoardId,viewport:props.viewportStore.getLive()});
    if(board.id!==props.activeBoardId)props.setActiveBoardId(board.id);
    props.setSelectedIds([element.id]);const bounds=getElementBounds(element,board.elements),zoom=Math.max(.05,Math.min(1,600/Math.max(bounds.width,bounds.height,1)));
    const viewport={zoom,panOffset:{x:window.innerWidth/2-(bounds.x+bounds.width/2)*zoom,y:window.innerHeight/2-(bounds.y+bounds.height/2)*zoom}};
    props.setBoards(previous=>previous.map(item=>item.id===board.id?{...item,...viewport}:item));
    props.viewportStore.syncDocument(viewport);setOpen(false);
  };
  const toCompare=(source:ImageElement[])=>source.map(image=>({id:image.id,name:image.name||'图片',href:image.originalHref||image.href}));
  const compareSelected=()=>{
    const selected=props.selectedIds.map(id=>images.find(image=>image.id===id)).filter((image):image is ImageElement=>!!image);
    setOpen(false);setExportOpen(false);
    if(selected.length===2){setCompare(toCompare(selected));return;}
    pickingBoard.current=props.activeBoardId;setPicked([]);setPicking(true);
  };
  useEffect(()=>{if(props.disabled||props.activeBoardId!==pickingBoard.current)setPicking(false);},[props.disabled,props.activeBoardId]);
  useEffect(()=>{
    if(!picking)return;
    const stop=(event:MouseEvent|PointerEvent)=>{
      const target=event.target as globalThis.Element;
      if(event.button!==0||!target.closest?.('[data-board-canvas]'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type!=='click')return;
      const node=target.closest('[data-id]'),id=node?.getAttribute('data-id');
      const current=latest.current,board=current.boards.find(item=>item.id===pickingBoard.current);
      const image=board?.elements.find(item=>item.id===id&&item.type==='image');
      if(!image||image.isVisible===false)return;
      const next=picked.includes(image.id)?picked.filter(item=>item!==image.id):[...picked,image.id];
      setPicked(next);
      if(next.length===2){setCompare(toCompare(next.map(item=>board!.elements.find(element=>element.id===item) as ImageElement)));setPicking(false);}
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setPicking(false);}};
    document.addEventListener('pointerdown',stop,true);document.addEventListener('mousedown',stop,true);document.addEventListener('click',stop,true);document.addEventListener('dblclick',stop,true);window.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',stop,true);document.removeEventListener('mousedown',stop,true);document.removeEventListener('click',stop,true);document.removeEventListener('dblclick',stop,true);window.removeEventListener('keydown',escape,true);};
  },[picking,picked]);
  useEffect(()=>{
    if(!picking){setMarkers([]);return;}
    let frame=0;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setMarkers(picked.flatMap((id,index)=>{
      const node=Array.from(document.querySelectorAll('[data-board-canvas] [data-id]')).find(item=>item.getAttribute('data-id')===id);
      if(!node)return [];const bounds=node.getBoundingClientRect();return [{x:bounds.left+8,y:bounds.top+8,number:index+1}];
    })));};
    update();const unsubscribe=props.viewportStore.subscribeLive(update);window.addEventListener('resize',update);
    return()=>{unsubscribe();cancelAnimationFrame(frame);window.removeEventListener('resize',update);};
  },[picking,picked,props.viewportStore]);
  const restore=async(version:Version)=>{
    if(!active||!window.confirm(`恢复「${new Date(version.createdAt).toLocaleString()}」的画板内容？恢复前会自动备份当前内容，其他画板不变。`))return;
    const boardId=active.id;
    await snapshot(active,true);
    const value=await json('/api/board/history/read?board='+encodeURIComponent(boardId)+'&id='+encodeURIComponent(version.id));
    props.setBoards(previous=>previous.map(board=>board.id===boardId?{...value.board,id:boardId,name:board.name,linkedFolderName:board.linkedFolderName,operationHistory:[],operationHistoryIndex:-1}:board));
    props.setSelectedIds([]);setNotice('已恢复历史版本，当前内容已另存备份；请保存画板');await loadHistory();
  };
  const tabs=[['find','快速查找'],['history','历史版本'],['duplicates','重复／相似图']];
  const panel=open&&<div role="dialog" aria-label="整理工具" aria-modal="true" className="fixed inset-x-4 top-20 bottom-8 z-[90] mx-auto flex max-w-3xl flex-col rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] p-4 text-sm text-[var(--ui-text)] shadow-2xl" style={{pointerEvents:'auto'}}>
    <div className="mb-3 flex justify-between"><strong>{tab==='project'?'打包文件':'整理工具'}</strong><button aria-label="关闭整理工具" disabled={busy} onClick={()=>setOpen(false)}>关闭</button></div>
    <div className="mb-4 flex flex-wrap gap-2">{tab!=='project'&&tabs.map(([key,label])=><button key={key} disabled={busy} aria-pressed={tab===key} onClick={()=>{setTab(key);setNotice('');}} className="rounded-full border border-[var(--ui-border)] px-3 py-2" style={tab===key?{background:'var(--bp-accent-soft)'}:undefined}>{label}</button>)}</div>
    {notice&&<p role="status" className="mb-3 rounded-xl bg-[var(--bp-accent-soft)] p-3">{notice}</p>}
    <div className="min-h-0 flex-1 overflow-y-auto space-y-3">
      {tab==='find'&&<><input autoFocus aria-label="查找名称、组名和备注" placeholder="搜索图片名、组名、备注、文字或标签…" value={query} onChange={event=>setQuery(event.target.value)} className="w-full rounded-xl border border-[var(--ui-border)] p-3"/>{returnTo&&<button onClick={()=>{props.setActiveBoardId(returnTo.boardId);props.setBoards(previous=>previous.map(board=>board.id===returnTo.boardId?{...board,...returnTo.viewport}:board));props.viewportStore.syncDocument(returnTo.viewport);setReturnTo(null);setOpen(false);}}>← 回到上一个位置</button>}{results.map(({board,element})=><button key={board.id+element.id} onClick={()=>locate(board,element)} className="block w-full rounded-xl border border-[var(--ui-border)] p-3 text-left">{element.name||('text'in element?element.text:'未命名对象')}<small className="ml-3 opacity-60">{board.name}</small></button>)}{query&&!results.length&&<p>没有匹配内容</p>}</>}
      {tab==='history'&&<><p>当前画板每 5 分钟自动备份一次；保存前也会保护旧内容，最多保留 40 个版本。未变化的内容不会重复备份。</p><button disabled={busy} onClick={()=>void run(async()=>{if(active)await snapshot(active,true);await loadHistory();setNotice('当前画板已备份');})}>立即备份当前画板</button>{versions.map(version=><div key={version.id} className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] p-3"><span>{new Date(version.createdAt).toLocaleString()} · {version.reason}<small className="block opacity-60">{version.count} 个对象</small></span><button disabled={busy} onClick={()=>void run(()=>restore(version))}>恢复</button></div>)}{!versions.length&&<p>尚无历史版本，可先立即备份。</p>}</>}
      {tab==='duplicates'&&<><p>检查图库中完全重复或画面相近的图片。这里只展示候选，不自动删除原图。</p><button disabled={busy} onClick={()=>void run(async()=>{const value=await json('/api/images/duplicates');setPairs(value.pairs);setScanNote(`${value.pairs.length} 组候选${value.truncated?' · 结果达到本次扫描上限':''}${value.missingHashes?' · 部分旧图缺少视觉指纹，仅检查完全重复':''}`);})}>扫描图库</button><p>{scanNote}</p>{pairs.map((pair,index)=><div key={index} className="flex items-center gap-3 rounded-xl border border-[var(--ui-border)] p-3"><img src={'/preview/'+pair.a.id} alt={pair.a.name} className="h-20 w-20 object-contain"/><img src={'/preview/'+pair.b.id} alt={pair.b.name} className="h-20 w-20 object-contain"/><span className="min-w-0 flex-1 break-all">{pair.kind==='exact'?'相同文件':'相似画面'}<small className="block">{pair.a.name} / {pair.b.name}</small></span><button onClick={()=>setCompare([pair.a,pair.b].map(image=>({...image,href:'/media/'+image.id})))}>对照</button></div>)}</>}
      {tab==='project'&&<><p>导出全部画板、图片与备注为便携项目；也可仅导出当前画板。导入会新增画板，不覆盖现有内容。撤销记录不打包，素材合计上限 256MB。</p><div className="flex flex-wrap gap-3">{[false,true].map(current=><button key={String(current)} disabled={busy} onClick={()=>void run(async()=>{const boards=current?(active?[active]:[]):props.boards;const blob=await exportPortableProject(boards,setNotice);const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(current?active?.name||'画板':'完整画板项目')+'.field.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setNotice('便携项目已导出');})}>{current?'导出当前画板':'导出全部画板'}</button>)}<button disabled={busy} onClick={()=>input.current?.click()}>导入便携项目</button><input ref={input} hidden type="file" accept=".zip" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run(async()=>{const boards=await importPortableProject(file,setNotice);if(latest.current.boards.length+boards.length>100)throw Error('导入后画板数量超过 100 个，请减少画板');props.setBoards(previous=>[...previous,...boards]);props.setActiveBoardId(boards[0].id);props.setSelectedIds([]);setNotice(`已新增 ${boards.length} 个画板，请保存画板`);});}}/></div><p className="text-xs opacity-60">超过 256MB 的整库迁移请使用图集设置中的完整备份，包含图库目录与素材。</p></>}
    </div>
  </div>;
  return <><button disabled={props.disabled} onClick={()=>{setTab('find');setNotice('');setOpen(previous=>!previous);}}>整理工具 ▾</button><button disabled={props.disabled||images.length<2} onClick={compareSelected} title="在画板上依次点击两张图片；已选中两张时直接对照">图片对照</button><div style={{position:'relative',pointerEvents:'auto'}}><button disabled={props.disabled} aria-haspopup="menu" aria-expanded={exportOpen} onClick={()=>setExportOpen(value=>!value)}>导出 ▾</button>{exportOpen&&<><div style={{position:'fixed',inset:0,zIndex:94,pointerEvents:'auto'}} onClick={()=>setExportOpen(false)}/><div role="menu" aria-label="导出" className="atlas-export-menu" style={{position:'absolute',right:0,top:'calc(100% + 8px)',zIndex:95,display:'flex',flexDirection:'column',gap:4,minWidth:168,padding:6,border:'1px solid #e4cddd',borderRadius:12,background:'#fffafd',boxShadow:'0 10px 30px #60384b26',pointerEvents:'auto'}}><button style={{width:'100%',minHeight:38,justifyContent:'flex-start',boxSizing:'border-box',margin:0,whiteSpace:'nowrap',background:'transparent',color:'#80566f',border:'none',borderRadius:8,padding:'10px 14px',fontSize:13,textAlign:'left'}} role="menuitem" onClick={()=>{setExportOpen(false);setTab('project');setNotice('');setOpen(true);}}>打包文件</button><button style={{width:'100%',minHeight:38,justifyContent:'flex-start',boxSizing:'border-box',margin:0,whiteSpace:'nowrap',background:'transparent',color:'#80566f',border:'none',borderRadius:8,padding:'10px 14px',fontSize:13,textAlign:'left'}} role="menuitem" disabled={!active?.elements.length} onClick={()=>{setExportOpen(false);props.onExportPng();}}>PNG</button></div></>}</div>{createPortal(<>{open&&<div className="fixed inset-0 z-[89] bg-black/20" style={{pointerEvents:'auto'}}/>}{panel}{picking&&<><div role="status" className="fixed bottom-20 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-color)] px-5 py-3 text-[var(--ui-text)] shadow-xl" style={{pointerEvents:'auto'}}>点击画板上的图片 {picked.length+1} · {picked.length}/2<button onClick={()=>setPicking(false)}>取消</button></div>{markers.map(marker=><span key={marker.number} className="fixed z-[94] grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#a56b91] font-bold text-white shadow-lg" style={{left:marker.x,top:marker.y,pointerEvents:'none'}}>{marker.number}</span>)}</>}{compare&&<ImageCompare immediate images={compare} onClose={()=>setCompare(null)}/>}</>,document.getElementById('root')||document.body)}</>;
}
