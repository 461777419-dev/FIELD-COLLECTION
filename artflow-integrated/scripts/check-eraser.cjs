require('./register-typescript.cjs');
const assert=require('node:assert/strict');
const {eraseElementIds,eraseElements,eraserDiameter,eraserCursor}=require('../utils/eraser.ts');
const {commitCanvasOperation,applyCanvasOperation}=require('../utils/operationHistory.ts');
const text={id:'text',type:'text',x:100,y:100,width:100,height:50,text:'备注',fontSize:20,fontColor:'#000'};
const shape={id:'shape',type:'shape',shapeType:'rectangle',x:250,y:100,width:100,height:80,fillColor:'transparent',strokeWidth:2};
const path={id:'path',type:'path',x:0,y:0,points:[{x:400,y:100},{x:600,y:100}],strokeWidth:2};
const elements=[text,shape,path,{...text,id:'locked',isLocked:true},{...text,id:'hidden',isVisible:false},
  {id:'image',type:'image',x:100,y:100,width:100,height:50},{id:'group',type:'group',x:100,y:100,width:100,height:50}];
assert.deepEqual([...eraseElementIds(elements,{x:120,y:120},{x:120,y:120},6)],['text']);
assert.ok(!eraseElementIds([shape],{x:300,y:140},{x:300,y:140},6).size,'empty shape interior is not a painted stroke');
assert.ok(eraseElementIds([shape],{x:245,y:140},{x:245,y:140},6).has('shape'));
assert.deepEqual([...eraseElementIds(elements,{x:90,y:120},{x:620,y:120},20)],['text','shape','path'],'fast sweep hits sparse path segments');
assert.ok(eraseElementIds([{...path,points:[{x:400,y:100}]}],{x:400,y:100},{x:400,y:100},6).has('path'),'single-point strokes');
assert.ok(!eraseElementIds([{...text,parentId:'parent'},{id:'parent',type:'group',isLocked:true}],{x:120,y:120},{x:120,y:120},6).size,'locked ancestor');
const rotated={...text,rotation:90};assert.ok(eraseElementIds([rotated],{x:150,y:170},{x:150,y:170},3).has('text'));
const circle={...shape,shapeType:'circle'};assert.ok(!eraseElementIds([circle],{x:250,y:100},{x:250,y:100},2).size,'circle bounding corner is empty');
const ids=eraseElementIds(elements,{x:90,y:120},{x:620,y:120},20),next=elements.filter(element=>!ids.has(element.id));
const journal=commitCanvasOperation([], -1,elements,next);
assert.deepEqual(applyCanvasOperation(next,journal.operationHistory[0],'undo'),elements,'one undo restores erased objects');
assert.deepEqual(applyCanvasOperation(elements,journal.operationHistory[0],'redo'),next);
console.log('eraser: click/sweep, strokes/shapes/text, rotation, protected media/locked ancestors and undo/redo passed');

