const { app } = require('electron');
const path = require('path');
const http = require('http');
const ip = require('ip');

let WebTorrent;
let client = null;
let activeStream = null;
let streamServer = null;
let controlServer = null;
let currentProgress = null;

async function getWT() {
  if (!WebTorrent) {
    const module = await import('webtorrent');
    WebTorrent = module.default;
  }
  return WebTorrent;
}

function initStreamerIpc(ipcMain) {
  // --- INTERNAL START ---
  ipcMain.handle('start-torrent-stream', async (event, magnet) => {
    return await startStreaming(magnet, (data) => {
      if (event && event.sender) event.sender.send('torrent-progress', data);
    });
  });

  ipcMain.handle('stop-torrent-stream', async () => {
    return await stopStreaming();
  });

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
        if (!magnet) {
          res.writeHead(400); res.end('Missing url'); return;
        }
        const result = await startStreaming(magnet);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404); res.end();
    });
    controlServer.listen(11471, '0.0.0.0', () => {
      console.log(`[Streamer] Control server (API) listening on ${ip.address()}:11471`);
    });
  }
}

async function startStreaming(magnet, progressCb = null) {
  console.log('[Streamer] Starting stream:', magnet.substring(0, 50) + '...');
  try {
    const WT = await getWT();
    await stopStreaming();

    if (!client) {
      client = new WT({ dht: true, pex: true, lsd: true });
    }

    let finalMagnet = magnet;
    if (magnet && magnet.length === 40 && !magnet.includes(':')) {
      finalMagnet = `magnet:?xt=urn:btih:${magnet}`;
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

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Metadata timeout')), 120000);
      const torrent = client.add(finalMagnet, { announce: TRACKERS });
      activeStream = torrent;

      torrent.on('metadata', () => {
        console.log('[Streamer] Metadata received for:', torrent.infoHash, 'with trackers:', TRACKERS);
        clearTimeout(timeout);
      });
      torrent.on('ready', () => {
        const videoFiles = torrent.files.filter(f => f.name.match(/\.(mp4|mkv|avi|webm|mov)$/i));
        const file = videoFiles.length > 0 
          ? videoFiles.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr)
          : torrent.files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
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
            const index = parseInt(url.pathname.substring(1));
            const targetFile = torrent.files[index];
            
            if (!targetFile) {
              res.writeHead(404);
              res.end();
              return;
            }

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'bytes');
            
            // Basic MIME detection
            const ext = path.extname(targetFile.name).toLowerCase();
            const mime = ext === '.mkv' ? 'video/x-matroska' : 'video/mp4';
            res.setHeader('Content-Type', mime);

            const fileSize = targetFile.length;
            const range = req.headers.range;

            if (range) {
              const parts = range.replace(/bytes=/, "").split("-");
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
              const chunksize = (end - start) + 1;
              
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunksize
              });
              targetFile.createReadStream({ start, end }).pipe(res);
            } else {
              res.writeHead(200, { 'Content-Length': fileSize });
              targetFile.createReadStream().pipe(res);
            }
          } catch (e) {
            console.error('[Streamer] Server Error:', e.message);
            if (!res.headersSent) { res.writeHead(500); res.end(); }
          }
        });

        streamServer.listen(11470, '0.0.0.0', () => {
          const localIp = ip.address();
          resolve({
            success: true,
            url: `http://${localIp}:11470/${fileIndex}`,
            localUrl: `http://localhost:11470/${fileIndex}`,
            title: file.name
          });
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
  if (streamServer) { 
    try { streamServer.close(); } catch(e) {}
    streamServer = null; 
  }
  if (activeStream) {
    try {
      const hash = activeStream.infoHash;
      activeStream.destroy();
      if (client && hash) {
        const existing = client.get(hash);
        if (existing) client.remove(hash, () => {});
      }
    } catch(e) {}
    activeStream = null;
  }
  currentProgress = { status: 'idle' };
  return { success: true };
}

module.exports = { initStreamerIpc };
