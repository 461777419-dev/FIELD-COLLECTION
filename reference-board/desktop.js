const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, dialog, shell, ipcMain, nativeImage } = require('electron');

if (process.env.REFERENCE_BOARD_USER_DATA_DIR) {
  fs.mkdirSync(process.env.REFERENCE_BOARD_USER_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.REFERENCE_BOARD_USER_DATA_DIR);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow;
  let localServer;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      process.env.REFERENCE_BOARD_DATA_DIR = path.join(app.getPath('userData'), 'library');
      const { startServer, server, imageFiles } = require('./server');
      localServer = server;
      ipcMain.on('drag-images-out', (event, ids) => {
        if (!Array.isArray(ids) || ids.length > 100) return;
        const files = imageFiles(ids).filter(item => fs.existsSync(item.file));
        if (!files.length) return;
        const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-journal-drag-'));
        const exported = files.map((item, index) => { const name = path.basename(item.name).replace(/[<>:"/\\|?*]/g, '_'); const target = path.join(exportDir, `${index + 1}-${name}`); fs.copyFileSync(item.file, target); return target; });
        const iconPath = fs.existsSync(files[0].icon) ? files[0].icon : files[0].file;
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 96, height: 96 });
        event.sender.startDrag({ files: exported, icon });
      });
      const port = await startServer(0);
      const origin = `http://127.0.0.1:${port}`;

      mainWindow = new BrowserWindow({
        width: 1360,
        height: 900,
        minWidth: 760,
        minHeight: 560,
        title: '探索者图集',
        backgroundColor: '#382217',
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') }
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
      });
      await mainWindow.loadURL(origin);
    } catch (error) {
      dialog.showErrorBox('无法启动探索者图集', error.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => localServer?.close());
}
