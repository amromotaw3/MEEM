/**
 * MediaVault Bridge v3.0
 * Handles real API fetching, robust data persistence, and
 * UNIVERSAL EXTERNAL PLAYER HANDOFF for Android/Mobile.
 *
 * All "Play" actions on mobile are delegated to external players
 * (VLC, MX Player, Stremio, etc.) via Android Intents.
 * The internal video player is ONLY used on Desktop (Electron).
 */
(function() {
    'use strict';

    const isElectron = !!(window.api);
    const isAndroid = !!(window.Capacitor);
    
    let Filesystem, Directory, AppLauncher, FileOpener, IntentLauncher, Share;
    if (isAndroid) {
        Filesystem = window.Capacitor.Plugins.Filesystem;
        AppLauncher = window.Capacitor.Plugins.AppLauncher;
        // @capacitor-community/file-opener — handles FileProvider URI generation
        // automatically so external players have read permission for local files.
        FileOpener = window.Capacitor.Plugins.FileOpener;
        // Custom plugin registered in MainActivity.java
        IntentLauncher = window.Capacitor.Plugins.IntentLauncher;
        // @capacitor/share — Nuclear fallback: OS Share Sheet bypasses FileProvider
        // entirely by granting temporary read permissions automatically.
        Share = window.Capacitor.Plugins.Share;

        Directory = {
            Documents: 'DOCUMENTS',
            Data: 'DATA',
            External: 'EXTERNAL',
            ExternalStorage: 'EXTERNAL_STORAGE'
        };
    }

    console.log(`[Bridge] Environment: ${isElectron ? 'Electron' : (isAndroid ? 'Android' : 'Web')}`);

    if (isElectron) return;

    // ═══════════════════════════════════════════════════════════════════
    //  PLAY MEDIA SERVICE — Universal External Player Handoff (Mobile)
    // ═══════════════════════════════════════════════════════════════════
    //  Every "Play" action on mobile MUST go through this service.
    //  Scenario 1: Torrent/Magnet/HTTP → AppLauncher.openUrl (ACTION_VIEW)
    //  Scenario 2: Local file → FileOpener.open (FileProvider content:// URI)
    // ═══════════════════════════════════════════════════════════════════
    const PlayMediaService = {
        /**
         * Determine the type of media source.
         * @returns {'magnet'|'torrent_file'|'http_stream'|'local_file'}
         */
        _classifySource(url) {
            if (!url) return 'unknown';
            if (url.startsWith('magnet:')) return 'magnet';
            // Bare 40-char info-hash
            if (/^[a-fA-F0-9]{40}$/.test(url)) return 'magnet';
            if (url.toLowerCase().endsWith('.torrent')) return 'torrent_file';
            if (url.startsWith('http://') || url.startsWith('https://')) return 'http_stream';
            if (url.startsWith('content://')) return 'content_uri';
            if (url.startsWith('file://')) return 'local_file';
            // Absolute native path (starts with /)
            if (url.startsWith('/')) return 'local_file';
            // Everything else is treated as a local file path (Capacitor-relative)
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
         * Resolve a Capacitor-relative path (e.g. "MediaVault/Movies/file.mp4")
         * to an absolute native file:// URI (e.g. "file:///storage/emulated/0/.../file.mp4").
         *
         * CRITICAL (Android 13+ Scoped Storage):
         * We return the FULL file:// URI as provided by Filesystem.getUri().
         * Do NOT strip the file:// prefix — FileOpener, IntentLauncher, and Share
         * all require the properly formatted native URI to function.
         *
         * @returns {Promise<{uri: string, directory: string|null}>}
         *          uri = the absolute file:// or content:// URI
         *          directory = the Capacitor Directory enum that matched (for Share fallback)
         */
        async _resolveToNativeUri(filePath) {
            // Already a content:// URI — pass through as-is
            if (filePath.startsWith('content://')) {
                return { uri: filePath, directory: null };
            }
            // Already a full file:// URI — pass through
            if (filePath.startsWith('file://')) {
                return { uri: filePath, directory: null };
            }
            // Already an absolute native path — prepend file:// scheme
            if (filePath.startsWith('/')) {
                return { uri: `file://${filePath}`, directory: null };
            }
            // HTTP URLs are not local files — pass through
            if (filePath.startsWith('http')) {
                return { uri: filePath, directory: null };
            }

            // It's a Capacitor-relative path — resolve via Filesystem.getUri()
            // Try multiple directories in priority order
            const dirsToTry = [
                Directory.Documents,
                Directory.External,
                Directory.ExternalStorage,
                Directory.Data
            ];

            for (const dir of dirsToTry) {
                try {
                    const result = await Filesystem.getUri({ path: filePath, directory: dir });
                    if (result && result.uri) {
                        console.log(`[PlayMediaService] Resolved "${filePath}" → "${result.uri}" (dir=${dir})`);
                        return { uri: result.uri, directory: dir };
                    }
                } catch (e) {
                    // File not found in this directory, try next
                    console.log(`[PlayMediaService] Not found in ${dir}: ${e.message || e}`);
                }
            }

            // Could not resolve — return as file:// URI and hope for the best
            console.warn('[PlayMediaService] Could not resolve path, using raw:', filePath);
            return { uri: filePath, directory: Directory.External };
        },

        /**
         * Scenario 1: Play a Magnet link or HTTP stream via external app.
         * Uses AppLauncher.openUrl which fires ACTION_VIEW intent.
         * Checks the `completed` flag and falls back to window.location
         * if AppLauncher silently fails (common with magnet: URIs).
         */
        async playMagnetOrStream(url) {
            console.log('[PlayMediaService] Scenario 1 — Magnet/HTTP:', url);
            
            // Expand bare info-hash to full magnet URI
            if (/^[a-fA-F0-9]{40}$/.test(url)) {
                url = `magnet:?xt=urn:btih:${url}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
            }

            // --- Method 1: Custom IntentLauncher (Best for Magnets/Intents)
            if (IntentLauncher) {
                try {
                    const result = await IntentLauncher.launchUrl({ url });
                    if (result && result.completed) {
                        console.log('[PlayMediaService] IntentLauncher succeeded');
                        return { success: true, method: 'IntentLauncher' };
                    }
                } catch (err) {
                    console.warn('[PlayMediaService] IntentLauncher failed:', err.message);
                }
            }

            // --- Method 2: AppLauncher.openUrl (ACTION_VIEW intent)
            if (AppLauncher) {
                try {
                    const result = await AppLauncher.openUrl({ url });
                    if (result && result.completed) {
                        console.log('[PlayMediaService] AppLauncher succeeded');
                        return { success: true, method: 'AppLauncher' };
                    }
                    console.warn('[PlayMediaService] AppLauncher returned completed=false for:', url);
                } catch (err) {
                    console.warn('[PlayMediaService] AppLauncher.openUrl threw:', err.message);
                }
            }

            // --- Method 2: Direct location assignment (triggers system intent resolver)
            // On Android WebView, setting window.location to a magnet: or intent: URI
            // triggers the OS intent resolver directly.
            try {
                // For magnet links, try the intent:// scheme which gives more control
                if (url.startsWith('magnet:')) {
                    const intentUrl = `intent:${url.substring(url.indexOf(':') + 1)}#Intent;scheme=magnet;end`;
                    console.log('[PlayMediaService] Trying intent:// fallback:', intentUrl);
                    window.location.href = intentUrl;
                    return { success: true, method: 'intent-scheme' };
                }
                // For HTTP streams, use window.open
                window.open(url, '_system');
                return { success: true, method: 'window.open' };
            } catch (err2) {
                console.warn('[PlayMediaService] Intent fallback failed:', err2.message);
            }

            // --- Method 3: Last resort — window.open
            try {
                window.open(url, '_system');
                return { success: true, method: 'fallback' };
            } catch (err3) {
                return { success: false, error: 'No app found to handle this link. Install VLC, Stremio, or a torrent client.' };
            }
        },

        /**
         * Scenario 2: Play a local file via external app.
         *
         * RADICAL 2-STEP FIX (Android 13+ Scoped Storage):
         *
         * Step 1 — Strict URI Resolution:
         *   Force Capacitor to give us the absolute native file:// URI
         *   via Filesystem.getUri(). This is the ONLY format that Android's
         *   FileProvider can reliably convert to a content:// URI.
         *   NEVER pass a relative path or Capacitor web URL to FileOpener.
         *
         * Step 2 — Nuclear Share Intent Fallback:
         *   If FileProvider is irreversibly broken (XML misconfiguration,
         *   authority mismatch, etc.), bypass it entirely using the OS
         *   Share Sheet. Android natively generates a content:// URI and
         *   grants temporary read permissions to whichever app the user
         *   picks (VLC, MX Player, etc.).
         */
        async playLocalFile(filePath) {
            console.log('[PlayMediaService] Scenario 2 — Local file:', filePath);
            const mime = this._guessMime(filePath);

            // ═══════════════════════════════════════════════════════════
            //  STEP 1: Strict URI Resolution via Filesystem.getUri()
            // ═══════════════════════════════════════════════════════════
            let resolved;
            try {
                resolved = await this._resolveToNativeUri(filePath);
            } catch (resolveErr) {
                console.warn('[PlayMediaService] URI resolution failed, using raw path:', resolveErr.message);
                resolved = { uri: filePath.startsWith('/') ? `file://${filePath}` : filePath, directory: null };
            }

            const nativeUri = resolved.uri;
            console.log('[PlayMediaService] Resolved native URI:', nativeUri, '| MIME:', mime);

            // ═══════════════════════════════════════════════════════════
            //  Try 1: Custom IntentLauncher (Java-side FileProvider)
            // ═══════════════════════════════════════════════════════════
            if (IntentLauncher) {
                try {
                    const result = await IntentLauncher.openFile({
                        filePath: nativeUri,
                        contentType: mime
                    });
                    if (result && result.completed) {
                        console.log('[PlayMediaService] ✓ IntentLauncher openFile succeeded');
                        return { success: true, method: 'IntentLauncher-file' };
                    }
                } catch (err) {
                    console.warn('[PlayMediaService] IntentLauncher openFile failed:', err.message);
                }
            }

            // ═══════════════════════════════════════════════════════════
            //  Try 2: FileOpener with strict native URI
            // ═══════════════════════════════════════════════════════════
            if (FileOpener) {
                try {
                    await FileOpener.open({
                        filePath: nativeUri,
                        contentType: mime
                    });
                    console.log('[PlayMediaService] ✓ FileOpener succeeded');
                    return { success: true, method: 'FileOpener' };
                } catch (err) {
                    console.error('[PlayMediaService] FileOpener FAILED. Executing Nuclear Fallback...', err.message || err);
                }
            }

            // ═══════════════════════════════════════════════════════════
            //  STEP 2: NUCLEAR OPTION — Share Intent Fallback
            //  Android OS generates content:// URI + grants temp read
            //  permissions automatically through the Share Sheet.
            // ═══════════════════════════════════════════════════════════
            const shareResult = await this._fallbackToShareIntent(filePath, resolved.directory);
            if (shareResult.success) return shareResult;

            // ═══════════════════════════════════════════════════════════
            //  Last Resort: AppLauncher / window.open
            // ═══════════════════════════════════════════════════════════
            try {
                if (AppLauncher) {
                    const result = await AppLauncher.openUrl({ url: nativeUri });
                    if (result && result.completed) {
                        return { success: true, method: 'AppLauncher-file' };
                    }
                }
            } catch (err2) {
                console.warn('[PlayMediaService] AppLauncher fallback failed:', err2.message);
            }

            try {
                window.open(nativeUri, '_system');
                return { success: true, method: 'window.open-fallback' };
            } catch (err3) {
                return {
                    success: false,
                    error: 'All playback methods exhausted. Please ensure a media player (VLC, MX Player) is installed.'
                };
            }
        },

        /**
         * NUCLEAR FALLBACK — Share Intent
         * Bypasses FileProvider entirely by using the OS Share Sheet.
         * Android natively grants temporary read permissions to external
         * apps when using ACTION_SEND. Video players like VLC and MX Player
         * automatically register in the Share Sheet.
         *
         * @param {string} originalPath - The original (potentially relative) file path
         * @param {string|null} resolvedDir - The Directory enum the file was found in
         */
        async _fallbackToShareIntent(originalPath, resolvedDir) {
            if (!Share) {
                console.warn('[PlayMediaService] Share plugin not available, skipping nuclear fallback');
                return { success: false, method: 'share-unavailable' };
            }

            try {
                // Re-resolve the URI specifically for Share
                let shareUri;
                if (originalPath.startsWith('file://') || originalPath.startsWith('content://')) {
                    shareUri = originalPath;
                } else if (originalPath.startsWith('/')) {
                    shareUri = `file://${originalPath}`;
                } else if (resolvedDir) {
                    // Re-resolve via Filesystem.getUri with the known directory
                    const stat = await Filesystem.getUri({
                        path: originalPath,
                        directory: resolvedDir
                    });
                    shareUri = stat.uri;
                } else {
                    // Try all directories again
                    const resolved = await this._resolveToNativeUri(originalPath);
                    shareUri = resolved.uri;
                }

                console.log('[PlayMediaService] Nuclear Share fallback with URI:', shareUri);

                await Share.share({
                    title: 'Play in External Player',
                    text: 'Select VLC or your preferred player to watch this video.',
                    url: shareUri,
                    dialogTitle: 'Play Video With...'
                });

                console.log('[PlayMediaService] ✓ Share Intent dispatched');
                return { success: true, method: 'share-intent-nuclear' };
            } catch (shareError) {
                console.error('[PlayMediaService] Share Intent completely failed:', shareError.message || shareError);
                return { success: false, method: 'share-failed', error: shareError.message };
            }
        },

        /**
         * Universal entry point — classifies the source and delegates.
         * @param {string} url  - Magnet link, HTTP URL, or local file path
         * @param {object} meta - Optional metadata (title, etc.) for logging
         * @returns {Promise<{success: boolean, method?: string, error?: string}>}
         */
        async play(url, meta = {}) {
            if (!url) return { success: false, error: 'No URL provided' };

            const sourceType = this._classifySource(url);
            console.log(`[PlayMediaService] play("${url.substring(0, 80)}...") → type=${sourceType}`, meta.title || '');

            switch (sourceType) {
                case 'magnet':
                case 'http_stream':
                case 'torrent_file':
                    return this.playMagnetOrStream(url);
                case 'local_file':
                case 'content_uri':
                    return this.playLocalFile(url);
                default:
                    // Attempt generic open
                    return this.playMagnetOrStream(url);
            }
        }
    };

    // Expose globally so renderer.js can use it
    window.PlayMediaService = PlayMediaService;

    // --- State & Helpers ---
    const STORAGE_KEY = 'mediavault_app_data';

    // Helper: Execute a TMDB Request
    async function tmdbFetch(endpoint, params = {}) {
        const raw = localStorage.getItem(STORAGE_KEY);
        let apiKey = '';
        if (raw) {
            try {
                const data = JSON.parse(raw);
                apiKey = data.tmdbKey || '';
            } catch(e) {}
        }
        
        if (!apiKey) {
            console.warn(`[Bridge] TMDB Key missing for ${endpoint}`);
            return { error: 'TMDB API key required' };
        }

        const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
        url.search = new URLSearchParams({
            api_key: apiKey,
            language: 'en-US',
            ...params
        }).toString();

        try {
            const resp = await fetch(url.href);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return await resp.json();
        } catch (e) {
            console.error(`[Bridge] TMDB Error (${endpoint}):`, e.message);
            return { error: e.message };
        }
    }

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

    // --- The Bridge ---
    window.api = {
        isElectron: false,
        isMobile: () => isAndroid,
        // Window Controls
        minimizeWindow: () => {},
        maximizeWindow: () => {},
        closeWindow: () => {},

        // Persistence (Robust implementation)
        loadData: async () => {
            return new Promise((resolve) => {
                try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (!raw) {
                        console.log('[Bridge] No data found, returning clean state for Onboarding');
                        resolve({ firstRun: true, profiles: [], activeProfileId: null });
                        return;
                    }
                    const data = JSON.parse(raw);
                    // Ensure firstRun is handled
                    if (data.firstRun === undefined) data.firstRun = false;
                    resolve(data);
                } catch (e) {
                    console.error('[Bridge] Load Error:', e);
                    resolve({ firstRun: true });
                }
            });
        },

        saveData: async (data) => {
            return new Promise((resolve, reject) => {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                    resolve(true);
                } catch (e) {
                    console.error('[Bridge] Save Error:', e);
                    resolve(false); 
                }
            });
        },

        requestFileSystemPermissions: async () => {
            if (!isAndroid) return true;
            try {
                console.log('[Bridge] Requesting Filesystem Permissions...');
                const status = await Filesystem.requestPermissions();
                if (status.publicStorage !== 'granted') {
                    console.warn('[Bridge] Storage permission NOT granted by user.');
                    return false;
                }
                return true;
            } catch (e) {
                console.error('[Bridge] Permission Request Error:', e);
                return false;
            }
        },

        // TMDB Logic (Implemented)
        tmdbTrending: (type = 'movie', time = 'week') => tmdbFetch(`trending/${type}/${time}`),
        tmdbSearch: (type, query) => tmdbFetch(`search/${type}`, { query }),
        tmdbDetails: (type, id) => tmdbFetch(`${type}/${id}`, { append_to_response: 'credits,videos' }),
        tmdbPopular: (type) => tmdbFetch(`${type}/popular`),
        tmdbTopRated: (type) => tmdbFetch(`${type}/top_rated`),
        tmdbUpcoming: () => tmdbFetch('movie/upcoming'),
        tmdbAnimeFeatured: () => tmdbFetch('discover/movie', { with_genres: '16', with_keywords: '210024' }),
        tmdbCredits: (type, id) => tmdbFetch(`${type}/${id}/credits`),
        tmdbVideos: (type, id) => tmdbFetch(`${type}/${id}/videos`),
        tmdbProviders: (type, id) => tmdbFetch(`${type}/${id}/watch/providers`),
        tmdbSearchDiscover: (query) => tmdbFetch('search/multi', { query }),
        tmdbSeasonDetails: (tvId, season) => tmdbFetch(`tv/${tvId}/season/${season}`),
        tmdbDiscoverByGenre: (genreId) => tmdbFetch('discover/movie', { with_genres: genreId }),
        tmdbExternalIds: (params) => tmdbFetch(`${params.type}/${params.id}/external_ids`),
        
        getTmdbKeyMasked: async () => {
            const data = await window.api.loadData();
            if (!data?.tmdbKey) return null;
            return '********' + data.tmdbKey.slice(-4);
        },

        mapKitsu: (media) => {
            return (media || []).map(m => {
                const attr = m.attributes || {};
                return {
                    id: m.id,
                    title: attr.canonicalTitle || attr.titles?.en || attr.titles?.en_jp || 'Unknown',
                    name: attr.canonicalTitle || attr.titles?.en || 'Unknown',
                    overview: attr.synopsis,
                    poster_path: attr.posterImage?.large || attr.posterImage?.original || '',
                    backdrop_path: attr.coverImage?.large || attr.coverImage?.original || '',
                    vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
                    first_air_date: attr.startDate || '',
                    media_type: 'anime',
                    source: 'kitsu',
                    episodes: attr.episodeCount || 1,
                    format: attr.subtype,
                    status: attr.status,
                    trailer: attr.youtubeVideoId ? { id: attr.youtubeVideoId, site: 'youtube' } : null
                };
            });
        },

        // Kitsu (Anime)
        kitsuTrending: async () => {
            try {
                const resp = await fetch('https://kitsu.io/api/edge/trending/anime');
                const raw = await resp.json();
                return { results: window.api.mapKitsu(raw.data) };
            } catch (e) { return null; }
        },
        kitsuSearch: async (query) => {
            try {
                const resp = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}`);
                const raw = await resp.json();
                return { results: window.api.mapKitsu(raw.data) };
            } catch (e) { return null; }
        },

        // Downloads & Streaming IPC
        // Scrapers (Stremio-compatible)
        searchAddons: async ({ imdbId, type, season, episode, title }) => {
            console.log(`[Bridge] Scraping for ${title} (${type})`);
            const results = [];
            const stremioType = type === 'movie' ? 'movie' : 'series';
            const stremioId = type === 'movie' ? imdbId : `${imdbId}:${season}:${episode}`;
            
            // Default Providers
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
                    const url = `${p.url}/stream/${stremioType}/${stremioId}.json`;
                    const resp = await fetch(url);
                    const data = await resp.json();
                    if (data && data.streams) {
                        data.streams.forEach(s => {
                            results.push({
                                addon: p.name,
                                icon: p.icon,
                                title: s.title || s.name,
                                quality: detectQuality(s.title || s.name),
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
            const { url, name } = options;
            const id = 'dl_' + Date.now();
            console.log('[Bridge] startDownload:', name, url);

            if (!url || !url.startsWith('http')) {
                window.dispatchEvent(new CustomEvent('download-error', { detail: { id, name, error: 'Only direct HTTP links can be downloaded on mobile.' } }));
                return { success: false, id, error: 'Direct links only on mobile' };
            }

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
            // 'EXTERNAL' maps to the app's own external files dir —
            // always writable without runtime permissions on Android 10+.
            // 'DOWNLOADS' is NOT a valid Capacitor directory constant and causes a native crash.
            const SAVE_DIR = 'EXTERNAL';
            const SAVE_SUBDIR = 'MediaVault';
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
            // Mobile: Always use external player for torrents for 100% stability
            const finalUrl = (url && url.length === 40 && !url.includes(':')) ? `magnet:?xt=urn:btih:${url}` : url;
            return { success: true, url: finalUrl, isExternal: true };
        },

        renderTorrentTo: async (infoHash, selector) => ({ success: false, error: 'Internal streaming disabled. Use External Player.' }),

        // Unified external player — delegates to PlayMediaService
        openInVlc: async (url) => {
            console.log('[Bridge] openInVlc → PlayMediaService:', url);
            if (!isAndroid) {
                window.open(url, '_blank');
                return true;
            }
            const result = await PlayMediaService.play(url, { title: 'VLC Handoff' });
            return result.success;
        },

        // --- Filesystem & Folders (Capacitor) ---
        ensureProfileFolders: async (profileName) => {
            if (!isAndroid) return true;
            try {
                const { Filesystem } = window.Capacitor.Plugins;
                const folders = ['Movies', 'Series', 'Social', 'Music', 'Downloads'];
                
                for (const folder of folders) {
                    try {
                        await Filesystem.mkdir({
                            path: `MediaVault/${profileName}/${folder}`,
                            directory: 'DOCUMENTS',
                            recursive: true
                        });
                    } catch (e) {
                        console.log(`[Bridge] Folder ${folder} already exists or error:`, e.message);
                    }
                }
                return true;
            } catch (err) {
                console.error('[Bridge] Filesystem setup failed:', err);
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
            if (channel === 'get-tmdb-key-masked') return window.api.getTmdbKeyMasked();
            if (channel === 'set-tmdb-key') return window.api.setTmdbKey(args[0]);
            if (channel === 'load-app-data') return window.api.loadData();
            if (channel === 'save-app-data') return window.api.saveData(args[0]);
            if (channel === 'verify-tmdb-key') return window.api.verifyTmdbKey(args[0]);
            if (channel === 'search-addons') return window.api.searchAddons(args[0]);
            if (channel === 'ensure-profile-folders') return window.api.ensureProfileFolders(args[0]);
            if (channel === 'get-profile-media-paths') return window.api.getProfileMediaPaths(args[0]);
            if (channel === 'lock-orientation') return window.api.lockOrientation(args[0]);
            if (channel === 'unlock-orientation') return window.api.unlockOrientation();
            if (channel === 'open-in-vlc') return window.api.openInVlc(args[0]);
            if (channel === 'start-download') return window.api.startDownload(args[0]);
            if (channel === 'play-native') return window.api.playNative(args[0]);
            if (channel === 'play-external') return window.api.playExternal(args[0], args[1] || {});
            if (channel === 'open-external-url') return window.api.openExternalUrl(args[0]);
            if (channel === 'request-filesystem-permissions') return window.api.requestFileSystemPermissions();
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
            
            // Handle Kitsu/TMDB Invokes
            if (channel === 'kitsu-trending') return window.api.kitsuTrending();
            if (channel === 'kitsu-search') return window.api.kitsuSearch(args[0]);
            if (channel === 'kitsu-cast') return window.api.kitsuCast(args[0]);

            // Dynamic TMDB Mapping
            if (channel.startsWith('tmdb-')) {
                const methodName = channel.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                if (window.api[methodName]) return window.api[methodName](...args);
            }
            return null;
        },

        setTmdbKey: async (key) => {
            const STORAGE_KEY = 'mediavault_app_data';
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                const data = raw ? JSON.parse(raw) : {};
                data.tmdbKey = key;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                console.log('[Bridge] TMDB Key saved directly to localStorage');
                return { success: true, key: key };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        verifyTmdbKey: async (key) => {
            if (!key) return false;
            try {
                const resp = await fetch(`https://api.themoviedb.org/3/movie/550?api_key=${key}`);
                return resp.status === 200;
            } catch (e) { return false; }
        },

        getTmdbKeyMasked: async () => {
            const data = await window.api.loadData();
            const key = data.tmdbKey || '';
            if (!key) return '';
            return key.substring(0, 4) + '****************' + key.substring(key.length - 4);
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
        openExternal: (url) => window.open(url, '_blank'),
        
        // --- REAL ADDON SEARCH ---
        searchAddons: async ({ imdbId, tmdbId, type, season, episode, title }) => {
            const results = [];
            const torrentioUrl = 'https://torrentio.strem.fun';
            const altUrl = 'https://comet.strem.fun';
            const animeUrl = 'https://anime-kitsu.strem.io';

            const detectQuality = (text) => {
                if (!text) return 'Unknown';
                if (text.includes('2160p') || text.includes('4K')) return '4K';
                if (text.includes('1080p')) return '1080p';
                if (text.includes('720p')) return '720p';
                return 'HD';
            };

            const fetchStremioAddon = async (name, baseUrl, icon) => {
                try {
                    const stremioType = type === 'movie' ? 'movie' : 'series';
                    let stremioId = type === 'movie' ? imdbId : `${imdbId}:${season}:${episode}`;
                    if (type === 'anime' && !imdbId?.startsWith('tt')) stremioId = `kitsu:${imdbId}:${episode || 1}`;

                    const url = `${baseUrl}/stream/${stremioType}/${stremioId}.json`;
                    const resp = await fetch(url);
                    if (!resp.ok) return;
                    const data = await resp.json();
                    
                    if (data && data.streams) {
                        data.streams.forEach(s => {
                            results.push({
                                addon: name,
                                icon: icon,
                                title: s.title || s.name,
                                quality: detectQuality(s.title || s.name),
                                url: s.url || s.infoHash || s.externalUrl,
                                type: s.infoHash ? 'torrent' : 'http',
                                infoHash: s.infoHash,
                                fileIdx: s.fileIdx
                            });
                        });
                    }
                } catch (e) { console.warn('[Addon] Fetch failed:', name, e.message); }
            };

            await Promise.all([
                fetchStremioAddon('Torrentio', torrentioUrl, '⚡'),
                fetchStremioAddon('Global Alt', altUrl, '🌍'),
                fetchStremioAddon('Anime Alt', animeUrl, '🇯🇵')
            ]);
            return results;
        },
        ensureProfileFolders: async (profileId) => {
            if (!isAndroid) return true;
            try {
                const base = `MediaVault/Profiles/${profileId}`;
                await safeMkdir(`${base}/Subtitles`);
                await safeMkdir(`${base}/Banners`);
                return true;
            } catch (e) { return false; }
        },
        getProfileMediaPaths: async (profileId) => {
             // Return paths relative to Documents or Data based on where they were created
             // For now, return standard layout
             return {
                 movies: 'MediaVault/Movies',
                 series: 'MediaVault/Series',
                 social: 'MediaVault/Social',
                 music: 'MediaVault/Music'
             };
        },
        // streamTorrent implementation moved above for consistency
        findSubtitles: async (filePath) => [],
        updateDiscordActivity: (data) => {},
        scanLibrary: async (path) => ({ movies: [], shows: [] }),
        downloadImage: async (url, id) => null,
        cleanMissingDownloads: async (history) => history || [],
        renameFile: async (oldPath, newName) => ({ success: false, error: 'Renaming not supported on mobile' }),
        fetchUrlMetadata: async (url) => ({ success: false }),
        clearCache: async () => true,
        setFullScreen: async (flag) => false,
        scanYoutube: async (path) => [],
        tmdbSeasonDetails: (id, sn) => tmdbFetch(`tv/${id}/season/${sn}`),
        tmdbDiscoverByGenre: (id) => tmdbFetch('discover/movie', { with_genres: id }),
        // --- REAL KITSU LOGIC ---
        kitsuTrending: async () => {
            try {
                const resp = await fetch('https://kitsu.io/api/edge/trending/anime');
                const data = await resp.json();
                return {
                    results: data.data.map(a => ({
                        id: a.id,
                        name: a.attributes.canonicalTitle,
                        title: a.attributes.canonicalTitle,
                        poster_path: a.attributes.posterImage?.large || a.attributes.posterImage?.original,
                        overview: a.attributes.synopsis,
                        media_type: 'tv',
                        source: 'kitsu'
                    }))
                };
            } catch (e) { return { results: [] }; }
        },
        setZoom: (f) => {},
        openInExternalPlayer: async (path) => {
            if (isAndroid) return PlayMediaService.play(path, { title: 'External Player' });
            return window.api.openInVlc(path);
        },
        downloadFile: async (url, name) => window.api.startDownload({ url, name }),

        // Invoke Mappings for specific channels that aren't dynamic
        getAppVersion: async () => '8.5.4',
        checkForUpdates: async () => ({ available: false }),
        
        // Kitsu/TMDB Dynamic Mapping Helpers (if needed)
        tmdbSearchDiscover: (q) => tmdbFetch('search/multi', { query: q }),
        kitsuSearch: async (query) => {
            try {
                const resp = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}`);
                const data = await resp.json();
                return {
                    results: data.data.map(a => ({
                        id: a.id,
                        name: a.attributes.canonicalTitle,
                        title: a.attributes.canonicalTitle,
                        poster_path: a.attributes.posterImage?.large || a.attributes.posterImage?.original,
                        overview: a.attributes.synopsis,
                        media_type: 'tv',
                        source: 'kitsu'
                    }))
                };
            } catch (e) { return { results: [] }; }
        },
        kitsuCast: async (id) => {
            try {
                const resp = await fetch(`https://kitsu.io/api/edge/anime/${id}/characters?include=character`);
                const data = await resp.json();
                if (!data.included) return [];
                return data.included.filter(x => x.type === 'characters').map(c => ({
                    name: c.attributes.name,
                    character: c.attributes.name,
                    profile_path: c.attributes.image?.original
                }));
            } catch (e) { return []; }
        },
        tmdbExternalIds: (data) => tmdbFetch(`${data.type}/${data.id}/external_ids`),


        // External App Launcher (for Torrents/Magnets)
        openExternalUrl: async (url) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            return PlayMediaService.playMagnetOrStream(url);
        },

        /**
         * playNative — Universal External Player Handoff
         * On mobile, ALL play actions now delegate to PlayMediaService
         * which hands off to external players (VLC, MX Player, Stremio, etc.)
         * via Android Intents. The internal ExoPlayer is fully abandoned.
         */
        playNative: async (options) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            const { url, title } = options;
            console.log('[Bridge] playNative → PlayMediaService (external handoff):', title, url);
            return PlayMediaService.play(url, { title: title || 'MediaVault' });
        },

        /**
         * playExternal — The new canonical API for ALL mobile playback.
         * Accepts any URL type (magnet, HTTP, local path) and hands off
         * to the OS for an external player to handle.
         */
        playExternal: async (url, meta = {}) => {
            if (!isAndroid) return { success: false, error: 'Not on Android' };
            return PlayMediaService.play(url, meta);
        }
    };

    // --- Android Specific Adjustments ---
    if (isAndroid && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener('backButton', () => {
            if (window.currentView && window.currentView !== 'movies') {
                if (typeof window.switchView === 'function') window.switchView('movies');
            } else {
                window.Capacitor.Plugins.App.exitApp();
            }
        });
    }


})();
