(() => {
  const switcher=document.createElement('div');switcher.id='workspaceSwitcher';
  switcher.innerHTML=`<button class="workspace-brand" id="workspaceTrigger" aria-expanded="false" aria-controls="workspaceMenu" title="点击切换；拖动名称可拆分窗口"><img src="/assets/app-icon.png?v=blue-portrait" alt=""><span><strong id="workspaceTitle">图集</strong><small id="workspaceSubtitle">FIELD COLLECTION</small></span><span class="workspace-chevron" aria-hidden="true">⌄</span></button><div id="workspaceMenu" hidden><button id="galleryTab" aria-current="true"><img src="/assets/app-icon.png?v=blue-portrait" alt="">图集</button><button id="boardTab" aria-current="false"><img src="/assets/doro/board-icon.png" alt="">画板</button><hr><button id="detachWorkspace">在独立窗口中打开 ↗</button></div><button class="workspace-ai" id="sharedAiSettings">AI 设置</button><button class="workspace-ai workspace-merge" id="mergeWorkspace" hidden>合并回主窗口 ↙</button>`;
  switcher.querySelector('.workspace-chevron').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>';
  document.body.append(switcher);
  const panel=document.createElement('section');panel.id='boardWorkspace';panel.hidden=true;panel.setAttribute('aria-label','画板工作空间');
  panel.innerHTML='<div class="board-shell-header"><strong>画板</strong><small>图库图片可直接拖入画布</small><div id="boardActionsHost"></div></div><iframe id="boardFrame" title="画板" src="about:blank"></iframe>';
  document.body.append(panel);
  let frameReady=false,opened=false,queue=[],currentMode='gallery';
  const frame=panel.querySelector('iframe');
  const flush=()=>{if(frameReady&&queue.length){frame.contentWindow.postMessage({type:'atlas:add',images:queue},location.origin);queue=[];}};
  function show(mode){
    currentMode=mode;
    const board=mode==='board';
    if(board&&!opened){frame.src='/board/';opened=true;}
    panel.hidden=!board;document.body.classList.toggle('board-active',board);
    document.getElementById('galleryTab').setAttribute('aria-current',String(!board));document.getElementById('boardTab').setAttribute('aria-current',String(board));
    closeMenu();
    document.getElementById('workspaceTitle').textContent=board?'画板':'图集';
    document.getElementById('workspaceSubtitle').textContent=board?'LITTLE STUDIO':'FIELD COLLECTION';
    switcher.querySelector('.workspace-brand > img').src=board?'/assets/doro/board-icon.png':'/assets/app-icon.png?v=blue-portrait';
    if(board){flush();if(frameReady)frame.contentWindow.postMessage({type:'atlas:sync-catalog'},location.origin);}
    window.atlasWorkspaceChanged?.(mode);
    window.dispatchEvent(new Event('atlas:workspace-shown'));
  }
  document.getElementById('galleryTab').onclick=()=>show('gallery');document.getElementById('boardTab').onclick=()=>show('board');
  const trigger=document.getElementById('workspaceTrigger'),menu=document.getElementById('workspaceMenu');
  function closeMenu(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
  trigger.onclick=()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)document.getElementById(document.body.classList.contains('board-active')?'boardTab':'galleryTab').focus();};
  document.addEventListener('click',event=>{if(!switcher.contains(event.target))closeMenu();});
  switcher.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();trigger.focus();}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const choices=[document.getElementById('galleryTab'),document.getElementById('boardTab')];choices[(choices.indexOf(document.activeElement)+1)%2].focus();}});
  const openAi=()=>{document.getElementById('settingsBtn').click();document.getElementById('settingsModal').classList.add('shared-ai-open');document.getElementById('aiProvider').focus();};
  document.getElementById('sharedAiSettings').onclick=openAi;
  window.atlasWorkspace={show,getMode:()=>currentMode,getFrame:()=>frame,openAi,
    ensureFrame:()=>{if(!opened){frame.src='/board/';opened=true;}return frameReady;},
    isFrameReady:()=>frameReady};
  window.atlasAddToBoard=ids=>{
    const images=ids.map(id=>state.images.find(item=>item.id===id)).filter(item=>item&&!isVideo(item)&&item.hasPreview!==false);
    if(!images.length)return toast('请选择可预览的图片');
    const payload=images.map(({id,name,type})=>({id,name,type}));
    if(window.atlasRouteBoard?.(payload))return;
    queue.push(...payload);show('board');flush();
  };
  window.addEventListener('message',async event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
    if(event.data?.type==='atlas:ready'){frameReady=true;flush();window.atlasWorkspaceChanged?.(currentMode);}
    window.atlasWindowMessage?.(event.data);
    if(event.data?.type==='atlas:gallery')show('gallery');
    if(event.data?.type==='atlas:ai-settings')openAi();
    if(event.data?.type==='atlas:add-failed')toast('添加到画板失败：'+event.data.message);
    if(event.data?.type==='atlas:collected'){
      try{const data=await api('/api/state');state.images=data.images;state.trash=data.trash;state.folders=data.folders;state.imageOrder=data.imageOrder;render();if(!event.data.silent)toast('画板图片已收藏到图集');}catch(error){toast(error.message);}
    }
  });
  window.setupAtlasWindows?.();
})();
