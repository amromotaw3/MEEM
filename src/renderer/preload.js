// ─── preload.js ─── MediaVault v3.0 ──────────────────────────────────────────
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');
const env = ipcRenderer.sendSync('get-supabase-env');

if (env && env.supabaseUrl && env.supabaseAnonKey) {
  contextBridge.exposeInMainWorld('SUPABASE_URL', env.supabaseUrl);
  contextBridge.exposeInMainWorld('SUPABASE_ANON_KEY', env.supabaseAnonKey);
  contextBridge.exposeInMainWorld('MEDIAVAULT_SUPABASE_URL', env.supabaseUrl);
  contextBridge.exposeInMainWorld('MEDIAVAULT_SUPABASE_ANON_KEY', env.supabaseAnonKey);
} else {
  console.warn('[PRELOAD] Supabase env not configured — cloud auth may fail');
}

// Validate that we're in a secure context
if (process.contextIsolated === false) {
  console.error('[SECURITY] Context isolation is disabled!');
}

contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  isMobile: () => false,
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  getZoom: () => webFrame.getZoomFactor(),
  minimizeWindow: () => ipcRenderer.send('win-minimize'),
  maximizeWindow: () => ipcRenderer.send('win-maximize'),
  closeWindow: () => ipcRenderer.send('win-close'),
  on: (channel, callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  off: (channel, callback) => ipcRenderer.removeListener(channel, callback),
  setFullScreen: (flag) => ipcRenderer.invoke('set-fullscreen', flag),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scanLibrary: (p) => ipcRenderer.invoke('scan-library', p),
  scanYoutube: (p) => ipcRenderer.invoke('scan-youtube', p),
  loadData: () => ipcRenderer.invoke('load-app-data'),
  saveData: (d) => ipcRenderer.invoke('save-app-data', d),
  cleanMissingDownloads: (h) => ipcRenderer.invoke('clean-missing-downloads', h),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  findSubtitles: (vp) => ipcRenderer.invoke('find-subtitles', vp),
  readSubtitleFile: (fp) => ipcRenderer.invoke('read-subtitle-file', fp),
  openSubtitleDialog: () => ipcRenderer.invoke('open-subtitle-dialog'),
  setCustomBanner: (id) => ipcRenderer.invoke('set-custom-banner', id),
  renameFile: (old, name) => ipcRenderer.invoke('rename-file', old, name),
  fetchUrlMetadata: (url) => ipcRenderer.invoke('fetch-url-metadata', url),
  searchOpenSubtitles: (vp, lang) => ipcRenderer.invoke('search-opensubtitles', vp, lang),
  searchSubtitlesById: (opts) => ipcRenderer.invoke('search-opensubtitles-by-id', opts),
  downloadSubtitle: (url, vp, lang) => ipcRenderer.invoke('download-subtitle', url, vp, lang),
  probeMedia: (vp) => ipcRenderer.invoke('probe-media', vp),

  searchAddons: (opts) => ipcRenderer.invoke('search-addons', opts),
  streamTorrent: (magnet, fileIdx) => ipcRenderer.invoke('stream-torrent', magnet, fileIdx),


  cinemetaDetails: (type, id) => ipcRenderer.invoke('cinemeta-details', { type, id }),
  cinemetaCatalog: (type, id) => ipcRenderer.invoke('cinemeta-catalog', { type, id }),
  cinemetaSearch: (query) => ipcRenderer.invoke('cinemeta-search', query),
  cinemetaDiscoverByGenre: (genre) => ipcRenderer.invoke('cinemeta-discover-by-genre', genre),
  tmdbDiscoverByGenre: (genreId) => ipcRenderer.invoke('tmdb-discover-by-genre', genreId),
  downloadImage: (url, id, force) => ipcRenderer.invoke('download-image', url, id, force),

  startDownload: (opts) => ipcRenderer.invoke('start-download', opts),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
  resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
  onDownloadProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-progress', h); return () => ipcRenderer.removeListener('download-progress', h); },
  onDownloadComplete: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-complete', h); return () => ipcRenderer.removeListener('download-complete', h); },
  onDownloadError: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-error', h); return () => ipcRenderer.removeListener('download-error', h); },
  onDownloadCancelled: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-cancelled', h); return () => ipcRenderer.removeListener('download-cancelled', h); },
  onTorrentProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('torrent-progress', h); return () => ipcRenderer.removeListener('torrent-progress', h); },
  onLibraryUpdated: (cb) => { const h = () => cb(); ipcRenderer.on('library-updated', h); return () => ipcRenderer.removeListener('library-updated', h); },
  onMetadataReady: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('metadata-ready', h); return () => ipcRenderer.removeListener('metadata-ready', h); },
  onResumeAvailable: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('resume-available', h); return () => ipcRenderer.removeListener('resume-available', h); },
  onStreamMetadataReady: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('stream-metadata-ready', h); return () => ipcRenderer.removeListener('stream-metadata-ready', h); },

  // Playback position persistence (lightweight — avoids full-data save)
  savePlaybackPosition: (profileId, key, entry, localOnly, forceImmediate) => ipcRenderer.invoke('save-playback-position', { profileId, key, entry, localOnly, forceImmediate }),
  getPlaybackPosition: (profileId, key) => ipcRenderer.invoke('get-playback-position', { profileId, key }),
  getProfilePlayback: (profileId) => ipcRenderer.invoke('get-profile-playback', profileId),
  clearProfilePlayback: (profileId) => ipcRenderer.invoke('clear-profile-playback', profileId),

  // Cloud Auth & Profile wrappers
  cloudLogin: (email, password) => ipcRenderer.invoke('cloud-login', { email, password }),
  cloudRegister: (email, password) => ipcRenderer.invoke('cloud-register', { email, password }),
  cloudCreateProfile: (profileData) => ipcRenderer.invoke('cloud-create-profile', profileData),
  cloudUpdateProfile: (profileData) => ipcRenderer.invoke('cloud-update-profile', profileData),
  cloudDeleteProfile: (id) => ipcRenderer.invoke('cloud-delete-profile', { id }),
  cloudVerifyProfilePin: (profile_id, pin) => ipcRenderer.invoke('cloud-verify-profile-pin', { profile_id, pin }),
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // Cloud Request wrappers
  cloudCreateRequest: (user_id, title) => ipcRenderer.invoke('cloud-create-request', { user_id, title }),
  cloudFetchRequests: (user_id) => ipcRenderer.invoke('cloud-fetch-requests', { user_id }),

  // Admin
  cloudAdminMutate: (admin_id, action, payload) => ipcRenderer.invoke('cloud-admin-mutate', { admin_id, action, payload }),


  // Fanart Key Management
  setFanartKey: (key) => ipcRenderer.invoke('set-fanart-key', key),
  getFanartKeyMasked: () => ipcRenderer.invoke('get-fanart-key-masked'),
  verifyFanartKey: (key) => ipcRenderer.invoke('verify-fanart-key', key),
  fanartGetImages: (imdbId, type) => ipcRenderer.invoke('fanart-get-images', { imdbId, type }),

  // MyAnimeList (Jikan API)
  malSearch: (q) => ipcRenderer.invoke('mal-search', q),
  malDetails: (id) => ipcRenderer.invoke('mal-details', id),
  malTopRated: () => ipcRenderer.invoke('mal-top-rated'),
  malTopUpcoming: () => ipcRenderer.invoke('mal-top-upcoming'),
  malSeasonal: (season, year) => ipcRenderer.invoke('mal-seasonal', season, year),

  // Kitsu (Anime)
  kitsuSearch: (q) => ipcRenderer.invoke('kitsu-search', q),
  kitsuTrending: () => ipcRenderer.invoke('kitsu-trending'),
  jikanTrending: () => ipcRenderer.invoke('jikan-trending'),
  unifiedSearch: (query) => ipcRenderer.invoke('unified-search', query),
  searchRadio: (opts) => ipcRenderer.invoke('radio-search', opts),

  // Manual metadata link
  saveManualLink: (opts) => ipcRenderer.invoke('save-manual-link', opts),

  // Native player (singleton window + media:// protocol)
  playMedia: (options) => ipcRenderer.invoke('play-media', options),
  openInVlc: (options) => ipcRenderer.invoke('open-in-vlc', options),
  playNative: (options) => ipcRenderer.invoke('play-media', options),
  playExternal: (url, meta) => ipcRenderer.invoke('play-media', typeof url === 'object' ? url : { url, ...meta }),
  downloadFile: (url, name) => ipcRenderer.invoke('download-file', url, name),

  // MPV Engine


  // Generic Invoke — whitelist-gated to prevent XSS from calling arbitrary IPC channels
  invoke: (() => {
    const ALLOWED = new Set([
      // Storage & Session
      'load-app-data', 'save-app-data', 'get-hardware-id', 'clear-cache',
      'save-playback-position', 'get-playback-position', 'get-profile-playback',
      'clear-profile-playback', 'cloud-delete-playback-position',
      'clean-missing-downloads', 'clear-session',

      // Cloud Authentication & Profiles
      'cloud-login', 'cloud-register', 'cloud-discord-login',
      'cloud-create-profile', 'cloud-update-profile', 'cloud-delete-profile',
      'cloud-verify-profile-pin', 'cloud-sync-user-session', 'cloud-oauth',
      'cloud-update-profile-avatar-color',

      // Cloud Catalog, Requests & Social Presence
      'cloud-fetch-catalog', 'cloud-fetch-requests', 'cloud-create-request',
      'cloud-update-request', 'cloud-admin-mutate', 'cloud-search-collaborators',
      'cloud-get-user-id-by-username', 'cloud-invite-collaborator',
      'cloud-refresh-custom-lists', 'cloud-delete-custom-list', 'cloud-remove-list-item',
      'cloud-get-pending-invitations', 'cloud-accept-invitation', 'cloud-decline-invitation',
      'cloud-delete-chat-message', 'cloud-kick-list-member', 'cloud-transfer-list-ownership',
      'cloud-get-list-sharing-members', 'cloud-get-allow-invitations',
      'cloud-set-allow-invitations', 'cloud-load-chat-history', 'cloud-send-chat-message',
      'cloud-open-chat-window', 'cloud-send-media-share', 'cloud-upload-chat-image',
      'cloud-realtime-send', 'cloud-realtime-fetch', 'cloud-fetch-addons',
      'cloud-save-addon', 'cloud-delete-addon',

      // File & Profile Folder Management
      'select-folder', 'select-download-folder', 'select-files',
      'delete-file', 'move-file', 'create-folder', 'rename-file', 'dir-exists',
      'get-profile-media-paths', 'ensure-profile-folders', 'rename-profile-folders',
      'delete-profile-data', 'select-user-avatar', 'select-user-banner',
      'get-default-library-root',

      // Library Scanning & Subtitles
      'scan-library', 'scan-youtube', 'scan-music',
      'find-subtitles', 'read-subtitle-file', 'open-subtitle-dialog',
      'list-profile-subtitles', 'create-subtitle-folder', 'save-subtitle-local',
      'delete-subtitle-local', 'rename-subtitle-local', 'move-subtitle-local',
      'get-managed-subtitles', 'search-opensubtitles', 'search-opensubtitles-by-id',
      'download-subtitle', 'download-remote-subtitle', 'fetch-addon-subtitles',
      'get-subdl-key', 'set-subdl-key', 'get-subdl-key-masked', 'verify-subdl-key',
      'subdl-verify-key',

      // Metadata, Catalogs & Search
      'set-custom-banner', 'fetch-url-metadata', 'fetch-url-text', 'fetch-proxy',
      'fetch-icon', 'is-media-link', 'save-frame', 'probe-media', 'download-image', 'get-media-images',
      'cinemeta-search', 'cinemeta-details', 'cinemeta-catalog', 'cinemeta-discover-by-genre',
      'tmdb-discover-by-genre', 'tmdb-season-details', 'tmdb-verify-key',
      'get-metadata-provider', 'set-metadata-provider',
      'set-fanart-key', 'get-fanart-key-masked', 'verify-fanart-key', 'fanart-get-images', 'fanart-images',
      'mal-search', 'map-mal-id', 'mal-details', 'mal-recommendations', 'mal-top-rated',
      'mal-top-upcoming', 'mal-seasonal', 'jikan-trending', 'jikan-episodes', 'jikan-details',
      'kitsu-search', 'kitsu-details', 'kitsu-details-by-mal', 'kitsu-trending',
      'anilist-search', 'anilist-media-detailed', 'anilist-media-assets',
      'unified-search', 'save-manual-link', 'get-anime-media-internal', 'get-western-media-internal',
      'radio-search', 'iptv-parse-m3u-text', 'stremio-addon-list', 'search-addons',

      // Trakt Integration
      'trakt-get-auth-code', 'trakt-check-auth-status', 'trakt-disconnect',
      'trakt-connection-status', 'trakt-sync-watchlist', 'trakt-toggle-watchlist',
      'trakt-scrobble-event', 'trakt-search', 'trakt-playback-progress',

      // Streaming & Media Playback
      'stream-torrent', 'start-torrent-stream', 'stop-torrent-stream', 'play-media', 'open-in-external-player',
      'open-in-meem-player', 'get-meem-player-status',
      'open-in-vlc', 'play-external', 'play-native', 'start-local-server', 'get-vlc-status',
      'resolve-trailer-stream',

      // YouTube
      'youtube-search', 'youtube-get-trending', 'youtube-get-home', 'youtube-get-video-info',
      'youtube-get-captions', 'youtube-download-media',
      'youtube-get-account', 'youtube-sign-in', 'youtube-sign-out', 'youtube-auth-start',
      'youtube-auth-status', 'youtube-get-subscriptions', 'youtube-get-history',
      'youtube-add-history', 'youtube-clear-history', 'youtube-like', 'youtube-dislike',
      'youtube-subscribe', 'youtube-unsubscribe', 'youtube-get-comments',

      // Addons & Downloads
      'uninstall-addon', 'stremio-remove-addon', 'remove-stremio-addon',
      'start-download', 'cancel-download', 'pause-download', 'resume-download', 'download-file',

      // Utility & Window Controls
      'check-network-status', 'get-app-version', 'open-external', 'set-fullscreen', 'is-fullscreen', 'open-devtools',
      'check-for-updates', 'download-update', 'install-update'
    ]);

    return (channel, ...args) => {
      if (!ALLOWED.has(channel)) {
        console.error(`[PRELOAD] Blocked invoke on unlisted channel: "${channel}"`);
        return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
      }
      return ipcRenderer.invoke(channel, ...args);
    };
  })(),
  send: (() => {
    const ALLOWED_SEND = new Set([
      'win-minimize', 'win-maximize', 'win-close', 'log-bridge',
      'discord-activity', 'update-tray-status', 'downloads-control', 'player-control'
    ]);
    return (channel, ...args) => {
      if (!ALLOWED_SEND.has(channel)) {
        console.error(`[PRELOAD] Blocked send on unlisted channel: "${channel}"`);
        return;
      }
      ipcRenderer.send(channel, ...args);
    };
  })(),
  cloudOAuthLogin: (url) => ipcRenderer.invoke('cloud-oauth', url),
  onDeepLink: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('handle-deep-link', h);
    return () => ipcRenderer.removeListener('handle-deep-link', h);
  },

  // LOG BRIDGE
  logToServer: (level, msg) => ipcRenderer.send('log-bridge', { level, msg }),
  // DISCORD
  updateDiscordActivity: (data) => ipcRenderer.send('discord-activity', data),

  // UTILS
  getFilePath: (file) => webUtils.getPathForFile(file)
});
