const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { BANNERS_DIR, DATA_DIR, ensureDir, loadData, saveData, getInMemorySession } = require('../store');

let currentFanartKey = '9b894a8fe501790e488c98a5ee605e34';
let metadataProvider = 'cinemeta'; // 'cinemeta' or 'mal'

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const FANART_BASE = 'https://webservice.fanart.tv/v3';
const FANART_CACHE_FILE = path.join(DATA_DIR, 'fanart_cache.json');
let fanartCache = {};

try {
  ensureDir(DATA_DIR);
  if (fs.existsSync(FANART_CACHE_FILE)) {
    fanartCache = JSON.parse(fs.readFileSync(FANART_CACHE_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('[STORE] Failed to load fanart cache:', e.message);
}

function saveFanartCache() {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(FANART_CACHE_FILE, JSON.stringify(fanartCache), 'utf8');
  } catch (e) {
    console.error('[STORE] Failed to save fanart cache:', e.message);
  }
}

async function fetchCinemetaUrl(url, timeout = 10000) {
  const endpoints = [
    url,
    url.replace('v3-cinemeta.strem.io', 'cinemeta.strem.io'),
    url.replace('v3-cinemeta.strem.io', 'v3-cinemeta.strem.fun')
  ];

  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const resp = await axios.get(endpoint, { timeout, headers: { 'User-Agent': 'MediaVault/3.0' } });
      return resp;
    } catch (err) {
      lastErr = err;
      console.warn(`[Cinemeta] Failed to fetch from ${endpoint}:`, err.message);
    }
  }

  throw lastErr || new Error(`Failed to fetch from all Cinemeta endpoints for ${url}`);
}

/**
 * Sanitize a poster/backdrop URL coming from Cinemeta API responses.
 * v3-cinemeta.strem.io never serves image files — it only serves JSON metadata.
 * Any image URL pointing there will return 404. We convert them to images.metahub.space
 * which is the actual working CDN for IMDb-ID-based posters.
 */
function sanitizePosterUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Pattern: https://v3-cinemeta.strem.io/poster/<size>/<imdbId>/<filename>
  if (url.includes('cinemeta.strem.io') && url.includes('/poster/')) {
    const m = url.match(/\/poster\/\w+\/(tt\d+)\//);
    if (m) return `https://images.metahub.space/poster/medium/${m[1]}/img`;
    return ''; // Can't salvage without an IMDb ID
  }
  return url;
}

function cleanMediaName(filename) {
  if (!filename) return "";
  let name = filename.split(/[/\\]/).pop();
  name = name.replace(/\.[^/.]+$/, "");
  
  name = name.replace(/\[.*?\]/g, " ")
             .replace(/\(.*?\)/g, " ")
             .replace(/\{(.*?)\}/g, " ")
             .replace(/\b(1080p|720p|4k|2160p|uhd|hdtv|brrip|bdrip|dvdrip|x264|x265|hevc|web-dl|webrip|aac|dd5\.1|bluray|dual-audio|hindi|english|multi-audio|multi|hc|sub|cam|telesync|proper|repack|internal|remux|atmos|truehd)\b/gi, " ")
             .replace(/[._-]/g, " ")
             .replace(/\s+/g, " ")
             .trim();

  name = name.replace(/\b(19|20)\d{2}\b$/g, "").trim();
  return name;
}

const STREMIO_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

