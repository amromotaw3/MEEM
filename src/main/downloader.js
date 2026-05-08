const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { TEMP_DIR, ensureDir } = require('./store');
const { getMainWindow, showToastNotification } = require('./windowManager');

const activeDownloads = new Map();
let WebTorrent;
let wtClient = null;

async function getWT() {
  if (!WebTorrent) {
    const module = await import('webtorrent');
    WebTorrent = module.default;
  }
  return WebTorrent;
}

function isYouTubeUrl(url) { return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url); }

// yt-dlp supports 1000+ sites. We detect the most common social media platforms.
function isSocialMediaUrl(url) {
  return /^https?:\/\/(www\.)?(instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|vimeo\.com|dailymotion\.com|twitch\.tv|reddit\.com|soundcloud\.com|bilibili\.com|nicovideo\.jp|rumble\.com|streamable\.com|ok\.ru|vk\.com|vk\.video|snapchat\.com|pinterest\.com|linkedin\.com|threads\.net)\//i.test(url);
}

function isSupportedByYtDlp(url) {
  // Use yt-dlp for all HTTP/S downloads to utilize -N 8 parallel speeds
  return url.startsWith('http');
}
function formatBytes(bytes) { 
  if (!bytes) return '0 B'; 
  const k=1024, s=['B','KB','MB','GB']; 
  const i=Math.floor(Math.log(bytes)/Math.log(k)); 
  return (bytes/Math.pow(k,i)).toFixed(1)+' '+s[i]; 
}
let ffmpegPath = null;
try {
  const ffStatic = require('ffmpeg-static');
  if (ffStatic && fs.existsSync(ffStatic)) {
    ffmpegPath = ffStatic;
    if (app.isPackaged || __dirname.includes('app.asar')) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
  }
} catch (e) {
  console.warn('[Downloader] Failed to find ffmpeg-static:', e.message);
}

async function extractFrame(videoPath, outputPath) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return false;
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(ffmpegPath, [
      '-ss', '00:00:01',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      outputPath
    ], (err) => {
      if (err) {
        console.error('[Downloader] Frame extraction failed:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function downloadYouTube(url, outputPath, downloadId, displayName) {
  let cancelled = false, childProcess = null;
  const mainWindow = getMainWindow();
  
  activeDownloads.set(downloadId, { cancel: () => { cancelled = true; if (childProcess) childProcess.kill(); } });
  
  return new Promise((resolve, reject) => {
    mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: 1, downloaded: 'Starting...', total: 'Fetching...', status: 'downloading' });
    
    // Check for platform
    const isPackaged = app.isPackaged || __dirname.includes('app.asar');
    let ytPath = 'yt-dlp'; // Default to system path

    if (process.platform === 'win32') {
        ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
        if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    } else if (process.platform === 'android') {
        // Fallback to API for mobile because yt-dlp binary is not natively executable
        mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: 5, downloaded: 'Resolving link...', total: '...', status: 'downloading' });
        
        const tryCobaltAPI = async (apiUrl) => {
            const res = await axios.post(apiUrl, { url: url }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            return res.data;
        };

        const resolveDirectUrl = async () => {
            // 1. TikTok specific high-success API (TikWM)
            if (url.includes('tiktok.com')) {
                try {
                    const tikRes = await axios.post('https://www.tikwm.com/api/', { url: url }, { timeout: 15000 });
                    if (tikRes.data && tikRes.data.data && tikRes.data.data.play) {
                        return tikRes.data.data.play;
                    }
                } catch (e) {
                    console.warn('[DL] TikWM API failed, falling back to Cobalt...', e.message);
                }
            }

            // 2. Cobalt API Instances for YouTube, Instagram, and TikTok fallback
            const instances = ['https://co.wuk.sh/api/json', 'https://api.cobalt.tools/api/json'];
            for (let apiUrl of instances) {
                try {
                    const data = await tryCobaltAPI(apiUrl);
                    if (data && data.url) return data.url;
                } catch (e) {
                    console.warn(`[DL] Cobalt API failed at ${apiUrl}:`, e.message);
                }
            }
            throw new Error('All API instances failed to resolve the video link.');
        };

        resolveDirectUrl()
            .then(directUrl => {
                downloadDirect(directUrl, outputPath, downloadId, displayName)
                    .then(resolve)
                    .catch(reject);
            })
            .catch(err => {
                reject(new Error('Mobile social download failed: ' + err.message));
            });
        return;
    }

    if (!fs.existsSync(ytPath) && process.platform === 'win32') {
        console.warn('[DL] Local yt-dlp not found, trying system path...');
        ytPath = 'yt-dlp';
    }

    const outputTemplate = path.join(path.dirname(outputPath), downloadId + '.%(ext)s');
    const args = ['--no-playlist', '-o', outputTemplate, '--no-warnings', '--newline', '-N', '8'];
    
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath, '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
    } else {
      args.push('-f', 'b[ext=mp4]/b');
    }
    
    args.push(url);
    
    childProcess = require('child_process').spawn(ytPath, args);
    
    childProcess.stdout.on('data', (d) => { 
      if (cancelled) return; 
      const t = d.toString();
      // Match yt-dlp progress: handles ~estimated sizes and fragment downloads
      const m = t.match(/\[download\]\s+([\d\.]+)%\s+of\s+[~]?([\d\.]+)([a-zA-Z]+)(?:\s+at\s+([^\s]+))?/); 
      if (m) {
        const sizeNum = parseFloat(m[2]);
        const sizeUnit = m[3].toUpperCase();
        let totalDisplay = m[2] + m[3];
        
        // Sanity check: yt-dlp fragment downloads can report misleading totals
        // (e.g. "90.5GiB" when the actual file is ~200MB).
        // If yt-dlp reports >20GB for a non-torrent download, show "Estimating..." instead.
        if ((sizeUnit.startsWith('G') && sizeNum > 20) || sizeUnit.startsWith('T')) {
          totalDisplay = 'Estimating...';
        }
        
        mainWindow?.webContents?.send?.('download-progress', { 
            id: downloadId, 
            name: displayName, 
            percent: parseFloat(m[1]).toFixed(1), 
            downloaded: 'Downloading...', 
            total: totalDisplay, 
            speed: m[4] || '', 
            status: 'downloading' 
        }); 
      }
    });

    childProcess.on('close', (code) => { 
      if (cancelled) return; 
      if (code === 0) resolve();
      else reject(new Error(`Download failed (Code ${code}). Check if the link is valid.`));
    });

    childProcess.on('error', (err) => { 
        if (!cancelled) reject(new Error('Engine Error: ' + err.message)); 
    });
  });
}


