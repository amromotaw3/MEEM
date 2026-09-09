const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { toMediaProtocolUrl } = require('../mediaProtocol');
const { startStreaming, stopStreaming } = require('../streamer');
const { createPlayerWindow } = require('../windowManager');

let activeVlcChild = null;
let activeMeemPlayerChild = null;



function getVlcExecutable() {
  if (process.platform === 'win32') {
    const pathsToTest = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'VLC', 'vlc.exe'),
      path.join(process.env['USERPROFILE'] || '', 'AppData', 'Local', 'Programs', 'VLC', 'vlc.exe')
    ];
    for (const p of pathsToTest) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
    return 'vlc';
  } else if (process.platform === 'darwin') {
    const macPaths = [
      '/Applications/VLC.app/Contents/MacOS/VLC',
      path.join(process.env.HOME || '', 'Applications/VLC.app/Contents/MacOS/VLC')
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'open';
  }
  return 'vlc';
}

function getVlcSkinPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'VLC skin', 'MEEM-skin.vlt') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'VLC skin', 'MEEM-skin.vlt') : null,
    path.join(__dirname, '..', '..', 'assets', 'VLC skin', 'MEEM-skin.vlt'),
    path.join(__dirname, '..', '..', 'assets', 'skins', 'MEEM.vlt'),
    path.join(process.env.APPDATA || '', 'vlc', 'skins', 'MEEM-skin.vlt'),
    path.join(process.env.APPDATA || '', 'vlc', 'skins', 'MEEM.vlt')
  ];

  let resolvedSkin = null;
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      resolvedSkin = c;
      break;
    }
  }

  // Ensure skin is copied to %APPDATA%\vlc\skins\ so VLC can also register it natively
  if (resolvedSkin && process.platform === 'win32' && process.env.APPDATA) {
    try {
      const vlcSkinsDir = path.join(process.env.APPDATA, 'vlc', 'skins');
      if (!fs.existsSync(vlcSkinsDir)) {
        fs.mkdirSync(vlcSkinsDir, { recursive: true });
      }
      const targetSkin = path.join(vlcSkinsDir, 'MEEM-skin.vlt');
      if (!fs.existsSync(targetSkin) || fs.statSync(targetSkin).size !== fs.statSync(resolvedSkin).size) {
        fs.copyFileSync(resolvedSkin, targetSkin);
      }
      return targetSkin;
    } catch (e) {
      console.warn('[VLC] Could not sync skin to APPDATA:', e.message);
    }
  }

  return resolvedSkin;
}

