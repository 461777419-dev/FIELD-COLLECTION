const iconTargets = [
  ['brand', '.brand-mark', 'compass'], ['all', '[data-view="all"] svg', 'images'],
  ['favorites', '[data-view="favorites"] svg', 'heart'], ['untagged', '[data-view="untagged"] svg', 'tag'],
  ['trash', '[data-view="trash"] svg', 'trash-2'], ['folders', '#newFolder svg', 'plus'], ['tags', '#newTag svg', 'plus'],
  ['menu', '#menuBtn svg', 'menu'], ['settings', '#settingsBtn svg', 'settings-2'], ['export', '#exportBtn svg', 'download'], ['search', '.search svg:not(.water-outline)', 'search'],
  ['sort', '.select-wrap svg', 'chevron-down'], ['details', '#toggleInspector svg', 'panel-right'],
  ['pinterest', '.pinterest-header strong svg', 'scan-search'], ['pinterestSearch', '#pinterestChoose svg', 'image-up'], ['pinterestToggle', '#pinterestToggle svg', 'chevron-down']
];
const iconLabels = { brand: '品牌', all: '所有图片', favorites: '收藏', untagged: '未加标签', trash: '回收站', folders: '文件夹', tags: '标签', menu: '菜单', settings: '设置', export: '导出目录', search: '搜索', sort: '排序', details: '详情', pinterest: 'Pinterest', pinterestSearch: 'Pinterest 搜索', pinterestToggle: '折叠' };

function applyCustomIcons() {
  for (const [key, selector, fallback] of iconTargets) {
    const target = document.querySelector(selector) || document.querySelector(selector.replace(' svg', ' .custom-icon'));
    if (!target) continue;
    if (state.icons[key]) {
      const img = document.createElement('img'); img.className = 'custom-icon'; img.src = `/icons/${key}?v=${state.iconNonce || ''}`; img.alt = '';
      target.replaceWith(img);
    } else if (target.classList.contains('custom-icon')) {
      const holder = document.createElement('i'); holder.dataset.lucide = fallback; target.replaceWith(holder);
    }
  }
  refreshIcons();
}
const originalRender = render;
render = function () { originalRender(); applyCustomIcons(); };
const originalSidebar = renderSidebar;
renderSidebar = function () { originalSidebar(); applyCustomIcons(); };

