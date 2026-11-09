require('./register-typescript.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {galleryIdFor,boardSelection,gallerySelection,linkedSelectionViewport}=require('../utils/atlas-selection.ts');
const first='11111111-1111-1111-1111-111111111111';
const second='22222222-2222-2222-2222-222222222222';
const hash='a'.repeat(64);
const catalog=[{id:first},{id:second,contentHash:hash}];
const elements=[
  {id:'original',type:'image',href:'/preview/'+first,originalHref:'/media/'+first},
  {id:'duplicate',type:'image',href:'/preview/'+first},
  {id:'imported',type:'image',href:'/board-media/'+hash+'.png'},
  {id:'shape',type:'shape',href:'/preview/'+first},
  {id:'unlinked',type:'image',href:'blob:temporary'},
];
test('图集多选同时选中画板上的重复引用与已入库素材',()=>{
  assert.deepEqual(boardSelection(elements,[first,second],catalog),['original','duplicate','imported']);
  assert.deepEqual(boardSelection(elements,[],catalog),[]);
  assert.deepEqual(boardSelection(elements,['missing'],catalog),[]);
});
test('画板多选去重映射回图集，不映射形状或未入库图片',()=>{
  assert.deepEqual(gallerySelection(elements,['original','duplicate','imported','shape','unlinked'],catalog),[first,second]);
  assert.deepEqual(gallerySelection(elements,[],catalog),[]);
});
test('素材识别保留原图身份，且不凭相同文件名误关联',()=>{
  assert.equal(galleryIdFor({type:'video',href:'/media/'+first},catalog),first);
  assert.equal(galleryIdFor({type:'image',href:'/board-media/'+hash+'.png'},[]),null);
  assert.equal(galleryIdFor({type:'image',href:'https://example.com/media/'+first},catalog),null);
});

test('画板选中顺序保留到图集，用于定位最后点击的图片',()=>{
  assert.deepEqual(gallerySelection(elements,['imported','original'],catalog),[second,first]);
});

test('联动定位保留可见视角，屏外图片居中但不放大',()=>{
  const current={zoom:1,panOffset:{x:0,y:0}},size={width:1000,height:700};
  assert.equal(linkedSelectionViewport({x:100,y:100,width:200,height:100},current,size),null);
  assert.equal(linkedSelectionViewport({x:2000,y:100,width:200,height:100},current,{width:0,height:0}),null);
  assert.deepEqual(linkedSelectionViewport({x:2000,y:100,width:200,height:100},current,size),{zoom:1,panOffset:{x:-1600,y:200}});
});

test('跨远距离多选按整体范围缩小，所有图片留在屏内',()=>{
  const bounds={x:-1000,y:-800,width:4000,height:2000},size={width:1000,height:700};
  const target=linkedSelectionViewport(bounds,{zoom:2,panOffset:{x:20,y:40}},size);
  assert.equal(target.zoom,0.225);
  const left=bounds.x*target.zoom+target.panOffset.x,top=bounds.y*target.zoom+target.panOffset.y;
  assert.ok(left>=50&&top>=50);
  assert.ok(left+bounds.width*target.zoom<=950&&top+bounds.height*target.zoom<=650);
});
