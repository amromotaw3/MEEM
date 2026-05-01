const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

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
      return { success: true, result };
    } catch (err) {
      console.error('[UPDATER] Check failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-update-download', async () => {
    try {
      console.log('[UPDATER] Starting download...');
      return await autoUpdater.downloadUpdate();
    } catch (err) {
      console.error('[UPDATER] Download failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('restart-app-and-install', () => {
    console.log('[UPDATER] Restart and install...');
    autoUpdater.quitAndInstall(false, true);
  });
}

module.exports = { initUpdater };
