// ─── main.js ─── MediaVault v7.1 ─────────────────────────────────────────────
const { app, ipcMain, Tray, Menu } = require('electron');
const { initStoreIpc, loadData } = require('./src/main/store');
const { createWindow, initWindowIpc, getMainWindow } = require('./src/main/windowManager');
const { initMiscIpc } = require('./src/main/ipcHandlers');
const { initLibraryScannerIpc } = require('./src/main/libraryScanner');
const { initSubtitlesIpc } = require('./src/main/subtitles');
const { initAddonsIpc } = require('./src/main/addons');
const { initDownloaderIpc } = require('./src/main/downloader');
const { initDiscordRPC } = require('./src/main/discordRPC');
const { initUpdater } = require('./src/main/updater');
const { initStreamerIpc } = require('./src/main/streamer');
const { startPersistentServer } = require('./src/main/mediaServer');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.mediavault.app');
}

// FIX: Disable GPU Cache to resolve "Access Denied" errors and startup crashes on Windows
app.commandLine.appendSwitch('disable-gpu-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('log-level', '3'); // Suppress native Chromium logs/errors in terminal

let tray = null;
let isQuitting = false;

// Single Instance Lock to prevent Cache Access Denied errors
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Register custom protocol schemes as privileged BEFORE app is ready
// This allows 'local-file://' URLs to load local images securely
const { protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(() => {
  const { net } = require('electron');
  const { pathToFileURL } = require('url');
  const path = require('path');

  protocol.handle('local-file', (request) => {
    try {
      const fs = require('fs');
      const url = new URL(request.url);
      let rawPath = decodeURIComponent(url.pathname);
      // On Windows, the pathname for file:///C:/path starts with /C:/. We need C:/
      if (process.platform === 'win32' && rawPath.startsWith('/') && rawPath.match(/^\/[a-zA-Z]:/)) {
        rawPath = rawPath.slice(1);
      }

      // Check if file exists
      if (!fs.existsSync(rawPath)) {
        return new Response('File not found', { status: 404 });
      }

      const stat = fs.statSync(rawPath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      // Determine MIME type
      const ext = path.extname(rawPath).toLowerCase();
      const mimeTypes = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.srt': 'text/plain',
        '.vtt': 'text/vtt', '.ass': 'text/plain', '.ssa': 'text/plain'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      if (rangeHeader) {
        // ─── RANGE REQUEST (required for video seeking) ───
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const stream = fs.createReadStream(rawPath, { start, end });
        const readable = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => {
              try { controller.enqueue(chunk); } catch (e) { stream.destroy(); }
            });
            stream.on('end', () => {
              try { controller.close(); } catch (e) {}
            });
            stream.on('error', (err) => {
              try { controller.error(err); } catch (e) {}
            });
          },
          cancel() {
            stream.destroy();
          }
        });

        return new Response(readable, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          }
        });
      } else {
        // ─── FULL REQUEST ───
        const stream = fs.createReadStream(rawPath);
        const readable = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => {
              try { controller.enqueue(chunk); } catch (e) { stream.destroy(); }
            });
            stream.on('end', () => {
              try { controller.close(); } catch (e) {}
            });
            stream.on('error', (err) => {
              try { controller.error(err); } catch (e) {}
            });
          },
          cancel() {
            stream.destroy();
          }
        });

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Length': String(fileSize),
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          }
        });
      }
    } catch (e) {
      console.error('[PROTOCOL] local-file error:', e);
      return new Response('Internal error', { status: 500 });
    }
  });

  // Also intercept file:// requests so webSecurity doesn't block local images
  protocol.handle('media-img', (request) => {
    try {
      const rawPath = decodeURIComponent(request.url.slice('media-img:///'.length));
      const normalized = path.normalize(rawPath);
      return net.fetch(pathToFileURL(normalized).href);
    } catch (e) {
      console.error('[PROTOCOL] media-img error:', e);
      return net.fetch(request.url.replace('media-img://', 'file://'));
    }
  });

  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: ['*://*.mangadex.org/*', '*://*.mangadex.network/*']
  }, (details, callback) => {
    details.requestHeaders['Referer'] = 'https://mangadex.org';
    details.requestHeaders['Origin'] = 'https://mangadex.org';
    callback({ requestHeaders: details.requestHeaders });
  });

  const win = createWindow();

  // ─── ADVANCED TRAY SYSTEM ───
  let trayState = {
    status: 'Idle',
    isPlaying: false,
    syncEnabled: true,
  };

  const updateTrayMenu = () => {
    if (!tray || tray.isDestroyed()) return;
    const safeSend = (channel, ...args) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    };
    const contextMenu = Menu.buildFromTemplate([
      { label: `MediaVault v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      
      // 1. Now Playing / Resume
      { label: trayState.status, enabled: false },
      { 
        label: trayState.isPlaying ? 'Pause Playback' : 'Resume Playback', 
        click: () => safeSend('player-control', trayState.isPlaying ? 'pause' : 'play') 
      },
      { type: 'separator' },

      // 2. Network & Sync
      { 
        label: 'Enable Mobile Sync', 
        type: 'checkbox', 
        checked: trayState.syncEnabled,
        click: (item) => {
          trayState.syncEnabled = item.checked;
          safeSend('sync-toggle', item.checked);
        }
      },
      { type: 'separator' },

      // 3. Torrent Manager
      { label: 'Add Magnet Link...', click: () => { if (win && !win.isDestroyed()) { win.show(); safeSend('open-modal', 'magnet'); } } },
      { label: 'Pause All Downloads', click: () => safeSend('downloads-control', 'pause-all') },
      { type: 'separator' },

      // 4. Standard App Controls
      { label: 'Settings', click: () => { if (win && !win.isDestroyed()) { win.show(); safeSend('switch-view', 'settings'); } } },
      { label: 'Show MediaVault', click: () => { if (win && !win.isDestroyed()) win.show(); } },
      { label: 'Quit MediaVault', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
  };

  // Initialize Tray with the new premium icon
  const iconPath = path.join(__dirname, 'src', 'renderer', 'imgs', 'appicon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('MediaVault');
  updateTrayMenu();
  tray.on('double-click', () => win.show());

  // IPC Listeners for Dynamic Tray Updates
  ipcMain.on('update-tray-status', (event, { status, isPlaying }) => {
    trayState.status = status || 'Idle';
    trayState.isPlaying = !!isPlaying;
    updateTrayMenu();
  });

  ipcMain.on('update-sync-status', (event, enabled) => {
    trayState.syncEnabled = !!enabled;
    updateTrayMenu();
  });

  // Initialize all modular IPC handlers with safety wrappers
  try {
    console.log('[DEBUG] Initializing Store IPC...');
    initStoreIpc(ipcMain);

    console.log('[DEBUG] Initializing Window IPC...');
    initWindowIpc(ipcMain);

    console.log('[DEBUG] Initializing Misc IPC...');
    initMiscIpc(ipcMain);

    console.log('[DEBUG] Initializing Library Scanner IPC...');
    initLibraryScannerIpc(ipcMain);

    console.log('[DEBUG] Initializing Subtitles IPC...');
    initSubtitlesIpc(ipcMain);

    console.log('[DEBUG] Initializing Addons IPC...');
    try {
      initAddonsIpc(ipcMain, { get: (k) => k === 'appData' ? loadData() : null });
      console.log('[DEBUG] Addons IPC initialized.');
    } catch (addonErr) {
      console.error('[ERROR] Failed to initialize Addons IPC:', addonErr);
    }

    console.log('[DEBUG] Initializing Downloader IPC...');
    initDownloaderIpc(ipcMain);

    console.log('[DEBUG] Initializing Discord RPC...');
    initDiscordRPC(ipcMain);

    console.log('[DEBUG] Initializing Auto-Updater...');
    initUpdater(win);

    console.log('[DEBUG] Initializing Streamer IPC...');
    initStreamerIpc(ipcMain);

    console.log('[DEBUG] Starting Persistent Sync Server...');
    startPersistentServer((port) => {
       console.log(`[DEBUG] Sync Server started on port: ${port}`);
       win.webContents.on('did-finish-load', () => {
          win.webContents.send('sync-server-started', { port });
       });
       // If window is already loaded
       if (!win.webContents.isLoading()) {
          win.webContents.send('sync-server-started', { port });
       }
    });

    console.log('[DEBUG] ALL IPC HANDLERS INITIALIZED SUCCESSFULLY');
  } catch (err) {
    console.error('[FATAL] CRASH DURING IPC INITIALIZATION:', err);
  }

  // LOG BRIDGE: Pipes renderer logs to terminal
  ipcMain.on('log-bridge', (event, data) => {
    if (!data) return;
    const { level = 'log', msg = '' } = data;
    if (level === 'info' && (msg.includes('RENDER') || msg.includes('FILTER'))) return;
    const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
    console.log(`${color}[RENDERER] [${new Date().toLocaleTimeString()}] ${msg}\x1b[0m`);
  });

  // SHUTDOWN & ERROR HANDLERS
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents?.send?.('app-error', { message: err.message });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  // Cleanly stop the sync server & Bonjour broadcast
  try {
    const { stopPersistentServer } = require('./src/main/mediaServer');
    stopPersistentServer();
  } catch (e) { /* ignore */ }
});
