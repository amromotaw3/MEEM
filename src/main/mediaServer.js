const http = require('http');
const fs = require('fs');
const path = require('path');
const ip = require('ip');
const mime = require('mime-types');
const { loadData, BANNERS_DIR } = require('./store');
const { powerSaveBlocker } = require('electron');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');



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

  server = http.createServer(async (req, res) => {
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
      const data = await loadData();
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

    // 2.6 API Endpoint: Player Playback Progress Reporting (from MEEM Player)
    if (pathname === '/api/player/progress') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const { handleExternalPlayerProgress } = require('./ipc/mediaPlay');
            if (typeof handleExternalPlayerProgress === 'function') {
              await handleExternalPlayerProgress(data);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      } else {
        res.writeHead(405);
        res.end();
      }
      return;
    }

    // 2.7 API Endpoint: YouTube Stream Direct Resolver / Redirect & Details
    if (pathname === '/api/youtube/stream' || pathname === '/api/youtube/details') {
      const videoId = url.searchParams.get('v') || url.searchParams.get('id');
      const requestedQuality = url.searchParams.get('quality') || '1080';
      const wantsJson = pathname === '/api/youtube/details' || url.searchParams.get('format') === 'json';

      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Missing v parameter' }));
        return;
      }

      try {
        const YouTubeService = require('./youtube/YouTubeService');
        const ytRes = await YouTubeService.getVideoDetails(videoId, requestedQuality);
        const directUrl = ytRes?.details?.streamUrl;
        const audioUrl = ytRes?.details?.audioStreamUrl || null;

        if (wantsJson) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({
            success: Boolean(directUrl),
            streamUrl: directUrl || '',
            audioStreamUrl: audioUrl || '',
            title: ytRes?.details?.title || '',
            thumbnail: ytRes?.details?.thumbnail || '',
            quality: requestedQuality,
            availableQualities: ytRes?.details?.availableQualities || ['1080p', '720p', '480p', '360p', 'Auto']
          }));
          return;
        }

        if (directUrl) {
          res.writeHead(302, {
            'Location': directUrl,
            'Access-Control-Allow-Origin': '*'
          });
          res.end();
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Stream not found' }));
      } catch (err) {
        console.error('[SyncServer] YouTube resolver error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Resolver Error: ' + err.message }));
        }
      }
      return;
    }

    // 2.8 API Endpoint: SubDL Subtitles Search Proxy (for MEEM Player)
    if (pathname === '/api/subtitles/subdl/search') {
      try {
        const imdbId = url.searchParams.get('imdb_id') || url.searchParams.get('imdbId');
        const tmdbId = url.searchParams.get('tmdb_id') || url.searchParams.get('tmdbId');
        const season = url.searchParams.get('season');
        const episode = url.searchParams.get('episode');
        const filmName = url.searchParams.get('film_name') || url.searchParams.get('title') || '';
        const mediaType = url.searchParams.get('type') || (season ? 'tv' : 'movie');
        const languages = url.searchParams.get('languages') || 'AR,EN';

        const { readLocalAppData } = require('./store');
        const local = readLocalAppData() || {};
        const apiKey = url.searchParams.get('api_key') || local.subdlConfig?.apiKey || local.subdlKey || '';

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'SubDL API key not configured', subtitles: [] }));
          return;
        }

        const axios = require('axios');
        const params = {
          api_key: apiKey,
          type: mediaType,
          languages: languages
        };
        if (imdbId) params.imdb_id = imdbId;
        if (tmdbId) params.tmdb_id = tmdbId;
        if (season) params.season_number = season;
        if (episode) params.episode_number = episode;
        if (filmName && !imdbId && !tmdbId) params.film_name = filmName;

        const subdlResp = await axios.get('https://api.subdl.com/api/v1/subtitles', {
          params,
          timeout: 6000
        }).catch(e => ({ data: { status: false, error: e.message } }));

        const rawList = subdlResp.data?.subtitles || [];
        const normalized = rawList.map((s, idx) => {
          let dlUrl = s.url || '';
          if (dlUrl && !dlUrl.startsWith('http')) dlUrl = `https://dl.subdl.com${dlUrl}`;
          const lang = (s.lang || s.language || 'Unknown').toUpperCase();
          const release = s.release_name || s.name || '';
          const author = s.author ? ` (by ${s.author})` : '';
          return {
            id: s.sd_id || s.subtitle_id || idx,
            url: dlUrl,
            lang: lang,
            releaseName: release,
            label: `[${lang}] ${release || 'Subtitle'}${author}`,
            format: s.format || 'zip',
            hi: !!s.hi
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, count: normalized.length, subtitles: normalized }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message, subtitles: [] }));
      }
      return;
    }

    // 2.9 API Endpoint: SubDL Subtitle Download & Unpack Proxy (for MEEM Player)
    if (pathname === '/api/subtitles/subdl/download') {
      try {
        const subUrl = url.searchParams.get('url');
        if (!subUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
          return;
        }

        const axios = require('axios');
        const AdmZip = require('adm-zip');
        const os = require('os');
        const subsDir = path.join(os.tmpdir(), 'meem_player_subs');
        if (!fs.existsSync(subsDir)) fs.mkdirSync(subsDir, { recursive: true });

        const resp = await axios.get(subUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://subdl.com/'
          }
        });

        const targetEp = parseInt(url.searchParams.get('episode') || '0', 10);
        const targetSeason = parseInt(url.searchParams.get('season') || '0', 10);

        let targetSrtPath = '';
        if (subUrl.toLowerCase().endsWith('.zip') || resp.data.slice(0, 4).toString('utf-8').includes('PK')) {
          const zip = new AdmZip(Buffer.from(resp.data));
          const entries = zip.getEntries();
          const subEntries = entries.filter(e => !e.isDirectory && /\.(srt|ass|vtt)$/i.test(e.entryName));
          
          let selectedEntry = null;
          if (subEntries.length > 0) {
            if (targetEp > 0) {
              // Score entries to accurately pick matching episode in multi-episode packs
              const scored = subEntries.map(e => {
                const name = path.basename(e.entryName).toLowerCase();
                let score = 0;
                
                // Match S01E05 / S1E5
                if (targetSeason > 0) {
                  const sRegex = new RegExp(`s0*${targetSeason}e0*${targetEp}([^0-9]|$)`, 'i');
                  if (sRegex.test(name)) score += 100;
                }
                
                // Match E05 / EP05 / Episode 05
                const epRegex = new RegExp(`(?:e|ep|episode)[._ -]?0*${targetEp}([^0-9]|$)`, 'i');
                if (epRegex.test(name)) score += 80;

                // Match delimited episode number like " - 05 ", "[05]", "(05)", "_05_"
                const delimRegex = new RegExp(`[\\[\\(_ .-]0*${targetEp}[\\]\\)_ .-]`, 'i');
                if (delimRegex.test(name)) score += 60;

                // Match isolated episode number
                const isoRegex = new RegExp(`(^|[^0-9])0*${targetEp}([^0-9]|$)`, 'i');
                if (isoRegex.test(name)) score += 40;

                return { entry: e, score };
              });

              scored.sort((a, b) => b.score - a.score);
              if (scored[0].score > 0) {
                selectedEntry = scored[0].entry;
              }
            }

            if (!selectedEntry) {
              selectedEntry = subEntries[0];
            }
          }

          if (selectedEntry) {
            targetSrtPath = path.join(subsDir, `sub_${Date.now()}_${path.basename(selectedEntry.entryName)}`);
            fs.writeFileSync(targetSrtPath, selectedEntry.getData());
          }
        } else {
          targetSrtPath = path.join(subsDir, `sub_${Date.now()}.srt`);
          fs.writeFileSync(targetSrtPath, Buffer.from(resp.data));
        }

        if (targetSrtPath && fs.existsSync(targetSrtPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, path: targetSrtPath }));
        } else {
          res.writeHead(422, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'No subtitle extracted from archive' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
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
      // Skip for localhost connections (the Electron app itself — the file is already trusted)
      const clientIp = req.socket.remoteAddress;
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
      if (!isLocalhost) {
        const data = await loadData();
        const { app: electronApp } = require('electron');
        const profileBase = path.join(electronApp.getPath('videos'), 'MEEM');
        const allowedFolders = [...(data.libraryFolders || []), profileBase];
        const isAllowed = allowedFolders.some(folder => filePath.startsWith(path.resolve(folder)));
        
        if (!isAllowed) {
          console.warn('[SyncServer] Blocked access to:', filePath);
          res.writeHead(403);
          res.end('Access Denied');
          return;
        }
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      const transcodeMode = url.searchParams.get('transcode'); // 'true'|'audio' = fast remux, 'full' = full transcode
      const isTranscodeAudio = transcodeMode === 'true' || transcodeMode === 'audio';
      const isTranscodeFull  = transcodeMode === 'full';
      const isTranscode = isTranscodeAudio || isTranscodeFull;
      const startTime = parseFloat(url.searchParams.get('start')) || 0;
      
      // Enhanced MIME detection
      const ext = path.extname(filePath).toLowerCase();
      let contentType = isTranscode ? 'video/mp4' : (mime.lookup(filePath) || 'video/mp4');
      if (!isTranscode) {
        if (ext === '.mkv') contentType = 'video/x-matroska';
        if (ext === '.webm') contentType = 'video/webm';
        if (ext === '.avi') contentType = 'video/x-msvideo';
        if (ext === '.mp3') contentType = 'audio/mpeg';
        if (ext === '.wav') contentType = 'audio/wav';
        if (ext === '.srt') contentType = 'text/plain';
        if (ext === '.vtt') contentType = 'text/vtt';
      }

      if (isTranscode) {
        console.log(`[SyncServer] Transcoding started for local file: ${filePath} (Start: ${startTime}s, Mode: ${transcodeMode})`);
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none' });

        let ffmpegArgs;
        if (isTranscodeAudio) {
          ffmpegArgs = [
            '-loglevel', 'error',
            '-fflags', '+genpts',
            '-i', filePath,
            ...(startTime > 0 ? ['-ss', startTime.toString()] : []),
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ac', '2',
            '-avoid_negative_ts', 'make_zero',
            '-reset_timestamps', '1',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
            '-f', 'mp4',
            'pipe:1'
          ];
        } else {
          ffmpegArgs = [
            '-loglevel', 'error',
            ...(startTime > 0 ? ['-ss', startTime.toString()] : []),
            '-i', filePath,
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
        }

        const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        
        ffmpegProcess.stderr.on('data', (data) => {
          console.error(`[SyncServer/FFmpeg] ${data.toString().trim()}`);
        });

        ffmpegProcess.stdout.pipe(res);

        res.on('close', () => {
          console.log('[SyncServer] Client disconnected, terminating ffmpeg...');
          try { ffmpegProcess.kill('SIGTERM'); } catch (e) {}
          setTimeout(() => { try { if (!ffmpegProcess.killed) ffmpegProcess.kill('SIGKILL'); } catch(e){} }, 2000);
        });

        ffmpegProcess.on('error', (err) => {
          console.error('[SyncServer] FFmpeg spawn error:', err.message);
          if (!res.headersSent) { try { res.writeHead(500); res.end('Transcode failed'); } catch(e){} }
        });

        ffmpegProcess.on('exit', (code, sig) => {
          if (code !== 0 && code !== null) console.warn('[SyncServer] FFmpeg exited with code', code, 'signal', sig);
          try { if (!res.destroyed) res.end(); } catch(e){}
        });
        return;
      }

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
          name: `MediaVault-${(primaryIp || 'device').replace(/\./g, '-')}`,
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

/**
 * Waits for the persistent server to be ready and returns the localhost base URL.
 * Safe to call multiple times — resolves immediately if the server is already running.
 */
function ensureLocalServerReady() {
  return new Promise((resolve) => {
    if (server) {
      // Server already running — resolve immediately with the actual port
      resolve(`http://127.0.0.1:${server.address().port}`);
    } else {
      // Start server and resolve once it's actually listening
      startPersistentServer((actualPort) => {
        resolve(`http://127.0.0.1:${actualPort}`);
      });
    }
  });
}

module.exports = {
  startPersistentServer,
  stopPersistentServer,
  startServer,
  ensureLocalServerReady
};
