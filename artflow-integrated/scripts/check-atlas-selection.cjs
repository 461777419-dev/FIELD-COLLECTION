require('./register-typescript.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {galleryIdFor,boardSelection,gallerySelection}=require('../utils/atlas-selection.ts');
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
