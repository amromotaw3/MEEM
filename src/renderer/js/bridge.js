/**
 * MediaVault Bridge v4.0
 * Handles real API fetching, robust data persistence, and
 * INTERNAL VIDEO PLAYER for Android/Mobile.
 *
 * All "Play" actions on mobile use a native Internal Player
 * served via a localhost HTTP server to bypass file:// CORS.
 * Desktop playback uses Electron's built-in player.
 */
(function() {
    'use strict';

    const isElectron = !!(window.api);
    const isAndroid = !!(window.Capacitor);
    
    let Filesystem, Directory, Share, LocalServer;
    if (isAndroid) {
        Filesystem = window.Capacitor.Plugins.Filesystem;
        Share = window.Capacitor.Plugins.Share;
        LocalServer = window.Capacitor.Plugins.LocalServer;
        if (!LocalServer) {
            console.warn('[Bridge] LocalServer plugin NOT found in window.Capacitor.Plugins. Trying fallback...');
            // alert('Critical: Native LocalServer plugin not found. Please ensure you have rebuilt the app in Android Studio.');
        } else {
            console.log('[Bridge] LocalServer plugin successfully loaded.');
        }

        Directory = {
            Documents: 'DOCUMENTS',
            Data: 'DATA',
            External: 'EXTERNAL',
            ExternalStorage: 'EXTERNAL_STORAGE'
        };
    }

    console.log(`[Bridge] Environment: ${isElectron ? 'Electron' : (isAndroid ? 'Android' : 'Web')}`);

    if (isElectron) return;

    // Supabase configuration — set by supabase-public.js or preload (Electron)
    const SUPABASE_URL = window.SUPABASE_URL || window.MEDIAVAULT_SUPABASE_URL || window.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || window.MEDIAVAULT_SUPABASE_ANON_KEY || window.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[Bridge] Supabase config missing — load js/supabase-public.js or set env in .env');
    } else {
      console.log('[Bridge] Supabase configured:', SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0]);
    }

    const BACKEND_URL = (window.MEDIAVAULT_BACKEND_URL || '').replace(/\/$/, '');

    const pendingDeepLinkUrls = [];
    let activeDeepLinkHandler = null;

    // Strip auth secrets before logging URLs (deep links carry access_token,
    // refresh_token and the Google provider_token in the fragment/query).
    function redactUrl(u) {
        if (!u || typeof u !== 'string') return u;
        return u.replace(/((?:access|refresh|provider|provider_refresh)_token|code|id_token)=[^&#\s]+/gi, '$1=***');
    }

    function dispatchDeepLink(url) {
        if (!url) return;
        console.log('[Bridge] Dispatching deep link:', redactUrl(url));
        if (activeDeepLinkHandler) {
            activeDeepLinkHandler(url);
        } else {
            pendingDeepLinkUrls.push(url);
        }
    }

    function unwrapRpcRow(data) {
      if (data == null) return null;
      if (Array.isArray(data)) {
        if (data.length === 0) return null;
        if (data.length === 1 && data[0] && typeof data[0] === 'object') return data[0];
        return data[0];
      }
      return data;
    }

    async function fetchNormalizedProfileData(client, profileId) {
        // 1. Fetch watchlist_items
        const { data: watchlistData, error: wlError } = await client
            .from('watchlist_items')
            .select('*')
            .eq('profile_id', profileId);
        if (wlError) {
            console.error('[Bridge] load watchlist error:', wlError.message);
            throw wlError;
        }

        // 2. Fetch playback_history
        const { data: playbackData, error: pbError } = await client
            .from('playback_history')
            .select('*')
            .eq('profile_id', profileId);
        if (pbError) {
            console.error('[Bridge] load playback error:', pbError.message);
            throw pbError;
        }

        // 3. Fetch locked_items
        const { data: lockedData, error: lError } = await client
            .from('locked_items')
            .select('*')
            .eq('profile_id', profileId);
        if (lError) {
            console.error('[Bridge] load locked error:', lError.message);
            throw lError;
        }

        // Preserve local-only watchlist items (not yet synced to DB)
        const localProf = localProfiles.find(p => p.id === profileId);
        const localWatchlist = localProf?.watchlist || [];
        const dbWatchlistIds = new Set((watchlistData || []).map(row => row.media_id));
        const localOnlyWatchlist = localWatchlist.filter(item => !dbWatchlistIds.has(item.id));

        const watchlist = [
            ...(watchlistData || []).map(row => ({
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
            })),
            ...localOnlyWatchlist
        ];

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

        // 4. Fetch custom_lists and list_items
        const { data: listsData, error: clError } = await client
            .from('custom_lists')
            .select('id, profile_id, list_name, theme_color, list_items(media_id, type, title, poster_path, backdrop_path, release_date, vote_average, overview, source, mal_id, anime_id)')
            .eq('profile_id', profileId);
        if (clError) {
            console.error('[Bridge] load custom lists error:', clError.message);
            throw clError;
        }

        // Fetch shared lists
        let sharedLists = [];
        try {
            const { data: { user } } = await client.auth.getUser();
            if (user && user.id) {
                const { data: memberRefs } = await client
                    .from('list_members')
                    .select('list_id')
                    .eq('user_id', user.id)
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
            console.warn('[Bridge] Failed to load shared lists:', e.message);
        }

        // Preserve local-only lists (not yet synced to DB)
        const localProfile = localProfiles.find(p => p.id === profileId);
        const localOnlyLists = (localProfile?.custom_lists || []).filter(localList => {
            const isInDb = (listsData || []).some(dbList => dbList.id === localList.id);
            const isInShared = sharedLists.some(sharedList => sharedList.id === localList.id);
            return !isInDb && !isInShared;
        });

        const combinedLists = [...(listsData || [])];
        const ownedIds = new Set(combinedLists.map(l => l.id));
        for (const list of sharedLists) {
            if (!ownedIds.has(list.id)) {
                combinedLists.push(list);
            }
        }

        // Merge local-only lists with DB lists
        const finalLists = [...combinedLists];
        for (const localList of localOnlyLists) {
            if (!finalLists.some(l => l.id === localList.id)) {
                finalLists.push(localList);
            }
        }

        const custom_lists = finalLists.map(row => ({
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

    async function cloudAuthHttp(path, body) {
      if (!BACKEND_URL) {
        return { error: 'Cloud sign-in requires MEDIAVAULT_BACKEND_URL (deploy api/ to Vercel or run vercel dev).' };
      }
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
      });
      let data;
      try { data = await res.json(); } catch (e) { data = { error: 'Invalid server response' }; }
      if (!res.ok && !data.error) data.error = data.message || `Request failed (${res.status})`;
      return data;
    }

    let _supabaseClient = null;
    function getSupabaseClient() {
        if (typeof window.getSupabaseRendererClient === 'function') {
            return window.getSupabaseRendererClient();
        }
        if (_supabaseClient) return _supabaseClient;
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            return _supabaseClient;
        }
        return null;
    }

    async function supabaseRpc(fn, body = {}) {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');

        const client = getSupabaseClient();
        if (client) {
            const { data, error } = await client.rpc(fn, body);
            if (error) throw error;
            return data;
        }

        const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Supabase RPC ${fn} failed: ${res.status} ${text}`);
        }
        try { return await res.json(); } catch (e) { return null; }
    }

    async function supabaseTable(method, table, params = {}) {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
        const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`);
        if (params.q) url.search = params.q;
        const headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        const res = await fetch(url.href, { method, headers, body: params.body ? JSON.stringify(params.body) : undefined });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Supabase table ${table} ${method} failed: ${res.status} ${text}`);
        }
        if (res.status === 204) return null;
        return await res.json();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PLAY MEDIA SERVICE — Internal Player via Local HTTP Server
    // ═══════════════════════════════════════════════════════════════════
    //  All "Play" actions on mobile go through this service.
    //  Phase 3: Local HTTP Server serves files at http://localhost
    //  Phase 4: InternalPlayer component renders HTML5 <video>
    // ═══════════════════════════════════════════════════════════════════
    const PlayMediaService = {
        /**
         * Determine the type of media source.
         * @returns {'magnet'|'torrent_file'|'http_stream'|'local_file'|'content_uri'|'unknown'}
         */
        _classifySource(url) {
            if (!url) return 'unknown';
            if (url.startsWith('magnet:')) return 'magnet';
            if (/^[a-fA-F0-9]{40}$/.test(url)) return 'magnet';
            if (url.toLowerCase().endsWith('.torrent')) return 'torrent_file';
            if (url.startsWith('http://') || url.startsWith('https://')) return 'http_stream';
            if (url.startsWith('content://')) return 'content_uri';
            if (url.startsWith('file://')) return 'local_file';
            if (url.startsWith('/')) return 'local_file';
            return 'local_file';
        },

        /**
         * Guess the MIME type from a file path/URL extension.
         */
        _guessMime(path) {
            if (!path) return 'video/*';
            const ext = path.split('.').pop()?.toLowerCase();
            const mimeMap = {
                mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
                webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
                flv: 'video/x-flv', wmv: 'video/x-ms-wmv', ts: 'video/mp2t',
                mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp',
                mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac',
                ogg: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac',
                opus: 'audio/opus', wma: 'audio/x-ms-wma',
                torrent: 'application/x-bittorrent'
            };
            return mimeMap[ext] || 'video/*';
        },

        /**
         * Resolve a Capacitor-relative path to an absolute native file:// URI.
         * Used by the Local HTTP Server (Phase 3) to locate files on disk.
         */
        async _resolveToNativeUri(filePath) {
            if (filePath.startsWith('content://')) return { uri: filePath, directory: null };
            if (filePath.startsWith('file://')) return { uri: filePath, directory: null };
            if (filePath.startsWith('/')) return { uri: `file://${filePath}`, directory: null };
            if (filePath.startsWith('http')) return { uri: filePath, directory: null };

            const dirsToTry = [
                Directory.Documents, Directory.External,
                Directory.ExternalStorage, Directory.Data
            ];

            for (const dir of dirsToTry) {
                try {
                    const result = await Filesystem.getUri({ path: filePath, directory: dir });
                    if (result && result.uri) {
                        console.log(`[PlayMediaService] Resolved "${filePath}" → "${result.uri}" (dir=${dir})`);
                        return { uri: result.uri, directory: dir };
                    }
                } catch (e) {
                    console.log(`[PlayMediaService] Not found in ${dir}: ${e.message || e}`);
                }
            }

            console.warn('[PlayMediaService] Could not resolve path, using raw:', filePath);
            return { uri: filePath, directory: Directory.External };
        },

        /**
         * Start the local HTTP server (auto-starts if not running).
         * @returns {Promise<{url: string, port: number}>}
         */
        async _ensureServer() {
            if (!LocalServer) {
                console.warn('[PlayMediaService] LocalServer plugin not available');
                return null;
            }
            try {
                const result = await LocalServer.start({ port: 8976 });
                console.log('[PlayMediaService] Local server running at', result.url);
                return result;
            } catch (e) {
                console.error('[PlayMediaService] Failed to start local server:', e);
                return null;
            }
        },

        /**
         * Serve a local file through the localhost server.
         * @param {string} nativePath - Absolute file path (with or without file:// prefix)
         * @returns {Promise<string|null>} The localhost URL to stream from, or null on failure
         */
        async _serveViaLocalhost(nativePath) {
            if (!LocalServer) return null;
            try {
                await this._ensureServer();
                const result = await LocalServer.serveFile({ path: nativePath });
                if (result && result.url) {
                    console.log(`[PlayMediaService] ✓ Success: Serving via ${result.url}`);
                    return result.url;
                }
                throw new Error('LocalServer returned invalid result');
            } catch (e) {
                console.error('[PlayMediaService] ✗ Failed to serve file:', e);
                window.dispatchEvent(new CustomEvent('toast', { detail: 'Server Error: ' + (e.message || 'Check logs') }));
                return null;
            }
        },

        /**
         * Universal entry point — routes to Internal Player via Local HTTP Server.
         *
         * For local files: resolves path → serves via localhost → returns streamable URL
         * For HTTP streams: passes URL directly (no server needed)
         * For magnets: hands off to OS via intent:// scheme
         *
         * @param {string} url  - Magnet link, HTTP URL, or local file path
         * @param {object} meta - Optional metadata (title, etc.)
         * @returns {Promise<{success: boolean, streamUrl?: string, method?: string, error?: string}>}
         */
        async play(url, meta = {}) {
            if (!url) return { success: false, error: 'No URL provided' };

            const sourceType = this._classifySource(url);
            console.log(`[PlayMediaService] play("${url.substring(0, 80)}...") → type=${sourceType}`, meta.title || '');

            // Magnet links & Torrent files: hand off to OS via native intent
            if (sourceType === 'magnet' || sourceType === 'torrent_file') {
                let magnetUrl = url;
                if (/^[a-fA-F0-9]{40}$/.test(url)) {
                    magnetUrl = `magnet:?xt=urn:btih:${url}&tr=udp://tracker.opentrackr.org:1337/announce`;
                }

                if (isAndroid) {
                    if (!LocalServer) {
                        console.warn('[PlayMediaService] LocalServer plugin missing from window.Capacitor.Plugins');
                        if (window.showToast) window.showToast('Native Bridge not found. Please rebuild the app.');
                    } else {
                        try {
                            console.log('[PlayMediaService] Opening magnet/torrent via native intent:', magnetUrl);
                            await LocalServer.openUrl({ url: magnetUrl });
                            return { success: true, method: 'native-intent' };
                        } catch (e) {
                            console.error('[PlayMediaService] Native intent failed:', e);
                            if (window.showToast) window.showToast('Native Error: ' + (e.message || 'Check if a torrent app is installed'));
                        }
                    }
                }

                // Fallback to legacy methods
                try {
                    const intentUrl = `intent:${magnetUrl.substring(magnetUrl.indexOf(':') + 1)}#Intent;scheme=magnet;end`;
                    window.location.href = intentUrl;
                    return { success: true, method: 'intent-scheme' };
                } catch (e) {
                    if (window.showToast) window.showToast('Fallback failed: ' + e.message);
                    window.open(magnetUrl, '_system');
                    return { success: true, method: 'window.open' };
                }
            }

            // HTTP streams: pass directly to internal player (no server needed)
            if (sourceType === 'http_stream') {
                console.log('[PlayMediaService] HTTP stream → Internal Player:', url);
                return { success: true, streamUrl: url, method: 'direct-http' };
            }

            // Local files: resolve path → convert to WebView-friendly URL
            if (sourceType === 'local_file' || sourceType === 'content_uri') {
                const resolved = await this._resolveToNativeUri(url);
                console.log('[PlayMediaService] Resolved native URI:', resolved.uri);

                // Use the official Capacitor way to convert file:// or content:// to a streamable URL
                if (window.Capacitor && window.Capacitor.convertFileSrc) {
                    const webUrl = window.Capacitor.convertFileSrc(resolved.uri);
                    console.log('[PlayMediaService] ✓ Success: Using convertFileSrc:', webUrl);
                    return { success: true, streamUrl: webUrl, method: 'capacitor-convert' };
                }

                // Fallback to local server if convertFileSrc is missing
                const localhostUrl = await this._serveViaLocalhost(resolved.uri);
                if (localhostUrl) {
                    console.log('[PlayMediaService] ✓ Fallback: Streaming via localhost:', localhostUrl);
                    return { success: true, streamUrl: localhostUrl, method: 'local-server' };
                }

                return { success: true, streamUrl: resolved.uri, method: 'direct-uri-fallback' };
            }

            return { success: false, error: `Unhandled source type: ${sourceType}` };
        }
    };

    // Expose globally so renderer.js can use it
    window.PlayMediaService = PlayMediaService;

    // --- State & Helpers ---
    const STORAGE_KEY = 'mediavault_app_data'; // Stored via Capacitor Storage on mobile, in-memory fallback on web

    // In-memory session cache (populated from cloud on boot)
    let cloudSession = null;

    // Cross-platform storage helpers. Persistence layers, in order:
    //   1. @capacitor/preferences (native, survives restart) — best on Android
    //   2. localStorage — also survives restart in the Capacitor Android WebView and
    //      in the browser, so the app stays logged in even before the native plugin is
    //      installed via `npx cap sync`
    //   3. in-memory Map — last resort, keeps values stable within the session
    const _memoryStore = new Map();
    // Prefer @capacitor/preferences (Capacitor 4+), fall back to the legacy
    // @capacitor/storage plugin name if present.
    function _nativeStore() {
        return window.Capacitor?.Plugins?.Preferences || window.Capacitor?.Plugins?.Storage || null;
    }
    function _lsGet(key) {
        try { return (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null; } catch (_) { return null; }
    }
    function _lsSet(key, value) {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch (_) { /* quota/disabled */ }
    }
    function _lsRemove(key) {
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (_) { /* ignore */ }
    }
    async function storageGet(key) {
        try {
            const Storage = _nativeStore();
            if (Storage && Storage.get) {
                const res = await Storage.get({ key });
                if (res && res.value != null) return res.value;
            }
        } catch (e) {
            console.warn('[Bridge] storageGet (native) failed:', e.message);
        }
        const ls = _lsGet(key);
        if (ls != null) return ls;
        return _memoryStore.has(key) ? _memoryStore.get(key) : null;
    }
    async function storageSet(key, value) {
        // Always keep an in-memory + localStorage copy so values survive within the
        // session and across restarts even if the native plugin is unavailable.
        _memoryStore.set(key, value);
        _lsSet(key, value);
        try {
            const Storage = _nativeStore();
            if (Storage && Storage.set) {
                await Storage.set({ key, value });
            }
            return true;
        } catch (e) {
            console.warn('[Bridge] storageSet (native) failed:', e.message);
            return true; // localStorage/memory copy already written
        }
    }
    async function storageRemove(key) {
        _memoryStore.delete(key);
        _lsRemove(key);
        try {
            const Storage = _nativeStore();
            if (Storage && Storage.remove) {
                await Storage.remove({ key });
            }
            return true;
        } catch (e) {
            console.warn('[Bridge] storageRemove (native) failed:', e.message);
            return true;
        }
    }

    async function storageClear() {
        _memoryStore.clear();
        try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch (_) { /* ignore */ }
        try {
            const Storage = _nativeStore();
            if (Storage && Storage.clear) {
                await Storage.clear();
            }
            return true;
        } catch (e) {
            console.warn('[Bridge] storageClear failed:', e.message);
            return false;
        }
    }

    // Initialize cloud session based on hardware ID via Supabase device session RPC
    async function initCloudSession() {
        try {
            const hw = await getHardwareId();
            if (!hw) return;

            // 1) Hardware-level ban check via Supabase RPC
            try {
                const banResult = await supabaseRpc('check_hardware_ban', { hardware_id: hw });
                if (banResult && Array.isArray(banResult) && banResult.length > 0) {
                    const reason = banResult[0].reason || 'This device has been banned.';
                    showBannedOverlay(reason);
                    return;
                } else {
                    await storageRemove('mediavault_device_banned');
                }
            } catch (e) {
                console.warn('[Bridge] check_hardware_ban RPC failed:', e.message);
                // Try backend HTTP fallback if RPC is broken (ambiguous hardware_id error)
                try {
                    const backend = 'http://localhost:3000';
                    const fb = await fetch(`${backend}/api/auth/device-session?hardware_id=${encodeURIComponent(hw)}`);
                    if (fb && fb.status === 403) {
                        showBannedOverlay('Banned (backend)');
                        return;
                    } else if (fb && fb.ok) {
                        await storageRemove('mediavault_device_banned');
                    }
                } catch (fbErr) { /* ignore fallback errors */ }
            }

            // 2) Request device session via Supabase RPC (server-side handles binding and limits)
            let resp = null;
            try {
                resp = await supabaseRpc('device_session', { hardware_id: hw });
            } catch (e) {
                console.warn('[Bridge] device_session RPC failed:', e.message);
                // If RPC fails due to ambiguous hardware_id in server function, try HTTP fallback
                try {
                    const backend = 'http://localhost:3000';
                    const fb = await fetch(`${backend}/api/auth/device-session?hardware_id=${encodeURIComponent(hw)}`);
                    if (fb && fb.ok) {
                        const data = await fb.json();
                        resp = data;
                    }
                } catch (fbErr) { console.warn('[Bridge] device_session backend fallback failed:', fbErr.message); }
            }

            const sessionRow = unwrapRpcRow(resp);
            if (sessionRow && sessionRow.authenticated) {
                cloudSession = { user: sessionRow.user, profiles: sessionRow.profiles || [] };
                console.log('[Bridge] Cloud session initialized for', cloudSession.user?.email || 'unknown');
                window.cloudSession = cloudSession;
                await storageRemove('mediavault_device_banned');
            } else {
                console.log('[Bridge] Device not authenticated via Supabase');
            }
        } catch (e) {
            console.warn('[Bridge] initCloudSession failed:', e.message);
        }
    }

    // Get Android device hardware ID — persistent across app restarts.
    // Cached in-memory so it stays IDENTICAL for every call within a session even if
    // the persistent store is unavailable. Without this, a missing storage/Device
    // plugin produced a brand-new random ID on each call, registering a new device
    // every time and quickly hitting DEVICE_LIMIT_REACHED.
    let _cachedHardwareId = null;
    async function getHardwareId() {
        if (!isAndroid) return 'web-unknown';
        if (_cachedHardwareId) return _cachedHardwareId;

        let storedId = await storageGet('mediavault_device_id');
        if (storedId && String(storedId).trim()) {
            _cachedHardwareId = String(storedId).trim();
            return _cachedHardwareId;
        }

        try {
            const Device = window.Capacitor?.Plugins?.Device;
            if (Device && typeof Device.getId === 'function') {
                const info = await Device.getId();
                const nativeId = info?.identifier || info?.uuid;
                if (nativeId && String(nativeId).trim()) {
                    storedId = 'android-' + String(nativeId).trim();
                    await storageSet('mediavault_device_id', storedId);
                    _cachedHardwareId = storedId;
                    return storedId;
                }
            }
        } catch (e) {
            console.warn('[Bridge] Device.getId failed, using generated ID:', e.message);
        }

        const uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString();
        storedId = 'android-' + uuid;
        await storageSet('mediavault_device_id', storedId);
        _cachedHardwareId = storedId;
        return storedId;
    }

    // Kick off session init (async IIFE).
    // NOTE: must run AFTER getHardwareId / _cachedHardwareId are declared above,
    // otherwise initCloudSession() hits the temporal-dead-zone error
    // "Cannot access '_cachedHardwareId' before initialization".
    (async () => { await initCloudSession(); })();


    // --- Filesystem Helpers ---
    async function safeMkdir(path) {
        if (!isAndroid) return;
        try {
            // Attempt 1: Public Documents (Preferred for user access)
            await Filesystem.mkdir({
                path: path,
                directory: Directory.Documents,
                recursive: true
            });
            console.log(`[Filesystem] Created (Public): ${path}`);
            return { directory: Directory.Documents, path };
        } catch (e) {
            console.warn(`[Filesystem] Public failed for ${path}, using Sandbox fallback.`, e.message);
            try {
                // Attempt 2: App Data Sandbox (Safe fallback)
                await Filesystem.mkdir({
                    path: path,
                    directory: Directory.Data,
                    recursive: true
                });
                console.log(`[Filesystem] Created (Sandbox): ${path}`);
                return { directory: Directory.Data, path };
            } catch (err2) {
                console.error(`[Filesystem] FATAL: All storage attempts failed for ${path}`, err2.message);
                throw err2;
            }
        }
    }
    async function readDirRobust(dirPath) {
        let results = [];
        if (!dirPath) return results;

        const cleanPath = dirPath.replace(/^\/+/, '').replace(/\/+$/, '');
        
        // Try native Java file listing first
        if (LocalServer) {
            try {
                const res = await LocalServer.listFiles({ path: dirPath });
                if (res.exists && res.files) {
                    const items = Array.isArray(res.files) ? res.files : Array.from(res.files || []);
                    return items.map(f => ({ name: f.name || '', type: f.type || 'file', uri: f.uri }));
                }
            } catch (e) {
                console.warn(`[Bridge/Native] readDirRobust failed for "${dirPath}":`, e.message);
            }
        }

        // Fallback: Capacitor Filesystem
        const dirsToTry = ['DOCUMENTS', 'EXTERNAL_STORAGE'];
        for (const d of dirsToTry) {
            try {
                const { files } = await Filesystem.readdir({ path: cleanPath, directory: d });
                if (files && files.length > 0) {
                    return files.map(f => {
                        const name = typeof f === 'string' ? f : (f.name || '');
                        const isDir = typeof f === 'string' ? !name.includes('.') : (f.type === 'directory');
                        return { name, type: isDir ? 'directory' : 'file' };
                    });
                }
            } catch (e) { /* silent fallback */ }
        }
        return results;
    }

    // --- The Bridge ---
    window.api = {
        isElectron: false,
        isMobile: () => isAndroid,
        // Window Controls
        minimizeWindow: () => {},
        maximizeWindow: () => {},
        closeWindow: () => {},
        // Cross-platform storage access (Capacitor Storage on mobile, localStorage on web)
        storageGet: storageGet,
        storageSet: storageSet,
        storageRemove: storageRemove,
        storageClear: storageClear,

        // Persistence — Stored via Capacitor Storage on mobile
        loadData: async () => {
            try {
                const storedRaw = await storageGet(STORAGE_KEY);
                let localData = null;
                if (storedRaw) {
                    try {
                        localData = JSON.parse(storedRaw);
                    } catch (e) {
                        console.warn('[Bridge] Failed to parse stored appData:', e.message);
                    }
                }
                
                const hwId = await getHardwareId();

                if (localData && localData.authenticated === false) {
                    console.log('[Bridge] User is logged out (localData.authenticated === false). Skipping device auto-login.');
                    return {
                        ...localData,
                        hardwareId: hwId
                    };
                }
                
                console.log(`[Bridge] Loading cloud session for device: ${hwId}`);

                // 1️⃣ Perform online ban check first if online
                let isHardwareBanned = false;
                let banReasonText = '';
                if (navigator.onLine) {
                    try {
                        const banResult = await supabaseRpc('check_hardware_ban', { hardware_id: hwId });
                        if (banResult && Array.isArray(banResult) && banResult.length > 0) {
                            banReasonText = banResult[0].reason || 'This device has been banned.';
                            await storageSet('mediavault_device_banned', 'true');
                            isHardwareBanned = true;
                        } else {
                            await storageRemove('mediavault_device_banned');
                        }
                    } catch (e) {
                        console.warn('[Bridge] check_hardware_ban RPC failed:', e.message);
                    }
                }

                if (isHardwareBanned) {
                    return { banned: true, banReason: banReasonText, hardwareId: hwId };
                }

                // 2️⃣ Check if locally flagged as banned to prevent offline bypass
                const isLocallyBanned = await storageGet('mediavault_device_banned');
                if (isLocallyBanned === 'true' || isLocallyBanned === true) {
                    return { banned: true, banReason: 'Permanently Banned (Offline Signature)', hardwareId: hwId };
                }

                // Try to load/restore Supabase session
                let session = null;
                const storedSession = await storageGet('mediavault_supabase_session');
                if (storedSession) {
                    try {
                        session = JSON.parse(storedSession);
                        const client = getSupabaseClient();
                        if (client && session) {
                            await client.auth.setSession({
                                access_token: session.access_token,
                                refresh_token: session.refresh_token
                            });
                        }
                    } catch (e) {
                        console.warn('[Bridge] Failed to restore stored session:', e.message);
                    }
                }

                // Device session via Supabase RPC
                let cloudData = null;
                try { 
                    cloudData = await supabaseRpc('device_session', { hardware_id: hwId }); 
                } catch (e) { 
                    console.warn('[Bridge] device_session failed:', e.message); 
                }

                let sessionRow = unwrapRpcRow(cloudData);
                if (sessionRow && !sessionRow.authenticated) {
                    const isBanned = sessionRow.user &&
                        (sessionRow.user.is_banned === true || sessionRow.user.is_banned === 'true');

                    if (isBanned) {
                        // Account is banned — block regardless of any local session.
                        console.warn('[Bridge] User is banned:', sessionRow.user.email);
                        await storageSet('mediavault_device_banned', 'true');
                        const cleared = {
                            ...(localData || {}),
                            authenticated: false, user: null, profiles: [], activeProfileId: null,
                            banned: true, banReason: 'Your account has been suspended.'
                        };
                        await storageSet(STORAGE_KEY, JSON.stringify(cleared));
                        return { ...cleared, hardwareId: hwId };
                    }

                    // Not banned: device_session only said "no" because this device isn't
                    // bound yet (typical for Google/Discord OAuth users). If a VALID
                    // Supabase Auth session exists, the user IS logged in — bind the device
                    // and continue instead of destroying the session. This is the login-loop fix.
                    let supaUser = null;
                    try {
                        const client = getSupabaseClient();
                        if (client) {
                            const { data: ures } = await client.auth.getUser();
                            supaUser = ures?.user || null;
                        }
                    } catch (e) { /* no valid Supabase session */ }

                    if (supaUser && supaUser.id) {
                        console.log('[Bridge] device_session=false but valid Supabase session present — recovering instead of wiping.');

                        // Best-effort: bind this device so device_session works next launch.
                        // (Skipped silently if the register_device RPC isn't deployed yet.)
                        try {
                            const reg = unwrapRpcRow(await supabaseRpc('register_device', { p_user_id: supaUser.id, p_hardware_id: hwId }));
                            if (reg && reg.error === 'DEVICE_LIMIT_REACHED') {
                                const cleared = {
                                    ...(localData || {}),
                                    authenticated: false, user: null, profiles: [], activeProfileId: null,
                                    deviceLimit: true, banReason: reg.message || 'Device limit reached.'
                                };
                                await storageSet(STORAGE_KEY, JSON.stringify(cleared));
                                return { ...cleared, hardwareId: hwId };
                            }
                        } catch (e) { console.warn('[Bridge] register_device during load failed:', e.message); }

                        // The valid Supabase session is the source of truth — build an
                        // authenticated row directly so a logged-in user is never wiped
                        // (works even before the register_device migration is deployed).
                        // Shape matches device_session: raw users_accounts + account_profiles rows.
                        sessionRow = { authenticated: true, user: { id: supaUser.id, email: supaUser.email }, profiles: [] };
                        try {
                            const client = getSupabaseClient();
                            const { data: accData } = await client.from('users_accounts').select('*').eq('id', supaUser.id).maybeSingle();
                            const { data: profData } = await client.from('account_profiles').select('*').eq('user_id', supaUser.id);
                            if (accData) sessionRow.user = accData;
                            if (profData) sessionRow.profiles = profData;
                        } catch (e) {
                            console.warn('[Bridge] Supabase recovery fetch failed (continuing with session user):', e.message);
                        }
                    }

                    // Still not authenticated (no valid Supabase session) → genuine logout.
                    if (sessionRow && !sessionRow.authenticated) {
                        console.warn('[Bridge] No valid session — clearing local auth state.');
                        const cleared = {
                            ...(localData || {}),
                            authenticated: false, user: null, profiles: [], activeProfileId: null
                        };
                        await storageSet(STORAGE_KEY, JSON.stringify(cleared));
                        return { ...cleared, hardwareId: hwId };
                    }
                }
                if (sessionRow && sessionRow.authenticated) {
                    await storageRemove('mediavault_device_banned');
                    const client = getSupabaseClient();
                    const profiles = sessionRow.profiles || [];
                    if (client && profiles.length) {
                        for (const cloudProf of profiles) {
                            try {
                                const relData = await fetchNormalizedProfileData(client, cloudProf.id);
                                Object.assign(cloudProf, relData);
                            } catch (relErr) {
                                console.error(`[Bridge] Failed to fetch relational data for profile ${cloudProf.id}:`, relErr.message);
                                const localProf = (localData?.profiles || []).find(p => p.id === cloudProf.id);
                                if (localProf) {
                                    cloudProf.watchlist = localProf.watchlist || [];
                                    cloudProf.playback = localProf.playback || {};
                                    cloudProf.lockedItems = localProf.lockedItems || localProf.locked_items || [];
                                    cloudProf.custom_lists = localProf.custom_lists || [];
                                }
                            }
                        }
                    }
                    cloudSession = {
                        user: sessionRow.user,
                        profiles: profiles,
                        activeProfileId: profiles?.[0]?.id || null,
                        authenticated: true,
                        hardwareId: hwId
                    };
                    window.cloudSession = cloudSession;
                    
                    return {
                        ...(localData || {}),
                        ...cloudSession,
                        authenticated: true
                    };
                }

                if (localData) {
                    return {
                        ...localData,
                        hardwareId: hwId
                    };
                }

                // Fallback guest state
                return {
                    authenticated: false,
                    user: null,
                    profiles: [],
                    activeProfileId: null,
                    hardwareId: hwId
                };
            } catch (e) {
                console.error('[Bridge] Cloud load failed:', e.message);
                return { authenticated: false, user: null, profiles: [], activeProfileId: null };
            }
        },

        saveData: async (data) => {
            try {
                if (!data) return false;
                const toSave = data.appData ? data.appData : data;
                await storageSet(STORAGE_KEY, JSON.stringify(toSave));
                
                if (toSave._supabaseSession === null) {
                    await storageRemove('mediavault_supabase_session');
                } else if (data.session) {
                    await storageSet('mediavault_supabase_session', JSON.stringify(data.session));
                }

                if (toSave.authenticated && toSave.user && toSave.user.id) {
                    const client = getSupabaseClient();
                    if (client) {
                        const storedSession = await storageGet('mediavault_supabase_session');
                        const activeSession = data.session || (storedSession ? JSON.parse(storedSession) : null);
                        if (activeSession) {
                            try {
                                await client.auth.setSession({
                                    access_token: activeSession.access_token,
                                    refresh_token: activeSession.refresh_token
                                });
                            } catch (sErr) {
                                console.warn('[Bridge] setSession in saveData failed:', sErr.message);
                            }
                        }

                        // Sync profiles to Supabase
                        if (toSave.profiles && Array.isArray(toSave.profiles)) {
                            for (const profile of toSave.profiles) {
                                if (profile.user_id && profile.user_id !== toSave.user.id) {
                                    continue;
                                }
                                try {
                                    // 1. Direct metadata upsert
                                    const { error: profileError } = await client
                                        .from('account_profiles')
                                        .upsert({
                                            id: profile.id,
                                            user_id: toSave.user.id,
                                            name: profile.name,
                                            avatar: profile.avatar || null,
                                            max_age_rating: typeof profile.max_age_rating !== 'undefined' ? parseInt(profile.max_age_rating, 10) : 18,
                                            profile_pin: profile.vaultPin || profile.pin || null,
                                            banner: profile.banner || null
                                        }, { onConflict: 'id' });
                                    if (profileError) throw profileError;

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
                                            media_id: item.id,
                                            type: item.type || item.media_type || 'movie',
                                            title: item.title || 'Untitled',
                                            poster_path: item.poster || null,
                                            rating: item.rating ? Number(item.rating) : null,
                                            added_at: item.listedAt ? new Date(item.listedAt).toISOString() : new Date().toISOString(),
                                            source: item.source || null,
                                            mal_id: item.mal_id ? String(item.mal_id) : (item.malId ? String(item.malId) : null),
                                            anime_id: item.anime_id ? String(item.anime_id) : null,
                                            backdrop_path: item.backdrop_path || item.backdrop || null,
                                            release_date: item.release_date || null,
                                            overview: item.overview || null
                                        }));

                                        const { error: upsertWlError } = await client
                                            .from('watchlist_items')
                                            .upsert(watchlistRows, { onConflict: 'profile_id,media_id' });
                                        if (upsertWlError) throw upsertWlError;
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

                                    const dbListsByName = new Map((dbLists || []).map(x => [x.list_name.toLowerCase(), x]));
                                    const localListsByName = new Set(localLists.map(x => x.name.toLowerCase()));

                                    const listsToDelete = (dbLists || []).filter(x => !localListsByName.has(x.list_name.toLowerCase()));
                                    if (listsToDelete.length > 0) {
                                        const listIdsToDelete = listsToDelete.map(x => x.id);
                                        const { error: delListsError } = await client
                                            .from('custom_lists')
                                            .delete()
                                            .in('id', listIdsToDelete);
                                        if (delListsError) throw delListsError;
                                    }

                                    // Leave shared lists that the user removed locally
                                    const { data: userMemberships, error: membError } = await client
                                        .from('list_members')
                                        .select('list_id')
                                        .eq('user_id', toSave.user.id)
                                        .eq('status', 'joined');
                                    if (!membError && userMemberships && userMemberships.length > 0) {
                                        const localListsIds = new Set(localLists.map(x => x.id));
                                        const membershipsToRemove = userMemberships
                                            .filter(m => !localListsIds.has(m.list_id))
                                            .map(m => m.list_id);
                                        
                                        if (membershipsToRemove.length > 0) {
                                            const { error: leaveError } = await client
                                                .from('list_members')
                                                .delete()
                                                .eq('user_id', toSave.user.id)
                                                .in('list_id', membershipsToRemove);
                                            if (leaveError) console.error('[Bridge] Failed to leave shared lists:', leaveError.message);
                                        }
                                    }

                                    for (const localList of localLists) {
                                        let listId = localList.id;
                                        const isShared = localList.profile_id && localList.profile_id !== profile.id;

                                        if (!isShared) {
                                            const upsertData = {
                                                profile_id: profile.id,
                                                list_name: localList.name,
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
                                                console.warn('[Bridge] List upsert warning:', listUpsertError.message);
                                                const { data: listSelectData } = await client
                                                    .from('custom_lists')
                                                    .select('id')
                                                    .eq('profile_id', profile.id)
                                                    .eq('list_name', localList.name)
                                                    .maybeSingle();
                                                if (listSelectData) {
                                                    listId = listSelectData.id;
                                                    localList.id = listSelectData.id;
                                                }
                                            } else if (listUpsertData) {
                                                listId = listUpsertData.id;
                                                localList.id = listUpsertData.id;
                                            }
                                        }

                                        if (!listId) {
                                            console.error('[Bridge] Could not retrieve ID for custom list:', localList.name);
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
                                            if (upsertItemsError) throw upsertItemsError;
                                        }
                                    }
                                } catch (profErr) {
                                    console.error('[Bridge] Failed to sync profile ' + profile.id + ':', profErr.message);
                                }
                            }
                            console.log('[Bridge] Profiles synchronized to Supabase.');
                        }

                        const tmdbKeyVal = toSave.tmdbKey || '';
                        const subdlKeyVal = toSave.subdlConfig?.apiKey || toSave.subdlKey || '';
                        const fanartKeyVal = toSave.fanartKey || '';
                        const traktVal = toSave.trakt || {};

                        const subdlEnabledVal = toSave.subdlConfig?.enabled ?? false;
                        const subdlLangsVal = Array.isArray(toSave.subdlConfig?.languages) 
                            ? toSave.subdlConfig.languages.join(',') 
                            : 'AR,EN';
                        const subdlHiVal = toSave.subdlConfig?.hearingImpairment || 'hiInclude';

                        try {
                            const { error: keyError } = await client
                                .from('users_accounts')
                                .update({
                                    tmdb_api_key: tmdbKeyVal || null,
                                    subdl_api_key: subdlKeyVal || null,
                                    fanart_api_key: fanartKeyVal || null,
                                    subdl_enabled: subdlEnabledVal,
                                    subdl_languages: subdlLangsVal,
                                    subdl_hearing_impairment: subdlHiVal,
                                    trakt_access_token: traktVal.accessToken || null,
                                    trakt_refresh_token: traktVal.refreshToken || null,
                                    trakt_created_at: traktVal.createdAt || null,
                                    trakt_expires_in: traktVal.expiresIn || null
                                })
                                .eq('id', toSave.user.id);
                            if (keyError) {
                                console.error('[Bridge] Failed to sync API keys to users_accounts:', keyError.message);
                            } else {
                                console.log('[Bridge] API keys successfully synchronized to users_accounts.');
                            }
                        } catch (err) {
                            console.error('[Bridge] Failed to sync users_accounts:', err.message);
                        }
                    }
                }

                await storageSet(STORAGE_KEY, JSON.stringify(toSave));
                return toSave;
            } catch (e) {
                console.error('[Bridge] Save Error:', e.message);
                return false;
            }
        },


        // --- Cloud Auth Operations ---
        cloudLogin: async (email, password) => {
            const hwId = await getHardwareId();
            try {
                let result;
                if (isAndroid && SUPABASE_URL && SUPABASE_ANON_KEY) {
                    result = unwrapRpcRow(await supabaseRpc('handle_secure_login', { email, password, hardware_id: hwId }));
                } else if (BACKEND_URL) {
                    result = await cloudAuthHttp('/api/auth/login', { email, password, hardware_id: hwId });
                } else {
                    result = unwrapRpcRow(await supabaseRpc('handle_secure_login', { email, password, hardware_id: hwId }));
                }
                if (result && (result.success || result.user)) {
                    cloudSession = {
                        user: result.user,
                        profiles: result.profiles || [],
                        activeProfileId: result.profiles?.[0]?.id || null,
                        authenticated: true,
                        hardwareId: hwId
                    };
                    window.cloudSession = cloudSession;
                }
                return result;
            } catch (e) {
                console.error('[Bridge] cloudLogin error:', e.message);
                return { error: e.message };
            }
        },


        cloudRegister: async (email, password) => {
            try {
                if (isAndroid && SUPABASE_URL && SUPABASE_ANON_KEY) {
                    return unwrapRpcRow(await supabaseRpc('handle_register', { email, password, hardware_id: null }));
                }
                if (BACKEND_URL) {
                    return await cloudAuthHttp('/api/auth/register', { email, password });
                }
                return unwrapRpcRow(await supabaseRpc('handle_register', { email, password, hardware_id: null }));
            } catch (e) {
                console.error('[Bridge] cloudRegister error:', e.message);
                return { error: e.message };
            }
        },

        cloudSyncUserSession: async (userId, email, username, session) => {
            try {
                const client = getSupabaseClient();
                if (client && session) {
                    await client.auth.setSession({
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    });
                }
                const hwId = await getHardwareId();

                // Bind this device to the account so device_session() recognises it on
                // subsequent launches. Without this, OAuth (Google/Discord) devices were
                // never registered in user_devices → device_session returned
                // authenticated:false → the client wiped the valid session → login loop.
                try {
                    const reg = unwrapRpcRow(await supabaseRpc('register_device', { p_user_id: userId, p_hardware_id: hwId }));
                    if (reg && reg.error === 'DEVICE_LIMIT_REACHED') {
                        return { error: 'DEVICE_LIMIT_REACHED', message: reg.message };
                    }
                    if (reg && (reg.error === 'HARDWARE_BANNED' || reg.error === 'ACCOUNT_BANNED')) {
                        await storageSet('mediavault_device_banned', 'true');
                        return { error: reg.error, message: reg.message };
                    }
                } catch (e) {
                    console.warn('[Bridge] register_device failed (continuing):', e.message);
                }

                // Fetch the actual record from Supabase public.users_accounts directly
                let subExpiresAt = null;
                let tmdbKeyVal = null;
                let subdlKeyVal = null;
                let fanartKeyVal = null;
                let subdlEnabledVal = false;
                let subdlLangsVal = 'AR,EN';
                let subdlHiVal = 'hiInclude';
                let traktAccessTokenVal = null;
                let traktRefreshTokenVal = null;
                let traktCreatedAtVal = null;
                let traktExpiresInVal = null;

                if (client) {
                    const { data: accData, error: accError } = await client
                        .from('users_accounts')
                        .select('*')
                        .eq('id', userId)
                        .maybeSingle();
                    if (!accError && accData) {
                        subExpiresAt = accData.subscription_expires_at;
                        tmdbKeyVal = accData.tmdb_api_key;
                        subdlKeyVal = accData.subdl_api_key;
                        fanartKeyVal = accData.fanart_api_key;
                        subdlEnabledVal = accData.subdl_enabled;
                        subdlLangsVal = accData.subdl_languages || 'AR,EN';
                        subdlHiVal = accData.subdl_hearing_impairment || 'hiInclude';
                        traktAccessTokenVal = accData.trakt_access_token;
                        traktRefreshTokenVal = accData.trakt_refresh_token;
                        traktCreatedAtVal = accData.trakt_created_at;
                        traktExpiresInVal = accData.trakt_expires_in;
                    }
                }

                // Fetch profiles from Supabase public.account_profiles directly
                let dbProfiles = [];
                if (client) {
                    const { data: profData, error: profError } = await client
                        .from('account_profiles')
                        .select('*')
                        .eq('user_id', userId);
                    if (!profError && profData) {
                        dbProfiles = profData.map(p => ({
                            id: p.id,
                            user_id: p.user_id,
                            name: p.name,
                            avatar: p.avatar,
                            max_age_rating: p.max_age_rating ?? 18,
                            vaultPin: p.profile_pin || p.pin || null,
                            banner: p.banner || null
                        }));
                    }
                }

                // If no profiles exist in the DB, let's create a default profile so the app doesn't break
                if (dbProfiles.length === 0) {
                    const defaultProfile = {
                        id: 'prof_' + userId + '_default',
                        user_id: userId,
                        name: username || email.split('@')[0] || 'Default',
                        avatar: null,
                        max_age_rating: 18,
                        vaultPin: null,
                        banner: null
                    };
                    if (client) {
                        await client.from('account_profiles').upsert({
                            id: defaultProfile.id,
                            user_id: defaultProfile.user_id,
                            name: defaultProfile.name,
                            avatar: defaultProfile.avatar,
                            max_age_rating: defaultProfile.max_age_rating,
                            profile_pin: defaultProfile.vaultPin,
                            banner: defaultProfile.banner
                        });
                    }
                    dbProfiles.push(defaultProfile);
                }

                const result = {
                    success: true,
                    user: { 
                        id: userId, 
                        email: email, 
                        username: username || '',
                        subscription_expires_at: subExpiresAt,
                        tmdb_api_key: tmdbKeyVal,
                        subdl_api_key: subdlKeyVal,
                        fanart_api_key: fanartKeyVal,
                        subdl_enabled: subdlEnabledVal,
                        subdl_languages: subdlLangsVal,
                        subdl_hearing_impairment: subdlHiVal,
                        trakt_access_token: traktAccessTokenVal,
                        trakt_refresh_token: traktRefreshTokenVal,
                        trakt_created_at: traktCreatedAtVal,
                        trakt_expires_in: traktExpiresInVal
                    },
                    profiles: dbProfiles,
                    message: "Synchronized user session directly from Supabase."
                };

                cloudSession = {
                    user: result.user,
                    profiles: result.profiles || [],
                    activeProfileId: result.profiles?.[0]?.id || null,
                    authenticated: true,
                    hardwareId: hwId
                };
                window.cloudSession = cloudSession;

                return result;
            } catch (e) {
                console.error('[Bridge] cloudSyncUserSession failed:', e.message);
                return { error: e.message };
            }
        },

        cloudOAuthLogin: async (url) => {
            console.log('[Bridge] Opening OAuth in system browser:', url);
            if (isAndroid) {
                const Browser = window.Capacitor?.Plugins?.Browser;
                if (Browser && typeof Browser.open === 'function') {
                    await Browser.open({ url, toolbarColor: '#050508' });
                    return true;
                }
                const LocalServer = window.Capacitor?.Plugins?.LocalServer;
                if (LocalServer && typeof LocalServer.openUrl === 'function') {
                    await LocalServer.openUrl({ url });
                    return true;
                }
                console.warn('[Bridge] Browser plugin missing — falling back to window.open');
                window.open(url, '_system');
            } else {
                window.open(url, '_blank');
            }
            return true;
        },

        onDeepLink: (cb) => {
            if (!isAndroid) return () => {};
            activeDeepLinkHandler = cb;
            while (pendingDeepLinkUrls.length) {
                cb(pendingDeepLinkUrls.shift());
            }

            const App = window.Capacitor?.Plugins?.App;
            if (!App) {
                console.warn('[Bridge] Capacitor App plugin not available for deep links');
                return () => { activeDeepLinkHandler = null; };
            }

            const deliverLaunchUrl = () => {
                App.getLaunchUrl().then((launchData) => {
                    if (launchData && launchData.url) {
                        dispatchDeepLink(launchData.url);
                    }
                }).catch((err) => {
                    console.warn('[Bridge] Failed to retrieve launch URL:', err);
                });
            };

            const listener = App.addListener('appUrlOpen', (data) => {
                console.log('[Bridge] Deep link received (appUrlOpen):', redactUrl(data?.url));
                if (data && data.url) {
                    dispatchDeepLink(data.url);
                }
            });

            App.addListener('resume', () => {
                deliverLaunchUrl();
            });

            setTimeout(deliverLaunchUrl, 300);
            setTimeout(deliverLaunchUrl, 1200);

            return () => {
                activeDeepLinkHandler = null;
                listener.then(h => h.remove()).catch(err => {
                    console.warn('[Bridge] Failed to remove appUrlOpen listener:', err);
                });
            };
        },


        // --- Cloud Profile CRUD ---
        cloudCreateProfile: async (profileData) => {
            try {
                const payload = { ...profileData, user_id: cloudSession?.user?.id };
                if (payload.pin !== undefined) {
                    payload.profile_pin = payload.pin;
                    delete payload.pin;
                }
                return await supabaseRpc('create_profile', payload);
            } catch (e) { console.error('[Bridge] create_profile RPC error:', e.message); return { error: e.message }; }
        },
        cloudUpdateProfile: async (profileData) => {
            try {
                const payload = { ...profileData };
                if (payload.pin !== undefined) {
                    payload.profile_pin = payload.pin;
                    delete payload.pin;
                }
                return await supabaseRpc('update_profile', payload);
            } catch (e) { console.error('[Bridge] update_profile RPC error:', e.message); return { error: e.message }; }
        },
        cloudDeleteProfile: async (id) => {
            try { return await supabaseRpc('delete_profile', { profile_id: id }); } catch (e) { console.error('[Bridge] delete_profile RPC error:', e.message); return { error: e.message }; }
        },
        cloudVerifyProfilePin: async (profile_id, pin) => {
            try {
                const r = await supabaseRpc('verify_profile_pin', { profile_id, pin });
                return r?.valid === true || false;
            } catch (e) { console.error('[Bridge] verify_profile_pin RPC error:', e.message); return false; }
        },


        // --- Playback Position Sync ---
        savePlaybackPosition: async (profileId, key, entry) => {
            if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
                return false;
            }
            try {
                const client = getSupabaseClient();
                if (!client) return false;
                const { error } = await client
                    .from('playback_history')
                    .upsert({
                        profile_id: profileId,
                        media_id: key,
                        progress: entry?.time ? Number(entry.time) : 0,
                        duration: entry?.duration ? Number(entry.duration) : 0,
                        last_watched_at: entry?.lastWatched ? new Date(entry.lastWatched).toISOString() : new Date().toISOString(),
                        watched: entry?.watched ? true : false
                    }, { onConflict: 'profile_id,media_id' });
                return !error;
            } catch (e) {
                console.error('[Bridge] savePlaybackPosition failed:', e.message);
                return false;
            }
        },
        getPlaybackPosition: async (profileId, key) => {
            if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
                return null;
            }
            try {
                const client = getSupabaseClient();
                if (!client) return null;
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
            } catch (e) {
                console.error('[Bridge] getPlaybackPosition failed:', e.message);
                return null;
            }
        },
        getProfilePlayback: async (profileId) => {
            if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
                return {};
            }
            try {
                const client = getSupabaseClient();
                if (!client) return {};
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
            } catch (e) {
                console.error('[Bridge] getProfilePlayback failed:', e.message);
                return {};
            }
        },


        // --- Content Requests ---
        cloudCreateRequest: async (title) => {
            try { return await supabaseRpc('create_movie_request', { user_id: cloudSession?.user?.id, title }); } catch (e) { console.error('[Bridge] create_movie_request RPC failed:', e.message); return { error: e.message }; }
        },
        cloudFetchRequests: async () => {
            try { const r = await supabaseRpc('fetch_movie_requests', { user_id: cloudSession?.user?.id }); return r || []; } catch (e) { console.error('[Bridge] fetch_movie_requests RPC failed:', e.message); return []; }
        },

        // --- Admin Mutations (Super Admin only) ---
        cloudAdminMutate: async (action, payload) => {
            try { return await supabaseRpc('admin_mutation', { admin_id: cloudSession?.user?.id, action, payload }); } catch (e) { console.error('[Bridge] admin_mutation RPC failed:', e.message); return { error: e.message }; }
        },


        // --- Session helpers ---
        getCloudSession: () => cloudSession,
        getHardwareId: getHardwareId,

        requestFileSystemPermissions: async () => {
            if (!isAndroid) return true;
            try {
                console.log('[Bridge] Requesting Filesystem Permissions...');
                // Step 1: Request standard Capacitor storage permissions
                const status = await Filesystem.requestPermissions();
                console.log('[Bridge] Capacitor permission result:', JSON.stringify(status));

                // Step 2: Check for MANAGE_EXTERNAL_STORAGE (needed on Android 11+ to see user-placed files)
                if (LocalServer) {
                    try {
                        const allFilesCheck = await LocalServer.checkAllFilesAccess();
                        console.log('[Bridge] All Files Access:', allFilesCheck.granted);
                        if (!allFilesCheck.granted) {
                            console.log('[Bridge] Requesting All Files Access via system settings...');
                            await LocalServer.requestAllFilesAccess();
                            // The user is taken to Settings — we return true but they need to grant it
                            return true;
                        }
                    } catch (e) {
                        console.warn('[Bridge] All Files Access check failed (may not be needed):', e.message);
                    }
                }
                return true;
            } catch (e) {
                console.error('[Bridge] Permission Request Error:', e);
                return false;
            }
        },

        // TMDB functions removed — use Cinemeta/Kitsu APIs instead

        cinemetaSearch: async (query) => {
            try {
                const q = String(query).trim();
                if (!q) return { results: [] };
                
                const movieUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q)}.json`;
                const seriesUrl = `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(q)}.json`;
                
                const [movieResp, seriesResp] = await Promise.all([
                    fetch(movieUrl).then(r => r.json()).catch(() => ({ metas: [] })),
                    fetch(seriesUrl).then(r => r.json()).catch(() => ({ metas: [] }))
                ]);
                
                const movies = movieResp?.metas || [];
                const series = seriesResp?.metas || [];
                
                const results = [
                    ...movies.map(r => ({ ...r, media_type: 'movie' })),
                    ...series.map(r => ({ ...r, media_type: 'tv' }))
                ];
                return { results };
            } catch (err) {
                console.error('[Bridge Cinemeta Search] Error:', err);
                return { results: [], error: err.message };
            }
        },

        cinemetaDiscoverByGenre: async (genre) => {
            try {
                const movieUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/genre=${encodeURIComponent(genre)}.json`;
                const seriesUrl = `https://v3-cinemeta.strem.io/catalog/series/top/genre=${encodeURIComponent(genre)}.json`;
                
                const [movieResp, seriesResp] = await Promise.all([
                    fetch(movieUrl).then(r => r.json()).catch(() => ({ metas: [] })),
                    fetch(seriesUrl).then(r => r.json()).catch(() => ({ metas: [] }))
                ]);
                
                const results = [
                    ...(movieResp?.metas || []).map(r => ({ ...r, media_type: 'movie' })),
                    ...(seriesResp?.metas || []).map(r => ({ ...r, media_type: 'tv' }))
                ];
                return { results };
            } catch (err) {
                return { results: [], error: err.message };
            }
        },

        cinemetaCatalog: async (opts) => {
            try {
                const { type, id } = opts || {};
                const cinemetaType = type === 'tv' ? 'series' : 'movie';
                const catalogId = id || 'top';
                const url = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/${catalogId}.json`;
                const resp = await fetch(url).then(r => r.json());
                return resp;
            } catch (err) {
                console.error('[Bridge Cinemeta Catalog] Error:', err);
                return { metas: [] };
            }
        },

        cinemetaDetails: async (opts) => {
            try {
                const { id, type } = opts || {};
                const cinemetaType = type === 'tv' ? 'series' : 'movie';
                let cinemetaUrl;
                if (id && id.toString().startsWith('tt')) {
                    cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cinemetaType}/${id}.json`;
                } else {
                    const tmdbId = id && id.toString().startsWith('tmdb:') ? id : (id ? `tmdb:${id}` : 'tmdb:0');
                    cinemetaUrl = `https://tmdb.elfhosted.com/meta/${cinemetaType}/${tmdbId}.json`;
                }
                
                const resp = await fetch(cinemetaUrl).then(r => r.json());
                const cinemetaMeta = resp?.meta || resp || null;
                
                const result = {
                    id: id || cinemetaMeta?.id || null,
                    type: type === 'tv' ? 'tv' : 'movie',
                    title: cinemetaMeta?.name || cinemetaMeta?.title || null,
                    synopsis: cinemetaMeta?.overview || cinemetaMeta?.description || null,
                    year: cinemetaMeta?.year || cinemetaMeta?.released || null,
                    runtime: cinemetaMeta?.runtime || null,
                    rating: cinemetaMeta?.imdbRating || cinemetaMeta?.rating || null,
                    genres: cinemetaMeta?.genres || [],
                    imdb_id: cinemetaMeta?.imdb_id || (cinemetaMeta?.id?.startsWith('tt') ? cinemetaMeta.id : null),
                    tmdb_id: cinemetaMeta?.moviedb_id || cinemetaMeta?.moviedbId || null,
                    tvdb_id: cinemetaMeta?.tvdb_id || null,
                    mal_id: null,
                    posters: { primary: null, fallback: null, extras: [] },
                    banners: [],
                    clearlogos: [],
                    backdrops: [],
                    meta: cinemetaMeta || null,
                    source: { metadata: 'cinemeta', visuals: 'cinemeta' }
                };

                result.posters.primary = cinemetaMeta?.poster || cinemetaMeta?.thumbnail || null;
                result.posters.fallback = cinemetaMeta?.poster || cinemetaMeta?.background || null;
                result.backdrops = cinemetaMeta?.background ? [cinemetaMeta.background] : [];
                result.clearlogos = cinemetaMeta?.logo ? [cinemetaMeta.logo] : [];
                result.banners = cinemetaMeta?.banner ? [cinemetaMeta.banner] : [];
                
                const fanartKey = await storageGet('mediavault_fanart_key');
                let fanartId = result.imdb_id || (type === 'tv' ? result.tvdb_id : result.tmdb_id);
                if (fanartKey && fanartId) {
                    try {
                        const fanartType = type === 'tv' ? 'tv' : 'movies';
                        const fanartUrl = `https://webservice.fanart.tv/v3/${fanartType}/${fanartId}?api_key=${fanartKey}`;
                        const fanartResp = await fetch(fanartUrl).then(r => r.ok ? r.json() : null).catch(() => null);
                        if (fanartResp) {
                            const posters = (fanartResp.movieposter || fanartResp.tvposter || []).map(x => x.url);
                            const backdrops = (fanartResp.moviebackground || fanartResp.showbackground || []).map(x => x.url);
                            const clearlogos = (fanartResp.hdmovielogo || fanartResp.hdtvlogo || fanartResp.movielogo || fanartResp.clearlogo || []).map(x => x.url);
                            const banners = (fanartResp.moviebanner || fanartResp.tvbanner || []).map(x => x.url);
                            
                            result.clearlogos = clearlogos;
                            result.banners = banners;
                            result.backdrops = backdrops;
                            result.posters.extras = [...posters, ...banners, ...backdrops];
                            if (posters[0]) result.posters.primary = posters[0];
                            result.source.visuals = 'fanart.tv';
                            if (result.meta) {
                                result.meta.logo = clearlogos[0] || result.meta.logo;
                                result.meta.banner = banners[0] || result.meta.banner;
                                result.meta.background = backdrops[0] || result.meta.background;
                                result.meta.poster = posters[0] || result.meta.poster;
                            }
                        }
                    } catch (e) {
                        console.warn('[Bridge Fanart] Error:', e.message);
                    }
                }
                
                return result;
            } catch (err) {
                console.error('[Bridge Cinemeta Details] Error:', err);
                return { meta: null, error: err.message };
            }
        },

        downloadImage: async (url, id, force) => {
            return url;
        },

        mapKitsu: (media) => {
            return (media || []).map(m => {
                const attr = m.attributes || {};
                return {
                    id: m.id,
                    title: attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp || 'Unknown',
                    name: attr.canonicalTitle || attr.titles?.en || 'Unknown',
                    overview: attr.synopsis,
                    poster_path: attr.posterImage?.original || attr.posterImage?.large || '',
                    backdrop_path: attr.coverImage?.original || attr.coverImage?.large || '',
                    vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
                    first_air_date: attr.startDate || '',
                    media_type: 'anime',
                    source: 'kitsu',
                    episodes: attr.episodeCount || 1,
                    format: attr.subtype,
                    status: attr.status,
                    trailer: attr.youtubeVideoId ? { id: attr.youtubeVideoId, site: 'youtube' } : null,
                    certification: attr.ageRating || attr.ageRatingGuide || null,
                    contentRating: attr.ageRating || attr.ageRatingGuide || null,
                    content_rating: attr.ageRating || attr.ageRatingGuide || null
                };
            });
        },

        // Kitsu (Anime)
        kitsuTrending: async () => {
            return { results: [] };
        },
        kitsuSearch: async (query) => {
            return { results: [] };
        },

        // Downloads & Streaming IPC
        // Scrapers (Stremio-compatible)
        searchAddons: async ({ imdbId, kitsuId, type, season, episode, title }) => {
            console.log(`[Bridge] Scraping for ${title} (${type})`);
            const results = [];
            const stremioType = type === 'movie' ? 'movie' : 'series';
            
            // Default Providers — Anime Alt (Kitsu) removed; all streams go through standard IMDb-based IDs.
            const providers = [
                { name: 'Torrentio', url: 'https://torrentio.strem.fun', icon: 'fas fa-bolt' },
                { name: 'Comet', url: 'https://comet.strem.fun', icon: 'fas fa-globe' }
            ];

            const detectQuality = (text) => {
                if (!text) return 'HD';
                if (text.includes('2160p') || text.includes('4K')) return '4K';
                if (text.includes('1080p')) return '1080p';
                if (text.includes('720p')) return '720p';
                return 'HD';
            };

            const promises = providers.map(async (p) => {
                try {
                    // Always build the stremioId using IMDb IDs — no Kitsu/anime-specific paths.
                    let stremioId = type === 'movie' ? imdbId : `${imdbId}:${season}:${episode}`;

                    const url = `${p.url}/stream/${stremioType}/${stremioId}.json`;
                    const resp = await fetch(url);
                    const data = await resp.json();
                    if (data && data.streams) {
                        data.streams.forEach(s => {
                            const torrentTitle = s.title || s.name || '';
                            // Basic mobile filtering (simplified version of TorrentFilterService)
                            if (type !== 'movie') {
                                const epStr = String(episode).padStart(2, '0');
                                const hasEp = torrentTitle.includes(`E${epStr}`) || torrentTitle.includes(` ${episode} `) || torrentTitle.includes(` ${epStr} `) || new RegExp(`\\b${episode}\\b`).test(torrentTitle);
                                if (!hasEp) return;
                            }

                            results.push({
                                addon: p.name,
                                icon: p.icon,
                                title: torrentTitle,
                                quality: detectQuality(torrentTitle),
                                url: s.url || s.infoHash || s.externalUrl,
                                type: s.infoHash ? 'torrent' : 'http',
                                infoHash: s.infoHash,
                                fileIdx: s.fileIdx
                            });
                        });
                    }
                } catch (e) {
                    console.warn(`[Bridge] Scraper ${p.name} failed:`, e.message);
                }
            });

            await Promise.all(promises);
            return results;
        },

        startDownload: async (options) => {
            let { url, name } = options;
            const id = 'dl_' + Date.now();
            console.log('[Bridge] startDownload:', name, url);

            if (!url || !url.startsWith('http')) {
                window.dispatchEvent(new CustomEvent('download-error', { detail: { id, name, error: 'Only direct HTTP links can be downloaded on mobile.' } }));
                return { success: false, id, error: 'Direct links only on mobile' };
            }

            // --- Serverless Social Downloader Fallback for Capacitor ---
            const isSocialUrl = (u) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|twitter\.com|x\.com)\//i.test(u);
            if (isSocialUrl(url)) {
                window.dispatchEvent(new CustomEvent('download-progress', { detail: { id, name: name || 'Video', percent: 5, status: 'downloading', statusText: 'Resolving social link...' } }));
                try {
                    let directUrl = null;
                    const makeReq = async (endpoint, payload) => {
                        if (window.Capacitor?.Plugins?.CapacitorHttp) {
                            const res = await window.Capacitor.Plugins.CapacitorHttp.post({
                                url: endpoint,
                                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                                data: payload
                            });
                            return res.data;
                        } else {
                            const res = await fetch(endpoint, {
                                method: 'POST',
                                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            return await res.json();
                        }
                    };

                    // 1. TikWM API for TikTok
                    if (url.includes('tiktok.com')) {
                        try {
                            const tikRes = await makeReq('https://www.tikwm.com/api/', { url });
                            if (tikRes?.data?.play) directUrl = tikRes.data.play;
                        } catch(e) { console.warn('[Bridge] TikWM failed:', e); }
                    }

                    // 2. Cobalt API v11 for everything else
                    if (!directUrl) {
                        const instances = [
                            'https://co.wuk.sh/', 
                            'https://cobalt.q0.wtf/', 
                            'https://api.vve.wtf/', 
                            'https://cobalt.catbox.video/', 
                            'https://api.cobalt.tools/'
                        ];
                        for (let apiUrl of instances) {
                            try {
                                const cobRes = await makeReq(apiUrl, { url });
                                if (cobRes && cobRes.url) { directUrl = cobRes.url; break; }
                            } catch(e) { console.warn('[Bridge] Cobalt failed at', apiUrl); }
                        }
                    }

                    // 3. Final Fallback: CORS Proxy + Cobalt v11 (Aggressive)
                    if (!directUrl) {
                        try {
                            const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent('https://api.vve.wtf/');
                            const res = await fetch(proxyUrl, {
                                method: 'POST',
                                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url })
                            }).then(r => r.json());
                            if (res && res.url) directUrl = res.url;
                        } catch (e) { console.warn('[Bridge] Final proxy fallback failed:', e); }
                    }

                    if (directUrl) {
                        url = directUrl; // Upgrade the URL to the direct MP4
                    } else {
                        throw new Error('Could not extract direct video link.');
                    }
                } catch (err) {
                    window.dispatchEvent(new CustomEvent('download-error', { detail: { id, name, error: err.message } }));
                    return { success: false, id, error: err.message };
                }
            }
            // --- End Social Injection ---


            const safeName = (name || 'download').replace(/[<>:"/\\|?*]/g, '_');
            const ext = url.match(/\.(mp4|mkv|avi|webm|mp3|m4a)/i)?.[0] || '.mp4';
            const fileName = safeName.endsWith(ext) ? safeName : safeName + ext;

            const fmtBytes = (b) => {
                if (!b) return '0 B';
                const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(Math.max(b, 1)) / Math.log(k));
                return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
            };

            window.dispatchEvent(new CustomEvent('download-progress', {
                detail: { id, name: fileName, percent: 0, status: 'downloading', statusText: 'Starting...' }
            }));

            // Use the outer isAndroid (window.Capacitor presence) — window.Capacitor.platform
            // is not a reliable property in Capacitor v5+; getPlatform() is the correct API.
            const onAndroid = isAndroid && window.Capacitor.Plugins.Filesystem;

            if (!onAndroid) {
                // Non-Android fallback: trigger browser download
                const a = document.createElement('a');
                a.href = url; a.download = fileName; a.target = '_blank';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                return { success: true, id };
            }

            const fs = window.Capacitor.Plugins.Filesystem;
            
            // On mobile, we save to the public Documents folder so MediaVault can scan it.
            const SAVE_DIR = 'DOCUMENTS';
            const profileName = params.profileName || 'Default';
            const SAVE_SUBDIR = params.type === 'social' 
                ? `MediaVault/${profileName}/Social` 
                : `MediaVault/${profileName}/Downloads`;
            let progressHandle = null;

            try {
                // Ensure destination folder exists before downloading
                try {
                    await fs.mkdir({ path: SAVE_SUBDIR, directory: SAVE_DIR, recursive: true });
                } catch (e) { /* already exists — safe to ignore */ }

                // Register progress listener BEFORE starting the download.
                // @capacitor/filesystem v5+ emits { url, bytes, contentLength } per chunk.
                try {
                    progressHandle = await fs.addListener('progress', (evt) => {
                        if (evt.url !== url) return;
                        const pct = evt.contentLength > 0
                            ? ((evt.bytes / evt.contentLength) * 100).toFixed(1)
                            : 0;
                        window.dispatchEvent(new CustomEvent('download-progress', {
                            detail: {
                                id, name: fileName,
                                percent: pct,
                                downloaded: fmtBytes(evt.bytes),
                                total: fmtBytes(evt.contentLength),
                                status: 'downloading',
                                statusText: `${fmtBytes(evt.bytes)} / ${fmtBytes(evt.contentLength)}`
                            }
                        }));
                    });
                } catch (e) {
                    console.warn('[Bridge] Progress listener not supported:', e.message);
                }

                const downloadRes = await fs.downloadFile({
                    url,
                    path: `${SAVE_SUBDIR}/${fileName}`,
                    directory: SAVE_DIR,
                    progress: true
                });

                window.dispatchEvent(new CustomEvent('download-complete', {
                    detail: { id, name: fileName, path: downloadRes.path }
                }));
                return { success: true, id, path: downloadRes.path };

            } catch (err) {
                console.error('[Bridge] Download failed:', err);
                window.dispatchEvent(new CustomEvent('download-error', {
                    detail: { id, name: fileName, error: err.message }
                }));
                return { success: false, id, error: err.message };
            } finally {
                try { progressHandle?.remove(); } catch (e) {}
            }
        },


        streamTorrent: async (url, fileIdx) => {
            const finalUrl = (url && url.length === 40 && !url.includes(':')) ? `magnet:?xt=urn:btih:${url}` : url;
            return { success: true, url: finalUrl };
        },

        renderTorrentTo: async (infoHash, selector) => ({ success: false, error: 'Use Internal Player.' }),

        // Play via External Player (Amnis, VLC, etc.)
        playExternal: async (url, meta = {}) => {
            if (!isAndroid) {
                window.open(url, '_blank');
                return { success: true };
            }
            try {
                const sourceType = PlayMediaService._classifySource(url);
                let finalUrl = url;

                if (sourceType === 'local_file' || sourceType === 'content_uri') {
                    const resolved = await PlayMediaService._resolveToNativeUri(url);
                    const localhostUrl = await PlayMediaService._serveViaLocalhost(resolved.uri);
                    if (localhostUrl) finalUrl = localhostUrl;
                }

                // Force Amnis Player directly via Intent
                const intentUrl = `intent://${finalUrl.replace(/^https?:\/\//, '')}#Intent;package=com.amnis.player;scheme=http;end;`;
                window.location.href = intentUrl;
                return { success: true };
            } catch (e) {
                console.error('[Bridge] playExternal failed:', e);
                return { success: false, error: e.message };
            }
        },

        openInExternalPlayer: async (url) => {
            return window.api.playExternal(url);
        },

        openInVlc: async (url) => {
            return window.api.playExternal(url);
        },

        // --- Filesystem & Folders (Capacitor) ---

        ensureProfileFolders: async (profileName) => {
            if (!isAndroid) return true;
            try {
                const folders = ['Movies', 'Series', 'Social', 'Music', 'Downloads', 'Subtitles', 'Banners'];
                for (const folder of folders) {
                    try {
                        const path = `MediaVault/${profileName}/${folder}`;
                        await Filesystem.mkdir({
                            path: path,
                            directory: 'DOCUMENTS',
                            recursive: true
                        });
                        console.log(`[Bridge] Folder created: ${path}`);
                    } catch (e) {
                        // Already exists or permission error
                    }
                }
                return true;
            } catch (err) {
                console.error('[Bridge] Filesystem setup failed:', err);
                return false;
            }
        },

        renameProfileFolders: async (oldName, newName) => {
            if (!isAndroid) return true;
            try {
                const { Filesystem } = window.Capacitor.Plugins;
                await Filesystem.rename({
                    from: `MediaVault/${oldName}`,
                    to: `MediaVault/${newName}`,
                    directory: 'DOCUMENTS'
                });
                return true;
            } catch (err) {
                console.warn('[Bridge] Rename folders failed:', err.message);
                return false;
            }
        },

        getProfileMediaPaths: async (profileName) => {
            if (!isAndroid) return { movies: '', shows: '', social: '', music: '' };
            return {
                movies: `MediaVault/${profileName}/Movies`,
                shows: `MediaVault/${profileName}/Series`,
                social: `MediaVault/${profileName}/Social`,
                music: `MediaVault/${profileName}/Music`,
                downloads: `MediaVault/${profileName}/Downloads`
            };
        },

        // Orientation Controls
        lockOrientation: async (type = 'landscape') => {
            if (!isAndroid) return false;
            try {
                if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
                    await window.screen.orientation.lock(type);
                    return true;
                }
                const { ScreenOrientation } = window.Capacitor.Plugins;
                if (ScreenOrientation) {
                    await ScreenOrientation.lock({ orientation: type });
                    return true;
                }
            } catch (e) { console.warn('[Bridge] Orientation lock failed:', e.message); }
            return false;
        },
        unlockOrientation: async () => {
            if (!isAndroid) return false;
            try {
                if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                    window.screen.orientation.unlock();
                    return true;
                }
                const { ScreenOrientation } = window.Capacitor.Plugins;
                if (ScreenOrientation) {
                    await ScreenOrientation.unlock();
                    return true;
                }
            } catch (e) { console.warn('[Bridge] Orientation unlock failed:', e.message); }
            return false;
        },

        // --- Utils & RPC ---
        invoke: async (channel, ...args) => {
            if (channel === 'load-app-data') return window.api.loadData();
            if (channel === 'save-app-data') return window.api.saveData(args[0]);
            if (channel === 'search-addons') return window.api.searchAddons(args[0]);
            if (channel === 'ensure-profile-folders') return window.api.ensureProfileFolders(args[0]);
            if (channel === 'get-profile-media-paths') return window.api.getProfileMediaPaths(args[0]);
            if (channel === 'lock-orientation') return window.api.lockOrientation(args[0]);
            if (channel === 'unlock-orientation') return window.api.unlockOrientation();
            if (channel === 'open-in-vlc') return window.api.playMedia(typeof args[0] === 'object' ? args[0] : { path: args[0] });
            if (channel === 'play-media') return window.api.playMedia(args[0]);
            if (channel === 'open-in-external-player') return window.api.playMedia(args[0]);
            if (channel === 'start-download') return window.api.startDownload(args[0]);
            if (channel === 'play-native') return window.api.playMedia(args[0]);
            if (channel === 'play-external') return window.api.playMedia(typeof args[0] === 'object' ? args[0] : { url: args[0], ...(args[1] || {}) });
            if (channel === 'select-files') return window.api.selectFiles(args[0]);
            // Cloud Auth/Profile IPC mappings
            if (channel === 'cloud-login') return window.api.cloudLogin(args[0]?.email, args[0]?.password);
            if (channel === 'cloud-register') return window.api.cloudRegister(args[0]?.email, args[0]?.password);
            if (channel === 'cloud-sync-user-session') return window.api.cloudSyncUserSession(args[0]?.userId, args[0]?.email, args[0]?.username, args[0]?.session);
            if (channel === 'clear-session') {
                // Log out across ALL storage layers (memory + localStorage + Preferences),
                // otherwise the persisted session in Preferences would survive logout.
                // Preserve installedAddons so the user keeps their Stremio addons.
                try {
                    let existing = {};
                    try { const raw = await storageGet(STORAGE_KEY); if (raw) existing = JSON.parse(raw); } catch (_) {}
                    const cleared = {
                        authenticated: false,
                        user: null,
                        profiles: [],
                        activeProfileId: null,
                        installedAddons: Array.isArray(existing.installedAddons) ? existing.installedAddons : []
                    };
                    await storageSet(STORAGE_KEY, JSON.stringify(cleared));
                    cloudSession = null;
                    window.cloudSession = null;
                    return { success: true };
                } catch (e) {
                    console.warn('[Bridge] clear-session failed:', e.message);
                    return { success: false, error: e.message };
                }
            }
            if (channel === 'cloud-create-profile') return window.api.cloudCreateProfile(args[0]);
            if (channel === 'cloud-update-profile') return window.api.cloudUpdateProfile(args[0]);
            if (channel === 'cloud-delete-profile') return window.api.cloudDeleteProfile(args[0]);
            if (channel === 'cloud-verify-profile-pin') return window.api.cloudVerifyProfilePin(args[0]?.profile_id, args[0]?.pin);
            if (channel === 'save-playback-position') return window.api.savePlaybackPosition(args[0]?.profileId, args[0]?.key, args[0]?.entry);
            if (channel === 'get-playback-position') return window.api.getPlaybackPosition(args[0]?.profileId, args[0]?.key);
            if (channel === 'get-hardware-id') return window.api.getHardwareId();
            if (channel === 'cloud-fetch-requests') return window.api.cloudFetchRequests();
            if (channel === 'cloud-create-request') return window.api.cloudCreateRequest(args[0]?.title);
            if (channel === 'cloud-admin-mutate') return window.api.cloudAdminMutate(args[0]?.action, args[0]?.payload);
            if (channel === 'move-file') return window.api.moveFile(args[0]);
            if (channel === 'create-folder') return window.api.createFolder(args[0]);
            if (channel === 'open-external' || channel === 'open-external-url') {
                const url = args[0];
                if (isAndroid) {
                    if (LocalServer) {
                        LocalServer.openUrl({ url });
                    } else {
                        window.open(url, '_system');
                    }
                } else {
                    window.open(url, '_blank');
                }
                return { success: true };
            }
            if (channel === 'request-filesystem-permissions') return window.api.requestFileSystemPermissions();
            if (channel === 'get-default-library-root') return window.api.getDefaultLibraryRoot();
            
            // Map common channels to bridge methods
            const method = channel.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
            if (window.api[method]) return window.api[method](...args);
            if (window.api[channel]) return window.api[channel](...args);
            if (channel === 'cancel-download') return { success: true };
            if (channel === 'start-torrent-stream' || channel === 'stream-torrent') {
                return window.api.streamTorrent(args[0], args[1]);
            }
            if (channel === 'render-torrent-to') {
                return window.api.renderTorrentTo(args[0], args[1]);
            }
            if (channel === 'stop-torrent-stream') {
                if (wtClient) {
                    console.log('[Bridge] Stopping all torrents...');
                    wtClient.torrents.forEach(t => t.destroy());
                }
                return { success: true };
            }
            if (channel === 'fetch-url-metadata') return { success: false };
            if (channel === 'clean-missing-downloads') return args[0] || [];
            
            // Handle Kitsu Invokes
            if (channel === 'kitsu-trending') return window.api.kitsuTrending();
            if (channel === 'kitsu-search') return window.api.kitsuSearch(args[0]);
            if (channel === 'kitsu-cast') return window.api.kitsuCast(args[0]);

            if (channel === 'fetch-proxy') {
                try {
                    const resp = await fetch(args[0], args[1]);
                    return await resp.json();
                } catch (e) { return { error: e.message }; }
            }
            return null;
        },



        // Event Emitters (Mocks for Mobile)
        onTorrentProgress: (fn) => { 
            const handler = (e) => fn(e.detail);
            window.addEventListener('torrent-progress', handler);
            return () => window.removeEventListener('torrent-progress', handler);
        },
        onDownloadProgress: (fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener('download-progress', handler);
            return () => window.removeEventListener('download-progress', handler);
        },
        onDownloadComplete: (fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener('download-complete', handler);
            return () => window.removeEventListener('download-complete', handler);
        },
        onDownloadError: (fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener('download-error', handler);
            return () => window.removeEventListener('download-error', handler);
        },
        onLibraryUpdated: (fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener('library-updated', handler);
            return () => window.removeEventListener('library-updated', handler);
        },
        on: (channel, fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener(channel, handler);
            return () => window.removeEventListener(channel, handler);
        },
        onMetadataReady: (fn) => {
            const handler = (e) => fn(e.detail);
            window.addEventListener('metadata-ready', handler);
            return () => window.removeEventListener('metadata-ready', handler);
        },

        // Selection Mocks
        selectFolder: async () => null,
        getFilePath: (file) => file.name || 'native-path',
        openExternal: (url) => {
            if (isAndroid) {
                window.api.openExternalUrl(url);
            } else {
                window.open(url, '_blank');
            }
        },
        
        // --- REAL ADDON SEARCH ---
        searchAddons: async ({ imdbId, tmdbId, type, season, episode, title }) => {
            const results = [];
            const torrentioUrl = 'https://torrentio.strem.fun';
            const cinemetaUrl = 'https://v3-cinemeta.strem.io'; // More stable metadata/stream source

            const detectQuality = (text) => {
                if (!text) return 'Unknown';
                const lower = text.toLowerCase();
                if (lower.includes('2160p') || lower.includes('4k')) return '4K';
                if (lower.includes('1080p')) return '1080p';
                if (lower.includes('720p')) return '720p';
                return 'HD';
            };

            const fetchStremioAddon = async (name, baseUrl, icon) => {
                try {
                    const stremioType = type === 'movie' ? 'movie' : 'series';
                    let stremioId = type === 'movie' ? imdbId : `${imdbId}:${season}:${episode}`;
                    
                    // Fallback for anime or missing IMDb
                    if ((type === 'anime' || !imdbId) && tmdbId) {
                        // Attempt to use TMDB if IMDB fails, though Stremio prefers IMDB
                        if (type === 'anime') stremioId = `kitsu:${tmdbId}:${episode || 1}`;
                    }

                    if (!stremioId) return;

                    const url = `${baseUrl}/stream/${stremioType}/${stremioId}.json`;
                    const resp = await fetch(url).catch(() => null);
                    if (!resp || !resp.ok) return;
                    const data = await resp.json();
                    
                    if (data && data.streams) {
                        data.streams.forEach(s => {
                            if (stremioType !== 'movie') {
                                const torrentTitle = (s.title || s.name || '').toString().toLowerCase();
                                const epStr = String(episode).padStart(2, '0');
                                
                                // Strict episode matching: look for E01, EP01, or standalone 01
                                const epRegex = new RegExp(`(e|ep|episode|\\s)${epStr}(\\s|\\b|\\.|$)`, 'i');
                                const isMatch = epRegex.test(torrentTitle);
                                
                                if (!isMatch) return; // Skip season packs or wrong episodes
                            }

                            results.push({
                                addon: name,
                                icon: icon,
                                title: s.title || s.name,
                                quality: detectQuality(s.title || s.name),
                                url: s.url || s.infoHash || s.externalUrl,
                                type: s.infoHash ? 'torrent' : (s.externalUrl ? 'browser' : 'http'),
                                infoHash: s.infoHash,
                                fileIdx: s.fileIdx
                            });
                        });
                    }
                } catch (e) { /* silent fail to clean console */ }
            };

            await Promise.all([
                fetchStremioAddon('Torrentio', torrentioUrl, '⚡'),
                fetchStremioAddon('Cinemeta', cinemetaUrl, '🎬')
            ]);
            return results;
        },
        getProfileMediaPaths: async (profileName) => {
             const base = `MediaVault/${profileName || 'Default'}`;
             return {
                 movies: `${base}/Movies`,
                 series: `${base}/Series`,
                 social: `${base}/Social`,
                 music: `${base}/Music`,
                 downloads: `${base}/Downloads`
             };
        },
        // streamTorrent implementation moved above for consistency
        findSubtitles: async (filePath) => [],
        updateDiscordActivity: (data) => {},
        scanLibrary: async (libPath) => {
            if (!isAndroid) return { movies: [], shows: [] };
            try {
                const outMovies = [];
                const outShows = [];

                const normalizedPath = libPath.replace(/\\/g, '/').toLowerCase();
                const parts = normalizedPath.split('/').filter(p => p);
                const folderName = parts.length > 0 ? parts[parts.length - 1] : '';

                const isMoviesFolder = folderName.includes('movie') || folderName.includes('film');
                const isSeriesFolder = folderName.includes('series') || folderName.includes('show') || folderName === 'tv';
                const isDownloads = folderName.includes('download');

                const VIDEO_EXTS = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i;

                // ── walk: Use native Java File listing (bypasses scoped storage) ──
                async function walk(dirPath) {
                    let results = { files: [], dirs: [] };
                    const items = await readDirRobust(dirPath);
                    for (const f of items) {
                        if (f.type === 'directory') {
                            results.dirs.push({ name: f.name, type: 'directory', uri: f.uri });
                        } else if (VIDEO_EXTS.test(f.name)) {
                            results.files.push({ name: f.name, type: 'file', uri: f.uri });
                        }
                    }
                    return results;
                }

                const rootFiles = await walk(libPath);
                console.log(`[Bridge] scanLibrary root "${libPath}" → ${rootFiles.files.length} files, ${rootFiles.dirs.length} dirs`);

                // If it's a generic folder (like Downloads), we try to guess content or just add everything as movies
                if (isMoviesFolder || isDownloads) {
                    for (const f of rootFiles.files) {
                        const cleanName = f.name.replace(/\.[^/.]+$/, '');
                        outMovies.push({ id: `${libPath}/${f.name}`, title: cleanName, filename: f.name, path: `${libPath}/${f.name}`, type: 'movie' });
                    }
                    for (const d of rootFiles.dirs) {
                        const sub = await walk(`${libPath}/${d.name}`);
                        for (const sf of sub.files) {
                            const cleanName = d.name; 
                            outMovies.push({ id: `${libPath}/${d.name}/${sf.name}`, title: cleanName, filename: sf.name, path: `${libPath}/${d.name}/${sf.name}`, type: 'movie' });
                        }
                    }
                } 
                
                if (isSeriesFolder || (isDownloads && outMovies.length === 0)) {
                    for (const d of rootFiles.dirs) {
                        const showName = d.name;
                        const episodes = [];
                        const sub1 = await walk(`${libPath}/${d.name}`);
                        
                        for (const f of sub1.files) {
                            let s = 1, ep = 1;
                            const m = f.name.match(/[Ss](\d{1,2})\s*[Ee](\d{1,3})/);
                            if (m) { s = +m[1]; ep = +m[2]; }
                            else { const m2 = f.name.match(/(\d{1,3})/); if (m2) ep = +m2[1]; }
                            episodes.push({ id: `${libPath}/${d.name}/${f.name}`, filename: f.name, title: f.name, path: `${libPath}/${d.name}/${f.name}`, season: s, episode: ep });
                        }

                        for (const sd of sub1.dirs) {
                            let s = 1;
                            const sm = sd.name.match(/season\s*(\d+)/i) || sd.name.match(/^(\d{1,2})$/i);
                            if (sm) s = +sm[1];
                            const sub2 = await walk(`${libPath}/${d.name}/${sd.name}`);
                            for (const f of sub2.files) {
                                let ep = 1;
                                const em = f.name.match(/[Ee](\d{1,3})/i) || f.name.match(/(\d{1,3})/);
                                if (em) ep = +em[1];
                                episodes.push({ id: `${libPath}/${d.name}/${sd.name}/${f.name}`, filename: f.name, title: f.name, path: `${libPath}/${d.name}/${sd.name}/${f.name}`, season: s, episode: ep });
                            }
                        }

                        if (episodes.length > 0) {
                            episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
                            outShows.push({ id: `${libPath}/${d.name}`, title: showName, type: 'show', episodes });
                        }
                    }
                }

                console.log(`[Bridge] scanLibrary result: ${outMovies.length} movies, ${outShows.length} shows`);
                return { movies: outMovies, shows: outShows };
            } catch (e) {
                console.error('[Bridge] scanLibrary Error:', e);
                return { movies: [], shows: [] };
            }
        },
        downloadImage: async (url, id) => null,
        cleanMissingDownloads: async (history) => history || [],
        renameFile: async (oldPath, newName) => ({ success: false, error: 'Renaming not supported on mobile' }),
        fetchUrlMetadata: async (url) => ({ success: false }),
        clearCache: async () => true,
        setFullScreen: async (flag) => false,
        openInVlc: async (path) => {
            if (isAndroid && LocalServer) {
                await LocalServer.openInExternalPlayer({ path: path });
                return true;
            } else if (isElectron) {
                return await window.api.playMedia(typeof path === 'object' ? path : { path });
            }
            return false;
        },
        scanYoutube: async (path) => {
            if (!isAndroid) return [];
            try {
                const items = await readDirRobust(path);
                const videos = [];
                for (const f of items) {
                    if (f.type === 'file' && /\.(mp4|mkv|avi|webm|mov|m4v)$/i.test(f.name)) {
                        const name = f.name.replace(/\.[^/.]+$/, '');
                        const imgName = name + '.jpg';
                        const hasImg = items.some(ef => ef.name === imgName);
                        let imgUri = null;
                        if (hasImg) {
                            const imgItem = items.find(ef => ef.name === imgName);
                            imgUri = imgItem?.uri || null;
                        }
                        videos.push({
                            id: `${path}/${f.name}`,
                            name: name,
                            title: name,
                            path: `${path}/${f.name}`,
                            type: 'social',
                            isLocal: true,
                            image: imgUri
                        });
                    }
                }
                return videos;
            } catch (e) { return []; }
        },
        selectFiles: async () => {
            if (!isAndroid) return [];
            try {
                // If we have LocalServer.pickFiles (Native), use it
                if (LocalServer && LocalServer.pickFiles) {
                    const res = await LocalServer.pickFiles();
                    return res.paths || [];
                }
                
                // Fallback: showToast
                window.dispatchEvent(new CustomEvent('toast', { detail: 'Please use the Social/Downloads section to manage files on mobile' }));
                return [];
            } catch (e) {
                return [];
            }
        },
        moveFile: async ({ src, dest }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                
                // Ensure paths are relative for Filesystem.rename
                const cleanSrc = src.replace(/.*\/Documents\//, '');
                const cleanDest = dest.replace(/.*\/Documents\//, '');
                
                await fs.rename({ 
                    from: cleanSrc, 
                    to: cleanDest, 
                    directory: 'DOCUMENTS' 
                });
                return { success: true };
            } catch (e) { 
                console.error('[Bridge] moveFile failed:', e.message);
                return { success: false, error: e.message }; 
            }
        },
        createFolder: async (folderPath) => {
            if (!isAndroid) return false;
            try {
                // Remove leading slash and ensure path starts with MediaVault/
                let cleanPath = folderPath;
                if (cleanPath.startsWith('/')) cleanPath = cleanPath.substring(1);
                
                console.log(`[Bridge] Creating directory: ${cleanPath}`);
                
                await Filesystem.mkdir({ 
                    path: cleanPath, 
                    directory: 'DOCUMENTS', 
                    recursive: true 
                });
                return true;
            } catch (e) { 
                console.error('[Bridge] createFolder failed:', e.message);
                // Return true if folder already exists
                if (e.message && (e.message.includes('exists') || e.message.includes('13'))) return true;
                return false; 
            }
        },
        // --- REAL KITSU LOGIC ---
        kitsuTrending: async () => {
            return { results: [] };
        },
        setZoom: (f) => {},
        openInExternalPlayer: async (path) => {
            if (isAndroid) return PlayMediaService.play(path, { title: 'MediaVault Player' });
            return window.api.playMedia(typeof path === 'object' ? path : { path });
        },
        downloadFile: async (url, name) => window.api.startDownload({ url, name }),

        // Invoke Mappings for specific channels that aren't dynamic
        getAppVersion: async () => '11.2.0',
        checkForUpdates: async () => ({ available: false }),
        


        'restart-server': async () => {
            if (!isAndroid || !LocalServer) return { success: false };
            try {
                await LocalServer.stop();
                const res = await LocalServer.start({ port: 8976 });
                window.dispatchEvent(new CustomEvent('toast', { detail: 'Service Restarted on Port ' + res.port }));
                return { success: true };
            } catch (e) {
                window.dispatchEvent(new CustomEvent('toast', { detail: 'Restart Failed: ' + e.message }));
                return { success: false };
            }
        },
        getDefaultLibraryRoot: async () => {
            return isAndroid ? 'MediaVault' : 'C:/MediaVault';
        },

        getCommonPaths: async () => {
            if (!isAndroid) return [];
            return [
                'Movies',
                'Download',
                'DCIM/Camera',
                'MediaVault',
                '/storage/emulated/0/Movies',
                '/storage/emulated/0/Download'
            ];
        },
        
        // --- NEW MOBILE HANDLERS ---
        'list-profile-subtitles': async ({ profileName, libraryRoot, subDir }) => {
            if (!isAndroid) return [];
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const path = `MediaVault/${profileName}/Subtitles${subDir ? '/' + subDir : ''}`;
                const result = await fs.readdir({ path, directory: 'DOCUMENTS' });
                return result.files.map(f => ({
                    name: f.name,
                    isDir: f.type === 'directory',
                    size: f.size || 0
                }));
            } catch (e) { return []; }
        },
        'save-subtitle-local': async ({ profileName, fileName, content, subDir }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const path = `MediaVault/${profileName}/Subtitles${subDir ? '/' + subDir : ''}/${fileName}`;
                await fs.writeFile({ path, data: content, directory: 'DOCUMENTS', encoding: 'utf8' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        'move-subtitle-local': async ({ profileName, fileName, fromDir, toDir }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const from = `MediaVault/${profileName}/Subtitles${fromDir ? '/' + fromDir : ''}/${fileName}`;
                const to = `MediaVault/${profileName}/Subtitles${toDir ? '/' + toDir : ''}/${fileName}`;
                await fs.rename({ from, to, directory: 'DOCUMENTS' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        'rename-subtitle-local': async ({ profileName, oldName, newName, subDir }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const from = `MediaVault/${profileName}/Subtitles${subDir ? '/' + subDir : ''}/${oldName}`;
                const to = `MediaVault/${profileName}/Subtitles${subDir ? '/' + subDir : ''}/${newName}`;
                await fs.rename({ from, to, directory: 'DOCUMENTS' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        'delete-subtitle-local': async ({ profileName, fileName, subDir }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const path = `MediaVault/${profileName}/Subtitles${subDir ? '/' + subDir : ''}/${fileName}`;
                await fs.deleteFile({ path, directory: 'DOCUMENTS' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        'read-subtitle-file': async (path) => {
            if (!isAndroid) return '';
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const result = await fs.readFile({ path, directory: 'DOCUMENTS', encoding: 'utf8' });
                return result.data;
            } catch (e) { return ''; }
        },
        'delete-file': async (path) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                await fs.deleteFile({ path, directory: 'DOCUMENTS' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        'scan-music': async (path) => {
            if (!isAndroid) return [];
            try {
                const items = await readDirRobust(path);
                return items.filter(f => f.type === 'file' && /\.(mp3|m4a|flac|wav|mp4|mkv|avi|webm|mov|m4v)$/i.test(f.name)).map(f => ({
                    id: 'music_' + f.name,
                    filename: f.name,
                    title: f.name.replace(/\.[^/.]+$/, ""),
                    artist: 'Unknown',
                    path: `${path}/${f.name}`,
                    cover: f.uri || null
                }));
            } catch (e) { return []; }
        },
        'factory-reset': async () => {
            // Clear localStorage (TMDB key, device ID)
            localStorage.clear();
            // Clear in-memory cloud session
            cloudSession = null;
            return true;
        },
        
        // Kitsu mapping helpers
        kitsuSearch: async (query) => {
            return { results: [] };
        },
        kitsuDetails: async (id) => {
            try {
                const cleanId = String(id).replace('kitsu:', '');
                const resp = await fetch(`https://kitsu.io/api/edge/anime/${cleanId}`, {
                    headers: { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' }
                });
                const res = await resp.json();
                if (res && res.data) {
                    const attrs = res.data.attributes || {};
                    const title = attrs.canonicalTitle || attrs.titles?.en || attrs.titles?.en_jp || 'Unknown Anime';
                    const rating = attrs.averageRating ? parseFloat((parseFloat(attrs.averageRating) / 10).toFixed(1)) : 0;
                    
                    const epResp = await fetch(`https://kitsu.io/api/edge/anime/${cleanId}/episodes?page[limit]=100&sort=number`, {
                        headers: { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' }
                    });
                    const epData = await epResp.json();
                    const videos = (epData.data || []).map(ep => {
                        const epAttrs = ep.attributes || {};
                        const epTitle = epAttrs.canonicalTitle || epAttrs.titles?.en || epAttrs.titles?.en_jp || epAttrs.titles?.ja_jp || `Episode ${epAttrs.number}`;
                        return {
                            episode: epAttrs.number || epAttrs.relativeNumber,
                            season: 1,
                            title: epTitle,
                            name: epTitle,
                            thumbnail: epAttrs.thumbnail?.original || epAttrs.thumbnail?.large || epAttrs.thumbnail?.medium || epAttrs.thumbnail?.small || null,
                            released: epAttrs.airdate || null
                        };
                    }).sort((a, b) => a.episode - b.episode);

                    return {
                        id: `kitsu:${cleanId}`,
                        kitsuId: cleanId,
                        name: title,
                        title: title,
                        type: 'series',
                        poster_path: attrs.posterImage?.original || attrs.posterImage?.large || null,
                        backdrop_path: attrs.coverImage?.original || attrs.coverImage?.large || null,
                        overview: attrs.synopsis || attrs.description || '',
                        year: attrs.startDate ? attrs.startDate.substring(0, 4) : '',
                        release_date: attrs.startDate || '',
                        vote_average: rating,
                        rating: rating,
                        status: attrs.status,
                        videos: videos,
                        source: 'kitsu'
                    };
                }
            } catch (e) {
                console.error('[Bridge] kitsuDetails failed:', e);
            }
            return null;
        },
        malDetails: async (id) => {
            try {
                const resp = await fetch(`https://api.jikan.moe/v4/anime/${id}`);
                const res = await resp.json();
                if (res && res.data) {
                    const d = res.data;
                    return {
                        id: `mal:${id}`,
                        mal_id: id,
                        title: d.title_english || d.title || d.title_japanese,
                        name: d.title_english || d.title,
                        type: 'anime',
                        synopsis: d.synopsis || d.background || '',
                        overview: d.synopsis || d.background || '',
                        genres: d.genres ? d.genres.map(g => g.name) : [],
                        rating: d.score,
                        vote_average: d.score,
                        year: d.year || (d.aired?.from ? d.aired.from.substring(0, 4) : ''),
                        release_date: d.aired?.from || '',
                        poster_path: d.images?.jpg?.large_image_url || d.images?.jpg?.image_url,
                        backdrop_path: d.images?.jpg?.large_image_url || d.images?.jpg?.image_url,
                        status: d.status
                    };
                }
            } catch (e) {
                console.error('[Bridge] malDetails failed:', e);
            }
            return null;
        },
        kitsuEpisodes: async (id) => {
            return [];
        },
        kitsuCast: async (id) => {
            return [];
        },



        // Magnet/Torrent URL launcher (non-player concern)
        // Magnet/Torrent URL launcher (non-player concern)
        openExternalUrl: async (url) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            
            if (url && url.startsWith('magnet:')) {
                try {
                    // Force LibreTorrent directly
                    const intentUrl = `intent://${url.replace(/^magnet:\?/, '')}#Intent;package=org.proninyaroslav.libretorrent;scheme=magnet;end;`;
                    window.location.href = intentUrl;
                    return { success: true, method: 'intent-scheme' };
                } catch (e) {
                    console.error('[Bridge] LibreTorrent intent failed:', e);
                }
            }

            if (LocalServer) {
                try {
                    console.log('[Bridge] openExternalUrl via native intent:', url);
                    await LocalServer.openUrl({ url: url });
                    return { success: true, method: 'native-intent' };
                } catch (e) {
                    console.error('[Bridge] Native intent failed:', e);
                }
            }

            window.open(url, '_system');
            return { success: true, method: 'window.open' };
        },

        /**
         * playNative — Internal Player Handoff
         * On mobile, ALL play actions route through PlayMediaService
         * which will serve local files via localhost and play in
         * the built-in HTML5 Internal Player.
         */
        playNative: async (options) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            const { url, title } = options;
            console.log('[Bridge] playNative → Internal Player:', title, url);
            return PlayMediaService.play(url, { title: title || 'MediaVault' });
        },

        /**
         * playMedia — The canonical API for ALL mobile playback.
         * Routes to the Internal Player via PlayMediaService.
         */
        playExternal: async (url, meta = {}) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            return PlayMediaService.play(url, meta);
        }
    };

    // --- Android Specific Adjustments ---
    if (isAndroid && window.Capacitor.Plugins.App) {
        // Track view history for proper back navigation
        const viewHistory = [];
        const mainViews = ['discover', 'movies', 'shows', 'library', 'music', 'social', 'settings', 'downloads', 'watchlist', 'sync'];
        
        // Hook into switchView to build history
        const originalSwitchView = window.switchView;
        const patchBackNav = () => {
            if (typeof window.switchView === 'function' && !window.switchView._patched) {
                const origFn = window.switchView;
                window.switchView = function(name) {
                    // Don't push duplicates
                    if (viewHistory.length === 0 || viewHistory[viewHistory.length - 1] !== window.currentView) {
                        if (window.currentView) viewHistory.push(window.currentView);
                    }
                    // Keep history manageable
                    if (viewHistory.length > 20) viewHistory.splice(0, viewHistory.length - 20);
                    return origFn.call(this, name);
                };
                window.switchView._patched = true;
            }
        };
        
        // Patch after renderer.js sets up switchView
        setTimeout(patchBackNav, 2000);
        setTimeout(patchBackNav, 5000);
        
        let lastBackPress = 0;
        window.Capacitor.Plugins.App.addListener('backButton', () => {
            // 0. Close ANY open modal overlay first (edit music, settings, profile, etc.)
            try {
                const modals = document.querySelectorAll('.modal-overlay');
                let closedModal = false;
                for (let i = modals.length - 1; i >= 0; i--) {
                    const m = modals[i];
                    if (window.getComputedStyle(m).display !== 'none') {
                        m.style.display = 'none';
                        if (m.classList.contains('active')) m.classList.remove('active');
                        
                        if (m.id === 'modal-edit-music') {
                            const preview = document.getElementById('edit-music-cover-preview');
                            if (preview) preview.innerHTML = '';
                        }
                        
                        closedModal = true;
                        break;
                    }
                }
                if (closedModal) return;

                const ctx = document.getElementById('context-menu');
                if (ctx && window.getComputedStyle(ctx).display !== 'none') {
                    ctx.style.display = 'none';
                    return;
                }
            } catch (e) { console.warn('Back handler modal close failed', e); }

            // 1. Close discover-detail overlay first using centralized close if available
            try {
                const detailView = document.getElementById('view-discover-detail');
                if (detailView && (detailView.classList.contains('active') || window.getComputedStyle(detailView).display !== 'none')) {
                    if (typeof window.closeUnifiedDetail === 'function') {
                        window.closeUnifiedDetail();
                    } else {
                        detailView.classList.remove('active');
                        detailView.style.display = 'none';
                    }
                    return;
                }
            } catch (e) { console.warn('Back handler closeUnifiedDetail failed', e); }
            
            // 2. If in player, exit player
            if (window.currentView === 'player') {
                if (typeof window.exitPlayer === 'function') window.exitPlayer();
                else if (typeof window.switchView === 'function') window.switchView(viewHistory.pop() || 'discover');
                return;
            }
            
            // 3. If in show-detail, go back
            if (window.currentView === 'show-detail') {
                if (typeof window.switchView === 'function') window.switchView(viewHistory.pop() || 'movies');
                return;
            }
            
            // 4. Navigate back through history
            if (viewHistory.length > 0) {
                const prev = viewHistory.pop();
                if (typeof window.switchView === 'function') window.switchView(prev);
                return;
            }
            
            // 5. If on a main view, double-tap to exit
            if (mainViews.includes(window.currentView)) {
                const now = Date.now();
                if (now - lastBackPress < 2000) {
                    window.Capacitor.Plugins.App.exitApp();
                } else {
                    lastBackPress = now;
                    if (typeof window.showToast === 'function') window.showToast('Press back again to exit');
                }
                return;
            }
            
            // 6. Fallback: go to discover
            if (typeof window.switchView === 'function') window.switchView('discover');
        });
    }


})();
