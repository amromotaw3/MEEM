const http = require('http');
const fs = require('fs');
const path = require('path');
const ip = require('ip');
const mime = require('mime-types');
const { loadData, BANNERS_DIR } = require('./store');
const { powerSaveBlocker } = require('electron');


// Wrap bonjour in try-catch — it crashes on Windows systems without mDNS service
let bonjour;
try {
  bonjour = require('bonjour')();
} catch (e) {
  console.warn('[SyncServer] Bonjour/mDNS unavailable:', e.message);
  bonjour = null;
}

let server = null;
let port = 0;
let bonjourService = null;
let connectedClients = new Set();
let sleepBlockerId = null;

/**
 * Starts a persistent HTTP server that broadcasts its presence via Bonjour (Zeroconf).
 * This allows the mobile app to discover the PC and stream its library.
 */
function startPersistentServer(onStarted) {
  if (server) return;

  server = http.createServer((req, res) => {
    // Enable CORS for mobile app (Capacitor origins)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Connection', 'keep-alive');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // 2. API Endpoint: Get Library Metadata
    if (pathname === '/api/library') {
      const data = loadData();
      const library = {
        movies: data.movies || [],
        shows: data.shows || [],
        music: data.music || [],
        profile: data.profiles?.[0]?.name || 'Default'
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(library));
      return;
    }

    // 2.5 API Endpoint: Get Server Status
    if (pathname === '/api/status') {
      const clientIp = req.socket.remoteAddress;
      if (typeof connectedClients !== 'undefined') connectedClients.add(clientIp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'online', 
        name: require('os').hostname(),
        clients: (typeof connectedClients !== 'undefined') ? connectedClients.size : 0
      }));
      return;
    }

    // 2. Poster Endpoint: Proxy local banner files
    if (pathname.startsWith('/api/poster/')) {
      const bannerId = pathname.replace('/api/poster/', '');
      const bannerPath = path.join(BANNERS_DIR, bannerId);
      if (fs.existsSync(bannerPath)) {
        res.writeHead(200, { 'Content-Type': mime.lookup(bannerPath) || 'image/jpeg' });
        fs.createReadStream(bannerPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // 3. Stream Endpoint: Stream media files with range support
    if (pathname === '/stream') {
      const rawPath = url.searchParams.get('path');
      if (!rawPath) {
        res.writeHead(400);
        res.end('Missing path parameter');
        return;
      }

      // Security: Normalize path to prevent traversal attacks (../ etc.)
      const filePath = path.resolve(rawPath);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      // Security Check: Ensure file is within an allowed folder
      const data = loadData();
      const { app: electronApp } = require('electron');
      const profileBase = path.join(electronApp.getPath('videos'), 'MediaVault');
      const allowedFolders = [...(data.libraryFolders || []), profileBase];
      const isAllowed = allowedFolders.some(folder => filePath.startsWith(path.resolve(folder)));
      
      if (!isAllowed) {
        console.warn('[SyncServer] Blocked access to:', filePath);
        res.writeHead(403);
        res.end('Access Denied');
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      
      // Enhanced MIME detection
      const ext = path.extname(filePath).toLowerCase();
      let contentType = mime.lookup(filePath) || 'video/mp4';
      if (ext === '.mkv') contentType = 'video/x-matroska';
      if (ext === '.webm') contentType = 'video/webm';
      if (ext === '.avi') contentType = 'video/x-msvideo';
      if (ext === '.mp3') contentType = 'audio/mpeg';
      if (ext === '.wav') contentType = 'audio/wav';
      if (ext === '.srt') contentType = 'text/plain';
      if (ext === '.vtt') contentType = 'text/vtt';

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        };
        res.writeHead(206, head);
        file.on('error', (err) => {
          console.error('[SyncServer] Stream Error:', err.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': contentType,
        };
        res.writeHead(200, head);
        const file = fs.createReadStream(filePath);
        file.on('error', (err) => {
          console.error('[SyncServer] Full Stream Error:', err.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        file.pipe(res);
      }
      return;
    }

    // Default 404
    res.writeHead(404);
    res.end();
  });

  // Listen on a fixed port for consistency (SyncServer default: 52686)
  const FIXED_PORT = 52686;
  server.listen(FIXED_PORT, '0.0.0.0', () => {
    port = server.address().port;
    
    // Get all IPv4 addresses
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
      for (const k2 in interfaces[k]) {
        const address = interfaces[k][k2];
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    
    const primaryIp = addresses[0] || ip.address();
    if (onStarted) onStarted(port, primaryIp, addresses);
    console.log(`[SyncServer] Running at http://${primaryIp}:${port}`);
    console.log(`[SyncServer] Available at: ${addresses.join(', ')}`);

    // Broadcast via Bonjour/Zeroconf (if available)
    if (bonjour) {
      try {
        bonjourService = bonjour.publish({
          name: `MediaVault-${localIp.replace(/\./g, '-')}`,
          type: 'mediavault',
          protocol: 'tcp',
          port: port,
          txt: {
            version: '1.0.0',
            platform: process.platform
          }
        });
        console.log(`[Discovery] Service broadcasted: _mediavault._tcp at port ${port}`);
      } catch (e) {
        console.warn('[Discovery] Failed to broadcast:', e.message);
      }
    } else {
      console.warn('[Discovery] Bonjour unavailable — mobile discovery will not work automatically.');
    }
    
    // Prevent sleep while server is running
    if (powerSaveBlocker && !sleepBlockerId) {
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log('[SyncServer] Power save blocked (prevent-app-suspension)');
    }
  });
}

function stopPersistentServer() {
  if (sleepBlockerId !== null && powerSaveBlocker) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }

  if (bonjourService) {
    bonjourService.stop();
    bonjourService = null;
  }
  if (server) {
    server.close();
    server = null;
  }
}

/**
 * Helper for VLC and other one-off streaming requests
 */
function startServer(filePath) {
  if (!server) {
    startPersistentServer();
  }
  const localIp = ip.address();
  // If no server port is assigned yet, we might need to wait or use a default
  // But startPersistentServer is async in its listen call.
  // For VLC, we can just return the stream URL assuming the server will be up.
  return `http://${localIp}:${port}/stream?path=${encodeURIComponent(filePath)}`;
}

module.exports = {
  startPersistentServer,
  stopPersistentServer,
  startServer
};
