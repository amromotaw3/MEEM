// NOTE: global.WebSocket is polyfilled in main.js before this module loads.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { isConfigured } = require('../shared/supabaseEnv');
const { supabaseRpc } = require('./supabaseRpc');
const {
  checkHardwareBan,
  getDeviceSessionWithRpcFallback,
  loginUser,
  registerUser
} = require('../shared/cloudAuth');
const { log } = require('./utils/logger');

if (!isConfigured()) {
  console.warn('[STORE] Supabase config missing. Set SUPABASE_URL and SUPABASE_ANON_KEY (or publishable key) in .env');
}

function formatAuthError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.error) return typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
  return JSON.stringify(err);
}

// Keep directories defined so other modules don't break, but do NOT write data to disk.
const USER_DATA   = app.getPath('userData');
const DATA_DIR    = path.join(USER_DATA, 'data');
const DATA_FILE   = path.join(DATA_DIR, 'appdata.json');
const BANNERS_DIR = path.join(USER_DATA, 'banners');
const TEMP_DIR    = path.join(USER_DATA, 'temp_downloads');

/**
 * Ensures that a directory exists by creating it recursively if needed.
 * 
 * @param {string} dir - The absolute directory path.
 */
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

/**
 * Resolves the backend API base URL dynamically.
 * 
 * @returns {string} The backend URL.
 */
function getBackendUrl() {
  return process.env.MEDIAVAULT_BACKEND_URL || 'http://localhost:3000';
}

// In-Memory cache for session data to avoid spamming network requests during a single process lifetime
let inMemorySession = null;

// Cache the last known Supabase JWT so saveData can create authenticated clients even after restart
let _cachedSupabaseSession = null;
let _refreshPromise = null;

