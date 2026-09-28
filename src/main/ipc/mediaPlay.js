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
      path.join(process.env['USERPROFILE'] || '', 'AppData', 'Local', 'Programs', 'VLC', 'vlc.exe'),
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ];
    for (const p of pathsToTest) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  } else if (process.platform === 'darwin') {
    const macPaths = [
      '/Applications/VLC.app/Contents/MacOS/VLC',
      path.join(process.env.HOME || '', 'Applications/VLC.app/Contents/MacOS/VLC')
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  } else {
    const linuxPaths = ['/usr/bin/vlc', '/usr/local/bin/vlc', '/bin/vlc', '/snap/bin/vlc'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'vlc';
  }
}

function isVlcAvailable() {
  const exe = getVlcExecutable();
  if (!exe) return false;
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return fs.existsSync(exe);
  }
  return true;
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
  const { app } = require('electron');
  const os = require('os');
  const userHome = os.homedir() || process.env.USERPROFILE || '';
  const exeName = process.platform === 'win32' ? 'MEEM-Player.exe' : 'MEEM-Player';

  // Strict check for INSTALLED MEEM Player only (No dev workspace or portable runner scripts)
  const candidateExePaths = [];

  // 1. Packaged Electron app directory (when app is installed and packaged)
  if (process.resourcesPath) {
    candidateExePaths.push(path.join(process.resourcesPath, 'MEEM-Player', exeName));
    candidateExePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'MEEM-Player', exeName));
  }
  if (process.execPath) {
    candidateExePaths.push(path.join(path.dirname(process.execPath), 'resources', 'MEEM-Player', exeName));
    candidateExePaths.push(path.join(path.dirname(process.execPath), 'MEEM-Player', exeName));
  }

  // 2. Standard Windows Installed App directories
  if (process.platform === 'win32') {
    candidateExePaths.push(
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'MEEM Player', exeName),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'MEEM Player', exeName),
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'MEEM Player', exeName),
      path.join(process.env['LOCALAPPDATA'] || '', 'MEEM Player', exeName),
      'C:\\Program Files\\MEEM Player\\MEEM-Player.exe',
      'C:\\Program Files (x86)\\MEEM Player\\MEEM-Player.exe',
      path.join(userHome, 'Documents', 'MEEM-Workspace', 'MEEM Player', exeName),
      path.join(__dirname, '..', '..', '..', 'MEEM Player', exeName)
    );
  } else if (process.platform === 'darwin') {
    candidateExePaths.push(
      '/Applications/MEEM Player.app/Contents/MacOS/MEEM-Player',
      path.join(userHome, 'Applications', 'MEEM Player.app', 'Contents', 'MacOS', 'MEEM-Player')
    );
  } else {
    candidateExePaths.push(
      '/usr/bin/MEEM-Player',
      '/usr/local/bin/MEEM-Player',
      '/opt/MEEM-Player/MEEM-Player'
    );
  }

  for (const exePath of candidateExePaths) {
    if (exePath && fs.existsSync(exePath)) {
      const dir = path.dirname(exePath);
      console.log(`[MEEM Player] Found installed MEEM Player: ${exePath}`);
      return { available: true, type: 'exe', command: exePath, cwd: dir };
    }
  }

  console.log('[MEEM Player] Installed MEEM Player not found on system.');
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

function extractSeasonEpisode(filename) {
  if (!filename) return null;
  const clean = String(filename).trim();
  const sMatch = clean.match(/(?:s|season\s*)(\d{1,2})[\s._-]*(?:e|ep|episode\s*)(\d{1,3})/i);
  if (sMatch) {
    return { season: parseInt(sMatch[1], 10), episode: parseInt(sMatch[2], 10) };
  }
  const xMatch = clean.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (xMatch) {
    return { season: parseInt(xMatch[1], 10), episode: parseInt(xMatch[2], 10) };
  }
  const eMatch = clean.match(/(?:e|ep|episode)[\s._-]*(\d{1,3})\b/i);
  if (eMatch) {
    return { season: 1, episode: parseInt(eMatch[1], 10) };
  }
  return null;
}

