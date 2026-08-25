const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ip = require('ip');
const { spawn, exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const mimeTypes = require('mime-types');

// ─── HIGH-PERFORMANCE TIER-1 PUBLIC TRACKERS (2026) ──────────────────────────
const BEST_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://movies.subtlety.onl:2710/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'https://tracker.tamersunion.org:443/announce',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.openwebtorrent.com'
];

const VIDEO_EXTENSIONS = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i;

// ─── WEBTORRENT CLIENT LOADER ────────────────────────────────────────────────
let WebTorrent = null;
let wtClient = null;

async function getWT() {
  if (!WebTorrent) {
    let firstErr;
    try {
      const module = await import('webtorrent');
      WebTorrent = module.default || module;
    } catch (e) {
      firstErr = e;
      try {
        const unpackedPath = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'webtorrent', 'index.js');
        if (fs.existsSync(unpackedPath)) {
          const module = await import('file://' + unpackedPath.replace(/\\/g, '/'));
          WebTorrent = module.default || module;
        } else {
          const module = await import('webtorrent/index.js');
          WebTorrent = module.default || module;
        }
      } catch (e2) {
        throw new Error('Failed to load WebTorrent: ' + (e2.message || firstErr?.message));
      }
    }
  }
  return WebTorrent;
}

async function getWTClient() {
  if (!wtClient) {
    const WT = await getWT();
    wtClient = new WT({
      maxConns: 500,
      dht: true,
      tracker: true,
      lsd: true,
      utp: true,
      downloadLimit: -1,
      uploadLimit: -1
    });

    wtClient.on('error', (err) => {
      console.warn('[WebTorrent/Client] Warning:', err.message);
    });
  }
  return wtClient;
}

// ─── ENGINE STATE ─────────────────────────────────────────────────────────
let activeTorrent = null;
let activeTargetFile = null;
let activeFileIndex = 0;
let activeInfoHash = null;
let activeMagnet = null;
let streamServer = null;
let currentProgress = null;
let _stopStreamingInProgress = false;
let _ipcHandlersInitialized = false;
let _progInterval = null;
const activeSockets = new Set();
const activeChildProcesses = new Set();

function getStreamServerPort() {
  if (streamServer) {
    try {
      const addr = streamServer.address();
      if (addr && addr.port) return addr.port;
    } catch (e) {}
  }
  return 11470;
}

function getCachePath() {
  const cPath = path.join(app.getPath('temp'), 'MediaVault_Cache');
  try {
    if (!fs.existsSync(cPath)) fs.mkdirSync(cPath, { recursive: true });
  } catch (e) {}
  return cPath;
}

function formatMagnet(input) {
  let magnet = String(input || '').trim();
  const trackerQuery = BEST_TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');

  if (/^[a-fA-F0-9]{40}$/i.test(magnet)) {
    return `magnet:?xt=urn:btih:${magnet}&${trackerQuery}`;
  }
  if (!magnet.startsWith('magnet:') && !magnet.startsWith('http')) {
    const hashMatch = magnet.match(/([a-fA-F0-9]{40})/i);
    if (hashMatch) {
      return `magnet:?xt=urn:btih:${hashMatch[1]}&${trackerQuery}`;
    }
  }
  if (magnet.startsWith('magnet:')) {
    BEST_TRACKERS.forEach(tr => {
      if (!magnet.includes(encodeURIComponent(tr)) && !magnet.includes(tr)) {
        magnet += `&tr=${encodeURIComponent(tr)}`;
      }
    });
  }
  return magnet;
}

function findBestVideoFile(files) {
  if (!files || files.length === 0) return null;
  const videoFiles = files.filter(f => VIDEO_EXTENSIONS.test(f.name));
  if (videoFiles.length > 0) {
    // Prefer files > 50MB (skips samples), then return largest
    const realVideos = videoFiles.filter(f => f.length > 50 * 1024 * 1024);
    const pool = realVideos.length > 0 ? realVideos : videoFiles;
    return pool.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
  }
  return files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
}

