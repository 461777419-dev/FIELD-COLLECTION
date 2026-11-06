const providers = {
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash' },
  anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-4-5' },
  deepseek: { label: 'DeepSeek', model: 'deepseek-flash' },
  custom: { label: '自定义平台', model: '' }
};

const prompt = '请用中文分析这张图片的主体、构图、色彩、光线、风格和关键细节，并反推一段可用于生成相似图片的详细提示词。只返回 JSON 对象，字段为 analysis 和 prompt，值均为字符串。对看不清或不确定的内容明确说明。';

function customEndpoint(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('请求地址必须使用 HTTPS（本机地址可用 HTTP）');
  if (url.username || url.password || url.search || url.hash) throw new Error('请求地址不能包含账号、参数或锚点');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString();
}

function modelsRequestFor(provider, key, address = '') {
  const headers = {};
  let url;
  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
    headers['x-goog-api-key'] = key;
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/models?limit=1000';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    url = provider === 'openai' ? 'https://api.openai.com/v1/models'
      : provider === 'deepseek' ? 'https://api.deepseek.com/models'
      : customEndpoint(address).replace(/\/chat\/completions$/, '/models');
    headers.Authorization = `Bearer ${key}`;
  }
  return { url, options: { headers, redirect: 'error', signal: AbortSignal.timeout(15000) } };
}

function requestFor(provider, model, key, imageBase64, instruction = prompt, address = '') {
  const headers = { 'Content-Type': 'application/json' };
  let url;
  let body;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/responses';
    headers.Authorization = `Bearer ${key}`;
    body = { model, store: false, input: [{ role: 'user', content: [
      { type: 'input_text', text: instruction },
      { type: 'input_image', image_url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' }
    ] }] };
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = key;
    body = { contents: [{ parts: [{ text: instruction }, { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }] }], generationConfig: { responseMimeType: 'application/json' } };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 1800, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: instruction }
    ] }] };
  } else if (provider === 'deepseek' || provider === 'custom') {
    url = provider === 'custom' ? customEndpoint(address) : 'https://api.deepseek.com/chat/completions';
    headers.Authorization = `Bearer ${key}`;
    body = { model, messages: [{ role: 'user', content: [
      { type: 'text', text: instruction },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }
    ] }] };
  } else throw new Error('不支持此 AI 服务');
  return { url, options: { method: 'POST', headers, signal: AbortSignal.timeout(90000), body: JSON.stringify(body) } };
}

function outputText(provider, result) {
  if (provider === 'openai') return result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n') || '';
  if (provider === 'gemini') return result.candidates?.[0]?.content?.parts?.filter(part => typeof part.text === 'string').map(part => part.text).join('\n') || '';
  if (provider === 'deepseek' || provider === 'custom') return result.choices?.[0]?.message?.content || '';
  return result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
}

function parseModelJson(text, fields) {
  const source = String(text || '').trim().replace(/^\uFEFF/, '');
  const valid = value => value && fields.every(field => typeof value[field] === 'string');
  try {
    const value = JSON.parse(source);
    if (valid(value)) return value;
  } catch {}
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"' && depth) quoted = true;
    else if (char === '{') {
      if (!depth) start = i;
      depth++;
    } else if (char === '}' && depth) {
      if (!--depth) {
        try {
          const value = JSON.parse(source.slice(start, i + 1));
          if (valid(value)) return value;
        } catch {}
      }
    }
  }
  throw new Error('AI 返回格式无法解析，请重试');
}

function parseAnalysis(text) { return parseModelJson(text, ['analysis', 'prompt']); }

function parseSearchQuery(text) {
  try { return parseModelJson(text, ['query']).query; } catch {}
  const plain = String(text || '').trim()
    .replace(/^```(?:text)?\s*|\s*```$/g, '')
    .replace(/^query\s*[:：]\s*/i, '')
    .replace(/^["'“”]|["'“”]$/g, '').trim();
  if (/^[a-z0-9][a-z0-9,\s-]*$/i.test(plain) && plain.split(/[\s,]+/).filter(Boolean).length <= 12) return plain;
  throw new Error('图片识别结果无法解析，请重试');
}

module.exports = { providers, requestFor, outputText, customEndpoint, modelsRequestFor, parseAnalysis, parseSearchQuery };
