'use strict';
(() => {
  const whale=document.getElementById('whale');
  whale.title='点击检查图集更新';whale.setAttribute('aria-label','鲸鱼娘 · 检查图集更新');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="updateDialog" hidden><div class="dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="updateHeading"><div class="dialog-header"><h2 id="updateHeading">图集更新</h2><button type="button" class="icon-btn" id="updateClose" aria-label="关闭更新面板">×</button></div><p id="updateVersion"></p><p id="updateStatus" role="status"></p><p id="updateNotes"></p><progress id="updateProgress" max="100" value="0" hidden></progress><label class="update-option"><input id="updateAutoCheck" type="checkbox">自动检查更新</label><label class="update-option"><input id="updateAutoDownload" type="checkbox">自动下载更新，安装前提示</label><p class="settings-hint">安装会关闭图集并重启，图库和标签会保留。</p><div class="dialog-actions"><button type="button" class="text-btn" id="updateCheck">检查更新</button><button type="button" class="action-btn" id="updateDownload" hidden>下载更新</button><button type="button" class="action-btn" id="updateInstall" hidden>安装并重启</button></div></div></div>`);
  const dialog=document.getElementById('updateDialog');let token='',working=false,lastStatus=null,checkTimer;
  const el=id=>document.getElementById(id);
  const message=error=>typeof error==='string'?error:error?.message||'更新操作失败，请重试或手动安装新版';
  async function status() { const value=await api('/api/updates');token=value.token;return value; }
  async function post(action,body) { if(!token)await status();return api('/api/updates/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Update-Token':token},body:JSON.stringify(body||{})}); }
  function draw(value) {
    lastStatus=value;
    el('updateVersion').textContent='当前版本 '+value.currentVersion+(value.latest?' · 最新版本 '+value.latest.version:'');
    const labels={idle:'点击检查是否有新版本',checking:'正在检查更新…',current:'当前已是最新版本',available:'发现新版本，可以下载更新',downloading:'正在下载更新…',ready:'更新已下载并通过签名校验，可以安装',installing:'正在启动安装程序…',error:value.error||'更新检查失败，请稍后重试'};
    el('updateStatus').textContent=!value.configured?'尚未配置 GitHub 更新仓库和签名公钥，当前不会下载或安装更新。':labels[value.phase]||'';
    if(value.installStatus?.phase==='error')el('updateStatus').textContent='上次安装失败：'+value.installStatus.message+(value.installLog?'；日志：'+value.installLog:'');
    el('updateNotes').textContent=value.latest?.notes||'';
    el('updateAutoCheck').checked=value.preferences.autoCheck;el('updateAutoDownload').checked=value.preferences.autoDownload;
    el('updateProgress').hidden=value.phase!=='downloading';el('updateProgress').value=value.progress;
    el('updateCheck').disabled=working||!value.configured;
    el('updateDownload').hidden=!value.desktop||!value.latest||!['available','error'].includes(value.phase);
    el('updateInstall').hidden=value.phase!=='ready';
    el('updateDownload').disabled=working;el('updateInstall').disabled=working;
    whale.classList.toggle('has-update',!!value.latest);whale.title=value.latest?'发现新版 '+value.latest.version+'，点击查看':'点击检查图集更新';
  }
  function show() {dialog.hidden=false;el('updateClose').focus();}
  function hide() {if(lastStatus?.phase==='installing')return;dialog.hidden=true;whale.focus();}
  async function operation(action,silent=false) {
    if(working)return;working=true;
    const poll=setInterval(()=>status().then(draw).catch(()=>{}),750);
    try { const result=await post(action);draw(result);
      if(action==='check'&&result.phase==='available'&&result.desktop&&result.preferences.autoDownload){working=false;await operation('download',silent);return;}
      if(result.phase==='ready'&&silent)toast('新版图集已下载，点击鲸鱼娘安装更新');
    } catch(error) { try {lastStatus=await status();}catch{} if(lastStatus){lastStatus={...lastStatus,phase:'error',error:error.message};draw(lastStatus);} if(!silent||!dialog.hidden)el('updateStatus').textContent=error.message; }
    finally {clearInterval(poll);working=false;if(lastStatus)draw(lastStatus);}
  }
  document.addEventListener('journal-check-updates',async()=>{show();try{draw(await status());await operation('check');}catch(error){el('updateStatus').textContent=error.message;}});
  el('updateClose').onclick=hide;dialog.addEventListener('click',event=>{if(event.target===dialog)hide();});
  document.addEventListener('keydown',event=>{if(!dialog.hidden&&event.key==='Escape'){event.stopImmediatePropagation();hide();}},true);
  el('updateCheck').onclick=()=>operation('check');el('updateDownload').onclick=()=>operation('download');
  el('updateInstall').onclick=async()=>{if(working)return;const bridge=window.__TAURI__?.core||window.__TAURI_INTERNALS__;
    if(typeof bridge?.invoke!=='function'){el('updateStatus').textContent='未连接桌面更新接口，请在桌面版安装；若仍无效，请手动运行新版安装包。';return;}
    working=true;el('updateInstall').disabled=true;el('updateCheck').disabled=true;el('updateStatus').textContent='正在准备安装，请稍候…';let prepared=false;
    try{const result=await post('install');if(result.phase!=='installing')throw Error(result.error||'更新助手尚未就绪，请稍后重试');prepared=true;draw(result);await bridge.invoke('quit_for_update');}
    catch(error){working=false;if(lastStatus)draw(lastStatus);el('updateStatus').textContent=message(error)+(prepared?'；安装助手正在等待退出，请保存后在 60 秒内关闭所有图集窗口。超时后可重新打开并重试。':'');el('updateInstall').disabled=false;}
  };
  for(const id of ['updateAutoCheck','updateAutoDownload'])el(id).onchange=async()=>{try{draw(await post('preferences',{autoCheck:el('updateAutoCheck').checked,autoDownload:el('updateAutoDownload').checked}));}catch(error){el('updateStatus').textContent=error.message;}};
  async function automatic(){try{const value=await status();draw(value);if(value.desktop&&value.configured&&value.preferences.autoCheck)await operation('check',true);}catch{}clearTimeout(checkTimer);checkTimer=setTimeout(automatic,6*60*60*1000);}
  checkTimer=setTimeout(automatic,10000);
})();
