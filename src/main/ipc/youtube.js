const YouTubeService = require('../youtube/YouTubeService');

/**
 * MediaVault v2 - YouTube & YouTube Music IPC Handlers
 */
function initYoutubeIpc(ipcMain) {
  // Feed Handlers
  ipcMain.handle('youtube-get-trending', async (event, category) => {
    return YouTubeService.getTrending(category);
  });

  ipcMain.handle('youtube-get-home', async () => {
    return YouTubeService.getHomeFeed();
  });

  // Search Handlers
  ipcMain.handle('youtube-search', async (event, { query, filter }) => {
    return YouTubeService.search(query, filter);
  });

  // Video Info & Streaming URL Handlers
  ipcMain.handle('youtube-get-video-info', async (event, args) => {
    const videoId = typeof args === 'string' ? args : (args?.videoId || args?.id);
    const quality = typeof args === 'object' ? (args?.quality || 'best') : 'best';
    return YouTubeService.getVideoDetails(videoId, quality);
  });

  // Captions / Subtitles
  ipcMain.handle('youtube-get-captions', async (event, { videoId, lang }) => {
    return YouTubeService.getTranscriptOrSubtitle(videoId, lang);
  });

  // Account Auth & OAuth2 TV Login Handlers
  ipcMain.handle('youtube-get-account', async () => {
    return YouTubeService.getAccountInfo();
  });

  ipcMain.handle('youtube-auth-start', async (event) => {
    const webContents = event.sender;
    return YouTubeService.startOAuthFlow((pendingData) => {
      try {
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('youtube-auth-pending', pendingData);
        }
      } catch (e) {}
    });
  });

  ipcMain.handle('youtube-auth-status', async () => {
    return YouTubeService.getOAuthPendingStatus();
  });

  ipcMain.handle('youtube-sign-out', async () => {
    return YouTubeService.signOutGoogle();
  });

  // Watch History & Subscriptions Handlers
  ipcMain.handle('youtube-get-history', async () => {
    return YouTubeService.getYouTubeHistory();
  });

  ipcMain.handle('youtube-get-subscriptions', async () => {
    return YouTubeService.getSubscriptionsFeed();
  });

  ipcMain.handle('youtube-add-history', async (event, item) => {
    return YouTubeService.addToWatchHistory(item);
  });

  ipcMain.handle('youtube-clear-history', async () => {
    return YouTubeService.clearWatchHistory();
  });

  // Video & Channel Interactions
  ipcMain.handle('youtube-like', async (event, videoId) => {
    return YouTubeService.likeVideo(videoId);
  });

  ipcMain.handle('youtube-dislike', async (event, videoId) => {
    return YouTubeService.dislikeVideo(videoId);
  });

  ipcMain.handle('youtube-subscribe', async (event, channelId) => {
    return YouTubeService.subscribeChannel(channelId);
  });

  ipcMain.handle('youtube-unsubscribe', async (event, channelId) => {
    return YouTubeService.unsubscribeChannel(channelId);
  });

  // Comments
  ipcMain.handle('youtube-get-comments', async (event, videoId) => {
    return YouTubeService.getComments(videoId);
  });

  // Download Media with Progress Broadcasting
  ipcMain.handle('youtube-download-media', async (event, { videoId, mode, title, targetDir }) => {
    const webContents = event.sender;
    return YouTubeService.downloadMedia({
      videoId,
      mode,
      title,
      targetDir,
      onProgress: (progressData) => {
        try {
          if (webContents && !webContents.isDestroyed()) {
            webContents.send('youtube-download-progress', progressData);
          }
        } catch (e) {}
      }
    });
  });

  console.log('[YouTube IPC] Handlers registered successfully.');
}

module.exports = { initYoutubeIpc };
