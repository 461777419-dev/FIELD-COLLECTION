const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {convertPresentation}=require('../ppt-import');
const nativeFs=require('node:fs');
const {Readable}=require('node:stream');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'field-ppt-check-'));
  try{
    const destination=path.join(directory,'fixture.pptx'),legacy=path.join(directory,'fixture.ppt');
    const literal=value=>"'"+value.replace(/'/g,"''")+"'";
    const code=`$ErrorActionPreference='Stop';$a=New-Object -ComObject PowerPoint.Application;$p=$null;try{$p=$a.Presentations.Add(0);$p.PageSetup.SlideWidth=960;$p.PageSetup.SlideHeight=540;for($i=1;$i -le 2;$i++){$s=$p.Slides.Add($i,12);$t=$s.Shapes.AddTextbox(1,50,50,800,100);$t.TextFrame.TextRange.Text=('Slide '+$i);$t.TextFrame.TextRange.Font.Size=48};$p.SaveAs(${literal(destination)},24);$p.SaveAs(${literal(legacy)},1)}finally{if($p){$p.Close()};if($a.Presentations.Count -eq 0){$a.Quit()}}`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:60000});
    const bytes=await fs.readFile(destination);
    const result=await convertPresentation(bytes,'pptx');
    assert.equal(result.slides.length,2);assert.equal(result.slides[0].width,1600);assert.equal(result.slides[0].height,900);
    assert.notEqual(result.slides[0].href,result.slides[1].href,'individual slides preserve distinct content');
    const oldResult=await convertPresentation(await fs.readFile(legacy),'ppt');
    assert.equal(oldResult.slides.length,2);
    const mediaDirectory=path.join(directory,'media');
    const stored=await convertPresentation(nativeFs.createReadStream(destination),'pptx',{mediaDirectory});
    assert.ok(stored.slides.every(slide=>/^\/board-media\/[a-f0-9]{64}\.png$/.test(slide.href)));
    assert.ok(JSON.stringify(stored).length<1000,'stream import returns references instead of bulk base64');
    assert.equal((await fs.readdir(mediaDirectory)).length,2);
    await assert.rejects(convertPresentation(Readable.from([Buffer.alloc(32)]),'pptx',{maxBytes:16}),error=>error.status===413);
    if(process.env.PPT_TEST_LARGE==='1'){
      const {unzipSync,zipSync}=require('../../artflow-integrated/node_modules/fflate');
      const entries=unzipSync(bytes);
      entries['docProps/padding.xml']=Buffer.from('<padding>'+ ' '.repeat(61*1024*1024)+'</padding>');
      const large=path.join(directory,'large.pptx');await fs.writeFile(large,zipSync(entries,{level:0}));
      assert.ok((await fs.stat(large)).size>60*1024*1024);
      const largeResult=await convertPresentation(nativeFs.createReadStream(large),'pptx',{mediaDirectory});
      assert.equal(largeResult.slides.length,2);
      console.log('Large PPTX: >61MB streamed from disk to persistent PNG references passed');
      if(process.env.PPT_TEST_OUTPUT){await fs.mkdir(process.env.PPT_TEST_OUTPUT,{recursive:true});await fs.copyFile(large,path.join(process.env.PPT_TEST_OUTPUT,'sample-large.pptx'));}
    }
    if(process.env.PPT_TEST_OUTPUT){await fs.mkdir(process.env.PPT_TEST_OUTPUT,{recursive:true});await fs.copyFile(destination,path.join(process.env.PPT_TEST_OUTPUT,'sample.pptx'));}
    await assert.rejects(convertPresentation(Buffer.from('not a ppt'),'pptx'));
    console.log('PowerPoint conversion: genuine two-slide PPT/PPTX → ordered 1600×900 PNG pages passed');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
