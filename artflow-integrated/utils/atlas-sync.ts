import type {Board,Element} from '../types';

// Merge only changes made by synchronization. Edits performed while a request was
// in flight, including camera movement and undo history, remain in the editor.
export function mergeAtlasSync(current:Board[],sent:Board[],received:Board[]):Board[]{
  const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const next=current.filter(board=>!sent.some(item=>item.id===board.id)||received.some(item=>item.id===board.id)).map(board=>{
    const source=sent.find(item=>item.id===board.id),remote=received.find(item=>item.id===board.id);
    if(!source||!remote)return board;
    let changed=false;
    const elements=board.elements.filter(element=>!source.elements.some(item=>item.id===element.id)||remote.elements.some(item=>item.id===element.id)).map(element=>{
      const before=source.elements.find(item=>item.id===element.id),after=remote.elements.find(item=>item.id===element.id);
      if(!before||!after)return element;
      const patch:Record<string,unknown>={};
      for(const key of Object.keys(after)){
        const a=after as unknown as Record<string,unknown>,b=before as unknown as Record<string,unknown>,c=element as unknown as Record<string,unknown>;
        if(!equal(a[key],b[key])&&equal(c[key],b[key]))patch[key]=a[key];
      }
      if(!Object.keys(patch).length)return element;
      changed=true;return {...element,...patch} as Element;
    });
    if(elements.length!==board.elements.length)changed=true;
    for(const element of remote.elements)if(!source.elements.some(item=>item.id===element.id)&&!elements.some(item=>item.id===element.id)){elements.push(element);changed=true;}
    const rename=board.name===source.name&&board.name!==remote.name;
    if(!changed&&!rename&&board.linkedFolderName===remote.linkedFolderName)return board;
    return {...board,elements,name:rename?remote.name:board.name,linkedFolderName:remote.linkedFolderName};
  });
  for(const board of received)if(!sent.some(item=>item.id===board.id)&&!next.some(item=>item.id===board.id))next.push(board);
  return next.length===current.length&&next.every((board,index)=>board===current[index])?current:next;
}
