const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');

test('图搜图无需 AI 配置，准备图片不会将文件导入图库', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-image-search-test-'));
  process.env.REFERENCE_BOARD_DATA_DIR = directory;
  process.env.OPENAI_API_KEY = 'test-only-image-search-key';
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const image = await sharp({ create:{ width:12, height:8, channels:4, background:'#719b82' } }).png().toBuffer();
    const result = await fetch(`${base}/api/image-search/prepare`, { method:'POST', headers:{ 'Content-Type':'image/png' }, body:image });
    assert.equal(result.status, 200);
    const prepared = await result.json();
    const metadata = await sharp(Buffer.from(prepared.data, 'base64')).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 12);
    const library = await fetch(`${base}/api/state`).then(response => response.json());
    assert.equal(library.images.length, 0);
    const invalid = await fetch(`${base}/api/image-search/prepare`, { method:'POST', headers:{ 'Content-Type':'image/png' }, body:'invalid image' });
    assert.equal(invalid.status, 422);
    const providers = await fetch(`${base}/search-providers.json`).then(response => response.json());
    assert.equal(providers.length, 12);
    for (const provider of providers) {
      assert.equal(new URL(provider.home).protocol, 'https:');
      const icon = await fetch(`${base}/assets/search-sites/${provider.id}.png`);
      assert.equal(icon.status, 200, provider.name);
      assert.equal((await sharp(Buffer.from(await icon.arrayBuffer())).metadata()).format, 'png');
    }
    const pinterest = providers.find(item => item.id === 'pinterest');
    assert.equal(pinterest.image, true);
    assert.equal(pinterest.embedded, 'results');
    const nativeFetch = global.fetch;
    try {
      global.fetch = async (url, options) => {
        if (String(url).startsWith('https://api.openai.com/')) return Response.json({ output:[{ content:[{ type:'output_text', text:JSON.stringify({ query:'botanical illustration' }) }] }] });
        if (String(url).startsWith('https://www.pinterest.com/resource/')) return Response.json({ resource_response:{ data:{ results:[{ id:'123456789012', images:{ orig:{ url:'https://i.pinimg.com/originals/test.jpg', width:400, height:600 } } }] }, bookmark:'' } });
        return nativeFetch(url, options);
      };
      const response = await nativeFetch(`${base}/api/pinterest/image-search`, { method:'POST', headers:{'Content-Type':'image/png'}, body:image });
      assert.equal(response.status, 200);
      const results = await response.json();
      assert.equal(results.query, 'botanical illustration');
      assert.equal(results.images.length, 1);
      assert.equal(results.images[0].pinId, '123456789012');
    } finally { global.fetch = nativeFetch; }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('官网自动填图限定域名和入口，完成后不重复提交', async () => {
  const providers = require('../search-providers.json');
  const provider = providers.find(item => item.id === 'saucenao');
  const data = await sharp({ create:{ width:2, height:2, channels:3, background:'white' } }).jpeg().toBuffer();
  const events = [];
  const input = { dispatchEvent(event) { events.push(event.type); } };
  const storage = new Map();
  let tick;
  const context = {
    window:{}, location:{ hostname:'saucenao.com', pathname:'/' }, URL, File, Uint8Array, atob, Event,
    sessionStorage:{ getItem:key => storage.get(key), setItem:(key,value) => storage.set(key,value) },
    document:{ body:{ append() {} }, getElementById:() => ({ style:{}, textContent:'' }), querySelector:selector => selector === provider.input ? input : null },
    setInterval:callback => { tick = callback; return 1; }, clearInterval() {},
    DataTransfer:class { constructor() { this.files = []; this.items = { add:file => this.files.push(file) }; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../image-search-autofill.js'), 'utf8'), context);
  const job = { id:'test', provider, data:data.toString('base64') };
  context.location.hostname = 'unrelated.example';
  await context.window.__journalFillSearchImage(job);
  assert.equal(tick, undefined);
  context.location.hostname = 'saucenao.com';
  await context.window.__journalFillSearchImage(job);
  tick();
  assert.equal(input.files.length, 1);
  assert.equal(input.files[0].type, 'image/jpeg');
  assert.deepEqual(events, ['input', 'change']);
  tick = undefined;
  await context.window.__journalFillSearchImage(job);
  assert.equal(tick, undefined);
});