async function downloadThumbnail(url, outputPath) {
  if (!url) return false;
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/'
      },
      timeout: 10000
    });
    const ws = fs.createWriteStream(outputPath);
    response.data.pipe(ws);
    return new Promise((resolve) => {
      ws.on('finish', () => resolve(true));
      ws.on('error', () => resolve(false));
    });
  } catch (err) {
    console.error('[DL] Thumbnail fetch failed:', err.message);
    return false;
  }
}

async function downloadDirect(url, outputPath, downloadId, displayName) {
  const mainWindow = getMainWindow();
  let cancelled = false;
  
  activeDownloads.set(downloadId, { cancel: () => { cancelled = true; } });

  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: { 'User-Agent': 'MediaVault/3.0' }
    });

    const totalBytes = parseInt(response.headers['content-length']) || 0;
    let downloadedBytes = 0;
    const ws = fs.createWriteStream(outputPath);

    response.data.on('data', (chunk) => {
      if (cancelled) {
        response.data.destroy();
        ws.close();
        return;
      }
      downloadedBytes += chunk.length;
      const percent = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : 0;
      
      mainWindow?.webContents?.send?.('download-progress', { 
        id: downloadId, 
        name: displayName, 
        percent, 
        downloaded: formatBytes(downloadedBytes), 
        total: formatBytes(totalBytes), 
        status: 'downloading' 
      });
    });

    return new Promise((resolve, reject) => {
      response.data.pipe(ws);
      ws.on('finish', () => { if (!cancelled) resolve(); });
      ws.on('error', reject);
      response.data.on('error', reject);
    });

  } catch (err) {
    throw new Error('Direct Download Failed: ' + (err.response?.statusText || err.message));
  }
}

