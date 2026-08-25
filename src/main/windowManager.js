const { app, BrowserWindow, Notification } = require('electron');
const path = require('path');

const { loadData, ensureDir } = require('./store');
const { toMediaProtocolUrl } = require('./mediaProtocol');

let mainWindow;
let playerWindow;
let chatWindow = null;
let activeOAuthServer = null;

function showToastNotification(title, body) {
  try {
    const icoPath = path.resolve(__dirname, '..', 'renderer', 'imgs', 'appicon.ico');
    if (Notification.isSupported()) new Notification({ title, body, icon: icoPath }).show();
  } catch (err) {
    console.error('[Notification] Failed to show system notification:', err.message);
  }
}

function normalizePlayerOptions(options = {}) {
  const rawPath = options.url || options.path || options.filePath || '';
  const mediaUrl = toMediaProtocolUrl(rawPath);
  return {
    ...options,
    url: mediaUrl,
    path: mediaUrl,
    title: options.title || options.name || 'Playback',
    startTime: typeof options.startTime === 'number' ? options.startTime : 0
  };
}

function dispatchOpenPlayer(win, options) {
  const payload = normalizePlayerOptions(options);
  const send = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('open-player', payload);
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'renderer', 'imgs', 'appicon.ico');

  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: '#ffffff',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      enableRemoteModule: false,
      sandbox: true,
      plugins: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Detect renderer crashes or process termination and attempt recovery
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[CRASH] Renderer process gone:', details);
      try {
        // Try to reload the renderer first
        if (!mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      } catch (e) {
        console.error('[CRASH] Failed to reload mainWindow, recreating:', e.message);
        try {
          mainWindow.destroy();
        } catch (e) {}
        // Recreate window after a short delay to avoid tight crash loops
        setTimeout(() => createWindow(), 500);
      }
    });

    mainWindow.webContents.on('crashed', (event) => {
      console.error('[CRASH] Renderer crashed unexpectedly');
      try {
        if (!mainWindow.isDestroyed()) mainWindow.reload();
      } catch (e) {
        console.error('[CRASH] reload failed:', e.message);
        try { mainWindow.destroy(); } catch (e) {}
        setTimeout(() => createWindow(), 500);
      }
    });
  }


  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.webContents.on('console-message', (event, levelOrDetails, messageStr) => {
    let level = 1;
    let message = 'undefined';
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      level = levelOrDetails.level ?? 1;
      message = levelOrDetails.message ?? 'undefined';
    } else {
      level = levelOrDetails ?? 1;
      message = messageStr ?? 'undefined';
    }
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    console.log(`[RENDERER/${levels[level] || level}] ${message}`);
  });

  if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
    mainWindow.webContents.session.on('will-download', (event, item) => {
      try {
        const filename = item?.getFilename?.();
        if (!filename) {
          console.warn('[DOWNLOAD] No filename provided');
          return;
        }
        const data = loadData();
        const baseDir = data.downloadPath || (data.libraryFolders && data.libraryFolders[0]) || path.join(app.getPath('downloads'), 'MEEM_Downloads');

        const seriesMatch = filename.match(/(.*)[. ]S(\d{1,2})E(\d{1,3})/i) ||
          filename.match(/(.*)[. ](\d{1,2})x(\d{1,3})/i) ||
          filename.match(/(^.*)\s-\s(\d{1,3})/i);

        let targetPath;
        if (seriesMatch) {
          const showName = seriesMatch[1].replace(/[\._]/g, ' ').replace(/\[.*?\]/g, '').trim();
          const seasonNum = seriesMatch[3] ? String(seriesMatch[2]).padStart(2, '0') : '01';
          const finalDir = path.join(baseDir, showName, `Season ${seasonNum}`);
          ensureDir(finalDir);
          targetPath = path.join(finalDir, filename);
        } else {
          const cleanMovieName = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '').replace(/[\._]/g, ' ').trim();
          const movieDir = path.join(baseDir, 'Movies', cleanMovieName);
          ensureDir(movieDir);
          targetPath = path.join(movieDir, filename);
        }

        item.setSavePath(targetPath);
        item.on('updated', (event, state) => {
          if (state === 'interrupted') showToastNotification('Download Interrupted', filename);
        });
        item.once('done', (event, state) => {
          if (state === 'completed') {
            showToastNotification('Download Complete', `Saved to ${targetPath}`);
            mainWindow?.webContents?.send?.('library-updated');
          } else if (state === 'cancelled') {
            console.warn('[DOWNLOAD] Download cancelled:', filename);
          }
        });

        item.on('error', (err) => {
          console.error('[DOWNLOAD] Item error:', err);
        });
      } catch (err) {
        console.error('[WINDOW] Download handler error:', err.message);
      }
    });
  }

  return mainWindow;
}