// ─── PERMANENT HTTP STREAM SERVER ─────────────────────────────────────────
function startPermanentCompatServer() {
  if (streamServer) return;

  streamServer = http.createServer(async (req, res) => {
    try {
      const currentPort = getStreamServerPort();
      const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${currentPort}`}`);

      // ── CORS ──────────────────────────────────────────────────────────────
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Server', 'MediaVault/3.0');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // ── STATUS / STREMIO COMPATIBILITY ENDPOINTS ─────────────────────────
      if (
        url.pathname === '/' ||
        url.pathname.endsWith('/stats.json') ||
        url.pathname.endsWith('/stats') ||
        url.pathname === '/settings' ||
        url.pathname === '/status'
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const statsObj = {
          status: 'online',
          stremio: true,
          version: '4.4.160',
          torrents: []
        };
        if (activeTorrent && activeTargetFile) {
          const torrentInfo = {
            infoHash: activeInfoHash,
            name: activeTargetFile.name || 'MediaVault Stream',
            downloadSpeed: activeTorrent.downloadSpeed || 0,
            uploadSpeed: activeTorrent.uploadSpeed || 0,
            downloaded: activeTorrent.downloaded || 0,
            progress: activeTorrent.progress || 0,
            length: activeTargetFile.length || 0,
            peers: activeTorrent.numPeers || 0,
            status: 'downloading'
          };
          Object.assign(statsObj, torrentInfo);
          statsObj.torrents.push(torrentInfo);
        }
        res.end(JSON.stringify(statsObj));
        return;
      }

      // ── PLAYLIST ENDPOINT ────────────────────────────────────────────────
      if (url.pathname === '/playlist.m3u') {
        if (!activeTorrent || !activeTorrent.files || activeTorrent.files.length === 0) {
          res.writeHead(404);
          res.end('No active stream');
          return;
        }
        res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
        let m3u = '#EXTM3U\n';
        activeTorrent.files.forEach((f, idx) => {
          if (VIDEO_EXTENSIONS.test(f.name)) {
            m3u += `#EXTINF:-1,${f.name}\n`;
            m3u += `http://${req.headers.host || `127.0.0.1:${currentPort}`}/${idx}\n`;
          }
        });
        res.writeHead(200);
        res.end(m3u);
        return;
      }

      // ── SUBTITLE EXTRACTION (WEBVTT) ─────────────────────────────────────
      if (url.pathname.startsWith('/subtitles/') || url.pathname.startsWith('/stream/subtitle/')) {
        const trackIdx = parseInt(url.pathname.split('/').pop(), 10) || 0;
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');

        if (!activeTargetFile) {
          res.writeHead(404);
          res.end('WEBVTT\n\n');
          return;
        }

        const subStreamUrl = `http://127.0.0.1:${currentPort}/raw`;
        const subProc = spawn(ffmpegPath, [
          '-loglevel', 'error',
          '-i', subStreamUrl,
          '-map', `0:s:${trackIdx}`,
          '-f', 'webvtt',
          'pipe:1'
        ]);
        activeChildProcesses.add(subProc);

        subProc.stdout.pipe(res);
        res.on('close', () => {
          activeChildProcesses.delete(subProc);
          try { subProc.kill('SIGKILL'); } catch (e) {}
        });
        subProc.on('error', () => {
          activeChildProcesses.delete(subProc);
          if (!res.headersSent) { res.writeHead(500); res.end(); }
        });
        subProc.on('exit', () => {
          activeChildProcesses.delete(subProc);
        });
        return;
      }

      // ── FILE RESOLUTION ──────────────────────────────────────────────────
      let targetFile = activeTargetFile;
      const pathParts = url.pathname.split('/').filter(Boolean);
      const requestedIdx = pathParts[0] && !isNaN(parseInt(pathParts[0], 10)) ? parseInt(pathParts[0], 10) : null;

      if (requestedIdx !== null && activeTorrent && activeTorrent.files && activeTorrent.files[requestedIdx]) {
        targetFile = activeTorrent.files[requestedIdx];
      }

      if (!targetFile) {
        res.writeHead(404);
        res.end('File not found or torrent still initializing');
        return;
      }

      // ── AUDIO REMUX / FULL TRANSCODE ─────────────────────────────────────
      const isTranscode = url.searchParams.has('transcode');
      const isFullTranscode = url.searchParams.get('transcode') === 'full' || /\.avi$/i.test(targetFile.name);
      const startTime = parseFloat(url.searchParams.get('start') || url.searchParams.get('t') || '0') || 0;

      if (isTranscode) {
        console.log(`[Streamer] Starting FFmpeg live stream for "${targetFile.name}" (Full: ${isFullTranscode}, Start: ${startTime}s)`);
        res.writeHead(200, { 'Content-Type': 'video/mp4' });

        let ffmpegArgs = [];
        if (isFullTranscode) {
          ffmpegArgs = [
            '-loglevel', 'error',
            ...(startTime > 0 ? ['-ss', startTime.toString()] : []),
            '-i', `http://127.0.0.1:${currentPort}/${activeFileIndex}`,
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ac', '2',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
            '-f', 'mp4',
            'pipe:1'
          ];
        } else {
          ffmpegArgs = [
            '-loglevel', 'error',
            '-fflags', '+genpts+igndts',
            ...(startTime > 0 ? ['-ss', startTime.toString()] : []),
            '-i', `http://127.0.0.1:${currentPort}/${activeFileIndex}`,
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ac', '2',
            '-af', 'aresample=async=1000',
            '-avoid_negative_ts', 'make_zero',
            '-reset_timestamps', '1',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
            '-f', 'mp4',
            'pipe:1'
          ];
        }

        const ffmpegProc = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        activeChildProcesses.add(ffmpegProc);

        ffmpegProc.stdout.pipe(res);
        res.on('close', () => {
          activeChildProcesses.delete(ffmpegProc);
          try { ffmpegProc.kill('SIGTERM'); } catch (e) {}
          setTimeout(() => { try { if (!ffmpegProc.killed) ffmpegProc.kill('SIGKILL'); } catch (e) {} }, 1500);
        });
        ffmpegProc.on('error', (err) => {
          activeChildProcesses.delete(ffmpegProc);
          console.error('[Streamer/FFmpeg] Error:', err.message);
          if (!res.headersSent) { res.writeHead(500); res.end(); }
        });
        ffmpegProc.on('exit', () => {
          activeChildProcesses.delete(ffmpegProc);
        });
        return;
      }

      // ── MIME TYPE RESOLUTION ─────────────────────────────────────────────
      const ext = path.extname(targetFile.name).toLowerCase();
      const mimeMap = {
        '.mkv': 'video/x-matroska',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.m4v': 'video/mp4',
        '.ts': 'video/mp2t'
      };
      const contentType = mimeMap[ext] || mimeTypes.lookup(ext) || 'video/mp4';
      const fileSize = targetFile.length;

      // ── HEAD REQUEST ─────────────────────────────────────────────────────
      if (req.method === 'HEAD') {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.writeHead(200);
        res.end();
        return;
      }

      // ── RANGE (206) & FULL (200) REQUEST ─────────────────────────────────
      const range = req.headers.range;

      const safePipe = (readStream) => {
        readStream.on('error', (err) => {
          if (!err.message?.includes('closed') && !err.message?.includes('premature')) {
            console.warn('[Streamer] File stream notice:', err.message);
          }
          if (!res.destroyed) res.destroy();
        });
        res.on('error', () => { try { readStream.destroy(); } catch (e) {} });
        res.on('close', () => { try { readStream.destroy(); } catch (e) {} });
        readStream.pipe(res);
      };

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start)) { start = fileSize - end; end = fileSize - 1; }
        if (start < 0) start = 0;
        if (end >= fileSize) end = fileSize - 1;

        if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          res.end();
          return;
        }

        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Connection': 'keep-alive'
        });

        safePipe(targetFile.createReadStream({ start, end }));
      } else {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize,
          'Content-Type': contentType
        });
        safePipe(targetFile.createReadStream());
      }
    } catch (err) {
      console.error('[Streamer] Server error:', err.message);
      if (!res.headersSent) { res.writeHead(500); res.end('Streaming server error'); }
    }
  });

  streamServer.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  const tryListen = (port) => {
    streamServer.listen(port, '0.0.0.0', () => {
      console.log(`[Streamer] ✓ Unified HTTP streaming server listening on http://0.0.0.0:${port}`);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 11480) {
        tryListen(port + 1);
      } else {
        console.error('[Streamer] Server listen error:', err);
      }
    });
  };

  tryListen(11470);
}

