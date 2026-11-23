require('./register-typescript.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {moveImagesBetweenBoards,movableBoardImages,replayBoardOperation,canReplayBoardOperation}=require('../utils/board-image-transfer.ts');
const {commitCanvasOperation}=require('../utils/operationHistory.ts');
const image=(id,x=10,y=20)=>({id,type:'image',x,y,width:100,height:80,href:'/board-media/original.png',originalHref:'/media/original',rotation:20,opacity:.6,grayscale:true,borderRadius:12});
const board=(id,elements=[])=>({id,name:id,elements,operationHistory:[],operationHistoryIndex:-1,zoom:1,panOffset:{x:0,y:0},canvasBackgroundColor:'#fff'});
test('跨画板多选移动保留效果、原图、相对位置和现有目标内容',()=>{
  const a=image('a'),b={...image('b',150,300),parentId:'frame'},frame={id:'frame',type:'frame',x:0,y:0,width:400,height:400};
  const previous=[board('source',[a,b,frame]),board('target',[image('existing')]),board('other')];
  const next=moveImagesBetweenBoards(previous,'source','target',['a','b'],{x:600,y:400});
  assert.deepEqual(next[0].elements,[frame]);assert.equal(next[1].elements.length,3);assert.equal(next[2],previous[2]);
  const [movedA,movedB]=next[1].elements.slice(1);
  assert.ok(Math.abs(movedB.x-movedA.x-140)<1e-9);assert.ok(Math.abs(movedB.y-movedA.y-280)<1e-9);assert.equal(movedB.parentId,undefined);
  for(const property of ['href','originalHref','rotation','opacity','grayscale','borderRadius'])assert.equal(movedA[property],a[property]);
  assert.equal(previous[0].elements.length,3);assert.equal(previous[1].elements.length,1);
  assert.equal(next[0].operationHistory[0].id,next[1].operationHistory[0].id);
});
test('一次撤销/重做同时恢复两边，重新加载历史也不会复制或丢失图片',()=>{
  const previous=[board('source',[image('a')]),board('target')];
  const moved=JSON.parse(JSON.stringify(moveImagesBetweenBoards(previous,'source','target',['a'],{x:500,y:400})));
  const undone=replayBoardOperation(moved,'target','undo');
  assert.deepEqual(undone[0].elements,previous[0].elements);assert.equal(undone[1].elements.length,0);
  const redone=replayBoardOperation(undone,'source','redo');assert.equal(redone[0].elements.length,0);assert.equal(redone[1].elements.length,1);
});
test('另一边有后续编辑时先撤销该编辑，避免只恢复一半的移动',()=>{
  const moved=moveImagesBetweenBoards([board('source',[image('a')]),board('target')],'source','target',['a'],{x:500,y:400});
  const after=[...moved[1].elements,image('later')];
  const edited=[moved[0],{...moved[1],elements:after,...commitCanvasOperation(moved[1].operationHistory,moved[1].operationHistoryIndex,moved[1].elements,after)}];
  assert.equal(canReplayBoardOperation(edited,'source','undo'),false);assert.equal(replayBoardOperation(edited,'source','undo'),edited);
  const step=replayBoardOperation(edited,'target','undo');assert.equal(step[1].elements.length,1);
  const undone=replayBoardOperation(step,'source','undo');assert.equal(undone[0].elements.length,1);assert.equal(undone[1].elements.length,0);
});
test('锁定图片及锁定组内图片不可移动，缺失目标与重复ID无副作用',()=>{
  const elements=[image('a'),{...image('locked'),isLocked:true},{...image('child'),parentId:'group'},{id:'group',type:'group',isLocked:true,x:0,y:0,width:200,height:200}];
  assert.deepEqual(movableBoardImages(elements,['a','locked','child']).map(element=>element.id),['a']);
  const previous=[board('source',elements),board('target',[image('a')])];
  for(const target of ['source','missing','target'])assert.equal(moveImagesBetweenBoards(previous,'source',target,['a'],{x:0,y:0}),previous);
  assert.equal(moveImagesBetweenBoards(previous,'source','target',['locked','child'],{x:0,y:0}),previous);
});
