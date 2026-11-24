const assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const {transformSync}=require('esbuild');
const updates=[],refs=[];
const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:value=>[value,update=>updates.push(update)],useRef:value=>{const ref={current:value};refs.push(ref);return ref;}};
const code=transformSync(require('node:fs').readFileSync(path.join(__dirname,'../components/ImageCompare.tsx'),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code;
const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>{assert.equal(name,'react');return react;}});
const tree=mod.exports.ImageCompare({images:[{id:'1',name:'图1',href:'1'},{id:'2',name:'图2',href:'2'}],immediate:true,onClose(){}});
function find(node){if(!node||typeof node!=='object')return null;if(node.props?.onPointerMove)return node;for(const child of (node.children||[]).flat(Infinity)){const result=find(child);if(result)return result;}return null;}
const pane=find(tree);assert.ok(pane,'comparison drag surface exists');
const event={button:0,pointerId:1,clientX:10,clientY:20,currentTarget:{setPointerCapture(){}}};
for(const finish of ['onPointerUp','onPointerCancel','onLostPointerCapture']){
  pane.props.onPointerDown(event);pane.props.onPointerMove({...event,clientX:40,clientY:70});pane.props[finish]();
  assert.equal(refs[0].current,null);
  const result=updates.pop()({zoom:2,x:0,y:0});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{zoom:2,x:30,y:50},'queued move remains safe after drag ends');
}
pane.props.onPointerDown({...event,button:2});assert.equal(refs[0].current,null,'right click does not start dragging');
console.log('image compare: queued movement survives pointer release, cancellation and lost capture');