// ─── TORRENT STREAMING CONTROLLER ─────────────────────────────────────────
async function startStreaming(magnetOrHash, fileIdx = null, progressCb = null) {
  if (!magnetOrHash) return { success: false, error: 'No torrent hash or magnet provided' };

  const magnet = formatMagnet(magnetOrHash);
  const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i);
  const infoHash = hashMatch ? hashMatch[1].toLowerCase() : null;

  startPermanentCompatServer();

  // If the same torrent is already active, switch file without restarting
  if (activeTorrent && activeInfoHash && infoHash && activeInfoHash === infoHash) {
    console.log('[Streamer] Torrent already active in memory, switching fileIdx to:', fileIdx);
    if (activeTorrent.files && activeTorrent.files.length > 0) {
      let file = null;
      const numIdx = fileIdx != null ? parseInt(fileIdx, 10) : null;
      if (numIdx !== null && activeTorrent.files[numIdx]) {
        file = activeTorrent.files[numIdx];
      }
      if (!file) file = findBestVideoFile(activeTorrent.files);

      if (file) {
        activeTorrent.files.forEach(f => { if (f !== file) try { f.deselect(); } catch (e) {} });
        try { file.select(); } catch (e) {}

        activeTargetFile = file;
        activeFileIndex = activeTorrent.files.indexOf(file);

        const currentPort = getStreamServerPort();
        const localIp = ip.address();
        const safeName = encodeURIComponent(file.name);
        const isAvi = /\.avi$/i.test(file.name);

        return {
          success: true,
          url: `http://${localIp}:${currentPort}/${activeFileIndex}/${safeName}`,
          localUrl: `http://127.0.0.1:${currentPort}/${activeFileIndex}/${safeName}${isAvi ? '?transcode=full' : ''}`,
          title: file.name,
          fileIdx: activeFileIndex,
          infoHash: activeInfoHash,
          files: activeTorrent.files.map((f, i) => ({
            idx: i,
            name: f.name,
            size: f.length,
            isPlayed: i === activeFileIndex
          })).filter(f => VIDEO_EXTENSIONS.test(f.name))
        };
      }
    }
  }

  // Stop previous torrent cleanly
  await stopStreaming();

  console.log('[Streamer] 🚀 Initializing WebTorrent turbo engine for:', magnet.slice(0, 65) + '...');

  const client = await getWTClient();

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stopStreaming().catch(() => {});
        reject(new Error('Torrent timeout: No swarm peers discovered within 60 seconds'));
      }
    }, 60000);

    try {
      const torrent = client.add(magnet, {
        path: getCachePath(),
        destroyStoreOnDestroy: false
      });

      activeTorrent = torrent;
      activeInfoHash = infoHash || torrent.infoHash;
      activeMagnet = magnet;

      // Progress reporting
      if (_progInterval) clearInterval(_progInterval);
      _progInterval = setInterval(() => {
        if (!activeTorrent || activeTorrent !== torrent) {
          if (_progInterval) clearInterval(_progInterval);
          return;
        }
        const totalSize = activeTargetFile ? activeTargetFile.length : (torrent.length || 1);
        const downloaded = torrent.downloaded || 0;
        const pct = Math.min(100, (downloaded / totalSize) * 100);
        const speedMb = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
        const stats = {
          status: activeTargetFile ? 'streaming' : 'fetching_metadata',
          statusText: activeTargetFile ? 'Streaming torrent pieces...' : 'Connecting to DHT & Swarm Peers...',
          speed: `${speedMb} MB/s`,
          percent: `${pct.toFixed(1)}%`,
          peers: torrent.numPeers || 0,
          downloaded: `${(downloaded / 1024 / 1024).toFixed(1)} MB`,
          total: activeTargetFile ? `${(activeTargetFile.length / 1024 / 1024).toFixed(1)} MB` : '...',
          fileName: activeTargetFile ? activeTargetFile.name : 'Resolving metadata...'
        };
        currentProgress = stats;
        if (progressCb) progressCb(stats);
        if (torrent.numPeers > 0 && Math.random() < 0.25) {
          console.log(`[Streamer/Diag] ⚡ Speed: ${stats.speed} | 👥 Peers: ${stats.peers} | 💾 ${stats.downloaded} / ${stats.total} (${stats.percent}) | 🎬 ${stats.fileName}`);
        }
      }, 1000);

      torrent.on('ready', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);

        console.log(`[Streamer] ✓ WebTorrent ready! Found ${torrent.files.length} files in torrent.`);

        let file = null;
        const numIdx = fileIdx != null ? parseInt(fileIdx, 10) : null;
        if (numIdx !== null && torrent.files[numIdx] && VIDEO_EXTENSIONS.test(torrent.files[numIdx].name)) {
          file = torrent.files[numIdx];
        }
        if (!file) file = findBestVideoFile(torrent.files);

        if (!file) {
          stopStreaming().catch(() => {});
          return reject(new Error('No video files found in torrent'));
        }

        // ── Allocate 100% bandwidth to target file ──
        torrent.files.forEach(f => { if (f !== file) try { f.deselect(); } catch (e) {} });
        try { file.select(); } catch (e) {}

        activeTargetFile = file;
        activeFileIndex = torrent.files.indexOf(file);

        console.log(`[Streamer] Selected file: "${file.name}" (${(file.length / 1024 / 1024).toFixed(1)} MB)`);

        const currentPort = getStreamServerPort();
        const localIp = ip.address();
        const safeName = encodeURIComponent(file.name);
        const isAvi = /\.avi$/i.test(file.name);

        resolve({
          success: true,
          url: `http://${localIp}:${currentPort}/${activeFileIndex}/${safeName}`,
          localUrl: `http://127.0.0.1:${currentPort}/${activeFileIndex}/${safeName}${isAvi ? '?transcode=full' : ''}`,
          playlistUrl: `http://127.0.0.1:${currentPort}/playlist.m3u`,
          title: file.name,
          fileIdx: activeFileIndex,
          infoHash: activeInfoHash,
          files: torrent.files.map((f, i) => ({
            idx: i,
            name: f.name,
            size: f.length,
            isPlayed: i === activeFileIndex
          })).filter(f => VIDEO_EXTENSIONS.test(f.name))
        });
      });

      torrent.on('error', (err) => {
        console.error('[Streamer] WebTorrent error:', err.message);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          stopStreaming().catch(() => {});
          reject(err);
        }
      });
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    }
  });
}

