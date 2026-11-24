const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
exports.createBoardHistory=directory=>{
  const root=path.join(directory,'history');
  const valid=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id);
  const folder=id=>{if(!valid(id))throw Error('画板标识无效');return path.join(root,id);};
  const list=id=>{
    const dir=folder(id);if(!fs.existsSync(dir))return [];
    return fs.readdirSync(dir).filter(name=>/^\d+-[a-f0-9]{12}\.json$/.test(name)).sort().reverse().map(name=>{
      try{const value=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));return {id:name.slice(0,-5),createdAt:value.createdAt,reason:value.reason,name:value.board.name,count:value.board.elements.length};}catch{return null;}
    }).filter(Boolean);
  };
  const snapshot=(board,reason='自动备份',force=false)=>{
    if(!board||!valid(board.id)||!Array.isArray(board.elements))throw Error('备份画板无效');
    const existing=list(board.id),latest=existing[0];
    const signature=crypto.createHash('sha256').update(JSON.stringify({elements:board.elements,canvasBackgroundColor:board.canvasBackgroundColor,viewBookmarks:board.viewBookmarks})).digest('hex').slice(0,12);
    if(latest?.id.endsWith(signature))return latest;
    if(!force&&latest&&Date.now()-latest.createdAt<5*60*1000)return latest;
    const dir=folder(board.id);fs.mkdirSync(dir,{recursive:true});
    const createdAt=Math.max(Date.now(),(latest?.createdAt||0)+1),id=`${createdAt}-${signature}`;
    // History is independent of the undo journal and immutable media is referenced.
    const value={createdAt,reason,board:{...board,operationHistory:[],operationHistoryIndex:-1}};
    fs.writeFileSync(path.join(dir,id+'.tmp'),JSON.stringify(value));fs.renameSync(path.join(dir,id+'.tmp'),path.join(dir,id+'.json'));
    for(const item of list(board.id).slice(40))fs.rmSync(path.join(dir,item.id+'.json'));
    return {id,createdAt,reason,name:board.name,count:board.elements.length};
  };
  const read=(boardId,id)=>{if(!/^\d+-[a-f0-9]{12}$/.test(id))throw Error('备份标识无效');return JSON.parse(fs.readFileSync(path.join(folder(boardId),id+'.json'),'utf8'));};
  return {list,snapshot,read};
};
