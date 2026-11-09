# 图集 v1.0.4 源码与构建

本次提交对应已发布的 Windows x64 安装包：
`Field-Collection_1.0.4_x64-setup.exe`。

安装包 SHA256：
`922a87054faf7221f27af36c02b6ca2168f0e6989f23f8fbd908633e4628b397`。

## 目录

- `reference-board/`：图集界面、本地 Node 服务、Tauri 桌面壳、自动更新及相关测试。
- `artflow-integrated/`：整合画板的 React / TypeScript 源码、Doro 主题、素材互通和画板资源。
- `CHANGELOG-1.0.4.md`：本次正式版本更新说明。

根目录原 README 及其图片保留。两份子项目 README 包含各自历史开发入口；整合版请以下列步骤为准。

## 环境

- Windows x64，Node.js 22.5+ 和 npm。
- Rust stable MSVC、Microsoft C++ Build Tools（Windows SDK）、WebView2。
- 首次安装依赖和 Tauri 构建工具时需要网络。

## 构建整合版

在仓库根目录依次执行：

```powershell
cd artflow-integrated
npm ci
npm run build -- --base=/board/ --outDir=../reference-board/board-dist --emptyOutDir
cd ../reference-board
npm ci
npm run build:win
```

默认安装包位于：
`reference-board/src-tauri/target/release/bundle/nsis/图集_1.0.4_x64-setup.exe`。
若设置了 `CARGO_TARGET_DIR`，则使用对应目标目录。
发布附件采用英文名以避免 GitHub 自动调整中文文件名；改名不改变安装包内容。

开发预览：先按上述步骤构建画板，然后在 `reference-board/` 运行 `npm start`，打开终端显示的本地地址。
桌面开发模式在同目录运行 `npm run desktop`。

## 版本与发布历史

本次为正式发布版本 1.0.4，包含画板图片拖出与图集/画板选中联动更新。
版本号统一位于图集的 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 与 `src-tauri/tauri.conf.json`。
画板保留其原子项目版本号，并非整合版发行版本。

v1.0.4 为新的正式发布；此前 v1.0.3 安装包、发布说明和标签保留。
本次 v1.0.4 修订替换现有发布附件，包含自动更新安装助手启动修复；旧版或早期 v1.0.4 需手动覆盖安装一次。安装助手已在隔离 Windows 测试中验证后端退出后的安装与重启。
v1.0.4 标签同步指向本次源码提交，GitHub 的 Source code 下载与该提交一致。构建工具、运行时和打包元数据可能变化，因此不承诺重建 EXE 字节级一致。

## 更新签名与用户数据

`reference-board/update-config.json` 只包含公共更新仓库和签名公钥；源码没有签名私钥、真实 API Key、用户图库或构建机器的运行时依赖。
官方签名私钥由维护者在仓库外保管，不随源码或安装包公开。
发布操作参见 `reference-board/自动更新发布说明.md`，新维护者应使用自己的密钥和仓库配置。
不要在画板 `.env.local` 填入密钥后公开分发前端构建；正式整合版优先通过图集共用 AI 设置在运行时配置。

## 更新流程测试

在 `reference-board/` 中：

```powershell
node --test tests/app-updater.test.cjs tests/update-ui.test.cjs tests/update-install-helper.test.cjs
```

Windows 安装助手测试使用隔离目录及测试安装器，不会覆盖用户已安装的图集。
真实模型和用户环境中的覆盖升级仍需使用有效配置单独验收。