// ─── STOP & CLEANUP ───────────────────────────────────────────────────────
async function stopStreaming() {
  if (_stopStreamingInProgress) return { success: true };
  _stopStreamingInProgress = true;

  if (_progInterval) {
    clearInterval(_progInterval);
    _progInterval = null;
  }

  try {
    // 1. Destroy child processes (FFmpeg)
    for (const proc of activeChildProcesses) {
      try { proc.kill('SIGKILL'); } catch (e) {}
    }
    activeChildProcesses.clear();

    // 2. Destroy active torrent from client
    if (activeTorrent) {
      const tor = activeTorrent;
      activeTorrent = null;
      activeTargetFile = null;
      activeInfoHash = null;
      activeMagnet = null;
      try {
        await new Promise((resolve) => {
          tor.destroy({ destroyStore: false }, () => {
            console.log('[Streamer] ✓ WebTorrent active stream destroyed cleanly');
            resolve();
          });
        });
      } catch (e) {
        console.warn('[Streamer] Torrent destroy notice:', e.message);
      }
    }

    // 3. Destroy active sockets to free file handles
    for (const socket of Array.from(activeSockets)) {
      try { socket.destroy(); } catch (e) {}
    }
    activeSockets.clear();
  } catch (err) {
    console.warn('[Streamer] Cleanup warning:', err.message);
  } finally {
    _stopStreamingInProgress = false;
  }
  return { success: true };
}

