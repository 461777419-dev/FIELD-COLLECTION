// 独立搜索组件：只发送查询；图库数据与过滤仍由 app.js 负责。
(() => {
  const mount = document.getElementById('searchBarMount');
  if (!mount) return;
  mount.outerHTML = `<div class="search-area library-search-area">
    <div class="search library-search search-box">
      <svg class="water-outline" viewBox="0 0 600 68" preserveAspectRatio="none" aria-hidden="true"><path class="water-fill" d="M24 1H576Q599 1 599 24V46Q581 65 552 55T496 55T440 55T384 55T328 55T272 55T216 55T160 55T104 55T48 55Q1 70 1 45V24Q1 1 24 1Z"/><path class="water-line" d="M14 42Q42 34 70 42T126 42T182 42T238 42T294 42T350 42T406 42T462 42T518 42T586 42"/></svg>
      <i data-lucide="search" class="library-search-icon"></i>
      <input id="searchInput" type="search" role="combobox" aria-label="搜索图片" aria-autocomplete="list" aria-expanded="false" aria-controls="searchSuggestions" placeholder="搜索图片、标签或备注" autocomplete="off">
      <div class="whale-companion" id="whaleCompanion"><span class="whale-reply" id="whaleReply" role="status" aria-live="polite" hidden></span><button id="whale" class="whale" type="button" aria-label="摸摸鲸鱼娘女仆" aria-describedby="whaleHint" title="摸摸鲸鱼娘，陪你找图片"><span class="whale-water" aria-hidden="true"></span><span class="whale-swim"><img src="/assets/whale/maid-sleepy.png" class="whale-body" width="90" height="90" alt="" draggable="false"></span><span class="whale-bubbles" aria-hidden="true"><i></i><i></i><i></i></span></button><span id="whaleHint" class="sr-only">点击时开心弹跳；输入搜索词时认真找图。</span></div>
      <button id="clearSearch" class="search-clear" type="button" aria-label="清除搜索" hidden>×</button><kbd id="searchShortcut">Ctrl K</kbd>
    </div>
    <div id="searchSuggestions" class="search-suggestions" role="listbox" aria-label="搜索建议" hidden></div>
  </div>`;
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('clearSearch');
  const shortcut = document.getElementById('searchShortcut');
  const list = document.getElementById('searchSuggestions');
  let composing = false, active = -1, names = [], lastQuery = '';
  const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  function updateControls() { clear.hidden = !input.value; shortcut.hidden = !!input.value; }
  function publish() {
    updateControls();
    const query = input.value.trim();
    if (query !== lastQuery) { lastQuery = query; document.dispatchEvent(new CustomEvent('library-search', { detail: { query } })); }
  }
  function choose(index) {
    if (!names[index]) return;
    input.value = names[index]; publish(); close(); input.focus();
  }
  function suggestions(detail) {
    lastQuery = detail.query;
    updateControls(); close();
    if (document.activeElement !== input || !input.value.trim()) return;
    const query = input.value.trim().toLocaleLowerCase();
    names = [...new Set(detail.suggestions || [])].filter(name => name.toLocaleLowerCase().includes(query)).slice(0, 6);
    list.replaceChildren();
    for (const [index, name] of names.entries()) {
      const option = document.createElement('button'); option.type = 'button'; option.id = `search-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = name;
      option.onmousedown = event => event.preventDefault(); option.onclick = () => choose(index); list.append(option);
    }
    if (names.length) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
  }
  input.addEventListener('compositionstart', () => { composing = true; close(); });
  input.addEventListener('compositionend', () => { composing = false; publish(); });
  input.addEventListener('input', event => { updateControls(); if (!composing && !event.isComposing) publish(); });
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (list.hidden) return;
    if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(active); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + names.length) % names.length;
      [...list.children].forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', `search-option-${active}`);
    }
  });
  clear.onclick = () => { input.value = ''; publish(); close(); input.focus(); };
  document.addEventListener('library-rendered', event => suggestions(event.detail));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.library-search-area')) close(); });
  input.addEventListener('blur', close);
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); input.select(); } });
})();