function drawIconSettings() {
  $('#iconSettings').innerHTML = iconTargets.map(([key, , fallback]) => `<div class="icon-setting"><span class="icon-setting-preview">${state.icons[key] ? `<img src="/icons/${key}?v=${state.icons[key]}" alt="">` : icon(fallback)}</span><span>${iconLabels[key]}</span><button data-icon-upload="${key}" title="替换${iconLabels[key]}图标">替换</button><button data-icon-reset="${key}" title="还原${iconLabels[key]}图标">${icon('rotate-ccw', 14)}</button></div>`).join('');
  refreshIcons();
}
$('#settingsBtn').onclick = () => { drawIconSettings(); $('#settingsModal').hidden = false; };
$('#settingsBtn').addEventListener('click', async () => {
  try { const result = await api('/api/pinterest/cookie'); $('#pinterestCookieStatus').textContent = result.configured ? 'Cookie 已在当前运行中应用' : '仅当前运行有效，不写入图库文件。'; }
  catch (error) { $('#pinterestCookieStatus').textContent = error.message; }
});
$('#savePinterestCookie').onclick = async () => {
  try {
    const result = await api('/api/pinterest/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: $('#pinterestCookie').value }) });
    $('#pinterestCookie').value = '';
    $('#pinterestCookieStatus').textContent = result.configured ? 'Cookie 已在当前运行中应用' : 'Cookie 未填写';
  } catch (error) { $('#pinterestCookieStatus').textContent = error.message; }
};
$('#clearPinterestCookie').onclick = async () => {
  await api('/api/pinterest/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: '' }) });
  $('#pinterestCookie').value = '';
  $('#pinterestCookieStatus').textContent = 'Cookie 已清除';
};
$('#iconSettings').onclick = async event => {
  const upload = event.target.closest('[data-icon-upload]');
  if (upload) { $('#iconFileInput').dataset.key = upload.dataset.iconUpload; $('#iconFileInput').click(); return; }
  const reset = event.target.closest('[data-icon-reset]');
  if (reset) { await api(`/api/icons/${reset.dataset.iconReset}`, { method: 'DELETE' }); delete state.icons[reset.dataset.iconReset]; drawIconSettings(); applyCustomIcons(); }
};
$('#iconFileInput').onchange = async event => {
  const file = event.target.files[0], key = event.target.dataset.key;
  if (!file) return;
  try { const result = await api(`/api/icons/${key}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file }); state.icons[key] = result.ext; state.iconNonce = Date.now(); drawIconSettings(); applyCustomIcons(); toast('图标已替换'); }
  catch (error) { toast(error.message); }
  event.target.value = '';
};
$('#restoreIcons').onclick = async () => { for (const key of Object.keys(state.icons)) await api(`/api/icons/${key}`, { method: 'DELETE' }); state.icons = {}; drawIconSettings(); applyCustomIcons(); toast('已还原默认图标'); };

async function assignTag(ids, tag, remove = false) {
  const selected = state.tags.find(item => item.key === tag);
  const related = selected?.parent && !remove ? [selected.parent, tag] : [tag];
  for (const id of ids) {
    const image = state.images.find(item => item.id === id);
    if (!image) continue;
    const tags = remove ? image.tags.filter(item => item !== tag && !(selected && !selected.parent && item.startsWith(`${tag} / `))) : [...new Set([...image.tags, ...related])];
    await patchImage(id, { tags }, false);
  }
  render(); toast(remove ? '标签已移除' : '标签已添加');
}
async function moveImages(ids, folderId) {
  for (const id of ids) await patchImage(id, { folderId }, false);
  render(); toast('图片已移动');
}
document.addEventListener('dragstart', event => {
  const related = event.target.closest('.related-card');
  if (related) {
    const ownerId = related.closest('[data-related-board]').dataset.relatedBoard;
    event.dataTransfer.setData('application/x-journal-related', JSON.stringify({ ownerId, relatedId: related.dataset.relatedId }));
    event.dataTransfer.setData('application/x-journal-images', JSON.stringify([related.dataset.relatedId]));
    event.dataTransfer.effectAllowed = 'move';
    return;
  }
  const outbound = event.target.closest('.drag-out');
  if (outbound) { event.preventDefault(); const card = outbound.closest('.image-card'); const ids = state.selectedIds.includes(card.dataset.id) ? state.selectedIds : [card.dataset.id]; window.journalDesktop?.dragImagesOut(ids); return; }
  const folder = event.target.closest('[data-folder-view]');
  if (folder) { event.dataTransfer.setData('application/x-journal-folder', folder.dataset.folderView); event.dataTransfer.effectAllowed = 'move'; return; }
  const tag = event.target.closest('[data-drop-tag]');
  if (tag) { event.dataTransfer.setData('application/x-journal-tag', tag.dataset.dropTag); event.dataTransfer.effectAllowed = 'copy'; return; }
  const card = event.target.closest('.image-card');
  if (card) {
    const ids = state.selectedIds.includes(card.dataset.id) ? state.selectedIds : [card.dataset.id];
    event.dataTransfer.setData('application/x-journal-images', JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
    draggedGalleryImageId = ids[0];
  }
});
let draggedGalleryImageId = null;
let pinterestDropHandled = false;
document.addEventListener('dragend', event => {
  const id = draggedGalleryImageId;
  draggedGalleryImageId = null;
  if (!id || pinterestDropHandled) { pinterestDropHandled = false; return; }
  const bounds = $('#pinterestPanel').getBoundingClientRect();
  if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
    void searchPinterestImage({ imageId: id });
  }
});
document.addEventListener('dragover', event => {
  if (!event.dataTransfer) return;
  const target = event.target.closest('.related-card,.related-board,.image-card,[data-drop-tag],[data-folder-view],[data-folder-root],[data-tag-root],[data-view],#dropZone');
  if ([...event.dataTransfer.types].includes('application/x-journal-folder')) {
    if (target?.matches('[data-folder-view],[data-folder-root]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drag-target'); }
    return;
  }
  if (target?.dataset.view === 'favorites' && [...event.dataTransfer.types].includes('Files')) { event.preventDefault(); target.classList.add('drag-target'); return; }
  if (target?.dataset.view && !['all', 'favorites', 'trash'].includes(target.dataset.view)) return;
  if (target && [...event.dataTransfer.types].some(type => ['application/x-journal-related', 'application/x-journal-images', 'application/x-journal-tag'].includes(type))) {
    event.preventDefault();
    event.dataTransfer.dropEffect = [...event.dataTransfer.types].includes('application/x-journal-tag') ? 'copy' : 'move';
    target.classList.add('drag-target');
  }
});
document.addEventListener('dragleave', event => { event.target.closest('.drag-target')?.classList.remove('drag-target'); });
document.addEventListener('drop', async event => {
  const target = event.target.closest('.related-card,.related-board,.image-card,[data-drop-tag],[data-folder-view],[data-folder-root],[data-tag-root],[data-view],#dropZone');
  document.querySelectorAll('.drag-target').forEach(item => item.classList.remove('drag-target'));
  if (!target || !event.dataTransfer) return;
  const folderId = event.dataTransfer.getData('application/x-journal-folder');
  if (folderId) {
    event.preventDefault(); event.stopPropagation();
    if (!target.matches('[data-folder-view],[data-folder-root]')) return;
    try {
      const parentId = target.dataset.folderView || null;
      await api('/api/folders/' + folderId, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({parentId}) });
      const data = await api('/api/state'); state.folders = data.folders; state.images = data.images; state.trash = data.trash;
      if (parentId) state.collapsedFolders.delete(parentId);
      render(); toast(parentId ? '已设为子文件夹' : '已恢复为一级文件夹');
    } catch (error) { toast(error.message); }
    return;
  }
  const tag = event.dataTransfer.getData('application/x-journal-tag');
  const images = event.dataTransfer.getData('application/x-journal-images');
  const related = event.dataTransfer.getData('application/x-journal-related');
  if (images && ['all', 'favorites', 'trash'].includes(target.dataset.view)) {
    event.preventDefault(); event.stopPropagation();
    const ids = JSON.parse(images);
    try {
      for (const id of ids) {
        let image = state.images.find(item => item.id === id);
        if (target.dataset.view === 'trash') {
          if (!image) continue;
          await api(`/api/images/${id}`, { method: 'DELETE' });
          state.images = state.images.filter(item => item.id !== id);
          state.trash.unshift({ ...image, deletedAt: Date.now() });
        } else {
          if (!image) {
            const trashed = state.trash.find(item => item.id === id);
            if (!trashed) continue;
            await api(`/api/trash/${id}/restore`, { method: 'POST' });
            state.trash = state.trash.filter(item => item.id !== id);
            image = { ...trashed }; delete image.deletedAt;
            state.images.unshift(image);
          }
          if (target.dataset.view === 'favorites' && !image.favorite) {
            const updated = await api(`/api/images/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true }) });
            state.images[state.images.findIndex(item => item.id === id)] = updated;
          }
        }
      }
      state.selectedIds = [];
      state.selectedId = null;
      render(); toast(target.dataset.view === 'trash' ? '已移至回收站' : target.dataset.view === 'favorites' ? '已加入收藏' : '图片已恢复');
    } catch (error) { const data = await api('/api/state'); state.images = data.images; state.trash = data.trash; render(); toast(error.message); }
    return;
  }
  if (images && target.id === 'dropZone' && state.view === 'all') {
    event.preventDefault(); event.stopPropagation();
    const sourceId = JSON.parse(images)[0];
    try {
      const result = await api('/api/images/order', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, targetId: null }) });
      state.imageOrder = result.order;
      state.sort = 'manual';
      $('#sortSelect').value = 'manual';
      renderGallery(); toast('图片位置已更新');
    } catch (error) { toast(error.message); }
    return;
  }
  if (related && target.classList.contains('related-card')) {
    event.preventDefault(); event.stopPropagation();
    const source = JSON.parse(related);
    const ownerId = target.closest('[data-related-board]').dataset.relatedBoard;
    if (source.ownerId === ownerId && source.relatedId !== target.dataset.relatedId) {
      try { await api(`/api/images/${ownerId}/related-order`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: source.relatedId, targetId: target.dataset.relatedId }) }); await refreshRelatedImages(); }
      catch (error) { toast(error.message); }
    }
  }
  else if (images && target.classList.contains('image-card') && state.view === 'all') {
    event.preventDefault(); event.stopPropagation();
    const sourceId = JSON.parse(images)[0];
    if (!sourceId || sourceId === target.dataset.id) return;
    try {
      const result = await api('/api/images/order', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, targetId: target.dataset.id }) });
      state.imageOrder = result.order;
      state.sort = 'manual';
      $('#sortSelect').value = 'manual';
      renderGallery();
      toast('图片位置已更新');
    } catch (error) { toast(error.message); }
  }
  else if (images && (target.classList.contains('image-card') || target.closest('[data-related-board]'))) {
    event.preventDefault(); event.stopPropagation();
    const ownerId = target.classList.contains('image-card') ? target.dataset.id : target.closest('[data-related-board]').dataset.relatedBoard;
    try {
      let count = 0;
      for (const relatedId of JSON.parse(images)) {
        if (relatedId === ownerId) continue;
        await api(`/api/images/${ownerId}/related`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relatedId }) });
        count++;
      }
      if (count) { await refreshRelatedImages(); toast('已添加关联图片'); }
    } catch (error) { toast(error.message); }
  }
  else if (tag && target.classList.contains('image-card')) { event.preventDefault(); event.stopPropagation(); await assignTag(state.selectedIds.includes(target.dataset.id) ? state.selectedIds : [target.dataset.id], tag); }
  else if (tag && (target.dataset.dropTag || target.hasAttribute('data-tag-root'))) {
    event.preventDefault(); event.stopPropagation();
    const source = state.tags.find(item => item.key === tag);
    const parent = target.dataset.dropTag || null;
    if (!source || tag === parent || source.parent === parent) return;
    try {
      const result = await api(`/api/tags/${encodeURIComponent(tag)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: source.name, parent }) });
      state.tags = result.tags; state.images = result.images;
      if (result.changes[state.view.slice(4)] && state.view.startsWith('tag:')) state.view = `tag:${result.changes[state.view.slice(4)]}`;
      state.collapsedTags = new Set([...state.collapsedTags].map(key => result.changes[key] || key));
      render(); toast(parent ? '已设为子标签' : '已设为一级标签');
    } catch (error) { toast(error.message); }
  }
  else if (images && target.dataset.dropTag) { event.preventDefault(); event.stopPropagation(); await assignTag(JSON.parse(images), target.dataset.dropTag); }
  else if (images && target.dataset.folderView) { event.preventDefault(); event.stopPropagation(); await moveImages(JSON.parse(images), target.dataset.folderView); }
});

const themeHeading = [...document.querySelectorAll('#settingsModal .settings-section-title')].find(item => item.textContent.includes('界面颜色'));
themeHeading.insertAdjacentHTML('beforebegin', `<section class="library-tools"><h3 class="settings-section-title">文件夹同步</h3><div class="ai-settings-row"><input id="syncPath" class="dialog-input" placeholder="输入本地文件夹完整路径" aria-label="同步文件夹路径"><button class="action-btn" id="addSyncRoot" type="button">添加</button></div><div class="tool-row"><button class="text-btn" id="scanSyncRoots" type="button">立即扫描</button><span id="syncSummary" role="status"></span></div><div id="syncRootList" class="tool-list"></div><div id="syncIssueList" class="tool-list"></div><h3 class="settings-section-title">图库备份</h3><div class="tool-row"><button class="text-btn" id="downloadBackup" type="button">下载完整备份</button><button class="text-btn" id="restoreBackup" type="button">从备份恢复</button></div></section>`);
let syncInfo = { roots: [], issues: [] };
async function refreshLibraryState() {
  const next = await api('/api/state');
  for (const key of ['folders', 'tags', 'trash', 'icons', 'images', 'imageOrder']) state[key] = next[key] || [];
  render();
}
async function drawSyncSettings() {
  syncInfo = await api('/api/sync');
  $('#syncSummary').textContent = `${syncInfo.roots.length} 个目录 · ${syncInfo.issues.length} 项待处理`;
  $('#syncRootList').innerHTML = syncInfo.roots.map(root => `<div class="tool-item"><span title="${esc(root.path)}">${esc(root.path)}</span><button class="icon-btn quiet" data-remove-sync="${esc(root.path)}" title="停止同步，保留图库图片" aria-label="停止同步">${icon('x', 15)}</button></div>`).join('');
  $('#syncIssueList').innerHTML = syncInfo.issues.map(issue => {
    const label = { changed: '外部文件已修改', missing: '外部文件已消失', similar: issue.matches?.some(match => match.kind === 'exact') ? '发现相同图片' : '发现相似图片', renamed: '外部文件已改名', error: '导入失败', 'root-missing': '同步目录不存在' }[issue.kind];
    const actions = issue.kind === 'changed' || issue.kind === 'similar' ? `<button data-sync-action="import" data-sync-kind="${issue.kind}" data-sync-path="${esc(issue.path)}">导入新版</button><button data-sync-action="merge" data-sync-kind="${issue.kind}" data-sync-path="${esc(issue.path)}">导入并沿用标签</button><button data-sync-action="ignore" data-sync-kind="${issue.kind}" data-sync-path="${esc(issue.path)}">忽略</button>` : issue.kind === 'renamed' ? `<button data-sync-action="relink" data-sync-kind="renamed" data-sync-path="${esc(issue.path)}">关联原图片</button><button data-sync-action="ignore" data-sync-kind="renamed" data-sync-path="${esc(issue.path)}">忽略</button>` : issue.kind === 'missing' ? `<button data-sync-action="ignore" data-sync-kind="${issue.kind}" data-sync-path="${esc(issue.path)}">保留图库图片</button>` : '';
    return `<div class="tool-issue"><strong>${label}</strong><span title="${esc(issue.path)}">${esc(issue.path)}</span>${issue.message ? `<span>${esc(issue.message)}</span>` : ''}<div>${actions}</div></div>`;
  }).join('');
  refreshIcons();
}
$('#settingsBtn').addEventListener('click', () => { drawSyncSettings().catch(error => toast(error.message)); });
$('#addSyncRoot').onclick = async () => {
  const path = $('#syncPath').value.trim();
  if (!path) return toast('请输入文件夹路径');
  try { await api('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); $('#syncPath').value = ''; await drawSyncSettings(); await refreshLibraryState(); toast('同步目录已添加'); }
  catch (error) { toast(error.message); }
};
$('#scanSyncRoots').onclick = async () => {
  $('#syncSummary').textContent = '正在扫描…';
  try { await api('/api/sync/scan', { method: 'POST' }); await drawSyncSettings(); await refreshLibraryState(); toast('扫描完成'); }
  catch (error) { toast(error.message); }
};
$('#settingsModal').addEventListener('click', async event => {
  const remove = event.target.closest('[data-remove-sync]');
  const action = event.target.closest('[data-sync-action]');
  try {
    if (remove) { await api('/api/sync', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: remove.dataset.removeSync }) }); await drawSyncSettings(); toast('已停止同步，图库图片已保留'); }
    if (action) { await api('/api/sync/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: action.dataset.syncPath, kind: action.dataset.syncKind, action: action.dataset.syncAction === 'merge' ? 'import' : action.dataset.syncAction, mergeTags: action.dataset.syncAction === 'merge' }) }); await drawSyncSettings(); await refreshLibraryState(); toast('已处理'); }
  } catch (error) { toast(error.message); }
});
$('#downloadBackup').onclick = () => { location.href = '/api/backup'; };
$('#restoreBackup').onclick = () => $('#restoreBackupInput').click();
$('#restoreBackupInput').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || !confirm('恢复备份会替换当前图库。当前图库会自动另存一份备份，是否继续？')) return;
  try {
    const result = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: file });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || '恢复失败');
    state.view = 'all'; state.selectedId = null; state.selectedIds = [];
    await refreshLibraryState(); await drawSyncSettings(); toast('图库已从备份恢复');
  } catch (error) { toast(error.message); }
};
setInterval(async () => {
  if (state.uploading || !syncInfo.roots.length) return;
  try { await refreshLibraryState(); if (!$('#settingsModal').hidden) await drawSyncSettings(); }
  catch {}
}, 25000);
drawSyncSettings().catch(() => {});

async function refreshRelatedImages() {
  const data = await api('/api/state');
  state.images = data.images;
  state.trash = data.trash;
  render();
}
$('#inspector').addEventListener('click', async event => {
  const ownerId = state.selectedId;
  const lock = event.target.closest('[data-related-lock]');
  const remove = event.target.closest('[data-related-remove]');
  if (lock || remove) {
    event.stopPropagation();
    const relatedId = (lock || remove).dataset[lock ? 'relatedLock' : 'relatedRemove'];
    try {
      if (lock) {
        const image = state.images.find(item => item.id === ownerId);
        const current = image?.related.find(item => item.id === relatedId);
        if (!current) return;
        await api(`/api/images/${ownerId}/related/${relatedId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: !current.locked }) });
      } else await api(`/api/images/${ownerId}/related/${relatedId}`, { method: 'DELETE' });
      await refreshRelatedImages();
      toast(lock ? '关联位置已更新' : '关联已移除');
    } catch (error) { toast(error.message); }
    return;
  }
  const card = event.target.closest('.related-card');
  if (card) {
    event.preventDefault();
    event.stopPropagation();
    const id = card.dataset.relatedId;
    const image = state.images.find(item => item.id === id);
    if (!image) return toast('关联图片已不存在');
    state.query = '';
    $('#searchInput').value = '';
    const folder = state.folders.find(item => item.id === image.folderId);
    setView(folder ? `folder:${folder.id}` : 'all');
    selectImage(id);
    const target = [...$('#gallery').querySelectorAll('.image-card')].find(item => item.dataset.id === id);
    if (!target) return toast('无法在图库中定位关联图片');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  }
});

