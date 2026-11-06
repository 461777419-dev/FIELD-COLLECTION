(async () => {
  const status = document.getElementById('status');
  try {
    const key = `journal-search-job:${location.hash.slice(1)}`;
    let raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (window.opener) {
      const parent = window.opener.sessionStorage.getItem(key);
      window.opener.sessionStorage.removeItem(key);
      if (!raw) raw = parent;
    }
    window.opener = null;
    const job = raw && JSON.parse(raw);
    if (!job) throw new Error('搜索任务已过期，请回到图集重新搜索。');
    const providers = await fetch('/search-providers.json').then(response => response.json());
    const provider = providers.find(item => item.id === job.providerId);
    if (!provider) throw new Error('搜索网站不存在。');
    document.title = `${provider.name} · 图片搜索`;
    document.getElementById('title').textContent = provider.name;
    if (!job.image) {
      if (!provider.keyword) throw new Error('此网站请使用图搜图。');
      location.replace(provider.keyword.replace('{query}', encodeURIComponent(job.query || '')));
      return;
    }
    if (!provider.image) throw new Error('此网站请使用关键词搜索。');
    const file = new File([Uint8Array.from(atob(job.image.data), char => char.charCodeAt(0))], 'search-image.jpg', { type:'image/jpeg' });
    const objectUrl = URL.createObjectURL(file);
    const preview = document.getElementById('preview'); preview.src = objectUrl; preview.hidden = false;
    const download = document.createElement('a'); download.href = objectUrl; download.download = 'search-image.jpg'; download.textContent = '保存检索图片';
    const link = document.createElement('a'); link.href = provider.home; link.textContent = `在此窗口打开 ${provider.name}`; link.rel = 'noreferrer';
    document.getElementById('actions').append(download, link);
    if (['google', 'saucenao'].includes(provider.id)) {
      status.textContent = '正在把图片提交给官网；若官网要求验证，请按页面提示完成。';
      const form = document.createElement('form'); form.method = 'POST'; form.enctype = 'multipart/form-data';
      form.action = provider.id === 'google' ? 'https://lens.google.com/v3/upload?hl=zh-CN' : 'https://saucenao.com/search.php';
      const input = document.createElement('input'); input.type = 'file'; input.name = provider.id === 'google' ? 'encoded_image' : 'file';
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      form.hidden = true; form.append(input); document.body.append(form); form.submit();
    } else {
      status.textContent = '浏览器预览无法跨站自动填入该网站的上传框。请保存检索图片，再打开官网上传；桌面端会尝试在独立窗口自动填图。';
    }
  } catch (error) { status.textContent = error.message || '搜索窗口打开失败，请回到图集重试。'; }
})();