async function fetchStremioMeta(kitsuId) {
  if (!kitsuId) return null;
  try {
    try {
      const store = await loadData();
      if (store.stremioCache && store.stremioCache[String(kitsuId)]) {
        const cached = store.stremioCache[String(kitsuId)];
        if (Date.now() - cached.ts < STREMIO_CACHE_TTL) return cached.data;
      }
    } catch (e) { /* ignore */ }

    const url = `https://anime-kitsu.strem.fun/meta/anime/kitsu:${kitsuId}.json`;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await throttle('stremio');
        const resp = await axios.get(url, { timeout: 7000, headers: { 'User-Agent': 'MediaVault/3.0' } });
        const meta = resp.data?.meta || resp.data || null;
        if (meta) {
          try {
            const store = await loadData();
            store.stremioCache = store.stremioCache || {};
            store.stremioCache[String(kitsuId)] = { ts: Date.now(), data: meta };
            await saveData(store);
          } catch (e) { /* ignore */ }
          return meta;
        }
        break;
      } catch (err) {
        lastErr = err;
        await sleep(200 * (attempt + 1));
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

const CINEMETA_TITLE_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

async function resolveCinemetaByTitle(query) {
  if (!query) return null;
  const q = String(query).trim();
  if (!q) return null;
  const key = q.toLowerCase();
  try {
    try {
      const store = await loadData();
      if (store.cinemetaTitleCache && store.cinemetaTitleCache[key] && (Date.now() - store.cinemetaTitleCache[key].ts) < CINEMETA_TITLE_CACHE_TTL) {
        return store.cinemetaTitleCache[key].data;
      }
    } catch (e) { /* ignore */ }

    const [movieRes, tvRes] = await Promise.allSettled([
      fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q)}.json`),
      fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(q)}.json`)
    ]);

    const movieResults = movieRes.status === 'fulfilled' && movieRes.value && movieRes.value.data?.metas ? movieRes.value.data.metas : [];
    const tvResults = tvRes.status === 'fulfilled' && tvRes.value && tvRes.value.data?.metas ? tvRes.value.data.metas : [];

    const candidates = [
      ...movieResults.map(r => ({ ...r, media_type: 'movie' })),
      ...tvResults.map(r => ({ ...r, media_type: 'tv' }))
    ];

    const qLower = key;
    candidates.sort((a, b) => {
      const aTitle = (a.name || '').toLowerCase();
      const bTitle = (b.name || '').toLowerCase();
      if (aTitle === qLower && bTitle !== qLower) return -1;
      if (bTitle === qLower && aTitle !== qLower) return 1;
      const aContains = aTitle.includes(qLower);
      const bContains = bTitle.includes(qLower);
      if (aContains && !bContains) return -1;
      if (bContains && !aContains) return 1;
      return 0;
    });

    const best = candidates[0];
    if (!best) return null;
    const out = { id: best.id, type: best.media_type, poster_path: best.poster || null, backdrop_path: best.background || null };
    try {
      const store = await loadData();
      store.cinemetaTitleCache = store.cinemetaTitleCache || {};
      store.cinemetaTitleCache[key] = { ts: Date.now(), data: out };
      await saveData(store);
    } catch (e) { /* ignore */ }
    return out;
  } catch (e) {
    return null;
  }
}

const providerLastCall = {};
const providerMinInterval = { kitsu: 250, stremio: 250, jikan: 350 };

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function throttle(provider) {
  const min = providerMinInterval[provider] || 300;
  const last = providerLastCall[provider] || 0;
  const now = Date.now();
  const wait = Math.max(0, min - (now - last));
  if (wait > 0) await sleep(wait);
  providerLastCall[provider] = Date.now();
}

async function fetchWithThrottle(provider, fn, attempts = 2) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await throttle(provider);
      const res = await fn();
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(150 * (i + 1));
    }
  }
  throw lastErr || new Error('Request failed');
}

function extractFanartAssets(fanartData) {
  const extractUrls = (keys) => {
    for (const key of keys) {
      const value = fanartData?.[key];
      if (!value) continue;
      if (Array.isArray(value) && value.length > 0) {
        return value.map(item => item.url || item).filter(Boolean);
      }
      if (typeof value === 'object' && value.url) {
        return [value.url];
      }
    }
    return [];
  };

  return {
    posters: extractUrls(['tvposter', 'movieposter', 'hdtvposter', 'hdmovieposter']),
    banners: extractUrls(['tvbanner', 'moviebanner', 'tvthumb', 'hdmovieclearart', 'movieart', 'clearart']),
    clearlogos: extractUrls(['hdtvlogo', 'hdmovielogo', 'clearlogo', 'hdclearlogo', 'movielogo']),
    backdrops: extractUrls(['hdbackground', 'showbackground', 'tvbackground', 'moviebackground', 'fanart'])
  };
}

function buildUnifiedResponse(base) {
  return {
    meta: base.meta || null,
    id: base.id || null,
    type: base.type || null,
    title: base.title || null,
    synopsis: base.synopsis || null,
    year: base.year || null,
    runtime: base.runtime || null,
    rating: base.rating || null,
    genres: base.genres || [],
    certification: base.certification || base.meta?.certification || base.meta?.contentRating || base.meta?.content_rating || null,
    content_rating: base.content_rating || base.contentRating || base.meta?.content_rating || base.meta?.contentRating || base.meta?.certification || null,
    imdb_id: base.imdb_id || null,
    tmdb_id: base.tmdb_id || null,
    tvdb_id: base.tvdb_id || null,
    mal_id: base.mal_id || null,
    posters: base.posters || { primary: null, fallback: null, extras: [] },
    banners: base.banners || [],
    clearlogos: base.clearlogos || [],
    backdrops: base.backdrops || [],
    source: base.source || { metadata: null, visuals: null }
  };
}

async function fetchFanartAssets(fanartType, id) {
  try {
    if (!currentFanartKey || !id) return null;
    const url = `${FANART_BASE}/${fanartType}/${id}?api_key=${currentFanartKey}`;
    const res = await axios.get(url, { timeout: 10000 });
    return res.data || null;
  } catch (err) {
    console.warn(`[Fanart.tv] Fetch failed for ${fanartType}/${id}:`, err.message);
    return null;
  }
}

