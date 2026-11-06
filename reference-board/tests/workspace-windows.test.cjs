const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../workspace-windows.js'),'utf8');

function owner(){
  const nodes=new Map(),sent=[],timers=[],listeners={};let current='gallery',opened,channel,clock=Date.now();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:true,value:'220',classList:{add(){},remove(){},toggle(){}},addEventListener(){},dispatchEvent(){}});return nodes.get(id);};
  const window={atlasWorkspace:{getMode:()=>current,show:mode=>{current=mode;window.atlasWorkspaceChanged?.(mode);},getFrame:()=>({contentWindow:{postMessage(data){queueMicrotask(()=>window.atlasWindowMessage({type:data.type==='atlas:hydrate'?'atlas:hydrated':'atlas:snapshot',requestId:data.requestId,snapshot:{boards:[{id:'b',elements:[]}],dirty:true}}));}}}),ensureFrame:()=>true,isFrameReady:()=>true},addEventListener(type,fn){listeners[type]=fn;},open(address){opened={address,closed:false,focus(){},close(){this.closed=true;}};return opened;}};
  const state={view:'all',query:'建筑',sort:'name',selectedId:'image',selectedIds:['image'],collapsedTags:new Set(),collapsedFolders:new Set()};
  const context={window,location:{search:'',origin:'http://127.0.0.1'},URLSearchParams,crypto:require('node:crypto').webcrypto,sessionStorage:{getItem(){return 'session';},setItem(){}},BroadcastChannel:class{constructor(){channel=this;}postMessage(message){sent.push(message);}},document:{getElementById:node,createElement:()=>node('created'+nodes.size),body:{append(){},classList:{add(){}}},querySelector:()=>({scrollTop:32}),addEventListener(){}},state,api:async()=>({images:[],folders:[],tags:[],trash:[],icons:{},imageOrder:[]}),render(){},toast(){},Event:class{},requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval,console};
  context.Date={now:()=>clock};
  vm.runInNewContext(source,context);window.setupAtlasWindows();
  return {nodes,sent,timers,state,window,advance:ms=>{clock+=ms;},get opened(){return opened;},message:async(type,data={})=>{const peer=new URL(opened.address,'http://127.0.0.1').searchParams.get('peer');await channel.onmessage({data:{type,from:peer,to:'owner',...data}});}};
}

test('blocked popup rolls back editor lock instead of leaving an unusable workspace',async()=>{
  const ui=owner();ui.window.open=()=>null;
  await ui.nodes.get('detachWorkspace').onclick();
  assert.equal(ui.nodes.get('workspaceTrigger').id,'workspaceTrigger');
  assert.equal([...ui.nodes.values()].find(n=>n.innerHTML?.includes('此工作区')).hidden,true);
  assert.equal(ui.nodes.get('boardActionsHost').inert,false);
});

test('background heartbeat silence does not unlock a second editor',async()=>{
  const ui=owner();await ui.nodes.get('detachWorkspace').onclick();
  await ui.message('ready');await ui.message('initialized');
  ui.window.atlasWorkspace.show('gallery');ui.advance(12000);
  const mask=[...ui.nodes.values()].find(n=>n.innerHTML?.includes('此工作区'));
  assert.equal(mask.hidden,false);
  for(let i=0;i<12;i++)ui.timers[0]();
  assert.equal(mask.hidden,false);
  ui.opened.closed=true;ui.timers[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mask.hidden,true);
  assert.equal(ui.state.query,'建筑');
});

test('merge restores child filters before acknowledging and unlocking the original',async()=>{
  const ui=owner();await ui.nodes.get('detachWorkspace').onclick();await ui.message('ready');
  const initial=ui.sent.find(item=>item.type==='initialize').snapshot;
  await ui.message('merge',{snapshot:{...initial,query:'植物',selectedIds:[]}});
  assert.equal(ui.state.query,'植物');
  assert.equal([...ui.nodes.values()].find(n=>n.innerHTML?.includes('此工作区')).hidden,true);
  assert.ok(ui.sent.some(item=>item.type==='merged'));
});
