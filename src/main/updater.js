const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

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
    win.webContents.send('update-status', { status: 'checking', msg: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[UPDATER] Update available:', info.version);
    win.webContents.send('update-status', { 
      status: 'available', 
      msg: `Update Available: v${info.version}`,
      version: info.version
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[UPDATER] No update available.');
    win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' });
  });

  autoUpdater.on('error', (err) => {
    console.error('[UPDATER] Error:', err.message);
    win.webContents.send('update-status', { status: 'error', msg: `Update Error: ${err.message}` });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    win.webContents.send('update-status', { 
      status: 'downloading', 
      percent: progressObj.percent.toFixed(1),
      speed: (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2),
      msg: `Downloading: ${progressObj.percent.toFixed(1)}%`
    });
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[UPDATER] Update downloaded.');
    win.webContents.send('update-status', { 
      status: 'ready', 
      msg: 'Update Downloaded. Restart to apply.' 
    });
  });

  // IPC Listeners for Renderer
  ipcMain.handle('check-for-updates', async () => {
    try {
      console.log('[UPDATER] Manual check requested');
      // Add a safety timeout for the update check to prevent UI hanging
      const checkPromise = autoUpdater.checkForUpdates();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Update check timed out after 15s')), 15000)
      );
      const result = await Promise.race([checkPromise, timeoutPromise]);

      // If the updater did not emit events (packaged vs dev), send an explicit status
      if (result && result.updateInfo && result.updateInfo.version) {
        const latestVersion = result.updateInfo.version;
        const currentVersion = autoUpdater.currentVersion.version;
        
        console.log(`[UPDATER] Version check: Current=${currentVersion}, Latest=${latestVersion}`);
        
        if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
          // New version available
          win.webContents.send('update-status', { 
            status: 'available', 
            msg: `Update Available: v${latestVersion}`, 
            version: latestVersion, 
            downloadUrl: result.updateInfo.files && result.updateInfo.files[0] && result.updateInfo.files[0].url 
          });
        } else {
          // Already on latest or dev mode
          win.webContents.send('update-status', { status: 'none', msg: 'App is up to date.' });
        }
      }

      return { success: true, result };
    } catch (err) {
      console.error('[UPDATER] Check failed:', err.message);
      // Fallback to GitHub API check for PC if autoUpdater fails (e.g. in dev mode)
      try {
        const axios = require('axios');
        const resp = await axios.get('https://api.github.com/repos/amromotaw3/MEEM/releases/latest', { timeout: 8000 }).catch(() => null);
        if (resp && resp.data && resp.data.tag_name) {
          const latestVersion = resp.data.tag_name.replace('v', '').trim();
          const currentVersion = require('../../package.json').version;
          if (isNewerVersion(latestVersion, currentVersion)) {
            win.webContents.send('update-status', { 
              status: 'available', 
              msg: `Update Available: v${latestVersion}`, 
              version: latestVersion, 
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
      // Notify renderer of failure so UI can present manual fallback
      try { win.webContents.send('update-status', { status: 'error', msg: `Update check failed: ${err.message}` }); } catch (e) {}
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-update-download', async () => {
    try {
      console.log('[UPDATER] Starting download...');
      // Notify renderer that download is starting (immediate feedback)
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
