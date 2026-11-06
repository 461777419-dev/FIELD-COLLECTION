const $ = selector => document.querySelector(selector);
const state = { folders: [], tags: [], trash: [], icons: {}, images: [], view: 'all', selectedId: null, selectedIds: [], query: '', sort: 'newest', folderEditing: null, tagEditing: null, collapsedTags: new Set(), collapsedFolders: new Set(), uploading: false };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, size = 16) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
const imgUrl = id => `/media/${id}`;
const isVideo = image => /\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(image.ext || '');
function folderFill(image) {
  const color = state.folders.find(folder => folder.id === image.folderId)?.color;
  return /^#[0-9a-f]{6}$/i.test(color || '') ? '<div class="folder-color-fill" style="background:' + color + '" aria-label="文件夹标记颜色"></div>' : '';
}
function tagFrame(image) { const colors = [...new Set(image.tags.map(key => state.tags.find(tag => tag.key === key)?.color).filter(color => /^#[0-9a-f]{6}$/i.test(color)))]; return colors.length ? `<div class="tag-color-frame" style="border-image:linear-gradient(135deg,${colors.length === 1 ? colors[0]+','+colors[0] : colors.join(',')}) 1" aria-label="标签颜色边框"></div>` : ''; }
const previewUrl = id => `/preview/${id}`;
if (!window.journalDesktop && (window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke)) {
  window.journalDesktop = {
    dragImagesOut(ids) {
      const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
      invoke('drag_images_out', { ids }).catch(error => toast(`拖出失败：${error}`));
    }
  };
}
window.addEventListener('journal-drag-error', event => toast(`拖出失败：${event.detail}`));
const iconSlot = (key, fallback) => state.icons[key] ? `<img class="custom-icon" src="/icons/${key}?v=${encodeURIComponent(state.icons[key])}" alt="">` : icon(fallback);
const sizeText = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const dateText = timestamp => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);
let toastTimer;
function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
async function api(route, options = {}) {
  const response = await fetch(route, options);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if(response.status===409&&data.needsConfirmation&&options.method==='DELETE'){
    const names=(data.affected||[]).map(board=>board.name).join('、');
    if(!confirm(`${data.error}\n关联画板：${names}\n继续移入回收站？`))throw new Error('已取消删除');
    return api(route,{...options,headers:{...options.headers,'X-Confirm-Board-Delete':'1'}});
  }
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
function folderTreeIds(id) {
  const ids = new Set([id]);
  let changed;
  do {
    changed = false;
    for (const folder of state.folders) {
      if (ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
    }
  } while (changed);
  return ids;
}
function folderPath(folder) {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parent = state.folders.find(item => item.id === folder.parentId);
  while (parent && !seen.has(parent.id)) {
    names.unshift(parent.name);
    seen.add(parent.id);
    parent = state.folders.find(item => item.id === parent.parentId);
  }
  return names.join(' / ');
}
function folderOptions(selectedId = '') {
  return state.folders.map(folder => `<option value="${folder.id}" ${selectedId === folder.id ? 'selected' : ''}>${esc(folderPath(folder))}</option>`).join('');
}
function visibleImages() {
  const query = state.query.toLocaleLowerCase();
  const folderIds = state.view.startsWith('folder:') ? folderTreeIds(state.view.slice(7)) : null;
  const items = (state.view === 'trash' ? state.trash : state.images).filter(image => {
    if (state.view === 'favorites' && !image.favorite) return false;
    if (state.view === 'untagged' && image.tags.length) return false;
    if (folderIds && !folderIds.has(image.folderId) && !state.folders.some(folder => folderIds.has(folder.id) && folder.referenceIds?.includes(image.id))) return false;
    if (state.view.startsWith('tag:') && !image.tags.includes(state.view.slice(4))) return false;
    if (!query) return true;
    return [image.name, image.originalName, image.note, ...image.tags].some(value => String(value).toLocaleLowerCase().includes(query));
  });
  items.sort((a, b) => state.sort === 'manual' ? (state.imageOrder?.indexOf(a.id) ?? -1) - (state.imageOrder?.indexOf(b.id) ?? -1) : state.sort === 'oldest' ? a.createdAt - b.createdAt : state.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : state.sort === 'size' ? b.size - a.size : state.sort === 'tags' ? (a.tags[0] || '\uffff').localeCompare(b.tags[0] || '\uffff', 'zh-CN') : b.createdAt - a.createdAt);
  return items;
}
function viewName() {
  if (state.view === 'trash') return '回收站';
  if (state.view === 'favorites') return '我的收藏';
  if (state.view === 'untagged') return '未加标签';
  if (state.view.startsWith('folder:')) { const folder = state.folders.find(item => item.id === state.view.slice(7)); return folder ? folderPath(folder) : '文件夹'; }
  if (state.view.startsWith('tag:')) return `# ${state.view.slice(4)}`;
  return '所有图片';
}
function renderSidebar() {
  $('#allCount').textContent = state.images.length;
  $('#favCount').textContent = state.images.filter(image => image.favorite).length;
  $('#untaggedCount').textContent = state.images.filter(image => !image.tags.length).length;
  $('#trashCount').textContent = state.trash.length;
  document.querySelectorAll('.side-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  const renderFolder = (folder, depth = 0) => {
    const children = state.folders.filter(item => item.parentId === folder.id);
    const ids = folderTreeIds(folder.id);
    const count = state.images.filter(image => ids.has(image.folderId) || state.folders.some(item => ids.has(item.id) && item.referenceIds?.includes(image.id))).length;
    const expanded = !state.collapsedFolders.has(folder.id);
    return `<div class="side-item folder-row ${state.view === `folder:${folder.id}` ? 'active' : ''}" style="--folder-depth:${Math.min(depth, 8)};${/^#[0-9a-f]{6}$/i.test(folder.color || '') ? `--folder-mark:${folder.color}` : ''}" role="button" tabindex="0" data-folder-view="${esc(folder.id)}" draggable="true" title="拖到其他文件夹可设为子文件夹">${children.length ? `<button class="folder-expander" data-folder-expand="${folder.id}" title="${expanded ? '折叠' : '展开'}子文件夹" aria-label="${expanded ? '折叠' : '展开'}${esc(folder.name)}">${icon(expanded ? 'chevron-down' : 'chevron-right', 13)}</button>` : '<span class="folder-expander-spacer"></span>'}<button class="folder-color-icon" data-folder-color="${esc(folder.id)}" title="调整文件夹标记颜色" aria-label="调整 ${esc(folder.name)} 文件夹颜色">${icon('folder')}</button>${folder.coverId ? `<img class="folder-cover" src="${previewUrl(folder.coverId)}" alt="">` : ''}<span title="${esc(folderPath(folder))}">${esc(folder.name)}</span><b>${count}</b><button class="folder-menu" data-folder-menu="${esc(folder.id)}" title="文件夹选项" aria-label="${esc(folder.name)}选项">${icon('ellipsis')}</button></div>${expanded ? children.map(child => renderFolder(child, depth + 1)).join('') : ''}`;
  };
  $('#folderList').innerHTML = state.folders.filter(folder => !folder.parentId || !state.folders.some(item => item.id === folder.parentId)).map(folder => renderFolder(folder)).join('');
  const tags = new Map(state.tags.map(tag => [tag.key, tag]));
  state.images.forEach(image => image.tags.forEach(key => { if (!tags.has(key)) tags.set(key, { key, name: key, color: '#a25337', parent: null }); }));
  $('#sidebar').classList.toggle('has-categories', state.folders.length + tags.size > 3);
  const row = (tag, child = false) => `<div class="tag-side-row ${child ? 'child' : ''} ${state.view === `tag:${tag.key}` ? 'active' : ''}" data-tag-view="${esc(tag.key)}" data-drop-tag="${esc(tag.key)}" draggable="true" title="拖到图片可赋予标签；拖到一级标签可设为子标签">${child ? '' : `<button class="tag-expander" data-tag-expand="${esc(tag.key)}" title="展开或折叠">${icon(state.collapsedTags.has(tag.key) ? 'chevron-right' : 'chevron-down', 13)}</button>`}<button class="tag-dot" data-edit-tag="${esc(tag.key)}" title="调整标签颜色" aria-label="调整 ${esc(tag.name)} 标签颜色" style="background:${esc(tag.color)}"></button><span class="tag-label" title="${esc(tag.name)}">${esc(tag.name)}</span><b>${state.images.filter(image => image.tags.includes(tag.key)).length}</b><button data-edit-tag="${esc(tag.key)}" title="重命名标签" aria-label="重命名 ${esc(tag.name)}">${icon('pencil', 13)}</button><button data-delete-tag="${esc(tag.key)}" title="删除标签" aria-label="删除 ${esc(tag.name)}">${icon('x', 13)}</button></div>`;
  $('#tagList').innerHTML = [...tags.values()].filter(tag => !tag.parent).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map(parent => row(parent) + (state.collapsedTags.has(parent.key) ? '' : [...tags.values()].filter(tag => tag.parent === parent.key).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map(tag => row(tag, true)).join(''))).join('');
  document.querySelectorAll('[data-icon-slot]').forEach(slot => { const key = slot.dataset.iconSlot; slot.innerHTML = iconSlot(key, slot.dataset.defaultIcon); });
  refreshIcons();
}
function renderGallery() {
  const items = visibleImages();
  const title = viewName();
  $('#viewTitle').textContent = title;
  $('#heading').textContent = title;
  $('#viewCount').textContent = `${items.length} 张图片`;
  $('#footerCount').textContent = `${items.length} 张图片`;
  $('#emptyTrash').hidden = state.view !== 'trash' || !state.trash.length;
  const card = (image, index) => `<article class="image-card ${state.selectedIds.includes(image.id) ? 'selected' : ''}" data-id="${image.id}" data-plate="SPECIMEN No. ${String(index + 1).padStart(3, '0')}" tabindex="0" draggable="true" title="双击打开 ${esc(image.name)}" aria-label="${esc(image.name)}">${folderFill(image)}${tagFrame(image)}<div class="album-specimen"><span>SPECIMEN No. ${String(index + 1).padStart(3, '0')}</span><span>${esc(image.ext?.slice(1).toUpperCase() || 'IMAGE')}</span></div>${state.view !== 'trash' && window.journalDesktop ? `<span class="drag-out" draggable="true" title="拖出原文件" aria-label="拖出原文件">${icon('move-up-right', 14)}</span>` : ''}${isVideo(image) ? `<div class="video-thumbnail"><video src="/media/${image.id}#t=0.1" preload="metadata" muted playsinline draggable="false"></video><button type="button" class="video-play" data-play-video="${image.id}" aria-label="播放 ${esc(image.name)}">▶ 播放视频</button></div>` : image.hasPreview === false ? `<div class="no-preview">${icon('file-image', 28)}<span>暂无内嵌预览</span></div>` : `<img src="${previewUrl(image.id)}" alt="${esc(image.name)}" ${image.width && image.height ? `width="${image.width}" height="${image.height}"` : ''} loading="lazy" draggable="false">`}<div class="image-meta"><strong title="${esc(image.name)}">${esc(image.name)}</strong>${state.view === 'trash' ? '' : `<button class="heart ${image.favorite ? 'active' : ''}" data-favorite="${image.id}" title="${image.favorite ? '取消收藏' : '收藏'}" aria-label="${image.favorite ? '取消收藏' : '收藏'}" aria-pressed="${!!image.favorite}">${icon('heart', 16)}</button>`}</div><div class="image-tags"><span class="format-badge">${esc(image.ext?.slice(1).toUpperCase() || 'IMG')}</span><span class="card-file-size">${sizeText(image.size)}</span>${image.tags.slice(0, 3).map(tag => `<span>${esc(tag)}</span>`).join('')}</div></article>`;
  if (state.sort === 'tags') {
    const groups = new Map();
    items.forEach(image => { const child = image.tags.map(key => state.tags.find(tag => tag.key === key)).find(tag => tag?.parent); const parent = child?.parent || image.tags[0] || '未加标签 / 待整理'; const key = `${parent}\u0000${child?.name || ''}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(image); });
    $('#gallery').innerHTML = [...groups].sort(([a], [b]) => a.includes('未加标签 / 待整理') ? 1 : b.includes('未加标签 / 待整理') ? -1 : a.localeCompare(b, 'zh-CN')).map(([key, group]) => { const [parent, child] = key.split('\u0000'); return `<section class="gallery-group"><h2>${esc(parent)}${child ? ` <span class="group-child">/ ${esc(child)}</span>` : ''} <small>${group.length}</small></h2><div class="gallery-columns">${group.map(card).join('')}</div></section>`; }).join('');
  } else $('#gallery').innerHTML = items.map(card).join('');
  const empty = !items.length;
  $('#emptyState').hidden = !empty;
  $('#emptyTitle').textContent = state.images.length ? '没有匹配的图片' : '还没有参考图';
  $('#emptyText').textContent = state.view === 'trash' ? '回收站为空。' : state.images.length ? '试试其他搜索词或分类。' : '将图片或文件夹拖入窗口。';
  refreshIcons();
  document.dispatchEvent(new CustomEvent('library-rendered', { detail: { query: state.query, count: items.length, suggestions: items.flatMap(image => [image.name, ...image.tags]) } }));
}
const paletteCache = new Map();
let sampleCount = 4;
function sampleColors(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = pixels.subarray(i, i + 4);
    if (alpha < 160 || (r > 242 && g > 242 && b > 242)) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].sort((a, b) => b.count - a.count).map(bucket => [bucket.r, bucket.g, bucket.b].map(value => Math.round(value / bucket.count)));
  const chosen = [];
  for (const distance of [58, 28, 0]) {
    for (const color of colors) {
      if (chosen.length === 9) break;
      if (!chosen.includes(color) && chosen.every(other => color.reduce((sum, value, index) => sum + (value - other[index]) ** 2, 0) >= distance ** 2)) chosen.push(color);
    }
  }
  return chosen.map(color => `#${color.map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase());
}
function paintSamplePalette(id, colors) {
  const target = document.querySelector(`.sample-palette[data-image-id="${id}"] .sample-swatches`);
  if (target) target.innerHTML = colors.length ? colors.slice(0, sampleCount).map(color => `<button type="button" class="sample-swatch" data-color="${color}" style="background:${color}" title="复制 ${color}" aria-label="复制颜色 ${color}"></button>`).join('') : '<span class="sample-unavailable">无法从预览提取颜色</span>';
}
function renderSamplePalette(image) {
  const section = document.createElement('section');
  section.className = 'sample-palette';
  section.dataset.imageId = image.id;
  section.innerHTML = `<div class="sample-heading"><strong>采样色彩</strong><output for="sampleCount" id="sampleCountValue">${sampleCount} 色</output></div><input type="range" id="sampleCount" min="1" max="9" value="${sampleCount}" aria-label="采样颜色数量" ${image.hasPreview ? '' : 'disabled'}><div class="sample-swatches"><span class="sample-unavailable">${image.hasPreview ? '正在采样…' : '此文件暂无可采样的预览图'}</span></div>`;
  section.insertAdjacentHTML('beforeend', '<div class="field-note"><img src="/assets/observation-note.svg" alt="小黑正在观察图片中的颜色"><small>把自然的颜色，留下来。</small></div>');
  $('#inspectorContent .ai-panel').before(section);
  if (!image.hasPreview) return;
  if (paletteCache.has(image.id)) return paintSamplePalette(image.id, paletteCache.get(image.id));
  const source = new Image();
  source.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 96 / Math.max(source.naturalWidth, source.naturalHeight));
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const colors = sampleColors(context.getImageData(0, 0, canvas.width, canvas.height).data);
      paletteCache.set(image.id, colors); paintSamplePalette(image.id, colors);
    } catch { paintSamplePalette(image.id, []); }
  };
  source.onerror = () => paintSamplePalette(image.id, []);
  source.src = previewUrl(image.id);
}
$('#inspector').addEventListener('input', event => {
  if (event.target.id !== 'sampleCount') return;
  sampleCount = Number(event.target.value);
  $('#sampleCountValue').value = `${sampleCount} 色`;
  const id = event.target.closest('.sample-palette').dataset.imageId;
  if (paletteCache.has(id)) paintSamplePalette(id, paletteCache.get(id));
});
function renderInspector() {
  const image = [...state.images, ...state.trash].find(item => item.id === state.selectedId);
  if (state.selectedIds.length > 1) {
    $('#inspectorContent').className = 'inspector-multi';
    $('#inspectorContent').innerHTML = `<div class="batch-inspector"><h2>已选 ${state.selectedIds.length} 张图片</h2>${state.view === 'trash' ? `<div class="batch-actions"><button class="action-btn" id="batchRestore">恢复所选</button><button class="text-btn danger" id="batchPermanentDelete">彻底删除所选</button></div>` : `<label class="field-label" for="batchTag">添加标签</label><input class="tag-input" id="batchTag" placeholder="输入标签后按 Enter"><label class="field-label" for="batchFolder">移动到文件夹</label><select class="detail-select" id="batchFolder"><option value="">选择文件夹</option>${folderOptions()}</select><div class="batch-actions"><button class="text-btn" id="batchFavorite">加入收藏</button><button class="text-btn danger" id="batchDelete">移至回收站</button></div>`}</div>`;
    return;
  }
  if (!image) {
    $('#inspectorContent').className = 'inspector-empty';
    $('#inspectorContent').innerHTML = `<div class="inspector-empty-icon">${icon('mouse-pointer-2', 20)}</div><strong>选择一张图片</strong><span>查看详情并整理标签与备注</span>`;
    refreshIcons(); return;
  }
  const inTrash = state.view === 'trash';
  $('#inspectorContent').className = '';
  const relatedItems = (image.related || []).map(link => ({ link, peer: state.images.find(item => item.id === link.id) })).filter(item => item.peer);
  const relatedBoard = `<section class="related-board" data-related-board="${image.id}"><div class="related-heading"><strong><img src="/assets/related-images.png" alt="">关联图片</strong><span>${relatedItems.length}</span></div><div class="related-grid">${relatedItems.map(({ link, peer }) => `<div class="related-card ${link.locked ? 'locked' : ''}" data-related-id="${peer.id}" draggable="${!link.locked && !inTrash}" title="${esc(peer.name)}">${peer.hasPreview === false ? `<span class="related-no-preview">${icon('file-image', 19)}</span>` : `<img src="${previewUrl(peer.id)}" alt="${esc(peer.name)}" draggable="false">`}<span class="related-name">${esc(peer.name)}</span>${inTrash ? '' : `<button class="related-lock" data-related-lock="${peer.id}" title="${link.locked ? '解锁位置' : '锁定位置'}" aria-label="${link.locked ? '解锁位置' : '锁定位置'}" aria-pressed="${!!link.locked}">${icon(link.locked ? 'lock-keyhole' : 'lock-keyhole-open', 14)}</button><button class="related-remove" data-related-remove="${peer.id}" title="移除关联" aria-label="移除关联 ${esc(peer.name)}">${icon('x', 13)}</button>`}</div>`).join('') || '<div class="related-empty">拖入图库中的图片建立关联</div>'}</div><div class="related-resizer" role="separator" aria-label="调整关联图片区域高度" aria-orientation="horizontal" tabindex="0" title="上下拖动调整关联图片区域高度"></div></section>`;
  const tags = image.tags.map(key => `<span class="tag-chip">${esc(key)}${inTrash ? '' : `<button data-remove-tag="${esc(key)}" title="移除标签" aria-label="移除 ${esc(key)} 标签">${icon('x', 11)}</button>`}</span>`).join('');
  const rows = [['文件名', image.originalName], ['文件格式', image.ext?.slice(1).toUpperCase() || '未知'], ['分辨率', image.width && image.height ? `${image.width} × ${image.height} px` : '未知'], ['文件大小', sizeText(image.size)], ['源文件修改', dateText(image.sourceModifiedAt || image.createdAt)], ['图库修改', dateText(image.modifiedAt || image.createdAt)]].map(([label, value]) => `<div class="detail-row"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('');
  $('#inspectorContent').innerHTML = `${relatedBoard}<div class="inspector-body"><div class="inspector-heading"><h2>图片详情</h2><button class="inspector-open" id="detailOpen" type="button">${icon('expand', 14)}查看大图</button>${inTrash ? '' : `<button class="icon-btn quiet favorite-detail ${image.favorite ? 'active' : ''}" id="detailFavorite" title="${image.favorite ? '取消收藏' : '收藏'}" aria-label="${image.favorite ? '取消收藏' : '收藏'}" aria-pressed="${!!image.favorite}">${icon('heart')}</button>`}</div><label class="field-label" for="detailName">名称</label><input class="detail-input" id="detailName" value="${esc(image.name)}" maxlength="240" ${inTrash ? 'disabled' : ''}><label class="field-label" for="detailFolder">文件夹</label><select class="detail-select" id="detailFolder" ${inTrash ? 'disabled' : ''}><option value="">未分类</option>${state.folders.map(folder => `<option value="${folder.id}" ${image.folderId === folder.id ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}</select><label class="field-label">标签</label><div class="tag-editor">${tags}</div>${inTrash ? '' : `<input class="tag-input" id="tagInput" placeholder="输入标签后按 Enter" maxlength="40">`}<label class="field-label" for="detailNote">备注</label><textarea class="detail-textarea" id="detailNote" ${inTrash ? 'disabled' : ''}>${esc(image.note)}</textarea><div class="divider"></div><section class="ai-panel"><div class="ai-heading"><strong>AI 图片分析</strong>${inTrash ? '' : `<button id="analyzeImage" ${image.hasPreview === false ? 'disabled title="暂无可分析的预览图"' : 'title="分析图片并反推生成提示词"'}>${icon('sparkles', 14)}${image.ai ? '重新分析' : '开始分析'}</button>`}</div>${image.ai ? `<label class="field-label">画面分析</label><p class="ai-result">${esc(image.ai.analysis)}</p><label class="field-label">反推提示词</label><p class="ai-result">${esc(image.ai.prompt)}</p><button class="ai-copy" id="copyAiPrompt" title="复制提示词">${icon('copy', 14)}复制提示词</button>` : `<p class="ai-placeholder">${image.hasPreview === false ? '此文件暂无可分析的预览图' : '分析结果将在这里显示'}</p>`}</section><div class="divider"></div>${rows}<div class="detail-actions">${inTrash ? `<button id="detailRestore">${icon('rotate-ccw')}恢复</button><button class="danger" id="detailPermanentDelete">${icon('trash-2')}彻底删除</button>` : `<button id="detailDownload">${icon('download')}原图</button><button class="danger" id="detailDelete">${icon('trash-2')}移至回收站</button>`}</div></div>`;
  $('#detailFolder').innerHTML = `<option value="">未分类</option>${folderOptions(image.folderId)}`;
  renderSamplePalette(image);
  refreshIcons();
}
function render() { renderSidebar(); renderGallery(); renderInspector(); }
function selectImage(id, additive = false) { state.selectedIds = additive ? (state.selectedIds.includes(id) ? state.selectedIds.filter(item => item !== id) : [...state.selectedIds, id]) : [id]; state.selectedId = state.selectedIds.at(-1) || null; document.querySelectorAll('.image-card').forEach(card => card.classList.toggle('selected', state.selectedIds.includes(card.dataset.id))); renderInspector(); $('.app').classList.remove('details-collapsed'); $('#inspector').classList.add('open'); window.updatePinterest?.(state.images.find(item => item.id === state.selectedId)); }
async function patchImage(id, values, rerender = true) {
  try { const updated = await api(`/api/images/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); const index = state.images.findIndex(item => item.id === id); if (index !== -1) state.images[index] = updated; if (rerender) render(); }
  catch (error) { toast(error.message); }
}
async function toggleFavorite(id) { const image = state.images.find(item => item.id === id); if (image) await patchImage(id, { favorite: !image.favorite }); }
function openFolderModal(folder = null) { state.folderEditing = folder?.id || null; $('#folderDialogTitle').textContent = folder ? '编辑文件夹' : '新建文件夹'; $('#folderName').value = folder?.name || ''; $('#folderColor').value = folder?.color || '#95b6dc'; $('#folderColorEnabled').checked = !!folder?.color; const excluded = folder ? folderTreeIds(folder.id) : new Set(); const parentId = folder ? folder.parentId : (state.view.startsWith('folder:') ? state.view.slice(7) : null); $('#folderParent').innerHTML = '<option value="">无（一级文件夹）</option>' + state.folders.filter(item => !excluded.has(item.id)).map(item => `<option value="${esc(item.id)}" ${item.id === parentId ? 'selected' : ''}>${esc(folderPath(item))}</option>`).join(''); $('#folderModal').hidden = false; setTimeout(() => $('#folderName').focus(), 0); }
function closeModal(id) { if (id === 'viewer') { $('#viewerVideo').pause(); $('#viewerVideo').removeAttribute('src'); $('#viewerVideo').load(); } $('#' + id).hidden = true; }
async function saveFolder() {
  const parentId = $('#folderParent').value || null;
  const color = $('#folderColorEnabled').checked ? $('#folderColor').value : null;
  const name = $('#folderName').value.trim(); if (!name) return toast('请输入文件夹名称');
  try {
    if (state.folderEditing) { const folder = await api(`/api/folders/${state.folderEditing}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color, parentId }) }); const index = state.folders.findIndex(item => item.id === folder.id); state.folders[index] = folder; }
    else { const folder = await api('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId, color }) }); state.folders.push(folder); state.view = `folder:${folder.id}`; }
    closeModal('folderModal'); render(); toast(state.folderEditing ? '文件夹已保存' : '文件夹已创建');
  } catch (error) { toast(error.message); }
}
async function uploadFiles(files, destination = state.view) {
  const supported = [...files].map(item => item.file ? item : { file: item }).filter(item => /\.(png|jpe?g|webp|gif|avif|tiff?|tga|bmp|psd|psb|clip|ai|eps|cr2|cr3|nef|arw|dng|raf|orf|rw2|mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(item.file.name));
  if (!supported.length) return toast('请选择图片、视频或设计源文件（单文件不超过 120 MB）');
  if (state.uploading) return toast('请等待当前导入完成');
  state.uploading = true;
  let done = 0, failed = 0, skipped = 0, lastError = '';
  const folderId = destination.startsWith('folder:') ? destination.slice(7) : '';
  const importedFolders = new Map();
  for (const { file, relativePath } of supported) {
    $('#uploadStatus').textContent = `正在导入 ${done + failed + 1} / ${supported.length}`;
    try {
      let targetFolder = folderId;
      const segments = String(relativePath || file.webkitRelativePath || '').split('/').filter(part => part && part !== '.' && part !== '..').slice(0, -1);
      for (const name of segments) {
        const key = `${targetFolder}/${name}`;
        if (!importedFolders.has(key)) {
          let folder = state.folders.find(item => (item.parentId || '') === targetFolder && item.name === name);
          if (!folder) {
            folder = await api('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId: targetFolder || null }) });
            state.folders.push(folder);
          }
          importedFolders.set(key, folder.id);
        }
        targetFolder = importedFolders.get(key);
      }
      if (file.size > 120 * 1024 * 1024) throw new Error('文件过大（最大 120 MB）');
      const headers = { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Folder-Id': targetFolder, 'X-Modified-At': String(file.lastModified) };
      let response = await fetch('/api/images', { method: 'POST', headers, body: file });
      if (response.status === 409) {
        const details = await response.json();
        const action = await chooseDuplicate(file.name, details.matches);
        if (action === 'skip') { skipped++; continue; }
        response = await fetch('/api/images', { method: 'POST', headers: { ...headers, 'X-Duplicate-Action': action }, body: file });
      }
      const image = await response.json();
      if (!response.ok) throw new Error(image.error || `导入失败 (${response.status})`);
      if (image.skipped) { skipped++; continue; }
      const imported = destination === 'favorites' ? await api(`/api/images/${image.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true }) }) : image;
      state.images.unshift(imported); state.imageOrder?.unshift(imported.id); done++;
    } catch (error) { failed++; lastError = error.message; }
  }
  state.uploading = false;
  $('#uploadStatus').textContent = '';
  render(); toast(`已导入 ${done} 张图片${skipped ? `，跳过 ${skipped} 张` : ''}${failed ? `，${failed} 张失败：${lastError}` : ''}`);
}
function chooseDuplicate(filename, matches) {
  const existing = matches?.[0];
  if (!existing) return Promise.resolve('keep');
  $('#duplicateDescription').textContent = `“${filename}”与图库中已有图片${existing.kind === 'exact' ? '完全相同' : '画面相近'}。`;
  $('#duplicateExisting').src = previewUrl(existing.id);
  $('#duplicateName').textContent = existing.name;
  $('#duplicateKind').textContent = existing.kind === 'exact' ? '相同文件' : '相似画面';
  $('#duplicateModal').hidden = false;
  refreshIcons();
  return new Promise(resolve => {
    const modal = $('#duplicateModal');
    const choose = event => {
      const action = event.target.closest('[data-duplicate]')?.dataset.duplicate;
      if (!action) return;
      modal.removeEventListener('click', choose);
      modal.hidden = true;
      resolve(action);
    };
    modal.addEventListener('click', choose);
  });
}
function chooseImportFiles() {
  $('#sidebar').classList.remove('open');
  $('#importFileInput').click();
}
$('#importImages').onclick = chooseImportFiles;
$('#toolbarImport').onclick = chooseImportFiles;
$('#importFolder').onclick = () => { $('#sidebar').classList.remove('open'); $('#importFolderInput').click(); };
$('#importFileInput').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) void uploadFiles(files);
};
$('#importFolderInput').onchange = event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) void uploadFiles(files);
};
function viewerItems() { return visibleImages(); }
function openViewer(id) { state.selectedId = id; const image = [...state.images, ...state.trash].find(item => item.id === id); if (!image) return; if (!isVideo(image) && image.hasPreview === false) return toast('此文件没有可用的内嵌预览，请在默认应用中打开'); $('#viewer').hidden = false; updateViewer(); }
function updateViewer() { const items = viewerItems(); const index = items.findIndex(item => item.id === state.selectedId); const image = items[index]; if (!image) return closeModal('viewer'); const video = $('#viewerVideo'); video.pause(); video.hidden = !isVideo(image); $('#viewerImage').hidden = isVideo(image); if (isVideo(image)) { $('#viewerImage').removeAttribute('src'); video.onerror = () => { $('#videoPlaybackHint').hidden = false; }; video.src = '/media/' + image.id; video.load(); video.play().catch(error => { if (error.name === 'NotSupportedError') $('#videoPlaybackHint').hidden = false; }); $('#videoPlaybackHint').hidden = true; } else { video.removeAttribute('src'); video.load(); $('#videoPlaybackHint').hidden = true; $('#viewerImage').src = previewUrl(image.id); } $('#viewerImage').alt = image.name; $('#viewerName').textContent = image.name; $('#viewerCount').textContent = `${index + 1} / ${items.length}`; $('#viewerPrev').disabled = index <= 0; $('#viewerNext').disabled = index >= items.length - 1; }
function stepViewer(direction) { const items = viewerItems(); const index = items.findIndex(item => item.id === state.selectedId); if (items[index + direction]) { state.selectedId = items[index + direction].id; updateViewer(); renderGallery(); renderInspector(); } }
function downloadImage(image) { const link = document.createElement('a'); link.href = imgUrl(image.id); link.download = image.originalName || `${image.name}${image.ext}`; document.body.append(link); link.click(); link.remove(); }
function setView(view) { state.view = view; state.selectedId = null; state.selectedIds = []; $('#sidebar').classList.remove('open'); render(); }

document.addEventListener('click', async event => {
  if (event.button !== 0) return;
  const playVideo = event.target.closest('[data-play-video]'); if (playVideo) { event.stopPropagation(); openViewer(playVideo.dataset.playVideo); return; }
  const view = event.target.closest('[data-view]'); if (view) return setView(view.dataset.view);
  const folderExpand = event.target.closest('[data-folder-expand]');
  if (folderExpand) { event.stopPropagation(); const id = folderExpand.dataset.folderExpand; if (state.collapsedFolders.has(id)) state.collapsedFolders.delete(id); else state.collapsedFolders.add(id); renderSidebar(); return; }
  const folderColor = event.target.closest('[data-folder-color]');
  if (folderColor) { event.stopPropagation(); const folder = state.folders.find(item => item.id === folderColor.dataset.folderColor); if (folder) { openFolderModal(folder); $('#folderColorEnabled').checked = true; $('#folderColor').focus(); } return; }
  const folderView = event.target.closest('[data-folder-view]'); if (folderView && !event.target.closest('[data-folder-menu]')) return setView(`folder:${folderView.dataset.folderView}`);
  const expandTag = event.target.closest('[data-tag-expand]'); if (expandTag) { event.stopPropagation(); const key = expandTag.dataset.tagExpand; if (state.collapsedTags.has(key)) state.collapsedTags.delete(key); else state.collapsedTags.add(key); renderSidebar(); return; }
  const editTag = event.target.closest('[data-edit-tag]'); if (editTag) { event.stopPropagation(); openTagModal(state.tags.find(tag => tag.key === editTag.dataset.editTag)); return; }
  const deleteTag = event.target.closest('[data-delete-tag]'); if (deleteTag) { event.stopPropagation(); const key = deleteTag.dataset.deleteTag; if (!confirm(`删除标签「${key}」及其子标签？`)) return; try { await api(`/api/tags/${encodeURIComponent(key)}`, { method: 'DELETE' }); const data = await api('/api/state'); state.tags = data.tags; state.images = data.images; if (state.view === `tag:${key}`) state.view = 'all'; render(); } catch (error) { toast(error.message); } return; }
  const tagView = event.target.closest('[data-tag-view]'); if (tagView) return setView(`tag:${tagView.dataset.tagView}`);
  const folderMenu = event.target.closest('[data-folder-menu]');
  if (folderMenu) { showFolderMenu(folderMenu.dataset.folderMenu, event); return; }
  const favorite = event.target.closest('[data-favorite]'); if (favorite) { event.stopPropagation(); return toggleFavorite(favorite.dataset.favorite); }
  const card = event.target.closest('.image-card');
  if (card) {
    if (event.shiftKey && state.selectedId) {
      const ids = visibleImages().map(image => image.id);
      const start = ids.indexOf(state.selectedId), end = ids.indexOf(card.dataset.id);
      if (start >= 0 && end >= 0) {
        state.selectedIds = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
        state.selectedId = card.dataset.id;
        document.querySelectorAll('.image-card').forEach(item => item.classList.toggle('selected', state.selectedIds.includes(item.dataset.id)));
        renderInspector();
        $('.app').classList.remove('details-collapsed');
        $('#inspector').classList.add('open');
        return;
      }
    }
    return selectImage(card.dataset.id, event.ctrlKey || event.metaKey);
  }
  const close = event.target.closest('[data-close]'); if (close) return closeModal(close.dataset.close);
  const removeTag = event.target.closest('[data-remove-tag]'); if (removeTag) { const image = state.images.find(item => item.id === state.selectedId); if (image) return patchImage(image.id, { tags: image.tags.filter(tag => tag !== removeTag.dataset.removeTag) }); }
});
$('#gallery').addEventListener('dblclick', async event => { const card = event.target.closest('.image-card'); if (!card || event.target.closest('button,.drag-out')) return; if (!window.journalDesktop || state.view === 'trash') return openViewer(card.dataset.id); try { await api(`/api/images/${card.dataset.id}/open`, { method: 'POST' }); } catch (error) { toast(error.message); } });
$('#newFolder').onclick = () => openFolderModal();
function openTagModal(tag = null) { state.tagEditing = tag?.key || null; $('#tagDialogTitle').textContent = tag ? '编辑标签' : '新建标签'; $('#tagName').value = tag?.name || ''; $('#tagColor').value = tag?.color || '#506a51'; $('#tagModal').hidden = false; $('#tagName').focus(); }
$('#newTag').onclick = () => openTagModal();
$('#saveTag').onclick = async () => { try { const body = { name: $('#tagName').value.trim(), color: $('#tagColor').value }; const route = state.tagEditing ? `/api/tags/${encodeURIComponent(state.tagEditing)}` : '/api/tags'; const result = await api(route, { method: state.tagEditing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (state.tagEditing) { state.tags = result.tags; state.images = result.images; } else state.tags.push(result); closeModal('tagModal'); render(); toast('标签已保存'); } catch (error) { toast(error.message); } };
$('#saveFolder').onclick = saveFolder;
$('#folderColor').oninput = () => { $('#folderColorEnabled').checked = true; };
$('#folderName').onkeydown = event => { if (event.key === 'Enter') saveFolder(); };
document.addEventListener('library-search', event => { state.query = event.detail.query; renderGallery(); });
$('#sortSelect').onchange = event => { state.sort = event.target.value; renderGallery(); };
$('#sizeSlider').oninput = event => { $('#gallery').style.setProperty('--column-width', `${event.target.value}px`); $('#galleryZoomValue').textContent = Math.round(event.target.value / 220 * 100) + '%'; localStorage.setItem('journal-gallery-size', event.target.value); };
$('#sizeSlider').value = Math.max(160, Math.min(320, Number(localStorage.getItem('journal-gallery-size')) || 220)); $('#sizeSlider').oninput({ target: $('#sizeSlider') });
$('#toggleInspector').onclick = () => { $('.app').classList.toggle('details-collapsed'); $('#inspector').classList.toggle('open', !$('.app').classList.contains('details-collapsed')); };
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
$('#exportBtn').onclick = () => { location.href = '/api/export'; toast('已导出图库目录'); };
$('#inspector').addEventListener('change', event => { const id = state.selectedId; if (!id) return; if (event.target.id === 'detailName') patchImage(id, { name: event.target.value }); if (event.target.id === 'detailFolder') patchImage(id, { folderId: event.target.value || null }); if (event.target.id === 'detailNote') patchImage(id, { note: event.target.value }); });
$('#inspector').addEventListener('change', async event => { if (event.target.id === 'batchFolder' && event.target.value) { for (const id of state.selectedIds) await patchImage(id, { folderId: event.target.value }, false); render(); toast('已批量移动'); } });
$('#inspector').addEventListener('focusout', event => { if (event.target.id === 'detailNote' || event.target.id === 'detailName') event.target.dispatchEvent(new Event('change', { bubbles: true })); });
$('#inspector').addEventListener('keydown', async event => { if (['tagInput', 'batchTag'].includes(event.target.id) && event.key === 'Enter') { event.preventDefault(); const tag = event.target.value.trim(); if (!tag) return; const ids = event.target.id === 'batchTag' ? state.selectedIds : [state.selectedId]; for (const id of ids) { const image = state.images.find(item => item.id === id); if (image && !image.tags.includes(tag)) await patchImage(id, { tags: [...image.tags, tag] }, false); } render(); } });
$('#inspector').addEventListener('click', async event => { const image = [...state.images, ...state.trash].find(item => item.id === state.selectedId); if (!image) return; if (event.target.closest('#detailFavorite')) return toggleFavorite(image.id); if (event.target.closest('#detailOpen')) return openViewer(image.id); if (event.target.closest('#detailDownload')) return downloadImage(image); try { if (event.target.closest('#detailDelete')) { await api(`/api/images/${image.id}`, { method: 'DELETE' }); state.images = state.images.filter(item => item.id !== image.id); state.trash.unshift({ ...image, deletedAt: Date.now() }); state.selectedId = null; state.selectedIds = []; render(); toast('已移至回收站'); } if (event.target.closest('#detailRestore')) { await api(`/api/trash/${image.id}/restore`, { method: 'POST' }); state.trash = state.trash.filter(item => item.id !== image.id); state.images.unshift(image); state.selectedId = null; state.selectedIds = []; render(); toast('图片已恢复'); } if (event.target.closest('#detailPermanentDelete') && confirm(`彻底删除「${image.name}」？此操作无法撤销。`)) { await api(`/api/trash/${image.id}/delete`, { method: 'POST' }); state.trash = state.trash.filter(item => item.id !== image.id); state.selectedId = null; state.selectedIds = []; render(); toast('图片已彻底删除'); } } catch (error) { toast(error.message); } });
$('#videoOpenExternal').onclick = async () => { const image = [...state.images, ...state.trash].find(item => item.id === state.selectedId); if (!image) return; if (!window.journalDesktop || state.view === 'trash') return downloadImage(image); try { await api(`/api/images/${image.id}/open`, { method:'POST' }); } catch (error) { toast(error.message); } };
$('#viewerClose').onclick = () => closeModal('viewer');
$('#viewerPrev').onclick = () => stepViewer(-1);
$('#viewerNext').onclick = () => stepViewer(1);
$('#viewerDownload').onclick = () => { const image = state.images.find(item => item.id === state.selectedId); if (image) downloadImage(image); };
$('#viewer').onclick = event => { if (event.target === $('#viewer') || event.target === $('.viewer')) closeModal('viewer'); };
$('#folderModal').onclick = event => { if (event.target === $('#folderModal')) closeModal('folderModal'); };
$('#tagModal').onclick = event => { if (event.target === $('#tagModal')) closeModal('tagModal'); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeModal('viewer'); closeModal('folderModal'); closeModal('tagModal'); closeModal('settingsModal'); $('#contextMenu').hidden = true; $('#inspector').classList.remove('open'); $('#sidebar').classList.remove('open'); return; }
  if (!$('#viewer').hidden) { if (event.key === 'ArrowLeft') stepViewer(-1); if (event.key === 'ArrowRight') stepViewer(1); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'Enter' && state.selectedId) openViewer(state.selectedId);
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) {
    if (state.view === 'trash') (state.selectedIds.length > 1 ? $('#batchPermanentDelete') : $('#detailPermanentDelete'))?.click();
    else (state.selectedIds.length > 1 ? $('#batchDelete') : $('#detailDelete'))?.click();
  }
});
let dragResetTimer;
function clearFileDrag() { clearTimeout(dragResetTimer); $('#dropOverlay').classList.remove('visible'); }
function showFileDrag(event) {
  if ([...(event.dataTransfer?.types || [])].some(type => type.startsWith('application/x-journal-'))) return;
  if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
  event.preventDefault();
  $('#dropOverlay').classList.add('visible');
  clearTimeout(dragResetTimer);
  dragResetTimer = setTimeout(clearFileDrag, 1500);
}
window.addEventListener('dragenter', showFileDrag);
window.addEventListener('dragover', showFileDrag);
window.addEventListener('dragleave', event => {
  if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) clearFileDrag();
});
window.addEventListener('dragend', clearFileDrag);
window.addEventListener('blur', clearFileDrag);
async function droppedFiles(transfer) {
  const entries = [...(transfer.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...transfer.files].map(file => ({ file }));
  const found = [];
  async function walk(entry, parents = []) {
    if (entry.isFile) { const file = await new Promise((resolve, reject) => entry.file(resolve, reject)); found.push({ file, relativePath: [...parents, file.name].join('/') }); return; }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    while (true) { const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; for (const child of batch) await walk(child, [...parents, entry.name]); }
  }
  for (const entry of entries) await walk(entry);
  return found;
}
window.addEventListener('drop', clearFileDrag, true);
window.addEventListener('drop', async event => { event.preventDefault(); if ([...(event.dataTransfer?.types || [])].some(type => type.startsWith('application/x-journal-'))) return; if (event.target.closest('#pinterestPanel')) return; if ([...(event.dataTransfer?.types || [])].includes('Files')) { const destination = event.target.closest('[data-view]')?.dataset.view; if (destination === 'trash') return toast('请将图库中的图片拖入回收站'); try { await uploadFiles(await droppedFiles(event.dataTransfer), destination === 'favorites' ? 'favorites' : state.view); } catch (error) { toast(error.message); } } });

api('/api/state').then(data => { state.folders = data.folders || []; state.tags = data.tags || []; state.trash = data.trash || []; state.icons = data.icons || {}; state.images = data.images || []; state.imageOrder = data.imageOrder || state.images.map(image => image.id); render(); }).catch(error => { toast(`无法读取图库：${error.message}`); document.dispatchEvent(new CustomEvent('library-load-error')); });
refreshIcons();