// ─── PROBE URL (FFPROBE) ──────────────────────────────────────────────────
async function probeUrl(url, timeoutMs = 7000) {
  if (!url) return null;
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
    }, timeoutMs);

    exec(`"${ffprobePath}" -v quiet -print_format json -show_streams "${url}"`, (err, stdout) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (!err && stdout) {
        try {
          const meta = JSON.parse(stdout);
          const audioTracks = (meta.streams || []).filter(s => s.codec_type === 'audio').map(s => ({
            index: s.index,
            language: s.tags?.language || s.tags?.LANGUAGE || 'und',
            title: s.tags?.title || s.tags?.TITLE || '',
            codec: s.codec_name
          }));
          const subtitleTracks = (meta.streams || []).filter(s => s.codec_type === 'subtitle').map(s => ({
            index: s.index,
            language: s.tags?.language || s.tags?.LANGUAGE || 'und',
            title: s.tags?.title || s.tags?.TITLE || '',
            codec: s.codec_name
          }));
          resolve({ audioTracks, subtitleTracks });
        } catch (e) { resolve(null); }
      } else {
        resolve(null);
      }
    });
  });
}

// ─── PARSE TORRENT METADATA ───────────────────────────────────────────────
async function parseTorrent(magnetOrHash) {
  if (!magnetOrHash) return { success: false, error: 'No magnet provided' };
  const magnet = formatMagnet(magnetOrHash);

  try {
    const client = await getWTClient();
    return new Promise((resolve) => {
      let resolved = false;
      const torrent = client.add(magnet, { path: getCachePath(), destroyStoreOnDestroy: false });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { torrent.destroy({ destroyStore: false }); } catch (e) {}
          resolve({ success: false, error: 'Timeout fetching torrent metadata (45s)' });
        }
      }, 45000);

      torrent.on('ready', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        const files = torrent.files.map((f, idx) => ({
          idx,
          name: f.name,
          size: f.length
        }));

        try { torrent.destroy({ destroyStore: false }); } catch (e) {}
        resolve({
          success: true,
          name: torrent.name || 'Torrent',
          files
        });
      });

      torrent.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { torrent.destroy({ destroyStore: false }); } catch (e) {}
          resolve({ success: false, error: err.message });
        }
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── IPC INITIALIZATION ───────────────────────────────────────────────────
function initStreamerIpc(ipcMain) {
  if (_ipcHandlersInitialized) return;
  _ipcHandlersInitialized = true;

  ipcMain.handle('start-torrent-stream', async (event, magnet, fileIdx) => {
    try {
      return await startStreaming(magnet, fileIdx, (data) => {
        try {
          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('torrent-progress', data);
          }
        } catch (e) {}
      });
    } catch (err) {
      console.error('[Streamer] start-torrent-stream error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('stream-torrent', async (event, magnet, fileIdx) => {
    return await startStreaming(magnet, fileIdx, (data) => {
      try {
        if (event?.sender && !event.sender.isDestroyed()) {
          event.sender.send('torrent-progress', data);
        }
      } catch (e) {}
    });
  });

  ipcMain.handle('parse-torrent', async (_event, magnet) => {
    return await parseTorrent(magnet);
  });

  ipcMain.handle('probe-media-url', async (_event, url, timeoutMs) => {
    return await probeUrl(url, timeoutMs);
  });

  console.log('[Streamer] ✓ Turbo WebTorrent Streamer IPC handlers registered');
}

// Cleanup on process exit
process.on('exit', () => {
  for (const proc of activeChildProcesses) {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
  if (activeTorrent) {
    try { activeTorrent.destroy({ destroyStore: false }); } catch (e) {}
  }
  if (wtClient) {
    try { wtClient.destroy(); } catch (e) {}
  }
  if (streamServer) {
    try { streamServer.close(); } catch (e) {}
  }
});

module.exports = {
  startStreaming,
  stopStreaming,
  probeUrl,
  initStreamerIpc,
  startPermanentCompatServer
};
