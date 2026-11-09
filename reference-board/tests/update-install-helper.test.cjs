const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const {spawn,spawnSync}=require('node:child_process');
const compiler='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';

test('生产更新入口：助手就绪后后端退出，助手继续安装并重启测试程序',{skip:process.platform!=='win32'||!fs.existsSync(compiler),timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'图集 后端退出测试 '));
 let backend,helperPid;
 try{
  const exe=path.join(dir,'fixture.exe');
  const compile=spawnSync(compiler,['/nologo','/target:winexe','/out:'+exe,path.join(__dirname,'fixtures/update-installer.cs')],{windowsHide:true,encoding:'utf8'});
  assert.equal(compile.status,0,compile.stdout+compile.stderr);
  const bytes=fs.readFileSync(exe),keys=crypto.generateKeyPairSync('ed25519');
  const {fields}=require('../app-updater');
  const item={version:'1.0.4',url:'https://github.com/test/album/releases/download/v1.0.4/setup.exe',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length,notes:'隔离安装测试'};
  item.signature=crypto.sign(null,Buffer.from(fields(item)),keys.privateKey).toString('base64');
  const config={repository:'test/album',publicKey:keys.publicKey.export({type:'spki',format:'pem'})};
  const inputFile=path.join(dir,'input.json');fs.writeFileSync(inputFile,JSON.stringify({item,config,dir,exe}));
  // This child uses the real updater launcher, then exits exactly as the backend
  // does after the desktop confirms shutdown. Only the fixture can be installed.
  const source=`const fs=require('fs'),cp=require('child_process');
    const {createUpdater}=require(process.argv[1]);
    const {item,config,dir,exe}=JSON.parse(fs.readFileSync(process.argv[2]));
    (async()=>{
      const u=createUpdater({directory:dir,config,version:'1.0.3',desktop:true,desktopPid:process.pid,desktopExe:exe,exitTimeoutSeconds:10,
        fetcher:async url=>new Response(url.endsWith('latest.json')?JSON.stringify(item):fs.readFileSync(exe)),
        launch:(command,args,opts)=>{const child=cp.spawn(command,args,opts);fs.writeFileSync(require('path').join(dir,'helper-pid.txt'),String(child.pid));return child;}});
      await u.check();await u.download();const status=await u.install();
      if(status.phase!=='installing')throw Error('helper not ready');
      fs.writeFileSync(require('path').join(dir,'ready.txt'),'ready');
    })().catch(error=>{console.error(error);process.exitCode=1;});`;
  backend=spawn(process.execPath,['-e',source,path.resolve(__dirname,'../app-updater.js'),inputFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';backend.stdout.on('data',b=>output+=b);backend.stderr.on('data',b=>output+=b);
  const exitCode=await new Promise((resolve,reject)=>{backend.once('exit',resolve);backend.once('error',reject);});
  assert.equal(exitCode,0,output);
  assert.ok(fs.existsSync(path.join(dir,'ready.txt')),'real helper handshake');
  const jobRecord=JSON.parse(fs.readFileSync(path.join(dir,'update-install-state.json'),'utf8'));
  helperPid=Number(fs.readFileSync(path.join(jobRecord.jobDir,'helper.pid'),'utf8'));
  const job=JSON.parse(fs.readFileSync(path.join(dir,'update-install-state.json'),'utf8'));
  let state;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    try{state=JSON.parse(fs.readFileSync(path.join(job.jobDir,'status.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
    if(['complete','error'].includes(state?.phase))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(state?.phase,'complete',JSON.stringify(state)+' '+fs.readFileSync(path.join(job.jobDir,'install.log'),'utf8'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'runtime/package.json'),'utf8')).version,'1.0.4');
  const restarted=path.join(dir,'restarted.txt');
  const restartDeadline=Date.now()+2000;
  while(!fs.existsSync(restarted)&&Date.now()<restartDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(fs.existsSync(restarted),'fixture relaunched after backend exit');
 }finally{
  if(backend?.exitCode===null)backend.kill();
  if(helperPid){try{process.kill(helperPid);}catch{}}
  // Let the short-lived fixture release its executable before removing the sandbox.
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
test('真实 Windows 安装助手：退出交接、中文空格目录、重启及失败日志',{skip:process.platform!=='win32'||!fs.existsSync(compiler),timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'图集 更新测试 '));
 try{const exe=path.join(dir,'fixture.exe');const compile=spawnSync(compiler,['/nologo','/target:winexe','/out:'+exe,path.join(__dirname,'fixtures/update-installer.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(compile.status,0,compile.stdout+compile.stderr);
 for(const mode of ['success','installer-error','exit-timeout']){
  const jobDir=path.join(dir,mode);fs.mkdirSync(jobDir);const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});await new Promise((r,j)=>{parent.once('spawn',r);parent.once('error',j);});
  const plan={jobDir,version:'1.0.4',desktopPid:parent.pid,desktopExe:exe,installDir:dir,installer:exe,size:fs.statSync(exe).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),exitTimeoutSeconds:1};
  const planFile=path.join(jobDir,'plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));if(mode==='installer-error')fs.writeFileSync(path.join(dir,'fail.txt'),'fail');
  const script=fs.readFileSync(path.join(__dirname,'../update-install-helper.ps1'),'utf8');const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe',env:{...process.env,ATLAS_UPDATE_PLAN:planFile}});
  let output='';child.stderr.on('data',b=>output+=b);const exited=new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});
  try{if(mode!=='exit-timeout'){
   const deadline=Date.now()+5000;while(!fs.existsSync(path.join(jobDir,'status.json'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));assert.ok(fs.existsSync(path.join(jobDir,'status.json')),'helper handshake');parent.kill();
  }
  const code=await exited;const state=JSON.parse(fs.readFileSync(path.join(jobDir,'status.json'),'utf8').replace(/^\uFEFF/,''));
  assert.equal(state.phase,mode==='success'?'complete':'error',output+' '+state.message);assert.equal(code,mode==='success'?0:1);
  if(mode==='success'){assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'runtime/package.json'))).version,'1.0.4');assert.equal(fs.readFileSync(path.join(dir,'arguments.txt'),'utf8').trim().split(/\r?\n/).join(' '),'/S /UPDATE /D='+dir);const deadline=Date.now()+2000;while(!fs.existsSync(path.join(dir,'restarted.txt'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));assert.ok(fs.existsSync(path.join(dir,'restarted.txt')));}
  if(mode==='installer-error')assert.match(state.message,/42/);assert.ok(fs.statSync(path.join(jobDir,'install.log')).size>0);
  }finally{parent.kill();if(child.exitCode===null)child.kill();}
 }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