async function mapMalIdToExternal(malId) {
  try {
    if (!malId) return null;

    const armResp = await axios.get(
      `https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=${malId}`,
      { timeout: 8000 }
    ).catch(() => null);

    if (armResp?.data) {
      const data = armResp.data;
      const tvdb = data.thetvdb || data.tvdb || data.tvdb_id || data.thetvdb_id || null;
      const tmdb = data.themoviedb || data.tmdb || data.tmdb_id || data.themoviedb_id || null;
      const anilist = data.anilist || data.anilist_id || null;
      if (tvdb || tmdb) {
        return { tmdb, tvdb, anilistId: anilist };
      }
    }

    const query = `
      query ($mal: Int) {
        Media(idMal: $mal, type: ANIME) {
          id
          idMal
        }
      }
    `;
    const resp = await axios.post(
      'https://graphql.anilist.co',
      { query, variables: { mal: Number(malId) } },
      { timeout: 8000, headers: { 'Content-Type': 'application/json' } }
    );
    const media = resp.data?.data?.Media;
    if (!media) return null;
    return { tmdb: null, tvdb: null, anilistId: media.id || null };
  } catch (err) {
    console.warn('[ID Mapper] Error:', err.message);
    return null;
  }
}

async function getWesternMedia({ id, type }) {
  try {
    if (id && (id.toString().includes('\\') || id.toString().includes('/') || (id.toString().includes(':') && !id.toString().startsWith('tmdb:') && !id.toString().startsWith('mal:')))) {
      // Return empty response immediately if id is a local file path
      return buildUnifiedResponse({ type: type === 'tv' ? 'tv' : 'movie', source: { metadata: null, visuals: null } });
    }

    const cinemetaType = type === 'tv' ? 'series' : 'movie';
    let cinemetaUrl;
    
    if (id && id.toString().startsWith('tt')) {
      cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cinemetaType}/${id}.json`;
    } else {
      const tmdbId = id && id.toString().startsWith('tmdb:') ? id : (id ? `tmdb:${id}` : 'tmdb:0');
      cinemetaUrl = `https://tmdb.elfhosted.com/meta/${cinemetaType}/${tmdbId}.json`;
    }

    const cinemetaResp = await fetchCinemetaUrl(cinemetaUrl).catch(() => null);
    const cinemetaMeta = cinemetaResp?.data?.meta || cinemetaResp?.data || null;

    // Sanitize poster/background URLs from Cinemeta — the cinemeta.strem.io domain
    // only serves JSON, not images. Fix them to use images.metahub.space instead.
    if (cinemetaMeta) {
      if (cinemetaMeta.poster) cinemetaMeta.poster = sanitizePosterUrl(cinemetaMeta.poster);
      if (cinemetaMeta.background) cinemetaMeta.background = sanitizePosterUrl(cinemetaMeta.background);
      if (cinemetaMeta.thumbnail) cinemetaMeta.thumbnail = sanitizePosterUrl(cinemetaMeta.thumbnail);
    }
    const result = {
      id: id || cinemetaMeta?.id || null,
      type: type === 'tv' ? 'tv' : 'movie',
      title: cinemetaMeta?.name || cinemetaMeta?.title || null,
      synopsis: cinemetaMeta?.overview || cinemetaMeta?.description || null,
      year: cinemetaMeta?.year || cinemetaMeta?.released || null,
      runtime: cinemetaMeta?.runtime || null,
      rating: cinemetaMeta?.imdbRating || cinemetaMeta?.rating || null,
      genres: cinemetaMeta?.genres || [],
      certification: cinemetaMeta?.certification || cinemetaMeta?.contentRating || cinemetaMeta?.content_rating || null,
      content_rating: cinemetaMeta?.content_rating || cinemetaMeta?.contentRating || cinemetaMeta?.certification || null,
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

    let fanartId = null;
    let fanartType = type === 'tv' ? 'tv' : 'movies';

    if (result.imdb_id) {
      fanartId = result.imdb_id;
    } else if (result.tvdb_id && type === 'tv') {
      fanartId = result.tvdb_id;
      fanartType = 'tv';
    } else if (result.tmdb_id) {
      fanartId = result.tmdb_id;
    }

    if (fanartId) {
      const fanartData = await fetchFanartAssets(fanartType, fanartId);
      
      if (fanartData) {
        const assets = extractFanartAssets(fanartData);
        
        result.clearlogos = assets.clearlogos;
        result.banners = assets.banners;
        result.backdrops = assets.backdrops;
        result.posters.extras = [...assets.posters, ...assets.banners, ...assets.backdrops];
        
        result.posters.primary = assets.posters[0] || 
                                 assets.banners[0] || 
                                 cinemetaMeta?.poster || 
                                 cinemetaMeta?.thumbnail || 
                                 null;
        result.posters.fallback = cinemetaMeta?.poster || cinemetaMeta?.background || null;
        result.source.visuals = 'fanart.tv';
        if (result.meta) {
          result.meta.fanart = fanartData;
          result.meta.logo = assets.clearlogos[0] || result.meta.logo;
          result.meta.banner = assets.banners[0] || result.meta.banner;
          result.meta.background = assets.backdrops[0] || result.meta.background;
          result.meta.poster = assets.posters[0] || result.meta.poster;
        }
      } else {
        result.posters.primary = cinemetaMeta?.poster || cinemetaMeta?.thumbnail || null;
        result.posters.fallback = cinemetaMeta?.background || null;
        result.backdrops = cinemetaMeta?.background ? [cinemetaMeta.background] : [];
        result.clearlogos = cinemetaMeta?.logo ? [cinemetaMeta.logo] : [];
        result.banners = cinemetaMeta?.banner ? [cinemetaMeta.banner] : [];
        result.source.visuals = 'cinemeta';
      }
    } else {
      result.posters.primary = cinemetaMeta?.poster || cinemetaMeta?.thumbnail || null;
      result.posters.fallback = cinemetaMeta?.background || null;
      result.backdrops = cinemetaMeta?.background ? [cinemetaMeta.background] : [];
    }

    try {
      const store = getInMemorySession();
      const tmdbKey = store.tmdbKey;
      const overrideEnabled = store.tmdbEnabled !== false && store.tmdbImageOverride !== false;
      const scope = store.tmdbImageScope || 'both';
      const imdbId = result.imdb_id || (id && id.toString().startsWith('tt') ? id : null);

      if (tmdbKey && imdbId) {
        const tmdbFindUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
        const tmdbFindResp = await axios.get(tmdbFindUrl, { timeout: 6000 }).catch(() => null);
        const resultsList = result.type === 'tv' ? tmdbFindResp?.data?.tv_results : tmdbFindResp?.data?.movie_results;
        const tmdbItem = resultsList?.[0];
        if (tmdbItem) {
          result.tmdb_id = tmdbItem.id;
          if (result.meta) {
            result.meta.tmdb_id = tmdbItem.id;
          }

          if (overrideEnabled) {
            if ((scope === 'both' || scope === 'posters') && tmdbItem.poster_path) {
              const tmdbPoster = `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}`;
              result.posters.primary = tmdbPoster;
              if (result.meta) result.meta.poster = tmdbPoster;
            }
            if ((scope === 'both' || scope === 'banners') && tmdbItem.backdrop_path) {
              const tmdbBackdrop = `https://image.tmdb.org/t/p/w1280${tmdbItem.backdrop_path}`;
              result.backdrops = [tmdbBackdrop, ...result.backdrops];
              if (result.meta) result.meta.background = tmdbBackdrop;
            }
          }
          try {
            if (result.type === 'tv') {
              const certUrl = `https://api.themoviedb.org/3/tv/${tmdbItem.id}/content_ratings?api_key=${tmdbKey}`;
              const certResp = await axios.get(certUrl, { timeout: 4000 }).catch(() => null);
              if (certResp?.data?.results) {
                const usRating = certResp.data.results.find(r => r.iso_3166_1 === 'US');
                let cert = usRating ? usRating.rating : null;
                if (!cert) {
                  const found = certResp.data.results.find(r => r.rating);
                  if (found) cert = found.rating;
                }
                if (cert) {
                  result.certification = cert;
                  if (result.meta) result.meta.certification = cert;
                }
              }
            } else {
              const certUrl = `https://api.themoviedb.org/3/movie/${tmdbItem.id}/release_dates?api_key=${tmdbKey}`;
              const certResp = await axios.get(certUrl, { timeout: 4000 }).catch(() => null);
              if (certResp?.data?.results) {
                const usRelease = certResp.data.results.find(r => r.iso_3166_1 === 'US');
                let cert = null;
                if (usRelease && usRelease.release_dates) {
                  const found = usRelease.release_dates.find(d => d.certification);
                  if (found) cert = found.certification;
                }
                if (!cert) {
                  for (const r of certResp.data.results) {
                    if (r.release_dates) {
                      const found = r.release_dates.find(d => d.certification);
                      if (found) {
                        cert = found.certification;
                        break;
                      }
                    }
                  }
                }
                if (cert) {
                  result.certification = cert;
                  if (result.meta) result.meta.certification = cert;
                }
              }
            }
          } catch (cErr) {
            console.warn('[TMDB Certification] Failed to fetch certification:', cErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('[TMDB Image Override] Failed to apply TMDB details:', e.message);
    }

    return buildUnifiedResponse(result);
  } catch (err) {
    console.error('[Pipeline:Western] Error:', err.message);
    return buildUnifiedResponse({ type: type === 'tv' ? 'tv' : 'movie', source: { metadata: null, visuals: null } });
  }
}

async function getAnimeMedia({ malId }) {
  return buildUnifiedResponse({ type: 'anime', source: { metadata: null, visuals: null } });
}

async function jikanFetch(endpoint) {
  return fetchWithThrottle('jikan', async () => {
    const url = `${JIKAN_BASE}${endpoint}`;
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'MediaVault/3.0' } });
    return response.data;
  }).catch(err => {
    if (err.response?.status === 429) {
      return { error: 'Jikan API rate limited - please try again later' };
    }
    return { error: 'Jikan API Error: ' + (err.message || 'Unknown error') };
  });
}

function initMetadataIpc(ipcMain) {
  const session = getInMemorySession();
  if (session.fanartKey) currentFanartKey = session.fanartKey;
  if (session.metadataProvider) metadataProvider = session.metadataProvider;

  ipcMain.handle('stremio-addon-list', async () => {
    try {
      const resp = await axios.get('https://api.strem.io/addonscollection.json', { timeout: 10000 });
      return resp.data;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('cinemeta-search', async (_e, query) => {
    try {
      const q = String(query).trim();
      if (!q) return { results: [] };
      const [movieRes, tvRes] = await Promise.allSettled([
        fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q)}.json`),
        fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(q)}.json`)
      ]);
      const movies = movieRes.status === 'fulfilled' && movieRes.value && movieRes.value.data?.metas ? movieRes.value.data.metas : [];
      const shows = tvRes.status === 'fulfilled' && tvRes.value && tvRes.value.data?.metas ? tvRes.value.data.metas : [];
      const results = [
        ...movies.map(r => ({ ...r, media_type: 'movie' })),
        ...shows.map(r => ({ ...r, media_type: 'tv' }))
      ];
      return { results };
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('resolve-local-metadata', async (_e, filePath) => {
    try {
      if (!filePath) return null;
      const q = cleanMediaName(filePath);
      if (!q) return null;
      return await resolveCinemetaByTitle(q);
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('cinemeta-discover-by-genre', async (_e, genre) => {
    try {
      const [movies, shows] = await Promise.all([
        fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/movie/top/genre=${encodeURIComponent(genre)}.json`).catch(() => ({ data: { metas: [] }})),
        fetchCinemetaUrl(`https://v3-cinemeta.strem.io/catalog/series/top/genre=${encodeURIComponent(genre)}.json`).catch(() => ({ data: { metas: [] }}))
      ]);
      const results = [
        ...(movies.data?.metas || []).map(r => ({ ...r, media_type: 'movie' })),
        ...(shows.data?.metas || []).map(r => ({ ...r, media_type: 'tv' }))
      ];
      return { results };
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-discover-by-genre', async (_e, genreId) => {
    try {
      const store = getInMemorySession();
      const tmdbKey = store.tmdbKey;
      if (!tmdbKey) return { results: [] };
      const url = `https://api.themoviedb.org/3/discover/movie?api_key=${tmdbKey}&with_genres=${genreId}&sort_by=popularity.desc`;
      const resp = await axios.get(url, { timeout: 8000 });
      return resp.data || { results: [] };
    } catch (err) {
      console.error('[TMDB Discover] Genre error:', err.message);
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('cinemeta-details', async (_e, { id, type }) => {
    try {
      const res = await getWesternMedia({ id, type });
      return res;
    } catch (err) {
      console.error('[Cinemeta] details error:', err.message);
      return { meta: null };
    }
  });

  ipcMain.handle('cinemeta-catalog', async (_e, { type, id }) => {
    try {
      const cinemetaType = type === 'tv' ? 'series' : 'movie';
      const catalogId = id || 'top';
      const url = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/${catalogId}.json`;
      const resp = await fetchCinemetaUrl(url);
      const data = resp.data || { metas: [] };
      if (Array.isArray(data.metas)) {
        data.metas = data.metas.map(m => {
          let poster = m.poster || '';
          if (poster.startsWith('/tt') || poster.startsWith('tt')) {
            const cleanId = poster.replace(/^\//, '').split('/')[0];
            poster = `https://images.metahub.space/poster/medium/${cleanId}/img`;
          } else if (poster === 'img' || poster === '/img' || poster === 'poster.jpg' || poster === '/poster.jpg' || !poster) {
            poster = m.id ? `https://images.metahub.space/poster/medium/${m.id}/img` : '';
          }
          let bg = m.background || '';
          if (bg.startsWith('/tt') || bg.startsWith('tt')) {
            const cleanId = bg.replace(/^\//, '').split('/')[0];
            bg = `https://images.metahub.space/background/large/${cleanId}/img`;
          } else if (bg === 'img' || bg === '/img' || !bg) {
            bg = m.id ? `https://images.metahub.space/background/large/${m.id}/img` : '';
          }
          return {
            ...m,
            poster,
            background: bg
          };
        });
      }
      return data;
    } catch (err) {
      console.error('[Cinemeta] catalog error:', err.message);
      return { metas: [] };
    }
  });

  ipcMain.handle('download-image', async (_e, imgPath, itemId, force = false) => {
    if (!imgPath) return null;
    ensureDir(BANNERS_DIR);
    let url = imgPath;
    if (!imgPath.startsWith('http')) {
      // If the path looks like a Cinemeta/metahub IMDB path (/tt...), use images.metahub.space
      if (imgPath.startsWith('/tt') || imgPath.startsWith('tt')) {
        const imdbMatch = imgPath.match(/tt\d+/);
        const imdbId = imdbMatch ? imdbMatch[0] : imgPath.replace(/^\//, '');
        url = `https://images.metahub.space/poster/medium/${imdbId}/img`;

      // If it's a TMDB-style relative path (starts with / and not an IMDB path), assume it's a TMDB image path
      } else if (imgPath.startsWith('/')) {
        url = `https://image.tmdb.org/t/p/w500${imgPath}`;
      } else {
        url = imgPath;
      }
    }
    const safe = Buffer.from(String(itemId)).toString('base64').replace(/[/+=]/g, '_');
    const dest = path.join(BANNERS_DIR, safe + '.jpg');
    if (!force && fs.existsSync(dest)) {
      try {
        const stats = fs.statSync(dest);
        if (stats.size > 0) return dest;
      } catch (e) { /* ignore */ }
    }

    const downloadWithRedirects = (targetUrl, redirectsLeft = 5) => {
      return new Promise((resolve) => {
        if (redirectsLeft < 0) return resolve(null);
        try {
          const parsed = new URL(targetUrl);
          const proto = parsed.protocol === 'https:' ? https : require('http');
          const req = proto.get(targetUrl, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 10000 }, (res) => {
            // Follow 301, 302, 307, 308 redirects automatically
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              let redirectUrl = res.headers.location;
              if (!redirectUrl.startsWith('http')) {
                redirectUrl = new URL(redirectUrl, targetUrl).href;
              }
              res.resume();
              return resolve(downloadWithRedirects(redirectUrl, redirectsLeft - 1));
            }

            if (res.statusCode !== 200) {
              res.resume();
              return resolve(null);
            }

            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
              file.close(() => resolve(dest));
            });
            file.on('error', () => {
              file.close();
              try { fs.unlinkSync(dest); } catch (_) {}
              resolve(null);
            });
          });

          req.on('error', () => resolve(null));
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
        } catch (e) {
          resolve(null);
        }
      });
    };

    return downloadWithRedirects(url);
  });

  ipcMain.handle('get-metadata-provider', () => metadataProvider);

  ipcMain.handle('set-metadata-provider', async (_e, p) => {
    if (['cinemeta', 'mal'].includes(p)) {
      metadataProvider = p;
      const store = await loadData();
      store.metadataProvider = p;
      await saveData(store);
      return true;
    }
    return false;
  });

  ipcMain.handle('set-fanart-key', async (_e, key) => {
    if (key && key.trim().length > 0) {
      currentFanartKey = key.trim();
      const store = await loadData();
      store.fanartKey = currentFanartKey;
      await saveData(store);
      return true;
    }
    return false;
  });

  ipcMain.handle('fanart-get-images', async (_e, { imdbId, type }) => {
    try {
      if (!currentFanartKey) return null;
      const fanartType = type === 'tv' || type === 'series' ? 'tv' : 'movies';
      const cacheKey = `${fanartType}_${imdbId}`;
      if (fanartCache[cacheKey] && (Date.now() - fanartCache[cacheKey].timestamp < 7 * 24 * 60 * 60 * 1000)) {
        return fanartCache[cacheKey].data;
      }
      const url = `${FANART_BASE}/${fanartType}/${imdbId}?api_key=${currentFanartKey}`;
      const res = await axios.get(url, { timeout: 10000 });
      fanartCache[cacheKey] = { data: res.data, timestamp: Date.now() };
      saveFanartCache();
      return res.data;
    } catch (err) {
      console.error('[Fanart] get images error:', err.message);
      const fanartType = type === 'tv' || type === 'series' ? 'tv' : 'movies';
      const cacheKey = `${fanartType}_${imdbId}`;
      if (fanartCache[cacheKey]) return fanartCache[cacheKey].data;
      return null;
    }
  });

  ipcMain.handle('fanart-images', async (_e, type, imdbId) => {
    try {
      if (!currentFanartKey) return null;
      const fanartType = type === 'tv' || type === 'series' ? 'tv' : 'movies';
      const cacheKey = `${fanartType}_${imdbId}`;
      if (fanartCache[cacheKey] && (Date.now() - fanartCache[cacheKey].timestamp < 7 * 24 * 60 * 60 * 1000)) {
        return fanartCache[cacheKey].data;
      }
      const url = `${FANART_BASE}/${fanartType}/${imdbId}?api_key=${currentFanartKey}`;
      const res = await axios.get(url, { timeout: 10000 });
      fanartCache[cacheKey] = { data: res.data, timestamp: Date.now() };
      saveFanartCache();
      return res.data;
    } catch (err) {
      console.error('[Fanart] get images error:', err.message);
      const fanartType = type === 'tv' || type === 'series' ? 'tv' : 'movies';
      const cacheKey = `${fanartType}_${imdbId}`;
      if (fanartCache[cacheKey]) return fanartCache[cacheKey].data;
      return null;
    }
  });

  ipcMain.handle('resolve-trailer-stream', async (_e, youtubeUrl) => {
    if (!youtubeUrl) return null;

    const vMatch = youtubeUrl.match(/(?:v=|\/embed\/|\/1.1\/|v\/|https:\/\/youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    const videoId = vMatch ? vMatch[1] : null;

    // 1. Primary: Use YouTubeService (youtubei.js / Innertube) locally to get playable stream URL
    if (videoId) {
      try {
        const YouTubeService = require('../youtube/YouTubeService');
        const res = await YouTubeService.getVideoDetails(videoId, '1080');
        if (res && res.success && res.details?.streamUrl) {
          console.log('[resolve-trailer-stream] Resolved via YouTubeService (youtubei.js):', res.details.streamUrl.slice(0, 60) + '...');
          return res.details.streamUrl;
        }
      } catch (ytErr) {
        console.warn('[resolve-trailer-stream] YouTubeService failed:', ytErr.message);
      }
    }

    // 2. Secondary: Try local yt-dlp fallback prioritizing High Definition (1080p/720p)
    try {
      const { execYtDlp } = require('../downloader-adapter');
      const directUrl = await execYtDlp(
        `--no-playlist --flat-playlist --socket-timeout 5 -g -f "best[height<=1080][height>=720][ext=mp4]/best[height<=1080]/22/bestvideo[height<=1080]+bestaudio/best" --extractor-args "youtube:player_client=android,web" "${youtubeUrl}"`,
        { timeout: 8000 }
      );
      if (directUrl && directUrl.startsWith('http')) {
        const stream = directUrl.split('\n')[0].trim();
        console.log('[YTDLP] Fast resolved HD YouTube trailer stream:', stream.slice(0, 60) + '...');
        return stream;
      }
    } catch (err) {
      console.warn('[YTDLP] Stream resolution failed, trying proxy fallbacks:', err.message);
    }

    // 2. Secondary: Invidious / Piped using proxied stream URLs (prevents IP-binding 403)
    if (videoId) {
      const invidInstances = [
        `https://inv.tux.pizza/latest_version?id=${videoId}&itag=22`,
        `https://invidious.nerqv.ps/latest_version?id=${videoId}&itag=22`,
        `https://inv.tux.pizza/latest_version?id=${videoId}&itag=18`
      ];
      for (const invUrl of invidInstances) {
        try {
          const res = await axios.head(invUrl, { timeout: 3000, maxRedirects: 5 });
          if (res.status === 200 || res.status === 302 || res.status === 301) {
            console.log('[Invidious] Stream resolved via proxy:', invUrl);
            return invUrl;
          }
        } catch (e) {}
      }

      const pipedEndpoints = [
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://api.piped.privacydev.net/streams/${videoId}`
      ];
      for (const endpoint of pipedEndpoints) {
        try {
          const res = await axios.get(endpoint, { timeout: 3500 });
          if (res.data && res.data.videoStreams && res.data.videoStreams.length > 0) {
            const bestStream = res.data.videoStreams.find(s => s.quality === '720p' || s.quality === '360p') || res.data.videoStreams[0];
            const streamUrl = bestStream?.proxyUrl || bestStream?.url;
            if (streamUrl) {
              console.log('[TrailerAPI] Stream resolved via Piped:', endpoint);
              return streamUrl;
            }
          }
        } catch (e) {}
      }
    }

    // 3. Tertiary: Cobalt API
    const instances = [
      'https://co.wuk.sh/api/json',
      'https://api.vve.wtf/api/json',
      'https://api.cobalt.tools/api/json'
    ];
    for (const endpoint of instances) {
      try {
        const res = await axios.post(endpoint, 
          { url: youtubeUrl, videoQuality: '720' }, 
          { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 4000 }
        );
        if (res.data && res.data.url) {
          console.log('[Cobalt] Resolved stream from:', endpoint);
          return res.data.url;
        }
      } catch (err) {}
    }
    return null;
  });

  ipcMain.handle('mal-search', async () => {
    return { data: [] };
  });

  ipcMain.handle('map-mal-id', async () => {
    return null;
  });

  ipcMain.handle('mal-details', async (_e, malId) => {
    try {
      if (!malId) return null;
      const res = await jikanFetch(`/anime/${malId}`);
      if (res && res.data) {
        const d = res.data;
        return {
          id: `mal:${malId}`,
          mal_id: malId,
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
    } catch (err) {
      console.error('[Metadata] mal-details failed:', err.message);
    }
    return null;
  });

  ipcMain.handle('jikan-episodes', async (_e, malId) => {
    try {
      if (!malId) return { data: [] };
      return await jikanFetch(`/anime/${malId}/episodes`);
    } catch (err) {
      console.error('[Metadata] jikan-episodes error:', err.message);
      return { data: [] };
    }
  });

  ipcMain.handle('mal-recommendations', async () => {
    return { data: [] };
  });

  ipcMain.handle('mal-top-rated', async () => {
    return { results: [] };
  });

  ipcMain.handle('mal-top-upcoming', async () => {
    return { results: [] };
  });

  ipcMain.handle('mal-seasonal', async () => {
    return { results: [] };
  });

  ipcMain.handle('tmdb-season-details', async (_e, tvId, seasonNum) => {
    try {
      if (!tvId) return { episodes: [] };
      const data = await loadData();
      const tmdbKey = data.tmdbKey || '';

      let resolvedTvId = tvId;
      if (String(tvId).startsWith('tt')) {
        const apiKeyForFind = tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
        const tmdbFindUrl = `https://api.themoviedb.org/3/find/${tvId}?api_key=${apiKeyForFind}&external_source=imdb_id`;
        const tmdbFindResp = await axios.get(tmdbFindUrl, { timeout: 6000 }).catch(() => null);
        const resultsList = tmdbFindResp?.data?.tv_results;
        const tmdbItem = resultsList?.[0];
        if (tmdbItem) {
          resolvedTvId = tmdbItem.id;
        } else {
          console.warn(`[Metadata] Could not resolve TMDB ID for IMDb ID: ${tvId}`);
        }
      }

      if (!tmdbKey) {
        // Fallback to Stremio TMDB addon
        const addonUrl = `https://tmdb.elfhosted.com/meta/series/tmdb:${resolvedTvId}.json`;
        const resp = await axios.get(addonUrl, { timeout: 8000 });
        const meta = resp.data?.meta;
        if (meta && meta.videos) {
          const filtered = meta.videos.filter(v => Number(v.season) === Number(seasonNum));
          if (filtered.length > 0) {
            return {
              episodes: filtered.map(v => ({
                episode_number: v.episode,
                season_number: v.season,
                name: v.title || v.name || `Episode ${v.episode}`,
                still_path: v.thumbnail || v.still || v.still_path || v.image || null,
                air_date: v.released || null
              }))
            };
          }
        }
        return { episodes: [] };
      }
      
      const url = `https://api.themoviedb.org/3/tv/${resolvedTvId}/season/${seasonNum}?api_key=${tmdbKey}`;
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.data && resp.data.episodes) {
        return {
          episodes: resp.data.episodes.map(ep => ({
            episode_number: ep.episode_number,
            season_number: ep.season_number,
            name: ep.name,
            still_path: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
            air_date: ep.air_date
          }))
        };
      }
    } catch (err) {
      console.error('[Metadata] tmdb-season-details error:', err.message);
    }
    return { episodes: [] };
  });

  ipcMain.handle('save-manual-link', async (_e, { kitsuId, externalId, externalType, note }) => {
    try {
      const data = await loadData();
      data.manualLinks = data.manualLinks || {};
      const key = `kitsu:${kitsuId}`;
      data.manualLinks[key] = { external_id: externalId, external_type: externalType || null, note: note || null, ts: Date.now() };
      await saveData(data);
      return { success: true };
    } catch (err) {
      console.error('[IPC] save-manual-link error:', err);
      return { success: false, error: err.message };
    }
  });

  // Export internal API functions so other modules (like libraryScanner/addons) can fetch western media if needed
  ipcMain.handle('get-anime-media-internal', async (_e, malId) => getAnimeMedia({ malId }));
  ipcMain.handle('get-western-media-internal', async (_e, { id, type }) => getWesternMedia({ id, type }));
}

module.exports = { initMetadataIpc, getWesternMedia, getAnimeMedia, resolveCinemetaByTitle };