async function openInMeemPlayer(args) {
  const opts = typeof args === 'string' ? { path: args } : (args || {});
  let raw = opts.path || opts.url || opts.streamUrl || opts.mediaUrl;
  if (!raw && opts.item) raw = opts.item.path || opts.item.url;

  let torrentFiles = null;
  let torrentSelectedIdx = 0;

  // Extract Poster / Thumbnail & Series Metadata
  let poster = opts.poster || opts.thumbnail || opts.still_path || opts.image ||
               opts.item?.thumbnail || opts.item?.still_path || opts.item?.poster || opts.item?.poster_path ||
               opts.show?.poster || opts.show?.poster_path || opts.show?.still_path;
  if (poster && poster.startsWith('/') && !poster.startsWith('//')) {
    poster = `https://image.tmdb.org/t/p/w500${poster}`;
  }

  const showTitle = opts.showTitle || opts.seriesTitle || opts.item?.showTitle || opts.item?.seriesTitle || opts.show?.title || opts.show?.name;
  const season = opts.season ?? opts.item?.season;
  const episode = opts.episode ?? opts.item?.episode;
  const subTitle = showTitle ? (season != null && episode != null ? `${showTitle} • S${season}E${episode}` : `${showTitle}`) : (opts.subtitle || opts.subTitle || null);

  // Resolve TMDB & IMDb IDs
  const resolvedTmdbId = opts.tmdbId || opts.item?.tmdbId || opts.item?.id || opts.show?.id || (opts.id && !String(opts.id).startsWith('tt') ? opts.id : null);
  const resolvedImdbId = opts.imdbId || opts.item?.imdb_id || opts.item?.imdbId || (opts.id && String(opts.id).startsWith('tt') ? opts.id : null);

  // Read preferred YouTube playback quality & API Keys from settings
  let preferredQuality = '1080';
  let localData = {};
  try {
    const { readLocalAppData } = require('../store');
    localData = readLocalAppData() || {};
    if (localData?.youtubeQuality) {
      preferredQuality = localData.youtubeQuality;
    }
  } catch (_) {}
  if (opts.quality) preferredQuality = String(opts.quality);

  const tmdbKey = localData?.tmdbKey || '';
  const subdlApiKey = localData?.subdlConfig?.apiKey || localData?.subdlKey || '';
  const subdlLanguages = Array.isArray(localData?.subdlConfig?.languages) ? localData.subdlConfig.languages.join(',') : 'AR,EN';

  const originalMagnet = (opts.torrentMagnet && (opts.torrentMagnet.startsWith('magnet:') || opts.torrentMagnet.endsWith('.torrent')))
    ? opts.torrentMagnet
    : (opts.item?.torrentMagnet && (opts.item.torrentMagnet.startsWith('magnet:') || opts.item.torrentMagnet.endsWith('.torrent')))
      ? opts.item.torrentMagnet
      : (raw && (raw.startsWith('magnet:') || raw.endsWith('.torrent')))
        ? raw
        : null;

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
  } else if (originalMagnet && (!raw || /^https?:\/\/(127\.0\.0\.1|localhost):1147\d\//i.test(raw))) {
    // If raw was a stale local torrent server URL from a past session, restart with original magnet
    const res = await startStreaming(originalMagnet, opts.fileIdx ?? opts.item?.fileIdx).catch(e => {
      console.warn('[Streamer] startStreaming error:', e.message);
      return null;
    });
    if (res && res.url) {
      raw = res.url;
      if (Array.isArray(res.files) && res.files.length > 0) {
        torrentFiles = res.files;
        torrentSelectedIdx = res.fileIdx ?? opts.item?.fileIdx ?? 0;
      }
    }
  }

  const config = getMeemPlayerConfig();
  if (!config.available) {
    console.warn('[MEEM Player] Standalone MEEM Player executable not found.');
    if (isVlcAvailable()) {
      console.log('[MediaPlay] MEEM Player not installed. Falling back to VLC Media Player...');
      return openInVlc(args);
    }
    console.warn('[MediaPlay] Neither MEEM Player nor VLC is installed.');
    return { success: false, noPlayer: true, error: 'no media player to use' };
  }

  // If requested to launch in standalone/idle mode without a specific file
  if (opts.launchOnly || (!raw && (!opts.playlist || opts.playlist.length === 0))) {
    console.log(`[MEEM Player] Launching standalone MEEM Player in idle mode: ${config.command}`);
    const child = spawn(config.command, [], {
      cwd: config.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { success: true, player: 'meem-player', launched: true };
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

  let extraAudioUrl = opts.audio || opts.audioUrl || opts.extraAudioUrl || null;
  let resolvedVideoId = null;

  // Handle YouTube URLs: Resolve to direct playable stream URL for MEEM Player using user's quality preference
  const ytMatch = (targetPath && targetPath.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)) ||
                  (raw && String(raw).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)) ||
                  (opts.item?.videoId ? [null, opts.item.videoId] : null) ||
                  (opts.videoId ? [null, opts.videoId] : null);
  if (ytMatch && (!targetPath || !targetPath.startsWith('http') || targetPath.includes('youtube.com') || targetPath.includes('youtu.be') || !extraAudioUrl)) {
    const videoId = ytMatch[1];
    resolvedVideoId = videoId;
    try {
      const YouTubeService = require('../youtube/YouTubeService');
      const ytRes = await YouTubeService.getVideoDetails(videoId, preferredQuality);
      if (ytRes && ytRes.success && ytRes.details?.streamUrl) {
        targetPath = ytRes.details.streamUrl;
        extraAudioUrl = ytRes.details.audioStreamUrl || null;
        if (!poster && ytRes.details.thumbnail) {
          poster = ytRes.details.thumbnail;
        }
        if (!opts.title && !opts.name && ytRes.details.title) {
          opts.title = ytRes.details.title;
        }
        console.log(`[MEEM Player] ✓ Resolved direct YouTube ${preferredQuality}p stream for ${videoId} (hasAudio: ${!!extraAudioUrl})`);
      }
    } catch (e) {
      console.warn('[MEEM Player] Failed to resolve YouTube stream URL:', e.message);
    }
  } else if (ytMatch) {
    resolvedVideoId = ytMatch[1];
    if (!poster) {
      poster = `https://i.ytimg.com/vi/${resolvedVideoId}/hqdefault.jpg`;
    }
  }

  // Handle Directory target: Scan for video files and build playlist
  if (targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    try {
      const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.ts', '.m4v', '.flv'];
      const dirFiles = fs.readdirSync(targetPath);
      const videoFiles = dirFiles
        .filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(f => path.join(targetPath, f));

      if (videoFiles.length > 0) {
        console.log(`[MEEM Player] Target is directory, resolved to first video: ${videoFiles[0]}`);
        targetPath = videoFiles[0];
      }
    } catch (e) {
      console.warn('[MEEM Player] Error reading directory:', e.message);
    }
  }

  const cliArgs = [];
  if (config.type === 'python') {
    cliArgs.push(config.script);
  }

  const isTvShow = Boolean(season != null || (opts.type && opts.type !== 'movie') || (showTitle && showTitle !== opts.title));

  // Check if a full playlist array was provided (e.g. from TV show details screen)
  let playlistItems = [];
  if (Array.isArray(opts.playlist) && opts.playlist.length > 0) {
    playlistItems = opts.playlist.map(item => {
      let thumb = item.thumbnail || item.still_path || item.poster || item.poster_path || '';
      if (thumb && thumb.startsWith('/') && !thumb.startsWith('//')) {
        thumb = `https://image.tmdb.org/t/p/w500${thumb}`;
      }
      return {
        path: item.path || item.url || '',
        title: item.title || item.name || '',
        show_title: item.show_title || item.showTitle || showTitle || '',
        season: item.season != null ? item.season : (season || 0),
        episode: item.episode != null ? item.episode : (episode || 0),
        thumbnail: thumb || poster || '',
        tmdb_id: item.tmdb_id || item.tmdbId || (resolvedTmdbId ? String(resolvedTmdbId) : ''),
        imdb_id: item.imdb_id || item.imdbId || (resolvedImdbId ? String(resolvedImdbId) : ''),
        overview: item.overview || ''
      };
    });
  }

  // If torrent returned multiple video files, convert them to a smart playlist with TMDB episode stills
  if (torrentFiles && torrentFiles.length > 0) {
    const portMatch = targetPath.match(/:(\d+)\//);
    const streamPort = portMatch ? portMatch[1] : '11470';

    // Fetch episode metadata and stills (Smart Cinemeta + TMDB fallback)
    let episodeMetadataMap = {};
    if (isTvShow) {
      const axios = require('axios');
      const targetSeason = season || 1;

      // 1. Check Cinemeta first (free, instant, no API key needed, has full episode stills)
      if (resolvedImdbId && String(resolvedImdbId).startsWith('tt')) {
        try {
          const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/series/${resolvedImdbId}.json`;
          const cResp = await axios.get(cinemetaUrl, { timeout: 3000 }).catch(() => null);
          if (cResp?.data?.meta?.videos && Array.isArray(cResp.data.meta.videos)) {
            cResp.data.meta.videos.forEach(v => {
              const vSeason = v.season != null ? v.season : (v.seasonNumber || 1);
              const vEp = v.episode != null ? v.episode : (v.number != null ? v.number : v.episodeNumber);
              if (vSeason === targetSeason && vEp != null) {
                episodeMetadataMap[vEp] = {
                  name: v.title || v.name || '',
                  still: v.thumbnail || v.still || '',
                  overview: v.overview || ''
                };
              }
            });
          }
        } catch (_) {}
      }

      // 2. Check Kitsu Anime for anime series
      const kitsuId = opts.kitsuId || opts.item?.kitsuId || opts.show?.kitsuId || (String(resolvedImdbId).startsWith('kitsu:') ? String(resolvedImdbId).replace('kitsu:', '') : null);
      if (kitsuId) {
        try {
          const kitsuUrl = `https://anime-kitsu.strem.fun/meta/series/kitsu:${kitsuId}.json`;
          const kResp = await axios.get(kitsuUrl, { timeout: 3000 }).catch(() => null);
          if (kResp?.data?.meta?.videos && Array.isArray(kResp.data.meta.videos)) {
            kResp.data.meta.videos.forEach(v => {
              const vEp = v.episode != null ? v.episode : (v.number != null ? v.number : v.episodeNumber);
              if (vEp != null && (!episodeMetadataMap[vEp] || !episodeMetadataMap[vEp].still)) {
                episodeMetadataMap[vEp] = {
                  name: v.title || v.name || episodeMetadataMap[vEp]?.name || '',
                  still: v.thumbnail || v.still || episodeMetadataMap[vEp]?.still || '',
                  overview: v.overview || episodeMetadataMap[vEp]?.overview || ''
                };
              }
            });
          }
        } catch (_) {}
      }

      // 3. Fallback to passed episode objects from renderer
      const existingEps = opts.episodes || opts.item?.episodes || opts.show?.episodes || (opts.playlist && opts.playlist.length > 0 ? opts.playlist : null);
      if (Array.isArray(existingEps)) {
        existingEps.forEach(ep => {
          const epNum = ep.episode_number || ep.episode || ep.number;
          if (epNum != null) {
            const existing = episodeMetadataMap[epNum] || {};
            let st = ep.still_path || ep.still || ep.thumbnail || ep.poster || ep.image || '';
            if (st && st.startsWith('/') && !st.startsWith('//')) st = `https://image.tmdb.org/t/p/w500${st}`;
            episodeMetadataMap[epNum] = {
              name: ep.name || ep.title || existing.name || '',
              still: st || existing.still || '',
              overview: ep.overview || existing.overview || ''
            };
          }
        });
      }

      // 4. Fetch TMDB Season episodes if user provided a TMDB key
      if (resolvedTmdbId && tmdbKey) {
        try {
          const tmdbSeasonUrl = `https://api.themoviedb.org/3/tv/${resolvedTmdbId}/season/${targetSeason}?api_key=${tmdbKey}`;
          const seasonResp = await axios.get(tmdbSeasonUrl, { timeout: 2500 }).catch(() => null);
          if (seasonResp?.data && Array.isArray(seasonResp.data.episodes)) {
            seasonResp.data.episodes.forEach(ep => {
              const existing = episodeMetadataMap[ep.episode_number] || {};
              episodeMetadataMap[ep.episode_number] = {
                name: ep.name || existing.name || '',
                still: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : (existing.still || null),
                overview: ep.overview || existing.overview || ''
              };
            });
          }
        } catch (_) {}
      }
    }

    playlistItems = torrentFiles.map((f, i) => {
      const parsedEp = extractSeasonEpisode(f.name);
      const epNum = parsedEp ? parsedEp.episode : (f.idx + 1);
      const snNum = parsedEp ? parsedEp.season : (season || 1);
      const epMeta = episodeMetadataMap[epNum];
      const epTitle = (epMeta && epMeta.name) ? epMeta.name : ((!isTvShow || torrentFiles.length === 1) ? (opts.title || f.name) : f.name);
      const epThumb = (epMeta && epMeta.still) ? epMeta.still : (poster || '');

      return {
        path: `http://127.0.0.1:${streamPort}/${f.idx}/${encodeURIComponent(f.name)}`,
        title: epTitle,
        show_title: isTvShow ? (showTitle || opts.title || '') : '',
        season: isTvShow ? snNum : 0,
        episode: isTvShow ? epNum : 0,
        thumbnail: epThumb,
        tmdb_id: resolvedTmdbId ? String(resolvedTmdbId) : '',
        imdb_id: resolvedImdbId ? String(resolvedImdbId) : '',
        overview: epMeta?.overview || ''
      };
    });
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
  if (extraAudioUrl) cliArgs.push(`--audio=${extraAudioUrl}`);
  if (resolvedVideoId) {
    cliArgs.push(`--video-id=${resolvedVideoId}`);
    cliArgs.push(`--yt-quality=${preferredQuality}`);
  }
  if (resolvedTmdbId) cliArgs.push(`--tmdb-id=${resolvedTmdbId}`);
  if (resolvedImdbId) cliArgs.push(`--imdb-id=${resolvedImdbId}`);
  if (season != null) cliArgs.push(`--season=${season}`);
  if (episode != null) cliArgs.push(`--episode=${episode}`);
  if (tmdbKey) cliArgs.push(`--tmdb-key=${tmdbKey}`);
  if (subdlApiKey) cliArgs.push(`--subdl-key=${subdlApiKey}`);

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

  // Write dedicated UTF-8 metadata JSON for MEEM Player to ensure 100% accurate Unicode (Arabic) decoding
  let tempMetaPath = null;
  try {
    const metaData = {
      title: opts.title || opts.name || '',
      subtitle: subTitle || '',
      showTitle: showTitle || '',
      poster: poster || '',
      thumbnail: poster || '',
      path: targetPath || '',
      sub: opts.subtitle || opts.subPath || '',
      audio: extraAudioUrl || '',
      startTime: opts.startTime || 0,
      pbKey: pbKey || '',
      profileId: profileId || '',
      videoId: resolvedVideoId || '',
      ytQuality: preferredQuality || '1080',
      mediaType: isTvShow ? 'tv' : 'movie',
      tmdbId: resolvedTmdbId ? String(resolvedTmdbId) : '',
      imdbId: resolvedImdbId ? String(resolvedImdbId) : '',
      season: season != null ? Number(season) : 0,
      episode: episode != null ? Number(episode) : 0,
      tmdbApiKey: tmdbKey,
      subdlApiKey: subdlApiKey,
      subdlLanguages: subdlLanguages,
      syncPort: syncPort || 0
    };
    tempMetaPath = path.join(os.tmpdir(), `meem_meta_${Date.now()}.json`);
    fs.writeFileSync(tempMetaPath, JSON.stringify(metaData, null, 2), 'utf-8');
    cliArgs.push(`--meta-json=${tempMetaPath}`);
  } catch (e) {
    console.warn('[MEEM Player] Could not write metadata json:', e.message);
  }

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
    originalMagnet,
    torrentMagnet: originalMagnet || opts.torrentMagnet || opts.item?.torrentMagnet || null,
    fileIdx: opts.fileIdx ?? opts.item?.fileIdx ?? torrentSelectedIdx,
    season: season != null ? Number(season) : (opts.season ?? opts.item?.season),
    episode: episode != null ? Number(episode) : (opts.episode ?? opts.item?.episode),
    showTitle: showTitle,
    tmdbId: resolvedTmdbId,
    imdbId: resolvedImdbId,
    thumbnail: poster,
    type: opts.type,
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
    windowsHide: false
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

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.warn('[MEEM Player STDERR]', msg);
    });
  }

  child.on('exit', () => {
    if (activeMeemPlayerChild === child) {
      activeMeemPlayerChild = null;
      stopStreaming().catch(() => {});
      if (tempPlaylistPath && fs.existsSync(tempPlaylistPath)) {
        try { fs.unlinkSync(tempPlaylistPath); } catch (e) {}
      }
      if (tempMetaPath && fs.existsSync(tempMetaPath)) {
        try { fs.unlinkSync(tempMetaPath); } catch (e) {}
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

    let meta = ctx?.item ? { ...ctx.item } : {};
    if (ctx?.show && !meta.show) {
      meta.show = ctx.show;
      meta.showTitle = ctx.show.title || ctx.show.name;
    }

    if (!meta.id) meta.id = key;
    if (ctx?.title && (!meta.title || meta.title === 'Playback' || meta.title === 'Media')) meta.title = ctx.title;
    if (ctx?.showTitle && !meta.showTitle) meta.showTitle = ctx.showTitle;
    if (ctx?.season != null && meta.season == null) meta.season = ctx.season;
    if (ctx?.episode != null && meta.episode == null) meta.episode = ctx.episode;
    if (ctx?.imdbId && !meta.imdb_id) meta.imdb_id = String(ctx.imdbId);
    if (ctx?.tmdbId && !meta.tmdbId) meta.tmdbId = String(ctx.tmdbId);

    const isYt = Boolean(
      ctx?.type === 'youtube' ||
      ctx?.item?.isYoutube ||
      ctx?.item?.type === 'youtube' ||
      (typeof key === 'string' && (/^[a-zA-Z0-9_-]{11}$/.test(key) || key.startsWith('yt:') || key.startsWith('yt_')))
    );

    if (isYt) {
      const vId = (typeof key === 'string' && (key.startsWith('yt:') || key.startsWith('yt_'))) ? key.replace(/^yt[:_]/, '') : key;
      const ytThumb = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
      meta.id = vId;
      meta.videoId = vId;
      meta.type = 'youtube';
      meta.isYoutube = true;
      if (!meta.title || meta.title === vId || meta.title === 'Playback') {
        meta.title = (ctx?.title && ctx.title !== vId && ctx.title !== 'Playback') ? ctx.title : 'YouTube Video';
      }
      meta.poster = meta.poster || ctx?.poster || ytThumb;
      meta.thumbnail = meta.thumbnail || ytThumb;
      meta.backdrop_path = meta.backdrop_path || ytThumb;
      meta.backdrop = meta.backdrop || ytThumb;
      if (ctx?.item?.author) meta.author = ctx.item.author;
    } else {
      const effImg = ctx?.poster || ctx?.thumbnail || meta.thumbnail || meta.still || meta.poster;
      if (effImg) {
        if (!meta.poster) meta.poster = effImg;
        if (!meta.thumbnail) meta.thumbnail = effImg;
        if (!meta.still) meta.still = effImg;
        if (!meta.backdrop_path) meta.backdrop_path = effImg;
        if (!meta.backdrop) meta.backdrop = effImg;
      }
      if (!meta.type) {
        meta.type = ctx?.type || (key.includes('_S') ? 'tv' : 'movie');
      }
    }

    const resolvedMagnet = ctx?.torrentMagnet || ctx?.originalMagnet || ctx?.item?.torrentMagnet ||
      (ctx?.raw && (ctx.raw.startsWith('magnet:') || ctx.raw.endsWith('.torrent')) ? ctx.raw : null);
    if (resolvedMagnet) {
      meta.torrentMagnet = resolvedMagnet;
      const fIdx = ctx?.fileIdx ?? ctx?.item?.fileIdx;
      if (fIdx != null) meta.fileIdx = fIdx;
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
      torrentMagnet: meta.torrentMagnet || null,
      fileIdx: meta.fileIdx != null ? meta.fileIdx : null,
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

    if (!isVlcAvailable()) {
      const meemConfig = getMeemPlayerConfig();
      if (meemConfig.available) {
        return openInMeemPlayer(args);
      }
      return { success: false, noPlayer: true, error: 'no media player to use' };
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
      if (isVlcAvailable()) {
        return openInVlc(args);
      }
      const meemConfig = getMeemPlayerConfig();
      if (meemConfig.available) {
        return openInMeemPlayer(args);
      }
      return { success: false, noPlayer: true, error: 'no media player to use' };
    }

    // Default flow:
    // 1. Try MEEM Player first
    const meemConfig = getMeemPlayerConfig();
    if (meemConfig.available) {
      return openInMeemPlayer(args);
    }

    // 2. If MEEM Player is not installed, fallback to VLC
    if (isVlcAvailable()) {
      console.log('[MediaPlay] MEEM Player not installed, falling back to VLC Media Player');
      return openInVlc(args);
    }

    // 3. If neither is installed, return no media player to use
    console.warn('[MediaPlay] Neither MEEM Player nor VLC is available.');
    return { success: false, noPlayer: true, error: 'no media player to use' };
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
