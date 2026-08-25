const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { getCleanMetadata, isLocalFilePath } = require('./utils/MetadataNormalizer');
const torrentStream = require('torrent-stream');
let torrentEngine = null;
let torrentServer = null;

const searchCache = new Map();
const streamCache = new Map();

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
    try {
        const { stopStreaming } = require('./streamer');
        stopStreaming();
    } catch(e) {}
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
        
        // Fast Stream Cache Lookup (0ms response if recently searched)
        const streamKey = `${imdbId || ''}_${tmdbId || ''}_${kitsuId || ''}_${season || ''}_${episode || ''}`;
        if (streamKey.length > 3 && streamCache.has(streamKey)) {
            const cached = streamCache.get(streamKey);
            if (Date.now() - cached.timestamp < 300000) { // 5 min TTL
                console.log('[Addons] ⚡ Returning fast cached streams for:', streamKey);
                return cached.data;
            }
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

        // Resolve TMDB to IMDb ID if necessary with fast 2s timeout
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
                const tmdbResp = await axios.get(tmdbAddonUrl, { timeout: 2000 }).then(r => r.data);
                if (tmdbResp?.meta?.imdb_id) {
                    imdbId = tmdbResp.meta.imdb_id;
                    console.log(`[Addons] Resolved TMDB ID ${tmdbId} to IMDb ID: ${imdbId}`);
                }
            } catch (err) {
                console.warn(`[Addons] TMDB ID resolution note:`, err.message);
            }
        }
        console.log(`[Addons] "search-addons" invoked for: ${title} (IMDb: ${imdbId}, TMDB: ${tmdbId}, Kitsu: ${kitsuId}, MAL: ${malId})`);
        const appData = (store && typeof store.get === 'function' ? store.get('appData') : null) || {};
        const sc = appData.scraperConfig || {};
        sc.installedAddons = (Array.isArray(appData.installedAddons) && appData.installedAddons.length > 0)
            ? appData.installedAddons
            : [
                { id: 'torrentio', name: 'Torrentio', url: 'https://torrentio.strem.fun', types: ['movie', 'series', 'anime'], icon: '⚡' },
                { id: 'knightcrawler', name: 'KnightCrawler', url: 'https://main.knightcrawler.elfhosted.com', types: ['movie', 'series', 'anime'], icon: '🐉' }
            ];
        const { StremioAddonService } = require('./StremioAddonService');
        const service = new StremioAddonService(sc);
        const results = await service.getStreams({ imdbId, kitsuId, type, season, episode, title });
        
        if (results.length < 5) {
            results.push({ addon: 'External Search', icon: '🌐', title: `Search "${title}" on Google`, quality: 'Browser', url: `https://www.google.com/search?q=${encodeURIComponent(title + ' stream free')}`, type: 'browser' });
        }
        if (streamKey.length > 3 && results.length > 0) {
            streamCache.set(streamKey, { data: results, timestamp: Date.now() });
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
            const cacheKey = query.trim().toLowerCase();
            if (cacheKey && searchCache.has(cacheKey)) {
                const cached = searchCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 300000) { // 5 min TTL
                    console.log('[Unified Search] ⚡ Returning fast cached results for:', cacheKey);
                    return cached.data;
                }
            }

            console.log('[Unified Search] Searching for:', query);
            const q = encodeURIComponent(query.trim());
            const appData = (store && typeof store.get === 'function' ? store.get('appData') : null) || {};
            const tmdbKey = appData.tmdbKey || '';

            // 1. Search Stremio TMDB Addon (Fast 2.5s timeout)
            const tmdbMoviesPromise = axios.get(`https://tmdb.elfhosted.com/catalog/movie/top/search=${q}.json`, { timeout: 2500 })
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
                .catch(err => []);

            const tmdbTvPromise = axios.get(`https://tmdb.elfhosted.com/catalog/series/top/search=${q}.json`, { timeout: 2500 })
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
                .catch(err => []);

            // 2. Search Cinemeta (Fast 2.5s timeout)
            const cinemetaMoviesPromise = fetchCinemeta(`/catalog/movie/top/search=${q}.json`, 2500)
                .then(data => {
                    const items = data?.metas || [];
                    return items.map(movie => ({
                        id: movie.id,
                        title: movie.name,
                        poster: movie.poster ? (movie.poster.startsWith('http') ? movie.poster : `https://images.metahub.space/poster/medium/${movie.id}/img`) : (movie.id ? `https://images.metahub.space/poster/medium/${movie.id}/img` : ''),
                        type: 'movie',
                        source: 'cinemeta',
                        rating: movie.imdbRating ? parseFloat(movie.imdbRating) : 0,
                        releaseYear: movie.releaseInfo ? parseInt(movie.releaseInfo.substring(0, 4)) : 0,
                        synopsis: movie.description || ''
                    }));
                })
                .catch(err => []);

            const cinemetaTvPromise = fetchCinemeta(`/catalog/series/top/search=${q}.json`, 2500)
                .then(data => {
                    const items = data?.metas || [];
                    return items.map(tv => ({
                        id: tv.id,
                        title: tv.name,
                        poster: tv.poster ? (tv.poster.startsWith('http') ? tv.poster : `https://images.metahub.space/poster/medium/${tv.id}/img`) : (tv.id ? `https://images.metahub.space/poster/medium/${tv.id}/img` : ''),
                        type: 'tv',
                        source: 'cinemeta',
                        rating: tv.imdbRating ? parseFloat(tv.imdbRating) : 0,
                        releaseYear: tv.releaseInfo ? parseInt(tv.releaseInfo.substring(0, 4)) : 0,
                        synopsis: tv.description || ''
                    }));
                })
                .catch(err => []);

            // 3. Search Official TMDB API if tmdbKey is active
            let officialTmdbMoviesPromise = Promise.resolve([]);
            let officialTmdbTvPromise = Promise.resolve([]);

            if (tmdbKey) {
                officialTmdbMoviesPromise = axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}`, { timeout: 2500 })
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

                officialTmdbTvPromise = axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${q}`, { timeout: 2500 })
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
                tmdbMoviesPromise,
                tmdbTvPromise,
                cinemetaMoviesPromise,
                cinemetaTvPromise,
                officialTmdbMoviesPromise,
                officialTmdbTvPromise
            ]);

            // Merge and deduplicate results
            const merged = [];
            const seen = new Set();

            const addResults = (items) => {
                if (!items || !Array.isArray(items)) return;
                for (const item of items) {
                    const key = `${(item.title || '').toLowerCase().trim()}_${item.releaseYear || ''}_${item.type}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(item);
                    } else {
                        const existingIdx = merged.findIndex(x => `${(x.title || '').toLowerCase().trim()}_${x.releaseYear || ''}_${x.type}` === key);
                        if (existingIdx !== -1) {
                            const existing = merged[existingIdx];
                            if (item.source === 'tmdb' && existing.source !== 'tmdb') {
                                merged[existingIdx] = item;
                            }
                        }
                    }
                }
            };

            addResults(officialTmdbMovies);
            addResults(officialTmdbTv);
            addResults(cinemetaMovies);
            addResults(cinemetaTv);
            addResults(tmdbMovies);
            addResults(tmdbTv);

            if (cacheKey && merged.length > 0) {
                searchCache.set(cacheKey, { data: { results: merged }, timestamp: Date.now() });
            }

            return { results: merged };
        } catch (err) {
            console.error('[Unified Search] Search error:', err.message);
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
        const creds = TraktService.getCredentials();
        if (!creds || !creds.accessToken) return null;
        // Always include `connected: true` so the renderer's guard check works correctly.
        return { ...creds, connected: true };
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
