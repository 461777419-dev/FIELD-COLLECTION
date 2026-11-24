require('./register-typescript.cjs');
const assert=require('node:assert/strict');
const {exportPortableProject,importPortableProject}=require('../utils/portable-project.ts');
const {unzipSync,strFromU8,zipSync,strToU8}=require('fflate');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64');
const media='/board-media/'+'a'.repeat(64)+'.png';
const board={id:'board',name:'迁移测试',canvasBackgroundColor:`url(${media})`,elements:[{id:'g',type:'group',x:0,y:0,width:100,height:100,name:'分组',groupNote:'保留备注'},{id:'i',type:'image',x:10,y:10,width:80,height:80,parentId:'g',href:media,originalHref:media,mimeType:'image/png'}],operationHistory:[],operationHistoryIndex:-1};
(async()=>{
  const realFetch=global.fetch;let reads=0,uploads=0;
  global.fetch=async(url,options)=>{
    if(url===media){reads++;return new Response(png,{headers:{'Content-Type':'image/png'}});}
    if(url==='/api/board/media'){uploads++;assert.deepEqual(Buffer.from(await options.body.arrayBuffer()),png);return Response.json({url:'/board-media/'+'b'.repeat(64)+'.png'});}
    throw Error('unexpected request '+url);
  };
  try{
    const blob=await exportPortableProject([board],()=>{}),bytes=new Uint8Array(await blob.arrayBuffer());
    assert.equal(reads,1,'duplicate media and background read only once');
    const entries=unzipSync(bytes),manifest=JSON.parse(strFromU8(entries['project.json']));
    assert.ok(manifest.boards[0].elements[1].href.startsWith('portable:'));
    const loaded=await importPortableProject(new File([bytes],'test.field.zip'),()=>{});
    assert.equal(uploads,1);assert.notEqual(loaded[0].id,board.id);
    assert.equal(loaded[0].elements[1].parentId,loaded[0].elements[0].id);
    assert.equal(loaded[0].elements[0].groupNote,'保留备注');
    assert.equal(loaded[0].canvasBackgroundColor,'url(/board-media/'+'b'.repeat(64)+'.png)');
    assert.equal(board.elements[1].href,media,'original project untouched');
    const broken={...entries};delete broken['assets/0'];
    await assert.rejects(importPortableProject(new File([zipSync(broken)],'missing.zip'),()=>{}),/缺少素材/);
    await assert.rejects(importPortableProject(new File([zipSync({'project.json':strToU8('{}')})],'bad.zip'),()=>{}),/不支持/);
    console.log('portable project: complete media/background roundtrip, deduplication, new identities, parent links and missing-media rejection passed');
  }finally{global.fetch=realFetch;}
})().catch(error=>{console.error(error);process.exitCode=1;});
