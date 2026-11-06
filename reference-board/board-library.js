// Folder/board identity lives outside the editor document. Originals are never duplicated.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
exports.createBoardLibrary=({state,save,dataDir,boardDir,mediaDir,folderDiskPath,uniqueFolderDiskName,mediaPath,renameFolder,importMedia})=>{
  const file=path.join(boardDir,'document.json');
  state.boardLinks ||= [];
  state.unlinkedBoardFolders ||= [];
  const atomic=(target,value)=>{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target+'.tmp',JSON.stringify(value,null,2));fs.renameSync(target+'.tmp',target);};
  const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{boards:[],activeBoardId:null};
  const backup=()=>{
    const target=path.join(dataDir,'backup-before-board-links');
    if(fs.existsSync(target))return;
    fs.mkdirSync(target,{recursive:true});
    if(fs.existsSync(file))fs.copyFileSync(file,path.join(target,'document.json'));
    atomic(path.join(target,'library.json'),state);
  };
  function catalog(incoming=[]){
    backup();
    const before=JSON.stringify([state.folders,state.boardLinks]);
    const ids=new Set(incoming.map(board=>board.id));
    if(ids.size!==incoming.length||incoming.length>100)throw Error('画板编号重复或数量超限');
    for(const board of incoming){
      if(typeof board.id!=='string'||!board.id||board.id.length>100)throw Error('画板编号无效');
      const name=String(board.name||'未命名画板').trim().slice(0,80)||'未命名画板';
      let link=state.boardLinks.find(item=>item.boardId===board.id);
      if(link?.archived)continue;
      if(!link){
        const folder={id:crypto.randomUUID(),name,parentId:null,diskName:uniqueFolderDiskName(name,null),createdAt:Date.now(),color:null};
        fs.mkdirSync(path.join(mediaDir,folder.diskName),{recursive:true});state.folders.push(folder);
        link={boardId:board.id,folderId:folder.id,name,origin:'board'};state.boardLinks.push(link);
      }
      const folder=state.folders.find(item=>item.id===link.folderId);
      if(!folder)continue;
      // A rename made in the gallery wins over a stale editor name. The editor then receives it.
      if(folder.name!==link.name)link.name=folder.name;
      else if(name!==link.name&&(!board.linkedFolderName||name!==board.linkedFolderName)){renameFolder(folder,name);link.name=name;}
    }
    for(const folder of state.folders){
      if(state.unlinkedBoardFolders.includes(folder.id)||state.boardLinks.some(item=>item.folderId===folder.id&&!item.archived))continue;
      state.boardLinks.push({boardId:crypto.randomUUID(),folderId:folder.id,name:folder.name,origin:'gallery'});
    }
    for(const link of state.boardLinks){const folder=state.folders.find(item=>item.id===link.folderId);if(folder&&!link.archived)link.name=folder.name;}
    if(before!==JSON.stringify([state.folders,state.boardLinks]))save();
    return state.boardLinks.filter(link=>!link.archived&&state.folders.some(folder=>folder.id===link.folderId)).map(link=>({...link,directory:folderDiskPath(link.folderId)}));
  }
  const blank=link=>({id:link.boardId,name:link.name,elements:[],operationHistory:[],operationHistoryIndex:-1,panOffset:{x:0,y:0},zoom:1,canvasBackgroundColor:'#fff8fb'});
  function document(){
    const doc=read(),links=catalog((doc.boards||[]).map(board=>({...board,name:state.boardLinks.find(link=>link.boardId===board.id)?.name||board.name})));
    const boards=links.map(link=>({...((doc.boards||[]).find(board=>board.id===link.boardId)||blank(link)),name:link.name,linkedFolderName:link.name}));
    return {...doc,boards:boards.length?boards:null,activeBoardId:boards.some(board=>board.id===doc.activeBoardId)?doc.activeBoardId:boards[0]?.id};
  }
  function archive(link,board){
    if(board)atomic(path.join(boardDir,'archive',crypto.randomUUID()+'.json'),{board,folderId:link.folderId,archivedAt:Date.now()});
    link.archived=true;
    if(!state.unlinkedBoardFolders.includes(link.folderId))state.unlinkedBoardFolders.push(link.folderId);
  }
  function removeFolders(ids){
    backup();const doc=read();
    for(const link of state.boardLinks)if(ids.has(link.folderId)&&!link.archived)archive(link,doc.boards?.find(board=>board.id===link.boardId));
    for(const id of ids){
      const manifest=path.join(mediaDir,folderDiskPath(id),'.画板.json');
      if(!fs.existsSync(manifest))continue;
      const previous=JSON.parse(fs.readFileSync(manifest,'utf8'));
      for(const link of previous.links||[]){
        if(!/^atlas-[a-f0-9-]+\.[a-z0-9]+$/.test(link.name))continue;
        const target=path.join(path.dirname(manifest),link.name);
        if(fs.existsSync(target)&&String(fs.statSync(target).ino)===link.inode)fs.unlinkSync(target);
      }
      fs.unlinkSync(manifest);
    }
    doc.boards=(doc.boards||[]).filter(board=>!state.boardLinks.some(link=>link.boardId===board.id&&link.archived));
    atomic(file,doc);
    save();
  }
  function materialize(folder,board,images){
    const dir=path.join(mediaDir,folderDiskPath(folder.id));fs.mkdirSync(dir,{recursive:true});
    const manifest=path.join(dir,'.画板.json');
    let previous={};try{previous=JSON.parse(fs.readFileSync(manifest,'utf8'));}catch{}
    const links=[];
    for(const image of images){
      const source=mediaPath(image);if(!fs.existsSync(source))continue;
      if(path.dirname(source)===dir)continue;
      const name=`atlas-${image.id}${image.ext}`,target=path.join(dir,name);
      if(fs.existsSync(target)){
        if(fs.statSync(target).ino!==fs.statSync(source).ino){
          if(!(previous.links||[]).some(link=>link.name===name&&link.inode===String(fs.statSync(target).ino)))throw Error('同步目录中存在同名文件，请先移走：'+name);
          fs.unlinkSync(target);fs.linkSync(source,target);
        }
      }else fs.linkSync(source,target);
      links.push({name,imageId:image.id,inode:String(fs.statSync(target).ino)});
    }
    // Remove only links still owned by the previous manifest; never touch replaced files.
    for(const link of previous.links||[]){
      if(links.some(item=>item.name===link.name)||!/^atlas-[a-f0-9-]+\.[a-z0-9]+$/.test(link.name))continue;
      const target=path.join(dir,link.name);
      if(fs.existsSync(target)&&String(fs.statSync(target).ino)===link.inode)fs.unlinkSync(target);
    }
    atomic(manifest,{boardId:board.id,folderId:folder.id,name:board.name,links,board,savedAt:Date.now()});
  }
  async function put(body){
    backup();const old=read();
    const incomingIds=new Set(body.boards.map(board=>board.id));
    // Deletion is explicit in a saved document; archived content remains recoverable.
    for(const board of old.boards||[]){const link=state.boardLinks.find(item=>item.boardId===board.id&&!item.archived);if(link&&!incomingIds.has(board.id))archive(link,board);}
    for(const link of state.boardLinks)if(!link.archived&&link.origin==='board'&&!incomingIds.has(link.boardId))archive(link,null);
    const links=catalog(body.boards);
    for(const board of body.boards){
      const link=links.find(item=>item.boardId===board.id);
      if(!link)throw Error('关联文件夹已删除，请同步目录后重试；当前编辑仍保留');
      board.name=link.name;board.linkedFolderName=link.name;
      const folder=state.folders.find(item=>item.id===link.folderId),images=[];
      for(const element of board.elements){
        if(!['image','video'].includes(element.type))continue;
        const href=element.originalHref||element.href;
        const match=String(href||'').match(/^\/(?:media|preview)\/([a-f0-9-]{36})$/);
        let image=match&&state.images.find(item=>item.id===match[1]);
        if(!image&&String(href||'').startsWith('/board-media/'))image=await importMedia(href,folder.id,element.name);
        if(image&&!images.some(item=>item.id===image.id))images.push(image);
      }
      folder.referenceIds=images.map(image=>image.id);
      materialize(folder,board,images);
    }
    const boards=links.map(link=>body.boards.find(board=>board.id===link.boardId)||old.boards?.find(board=>board.id===link.boardId)||blank(link));
    if(fs.existsSync(file))fs.copyFileSync(file,path.join(boardDir,'document.previous.json'));
    atomic(file,{...body,boards,savedAt:Date.now()});save();return {ok:true,links};
  }
  function mediaId(element){
    if(!['image','video'].includes(element.type))return null;
    const href=element.originalHref||element.href||'';
    const match=href.match(/^\/(?:media|preview)\/([a-f0-9-]{36})$/);
    if(match)return match[1];
    const hash=href.match(/^\/board-media\/([a-f0-9]{64})\./)?.[1];
    return hash?[...state.images,...state.trash].find(image=>image.contentHash===hash)?.id:null;
  }
  function references(id,boards=read().boards||[]){
    return boards.filter(board=>board.elements.some(element=>mediaId(element)===id)).map(board=>({id:board.id,name:board.name}));
  }
  function moveToTrash(id,boards,sourceBoardId){
    const image=state.images.find(image=>image.id===id);if(!image)return;
    const all=new Map((read().boards||[]).map(board=>[board.id,board]));
    for(const board of boards)all.set(board.id,board);
    // Include the last synchronized copy when the deletion has already happened in the editor.
    const placements=[];
    for(const board of all.values()){
      const baseline=state.boardLinks.find(link=>link.boardId===board.id)?.mediaSnapshot||[];
      const elements=[...board.elements,...baseline].filter(element=>mediaId(element)===id);
      const unique=[...new Map(elements.map(element=>[element.id,element])).values()];
      if(unique.length)placements.push({boardId:board.id,elements:unique});
    }
    state.images=state.images.filter(image=>image.id!==id);
    state.trash.push({...image,deletedAt:Date.now(),boardPlacements:placements,boardRemovedBy:sourceBoardId||null});
    for(const board of boards)board.elements=board.elements.filter(element=>mediaId(element)!==id);
  }
  function restoreMedia(image){
    state.trash=state.trash.filter(item=>item.id!==image.id);
    delete image.deletedAt;delete image.boardRemovedBy;state.images.unshift(image);
    for(const placement of image.boardPlacements||[]){
      const link=state.boardLinks.find(link=>link.boardId===placement.boardId&&!link.archived);
      const folder=state.folders.find(folder=>folder.id===link?.folderId);
      if(folder)folder.referenceIds=[...new Set([...(folder.referenceIds||[]),image.id])];
    }
  }
  async function trashImages(ids,confirmed=false){
    const doc=document(),boards=doc.boards||[];
    const affected=[...new Map(ids.flatMap(id=>references(id,boards)).map(board=>[board.id,board])).values()];
    if(affected.length&&!confirmed)return {needsConfirmation:true,affected};
    for(const id of ids)moveToTrash(id,boards,null);
    if(boards.length)await put({...doc,boards});else save();
    return {ok:true};
  }
  async function sync(body){
    const before=JSON.stringify(state);
    const old=read();
    for(const id of body.deletedBoardIds||[]){
      const link=state.boardLinks.find(link=>link.boardId===id&&!link.archived);
      if(link)archive(link,old.boards?.find(board=>board.id===id));
    }
    const links=catalog(body.boards),incoming=JSON.parse(JSON.stringify(body.boards));
    const deleted=new Map(),restore=[];
    for(const board of incoming){
      const link=state.boardLinks.find(link=>link.boardId===board.id&&!link.archived);if(!link)continue;
      const previous=link.mediaSnapshot||(old.boards||[]).find(item=>item.id===board.id)?.elements||[];
      const currentIds=new Set(board.elements.map(mediaId).filter(Boolean));
      for(const element of previous){const id=mediaId(element);if(id&&!currentIds.has(id)&&state.images.some(image=>image.id===id)){deleted.set(id,board.id);restore.push({boardId:board.id,element});}}
    }
    const affected=[...deleted].flatMap(([id,source])=>references(id,old.boards||[]).filter(board=>board.id!==source).map(board=>({...board,imageId:id})));
    if(affected.some(item=>!body.confirmedDeleteIds?.includes(item.imageId)))return {needsConfirmation:true,affected,deleteIds:[...deleted.keys()],restore};
    for(const [id,source] of deleted)moveToTrash(id,incoming,source);
    const boards=links.map(link=>incoming.find(board=>board.id===link.boardId)||old.boards?.find(board=>board.id===link.boardId)||blank(link));
    for(const board of boards){
      const link=state.boardLinks.find(link=>link.boardId===board.id),folder=state.folders.find(folder=>folder.id===link.folderId);
      const retained=[];
      for(const element of board.elements){
        if(!['image','video'].includes(element.type)){retained.push(element);continue;}
        let id=mediaId(element),trashed=state.trash.find(image=>image.id===id);
        // Undo of a deletion made on this board can restore it; stale copies on other boards cannot.
        if(trashed?.boardRemovedBy===board.id&&(trashed.boardPlacements||[]).some(p=>p.boardId===board.id&&p.elements.some(e=>e.id===element.id))){restoreMedia(trashed);trashed=null;}
        if(trashed||(id&&!state.images.some(image=>image.id===id)))continue;
        const href=element.originalHref||element.href||'';
        if(!id&&href.startsWith('/board-media/')&&state.boardDeletedHashes?.includes(href.split('/').pop().split('.')[0]))continue;
        if(!id&&href.startsWith('/board-media/'))id=(await importMedia(href,folder.id,element.name)).id;
        if(id)element.atlasImageId=id;
        retained.push(element);
      }
      board.elements=retained;const wasEmpty=retained.length===0;
      const present=new Set(retained.map(mediaId).filter(Boolean));
      const candidates=state.images.filter(image=>(image.folderId===folder.id||folder.referenceIds?.includes(image.id))&&!present.has(image.id)&&(image.hasPreview!==false||image.type.startsWith('video/')));
      const startX=retained.length?Math.max(...retained.map(element=>element.x+(element.width||360)))+80:80;
      for(const [index,image] of candidates.entries()){
        const placement=image.boardPlacements?.find(p=>p.boardId===board.id)?.elements;
        if(placement?.length){board.elements.push(...placement.map(element=>({...element,atlasImageId:image.id})));continue;}
        const scale=Math.min(1,360/(image.width||360),300/(image.height||240));
        board.elements.push({id:crypto.randomUUID(),type:image.type.startsWith('video/')?'video':'image',name:image.name,atlasImageId:image.id,href:(image.type.startsWith('video/')?'/media/':'/preview/')+image.id,...(!image.type.startsWith('video/')?{originalHref:'/media/'+image.id}:{}),mimeType:image.type,width:(image.width||360)*scale,height:(image.height||240)*scale,x:startX+(index%3)*400,y:80+Math.floor(index/3)*340,rotation:0});
      }
      // Migrate the old piled import once; a deliberately arranged layout is preserved.
      const media=board.elements.filter(element=>['image','video'].includes(element.type));
      if(!link.autoLayoutDone&&media.length>1&&Math.max(...media.map(e=>e.x))-Math.min(...media.map(e=>e.x))<180&&Math.max(...media.map(e=>e.y))-Math.min(...media.map(e=>e.y))<180){
        media.forEach((element,index)=>{const scale=Math.min(1,360/element.width,300/element.height);element.width*=scale;element.height*=scale;element.x=80+(index%3)*400;element.y=80+Math.floor(index/3)*340;});
        board.atlasNeedsFit=true;
      }
      if(wasEmpty&&candidates.length)board.atlasNeedsFit=true;
      if(media.length)link.autoLayoutDone=true;
      link.mediaSnapshot=board.elements.filter(element=>['image','video'].includes(element.type)).map(element=>({...element}));
      board.name=link.name;board.linkedFolderName=link.name;
      const saved=old.boards?.find(item=>item.id===board.id);
      // Automatic material synchronization must not erase manually saved undo history.
      board.operationHistory=saved?.operationHistory||[];
      board.operationHistoryIndex=saved?.operationHistoryIndex??-1;
    }
    const fitBoardIds=boards.filter(board=>board.atlasNeedsFit).map(board=>board.id);
    boards.forEach(board=>delete board.atlasNeedsFit);
    // Only write when content or membership changed; polling does not create repeated backups.
    const next={...old,boards,activeBoardId:body.activeBoardId||old.activeBoardId};
    if(JSON.stringify(old.boards)!==JSON.stringify(boards)||old.activeBoardId!==next.activeBoardId)await put(next);else if(before!==JSON.stringify(state))save();
    return {ok:true,boards,links,fitBoardIds,changed:before!==JSON.stringify(state)||JSON.stringify(old.boards)!==JSON.stringify(boards)};
  }
  const archivedIds=()=>state.boardLinks.filter(link=>link.archived).map(link=>link.boardId);
  const recovery=boards=>{backup();for(const board of boards)atomic(path.join(boardDir,'archive',crypto.randomUUID()+'.json'),{board,archivedAt:Date.now(),reason:'folder-removed-editor-recovery'});return {ok:true};};
  return {catalog,document,put,removeFolders,archivedIds,recovery,sync,trashImages,restoreMedia};
};