async function checkArea(){
  const {getElementBounds,generateBoardThumbnail,boardThumbnailMarkup}=require('../utils/canvasUtils.ts');
  const {erasureScale}=require('../utils/element-erasure.ts');
  const {serializeProjectDocument,deserializeProjectDocument}=require('../utils/projectDocument.ts');
  assert.equal(eraserDiameter(150),99);
  const cursorSvg=decodeURIComponent(eraserCursor(99).split('data:image/svg+xml,')[1].split('"')[0]);
  assert.ok(cursorSvg.includes('width="127"'),'99px cursor remains below Chromium 128px cursor limit');
  const fill={id:'fill',type:'path',name:'套索填色',x:0,y:0,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],closed:true,fillColor:'#f00',strokeColor:'#f00',strokeWidth:0,opacity:.5};
  assert.ok(eraseElementIds([fill],{x:50,y:50},{x:50,y:50},2).has('fill'),'filled lasso interior is erasable');
  const area=eraseElements(elements,{x:120,y:120},{x:140,y:120},8,undefined,'gesture');
  assert.equal(area.length,elements.length,'area mode is default and preserves editable objects');
  assert.equal(area[0].erasures.length,1);
  assert.equal(elements[0].erasures,undefined,'source is immutable');
  assert.equal(area.find(el=>el.id==='image'),elements.find(el=>el.id==='image'));
  assert.equal(area.find(el=>el.id==='locked'),elements.find(el=>el.id==='locked'));
  const swept=eraseElements(area,{x:140,y:120},{x:160,y:120},8,'area','gesture');
  assert.equal(swept[0].erasures.length,1,'one stroke per gesture');
  assert.equal(swept[0].erasures[0].points.length,3);
  assert.ok(!eraseElements(elements,{x:120,y:120},{x:120,y:120},8,'object').some(el=>el.id==='text'));
  const record=commitCanvasOperation([],-1,elements,area);
  assert.deepEqual(applyCanvasOperation(area,record.operationHistory[0],'undo'),elements);
  assert.deepEqual(applyCanvasOperation(elements,record.operationHistory[0],'redo'),area);
  const board={id:'board',name:'范围擦除',elements:[area[0],fill],operationHistory:[],operationHistoryIndex:-1,zoom:1,panOffset:{x:0,y:0},canvasBackgroundColor:'#fff'};
  const loaded=deserializeProjectDocument(JSON.parse(JSON.stringify(serializeProjectDocument([board]))));
  assert.deepEqual(loaded[0].elements[0].erasures,area[0].erasures,'save/reload retains partial erasures');
  assert.deepEqual(loaded[0].elements[1],fill,'filled lasso survives persistence');
  assert.ok(boardThumbnailMarkup(generateBoardThumbnail(area,'#fff')).includes('<mask'));
  const scaled={...area[0],width:200,height:100};
  assert.deepEqual(erasureScale(area[0].erasures[0],getElementBounds(scaled)),{x:2,y:2});

  // Real pixels: export must punch a hole only in the erased object layer.
  const {createCanvas}=require('../../reference-board/node_modules/@napi-rs/canvas');
  const {composeExportPng}=require('../capabilities/canvas-export/compose.ts');
  const top={id:'top',type:'shape',shapeType:'rectangle',x:0,y:0,width:100,height:100,strokeColor:'#f00',strokeWidth:1,fillColor:'#f00'};
  const bottom={...top,id:'bottom',isLocked:true,fillColor:'#00f'};
  const partial=eraseElements([bottom,top],{x:50,y:50},{x:50,y:50},10);
  const savedDocument=global.document,canvases=[];
  global.document={createElement:()=>{const canvas=createCanvas(1,1);canvas.toBlob=callback=>callback(new Blob([canvas.toBuffer('image/png')]));canvases.push(canvas);return canvas;}};
  try{
    assert.ok(await composeExportPng({elements:partial,selectionIds:[],background:'#fff'},false));
    const ctx=canvases[0].getContext('2d');
    const pixel=(x,y)=>[...ctx.getImageData((x+24)*2,(y+24)*2,1,1).data];
    assert.deepEqual(pixel(50,50),[0,0,255,255],'hole reveals protected layer underneath');
    assert.deepEqual(pixel(20,20),[255,0,0,255],'outside radius remains intact');
    canvases.length=0;
    assert.ok(await composeExportPng({elements:[fill],selectionIds:[],background:'#fff'},false));
    const filledPixel=[...canvases[0].getContext('2d').getImageData(148,148,1,1).data];
    assert.equal(filledPixel[0],255);assert.ok(filledPixel[1]>=126&&filledPixel[1]<=128);assert.equal(filledPixel[3],255,'closed lasso exports a half-opacity fill');
  }finally{global.document=savedDocument;}
  console.log('area eraser: partial pixels, isolated export layers, persistence, undo/redo, thumbnail masks and transform scaling passed');
}
checkArea().catch(error=>{console.error(error);process.exitCode=1;});
