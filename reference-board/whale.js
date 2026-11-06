'use strict';
(() => {
  const whale = document.getElementById('whale');
  const companion = document.getElementById('whaleCompanion');
  const reply = document.getElementById('whaleReply');
  const search = document.getElementById('searchInput');
  const portrait = whale.querySelector('img');
  const portraits = {idle:'/assets/whale/maid-sleepy.png',typing:'/assets/whale/maid-determined.png',happy:'/assets/whale/maid-delighted.png'};
  Object.values(portraits).forEach(src => { const image = new Image(); image.src = src; });
  let replyTimer, typingTimer, playTimer, query = '', count = 0, turns = 0;
  function say(message) {
    clearTimeout(replyTimer);
    reply.textContent = message;
    reply.hidden = false;
    replyTimer = setTimeout(() => { reply.hidden = true; }, 2600);
  }
  function expression(state) { portrait.src = portraits[state]; }
  whale.addEventListener('pointerenter', () => { if(!whale.classList.contains('playing')) expression('happy'); });
  whale.addEventListener('pointermove', event => {
    const rect = whale.getBoundingClientRect();
    whale.style.setProperty('--look-x', `${((event.clientX-rect.left)/rect.width-.5)*4}px`);
    whale.style.setProperty('--look-y', `${((event.clientY-rect.top)/rect.height-.5)*3}px`);
  });
  whale.addEventListener('pointerleave', () => {
    whale.style.setProperty('--look-x', '0px');whale.style.setProperty('--look-y', '0px');
    if(!whale.classList.contains('playing')) expression(whale.classList.contains('typing')?'typing':'idle');
  });
  // Preserve the search caret on pointer taps; keyboard focus remains available via Tab.
  whale.addEventListener('mousedown', event => event.preventDefault());
  whale.addEventListener('click', () => {
    turns++;
    clearTimeout(playTimer);
    whale.classList.remove('typing');
    expression('happy');
    if (!whale.classList.contains('playing')) whale.classList.add('playing');
    playTimer = setTimeout(() => {whale.classList.remove('playing');expression(whale.classList.contains('typing')?'typing':'idle');}, 800);
    document.dispatchEvent(new CustomEvent('journal-check-updates'));
    say(query ? (count ? `找到 ${count} 张啦，陪你慢慢挑～` : '这里没有，再换个词一起找？') : ['被摸摸啦，精神满满～','鲸鱼娘待命，今天想找什么？',`这里有 ${count} 张图片，慢慢挑～`][((turns-1)%3)]);
  });
  document.addEventListener('library-rendered', event => {
    query = event.detail.query;
    count = event.detail.count;
    if (!reply.hidden) reply.textContent = query ? (count ? `找到 ${count} 张啦，陪你慢慢挑～` : '这里没有，再换个词一起找？') : '图库都回来啦～';
  });
  search.addEventListener('input', () => {
    clearTimeout(typingTimer);
    whale.classList.add('typing');
    if(!whale.classList.contains('playing')) expression('typing');
    typingTimer = setTimeout(() => {whale.classList.remove('typing');if(!whale.classList.contains('playing'))expression('idle');}, 700);
  });
  document.addEventListener('visibilitychange', () => {
    companion.classList.toggle('paused', document.hidden);
  });
})();
