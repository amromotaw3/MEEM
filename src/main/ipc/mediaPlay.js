const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { toMediaProtocolUrl } = require('../mediaProtocol');
const { startStreaming, stopStreaming } = require('../streamer');
const { createPlayerWindow } = require('../windowManager');

let activePlayerChild = null;
let activeVlcChild = null;

function getMeemPlayerConfig() {
  const isWin = process.platform === 'win32';
  const appExecDir = process.execPath ? path.dirname(process.execPath) : null;
  
  // 1. Root directories of MEEM Player to inspect
  const candidateDirs = [
    appExecDir ? path.join(appExecDir, 'MEEM-Player') : null,
    appExecDir ? path.join(appExecDir, 'resources', 'MEEM-Player') : null,
    appExecDir ? path.join(appExecDir, '..', 'MEEM-Player') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'MEEM-Player') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'MEEM-Player') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'MEEM Player') : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'MEEM Player') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'MEEM Player') : null,
    path.resolve(__dirname, '../../../../MEEM Player'),
    path.resolve(process.cwd(), '../MEEM Player'),
    'C:\\Users\\motawa\\Documents\\MEEM-Workspace\\MEEM Player'
  ].filter(Boolean);

  for (const baseDir of candidateDirs) {
    if (!fs.existsSync(baseDir)) continue;

    // Check for pre-built EXE
    const exePaths = [
      path.join(baseDir, 'MEEM-Player.exe'),
      path.join(baseDir, 'dist', 'MEEM-Player.exe'),
      path.join(baseDir, 'dist', 'main.exe'),
      path.join(baseDir, 'main.exe')
    ];
    for (const exe of exePaths) {
      if (fs.existsSync(exe)) {
        return { type: 'exe', command: exe, args: [], cwd: baseDir };
      }
    }

    // Check for .venv Python
    const venvPy = path.join(baseDir, '.venv', isWin ? 'Scripts\\python.exe' : 'bin/python');
    const mainPy = path.join(baseDir, 'main.py');
    if (fs.existsSync(venvPy) && fs.existsSync(mainPy)) {
      return { type: 'python', command: venvPy, args: [mainPy], cwd: baseDir };
    }

    // Check for run_player.bat
    const batPath = path.join(baseDir, 'run_player.bat');
    if (fs.existsSync(batPath)) {
      return { type: 'bat', command: batPath, args: [], cwd: baseDir };
    }
  }

  return null;
}

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
    clean = decodeURIComponent(clean);
    if (/^[a-zA-Z]:/.test(clean)) {
      clean = path.normalize(clean);
    } else if (/^\/[a-zA-Z]:/.test(clean)) {
      clean = path.normalize(clean.slice(1));
    }
    if (fs.existsSync(clean)) {
      return clean;
    }
  }

  return str;
}

