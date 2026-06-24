const { dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { BANNERS_DIR, ensureDir } = require('../store');
const { getMainWindow } = require('../windowManager');

function initProfileConfigIpc(ipcMain) {
  ipcMain.handle('get-profile-media-paths', (_e, profileName) => {
    if (!profileName) return null;
    const p = (sub) => path.join(app.getPath('videos'), 'MediaVault', profileName, sub);
    return { movies: p('Movies'), series: p('Series'), social: p('Social'), music: p('Music') };
  });

  ipcMain.handle('ensure-profile-folders', (_e, profileName) => {
    if (!profileName) return false;
    try {
      const basePath = path.join(app.getPath('videos'), 'MediaVault', profileName);
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
    if (!oldName || !newName || oldName === newName) return false;
    const oldPath = path.join(app.getPath('videos'), 'MediaVault', oldName);
    const newPath = path.join(app.getPath('videos'), 'MediaVault', newName);
    try {
      if (fs.existsSync(oldPath)) {
        if (fs.existsSync(newPath)) return false;
        fs.renameSync(oldPath, newPath);
        return true;
      } else {
        const subDirs = ['Movies', 'Series', 'Social', 'Music'];
        subDirs.forEach(sub => {
          const fullPath = path.join(newPath, sub);
          if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
        });
        return true;
      }
    } catch (err) {
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
