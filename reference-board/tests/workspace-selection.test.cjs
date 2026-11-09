const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../workspace-selection.js'),'utf8');
function session(){
  const channels=[];
  function client(tool='gallery'){
    const handlers={},sent=[],scrolls=[],notices=[];
    const rect={top:0,bottom:500,left:0,right:600,height:500};
    const cards=['a','b'].map((id,index)=>({dataset:{id},classList:{toggle(){}},getBoundingClientRect:()=>({top:100+index*800,bottom:200+index*800,left:20,right:120,height:100})}));
    const area={clientHeight:500,scrollTop:0,getBoundingClientRect:()=>rect,scrollTo(options){scrolls.push(options);}};
    const state={images:[{id:'a'},{id:'b'}],selectedIds:[],selectedId:null,view:'all'};
    let owns=tool,ready=true,mode=tool;
    const frame={postMessage(message){sent.push(message);}};
    const window={addEventListener(type,fn){handlers[type]=fn;},atlasOwnsWorkspace:mode=>mode===owns,
      atlasWorkspace:{isFrameReady:()=>ready,getFrame:()=>({contentWindow:frame}),getMode:()=>mode}};
    const renderInspector=()=>window.atlasGallerySelectionChanged?.();
    const context={window,state,location:{search:'?owner=test-session',origin:'http://localhost'},URLSearchParams,
      crypto:require('node:crypto').webcrypto,sessionStorage:{getItem:()=>null,setItem(){}},
      BroadcastChannel:class{constructor(name){this.name=name;channels.push(this);}postMessage(data){for(const peer of channels)if(peer!==this&&peer.name===this.name)queueMicrotask(()=>peer.onmessage?.({data:structuredClone(data)}));}close(){}},
      document:{querySelectorAll:()=>cards,querySelector:()=>area,addEventListener(){},body:{classList:{contains:name=>name==='board-active'&&mode==='board'}}},renderInspector,renderGallery(){},toast:message=>notices.push(message),Date,requestAnimationFrame:fn=>queueMicrotask(fn)};
    vm.runInNewContext(source,context);
    return {state,sent,window,scrolls,notices,cards,select(ids){state.selectedIds=ids;state.selectedId=ids.at(-1)||null;renderInspector();},
      board(ids,focusId){handlers.message({origin:'http://localhost',source:frame,data:{type:'atlas:selection-changed',ids,focusId}});},
      message(type){handlers.message({origin:'http://localhost',source:frame,data:{type}});},
      show(value){mode=value;handlers['atlas:workspace-shown']();},transfer(active){window.atlasSelectionTransfer(active);},setReady(value){ready=value;},setOwner(value){owns=value;}};
  }
  return {client,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('独立画板和主图集双向单选、多选、取消选中，不回传循环',async()=>{
  const s=session(),gallery=s.client(),board=s.client('board');await s.flush();
  gallery.select(['a','b']);await s.flush();
  assert.deepEqual([...board.state.selectedIds],['a','b']);
  assert.deepEqual([...board.sent.at(-1).ids],['a','b']);
  board.board(['b']);await s.flush();
  assert.deepEqual([...gallery.state.selectedIds],['b']);
  const count=board.sent.length;
  board.select([]);await s.flush(); // Hidden gallery has no authority.
  assert.deepEqual([...gallery.state.selectedIds],['b']);
  assert.equal(board.sent.length,count);
  board.board([]);await s.flush();
  assert.deepEqual([...gallery.state.selectedIds],[]);
});
test('交接中收到的新选区优先于旧快照，初始化结束后重放',async()=>{
  const s=session(),gallery=s.client(),child=s.client();await s.flush();
  gallery.select(['a']);await s.flush();
  child.transfer(true);
  child.select([]); // Simulate restoring an older gallery snapshot.
  gallery.select(['b']);await s.flush();
  child.transfer(false);await s.flush();
  assert.deepEqual([...child.state.selectedIds],['b']);
  assert.deepEqual([...gallery.state.selectedIds],['b']);
  assert.deepEqual([...child.sent.at(-1).ids],['b']);
});
test('延迟打开和合并回来的画板都能重新请求最新选区',async()=>{
  const s=session(),gallery=s.client(),child=s.client('board');await s.flush();
  child.setReady(false);gallery.select(['a']);await s.flush();
  child.setReady(true);child.message('atlas:selection-request');
  assert.deepEqual([...child.sent.at(-1).ids],['a']);
  child.board(['b']);await s.flush();
  gallery.message('atlas:hydrated');
  assert.deepEqual([...gallery.sent.at(-1).ids],['b']);
});
test('后开的独立图集收到现有选区，仍能继续选择',async()=>{
  const s=session(),gallery=s.client();gallery.select(['a']);
  const child=s.client();await s.flush();
  assert.deepEqual([...child.state.selectedIds],['a']);
  child.select(['b']);await s.flush();
  assert.deepEqual([...gallery.state.selectedIds],['b']);
});

test('独立窗口只定位另一侧，多选定位本次点击图片，重放不再次滚动',async()=>{
  const s=session(),gallery=s.client(),board=s.client('board');await s.flush();
  gallery.select(['b']);await s.flush();
  assert.equal(board.sent.at(-1).reveal,true);
  assert.equal(board.sent.at(-1).focusId,'b');
  assert.equal(gallery.scrolls.length,0);
  board.board(['a','b'],'b');await s.flush();
  assert.equal(gallery.scrolls.length,1);
  assert.equal(gallery.scrolls[0].top,700);
  gallery.transfer(true);gallery.transfer(false);await s.flush();
  assert.equal(gallery.scrolls.length,1);
  assert.equal(gallery.sent.at(-1).reveal,false);
  board.board(['b','a'],'a');await s.flush();
  assert.equal(gallery.scrolls.length,1); // a is already visible.
});

test('隐藏工作区显示后定位，清空和交接不产生循环定位',async()=>{
  const s=session(),gallery=s.client(),board=s.client('board');await s.flush();
  gallery.show('board');board.board(['b']);await s.flush();
  assert.equal(gallery.scrolls.length,0);
  gallery.show('gallery');await s.flush();
  assert.equal(gallery.scrolls.length,1);
  gallery.select(['a']);await s.flush();
  board.show('board');await s.flush();
  assert.equal(board.sent.at(-1).reveal,true);
  assert.deepEqual([...board.sent.at(-1).ids],['a']);
  board.board([]);await s.flush();
  assert.equal(gallery.scrolls.length,1);
});

test('筛选隐藏目标时保留筛选并提示，不滚动到无关图片',async()=>{
  const s=session(),gallery=s.client(),board=s.client('board');await s.flush();
  gallery.cards.pop();board.board(['b']);await s.flush();
  assert.equal(gallery.scrolls.length,0);
  assert.equal(gallery.notices.length,1);
  assert.equal(gallery.state.view,'all');
});
