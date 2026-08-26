const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { exec, execSync, spawn } = require('child_process');

// Cached binary paths to avoid repeated filesystem checks
let cachedFFmpegPath = null;
let cachedYtDlpPath = null;
let checkedYtDlp = false;

// Asynchronously check system PATH for yt-dlp on module load
(function initYtDlpCheck() {
  const isPackaged = (app && app.isPackaged) || __dirname.includes('app.asar');
  let ytPath = 'yt-dlp';
  if (process.platform === 'win32') {
    ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
  }

  if (fs.existsSync(ytPath)) {
    cachedYtDlpPath = ytPath;
    checkedYtDlp = true;
    return;
  }

  exec('yt-dlp --version', { timeout: 2000 }, (error) => {
    checkedYtDlp = true;
    if (!error) {
      cachedYtDlpPath = 'yt-dlp';
    } else {
      console.warn('[Adapter] yt-dlp not found in bundle or system PATH (async check)');
      cachedYtDlpPath = null;
    }
  });
})();

function resolveYtDlpPath() {
  if (checkedYtDlp || cachedYtDlpPath) return cachedYtDlpPath;

  const isPackaged = (app && app.isPackaged) || __dirname.includes('app.asar');
  let ytPath = 'yt-dlp';
  if (process.platform === 'win32') {
    ytPath = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    if (isPackaged) ytPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
  }

  if (fs.existsSync(ytPath)) {
    cachedYtDlpPath = ytPath;
    checkedYtDlp = true;
    return ytPath;
  }

  // Fallback: check system PATH synchronously only once if async check isn't complete yet
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 2000 });
    cachedYtDlpPath = 'yt-dlp';
  } catch (e) {
    console.warn('[Adapter] yt-dlp not found in bundle or system PATH (sync fallback)');
    cachedYtDlpPath = null;
  }
  checkedYtDlp = true;
  return cachedYtDlpPath;
}

function spawnYtDlp(args, opts = {}) {
  const yt = resolveYtDlpPath();
  if (!yt) throw new Error('yt-dlp binary not found');
  return spawn(yt, args, opts);
}

function execYtDlp(args, options = {}) {
  const yt = resolveYtDlpPath();
  if (!yt) return Promise.reject(new Error('yt-dlp binary not found'));
  return new Promise((resolve, reject) => {
    exec(`"${yt}" ${args}`, {
      maxBuffer: options.maxBuffer || 1024 * 1024 * 50,
      timeout: options.timeout || 30000
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`yt-dlp exec failed: ${error.message}`));
      } else {
        resolve(stdout.toString().trim());
      }
    });
  });
}

function getFfmpegPath() {
  if (cachedFFmpegPath) return cachedFFmpegPath;
  try {
    const ffStatic = require('ffmpeg-static');
    if (!ffStatic) {
      console.warn('[Adapter] ffmpeg-static not available');
      return null;
    }

    let fp = ffStatic;
    if (app.isPackaged || __dirname.includes('app.asar')) {
      fp = fp.replace('app.asar', 'app.asar.unpacked');
    }

    if (!fs.existsSync(fp)) {
      console.warn('[Adapter] FFmpeg binary not found at:', fp);
      return null;
    }

    cachedFFmpegPath = fp;
    return fp;
  } catch (err) {
    console.error('[Adapter] Failed to resolve FFmpeg:', err.message);
    return null;
  }
}

function verifyBinaries() {
  return {
    ffmpeg: { available: !!getFfmpegPath(), path: cachedFFmpegPath },
    ytdlp: { available: !!resolveYtDlpPath(), path: cachedYtDlpPath }
  };
}

function clearCache() {
  cachedFFmpegPath = null;
  cachedYtDlpPath = null;
}

module.exports = { resolveYtDlpPath, spawnYtDlp, execYtDlp, getFfmpegPath, verifyBinaries, clearCache };