let aiSettings = null;
$('#aiProvider').insertAdjacentHTML('beforeend', '<option value="custom">自定义平台（OpenAI 兼容）</option>');
$('#aiProvider').insertAdjacentHTML('afterend', '<div id="customAiFields" hidden><label class="field-label" for="customAiName">平台名称</label><input id="customAiName" class="dialog-input" maxlength="40" placeholder="例如：我的 API 平台"><label class="field-label" for="customAiAddress">请求地址</label><input id="customAiAddress" class="dialog-input" type="url" spellcheck="false" placeholder="https://example.com/v1"><p class="settings-hint">填写 API 基础地址或完整的 /chat/completions 地址。</p></div>');
$('#aiModel').insertAdjacentHTML('afterend', '<datalist id="aiModelOptions"></datalist><button class="text-btn ai-models-button" id="loadAiModels" type="button">读取模型</button><p class="settings-hint" id="aiModelsStatus" role="status"></p>');
$('#aiModel').setAttribute('list', 'aiModelOptions');
document.querySelector('label[for="aiModel"]').textContent='图片理解模型（图库分析 / 画板识图）';
document.querySelector('#settingsModal .settings-section-title').textContent='共用 AI · 图库与画板';
$('#aiModelOptions').insertAdjacentHTML('afterend','<label class="field-label" for="aiGenerationModel">图片生成模型（画板生图 / 编辑）</label><input id="aiGenerationModel" class="dialog-input" maxlength="100" spellcheck="false" list="aiModelOptions" placeholder="选择支持图片生成的模型，可暂时留空"><div id="aiImageProtocolFields"><label class="field-label" for="aiImageProtocol">自定义平台图片接口</label><select id="aiImageProtocol" class="dialog-input"><option value="images">Images API（generations / edits）</option><option value="chat">Chat Completions（返回 Base64 图片）</option></select></div><p class="settings-hint">两边共用服务接口与密钥；图片理解和生成分别选择模型。模型列表不代表该模型支持生图。</p>');
$('#aiKeyStatus').insertAdjacentHTML('afterend', '<button class="text-btn ai-verify" id="verifyAiApi" type="button">验证接口与图片识别</button><p class="settings-hint" id="aiVerifyStatus" role="status"></p>');
async function loadAiModels() {
  const provider = $('#aiProvider').value;
  const button = $('#loadAiModels');
  button.disabled = true;
  $('#aiModelsStatus').textContent = '正在读取模型…';
  try {
    const result = await api('/api/ai/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key: $('#aiKey').value.trim(), address: $('#customAiAddress').value.trim() }) });
    if (provider !== $('#aiProvider').value) return;
    const options = $('#aiModelOptions');
    options.replaceChildren(...result.models.map(id => {
      const option = document.createElement('option');
      option.value = id;
      return option;
    }));
    $('#aiModelsStatus').textContent = result.models.length ? `已读取 ${result.models.length} 个模型，可在名称框中选择` : '接口未提供可选模型，请手动填写';
  } catch (error) { $('#aiModelsStatus').textContent = `${error.message}；可手动填写模型名称`; }
  finally { button.disabled = false; }
}
function showAiProvider() {
  if (!aiSettings) return;
  const provider = $('#aiProvider').value;
  $('#customAiFields').hidden = provider !== 'custom';
  $('#customAiName').value = aiSettings.custom?.name || '自定义平台';
  $('#customAiAddress').value = aiSettings.custom?.address || '';
  $('#aiModel').value = aiSettings.models[provider] || aiSettings.providers[provider].model;
  $('#aiGenerationModel').value = aiSettings.generationModels?.[provider] || '';
  $('#aiImageProtocolFields').hidden = provider !== 'custom';
  $('#aiImageProtocol').value = aiSettings.imageProtocol || 'images';
  $('#aiModelOptions').replaceChildren();
  $('#aiModelsStatus').textContent = '';
  $('#aiKey').value = '';
  $('#aiKeyStatus').textContent = `${aiSettings.providers[provider].label}：${aiSettings.providers[provider].configured ? (aiSettings.persistent ? '密钥已保存' : '密钥在当前运行期间有效') : '未配置密钥'}`;
  $('#aiVerifyStatus').textContent = '';
  if (aiSettings.providers[provider].configured) loadAiModels();
}
$('#aiProvider').onchange = showAiProvider;
$('#loadAiModels').onclick = loadAiModels;
$('#aiKey').onchange = () => { if ($('#aiKey').value.trim()) loadAiModels(); };
$('#saveAiKey').onclick = async () => {
  try {
    const provider = $('#aiProvider').value;
    const name = $('#customAiName').value.trim();
    const address = $('#customAiAddress').value.trim();
    const generationModel=$('#aiGenerationModel').value.trim(),imageProtocol=$('#aiImageProtocol').value;
    const result = await api('/api/ai/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model: $('#aiModel').value.trim(), generationModel,imageProtocol,key: $('#aiKey').value.trim(), name, address }) });
    aiSettings.models[provider] = $('#aiModel').value.trim();
    aiSettings.provider=provider;
    aiSettings.generationModels={...aiSettings.generationModels,[provider]:generationModel};
    aiSettings.imageProtocol=imageProtocol;
    aiSettings.providers[provider].configured = result.configured;
    if (provider === 'custom') { aiSettings.custom = { name, address }; aiSettings.providers.custom.label = name; }
    $('#aiKey').value = '';
    $('#aiKeyStatus').textContent = result.configured ? (result.persistent ? '密钥已加密保存' : '密钥仅在当前运行期间有效') : '模型已保存；请填写 API Key';
    toast('AI 设置已保存');
  } catch (error) { toast(error.message); }
};
$('#verifyAiApi').onclick = async () => {
  const button = $('#verifyAiApi');
  button.disabled = true;
  $('#aiVerifyStatus').textContent = '正在验证接口与图片识别…';
  try { const result = await api('/api/ai/verify', { method: 'POST' }); $('#aiVerifyStatus').textContent = result.message; }
  catch (error) { $('#aiVerifyStatus').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#clearAiKey').onclick = async () => {
  try { const provider = $('#aiProvider').value; await api(`/api/ai/settings?provider=${provider}`, { method: 'DELETE' }); aiSettings.providers[provider].configured = false; $('#aiKey').value = ''; showAiProvider(); toast('密钥已清除'); }
  catch (error) { toast(error.message); }
};
$('#settingsBtn').addEventListener('click', async () => {
  try { aiSettings = await api('/api/ai/settings'); $('#aiProvider').value = aiSettings.provider; showAiProvider(); }
  catch (error) { $('#aiKeyStatus').textContent = error.message; }
});

const themeDefaults = { paper: '#ffffff', canvas: '#f1f5fb', toolbar: '#edf3fc', accent: '#587bb8' };
let theme = { ...themeDefaults };
try { theme = { ...theme, ...JSON.parse(localStorage.getItem('journal-album-theme') || '{}') }; } catch {}
function applyTheme() {
  for (const [key, value] of Object.entries(theme)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) { theme[key] = themeDefaults[key]; continue; }
    document.documentElement.style.setProperty(`--theme-${key}`, value);
    const input = $(`#theme${key[0].toUpperCase()}${key.slice(1)}`);
    if (input) input.value = value;
  }
}
applyTheme();
for (const key of Object.keys(themeDefaults)) {
  $(`#theme${key[0].toUpperCase()}${key.slice(1)}`).oninput = event => {
    theme[key] = event.target.value;
    applyTheme();
    localStorage.setItem('journal-album-theme', JSON.stringify(theme));
  };
}
$('#resetTheme').onclick = () => { theme = { ...themeDefaults }; applyTheme(); localStorage.removeItem('journal-album-theme'); };

const layout = { sidebar: 212, inspector: 286, pinterest: 280, related: 220 };
try { Object.assign(layout, JSON.parse(localStorage.getItem('journal-layout') || '{}')); } catch {}
function applyLayout() {
  const maxSidebar = Math.max(180, innerWidth - layout.inspector - 400);
  layout.sidebar = Math.min(Math.max(Number(layout.sidebar) || 246, 180), Math.min(360, maxSidebar));
  const maxInspector = Math.max(240, innerWidth - layout.sidebar - 400);
  layout.inspector = Math.min(Math.max(Number(layout.inspector) || 306, 240), Math.min(500, maxInspector));
  layout.pinterest = Math.min(Math.max(Number(layout.pinterest) || 280, 44), Math.min(500, innerHeight * .55));
  $('.app').style.setProperty('--sidebar-width', `${layout.sidebar}px`);
  $('.app').style.setProperty('--inspector-width', `${layout.inspector}px`);
  $('#pinterestPanel').style.height = `${layout.pinterest}px`;
  layout.related = Math.max(140, Math.min(Number(layout.related) || 220, Math.max(140, innerHeight - 260)));
  document.documentElement.style.setProperty('--related-height', `${layout.related}px`);
  document.querySelectorAll('.related-resizer').forEach(handle => { handle.setAttribute('aria-valuenow', Math.round(layout.related)); handle.setAttribute('aria-valuemin', '140'); handle.setAttribute('aria-valuemax', Math.max(140, innerHeight - 260)); });
}
applyLayout();
window.addEventListener('resize', applyLayout);
function resizePanel(handle, key, axis, direction) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (key !== 'pinterest' && innerWidth <= 850) || (key === 'inspector' && $('.app').classList.contains('details-collapsed'))) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const start = axis === 'x' ? event.clientX : event.clientY;
    const initial = layout[key];
    document.body.classList.add(axis === 'x' ? 'resizing-columns' : 'resizing-rows');
    const move = next => { layout[key] = initial + ((axis === 'x' ? next.clientX : next.clientY) - start) * direction; applyLayout(); };
    const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop); document.body.classList.remove('resizing-columns', 'resizing-rows'); localStorage.setItem('journal-layout', JSON.stringify(layout)); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
  handle.addEventListener('keydown', event => {
    const delta = axis === 'x' ? (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0) : (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0);
    if (!delta) return;
    event.preventDefault(); layout[key] += delta * direction; applyLayout(); localStorage.setItem('journal-layout', JSON.stringify(layout));
  });
}
resizePanel($('#sidebarResizer'), 'sidebar', 'x', 1);
resizePanel($('#inspectorResizer'), 'inspector', 'x', -1);
resizePanel($('#pinterestResizer'), 'pinterest', 'y', -1);
// 关联区会随图片选择重新渲染，用稳定的详情容器代理拖动事件。
$('#inspectorContent').addEventListener('pointerdown', event => {
  const handle = event.target.closest('.related-resizer');
  if (!handle || event.button !== 0) return;
  event.preventDefault(); event.stopPropagation(); handle.setPointerCapture(event.pointerId);
  const start = event.clientY, initial = layout.related;
  document.body.classList.add('resizing-rows');
  const move = next => { layout.related = initial + next.clientY - start; applyLayout(); };
  const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop); handle.removeEventListener('lostpointercapture', stop); document.body.classList.remove('resizing-rows'); localStorage.setItem('journal-layout', JSON.stringify(layout)); };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop); handle.addEventListener('lostpointercapture', stop);
});
$('#inspectorContent').addEventListener('keydown', event => {
  if (!event.target.matches('.related-resizer') || !['ArrowUp','ArrowDown','Home'].includes(event.key)) return;
  event.preventDefault(); layout.related = event.key === 'Home' ? 220 : layout.related + (event.key === 'ArrowDown' ? 20 : -20); applyLayout(); localStorage.setItem('journal-layout', JSON.stringify(layout));
});
$('#inspector').addEventListener('click', async event => {
  const id = state.selectedId;
  if (event.target.closest('#copyAiPrompt')) {
    const prompt = state.images.find(item => item.id === id)?.ai?.prompt;
    if (prompt) { await navigator.clipboard.writeText(prompt); toast('提示词已复制'); }
    return;
  }
  const button = event.target.closest('#analyzeImage');
  if (!button || !id) return;
  button.disabled = true; button.textContent = '分析中…';
  try {
    const result = await api(`/api/images/${id}/analyze`, { method: 'POST' });
    const image = state.images.find(item => item.id === id);
    if (image) image.ai = result;
    if (state.selectedId === id) renderInspector();
    toast('图片分析完成');
  } catch (error) { button.disabled = false; button.innerHTML = `${icon('sparkles', 14)}重新分析`; refreshIcons(); toast(error.message); }
});