async function getAuthenticatedClient(session = null) {
  const isCredentialsUser = inMemorySession && inMemorySession.authenticated && !inMemorySession._supabaseSession;
  let effectiveSession = (session && session.access_token) ? session : null;

  if (!effectiveSession && !isCredentialsUser) {
    if (_cachedSupabaseSession && _cachedSupabaseSession.access_token) {
      effectiveSession = _cachedSupabaseSession;
    } else {
      try {
        const local = readLocalAppData() || {};
        if (local._supabaseSession && local._supabaseSession.access_token) {
          effectiveSession = local._supabaseSession;
          _cachedSupabaseSession = effectiveSession;
          // Quiet background session restoration log
          // console.log('[STORE] Restored Supabase session from disk in getAuthenticatedClient.');
        }
      } catch (e) {
        console.warn('[STORE] Failed to read local Supabase session from disk:', e.message);
      }
    }
  }

  if (effectiveSession && effectiveSession.access_token) {
    const { createClient } = require('@supabase/supabase-js');
    const { getSupabaseUrl, getSupabaseAnonKey } = require('../shared/supabaseEnv');
    
    let currentAccessToken = effectiveSession.access_token;

    if (effectiveSession.refresh_token) {
      try {
        let isExpired = true;
        try {
          const payload = JSON.parse(Buffer.from(effectiveSession.access_token.split('.')[1], 'base64').toString());
          const expiry = payload.exp * 1000;
          if (expiry - Date.now() > 30000) {
            isExpired = false;
          }
        } catch (jwtErr) {
          console.warn('[STORE] Failed to parse JWT expiration:', jwtErr.message);
        }

        if (isExpired) {
          if (!_refreshPromise) {
            _refreshPromise = (async () => {
              console.log('[STORE] Access token is expired, refreshing...');
              const tempClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
                auth: { persistSession: false, autoRefreshToken: true }
              });

              const { data: sessionData, error: refreshError } = await tempClient.auth.refreshSession({
                refresh_token: effectiveSession.refresh_token
              });

              if (!refreshError && sessionData && sessionData.session) {
                console.log('[STORE] Token refreshed successfully.');
                const newSession = {
                  access_token: sessionData.session.access_token,
                  refresh_token: sessionData.session.refresh_token
                };
                _cachedSupabaseSession = newSession;
                const local = readLocalAppData() || {};
                local._supabaseSession = newSession;
                writeLocalAppData(local);

                // Broadcast refreshed session to renderer windows to prevent token reuse conflicts
                try {
                  const { BrowserWindow } = require('electron');
                  BrowserWindow.getAllWindows().forEach(win => {
                    if (!win.isDestroyed()) {
                      win.webContents.send('session-refreshed', newSession);
                    }
                  });
                  console.log('[STORE] Broadcasted refreshed session to renderer windows');
                } catch (broadcastErr) {
                  console.error('[STORE] Failed to broadcast refreshed session:', broadcastErr.message);
                }

                return newSession;
              } else {
                console.warn('[STORE] Token refresh failed:', refreshError?.message);
                return null;
              }
            })();
          }

          const refreshedSession = await _refreshPromise;
          _refreshPromise = null; // Clear lock after resolution

          if (refreshedSession) {
            currentAccessToken = refreshedSession.access_token;
          } else {
            currentAccessToken = null;
          }
        }
      } catch (refreshErr) {
        _refreshPromise = null;
        console.error('[STORE] Error refreshing session:', refreshErr.message);
        currentAccessToken = null;
      }
    }

    if (currentAccessToken) {
      return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${currentAccessToken}` } }
      });
    }
  }

  // Fallback: use service_role key when no Supabase JWT is available.
  // This is safe because:
  //  1. The service_role key is only accessible in the Electron main process (never exposed to renderer).
  //  2. The hardware-ID device session already authenticated the user before this function is called.
  const { getSupabaseServiceRoleKey, getSupabaseUrl, getSupabaseAnonKey } = require('../shared/supabaseEnv');
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (serviceRoleKey) {
    console.log('[STORE] No Supabase JWT found — using service_role client for main-process DB access.');
    
    // Auto-logout the user if they were marked authenticated but have no JWT
    const localData = readLocalAppData() || {};
    if (localData.authenticated) {
      console.log('[STORE] User was authenticated but has no valid JWT. Forcing logout...');
      inMemorySession = null;
      _cachedSupabaseSession = null;
      const clearedData = {
        authenticated: false,
        user: null,
        profiles: [],
        activeProfileId: null,
        installedAddons: Array.isArray(localData.installedAddons) ? localData.installedAddons : []
      };
      writeLocalAppData(clearedData, true);
      
      const { getMainWindow } = require('./windowManager');
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('force-logout');
      }
    }

    const { createClient } = require('@supabase/supabase-js');
    return createClient(getSupabaseUrl(), serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  throw new Error('No active authenticated session available');
}

async function fetchNormalizedProfileData(client, profileId) {
  // 1. Fetch watchlist_items
  const { data: watchlistData, error: wlError } = await client
    .from('watchlist_items')
    .select('*')
    .eq('profile_id', profileId);
  if (wlError) {
    console.error('[STORE] load watchlist error:', wlError.message);
    throw wlError;
  }

  // 2. Fetch playback_history
  const { data: playbackData, error: pbError } = await client
    .from('playback_history')
    .select('*')
    .eq('profile_id', profileId);
  if (pbError) {
    console.error('[STORE] load playback error:', pbError.message);
    throw pbError;
  }

  // 3. Fetch locked_items
  const { data: lockedData, error: lError } = await client
    .from('locked_items')
    .select('*')
    .eq('profile_id', profileId);
  if (lError) {
    console.error('[STORE] load locked error:', lError.message);
    throw lError;
  }

  // 4. Fetch custom_lists and list_items
  const { data: listsData, error: clError } = await client
    .from('custom_lists')
    .select('id, profile_id, list_name, theme_color, list_items(media_id, type, title, poster_path, backdrop_path, release_date, vote_average, overview, source, mal_id, anime_id)')
    .eq('profile_id', profileId);
  if (clError) {
    console.error('[STORE] load custom lists error:', clError.message);
    throw clError;
  }

  // Fetch shared lists
  let sharedLists = [];
  try {
    const session = getInMemorySession();
    const userId = session?.user?.id;
    if (userId) {
      const { data: memberRefs } = await client
        .from('list_members')
        .select('list_id')
        .eq('user_id', userId)
        .eq('status', 'joined');
      if (memberRefs && memberRefs.length > 0) {
        const sharedListIds = memberRefs.map(m => m.list_id);
        const { data: fetchedShared, error: sharedError } = await client
          .from('custom_lists')
          .select('id, profile_id, list_name, theme_color, list_items(media_id, type, title, poster_path, backdrop_path, release_date, vote_average, overview, source, mal_id, anime_id)')
          .in('id', sharedListIds);
        if (!sharedError && fetchedShared) {
          sharedLists = fetchedShared;
        }
      }
    }
  } catch (e) {
    console.warn('[STORE] Failed to load shared lists:', e.message);
  }

  const combinedLists = [...(listsData || [])];
  const ownedIds = new Set(combinedLists.map(l => l.id));
  for (const list of sharedLists) {
    if (!ownedIds.has(list.id)) {
      combinedLists.push(list);
    }
  }

  const watchlist = (watchlistData || []).map(row => ({
    id: row.media_id,
    type: row.type,
    media_type: row.type,
    title: row.title,
    poster: row.poster_path,
    rating: row.rating ? Number(row.rating) : null,
    listedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
    source: row.source || null,
    mal_id: row.mal_id || null,
    malId: row.mal_id || null,
    anime_id: row.anime_id || null,
    backdrop_path: row.backdrop_path || null,
    backdrop: row.backdrop_path || null,
    release_date: row.release_date || null,
    overview: row.overview || null
  }));

  const playback = {};
  (playbackData || []).forEach(row => {
    playback[row.media_id] = {
      time: row.progress ? Number(row.progress) : 0,
      duration: row.duration ? Number(row.duration) : 0,
      lastWatched: row.last_watched_at ? new Date(row.last_watched_at).getTime() : Date.now(),
      watched: row.watched || false
    };
  });

  const lockedItems = (lockedData || []).map(row => row.item_path);

  const custom_lists = combinedLists.map(row => ({
    id: row.id,
    profile_id: row.profile_id,
    name: row.list_name,
    theme_color: row.theme_color || '#6366f1',
    items: (row.list_items || []).map(item => ({
      id: item.media_id,
      title: item.title || '',
      type: item.type || '',
      media_type: item.type || '',
      poster: item.poster_path || '',
      backdrop: item.backdrop_path || '',
      release_date: item.release_date || '',
      vote_average: item.vote_average ? Number(item.vote_average) : 0,
      overview: item.overview || '',
      source: item.source || null,
      mal_id: item.mal_id || null,
      malId: item.mal_id || null,
      anime_id: item.anime_id || null
    }))
  }));

  return { watchlist, playback, lockedItems, custom_lists };
}

/**
 * Fetches all relational profile data using a hardware_id-authenticated RPC.
 * Used as a fallback when no Supabase JWT session is available.
 * Calls the SECURITY DEFINER function `get_profile_data_by_hardware`.
 *
 * @param {string} hardwareId - The device hardware ID.
 * @param {string} profileId - The profile UUID.
 * @returns {Promise<Object|null>} Normalized profile data, or null on failure.
 */
async function fetchNormalizedProfileDataByHardware(hardwareId, profileId) {
  try {
    const { getClient } = require('../shared/supabaseClient');
    const client = getClient();
    const { data, error } = await client.rpc('get_profile_data_by_hardware', {
      p_hardware_id: hardwareId,
      p_profile_id: profileId
    });
    if (error) throw error;
    if (!data || data.error) {
      console.warn('[STORE] get_profile_data_by_hardware returned error:', data?.error);
      return null;
    }

    const watchlistData = data.watchlist_items || [];
    const playbackData = data.playback_history || [];
    const lockedData = data.locked_items || [];
    const listsData = data.custom_lists || [];

    const watchlist = watchlistData.map(row => ({
      id: row.media_id,
      type: row.type,
      media_type: row.type,
      title: row.title,
      name: row.title,
      poster: row.poster_path,
      poster_path: row.poster_path,
      posterPath: row.poster_path,
      rating: row.rating ? Number(row.rating) : null,
      listedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
      source: row.source || null,
      mal_id: row.mal_id || null,
      malId: row.mal_id || null,
      anime_id: row.anime_id || null,
      backdrop_path: row.backdrop_path || null,
      backdrop: row.backdrop_path || null,
      release_date: row.release_date || null,
      overview: row.overview || null,
      streamUrl: row.stream_url || row.streamUrl || null,
      radioUrl: row.radio_url || row.radioUrl || null,
      favicon: row.favicon || null,
      logo: row.logo || null,
      country: row.country || null,
      category: row.category || null
    }));

    const playback = {};
    playbackData.forEach(row => {
      playback[row.media_id] = {
        time: row.progress ? Number(row.progress) : 0,
        duration: row.duration ? Number(row.duration) : 0,
        lastWatched: row.last_watched_at ? new Date(row.last_watched_at).getTime() : Date.now(),
        watched: row.watched || false
      };
    });

    const lockedItems = lockedData.map(row => row.item_path);

    const custom_lists = listsData.map(row => ({
      id: row.id,
      profile_id: row.profile_id,
      name: row.list_name,
      theme_color: row.theme_color || '#6366f1',
      items: (row.list_items || []).map(item => ({
        id: item.media_id,
        title: item.title || '',
        type: item.type || '',
        media_type: item.type || '',
        poster: item.poster_path || '',
        backdrop: item.backdrop_path || '',
        release_date: item.release_date || '',
        vote_average: item.vote_average ? Number(item.vote_average) : 0,
        overview: item.overview || '',
        source: item.source || null,
        mal_id: item.mal_id || null,
        malId: item.mal_id || null,
        anime_id: item.anime_id || null
      }))
    }));

    return { watchlist, playback, lockedItems, custom_lists };
  } catch (err) {
    console.warn('[STORE] fetchNormalizedProfileDataByHardware failed:', err.message);
    return null;
  }
}

/**
 * Reads local application state data from the local JSON file.
 * 
 * @returns {Object} The parsed application data, or empty object.
 */
function readLocalAppData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return parsed || {};
    }
  } catch (err) {
    console.warn('[STORE] readLocalAppData failed:', err.message);
  }
  return {};
}

let diskWriteTimeout = null;

/**
 * Writes the application state data to the local JSON file.
 * 
 * @param {Object} data - The state data to save.
 * @returns {boolean} True on success, false on error.
 */
function writeLocalAppData(data, forceImmediate = false) {
  try {
    inMemorySession = data;
    ensureDir(DATA_DIR);

    // If running in unit tests or forced immediate, write synchronously to prevent race conditions
    if (forceImmediate || process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test') {
      if (diskWriteTimeout) {
        clearTimeout(diskWriteTimeout);
        diskWriteTimeout = null;
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    }

    // Debounce disk writes by 3 seconds asynchronously to avoid blocking the main UI thread
    if (diskWriteTimeout) clearTimeout(diskWriteTimeout);
    diskWriteTimeout = setTimeout(() => {
      fs.writeFile(DATA_FILE, JSON.stringify(inMemorySession, null, 2), 'utf8', (err) => {
        if (err) console.error('[STORE] writeLocalAppData async failed:', err.message);
      });
    }, 3000);
    return true;
  } catch (err) {
    console.error('[STORE] writeLocalAppData failed:', err.message);
    return false;
  }
}

// Flush pending state synchronously on app termination
if (app && typeof app.on === 'function') {
  app.on('before-quit', () => {
    if (diskWriteTimeout) {
      clearTimeout(diskWriteTimeout);
      diskWriteTimeout = null;
    }
    try {
      if (inMemorySession && Object.keys(inMemorySession).length > 0) {
        ensureDir(DATA_DIR);
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemorySession, null, 2), 'utf8');
        console.log('[STORE] Flushed local state to disk synchronously before quit');
      } else {
        console.log('[STORE] inMemorySession is empty/null, skipping flush to avoid corruption');
      }
    } catch (e) {
      console.error('[STORE] Failed to flush local state on quit:', e.message);
    }
  });
}

/**
 * Returns the current cached in-memory session, falling back to local file.
 * 
 * @returns {Object} The current state object.
 */
function getInMemorySession() {
  return inMemorySession || readLocalAppData();
}

/**
 * Gets a unique hardware identifier for the system.
 * Uses node-machine-id, falling back to OS hostname/arch information.
 * 
 * @returns {string} The unique hardware ID.
 */
function getHardwareId() {
  let hardwareId = 'desktop-unknown';
  try {
    const { machineIdSync } = require('node-machine-id');
    hardwareId = machineIdSync();
  } catch (e) {
    const os = require('os');
    hardwareId = os.hostname() + '-' + os.platform() + '-' + os.arch();
  }
  return hardwareId;
}



async function loadData() {
  const local = readLocalAppData() || {};
  const hardwareId = getHardwareId();

  if (local && local.authenticated === false) {
    console.log('[STORE] User is logged out (local.authenticated === false). Skipping device auto-login.');
    return { ...local, hardwareId };
  }

  // Restore cached Supabase session from disk so saveData works after restart
  if (local._supabaseSession && local._supabaseSession.access_token) {
    _cachedSupabaseSession = local._supabaseSession;
     // Quiet background session restoration log
     // console.log('[STORE] Restored Supabase session from disk.');
  }

  if (local && (local.banned === true || local.banned === 'true')) {
    console.warn('[STORE] Cached ban active for device:', local.banReason);
    return { ...local, authenticated: false, banned: true, banReason: local.banReason || 'Permanently Banned (Offline Signature)', hardwareId };
  }

  try {
    // Mute redundant loading logs
    // console.log(`[STORE] Loading cloud session for hardware ID: ${hardwareId}`);
    let data = null;
    try {
      const banned = await checkHardwareBan(hardwareId);
      if (banned) {
        console.warn('[STORE] Device is banned:', banned.reason);
        local.banned = true;
        local.banReason = banned.reason || 'This device has been banned.';
        writeLocalAppData(local);
        return { ...local, authenticated: false, banned: true, banReason: local.banReason, hardwareId };
      }
      data = await getDeviceSessionWithRpcFallback(hardwareId);
    } catch (be) {
      console.warn('[STORE] Cloud session load failed', be.message || be);
      try {
        const fallbackUrl = `${getBackendUrl()}/api/auth/device-session?hardware_id=${encodeURIComponent(hardwareId)}`;
        const resp = await axios.get(fallbackUrl, { timeout: 8000 });
        if (resp?.status === 403) {
          return { ...local, authenticated: false, banned: true, hardwareId };
        }
        if (resp?.data) data = resp.data;
      } catch (fbErr) {
        console.warn('[STORE] device-session HTTP fallback failed:', fbErr.message || fbErr);
      }
    }
    if (data && !data.authenticated) {
      console.warn('[STORE] Server explicitly returned authenticated: false. Invalidating session.');
      if (data.user && (data.user.is_banned === true || data.user.is_banned === 'true')) {
        console.warn('[STORE] User is banned:', data.user.email);
        local.authenticated = false;
        local.banned = true;
        local.banReason = 'Your account has been suspended.';
        writeLocalAppData(local, true);
        return { ...local, authenticated: false, banned: true, banReason: local.banReason, hardwareId };
      } else {
        const clearedData = { ...local, authenticated: false, user: null, profiles: [], activeProfileId: null };
        writeLocalAppData(clearedData, true);
        return clearedData;
      }
    }
    if (data && data.authenticated) {
      let client;
      try {
        client = await getAuthenticatedClient();
      } catch (clientErr) {
        // Only log as a warning — the app continues in degraded (local-only) mode.
        console.warn('[STORE] Failed to initialize authenticated client for load:', clientErr.message);
      }

      const mergedProfiles = [];
      if (data.profiles && Array.isArray(data.profiles)) {
        for (const cloudProf of data.profiles) {
          let relData = null;
          if (client) {
            try {
              relData = await fetchNormalizedProfileData(client, cloudProf.id);
            } catch (relErr) {
              console.error(`[STORE] Failed to fetch relational data for profile ${cloudProf.id}:`, relErr.message);
            }
          }

          // If JWT client failed, try hardware-ID-based RPC fallback
          if (!relData) {
            console.log(`[STORE] Attempting hardware-ID RPC fallback for profile ${cloudProf.id}...`);
            relData = await fetchNormalizedProfileDataByHardware(hardwareId, cloudProf.id);
            if (relData) {
              console.log(`[STORE] Hardware-ID RPC fallback succeeded for profile ${cloudProf.id}.`);
            }
          }

          const localProf = (local.profiles || []).find(p => p.id === cloudProf.id);
          const loadedProf = {
            ...cloudProf,
            ...(relData || {
              watchlist: localProf?.watchlist || [],
              playback: localProf?.playback || {},
              lockedItems: localProf?.lockedItems || localProf?.locked_items || [],
              custom_lists: localProf?.custom_lists || []
            })
          };

          if (localProf) {
            mergedProfiles.push({
              ...localProf,
              ...loadedProf,
              // Keep local-only settings and preserve local avatar/banner over old/null cloud values
              avatar: localProf.avatar || loadedProf.avatar || null,
              banner: localProf.banner || loadedProf.banner || local.globalBanner || null,
              trakt: loadedProf.trakt || localProf.trakt || null,
              libraryFolders: loadedProf.libraryFolders || localProf.libraryFolders || undefined
            });
          } else {
            mergedProfiles.push(loadedProf);
          }
        }
      }

      inMemorySession = {
        ...local,
        user: data.user,
        tmdbKey: data.user.tmdb_api_key || local.tmdbKey || '',
        subdlKey: data.user.subdl_api_key || local.subdlKey || '',
        fanartKey: data.user.fanart_api_key || local.fanartKey || '',
        globalBanner: local.globalBanner || data.globalBanner || null,
        profiles: mergedProfiles.length ? mergedProfiles : (local.profiles || []),
        activeProfileId: data.profiles?.[0]?.id || local.activeProfileId || null,
        authenticated: true,
        hardwareId,
        _supabaseSession: _cachedSupabaseSession || local._supabaseSession
      };

      if (!inMemorySession.subdlConfig) inMemorySession.subdlConfig = {};
      if (data.user.subdl_api_key) {
        inMemorySession.subdlConfig.apiKey = data.user.subdl_api_key;
      }
      if (data.user.subdl_enabled !== undefined && data.user.subdl_enabled !== null) {
        inMemorySession.subdlConfig.enabled = data.user.subdl_enabled;
      }
      if (data.user.subdl_languages) {
        inMemorySession.subdlConfig.languages = data.user.subdl_languages.split(',');
      }
      if (data.user.subdl_hearing_impairment) {
        inMemorySession.subdlConfig.hearingImpairment = data.user.subdl_hearing_impairment;
      }

      if (data.user.trakt_access_token) {
        inMemorySession.trakt = {
          accessToken: data.user.trakt_access_token,
          refreshToken: data.user.trakt_refresh_token || '',
          createdAt: Number(data.user.trakt_created_at || 0),
          expiresIn: Number(data.user.trakt_expires_in || 0),
          connected: true
        };
      }

      return inMemorySession;
    }
  } catch (e) {
    console.error('[STORE] Failed to load data from Supabase:', e.message);
  }

  return {
    ...local,
    authenticated: local.authenticated || false,
    user: local.user || null,
    profiles: local.profiles || [],
    activeProfileId: local.activeProfileId || null,
    hardwareId
  };
}

async function saveData(data, session = null) {
  if (!inMemorySession) {
    inMemorySession = readLocalAppData() || {};
  }

  // Update cached session if provided
  if (session && session.access_token) {
    _cachedSupabaseSession = session;
    inMemorySession._supabaseSession = session;
  }

  // Keep existing session token in memory to prevent overwrite
  const existingSupabaseSession = inMemorySession._supabaseSession;

  // Always update memory session locally
  inMemorySession = { ...inMemorySession, ...data };

  if (existingSupabaseSession && data._supabaseSession !== null) {
    inMemorySession._supabaseSession = existingSupabaseSession;
  } else if (data._supabaseSession === null) {
    _cachedSupabaseSession = null;
    inMemorySession._supabaseSession = null;
  }

  // Write to local JSON storage for guests (and as a backup)
  writeLocalAppData(inMemorySession);

  // Quick logger helper to persistent debug file
  const SYNC_LOG = path.join(USER_DATA, 'sync-errors.log');
  function appendSyncLog(msg) {
    try { fs.appendFileSync(SYNC_LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8'); } catch (e) {}
  }

  // 1️⃣ Enforce Authentication Lockdown (The "Gatekeeper" Rule)
  if (!data || !data.authenticated || !data.user || !data.user.id) {
    // Only log on first attempt to avoid log spam - skip cloud sync silently
    if (inMemorySession?.authenticated) {
      console.log('[STORE] User logged out: Settings saved locally (cloud sync skipped).');
      appendSyncLog('Logout: skipping cloud sync (not authenticated)');
    }
    return inMemorySession; 
  }

  if (data.user) {
    let client;
    try {
      client = await getAuthenticatedClient(session);
    } catch (e) {
      // Only log if we previously had a session - skip cloud sync silently
      if (_cachedSupabaseSession) {
        console.warn('[STORE] Cloud sync unavailable (session invalid/expired). Local save complete.');
        appendSyncLog('Cloud sync failed (session expired): ' + (e.message || String(e)));
      }
      return inMemorySession; // local save already done
    }

    // helper: retry operation with backoff
    async function retry(fn, attempts = 3, delayMs = 500) {
      let lastErr = null;
      for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (err) { lastErr = err; await new Promise(r => setTimeout(r, delayMs * (i+1))); }
      }
      throw lastErr;
    }

    try {
      // Sync API Keys and Trakt credentials to public.users_accounts table (with retry)
      const tmdbKeyVal = data.tmdbKey || '';
      const subdlKeyVal = data.subdlConfig?.apiKey || data.subdlKey || '';
      const fanartKeyVal = data.fanartKey || '';
      const traktVal = data.trakt || {};
      const subdlEnabledVal = data.subdlConfig?.enabled ?? false;
      const subdlLangsVal = Array.isArray(data.subdlConfig?.languages) ? data.subdlConfig.languages.join(',') : 'AR,EN';
      const subdlHiVal = data.subdlConfig?.hearingImpairment || 'hiInclude';

      await retry(async () => {
        const hwId = getHardwareId();
        const res = await client.rpc('update_user_settings', {
          p_user_id:                 data.user.id,
          p_hardware_id:             hwId,
          p_tmdb_api_key:            tmdbKeyVal || null,
          p_subdl_api_key:           subdlKeyVal || null,
          p_fanart_api_key:          fanartKeyVal || null,
          p_subdl_enabled:           subdlEnabledVal,
          p_subdl_languages:         subdlLangsVal,
          p_subdl_hearing_impairment: subdlHiVal,
          p_trakt_access_token:      traktVal.accessToken || null,
          p_trakt_refresh_token:     traktVal.refreshToken || null,
          p_trakt_created_at:        traktVal.createdAt   || null,
          p_trakt_expires_in:        traktVal.expiresIn   || null
        });
        if (res.error) throw res.error;
        const rpcData = res.data || res;
        if (rpcData && rpcData.success === false) throw new Error(rpcData.error || 'update_user_settings reported failure');
      }, 3, 700);


      // Quiet API key sync log
      // console.log('[STORE] API keys successfully synchronized via update_user_settings RPC.');

      if (Array.isArray(data.profiles) && data.profiles.length) {
        for (const profile of data.profiles) {
          if (profile.user_id && profile.user_id !== data.user.id) {
            continue;
          }
          try {
            // 1. Direct metadata upsert
          await retry(async () => {
            const { error: profileError } = await client
              .from('account_profiles')
              .upsert({
                id: profile.id,
                user_id: data.user.id,
                name: profile.name,
                avatar: profile.avatar || null,
                max_age_rating: typeof profile.max_age_rating !== 'undefined' ? parseInt(profile.max_age_rating, 10) : 18,
                profile_pin: profile.vaultPin || profile.pin || null,
                banner: profile.banner || null
              }, { onConflict: 'id' });
            if (profileError) {
              if (profileError.code === '42501' || (profileError.message && profileError.message.includes('row-level security'))) {
                log('STORE', `Profile sync skipped — RLS policy active for profile ${profile.id}.`, 'warn');
                return;
              }
              throw profileError;
            }
          }, 2, 500);

          // 2. Sync watchlist_items
          const localWatchlist = profile.watchlist || [];
          const { data: dbWatchlist, error: wlFetchError } = await client
            .from('watchlist_items')
            .select('media_id')
            .eq('profile_id', profile.id);
          if (wlFetchError) throw wlFetchError;

          const dbWatchlistIds = new Set((dbWatchlist || []).map(x => x.media_id));
          const localWatchlistIds = new Set(localWatchlist.map(x => x.id));

          const toDeleteWl = [...dbWatchlistIds].filter(id => !localWatchlistIds.has(id));
          if (toDeleteWl.length > 0) {
            const { error: delError } = await client
              .from('watchlist_items')
              .delete()
              .eq('profile_id', profile.id)
              .in('media_id', toDeleteWl);
            if (delError) throw delError;
          }

           if (localWatchlist.length > 0) {
            const watchlistRows = localWatchlist.map(item => ({
              profile_id: profile.id,
              media_id: item.id || item.radioUrl || item.streamUrl || item.url || item.path || ('wl_' + Math.random().toString(36).substr(2, 6)),
              type: item.type || item.media_type || 'movie',
              title: item.title || item.name || 'Untitled',
              poster_path: item.poster_path || item.posterPath || item.favicon || item.logo || item.poster || null,
              rating: item.rating ? Number(item.rating) : null,
              added_at: item.listedAt ? new Date(item.listedAt).toISOString() : new Date().toISOString(),
              source: item.source || null,
              mal_id: item.mal_id ? String(item.mal_id) : (item.malId ? String(item.malId) : null),
              anime_id: item.anime_id ? String(item.anime_id) : null,
              backdrop_path: item.backdrop_path || item.backdrop || item.favicon || item.logo || null,
              release_date: item.release_date || null,
              overview: item.overview || null,
              stream_url: item.streamUrl || item.url || null,
              radio_url: item.radioUrl || item.url || null,
              favicon: item.favicon || null,
              logo: item.logo || item.tvgLogo || null,
              country: item.country || null,
              category: item.category || item.groupTitle || null,
              path: item.path || null,
              item_data: item
            }));

            const { error: upsertWlError } = await client
              .from('watchlist_items')
              .upsert(watchlistRows, { onConflict: 'profile_id,media_id' });
            if (upsertWlError) {
              console.warn('[STORE] watchlist_items upsert warning:', upsertWlError.message || upsertWlError);
            }
          }

          // 3. Sync playback_history
          const localPlayback = profile.playback || {};
          const { data: dbPlayback, error: pbFetchError } = await client
            .from('playback_history')
            .select('media_id')
            .eq('profile_id', profile.id);
          if (pbFetchError) throw pbFetchError;

          const dbPlaybackIds = new Set((dbPlayback || []).map(x => x.media_id));
          const localPlaybackIds = new Set(Object.keys(localPlayback));

          const toDeletePb = [...dbPlaybackIds].filter(id => !localPlaybackIds.has(id));
          if (toDeletePb.length > 0) {
            const { error: delPbError } = await client
              .from('playback_history')
              .delete()
              .eq('profile_id', profile.id)
              .in('media_id', toDeletePb);
            if (delPbError) throw delPbError;
          }

          const localPlaybackEntries = Object.entries(localPlayback);
          if (localPlaybackEntries.length > 0) {
            const playbackRows = localPlaybackEntries.map(([mediaId, entry]) => ({
              profile_id: profile.id,
              media_id: mediaId,
              progress: entry.time ? Number(entry.time) : 0,
              duration: entry.duration ? Number(entry.duration) : 0,
              last_watched_at: entry.lastWatched ? new Date(entry.lastWatched).toISOString() : new Date().toISOString(),
              watched: entry.watched ? true : false
            }));

            const { error: upsertPbError } = await client
              .from('playback_history')
              .upsert(playbackRows, { onConflict: 'profile_id,media_id' });
            if (upsertPbError) throw upsertPbError;
          }

          // 4. Sync locked_items
          const localLocked = profile.lockedItems || profile.locked_items || [];
          const { data: dbLocked, error: lFetchError } = await client
            .from('locked_items')
            .select('item_path')
            .eq('profile_id', profile.id);
          if (lFetchError) throw lFetchError;

          const dbLockedPaths = new Set((dbLocked || []).map(x => x.item_path));
          const localLockedPaths = new Set(localLocked);

          const toDeleteL = [...dbLockedPaths].filter(path => !localLockedPaths.has(path));
          if (toDeleteL.length > 0) {
            const { error: delLError } = await client
              .from('locked_items')
              .delete()
              .eq('profile_id', profile.id)
              .in('item_path', toDeleteL);
            if (delLError) throw delLError;
          }

          if (localLocked.length > 0) {
            const lockedRows = localLocked.map(path => ({
              profile_id: profile.id,
              item_path: path,
              locked_at: new Date().toISOString()
            }));

            const { error: upsertLError } = await client
              .from('locked_items')
              .upsert(lockedRows, { onConflict: 'profile_id,item_path' });
            if (upsertLError) throw upsertLError;
          }

          // 5. Sync custom lists & list items
          const localLists = profile.custom_lists || [];
          const { data: dbLists, error: clFetchError } = await client
            .from('custom_lists')
            .select('id, list_name')
            .eq('profile_id', profile.id);
          if (clFetchError) throw clFetchError;

          const dbListsByName = new Map((dbLists || []).map(x => [x.list_name?.toLowerCase() || '', x]));
          const localListsByName = new Set(localLists.map(x => (x.name || 'Unnamed').toLowerCase()));

          const listsToDelete = (dbLists || []).filter(x => !localListsByName.has((x.list_name || '').toLowerCase()));
          if (listsToDelete.length > 0) {
            const listIdsToDelete = listsToDelete.map(x => x.id);
            const { error: delListsError } = await client
              .from('custom_lists')
              .delete()
              .in('id', listIdsToDelete);
            if (delListsError) throw delListsError;
          }

          // NOTE: Auto-leave on sync was REMOVED — it caused a race condition where
          // newly-accepted invitations were immediately deleted by the next saveData call
          // before the local custom_lists had a chance to include the new shared list.
          // Membership removal now only happens via explicit user action (Leave List button).

          for (const localList of localLists) {
            let listId = localList.id;
            const isShared = localList.profile_id && localList.profile_id !== profile.id;

            if (!isShared) {
              const upsertData = {
                profile_id: profile.id,
                list_name: localList.name || 'Unnamed List',
                theme_color: localList.theme_color || '#6366f1'
              };
              const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localList.id);
              if (isUuid) {
                upsertData.id = localList.id;
              }

              const { data: listUpsertData, error: listUpsertError } = await client
                .from('custom_lists')
                .upsert(upsertData, { onConflict: 'profile_id,list_name' })
                .select('id')
                .maybeSingle();

              if (listUpsertError) {
                console.warn('[STORE] List upsert warning:', listUpsertError.message);
                const { data: listSelectData } = await client
                  .from('custom_lists')
                  .select('id')
                  .eq('profile_id', profile.id)
                  .eq('list_name', localList.name || 'Unnamed List')
                  .maybeSingle();
                if (listSelectData) {
                  listId = listSelectData.id;
                  localList.id = listSelectData.id; // Update local list ID
                }
              } else if (listUpsertData) {
                listId = listUpsertData.id;
                localList.id = listUpsertData.id; // Update local list ID
              }
            }

            if (!listId) {
              console.error('[STORE] Could not retrieve ID for custom list:', localList.name);
              continue;
            }

            const localItems = localList.items || [];
            const { data: dbItems, error: itemsFetchError } = await client
              .from('list_items')
              .select('media_id')
              .eq('list_id', listId);
            if (itemsFetchError) throw itemsFetchError;

            const dbItemIds = new Set((dbItems || []).map(x => x.media_id));
            const localItemIds = new Set(localItems.map(item => String(item.id || item)));

            const itemsToDelete = [...dbItemIds].filter(id => !localItemIds.has(id));
            if (itemsToDelete.length > 0) {
              const { error: delItemsError } = await client
                .from('list_items')
                .delete()
                .eq('list_id', listId)
                .in('media_id', itemsToDelete);
              if (delItemsError) throw delItemsError;
            }

            if (localItems.length > 0) {
              const itemRows = localItems.map(item => ({
                list_id: listId,
                media_id: String(item.id || item),
                type: item.type || item.media_type || '',
                title: item.title || item.name || '',
                poster_path: item.poster || item.poster_path || '',
                backdrop_path: item.backdrop || item.backdrop_path || '',
                release_date: item.release_date || '',
                vote_average: item.vote_average ? Number(item.vote_average) : 0,
                overview: item.overview || '',
                source: item.source || null,
                mal_id: item.mal_id ? String(item.mal_id) : (item.malId ? String(item.malId) : null),
                anime_id: item.anime_id ? String(item.anime_id) : null
              }));
              const { error: upsertItemsError } = await client
                .from('list_items')
                .upsert(itemRows, { onConflict: 'list_id,media_id' });
              if (upsertItemsError) {
                console.warn('[STORE] list_items upsert failed for list', listId, 'retrying with insert fallback:', upsertItemsError.message || upsertItemsError);
                const fallbackRows = itemRows.map(row => ({ ...row, list_id: listId }));
                const { error: insertFallbackError } = await client
                  .from('list_items')
                  .insert(fallbackRows);
                if (insertFallbackError) throw insertFallbackError;
              }
            }
          }
          } catch (profErr) {
            console.error('[STORE] Failed to sync profile ' + profile.id + ':', profErr.message || String(profErr));
            appendSyncLog('Failed to sync profile ' + profile.id + ': ' + (profErr.message || String(profErr)));
          }
        }
         // Quiet profiles sync log
         // console.log('[STORE] Profiles synchronized to Supabase.');
        writeLocalAppData(inMemorySession);
      }
    } catch (err) {
      console.error('[STORE] Failed to sync to Supabase:', err.message || String(err));
      appendSyncLog('Failed to sync to Supabase: ' + (err.message || String(err)));
    }
  }
  return inMemorySession;
}

function saveDataSync(data) {
  // Synchronous saving is deprecated since cloud operations are asynchronous
  console.log('[STORE] saveDataSync called (deprecated in cloud mode)');
}

const mainRealtimeProfileCache = new Map();
let mainRealtimeChannel = null;

async function setupMainRealtimeSubscription() {
  try {
    const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
    const serviceRoleKey = getSupabaseServiceRoleKey();
    const supabaseUrl = getSupabaseUrl();
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.warn('[STORE] Supabase URL or Service Role Key missing. Skipping main process Realtime subscription.');
      return;
    }

    // Set global WebSocket to use ws library so that Supabase Realtime works in Node.js
    if (typeof global.WebSocket === 'undefined' || global.WebSocket.name === 'DummyWebSocket') {
      try {
        global.WebSocket = require('ws');
        console.log('[STORE] Set global.WebSocket to ws library in main process.');
      } catch (err) {
        console.error('[STORE] Failed to load ws library for main-process WebSocket:', err.message);
      }
    }

    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (mainRealtimeChannel) {
      try {
        mainRealtimeChannel.unsubscribe();
      } catch (_) {}
      mainRealtimeChannel = null;
    }

    console.log('[STORE] Initializing main-process Realtime subscription for collection_messages...');
    
    mainRealtimeChannel = client
      .channel('main-process-chat-inserts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collection_messages'
        },
        async (payload) => {
          try {
            console.log('[STORE] Real-time message insert received in main process:', payload.new.id);
            const msg = payload.new;
            if (!msg) return;

            // Fetch sender profile information
            let profile_name = 'Friend';
            let profile_avatar = 'imgs/avatars/default.jpg';
            
            if (msg.profile_id) {
              if (mainRealtimeProfileCache.has(msg.profile_id)) {
                const cached = mainRealtimeProfileCache.get(msg.profile_id);
                profile_name = cached.name;
                profile_avatar = cached.avatar;
              } else {
                try {
                  const { data: prof, error: profErr } = await client
                    .from('account_profiles')
                    .select('name, avatar')
                    .eq('id', msg.profile_id)
                    .maybeSingle();
                  
                  if (!profErr && prof) {
                    const profData = Array.isArray(prof) ? prof[0] : prof;
                    profile_name = profData?.name || 'Friend';
                    profile_avatar = profData?.avatar || 'imgs/avatars/default.jpg';
                    mainRealtimeProfileCache.set(msg.profile_id, { name: profile_name, avatar: profile_avatar });
                  }
                } catch (profErr) {
                  console.warn('[STORE] Error loading profile for real-time message:', profErr.message);
                }
              }
            }

            const messagePayload = {
              ...msg,
              profile_name,
              profile_avatar
            };

            // Broadcast to all active Electron windows
            const { BrowserWindow } = require('electron');
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send('new-chat-message', messagePayload);
              }
            });
          } catch (e) {
            console.error('[STORE] Error processing main process Realtime insert:', e.message);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[STORE] Main process Realtime subscription status: ${status}`);
      });

  } catch (err) {
    console.error('[STORE] Failed to setup main process Realtime subscription:', err.message);
  }
}

