// 按 DOM 中的排序布置瀑布流，不挪动卡片，保留多选、键盘和拖放的原有对象。
(() => {
  const gallery = document.getElementById('gallery');
  let pending = 0;
  function layout() {
    pending = 0;
    const containers = gallery.querySelector('.gallery-group') ? [...gallery.querySelectorAll('.gallery-columns')] : [gallery];
    for (const container of containers) {
      const cards = [...container.children].filter(item => item.classList.contains('image-card'));
      const width = container.clientWidth;
      if (!width) continue;
      const minimum = parseFloat(getComputedStyle(gallery).getPropertyValue('--column-width')) || 250;
      const gap = width < 500 ? 12 : 18;
      const columns = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
      const cardWidth = (width - gap * (columns - 1)) / columns;
      const heights = Array(columns).fill(0);
      for (const card of cards) card.style.width = `${cardWidth}px`;
      for (const card of cards) {
        const column = heights.indexOf(Math.min(...heights));
        card.style.left = `${column * (cardWidth + gap)}px`;
        card.style.top = `${heights[column]}px`;
        heights[column] += card.getBoundingClientRect().height + gap;
      }
      container.style.height = `${Math.max(0, ...heights) - (cards.length ? gap : 0)}px`;
    }
    if (containers[0] !== gallery) gallery.style.height = 'auto';
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(layout); }
  let previousWidth = -1;
  new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width !== previousWidth) { previousWidth = width; schedule(); } }).observe(gallery);
  gallery.addEventListener('load', schedule, true);
  gallery.addEventListener('loadedmetadata', schedule, true);
  gallery.addEventListener('error', schedule, true);
  document.addEventListener('library-rendered', schedule);
  document.getElementById('sizeSlider').addEventListener('input', schedule);
  document.addEventListener('library-load-error', () => {
    const empty = document.getElementById('emptyState'); empty.hidden = false;
    document.getElementById('emptyTitle').textContent = '暂时无法读取图库';
    document.getElementById('emptyText').textContent = '请检查本地服务，再重试。';
    if (!document.getElementById('retryLibrary')) {
      const button = document.createElement('button'); button.id = 'retryLibrary'; button.className = 'action-btn'; button.textContent = '重新读取'; button.onclick = () => location.reload(); empty.append(button);
    }
  });
  schedule();
})();
