const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBoardHistory}=require('../board-history');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'field-history-check-'));
try{
  const history=createBoardHistory(dir),board={id:'test-board',name:'测试画板',elements:[{id:'a',type:'text',text:'初稿'}],operationHistory:[{large:'journal'}],operationHistoryIndex:0};
  const first=history.snapshot(board);
  assert.equal(history.snapshot(board).id,first.id,'identical content deduplicates');
  const next={...board,elements:[{id:'a',type:'text',text:'修改稿'}]};
  assert.equal(history.snapshot(next).id,first.id,'automatic snapshots are throttled');
  const second=history.snapshot(next,'恢复前备份',true);
  assert.notEqual(second.id,first.id);
  assert.equal(history.read(board.id,first.id).board.elements[0].text,'初稿','old snapshot stays immutable');
  assert.equal(history.read(board.id,second.id).board.elements[0].text,'修改稿');
  assert.deepEqual(history.read(board.id,second.id).board.operationHistory,[]);
  const background=history.snapshot({...next,canvasBackgroundColor:'#fff'},'背景修改',true);
  assert.notEqual(background.id,second.id,'background changes create restore points');
  assert.throws(()=>history.list('../../outside'));
  assert.throws(()=>history.read(board.id,'../document'));
  for(let i=0;i<45;i++)history.snapshot({...board,elements:[{id:'a',value:i}]},'测试',true);
  assert.equal(history.list(board.id).length,40,'bounded retention');
  console.log('board history: immutable restore points, deduplication, interval, retention and path validation passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