function resolveRealMediaUrlOrPath(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  if (/^(media|local-file|file):\/\//i.test(str)) {
    let clean = str.replace(/^(media|local-file|file):\/\/\/?/i, '');
    try { clean = decodeURIComponent(clean); } catch (_) {}
    clean = clean.replace(/\//g, '\\');
    if (/^\\[a-zA-Z]:/.test(clean)) clean = clean.slice(1);
    if (/^[a-zA-Z]:/.test(clean)) {
      return path.normalize(clean);
    }
    return clean;
  }

  if (/^[a-zA-Z]:[\\/]/i.test(str)) {
    try { str = decodeURIComponent(str); } catch (_) {}
    return path.normalize(str);
  }

  return str;
}

function getMeemPlayerConfig() {
  const os = require('os');
  const userHome = os.homedir() || process.env.USERPROFILE || '';
  const exeName = process.platform === 'win32' ? 'MEEM-Player.exe' : 'MEEM-Player';
  const cppExeName = process.platform === 'win32' ? 'MEEM-Player-CPP.exe' : 'MEEM-Player-CPP';

  // Candidate directories where MEEM Player may reside
  const dirCandidates = [
    // 1. Packaged Electron app extraResources directory (Production Build)
    process.resourcesPath ? path.join(process.resourcesPath, 'MEEM-Player') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'MEEM-Player') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'MEEM-Player') : null,

    // 2. Application root folder (installed next to main executable)
    process.execPath ? path.join(path.dirname(process.execPath), 'resources', 'MEEM-Player') : null,
    process.execPath ? path.join(path.dirname(process.execPath), 'MEEM-Player') : null,

    // 3. Development Workspace candidates
    `C:\\Users\\motawa\\Documents\\MEEM-Workspace\\MEEM Player`,
    path.join(userHome, 'Documents', 'MEEM-Workspace', 'MEEM Player'),
    path.join(process.cwd(), '..', 'MEEM Player'),
    path.join(process.cwd(), 'MEEM Player'),
    path.join(__dirname, '..', '..', '..', 'MEEM Player')
  ].filter(Boolean);

  for (const dir of dirCandidates) {
    if (!fs.existsSync(dir)) continue;

    // A. Check C++ Executable (MEEM-Player.exe or MEEM-Player-CPP.exe)
    const rootExe = path.join(dir, exeName);
    if (fs.existsSync(rootExe)) {
      return { available: true, type: 'exe', command: rootExe, cwd: dir };
    }
    const cppExe = path.join(dir, cppExeName);
    if (fs.existsSync(cppExe)) {
      return { available: true, type: 'exe', command: cppExe, cwd: dir };
    }

    // B. Check C++ Runner Script
    const batCpp = path.join(dir, 'run_cpp_player.bat');
    if (fs.existsSync(batCpp)) {
      return { available: true, type: 'bat', command: batCpp, cwd: dir };
    }
  }

  return { available: false };
}

let activeWebEmbedWindow = null;

