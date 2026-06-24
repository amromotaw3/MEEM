const { dialog } = require('electron');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { loadData, saveData, getInMemorySession } = require('../store');
const { getMainWindow } = require('../windowManager');

let currentSubdlKey = null;

function initSubtitleIpc(ipcMain) {
  // Initialize currentSubdlKey from stored session
  const session = getInMemorySession();
  if (session.subdlKey) {
    currentSubdlKey = session.subdlKey;
  }

  ipcMain.handle('open-subtitle-dialog', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      title: 'Select Subtitle',
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }]
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('get-subdl-key', () => currentSubdlKey);

  ipcMain.handle('set-subdl-key', async (_e, key) => {
    if (key && key.trim().length > 0) {
      currentSubdlKey = key.trim();
      const store = await loadData();
      store.subdlKey = currentSubdlKey;
      if (!store.subdlConfig) store.subdlConfig = {};
      store.subdlConfig.apiKey = currentSubdlKey;
      await saveData(store);
      return true;
    }
    return false;
  });

  ipcMain.handle('get-subdl-key-masked', () => {
    if (!currentSubdlKey) return '';
    if (currentSubdlKey.length <= 4) return '••••••••••••';
    return currentSubdlKey.substring(0, 2) + '••••••••••' + currentSubdlKey.substring(currentSubdlKey.length - 2);
  });

  ipcMain.handle('verify-subdl-key', async (_e, key) => {
    try {
      const testUrl = `https://api.subdl.com/api/v1/subtitles?api_key=${key}&type=movie&tmdb_id=550`;
      const response = await axios.get(testUrl, { timeout: 5000 });
      return response.status === 200;
    } catch (err) {
      return false;
    }
  });

  ipcMain.handle('fetch-zip-subtitle', async (_e, url) => {
    try {
      console.log('[Subtitle ZIP] Downloading:', url);
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://subdl.com/'
        }
      });
      const zipBuffer = Buffer.from(response.data);
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      // Find the first file that matches srt, vtt, ass, ssa extensions
      const subEntry = zipEntries.find(entry => {
        const name = entry.entryName.toLowerCase();
        return !entry.isDirectory && (name.endsWith('.srt') || name.endsWith('.vtt') || name.endsWith('.ass') || name.endsWith('.ssa'));
      });

      if (!subEntry) {
        console.warn('[Subtitle ZIP] No subtitle file found in ZIP archive.');
        return null;
      }

      console.log('[Subtitle ZIP] Extracted entry:', subEntry.entryName);
      const contentBase64 = subEntry.getData().toString('base64');
      return {
        content: contentBase64,
        filename: subEntry.name,
        isBase64: true
      };
    } catch (err) {
      console.error('[Subtitle ZIP] Extraction failed:', err.message);
      return null;
    }
  });
}

module.exports = { initSubtitleIpc };