function initWindowIpc(ipcMain) {
  ipcMain.on('get-supabase-env', (event) => {
    try {
      const { getSupabaseUrl, getSupabaseAnonKey, isConfigured } = require('../shared/supabaseEnv');
      if (isConfigured()) {
        event.returnValue = {
          supabaseUrl: getSupabaseUrl(),
          supabaseAnonKey: getSupabaseAnonKey()
        };
      } else {
        event.returnValue = null;
      }
    } catch (e) {
      console.error('[IPC] Failed to get supabase env:', e.message);
      event.returnValue = null;
    }
  });

  ipcMain.on('win-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });
  ipcMain.on('win-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });
  ipcMain.on('win-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });
  ipcMain.handle('set-fullscreen', (event, flag) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setFullScreen(flag);
    return flag;
  });
  ipcMain.handle('is-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFullScreen() ?? false;
  });
  ipcMain.handle('open-devtools', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && win.webContents) {
        win.webContents.openDevTools({ mode: 'right' });
        return true;
      }
    } catch (e) { console.error('open-devtools failed', e); }
  });
  ipcMain.handle('cloud-oauth', async (event, url) => {
    const { shell } = require('electron');
    const http = require('http');

    // If there is already an active server, close it first
    if (activeOAuthServer) {
      try {
        activeOAuthServer.close();
      } catch (err) {
        console.error('[OAuth] Error closing active server:', err);
      }
      activeOAuthServer = null;
    }

    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
          <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #111; color: #fff;">
            <h2 id="msg">Authenticating...</h2>
            <script>
              let params = "";
              if (window.location.hash) {
                params = window.location.hash.substring(1);
              } else if (window.location.search) {
                params = window.location.search.substring(1);
              }
              if (params) {
                document.getElementById('msg').innerText = 'Authentication Successful! Redirecting to app...';
                window.location.href = 'mediavault://callback#' + params;
                setTimeout(() => window.close(), 3000);
              } else {
                document.getElementById('msg').innerText = 'Failed to get auth token.';
              }
            </script>
          </body>
          </html>
        `);
        // Close server after serving the page
        setTimeout(() => {
          server.close();
          if (activeOAuthServer === server) activeOAuthServer = null;
        }, 5000);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.on('error', (err) => {
      console.error('[OAuth] Local server error:', err);
      if (err.code === 'EADDRINUSE') {
        console.warn('[OAuth] Port 3000 in use, opening browser anyway.');
        shell.openExternal(url);
      }
    });

    activeOAuthServer = server;

    server.listen(3000, () => {
      // Open system browser to perform OAuth; do not open an in-app fallback window.
      shell.openExternal(url).catch(() => {
        console.warn('[OAuth] Failed to open external browser for', url);
      });
    });

    // Fallback: automatically close the server after 2 minutes of inactivity to release the port
    setTimeout(() => {
      try {
        server.close();
      } catch (e) {}
      if (activeOAuthServer === server) activeOAuthServer = null;
    }, 120000);
    
    return true; // Resolve immediately so renderer doesn't crash
  });

  ipcMain.handle('cloud-open-chat-window', (event, { listId }) => {
    openChatWindow(listId);
    return { success: true };
  });
}

function openChatWindow(listId) {
  const iconPath = path.join(__dirname, '..', 'renderer', 'imgs', 'appicon.ico');
  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');

  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    chatWindow.webContents.send('set-active-chat-list', { listId });
    return chatWindow;
  }

  chatWindow = new BrowserWindow({
    width: 360,
    height: 600,
    minWidth: 320,
    minHeight: 400,
    frame: true,
    title: 'List Chat',
    backgroundColor: '#0d0d18',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      enableRemoteModule: false,
      sandbox: true,
      plugins: true
    }
  });

  chatWindow.loadFile(indexPath, { query: { mvWindow: 'chat', listId } });

  chatWindow.once('ready-to-show', () => {
    chatWindow.show();
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  // Enable console logs to print in main process console for debugging
  chatWindow.webContents.on('console-message', (event, levelOrDetails, messageStr) => {
    let level = 1;
    let message = 'undefined';
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      level = levelOrDetails.level ?? 1;
      message = levelOrDetails.message ?? 'undefined';
    } else {
      level = levelOrDetails ?? 1;
      message = messageStr ?? 'undefined';
    }
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    console.log(`[CHAT/${levels[level] || level}] ${message}`);
  });

  return chatWindow;
}

/**
 * Singleton native player window.
 * Reuses the existing window: focus + push the new media:// source via IPC.
 */
function createPlayerWindow(options = {}) {
  const iconPath = path.join(__dirname, '..', 'renderer', 'imgs', 'appicon.ico');
  const normalized = normalizePlayerOptions(options);

  if (playerWindow && !playerWindow.isDestroyed()) {
    if (playerWindow.isMinimized()) playerWindow.restore();
    playerWindow.focus();
    dispatchOpenPlayer(playerWindow, normalized);
    return playerWindow;
  }

  // Get current bounds & maximized state from mainWindow
  let bounds = { width: 1280, height: 720 };
  let isMax = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    isMax = mainWindow.isMaximized();
    bounds = mainWindow.getBounds();
  }

  const width = bounds.width;
  const height = bounds.height;
  const x = bounds.x;
  const y = bounds.y;

  playerWindow = new BrowserWindow({
    x, y,
    width, height,
    minWidth: 860, minHeight: 520,
    frame: false,
    backgroundColor: '#000000',
    useContentSize: true,
    fullscreenable: true,
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      enableRemoteModule: false,
      sandbox: true,
      plugins: true
    }
  });

  if (isMax) {
    playerWindow.maximize();
  }

  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
  playerWindow.loadFile(indexPath, { query: { mvWindow: 'player' } });


  playerWindow.once('ready-to-show', () => {
    console.log('[PLAYER] Player window ready, showing...');
    playerWindow.show();
    dispatchOpenPlayer(playerWindow, normalized);
    // Keep main window visible — do not hide the main app when player opens
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[PLAYER] Leaving main window visible');
    }
  });

  playerWindow.on('close', () => {
    console.log('[PLAYER] Player window closing');
    // Capture bounds and maximized state of playerWindow before it is destroyed
    if (playerWindow && !playerWindow.isDestroyed() && mainWindow && !mainWindow.isDestroyed()) {
      const isPlayerMax = playerWindow.isMaximized();
      const playerBounds = playerWindow.getBounds();
      
      if (isPlayerMax) {
        mainWindow.maximize();
      } else {
        mainWindow.unmaximize();
        mainWindow.setBounds(playerBounds);
      }
    }
  });

  playerWindow.on('closed', () => {
    console.log('[PLAYER] Player window closed, playerWindow = null');
    playerWindow = null;
    
    // Restore and show mainWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[PLAYER] Restoring main window');
      mainWindow.show();
      mainWindow.focus();
      try {
        if (mainWindow.webContents) {
          mainWindow.webContents.send('player-window-closed');
        }
      } catch (err) {
        console.warn('[PLAYER] Failed to send player-window-closed event:', err.message);
      }
    }

    // ── Cleanup: Destroy active torrent streams when player closes ──
    // Uses lazy require() to avoid circular dependency issues
    try {
      const { stopStreaming } = require('./streamer');
      stopStreaming().catch(e => console.warn('[PLAYER] Streamer cleanup error:', e.message));
    } catch (e) { console.warn('[PLAYER] Streamer cleanup error:', e.message); }
    try {
      const { stopAddonStreaming } = require('./addons');
      stopAddonStreaming();
    } catch (e) { /* ignore — addons may not be initialized */ }
  });

  playerWindow.webContents.on('console-message', (event, levelOrDetails, messageStr) => {
    let level = 1;
    let message = 'undefined';
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      level = levelOrDetails.level ?? 1;
      message = levelOrDetails.message ?? 'undefined';
    } else {
      level = levelOrDetails ?? 1;
      message = messageStr ?? 'undefined';
    }
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    console.log(`[PLAYER/${levels[level] || level}] ${message}`);
  });

  return playerWindow;
}

function getMainWindow() {
  return mainWindow;
}

function getPlayerWindow() {
  return playerWindow;
}

module.exports = {
  createWindow,
  initWindowIpc,
  getMainWindow,
  getPlayerWindow,
  showToastNotification,
  createPlayerWindow,
  openChatWindow,
  toMediaProtocolUrl
};
