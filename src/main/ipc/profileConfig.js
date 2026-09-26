const { dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { BANNERS_DIR, ensureDir } = require('../store');
const { getMainWindow } = require('../windowManager');

function getMeemVideosRoot() {
  const videosDir = app.getPath('videos');
  const meemDir = path.join(videosDir, 'MEEM');
  const legacyDir = path.join(videosDir, 'MediaVault');
  
  // Auto-migrate legacy folder if MEEM doesn't exist
  if (!fs.existsSync(meemDir) && fs.existsSync(legacyDir)) {
    try {
      fs.renameSync(legacyDir, meemDir);
      console.log('[MIGRATION] Migrated Videos/MediaVault to Videos/MEEM');
    } catch (e) {
      console.warn('[MIGRATION] Could not rename legacy folder:', e.message);
    }
  }
  return meemDir;
}

function initProfileConfigIpc(ipcMain) {
  ipcMain.handle('get-profile-media-paths', (_e, profileName) => {
    if (!profileName) return null;
    const root = getMeemVideosRoot();
    const p = (sub) => path.join(root, profileName, sub);
    return { movies: p('Movies'), series: p('Series'), social: p('Social'), music: p('Music') };
  });

  ipcMain.handle('ensure-profile-folders', (_e, profileName) => {
    if (!profileName) return false;
    try {
      const root = getMeemVideosRoot();
      const basePath = path.join(root, profileName);
      const subDirs = ['Movies', 'Series', 'Social', 'Music'];
      subDirs.forEach(sub => {
        const fullPath = path.join(basePath, sub);
        if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
      });
      return true;
    } catch (err) {
      console.error('[IPC] ensure-profile-folders error:', err);
      return false;
    }
  });

  ipcMain.handle('rename-profile-folders', async (_e, oldName, newName) => {
    const cleanOld = String(oldName || '').trim();
    const cleanNew = String(newName || '').trim();
    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return false;
    
    const root = getMeemVideosRoot();
    const oldPath = path.join(root, cleanOld);
    const newPath = path.join(root, cleanNew);
    const subDirs = ['Movies', 'Series', 'Social', 'Music'];

    try {
      if (!fs.existsSync(oldPath)) {
        // If old folder didn't exist, simply create the new one
        subDirs.forEach(sub => {
          const fullPath = path.join(newPath, sub);
          if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
        });
        return true;
      }

      // Windows case-sensitivity handling (e.g. "Ahmed" -> "ahmed")
      const isCaseOnlyChange = oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath;
      if (isCaseOnlyChange) {
        const tempPath = path.join(root, `${cleanOld}__temp_${Date.now()}`);
        fs.renameSync(oldPath, tempPath);
        fs.renameSync(tempPath, newPath);
      } else {
        // Direct instant rename in file manager
        fs.renameSync(oldPath, newPath);
      }

      // Ensure standard subdirectories exist inside the renamed folder
      subDirs.forEach(sub => {
        const fullPath = path.join(newPath, sub);
        if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
      });

      return true;
    } catch (err) {
      console.error('[IPC] rename-profile-folders direct rename error:', err.message);
      // Fallback in case of Windows file lock: ensure new folder exists
      try {
        subDirs.forEach(sub => {
          const fullPath = path.join(newPath, sub);
          if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
        });
      } catch (e) {}
      return false;
    }
  });

  ipcMain.handle('select-user-avatar', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      title: 'Select Avatar Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR);
    const src = r.filePaths[0];
    const ext = path.extname(src);
    const dest = path.join(BANNERS_DIR, `avatar_${Date.now()}${ext}`);
    fs.copyFileSync(src, dest);
    try {
      // Also return a data URL to avoid renderer fetch issues for local files
      const buf = fs.readFileSync(dest);
      const mime = (ext.toLowerCase() === '.png') ? 'image/png' : (ext.toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg');
      const dataUrl = `data:${mime};base64,` + buf.toString('base64');
      return dataUrl;
    } catch (e) {
      return dest;
    }
  });

  ipcMain.handle('select-user-banner', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      title: 'Select Banner Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR);
    const src = r.filePaths[0];
    const ext = path.extname(src);
    const dest = path.join(BANNERS_DIR, `banner_${Date.now()}${ext}`);
    fs.copyFileSync(src, dest);
    return dest;
  });
}

module.exports = { initProfileConfigIpc };