function initStoreIpc(ipcMain) {
  setupMainRealtimeSubscription().catch(err => {
    console.error('[STORE] setupMainRealtimeSubscription failed:', err);
  });
  ipcMain.handle('load-app-data', async () => {
    return await loadData();
  });

  ipcMain.handle('save-app-data', async (e, payload) => {
    let appData = payload;
    let session = null;
    
    if (payload && payload.appData) {
      appData = payload.appData;
      session = payload.session;
    }
    
    return await saveData(appData, session);
  });

  ipcMain.handle('get-hardware-id', () => {
    return getHardwareId();
  });

  // Playback position - direct sync to cloud playback_history table
  ipcMain.handle('save-playback-position', async (e, { profileId, key, entry, localOnly, forceImmediate }) => {
    try {
      console.log('[STORE] Saving playback to local cache:', { profileId, key, time: entry?.time, localOnly, forceImmediate });

      // 1. Update in-memory session (local cache) so it is written to appData.json
      if (inMemorySession && Array.isArray(inMemorySession.profiles)) {
        const profile = inMemorySession.profiles.find(p => p.id === profileId);
        if (profile) {
          profile.playback = profile.playback || {};
          profile.playback[key] = entry;
          writeLocalAppData(inMemorySession, forceImmediate || false);

          // 2. Sync directly to Supabase playback_history table immediately if not localOnly
          if (!localOnly && inMemorySession.authenticated && inMemorySession.user) {
            try {
              let client;
              try {
                client = await getAuthenticatedClient();
              } catch (_) { /* will use hardware RPC fallback */ }

              if (client) {
                client.from('playback_history').upsert({
                  profile_id: profile.id,
                  media_id: key,
                  progress: entry?.time ? Number(entry.time) : 0,
                  duration: entry?.duration ? Number(entry.duration) : 0,
                  last_watched_at: entry?.lastWatched ? new Date(entry.lastWatched).toISOString() : new Date().toISOString(),
                  watched: entry?.watched ? true : false
                }, { onConflict: 'profile_id,media_id' }).then(res => {
                  if (res.error) console.error('[STORE] save-playback upsert failed:', res.error.message);
                  else console.log('[STORE] save-playback upsert success');
                }).catch(err => console.error('[STORE] save-playback upsert error:', err.message));
              } else {
                // Hardware-ID RPC fallback
                const hwId = getHardwareId();
                const { getClient } = require('../shared/supabaseClient');
                getClient().rpc('upsert_playback_by_hardware', {
                  p_hardware_id: hwId,
                  p_profile_id: profile.id,
                  p_media_id: key,
                  p_progress: entry?.time ? Number(entry.time) : 0,
                  p_duration: entry?.duration ? Number(entry.duration) : 0,
                  p_watched: entry?.watched ? true : false
                }).then(res => {
                  if (res.error) console.error('[STORE] save-playback hardware RPC failed:', res.error.message);
                  else console.log('[STORE] save-playback hardware RPC success');
                }).catch(err => console.error('[STORE] save-playback hardware RPC error:', err.message));
              }
            } catch (syncErr) {
              console.error('[STORE] save-playback client initialization failed:', syncErr.message);
            }
          }
        }
      }

      // 3. Notify other windows (like main renderer) about the progress update
      try {
        const { getMainWindow } = require('./windowManager');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('playback-updated', { profileId, key, entry });
        }
      } catch (winErr) {
        console.warn('[STORE] Failed to notify main window of playback update:', winErr.message);
      }

      return true;
    } catch (err) {
      console.error('[STORE] save-playback-position failed:', err.message || err);
      return false;
    }
  });

  ipcMain.handle('get-playback-position', async (e, { profileId, key }) => {
    try {
      const client = await getAuthenticatedClient();
      const { data, error } = await client
        .from('playback_history')
        .select('*')
        .eq('profile_id', profileId)
        .eq('media_id', key)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        return { time: Number(data.progress), lastWatched: new Date(data.last_watched_at).getTime() };
      }
      return null;
    } catch (err) {
      console.error('[STORE] get-playback-position supabase fetch failed:', err.message || err);
      return null;
    }
  });

  ipcMain.handle('get-profile-playback', async (e, profileId) => {
    try {
      let client;
      try {
        client = await getAuthenticatedClient();
      } catch (_) { /* will use hardware fallback below */ }

      if (client) {
        const { data, error } = await client
          .from('playback_history')
          .select('*')
          .eq('profile_id', profileId);
        if (error) throw error;
        
        const playbackObj = {};
        for (const row of (data || [])) {
          playbackObj[row.media_id] = {
            time: Number(row.progress),
            lastWatched: new Date(row.last_watched_at).getTime(),
            watched: row.watched || false
          };
        }
        return playbackObj;
      }

      // Fallback: use hardware-ID authenticated RPC
      const hwId = getHardwareId();
      const relData = await fetchNormalizedProfileDataByHardware(hwId, profileId);
      return relData ? (relData.playback || {}) : {};
    } catch (err) {
      console.error('[STORE] get-profile-playback supabase fetch failed:', err.message || err);
      return {};
    }
  });

  ipcMain.handle('clear-profile-playback', async (e, profileId) => {
    try {
      if (!profileId) return { error: 'No profileId provided' };
      const client = await getAuthenticatedClient();
      const { error } = await client
        .from('playback_history')
        .delete()
        .eq('profile_id', profileId);
      if (error) {
        console.error('[STORE] clear-profile-playback supabase delete failed:', error.message);
        return { error: error.message };
      }
      console.log('[STORE] clear-profile-playback success for profile:', profileId);
      return { success: true };
    } catch (err) {
      console.error('[STORE] clear-profile-playback failed:', err.message || err);
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('cloud-delete-playback-position', async (e, { profileId, mediaId }) => {
    try {
      if (!profileId || !mediaId) return { error: 'profileId and mediaId are required' };
      const client = await getAuthenticatedClient();
      const { error } = await client
        .from('playback_history')
        .delete()
        .eq('profile_id', profileId)
        .eq('media_id', mediaId);
      if (error) {
        console.error('[STORE] cloud-delete-playback-position supabase delete failed:', error.message);
        return { error: error.message };
      }
      console.log(`[STORE] cloud-delete-playback-position success for media: ${mediaId} under profile: ${profileId}`);
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-delete-playback-position failed:', err.message || err);
      return { error: err.message || String(err) };
    }
  });


  // Profile-specific Cloud mutations (CRUD)
  ipcMain.handle('cloud-create-profile', async (e, profileData) => {
    try {
      if (profileData && profileData.id) mainRealtimeProfileCache.delete(profileData.id);
      const res = await supabaseRpc('create_profile', { ...profileData });
      return res;
    } catch (err) { return { error: err.response?.data || err.message || String(err) }; }
  });

  ipcMain.handle('cloud-update-profile', async (e, profileData) => {
    try {
      if (profileData && profileData.id) mainRealtimeProfileCache.delete(profileData.id);
      const res = await supabaseRpc('update_profile', profileData); return res;
    } catch (err) { return { error: err.response?.data || err.message || String(err) }; }
  });

  ipcMain.handle('cloud-delete-profile', async (e, { id }) => {
    try { const res = await supabaseRpc('delete_profile', { profile_id: id }); return res; } catch (err) { return { error: err.response?.data || err.message || String(err) }; }
  });

  ipcMain.handle('cloud-verify-profile-pin', async (e, { profile_id, pin }) => {
    try { const r = await supabaseRpc('verify_profile_pin', { profile_id, pin }); return r?.valid === true; } catch (err) { return false; }
  });

  // Auth Operations
  ipcMain.handle('cloud-login', async (e, { email, password }) => {
    try {
      const hwId = getHardwareId();
      const res = await loginUser(email, password, hwId);
      // If login succeeded, persist session + profiles locally and attempt cloud sync
      if (res && res.success) {
        try {
          const session = res.session || { access_token: res.access_token };
          await saveData({ authenticated: true, user: res.user, profiles: res.profiles || [], activeProfileId: res.profiles?.[0]?.id || null }, session);
        } catch (e) {
          console.warn('[STORE] Post-login local+cloud save failed:', e.message || e);
        }
      }
      return res;
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  });

  ipcMain.handle('cloud-register', async (e, { email, password }) => {
    try {
      const res = await registerUser(email, password);
      // After successful registration, attempt to persist session/profile if returned
      if (res && res.success) {
        try {
          const session = res.session || { access_token: res.access_token };
          await saveData({ authenticated: true, user: res.user, profiles: res.profiles || [], activeProfileId: res.profiles?.[0]?.id || null }, session);
        } catch (e) {
          console.warn('[STORE] Post-register local+cloud save failed:', e.message || e);
        }
      }
      return res;
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  });

  ipcMain.handle('cloud-discord-login', async (e, { userId }) => {
    return { error: 'cloud-discord-login is deprecated. Use cloud-sync-user-session instead.' };
  });

  ipcMain.handle('clear-session', async (e) => {
    try {
      console.log('[STORE] Clearing session...');
      const hardwareId = getHardwareId();
      try {
        const { getClient } = require('../shared/supabaseClient');
        const client = getClient();
        const { data, error } = await client.rpc('handle_logout', { p_hardware_id: hardwareId });
        if (error) {
          console.warn('[STORE] Remote handle_logout RPC failed:', error.message);
        } else {
          console.log('[STORE] Remote device logout result:', data);
        }
      } catch (rpcErr) {
        console.warn('[STORE] Failed to invoke handle_logout RPC:', rpcErr.message);
      }

      inMemorySession = null;
      _cachedSupabaseSession = null;
      // Preserve device-level app config that is NOT tied to the account so that
      // logging out (or switching accounts) does not wipe the user's installed
      // Stremio addons — previously the clean object dropped installedAddons,
      // forcing the user to re-add every addon after each logout/login.
      const existing = readLocalAppData() || {};
      const clearedData = {
        authenticated: false,
        user: null,
        profiles: [],
        activeProfileId: null,
        installedAddons: Array.isArray(existing.installedAddons) ? existing.installedAddons : []
      };
      writeLocalAppData(clearedData, true);
      console.log('[STORE] Session cleared successfully (installed addons preserved)');
      return { success: true };
    } catch (err) {
      console.error('[STORE] clear-session failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-sync-user-session', async (e, { userId, email, username, session }) => {
    try {
      const { getClient } = require('../shared/supabaseClient');
      const client = getClient();
      if (session && session.access_token) {
        await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        // Cache session so saveData can use it even when renderer doesn't send it
        _cachedSupabaseSession = { access_token: session.access_token, refresh_token: session.refresh_token };
        // Persist session to local file so it survives restarts
        try {
          const current = readLocalAppData() || {};
          current._supabaseSession = _cachedSupabaseSession;
          writeLocalAppData(current);
        } catch (_) {}
      }
      const hwId = getHardwareId();
      const { syncUserSession } = require('../shared/cloudAuth');
      const result = await syncUserSession(userId, email, username, hwId);
      if (result.success) {
        inMemorySession = {
          ...(inMemorySession || {}),
          authenticated: true,
          user: result.user,
          _supabaseSession: _cachedSupabaseSession
        };
      }
      return result;
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  });

  // Media Catalog Filtering
  ipcMain.handle('cloud-fetch-catalog', async (e, { profile_id, query, type, limit, offset }) => {
    try {
      const response = await axios.get(`${getBackendUrl()}/api/media/catalog`, {
        params: { profile_id, query, type, limit, offset }
      });
      return response.data;
    } catch (err) {
      return { error: err.message, results: [] };
    }
  });

  // Content Request Tickets
  ipcMain.handle('cloud-fetch-requests', async (e, { user_id }) => {
    try {
      const response = await axios.get(`${getBackendUrl()}/api/requests`, { params: { user_id } });
      return response.data?.requests || [];
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('cloud-create-request', async (e, { user_id, title }) => {
    try {
      const response = await axios.post(`${getBackendUrl()}/api/requests`, { user_id, title });
      return response.data;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('cloud-update-request', async (e, { id, admin_id, status }) => {
    try {
      const response = await axios.put(`${getBackendUrl()}/api/requests`, { id, admin_id, status });
      return response.data;
    } catch (err) {
      return { error: err.message };
    }
  });

  // Super Admin mutations
  ipcMain.handle('cloud-admin-mutate', async (e, { admin_id, action, payload }) => {
    try {
      const response = await axios.post(`${getBackendUrl()}/api/admin/mutate`, { admin_id, action, payload });
      return response.data;
    } catch (err) {
      return { error: err.response?.data?.error || err.message };
    }
  });

  // Collaboration / Invitations Handlers
  ipcMain.handle('cloud-search-collaborators', async (e, { query_str }) => {
    try {
      const session = getInMemorySession();
      const caller_id = session?.user?.id || null;
      const client = await getAuthenticatedClient();
      const { data, error } = await client.rpc('search_collaborators', { query_str, caller_id });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-search-collaborators failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-get-user-id-by-username', async (e, { username }) => {
    try {
      const client = await getAuthenticatedClient();
      const { data, error } = await client.rpc('get_user_id_by_username', { username_val: username });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-get-user-id-by-username failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-invite-collaborator', async (e, { listId, targetUserId }) => {
    try {
      const session = getInMemorySession();
      const callerUserId = session?.user?.id;
      if (!callerUserId) {
        throw new Error('User not authenticated');
      }
      
      const client = await getAuthenticatedClient();
      
      // 1. Verify caller owns the list
      const { data: isOwner, error: ownerError } = await client.rpc('is_list_owner', { p_list_id: listId, p_user_id: callerUserId });
      if (ownerError) throw ownerError;
      if (!isOwner) {
        throw new Error('You do not own this list');
      }
      
      // 2. Verify target user allows invitations
      const { data: allowsInvites, error: inviteCheckError } = await client.rpc('user_allows_invites', { p_user_id: targetUserId });
      if (inviteCheckError) throw inviteCheckError;
      if (!allowsInvites) {
        return { success: false, blocked: true, message: 'الشخص دا قافل الدعوات !' };
      }
      
      // 3. Perform insert with status = 'pending' so get_pending_invitations can find it
      const { error: insertError } = await client
        .from('list_members')
        .insert({
          list_id: listId,
          user_id: targetUserId,
          role: 'member',
          status: 'pending'
        });
        
      if (insertError) {
        if (insertError.code === '23505') {
          return { success: false, exists: true, message: 'This user is already a collaborator/invited' };
        }
        throw insertError;
      }
      
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-invite-collaborator failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-refresh-custom-lists', async (e, { profileId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) {
        throw new Error('User not authenticated');
      }
      
      const client = await getAuthenticatedClient();
      
      // 1. Fetch owned lists
      const { data: listsData, error: clError } = await client
        .from('custom_lists')
        .select('id, profile_id, list_name, theme_color, list_items(media_id, type, title, poster_path, backdrop_path, release_date, vote_average, overview, source, mal_id, anime_id)')
        .eq('profile_id', profileId);
      if (clError) throw clError;
      
      // 2. Fetch shared lists
      let sharedLists = [];
      const { data: memberRefs } = await client
        .from('list_members')
        .select('list_id')
        .eq('user_id', currentUserId)
        .eq('status', 'joined');
        
      if (memberRefs && memberRefs.length > 0) {
        const sharedListIds = memberRefs.map(m => m.list_id);
        
        const fetchShared = async (dbClient) => {
          const { data, error } = await dbClient
            .from('custom_lists')
            .select('id, profile_id, list_name, theme_color, list_items(media_id, type, title, poster_path, backdrop_path, release_date, vote_average, overview, source, mal_id, anime_id)')
            .in('id', sharedListIds);
          if (error) throw error;
          return data;
        };

        try {
          sharedLists = await fetchShared(client) || [];
        } catch (sharedError) {
          console.warn('[STORE] Auth/RLS issue fetching shared lists, retrying with service_role client...', sharedError.message);
          const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
          const serviceRoleKey = getSupabaseServiceRoleKey();
          if (serviceRoleKey) {
            const { createClient } = require('@supabase/supabase-js');
            const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false }
            });
            sharedLists = await fetchShared(serviceClient) || [];
          }
        }
      }
      
      return { success: true, listsData, sharedLists };
    } catch (err) {
      console.error('[STORE] cloud-refresh-custom-lists failed:', err.message);
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('cloud-delete-custom-list', async (e, { listId, profileId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();

      const runQuery = async (dbClient) => {
        // Check ownership first
        const { data: listData, error: fetchErr } = await dbClient
          .from('custom_lists')
          .select('profile_id')
          .eq('id', listId)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (listData && listData.profile_id === profileId) {
          // Owner -> Delete list entirely
          const { error: deleteErr } = await dbClient
            .from('custom_lists')
            .delete()
            .eq('id', listId);
          if (deleteErr) throw deleteErr;
        } else {
          // Member -> Leave/Remove membership
          const { error: leaveErr } = await dbClient
            .from('list_members')
            .delete()
            .eq('list_id', listId)
            .eq('user_id', currentUserId);
          if (leaveErr) throw leaveErr;
        }
      };

      try {
        await runQuery(client);
      } catch (queryErr) {
        console.warn('[STORE] Auth/RLS issue during delete-custom-list, retrying with service_role client...');
        const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
        const serviceRoleKey = getSupabaseServiceRoleKey();
        if (serviceRoleKey) {
          const { createClient } = require('@supabase/supabase-js');
          const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          await runQuery(serviceClient);
        } else {
          throw queryErr;
        }
      }

      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-delete-custom-list failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-remove-list-item', async (e, { listId, mediaId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();

      const runQuery = async (dbClient) => {
        const { error: deleteErr } = await dbClient
          .from('list_items')
          .delete()
          .eq('list_id', listId)
          .eq('media_id', String(mediaId));
        if (deleteErr) throw deleteErr;
      };

      try {
        await runQuery(client);
      } catch (queryErr) {
        console.warn('[STORE] Auth/RLS issue during remove-list-item, retrying with service_role client...');
        const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
        const serviceRoleKey = getSupabaseServiceRoleKey();
        if (serviceRoleKey) {
          const { createClient } = require('@supabase/supabase-js');
          const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          await runQuery(serviceClient);
        } else {
          throw queryErr;
        }
      }

      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-remove-list-item failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-get-pending-invitations', async (e) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) {
        return { success: true, data: [] };
      }

      let client = await getAuthenticatedClient();
      let data;
      
      const runQuery = async (dbClient) => {
        const { data: resData, error: queryErr } = await dbClient.rpc('get_pending_invitations', { caller_id: currentUserId });
        if (queryErr) throw queryErr;
        return resData;
      };

      try {
        data = await runQuery(client);
      } catch (queryErr) {
        const isAuthError = queryErr.message?.includes('JWT') || 
                            queryErr.message?.includes('invalid signature') || 
                            queryErr.message?.includes('Unauthorized') || 
                            queryErr.status === 401 || 
                            queryErr.code === '42501';
                            
        if (isAuthError) {
          console.warn('[STORE] Auth error during get-pending-invitations, retrying with service_role client...');
          const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
          const serviceRoleKey = getSupabaseServiceRoleKey();
          if (serviceRoleKey) {
            const { createClient } = require('@supabase/supabase-js');
            const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false }
            });
            data = await runQuery(serviceClient);
          } else {
            throw queryErr;
          }
        } else {
          throw queryErr;
        }
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-get-pending-invitations failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-accept-invitation', async (e, { membershipId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      // Use the SECURITY DEFINER RPC — runs as postgres role, bypasses ALL RLS
      // Security enforced inside the SQL function via WHERE user_id = p_user_id
      const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
      const serviceRoleKey = getSupabaseServiceRoleKey();
      const { createClient } = require('@supabase/supabase-js');
      const dbClient = serviceRoleKey
        ? createClient(getSupabaseUrl(), serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
        : await getAuthenticatedClient();

      const { data: accepted, error } = await dbClient.rpc('accept_invitation', {
        p_membership_id: membershipId,
        p_user_id: currentUserId
      });

      if (error) throw error;

      console.log(`[STORE] cloud-accept-invitation: RPC returned ${accepted} for membership ${membershipId}`);
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-accept-invitation failed:', err.message);
      return { success: false, error: err.message };
    }
  });


  ipcMain.handle('cloud-decline-invitation', async (e, { membershipId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
      const serviceRoleKey = getSupabaseServiceRoleKey();
      let dbClient;

      if (serviceRoleKey) {
        const { createClient } = require('@supabase/supabase-js');
        dbClient = createClient(getSupabaseUrl(), serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } else {
        dbClient = await getAuthenticatedClient();
      }

      // Direct delete without chained select which fails on RLS
      const { error } = await dbClient
        .from('list_members')
        .delete()
        .eq('id', membershipId)
        .eq('user_id', currentUserId);

      if (error) throw error;
      
      console.log(`[STORE] cloud-decline-invitation: successfully declined membership ${membershipId}`);
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-decline-invitation failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-delete-chat-message', async (e, { messageId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();
      
      const runQuery = async (dbClient) => {
        const { data: msg, error: msgError } = await dbClient
          .from('collection_messages')
          .select('list_id')
          .eq('id', messageId)
          .maybeSingle();
        if (msgError) throw msgError;
        if (!msg) throw new Error('Message not found');

        const listId = msg.list_id;

        const { data: isOwner, error: ownerErr } = await dbClient.rpc('is_list_owner', { p_list_id: listId, p_user_id: currentUserId });
        if (ownerErr) throw ownerErr;
        if (!isOwner) {
          throw new Error('Only the list leader can delete messages');
        }

        const { error: deleteErr } = await dbClient
          .from('collection_messages')
          .delete()
          .eq('id', messageId);
        if (deleteErr) throw deleteErr;
      };

      try {
        await runQuery(client);
      } catch (queryErr) {
        console.warn('[STORE] Auth/RLS issue deleting chat message, retrying with service_role client...');
        const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
        const serviceRoleKey = getSupabaseServiceRoleKey();
        if (serviceRoleKey) {
          const { createClient } = require('@supabase/supabase-js');
          const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          await runQuery(serviceClient);
        } else {
          throw queryErr;
        }
      }
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-delete-chat-message failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-kick-list-member', async (e, { listId, targetUserId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();

      const runQuery = async (dbClient) => {
        const { data: isOwner, error: ownerErr } = await dbClient.rpc('is_list_owner', { p_list_id: listId, p_user_id: currentUserId });
        if (ownerErr) throw ownerErr;
        if (!isOwner) {
          throw new Error('Only the list leader can kick members');
        }

        const { error: kickErr } = await dbClient
          .from('list_members')
          .delete()
          .eq('list_id', listId)
          .eq('user_id', targetUserId);
        if (kickErr) throw kickErr;
      };

      try {
        await runQuery(client);
      } catch (queryErr) {
        console.warn('[STORE] Auth/RLS issue kicking list member, retrying with service_role client...');
        const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
        const serviceRoleKey = getSupabaseServiceRoleKey();
        if (serviceRoleKey) {
          const { createClient } = require('@supabase/supabase-js');
          const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          await runQuery(serviceClient);
        } else {
          throw queryErr;
        }
      }
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-kick-list-member failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-transfer-list-ownership', async (e, { listId, targetProfileId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();

      const runQuery = async (dbClient) => {
        const { data: isOwner, error: ownerErr } = await dbClient.rpc('is_list_owner', { p_list_id: listId, p_user_id: currentUserId });
        if (ownerErr) throw ownerErr;
        if (!isOwner) {
          throw new Error('Only the list leader can transfer leadership');
        }

        const { data: targetProfile, error: profErr } = await dbClient
          .from('account_profiles')
          .select('user_id')
          .eq('id', targetProfileId)
          .maybeSingle();
        if (profErr) throw profErr;
        if (!targetProfile) throw new Error('Target profile not found');
        const targetUserId = targetProfile.user_id;

        const { error: insertErr } = await dbClient
          .from('list_members')
          .insert({
            list_id: listId,
            user_id: currentUserId,
            role: 'member',
            status: 'joined'
          });
        if (insertErr && insertErr.code !== '23505') throw insertErr;

        const { error: updateErr } = await dbClient
          .from('custom_lists')
          .update({ profile_id: targetProfileId })
          .eq('id', listId);
        if (updateErr) throw updateErr;

        const { error: deleteErr } = await dbClient
          .from('list_members')
          .delete()
          .eq('list_id', listId)
          .eq('user_id', targetUserId);
        if (deleteErr) throw deleteErr;
      };

      try {
        await runQuery(client);
      } catch (queryErr) {
        console.warn('[STORE] Auth/RLS issue transferring ownership, retrying with service_role client...');
        const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
        const serviceRoleKey = getSupabaseServiceRoleKey();
        if (serviceRoleKey) {
          const { createClient } = require('@supabase/supabase-js');
          const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          await runQuery(serviceClient);
        } else {
          throw queryErr;
        }
      }
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-transfer-list-ownership failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-get-list-sharing-members', async (e, { listId, ownerProfileId }) => {
    try {
      const client = await getAuthenticatedClient();
      
      // 1. Fetch Owner Profile Info
      const { data: ownerProf, error: ownerError } = await client
        .from('account_profiles')
        .select('id, name, avatar')
        .eq('id', ownerProfileId)
        .maybeSingle();
      if (ownerError) throw ownerError;

      // 2. Fetch Joined Members Profile Info
      const { data: memberRows, error: memberError } = await client
        .from('list_members')
        .select('user_id')
        .eq('list_id', listId)
        .eq('status', 'joined');
      if (memberError) throw memberError;

      let joinedMemberProfiles = [];
      if (memberRows && memberRows.length > 0) {
        const memberUserIds = memberRows.map(m => m.user_id).filter(Boolean);
        if (memberUserIds.length > 0) {
          const { data: fetchedProfiles, error: profError } = await client
            .from('account_profiles')
            .select('id, name, avatar, user_id')
            .in('user_id', memberUserIds);
          if (profError) throw profError;
          joinedMemberProfiles = fetchedProfiles || [];
        }
      }

      return { success: true, ownerProf, joinedMemberProfiles };
    } catch (err) {
      console.error('[STORE] cloud-get-list-sharing-members failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-get-allow-invitations', async (e) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      const client = await getAuthenticatedClient();
      const { data, error } = await client
        .from('users_accounts')
        .select('allow_invitations')
        .eq('id', currentUserId)
        .single();
      
      if (error) throw error;
      return { success: true, allow_invitations: data?.allow_invitations !== false };
    } catch (err) {
      console.error('[STORE] cloud-get-allow-invitations failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-set-allow-invitations', async (e, { allowInvitations }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      const client = await getAuthenticatedClient();
      const { error } = await client
        .from('users_accounts')
        .update({ allow_invitations: allowInvitations })
        .eq('id', currentUserId);
      
      if (error) throw error;
      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-set-allow-invitations failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-load-chat-history', async (e, { listId }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();
      let data;
      
      const runQuery = async (dbClient) => {
        // Check if list exists in database first
        const { data: listExists, error: existsErr } = await dbClient
          .from('custom_lists')
          .select('id')
          .eq('id', listId)
          .maybeSingle();
        if (existsErr) throw existsErr;
        if (!listExists) {
          console.log('[STORE] List does not exist in database yet (new or offline list). Returning empty chat history.');
          return [];
        }

        // Use is_list_participant — matches the RLS policy on collection_messages exactly
        const { data: isParticipant, error: participantErr } = await dbClient.rpc('is_list_participant', { list_uuid: listId, user_uuid: currentUserId });
        if (participantErr) throw participantErr;
        if (!isParticipant) {
          throw new Error('Not authorized to access this list');
        }
        
        const { data: resData, error: queryErr } = await dbClient
          .from('collection_messages')
          .select(`
            id,
            message_text,
            created_at,
            profile_id,
            account_profiles (
              name,
              avatar,
              avatar_border_color
            )
          `)
          .eq('list_id', listId)
          .order('created_at', { ascending: true })
          .limit(100);
          
        if (queryErr) throw queryErr;
        return resData;
      };

      try {
        data = await runQuery(client);
      } catch (queryErr) {
        const isAuthError = queryErr.message?.includes('JWT') || 
                            queryErr.message?.includes('invalid signature') || 
                            queryErr.message?.includes('Unauthorized') || 
                            queryErr.status === 401 || 
                            queryErr.code === '42501';
                            
        if (isAuthError) {
          console.warn('[STORE] Auth error during load-chat-history, retrying with service_role client...');
          const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
          const serviceRoleKey = getSupabaseServiceRoleKey();
          if (serviceRoleKey) {
            const { createClient } = require('@supabase/supabase-js');
            const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false }
            });
            data = await runQuery(serviceClient);
          } else {
            throw queryErr;
          }
        } else {
          throw queryErr;
        }
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-load-chat-history failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-send-chat-message', async (e, { listId, profileId, text }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();
      let data;

      const runQuery = async (dbClient) => {
        // Use is_list_participant — matches the RLS policy on collection_messages exactly
        // (covers owner + joined members + admins)
        const { data: isParticipant, error: participantErr } = await dbClient.rpc('is_list_participant', { list_uuid: listId, user_uuid: currentUserId });
        if (participantErr) throw participantErr;
        if (!isParticipant) {
          throw new Error('Not authorized to access this list');
        }
        
        const { data: resData, error: queryErr } = await dbClient
          .from('collection_messages')
          .insert({
            list_id: listId,
            profile_id: profileId,
            message_text: text
          })
          .select()
          .single();
          
        if (queryErr) throw queryErr;
        return resData;
      };

      try {
        data = await runQuery(client);
      } catch (queryErr) {
        const isAuthError = queryErr.message?.includes('JWT') || 
                            queryErr.message?.includes('invalid signature') || 
                            queryErr.message?.includes('Unauthorized') || 
                            queryErr.status === 401 || 
                            queryErr.code === '42501';
                            
        if (isAuthError) {
          console.warn('[STORE] Auth error during send-chat-message, retrying with service_role client...');
          const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
          const serviceRoleKey = getSupabaseServiceRoleKey();
          if (serviceRoleKey) {
            const { createClient } = require('@supabase/supabase-js');
            const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false }
            });
            data = await runQuery(serviceClient);
          } else {
            throw queryErr;
          }
        } else {
          throw queryErr;
        }
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-send-chat-message failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-send-media-share', async (e, { listId, profileId, media }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      let client = await getAuthenticatedClient();

      // Insert media share as special message type
      const runQuery = async (dbClient) => {
        const { data: resData, error: insertErr } = await dbClient
          .from('collection_messages')
          .insert({
            list_id: listId,
            profile_id: profileId,
            message_text: `[MEDIA_SHARE]:${JSON.stringify({mediaId: media.id, title: media.title, posterUrl: media.poster, mediaType: media.type})}`
          })
          .select()
          .single();

        if (insertErr) throw insertErr;
        return resData;
      };

      try {
        data = await runQuery(client);
      } catch (queryErr) {
        const isAuthError = queryErr.message?.includes('JWT') || 
                            queryErr.message?.includes('invalid signature') || 
                            queryErr.message?.includes('Unauthorized') || 
                            queryErr.status === 401 || 
                            queryErr.code === '42501';
                            
        if (isAuthError) {
          console.warn('[STORE] Auth error during send-media-share, retrying with service_role client...');
          const { getSupabaseServiceRoleKey, getSupabaseUrl } = require('../shared/supabaseEnv');
          const serviceRoleKey = getSupabaseServiceRoleKey();
          if (serviceRoleKey) {
            const { createClient } = require('@supabase/supabase-js');
            const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey, {
              auth: { persistSession: false, autoRefreshToken: false }
            });
            data = await runQuery(serviceClient);
          } else {
            throw queryErr;
          }
        } else {
          throw queryErr;
        }
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('[STORE] cloud-send-media-share failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-upload-chat-image', async (e, { base64Data, mimeType }) => {
    try {
      const client = await getAuthenticatedClient();
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `chat/${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      
      const { data, error } = await client.storage
        .from('avatars')
        .upload(fileName, buffer, {
          contentType: mimeType,
          upsert: true
        });
        
      if (error) throw error;
      
      const { data: publicUrlData } = client.storage
        .from('avatars')
        .getPublicUrl(fileName);
        
      return { success: true, url: publicUrlData?.publicUrl };
    } catch (err) {
      console.error('[STORE] cloud-upload-chat-image failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('cloud-update-profile-avatar-color', async (e, { profileId, avatarBorderColor }) => {
    try {
      const session = getInMemorySession();
      const currentUserId = session?.user?.id;
      if (!currentUserId) throw new Error('User not authenticated');

      const client = await getAuthenticatedClient();

      // Verify the profile belongs to the current user
      const { data: profile, error: fetchErr } = await client
        .from('account_profiles')
        .select('id, user_id')
        .eq('id', profileId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!profile) throw new Error('Profile not found');
      if (profile.user_id !== currentUserId) throw new Error('Not authorized to update this profile');

      // Update avatar border color
      const { error: updateErr } = await client
        .from('account_profiles')
        .update({ avatar_border_color: avatarBorderColor })
        .eq('id', profileId);

      if (updateErr) throw updateErr;

      return { success: true };
    } catch (err) {
      console.error('[STORE] cloud-update-profile-avatar-color failed:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  USER_DATA, DATA_DIR, DATA_FILE, BANNERS_DIR, TEMP_DIR,
  ensureDir, loadData, saveData, saveDataSync, initStoreIpc,
  getHardwareId, readLocalAppData, writeLocalAppData, getInMemorySession
};