const menu = $('#contextMenu');
function showFolderMenu(id, event) {
  const folder = state.folders.find(item => item.id === id);
  if (!folder) return;
  delete menu.dataset.id;
  menu.dataset.folderId = id;
  menu.innerHTML = `<button data-folder-action="open">${icon('folder-open', 15)}在资源管理器中打开</button><button data-folder-action="edit">${icon('palette', 15)}名称与标记颜色</button><hr><button data-folder-action="delete">${icon('trash-2', 15)}删除文件夹</button>`;
  menu.hidden = false;
  menu.style.left = `${Math.max(6, Math.min(event.clientX, innerWidth - 250))}px`;
  menu.style.top = `${Math.max(6, Math.min(event.clientY, innerHeight - 160))}px`;
  refreshIcons();
}
$('#sidebar').addEventListener('contextmenu', event => {
  const row = event.target.closest('[data-folder-view]');
  if (!row) return;
  event.preventDefault();
  showFolderMenu(row.dataset.folderView, event);
});
$('#inspector').addEventListener('click', async event => {
  const swatch = event.target.closest('.sample-swatch');
  if (!swatch) return;
  try { await navigator.clipboard.writeText(swatch.dataset.color); toast(`已复制 ${swatch.dataset.color}`); }
  catch { toast('无法复制色值，请检查剪贴板权限'); }
});
$('#gallery').addEventListener('contextmenu', event => {
  const card = event.target.closest('.image-card'); if (!card) return;
  event.preventDefault();
  if (!state.selectedIds.includes(card.dataset.id)) selectImage(card.dataset.id);
  const image = [...state.images, ...state.trash].find(item => item.id === card.dataset.id);
  menu.dataset.id = image.id;
  const item = (action, symbol, label) => `<button data-action="${action}">${icon(symbol, 15)}<span>${label}</span></button>`;
  const submenu = (symbol, label, entries) => `<div class="menu-cascade"><span>${icon(symbol, 15)}${label}${icon('chevron-right', 13)}</span><div class="menu-children">${entries || '<span class="menu-empty">暂无项目</span>'}</div></div>`;
  const tagChoices = state.tags.filter(tag => !tag.parent).map(parent => submenu('tag', esc(parent.name), item(`tag:${esc(parent.key)}`, 'plus', `添加 ${esc(parent.name)}`) + state.tags.filter(tag => tag.parent === parent.key).map(child => item(`tag:${esc(child.key)}`, 'corner-down-right', esc(child.name))).join(''))).join('');
  const removeChoices = image.tags.map(key => item(`untag:${esc(key)}`, 'x', esc(key))).join('');
  const formats = ['png', 'jpeg', 'webp', 'avif', 'tiff', 'tga', 'bmp'].map(format => item(`convert:${format}`, 'file-image', format.toUpperCase())).join('');
  const multiple = state.selectedIds.length > 1;
  menu.innerHTML = state.view === 'trash' ? `${multiple ? '' : item('preview', 'expand', '查看大图')}${item('restore', 'rotate-ccw', multiple ? '恢复所选' : '恢复图片')}${item('permanent', 'trash-2', multiple ? '彻底删除所选' : '彻底删除')}` : `${multiple ? '' : submenu('eye', '查看 / 编辑', item('preview', 'expand', '查看大图') + item('details', 'panel-right', '打开详情') + item('show', 'folder-open', '在本地文件夹中显示') + item('open', 'external-link', '在默认应用中打开'))}${item('add-to-board', 'panels-top-left', multiple ? '添加所选图片到画板' : '添加到画板')}${submenu('tag', '添加标签', tagChoices)}${submenu('tags', '移除标签', removeChoices)}<hr>${submenu('folder-input', '移动到文件夹', state.folders.map(folder => item(`folder:${folder.id}`, 'folder', esc(folderPath(folder)))).join(''))}${multiple ? '' : item('copy-clipboard', 'copy', '复制图片到剪贴板')}${item('copy', 'files', multiple ? '创建副本（所选）' : '创建副本')}${multiple ? '' : submenu('refresh-cw', '格式转换', image.hasPreview ? formats : '')}${multiple ? '' : item('cover', 'image-up', '设为图册封面')}${item('favorite', 'heart', multiple ? '加入收藏（所选）' : image.favorite ? '取消收藏' : '添加至收藏')}<hr>${multiple ? '' : item('pinterest', 'scan-search', '搜索相关图片')}${item('trash', 'trash-2', multiple ? '移至回收站（所选）' : '移至回收站')}`;
  menu.hidden = false; menu.style.left = `${Math.max(6, Math.min(event.clientX, innerWidth - 500))}px`; menu.style.top = `${Math.max(6, Math.min(event.clientY, innerHeight - 350))}px`; refreshIcons();
});
menu.onclick = async event => {
  const folderAction = event.target.closest('[data-folder-action]')?.dataset.folderAction;
  if (folderAction) {
    menu.hidden = true;
    const folder = state.folders.find(item => item.id === menu.dataset.folderId);
    if (!folder) return;
    try {
      if (folderAction === 'open') await api(`/api/folders/${folder.id}/open`, { method: 'POST' });
      if (folderAction === 'edit') openFolderModal(folder);
      if (folderAction === 'delete' && confirm(`删除文件夹「${folder.name}」及其子目录？图片会保留在所有图片中；关联画板将存入恢复备份，未保存的编辑请先保存。`)) {
        const removed = folderTreeIds(folder.id);
        await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
        const data = await api('/api/state');
        state.folders = data.folders; state.images = data.images; state.trash = data.trash;
        if (state.view.startsWith('folder:') && removed.has(state.view.slice(7))) state.view = 'all';
        render(); toast('文件夹已删除，图片已保留');
      }
    } catch (error) { toast(error.message); }
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
  menu.hidden = true;
  const image = [...state.images, ...state.trash].find(item => item.id === menu.dataset.id); if (!image) return;
  const ids = state.selectedIds.includes(image.id) ? state.selectedIds : [image.id];
  try {
    if (action === 'add-to-board') window.atlasAddToBoard(ids);
    else if (action === 'preview') openViewer(image.id);
    else if (action === 'details') selectImage(image.id);
    else if (action === 'show' || action === 'open') await api(`/api/images/${image.id}/${action}`, { method: 'POST' });
    else if (action.startsWith('tag:')) await assignTag(ids, action.slice(4));
    else if (action.startsWith('untag:')) await assignTag(ids, action.slice(6), true);
    else if (action === 'copy-clipboard') { await copyImageToClipboard(image); toast('图片已复制到剪贴板'); }
    else if (action === 'copy') { for (const id of ids) state.images.unshift(await api(`/api/images/${id}/copy`, { method: 'POST' })); render(); toast(`已创建 ${ids.length} 张副本`); }
    else if (action.startsWith('convert:')) { const format = action.slice(8); toast(`正在转换为 ${format.toUpperCase()}…`); const converted = await api(`/api/images/${image.id}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) }); state.images.unshift(converted); state.imageOrder?.unshift(converted.id); render(); selectImage(converted.id); toast(`已新增 ${format.toUpperCase()} 图片，原图已保留`); }
    else if (action.startsWith('folder:')) await moveImages(ids, action.slice(7));
    else if (action === 'cover') { if (!image.folderId) return toast('请先将图片放入文件夹'); const folder = state.folders.find(item => item.id === image.folderId); folder.coverId = image.id; await api(`/api/folders/${folder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coverId: image.id }) }); renderSidebar(); toast('已设为封面'); }
    else if (action === 'favorite') { if (ids.length > 1) $('#batchFavorite')?.click(); else await toggleFavorite(image.id); }
    else if (action === 'pinterest') { $('#pinterestPanel').classList.remove('collapsed'); void searchPinterestImage({ imageId: image.id }); }
    else if (action === 'trash') (ids.length > 1 ? $('#batchDelete') : $('#detailDelete'))?.click();
    else if (action === 'restore') (ids.length > 1 ? $('#batchRestore') : $('#detailRestore'))?.click();
    else if (action === 'permanent') (ids.length > 1 ? $('#batchPermanentDelete') : $('#detailPermanentDelete'))?.click();
  } catch (error) { toast(error.message); }
};
document.addEventListener('click', event => { if (!event.target.closest('#contextMenu')) menu.hidden = true; });

