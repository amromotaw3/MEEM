const { app } = require('electron');
const path = require('path');
const http = require('http');
const ip = require('ip');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

let WebTorrent;
let client = null;
let activeStream = null;
let activeFileIndex = null;
let activeStreamMetadata = null;
let streamServer = null;
let controlServer = null;
let currentProgress = null;
const activeConnections = new Set();
// Track spawned child processes (ffmpeg, etc.) for cleanup
const childProcesses = new Set();
let _stopStreamingInProgress = false;
let _startStreamingInProgress = false;  // Guard against concurrent starts
let _ipcHandlersInitialized = false;  // Guard to prevent duplicate IPC registrations

let pearioMockServer = null;

function startPearioMockServer() {
  if (pearioMockServer) return;
  try {
    pearioMockServer = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        
        // Allow CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          stremio: true,
          version: '4.4.160',
          torrents: []
        }));
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(err.message);
        }
      }
    });

    pearioMockServer.on('error', (err) => {
      console.warn('[PearioMock] Server error:', err.message);
      if (err.code === 'EADDRINUSE') {
        console.warn('[PearioMock] Port 11470 in use, Stremio or another process might be running.');
      }
      pearioMockServer = null;
    });

    pearioMockServer.listen(11470, '127.0.0.1', () => {
      console.log('[PearioMock] Mock Stremio server listening on http://127.0.0.1:11470');
    });
  } catch (err) {
    console.warn('[PearioMock] Failed to start:', err.message);
  }
}

function stopPearioMockServer() {
  return new Promise((resolve) => {
    if (!pearioMockServer) {
      resolve();
      return;
    }
    pearioMockServer.close((err) => {
      if (err) console.warn('[PearioMock] Error closing mock server:', err.message);
      console.log('[PearioMock] Mock Stremio server stopped');
      pearioMockServer = null;
      resolve();
    });
  });
}

// Ensure child processes are killed on exit
process.on('exit', () => {
  for (const p of childProcesses) {
    try { if (p && !p.killed) { p.kill('SIGTERM'); } } catch (e) {}
  }
  if (pearioMockServer) {
    try { pearioMockServer.close(); } catch (e) {}
  }
});

async function getWT() {
  if (!WebTorrent) {
    let firstErr;
    try {
      const module = await import('webtorrent');
      WebTorrent = module.default || module;
    } catch (e) {
      firstErr = e;
      try {
        // Try importing from app.asar.unpacked if packaged
        const path = require('path');
        const fs = require('fs');
        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'webtorrent', 'index.js');
        if (fs.existsSync(unpackedPath)) {
          const module = await import('file://' + unpackedPath.replace(/\\/g, '/'));
          WebTorrent = module.default || module;
        } else {
          throw new Error('Unpacked path not found');
        }
      } catch (e2) {
        try {
          const module = await import('webtorrent/index.js');
          WebTorrent = module.default || module;
        } catch (e3) {
          throw new Error('Failed to import webtorrent: ' + (e3.message || e2.message || firstErr.message));
        }
      }
    }
  }
  return WebTorrent;
}

/**
 * Probes a media URL using ffprobe to extract stream metadata (video/audio/subtitle tracks).
 * 
 * @param {string} url - The URL or local file path to probe.
 * @param {number} [timeoutMs=7000] - Timeout in milliseconds.
 * @returns {Promise<Array>} List of streams found.
 */
function probeUrlStreams(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', url];
    const p = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { p.kill(); } catch (e) {}
      reject(new Error('ffprobe timeout'));
    }, timeoutMs);

    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const json = JSON.parse(out || '{}');
          resolve(json.streams || []);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error('ffprobe failed: ' + err));
      }
    });
  });
}

// ── Video File Extensions ────────────────────────────────────────────────────
const VIDEO_EXTENSIONS = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i;
const JUNK_EXTENSIONS = /\.(nfo|txt|jpg|jpeg|png|gif|srt|sub|ass|ssa|idx|exe|bat|url|html|htm|xml|nzb|sfv|md5|sha1|ds_store)$/i;

/**
 * Finds the best video file from a torrent's file array.
 * Filters out non-video junk files (.nfo, .txt, .jpg, etc.) and returns
 * the largest video file — which is almost always the actual media content.
 *
 * @param {Array} files - torrent.files array
 * @returns {Object|null} The best video file, or null if none found
 */
function findBestVideoFile(files) {
  if (!files || files.length === 0) return null;

  // Filter to video files only
  const videoFiles = files.filter(f => VIDEO_EXTENSIONS.test(f.name));
  
  if (videoFiles.length > 0) {
    // Return the largest video file
    return videoFiles.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
  }

  // Fallback: if no recognized video extension, pick the largest non-junk file
  const nonJunk = files.filter(f => !JUNK_EXTENSIONS.test(f.name));
  if (nonJunk.length > 0) {
    return nonJunk.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
  }

  // Last resort: biggest file of any type
  return files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
}

/**
 * Registers IPC handlers for the torrent streamer (parsing torrents, starting/stopping torrent streams, and probing URLs).
 * 
 * @param {Object} ipcMain - Electron's ipcMain module instance.
 */
