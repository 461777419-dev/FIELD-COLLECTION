# 图集 · 参考图管理

本地参考图管理工具。支持拖入图片或文件夹、两级标签、收藏、搜索、手动排序、备注、回收站和大图预览。

## 启动

需要 Node.js 18 或更新版本。在本目录运行：

```powershell
npm start
```

随后打开 `http://127.0.0.1:4173`。服务仅监听本机地址。若 4173 端口已占用，可在 PowerShell 中运行 `$env:PORT=4175; npm start`，然后打开 `http://127.0.0.1:4175`。

浏览器运行时，图片与元数据保存在本目录的 `data/` 中。Tauri 桌面版保存在应用数据目录，并优先复用 `%APPDATA%\探索者图集\library` 中的旧图库。左下角下载按钮只导出图库目录 JSON，不包含图片文件。迁移图库时需保留整个图库数据目录。

支持 PNG、JPG、WebP、GIF、AVIF、TIFF、TGA、BMP、PSD/PSB，以及 MP4、WebM、MOV 等视频导入；视频能否内嵌播放取决于 Windows WebView2 支持的编码，失败时可使用系统播放器打开。AI 的 PDF 兼容文件可渲染首页。CLIP、EPS 和 RAW 尝试提取内嵌预览，无内嵌预览时会显示提示。单文件上限 120 MB。

## Windows 桌面版

设置中的“自定义平台”支持 OpenAI 兼容的视觉聊天接口。可填写平台名称、基础地址或完整 `/chat/completions` 地址、模型名和 API Key；保存后可用“验证接口与图片识别”检查。测试会向该服务发送一张 1 像素图片。Tauri 版 API Key 使用 Windows 当前用户加密保存，换电脑或换 Windows 用户需重新填写。桌面版启动本地 Node 服务时隐藏命令窗口，服务日志仍保存在图库目录。

应用名称为“图集”，安装界面使用简体中文，桌面图标来自 `assets/app-icon.png`。Pinterest 图搜图可拖入本地图片或图库图片；它先使用设置中的视觉模型生成搜索词，再检索 Pinterest 图片。图搜图需要可处理图片的 AI 模型和对应 API Key；真实结果也取决于 Pinterest 搜索接口是否可用。
Windows 版关闭 Tauri 内置拖放接管，让网页接收文件及图库内拖动事件。GIF、动态 WebP 和 APNG 等动图在图库和预览中使用原文件播放；AI 分析仍使用静态首帧。
图库空白处可拖框多选，并在详情区批量添加标签、加入收藏、移动文件夹或移至回收站。图片拖到“我的收藏”会收藏，拖到“回收站”会移入回收站；回收站图片可拖回“所有图片”或“我的收藏”恢复。所有图片中的卡片拖动只更改手动顺序，不创建副本。外部图片直接拖到 Pinterest 面板只用于搜索，不导入图库。

桌面壳使用 Tauri 2，现有 Node 图库服务作为打包资源随应用启动。构建机需要 Rust stable、Cargo、Microsoft C++ Build Tools、WebView2 和 Node.js 18+。运行 `npm ci`，再运行 `npm run build:win`，生成 NSIS 安装包。`npm run desktop` 启动开发版。

Tauri 启动时会优先使用 `%APPDATA%\探索者图集\library` 中的旧图库；没有旧图库时使用 Tauri 应用数据目录。打包时只将生产依赖与 Node 运行时复制到应用资源中，不包含图库数据。

“所有图片”中的卡片可拖到另一张卡片前调整顺序；排序会切换为“手动排序”并保存。其他视图仍可通过拖动建立手动关联。

Pinterest 面板输入 Pin 链接时调用官网 `RelatedModulesResource` 获取该 Pin 的“更多类似”结果。该接口需要登录态：在设置中粘贴 Pinterest Cookie 请求头，Cookie 仅存于当前服务进程内存，不写入磁盘。关键词输入仍可单独搜索，但关键词结果不是 Pin 的相似推荐。点击结果图片可继续查看该 Pin 的相似图片，下载按钮将原图加入图库。Pinterest 网页接口可能变化或限流，失败时会显示错误。
