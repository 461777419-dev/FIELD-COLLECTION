// 底部多网站搜索面板。网站名称、能力与地址统一在 search-providers.json 中维护。
(() => {
  let providers = [];
  let providerId = localStorage.getItem('journal-search-provider') || 'pinterest';
  let source = null;
  let busy = false;
  let lastJob = null;
  let previewUrl = '';
  let imageProviderId = null;
  const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  const ready = api('/search-providers.json').then(items => {
    providers = items;
    if (!providers.some(item => item.id === providerId)) providerId = 'pinterest';
    drawProvider();
    showMessage('拖入图片进行图搜图', '也可以在右侧输入关键词，搜索当前网站的图片。');
  });
  const header = document.querySelector('.pinterest-header');
  header.querySelector('strong').innerHTML = `${icon('scan-search')}图片搜索`;
  header.querySelector('strong').insertAdjacentHTML('afterend', `<div class="image-search-site"><button type="button" class="image-search-current" id="imageSearchCurrent" aria-haspopup="listbox" aria-expanded="false" title="切换搜索网站"><span>选择网站</span>${icon('chevron-down', 13)}</button></div><form class="image-search-form" id="imageSearchForm"><input id="imageSearchQuery" type="search" autocomplete="off" maxlength="200" aria-label="网站图片搜索关键词" placeholder="输入关键词搜索图片"><button class="image-search-submit" type="submit" title="搜索" aria-label="搜索当前网站">${icon('search')}</button></form>`);
  header.insertAdjacentHTML('beforeend', '<label class="web-zoom" title="缩放页内网页及搜索结果；独立窗口不受影响">缩放<input id="webZoom" type="range" min="50" max="150" step="10" value="100" aria-label="网页缩放"><output id="webZoomValue">100%</output></label>');
  function applyWebZoom() {
    const value = Number($('#webZoom').value);
    $('#webZoomValue').textContent = value + '%';
    localStorage.setItem('journal-web-zoom', value);
    const frame = $('#imageSearchEmbedded iframe');
    if (frame) { frame.style.zoom = value / 100; frame.style.width = (10000 / value) + '%'; }
    $('#pinterestResults').style.zoom = value / 100;
  }
  $('#webZoom').value = Math.max(50, Math.min(150, Number(localStorage.getItem('journal-web-zoom')) || 100));
  $('#webZoom').oninput = applyWebZoom;
  applyWebZoom();
  document.body.insertAdjacentHTML('beforeend', '<div class="image-search-site-menu" id="imageSearchSites" role="listbox" aria-label="搜索网站" hidden></div>');
  $('#pinterestChoose').title = '选择图片进行图搜图';
  $('#pinterestChoose').setAttribute('aria-label', '选择图片进行图搜图');
  $('#pinterestResizer').title = '拖动调整图片搜索区域高度';
  $('#pinterestResizer').setAttribute('aria-label', '调整图片搜索区域高度');
  setPinterestOpen(!$('#pinterestPanel').classList.contains('collapsed'));
  const current = () => providers.find(item => item.id === providerId);
  function drawProvider() {
    const provider = current();
    if (!provider) return;
    const logo = `<img src="/assets/search-sites/${provider.id}.png" alt="">`;
    $('#imageSearchCurrent').innerHTML = `${logo}<span>${esc(provider.name)}</span>${icon('chevron-down', 13)}`;
    $('#imageSearchSites').innerHTML = providers.map(item => `<button class="image-search-site-option" type="button" role="option" aria-selected="${item.id === providerId}" data-search-provider="${item.id}"><img src="/assets/search-sites/${item.id}.png" alt=""><span>${esc(item.name)}<small>${item.image && item.keyword ? '图搜图 · 关键词' : item.image ? '图搜图' : '关键词搜索'} · ${item.embedded ? '页内显示' : '独立窗口'}</small></span></button>`).join('');
    $('#imageSearchQuery').disabled = !provider.keyword;
    $('#imageSearchQuery').placeholder = provider.keyword ? `在 ${provider.name} 搜索图片` : '此网站支持图搜图，请拖入图片';
    $('#imageSearchForm button').disabled = !provider.keyword;
    $('#pinterestChoose').disabled = !provider.image;
    $('#pinterestChoose').title = provider.image ? `选择图片在 ${provider.name} 图搜图` : `${provider.name} 请使用关键词搜索`;
    refreshIcons();
  }
  function closeSites() { $('#imageSearchSites').hidden = true; $('#imageSearchCurrent').setAttribute('aria-expanded', 'false'); }
  $('#imageSearchCurrent').onclick = () => {
    const menu = $('#imageSearchSites');
    if (!menu.hidden) return closeSites();
    const rect = $('#imageSearchCurrent').getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 442))}px`;
    menu.style.bottom = `${Math.max(8, innerHeight - rect.top + 5)}px`;
    menu.hidden = false;
    $('#imageSearchCurrent').setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-selected=true]')?.focus();
  };
  $('#imageSearchSites').onclick = event => {
    const option = event.target.closest('[data-search-provider]');
    if (!option) return;
    if (busy) return toast('请等待当前图片准备完成后再切换网站');
    providerId = option.dataset.searchProvider;
    localStorage.setItem('journal-search-provider', providerId);
    pinterestRequest++;
    $('#pinterestMore').hidden = true;
    $('#pinterestResults').replaceChildren();
    clearEmbeddedPage();
    $('#pinterestSearchInfo').textContent = '';
    closeSites(); drawProvider();
    showMessage(current().image ? '拖入图片进行图搜图' : '输入关键词搜索图片', current().embedded ? `${current().name} 的结果优先在下方显示。` : `${current().name} 暂不支持稳定内嵌，可按需打开独立窗口。`);
    lastJob = null;
    if (source && current().image) {
      $('#pinterestFallback .image-search-intro').insertAdjacentHTML('beforeend', '<div class="image-search-actions"><button id="imageSearchReuse" type="button">使用当前图片搜索</button></div>');
      $('#imageSearchReuse').onclick = async () => {
        lastJob = { providerId, image:source };
        try { await displayJob(lastJob); }
        catch (error) { showMessage('搜索未能完成', error.message, current().id !== 'pinterest'); }
      };
    }
    $('#imageSearchCurrent').focus();
  };
  document.addEventListener('click', event => { if (!event.target.closest('.image-search-site, #imageSearchSites')) closeSites(); });
  document.addEventListener('keydown', event => {
    if ($('#imageSearchSites').hidden) return;
    if (event.key === 'Escape') { event.stopImmediatePropagation(); closeSites(); $('#imageSearchCurrent').focus(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const options = [...$('#imageSearchSites').querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length]?.focus();
    }
  }, true);
  function showMessage(title, message, retry = false) {
    clearEmbeddedPage();
    $('#pinterestFallback').hidden = false;
    $('#pinterestFallback').innerHTML = `<div class="image-search-intro">${previewUrl ? `<img class="image-search-preview" src="${previewUrl}" alt="检索图片">` : icon('image-plus', 30)}<strong>${esc(title)}</strong><p>${esc(message)}</p>${retry ? '<div class="image-search-actions"><button id="imageSearchRetry" type="button">打开搜索窗口</button></div>' : ''}</div>`;
    if (retry) $('#imageSearchRetry').onclick = () => openJob(lastJob).catch(error => showMessage('搜索窗口未能打开', error.message, true));
    refreshIcons();
  }
  function clearEmbeddedPage() {
    $('#imageSearchEmbedded')?.remove();
    $('#pinterestContent').classList.remove('has-embedded-search');
  }
  function showEmbeddedPage(job, provider) {
    clearEmbeddedPage();
    $('#pinterestResults').replaceChildren();
    $('#pinterestFallback').hidden = true;
    $('#pinterestMore').hidden = true;
    $('#pinterestSearchInfo').textContent = '';
    const container = document.createElement('div'); container.id = 'imageSearchEmbedded';
    container.innerHTML = `<div class="image-search-embedded-toolbar"><span>${esc(provider.name)} · 官网页内显示（空白或登录受限时请用独立窗口）</span><button id="imageSearchExternal" type="button">独立窗口打开</button></div>`;
    const frame = document.createElement('iframe');
    frame.name = `image-search-${crypto.randomUUID()}`;
    frame.title = `${provider.name} 图片搜索结果`;
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    frame.src = job.image ? provider.home : provider.keyword.replace('{query}', encodeURIComponent(job.query || ''));
    if (job.image && provider.id === 'saucenao') frame.src = 'about:blank';
    container.append(frame);
    $('#pinterestContent').append(container);
    applyWebZoom();
    $('#pinterestContent').classList.add('has-embedded-search');
    $('#imageSearchExternal').onclick = () => openJob(job).catch(error => toast(error.message));
    if (job.image && provider.id === 'saucenao') {
      const form = document.createElement('form'); form.method = 'POST'; form.action = 'https://saucenao.com/search.php'; form.enctype = 'multipart/form-data'; form.target = frame.name; form.hidden = true;
      const input = document.createElement('input'); input.type = 'file'; input.name = 'file';
      const transfer = new DataTransfer(); transfer.items.add(preparedFile(job.image)); input.files = transfer.files;
      form.append(input); container.append(form); form.submit();
    } else if (job.image) {
      container.querySelector('.image-search-embedded-toolbar span').textContent = `${provider.name} · 请在下方官网上传检索图片`;
      const download = document.createElement('a'); download.href = `data:image/jpeg;base64,${job.image.data}`; download.download = 'search-image.jpg'; download.textContent = '保存检索图片';
      container.querySelector('.image-search-embedded-toolbar').append(download);
    }
  }
  function preparedFile(image) {
    return new File([Uint8Array.from(atob(image.data), char => char.charCodeAt(0))], 'search-image.jpg', { type:'image/jpeg' });
  }
  async function searchPinterestEmbedded(image) {
    clearEmbeddedPage();
    const requestId = ++pinterestRequest;
    pinterestImages = []; pinterestBookmark = '';
    $('#pinterestResults').replaceChildren();
    showMessage('正在搜索 Pinterest…', '恢复原有识图搜索，结果将直接显示在这里。');
    const result = await api('/api/pinterest/image-search', { method:'POST', headers:{'Content-Type':'image/jpeg'}, body:preparedFile(image) });
    if (requestId !== pinterestRequest) return;
    pinterestQuery = result.query; pinterestMode = 'keyword';
    pinterestImages = result.images; pinterestBookmark = result.bookmark || '';
    $('#pinterestSearchInfo').textContent = `识图关键词：${result.query}`;
    $('#imageSearchQuery').value = result.query;
    $('#pinterestFallback').textContent = result.images.length ? '' : '没有找到相关图片';
    renderPinterestResults();
  }
  async function displayJob(job) {
    const provider = providers.find(item => item.id === job.providerId);
    if (provider.id === 'pinterest' && job.image) return searchPinterestEmbedded(job.image);
    if (provider.embedded === 'page') return showEmbeddedPage(job, provider);
    showMessage('此网站暂不支持稳定内嵌', `${provider.name} 的搜索页面存在内嵌限制或加载兼容问题。你可以手动打开独立窗口，或切换 Pinterest 等支持页内显示的网站。`, true);
  }
  async function openJob(job) {
    if (!job) return;
    const provider = providers.find(item => item.id === job.providerId);
    if (invoke) {
      await invoke('open_search_window', { providerId: job.providerId, query: job.query || '', imageData: job.image?.data || null });
    } else {
      if (job.image) {
        const key = crypto.randomUUID();
        sessionStorage.setItem(`journal-search-job:${key}`, JSON.stringify(job));
        const popup = window.open(`/image-search-window.html#${key}`, '_blank', 'popup,width=1100,height=800');
        if (!popup) { sessionStorage.removeItem(`journal-search-job:${key}`); throw new Error('窗口被浏览器拦截，请点击下方按钮重试。'); }
      } else {
        const popup = window.open(provider.keyword.replace('{query}', encodeURIComponent(job.query || '')), '_blank', 'popup,width=1100,height=800');
        if (!popup) throw new Error('窗口被浏览器拦截，请点击下方按钮重试。');
      }
    }
    showMessage('搜索窗口已打开', `${provider.name} 的结果在独立窗口中查看。需要登录或验证时，请在该窗口完成。`, true);
  }
  $('#imageSearchForm').onsubmit = async event => {
    event.preventDefault();
    await ready;
    const query = $('#imageSearchQuery').value.trim();
    if (!query) return $('#imageSearchQuery').focus();
    const provider = current();
    if (!provider.keyword) return;
    setPinterestOpen(true);
    if (provider.id === 'pinterest') { clearEmbeddedPage(); return searchPinterestResults(query); }
    lastJob = { providerId, query };
    try { await displayJob(lastJob); }
    catch (error) { showMessage('搜索窗口未能打开', error.message, true); }
  };
  window.imageSearch = {
    async searchImage(value) {
      await ready;
      if (busy) return toast('请等待当前图片准备完成');
      setPinterestOpen(true);
      if (!current().image) return showMessage('此网站请使用关键词搜索', `右侧输入关键词搜索 ${current().name}；拖图检索可切换 Pinterest、Google Images、TinEye、Yandex Images、SauceNAO 或 Lenso.ai。`);
      busy = true;
      imageProviderId = providerId;
      pinterestRequest++;
      $('#pinterestMore').hidden = true;
      $('#pinterestResults').replaceChildren();
      $('#pinterestSearchInfo').textContent = '';
      showMessage('正在准备图片…', `即将在 ${current().name} 进行图搜图。`);
      try {
        const options = value.imageId ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value) } : { method:'POST', headers:{'Content-Type':value.type || 'application/octet-stream'}, body:value };
        source = await api('/api/image-search/prepare', options);
        previewUrl = `data:image/jpeg;base64,${source.data}`;
        lastJob = { providerId:imageProviderId, image:source };
        await displayJob(lastJob);
      } catch (error) { showMessage('未能开始图搜图', error.message, current().id !== 'pinterest' && !!lastJob); }
      finally { busy = false; drawProvider(); }
    }
  };
  refreshIcons();
})();
