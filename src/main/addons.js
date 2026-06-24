const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { getCleanMetadata, isLocalFilePath } = require('./utils/MetadataNormalizer');

    const torrentStream = require('torrent-stream');
    let torrentEngine = null;
    let torrentServer = null;

/**
 * Fetches data from Cinemeta API using fallback endpoints and retry logic.
 * 
 * @param {string} endpoint - The API endpoint suffix (e.g. /catalog/movie/top.json).
 * @param {number} [timeout=8000] - Request timeout in milliseconds.
 * @returns {Promise<Object>} The parsed API response.
 */
async function fetchCinemeta(endpoint, timeout = 8000) {
  const endpoints = [
    `https://v3-cinemeta.strem.io${endpoint}`,
    `https://cinemeta.strem.io${endpoint}`, // Fallback
  ];

  for (const url of endpoints) {
    try {
      console.log(`[Cinemeta] Fetching from: ${url}`);
      const response = await axios.get(url, { timeout });
      return response.data;
    } catch (err) {
      console.warn(`[Cinemeta] Failed to fetch from ${url}:`, err.message);
    }
  }

  // All endpoints failed
  throw new Error(`[Cinemeta] All endpoints failed for: ${endpoint}`);
}

/**
 * Destroys the active addon torrent engine and stops the media server.
 */
function stopAddonStreaming() {
    console.log('[Addons] Stopping torrent stream and cleaning up...');
    if (torrentEngine) {
        try { torrentEngine.destroy(); } catch(e) {}
        torrentEngine = null;
    }
    if (torrentServer) {
        try { torrentServer.close(); } catch(e) {}
        torrentServer = null;
    }
}

/**
 * Maps a MyAnimeList (MAL) ID to a Kitsu ID.
 * 
 * @param {string|number} malId - The MyAnimeList ID.
 * @returns {Promise<string|null>} The mapped Kitsu ID, or null if mapping fails.
 */
