const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const sharp=require('sharp');
const {writePsdBuffer}=require('ag-psd');

test('画板保留原始像素，TIFF/PSD 可解码，图库预览与原文件不变',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-image-'));
  process.env.REFERENCE_BOARD_DATA_DIR=dir;
  const {server}=require('../server');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const pixels=sharp({create:{width:2400,height:1200,channels:4,background:'#de4380'}});
    const png=await pixels.clone().png().toBuffer();
    const tiff=await pixels.clone().tiff().toBuffer();
    const raw=await pixels.clone().raw().toBuffer();
    const psd=writePsdBuffer({width:2400,height:1200,imageData:{width:2400,height:1200,data:new Uint8ClampedArray(raw)}});
    for(const [ext,type,bytes] of [['png','image/png',png],['tiff','image/tiff',tiff],['psd','image/vnd.adobe.photoshop',psd]]){
      const upload=await fetch(base+'/api/images',{method:'POST',headers:{'Content-Type':type,'X-File-Name':`detail.${ext}`,'X-Duplicate-Action':'keep'},body:bytes});
      assert.equal(upload.status,201);
      const image=await upload.json();
      const preview=await fetch(base+'/preview/'+image.id).then(r=>r.arrayBuffer());
      assert.equal((await sharp(Buffer.from(preview)).metadata()).width,1800,'图库仍使用轻量预览');
      const response=await fetch(base+'/canvas-image/'+image.id);
      assert.equal(response.status,200);
      const canvas=Buffer.from(await response.arrayBuffer());
      const metadata=await sharp(canvas).metadata();
      assert.equal(metadata.width,2400,ext+' 画板不缩小');
      assert.equal(metadata.height,1200);
      if(ext==='png')assert.deepEqual(canvas,png,'原生图片不重新压缩');
      const original=Buffer.from(await fetch(base+'/media/'+image.id).then(r=>r.arrayBuffer()));
      assert.deepEqual(original,bytes,'原文件不改变');
      if(ext==='png') {
        const detail=await fetch(base+'/canvas-image/'+image.id+'?edge=2048');
        assert.equal((await sharp(Buffer.from(await detail.arrayBuffer())).metadata()).width,2048,'画板按实际像素需求加载，不受原图配额限制');
        const stored=await fetch(base+'/api/board/media',{method:'POST',headers:{'Content-Type':'image/png'},body:png}).then(r=>r.json());
        const boardDetail=await fetch(base+stored.url+'?edge=2048');
        assert.equal((await sharp(Buffer.from(await boardDetail.arrayBuffer())).metadata()).width,2048,'直接导入画板使用原始资源生成细节');
        assert.equal((await fetch(base+stored.url+'?edge=-1')).status,400);
      }
    }
    assert.equal((await fetch(base+'/canvas-image/missing')).status,404);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
