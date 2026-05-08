// ─── preload.js ─── MediaVault v3.0 ──────────────────────────────────────────
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

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


  // TMDB
  tmdbSearch: (t, q) => ipcRenderer.invoke('tmdb-search', t, q),
  tmdbDetails: (t, id) => ipcRenderer.invoke('tmdb-details', t, id),
  tmdbTrending: () => ipcRenderer.invoke('tmdb-trending'),
  tmdbPopular: (t) => ipcRenderer.invoke('tmdb-popular', t),
  tmdbTopRated: (t) => ipcRenderer.invoke('tmdb-top-rated', t),
  tmdbUpcoming: () => ipcRenderer.invoke('tmdb-upcoming'),
  tmdbAnimeFeatured: () => ipcRenderer.invoke('tmdb-anime-featured'),
  tmdbCredits: (t, id) => ipcRenderer.invoke('tmdb-credits', t, id),
  tmdbVideos: (t, id) => ipcRenderer.invoke('tmdb-videos', t, id),
  tmdbProviders: (t, id) => ipcRenderer.invoke('tmdb-providers', t, id),
  tmdbSearchDiscover: (q) => ipcRenderer.invoke('tmdb-search-discover', q),
  tmdbSeasonDetails: (tvId, s) => ipcRenderer.invoke('tmdb-season-details', tvId, s),
  tmdbDiscoverByGenre: (id) => ipcRenderer.invoke('tmdb-discover-by-genre', id),
  downloadImage: (url, id) => ipcRenderer.invoke('download-image', url, id),

  // Downloads
  startDownload: (opts) => ipcRenderer.invoke('start-download', opts),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  onDownloadProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-progress', h); return () => ipcRenderer.removeListener('download-progress', h); },
  onDownloadComplete: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-complete', h); return () => ipcRenderer.removeListener('download-complete', h); },
  onDownloadError: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('download-error', h); return () => ipcRenderer.removeListener('download-error', h); },
  onTorrentProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('torrent-progress', h); return () => ipcRenderer.removeListener('torrent-progress', h); },
  onLibraryUpdated: (cb) => { const h = () => cb(); ipcRenderer.on('library-updated', h); return () => ipcRenderer.removeListener('library-updated', h); },
  onMetadataReady: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('metadata-ready', h); return () => ipcRenderer.removeListener('metadata-ready', h); },


  // TMDB Key Management
  setTmdbKey: (key) => ipcRenderer.invoke('set-tmdb-key', key),
  getTmdbKeyMasked: () => ipcRenderer.invoke('get-tmdb-key-masked'),
  verifyTmdbKey: (key) => ipcRenderer.invoke('verify-tmdb-key', key),

  // MyAnimeList (Jikan API)
  malSearch: (q) => ipcRenderer.invoke('mal-search', q),
  malDetails: (id) => ipcRenderer.invoke('mal-details', id),
  malTopRated: () => ipcRenderer.invoke('mal-top-rated'),
  malTopUpcoming: () => ipcRenderer.invoke('mal-top-upcoming'),
  malSeasonal: (season, year) => ipcRenderer.invoke('mal-seasonal', season, year),

  // Kitsu (Anime)
  kitsuSearch: (q) => ipcRenderer.invoke('kitsu-search', q),
  kitsuTrending: () => ipcRenderer.invoke('kitsu-trending'),

  // Generic Invoke Fail-Safe
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),

  // LOG BRIDGE
  logToServer: (level, msg) => ipcRenderer.send('log-bridge', { level, msg }),

  // DISCORD
  updateDiscordActivity: (data) => ipcRenderer.send('discord-activity', data),

  // UTILS
  getFilePath: (file) => webUtils.getPathForFile(file)
});