function initStreamerIpc(ipcMain) {
  // Prevent duplicate initialization
  if (_ipcHandlersInitialized) {
    console.log('[Streamer] IPC handlers already initialized, skipping...');
    return;
  }
  _ipcHandlersInitialized = true;

  console.log('[Streamer] Initializing IPC handlers...');

  // Register start-torrent-stream handler
  ipcMain.handle('start-torrent-stream', async (event, magnet, fileIdx) => {
    try {
      // Clean up previous stream if it exists and is different
      if (activeStream && activeStream.infoHash !== magnet && !String(magnet).includes(activeStream.infoHash)) {
        console.log('[Streamer] Stopping previous stream to start new one...');
        await stopStreaming();
      }
      return await startStreaming(magnet, fileIdx, (data) => {
        if (event && event.sender) event.sender.send('torrent-progress', data);
      });
    } catch (err) {
      console.error('[Streamer] start-torrent-stream error:', err);
      return { success: false, error: err.message };
    }
  });

  // Register parse-torrent handler — fetches torrent metadata and file list
  ipcMain.handle('parse-torrent', async (event, magnet) => {
    console.log('[Streamer] parse-torrent called for:', magnet?.substring(0, 60));
    try {
      const WT = await getWT();
      
      return await new Promise((resolve) => {
        let resolved = false;
        let tempClient;
        
        try {
          tempClient = new WT({
            maxConns: 500, // Increased to speed up metadata fetching
            dht: true,
            lsd: true,
            pex: true
          });
          tempClient.on('error', (err) => {
            console.error('[Streamer] tempClient error:', err.message || err);
          });
        } catch (e) {
          console.error('[Streamer] parse-torrent: Failed to create temp client:', e.message);
          return resolve({ success: false, error: 'Failed to create torrent client: ' + e.message });
        }

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn('[Streamer] parse-torrent: Metadata timeout after 45s');
            try { tempClient.destroy(); } catch(e){}
            resolve({ success: false, error: 'Timeout fetching torrent metadata (45s). The torrent may have no active seeds.' });
          }
        }, 45000);

        let finalMagnet = magnet;
        if (magnet && magnet.length === 40 && !magnet.includes(':')) {
          finalMagnet = `magnet:?xt=urn:btih:${magnet}`;
        }

        // Append trackers to improve peer discovery
        const TRACKERS = [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://tracker.openbittorrent.com:6969/announce',
          'udp://exodus.desync.com:6969/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://open.stealth.si:80/announce',
          'udp://tracker.moeking.me:6969/announce',
          'udp://opentracker.i2p.rocks:6969/announce',
          'udp://tracker.dler.org:6969/announce',
          'udp://explodie.org:6969/announce',
          'udp://bt1.archive.org:6969/announce',
          'udp://bt2.archive.org:6969/announce',
          'http://tracker.openbittorrent.com:80/announce',
          'http://tracker.opentrackr.org:1337/announce'
        ];

        try {
          const torrent = tempClient.add(finalMagnet, { announce: TRACKERS });

          torrent.on('metadata', () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            console.log(`[Streamer] parse-torrent: Got metadata! Name: "${torrent.name}", Files: ${torrent.files.length}`);
            const result = {
              success: true,
              infoHash: torrent.infoHash,
              name: torrent.name,
              files: torrent.files.map((f, idx) => ({
                idx,
                name: f.name,
                size: f.length
              }))
            };
            // Delay destroy slightly to avoid crash
            setTimeout(() => { try { tempClient.destroy(); } catch(e){} }, 500);
            resolve(result);
          });

          torrent.on('error', (err) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            console.error('[Streamer] parse-torrent: Torrent error:', err.message);
            try { tempClient.destroy(); } catch(e){}
            resolve({ success: false, error: 'Torrent error: ' + err.message });
          });
        } catch (addErr) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.error('[Streamer] parse-torrent: client.add() threw:', addErr.message);
            try { tempClient.destroy(); } catch(e){}
            resolve({ success: false, error: addErr.message });
          }
        }
      });
    } catch (err) {
      console.error('[Streamer] parse-torrent: Outer error:', err.message);
      return { success: false, error: err.message };
    }
  });


  // NOTE: `stop-torrent-stream` is intentionally NOT registered here to avoid
  // duplicate IPC handler registration. The unified `stop-torrent-stream`
  // handler is registered from the app entry (main.js) so it can coordinate
  // stopping both addon and streamer engines.


  // Register probe-stream handler
  ipcMain.handle('probe-stream', async (event, url) => {
    try {
      const streams = await probeUrlStreams(url);
      return { success: true, streams };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  console.log('[Streamer] ✓ IPC handlers initialized successfully');

  // --- REMOTE CONTROL SERVER ---
  if (!controlServer) {
    controlServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Allow CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentProgress || { status: 'idle' }));
        return;
      }

      if (url.pathname === '/start') {
        const magnet = url.searchParams.get('url');
        const fileIdx = url.searchParams.get('fileIdx');
        if (!magnet) {
          res.writeHead(400); res.end('Missing url'); return;
        }
        // CRITICAL: Clean up previous stream FIRST before starting new one
        await stopStreaming();
        const result = await startStreaming(magnet, fileIdx ? parseInt(fileIdx) : null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404); res.end();
    });
    // Try binding control server to a preferred port, with fallback if in use
    const preferredPorts = [process.env.STREAMER_CONTROL_PORT ? parseInt(process.env.STREAMER_CONTROL_PORT, 10) : 11471, 11472, 11473, 11474, 11475].filter(Boolean);
    (async () => {
      for (const p of preferredPorts) {
        try {
          await new Promise((resolve, reject) => {
            controlServer.once('error', (err) => reject(err));
            controlServer.listen(p, '0.0.0.0', () => resolve());
          });
          console.log(`[Streamer] Control server (API) listening on ${ip.address()}:${p}`);
          return;
        } catch (err) {
          if (err && err.code === 'EADDRINUSE') {
            console.warn(`[Streamer] Port ${p} in use, trying next port...`);
            // continue to next port
          } else {
            console.warn('[Streamer] Control server listen error:', err && err.message ? err.message : err);
          }
        }
      }
      console.error('[Streamer] Failed to bind control server to any preferred port');
    })();
  }
  startPearioMockServer();
}

