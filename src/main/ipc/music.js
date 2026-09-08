const YouTubeMusicService = require('../youtube/YouTubeMusicService');

/**
 * YouTube Music IPC Handlers
 */
function initMusicIpc(ipcMain) {
  ipcMain.handle('music-search', async (event, query) => {
    return YouTubeMusicService.search(query);
  });

  ipcMain.handle('music-get-trending', async (event, genre) => {
    return YouTubeMusicService.getTrending(genre);
  });

  ipcMain.handle('music-get-stream-url', async (event, videoId) => {
    return YouTubeMusicService.getAudioStreamUrl(videoId);
  });

  ipcMain.handle('music-download-track', async (event, { track, customFolder }) => {
    return YouTubeMusicService.downloadTrack(track, customFolder);
  });

  ipcMain.handle('music-get-lyrics', async (event, { title, artist, duration, videoId }) => {
    return YouTubeMusicService.getLyrics(title, artist, duration, videoId);
  });
}

module.exports = { initMusicIpc };