async function getKitsuIdFromMalId(malId) {
    try {
        const fetch = global.fetch || require('node-fetch');
        const url = `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.data && data.data.length > 0) {
            const relatedUrl = data.data[0].relationships?.item?.links?.related;
            if (relatedUrl) {
                const itemRes = await fetch(relatedUrl);
                const itemData = await itemRes.json();
                if (itemData && itemData.data) {
                    return itemData.data.id;
                }
            }
        }
    } catch (e) {
        console.error('[Addons] Error fetching kitsu ID for MAL ID:', malId, e.message);
    }
    return null;
}

/**
 * Registers IPC handlers for Stremio addon protocol, subtitle fetching, and key verification.
 * 
 * @param {Object} ipcMain - Electron's ipcMain module instance.
 * @param {Object} store - Local storage manager instance.
 */
function initAddonsIpc(ipcMain, store) {
    console.log('[Addons] Registering "search-addons" handler...');

    // IPC: Search for streams via StremioAddonService (Stremio Addon Protocol)
    ipcMain.handle('search-addons', async (_e, opts) => {
        let { imdbId, tmdbId, kitsuId, malId, type, season, episode, title } = opts;
        if (tmdbId && tmdbId.toString().startsWith('tt')) {
            if (!imdbId) imdbId = tmdbId;
            tmdbId = null;
        }
        if (!kitsuId && malId) {
            const mappedKitsu = await getKitsuIdFromMalId(malId);
            if (mappedKitsu) kitsuId = mappedKitsu;
        }
        
        // Normalize local file path if provided
        if (imdbId && isLocalFilePath(imdbId)) {
            const cleanMeta = await getCleanMetadata(imdbId, () => (store && typeof store.get === 'function' ? store.get('appData') : null));
            if (cleanMeta) {
                imdbId = cleanMeta.imdbId;
                season = cleanMeta.season;
                episode = cleanMeta.episode;
                title = cleanMeta.title;
                type = cleanMeta.type === 'series' ? 'series' : 'movie';
            } else {
                imdbId = null;
            }
        }

        // Resolve TMDB to IMDb ID if necessary (supports prefix tmdb: and plain numeric)
        if (!tmdbId && imdbId) {
            const strId = imdbId.toString();
            if (strId.startsWith('tmdb:')) {
                tmdbId = strId.replace('tmdb:', '');
            } else if (/^\d+$/.test(strId)) {
                tmdbId = strId;
            }
        }
        if (tmdbId) {
            try {
                const tmdbAddonUrl = `https://tmdb.elfhosted.com/meta/${type === 'series' ? 'series' : 'movie'}/tmdb:${tmdbId}.json`;
                const tmdbResp = await axios.get(tmdbAddonUrl, { timeout: 8000 }).then(r => r.data);
                if (tmdbResp?.meta?.imdb_id) {
                    imdbId = tmdbResp.meta.imdb_id;
                    console.log(`[Addons] Resolved TMDB ID ${tmdbId} to IMDb ID: ${imdbId}`);
                }
            } catch (err) {
                console.warn(`[Addons] Failed to resolve TMDB ID ${tmdbId} to IMDb ID:`, err.message);
            }
        }
        console.log(`[Addons] "search-addons" invoked for: ${title} (IMDb: ${imdbId}, TMDB: ${tmdbId}, Kitsu: ${kitsuId}, MAL: ${malId})`);
        const appData = (store && typeof store.get === 'function' ? store.get('appData') : null) || {};
        const sc = appData.scraperConfig || {};
        sc.installedAddons = appData.installedAddons || [];
        if (!sc.installedAddons.length) {
          sc.installedAddons = [
            { id: 'v3.cinemeta.stremio', name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json', icon: '🎬', types: ['movie', 'series'] }
          ];
        } else {
          // Deep clean: replace dead RPDB cinemeta with official cinemeta if it was cached in user store
          sc.installedAddons = sc.installedAddons.map(a => 
            a.id === 'com.rpdb.cinemeta' 
            ? { id: 'v3.cinemeta.stremio', name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io', manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json', icon: '🎬', types: ['movie', 'series'] } 
            : a
          );
        }
        const { StremioAddonService } = require('./StremioAddonService');
        const service = new StremioAddonService(sc);
        const results = await service.getStreams({ imdbId, kitsuId, type, season, episode, title });
        
        if (results.length < 5) {
            results.push({ addon: 'External Search', icon: '🌐', title: `Search "${title}" on Google`, quality: 'Browser', url: `https://www.google.com/search?q=${encodeURIComponent(title + ' stream free')}`, type: 'browser' });
        }
        return results;
    });

    // IPC: Fetch subtitles via StremioAddonService (Stremio Subtitles Addon Protocol)
    ipcMain.handle('fetch-addon-subtitles', async (_e, opts) => {
        let { imdbId, kitsuId, malId, type, season, episode } = opts;
        if (!kitsuId && malId) {
            const mappedKitsu = await getKitsuIdFromMalId(malId);
            if (mappedKitsu) kitsuId = mappedKitsu;
        }
        
        // Normalize local file path if provided
        if (imdbId && isLocalFilePath(imdbId)) {
            const cleanMeta = await getCleanMetadata(imdbId, () => (store && typeof store.get === 'function' ? store.get('appData') : null));
            if (cleanMeta) {
                imdbId = cleanMeta.imdbId;
                season = cleanMeta.season;
                episode = cleanMeta.episode;
                type = cleanMeta.type === 'series' ? 'series' : 'movie';
            } else {
                imdbId = null;
            }
        }

        // Resolve TMDB to IMDb ID if necessary (supports prefix tmdb: and plain numeric)
        let tmdbIdSub = null;
        if (imdbId) {
            const strId = imdbId.toString();
            if (strId.startsWith('tmdb:')) {
                tmdbIdSub = strId.replace('tmdb:', '');
            } else if (/^\d+$/.test(strId)) {
                tmdbIdSub = strId;
            }
        }
        if (tmdbIdSub) {
            try {
                const tmdbAddonUrl = `https://tmdb.elfhosted.com/meta/${type === 'series' ? 'series' : 'movie'}/tmdb:${tmdbIdSub}.json`;
                const tmdbResp = await axios.get(tmdbAddonUrl, { timeout: 8000 }).then(r => r.data);
                if (tmdbResp?.meta?.imdb_id) {
                    imdbId = tmdbResp.meta.imdb_id;
                    console.log(`[Addons] Resolved TMDB ID ${tmdbIdSub} to IMDb ID for subtitles: ${imdbId}`);
                }
            } catch (err) {
                console.warn(`[Addons] Failed to resolve TMDB ID ${tmdbIdSub} to IMDb ID for subtitles:`, err.message);
            }
        }
        console.log(`[Addons] "fetch-addon-subtitles" invoked — IMDb: ${imdbId}, Kitsu: ${kitsuId}, MAL: ${malId}, Type: ${type}, S${season}E${episode}`);
        const appData = (store && typeof store.get === 'function' ? store.get('appData') : null) || {};
        const sc = appData.scraperConfig || {};
        sc.installedAddons = [...(appData.installedAddons || [])].filter(a => {
            const url = String(a.url || a.manifestUrl || '').toLowerCase();
            const id = String(a.id || '').toLowerCase();
            const name = String(a.name || '').toLowerCase();
            return a.enabled !== false && (url.includes('subdl') || id.includes('subdl') || name.includes('subdl'));
        });
        const { StremioAddonService } = require('./StremioAddonService');
        const service = new StremioAddonService(sc);
        try {
            return await service.getSubtitles({ imdbId, kitsuId, type, season, episode });
        } catch (err) {
            console.error('[Addons] fetch-addon-subtitles failed:', err.message);
            return [];
        }
    });

    // IPC: Verify SubDL API key
    ipcMain.handle('subdl-verify-key', async (_e, apiKey) => {
        if (!apiKey) return { success: false, error: 'API key is required' };
        try {
            const url = `https://api.subdl.com/api/v1/subtitles?api_key=${encodeURIComponent(apiKey)}&film_name=Inception`;
            const resp = await axios.get(url, { timeout: 8000 });
            if (resp.status === 200 && resp.data && resp.data.status !== false) {
                return { success: true };
            } else {
                const errorMsg = resp.data?.error || 'Invalid API Key response';
                return { success: false, error: errorMsg };
            }
        } catch (err) {
            console.error('[Addons] subdl-verify-key failed:', err.message);
            const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message || 'Network error';
            return { success: false, error: errorMsg };
        }
    });

    // IPC: Verify TMDB API key
    ipcMain.handle('tmdb-verify-key', async (_e, apiKey) => {
        if (!apiKey) return { success: false, error: 'API key is required' };
        try {
            const url = `https://api.themoviedb.org/3/authentication?api_key=${encodeURIComponent(apiKey)}`;
            const resp = await axios.get(url, { timeout: 8000 });
            if (resp.status === 200 && resp.data && resp.data.success) {
                return { success: true };
            } else {
                const errorMsg = resp.data?.status_message || 'Invalid API Key response';
                return { success: false, error: errorMsg };
            }
        } catch (err) {
            console.error('[Addons] tmdb-verify-key failed:', err.message);
            const errorMsg = err.response?.data?.status_message || err.response?.data?.error || err.message || 'Network error';
            return { success: false, error: errorMsg };
        }
    });

    // IPC: Fetch raw text from subtitle URLs (to bypass client CORS issues)
    ipcMain.handle('fetch-url-text', async (_e, url) => {
        try {
            const resp = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 10000
            });
            return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        } catch (err) {
            console.error('[Addons] fetch-url-text failed:', err.message);
            return null;
        }
    });

    const axios = require('axios');

    async function fetchAllKitsuEpisodes(animeId) {
        const kitsuHeaders = { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' };
        let allEpisodes = [];
        let offset = 0;
        const limit = 100;
        try {
            while (true) {
                const url = `https://kitsu.io/api/edge/anime/${animeId}/episodes?page[limit]=${limit}&page[offset]=${offset}&sort=number`;
                const resp = await axios.get(url, { headers: kitsuHeaders, timeout: 8000 });
                const data = resp.data?.data || [];
                if (data.length === 0) break;
                allEpisodes.push(...data);
                if (data.length < limit || allEpisodes.length >= 1500) break;
                offset += limit;
            }
        } catch (e) { console.error('[Kitsu Episodes] Error:', e.message); }
        return allEpisodes;
    }

    async function getKitsuSeasons(animeId, currentTitle) {
        const kitsuHeaders = { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' };
        let seasonsMap = new Map();
        
        // We need the main anime's date to sort properly.
        let mainDate = '9999-99-99';
        try {
            const mainRes = await axios.get(`https://kitsu.io/api/edge/anime/${animeId}`, { headers: kitsuHeaders, timeout: 5000 });
            mainDate = mainRes.data?.data?.attributes?.startDate || mainDate;
        } catch(e) {}

        seasonsMap.set(String(animeId), { season_number: 0, name: currentTitle, id: animeId, active: true, date: mainDate });

        async function fetchChain(id, direction) {
            try {
                const url = `https://kitsu.io/api/edge/anime/${id}/media-relationships?include=destination&page[limit]=20`;
                const resp = await axios.get(url, { headers: kitsuHeaders, timeout: 5000 });
                const data = resp.data?.data || [];
                const included = resp.data?.included || [];
                
                for (const rel of data) {
                    const role = rel.attributes?.role;
                    if (role === direction) {
                        const destId = String(rel.relationships?.destination?.data?.id);
                        if (seasonsMap.has(destId)) continue; // avoid loops
                        
                        const dest = included.find(i => String(i.id) === destId && i.type === 'anime');
                        if (dest) {
                            seasonsMap.set(destId, {
                                season_number: 0,
                                name: dest.attributes?.canonicalTitle || dest.attributes?.titles?.en || dest.attributes?.titles?.en_jp,
                                id: dest.id,
                                date: dest.attributes?.startDate || '9999-99-99'
                            });
                            await fetchChain(destId, direction);
                        }
                    }
                }
            } catch(e) { console.error('[Kitsu Seasons] Chain error:', e.message); }
        }

        // Fetch recursively
        await fetchChain(animeId, 'sequel');
        await fetchChain(animeId, 'prequel');

        // Fetch 1 level of parents/alternative settings just in case
        try {
            const url = `https://kitsu.io/api/edge/anime/${animeId}/media-relationships?include=destination&page[limit]=20`;
            const resp = await axios.get(url, { headers: kitsuHeaders, timeout: 5000 });
            const data = resp.data?.data || [];
            const included = resp.data?.included || [];
            for (const rel of data) {
                const role = rel.attributes?.role;
                if (['parent', 'alternative_setting'].includes(role)) {
                    const destId = String(rel.relationships?.destination?.data?.id);
                    if (!seasonsMap.has(destId)) {
                        const dest = included.find(i => String(i.id) === destId && i.type === 'anime');
                        if (dest) {
                            seasonsMap.set(destId, {
                                season_number: 0,
                                name: dest.attributes?.canonicalTitle || dest.attributes?.titles?.en || dest.attributes?.titles?.en_jp,
                                id: dest.id,
                                date: dest.attributes?.startDate || '9999-99-99'
                            });
                        }
                    }
                }
            }
        } catch(e) {}

        const uniqueSeasons = Array.from(seasonsMap.values());
        
        // Sort chronologically by start date
        uniqueSeasons.sort((a, b) => {
            if (a.date === b.date) return 0;
            return a.date > b.date ? 1 : -1;
        });

        // Re-assign season numbers
        return uniqueSeasons.map((s, idx) => ({ ...s, season_number: idx + 1 }));
    }

    const kitsuHeaders = { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' };

    async function formatKitsuData(item, includeExtra = false) {
        if (!item) return null;
        try {
            const attrs = item.attributes || {};
            const id = String(item.id || '').replace('kitsu:', '');
            if (!id) return null;
            
            let videos = [];
            let genres = [];
            let seasons = [];
            let malId = null;
            let tvdbId = null;
            let tmdbId = null;

            if (includeExtra) {
                try {
                    const [epData, genRes, catRes, mapRes] = await Promise.allSettled([
                        fetchAllKitsuEpisodes(id),
                        axios.get(`https://kitsu.io/api/edge/anime/${id}/genres`, { headers: kitsuHeaders, timeout: 10000 }),
                        axios.get(`https://kitsu.io/api/edge/anime/${id}/categories?page[limit]=15`, { headers: kitsuHeaders, timeout: 10000 }),
                        axios.get(`https://kitsu.io/api/edge/anime/${id}/mappings?page[limit]=50`, { headers: kitsuHeaders, timeout: 10000 })
                    ]);
                    
                    videos = (epData.status === 'fulfilled' ? epData.value : []).map(ep => {
                        const epAttrs = ep.attributes || {};
                        const epTitle = epAttrs.canonicalTitle || epAttrs.titles?.en || epAttrs.titles?.en_jp || epAttrs.titles?.ja_jp || `Episode ${epAttrs.number}`;
                        return {
                            episode: epAttrs.number || epAttrs.relativeNumber,
                            season: 1,
                            title: epTitle,
                            name: epTitle,
                            thumbnail: epAttrs.thumbnail?.original || epAttrs.thumbnail?.large || null,
                            released: epAttrs.airdate || null
                        };
                    }).sort((a, b) => a.episode - b.episode);

                    const gList = genRes.status === 'fulfilled' ? (genRes.value.data?.data || []) : [];
                    const cList = catRes.status === 'fulfilled' ? (catRes.value.data?.data || []) : [];
                    genres = [...gList.map(g => g.attributes?.name), ...cList.map(c => c.attributes?.title)].filter((v, i, a) => v && a.indexOf(v) === i);
                    
                    const title = attrs.canonicalTitle || attrs.titles?.en || attrs.titles?.en_jp || 'Unknown Anime';
                    seasons = await getKitsuSeasons(id, title);
                    
                    const mappings = mapRes.status === 'fulfilled' ? (mapRes.value.data?.data || []) : [];
                    for (const mapping of mappings) {
                        const site = String(mapping.attributes?.externalSite || '').toLowerCase();
                        const externalId = mapping.attributes?.externalId || null;
                        if (!externalId) continue;
                        if (site.includes('myanimelist')) malId = externalId;
                        if (site.includes('thetvdb') || site.includes('tvdb')) tvdbId = externalId;
                        if (site.includes('themoviedb') || site.includes('tmdb')) tmdbId = externalId;
                    }
                } catch (e) { console.error('[Kitsu Extra] Error:', e.message); }
            }

            const title = attrs.canonicalTitle || attrs.titles?.en || attrs.titles?.en_jp || 'Unknown Anime';
            const rating = attrs.averageRating ? parseFloat((parseFloat(attrs.averageRating) / 10).toFixed(1)) : 0;

            return {
                id: `kitsu:${id}`,
                kitsuId: id,
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
                mal_id: malId,
                tvdb_id: tvdbId,
                tmdb_id: tmdbId,
                status: attrs.status,
                genres: genres,
                videos: videos,
                seasons: seasons,
                source: 'kitsu',
                cast: typeof _kitsu_cast !== 'undefined' ? _kitsu_cast : []
            };
        } catch (err) {
            console.error('[Kitsu Format] Item error:', err);
            return null;
        }
    }

    ipcMain.handle('kitsu-search', async (_e, query) => {
        return { results: [] };
    });

    ipcMain.handle('kitsu-details', async (_e, id) => {
        try {
            const cleanId = String(id).replace('kitsu:', '');
            const resp = await axios.get(`https://kitsu.io/api/edge/anime/${cleanId}`, { headers: kitsuHeaders, timeout: 8000 });
            if (resp.data && resp.data.data) {
                return await formatKitsuData(resp.data.data, true);
            }
        } catch (e) {
            console.error('[Addons] kitsu-details error:', e.message);
        }
        return null;
    });

    ipcMain.handle('kitsu-details-by-mal', async (_e, malId) => {
        try {
            const kitsuId = await getKitsuIdFromMalId(malId);
            if (kitsuId) {
                const resp = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, { headers: kitsuHeaders, timeout: 8000 });
                if (resp.data && resp.data.data) {
                    return await formatKitsuData(resp.data.data, true);
                }
            }
        } catch (e) {
            console.error('[Addons] kitsu-details-by-mal error:', e.message);
        }
        return null;
    });

    // NEW: Unified Search (Cinemeta & TMDB Addon Movies/TV)
    ipcMain.handle('unified-search', async (_e, query) => {
        if (!query || query.trim().length < 2) {
            return { results: [] };
        }
        try {
            console.log('[Unified Search] Searching for:', query);
            const q = encodeURIComponent(query.trim());
            const appData = (store && typeof store.get === 'function' ? store.get('appData') : null) || {};
            const tmdbKey = appData.tmdbKey || '';

            // 1. Search Stremio TMDB Addon (Very reliable, TMDB CDN poster images, no key needed)
            const tmdbMoviesPromise = axios.get(`https://tmdb.elfhosted.com/catalog/movie/top/search=${q}.json`, { timeout: 8000 })
                .then(resp => {
                    const items = resp.data?.metas || [];
                    return items.map(movie => ({
                        id: movie.id,
                        title: movie.name,
                        poster: movie.poster || '',
                        backdrop: movie.background || '',
                        type: 'movie',
                        source: 'tmdb',
                        rating: movie.imdbRating ? parseFloat(movie.imdbRating) : 0,
                        releaseYear: movie.year ? parseInt(movie.year) : 0,
                        synopsis: movie.description || ''
                    }));
                })
                .catch(err => {
                    console.warn('[Unified Search] TMDB movie addon search failed:', err.message);
                    return [];
                });

            const tmdbTvPromise = axios.get(`https://tmdb.elfhosted.com/catalog/series/top/search=${q}.json`, { timeout: 8000 })
                .then(resp => {
                    const items = resp.data?.metas || [];
                    return items.map(tv => ({
                        id: tv.id,
                        title: tv.name,
                        poster: tv.poster || '',
                        backdrop: tv.background || '',
                        type: 'tv',
                        source: 'tmdb',
                        rating: tv.imdbRating ? parseFloat(tv.imdbRating) : 0,
                        releaseYear: tv.year ? parseInt(tv.year) : 0,
                        synopsis: tv.description || ''
                    }));
                })
                .catch(err => {
                    console.warn('[Unified Search] TMDB TV addon search failed:', err.message);
                    return [];
                });

            // 2. Search Cinemeta (Traditional fallback)
            const cinemetaMoviesPromise = fetchCinemeta(`/catalog/movie/top/search=${q}.json`)
                .then(data => {
                    const items = data?.metas || [];
                    return items.map(movie => ({
                        id: movie.id,
                        title: movie.name,
                        poster: movie.poster ? movie.poster.replace('https://images.metahub.space/poster/small/', '/').replace('https://images.metahub.space/poster/medium/', '/') : '',
                        type: 'movie',
                        source: 'cinemeta',
                        rating: movie.imdbRating ? parseFloat(movie.imdbRating) : 0,
                        releaseYear: movie.releaseInfo ? parseInt(movie.releaseInfo.substring(0, 4)) : 0,
                        synopsis: movie.description || ''
                    }));
                })
                .catch(err => {
                    console.warn('[Unified Search] Cinemeta movie search failed:', err.message);
                    return [];
                });

            const cinemetaTvPromise = fetchCinemeta(`/catalog/series/top/search=${q}.json`)
                .then(data => {
                    const items = data?.metas || [];
                    return items.map(tv => ({
                        id: tv.id,
                        title: tv.name,
                        poster: tv.poster ? tv.poster.replace('https://images.metahub.space/poster/small/', '/').replace('https://images.metahub.space/poster/medium/', '/') : '',
                        type: 'tv',
                        source: 'cinemeta',
                        rating: tv.imdbRating ? parseFloat(tv.imdbRating) : 0,
                        releaseYear: tv.releaseInfo ? parseInt(tv.releaseInfo.substring(0, 4)) : 0,
                        synopsis: tv.description || ''
                    }));
                })
                .catch(err => {
                    console.warn('[Unified Search] Cinemeta TV search failed:', err.message);
                    return [];
                });

            // 3. Search Official TMDB API if tmdbKey is active (Additional premium metadata)
            let officialTmdbMoviesPromise = Promise.resolve([]);
            let officialTmdbTvPromise = Promise.resolve([]);

            if (tmdbKey) {
                officialTmdbMoviesPromise = axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`, { timeout: 6000 })
                    .then(resp => {
                        const items = resp.data?.results || [];
                        return items.map(movie => ({
                            id: `tmdb:${movie.id}`,
                            title: movie.title,
                            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
                            backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : '',
                            type: 'movie',
                            source: 'tmdb',
                            rating: movie.vote_average ? parseFloat(movie.vote_average.toFixed(1)) : 0,
                            releaseYear: movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : 0,
                            synopsis: movie.overview || ''
                        }));
                    })
                    .catch(() => []);

                officialTmdbTvPromise = axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${q}`, { timeout: 6000 })
                    .then(resp => {
                        const items = resp.data?.results || [];
                        return items.map(tv => ({
                            id: `tmdb:${tv.id}`,
                            title: tv.name,
                            poster: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '',
                            backdrop: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : '',
                            type: 'tv',
                            source: 'tmdb',
                            rating: tv.vote_average ? parseFloat(tv.vote_average.toFixed(1)) : 0,
                            releaseYear: tv.first_air_date ? parseInt(tv.first_air_date.substring(0, 4)) : 0,
                            synopsis: tv.overview || ''
                        }));
                    })
                    .catch(() => []);
            }

            const [tmdbMovies, tmdbTv, cinemetaMovies, cinemetaTv, officialTmdbMovies, officialTmdbTv] = await Promise.all([
                
                
                cinemetaMoviesPromise,
                cinemetaTvPromise,
                officialTmdbMoviesPromise,
                officialTmdbTvPromise
            ]);

            // Merge and deduplicate results
            const merged = [];
            const seen = new Set();

            const addResults = (items) => {
                for (const item of items) {
                    const key = `${(item.title || '').toLowerCase().trim()}_${item.releaseYear || ''}_${item.type}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(item);
                    } else {
                        const existingIdx = merged.findIndex(x => `${(x.title || '').toLowerCase().trim()}_${x.releaseYear || ''}_${x.type}` === key);
                        if (existingIdx !== -1) {
                            const existing = merged[existingIdx];
                            // Prefer TMDB over Cinemeta because of direct CDN poster/backdrop URLs
                            if (item.source === 'tmdb' && existing.source !== 'tmdb') {
                                merged[existingIdx] = item;
                            }
                        }
                    }
                }
            };

            // Order of priority: official TMDB API > TMDB Addon > Cinemeta
            addResults(officialTmdbMovies);
            addResults(officialTmdbTv);
            
            
            addResults(cinemetaMovies);
            addResults(cinemetaTv);

            // Sort by rating (highest first)
            merged.sort((a, b) => (b.rating || 0) - (a.rating || 0));

            console.log(`[Unified Search] Found ${merged.length} deduplicated results for query: "${query}"`);
            return { results: merged };
        } catch (err) {
            console.error('[Unified Search] Error:', err.message);
            return { results: [] };
        }
    });

    const queryAniList = async (queryStr, variables = {}) => {
        try {
            const resp = await axios.post('https://graphql.anilist.co', {
                query: queryStr,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                timeout: 8000
            });
            return resp.data?.data;
        } catch (err) {
            console.error('[AniList] API error:', err.message);
            return null;
        }
    };

    ipcMain.handle('anilist-search', async (_e, query) => {
        if (!query) return [];
        const graphQL = `
            query ($search: String) {
              charactersPage: Page (page: 1, perPage: 15) {
                characters (search: $search) {
                  id
                  name {
                    full
                  }
                  image {
                    large
                  }
                }
              }
              mediaPage: Page (page: 1, perPage: 15) {
                media (search: $search, type: ANIME) {
                  id
                  title {
                    romaji
                    english
                  }
                  coverImage {
                    large
                  }
                }
              }
            }
        `;
        const data = await queryAniList(graphQL, { search: query });
        if (!data) return [];
        
        const results = [];
        if (data.charactersPage?.characters) {
            data.charactersPage.characters.forEach(char => {
                results.push({
                    id: char.id,
                    title: char.name?.full || 'Unknown Character',
                    poster: char.image?.large || '',
                    type: 'character',
                    source: 'anilist'
                });
            });
        }
        if (data.mediaPage?.media) {
            data.mediaPage.media.forEach(med => {
                results.push({
                    id: med.id,
                    title: med.title?.english || med.title?.romaji || 'Unknown Anime',
                    poster: med.coverImage?.large || '',
                    type: 'anime',
                    source: 'anilist'
                });
            });
        }
        return results;
    });

    ipcMain.handle('anilist-media-detailed', async (_e, { id, title }) => {
        if (!id && !title) return null;
        const graphQL = `
            query ($id: Int, $search: String) {
              Media (id: $id, search: $search, type: ANIME) {
                id
                description
                bannerImage
                genres
                coverImage {
                  extraLarge
                  large
                }
              }
            }
        `;
        const variables = {};
        if (id) variables.id = parseInt(id, 10);
        else variables.search = title;
        
        const data = await queryAniList(graphQL, variables);
        return data?.Media || null;
    });

    ipcMain.handle('anilist-media-assets', async (_e, id) => {
        if (!id) return [];
        const graphQL = `
            query ($id: Int) {
              Media (id: $id) {
                characters (sort: [ROLE, RELEVANCE], page: 1, perPage: 25) {
                  nodes {
                    id
                    name {
                      full
                    }
                    image {
                      large
                    }
                  }
                }
              }
            }
        `;
        const data = await queryAniList(graphQL, { id: parseInt(id, 10) });
        if (!data?.Media?.characters?.nodes) return [];
        
        return data.Media.characters.nodes.map(node => ({
            id: node.id,
            title: node.name?.full || 'Unknown Character',
            poster: node.image?.large || '',
            type: 'character'
        }));
    });


    // IPC: Start streaming a torrent
    ipcMain.handle('stream-torrent', async (_e, infoHashOrMagnet, fileIdx) => {
        console.log(`[Addons] Request to stream torrent: ${infoHashOrMagnet} (FileIdx: ${fileIdx})`);

        // Cleanup existing engine/server
        if (torrentEngine) {
            try { torrentEngine.destroy(); } catch(e) {}
            torrentEngine = null;
        }
        if (torrentServer) {
            try { torrentServer.close(); } catch(e) {}
            torrentServer = null;
        }

        const publicTrackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://9.rarbg.com:2810/announce',
            'udp://open.stealth.si:80/announce',
            'udp://exodus.desync.com:6969/announce',
            'udp://tracker.openbittorrent.com:6969/announce'
        ];

        let magnet = infoHashOrMagnet;
        if (!magnet.startsWith('magnet:') && !magnet.startsWith('http')) {
            magnet = `magnet:?xt=urn:btih:${infoHashOrMagnet}&tr=` + publicTrackers.map(encodeURIComponent).join('&tr=');
        }

        const engineOptions = {
            connections: 150,
            uploads: 10,
            verify: true,
            path: path.join(app.getPath('temp'), 'MediaVaultCache'),
            tracker: true,
            trackers: publicTrackers
        };

        torrentEngine = torrentStream(magnet, engineOptions);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (torrentEngine) { torrentEngine.destroy(); torrentEngine = null; }
                reject(new Error('Torrent timeout (No peers found within 90s)'));
            }, 90000);

            torrentEngine.on('ready', () => {
                clearTimeout(timeout);
                console.log('[Addons] Torrent engine ready. Files:', torrentEngine.files.length);

                // ── Selection Logic ──
                const VIDEO_EXT = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i;
                let file;
                
                // If index is provided, use it. Otherwise find largest video.
                if (fileIdx !== undefined && fileIdx !== null && torrentEngine.files[fileIdx]) {
                    file = torrentEngine.files[fileIdx];
                } else {
                    const videoFiles = torrentEngine.files.filter(f => VIDEO_EXT.test(f.name));
                    // Prioritize files > 50MB to avoid samples, then take largest
                    const realVideos = videoFiles.filter(f => f.length > 50 * 1024 * 1024);
                    const sourceList = realVideos.length > 0 ? realVideos : (videoFiles.length > 0 ? videoFiles : torrentEngine.files);
                    file = sourceList.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
                }

                // ── Priority ──
                torrentEngine.files.forEach(f => { if (f !== file) f.deselect(); });
                file.select();
                console.log(`[Addons] Selected file for streaming: "${file.name}" (${(file.length / 1024 / 1024).toFixed(1)} MB)`);

                // ── Mime Resolution ──
                const ext = path.extname(file.name).toLowerCase();
                const mimeMap = { '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.webm': 'video/webm', '.mov': 'video/quicktime' };
                const mime = mimeMap[ext] || require('mime-types').lookup(ext) || 'video/mp4';

                const http = require('http');
                torrentServer = http.createServer((req, res) => {
                    const range = req.headers.range;
                    
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Server', 'MediaVault/3.0');

                    if (req.method === 'OPTIONS') {
                        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                        res.setHeader('Access-Control-Allow-Headers', 'Range');
                        res.writeHead(204); res.end(); return;
                    }

                    // ── Subtitle Extraction (FFmpeg WebVTT) ──
                    if (req.url.startsWith('/stream/subtitle/')) {
                        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
                        const trackIndex = req.url.split('/').pop();
                        const { spawn } = require('child_process');
                        const ffmpegPath = require('ffmpeg-static');
                        
                        const streamUrl = `http://127.0.0.1:${torrentServer.address().port}/0`;
                        const ffmpeg = spawn(ffmpegPath, [
                            '-i', streamUrl,
                            '-map', `0:${trackIndex}`,
                            '-f', 'webvtt',
                            'pipe:1'
                        ]);
                        
                        ffmpeg.stdout.pipe(res);
                        
                        res.on('close', () => {
                            try { ffmpeg.kill('SIGKILL'); } catch(e) {}
                        });
                        return;
                    }

                    // ── HEAD Request ──
                    if (req.method === 'HEAD') {
                        res.setHeader('Accept-Ranges', 'bytes');
                        res.setHeader('Content-Type', mime);
                        res.setHeader('Content-Length', file.length);
                        res.writeHead(200); res.end(); return;
                    }

                    if (!range) {
                        res.setHeader('Accept-Ranges', 'bytes');
                        res.setHeader('Content-Type', mime);
                        res.setHeader('Content-Length', file.length);
                        res.writeHead(200);
                        const stream = file.createReadStream();
                        stream.pipe(res);
                        res.on('close', () => { stream.destroy(); });
                        return;
                    }

                    // ── Range Request ──
                    const parts = range.replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
                    
                    if (start >= file.length || end >= file.length) {
                        res.writeHead(416, { 'Content-Range': `bytes */${file.length}` });
                        return res.end();
                    }

                    const chunksize = (end - start) + 1;
                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${file.length}`,
                        'Content-Length': chunksize,
                        'Content-Type': mime,
                        'Accept-Ranges': 'bytes'
                    });

                    const stream = file.createReadStream({ start, end });
                    stream.pipe(res);
                    res.on('close', () => { stream.destroy(); });
                });

                torrentServer.listen(0, '127.0.0.1', () => {
                    const port = torrentServer.address().port;
                    const streamUrl = `http://127.0.0.1:${port}`;
                    console.log(`[Addons] Local streaming server: ${streamUrl} | File: ${file.name} | Size: ${(file.length / 1024 / 1024).toFixed(1)} MB`);
                    
                    // ── Probe Metadata using FFprobe ──
                    const { exec } = require('child_process');
                    const ffprobePath = require('ffprobe-static').path;
                    exec(`"${ffprobePath}" -v quiet -print_format json -show_streams "${streamUrl}/0"`, (err, stdout, stderr) => {
                        if (!err && stdout) {
                            try {
                                const meta = JSON.parse(stdout);
                                const audioTracks = meta.streams.filter(s => s.codec_type === 'audio').map(s => ({
                                    index: s.index,
                                    language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'Unknown',
                                    title: (s.tags && (s.tags.title || s.tags.TITLE)) || '',
                                    codec: s.codec_name
                                }));
                                const subtitleTracks = meta.streams.filter(s => s.codec_type === 'subtitle').map(s => ({
                                    index: s.index,
                                    language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'Unknown',
                                    title: (s.tags && (s.tags.title || s.tags.TITLE)) || '',
                                    codec: s.codec_name
                                }));
                                
                                console.log(`[FFprobe] Found ${audioTracks.length} audio tracks, ${subtitleTracks.length} subtitle tracks.`);
                                const win = require('electron').BrowserWindow.getAllWindows()[0];
                                if (win && !win.isDestroyed()) {
                                    win.webContents.send('stream-metadata-ready', { audioTracks, subtitleTracks, streamUrl });
                                }
                            } catch(e) { console.error('[FFprobe] Parse Error:', e); }
                        } else {
                            console.error('[FFprobe] Probing failed:', err?.message || stderr);
                        }
                    });

                    resolve({ url: streamUrl, title: file.name });
                });
            });

            // ── Progress Reporting ──
            const progressInterval = setInterval(() => {
                if (!torrentEngine) { clearInterval(progressInterval); return; }
                const sw = torrentEngine.swarm;
                const win = require('electron').BrowserWindow.getAllWindows()[0];
                if (win && !win.isDestroyed()) {
                    win.webContents.send('torrent-progress', {
                        speed: (sw.downloadSpeed() / 1024 / 1024).toFixed(2) + ' MB/s',
                        percent: 'Streaming...',
                        peers: sw.connections.length
                    });
                }
            }, 1000);

            torrentEngine.on('error', (err) => {
                console.error('[Addons] Engine error:', err);
                clearInterval(progressInterval);
                reject(err);
            });
        });
    });

    // ─── NATIVE TRAKT.TV INTEGRATION IPC HANDLERS ───
    const TraktService = require('./TraktService');

    ipcMain.handle('trakt-get-auth-code', async (_e, { clientId, clientSecret } = {}) => {
        try {
            const cleanId = (clientId || '').trim();
            const cleanSecret = (clientSecret || '').trim();

            if (cleanId && cleanSecret) {
                TraktService.saveCredentials({ clientId: cleanId, clientSecret: cleanSecret });
            } else {
                // If either is empty, clear them by saving nulls to revert to default credentials
                TraktService.saveCredentials({ clientId: null, clientSecret: null });
            }
            
            return await TraktService.generateDeviceCode();
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('trakt-check-auth-status', async (_e, deviceCode) => {
        try {
            return await TraktService.pollDeviceToken(deviceCode);
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('trakt-disconnect', async () => {
        TraktService.clearCredentials();
        return { success: true };
    });

    ipcMain.handle('trakt-connection-status', async () => {
        return TraktService.getCredentials();
    });

    ipcMain.handle('trakt-sync-watchlist', async () => {
        try {
            return await TraktService.getWatchlist();
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('trakt-toggle-watchlist', async (_e, { action, item }) => {
        try {
            if (action === 'add') {
                return await TraktService.addToWatchlist(item);
            } else {
                return await TraktService.removeFromWatchlist(item);
            }
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('trakt-scrobble-event', async (_e, { action, media, progress }) => {
        try {
            return await TraktService.scrobble(action, media, progress);
        } catch (err) {
            return { error: err.message };
        }
    });

    ipcMain.handle('trakt-search', async (_e, { query, type }) => {
        try {
            const results = await TraktService.search(query, type);
            return { results };
        } catch (err) {
            return { error: err.message, results: [] };
        }
    });

    ipcMain.handle('trakt-playback-progress', async () => {
        try {
            return await TraktService.getPlaybackProgress();
        } catch (err) {
            return { error: err.message };
        }
    });
}

function detectQuality(text) {
    if (!text) return 'Unknown';
    if (text.includes('2160p') || text.includes('4K')) return '4K';
    if (text.includes('1080p')) return '1080p';
    if (text.includes('720p')) return '720p';
    if (text.includes('480p')) return '480p';
    return 'HD';
}

module.exports = { initAddonsIpc, stopAddonStreaming };
