/* Selection is transient and session-scoped; never saved into a board document. */
(() => {
  const params=new URLSearchParams(location.search);
  const token=params.get('owner')||sessionStorage.getItem('atlas-window-session')||crypto.randomUUID();
  if(!params.get('owner'))sessionStorage.setItem('atlas-window-session',token);
  const self=crypto.randomUUID(),channel=new BroadcastChannel('atlas-selection-'+token);
  let applying=false,lastGallery='[]',latest=null,clock=0,transferring=0;
  const catalog=()=>state.images.map(({id,contentHash})=>({id,contentHash}));
  function toBoard(message){
    const workspace=window.atlasWorkspace;
    if(workspace?.isFrameReady())workspace.getFrame().contentWindow.postMessage({...message,type:'atlas:selection-apply',catalog:catalog()},location.origin);
  }
  function apply(message,{board=true}={}){
    latest=message;
    if(!transferring){
      applying=true;
      try{
        const available=new Set(state.images.map(image=>image.id));
        state.selectedIds=message.ids.filter(id=>available.has(id));
        state.selectedId=state.selectedIds.at(-1)||null;
        lastGallery=JSON.stringify([...state.selectedIds].sort());
        document.querySelectorAll('.image-card').forEach(card=>card.classList.toggle('selected',state.selectedIds.includes(card.dataset.id)));
        renderInspector();
      }finally{applying=false;}
    }
    if(board&&!transferring)toBoard(message);
  }
  const owns=tool=>window.atlasOwnsWorkspace?.(tool)??true;
  const replay=()=>{if(latest)apply(latest);};
  window.atlasSelectionTransfer=active=>{transferring=Math.max(0,transferring+(active?1:-1));if(!transferring)replay();};
  function publish(message){
    clock=Math.max(clock+1,Date.now());
    message={...message,clock,author:self};
    apply(message,{board:message.source!=='board'});
    channel.postMessage({type:'selection',message,from:self});
  }
  window.atlasGallerySelectionChanged=()=>{
    const ids=state.view==='trash'?[]:[...state.selectedIds];
    const key=JSON.stringify([...ids].sort());
    if(applying||transferring||!owns('gallery')||key===lastGallery)return;
    lastGallery=key;publish({source:'gallery',ids});
  };
  channel.onmessage=({data})=>{
    if(data.from===self)return;
    if(data.type==='hello'){if(latest)channel.postMessage({type:'selection',message:latest,from:self,to:data.from});return;}
    if(data.to&&data.to!==self)return;
    if(data.type==='selection'&&['board','gallery'].includes(data.message?.source)&&Array.isArray(data.message.ids)&&data.message.ids.length<=10000){
      const message=data.message;
      clock=Math.max(clock,Number(message.clock)||0);
      if(latest&&(message.clock<latest.clock||(message.clock===latest.clock&&message.author<=latest.author)))return;
      apply(message);
    }
  };
  channel.postMessage({type:'hello',from:self});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.atlasWorkspace?.getFrame().contentWindow)return;
    const data=event.data;
    if(['atlas:ready','atlas:hydrated','atlas:selection-request'].includes(data?.type)){
      toBoard(latest||{source:'gallery',ids:state.selectedIds});
    }
    if(data?.type==='atlas:selection-changed'&&!transferring&&owns('board')&&Array.isArray(data.ids))publish({source:'board',ids:data.ids});
    if(data?.type==='atlas:drag-out'){
      const invoke=window.__TAURI__?.core?.invoke||window.__TAURI_INTERNALS__?.invoke;
      if(invoke)invoke('drag_images_out',{ids:data.ids,boardFiles:data.boardFiles}).catch(error=>toast('拖出失败：'+error));
      else toast('当前为浏览器预览，可先另存为图片；Windows 原生拖出需要桌面预览');
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.body.classList.contains('board-active')||event.target.closest('input,textarea,[contenteditable=true]')||!state.selectedIds.length)return;
    state.selectedIds=[];state.selectedId=null;renderGallery();renderInspector();
  });
  window.addEventListener('pagehide',()=>channel.close());
})();