function openWebEmbedPlayerWindow(embedUrl, opts = {}) {
  const { BrowserWindow, app } = require('electron');
  if (activeWebEmbedWindow && !activeWebEmbedWindow.isDestroyed()) {
    try { activeWebEmbedWindow.close(); } catch (e) {}
    activeWebEmbedWindow = null;
  }

  const mediaTitle = opts.title || opts.name || 'Stream';

  activeWebEmbedWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    title: `MEEM Player — ${mediaTitle}`,
    autoHideMenuBar: true,
    backgroundColor: '#050508',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  activeWebEmbedWindow.setMenu(null);
  activeWebEmbedWindow.loadURL(embedUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  if (app) app.emit('update-tray-status-internal', { status: 'Playing Web Stream', isPlaying: true, isExternalPlayer: true });

  activeWebEmbedWindow.on('closed', () => {
    activeWebEmbedWindow = null;
    if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
  });

  return { success: true, player: 'meem-web-player', streamUrl: embedUrl };
}

async function openInMeemPlayer(args) {
  const opts = typeof args === 'string' ? { path: args } : (args || {});
  let raw = opts.path || opts.url || opts.streamUrl || opts.mediaUrl;
  if (!raw && opts.item) raw = opts.item.path || opts.item.url;

  let torrentFiles = null;
  let torrentSelectedIdx = 0;

  // Extract Poster / Thumbnail & Series Metadata
  const poster = opts.poster || opts.thumbnail || opts.still_path || opts.image ||
                 opts.item?.thumbnail || opts.item?.still_path || opts.item?.poster || opts.item?.poster_path ||
                 opts.show?.poster || opts.show?.poster_path || opts.show?.still_path;
  const showTitle = opts.showTitle || opts.seriesTitle || opts.item?.showTitle || opts.item?.seriesTitle || opts.show?.title || opts.show?.name;
  const season = opts.season ?? opts.item?.season;
  const episode = opts.episode ?? opts.item?.episode;
  const subTitle = showTitle ? (season != null && episode != null ? `${showTitle} • S${season}E${episode}` : `${showTitle}`) : (opts.subtitle || opts.subTitle || null);

  // If magnet or torrent file, resolve stream URL
  if (raw && (raw.startsWith('magnet:') || raw.endsWith('.torrent'))) {
    const res = await startStreaming(raw, opts.fileIdx).catch(e => {
      console.warn('[Streamer] startStreaming error:', e.message);
      return null;
    });
    if (res && res.url) {
      raw = res.url;
      if (Array.isArray(res.files) && res.files.length > 0) {
        torrentFiles = res.files;
        torrentSelectedIdx = res.fileIdx ?? 0;
      }
    }
  }

  if (!raw && (!opts.playlist || opts.playlist.length === 0)) {
    return { success: false, error: 'No media path provided' };
  }

  let targetPath = raw ? resolveRealMediaUrlOrPath(raw) : '';

  // Handle Web Embed URLs (VidSrc, 2embed, superembed, etc.)
  if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
    const isEmbed = targetPath.includes('/embed/') || targetPath.includes('vidsrc') || targetPath.includes('2embed') || targetPath.includes('superembed');
    if (isEmbed) {
      console.log(`[MEEM Player] Target is Web Embed URL (${targetPath}). Opening in dedicated Web Embed Window...`);
      return openWebEmbedPlayerWindow(targetPath, opts);
    }
  }

  const config = getMeemPlayerConfig();
  if (!config.available) {
    console.error('[MEEM Player] Standalone MEEM Player executable not found');
    return { success: false, error: 'MEEM Player executable not found' };
  }

  const cliArgs = [];
  if (config.type === 'python') {
    cliArgs.push(config.script);
  }

  // Check if a full playlist array was provided (e.g. from local TV show or season torrent)
  let playlistItems = Array.isArray(opts.playlist) ? [...opts.playlist] : [];

  // If torrent returned multiple video files, convert them to a playlist
  if (torrentFiles && torrentFiles.length > 0) {
    const portMatch = targetPath.match(/:(\d+)\//);
    const streamPort = portMatch ? portMatch[1] : '11470';
    const isTvShow = Boolean(season != null || (opts.type && opts.type !== 'movie') || (showTitle && showTitle !== opts.title));
    playlistItems = torrentFiles.map((f, i) => ({
      path: `http://127.0.0.1:${streamPort}/${f.idx}/${encodeURIComponent(f.name)}`,
      title: (!isTvShow || torrentFiles.length === 1) ? (opts.title || f.name) : f.name,
      show_title: isTvShow ? (showTitle || opts.title || '') : '',
      season: isTvShow ? (season || 1) : 0,
      episode: isTvShow ? (f.idx + 1) : 0,
      thumbnail: poster || ''
    }));
  }

  let tempPlaylistPath = null;
  if (playlistItems.length > 0) {
    try {
      const initialIdx = opts.playlistIndex != null ? opts.playlistIndex : (torrentSelectedIdx || 0);
      if (initialIdx >= 0 && initialIdx < playlistItems.length && targetPath) {
        playlistItems[initialIdx].path = targetPath;
        playlistItems[initialIdx].url = targetPath;
      }
      const os = require('os');
      tempPlaylistPath = path.join(os.tmpdir(), `meem_playlist_${Date.now()}.json`);
      fs.writeFileSync(tempPlaylistPath, JSON.stringify(playlistItems, null, 2), 'utf-8');
      cliArgs.push(`--playlist=${tempPlaylistPath}`);
      cliArgs.push(`--playlist-index=${initialIdx}`);
    } catch (e) {
      console.warn('[MEEM Player] Could not create temporary playlist file:', e.message);
    }
  }

  if (targetPath) cliArgs.push(targetPath);
  if (opts.title || opts.name) cliArgs.push(`--title=${opts.title || opts.name}`);
  if (opts.startTime && opts.startTime > 0) cliArgs.push(`--start-time=${opts.startTime}`);
  if (opts.subtitle || opts.subPath) cliArgs.push(`--sub=${opts.subtitle || opts.subPath}`);
  if (poster) cliArgs.push(`--poster=${poster}`);
  if (subTitle) cliArgs.push(`--subtitle=${subTitle}`);

  // Playback key and profile for progress tracking
  const pbKey = opts.pbKey || (opts.item ? (opts.item.id || opts.item.path) : targetPath);
  let profileId = opts.profileId;
  if (!profileId) {
    try {
      const { readLocalAppData } = require('../store');
      const local = readLocalAppData();
      profileId = local?.profiles?.[0]?.id || 'default';
    } catch (_) {}
  }

  // Ensure local server is ready to obtain sync port
  let syncPort = null;
  try {
    const { ensureLocalServerReady } = require('../mediaServer');
    const baseUrl = await ensureLocalServerReady();
    if (baseUrl) {
      const urlObj = new URL(baseUrl);
      syncPort = urlObj.port;
    }
  } catch (e) {
    console.warn('[MEEM Player] Could not resolve local mediaServer port:', e.message);
  }

  const syncFilePath = path.join(os.tmpdir(), `meem_player_sync_${Date.now()}.json`);

  if (pbKey) cliArgs.push(`--pb-key=${pbKey}`);
  if (profileId) cliArgs.push(`--profile-id=${profileId}`);
  if (syncPort) cliArgs.push(`--sync-port=${syncPort}`);
  cliArgs.push(`--sync-file=${syncFilePath}`);

  console.log(`[MEEM Player] Spawning external player (${config.command}) with args:`, cliArgs);

  if (activeMeemPlayerChild) {
    try { activeMeemPlayerChild.kill(); } catch (e) {}
    activeMeemPlayerChild = null;
  }

  const sessionContext = {
    pbKey,
    profileId,
    item: opts.item,
    show: opts.show,
    title: opts.title || opts.name,
    poster,
    subTitle,
    raw,
    type: opts.type,
    fileIdx: opts.fileIdx,
    syncFilePath,
    startTime: opts.startTime || 0,
    lastReportedTime: opts.startTime || 0,
    startedAt: Date.now()
  };
  activeMeemSession = sessionContext;

  const child = spawn(config.command, cliArgs, {
    cwd: config.cwd,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  activeMeemPlayerChild = child;

  // Listen for real-time progress broadcasts from MEEM Player
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('[MEEM_PLAYBACK_PROGRESS]')) {
          try {
            const jsonPart = line.substring(line.indexOf('[MEEM_PLAYBACK_PROGRESS]') + '[MEEM_PLAYBACK_PROGRESS]'.length).trim();
            const data = JSON.parse(jsonPart);
            handleExternalPlayerProgress(data, sessionContext);
          } catch (e) {
            console.warn('[MEEM Player] Error parsing progress stdout:', e.message);
          }
        }
      }
    });
  }

  child.on('exit', () => {
    if (activeMeemPlayerChild === child) {
      activeMeemPlayerChild = null;
      stopStreaming().catch(() => {});
      if (tempPlaylistPath && fs.existsSync(tempPlaylistPath)) {
        try { fs.unlinkSync(tempPlaylistPath); } catch (e) {}
      }

      // Check sync file for final reported progress
      let reportedFinal = false;
      if (fs.existsSync(syncFilePath)) {
        try {
          const content = fs.readFileSync(syncFilePath, 'utf-8');
          const data = JSON.parse(content);
          if (data && data.key) {
            handleExternalPlayerProgress(data, sessionContext);
            reportedFinal = true;
          }
        } catch (e) {}
        try { fs.unlinkSync(syncFilePath); } catch (e) {}
      }

      // Fallback: If no progress was reported by player, use elapsed duration
      if (!reportedFinal && sessionContext.lastReportedTime === sessionContext.startTime) {
        const elapsed = Math.max(0, Math.floor((Date.now() - sessionContext.startedAt) / 1000));
        const finalTime = Math.floor(sessionContext.startTime + elapsed);
        if (finalTime > 5) {
          handleExternalPlayerProgress({
            key: sessionContext.pbKey,
            profileId: sessionContext.profileId,
            time: finalTime,
            duration: sessionContext.item?.duration || 0
          }, sessionContext);
        }
      }

      const { app } = require('electron');
      if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
    }
  });

  const { app } = require('electron');
  if (app) app.emit('update-tray-status-internal', { status: 'Playing in MEEM Player', isPlaying: true, isExternalPlayer: true });

  return { success: true, player: 'meem-player', streamUrl: targetPath };
}