function initMediaPlayIpc(ipcMain) {
  async function playNativeWindow(args) {
    try {
      const opts = typeof args === 'string' ? { path: args } : (args || {});
      const raw = opts.url || opts.path || opts.pathOrUrl || opts.filePath || '';
      const startTime = typeof opts.startTime === 'number' ? Math.max(0, Math.floor(opts.startTime)) : 0;

      // ── DETECT ACTIVE LOCAL TORRENT STREAM ──
      const isLocalStream = /^https?:\/\/(127\.0\.0\.1|localhost):1147\d\//i.test(raw);
      if (isLocalStream && (opts.item?.torrentMagnet || opts.torrentMagnet)) {
        console.log('[PLAY-NATIVE] Using already active torrent stream:', raw);
        createPlayerWindow({
          url: raw,
          path: raw,
          title: opts.title || opts.name || 'Torrent Playback',
          startTime,
          pbKey: opts.pbKey,
          item: {
            ...(opts.item || {}),
            torrentMagnet: opts.item?.torrentMagnet || opts.torrentMagnet
          },
          show: opts.show,
          isTorrentStream: true
        });
        return { success: true, player: 'native', source: 'torrent', streamUrl: raw };
      }

      // ── DETECT MAGNET / INFOHASH ──
      const isMagnet = /^magnet:/i.test(raw);
      const isInfoHash = /^[a-f0-9]{40}$/i.test(raw);

      if (isMagnet || isInfoHash) {
        console.log('[PLAY-NATIVE] Detected torrent input, starting WebTorrent stream...');
        const res = await startStreaming(raw, opts.fileIdx ?? null);
        if (!res || !res.success) {
          throw new Error(res?.error || 'Failed to start torrent stream');
        }
        let streamUrl = res.localUrl || res.url;
        console.log('[PLAY-NATIVE] Torrent stream ready:', streamUrl);
        createPlayerWindow({
          url: streamUrl,
          path: streamUrl,
          title: opts.title || res.title || opts.name || 'Torrent Playback',
          startTime,
          pbKey: opts.pbKey,
          item: {
            ...(opts.item || {}),
            torrentFiles: res.files,
            fileIdx: res.fileIdx,
            torrentMagnet: raw
          },
          show: opts.show,
          isTorrentStream: true
        });
        return { success: true, player: 'native', source: 'torrent', streamUrl };
      }

      // ── LOCAL FILE or HTTP URL ──
      const mediaUrl = toMediaProtocolUrl(raw);
      createPlayerWindow({
        url: mediaUrl,
        path: mediaUrl,
        title: opts.title || opts.name || 'Playback',
        startTime,
        pbKey: opts.pbKey,
        item: opts.item,
        show: opts.show
      });
      return { success: true, player: 'native' };
    } catch (err) {
      console.error('[PLAY-NATIVE] Native player failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── PRIMARY PLAYER: MEEM PLAYER ─────────────────────────────────────────
  async function openInMeemPlayer(args) {
    try {
      const config = getMeemPlayerConfig();
      if (!config) {
        return { success: false, error: 'MEEM Player not configured or not found' };
      }

      const opts = typeof args === 'string' ? { path: args } : (args || {});
      let raw = opts.url || opts.path || opts.pathOrUrl || opts.filePath || '';
      const startTime = typeof opts.startTime === 'number' ? Math.max(0, Math.floor(opts.startTime)) : 0;

      raw = resolveRealMediaUrlOrPath(raw);

      // ── DETECT YOUTUBE STREAM ──
      const isYtUrl = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.test(raw);
      const isYtId = /^[a-zA-Z0-9_-]{11}$/.test(raw) && (opts.item?.isYoutube || opts.item?.type === 'youtube' || opts.isYoutube);
      let ytAudioUrl = null;
      if (isYtUrl || isYtId) {
        const vId = isYtId ? raw : raw.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)[1];
        console.log('[MEEM-PLAYER] Resolving YouTube video stream for ID:', vId);
        try {
          const YouTubeService = require('../youtube/YouTubeService');
          const ytRes = await YouTubeService.getVideoDetails(vId, '1080');
          if (ytRes && ytRes.success && ytRes.details?.streamUrl) {
            raw = ytRes.details.streamUrl;
            if (ytRes.details.audioStreamUrl) {
              ytAudioUrl = ytRes.details.audioStreamUrl;
            }
            if (!opts.title && ytRes.details.title) {
              opts.title = ytRes.details.title;
            }
            console.log('[MEEM-PLAYER] ✓ YouTube resolved to 1080p stream:', raw.slice(0, 60) + '...', 'audio:', ytAudioUrl ? 'yes' : 'no');
          }
        } catch (ytErr) {
          console.warn('[MEEM-PLAYER] YouTubeService resolution warning:', ytErr.message);
        }
      }

      let allFiles = opts.item?.torrentFiles || opts.torrentFiles || [];
      let torrentRes = null;
      const isMagnet = /^magnet:/i.test(raw) || /^[a-f0-9]{40}$/i.test(raw);
      if (isMagnet) {
        console.log('[MEEM-PLAYER] Starting WebTorrent stream for MEEM Player:', raw);
        torrentRes = await startStreaming(raw, opts.fileIdx ?? null);
        if (!torrentRes || !torrentRes.success) throw new Error(torrentRes?.error || 'Failed to start torrent stream');
        raw = torrentRes.localUrl || torrentRes.url;
        if (torrentRes.files && torrentRes.files.length > 0) {
          allFiles = torrentRes.files;
        }
      }

      if (activePlayerChild) {
        try { activePlayerChild.kill(); } catch (e) {}
        activePlayerChild = null;
      }

      const playerArgs = [...config.args];

      if (opts.title) {
        playerArgs.push(`--title=${opts.title}`);
      }
      if (startTime > 0) {
        playerArgs.push(`--start-time=${startTime}`);
      }
      if (opts.subPath && fs.existsSync(opts.subPath)) {
        playerArgs.push(`--sub=${opts.subPath}`);
      }
      if (ytAudioUrl) {
        playerArgs.push(`--audio=${ytAudioUrl}`);
      }

      // 1. Structured Playlist (e.g. TV Show with TMDB posters/thumbnails)
      let hasCustomPlaylist = false;
      if (opts.playlist && Array.isArray(opts.playlist) && opts.playlist.length > 0) {
        const plPath = path.join(require('os').tmpdir(), 'meem_player_playlist.json');
        try {
          fs.writeFileSync(plPath, JSON.stringify(opts.playlist), 'utf8');
          playerArgs.push(`--playlist=${plPath}`);
          if (typeof opts.playlistIndex === 'number') {
            playerArgs.push(`--playlist-index=${opts.playlistIndex}`);
          }
          hasCustomPlaylist = true;
        } catch (e) {
          console.error('[MEEM-PLAYER] Error writing playlist temp file:', e);
        }
      }

      // 2. Direct media file or stream URL (if not using structured playlist)
      if (raw && !hasCustomPlaylist) {
        playerArgs.push(raw);
      }

      // 3. Additional playlist items for multi-file torrent
      if (!hasCustomPlaylist && allFiles && allFiles.length > 1) {
        const currentPort = 11470;
        const selectedIdx = opts.fileIdx != null ? parseInt(opts.fileIdx, 10) : (torrentRes?.fileIdx ?? 0);
        const sorted = [...allFiles].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
        for (const f of sorted) {
          if (f.idx !== selectedIdx) {
            const safeName = encodeURIComponent(f.name || '');
            playerArgs.push(`http://127.0.0.1:${currentPort}/${f.idx}/${safeName}`);
          }
        }
      }

      console.log('[MEEM-PLAYER] 🚀 Launching MEEM Player:', { command: config.command, args: playerArgs, cwd: config.cwd });

      const child = spawn(config.command, playerArgs, {
        cwd: config.cwd,
        stdio: 'ignore'
      });

      activePlayerChild = child;

      const { app } = require('electron');
      if (app) {
        app.emit('update-tray-status-internal', { status: 'Playing (MEEM Player)', isPlaying: true, isExternalPlayer: true });
      }

      child.on('exit', (code) => {
        console.log(`[MEEM-PLAYER] MEEM Player closed (exit code: ${code}). Stopping stream.`);
        if (activePlayerChild === child) {
          activePlayerChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      child.on('close', () => {
        if (activePlayerChild === child) {
          activePlayerChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      child.on('error', (err) => {
        console.error('[MEEM-PLAYER] Spawn error:', err.message);
        if (activePlayerChild === child) {
          activePlayerChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      return { success: true, player: 'meem-player', streamUrl: raw };
    } catch (e) {
      console.error('[MEEM-PLAYER] Launch failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  // ─── SECONDARY PLAYER: VLC MEDIA PLAYER ───────────────────────────────────
  async function openInVlc(args) {
    try {
      const opts = typeof args === 'string' ? { path: args } : (args || {});
      let raw = opts.url || opts.path || opts.pathOrUrl || opts.filePath || '';
      const startTime = typeof opts.startTime === 'number' ? Math.max(0, Math.floor(opts.startTime)) : 0;

      raw = resolveRealMediaUrlOrPath(raw);

      let allFiles = opts.item?.torrentFiles || opts.torrentFiles || [];
      let torrentRes = null;
      const isMagnet = /^magnet:/i.test(raw) || /^[a-f0-9]{40}$/i.test(raw);
      if (isMagnet) {
        console.log('[VLC] Starting WebTorrent stream for VLC playback:', raw);
        torrentRes = await startStreaming(raw, opts.fileIdx ?? null);
        if (!torrentRes || !torrentRes.success) throw new Error(torrentRes?.error || 'Failed to start torrent stream');
        raw = torrentRes.localUrl || torrentRes.url;
        if (torrentRes.files && torrentRes.files.length > 0) {
          allFiles = torrentRes.files;
        }
      }

      // Determine VLC executable
      const vlcCmd = getVlcExecutable();
      const skinPath = getVlcSkinPath();

      if (activeVlcChild) {
        try { activeVlcChild.kill(); } catch (e) {}
        activeVlcChild = null;
      }

      console.log('[VLC] Launching VLC with MEEM Theme:', { vlcCmd, skinPath, raw, startTime, filesCount: allFiles?.length || 0 });

      let child;
      if (process.platform === 'darwin') {
        const vlcAppArgs = ['-a', 'VLC'];
        if (raw) vlcAppArgs.push(raw);
        child = spawn('open', vlcAppArgs, { stdio: 'ignore' });
      } else {
        const vlcArgs = [];
        if (process.platform === 'win32' && skinPath && fs.existsSync(skinPath)) {
          vlcArgs.push('--intf', 'skins2', '--skins2-last', skinPath);
        }
        vlcArgs.push('--network-caching=2000');
        if (startTime > 0) {
          vlcArgs.push('--start-time', String(Math.floor(startTime)));
        }
        if (opts.title) {
          vlcArgs.push('--meta-title', opts.title);
        }
        if (opts.subPath && fs.existsSync(opts.subPath)) {
          vlcArgs.push('--sub-file', opts.subPath);
        }

        // Multi-file torrent / episode playlist support in VLC
        if (allFiles && allFiles.length > 1) {
          const currentPort = 11470;
          const selectedIdx = opts.fileIdx != null ? parseInt(opts.fileIdx, 10) : (torrentRes?.fileIdx ?? 0);
          if (raw) vlcArgs.push(raw);
          const sorted = [...allFiles].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
          for (const f of sorted) {
            if (f.idx !== selectedIdx) {
              const safeName = encodeURIComponent(f.name || '');
              vlcArgs.push(`http://127.0.0.1:${currentPort}/${f.idx}/${safeName}`);
            }
          }
        } else if (raw) {
          vlcArgs.push(raw);
        }

        child = spawn(vlcCmd, vlcArgs, { stdio: 'ignore' });
      }

      activeVlcChild = child;

      const { app } = require('electron');
      if (app) {
        app.emit('update-tray-status-internal', { status: 'Playing (VLC)', isPlaying: true, isExternalPlayer: true });
      }

      child.on('exit', (code) => {
        console.log(`[VLC] VLC closed (exit code: ${code}). Stopping torrent stream.`);
        if (activeVlcChild === child) {
          activeVlcChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      child.on('close', () => {
        if (activeVlcChild === child) {
          activeVlcChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      child.on('error', (err) => {
        console.error('[VLC] Spawn error:', err.message);
        if (activeVlcChild === child) {
          activeVlcChild = null;
          stopStreaming().catch(() => {});
          if (app) app.emit('update-tray-status-internal', { status: 'Idle', isPlaying: false, isExternalPlayer: false });
        }
      });

      return { success: true, player: 'vlc', streamUrl: raw };
    } catch (e) {
      console.error('[VLC] openInVlc failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Primary playback router: MEEM Player (Standalone if installed) -> MEEM Built-in Player Window -> VLC (Only when explicitly chosen)
  async function playMedia(args) {
    const opts = typeof args === 'string' ? { path: args } : (args || {});
    
    // Explicit request for VLC
    if (opts.player === 'vlc' || opts.engine === 'vlc') {
      return openInVlc(args);
    }

    // Explicit request for native/internal player window
    if (opts.forceNative || opts.player === 'native' || opts.engine === 'native') {
      return playNativeWindow(args);
    }

    // 1. PRIMARY: Standalone MEEM Player executable if available on the system
    const meemConfig = getMeemPlayerConfig();
    if (meemConfig) {
      const meemResult = await openInMeemPlayer(args);
      if (meemResult && meemResult.success) {
        return meemResult;
      }
      console.warn('[PLAY] Standalone MEEM Player launch failed, switching to built-in MEEM player window...', meemResult?.error);
    }

    // 2. DEFAULT & CORE: MEEM Built-in Cinematic Native Player Window
    // Guarantees distributed .exe plays seamlessly with MEEM's custom player interface on all users' machines
    return playNativeWindow(args);
  }

  ipcMain.handle('play-media', async (_e, args) => playMedia(args));
  ipcMain.handle('open-in-meem-player', async (_e, args) => openInMeemPlayer(args));
  ipcMain.handle('open-in-external-player', async (_e, args) => openInMeemPlayer(args));
  ipcMain.handle('open-in-vlc', async (_e, args) => openInVlc(args));
  ipcMain.handle('play-external', async (_e, args) => openInMeemPlayer(args));
  ipcMain.handle('play-native', async (_e, args) => playNativeWindow(args));

  ipcMain.handle('get-meem-player-status', async () => {
    const config = getMeemPlayerConfig();
    return {
      available: !!config,
      type: config?.type || null,
      command: config?.command || null,
      cwd: config?.cwd || null
    };
  });

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

module.exports = { initMediaPlayIpc };

