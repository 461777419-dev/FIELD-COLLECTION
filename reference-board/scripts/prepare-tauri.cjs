const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const generateIcons = require('./generate-icons.cjs');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'src-tauri', 'resources', 'runtime');
fs.mkdirSync(runtime, { recursive: true });
const frontend = path.join(root, 'src-tauri', 'frontend');
fs.mkdirSync(frontend, { recursive: true });
const files = [
  'server.js', 'app-updater.js', 'update-install-helper.ps1', 'update-config.json', 'update-ui.js', 'pinterest-search.js', 'ai-providers.js', 'shared-ai.js', 'media-preview.js',
  'index.html', 'app.js', 'search-bar.js', 'improvements.js', 'app.css', 'journal.css',
  'atlas.css', 'atlas-tuning.css', 'improvements.css', 'lucide.min.js',
  'botanical-plate.svg', 'field-map.svg', 'package.json', 'package-lock.json',
  'image-search.js', 'image-search.css', 'image-search-window.html', 'image-search-window.js', 'search-providers.json',
  'album.css', 'album.js', 'whale.css', 'wave.css', 'whale.js', 'attribution.html',
  'workspace-switch.js', 'workspace-selection.js', 'workspace-switch.css', 'workspace-windows.js', 'board-library.js'
];
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(runtime, file));
fs.cpSync(path.join(root, 'assets', 'search-sites'), path.join(runtime, 'assets', 'search-sites'), { recursive:true });
if (!fs.existsSync(path.join(root, 'board-dist', 'index.html'))) throw new Error('请先构建整合画板到 board-dist，再准备桌面资源');
// Vite filenames change between builds; remove only the generated board bundle.
fs.rmSync(path.join(runtime, 'board-dist'), {recursive:true,force:true});
fs.cpSync(path.join(root, 'board-dist'), path.join(runtime, 'board-dist'), { recursive: true });
for (const destination of [runtime, frontend]) {
  fs.mkdirSync(path.join(destination, 'assets'), { recursive: true });
  for (const name of ['all-images.png', 'related-images.png', 'whale-album.png']) fs.copyFileSync(path.join(root, 'assets', name), path.join(destination, 'assets', name));
  fs.copyFileSync(path.join(root, 'assets', 'app-icon.png'), path.join(destination, 'assets', 'app-icon.png'));
  fs.copyFileSync(path.join(root, 'assets', 'observation-note.svg'), path.join(destination, 'assets', 'observation-note.svg'));
  fs.cpSync(path.join(root, 'assets', 'whale'), path.join(destination, 'assets', 'whale'), { recursive: true });
  fs.cpSync(path.join(root, 'assets', 'doro'), path.join(destination, 'assets', 'doro'), { recursive: true });
}
for (const file of files.filter(file => /\.(?:html|css|js|svg)$/.test(file) && !['app-updater.js', 'server.js', 'pinterest-search.js', 'ai-providers.js', 'media-preview.js'].includes(file))) fs.copyFileSync(path.join(root, file), path.join(frontend, file));
const npm = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs = process.platform === 'win32' ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')] : [];
const install = spawnSync(npm, [...npmArgs, 'ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund', '--cache', path.join(root, '.tauri-npm-cache')], { cwd: runtime, stdio: 'inherit' });
if (install.status !== 0) throw new Error('Tauri runtime dependencies could not be installed');
const packages = path.join(runtime, 'node_modules');
for (const directory of [
  'pdfjs-dist/build', 'pdfjs-dist/web', 'pdfjs-dist/types',
  'ag-psd/.v8-cache', 'ag-psd/src', 'ag-psd/dist-es'
]) fs.rmSync(path.join(packages, directory), { recursive: true, force: true });
for (const directory of ['pdfjs-dist/legacy/build', 'ag-psd/dist']) {
  for (const entry of fs.readdirSync(path.join(packages, directory))) {
    if (entry.endsWith('.map')) fs.rmSync(path.join(packages, directory, entry));
  }
}
fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));

(async () => {
  await generateIcons();
  console.log('Tauri runtime prepared');
})().catch(error => { console.error(error); process.exitCode = 1; });