let activeMeemSession = null;
let lastSupabaseSyncWall = 0;

async function handleExternalPlayerProgress(data, context = null) {
  try {
    const ctx = context || activeMeemSession;
    const profileId = data.profileId || ctx?.profileId;
    const key = data.key || ctx?.pbKey;
    if (!profileId || !key) return;

    const time = Number(data.time != null ? data.time : 0);
    const duration = Number(data.duration != null ? data.duration : 0);
    if (time <= 0 && duration <= 0) return;

    const prevTime = ctx?.lastReportedTime || 0;
    if (ctx) ctx.lastReportedTime = time;

    const watched = Boolean(data.watched || (duration > 0 && (time / duration) >= 0.90));

    let meta = ctx?.item || null;
    if (ctx?.show && meta && !meta.show) {
      meta = { ...meta, show: ctx.show, showTitle: ctx.show.title || ctx.show.name };
    }

    if (!meta) {
      meta = {
        id: key,
        title: ctx?.title || 'Playback',
        poster: ctx?.poster || null,
        backdrop_path: ctx?.poster || null,
        type: ctx?.type || (key.includes('_S') ? 'tv' : 'movie')
      };
    } else {
      if (!meta.title && ctx?.title) meta.title = ctx.title;
      if (!meta.poster && ctx?.poster) meta.poster = ctx.poster;
      if (!meta.backdrop_path && ctx?.poster) meta.backdrop_path = ctx.poster;
    }

    if (ctx?.raw && (ctx.raw.startsWith('magnet:') || ctx.raw.endsWith('.torrent'))) {
      meta.torrentMagnet = ctx.raw;
      if (ctx.fileIdx != null) meta.fileIdx = ctx.fileIdx;
    }

    // Always attach exact file path if available
    const resolvedPath = ctx?.raw || ctx?.item?.path || (key && (key.includes(':\\') || key.includes(':/') || key.startsWith('/')) ? key : null);
    if (resolvedPath && !resolvedPath.startsWith('magnet:')) {
      meta.path = resolvedPath;
    }

    const entry = {
      time: Math.floor(time),
      duration: Math.floor(duration),
      lastWatched: Date.now(),
      watched,
      meta
    };

    // Practical Cloud Throttling:
    // Sync to Supabase:
    // 1. Every 30 seconds during active playback
    // 2. Immediately if seek jump occurred (jump >= 5s)
    // 3. Immediately on pause, end of video, or window exit (data.force / data.isEnded / watched)
    const now = Date.now();
    const isSeekJump = Math.abs(time - prevTime) >= 5;
    const isSpecialEvent = Boolean(data.force || data.isEnded || isSeekJump || watched);
    const isPeriodicCloudSync = (now - lastSupabaseSyncWall >= 30000);

    const shouldSyncCloud = isSpecialEvent || isPeriodicCloudSync;
    if (shouldSyncCloud) {
      lastSupabaseSyncWall = now;
      console.log(`[MEEM Player -> Supabase] Syncing cloud snapshot: "${key}" => ${entry.time}s / ${entry.duration}s (watched=${watched})`);
    }

    // Local cache & UI is ALWAYS updated in real-time
    const { savePlaybackPositionInternal } = require('../store');
    if (typeof savePlaybackPositionInternal === 'function') {
      await savePlaybackPositionInternal({
        profileId,
        key,
        entry,
        localOnly: !shouldSyncCloud,
        forceImmediate: shouldSyncCloud
      });
    }
  } catch (err) {
    console.error('[MEEM Player] handleExternalPlayerProgress error:', err);
  }
}

