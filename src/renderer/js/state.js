// Renderer console log interceptor
(function() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  function safeLogBridge(level, ...args) {
    try {
      const msg = args.map(arg => {
        if (arg instanceof Error) return arg.message + '\n' + arg.stack;
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      }).join(' ');
      if (window.api && typeof window.api.logToServer === 'function') {
        window.api.logToServer(level, msg);
      }
    } catch (e) {}
  }

  console.log = function(...args) {
    originalLog.apply(console, args);
    safeLogBridge('info', ...args);
  };
  console.error = function(...args) {
    originalError.apply(console, args);
    safeLogBridge('error', ...args);
  };
  console.warn = function(...args) {
    originalWarn.apply(console, args);
    safeLogBridge('warn', ...args);
  };

  window.addEventListener('error', (event) => {
    safeLogBridge('error', 'Uncaught window error: ' + event.message + ' at ' + event.filename + ':' + event.lineno);
  });
  window.addEventListener('unhandledrejection', (event) => {
    safeLogBridge('error', 'Unhandled rejection: ' + event.reason);
  });
})();

// State declarations for MediaVault
var appData = {
  libraryFolders: [], libraryPath: '', movies: [], shows: [], music: [],
  thumbnails: {}, banners: {}, pinned: [], lastView: 'movies',
  tmdbCache: {}, downloadHistory: [], theme: 'minimalist', downloadPath: '',
  notifications: [],
  enableVideoTrailers: true,
  youtubeFolder: '', youtubeVideos: [], socialVideos: [], uiState: { collapsedGroups: [] },
  tmdbKey: null, searchHistory: [],
  installedAddons: [],
  profiles: [], // { id, name, avatar, playback: {}, watchlist: [], pinned: [], vaultPin: null, lockedItems: [] }
  activeProfileId: null,
  musicMetadata: {}, // { itemId: { title, artist, album, cover } }
  eqGains: [0, 0, 0, 0, 0],
  eqPreset: 'flat',
  autoUpdate: true,
  firstRun: true,
  activeDownloads: new Map(),
  remoteStreamingServer: '192.168.31.125', // Default PC IP for mobile streaming
  mobileInternalPlayer: true,
  autoChooseBestStream: false,
  autoChooseMaxRes: '1080p',
  authenticated: false,
  user: null,
  subscription_expires_at: null
};

var currentProfile = null;
var isEditingProfiles = false;
var isTransitioningAway = false;
window.isEditingProfiles = isEditingProfiles;
window.isTransitioningAway = isTransitioningAway;

var currentView = 'movies';
var prevView = 'discover';
var discoverStack = [];
var currentDiscoverItem = null;
var playerSourceView = null;
var currentShowId = null;
var currentShow = null;
var currentEpisodes = [];
var currentEpisodeIndex = -1;
var suppressStopOnViewChange = false;
var isDiscoverLoading = false;
var contextTarget = null;
var isFullscreen = false;
var autoNextTimer = null;
var panelOpen = false;
var currentItem = null;
var currentMediaMetadata = null;
var isVaultUnlocked = false;
var isSeeking = false;
var isPlayingMusic = false;
var saveInterval = null;
var ctrlTimeout = null;
var subtitleTrack = null;
var subtitlesEnabled = false;
var currentPart = null;
var subtitlesAreRTL = false;
var editingProfileId = null;
var currentAudioTrackIndex = -1;
var currentInternalSubIndex = -1;
var analyser = null;
var dataArray = null;
var visualizerAnim = null;
var currentStreamUrl = null;

var currentDlType = 'downloads';
var customDlPath = null;
var activeDownloads = new Map();

var isSearchTmdbEnabled = true;
var isSearchKitsuEnabled = false;
var isSearchJikanEnabled = false;

var subCurrentDir = '';
var playerSubCurrentDir = '';

var GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

var $ = s => document.querySelector(s);
var $$ = s => Array.from(document.querySelectorAll(s));

var AVATARS = [
  'imgs/avatars/default.png'
];

var DEFAULT_AVATAR_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="%23333"><circle cx="12" cy="12" r="10" fill="%23222"/><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%23666"/></svg>';

var selectedAvatar = AVATARS[0];
var selectedBanner = null;

// Global Helper Functions
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function normalizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.map((p) => ({
    id: p.id,
    name: (p.name || p.profile_name || 'Profile').trim(),
    avatar: p.avatar || p.avatar_url || AVATARS[0],
    banner: p.banner || p.banner_url || null,
    playback: p.playback || {},
    watchlist: p.watchlist || [],
    pinned: p.pinned || [],
    vaultPin: p.pin || p.vaultPin || null,
    lockedItems: p.locked_items || p.lockedItems || [],
    custom_lists: p.custom_lists || p.customLists || []
  }));
}

