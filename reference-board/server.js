const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');
const { providers, requestFor, outputText, customEndpoint, modelsRequestFor, parseAnalysis, parseSearchQuery } = require('./ai-providers');
const {runSharedAI} = require('./shared-ai');
const { supported, previewFor, rasterInputFor, encodeRasterFor, ordinary, decoded } = require('./media-preview');
const { searchPinterest, relatedPinterest, pinId } = require('./pinterest-search');

const root = __dirname;
const dataDir = process.env.REFERENCE_BOARD_DATA_DIR || path.join(root, 'data');
const mediaDir = path.join(dataDir, 'media');
const previewDir = path.join(dataDir, 'cache', 'previews');
const boardDir = path.join(dataDir, 'board');
const boardBuildDir = path.join(root, 'board-dist');
const stateFile = path.join(dataDir, 'library.json');
const iconDir = path.join(dataDir, 'icons');
const aiKeyFile = path.join(dataDir, 'ai-key.bin');
const aiKeysFile = path.join(dataDir, 'ai-keys.bin');
const tauriAiKeysFile = path.join(dataDir, 'tauri-ai-keys.bin');
const sessionAiKeys = { openai: process.env.OPENAI_API_KEY || '' };
let cachedAiKeys;
function protectedKeys(operation, value = '') {
  const command = operation === 'save'
    ? '[byte[]]$plain=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [byte[]]$encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($env:ATLAS_KEY_FILE,$encrypted)'
    : '[byte[]]$encrypted=[IO.File]::ReadAllBytes($env:ATLAS_KEY_FILE); [byte[]]$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; ${command}`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: value, encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, ATLAS_KEY_FILE: tauriAiKeysFile }
  });
}
function savedAiKeys() {
  if (process.env.TAURI_BACKEND === '1') {
    if (!cachedAiKeys) cachedAiKeys = fs.existsSync(tauriAiKeysFile) ? JSON.parse(protectedKeys('load')) : {};
    return cachedAiKeys;
  }
  if (!process.versions.electron) return {};
  const { safeStorage } = require('electron');
  if (!safeStorage.isEncryptionAvailable()) return {};
  const keys = fs.existsSync(aiKeysFile) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(aiKeysFile))) : {};
  if (!keys.openai && fs.existsSync(aiKeyFile)) keys.openai = safeStorage.decryptString(fs.readFileSync(aiKeyFile));
  return keys;
}
function aiKey(provider) {
  if (sessionAiKeys[provider]) return sessionAiKeys[provider];
  return savedAiKeys()[provider] || '';
}
function persistAiKeys(keys) {
  if (process.env.TAURI_BACKEND === '1') {
    protectedKeys('save', JSON.stringify(keys));
    cachedAiKeys = keys;
    return;
  }
  if (!process.versions.electron) return;
  const { safeStorage } = require('electron');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存密钥');
  fs.writeFileSync(aiKeysFile, safeStorage.encryptString(JSON.stringify(keys)));
  if (fs.existsSync(aiKeyFile)) fs.unlinkSync(aiKeyFile);
}
fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });
fs.mkdirSync(path.join(boardDir, 'media'), { recursive: true });
fs.mkdirSync(iconDir, { recursive: true });

