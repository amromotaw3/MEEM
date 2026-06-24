// ─── main.js ─── MediaVault v11.6.0 ─────────────────────────────────────────────
try {
  global.WebSocket = require('ws');
} catch (e) {
  if (typeof global.WebSocket === 'undefined') {
    global.WebSocket = class DummyWebSocket {};
  }
}

const { app, ipcMain, Tray, Menu, BrowserWindow, screen } = require('electron');
const { createWindow, initWindowIpc, getMainWindow } = require('./src/main/windowManager');
const path = require('path');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.mediavault.app');
}

// Gracefully clear GPUCache folder on startup if possible to avoid "Access Denied" errors,
// rather than disabling GPU hardware acceleration entirely which causes UI rendering lag.
try {
  const fs = require('fs');
  const gpuCachePath = path.join(app.getPath('userData'), 'GPUCache');
  if (fs.existsSync(gpuCachePath)) {
    fs.rmSync(gpuCachePath, { recursive: true, force: true });
  }
} catch (e) {
  // Ignore if locked by another active instance
}

app.commandLine.appendSwitch('enable-features', 'EnableAudioTrack'); // Required for MKV internal audio selection
app.commandLine.appendSwitch('log-level', '3'); // Suppress native Chromium logs/errors in terminal



let tray = null;
let isQuitting = false;

// Register custom protocol for deep-linking
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mediavault', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('mediavault');
}

// Single Instance Lock to prevent Cache Access Denied errors
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      // Windows/Linux deep link interception
      const url = commandLine.find(arg => arg.startsWith('mediavault://'));
      if (url) win.webContents.send('handle-deep-link', url);
    }
  });
}

// macOS deep link interception
app.on('open-url', (event, url) => {
  event.preventDefault();
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('handle-deep-link', url);
  }
});

