'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fields = item => JSON.stringify({ version:item.version, url:item.url, sha256:item.sha256, size:item.size, notes:item.notes || '' });
function newer(version, current) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const a = version.split('.').map(Number), b = current.split('.').map(Number);
  for (let i=0;i<3;i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function verifyRelease(item, config) {
  if (!item || !/^\d+\.\d+\.\d+$/.test(item.version) || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 512*1024*1024 || typeof item.notes !== 'string' || item.notes.length > 20000) throw new Error('更新清单格式无效');
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/'+config.repository+'/releases/download/') || url.username || url.password || url.port || !url.pathname.endsWith('.exe')) throw new Error('更新包必须来自配置的 GitHub Releases 仓库');
  const key = crypto.createPublicKey(config.publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, Buffer.from(fields(item)), key, Buffer.from(item.signature || '', 'base64'))) throw new Error('更新签名校验失败');
  return item;
}
async function limitedBytes(response, limit, progress = () => {}) {
  if (!response.ok) throw new Error(`更新服务器返回 ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('更新文件超过允许大小');
  const chunks=[]; let size=0;
  try { for await (const chunk of response.body) { size+=chunk.length; if(size>limit) throw new Error('更新文件超过允许大小'); chunks.push(Buffer.from(chunk)); progress(size); } }
  catch(error) { await response.body?.cancel?.().catch(()=>{}); throw error; }
  return Buffer.concat(chunks);
}
function createUpdater({ directory, config, version, desktop=false, fetcher=fetch, launch=spawn, desktopPid=process.env.REFERENCE_BOARD_DESKTOP_PID, desktopExe=process.env.REFERENCE_BOARD_DESKTOP_EXE, helperTimeout=10000, exitTimeoutSeconds=60 }) {
  const prefsFile=path.join(directory,'update-preferences.json');
  let prefs={ autoCheck:true, autoDownload:true };
  try { const saved=JSON.parse(fs.readFileSync(prefsFile,'utf8')); for(const key of Object.keys(prefs)) if(typeof saved[key]==='boolean') prefs[key]=saved[key]; } catch {}
  const configured=/^[\w.-]+\/[\w.-]+$/.test(config.repository || '') && !!config.publicKey;
  let state={phase:'idle',currentVersion:version,configured,desktop,latest:null,progress:0,error:null};
  let busy=false, staged=null;
  const installStateFile=path.join(directory,'update-install-state.json');
  let installJob;
  try { installJob=JSON.parse(fs.readFileSync(installStateFile,'utf8')); } catch {}
  const status=()=>{
    let installStatus;
    try {if(installJob)installStatus=JSON.parse(fs.readFileSync(path.join(installJob.jobDir,'status.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
    if(installStatus&&!newer(installStatus.version,version))installStatus=undefined;
    return {...state,preferences:{...prefs},installStatus,installLog:installJob?path.join(installJob.jobDir,'install.log'):null};
  };
  function savePreferences(body) { for(const key of Object.keys(prefs)) if(typeof body[key]==='boolean')prefs[key]=body[key]; fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(prefsFile,JSON.stringify(prefs));return status(); }
  async function check() {
    if(!configured) return status();
    if(busy) return status(); busy=true;state.phase='checking';state.error=null;
    try {
      const response=await fetcher(`https://github.com/${config.repository}/releases/latest/download/latest.json`,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
      const manifest=verifyRelease(JSON.parse((await limitedBytes(response,65536)).toString()),config);
      state.checkedAt=Date.now();
      if(newer(manifest.version,version)) { state.latest=manifest;state.phase=staged?.version===manifest.version?'ready':'available'; }
      else { state.latest=null;state.phase='current';staged=null; }
      return status();
    } catch(error) { state.phase='error';state.error=error.message;throw error; } finally {busy=false;}
  }
  async function download() {
    if(!desktop) throw new Error('请在 Windows 桌面版下载更新');
    if(busy) return status();
    const item=state.latest;if(!item) throw new Error('请先检查可用更新');
    verifyRelease(item,config);busy=true;state.phase='downloading';state.progress=0;state.error=null;staged=null;
    const targetDir=path.join(directory,'updates');const file=path.join(targetDir,`update-${item.version}.exe`);
    try {
      const response=await fetcher(item.url,{signal:AbortSignal.timeout(300000)});
      const bytes=await limitedBytes(response,item.size,n=>{state.progress=Math.floor(n/item.size*100);});
      if(bytes.length!==item.size || crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256 || bytes.toString('ascii',0,2)!=='MZ') throw new Error('安装包完整性校验失败');
      fs.mkdirSync(targetDir,{recursive:true});fs.writeFileSync(file+'.part',bytes);fs.renameSync(file+'.part',file);
      staged={...item,file};state.phase='ready';state.progress=100;return status();
    } catch(error) {state.phase='error';state.error=error.message;throw error;} finally {busy=false;}
  }
  async function install() {
    if(!desktop || !staged || state.phase!=='ready' || !/^\d+$/.test(String(desktopPid))) throw new Error('更新尚未准备好，请重新下载');
    if(!desktopExe||!path.isAbsolute(desktopExe)||!fs.existsSync(desktopExe))throw Error('无法确定当前图集安装位置，请手动运行新版安装包完成首次修复');
    verifyRelease(staged,config);
    const bytes=fs.readFileSync(staged.file);
    if(bytes.length!==staged.size || crypto.createHash('sha256').update(bytes).digest('hex')!==staged.sha256) throw new Error('安装包已变化，请重新下载');
    const jobDir=path.join(directory,'updates','install-'+crypto.randomUUID());fs.mkdirSync(jobDir,{recursive:true});
    const plan={jobDir,version:staged.version,desktopPid:String(desktopPid),desktopExe,installDir:path.dirname(desktopExe),installer:staged.file,size:staged.size,sha256:staged.sha256,exitTimeoutSeconds};
    const planFile=path.join(jobDir,'plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));
    const script=fs.readFileSync(path.join(__dirname,'update-install-helper.ps1'),'utf8');
    let child;
    try {
      await new Promise((resolve,reject)=>{child=launch('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,ATLAS_UPDATE_PLAN:planFile}});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      // Do not close the app until the detached helper has actually initialized.
      const deadline=Date.now()+helperTimeout;
      while(Date.now()<deadline){
        try{const result=JSON.parse(fs.readFileSync(path.join(jobDir,'status.json'),'utf8').replace(/^\uFEFF/,''));if(result.phase==='error')throw Error(result.message);if(result.phase==='waiting'){installJob={jobDir};fs.writeFileSync(installStateFile,JSON.stringify(installJob));state.phase='installing';return status();}}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
        if(child.exitCode!==null&&child.exitCode!==undefined)throw Error('安装助手提前退出，请查看日志或手动安装');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error('安装助手未能就绪，图集已保留打开；请手动运行安装包');
    }catch(error){child?.kill?.();state.phase='ready';state.error=error.message;throw error;}
  }
  return {status,savePreferences,check,download,install};
}
module.exports={createUpdater,fields,verifyRelease,newer};
