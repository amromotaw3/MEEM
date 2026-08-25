const { dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { getMainWindow } = require('../windowManager');

function initFileManageIpc(ipcMain) {
  ipcMain.handle('delete-file', async (_e, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        await shell.trashItem(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('select-files', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'm4v'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('move-file', async (_e, { src, dest }) => {
    try {
      if (!fs.existsSync(src)) return { success: false, error: 'Source missing' };
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(src, dest);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('create-folder', async (_e, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('rename-file', (_e, oldPath, newName) => {
    try {
      const newPath = path.join(path.dirname(oldPath), newName);
      fs.renameSync(oldPath, newPath);
      return { success: true, newPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-profile-data', async (_e, profileName) => {
    if (!profileName) return false;
    try {
      const videosPath = app.getPath('videos');
      const profilePath = path.join(videosPath, 'MEEM', profileName);
      if (fs.existsSync(profilePath)) {
        fs.rmSync(profilePath, { recursive: true, force: true });
      }
      return true;
    } catch (err) {
      console.error('[IPC] delete-profile-data error:', err);
      return false;
    }
  });
}

module.exports = { initFileManageIpc };