async function openInVlc(args) {
  try {
    const opts = typeof args === 'string' ? { path: args } : (args || {});
    let raw = opts.path || opts.url || opts.streamUrl || opts.mediaUrl;
    if (!raw && opts.item) raw = opts.item.path || opts.item.url;

    if (!raw) {
      return { success: false, error: 'No media path provided' };
    }

    let targetPath = resolveRealMediaUrlOrPath(raw);

    const vlcCmd = getVlcExecutable();
    const skinPath = getVlcSkinPath();

    const vlcArgs = [];
    if (skinPath && fs.existsSync(skinPath) && process.platform === 'win32') {
      vlcArgs.push('--intf', 'skins2', `--skins2-last=${skinPath}`);
    }
    vlcArgs.push(targetPath);
    if (opts.subtitle || opts.subPath) {
      vlcArgs.push(`--sub-file=${opts.subtitle || opts.subPath}`);
    }
    if (opts.startTime && opts.startTime > 0) {
      vlcArgs.push(`--start-time=${Math.floor(opts.startTime)}`);
    }
    if (opts.title) {
      vlcArgs.push(`--meta-title=${opts.title}`);
    }

    if (activeVlcChild) {
      try { activeVlcChild.kill(); } catch (e) {}
      activeVlcChild = null;
    }

    const child = spawn(vlcCmd, vlcArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.unref();
    activeVlcChild = child;

    const { app } = require('electron');
    if (app) app.emit('update-tray-status-internal', { status: 'Playing in VLC', isPlaying: true, isExternalPlayer: true });

    child.on('exit', () => {
      if (activeVlcChild === child) {
        activeVlcChild = null;
        stopStreaming().catch(() => {});
        if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
      }
    });

    return { success: true, player: 'vlc', streamUrl: targetPath };
  } catch (e) {
    console.error('[VLC] openInVlc failed:', e.message);
    return { success: false, error: e.message };
  }
}

function initMediaPlayIpc(ipcMain) {
  async function playMedia(args) {
    const opts = typeof args === 'string' ? { path: args } : (args || {});
    
    // Explicit request for VLC
    if (opts.player === 'vlc' || opts.engine === 'vlc') {
      return openInVlc(args);
    }

    // DEFAULT & EXCLUSIVE: Launch MEEM Player
    return openInMeemPlayer(args);
  }

  ipcMain.handle('play-media', async (_e, args) => playMedia(args));
  ipcMain.handle('open-in-meem-player', async (_e, args) => openInMeemPlayer(args));
  ipcMain.handle('open-in-external-player', async (_e, args) => playMedia(args));
  ipcMain.handle('open-in-vlc', async (_e, args) => openInVlc(args));
  ipcMain.handle('play-external', async (_e, args) => playMedia(args));
  ipcMain.handle('play-native', async (_e, args) => openInMeemPlayer(args));

  ipcMain.handle('get-meem-player-status', async () => getMeemPlayerConfig());

  ipcMain.handle('get-vlc-status', async () => {
    const vlcCmd = getVlcExecutable();
    const skinPath = getVlcSkinPath();
    const vlcExists = process.platform === 'win32' ? (vlcCmd !== 'vlc' && fs.existsSync(vlcCmd)) : true;
    return {
      available: vlcExists,
      path: vlcCmd,
      skinPath: skinPath,
      skinExists: skinPath ? fs.existsSync(skinPath) : false
    };
  });

  // Start a one-off local HTTP stream for a given filesystem path and return the stream URL.
  ipcMain.handle('start-local-server', async (_e, filePath) => {
    try {
      if (!filePath) return null;
      const { ensureLocalServerReady } = require('../mediaServer');
      const baseUrl = await ensureLocalServerReady();
      return `${baseUrl}/stream?path=${encodeURIComponent(filePath)}`;
    } catch (err) {
      console.error('[IPC] start-local-server error:', err);
      return null;
    }
  });
}

module.exports = { initMediaPlayIpc, handleExternalPlayerProgress };