function ensureDefaultAddons() {
  // MediaVault is a neutral media player. No addons are pre-installed by default.
  // Content-discovery features (Cinemeta, Torrentio, TMDB, Trakt) are opt-in Mods
  // that users install manually. This ensures the app has zero default
  // content-discovery footprint and the user bears full responsibility for any
  // addons they choose to install.
  if (!appData.installedAddons) appData.installedAddons = [];
}

// Global scope declarations for modularized functions
var runAuthFlow, renderProfilePicker, renderProfileWidget, migrateToProfiles, checkAndUnlockApp, onDeepLink, handleVaultAuth, renderAccount, openVault, lockVault, updateVaultUI, toggleLock;
var playVideo, playStream, exitPlayer, saveProgress, playMusic, playNextMusic, playPrevMusic, getMusicMeta, stopBackgroundTrailer, createSubtitleOverlay, attachTrackToOverlay, applySubtitleStyles, loadSubtitleLocal, loadSubtitleFromUrl, loadExternalSubtitle;
var renderLibrary, scanLibrary, openTmdbSearchModal, performMetaSearch, linkMetaResult, moveNewMovieDialog, moveNewEpisodeDialog, createSeriesFolderDialog, createMovieFolderDialog;
var loadDiscover, renderDiscoverRow, performDiscoverSearch, openDiscoverDetail, renderCinemetaEpisodes, loadStreams, clearContinueWatching, renderContinueWatchingDiscover;
var renderSettings, renderSettingsFolders, updateZoom;
var adjustSubSync, getPlaybackKey, ensureSeasonMetadata, isNativePlayerWindow, engine;

function isStaleStreamUrl(p) {
  if (!p || !/^https?:\/\//i.test(p)) return false;
  // If the stream URL is currently active in the running session, it's not stale
  if (window._activeStreamUrl && window._activeStreamUrl === p) return false;
  return /\/stream\?path=/i.test(p);
}

function toMediaPlayUrl(filePath) {
  if (!filePath) return '';
  if (/^(media|https?|data|blob):/i.test(filePath)) return filePath;
  if (window.api && window.api.isElectron) {
    const safePath = filePath.replace(/\\/g, '/');
    if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith('/')) {
      const cleanPath = safePath.replace(/^\/+/, '');
      return 'media:///' + encodeURI(cleanPath).replace(/#/g, '%23').replace(/\?/g, '%3F');
    }
    return 'media://' + encodeURI(safePath).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  if (window.Capacitor) return window.Capacitor.convertFileSrc(filePath);
  return filePath;
}

function cleanTechnicalTitle(t) {
  if (!t) return 'Unknown';
  let clean = t.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i, '')
    .replace(/[.\-_]/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|web-dl|bluray|brrip|bdrip|remux|uhd|hdr|dts|dd5\.1|ac3|atmos|truehd|aac|dual|audio|multi|sub|eng|ita|ger|fra|spa|por|pt|gb|ru|rus|ukr|hq|10bit|6ch|5\.1|stereo)\b/gi, '')
    .replace(/\b(Project|Comando|Dub|YTS|YIFY|RARBG|ETRG|SPARKS|AMIABLE|DRONES|ROVERS|GECKOS|VPPV|WIKI|EVO|TIGOLE|PSA|QxR|YOL0|ARWEN|MFL|TDR|DDR|KOC|SEL|DoMiNo|Rutor|Selezen|MovieDalen|DUAL|AUDIO|GB|PT)\b/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/[«»\[\]\(\)]/g, '')
    .replace(/\s+/g, ' ').trim();

  return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || t;
}

