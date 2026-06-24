// ─── preload.js ─── MediaVault v3.0 ──────────────────────────────────────────
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');
const { getSupabaseUrl, getSupabaseAnonKey, isConfigured } = require('../shared/supabaseEnv');

if (isConfigured()) {
  contextBridge.exposeInMainWorld('SUPABASE_URL', getSupabaseUrl());
  contextBridge.exposeInMainWorld('SUPABASE_ANON_KEY', getSupabaseAnonKey());
  contextBridge.exposeInMainWorld('MEDIAVAULT_SUPABASE_URL', getSupabaseUrl());
  contextBridge.exposeInMainWorld('MEDIAVAULT_SUPABASE_ANON_KEY', getSupabaseAnonKey());
  
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

  // Downloads
  startDownload: (opts) => ipcRenderer.invoke('start-download', opts),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  onDownloadProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-progress', h); return () => ipcRenderer.removeListener('download-progress', h); },
  onDownloadComplete: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-complete', h); return () => ipcRenderer.removeListener('download-complete', h); },
  onDownloadError: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-error', h); return () => ipcRenderer.removeListener('download-error', h); },
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

  // Manual metadata link
  saveManualLink: (opts) => ipcRenderer.invoke('save-manual-link', opts),

  // Native player (singleton window + media:// protocol)
  playMedia: (options) => ipcRenderer.invoke('play-media', options),
  openInVlc: (options) => ipcRenderer.invoke('open-in-vlc', options),
  playNative: (options) => ipcRenderer.invoke('play-media', options),
  playExternal: (url, meta) => ipcRenderer.invoke('play-media', typeof url === 'object' ? url : { url, ...meta }),
  downloadFile: (url, name) => ipcRenderer.invoke('download-file', url, name),

  // MPV Engine


  // Generic Invoke Fail-Safe
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
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
