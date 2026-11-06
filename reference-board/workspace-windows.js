/* One live editor per tool. Window handoffs are acknowledged before the source unlocks. */
(() => {
  const validMode=mode=>mode==='gallery'||mode==='board';
  const shouldDetach=(start,end)=>Math.hypot(end.x-start.x,end.y-start.y)>72;
  if(typeof module!=='undefined')module.exports={validMode,shouldDetach};
  if(typeof window==='undefined')return;
  window.setupAtlasWindows=()=>{
    const apiUI=window.atlasWorkspace,params=new URLSearchParams(location.search);
    const child=validMode(params.get('tool'))&&!!params.get('owner');
    const mode=child?params.get('tool'):null;
    const token=child?params.get('owner'):(sessionStorage.getItem('atlas-window-session')||crypto.randomUUID());
    if(!child)sessionStorage.setItem('atlas-window-session',token);
    const self=child?params.get('peer'): 'owner';
    const channel=new BroadcastChannel('atlas-windows-'+token);
    const peers=new Map(),pending=new Map();
    let lastBoard=null,hydrating=false,initialized=!child,merging=false,dragging=false;
    const invoke=window.__TAURI__?.core?.invoke||window.__TAURI_INTERNALS__?.invoke;
    const send=(type,data={},to='owner')=>channel.postMessage({type,...data,from:self,to});
    const post=data=>apiUI.getFrame().contentWindow?.postMessage(data,location.origin);
    const wait=(type,data)=>new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('工作区同步超时，内容仍保留在原窗口，请重试'));},20000);
      pending.set(requestId,{resolve,reject,timer});post({type,requestId,...data});
    });
    const frameReady=()=>new Promise((resolve,reject)=>{
      if(apiUI.ensureFrame())return resolve();
      const started=Date.now();const timer=setInterval(()=>{if(apiUI.isFrameReady()){clearInterval(timer);resolve();}else if(Date.now()-started>20000){clearInterval(timer);reject(Error('画板尚未载入，请稍后重试'));}},100);
    });
    function gallerySnapshot(){return {view:state.view,query:state.query,sort:state.sort,selectedId:state.selectedId,selectedIds:[...state.selectedIds],collapsedTags:[...state.collapsedTags],collapsedFolders:[...state.collapsedFolders],size:document.getElementById('sizeSlider').value,scroll:document.querySelector('.gallery-area')?.scrollTop||0};}
    async function hydrateGallery(snapshot){
      const data=await api('/api/state');Object.assign(state,{images:data.images,folders:data.folders,tags:data.tags,trash:data.trash,icons:data.icons,imageOrder:data.imageOrder});
      if(snapshot){for(const key of ['view','query','sort','selectedId','selectedIds'])if(key in snapshot)state[key]=snapshot[key];state.collapsedTags=new Set(snapshot.collapsedTags);state.collapsedFolders=new Set(snapshot.collapsedFolders);document.getElementById('searchInput').value=state.query;document.getElementById('sortSelect').value=state.sort;
        const slider=document.getElementById('sizeSlider');slider.value=snapshot.size;slider.dispatchEvent(new Event('input',{bubbles:true}));}
      render();requestAnimationFrame(()=>{const area=document.querySelector('.gallery-area');if(area&&snapshot)area.scrollTop=snapshot.scroll;});
    }
    async function snapshot(tool){if(tool==='gallery')return gallerySnapshot();await frameReady();return wait('atlas:request-snapshot',{});}
    async function hydrate(tool,value){if(tool==='gallery')return hydrateGallery(value);hydrating=true;try{await frameReady();await wait('atlas:hydrate',{snapshot:value});lastBoard=value;}finally{hydrating=false;}}
    const mask=document.createElement('div');mask.id='workspaceDetached';mask.hidden=true;mask.innerHTML='<div><strong>此工作区已在独立窗口打开</strong><p>内容在独立窗口编辑，合并后继续使用。</p><button id="focusWorkspace">显示独立窗口</button><button id="dockWorkspace">合并回此窗口</button></div>';document.body.append(mask);
    const busy=document.createElement('div');busy.id='workspaceTransfer';busy.hidden=true;busy.textContent='正在同步工作区，请稍候…';document.body.append(busy);
    function redraw(){const peer=peers.get(apiUI.getMode());mask.hidden=child||!peer;const actions=document.getElementById('boardActionsHost');if(actions)actions.inert=!child&&peers.has('board');if(apiUI.isFrameReady())post({type:'atlas:editor-lock',locked:!child&&peers.has('board')});document.getElementById('detachWorkspace').textContent=child?'合并回主窗口 ↙':peer?'显示独立窗口 ↗':'在独立窗口中打开 ↗';}
    window.atlasWorkspaceChanged=tool=>{
      if(child&&initialized&&tool!==mode){apiUI.show(mode);send('show',{mode:tool});return;}
      redraw();
    };
    document.getElementById('focusWorkspace').onclick=()=>{const peer=peers.get(apiUI.getMode());if(peer?.ref)peer.ref.focus();send('focus',{},peer.id);};
    document.getElementById('dockWorkspace').onclick=()=>{const peer=peers.get(apiUI.getMode());if(peer)send('merge-request',{},peer.id);};
    const closeWindow=()=>{post({type:'atlas:close-transfer'});setTimeout(()=>{if(invoke)invoke('close_workspace_window').catch(()=>window.close());else window.close();},50);};
    async function merge(){
      if(!child||merging)return;merging=true;busy.hidden=false;
      try{const value=await snapshot(mode);send('merge',{mode,snapshot:value});}
      catch(error){merging=false;busy.hidden=true;toast(error.message);}
    }
    async function recover(peer){
      if(peers.get(peer.mode)!==peer||peer.recovering)return;
      peer.recovering=true;
      try{if(peer.snapshot)await hydrate(peer.mode,peer.snapshot);else if(peer.mode==='gallery')await hydrateGallery();
        peers.delete(peer.mode);redraw();toast('独立窗口已关闭，工作区已回到主窗口');}
      catch(error){toast('恢复失败，保留独立窗口状态：'+error.message);}finally{peer.recovering=false;}
    }
    async function detach(tool=apiUI.getMode()){
      if(child)return merge();
      if(state.uploading)return toast('请等待素材导入完成再拆分窗口');
      const existing=peers.get(tool);if(existing){existing.ref?.focus();send('focus',{},existing.id);return;}
      const id=crypto.randomUUID();const address=`/?tool=${tool}&owner=${encodeURIComponent(token)}&peer=${id}`;
      const peer={id,mode:tool,ref:null,snapshot:null,lastSeen:Date.now(),ready:false,initializing:null};
      peers.set(tool,peer);redraw();
      // Open synchronously in the user gesture so browsers don't classify it as an unsolicited popup.
      if(invoke){invoke('open_workspace_window',{tool,session:token,peer:id}).catch(error=>{peers.delete(tool);redraw();toast('窗口打开失败：'+error);});}
      else {peer.ref=window.open(address,'atlas-'+id,'popup,width=1180,height=820,left=140,top=90');if(!peer.ref){peers.delete(tool);redraw();return toast('浏览器阻止了独立窗口，请允许此页面弹出窗口后重试');}}
      try{peer.snapshot=await snapshot(tool);peer.initializing=peer.snapshot;if(peer.ready)send('initialize',{mode:tool,snapshot:peer.snapshot},id);}
      catch(error){peers.delete(tool);send('cancel',{},id);peer.ref?.close();redraw();toast(error.message);}
    }
    document.getElementById('detachWorkspace').onclick=()=>detach();
    document.getElementById('mergeWorkspace').onclick=merge;
    const trigger=document.getElementById('workspaceTrigger');
    let start=null;
    trigger.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,y:event.clientY};trigger.setPointerCapture(event.pointerId);});
    trigger.addEventListener('pointermove',event=>{if(!start)return;dragging=shouldDetach(start,{x:event.clientX,y:event.clientY});trigger.classList.toggle('workspace-pulling',dragging);});
    trigger.addEventListener('pointerup',event=>{if(!start)return;const detachNow=shouldDetach(start,{x:event.clientX,y:event.clientY});start=null;trigger.classList.remove('workspace-pulling');if(detachNow){event.preventDefault();event.stopImmediatePropagation();document.getElementById('workspaceMenu').hidden=true;void detach();}setTimeout(()=>{dragging=false;},0);});
    trigger.addEventListener('click',event=>{if(dragging){event.preventDefault();event.stopImmediatePropagation();}},true);
    // Return a detached tool by dragging its title onto the main window's title.
    const mergeHandle=document.getElementById('mergeWorkspace');mergeHandle.draggable=true;
    mergeHandle.addEventListener('dragstart',event=>{event.dataTransfer.setData('application/x-atlas-workspace',JSON.stringify({token,peer:self,mode}));event.dataTransfer.effectAllowed='move';});
    const switcher=document.getElementById('workspaceSwitcher');
    switcher.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('application/x-atlas-workspace')){event.preventDefault();switcher.classList.add('workspace-drop');}});
    switcher.addEventListener('dragleave',()=>switcher.classList.remove('workspace-drop'));
    switcher.addEventListener('drop',event=>{switcher.classList.remove('workspace-drop');const raw=event.dataTransfer.getData('application/x-atlas-workspace');if(!raw)return;event.preventDefault();event.stopPropagation();try{const data=JSON.parse(raw);if(!child&&data.token===token&&validMode(data.mode)&&peers.get(data.mode)?.id===data.peer)send('merge-request',{},data.peer);}catch{}});
    window.atlasRouteBoard=images=>{
      const peer=peers.get('board');
      if(!child&&peer){send('add',{images},peer.id);peer.ref?.focus();return true;}
      if(child&&mode!=='board'){send('add',{images});return true;}
      return false;
    };
    const previous=window.atlasWindowMessage;
    window.atlasWindowMessage=data=>{
      previous?.(data);
      const task=pending.get(data?.requestId);
      if(task&&['atlas:snapshot','atlas:hydrated','atlas:snapshot-error'].includes(data.type)){clearTimeout(task.timer);pending.delete(data.requestId);data.type==='atlas:snapshot-error'?task.reject(Error(data.message)):task.resolve(data.snapshot);}
      if(data?.type==='atlas:snapshot-update'&&!hydrating){lastBoard=data.snapshot;if(child&&initialized)send('snapshot',{mode,snapshot:lastBoard});}
      if(data?.type==='atlas:collected')send('gallery-changed',{},child?'owner':'all');
    };
    channel.onmessage=async({data})=>{
      if(data.from===self||(data.to!==self&&data.to!=='all'))return;
      if(child&&data.from!=='owner')return;
      const peer=!child?[...peers.values()].find(item=>item.id===data.from):null;
      if(!child&&!peer)return;
      try{
        if(data.type==='ready'&&peer){peer.ready=true;peer.lastSeen=Date.now();if(peer.initializing)send('initialize',{mode:peer.mode,snapshot:peer.initializing},peer.id);}
        if(data.type==='initialize'&&child&&!initialized&&!hydrating){busy.hidden=false;await hydrate(mode,data.snapshot);initialized=true;busy.hidden=true;send('initialized',{mode});}
        if(data.type==='initialized'&&peer){peer.initializing=null;peer.lastSeen=Date.now();if(apiUI.getMode()===peer.mode)apiUI.show(peer.mode==='board'?'gallery':'board');}
        if(data.type==='heartbeat'&&peer)peer.lastSeen=Date.now();
        if(data.type==='snapshot'&&peer){peer.snapshot=data.snapshot;peer.lastSeen=Date.now();}
        if(data.type==='focus'&&child)window.focus();
        if(data.type==='cancel'&&child)closeWindow();
        if(data.type==='show'&&!child)apiUI.show(data.mode);
        if(data.type==='merge-request'&&child)await merge();
        if(data.type==='merge'&&peer){peer.snapshot=data.snapshot;await hydrate(peer.mode,data.snapshot);peers.delete(peer.mode);apiUI.show(peer.mode);send('merged',{},data.from);redraw();}
        if(data.type==='merged'&&child)closeWindow();
        if(data.type==='closing'&&peer){if(data.snapshot)peer.snapshot=data.snapshot;await recover(peer);}
        if(data.type==='add'){if(child){await frameReady();post({type:'atlas:add',images:data.images});}else{const boardPeer=peers.get('board');if(boardPeer)send('add',{images:data.images},boardPeer.id);else{apiUI.show('board');await frameReady();post({type:'atlas:add',images:data.images});}}}
        if(data.type==='gallery-changed')await hydrateGallery(child&&mode==='gallery'?gallerySnapshot():null);
      }catch(error){toast(error.message);if(child){merging=false;busy.hidden=false;busy.textContent='同步失败，当前内容仍保留，请重试合并';}}
    };
    if(child){
      document.body.classList.add('workspace-child');document.getElementById('mergeWorkspace').hidden=false;
      document.getElementById('mergeWorkspace').title='点击合并；也可拖到主窗口左上名称处合并';
      document.title=mode==='board'?'画板 · 独立窗口':'图集 · 独立窗口';apiUI.show(mode);busy.hidden=false;send('ready',{mode});
    }
    const heartbeat=setInterval(()=>{
      if(child){if(!initialized)send('ready',{mode});else{send('heartbeat',{mode});if(mode==='gallery')send('snapshot',{mode,snapshot:gallerySnapshot()});}}
      // Background tabs may pause timers. Silence alone must never unlock a second editor.
      else for(const peer of peers.values())if(peer.ref?.closed)void recover(peer);
    },1000);
    window.addEventListener('pagehide',()=>{clearInterval(heartbeat);if(child&&!merging)send('closing',{mode,snapshot:mode==='board'?lastBoard:gallerySnapshot()});});
    window.addEventListener('beforeunload',event=>{if(!child&&peers.size){event.preventDefault();event.returnValue='';}});
    // Ctrl+C in the gallery copies original references for a lossless paste into either canvas window.
    document.addEventListener('keydown',event=>{if(apiUI.getMode()!=='gallery'||event.target.closest('input,textarea,[contenteditable=true]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'&&state.selectedIds.length){event.preventDefault();event.stopImmediatePropagation();navigator.clipboard.writeText(JSON.stringify({type:'atlas-images',ids:state.selectedIds})).then(()=>toast('已复制素材，可在画板粘贴')).catch(error=>toast(error.message));}},true);
    document.addEventListener('dragstart',event=>{if(event.dataTransfer?.types.includes('application/x-journal-images'))event.dataTransfer.effectAllowed='copyMove';});
    // Pasting a board's existing gallery image selects it; new canvas images are imported as new assets.
    async function collectImages(elements){
      for(const element of elements.filter(item=>item.type==='image')){
        const match=String(element.originalHref||element.href).match(/^\/(?:media|preview)\/([a-f0-9-]{36})$/);
        if(match){selectImage(match[1],true);continue;}
        try{const source=String(element.href||'');if(!source.startsWith('data:image/')&&!source.startsWith('blob:')&&!source.startsWith('/board-media/'))throw Error('素材来源无效');const blob=await fetch(source).then(r=>r.blob());await uploadFiles([new File([blob],(element.name||'画板素材')+'.png',{type:blob.type})]);}catch(error){toast(error.message);}
      }
    }
    window.addEventListener('paste',async event=>{
      if(apiUI.getMode()!=='gallery'||event.target.closest('input,textarea,[contenteditable=true]'))return;
      let data;try{data=JSON.parse(event.clipboardData?.getData('text/plain')||'');}catch{return;}
      if(data.type!=='artflow-elements'||!Array.isArray(data.elements))return;
      event.preventDefault();event.stopImmediatePropagation();await collectImages(data.elements);
    },true);
    window.addEventListener('dragover',event=>{if(apiUI.getMode()==='gallery'&&event.dataTransfer?.types.includes('application/x-atlas-canvas-images')){event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';}},true);
    window.addEventListener('drop',event=>{if(apiUI.getMode()!=='gallery')return;const raw=event.dataTransfer?.getData('application/x-atlas-canvas-images');if(!raw)return;event.preventDefault();event.stopImmediatePropagation();try{void collectImages(JSON.parse(raw));}catch(error){toast(error.message);}},true);
    redraw();
  };
})();
