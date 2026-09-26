const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');
const axios = require('axios');

/**
 * Semantic version comparison: returns true if `latest` is strictly newer than `current`.
 * Handles versions like "3.1.0", "3.10.2", etc.
 */
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const a = String(latest).replace(/^v/i, '').split('.').map(Number);
  const b = String(current).replace(/^v/i, '').split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false; // equal
}

function initUpdater(win) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[UPDATER] Checking for update...');
    try { win.webContents.send('update-status', { status: 'checking', msg: 'Checking for updates...' }); } catch (e) {}
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATER] Update available:', info.version);
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : (Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.releaseNotes).join('\n') : info.body || '');
    try {
      win.webContents.send('update-status', { 
        status: 'available', 
        msg: `Update Available: v${info.version}`,
        version: info.version,
        releaseNotes: notes
      });
    } catch (e) {}
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[UPDATER] No update available.');
    try { win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' }); } catch (e) {}
  });

  let isManualCheck = false;

  autoUpdater.on('error', (err) => {
    console.error('[UPDATER] Error:', err.message);
    if (isManualCheck) {
      try { win.webContents.send('update-status', { status: 'error', msg: `Update Error: ${err.message}` }); } catch (e) {}
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    try {
      win.webContents.send('update-status', { 
        status: 'downloading', 
        percent: progressObj.percent.toFixed(1),
        speed: (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2),
        msg: `Downloading: ${progressObj.percent.toFixed(1)}%`
      });
    } catch (e) {}
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[UPDATER] Update downloaded.');
    const notes = info && (typeof info.releaseNotes === 'string' ? info.releaseNotes : (Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.releaseNotes).join('\n') : info.body || ''));
    try {
      win.webContents.send('update-status', { 
        status: 'ready', 
        msg: 'Update Downloaded. Restarting to apply...',
        releaseNotes: notes
      });
    } catch (e) {}
  });

  // Fetch release notes from GitHub API for a specific tag or latest
  ipcMain.handle('get-release-notes', async (_event, version) => {
    try {
      let url = 'https://api.github.com/repos/amromotaw3/MEEM-Landing/releases/latest';
      if (version) {
        const cleanVer = String(version).replace(/^v/i, '').trim();
        url = `https://api.github.com/repos/amromotaw3/MEEM-Landing/releases/tags/v${cleanVer}`;
      }
      let resp = await axios.get(url, { timeout: 8000 }).catch(() => null);
      if ((!resp || !resp.data) && version) {
        resp = await axios.get('https://api.github.com/repos/amromotaw3/MEEM-Landing/releases/latest', { timeout: 8000 }).catch(() => null);
      }

      if (resp && resp.data) {
        const data = resp.data;
        return {
          success: true,
          version: data.tag_name ? data.tag_name.replace(/^v/i, '') : version,
          name: data.name || `Version ${data.tag_name || version}`,
          notes: data.body || 'No release description provided for this version.',
          publishedAt: data.published_at,
          htmlUrl: data.html_url
        };
      }
      return { success: false, error: 'Could not fetch release notes from GitHub.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // IPC Listeners for Renderer
  ipcMain.handle('check-for-updates', async () => {
    try {
      console.log('[UPDATER] Manual check requested');
      isManualCheck = true;
      const checkPromise = autoUpdater.checkForUpdates();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Update check timed out after 15s')), 15000)
      );
      const result = await Promise.race([checkPromise, timeoutPromise]);

      if (result && result.updateInfo && result.updateInfo.version) {
        const latestVersion = result.updateInfo.version;
        const currentVersion = autoUpdater.currentVersion ? autoUpdater.currentVersion.version : require('../../package.json').version;
        const notes = typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : (Array.isArray(result.updateInfo.releaseNotes) ? result.updateInfo.releaseNotes.map(n => n.releaseNotes).join('\n') : result.updateInfo.body || '');
        
        console.log(`[UPDATER] Version check: Current=${currentVersion}, Latest=${latestVersion}`);
        
        if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
          win.webContents.send('update-status', { 
            status: 'available', 
            msg: `Update Available: v${latestVersion}`, 
            version: latestVersion, 
            releaseNotes: notes,
            downloadUrl: result.updateInfo.files && result.updateInfo.files[0] && result.updateInfo.files[0].url 
          });
        } else {
          win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' });
        }
      }

      return { success: true, result };
    } catch (err) {
      console.error('[UPDATER] Check failed:', err.message);
      try {
        const resp = await axios.get('https://api.github.com/repos/amromotaw3/MEEM-Landing/releases/latest', { timeout: 8000 }).catch(() => null);
        if (resp && resp.data && resp.data.tag_name) {
          const latestVersion = resp.data.tag_name.replace('v', '').trim();
          const currentVersion = require('../../package.json').version;
          if (isNewerVersion(latestVersion, currentVersion)) {
            win.webContents.send('update-status', { 
              status: 'available', 
              msg: `Update Available: v${latestVersion}`, 
              version: latestVersion,
              releaseNotes: resp.data.body || '',
              downloadUrl: resp.data.html_url 
            });
            return { success: true, fallback: true, latestVersion };
          } else {
            win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' });
            return { success: true, fallback: true, latestVersion };
          }
        }
      } catch (fallbackErr) {
        console.error('[UPDATER] Fallback GitHub check failed:', fallbackErr.message);
      }
      try { win.webContents.send('update-status', { status: 'error', msg: `Update check failed: ${err.message}` }); } catch (e) {}
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-update-download', async () => {
    try {
      console.log('[UPDATER] Starting download...');
      try { win.webContents.send('update-status', { status: 'downloading', percent: 0, msg: 'Starting download...' }); } catch (e) {}
      const res = await autoUpdater.downloadUpdate();
      return res;
    } catch (err) {
      console.error('[UPDATER] Download failed:', err.message);
      try { win.webContents.send('update-status', { status: 'error', msg: `Download failed: ${err.message}` }); } catch (e) {}
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('restart-app-and-install', () => {
    console.log('[UPDATER] Restart and install...');
    autoUpdater.quitAndInstall(false, true);
  });
}

module.exports = { initUpdater };