/**
 * Starts streaming a torrent using WebTorrent. Automatically sets up the sequential download strategy
 * and spins up a local HTTP media server to stream the file contents.
 * 
 * @param {string} magnet - The magnet link or info hash of the torrent.
 * @param {number|null} [fileIdx=null] - The specific file index to stream. If null, automatically selects the largest video file.
 * @param {Function|null} [progressCb=null] - Optional callback function to report download progress.
 * @returns {Promise<Object>} Object containing streaming metadata (URL, file index, files list) on success.
 */
async function startStreaming(magnet, fileIdx = null, progressCb = null) {
  let finalMagnet = magnet;
  if (magnet && magnet.length === 40 && !magnet.includes(':')) {
    finalMagnet = `magnet:?xt=urn:btih:${magnet}`;
  }

  // Optimize: If same torrent is already active, just switch file
  if (activeStream && (activeStream.infoHash === magnet || activeStream.magnetURI === finalMagnet || (activeStream.infoHash && finalMagnet.includes(activeStream.infoHash)))) {
    console.log('[Streamer] Torrent already active, switching fileIdx to:', fileIdx);
    
    return new Promise((resolve, reject) => {
        let timer = null;

        const handleFilesReady = () => {
            if (timer) clearTimeout(timer);
            // ── DESELECT ALL FILES individually (critical for season packs) ──
            if (activeStream.files) {
                activeStream.files.forEach(f => { try { f.deselect(); } catch(e) {} });
            }

            // Identify the target file
            let file = null;
            const idx = (fileIdx !== null && fileIdx !== undefined) ? parseInt(fileIdx, 10) : null;
            if (idx !== null && Number.isFinite(idx) && activeStream.files && activeStream.files[idx]) {
              const candidate = activeStream.files[idx];
              if (VIDEO_EXTENSIONS.test(candidate.name)) {
                file = candidate;
                console.log(`[Streamer] Using provided fileIdx=${idx}: "${candidate.name}"`);
              } else {
                console.log(`[Streamer] Ignoring provided fileIdx=${idx} because it's not a video: "${candidate.name}"`);
              }
            }
            if (!file) {
              file = findBestVideoFile(activeStream.files);
            }
            
            if (!file) {
                console.warn('[Streamer] No files available yet in active torrent.');
                return resolve({ success: false, error: 'Torrent metadata still loading, please wait...' });
            }

            // ── SELECT ONLY the target file ──
            file.select();
            console.log(`[Streamer] Selected ONLY: "${file.name}" (${(file.length / 1024 / 1024).toFixed(1)} MB) — all other files deselected`);
            
            const newIdx = activeStream.files.indexOf(file);
            const localIp = ip.address();
            const currentPort = streamServer ? streamServer.address().port : 11470;
            resolve({
                success: true,
                url: `http://${localIp}:${currentPort}/${newIdx}`,
                localUrl: `http://localhost:${currentPort}/${newIdx}`,
                title: file.name,
                fileIdx: newIdx,
                infoHash: activeStream.infoHash,
                files: activeStream.files.map((f, i) => ({
                    idx: i,
                    name: f.name,
                    size: f.length,
                    isPlayed: i === newIdx
                })).filter(f => f.name.match(/\.(mp4|mkv|avi|webm|mov)$/i))
            });
        };

        if (activeStream.files && activeStream.files.length > 0) {
            handleFilesReady();
        } else {
            console.log('[Streamer] Waiting for metadata on active torrent...');
            activeStream.once('metadata', handleFilesReady);
            activeStream.once('error', (err) => {
                if (timer) clearTimeout(timer);
                resolve({ success: false, error: err.message });
            });
            timer = setTimeout(() => {
                activeStream.removeListener('metadata', handleFilesReady);
                resolve({ success: false, error: 'Timeout waiting for torrent metadata' });
            }, 60000);
        }
    });
  }
  console.log('[Streamer] Starting new stream request:', magnet.substring(0, 50));
  try {
    await stopPearioMockServer();
    const WT = await getWT();
    // Note: cleanupCurrentStream() is now called from the HTTP endpoint BEFORE this function

    if (!client) {
      client = new WT({ 
        dht: true, 
        pex: true, 
        lsd: true,
        maxConns: 500 // Allow more connections for faster streaming
      });
      client.on('error', (err) => {
        console.error('[Streamer] client error:', err.message || err);
      });
    }

    const TRACKERS = [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.files.fm:7073/announce',
      'wss://tracker.fastcast.nz',
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.openbittorrent.com:6969/announce',
      'udp://tracker.coppersurfer.tk:6969/announce',
      'udp://exodus.desync.com:6969/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://tracker.moeking.me:6969/announce',
      'udp://opentracker.i2p.rocks:6969/announce',
      'udp://9.rarbg.com:2810/announce',
      'http://tracker.openbittorrent.com:80/announce',
      'http://tracker.opentrackr.org:1337/announce'
    ];

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Metadata timeout')), 120000);
      
      let torrentSource = finalMagnet;
      const infoHashMatch = finalMagnet.match(/urn:btih:([a-zA-Z0-9]+)/i);
      const parsedInfoHash = infoHashMatch ? infoHashMatch[1].toUpperCase() : null;

      if (parsedInfoHash) {
        try {
          console.log('[Streamer] Bypassing DHT metadata fetch by downloading .torrent from iTorrents for hash:', parsedInfoHash);
          const controller = new AbortController();
          const fetchTimeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(`https://itorrents.net/torrent/${parsedInfoHash}.torrent`, { 
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          clearTimeout(fetchTimeout);
          
          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            torrentSource = Buffer.from(arrayBuffer);
            console.log('[Streamer] Successfully downloaded .torrent file! Size:', torrentSource.length);
          } else {
            console.warn('[Streamer] iTorrents returned status:', res.status, '- Falling back to magnet link');
          }
        } catch (e) {
          console.warn('[Streamer] Failed to fetch .torrent file, falling back to magnet:', e.message);
        }
      }

      // Use sequential download to prioritize the start of the video (Stremio-like instant playback)
      const torrent = client.add(torrentSource, { 
        announce: TRACKERS,
        path: path.join(app.getPath('temp'), 'MediaVault_Cache'),
        sequential: true,      // Download pieces in order for streaming
        strategy: 'sequential'  // Reinforced sequential strategy
      });
      activeStream = torrent;

      torrent.on('metadata', () => {
        // ── Target File Identification ──
        let file = null;
        const idx = (fileIdx !== null && fileIdx !== undefined) ? parseInt(fileIdx, 10) : null;
        if (idx !== null && Number.isFinite(idx) && torrent.files[idx]) {
          const candidate = torrent.files[idx];
          if (VIDEO_EXTENSIONS.test(candidate.name)) {
            file = candidate;
            console.log(`[Streamer] Using Stremio fileIdx=${idx}: "${candidate.name}"`);
          } else {
            console.log(`[Streamer] Ignoring provided fileIdx=${idx} because it's not a video: "${candidate.name}"`);
          }
        }
        if (!file) {
          file = findBestVideoFile(torrent.files);
          if (file) console.log(`[Streamer] Auto-selected best video: "${file.name}"`);
        }

        if (!file) return reject(new Error('No video files found in torrent metadata'));

        // ── TARGET-SPECIFIC PIECE PRIORITIZATION ──
        // Only prioritize pieces that belong to the SELECTED file.
        // This prevents WebTorrent from pre-fetching pieces of other files in a pack.
        try {
            const pieceLength = torrent.pieceLength;
            const startPiece = Math.floor(file.offset / pieceLength);
            const endPiece = Math.floor((file.offset + file.length - 1) / pieceLength);
            const totalFilePieces = (endPiece - startPiece) + 1;

            if (totalFilePieces > 0) {
                // High priority for the first ~15 pieces of THIS file
                const headCount = Math.min(totalFilePieces, 15);
                for (let i = 0; i < headCount; i++) {
                    if (torrent.pieces[startPiece + i]) torrent.pieces[startPiece + i].priority = 7;
                }
                // High priority for the last ~5 pieces of THIS file (for index data)
                const tailCount = Math.min(totalFilePieces, 5);
                for (let i = 0; i < tailCount; i++) {
                    if (torrent.pieces[endPiece - i]) torrent.pieces[endPiece - i].priority = 7;
                }
                console.log(`[Streamer] Prioritized ${headCount} start + ${tailCount} end pieces of file "${file.name}" (Range: ${startPiece}-${endPiece})`);
            }
        } catch (e) {
            console.warn('[Streamer] File-specific prioritization error:', e.message);
        }
        
        // ── SELECT ONLY this single file ──
        file.select();
        console.log(`[Streamer] ✓ Selected ONLY: "${file.name}" (${(file.length / 1024 / 1024).toFixed(1)} MB)`);
        console.log(`[Streamer]   Ignored: ${torrent.files.length - 1} other files`);
        
        const fileIndex = torrent.files.indexOf(file);

        // Heartbeat
        const interval = setInterval(() => {
          if (!activeStream || activeStream.destroyed) { clearInterval(interval); return; }
          const stats = {
            status: 'streaming',
            speed: (activeStream.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
            percent: (activeStream.progress * 100).toFixed(1) + '%',
            peers: activeStream.numPeers,
            downloaded: (activeStream.downloaded / 1024 / 1024).toFixed(1) + ' MB',
            total: (activeStream.length / 1024 / 1024).toFixed(1) + ' MB'
          };
          currentProgress = stats;
          if (progressCb) progressCb(stats);
        }, 1000);

        // Manual HTTP Server for WebTorrent v2 (createServer was removed)
        streamServer = http.createServer((req, res) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);

            // Stremio/Peario check endpoints (stats.json, settings, root, status)
            if (url.pathname === '/' || url.pathname.endsWith('/stats.json') || url.pathname.endsWith('/stats') || url.pathname === '/settings' || url.pathname === '/status') {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', '*');
              if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });

              const statsObj = {
                status: 'online',
                stremio: true,
                version: '4.4.160',
                torrents: []
              };

              if (activeStream) {
                const torrentInfo = {
                  infoHash: activeStream.infoHash,
                  name: activeStream.name || "MediaVault Stream",
                  downloadSpeed: activeStream.downloadSpeed || 0,
                  uploadSpeed: activeStream.uploadSpeed || 0,
                  downloaded: activeStream.downloaded || 0,
                  progress: activeStream.progress || 0,
                  length: activeStream.length || 0,
                  peers: activeStream.numPeers || 0,
                  status: activeStream.ready ? 'downloading' : 'metadata'
                };
                Object.assign(statsObj, torrentInfo);
                statsObj.torrents.push(torrentInfo);
              }

              res.end(JSON.stringify(statsObj));
              return;
            }

            if (url.pathname === '/playlist.m3u') {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
              res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u"');
              
              let m3u = '#EXTM3U\n';
              const startIdx = parseInt(url.searchParams.get('startIdx'), 10);
              
              const vFiles = [];
              torrent.files.forEach((f, idx) => {
                if (VIDEO_EXTENSIONS.test(f.name)) vFiles.push({ f, idx });
              });
              
              if (!Number.isNaN(startIdx)) {
                // Reorder playlist so selected item is first
                const targetIdx = vFiles.findIndex(item => item.idx === startIdx);
                if (targetIdx !== -1) {
                  const targetItem = vFiles.splice(targetIdx, 1)[0];
                  vFiles.unshift(targetItem);
                }
              }
              
               vFiles.forEach(item => {
                m3u += `#EXTINF:-1,${item.f.name}\n`;
                m3u += `http://${req.headers.host || '127.0.0.1:11470'}/${item.idx}\n`;
              });
              
              res.writeHead(200);
              res.end(m3u);
              return;
            }

            if (url.pathname.startsWith('/stream/subtitle/')) {
              const trackId = parseInt(url.pathname.split('/').pop(), 10);
              if (Number.isNaN(trackId) || !activeStreamMetadata?.subtitleTracks || !activeStreamMetadata.subtitleTracks[trackId]) {
                res.writeHead(404);
                res.end();
                return;
              }

              const subtitleInfo = activeStreamMetadata.subtitleTracks[trackId];
              const targetFile = torrent.files[activeFileIndex];
              if (!targetFile) {
                res.writeHead(404);
                res.end();
                return;
              }

              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'text/vtt');
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

              const ffmpegArgs = [
                '-loglevel', 'error',
                '-i', 'pipe:0',
                '-map', `0:s:${subtitleInfo.index}`,
                '-c:s', 'webvtt',
                '-f', 'webvtt',
                'pipe:1'
              ];

              const sourceStream = targetFile.createReadStream();
              const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
              childProcesses.add(ffmpegProcess);

              sourceStream.on('error', (err) => {
                console.error('[Streamer] Subtitle source stream error:', err.message);
                try { sourceStream.destroy(); } catch (e) {}
                if (!res.headersSent) { res.writeHead(500); res.end('Subtitle source failure'); }
              });

              ffmpegProcess.stderr.on('data', (data) => {
                console.error(`[Streamer/Subtitle FFmpeg] ${data.toString().trim()}`);
              });

              ffmpegProcess.stdout.pipe(res);
              sourceStream.pipe(ffmpegProcess.stdin);

              const cleanupSubtitleProcess = () => {
                try { if (ffmpegProcess && !ffmpegProcess.killed) ffmpegProcess.kill('SIGTERM'); } catch (e) {}
                try { sourceStream.destroy(); } catch (e) {}
                setTimeout(() => { try { if (ffmpegProcess && !ffmpegProcess.killed) ffmpegProcess.kill('SIGKILL'); } catch (e) {} }, 2000);
              };

              res.on('close', cleanupSubtitleProcess);
              ffmpegProcess.on('exit', () => {
                childProcesses.delete(ffmpegProcess);
                try { sourceStream.destroy(); } catch (e) {}
              });
              ffmpegProcess.on('error', () => {
                childProcesses.delete(ffmpegProcess);
                try { sourceStream.destroy(); } catch (e) {}
              });
              return;
            }

            let index = parseInt(url.pathname.substring(1), 10);
            
            // Handle Stremio-style paths: /[infoHash]/[fileIdx]
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length === 2 && /^[a-fA-F0-9]{40}$/i.test(parts[0]) && /^\d+$/.test(parts[1])) {
              index = parseInt(parts[1], 10);
            }

            const targetFile = torrent.files[index];
            
            if (!targetFile) {
              res.writeHead(404);
              res.end();
              return;
            }

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Connection', 'keep-alive');
            
            const isTranscode = url.searchParams.get('transcode') === 'true';
            const startTime = parseFloat(url.searchParams.get('start')) || 0;

                // Rate limiting: generous per-IP and per-file limits to allow scrubbing
                // We allow higher limits for localhost (127.0.0.1 / ::1) to support local players
                try {
                  const clientIp = req.socket.remoteAddress || req.socket.localAddress || 'unknown';
                  if (!global._mv_client_connections) global._mv_client_connections = new Map();
                  if (!global._mv_file_requests) global._mv_file_requests = new Map();

                  const ipKey = clientIp;
                  const ipConns = global._mv_client_connections.get(ipKey) || [];
                  const isLocal = (ipKey === '127.0.0.1' || ipKey === '::1' || ipKey === '::ffff:127.0.0.1' || ipKey === 'unknown');
                  const maxIp = isLocal ? 100 : 12; // Much higher limit for local to avoid blocking FFmpeg/UI
                  if (ipConns.length >= maxIp) {
                    res.writeHead(429, { 'Retry-After': '1' });
                    res.end('Too many concurrent connections');
                    return;
                  }

                  const fileKey = `${ipKey}:${index}`;
                  const fileConns = global._mv_file_requests.get(fileKey) || 0;
                  const maxPerFile = isLocal ? 50 : 6;
                  if (fileConns >= maxPerFile) {
                    res.writeHead(429, { 'Retry-After': '2' });
                    res.end('Too many concurrent file requests');
                    return;
                  }

                  // Register this connection
                  ipConns.push(res);
                  global._mv_client_connections.set(ipKey, ipConns);
                  global._mv_file_requests.set(fileKey, fileConns + 1);

                  // Cleanup on close
                  res.on('close', () => {
                    try {
                      const conns = global._mv_client_connections.get(ipKey) || [];
                      const idx = conns.indexOf(res);
                      if (idx !== -1) conns.splice(idx, 1);
                      if (conns.length === 0) global._mv_client_connections.delete(ipKey);
                      else global._mv_client_connections.set(ipKey, conns);
                    } catch (e) {}
                    try {
                      const current = global._mv_file_requests.get(fileKey) || 0;
                      if (current <= 1) global._mv_file_requests.delete(fileKey);
                      else global._mv_file_requests.set(fileKey, current - 1);
                    } catch (e) {}
                  });
                } catch (e) {
                  console.warn('[Streamer] Rate limiter error:', e.message);
                }

                // MIME detection - Disguise MKV as WebM to force Chromium's internal demuxer to parse it
            const ext = path.extname(targetFile.name).toLowerCase();
            const mimeMap = { 
              '.mkv': 'video/x-matroska', // Castlabs supports MKV natively. Disguising as WebM breaks H.264/HEVC inside MKV.
              '.avi': 'video/mp4',
              '.webm': 'video/webm', 
              '.mov': 'video/mp4' 
            };
            const mime = isTranscode ? 'video/mp4' : (mimeMap[ext] || 'video/mp4');
            res.setHeader('Content-Type', mime);

            const fileSize = targetFile.length;
            const range = req.headers.range;

            if (isTranscode) {
              // ── ON-THE-FLY TRANSCODING (HEVC/Unsupported -> H.264/AAC) ──
              console.log(`[Streamer] Transcoding started for: ${targetFile.name} (Start: ${startTime}s)`);
              res.writeHead(200);

              const ffmpegArgs = [
                '-loglevel', 'error',
                ...(startTime > 0 ? ['-ss', startTime.toString()] : []),
                '-i', `http://127.0.0.1:${streamServer ? streamServer.address().port : 11470}/${index}`,
                '-map', '0:v:0',
                '-map', '0:a:0',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-pix_fmt', 'yuv420p',
                '-crf', '23',
                '-maxrate', '5M',
                '-bufsize', '10M',
                '-force_key_frames', 'expr:gte(t,n_forced*2)',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ac', '2',
                '-fflags', '+genpts',
                '-avoid_negative_ts', 'make_zero',
                '-reset_timestamps', '1',
                '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
                '-f', 'mp4',
                'pipe:1'
              ];

              const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
              childProcesses.add(ffmpegProcess);

              // Log FFmpeg errors
              ffmpegProcess.stderr.on('data', (data) => {
                console.error(`[Streamer/FFmpeg] ${data.toString().trim()}`);
              });

              // Timeout: ensure ffmpeg doesn't hang indefinitely
              const transcodeTimeout = setTimeout(() => {
                try {
                  if (ffmpegProcess && !ffmpegProcess.killed) {
                    console.warn('[Streamer] FFmpeg timeout, killing process');
                    ffmpegProcess.kill('SIGKILL');
                  }
                } catch (e) {}
              }, 120000);

              ffmpegProcess.stdout.pipe(res);

              // Cleanup on client disconnect
              res.on('close', () => {
                console.log('[Streamer] Client disconnected, terminating ffmpeg...');
                try { ffmpegProcess.kill('SIGTERM'); } catch (e) {}
                setTimeout(() => { try { if (!ffmpegProcess.killed) ffmpegProcess.kill('SIGKILL'); } catch(e){} }, 2000);
              });

              ffmpegProcess.on('error', (err) => {
                console.error('[Streamer] FFmpeg spawn error:', err.message);
                clearTimeout(transcodeTimeout);
                if (!res.headersSent) { try { res.writeHead(500); res.end('Transcode failed'); } catch(e){} }
              });

              ffmpegProcess.on('exit', (code, sig) => {
                clearTimeout(transcodeTimeout);
                childProcesses.delete(ffmpegProcess);
                if (code !== 0) {
                  console.warn('[Streamer] FFmpeg exited with code', code, 'signal', sig);
                }
                try { if (!res.destroyed) res.end(); } catch(e){}
              });

              return;
            }

            // Helper: pipe with proper error handling to prevent
            // "Writable stream closed prematurely" crashes during seeks
            const safePipe = (readStream) => {
              readStream.on('error', (err) => {
                if (!err.message?.includes('closed prematurely') && !err.message?.includes('premature close')) {
                  console.warn('[Streamer] Read stream error:', err.message);
                }
                if (!res.destroyed) res.destroy();
              });
              res.on('error', () => { readStream.destroy(); });
              res.on('close', () => { readStream.destroy(); });
              readStream.pipe(res);
            };

            if (range) {
              const parts = range.replace(/bytes=/, "").split("-");
              let start = parseInt(parts[0], 10);
              let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

              // Handle suffix range (e.g. -500: last 500 bytes)
              if (isNaN(start)) {
                start = fileSize - end;
                end = fileSize - 1;
              }

              // Clamp values to avoid out-of-bounds errors
              if (start < 0) start = 0;
              if (end >= fileSize) end = fileSize - 1;

              // Check if range is satisfiable
              if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
                res.writeHead(416, {
                  'Content-Range': `bytes */${fileSize}`
                });
                res.end();
                return;
              }

              const chunksize = (end - start) + 1;
              
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunksize
              });
              safePipe(targetFile.createReadStream({ start, end }));
            } else {
              res.writeHead(200, { 'Content-Length': fileSize });
              safePipe(targetFile.createReadStream());
            }
          } catch (e) {
            console.error('[Streamer] Server Error:', e.message);
            if (!res.headersSent) { res.writeHead(500); res.end(); }
          }
        });

        activeFileIndex = fileIndex;
        activeStreamMetadata = null;
        streamServer.on('connection', (socket) => {
          activeConnections.add(socket);
          socket.on('close', () => activeConnections.delete(socket));
        });

        // Error handling for port in use
        streamServer.on('error', (err) => {
          console.error('[Streamer] Stream server error:', err.message);
          if (err.code === 'EADDRINUSE') {
            console.warn('[Streamer] Port 11470 in use, trying dynamic port 0...');
            streamServer.listen(0, '0.0.0.0');
          } else {
            reject(new Error('Failed to start stream server: ' + err.message));
          }
        });

        streamServer.listen(11470, '0.0.0.0', async () => {
          const port = streamServer.address().port;
          const localIp = ip.address();
          const baseUrl = `http://${localIp}:${port}`;
          const fileUrl = `${baseUrl}/${fileIndex}`;
          
          // Background probe for duration (don't block initial resolve)
          try {
            import('music-metadata').then(mm => {
              const probeMime = ext === '.mkv' ? 'video/webm' : 'video/mp4';
              const stream = file.createReadStream({ start: 0, end: Math.min(file.length, 2 * 1024 * 1024) });
              mm.parseStream(stream, { mimeType: probeMime, size: file.length }).then(metadata => {
                const d = metadata.format.duration || 0;
                if (d) console.log(`[Streamer] Background probe duration: ${Math.round(d)}s`);
                stream.destroy();
              }).catch(e => { try { stream.destroy(); } catch(e2) {} });
            }).catch(() => {});
          } catch(e) {}

          clearTimeout(timeout);
          const isUnsupported = /\.avi$/i.test(file.name);
          resolve({
            success: true,
            url: fileUrl,
            localUrl: `http://127.0.0.1:${port}/${fileIndex}${isUnsupported ? '?transcode=true' : ''}`,
            playlistUrl: torrent.files.filter(f => VIDEO_EXTENSIONS.test(f.name)).length > 1 ? `http://127.0.0.1:${port}/playlist.m3u?startIdx=${fileIndex}` : null,
            title: file.name,
            fileIdx: fileIndex,
            infoHash: torrent.infoHash,
            files: torrent.files.map((f, idx) => ({
              idx,
              name: f.name,
              size: f.length,
              isPlayed: idx === fileIndex
            })).filter(f => f.name.match(/\.(mp4|mkv|avi|webm|mov)$/i))
          });

          // Bypassed background ffprobe metadata probe to prevent random-seek piece starvation and avoid player buffering stalls.
        });
      });
      torrent.on('error', (err) => { 
        console.error('[Streamer] Torrent Error:', err.message);
        clearTimeout(timeout); 
        reject(err); 
      });
    });
  } catch (err) {
    console.error('[Streamer] Start Failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function stopStreaming() {
  if (_stopStreamingInProgress) {
    console.log('[Streamer] Stop streaming already in progress, waiting...');
    return { success: true };
  }

  _stopStreamingInProgress = true;
  try {
    console.log('[Streamer] ========== STARTING ROBUST CLEANUP ==========');
    
    // 1. Destroy active torrent stream
    if (activeStream) {
      const hash = activeStream.infoHash;
      const stream = activeStream;
      activeStream = null;
      
      try {
        console.log('[Streamer] Destroying torrent stream:', hash);
        if (client && hash) {
          const existing = client.get(hash);
          if (existing) {
            await new Promise((resolve) => {
              try { 
                client.remove(hash, () => {
                  console.log('[Streamer] ✓ Torrent removed from client');
                  resolve();
                }); 
              } catch (e) { 
                console.warn('[Streamer] Error removing torrent:', e.message);
                resolve(); 
              }
            });
          } else {
            try { 
              stream.destroy(); 
              console.log('[Streamer] ✓ Torrent stream destroyed');
            } catch (e) { }
          }
        } else {
          try { 
            stream.destroy(); 
            console.log('[Streamer] ✓ Torrent stream destroyed (no client)');
          } catch (e) { }
        }
      } catch (e) {
        console.warn('[Streamer] Error in torrent cleanup:', e.message);
      }
    }

    // 2. Close HTTP server with FORCE and wait for full port release
    if (streamServer) {
      try {
        console.log('[Streamer] Closing HTTP stream server (port 11470)...');

        for (const socket of activeConnections) {
          try { socket.destroy(); } catch (e) {}
        }
        activeConnections.clear();

        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.warn('[Streamer] Stream server close timeout, destroying any remaining sockets');
            for (const socket of activeConnections) {
              try { socket.destroy(); } catch (e) {}
            }
            activeConnections.clear();
            resolve();
          }, 2000);

          streamServer.close((err) => {
            if (err) console.warn('[Streamer] Error closing stream server:', err.message || err);
          });

          streamServer.once('close', () => {
            clearTimeout(timeout);
            console.log('[Streamer] ✓ Stream server closed cleanly');
            resolve();
          });
        });

        streamServer = null;
        activeFileIndex = null;
        activeStreamMetadata = null;
        
        // Give OS time to fully release the port (critical!)
        await new Promise(resolve => setTimeout(resolve, 250));
        console.log('[Streamer] ✓ Port 11470 released');
      } catch (e) {
        console.warn('[Streamer] Error closing stream server:', e.message);
        streamServer = null;
        activeFileIndex = null;
        activeStreamMetadata = null;
      }
    }

    // 3. Kill all spawned child processes (FFmpeg, FFprobe, etc.)
    if (childProcesses.size > 0) {
      console.log(`[Streamer] Killing ${childProcesses.size} child processes...`);
      for (const p of Array.from(childProcesses)) {
        try {
          if (p && !p.killed) {
            console.log('[Streamer] Sending SIGTERM to child process...');
            p.kill('SIGTERM');
            
            // If still alive after 2s, send SIGKILL
            await new Promise(resolve => {
              const killTimeout = setTimeout(() => {
                if (p && !p.killed) {
                  console.warn('[Streamer] Child process not responding, sending SIGKILL');
                  try { p.kill('SIGKILL'); } catch (e) {}
                }
                resolve();
              }, 2000);
            });
          }
          childProcesses.delete(p);
        } catch (e) {
          console.warn('[Streamer] Error killing child process:', e.message);
          childProcesses.delete(p);
        }
      }
      console.log('[Streamer] ✓ All child processes terminated');
    }

    // 4. Reset global state
    currentProgress = { status: 'idle' };
    console.log('[Streamer] ✓ Global state reset');
    startPearioMockServer();
    console.log('[Streamer] ========== CLEANUP COMPLETE ==========');
    return { success: true };
    
  } finally {
    _stopStreamingInProgress = false;
  }
}

module.exports = { initStreamerIpc, startStreaming, probeUrlStreams, stopStreaming, findBestVideoFile };
