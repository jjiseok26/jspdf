const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const fsSync = require('fs');

const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
const appIcon = nativeImage.createFromPath(iconPath);

if (process.platform === 'win32') {
  app.setAppUserModelId('com.jspdf.app');
}

let mainWindow = null;
let pendingFile = null;
let rendererReady = false;

// 연결 프로그램/드래그 실행 시 실행 인수로 들어오는 PDF 경로를 골라낸다.
function pdfFromArgv(argv) {
  return argv.slice(1).find((arg) => arg.toLowerCase().endsWith('.pdf') && fsSync.existsSync(arg)) || null;
}

async function sendFileToRenderer(filePath) {
  if (!filePath || !mainWindow) return;
  const payload = {
    name: path.basename(filePath),
    path: filePath,
    data: await fs.readFile(filePath)
  };
  if (rendererReady) {
    mainWindow.webContents.send('file:openExternal', payload);
  } else {
    pendingFile = filePath;
  }
}

ipcMain.on('file:ready', async () => {
  rendererReady = true;
  if (pendingFile) {
    const filePath = pendingFile;
    pendingFile = null;
    await sendFileToRenderer(filePath);
  }
});

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1f2126',
    title: 'JSPDF',
    icon: appIcon.isEmpty() ? path.join(__dirname, '..', '..', 'build', 'icon.ico') : appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.env.PDFSTUDIO_DEBUG) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    sendFileToRenderer(pdfFromArgv(argv));
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    sendFileToRenderer(filePath);
  });

  app.whenReady().then(() => {
    pendingFile = pdfFromArgv(process.argv);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function readFiles(paths) {
  return Promise.all(
    paths.map(async (p) => ({
      path: p,
      name: path.basename(p),
      data: await fs.readFile(p)
    }))
  );
}

ipcMain.handle('file:open', async (_e, { filters, multi }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return readFiles(result.filePaths);
});

ipcMain.handle('file:save', async (_e, { defaultName, filters, data, filePath }) => {
  if (filePath) {
    await fs.writeFile(filePath, Buffer.from(data));
    return filePath;
  }
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return result.filePath;
});

ipcMain.handle('print:pdf', async (_e, { data }) => {
  const tmpPath = path.join(os.tmpdir(), `jspdf-print-${Date.now()}.pdf`);
  await fs.writeFile(tmpPath, Buffer.from(data));
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true }
  });
  return new Promise((resolve) => {
    const cleanup = async () => {
      if (!printWin.isDestroyed()) printWin.destroy();
      await fs.unlink(tmpPath).catch(() => {});
    };
    printWin.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        printWin.webContents.print({ silent: false, printBackground: true }, async (success, failureReason) => {
          await cleanup();
          resolve({ success, failureReason: failureReason || null });
        });
      }, 600);
    });
    printWin.webContents.on('did-fail-load', async () => {
      await cleanup();
      resolve({ success: false, failureReason: 'PDF 로드 실패' });
    });
    printWin.loadURL(pathToFileURL(tmpPath).href);
  });
});

ipcMain.handle('file:saveMany', async (_e, { files }) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];
  for (const file of files) {
    await fs.writeFile(path.join(dir, file.name), Buffer.from(file.data));
  }
  return dir;
});

ipcMain.handle('window:fullscreen', (_e, on) => {
  if (mainWindow) mainWindow.setFullScreen(Boolean(on));
});

ipcMain.handle('app:version', () => app.getVersion());