async function downloadTorrent(magnet, outputPath, downloadId, displayName) {
  const WT = await getWT();
  if (!wtClient) wtClient = new WT({
    maxConns: 1000,
    maxWebConns: 250,
    dht: true,
    lsd: true,
    pex: true,
    tracker: true,
    utp: true // Enable uTP for better performance on restrictive networks
  });

  const bestTrackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://9.rarbg.com:2810/announce',
    'udp://open.stealth.si:80/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://opentracker.i2p.rocks:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://tracker.bitsearch.to:1337/announce',
    'udp://www.torrent.eu.org:451/announce',
    'udp://retracker.akado.ru:2710/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://ipv4.tracker.harry.lu:80/announce',
    'udp://tracker.auctor.tv:6969/announce',
    'udp://tracker.monitorit4.me:6969/announce',
    'udp://bt1.archive.org:6969/announce',
    'udp://bt2.archive.org:6969/announce',
    'udp://tracker.leechers-paradise.org:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://p4p.arenabg.ch:1337/announce',
    'udp://tracker.skyts.net:6969/announce',
    'http://tracker.files.fm:6969/announce',
    'udp://ipv4.tracker.harry.lu:80/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker1.bt-chat.com:6969/announce'
  ];

  function normalizeMagnet(uri, extraTrackers) {
    if (!uri.startsWith('magnet:')) return uri;
    let normalized = uri;
    extraTrackers.forEach(tr => {
      const trParam = 'tr=' + encodeURIComponent(tr);
      if (!normalized.includes(trParam)) {
        normalized += (normalized.includes('?') ? '&' : '?') + trParam;
      }
    });
    return normalized;
  }

  const magnetWithTrackers = normalizeMagnet(magnet, bestTrackers);

  const mainWindow = getMainWindow();

  return new Promise((resolve, reject) => {
    let cancelled = false;
    let metadataReceived = false;
    let lastProgressTime = Date.now();
    let startTime = Date.now();
    
    // Status Heartbeat: Update peer count even before metadata is received
    const heartbeatInterval = setInterval(() => {
      if (cancelled || metadataReceived) return; // Note: !torrent check removed because we want to show messages until it starts
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      let statusMsg = `Finding Peers...`;
      
      const peers = torrent ? torrent.numPeers : 0;
      
      if (peers > 0) {
        statusMsg = `Connecting to ${peers} peer${peers > 1 ? 's' : ''}...`;
      } else {
        if (elapsed > 10) statusMsg = `Searching trackers (${elapsed}s)...`;
        if (elapsed > 20) statusMsg = `Checking DHT & PEX networks...`;
        if (elapsed > 40) statusMsg = `Still searching (attempting deep discovery)...`;
        if (elapsed > 70) statusMsg = `Source might be slow or inactive (0 peers).`;
      }
      
      mainWindow?.webContents.send('download-progress', { 
        id: downloadId, 
        name: displayName, 
        percent: 0, 
        status: 'searching', 
        statusText: statusMsg 
      });
    }, 3000);

    // Watchdog: Timeout if no peers found within 120s
    const discoveryTimeout = setTimeout(() => {
      clearInterval(heartbeatInterval);
      if (!metadataReceived && !cancelled) {
        cancelled = true;
        try { wtClient.remove(torrent.infoHash); } catch(e) {}
        reject(new Error('Download failed: No peers found within 120s. The source might be dead or have 0 seeds.'));
      }
    }, 120000);

    let torrent;
    try {
      // Re-initialize client if needed with robust options
      if (!wtClient) wtClient = new WT({ dht: true, pex: true, lpd: true });
      torrent = wtClient.add(magnetWithTrackers, { path: path.dirname(outputPath) });
    } catch (e) {
      clearInterval(heartbeatInterval);
      clearTimeout(discoveryTimeout);
      reject(new Error('Failed to add torrent: ' + e.message));
      return;
    }

    // Attach events DIRECTLY on the torrent object (not inside callback)
    torrent.on('metadata', () => {
      metadataReceived = true;
      clearInterval(heartbeatInterval);
      clearTimeout(discoveryTimeout);
      
      if (torrent.files && torrent.files.length > 0) {
        const videoFiles = torrent.files.filter(f => f.name.match(/\.(mp4|mkv|avi|webm|mov)$/i));
        const largeVideos = videoFiles.filter(f => f.length > 50 * 1024 * 1024);

        if (largeVideos.length > 1) {
          // Season Pack: Deselect everything except the actual video episodes
          torrent.files.forEach(f => { if (!largeVideos.includes(f)) f.deselect(); });
          torrent.targetFile = null; // null implies batch mode
        } else {
          // Single Movie: Select only the largest file definitively
          const targetFile = torrent.files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
          torrent.files.forEach(f => { if (f !== targetFile) f.deselect(); });
          torrent.targetFile = targetFile;
        }
      }
      
      mainWindow?.webContents?.send?.('download-progress', { id: downloadId, name: displayName, percent: 0, status: 'metadata_ready', statusText: 'Metadata received...' });
    });

    torrent.on('ready', () => {
      metadataReceived = true;
      clearTimeout(discoveryTimeout);
    });

    torrent.on('download', () => {
      if (cancelled) return;
      metadataReceived = true;
      clearTimeout(discoveryTimeout);
      
      // Throttle UI updates to every 500ms
      const now = Date.now();
      if (now - lastProgressTime < 500) return;
      lastProgressTime = now;
      
      // Calculate true progress based on selection mode
      const progress = torrent.targetFile ? torrent.targetFile.progress : torrent.progress;
      const downloadedBytes = torrent.targetFile ? torrent.targetFile.downloaded : torrent.downloaded;
      
      // Calculate selected files total length
      let totalBytes = torrent.targetFile ? torrent.targetFile.length : 0;
      if (!torrent.targetFile) {
        totalBytes = torrent.files.filter(f => f.progress > -1).reduce((acc, f) => acc + f.length, 0);
        if (totalBytes === 0) totalBytes = torrent.length; // Fallback
      }

      mainWindow?.webContents.send('download-progress', { 
        id: downloadId, 
        name: displayName, 
        percent: (progress * 100).toFixed(1),
        downloaded: formatBytes(downloadedBytes),
        total: formatBytes(totalBytes),
        speed: formatBytes(torrent.downloadSpeed) + '/s',
        peers: torrent.numPeers,
        status: 'downloading'
      });
    });

    torrent.on('done', () => {
      if (cancelled) return;
      clearTimeout(discoveryTimeout);
      try {
        if (torrent.targetFile) {
          // Single file move
          const srcPath = path.join(path.dirname(outputPath), torrent.targetFile.path);
          if (fs.existsSync(srcPath) && srcPath !== outputPath) fs.copyFileSync(srcPath, outputPath);
        } else {
          // Season Pack: No renaming needed, keep the folder structure as is
        }
      } catch(e) { console.warn('[Downloader] File move error:', e.message); }
      resolve();
    });

    torrent.on('error', (err) => {
      clearTimeout(discoveryTimeout);
      if (!cancelled) reject(err);
    });

    activeDownloads.set(downloadId, { cancel: () => { cancelled = true; clearTimeout(discoveryTimeout); try { wtClient.remove(torrent.infoHash); } catch(e) {} } });
  });
}

