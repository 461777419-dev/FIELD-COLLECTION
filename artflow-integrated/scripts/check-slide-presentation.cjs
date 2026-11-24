const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {transformSync}=require('esbuild');
const updates=[],refs=[];let stateIndex=0;
const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:value=>[stateIndex++===0?'pen':value,update=>updates.push(update)],useRef:value=>{const ref={current:value};refs.push(ref);return ref;},useEffect(){},useMemo:compute=>compute()};
const code=transformSync(fs.readFileSync(path.join(__dirname,'../components/SlidePresentation.tsx'),'utf8'),{loader:'tsx',format:'cjs',jsx:'transform'}).code;
const mod={exports:{}};
vm.runInNewContext(code,{module:mod,exports:mod.exports,DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return this;}},require:name=>{
  if(name==='react')return react;
  if(name==='./CanvasElement')return {CanvasElement(){}};
  if(name==='../utils/canvasUtils')return {generateId:()=> 'note',getElementBounds:element=>element};
  throw Error('Unexpected import '+name);
}});
const frame={id:'slide',x:0,y:0,width:100,height:100};
const tree=mod.exports.SlidePresentation({frame,elements:[],index:0,total:1,onNext(){},onPrev(){},onExit(){},onKeep(){}});
function find(node){if(!node||typeof node!=='object')return null;if(node.type==='svg')return node;for(const child of(node.children||[]).flat(Infinity)){const result=find(child);if(result)return result;}return null;}
const svg=find(tree);refs[1].current={getScreenCTM:()=>({inverse(){return {};}})};
const event={button:0,pointerId:1,clientX:10,clientY:10,currentTarget:{setPointerCapture(){}}};
svg.props.onPointerDown(event);let notes=updates.shift()([]);
svg.props.onPointerMove({...event,clientX:40,clientY:50});const queuedMove=updates.shift();svg.props.onPointerUp();
assert.equal(refs[0].current,null);
notes=queuedMove(notes);assert.equal(notes[0].points.length,2,'queued last point survives pointer release');
assert.deepEqual(JSON.parse(JSON.stringify(notes[0].points[1])),{x:40,y:50});
console.log('presentation annotation: final queued point survives pointer release');
