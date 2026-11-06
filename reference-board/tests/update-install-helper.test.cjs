const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const {spawn,spawnSync}=require('node:child_process');
const compiler='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
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