function initDownloaderIpc(ipcMain) {
  ipcMain.handle('start-download', async (_e, opts) => {
    let { url, name, type, season, episode, isMusicMode } = opts;
    const mainWindow = getMainWindow();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    
    // Immediate feedback so the UI doesn't delay
    mainWindow?.webContents?.send?.('download-progress', { id, name: name || 'Initializing...', percent: 0, status: 'searching', statusText: 'Initializing...' });

    const isPackaged = app.isPackaged || __dirname.includes('app.asar');
    let ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (!fs.existsSync(ytPath)) ytPath = 'yt-dlp';

    const fetchInfo = (args) => new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`"${ytPath}" ${args} "${url}"`, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout.trim());
      });
    });

    // START METADATA FETCH IN BACKGROUND (NON-BLOCKING)
    let metadataPromise = null;
    if (url && (isMusicMode || (!name || name === ''))) {
      metadataPromise = (async () => {
        try {
          if (isMusicMode) {
            const jsonInfo = await fetchInfo('--print-json --skip-download --no-warnings');
            const info = JSON.parse(jsonInfo);
            const artist = info.artist || info.uploader || info.channel || (info.title.includes(' - ') ? info.title.split(' - ')[0].trim() : 'Unknown Artist');
            return {
              title: info.title || name,
              artist,
              album: info.album || 'Unknown Album',
              year: info.release_year || info.upload_date?.substring(0, 4) || '',
              coverUrl: info.thumbnail,
              sourceUrl: url,
              isVideoMusic: true
            };
          } else {
            const fetchedTitle = await fetchInfo('--get-title --no-warnings');
            return { title: fetchedTitle };
          }
        } catch (e) {
          console.error('[Downloader] Background metadata fetch failed:', e.message);
          return null;
        }
      })();
    }

    const safeName = (name || 'download').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    
    // Determine category
    let category = 'Social';
    const isMovie = opts.type === 'movie' || opts.mediaType === 'movie';
    const isSeries = opts.type === 'series' || opts.type === 'tv' || opts.mediaType === 'tv' || opts.type === 'anime' || opts.mediaType === 'anime';

    if (isMusicMode || opts.type === 'music' || opts.mediaType === 'music') {
        category = 'Music';
    } else if (isSeries || (season !== undefined && episode !== undefined && season !== null && episode !== null)) {
        category = 'Series';
    } else if (isMovie) {
        category = 'Movies';
    } else if (isYouTubeUrl(url) || isSocialMediaUrl(url)) {
        category = 'Social';
    } else {
        category = 'Downloads'; 
    }

    // --- SMART PATH RESOLUTION ---
    let rootDir = path.join(app.getPath('videos'), 'MediaVault');
    if (process.platform === 'android') {
        // On Android, use the public Downloads folder for better visibility
        rootDir = path.join(app.getPath('downloads'), 'MediaVault');
    }
    const profileName = opts.profileName || 'Default';
    const profileSafe = profileName.replace(/[<>:"/\\|?*]/g, '_');
    
    // If the caller already specified an explicit download path, use it directly.
    // This prevents creating spurious profile subdirectories (e.g. "Default/Social")
    // when the UI has already computed the correct destination.
    let finalDir;
    if (opts.downloadPath && opts.downloadPath.trim()) {
        finalDir = opts.downloadPath;
    } else if (isMusicMode || category === 'Music') {
        // Music mode: always use the profile's dedicated Music folder
        finalDir = path.join(rootDir, profileSafe, 'Music');
    } else {
        // Default fallback path - start with root but don't commit to profile subfolder yet
        finalDir = rootDir; 
        let useProfileFolder = true;

        // If profile has custom library folders, try to pick the most relevant one
        if (opts.libraryFolders && Array.isArray(opts.libraryFolders) && opts.libraryFolders.length > 0) {
            let bestMatch = null;
            if (category === 'Movies') {
                bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('movie') || f.toLowerCase().includes('film'));
            } else if (category === 'Series') {
                bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('tv') || f.toLowerCase().includes('series') || f.toLowerCase().includes('show') || f.toLowerCase().includes('anime'));
            } else if (category === 'Social') {
                bestMatch = opts.libraryFolders.find(f => f.toLowerCase().includes('social') || f.toLowerCase().includes('youtube') || f.toLowerCase().includes('video'));
            }
            
            if (bestMatch) {
                finalDir = bestMatch;
                useProfileFolder = false;
            } else {
                finalDir = opts.libraryFolders[0];
                useProfileFolder = false;
            }
        }

        if (useProfileFolder && profileSafe !== 'Default') {
            finalDir = path.join(finalDir, profileSafe, category);
        } else {
            finalDir = path.join(finalDir, category);
        }
    }
    let finalName = `${safeName}.mp4`;
    
    // Smart Parsing & Routing
    let pSeason = season;
    let pEpisode = episode;
    
    if (category === 'Series') {
        // Attempt to parse missing S/E
        if (pSeason == null || pEpisode == null) {
            const seMatch = (name || '').match(/[Ss](\d{1,2})\s*[Ee](\d{1,4})/i) || (name || '').match(/[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,4})/i);
            if (seMatch) {
                if (pSeason == null) pSeason = parseInt(seMatch[1], 10);
                if (pEpisode == null) pEpisode = parseInt(seMatch[2], 10);
            } else {
                const sMatch = (name || '').match(/[Ss](\d{1,2})\b/);
                if (sMatch && pSeason == null) pSeason = parseInt(sMatch[1], 10);
                const epMatch = (name || '').match(/(?:\s-\s|_[Ee][Pp]?\s*|^\s*0*)(\d{1,4})(?:v\d)?\b/);
                if (epMatch && pEpisode == null) pEpisode = parseInt(epMatch[1], 10);
            }
        }
        
        // Defaults for Anime/Series
        if (pSeason == null || Number.isNaN(pSeason)) pSeason = 1;
        if (pEpisode == null || Number.isNaN(pEpisode)) pEpisode = 1;

        const sNum = String(pSeason).padStart(2, '0');
        const eNum = String(pEpisode).padStart(2, '0');
        
        let showTitle = opts.title || name || safeName;
        // Clean title from standard tags
        showTitle = showTitle.replace(/[\[\(].*?[\]\)]/g, '').replace(/[._-]/g, ' ').replace(/[Ss]\d+.*$/i, '').trim();
        if (!showTitle) showTitle = safeName;
        showTitle = showTitle.replace(/[<>:"/\\|?*]/g, '_');
        
        if (!(opts.downloadPath && opts.downloadPath.trim())) {
            // Append show structure to the properly resolved base directory
            finalDir = path.join(finalDir, showTitle, `Season ${pSeason}`);
        }
        finalName = `${showTitle} - S${sNum}E${eNum}.mp4`;
        
    } else if (category === 'Movies') {
        // Movie -> \Movies\Movie Title (Year)\Movie Title.mp4
        let movieTitle = opts.title || name || safeName;
        movieTitle = movieTitle.replace(/[\[\(].*?[\]\)]/g, '').replace(/[._-]/g, ' ').trim() || safeName;
        movieTitle = movieTitle.replace(/[<>:"/\\|?*]/g, '_');
        const yearTxt = opts.year ? ` (${opts.year})` : '';
        
        if (!(opts.downloadPath && opts.downloadPath.trim())) {
            // Append movie folder to the properly resolved base directory
            finalDir = path.join(finalDir, `${movieTitle}${yearTxt}`);
        }
        finalName = `${movieTitle}.mp4`;
    }

    ensureDir(TEMP_DIR);
    if (!fs.existsSync(finalDir)) {
       fs.mkdirSync(finalDir, { recursive: true });
    }

    const tempPath = path.join(TEMP_DIR, `${id}.mp4`);
    let finalPath = path.join(finalDir, finalName);

    mainWindow?.webContents?.send?.('download-progress', { id, name: finalName, percent: 0, status: 'searching', statusText: 'Starting download...' });
    
    try {
      if (url.startsWith('magnet:') || (url.length === 40 && !url.includes(':'))) { 
        await downloadTorrent(url, tempPath, id, finalName); 
      } else {
        // RADICAL FIX: Try Native Direct Download first for speed and reliability
        // Only use yt-dlp if it's a known social media / video site that requires extraction
        const useYtDlp = isYouTubeUrl(url) || isSocialMediaUrl(url);
        
        if (useYtDlp) {
          try {
            await downloadYouTube(url, tempPath, id, finalName);
          } catch (ytErr) {
            console.warn('[DL] yt-dlp failed, attempting native fallback:', ytErr.message);
            await downloadDirect(url, tempPath, id, finalName);
          }
        } else {
          await downloadDirect(url, tempPath, id, finalName);
        }
      }
      
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
      if (files.length === 0) throw new Error('Download finished but no file was found.');
      
      const sourceFile = path.join(TEMP_DIR, files[0]);
      const actualExt = path.extname(files[0]);
      
      if (actualExt && actualExt !== '.mp4') { 
        finalPath = finalPath.replace(/\.mp4$/i, actualExt); 
        finalName = finalName.replace(/\.mp4$/i, actualExt); 
      }
      
      if (!fs.existsSync(path.dirname(finalPath))) fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      
      // Use move instead of copy for speed
      fs.renameSync(sourceFile, finalPath);
      
      mainWindow?.webContents?.send?.('download-complete', { id, name: finalName, path: finalPath, url });
      showToastNotification('Download Complete', finalName);
      activeDownloads.delete(id);

      // Metadata generation in background
      (async () => {
        try {
          const coverPath = finalPath + '.cover.jpg';
          if (isMusicMode || category === 'Social') {
            await extractFrame(finalPath, coverPath);
          }
          mainWindow?.webContents?.send?.('metadata-ready', { path: finalPath });
        } catch (e) {}
      })();

      return { success: true, id, path: finalPath };
    } catch (err) {
      activeDownloads.delete(id); 
      mainWindow?.webContents?.send?.('download-error', { id, name: finalName, error: err.message }); 
      return { success: false, id, error: err.message };
    }
  });

  ipcMain.handle('cancel-download', (_e, id) => { 
    const dl = activeDownloads.get(id); 
    if (dl?.cancel) { dl.cancel(); activeDownloads.delete(id); } 
    return true; 
  });

  ipcMain.handle('fetch-url-metadata', async (_e, url) => {
    return new Promise((resolve) => {
      const isPackaged = app.isPackaged || __dirname.includes('app.asar');
      let ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
      if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
      if (!fs.existsSync(ytPath)) ytPath = 'yt-dlp';

      const cp = require('child_process').spawn(ytPath, ['--get-title', '--no-playlist', '--quiet', '--no-warnings', url]);
      let title = '';
      cp.stdout.on('data', d => title += d.toString());
      cp.on('close', (code) => {
        if (code === 0 && title.trim()) resolve({ success: true, title: title.trim() });
        else resolve({ success: false });
      });
      cp.on('error', () => resolve({ success: false }));
      // Timeout after 5 seconds to avoid hanging the UI
      setTimeout(() => { try { cp.kill(); } catch(e){} resolve({ success: false }); }, 5000);
    });
  });
}

module.exports = { initDownloaderIpc };
