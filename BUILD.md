# 图集 v1.0.5 源码与构建

Windows x64 安装包：`Field-Collection_1.0.5_x64-setup.exe`。

安装包 SHA256：`a6af062adc54ff6cc65a6342d354136fb2425f8dd8239a7219eead14da73a112`。

## 目录

- `reference-board/`：图集界面、本地 Node 服务、Tauri 桌面壳与自动更新。
- `artflow-integrated/`：整合画板 React / TypeScript 源码。
- `CHANGELOG-1.0.5.md`：本版更新说明。

## 构建

需要 Windows x64、Node.js 22.5+、Rust stable MSVC、Microsoft C++ Build Tools（含 Windows SDK）和 WebView2。首次安装依赖需要网络。

在仓库根目录依次运行：

```powershell
cd artflow-integrated
npm ci
npm run build -- --base=/board/ --outDir=../reference-board/board-dist --emptyOutDir
cd ../reference-board
npm ci
npm run build:win
```

安装包默认位于 `reference-board/src-tauri/target/release/bundle/nsis/图集_1.0.5_x64-setup.exe`。发布时使用英文文件名，改名不改变内容。GitHub 标签 v1.0.5 与本版源码对应；旧版本保留。构建元数据和依赖工具可能变化，不承诺重建 EXE 字节级一致。

开发预览：先构建画板，再在 `reference-board/` 运行 `npm start`。桌面开发使用 `npm run desktop`。

PPT／PPTX 转换需要本机安装 Microsoft PowerPoint，单份上限 512MB、200 页。便携项目素材合计上限 256MB，大规模迁移使用原有完整备份。查重仅提供候选，不自动删除。

## 更新签名与用户数据

发行版本号统一位于 `reference-board/package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`tauri.conf.json`；画板子项目版本号单独保留。

`update-config.json` 只含公共仓库及签名公钥。Ed25519 私钥由维护者在仓库外保管，不随源码或安装包分发。更新清单及 SHA256SUMS.txt 用于验证附件完整性，更新签名不是 Windows Authenticode 代码签名。

源码不包含真实 API Key、用户图库、运行时依赖及私钥。前端环境变量会进入浏览器构建，正式版通过图集设置在运行时配置 API。

预览功能检查和隔离测试不替代真实用户环境中的覆盖升级验收。
