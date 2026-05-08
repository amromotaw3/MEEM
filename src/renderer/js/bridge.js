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
                console.log(`[PlayMediaService] Serving via localhost: ${result.url} (${result.mimeType}, ${(result.size / 1048576).toFixed(1)}MB)`);
                return result.url;
            } catch (e) {
                console.error('[PlayMediaService] Failed to serve file:', e);
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

            // Local files: resolve path → serve via localhost → return streamable URL
            if (sourceType === 'local_file' || sourceType === 'content_uri') {
                const resolved = await this._resolveToNativeUri(url);
                console.log('[PlayMediaService] Resolved native URI:', resolved.uri);

                const localhostUrl = await this._serveViaLocalhost(resolved.uri);
                if (localhostUrl) {
                    console.log('[PlayMediaService] ✓ Streaming via localhost:', localhostUrl);
                    return { success: true, streamUrl: localhostUrl, method: 'local-server' };
                }

                // Fallback: try direct file URI (may work on some devices)
                console.warn('[PlayMediaService] Local server failed, trying direct URI...');
                return { success: true, streamUrl: resolved.uri, method: 'direct-uri-fallback' };
            }

            return { success: false, error: `Unhandled source type: ${sourceType}` };
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
            if (channel === 'select-files') return window.api.selectFiles(args[0]);
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
            
            // Handle Kitsu/TMDB Invokes
            if (channel === 'kitsu-trending') return window.api.kitsuTrending();
            if (channel === 'kitsu-search') return window.api.kitsuSearch(args[0]);
            if (channel === 'kitsu-cast') return window.api.kitsuCast(args[0]);

            // Dynamic TMDB Mapping
            if (channel.startsWith('tmdb-')) {
                const methodName = channel.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                if (window.api[methodName]) return window.api[methodName](...args);
            }
            if (channel === 'fetch-proxy') {
                try {
                    const resp = await fetch(args[0], args[1]);
                    return await resp.json();
                } catch (e) { return { error: e.message }; }
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
                const { Filesystem } = window.Capacitor.Plugins;
                const outMovies = [];
                const outShows = [];

                const isMoviesFolder = libPath.toLowerCase().endsWith('movies');
                const isSeriesFolder = libPath.toLowerCase().endsWith('series');

                async function walk(dirPath, isRoot = false) {
                    let results = { files: [], dirs: [] };
                    try {
                        const { files } = await Filesystem.readdir({ path: dirPath, directory: 'DOCUMENTS' });
                        for (const f of files) {
                            if (f.type === 'directory') results.dirs.push(f);
                            else if (f.type === 'file' && /\.(mp4|mkv|avi|webm|mov|m4v)$/i.test(f.name)) results.files.push(f);
                        }
                    } catch (e) {}
                    return results;
                }

                const rootFiles = await walk(libPath, true);

                if (isMoviesFolder) {
                    for (const f of rootFiles.files) {
                        const cleanName = f.name.replace(/\.[^/.]+$/, '');
                        outMovies.push({ id: `${libPath}/${f.name}`, title: cleanName, filename: f.name, path: `${libPath}/${f.name}`, type: 'movie' });
                    }
                    for (const d of rootFiles.dirs) {
                        const sub = await walk(`${libPath}/${d.name}`);
                        for (const sf of sub.files) {
                            const cleanName = d.name; // Folder name is movie name
                            outMovies.push({ id: `${libPath}/${d.name}/${sf.name}`, title: cleanName, filename: sf.name, path: `${libPath}/${d.name}/${sf.name}`, type: 'movie' });
                        }
                    }
                } else if (isSeriesFolder) {
                    for (const d of rootFiles.dirs) {
                        const showName = d.name;
                        const episodes = [];
                        const sub1 = await walk(`${libPath}/${d.name}`);
                        
                        // Flat episodes
                        for (const f of sub1.files) {
                            let s = 1, ep = 1;
                            const m = f.name.match(/[Ss](\d{1,2})\s*[Ee](\d{1,3})/);
                            if (m) { s = +m[1]; ep = +m[2]; }
                            else { const m2 = f.name.match(/(\d{1,3})/); if (m2) ep = +m2[1]; }
                            episodes.push({ id: `${libPath}/${d.name}/${f.name}`, filename: f.name, title: f.name, path: `${libPath}/${d.name}/${f.name}`, season: s, episode: ep });
                        }

                        // Subfolders (seasons)
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
        scanYoutube: async (path) => {
            if (!isAndroid) return [];
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const { files } = await fs.readdir({ path, directory: 'DOCUMENTS' });
                const videos = [];
                for (const f of files) {
                    if (f.type === 'file' && /\.(mp4|mkv|avi|webm|mov|m4v)$/i.test(f.name)) {
                        const name = f.name.replace(/\.[^/.]+$/, '');
                        const imgName = name + '.jpg';
                        const hasImg = files.some(ef => ef.name === imgName);
                        let imgUri = null;
                        if (hasImg) {
                            try {
                                const uriRes = await fs.getUri({ path: `${path}/${imgName}`, directory: 'DOCUMENTS' });
                                imgUri = uriRes.uri;
                            } catch(e) {}
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
            console.warn('[Bridge] selectFiles not implemented on mobile. Use file input.');
            return [];
        },
        moveFile: async ({ src, dest }) => {
            if (!isAndroid) return { success: false };
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                await fs.rename({ from: src, to: dest, directory: 'DOCUMENTS' });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        createFolder: async (folderPath) => {
            if (!isAndroid) return false;
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                await fs.mkdir({ path: folderPath, directory: 'DOCUMENTS', recursive: true });
                return true;
            } catch (e) { return false; }
        },
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
            if (isAndroid) return PlayMediaService.play(path, { title: 'MediaVault Player' });
            return window.api.openInVlc(path);
        },
        downloadFile: async (url, name) => window.api.startDownload({ url, name }),

        // Invoke Mappings for specific channels that aren't dynamic
        getAppVersion: async () => '11.2.0',
        checkForUpdates: async () => ({ available: false }),
        
        requestFileSystemPermissions: async () => {
            if (!isAndroid) return true;
            try {
                const fs = window.Capacitor.Plugins.Filesystem;
                const status = await fs.requestPermissions();
                return status.publicStorage === 'granted';
            } catch (e) { return false; }
        },

        getDefaultLibraryRoot: async () => {
            return isAndroid ? 'MediaVault' : 'C:/MediaVault';
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
                const fs = window.Capacitor.Plugins.Filesystem;
                const result = await fs.readdir({ path, directory: 'DOCUMENTS' });
                return result.files.filter(f => f.type === 'file' && /\.(mp3|m4a|flac|wav)$/i.test(f.name)).map(f => ({
                    id: 'music_' + f.name,
                    filename: f.name,
                    title: f.name.replace(/\.[^/.]+$/, ""),
                    artist: 'Unknown',
                    path: `${path}/${f.name}`
                }));
            } catch (e) { return []; }
        },
        'factory-reset': async () => {
            localStorage.clear();
            return true;
        },
        
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
        window.Capacitor.Plugins.App.addListener('backButton', () => {
            if (window.currentView && window.currentView !== 'movies') {
                if (typeof window.switchView === 'function') window.switchView('movies');
            } else {
                window.Capacitor.Plugins.App.exitApp();
            }
        });
    }


})();