async function requestNativePlayback(item, show, extra = {}) {
  if (!window.api?.playMedia) return { success: false, error: 'playMedia unavailable' };
  
  // Prefer active stream URL if available, fallback to torrentMagnet or media path
  let pathUrl = item.path || item.url || item.torrentMagnet || item.streamUrl || item.mediaUrl || item.sourceUrl || item.videoId || item.id;
  if ((item.isYoutube || item.type === 'youtube') && (item.videoId || item.id) && (!pathUrl || !pathUrl.startsWith('http'))) {
    pathUrl = `https://www.youtube.com/watch?v=${item.videoId || item.id}`;
  }
  const pbKey = typeof getPlaybackKey === 'function' ? getPlaybackKey(item) : null;
  const pb = currentProfile?.playback?.[pbKey];
  const startTime = extra.startTime ?? ((pb && pb.time > 2 && !pb.watched) ? pb.time : 0);
  
  // ── Smart Playlist Construction for TV Shows & Multi-Item Series ──
  let playlist = null;
  let playlistIndex = 0;

  const rawEpisodes = show?.episodes || window.currentEpisodes || window.currentDetailEpisodes || (item.episodes || null);
  if (Array.isArray(rawEpisodes) && rawEpisodes.length > 1) {
    const showObj = show || window.currentShow || window.currentDetailItem || item;
    
    // Comprehensive Metadata Lookup across TMDB, Cinemeta, and Local Banners
    let tmdbMeta = null;
    if (typeof getMetadataForItem === 'function') {
      tmdbMeta = getMetadataForItem(showObj) || getMetadataForItem(item);
    }
    if (!tmdbMeta && window.appData) {
      const keys = [
        showObj?.id, showObj?.imdb_id, showObj?.imdbId, showObj?.tmdbId, showObj?.tmdb_id, showObj?.cinemetaId,
        showObj?.title, showObj?.name, showObj?.cleanTitle,
        item?.id, item?.showId, item?.showTitle, item?.title
      ].filter(Boolean);
      for (const k of keys) {
        if (window.appData.tmdbCache && window.appData.tmdbCache[k]) {
          tmdbMeta = window.appData.tmdbCache[k];
          break;
        }
        if (window.appData.cinemetaCache && window.appData.cinemetaCache[k]) {
          tmdbMeta = window.appData.cinemetaCache[k];
          break;
        }
      }
    }

    const tmdbSeasons = tmdbMeta?.seasons || {};
    const showTitle = showObj?.title || showObj?.name || tmdbMeta?.title || item.showTitle || '';
    
    // General Show Fallback Image (Poster / Backdrop / Local Banner)
    let showFallbackImage = tmdbMeta?.backdrop || tmdbMeta?.backdrop_path || tmdbMeta?.poster || tmdbMeta?.poster_path ||
                            showObj?.backdrop || showObj?.backdrop_path || showObj?.poster || showObj?.poster_path ||
                            showObj?.cover || showObj?.banner || '';
    
    if (!showFallbackImage && window.appData?.banners) {
      showFallbackImage = window.appData.banners[showObj?.id] || window.appData.banners[item?.id] || '';
    }

    if (showFallbackImage && showFallbackImage.startsWith('/') && !showFallbackImage.startsWith('//') && !showFallbackImage.includes(':')) {
      showFallbackImage = `https://image.tmdb.org/t/p/w500${showFallbackImage}`;
    }

    playlist = rawEpisodes.map((ep, idx) => {
      const epNum = ep.episode != null ? parseInt(ep.episode, 10) : (ep.episode_number != null ? parseInt(ep.episode_number, 10) : (idx + 1));
      const snNum = ep.season != null ? parseInt(ep.season, 10) : (ep.season_number != null ? parseInt(ep.season_number, 10) : 1);
      const tE = (tmdbSeasons[snNum] && (tmdbSeasons[snNum][epNum] || tmdbSeasons[snNum][String(epNum)])) || null;

      // Extract high-resolution still thumbnail
      let thumb = ep.thumbnail || ep.still_path || ep.still || '';
      if (!thumb && tE) {
        thumb = tE.local_still || tE.still_path || tE.still || tE.thumbnail || '';
      }
      if (!thumb && window.appData?.banners) {
        thumb = window.appData.banners[ep.id] || window.appData.banners[ep.path] || '';
      }
      if (!thumb) {
        thumb = showFallbackImage;
      }

      if (thumb && thumb.startsWith('/') && !thumb.startsWith('//') && !thumb.includes(':')) {
        thumb = `https://image.tmdb.org/t/p/w500${thumb}`;
      }
      if (thumb && thumb.startsWith('file:///')) {
        thumb = thumb.replace('file:///', '');
      }

      const epTitle = ep.title || ep.name || tE?.name || `Episode ${epNum}`;
      const epPath = ep.path || ep.url || ep.sourceUrl || '';

      return {
        path: epPath,
        url: epPath,
        title: epTitle,
        season: snNum,
        episode: epNum,
        thumbnail: thumb || '',
        showTitle: showTitle,
        duration_ms: (typeof ep.duration === 'number') ? ep.duration * 1000 : 0
      };
    }).filter(p => p.path); // keep only playable items

    // Determine the index of the currently requested episode in the playlist
    const foundIdx = playlist.findIndex(p => {
      if (item.path && p.path === item.path) return true;
      if (item.id && p.path === item.id) return true;
      if (item.episode != null && p.episode === parseInt(item.episode, 10) && (item.season == null || p.season === parseInt(item.season, 10))) return true;
      return false;
    });

    if (foundIdx >= 0) {
      playlistIndex = foundIdx;
    }
  }

  return window.api.playMedia({
    path: pathUrl,
    url: pathUrl,
    title: item.displayTitle || item.title || item.epTitle || item.name || 'Playback',
    startTime,
    pbKey,
    profileId: currentProfile?.id,
    item,
    show,
    playlist,
    playlistIndex,
    fileIdx: item.fileIdx ?? (pb ? pb.fileIdx : null)
  });
}

getMusicMeta = function(item) {
  if (!item) return { title: 'Unknown', artist: 'Unknown Artist', cover: null };
  const custom = appData.banners[item.id];
  const override = appData.musicMetadata[item.id] || {};
  return {
    title: override.title || item.title || item.filename?.replace(/\.[^/.]+$/, '') || 'Unknown Title',
    artist: override.artist || item.artist || 'Unknown Artist',
    cover: custom || override.cover || item.cover
  };
}



