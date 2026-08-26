// ─── main.js ─── MEEM v2.7.0 ─────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

// ─── Logging setup (replaces console monkey-patch) ──────────────────────────
const { initFileLogger, writeToDebugFile } = require('./src/main/utils/logger');
const logPath = path.join(__dirname, 'debug.log');
initFileLogger(logPath);

try {
  global.WebSocket = require('ws');
} catch (e) {
  if (typeof global.WebSocket === 'undefined') {
    global.WebSocket = class DummyWebSocket {};
  }
}

// Disable proxy globally for axios to prevent ECONNREFUSED 127.0.0.1:443 when system proxy is misconfigured or inactive
try {
  const axios = require('axios');
  if (axios && axios.defaults) {
    axios.defaults.proxy = false;
  }
} catch (e) {}

const { app, ipcMain, Tray, Menu, BrowserWindow, screen } = require('electron');

const { createWindow, initWindowIpc, getMainWindow } = require('./src/main/windowManager');
if (process.platform === 'win32') {
  try {
    if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');
    if (process.stderr && process.stderr.setEncoding) process.stderr.setEncoding('utf8');
  } catch (e) {}
  app.setAppUserModelId('com.meem.app');
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

app.commandLine.appendSwitch('enable-features', 'EnableAudioTrack,VaapiVideoDecoder,VaapiVideoEncoder,PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('log-level', '3'); // Suppress native Chromium logs/errors in terminal

// Enable hardware video decoding & fix black-screen / audio-only issue with HLS streams
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');




let tray = null;
let isQuitting = false;

// Register custom protocol for deep-linking
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('meem', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('mediavault', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('meem');
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
      const url = commandLine.find(arg => arg.startsWith('meem://') || arg.startsWith('mediavault://'));
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
  const { session, net } = require('electron');
  const { pathToFileURL } = require('url');
  // fs and path are available from module scope

  // ─── Shared helper: wraps an fs.ReadStream into a Fetch API ReadableStream ──
  function createNodeReadable(filePath, options = {}) {
    const stream = fs.createReadStream(filePath, options);
    return new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => { try { controller.enqueue(chunk); } catch (e) { stream.destroy(); } });
        stream.on('end', () => { try { controller.close(); } catch (e) {} });
        stream.on('error', (err) => { try { controller.error(err); } catch (e) {} });
      },
      cancel() { stream.destroy(); }
    });
  }

  const { createMediaProtocolHandler } = require('./src/main/mediaProtocol');
  protocol.handle('media', createMediaProtocolHandler());

  protocol.handle('local-file', (request) => {
    try {
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

        const readable = createNodeReadable(rawPath, { start, end });

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
        const readable = createNodeReadable(rawPath);

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
            } else if (/^tt\d+$/i.test(firstDecode)) {
              remoteUrl = `https://images.metahub.space/poster/medium/${firstDecode}/img`;
            } else {
              const secondDecode = decodeBase64Safe(firstDecode);
              if (secondDecode) {
                if (/^https?:\/\//i.test(secondDecode)) {
                  remoteUrl = secondDecode;
                } else if (/^tt\d+$/i.test(secondDecode)) {
                  remoteUrl = `https://images.metahub.space/poster/medium/${secondDecode}/img`;
                }
              }
            }
          }

          if (remoteUrl) {
            console.log('[PROTOCOL] media-img redirecting to remote URL (non-blocking):', remoteUrl);
            return new Response(null, {
              status: 302,
              headers: { 'Location': remoteUrl }
            });
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

        const readable = createNodeReadable(normalized, { start, end });

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
      const readable = createNodeReadable(normalized);

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

  const probeNodeConnectivity = async () => {
    const dns = require('dns').promises;
    const http = require('http');

    // Method 1: Fast IPv4 DNS Lookup via OS resolver
    try {
      await Promise.any([
        dns.lookup('google.com', { family: 4 }),
        dns.lookup('cloudflare.com', { family: 4 }),
        dns.lookup('one.one.one.one', { family: 4 })
      ]);
      return true;
    } catch (_) {}

    // Method 2: Direct HTTP 204 socket probe (lightweight, no TLS overhead)
    const socketProbe = (url) => new Promise((resolve) => {
      const req = http.get(url, { headers: { 'User-Agent': 'MEEM/3.0' }, timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200 || res.statusCode === 204 || res.statusCode === 301 || res.statusCode === 302);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    try {
      const results = await Promise.all([
        socketProbe('http://www.google.com/generate_204'),
        socketProbe('http://connectivitycheck.gstatic.com/generate_204'),
        socketProbe('http://1.1.1.1')
      ]);
      return results.some(r => r === true);
    } catch (_) {
      return true; // Default to online on error to avoid false red indicator
    }
  };

  ipcMain.handle('check-network-status', async () => {
    return probeNodeConnectivity();
  });


  if (session && session.defaultSession) {
    // ── METAHUB NORMALIZER ────────────────────────────────────────────────
    // Normalize any legacy/alternate metahub URLs directly to images.metahub.space
    session.defaultSession.webRequest.onBeforeRequest({
      urls: ['*://*.metahub.space/*', '*://metahub.space/*']
    }, (details, callback) => {
      let url = details.url;
      const imdbMatch = url.match(/tt\d+/i);
      const imdbId = imdbMatch ? imdbMatch[0] : null;

      if (url.includes('images.metahub.space') && (url.endsWith('/img') || url.includes('/img?'))) {
        return callback({}); // Pass through unaltered
      }

      if (url.includes('/background/') && imdbId) {
        return callback({ redirectURL: `https://images.metahub.space/background/large/${imdbId}/img` });
      } else if ((url.includes('/poster/') || url.includes('/img') || url.includes('/logo/')) && imdbId) {
        const type = url.includes('/logo/') ? 'logo' : 'poster';
        return callback({ redirectURL: `https://images.metahub.space/${type}/medium/${imdbId}/img` });
      }

      const newUrl = url.replace(/https?:\/\/(live|episodes)\.metahub\.space/gi, 'https://images.metahub.space');
      if (newUrl !== url) {
        return callback({ redirectURL: newUrl });
      }
      callback({});
    });

    session.defaultSession.webRequest.onBeforeSendHeaders({
      urls: ['*://*/*']
    }, (details, callback) => {

      details.requestHeaders = details.requestHeaders || {};
      
      const url = details.url.toLowerCase();

      // ── 1. YouTube & googlevideo.com streams ────────────────────────────
      if (url.includes('googlevideo.com') || url.includes('youtube.com') || url.includes('youtube-nocookie.com')) {
        if (url.includes('c=android_vr')) {
          details.requestHeaders['User-Agent'] = 'com.google.android.apps.youtube.vr.oculus/1.40.16 (Linux; U; Android 10; en_US; Quest 2)';
        } else if (url.includes('c=android') || url.includes('c=tvhtml5')) {
          details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Linux; GoogleTV 12; Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Safari/537.36';
        } else {
          details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        }
        details.requestHeaders['Referer'] = 'https://www.youtube.com/';
        details.requestHeaders['Origin'] = 'https://www.youtube.com';
        delete details.requestHeaders['Sec-Fetch-Site'];
        delete details.requestHeaders['Sec-Fetch-Mode'];
        delete details.requestHeaders['Sec-Fetch-Dest'];
        return callback({ cancel: false, requestHeaders: details.requestHeaders });
      }

      // ── 2. IPTV stream links, M3U playlists, HLS segments ─────────────
      const isIptvRequest = url.includes('.m3u8') ||
                            url.includes('.m3u') ||
                            url.includes('.ts?') ||
                            url.includes('.ts') && (url.includes('/live/') || url.includes('iptv') || url.includes('stream')) ||
                            url.includes('/live/') ||
                            url.includes('/get.php') ||
                            url.includes('iptv') ||
                            url.includes('nexotv') ||
                            url.includes('player_api');

      if (isIptvRequest) {
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        details.requestHeaders['Accept'] = '*/*';
        delete details.requestHeaders['Origin'];
        if (!details.requestHeaders['Referer'] || details.requestHeaders['Referer'].includes('file://')) {
          try {
            const u = new URL(details.url);
            details.requestHeaders['Referer'] = `${u.protocol}//${u.host}/`;
          } catch (e) {}
        }
      } else {
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }

      if (url.startsWith('http')) {
        try {
          const urlObj = new URL(details.url);
          const host = urlObj.hostname.toLowerCase();
          
          if (host.includes('animecix') || host.includes('watchanimeworld') || host.includes('docci') || host.includes('github') || host.includes('wikimedia') || host.includes('consumet')) {
            details.requestHeaders['Referer'] = urlObj.origin + '/';
            details.requestHeaders['Origin'] = urlObj.origin;
          }
          else if (host.includes('wikimedia.org') || host.includes('wikipedia.org')) {
            details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
          }
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

    session.defaultSession.webRequest.onHeadersReceived({
      urls: ['*://*/*']
    }, (details, callback) => {
      const responseHeaders = details.responseHeaders || {};
      
      // ── RADICAL 404 IMAGE INTERCEPTOR ──────────────────────────────────────
      // Intercept 404 responses for poster/background CDN requests and redirect to
      // a transparent pixel Data URI so Chromium's network engine never emits a 404 error!
      if (details.statusCode === 404 && details.url) {
        const u = details.url.toLowerCase();
        if (u.includes('cinemeta.strem.io') || u.includes('metahub.space') || u.includes('/poster/') || u.includes('/background/')) {
          return callback({
            redirectURL: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg=='
          });
        }
      }

      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Headers'] = ['*'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS, PUT, DELETE, HEAD'];
      callback({ responseHeaders });
    });

  }

  const win = createWindow();

  // ─── STANDARD ELECTRON TRAY ───
  let trayState = {
    status: 'Idle',
    isPlaying: false,
    syncEnabled: true,
    isExternalPlayer: false,
  };

  const updateTrayMenu = () => {
    if (!tray || tray.isDestroyed()) return;
    const safeSend = (channel, ...args) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    };

    const items = [
      { label: `MEEM v${app.getVersion()}`, enabled: false },
      { type: 'separator' }
    ];

    if (trayState.isExternalPlayer) {
      items.push(
        { label: `Status: ${trayState.status || 'External Playback'}`, enabled: false },
        { label: 'Playing in External Player', enabled: false }
      );
    } else {
      items.push(
        { label: `Status: ${trayState.status}`, enabled: false },
        { 
          label: trayState.isPlaying ? 'Pause Playback' : 'Resume Playback', 
          click: () => safeSend('player-control', 'toggle') 
        }
      );
    }

    items.push(
      { type: 'separator' },
      { label: 'Pause Downloads', click: () => safeSend('downloads-control', 'pause-all') },
      { label: 'Settings', click: () => { if (win && !win.isDestroyed()) { win.show(); safeSend('switch-view', 'settings'); } } },
      { label: 'Show MEEM', click: () => { if (win && !win.isDestroyed()) win.show(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    );

    const contextMenu = Menu.buildFromTemplate(items);
    tray.setContextMenu(contextMenu);
  };

  // Initialize Tray
  const iconPath = path.join(__dirname, 'src', 'renderer', 'imgs', 'appicon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('MEEM');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (win && !win.isDestroyed()) win.show();
  });

  // Listeners for Dynamic Updates from Renderer or Main IPC
  ipcMain.on('update-tray-status', (event, payload) => {
    if (!payload) return;
    const { status, isPlaying, syncEnabled, isExternalPlayer } = payload;
    if (status !== undefined) trayState.status = status;
    if (isPlaying !== undefined) trayState.isPlaying = !!isPlaying;
    if (syncEnabled !== undefined) trayState.syncEnabled = !!syncEnabled;
    if (isExternalPlayer !== undefined) trayState.isExternalPlayer = !!isExternalPlayer;
    updateTrayMenu();
  });

  // Internal main process listener for tray updates
  app.on('update-tray-status-internal', (payload) => {
    if (!payload) return;
    const { status, isPlaying, isExternalPlayer } = payload;
    if (status !== undefined) trayState.status = status;
    if (isPlaying !== undefined) trayState.isPlaying = !!isPlaying;
    if (isExternalPlayer !== undefined) trayState.isExternalPlayer = !!isExternalPlayer;
    updateTrayMenu();
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
  // net.isOnline() in Electron only checks Chromium's internal DNS check — not actual internet.
  // After travel/ISP changes it can get stuck returning false. We probe real endpoints instead.
  let _lastOnlineState = null;
  async function broadcastConnectivity() {
      try {
        const isOnline = await probeNodeConnectivity();
        if (isOnline !== _lastOnlineState) {
          _lastOnlineState = isOnline;
          const mainWin = getMainWindow();
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('connectivity-changed', { isOnline });
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Check immediately on startup then every 15 seconds
    setTimeout(broadcastConnectivity, 1500);
    setInterval(broadcastConnectivity, 15000);

    // Also wire up Electron's native online/offline events
    const { powerMonitor } = require('electron');
    try {
      powerMonitor.on('unlock-screen', broadcastConnectivity);
    } catch (e) { /* powerMonitor event optional */ }
  // ──────────────────────────────────────────────────────────────────────────


  // LOG BRIDGE: Renderer → Main process log forwarding (filters noisy messages)
  ipcMain.on('log-bridge', (event, data) => {
    if (!data) return;
    const { level = 'log', msg = '' } = data;
    if (msg.includes('[RENDER-SOCIAL]') || msg.includes('[SCAN]') || msg.includes('[INIT]')) return;
    const logLevel = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    log('RENDERER', msg, logLevel);
    // Also persist to debug.log (replaces the old console monkey-patch)
    writeToDebugFile(`RENDERER/${logLevel.toUpperCase()}`, msg);
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

