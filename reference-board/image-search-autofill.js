// 此脚本仅注入独立官网窗口；不会获得图库命令权限。
window.__journalFillSearchImage = async function (job) {
  if (!job.data || !job.provider.hosts?.includes(location.hostname)) return;
  const landing = new URL(job.provider.home);
  if (location.pathname.replace(/\/$/, '') !== landing.pathname.replace(/\/$/, '')) return;
  const startedKey = `journal-image-search:${job.id}`;
  if (sessionStorage.getItem(startedKey)) return;
  const file = new File([Uint8Array.from(atob(job.data), char => char.charCodeAt(0))], 'search-image.jpg', { type:'image/jpeg' });
  function notice(message) {
    const render = () => {
      if (!document.body) return;
      let banner = document.getElementById('journal-search-notice');
      if (!banner) { banner = document.createElement('div'); banner.id = 'journal-search-notice'; banner.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:420px;padding:12px 16px;background:#fff9ec;color:#3d5141;border:1px solid #b5a080;font:13px/1.6 system-ui;box-shadow:0 3px 18px #0002'; document.body.append(banner); }
      banner.textContent = message;
      banner.onclick = () => banner.remove();
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once:true });
  }
  notice('正在准备图搜图。如网站要求登录、验证或确认，请在此窗口完成。');
  if (job.provider.id === 'yandex') {
    try {
      const form = new FormData(); form.append('upfile', file);
      const request = encodeURIComponent(JSON.stringify({ blocks:[{ block:'cbir-uploader__get-cbir-id' }] }));
      const response = await fetch(`/images/touch/search?rpt=imageview&format=json&request=${request}`, { method:'POST', headers:{ 'X-Requested-With':'XMLHttpRequest' }, body:form });
      const result = await response.json();
      const params = result.blocks?.[0]?.params;
      if (!response.ok || !params?.cbirId) throw new Error('官网要求验证或上传接口暂不可用');
      sessionStorage.setItem(startedKey, '1');
      location.assign(`/images/search?rpt=imageview&cbir_id=${encodeURIComponent(params.cbirId)}&url=${encodeURIComponent(params.originalImageUrl || '')}`);
      return;
    } catch { notice('Yandex 暂未完成上传。请完成官网验证后刷新，或使用官网上传按钮。'); }
  }
  let triggered = false;
  const begin = Date.now();
  const timer = setInterval(() => {
    const input = document.querySelector(job.provider.input || 'input[type=file]');
    if (input) {
      clearInterval(timer);
      try {
        const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
        if (job.provider.id === 'saucenao') { const auto = document.querySelector('#auto-cb'); if (auto) auto.checked = true; }
        sessionStorage.setItem(startedKey, '1');
        input.dispatchEvent(new Event('input', { bubbles:true }));
        input.dispatchEvent(new Event('change', { bubbles:true }));
        notice('检索图片已填入官网。若显示上传或确认按钮，请按网站提示继续。');
      } catch { notice('此页面暂无法自动填图，请使用官网上传按钮。'); }
    } else if (!triggered && job.provider.trigger) {
      const trigger = document.querySelector(job.provider.trigger);
      if (trigger) { triggered = true; trigger.click(); }
    }
    if (Date.now() - begin > 45000) { clearInterval(timer); notice('未找到可用上传入口。请完成登录或验证，再刷新此窗口重试。'); }
  }, 500);
};
