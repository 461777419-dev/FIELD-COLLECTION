const BASE = 'https://www.pinterest.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

function pinimgUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'i.pinimg.com' ? url.href : null;
  } catch { return null; }
}

function extractImages(payload) {
  const images = [];
  const seen = new Set();
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const original = pinimgUrl(value.images?.orig?.url);
    if (original && !seen.has(original)) {
      seen.add(original);
      images.push({
        original,
        preview: pinimgUrl(value.images?.['236x']?.url) || original,
        width: Number(value.images.orig.width) || null,
        height: Number(value.images.orig.height) || null,
        pinId: /^\d+$/.test(String(value.id)) ? String(value.id) : null
      });
    }
    Object.values(value).forEach(walk);
  }
  walk(payload);
  return images;
}

async function searchPinterest(query, bookmark = '', request = fetch) {
  const term = String(query || '').trim().slice(0, 120);
  if (!term) throw new Error('请输入搜索关键词');
  if (bookmark && (typeof bookmark !== 'string' || bookmark.length > 10000)) throw new Error('翻页标记无效');
  const source = `/search/pins/?q=${encodeURIComponent(term)}&rs=typed`;
  const options = { query: term, scope: 'pins', page_size: '30', rs: 'typed', redux_normalize_feed: true, auto_correction_disabled: false };
  if (bookmark) options.bookmarks = [bookmark];
  const params = new URLSearchParams({ source_url: source, data: JSON.stringify({ options, context: {} }), _: String(Date.now()) });
  const response = await request(`${BASE}/resource/BaseSearchResource/get/?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'X-Pinterest-Source-Url': source, 'x-pinterest-pws-handler': 'www/search/[scope].js' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Pinterest 搜索暂不可用 (HTTP ${response.status})`);
  const payload = await response.json();
  const resource = payload.resource_response;
  if (!resource || !Array.isArray(resource.data?.results)) throw new Error('Pinterest 搜索结果格式已变化');
  const next = Array.isArray(resource.bookmark) ? resource.bookmark[0] : resource.bookmark;
  return { images: extractImages(resource.data.results), bookmark: typeof next === 'string' ? next : '' };
}

function pinId(value) {
  const text = String(value || '').trim();
  if (/^\d{8,25}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (!['www.pinterest.com', 'pinterest.com'].includes(url.hostname)) return null;
    return url.pathname.match(/^\/pin\/(\d{8,25})\/?$/)?.[1] || null;
  } catch { return null; }
}

async function relatedPinterest(value, cookie, bookmark = '', request = fetch) {
  const id = pinId(value);
  if (!id) throw new Error('请输入有效的 Pinterest Pin 链接');
  if (!cookie || typeof cookie !== 'string') throw new Error('官网相似推荐需要 Pinterest 登录 Cookie，请在设置中填写');
  if (cookie.length > 16000 || /[\r\n]/.test(cookie)) throw new Error('Cookie 格式无效');
  if (bookmark && (typeof bookmark !== 'string' || bookmark.length > 10000)) throw new Error('翻页标记无效');
  const source = `/pin/${id}/`;
  const options = { pin_id: id, context_pin_ids: [id], page_size: '30', bookmarks: bookmark ? [bookmark] : [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking', top_level_source_depth: 1, is_pdp: true };
  const params = new URLSearchParams({ source_url: source, data: JSON.stringify({ options, context: {} }), _: String(Date.now()) });
  const response = await request(`${BASE}/resource/RelatedModulesResource/get/?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'X-Pinterest-Source-Url': source, 'x-pinterest-pws-handler': 'www/pin/[id].js', Cookie: cookie },
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 412 || response.status === 401 || response.status === 403) throw new Error('Pinterest 登录态无效或已过期，请更新 Cookie');
  if (!response.ok) throw new Error(`Pinterest 相似推荐暂不可用 (HTTP ${response.status})`);
  const payload = await response.json();
  const resource = payload.resource_response;
  if (!resource || !Array.isArray(resource.data)) throw new Error('Pinterest 相似推荐结果格式已变化');
  const next = Array.isArray(resource.bookmark) ? resource.bookmark[0] : resource.bookmark;
  return { images: extractImages(resource.data), bookmark: typeof next === 'string' ? next : '' };
}

module.exports = { searchPinterest, relatedPinterest, pinId, extractImages };
