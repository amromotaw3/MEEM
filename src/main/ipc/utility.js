const { dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { BANNERS_DIR, ensureDir } = require('../store');
const { getMainWindow } = require('../windowManager');

function initUtilityIpc(ipcMain) {
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('open-external', async (_event, url) => {
    try {
      if (url) {
        await shell.openExternal(url);
        return true;
      }
    } catch (err) {
      console.error('[Utility IPC] Failed to open external URL:', url, err);
    }
    return false;
  });

  ipcMain.handle('clear-cache', () => {
    try {
      if (fs.existsSync(BANNERS_DIR)) {
        for (const file of fs.readdirSync(BANNERS_DIR)) {
          fs.unlinkSync(path.join(BANNERS_DIR, file));
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('select-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('select-download-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
      title: 'Select Download Location'
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('get-default-library-root', () => {
    return path.join(app.getPath('videos'), 'MediaVault');
  });

  if (!ipcMain.eventNames().includes('fetch-proxy')) {
    ipcMain.handle('fetch-proxy', async (_e, url) => {
      try {
        const resp = await axios.get(url, { timeout: 10000 });
        return resp.data;
      } catch (err) {
        console.error('[PROXY] Error fetching:', url, err.message);
        return { error: err.message, status: err.response?.status };
      }
    });
  }

  if (!ipcMain.eventNames().includes('fetch-icon')) {
    ipcMain.handle('fetch-icon', async (_e, faviconUrl) => {
      try {
        const response = await fetch(faviconUrl);
        if (!response.ok) throw new Error('Failed to fetch icon');
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const mime = response.headers.get('content-type') || 'image/x-icon';
        return `data:${mime};base64,${base64}`;
      } catch (err) {
        console.error('Icon fetch error:', err);
        return null;
      }
    });
  }

  if (!ipcMain.eventNames().includes('is-media-link')) {
    ipcMain.handle('is-media-link', (_e, url) => {
      const mediaExts = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.wav', '.flac', '.srt', '.vtt'];
      try {
        const ext = path.extname(new URL(url).pathname).toLowerCase();
        return mediaExts.includes(ext);
      } catch (e) {
        return false;
      }
    });
  }

  if (!ipcMain.eventNames().includes('save-frame')) {
    ipcMain.handle('save-frame', async (_e, { id, data }) => {
      try {
        ensureDir(BANNERS_DIR);
        const safe = Buffer.from(id).toString('base64').replace(/[/+=]/g, '_');
        const dest = path.join(BANNERS_DIR, safe + '.jpg');
        const base64Data = data.replace(/^data:image\/jpeg;base64,/, "");
        fs.writeFileSync(dest, base64Data, 'base64');
        return { path: dest };
      } catch (err) {
        return { error: err.message };
      }
    });
  }
}

module.exports = { initUtilityIpc };
