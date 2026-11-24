import type {Board, Element, ImageElement, Point} from '../types';
import {getSelectionBounds} from './canvasUtils';
import {applyCanvasOperation, commitCanvasOperation} from './operationHistory';

const TRANSFER_PREFIX='image-transfer:';
export function movableBoardImages(elements:Element[], ids:string[]):ImageElement[] {
  const selected=new Set(ids),byId=new Map(elements.map(element=>[element.id,element]));
  return elements.filter((element):element is ImageElement=>{
    if(element.type!=='image'||!selected.has(element.id))return false;
    let current:Element|undefined=element;
    const seen=new Set<string>();
    while(current){
      if(current.isLocked||seen.has(current.id))return false;
      seen.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;
    }
    return true;
  });
}

/** Both boards change in one document update; bytes/effects and relative positions survive. */
export function moveImagesBetweenBoards(boards:Board[], sourceId:string, targetId:string, ids:string[], center:Point):Board[] {
  const source=boards.find(board=>board.id===sourceId),target=boards.find(board=>board.id===targetId);
  if(!source||!target||source===target)return boards;
  const images=movableBoardImages(source.elements,ids);
  if(!images.length||images.some(image=>target.elements.some(element=>element.id===image.id)))return boards;
  const bounds=getSelectionBounds(images,source.elements);
  const dx=center.x-bounds.x-bounds.width/2,dy=center.y-bounds.y-bounds.height/2;
  const selected=new Set(images.map(image=>image.id));
  const transferred=images.map(image=>({...image,parentId:undefined,x:image.x+dx,y:image.y+dy}));
  const transferId=TRANSFER_PREFIX+crypto.randomUUID();
  return boards.map(board=>{
    if(board!==source&&board!==target)return board;
    const elements=board===source?board.elements.filter(element=>!selected.has(element.id)):[...board.elements,...transferred];
    const journal=commitCanvasOperation(board.operationHistory,board.operationHistoryIndex,board.elements,elements);
    journal.operationHistory[journal.operationHistoryIndex]={...journal.operationHistory[journal.operationHistoryIndex],id:transferId};
    return {...board,elements,...journal};
  });
}

const operationIndex=(board:Board, direction:'undo'|'redo')=>board.operationHistoryIndex+(direction==='redo'?1:0);
export function boardOperationBlocker(boards:Board[], boardId:string): {message:string; boardId?:string} | undefined {
  const board=boards.find(item=>item.id===boardId);
  const operation=board?.operationHistory[operationIndex(board,'undo')];
  if(!operation?.id.startsWith(TRANSFER_PREFIX)||canReplayBoardOperation(boards,boardId,'undo'))return;
  const partner=boards.find(item=>item.id!==boardId&&item.operationHistory.some(entry=>entry.id===operation.id));
  return partner ? {message:`跨画板移动需同时撤销。请先在「${partner.name}」撤销后续编辑。`,boardId:partner.id} : {message:'这次移动关联的另一份历史已不存在，无法安全撤销。可从工程备份恢复。'};
}
export function canReplayBoardOperation(boards:Board[], boardId:string, direction:'undo'|'redo'):boolean {
  const board=boards.find(item=>item.id===boardId);
  if(!board)return false;
  const operation=board.operationHistory[operationIndex(board,direction)];
  if(!operation)return false;
  if(!operation.id.startsWith(TRANSFER_PREFIX))return true;
  // Never undo only one half of a move; newer edits on the other board go first.
  return boards.filter(item=>item.operationHistory[operationIndex(item,direction)]?.id===operation.id).length===2;
}
export function replayBoardOperation(boards:Board[], boardId:string, direction:'undo'|'redo'):Board[] {
  if(!canReplayBoardOperation(boards,boardId,direction))return boards;
  const board=boards.find(item=>item.id===boardId)!;
  const operation=board.operationHistory[operationIndex(board,direction)];
  return boards.map(item=>{
    const index=operationIndex(item,direction),candidate=item.operationHistory[index];
    if(item!==board&&(!operation.id.startsWith(TRANSFER_PREFIX)||candidate?.id!==operation.id))return item;
    return {...item,elements:applyCanvasOperation(item.elements,candidate,direction),operationHistoryIndex:item.operationHistoryIndex+(direction==='undo'?-1:1)};
  });
}