// Register custom protocol schemes as privileged BEFORE app is ready
// This allows 'local-file://' URLs to load local images securely
const { protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
  const { net } = require('electron');
  const { pathToFileURL } = require('url');
  const path = require('path');
  const fs = require('fs');

  const { createMediaProtocolHandler } = require('./src/main/mediaProtocol');
  protocol.handle('media', createMediaProtocolHandler());

  protocol.handle('local-file', (request) => {
    try {
      const fs = require('fs');
      const url = new URL(request.url);
      
      // On Windows, if the URL is local-file://C:/path, 'C:' is the host and '/path' is the pathname.
      // If it's local-file:///C:/path, host is empty and '/C:/path' is the pathname.
      let rawPath = decodeURIComponent(url.pathname);
      
      if (process.platform === 'win32') {
        if (url.host && url.host.match(/^[a-zA-Z]:$/)) {
          rawPath = url.host + rawPath;
        } else if (url.host && url.host.match(/^[a-zA-Z]$/)) {
          // single-letter host like 'c' -> treat as drive letter, uppercase for Windows
          rawPath = url.host.toUpperCase() + ':' + rawPath;
        } else if (rawPath.startsWith('/') && rawPath.match(/^\/[a-zA-Z]:/)) {
          rawPath = rawPath.slice(1);
        }
        // Normalize drive letter to uppercase
        if (rawPath.match(/^[a-z]:/i)) {
          rawPath = rawPath[0].toUpperCase() + rawPath.slice(1);
        }
      }

      // Check if file exists
      if (!fs.existsSync(rawPath)) {
        console.warn('[PROTOCOL] File not found:', rawPath);
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
  protocol.handle('media-img', async (request) => {
    try {
      const { BANNERS_DIR, ensureDir } = require('./src/main/store');
      ensureDir(BANNERS_DIR);

      // Parse the request URL. Since standard URL parsing can lowercase hostnames (corrupting case-sensitive base64 filenames),
      // we perform a robust case-sensitive parse first.
      const rawUrl = request.url;
      let rawPath = '';
      
      if (rawUrl.startsWith('media-img:///')) {
        rawPath = decodeURIComponent(rawUrl.slice(13));
      } else if (rawUrl.startsWith('media-img://')) {
        const remainder = decodeURIComponent(rawUrl.slice(12));
        const driveMatch = remainder.match(/^([a-zA-Z]):(\/|\\|$)/);
        if (driveMatch) {
          rawPath = remainder;
        } else {
          const singleLetterMatch = remainder.match(/^([a-zA-Z])(\/|\\)/);
          if (singleLetterMatch) {
            rawPath = singleLetterMatch[1].toUpperCase() + ':' + remainder.slice(1);
          } else {
            rawPath = remainder;
          }
        }
      } else {
        const parsedUrl = new URL(rawUrl);
        rawPath = decodeURIComponent(parsedUrl.pathname || '');
      }

      // Strip query parameters and hash anchors to prevent cache-busting suffixes (e.g. ?t=...) from corrupting file lookups
      rawPath = rawPath.split('?')[0].split('#')[0];

      let normalized = '';
      const hasSeparators = rawPath.includes('/') || rawPath.includes('\\');
      
      if (hasSeparators) {
        if (process.platform === 'win32') {
          if (rawPath.match(/^[a-z]:/i)) {
            rawPath = rawPath[0].toUpperCase() + rawPath.slice(1);
          }
        }
        normalized = path.normalize(rawPath);
      } else {
        normalized = path.join(BANNERS_DIR, rawPath);
      }

      // Check existence and support Range requests (required for video seeking)
      if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
        const base = path.basename(normalized);
        const alt = path.join(BANNERS_DIR, base);
        
        if (fs.existsSync(alt) && !fs.statSync(alt).isDirectory()) {
          normalized = alt;
        } else {
          // Attempt on-the-fly download of missing banner if base is a base64 encoded URL
          const basenameNoExt = base.replace(/\.[^/.]+$/, "");
          
          const decodeBase64Safe = (str) => {
            try {
              const normalizedB64 = str.replace(/_/g, '=').replace(/-/g, '+');
              const padded = normalizedB64.padEnd(normalizedB64.length + (4 - normalizedB64.length % 4) % 4, '=');
              return Buffer.from(padded, 'base64').toString('utf8');
            } catch (e) {
              return null;
            }
          };

          let remoteUrl = null;
          const firstDecode = decodeBase64Safe(basenameNoExt);
          if (firstDecode) {
            if (/^https?:\/\//i.test(firstDecode)) {
              remoteUrl = firstDecode;
            } else {
              const secondDecode = decodeBase64Safe(firstDecode);
              if (secondDecode && /^https?:\/\//i.test(secondDecode)) {
                remoteUrl = secondDecode;
              }
            }
          }

          if (remoteUrl) {
            console.log('[PROTOCOL] media-img downloading missing banner on the fly:', remoteUrl);
            try {
              await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(alt);
                const proto = remoteUrl.startsWith('https') ? require('https') : require('http');
                const req = proto.get(remoteUrl, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 10000 }, (res) => {
                  if (res.statusCode !== 200) {
                    file.close();
                    try { fs.unlinkSync(alt); } catch (e) {}
                    reject(new Error(`Status ${res.statusCode}`));
                    return;
                  }
                  res.pipe(file);
                  file.on('finish', () => {
                    file.close();
                    resolve();
                  });
                });
                req.on('error', (err) => {
                  file.close();
                  try { fs.unlinkSync(alt); } catch (e) {}
                  reject(err);
                });
                req.on('timeout', () => {
                  req.destroy();
                  file.close();
                  try { fs.unlinkSync(alt); } catch (e) {}
                  reject(new Error('Timeout'));
                });
              });
              normalized = alt;
              console.log('[PROTOCOL] media-img on-the-fly download completed successfully:', alt);
            } catch (downloadErr) {
              console.warn('[PROTOCOL] media-img on-the-fly download failed:', remoteUrl, downloadErr.message);
              return new Response('File not found', { status: 404 });
            }
          } else {
            console.warn('[PROTOCOL] media-img file not found and cannot decode remote URL:', normalized);
            return new Response('File not found', { status: 404 });
          }
        }
      }

      const stat = fs.statSync(normalized);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      const ext = path.extname(normalized).toLowerCase();
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
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        const stream = fs.createReadStream(normalized, { start, end });
        const readable = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => { try { controller.enqueue(chunk); } catch (e) { stream.destroy(); } });
            stream.on('end', () => { try { controller.close(); } catch (e) {} });
            stream.on('error', (err) => { try { controller.error(err); } catch (e) {} });
          },
          cancel() { stream.destroy(); }
        });

        return new Response(readable, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType
          }
        });
      }

      // Full content response
      const stream = fs.createReadStream(normalized);
      const readable = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => { try { controller.enqueue(chunk); } catch (e) { stream.destroy(); } });
          stream.on('end', () => { try { controller.close(); } catch (e) {} });
          stream.on('error', (err) => { try { controller.error(err); } catch (e) {} });
        },
        cancel() { stream.destroy(); }
      });

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Length': String(fileSize),
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes'
        }
      });
    } catch (e) {
      console.error('[PROTOCOL] media-img error:', e);
      return net.fetch(request.url.replace('media-img://', 'file://'));
    }
  });

  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: ['*://*/*']
  }, (details, callback) => {
    details.requestHeaders = details.requestHeaders || {};
    
    // General User-Agent override for compatibility
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const url = details.url.toLowerCase();
    if (url.startsWith('http')) {
      try {
        const urlObj = new URL(details.url);
        const host = urlObj.hostname.toLowerCase();
        
        // YouTube Referer/Origin bypass to resolve Error 153 configuration error
        if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
          details.requestHeaders['Referer'] = 'https://www.youtube.com/';
          details.requestHeaders['Origin'] = 'https://www.youtube.com';
        }
        // Specific streaming providers / hosts referer bypass
        else if (host.includes('animecix') || host.includes('watchanimeworld') || host.includes('docci') || host.includes('github') || host.includes('wikimedia') || host.includes('consumet')) {
          details.requestHeaders['Referer'] = urlObj.origin + '/';
          details.requestHeaders['Origin'] = urlObj.origin;
        }
        // Wikipedia / Wikimedia flags & images User-Agent requirement
        else if (host.includes('wikimedia.org') || host.includes('wikipedia.org')) {
          details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
        }
        // Stremio Addon Store logos & external images hotlink bypass
        else if (details.resourceType === 'image' && !url.startsWith('file://') && !url.startsWith('media://') && !url.startsWith('media-img://')) {
          delete details.requestHeaders['Referer'];
          delete details.requestHeaders['Origin'];
          details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
        }
      } catch (e) {
        console.error('[Session] Error parsing URL in header interceptor:', e.message);
      }
    }
    
    callback({ requestHeaders: details.requestHeaders });
  });

  const win = createWindow();

  // ─── PREMIUM TRAY WINDOW SYSTEM ───
  let trayWindow = null;

  let trayState = {
    status: 'Idle',
    isPlaying: false,
    progress: 0,
    syncEnabled: true,
    image: null,
    volume: 100,
    mediaType: 'movie'
  };

  const createTrayWindow = () => {
    trayWindow = new BrowserWindow({
      width: 220,
      height: 200,
      show: false,
      frame: false,
      fullscreenable: false,
      resizable: false,
      transparent: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'src', 'renderer', 'tray', 'preload.js'),
        backgroundThrottling: false
      }
    });

    trayWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'tray', 'index.html'));

    trayWindow.on('blur', () => {
      // Mark as recently blurred to prevent immediate re-opening by tray click
      trayWindow._isBlurring = true;
      trayWindow.hide();
      trayWindow.setAlwaysOnTop(false);
      setTimeout(() => { if (trayWindow) trayWindow._isBlurring = false; }, 200);
    });
  };

  const getTrayWindowPosition = () => {
    const windowBounds = trayWindow.getBounds();
    const trayBounds = tray.getBounds();
    
    // Find the display where the tray icon is located
    const activeDisplay = screen.getDisplayMatching(trayBounds);
    const { workArea, bounds: displayBounds } = activeDisplay;

    let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    let y;

    // Detect Taskbar Position
    const isBottom = workArea.y === displayBounds.y && workArea.height < displayBounds.height && workArea.y + workArea.height >= displayBounds.y + displayBounds.height - 100;
    const isTop = workArea.y > displayBounds.y;
    const isLeft = workArea.x > displayBounds.x;
    const isRight = workArea.x === displayBounds.x && workArea.width < displayBounds.width;

    if (isTop) {
      y = Math.round(trayBounds.y + trayBounds.height + 12);
    } else if (isLeft) {
      x = Math.round(trayBounds.x + trayBounds.width + 12);
      y = Math.round(trayBounds.y + (trayBounds.height / 2) - (windowBounds.height / 2));
    } else if (isRight) {
      x = Math.round(trayBounds.x - windowBounds.width - 12);
      y = Math.round(trayBounds.y + (trayBounds.height / 2) - (windowBounds.height / 2));
    } else {
      // Default: Bottom — raise a bit more to avoid overlap
      y = Math.round(trayBounds.y - windowBounds.height - 12);
    }

    // Boundary check for X (ensure it stays within the current display)
    if (x + windowBounds.width > workArea.x + workArea.width) {
      x = workArea.x + workArea.width - windowBounds.width - 12;
    }
    if (x < workArea.x) {
      x = workArea.x + 12;
    }

    // Boundary check for Y
    if (y + windowBounds.height > workArea.y + workArea.height) {
      y = workArea.y + workArea.height - windowBounds.height - 12;
    }
    if (y < workArea.y) {
      y = workArea.y + 12;
    }

    return { x, y };
  };

  const toggleTrayWindow = () => {
    if (!trayWindow) createTrayWindow();
    
    // If we just hid because of a blur, don't re-open on the same click
    if (trayWindow._isBlurring) return;

    if (trayWindow.isVisible()) {
      trayWindow.hide();
    } else {
      const { x, y } = getTrayWindowPosition();
      trayWindow.setPosition(x, y, false);
      trayWindow.setAlwaysOnTop(true, 'pop-up-menu');
      trayWindow.show();
      trayWindow.focus();
      // Sync state to window on open
      trayWindow.webContents.send('update-tray-ui', trayState);
    }
  };

  // Initialize Tray
  const iconPath = path.join(__dirname, 'src', 'renderer', 'imgs', 'appicon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('MediaVault');
  
  createTrayWindow();

  tray.on('click', () => toggleTrayWindow());
  tray.on('right-click', () => toggleTrayWindow());
  tray.on('double-click', () => {
    if (win && !win.isDestroyed()) win.show();
  });

  // Action Handler from Tray Window
  ipcMain.on('tray-action', (event, action, data) => {
    if (action === 'show-app') {
      if (win && !win.isDestroyed()) win.show();
      trayWindow.hide();
    } else if (action === 'quit-app') {
      app.isQuitting = true;
      app.quit();
    } else if (action === 'pause-downloads') {
      if (win && !win.isDestroyed()) win.webContents.send('downloads-control', 'pause-all');
    } else if (action === 'toggle-sync') {
      trayState.syncEnabled = !trayState.syncEnabled;
      if (win && !win.isDestroyed()) win.webContents.send('sync-toggle', trayState.syncEnabled);
      trayWindow.webContents.send('update-tray-ui', trayState);
    } else if (action === 'open-settings') {
      if (win && !win.isDestroyed()) {
        win.show();
        win.webContents.send('switch-view', 'settings');
      }
      trayWindow.hide();
    } else if (action === 'close-tray') {
      trayWindow.hide();
    } else if (action === 'toggle-play') {
      if (win && !win.isDestroyed()) win.webContents.send('player-control', 'toggle');
    } else if (action === 'prev-track') {
      if (win && !win.isDestroyed()) win.webContents.send('player-control', 'prev');
    } else if (action === 'next-track') {
      if (win && !win.isDestroyed()) win.webContents.send('player-control', 'next');
    } else if (action === 'set-volume') {
      const volume = parseInt(data);
      if (isNaN(volume)) return;
      trayState.volume = volume;
      if (win && !win.isDestroyed()) {
        win.webContents.send('player-control', { action: 'volume', value: volume });
      }
    }
  });

  ipcMain.on('update-tray-height', (event, height) => {
    if (trayWindow && !trayWindow.isDestroyed()) {
      const bounds = trayWindow.getBounds();
      const newHeight = Math.round(height);
      if (bounds.height !== newHeight) {
        // Resize first
        trayWindow.setSize(bounds.width, newHeight, false);
        
        // Then reposition so it stays 'attached' to the icon
        const { x, y } = getTrayWindowPosition();
        trayWindow.setPosition(x, y, false);
      }
    }
  });



  // Listeners for Dynamic Updates from Renderer
  ipcMain.on('update-tray-status', (event, { status, isPlaying, progress, syncEnabled, image, volume, mediaType }) => {
    trayState.status = status || trayState.status;
    trayState.isPlaying = isPlaying !== undefined ? !!isPlaying : trayState.isPlaying;
    if (progress !== undefined) trayState.progress = progress;
    if (syncEnabled !== undefined) trayState.syncEnabled = !!syncEnabled;
    if (image !== undefined) trayState.image = image;
    if (volume !== undefined) trayState.volume = volume;
    if (mediaType !== undefined) trayState.mediaType = mediaType;
    
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.webContents.send('update-tray-ui', trayState);
    }
  });

  // Initialize all modular IPC handlers with smart logging
  const { log } = require('./src/main/utils/logger');

  try {
    const { initStoreIpc } = require('./src/main/store');
    initStoreIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Store IPC: ${err.message}`, 'error');
  }

  try {
    initWindowIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Window IPC: ${err.message}`, 'error');
  }

  try {
    const { initMiscIpc } = require('./src/main/ipcHandlers');
    initMiscIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Misc IPC: ${err.message}`, 'error');
  }

  try {
    const { initLibraryScannerIpc } = require('./src/main/libraryScanner');
    initLibraryScannerIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Library Scanner IPC: ${err.message}`, 'error');
  }

  try {
    const { initSubtitlesIpc } = require('./src/main/subtitles');
    initSubtitlesIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Subtitles IPC: ${err.message}`, 'error');
  }

  try {
    const { initSubtitleManagerIpc } = require('./src/main/SubtitleManager');
    const storeModule = require('./src/main/store');
    initSubtitleManagerIpc(ipcMain, () => storeModule.getInMemorySession());
  } catch (subtitleManagerErr) {
    log('SUBTITLES', `Failed to initialize manager: ${subtitleManagerErr.message}`, 'error');
  }

  try {
    const { initAddonsIpc } = require('./src/main/addons');
    const storeModule = require('./src/main/store');
    initAddonsIpc(ipcMain, { get: (k) => (k === 'appData' ? storeModule.getInMemorySession() : null) });
  } catch (addonErr) {
    log('ADDONS', `Failed to initialize: ${addonErr.message}`, 'error');
  }

  try {
    const { initDownloaderIpc } = require('./src/main/downloader');
    initDownloaderIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Downloader IPC: ${err.message}`, 'error');
  }

  try {
    const { initDiscordRPC } = require('./src/main/discordRPC');
    initDiscordRPC(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Discord RPC: ${err.message}`, 'error');
  }

  try {
    const { initUpdater } = require('./src/main/updater');
    initUpdater(win);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Updater: ${err.message}`, 'error');
  }

  try {
    const { initStreamerIpc } = require('./src/main/streamer');
    initStreamerIpc(ipcMain);
  } catch (err) {
    log('SYSTEM', `Failed to initialize Streamer IPC: ${err.message}`, 'error');
  }

  // Unified stop-torrent-stream handler (stops both addons and streamer engines cleanly)
  try {
    ipcMain.handle('stop-torrent-stream', async () => {
      try {
        const { stopAddonStreaming } = require('./src/main/addons');
        stopAddonStreaming();
      } catch (e) {
        log('SYSTEM', `Failed to stop addon streaming: ${e.message}`, 'error');
      }
      try {
        const { stopStreaming } = require('./src/main/streamer');
        await stopStreaming();
      } catch (e) {
        log('SYSTEM', `Failed to stop main streamer: ${e.message}`, 'error');
      }
      return { success: true };
    });
  } catch (err) {
    log('SYSTEM', `Failed to register stop-torrent-stream: ${err.message}`, 'error');
  }

  log('SYSTEM', 'All IPC handlers and persistent services initialized', 'success');

  // ─── REAL INTERNET CONNECTIVITY MONITOR ───────────────────────────────────
  // navigator.onLine in Electron only checks network adapter — not actual internet.
  // We use net.isOnline() (Chromium's real connectivity check) and push updates to the renderer.
  {
    let _lastOnlineState = null;

    function broadcastConnectivity() {
      try {
        const { net } = require('electron');
        const isOnline = net.isOnline();
        if (isOnline !== _lastOnlineState) {
          _lastOnlineState = isOnline;
          const mainWin = getMainWindow();
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('connectivity-changed', { isOnline });
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Check immediately on startup then every 10 seconds
    setTimeout(broadcastConnectivity, 1500);
    setInterval(broadcastConnectivity, 10000);

    // Also wire up Electron's native online/offline events
    const { powerMonitor } = require('electron');
    try {
      powerMonitor.on('unlock-screen', broadcastConnectivity);
    } catch (e) { /* powerMonitor event optional */ }
  }
  // ──────────────────────────────────────────────────────────────────────────


  // CLEAN LOG BRIDGE: Filters noisy renderer logs
  ipcMain.on('log-bridge', (event, data) => {
    if (!data) return;
    const { level = 'log', msg = '' } = data;
    // Filter out redundant noise
    if (msg.includes('[RENDER-SOCIAL]') || msg.includes('[SCAN]') || msg.includes('[INIT]')) return;
    log('RENDERER', msg, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info');
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
  // Attempt to gracefully stop streaming, downloads, and embedded MPV
  try { cleanupActiveDownloads(); } catch (e) {}
  try { stopStreaming(); } catch (e) {}
});