const mimeByExt = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.tga': 'image/x-tga', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo' };
const extensionByMime = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
let state = { folders: [], images: [] };
let pinterestCookie = '';
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
if (!Array.isArray(state.folders)) state.folders = [];
if (!Array.isArray(state.images)) state.images = [];
if (!Array.isArray(state.imageOrder)) state.imageOrder = state.images.map(image => image.id);
if (!Array.isArray(state.tags)) state.tags = [];
if (!Array.isArray(state.trash)) state.trash = [];
if (!Array.isArray(state.syncRoots)) state.syncRoots = [];
const syncIssues = new Map();
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff', '.tga', '.bmp', '.psd', '.psb', '.clip', '.ai', '.eps', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2', '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi']);
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function safeDiskName(value, max = 60) {
  const name = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, max);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `_${name || '未命名'}` : name;
}
function uniqueFolderDiskName(name, parentId, currentId) {
  const base = safeDiskName(name);
  const taken = new Set(state.folders.filter(folder => folder.id !== currentId && (folder.parentId || null) === (parentId || null)).map(folder => (folder.diskName || safeDiskName(folder.name)).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`.toLowerCase())) index++;
  return `${base} (${index})`;
}
function folderDiskPath(folderId) {
  const names = [];
  const seen = new Set();
  let folder = state.folders.find(item => item.id === folderId);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    names.unshift(folder.diskName || safeDiskName(folder.name));
    folder = state.folders.find(item => item.id === folder.parentId);
  }
  return path.join(...names);
}
function mediaPath(image) {
  const relative = image.storagePath || `${image.id}${image.ext}`;
  const file = path.resolve(mediaDir, relative);
  if (path.isAbsolute(relative) || !file.startsWith(mediaDir + path.sep)) throw new Error('图片路径无效');
  return file;
}
function imagePreviewPath(image) { return path.join(previewDir, `${image.id}.preview.png`); }
function nextStoragePath(image, folderId = image.folderId) {
  const filename = `${image.id.slice(0, 8)}-${safeDiskName(path.parse(image.originalName || image.name).name, 70)}${image.ext}`;
  return path.join(folderId ? folderDiskPath(folderId) : '', filename);
}
function relocateImage(image, folderId = image.folderId) {
  const previousFile = mediaPath(image);
  const previousPreview = imagePreviewPath(image);
  const relative = nextStoragePath(image, folderId);
  const nextFile = path.resolve(mediaDir, relative);
  const nextPreview = imagePreviewPath(image);
  if (nextFile !== previousFile) {
    fs.mkdirSync(path.dirname(nextFile), { recursive: true });
    fs.copyFileSync(previousFile, nextFile);
    if (previousPreview !== nextPreview && fs.existsSync(previousPreview)) fs.copyFileSync(previousPreview, nextPreview);
  }
  image.folderId = folderId;
  image.storagePath = relative;
  save();
  if (nextFile !== previousFile) {
    fs.rmSync(previousFile, { force: true });
    if (previousPreview !== nextPreview) fs.rmSync(previousPreview, { force: true });
  }
}
function renameFolder(folder, name, parentId = folder.parentId || null) {
          const oldPath = folderDiskPath(folder.id);
          const oldName = folder.name;
          const oldDiskName = folder.diskName;
          const oldParentId = folder.parentId;
          folder.parentId = parentId;
          folder.name = name;
          folder.diskName = uniqueFolderDiskName(folder.name, folder.parentId, folder.id);
          const newPath = folderDiskPath(folder.id);
          try {
            if (oldPath !== newPath) { fs.mkdirSync(path.dirname(path.join(mediaDir, newPath)), { recursive: true }); fs.renameSync(path.join(mediaDir, oldPath), path.join(mediaDir, newPath)); }
            for (const image of [...state.images, ...state.trash]) {
              if (image.storagePath && (image.storagePath === oldPath || image.storagePath.startsWith(oldPath + path.sep)))
                image.storagePath = path.join(newPath, path.relative(oldPath, image.storagePath));
            }
          } catch (error) { folder.name = oldName; folder.diskName = oldDiskName; folder.parentId = oldParentId; throw error; }
}
for (const folder of state.folders) {
  if (!folder.diskName) folder.diskName = uniqueFolderDiskName(folder.name, folder.parentId, folder.id);
  fs.mkdirSync(path.join(mediaDir, folderDiskPath(folder.id)), { recursive: true });
}
for (const image of [...state.images, ...state.trash]) {
  const legacyPreview = path.join(path.dirname(mediaPath(image)), `${image.id}.preview.png`);
  const cachedPreview = imagePreviewPath(image);
  if (fs.existsSync(legacyPreview)) {
    if (!fs.existsSync(cachedPreview)) fs.renameSync(legacyPreview, cachedPreview);
    else if (fs.readFileSync(legacyPreview).equals(fs.readFileSync(cachedPreview))) fs.unlinkSync(legacyPreview);
  }
  if (!image.storagePath && fs.existsSync(mediaPath(image))) relocateImage(image);
}
[...state.images, ...state.trash].forEach(image => { if (!Array.isArray(image.related)) image.related = []; });
const browserImages = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
[...state.images, ...state.trash].forEach(image => {
  if (!image.hasPreview && (fs.existsSync(imagePreviewPath(image)) ||
      (browserImages.has(image.ext) && fs.existsSync(mediaPath(image))))) image.hasPreview = true;
});
if (!state.icons || typeof state.icons !== 'object') state.icons = {};
if (!state.aiSettings || typeof state.aiSettings !== 'object') state.aiSettings = { provider: 'openai', models: {} };
if (!providers[state.aiSettings.provider]) state.aiSettings.provider = 'openai';
if (!state.aiSettings.models || typeof state.aiSettings.models !== 'object') state.aiSettings.models = {};
if (!state.aiSettings.custom || typeof state.aiSettings.custom !== 'object') state.aiSettings.custom = { name: '自定义平台', address: '' };
function aiLabel(provider) { return provider === 'custom' ? state.aiSettings.custom.name : providers[provider].label; }
function aiRequest(provider, model, key, image, instruction) {
  return requestFor(provider, model, key, image, instruction, state.aiSettings.custom.address);
}
state.tags = state.tags.map(tag => ({ name: tag.name, color: tag.color || '#506a51', parent: tag.parent || null, key: tag.key || (tag.parent ? `${tag.parent} / ${tag.name}` : tag.name) }));
function tagFamily(key) { return state.tags.filter(tag => tag.key === key || tag.parent === key).map(tag => tag.key); }
const iconKeys = new Set(['brand', 'all', 'favorites', 'untagged', 'trash', 'folders', 'tags', 'menu', 'settings', 'export', 'search', 'sort', 'details', 'pinterest', 'pinterestSearch', 'pinterestLogin', 'pinterestOpen', 'pinterestToggle']);

function save() {
  const temp = stateFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, stateFile);
}
function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, max = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, exceeded = false;
    req.on('data', chunk => { if (exceeded) return; size += chunk.length; if (size > max) { exceeded = true; chunks.length = 0; const error = new Error(`文件过大（最大 ${max >= 1024 * 1024 ? Math.round(max / 1024 / 1024) + ' MB' : Math.round(max / 1024) + ' KB'}）`); error.status = 413; reject(error); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function cleanText(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function uniqueTags(value) { return Array.isArray(value) ? [...new Set(value.map(tag => cleanText(tag, 40)).filter(Boolean))].slice(0, 30) : []; }
function previewPathFor(image) {
  const preview = imagePreviewPath(image);
  return image.hasPreview && fs.existsSync(preview) ? preview : mediaPath(image);
}
async function visualHash(input) {
  try {
    const pixels = await sharp(input).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | BigInt(pixels[y * 9 + x] > pixels[y * 9 + x + 1]);
    return bits.toString(16).padStart(16, '0');
  } catch { return null; }
}
async function visualColor(input) {
  try { return [...await sharp(input).resize(1, 1).removeAlpha().raw().toBuffer()].slice(0, 3); }
  catch { return null; }
}
function colorsClose(a, b) { return a && b && a.reduce((distance, color, index) => distance + Math.abs(color - b[index]), 0) <= 90; }
function hashDistance(a, b) {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (bits) { count++; bits &= bits - 1n; }
  return count;
}
async function duplicateCandidates(buffer, parsed) {
  const contentHash = digest(buffer);
  const imageHash = (parsed.preview || parsed.reuseOriginal) ? await visualHash(parsed.preview || buffer) : null;
  const imageColor = (parsed.preview || parsed.reuseOriginal) ? await visualColor(parsed.preview || buffer) : null;
  const matches = [];
  let updated = false;
  for (const image of state.images) {
    if (!image.contentHash && fs.existsSync(mediaPath(image))) { image.contentHash = digest(fs.readFileSync(mediaPath(image))); updated = true; }
    if (imageHash && !image.visualHash && image.hasPreview && fs.existsSync(previewPathFor(image))) { image.visualHash = await visualHash(previewPathFor(image)); updated = true; }
    if (imageHash && !image.visualColor && image.hasPreview && fs.existsSync(previewPathFor(image))) { image.visualColor = await visualColor(previewPathFor(image)); updated = true; }
    if (image.contentHash === contentHash) matches.push({ id: image.id, name: image.name, kind: 'exact', folderId: image.folderId });
    else if (imageHash && image.visualHash && colorsClose(imageColor, image.visualColor) && hashDistance(imageHash, image.visualHash) <= 5) matches.push({ id: image.id, name: image.name, kind: 'similar', folderId: image.folderId });
  }
  if (updated) save();
  return { contentHash, imageHash, imageColor, matches: matches.slice(0, 6) };
}
function sourceInsideLibrary(source) {
  const relative = path.relative(fs.realpathSync(dataDir), fs.realpathSync(source));
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
async function importSourceFile(file, folderId, sourcePath, action = 'skip') {
  const ext = path.extname(file).toLowerCase();
  const buffer = fs.readFileSync(file);
  const parsed = await previewFor(buffer, ext);
  const { contentHash, imageHash, imageColor, matches } = await duplicateCandidates(buffer, parsed);
  const exact = matches.find(match => match.kind === 'exact');
  if (matches.length && action === 'skip') return { matches };
  const id = crypto.randomUUID();
  const stat = fs.statSync(file);
  const inherited = action === 'merge' ? state.images.find(image => image.id === matches[0]?.id) : null;
  const image = { id, name: path.basename(file, ext), originalName: path.basename(file), type: mimeByExt[ext] || 'application/octet-stream', size: buffer.length, width: parsed.width, height: parsed.height, folderId, tags: inherited ? [...inherited.tags] : [], related: [], note: '', favorite: false, createdAt: Date.now(), modifiedAt: Date.now(), sourceModifiedAt: stat.mtimeMs, sourceSize: stat.size, sourcePath, ext, hasPreview: !!parsed.preview || !!parsed.reuseOriginal, animated: parsed.animated, contentHash, visualHash: imageHash, visualColor: imageColor };
  image.storagePath = nextStoragePath(image);
  fs.mkdirSync(path.dirname(mediaPath(image)), { recursive: true });
  fs.writeFileSync(mediaPath(image), buffer);
  if (parsed.preview) fs.writeFileSync(imagePreviewPath(image), parsed.preview);
  state.images.unshift(image); state.imageOrder.unshift(id); save();
  return { image };
}
function collectSourceFiles(root, folder = root, files = []) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) collectSourceFiles(root, file, files);
    else if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
  }
  return files;
}
async function syncRoot(root) {
  if (!fs.existsSync(root.path)) { syncIssues.set(root.path, { path: root.path, kind: 'root-missing' }); return; }
  syncIssues.delete(root.path);
  for (const [key, issue] of syncIssues) if (issue.path.startsWith(root.path + path.sep)) syncIssues.delete(key);
  const files = new Set(collectSourceFiles(root.path));
  for (const file of files) {
    const known = [...state.images, ...state.trash].find(image => image.sourcePath === file);
    if (known) {
      if (state.trash.includes(known)) continue;
      const stat = fs.statSync(file);
      const key = `${file}:changed`;
      if (stat.size !== known.sourceSize || Math.abs(stat.mtimeMs - known.sourceModifiedAt) > 0.1) syncIssues.set(key, { path: file, kind: 'changed', imageId: known.id });
      else syncIssues.delete(key);
      syncIssues.delete(`${file}:missing`);
      continue;
    }
    if (root.ignored?.includes(file)) continue;
    const fileHash = digest(fs.readFileSync(file));
    const sameContent = [...state.images, ...state.trash].find(image => image.sourcePath && image.sourcePath.startsWith(root.path + path.sep) && !files.has(image.sourcePath) && image.contentHash === fileHash);
    if (sameContent) {
      syncIssues.set(`${file}:renamed`, { path: file, kind: 'renamed', imageId: sameContent.id, previousPath: sameContent.sourcePath });
      syncIssues.delete(`${sameContent.sourcePath}:missing`);
      continue;
    }
    let parentId = root.folderId || null;
    const segments = path.relative(root.path, path.dirname(file)).split(path.sep).filter(part => part && part !== '.');
    for (const name of [path.basename(root.path), ...segments]) {
      let folder = state.folders.find(item => item.parentId === parentId && item.name === name);
      if (!folder) { folder = { id: crypto.randomUUID(), name, parentId, diskName: uniqueFolderDiskName(name, parentId), createdAt: Date.now() }; state.folders.push(folder); fs.mkdirSync(path.join(mediaDir, folderDiskPath(folder.id)), { recursive: true }); save(); }
      parentId = folder.id;
    }
    try {
      const result = await importSourceFile(file, parentId, file);
      if (result.matches) syncIssues.set(`${file}:similar`, { path: file, kind: 'similar', matches: result.matches, folderId: parentId });
      else syncIssues.delete(`${file}:similar`);
    } catch (error) { syncIssues.set(`${file}:error`, { path: file, kind: 'error', message: error.message }); }
  }
  for (const image of state.images) if (image.sourcePath && (image.sourcePath === root.path || image.sourcePath.startsWith(root.path + path.sep)) && !files.has(image.sourcePath) && ![...syncIssues.values()].some(issue => issue.kind === 'renamed' && issue.imageId === image.id)) syncIssues.set(`${image.sourcePath}:missing`, { path: image.sourcePath, kind: 'missing', imageId: image.id });
}
let syncing = false;
async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    for (const root of state.syncRoots) {
      try { await syncRoot(root); }
      catch (error) { syncIssues.set(root.path, { path: root.path, kind: 'error', message: error.message }); }
    }
  }
  finally { syncing = false; }
}
setInterval(() => { syncAll().catch(error => console.error('目录同步失败:', error)); }, 20000).unref();
function fileResponse(res, file, cacheControl = 'private, max-age=3600', req = null) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: '未找到文件' });
    const headers = { 'Content-Type': mimeByExt[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cacheControl, 'Accept-Ranges': 'bytes' };
    if (req?.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start = match?.[1] ? Number(match[1]) : 0;
      let end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (match && !match[1] && match[2]) { start = Math.max(0, stat.size - Number(match[2])); end = stat.size - 1; }
      if (!match || (!match[1] && !match[2]) || start >= stat.size || start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + stat.size }); return res.end(); }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    if (req?.method === 'HEAD') { res.writeHead(200, { ...headers, 'Content-Length': stat.size }); return res.end(); }
    res.writeHead(200, { ...headers, 'Content-Type': mimeByExt[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cacheControl });
    fs.createReadStream(file).pipe(res);
  });
}
function createBackup(file) {
  save();
  execFileSync('tar', ['-czf', file, '-C', dataDir, 'library.json', 'media', 'icons', 'cache', 'board'], { windowsHide: true, timeout: 120000 });
}
function validateBackup(archive, stage) {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true, timeout: 120000 }).trim().split(/\r?\n/);
  const details = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', windowsHide: true, timeout: 120000 }).trim().split(/\r?\n/);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index].replace(/^\.\//, '').replace(/\\/g, '/');
    if (!/^(library\.json|media(?:\/.*)?|icons(?:\/.*)?|cache(?:\/.*)?|board(?:\/.*)?)$/.test(entry) || entry.split('/').includes('..') || !['-', 'd', 'h'].includes(details[index]?.[0])) throw new Error('备份包含无效路径或文件类型');
    if (details[index]?.[0] === 'h') {
      // Only allow links to a regular file in this archive, never symlinks or outside paths.
      const target = details[index].split(' link to ').slice(1).join(' link to ').replace(/^\.\//, '').replace(/\\/g, '/');
      const targetIndex = entries.findIndex(name => name.replace(/^\.\//, '').replace(/\\/g, '/') === target);
      if (!target || target.split('/').includes('..') || targetIndex < 0 || details[targetIndex]?.[0] !== '-') throw new Error('备份包含不安全的硬链接');
    }
  }
  execFileSync('tar', ['-xzf', archive, '-C', stage], { windowsHide: true, timeout: 120000 });
  const restored = JSON.parse(fs.readFileSync(path.join(stage, 'library.json'), 'utf8'));
  if (!Array.isArray(restored.folders) || !Array.isArray(restored.images) || !Array.isArray(restored.trash) || !Array.isArray(restored.tags)) throw new Error('备份图库数据无效');
  for (const image of [...restored.images, ...restored.trash]) {
    if (!/^[a-f0-9-]{36}$/.test(image.id) || !/^\.[a-z0-9]{1,8}$/.test(image.ext)) throw new Error('备份图片数据无效');
    const relative = image.storagePath || `${image.id}${image.ext}`;
    const file = path.resolve(stage, 'media', relative);
    if (path.isAbsolute(relative) || !file.startsWith(path.resolve(stage, 'media') + path.sep) || !fs.statSync(file).isFile()) throw new Error('备份图片文件不完整');
  }
  fs.mkdirSync(path.join(stage, 'cache', 'previews'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'icons'), { recursive: true });
  for (const image of [...restored.images, ...restored.trash]) {
    const original = path.resolve(stage, 'media', image.storagePath || image.id + image.ext);
    const oldPreview = path.join(path.dirname(original), image.id + '.preview.png');
    const cachedPreview = path.join(stage, 'cache', 'previews', image.id + '.preview.png');
    if (fs.existsSync(oldPreview) && !fs.existsSync(cachedPreview)) fs.renameSync(oldPreview, cachedPreview);
  }
  fs.mkdirSync(path.join(stage,'board','media'),{recursive:true});
  // Restoring changes inode numbers. Rebind only manifest links that still share
  // the canonical original; a replaced user file must never become system-owned.
  const refreshManifests = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const target=path.join(directory,entry.name);
      if(entry.isDirectory()) {refreshManifests(target);continue;}
      if(entry.name!=='.画板.json')continue;
      const manifest=JSON.parse(fs.readFileSync(target,'utf8'));
      for(const link of manifest.links||[]) {
        if(!/^atlas-[a-f0-9-]+\.[a-z0-9]+$/.test(link.name))continue;
        const image=restored.images.find(image=>image.id===link.imageId);
        if(!image)continue;
        const original=path.resolve(stage,'media',image.storagePath||image.id+image.ext),alias=path.join(directory,link.name);
        if(fs.existsSync(alias)&&fs.statSync(alias).ino===fs.statSync(original).ino)link.inode=String(fs.statSync(alias).ino);
      }
      fs.writeFileSync(target,JSON.stringify(manifest,null,2));
    }
  };
  refreshManifests(path.join(stage,'media'));
  restored.syncRoots = [];
  for (const image of [...restored.images, ...restored.trash]) { delete image.sourcePath; delete image.sourceSize; }
  return restored;
}

const boardLibrary = require('./board-library').createBoardLibrary({state,save,dataDir,boardDir,mediaDir,folderDiskPath,uniqueFolderDiskName,mediaPath,renameFolder,
  importMedia: async (href, folderId, name) => {
    const match = href.match(/^\/board-media\/([a-f0-9]{64}\.[a-z0-9]+)$/);
    if (!match) throw Error('画板素材地址无效');
    const source=path.join(boardDir,'media',match[1]);
    if (!fs.existsSync(source)) throw Error('画板素材不存在');
    const hash=digest(fs.readFileSync(source));
    const existing=state.images.find(image=>image.contentHash===hash);
    const image=existing||(await importSourceFile(source,folderId,null,'keep')).image;
    if(!existing&&name)image.name=cleanText(name,240);
    const original=mediaPath(image),backup=source+'.link-backup';
    if(fs.statSync(original).ino===fs.statSync(source).ino)return image;
    fs.renameSync(source,backup);
    try{fs.linkSync(original,source);fs.unlinkSync(backup);}catch(error){fs.renameSync(backup,source);throw error;}
    save();return image;
  }
});
let boardQueue=Promise.resolve();
function withBoardLock(action){const next=boardQueue.then(action);boardQueue=next.catch(()=>{});return next;}
function boardRevision(){
  return [stateFile,path.join(boardDir,'document.json')].map(file=>{
    try{const stat=fs.statSync(file,{bigint:true});return `${stat.mtimeNs}:${stat.size}`;}catch{return 'missing';}
  }).join('|');
}
const updater = require('./app-updater').createUpdater({ directory:dataDir, config:require('./update-config.json'), version:require('./package.json').version, desktop:process.env.TAURI_BACKEND === '1' && process.platform === 'win32' });
const updateToken = crypto.randomBytes(32).toString('hex');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (req.method === 'GET' && route.startsWith('/assets/doro/')) {
      const name = route.slice('/assets/doro/'.length);
      if (!['board-icon.png','doro-rest.png','doro-note.png'].includes(name)) return send(res,404,{error:'图标不存在'});
      return fileResponse(res,path.join(root,'assets','doro',name));
    }
    if (req.method === 'GET' && (route === '/board' || route.startsWith('/board/'))) {
      const relative = decodeURIComponent(route.slice('/board'.length)).replace(/^\//,'') || 'index.html';
      const file = path.resolve(boardBuildDir,relative);
      if (!file.startsWith(boardBuildDir + path.sep)) return send(res,400,{error:'路径无效'});
      if (!fs.existsSync(file)) return send(res,404,{error:'画板资源未构建'});
      return fileResponse(res,file,'no-store');
    }
    if (route === '/api/board/catalog') {
      if(req.method==='GET')return send(res,200,await withBoardLock(()=>({links:boardLibrary.catalog(),archivedIds:boardLibrary.archivedIds()})));
      if(req.method==='POST'){
        const body=JSON.parse((await readBody(req,128*1024)).toString());
        if(!Array.isArray(body.boards))return send(res,400,{error:'画板目录无效'});
        return send(res,200,await withBoardLock(()=>({links:boardLibrary.catalog(body.boards),archivedIds:boardLibrary.archivedIds()})));
      }
    }
    if(route==='/api/board/recovery'&&req.method==='POST'){
      const body=JSON.parse((await readBody(req,100*1024*1024)).toString());
      if(!Array.isArray(body.boards)||body.boards.length>100||!body.boards.every(board=>typeof board.id==='string'&&Array.isArray(board.elements)))return send(res,400,{error:'恢复副本无效'});
      return send(res,200,await withBoardLock(()=>boardLibrary.recovery(body.boards)));
    }
    if(route==='/api/board/revision'&&req.method==='GET')return send(res,200,await withBoardLock(()=>({revision:boardRevision()})));
    if(route==='/api/board/sync'&&req.method==='POST'){
      const body=JSON.parse((await readBody(req,100*1024*1024)).toString());
      if(!Array.isArray(body.boards)||body.boards.length<1||body.boards.length>100||!body.boards.every(board=>typeof board.id==='string'&&Array.isArray(board.elements)))return send(res,400,{error:'画板同步数据无效'});
      return send(res,200,await withBoardLock(async()=>({...await boardLibrary.sync(body),revision:boardRevision()})));
    }
    if (route === '/api/board/document') {
      if (req.method === 'GET') return send(res,200,await withBoardLock(()=>boardLibrary.document()));
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req,100*1024*1024)).toString());
        if (!Array.isArray(body.boards) || body.boards.length < 1 || body.boards.length > 100 || !body.boards.every(board=>typeof board.id==='string' && Array.isArray(board.elements))) return send(res,400,{error:'画板工程无效'});
        return send(res,200,await withBoardLock(()=>boardLibrary.put(body)));
      }
    }
    if (req.method === 'POST' && route === '/api/board/media') {
      const type = (req.headers['content-type'] || '').split(';')[0];
      const ext = Object.keys(mimeByExt).find(ext=>mimeByExt[ext] === type && /^\.(png|jpg|jpeg|webp|gif|avif|mp4|webm|mp3|wav|svg)$/.test(ext));
      if (!ext) return send(res,415,{error:'画板素材格式不支持'});
      const buffer = await readBody(req,120*1024*1024);
      const name = digest(buffer) + ext;const file = path.join(boardDir,'media',name);
      if (!fs.existsSync(file)) fs.writeFileSync(file,buffer);
      return send(res,201,{url:'/board-media/'+name});
    }
    if (['GET','HEAD'].includes(req.method) && route.startsWith('/board-media/')) {
      const name=route.slice('/board-media/'.length);
      if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(name)) return send(res,400,{error:'素材地址无效'});
      if (req.method === 'GET' && url.searchParams.has('edge')) {
        const edge=Number(url.searchParams.get('edge'));
        if (![512,1024,2048,4096,8192].includes(edge)) return send(res,400,{error:'图片尺寸无效'});
        const pixels=await sharp(path.join(boardDir,'media',name)).rotate().resize(edge,edge,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=3600'});
        return res.end(pixels);
      }
      return fileResponse(res,path.join(boardDir,'media',name),undefined,req);
    }

    if (route === '/api/updates' && req.method === 'GET') return send(res, 200, {...updater.status(),token:updateToken});
    if (route.startsWith('/api/updates/') && req.method === 'POST') {
      if (req.headers['x-update-token'] !== updateToken) return send(res, 403, {error:'更新请求无效，请重新打开更新面板'});
      try {
        if (route === '/api/updates/preferences') return send(res,200,updater.savePreferences(JSON.parse((await readBody(req,2048)).toString())));
        if (route === '/api/updates/check') return send(res,200,await updater.check());
        if (route === '/api/updates/download') return send(res,200,await updater.download());
        if (route === '/api/updates/install') return send(res,200,await updater.install());
      } catch(error) { return send(res,422,{error:error.message}); }
      return send(res,404,{error:'未找到更新操作'});
    }
    if (req.method === 'GET' && route === '/search-providers.json') return fileResponse(res, path.join(root, 'search-providers.json'), 'no-store');
    if (req.method === 'GET' && /^\/assets\/(all-images|related-images|whale-album)\.png$/.test(route)) return fileResponse(res, path.join(root, route.slice(1)));
    if (req.method === 'GET' && route === '/assets/app-icon.png') return fileResponse(res, path.join(root, 'assets', 'app-icon.png'));
    if (req.method === 'GET' && route === '/assets/observation-note.svg') return fileResponse(res, path.join(root, 'assets', 'observation-note.svg'));
    if (req.method === 'GET' && /^\/assets\/whale\/(?:maid-(?:sleepy|determined|delighted)\.png|maid-NOTICE|maid-LICENSE-ARTWORK)$/.test(route)) return fileResponse(res, path.join(root, route.slice(1)));
    const searchIcon = route.match(/^\/assets\/search-sites\/([a-z]+)\.png$/);
    if (req.method === 'GET' && searchIcon) return fileResponse(res, path.join(root, 'assets', 'search-sites', searchIcon[1] + '.png'));
    if (req.method === 'POST' && route === '/api/image-search/prepare') {
      let input;
      if (req.headers['content-type']?.startsWith('application/json')) {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const image = state.images.find(item => item.id === body.imageId);
        if (!image || image.hasPreview === false) return send(res, 404, { error: '图片不存在或暂无可搜索的预览图' });
        input = previewPathFor(image);
      } else {
        if (!req.headers['content-type']?.startsWith('image/')) return send(res, 415, { error: '请拖入图片文件' });
        input = await readBody(req, 20 * 1024 * 1024);
      }
      try {
        const jpeg = await sharp(input).rotate().resize({ width:1600, height:1600, fit:'inside', withoutEnlargement:true }).flatten({ background:'#ffffff' }).jpeg({ quality:88 }).toBuffer();
        return send(res, 200, { data:jpeg.toString('base64'), mime:'image/jpeg', name:'search-image.jpg' });
      } catch { return send(res, 422, { error: '无法读取此图片，请换用 JPG、PNG、WebP 或图库中的可预览图片' }); }
    }
    if (req.method === 'GET' && route === '/api/state') return send(res, 200, state);
    if (req.method === 'GET' && route === '/api/backup') {
      const temporary = path.join(os.tmpdir(), `journal-backup-${crypto.randomUUID()}.tar.gz`);
      createBackup(temporary);
      const stat = fs.statSync(temporary);
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="journal-library.tar.gz"', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(temporary);
      stream.on('close', () => fs.rm(temporary, { force: true }, () => {}));
      return stream.pipe(res);
    }
    if (req.method === 'POST' && route === '/api/backup/restore') {
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-restore-'));
      const archive = path.join(stage, 'upload.tar.gz');
      try {
        let bytes = 0;
        req.on('data', chunk => { bytes += chunk.length; if (bytes > 10 * 1024 * 1024 * 1024) req.destroy(new Error('备份文件过大')); });
        await pipeline(req, fs.createWriteStream(archive));
        const restored = validateBackup(archive, stage);
        const backupDir = path.join(dataDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        createBackup(path.join(backupDir, `before-restore-${Date.now()}.tar.gz`));
        const previous = path.join(dataDir, `previous-${crypto.randomUUID()}`);
        const previousState = state;
        fs.mkdirSync(previous);
        try {
          for (const name of ['library.json', 'media', 'icons', 'cache', 'board']) fs.renameSync(path.join(dataDir, name), path.join(previous, name));
          for (const name of ['library.json', 'media', 'icons', 'cache', 'board']) fs.renameSync(path.join(stage, name), path.join(dataDir, name));
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, restored);
          state.boardLinks ||= [];state.unlinkedBoardFolders ||= [];
          save();
          fs.rmSync(previous, { recursive: true, force: true });
        } catch (error) {
          state = previousState;
          for (const name of ['library.json', 'media', 'icons', 'cache', 'board']) {
            if (fs.existsSync(path.join(previous, name))) {
              fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
              fs.renameSync(path.join(previous, name), path.join(dataDir, name));
            }
          }
          throw error;
        }
        syncIssues.clear();
        return send(res, 200, { ok: true });
      } finally { fs.rmSync(stage, { recursive: true, force: true }); }
    }
    if (route === '/api/sync') {
      if (req.method === 'GET') return send(res, 200, { roots: state.syncRoots, issues: [...syncIssues.values()] });
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const source = path.resolve(String(body.path || '').trim());
        if (!path.isAbsolute(body.path || '') || !fs.existsSync(source) || !fs.statSync(source).isDirectory() || sourceInsideLibrary(source)) return send(res, 400, { error: '请选择图库之外的现有文件夹' });
        if (state.syncRoots.some(root => root.path.toLowerCase() === source.toLowerCase())) return send(res, 409, { error: '此文件夹已在同步' });
        const folderId = state.folders.some(folder => folder.id === body.folderId) ? body.folderId : null;
        state.syncRoots.push({ path: source, folderId, ignored: [] }); save();
        await syncAll();
        return send(res, 201, { roots: state.syncRoots, issues: [...syncIssues.values()] });
      }
      if (req.method === 'DELETE') {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        state.syncRoots = state.syncRoots.filter(root => root.path !== body.path);
        for (const key of syncIssues.keys()) if (key === body.path || key.startsWith(body.path + path.sep)) syncIssues.delete(key);
        save(); return send(res, 200, { roots: state.syncRoots, issues: [...syncIssues.values()] });
      }
    }
    if (req.method === 'POST' && route === '/api/sync/scan') { await syncAll(); return send(res, 200, { roots: state.syncRoots, issues: [...syncIssues.values()] }); }
    if (req.method === 'POST' && route === '/api/sync/resolve') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const issue = syncIssues.get(`${body.path}:${body.kind}`);
      if (!issue) return send(res, 404, { error: '待处理项目已不存在' });
      if (issue.kind === 'renamed' && body.action === 'relink') {
        const image = [...state.images, ...state.trash].find(item => item.id === issue.imageId);
        if (!image || !fs.existsSync(issue.path)) return send(res, 404, { error: '原图片或新路径不存在' });
        const stat = fs.statSync(issue.path);
        image.sourcePath = issue.path; image.sourceModifiedAt = stat.mtimeMs; image.sourceSize = stat.size;
        syncIssues.delete(`${issue.previousPath}:missing`); syncIssues.delete(`${issue.path}:renamed`); save();
        return send(res, 200, { issues: [...syncIssues.values()] });
      }
      if (body.action === 'ignore') {
        const root = state.syncRoots.find(root => issue.path.startsWith(root.path + path.sep));
        if (['similar', 'renamed'].includes(issue.kind) && root) { root.ignored = [...new Set([...(root.ignored || []), issue.path])]; save(); }
        if (issue.kind === 'changed' && fs.existsSync(issue.path)) {
          const image = state.images.find(item => item.id === issue.imageId);
          if (image) { const stat = fs.statSync(issue.path); image.sourceModifiedAt = stat.mtimeMs; image.sourceSize = stat.size; save(); }
        }
        if (issue.kind === 'missing') { const image = state.images.find(item => item.id === issue.imageId); if (image) { delete image.sourcePath; save(); } }
      } else if (body.action === 'import' && ['similar', 'changed'].includes(issue.kind) && fs.existsSync(issue.path)) {
        const original = state.images.find(item => item.id === issue.imageId);
        const result = await importSourceFile(issue.path, issue.folderId || original?.folderId || null, issue.path, body.mergeTags ? 'merge' : 'keep');
        if (original && issue.kind === 'changed') {
          if (body.mergeTags && result.image) { result.image.tags = [...new Set([...result.image.tags, ...original.tags])]; }
          delete original.sourcePath; save();
        }
        syncIssues.delete(`${issue.path}:${issue.kind}`);
        return send(res, 200, { image: result.image, issues: [...syncIssues.values()] });
      } else return send(res, 400, { error: '不支持此操作' });
      syncIssues.delete(`${issue.path}:${issue.kind}`);
      return send(res, 200, { issues: [...syncIssues.values()] });
    }
    if (req.method === 'PATCH' && route === '/api/images/order') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const ids = state.images.map(image => image.id);
      if (!ids.includes(body.sourceId) || (body.targetId !== null && !ids.includes(body.targetId))) return send(res, 404, { error: '图片不存在' });
      const order = [...new Set([...state.imageOrder.filter(id => ids.includes(id)), ...ids])];
      const from = order.indexOf(body.sourceId);
      order.splice(from, 1);
      order.splice(body.targetId === null ? order.length : order.indexOf(body.targetId), 0, body.sourceId);
      state.imageOrder = order;
      save();
      return send(res, 200, { order });
    }
    if (route === '/api/pinterest/cookie') {
      if (req.method === 'GET') return send(res, 200, { configured: !!pinterestCookie });
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 20000)).toString());
        const value = String(body.cookie || '').trim();
        if (value.length > 16000 || /[\r\n]/.test(value)) return send(res, 400, { error: 'Cookie 格式无效' });
        pinterestCookie = value;
        return send(res, 200, { configured: !!pinterestCookie });
      }
    }
    if (req.method === 'GET' && route === '/api/pinterest/related') {
      try { return send(res, 200, await relatedPinterest(url.searchParams.get('pin'), pinterestCookie, url.searchParams.get('bookmark') || '')); }
      catch (error) { return send(res, 502, { error: error.message || 'Pinterest 相似推荐失败' }); }
    }
    if (req.method === 'GET' && route === '/api/pinterest/search') {
      const query = cleanText(url.searchParams.get('q'), 120);
      const bookmark = url.searchParams.get('bookmark') || '';
      if (!query) return send(res, 400, { error: '请输入搜索关键词' });
      try { return send(res, 200, await searchPinterest(query, bookmark)); }
      catch (error) { return send(res, 502, { error: error.message || 'Pinterest 搜索失败' }); }
    }
    if (req.method === 'POST' && route === '/api/pinterest/image-search') {
      const provider = state.aiSettings.provider;
      const key = aiKey(provider);
      if (!key) return send(res, 400, { error: `请先在设置中填写 ${aiLabel(provider)} 的视觉模型 API Key` });
      let source;
      if (req.headers['content-type']?.startsWith('application/json')) {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const image = state.images.find(item => item.id === body.imageId);
        if (!image || image.hasPreview === false) return send(res, 404, { error: '找不到可识别的图库图片' });
        source = previewPathFor(image);
      } else {
        if (!req.headers['content-type']?.startsWith('image/')) return send(res, 415, { error: '请拖入图片文件' });
        source = await readBody(req, 20 * 1024 * 1024);
      }
      const jpeg = await sharp(source).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      const model = state.aiSettings.models[provider] || providers[provider].model;
      const instruction = '观察图片并写出适合 Pinterest 搜索相似图片的简短英文关键词。包含主体、风格与关键颜色，不要解释。只返回 JSON 对象，字段 query 为不超过 12 个英文单词的字符串。';
      const ai = aiRequest(provider, model, key, jpeg.toString('base64'), instruction);
      const response = await fetch(ai.url, ai.options);
      const result = await response.json();
      if (!response.ok) return send(res, response.status, { error: result.error?.message || '图片识别失败，请检查模型是否支持图片输入' });
      let query;
      try { query = parseSearchQuery(outputText(provider, result)); }
      catch { return send(res, 502, { error: '图片识别结果无法解析，请重试' }); }
      if (typeof query !== 'string' || !query.trim()) return send(res, 502, { error: '未能识别图片内容' });
      try { return send(res, 200, { ...await searchPinterest(query), query: query.slice(0, 120) }); }
      catch (error) { return send(res, 502, { error: error.message || 'Pinterest 图片搜索失败' }); }
    }
    if (route === '/api/ai/board' && req.method === 'POST') {
      try {const body=JSON.parse((await readBody(req,60*1024*1024)).toString());return send(res,200,await runSharedAI(state.aiSettings,aiKey(state.aiSettings.provider),body));}
      catch(error){return send(res,400,{ok:false,artifacts:[],error:error.message});}
    }
    if (route === '/api/ai/settings') {
      if (req.method === 'GET') return send(res, 200, { provider: state.aiSettings.provider, models: state.aiSettings.models, generationModels:state.aiSettings.generationModels || {}, imageProtocol:state.aiSettings.imageProtocol || 'images', custom: state.aiSettings.custom, providers: Object.fromEntries(Object.entries(providers).map(([id, value]) => [id, { ...value, label: aiLabel(id), configured: !!aiKey(id) }])), persistent: !!process.versions.electron || process.env.TAURI_BACKEND === '1' });
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const provider = cleanText(body.provider, 30);
        const model = cleanText(body.model, 100);
        if (!providers[provider]) return send(res, 400, { error: '不支持此 AI 服务' });
        if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return send(res, 400, { error: '模型名称无效' });
        const generationModel = cleanText(body.generationModel,100);
        if (generationModel && !/^[a-zA-Z0-9._:-]{1,100}$/.test(generationModel)) return send(res,400,{error:'图片生成模型名称无效'});
        if ('imageProtocol' in body && !['images','chat'].includes(body.imageProtocol)) return send(res,400,{error:'图片生成协议无效'});
        if (provider === 'custom') {
          const name = cleanText(body.name, 40);
          const address = cleanText(body.address, 500);
          if (!name) return send(res, 400, { error: '请输入平台名称' });
          try { customEndpoint(address); } catch (error) { return send(res, 400, { error: error.message || '请求地址无效' }); }
          state.aiSettings.custom = { name, address };
        }
        if ('key' in body && cleanText(body.key, 300)) {
          const key = cleanText(body.key, 300);
          const keys = { ...savedAiKeys(), [provider]: key };
          persistAiKeys(keys);
          sessionAiKeys[provider] = key;
        }
        state.aiSettings.provider = provider;
        state.aiSettings.models[provider] = model;
        if ('generationModel' in body) state.aiSettings.generationModels = {...state.aiSettings.generationModels,[provider]:generationModel};
        if ('imageProtocol' in body) state.aiSettings.imageProtocol = body.imageProtocol;
        save();
        return send(res, 200, { configured: !!aiKey(provider), persistent: !!process.versions.electron || process.env.TAURI_BACKEND === '1' });
      }
      if (req.method === 'DELETE') {
        const provider = cleanText(url.searchParams.get('provider'), 30);
        if (!providers[provider]) return send(res, 400, { error: '不支持此 AI 服务' });
        delete sessionAiKeys[provider];
        const keys = savedAiKeys();
        delete keys[provider];
        persistAiKeys(keys);
        return send(res, 200, { configured: false });
      }
    }
    if (req.method === 'POST' && route === '/api/ai/models') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const provider = cleanText(body.provider, 30);
      if (!providers[provider]) return send(res, 400, { error: '不支持此 AI 服务' });
      const key = cleanText(body.key, 300) || aiKey(provider);
      if (!key) return send(res, 400, { error: '请先填写 API Key' });
      let request;
      try { request = modelsRequestFor(provider, key, provider === 'custom' ? cleanText(body.address, 500) : ''); }
      catch (error) { return send(res, 400, { error: error.message || '请求地址无效' }); }
      try {
        const response = await fetch(request.url, request.options);
        const result = await response.json();
        if (!response.ok) return send(res, 502, { error: `模型列表读取失败（${response.status}）：${cleanText(result.error?.message || result.error, 180) || '请检查密钥和请求地址'}` });
        const entries = provider === 'gemini' ? result.models : result.data;
        if (!Array.isArray(entries)) return send(res, 502, { error: '接口未返回可识别的模型列表' });
        const models = [...new Set(entries.map(item => provider === 'gemini' ? item.name?.replace(/^models\//, '') : item.id)
          .filter(id => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(id)))].sort();
        return send(res, 200, { models });
      } catch (error) { return send(res, 502, { error: `模型列表读取失败：${error.cause?.code || error.message}` }); }
    }
    if (req.method === 'POST' && route === '/api/ai/verify') {
      const provider = state.aiSettings.provider;
      const key = aiKey(provider);
      if (!key) return send(res, 400, { error: '请先保存 API Key' });
      const model = state.aiSettings.models[provider] || providers[provider].model;
      const sample = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
      const request = aiRequest(provider, model, key, sample.toString('base64'), '请用一个词描述这张图片。');
      try {
        const response = await fetch(request.url, request.options);
        const result = await response.json();
        if (!response.ok) return send(res, 502, { error: `接口返回 ${response.status}：${cleanText(result.error?.message, 180) || '请检查地址、密钥和模型'}` });
        if (!outputText(provider, result).trim()) return send(res, 502, { error: '接口已响应，但未返回可识别的文本内容' });
        return send(res, 200, { ok: true, message: '连接成功，模型支持图片输入' });
      } catch (error) { return send(res, 502, { error: `接口连接失败：${error.cause?.code || error.message}` }); }
    }
    if (req.method === 'POST' && route === '/api/import-pinterest') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const source = new URL(body.url);
      if (source.protocol !== 'https:' || source.hostname !== 'i.pinimg.com') return send(res, 400, { error: '仅支持 Pinterest 图片地址' });
      const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return send(res, 422, { error: '无法读取 Pinterest 图片' });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 30 * 1024 * 1024) return send(res, 413, { error: '图片超过 30 MB' });
      const ext = extensionByMime[response.headers.get('content-type').split(';')[0]];
      if (!ext) return send(res, 415, { error: '不支持此图片格式' });
      const parsed = await previewFor(buffer, ext);
      const id = crypto.randomUUID();
      const linkedPin = pinId(body.pinId);
      const image = { id, name: 'Pinterest 参考图', originalName: `pinterest-${id.slice(0, 8)}${ext}`, type: response.headers.get('content-type'), size: buffer.length, width: parsed.width, height: parsed.height, folderId: null, tags: [], related: [], note: linkedPin ? `https://www.pinterest.com/pin/${linkedPin}/` : source.href, favorite: false, createdAt: Date.now(), modifiedAt: Date.now(), ext, hasPreview: !!parsed.preview || !!parsed.reuseOriginal, animated: parsed.animated };
      image.storagePath = nextStoragePath(image);
      fs.writeFileSync(mediaPath(image), buffer);
      if (parsed.preview) fs.writeFileSync(imagePreviewPath(image), parsed.preview);
      state.images.unshift(image); state.imageOrder.unshift(id); save(); return send(res, 201, image);
    }
    if (req.method === 'POST' && route === '/api/tags') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const name = cleanText(body.name, 40);
      const parent = body.parent ? cleanText(body.parent, 80) : null;
      if (parent && !state.tags.some(tag => tag.key === parent && !tag.parent)) return send(res, 400, { error: '一级标签不存在' });
      const key = parent ? `${parent} / ${name}` : name;
      if (!name || name.includes('/') || state.tags.some(tag => tag.key === key)) return send(res, 400, { error: '标签名称无效或已存在' });
      const color = /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#506a51';
      const tag = { name, color, parent, key }; state.tags.push(tag); save(); return send(res, 201, tag);
    }
    const tagMatch = route.match(/^\/api\/tags\/([^/]+)$/);
    if (tagMatch) {
      const key = decodeURIComponent(tagMatch[1]);
      const tag = state.tags.find(item => item.key === key);
      if (!tag) return send(res, 404, { error: '标签不存在' });
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const name = cleanText(body.name, 40);
        const parent = 'parent' in body ? (body.parent ? cleanText(body.parent, 80) : null) : tag.parent;
        if (parent && (parent === key || !state.tags.some(item => item.key === parent && !item.parent))) return send(res, 400, { error: '只能拖到其他一级标签上' });
        if (parent && state.tags.some(item => item.parent === key)) return send(res, 400, { error: '包含子标签的标签不能变为二级标签' });
        const nextKey = parent ? `${parent} / ${name}` : name;
        const children = state.tags.filter(item => item.parent === key);
        if (!name || name.includes('/') || state.tags.some(item => item !== tag && item.key === nextKey) || children.some(child => state.tags.some(item => item !== child && item.key === `${nextKey} / ${child.name}`))) return send(res, 400, { error: '标签名称无效或已存在' });
        const changes = new Map([[tag.key, nextKey]]);
        for (const child of children) { changes.set(child.key, `${nextKey} / ${child.name}`); child.parent = nextKey; child.key = changes.get(child.key); }
        tag.name = name; tag.key = nextKey; tag.parent = parent;
        if (/^#[0-9a-f]{6}$/i.test(body.color)) tag.color = body.color;
        [...state.images, ...state.trash].forEach(image => { image.tags = image.tags.map(value => changes.get(value) || value); });
        save(); return send(res, 200, { tags: state.tags, images: state.images, changes: Object.fromEntries(changes) });
      }
      if (req.method === 'DELETE') {
        const removed = new Set(tagFamily(key));
        state.tags = state.tags.filter(item => !removed.has(item.key));
        [...state.images, ...state.trash].forEach(image => { image.tags = image.tags.filter(value => !removed.has(value)); });
        save(); return send(res, 200, { ok: true });
      }
    }
    const iconMatch = route.match(/^\/api\/icons\/([a-zA-Z]+)$/);
    if (iconMatch && iconKeys.has(iconMatch[1])) {
      const key = iconMatch[1];
      if (req.method === 'POST') {
        const type = (req.headers['content-type'] || '').split(';')[0];
        if (!['image/png', 'image/svg+xml'].includes(type)) return send(res, 415, { error: '图标仅支持 PNG 或 SVG' });
        const buffer = await readBody(req, 2 * 1024 * 1024);
        if (type === 'image/svg+xml' && (/<script|on\w+\s*=|<foreignObject/i.test(buffer.toString()) || !buffer.toString().includes('<svg'))) return send(res, 400, { error: 'SVG 含不安全内容' });
        const ext = type === 'image/png' ? '.png' : '.svg';
        fs.writeFileSync(path.join(iconDir, key + ext), buffer);
        state.icons[key] = ext; save(); return send(res, 200, { key, ext });
      }
      if (req.method === 'DELETE') { delete state.icons[key]; save(); return send(res, 200, { ok: true }); }
    }
    if (req.method === 'GET' && route.startsWith('/icons/')) {
      const key = route.slice(7);
      if (!iconKeys.has(key) || !state.icons[key]) return send(res, 404, { error: '图标不存在' });
      return fileResponse(res, path.join(iconDir, key + state.icons[key]));
    }
    if (req.method === 'POST' && route === '/api/folders') {
      const body = JSON.parse((await readBody(req, 10240)).toString());
      const name = cleanText(body.name, 80);
      if (!name) return send(res, 400, { error: '请输入文件夹名称' });
      const parentId = body.parentId || null;
      if (parentId && !state.folders.some(folder => folder.id === parentId)) return send(res, 400, { error: '上级文件夹不存在' });
      const folder = { id: crypto.randomUUID(), name, parentId, color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null, diskName: uniqueFolderDiskName(name, parentId), createdAt: Date.now() };
      fs.mkdirSync(path.join(mediaDir, folderDiskPath(parentId), folder.diskName), { recursive: true });
      state.folders.push(folder); save(); return send(res, 201, folder);
    }
    const folderOpenMatch = route.match(/^\/api\/folders\/([a-f0-9-]+)\/open$/);
    if (req.method === 'POST' && folderOpenMatch) {
      const folder = state.folders.find(item => item.id === folderOpenMatch[1]);
      if (!folder) return send(res, 404, { error: '文件夹不存在' });
      const directory = path.resolve(mediaDir, folderDiskPath(folder.id));
      if (!directory.startsWith(path.resolve(mediaDir) + path.sep)) return send(res, 400, { error: '目录路径无效' });
      fs.mkdirSync(directory, { recursive: true });
      if (process.platform !== 'win32') return send(res, 400, { error: '请在 Windows 上使用此功能' });
      const { spawn } = require('child_process');
      await new Promise((resolve, reject) => {
        const child = spawn('explorer.exe', [directory], { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('spawn', () => { child.unref(); resolve(); });
        child.once('error', reject);
      });
      return send(res, 200, { ok: true });
    }
    const folderMatch = route.match(/^\/api\/folders\/([a-f0-9-]+)$/);
    if (folderMatch) {
      const folder = state.folders.find(item => item.id === folderMatch[1]);
      if (!folder) return send(res, 404, { error: '文件夹不存在' });
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 10240)).toString());
        const name = cleanText(body.name, 80);
        if ('name' in body && !name) return send(res, 400, { error: '请输入文件夹名称' });
        const parentId = 'parentId' in body ? (body.parentId || null) : (folder.parentId || null);
        if (parentId && !state.folders.some(item => item.id === parentId)) return send(res, 400, { error: '上级文件夹不存在' });
        let ancestor = parentId;
        const visited = new Set();
        while (ancestor) {
          if (ancestor === folder.id || visited.has(ancestor)) return send(res, 400, { error: '不能移动到自身或子文件夹中' });
          visited.add(ancestor); ancestor = state.folders.find(item => item.id === ancestor)?.parentId;
        }
        if ('color' in body && body.color !== null && !/^#[0-9a-f]{6}$/i.test(body.color)) return send(res, 400, { error: '颜色格式无效' });
        if (('name' in body && name !== folder.name) || parentId !== (folder.parentId || null)) {
          renameFolder(folder, 'name' in body ? name : folder.name, parentId);
        }
        if ('color' in body) {
          if (body.color !== null && !/^#[0-9a-f]{6}$/i.test(body.color)) return send(res, 400, { error: '颜色格式无效' });
          folder.color = body.color;
        }
        if ('coverId' in body && state.images.some(image => image.id === body.coverId && image.folderId === folder.id)) folder.coverId = body.coverId;
        save(); return send(res, 200, folder);
      }
      if (req.method === 'DELETE') {
        const removed = new Set([folder.id]);
        let changed;
        do {
          changed = false;
          for (const item of state.folders) {
            if (removed.has(item.parentId) && !removed.has(item.id)) { removed.add(item.id); changed = true; }
          }
        } while (changed);
        boardLibrary.removeFolders(removed);
        for (const image of [...state.images, ...state.trash]) if (removed.has(image.folderId)) relocateImage(image, null);
        const directories = [...removed].map(id => path.join(mediaDir, folderDiskPath(id))).sort((a, b) => b.length - a.length);
        for (const directory of directories) {
          try { fs.rmdirSync(directory); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; }
        }
        state.folders = state.folders.filter(item => !removed.has(item.id));
        save(); return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'POST' && route === '/api/images') {
      const type = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
      const originalName = cleanText(decodeURIComponent(req.headers['x-file-name'] || '未命名图片'), 240);
      const ext = path.extname(originalName).toLowerCase() || extensionByMime[type];
      if (!supported.has(ext)) return send(res, 415, { error: '不支持此文件格式' });
      const buffer = await readBody(req, 120 * 1024 * 1024);
      if (!buffer.length) return send(res, 400, { error: '文件为空' });
      const id = crypto.randomUUID();
      const folderId = state.folders.some(item => item.id === req.headers['x-folder-id']) ? req.headers['x-folder-id'] : null;
      let parsed;
      try { parsed = await previewFor(buffer, ext); }
      catch (error) { return send(res, 422, { error: `无法解析 ${ext.toUpperCase()}：${error.message}` }); }
      const { contentHash, imageHash, imageColor, matches } = await duplicateCandidates(buffer, parsed);
      const action = req.headers['x-duplicate-action'];
      if (matches.length && !['keep', 'merge', 'skip'].includes(action)) return send(res, 409, { error: '发现重复图片', matches });
      if (matches.length && action === 'skip') return send(res, 200, { skipped: true });
      const inherited = action === 'merge' ? state.images.find(item => item.id === matches[0]?.id) : null;
      const image = { id, name: originalName.replace(/\.[^.]+$/, '') || '未命名图片', originalName, type: type || 'application/octet-stream', size: buffer.length, width: parsed.width, height: parsed.height, folderId, tags: inherited ? [...inherited.tags] : [], related: [], note: '', favorite: false, createdAt: Date.now(), modifiedAt: Date.now(), sourceModifiedAt: Number(req.headers['x-modified-at']) || null, ext, hasPreview: !!parsed.preview || !!parsed.reuseOriginal, animated: parsed.animated, contentHash, visualHash: imageHash, visualColor: imageColor };
      image.storagePath = nextStoragePath(image);
      fs.mkdirSync(path.dirname(mediaPath(image)), { recursive: true });
      fs.writeFileSync(mediaPath(image), buffer);
      if (parsed.preview) fs.writeFileSync(imagePreviewPath(image), parsed.preview);
      state.images.unshift(image); state.imageOrder.unshift(id); save(); return send(res, 201, image);
    }
    const relatedMatch = route.match(/^\/api\/images\/([a-f0-9-]+)\/related(?:\/([a-f0-9-]+))?$/);
    if (relatedMatch) {
      const image = state.images.find(item => item.id === relatedMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const otherId = relatedMatch[2];
      const other = state.images.find(item => item.id === otherId);
      if (req.method === 'POST' && !otherId) {
        const body = JSON.parse((await readBody(req, 1024)).toString());
        const peer = state.images.find(item => item.id === body.relatedId);
        if (!peer || peer.id === image.id) return send(res, 400, { error: '请选择另一张图库图片' });
        if (!image.related.some(item => item.id === peer.id)) image.related.push({ id: peer.id, locked: false });
        if (!peer.related.some(item => item.id === image.id)) peer.related.push({ id: image.id, locked: false });
        save(); return send(res, 200, { image, peer });
      }
      if (!other || !image.related.some(item => item.id === other.id)) return send(res, 404, { error: '关联不存在' });
      if (req.method === 'DELETE') {
        image.related = image.related.filter(item => item.id !== other.id);
        other.related = other.related.filter(item => item.id !== image.id);
        save(); return send(res, 200, { image, peer: other });
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 1024)).toString());
        const link = image.related.find(item => item.id === other.id);
        if (typeof body.locked !== 'boolean') return send(res, 400, { error: '锁定状态无效' });
        link.locked = body.locked;
        save(); return send(res, 200, image);
      }
    }
    const orderMatch = route.match(/^\/api\/images\/([a-f0-9-]+)\/related-order$/);
    if (orderMatch && req.method === 'PATCH') {
      const image = state.images.find(item => item.id === orderMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const body = JSON.parse((await readBody(req, 1024)).toString());
      const from = image.related.findIndex(item => item.id === body.sourceId);
      const to = image.related.findIndex(item => item.id === body.targetId);
      if (from < 0 || to < 0 || image.related[from].locked || image.related[to].locked) return send(res, 409, { error: '锁定的关联图片不能换位' });
      [image.related[from], image.related[to]] = [image.related[to], image.related[from]];
      save(); return send(res, 200, image);
    }
    const imageMatch = route.match(/^\/api\/images\/([a-f0-9-]+)$/);
    if (imageMatch) {
      const image = state.images.find(item => item.id === imageMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 102400)).toString());
        if ('name' in body) image.name = cleanText(body.name, 240) || image.name;
        if ('note' in body) image.note = cleanText(body.note, 3000);
        if ('favorite' in body) image.favorite = Boolean(body.favorite);
        if ('tags' in body) image.tags = uniqueTags(body.tags);
        if ('folderId' in body) {
          const folderId = state.folders.some(item => item.id === body.folderId) ? body.folderId : null;
          if (folderId !== image.folderId) relocateImage(image, folderId);
        }
        image.modifiedAt = Date.now(); save(); return send(res, 200, image);
      }
      if (req.method === 'DELETE') {
        const result=await withBoardLock(()=>boardLibrary.trashImages([image.id],req.headers['x-confirm-board-delete']==='1'));
        if(result.needsConfirmation)return send(res,409,{...result,error:'删除后将同步移除关联画板中的此素材，并放入回收站。'});
        return send(res, 200, { ok: true });
      }
    }
    const analyzeMatch = route.match(/^\/api\/images\/([a-f0-9-]+)\/analyze$/);
    if (analyzeMatch && req.method === 'POST') {
      const image = state.images.find(item => item.id === analyzeMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const provider = state.aiSettings.provider;
      const key = aiKey(provider);
      if (!key) return send(res, 400, { error: `请先在设置中填写 ${aiLabel(provider)} API Key` });
      if (image.hasPreview === false) return send(res, 422, { error: '此文件暂无可分析的预览图' });
      const source = previewPathFor(image);
      const jpeg = await sharp(source).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      const model = state.aiSettings.models[provider] || providers[provider].model;
      const request = aiRequest(provider, model, key, jpeg.toString('base64'));
      const response = await fetch(request.url, request.options);
      const result = await response.json();
      if (!response.ok) return send(res, response.status, { error: result.error?.message || 'AI 服务请求失败' });
      const output = outputText(provider, result);
      let parsed;
      try { parsed = parseAnalysis(output); }
      catch { return send(res, 502, { error: 'AI 返回格式无法解析，请重试' }); }
      if (typeof parsed.analysis !== 'string' || typeof parsed.prompt !== 'string') return send(res, 502, { error: 'AI 返回内容不完整，请重试' });
      image.ai = { analysis: cleanText(parsed.analysis, 5000), prompt: cleanText(parsed.prompt, 5000), provider, model, updatedAt: Date.now() };
      save(); return send(res, 200, image.ai);
    }
    const convertMatch = route.match(/^\/api\/images\/([a-f0-9-]+)\/convert$/);
    if (convertMatch && req.method === 'POST') {
      const image = state.images.find(item => item.id === convertMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const { format } = JSON.parse((await readBody(req, 1024)).toString());
      const formats = { png: '.png', jpeg: '.jpg', webp: '.webp', avif: '.avif', tiff: '.tiff', tga: '.tga', bmp: '.bmp' };
      if (!Object.hasOwn(formats, format)) return send(res, 400, { error: '不支持此转换格式' });
      if (!image.hasPreview) return send(res, 422, { error: '原图没有可转换的预览内容' });
      try {
        const source = ordinary.has(image.ext) || decoded.has(image.ext)
          ? rasterInputFor(fs.readFileSync(mediaPath(image)), image.ext)
          : { input: fs.readFileSync(imagePreviewPath(image)) };
        let buffer;
        if (format === 'tga' || format === 'bmp') buffer = await encodeRasterFor(source.input, source.options, format);
        else {
          const pipeline = sharp(source.input, { ...source.options, animated: false }).rotate();
          if (format === 'jpeg') pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 92 });
          else if (format === 'png') pipeline.png();
          else if (format === 'webp') pipeline.webp({ quality: 90 });
          else if (format === 'avif') pipeline.avif({ quality: 75 });
          else pipeline.tiff({ compression: 'lzw' });
          buffer = await pipeline.toBuffer();
        }
        const parsed = await previewFor(buffer, formats[format]);
        const id = crypto.randomUUID();
        const ext = formats[format];
        const converted = { ...image, id, name: `${image.name} (${format.toUpperCase()})`, originalName: `${image.name} (${format.toUpperCase()})${ext}`, type: mimeByExt[ext], ext, size: buffer.length, width: parsed.width, height: parsed.height, hasPreview: true, animated: false, related: [], ai: undefined, createdAt: Date.now(), modifiedAt: Date.now(), sourceModifiedAt: null };
        converted.storagePath = nextStoragePath(converted);
        const output = mediaPath(converted);
        const preview = imagePreviewPath(converted);
        try {
          fs.writeFileSync(output, buffer);
          if (parsed.preview) fs.writeFileSync(preview, parsed.preview);
          state.images.unshift(converted);
          state.imageOrder.unshift(id);
          save();
        } catch (error) {
          state.images = state.images.filter(item => item.id !== id);
          state.imageOrder = state.imageOrder.filter(item => item !== id);
          fs.rmSync(output, { force: true });
          fs.rmSync(preview, { force: true });
          throw error;
        }
        return send(res, 201, converted);
      } catch (error) { return send(res, 422, { error: `格式转换失败：${error.message}` }); }
    }
    const trashMatch = route.match(/^\/api\/trash\/([a-f0-9-]+)\/(restore|delete)$/);
    if (trashMatch && req.method === 'POST') {
      const image = state.trash.find(item => item.id === trashMatch[1]);
      if (!image) return send(res, 404, { error: '回收站中没有此图片' });
      state.trash = state.trash.filter(item => item.id !== image.id);
      if (trashMatch[2] === 'restore') { boardLibrary.restoreMedia(image); }
      else {
        if(image.contentHash)state.boardDeletedHashes=[...new Set([...(state.boardDeletedHashes||[]),image.contentHash])];
        [...state.images, ...state.trash].forEach(item => { item.related = item.related.filter(link => link.id !== image.id); });
        const root = state.syncRoots.find(item => image.sourcePath?.startsWith(item.path + path.sep));
        if (root) root.ignored = [...new Set([...(root.ignored || []), image.sourcePath])];
        fs.rmSync(mediaPath(image), { force: true }); fs.rmSync(imagePreviewPath(image), { force: true });
      }
      save(); return send(res, 200, { ok: true, image });
    }
    const actionMatch = route.match(/^\/api\/images\/([a-f0-9-]+)\/(copy|show|open)$/);
    if (actionMatch && req.method === 'POST') {
      const image = state.images.find(item => item.id === actionMatch[1]);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const file = mediaPath(image);
      if (actionMatch[2] === 'copy') {
        const id = crypto.randomUUID(); const copy = { ...image, id, related: [], name: image.name + ' 副本', createdAt: Date.now(), modifiedAt: Date.now() };
        copy.storagePath = nextStoragePath(copy);
        fs.copyFileSync(file, mediaPath(copy));
        const preview = imagePreviewPath(image);
        if (image.hasPreview && fs.existsSync(preview)) fs.copyFileSync(preview, imagePreviewPath(copy));
        state.images.unshift(copy); save(); return send(res, 201, copy);
      }
      if (process.env.TAURI_BACKEND === '1' && process.platform === 'win32') {
        const { spawn } = require('child_process');
        const command = actionMatch[2] === 'show' ? 'explorer.exe' : 'rundll32.exe';
        const args = actionMatch[2] === 'show' ? ['/select,', file] : ['url.dll,FileProtocolHandler', file];
        await new Promise((resolve, reject) => {
          const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
          child.once('spawn', () => { child.unref(); resolve(); });
          child.once('error', reject);
        });
      } else {
        if (!process.versions.electron) return send(res, 400, { error: '请在桌面应用中使用此功能' });
        const { shell } = require('electron');
        if (actionMatch[2] === 'show') shell.showItemInFolder(file);
        else {
          const error = await shell.openPath(file);
          if (error) return send(res, 422, { error: `无法打开文件：${error}` });
        }
      }
      return send(res, 200, { ok: true });
    }
    if (['GET', 'HEAD'].includes(req.method) && route.startsWith('/media/')) {
      const id = route.slice(7);
      const image = [...state.images, ...state.trash].find(item => item.id === id);
      return image ? fileResponse(res, mediaPath(image), undefined, req) : send(res, 404, { error: '图片不存在' });
    }
    if (req.method === 'GET' && route.startsWith('/canvas-image/')) {
      const id = route.slice('/canvas-image/'.length);
      const image = [...state.images, ...state.trash].find(item => item.id === id);
      if (!image) return send(res, 404, { error: '图片不存在' });
      if (url.searchParams.has('edge') && (ordinary.has(image.ext) || decoded.has(image.ext))) {
        const edge=Number(url.searchParams.get('edge'));
        if (![512,1024,2048,4096,8192].includes(edge)) return send(res,400,{error:'图片尺寸无效'});
        const raster=rasterInputFor(fs.readFileSync(mediaPath(image)),image.ext);
        const pixels=await sharp(raster.input,raster.options).rotate().resize(edge,edge,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=3600'});
        return res.end(pixels);
      }
      // Browser-native images retain their original pixels and animation.
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(image.ext)) return fileResponse(res, mediaPath(image));
      // Decode TIFF/TGA/BMP/PSD at source resolution; other professional formats
      // can only supply the embedded preview available to the existing decoder.
      const parsed = await previewFor(fs.readFileSync(mediaPath(image)), image.ext, { fullResolution: true });
      if (!parsed.preview) return send(res, 404, { error: '图片无法解码' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
      return res.end(parsed.preview);
    }
    if (req.method === 'GET' && route.startsWith('/preview/')) {
      const id = route.slice(9); const image = [...state.images, ...state.trash].find(item => item.id === id);
      if (!image) return send(res, 404, { error: '图片不存在' });
      const original = mediaPath(image);
      let animated = image.animated || image.ext === '.gif';
      if (image.animated === undefined && ['.png', '.webp', '.avif'].includes(image.ext)) {
        try { animated = ((await sharp(original).metadata()).pages || 1) > 1; }
        catch { animated = false; }
        image.animated = animated;
      }
      return fileResponse(res, animated ? original : previewPathFor(image));
    }
    if (req.method === 'GET' && route === '/api/export') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="reference-board-library.json"' });
      return res.end(JSON.stringify(state, null, 2));
    }
    if (req.method === 'GET' && ['/', '/index.html', '/search-bar.html', '/image-search-window.html', '/image-search-window.js', '/image-search.js', '/image-search.css', '/app.css', '/journal.css', '/atlas.css', '/atlas-tuning.css', '/improvements.css', '/improvements.js', '/app.js', '/search-bar.js', '/lucide.min.js', '/botanical-plate.svg', '/field-map.svg', '/update-ui.js', '/workspace-switch.js', '/workspace-selection.js', '/workspace-switch.css', '/workspace-windows.js', '/album.css', '/album.js', '/whale.css', '/wave.css', '/whale.js', '/attribution.html'].includes(route)) {
      return fileResponse(res, path.join(root, route === '/' ? 'index.html' : route.slice(1)), 'no-store');
    }
    send(res, 404, { error: '未找到页面' });
  } catch (error) {
    if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.message || '服务器错误' });
  }
});

function startServer(port = Number(process.env.PORT) || 4173) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      console.log(`Reference Board: http://127.0.0.1:${address.port}`);
      resolve(address.port);
    });
  });
}

if (require.main === module) startServer().catch(error => { console.error(error); process.exitCode = 1; });
function imageFiles(ids) { return ids.map(id => state.images.find(image => image.id === id)).filter(Boolean).map(image => ({ file: mediaPath(image), name: path.basename(image.originalName || `${image.name}${image.ext}`), icon: previewPathFor(image) })); }
module.exports = { startServer, server, imageFiles };