async function copyImageToClipboard(image) {
  if (!image.hasPreview) throw new Error('此图片没有可复制的预览');
  if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('当前环境不支持复制图片');
  const response = await fetch(previewUrl(image.id));
  if (!response.ok) throw new Error('读取图片失败');
  let blob = await response.blob();
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  if (!blob) throw new Error('图片转换失败');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

let pinterestQuery = '';
let pinterestMode = 'keyword';
let pinterestBookmark = '';
let pinterestImages = [];
let pinterestRequest = 0;
function renderPinterestResults() {
  $('#pinterestResults').innerHTML = pinterestImages.map((item, index) => `<article class="pinterest-result" data-pinterest-similar="${index}" draggable="true" title="查看相似图片，或拖入图集导入原图"><img src="${esc(item.preview)}" alt="Pinterest 图片 ${index + 1}" loading="lazy" draggable="false"><button data-pinterest-import="${index}" title="导入原图" aria-label="导入 Pinterest 图片 ${index + 1}">${icon('download', 14)}</button></article>`).join('');
  $('#pinterestMore').hidden = !pinterestBookmark;
  $('#pinterestFallback').hidden = pinterestImages.length > 0;
  refreshIcons();
}
function setPinterestOpen(open) {
  $('#pinterestPanel').classList.toggle('collapsed', !open);
  $('#pinterestToggle').setAttribute('aria-expanded', String(open));
  $('#pinterestToggle').setAttribute('aria-label', `${open ? '折叠' : '展开'}图片搜索`);
  $('#pinterestToggle').title = `${open ? '折叠' : '展开'}图片搜索`;
}
async function searchPinterestResults(query, more = false) {
  setPinterestOpen(true);
  const requestId = ++pinterestRequest;
  if (!more) { pinterestQuery = query; pinterestMode = /^https?:\/\/[^/]*pinterest\.com\/pin\/\d+\/?$/i.test(query) || /^\d{8,25}$/.test(query) ? 'related' : 'keyword'; pinterestBookmark = ''; pinterestImages = []; $('#pinterestResults').replaceChildren(); }
  $('#pinterestFallback').textContent = '正在检索 Pinterest 图片...';
  $('#pinterestFallback').hidden = more;
  $('#pinterestChoose').disabled = true;
  $('#pinterestMore').disabled = true;
  try {
    const route = pinterestMode === 'related' ? `/api/pinterest/related?pin=${encodeURIComponent(query)}${more ? `&bookmark=${encodeURIComponent(pinterestBookmark)}` : ''}` : `/api/pinterest/search?q=${encodeURIComponent(query)}${more ? `&bookmark=${encodeURIComponent(pinterestBookmark)}` : ''}`;
    const result = await api(route);
    if (requestId !== pinterestRequest) return;
    const known = new Set(pinterestImages.map(item => item.original));
    pinterestImages.push(...result.images.filter(item => !known.has(item.original)));
    pinterestBookmark = result.bookmark || '';
    $('#pinterestFallback').textContent = pinterestImages.length ? '' : '未找到相关图片';
    renderPinterestResults();
  } catch (error) {
    if (requestId !== pinterestRequest) return;
    $('#pinterestFallback').textContent = error.message;
    $('#pinterestFallback').hidden = more && pinterestImages.length > 0;
    if (more) toast(error.message);
  } finally {
    if (requestId === pinterestRequest) { $('#pinterestChoose').disabled = false; $('#pinterestMore').disabled = false; }
  }
}
async function searchPinterestImage(source) {
  return window.imageSearch?.searchImage(source);
}
$('#pinterestChoose').onclick = () => { setPinterestOpen(true); $('#pinterestFile').click(); };
$('#pinterestFile').onchange = event => {
  const file = event.target.files[0];
  if (file) void searchPinterestImage(file);
  event.target.value = '';
};
$('#pinterestPanel').addEventListener('dragover', event => {
  if (![...(event.dataTransfer?.types || [])].some(type => type === 'Files' || type === 'application/x-journal-images')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = [...event.dataTransfer.types].includes('application/x-journal-images') ? 'move' : 'copy';
  $('#pinterestPanel').classList.add('image-search-target');
});
let deletingTrash = false;
async function permanentlyDeleteTrash(ids) {
  if (deletingTrash) return;
  deletingTrash = true;
  try {
    for (const id of ids) {
      await api(`/api/trash/${id}/delete`, { method: 'POST' });
      state.trash = state.trash.filter(item => item.id !== id);
    }
    state.selectedIds = [];
    state.selectedId = null;
    render();
    toast(`已彻底删除 ${ids.length} 张图片`);
  } catch (error) {
    const data = await api('/api/state');
    state.images = data.images;
    state.trash = data.trash;
    state.selectedIds = [];
    state.selectedId = null;
    render();
    toast(`删除未完成：${error.message}`);
  } finally {
    deletingTrash = false;
  }
}
$('#emptyTrash').onclick = () => {
  const ids = state.trash.map(image => image.id);
  if (ids.length && confirm(`彻底清空回收站中的 ${ids.length} 张图片？此操作无法撤销。`)) void permanentlyDeleteTrash(ids);
};
$('#pinterestPanel').addEventListener('dragleave', event => {
  if (!$('#pinterestPanel').contains(event.relatedTarget)) $('#pinterestPanel').classList.remove('image-search-target');
});
$('#pinterestPanel').addEventListener('drop', event => {
  $('#pinterestPanel').classList.remove('image-search-target');
  const id = event.dataTransfer?.getData('application/x-journal-images');
  const file = event.dataTransfer?.files?.[0];
  if (!id && !file) return;
  event.preventDefault();
  event.stopPropagation();
  if (id) {
    pinterestDropHandled = true;
    try { void searchPinterestImage({ imageId: JSON.parse(id)[0] }); }
    catch { toast('无法识别拖入的图库图片'); }
  } else if (file.type.startsWith('image/')) void searchPinterestImage(file);
  else toast('请拖入图片文件');
});
let suppressMarqueeClick = false;
document.addEventListener('click', event => {
  if (!suppressMarqueeClick) return;
  suppressMarqueeClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
$('#dropZone').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.image-card,button,input,.drop-overlay')) return;
  const area = $('#dropZone');
  const bounds = area.getBoundingClientRect();
  const origin = { x: event.clientX, y: event.clientY };
  const previous = event.ctrlKey || event.metaKey ? [...state.selectedIds] : [];
  let active = false;
  const box = document.createElement('div');
  box.className = 'selection-marquee';
  const move = pointer => {
    if (!active && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 5) return;
    if (!active) { active = true; document.body.append(box); }
    const x = Math.max(bounds.left, Math.min(bounds.right, pointer.clientX));
    const y = Math.max(bounds.top, Math.min(bounds.bottom, pointer.clientY));
    const left = Math.min(origin.x, x), top = Math.min(origin.y, y);
    const right = Math.max(origin.x, x), bottom = Math.max(origin.y, y);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    const hit = [...area.querySelectorAll('.image-card')].filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
    }).map(card => card.dataset.id);
    state.selectedIds = [...new Set([...previous, ...hit])];
    state.selectedId = state.selectedIds.at(-1) || null;
    area.querySelectorAll('.image-card').forEach(card => card.classList.toggle('selected', state.selectedIds.includes(card.dataset.id)));
  };
  const finish = () => {
    area.removeEventListener('pointermove', move);
    area.removeEventListener('pointerup', finish);
    area.removeEventListener('pointercancel', finish);
    box.remove();
    if (active) {
      suppressMarqueeClick = true;
      setTimeout(() => { suppressMarqueeClick = false; }, 0);
      renderInspector();
      $('.app').classList.remove('details-collapsed');
      $('#inspector').classList.add('open');
    }
  };
  area.setPointerCapture(event.pointerId);
  area.addEventListener('pointermove', move);
  area.addEventListener('pointerup', finish);
  area.addEventListener('pointercancel', finish);
  event.preventDefault();
});
$('#inspector').addEventListener('click', async event => {
  const action = event.target.closest('#batchFavorite,#batchDelete,#batchRestore,#batchPermanentDelete')?.id;
  if (!action || state.selectedIds.length < 2) return;
  const ids = [...state.selectedIds];
  if (action === 'batchDelete' && !confirm(`将选中的 ${ids.length} 张图片移至回收站？`)) return;
  if (action === 'batchPermanentDelete') {
    if (confirm(`彻底删除选中的 ${ids.length} 张图片？此操作无法撤销。`)) await permanentlyDeleteTrash(ids);
    return;
  }
  try {
    for (const id of ids) {
      if (action === 'batchRestore') {
        const image = state.trash.find(item => item.id === id);
        if (!image) continue;
        await api(`/api/trash/${id}/restore`, { method: 'POST' });
        state.trash = state.trash.filter(item => item.id !== id);
        const restored = { ...image }; delete restored.deletedAt;
        state.images.unshift(restored);
      } else if (action === 'batchDelete') {
        const image = state.images.find(item => item.id === id);
        if (!image) continue;
        await api(`/api/images/${id}`, { method: 'DELETE' });
        state.images = state.images.filter(item => item.id !== id);
        state.trash.unshift({ ...image, deletedAt: Date.now() });
      } else {
        const index = state.images.findIndex(item => item.id === id);
        if (index < 0) continue;
        state.images[index] = await api(`/api/images/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true }) });
      }
    }
    state.selectedIds = [];
    state.selectedId = null;
    render(); toast(action === 'batchRestore' ? '所选图片已恢复' : action === 'batchDelete' ? '所选图片已移至回收站' : '所选图片已加入收藏');
  } catch (error) {
    const data = await api('/api/state'); state.images = data.images; state.trash = data.trash; render(); toast(error.message);
  }
});
$('#pinterestMore').onclick = () => { if (pinterestBookmark) void searchPinterestResults(pinterestQuery, true); };
$('#pinterestToggle').onclick = () => setPinterestOpen($('#pinterestPanel').classList.contains('collapsed'));
async function importPinterestItem(item) {
  const image = await api('/api/import-pinterest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.original, pinId: item.pinId }) });
  state.images.unshift(image);
  state.view = 'all';
  state.query = '';
  $('#searchInput').value = '';
  state.selectedId = image.id;
  state.selectedIds = [image.id];
  render();
  toast('Pinterest 原图已加入图库');
}
$('#pinterestResults').addEventListener('dragstart', event => {
  const card = event.target.closest('[data-pinterest-similar]');
  const item = card && pinterestImages[Number(card.dataset.pinterestSimilar)];
  if (!item || event.target.closest('button')) return event.preventDefault();
  event.dataTransfer.setData('application/x-journal-pinterest', JSON.stringify({ original: item.original, pinId: item.pinId }));
  event.dataTransfer.effectAllowed = 'copy';
});
document.addEventListener('dragover', event => {
  if (!event.target.closest('#dropZone') || ![...(event.dataTransfer?.types || [])].includes('application/x-journal-pinterest')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  $('#dropZone').classList.add('pinterest-drop-target');
});
document.addEventListener('dragleave', event => {
  if (!$('#dropZone').contains(event.relatedTarget)) $('#dropZone').classList.remove('pinterest-drop-target');
});
document.addEventListener('dragend', () => $('#dropZone').classList.remove('pinterest-drop-target'));
document.addEventListener('drop', async event => {
  $('#dropZone').classList.remove('pinterest-drop-target');
  const payload = event.dataTransfer?.getData('application/x-journal-pinterest');
  if (!payload || !event.target.closest('#dropZone')) return;
  event.preventDefault();
  event.stopPropagation();
  try { await importPinterestItem(JSON.parse(payload)); }
  catch (error) { toast(error.message); }
});
$('#pinterestResults').onclick = async event => {
  const button = event.target.closest('[data-pinterest-import]');
  if (!button) {
    const card = event.target.closest('[data-pinterest-similar]');
    const item = card && pinterestImages[Number(card.dataset.pinterestSimilar)];
    if (!item?.pinId) return toast('该图片没有可用的 Pin ID');
    const link = `https://www.pinterest.com/pin/${item.pinId}/`;
    void searchPinterestResults(link);
    return;
  }
  const item = pinterestImages[Number(button.dataset.pinterestImport)];
  if (!item) return;
  button.disabled = true;
  try { await importPinterestItem(item); }
  catch (error) { toast(error.message); button.disabled = false; }
};

document.addEventListener('drop', async event => {
  if ([...(event.dataTransfer?.types || [])].includes('Files')) return;
  const html = event.dataTransfer?.getData('text/html') || '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  const value = document.querySelector('img')?.src || event.dataTransfer?.getData('text/uri-list') || '';
  try {
    const url = new URL(value);
    if (url.hostname !== 'i.pinimg.com') return;
    event.preventDefault(); event.stopPropagation();
    const image = await api('/api/import-pinterest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.href }) });
    state.images.unshift(image); render(); toast('Pinterest 图片已加入图库');
  } catch {}
});

