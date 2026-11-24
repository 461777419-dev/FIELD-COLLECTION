const assert = require('node:assert/strict');
require('./register-typescript.cjs');
const { generateBoardThumbnail, boardThumbnailMarkup } = require('../utils/canvasUtils.ts');
const savedBtoa = global.btoa;
let encodes = 0;
global.btoa = value => { encodes++; return savedBtoa(value); };
const image = { id: 'a', type: 'image', x: 0, y: 0, width: 100, height: 100, href: 'data:image/png;base64,ORIGINAL', thumbnailHref: 'data:image/png;base64,SMALL', mediumHref: 'data:image/png;base64,MEDIUM' };
const decode = url => Buffer.from(url.split(',')[1], 'base64').toString('utf8');
try {
  const elements = [image];
  const result = generateBoardThumbnail(elements, '#18181b');
  assert.ok(decode(result).includes('SMALL'));
  assert.ok(!decode(result).includes('ORIGINAL'));
  assert.equal(generateBoardThumbnail(elements, '#18181b'), result);
  assert.equal(encodes, 1, 'unchanged board should not re-encode');
  generateBoardThumbnail(elements, '#fff');
  assert.equal(encodes, 2, 'background changes must invalidate');
  generateBoardThumbnail([...elements], '#fff');
  assert.equal(encodes, 3, 'document revision must invalidate');
  assert.ok(decode(generateBoardThumbnail([{ ...image, thumbnailHref: undefined }], '#fff')).includes('MEDIUM'));
  assert.ok(decode(generateBoardThumbnail([{ ...image, thumbnailHref: undefined, mediumHref: undefined }], '#fff')).includes('ORIGINAL'));
  const empty = []; generateBoardThumbnail(empty, '#fff'); const before = encodes;
  generateBoardThumbnail(empty, '#fff'); assert.equal(encodes, before);
  const markup = boardThumbnailMarkup(generateBoardThumbnail([
    {...image, href:'/board-media/original.png', thumbnailHref:'/board-media/small.png'},
    {id:'g',type:'group',x:0,y:0,width:200,height:100,name:'配色 & 造型',groupColor:'#a56b91'},
    {id:'t',type:'text',x:0,y:0,width:100,height:30,fontSize:20,fontColor:'#000',text:'<script>备注</script>'},
    {id:'s',type:'shape',shapeType:'circle',x:20,y:10,width:40,height:40,strokeWidth:2,strokeColor:'#000',fillColor:'#fff'},
    {...image,id:'hidden',isVisible:false,thumbnailHref:'HIDDEN'}
  ], '#fff'));
  assert.ok(markup.includes('/board-media/small.png'),'inline SVG keeps managed media references');
  assert.ok(markup.includes('<ellipse') && markup.includes('配色 &amp; 造型'));
  assert.ok(markup.includes('&lt;script&gt;备注&lt;/script&gt;') && !markup.includes('<script>'));
  assert.ok(!markup.includes('HIDDEN'));
  console.log('board-thumbnail: immutable cache, background invalidation and image LOD fallback passed');
} finally { global.btoa = savedBtoa; }
