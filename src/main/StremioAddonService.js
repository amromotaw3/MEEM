/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  StremioAddonService.js — MediaVault v3.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Dual-Routing Stremio Addon Protocol service.
 *
 *  Routing Logic:
 *    Movie:       GET {base}/stream/movie/{imdbId}.json
 *    TV Series:   GET {base}/stream/series/{imdbId}:{season}:{episode}.json
 *    Anime:       GET {base}/stream/series/kitsu:{kitsuId}:{episode}.json  (PRIMARY)
 *                 GET {base}/stream/series/{imdbId}:{season}:{episode}.json (SECONDARY)
 *
 *  Why dual-routing for Anime?
 *    Anime torrents (Nyaa etc.) use Absolute Numbering (e.g. Episode 30),
 *    while TMDB/IMDb uses Season-based (S02E05). Torrentio accepts kitsu:
 *    prefixed IDs which map correctly to absolute episode numbers.
 *
 *  @module StremioAddonService
 */

const axios = require('axios');
const { getCleanMetadata, isLocalFilePath } = require('./utils/MetadataNormalizer');
const { getInMemorySession } = require('./store');

// ── Default Addon Endpoints ──────────────────────────────────────────────────
// Empty by default to comply fully with legal policies (User-configurable Addon Store)
const DEFAULT_ADDONS = {};

const REQUEST_TIMEOUT = 15000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ── Quality Detection ────────────────────────────────────────────────────────

/**
 * Detects the media quality (e.g., 4K, 1080p, 720p, CAM) from a stream title.
 * 
 * @param {string} text - The stream title text.
 * @returns {string} The detected quality category.
 */
function detectQuality(text) {
  if (!text) return 'Unknown';
  const t = text.toUpperCase();
  if (t.includes('2160P') || t.includes('4K') || t.includes('UHD')) return '4K';
  if (t.includes('1080P') || t.includes('FULLHD')) return '1080p';
  if (t.includes('720P')) return '720p';
  if (t.includes('480P') || t.includes('360P')) return '480p';
  if (t.includes('HDTS') || t.includes('HDCAM') || t.includes('CAM')) return 'CAM';
  return 'HD';
}

// ── Stream ID Builders ───────────────────────────────────────────────────────

/**
 * Builds an IMDb-based Stremio stream ID.
 * Used for Movies and standard TV Series.
 */
function buildImdbStreamId(imdbId, type, season, episode) {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  const stremioType = (type === 'movie') ? 'movie' : 'series';
  const stremioId = (type === 'movie') ? imdbId : `${imdbId}:${season}:${episode}`;
  return { stremioType, stremioId };
}

/**
 * Builds a Kitsu-based Stremio stream ID.
 * Used for Anime — maps to absolute episode numbering.
 * Example: kitsu:46562:5 (Jujutsu Kaisen episode 5)
 */
function buildKitsuStreamId(kitsuId, episode) {
  if (!kitsuId) return null;
  const kid = String(kitsuId).startsWith('kitsu:') ? kitsuId : `kitsu:${kitsuId}`;
  return { stremioType: 'series', stremioId: `${kid}:${episode}` };
}

// ── Core Fetch Logic ─────────────────────────────────────────────────────────

/**
 * Fetches raw stream lists from a given Stremio addon manifest endpoint.
 * 
 * @param {Object|string} addonObj - The addon configuration object or base URL string.
 * @param {string} stremioType - The type of media ('movie' or 'series').
 * @param {string} stremioId - The IMDb or Kitsu formatted ID.
 * @returns {Promise<Array>} List of raw streams from the addon.
 */
async function fetchAddonStreams(addonObj, stremioType, stremioId) {
  // Build candidate bases from addon object or string
  const bases = [];
  if (!addonObj) return [];
  if (typeof addonObj === 'string') bases.push(addonObj.replace(/\/$/, ''));
  else {
    if (addonObj.url) bases.push(String(addonObj.url).replace(/\/$/, ''));
    if (addonObj.manifestUrl) bases.push(String(addonObj.manifestUrl).replace(/\/manifest\.json$/i, '').replace(/\/$/, ''));
    if (addonObj.url && String(addonObj.url).match(/\/lite$/i)) bases.push(String(addonObj.url).replace(/\/lite$/i, '').replace(/\/$/, ''));
  }

  // Deduplicate
  const seen = new Set();
  const candidates = bases.filter(b => { if (!b || seen.has(b)) return false; seen.add(b); return true; });

  for (const base of candidates) {
  const url = `${base}/stream/${stremioType}/${stremioId}.json`;
  console.log(`[StremioAddon] Trying ${url}`);
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://web.stremio.com',
          'Referer': 'https://web.stremio.com/'
        },
        timeout: REQUEST_TIMEOUT
      });
      const data = response.data;
      if (data && Array.isArray(data.streams)) {
        return data.streams;
      }
    } catch (err) {
      if (err.response?.status && err.response.status !== 404) {
        console.warn(`[StremioAddon] ✗ ${url} failed:`, err.message || err);
      }
      // try next candidate
    }
  }
  return [];
}

function normalizeStream(raw, addonName, addonIcon) {
  const title = raw.title || raw.name || '';
  const titleLines = title.split('\n');
  const mainTitle = titleLines[0] || 'Unknown';
  const statsText = titleLines.slice(1).join(' ');
  const seedsMatch = statsText.match(/👤\s*(\d+)/) || statsText.match(/(\d+)\s*seeds/i);
  const sizeMatch = statsText.match(/💾\s*([\d.]+\s*[GMTK]i?B)/i) || statsText.match(/([\d.]+\s*[GMTK]i?B)/i);

  return {
    addon: addonName,
    icon: addonIcon,
    title, mainTitle,
    quality: detectQuality(title),
    seeds: seedsMatch ? parseInt(seedsMatch[1]) : 0,
    size: sizeMatch ? sizeMatch[1] : '',
    url: raw.url || raw.infoHash || raw.externalUrl || '',
    type: raw.infoHash ? 'torrent' : (raw.externalUrl ? 'browser' : 'http'),
    infoHash: raw.infoHash || null,
    fileIdx: raw.fileIdx != null ? raw.fileIdx : null,
    behaviorHints: raw.behaviorHints || null
  };
}

function normalizeMeta(raw, sourceAddon) {
    return {
        id: raw.id,
        tmdb_id: raw.tmdb_id || null,
        imdb_id: raw.imdb_id || null,
        name: raw.name,
        title: raw.name,
        type: raw.type === 'movie' ? 'movie' : 'tv',
        poster_path: raw.poster || raw.poster_path || raw.posterPath || raw.posterImage || null,
        backdrop_path: raw.background || raw.backdrop_path || raw.backdropPath || raw.coverImage || null,
        logo: raw.logo || raw.logo_path || null,
        overview: raw.description || raw.overview || raw.synopsis || '',
        releaseInfo: raw.releaseInfo || raw.year || '',
        year: raw.releaseInfo ? raw.releaseInfo.slice(0, 4) : '',
        vote_average: raw.imdbRating ? parseFloat(raw.imdbRating) : 0,
        genres: raw.genres || [],
        source: sourceAddon,
        isStremio: true,
        videos: Array.isArray(raw.videos) ? raw.videos.map(v => ({
            id: v.id,
            name: v.name || v.title || `Episode ${v.episode || v.number || ''}`,
            title: v.name || v.title || `Episode ${v.episode || v.number || ''}`,
            season: v.season || 1,
            episode: v.episode || v.number || 0,
            released: v.released || v.air_date || null,
            thumbnail: v.thumbnail || v.still_path || v.image || null
        })) : []
    };
}

// ── Public API ───────────────────────────────────────────────────────────────

class StremioAddonService {
  constructor(config = {}) {
    this.addons = {};
    const installed = config.installedAddons || [];
    installed.forEach(addon => {
      const key = addon.id || addon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      this.addons[key] = {
        name: addon.name,
        url: addon.url ? String(addon.url).trim().replace(/\/$/, '') : '',
        manifestUrl: addon.manifestUrl || null,
        icon: addon.icon || '🧩',
        types: addon.types || ['movie', 'series', 'anime']
      };
    });
  }

  /** Fetch streams for a Movie (IMDb only). */
  async getMovieStreams(imdbId) {
    if (!imdbId || !imdbId.startsWith('tt')) return [];
    const keys = Object.keys(this.addons).filter(k => this.addons[k].types.includes('movie'));
    return this._fetchWithId(buildImdbStreamId(imdbId, 'movie'), keys, 'movie');
  }

  /** Fetch streams for a TV Series episode (IMDb + S:E). */
  async getSeriesStreams(imdbId, season, episode) {
    if (!imdbId || !imdbId.startsWith('tt')) return [];
    const keys = Object.keys(this.addons).filter(k => this.addons[k].types.includes('series') || this.addons[k].types.includes('tv'));
    return this._fetchWithId(buildImdbStreamId(imdbId, 'tv', season, episode), keys, 'tv', season, episode);
  }

  /**
   * Fetch streams for an Anime episode using DUAL-ROUTING
   */
  async getAnimeStreams({ imdbId, kitsuId, season, episode }) {
    return [];
  }

  /** Universal entry point — routes by content type. */
  async getStreams(query) {
    let { imdbId, kitsuId, type, season, episode, title } = query;
    if (imdbId && isLocalFilePath(imdbId)) {
      const cleanMeta = await getCleanMetadata(imdbId, getInMemorySession);
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
    // console.log(`[StremioAddon] getStreams() — type=${type}, imdb=${imdbId}, kitsu=${kitsuId}, S${season}E${episode}, "${title}"`);

    let streams = [];

    switch (type) {
      case 'movie':
        streams = await this.getMovieStreams(imdbId);
        break;
      case 'tv':
      case 'series':
        streams = await this.getSeriesStreams(imdbId, season, episode);
        break;
      case 'anime':
        streams = await this.getAnimeStreams({ imdbId, kitsuId, season, episode });
        break;
      default:
        if (imdbId) {
          streams = await this.getMovieStreams(imdbId);
          if (!streams.length && season && episode) {
            streams = await this.getSeriesStreams(imdbId, season, episode);
          }
        }
    }

    // Sort: quality first, then seeds
    const qOrder = { '4K': 5, '1080p': 4, '720p': 3, 'HD': 2, '480p': 1, 'CAM': 0, 'Unknown': -1 };
    streams.sort((a, b) => {
      const qd = (qOrder[b.quality] || 0) - (qOrder[a.quality] || 0);
      return qd !== 0 ? qd : (b.seeds || 0) - (a.seeds || 0);
    });

    // console.log(`[StremioAddon] Total streams found: ${streams.length}`);
    return streams;
  }

  /**
   * Fetch subtitles from installed subtitle add-ons.
   * Query: { type: 'movie'|'series'|'anime', imdbId, season, episode, kitsuId }
   */
  async getSubtitles(query) {
    let { imdbId, kitsuId, type, season, episode, title } = query;
    if (imdbId && isLocalFilePath(imdbId)) {
      const cleanMeta = await getCleanMetadata(imdbId, getInMemorySession);
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
    // CRITICAL: Stremio subtitle protocol ONLY supports 'movie' and 'series'.
    // 'anime' and 'tv' must be mapped to 'series' — sending '/subtitles/anime/...' returns 404!
    let stremioType = (type === 'movie') ? 'movie' : 'series';
    const primaryIds = [];
    const fallbackIds = [];

    console.log('[StremioSubtitles] Request payload:', {
      imdb_id: imdbId,
      kitsuId,
      type,
      stremioType,
      season,
      episode,
      title
    });

    // === Build IDs: MULTI-ROUTE ===
    
    // 1. Anime: try Kitsu first (best for absolute numbering)
    if (type === 'anime' && kitsuId) {
      const kitsuId_str = String(kitsuId).startsWith('kitsu:') ? kitsuId : `kitsu:${kitsuId}`;
      const kitsuId_final = `${kitsuId_str}:${episode}`;
      console.log('[StremioSubtitles] Anime: Added Kitsu ID to primary routes:', kitsuId_final);
      primaryIds.push(kitsuId_final);
    }

    // 2. Movies: use IMDb directly
    if (type === 'movie' && imdbId && String(imdbId).startsWith('tt')) {
      console.log('[StremioSubtitles] Movie: Added IMDb ID to primary routes:', imdbId);
      primaryIds.push(imdbId);
    }
    
    // 3. Series/TV/Anime with IMDb: try IMDb with Season:Episode
    if ((type === 'series' || type === 'tv' || type === 'anime') && imdbId && String(imdbId).startsWith('tt')) {
      if (season !== undefined && season !== null && episode !== undefined && episode !== null) {
        const imdbSeriesId = `${imdbId}:${season}:${episode}`;
        console.log('[StremioSubtitles] Series/TV: Added IMDb Series ID to primary routes:', imdbSeriesId);
        primaryIds.push(imdbSeriesId);
      }
    }

    // 4. Anime without Kitsu: try IMDb as fallback
    if (type === 'anime' && !kitsuId && imdbId && String(imdbId).startsWith('tt')) {
      if (season !== undefined && season !== null && episode !== undefined && episode !== null) {
        const imdbAnimeId = `${imdbId}:${season}:${episode}`;
        console.log('[StremioSubtitles] Anime fallback (no Kitsu): Added IMDb Series ID:', imdbAnimeId);
        fallbackIds.push(imdbAnimeId);
      }
    }

    // 5. Fallback: search by title
    const fallbackTitle = String(title || '').trim();
    if (fallbackTitle) {
      console.log('[StremioSubtitles] Fallback: Will try search by title:', fallbackTitle);
      fallbackIds.push(fallbackTitle);
    }

    // التحقق: هل لدينا أي معرّفات على الإطلاق؟
    if (!primaryIds.length && !fallbackIds.length) {
      console.warn('[StremioSubtitles] ERROR: No valid identifiers found!', {
        hasIMDb: !!imdbId,
        hasKitsu: !!kitsuId,
        hasTitle: !!fallbackTitle,
        type
      });
      return [];
    }

    const keys = Object.keys(this.addons).filter(k => 
      (this.addons[k].types || []).includes('subtitles') || 
      (this.addons[k].url || '').includes('subtitles') || 
      (this.addons[k].url || '').includes('opensubtitles') ||
      (this.addons[k].manifestUrl || '').includes('opensubtitles') ||
      (this.addons[k].name || '').toLowerCase().includes('opensubtitles') ||
      (this.addons[k].url || '').includes('subdl') ||
      (this.addons[k].manifestUrl || '').includes('subdl') ||
      (this.addons[k].name || '').toLowerCase().includes('subdl')
    );
    
    if (!keys.length) {
      console.error('[StremioSubtitles] CRITICAL: No subtitle addons installed! Configure SubDL subtitles from settings.');
      return [];
    }

    // استخراج الترجمات مع معالجة صيغ مختلفة
    const extractSubtitles = (data) => {
      if (!data) return [];
      
      // صيغة 1: مصفوفة مباشرة
      if (Array.isArray(data)) return data;
      
      // صيغة 2: كائن subtitles
      if (Array.isArray(data?.subtitles)) return data.subtitles;
      
      // صيغة 3: كائن subs
      if (Array.isArray(data?.subs)) return data.subs;
      
      // صيغة 4: nested data.subtitles
      if (Array.isArray(data?.data?.subtitles)) return data.data.subtitles;
      
      // صيغة 5: nested result.subtitles
      if (Array.isArray(data?.result?.subtitles)) return data.result.subtitles;
      
      // صيغة 6: streams (كـ fallback للـ providers التي ترجع streams بدلاً من subtitles)
      if (Array.isArray(data?.streams)) {
        console.log('[StremioSubtitles] WARNING: Addon returned streams instead of subtitles, attempting conversion');
        return data.streams.filter(s => s.subtitle);
      }
      
      console.warn('[StremioSubtitles] Could not extract subtitles from response:', Object.keys(data || {}));
      return [];
    };

    const normalizeSubtitle = (sub, addonName) => {
      // تحويل القيم الفارغة
      const url = sub.url || sub.link || sub.download || sub.downloadUrl;
      if (!url) return null;  // تخطي الترجمات بدون رابط
      
      return {
        addon: addonName,
        id: sub.id || sub.subtitle_id || sub.file_id || sub.url,
        url,
        lang: sub.lang || sub.language || sub.iso639 || 'Unknown',
        label: sub.label || sub.name || (sub.lang ? String(sub.lang).toUpperCase() : 'Unknown'),
        format: sub.format || 'srt'  // تقدير الصيغة إذا لم تُذكر
      };
    };

    const results = [];
    
    // استدعاء جميع الـ Addons بالتوازي، لكن انتظر الاكتمال
    const fetches = keys.map(async (key) => {
      const addon = this.addons[key];
      const candidates = [];
      if (addon.url) candidates.push(addon.url.replace(/\/$/, ''));
      if (addon.manifestUrl) candidates.push(String(addon.manifestUrl).replace(/\/manifest\.json$/i, '').replace(/\/$/, ''));
      if (addon.url && addon.url.match(/\/lite$/i)) candidates.push(addon.url.replace(/\/lite$/i, '').replace(/\/$/, ''));

      const seen = new Set();
      const bases = candidates.filter(b => { if (!b || seen.has(b)) return false; seen.add(b); return true; });

      const requestSubtitleUrl = async (base, requestedId, reason) => {
        // Encode the ID if it's a plain title (not an IMDb/Kitsu structured ID)
        const isStructuredId = /^tt\d+/.test(requestedId) || requestedId.startsWith('kitsu:');
        const requestIdForUrl = isStructuredId ? requestedId : encodeURIComponent(requestedId);
        const url = base + '/subtitles/' + stremioType + '/' + requestIdForUrl + '.json';
        console.log('[StremioSubtitles] HTTP Request:', { addon: addon.name, url, reason });
        
        try {
          const response = await axios.get(url, {
            headers: { 
              'User-Agent': USER_AGENT,
              'Accept': 'application/json, text/plain, */*',
              'Origin': 'https://web.stremio.com',
              'Referer': 'https://web.stremio.com/'
            },
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true  // قبول جميع الحالات (لا نرمي أخطاء HTTP)
          });

          // معالجة الحالات غير الناجحة
          if (response.status !== 200) {
            console.warn(`[StremioSubtitles] Non-200 response: ${response.status} from ${url}`);
            return [];
          }

          console.log('[StremioSubtitles] Raw response (status 200):', JSON.stringify(response.data, null, 2));
          
          const extracted = extractSubtitles(response.data);
          const normalized = extracted
            .map(sub => normalizeSubtitle(sub, addon.name))
            .filter(sub => sub !== null);  // تصفية الـ null
          
          console.log(`[StremioSubtitles] Extracted ${normalized.length} subtitles from ${addon.name}`);
          return normalized;
          
        } catch (err) {
          console.error('[StremioSubtitles] Network error:', { 
            url, 
            addon: addon.name,
            reason,
            message: err.message 
          });
          return [];
        }
      };

      // حلقة البحث: جرّب جميع المعرّفات الأساسية أولاً
      for (const primaryId of primaryIds) {
        for (const base of bases) {
          const subtitles = await requestSubtitleUrl(base, primaryId, 'primary-id');
          if (subtitles.length) {
            results.push(...subtitles);
            console.log(`[StremioSubtitles] SUCCESS: Found ${subtitles.length} subtitles for primary ID: ${primaryId}`);
            return;  // توقف: وجدنا نتائج!
          }
        }
      }

      // إذا فشلت جميع المعرّفات الأساسية، جرّب المعرّفات البديلة
      for (const fallbackId of fallbackIds) {
        for (const base of bases) {
          const subtitles = await requestSubtitleUrl(base, fallbackId, 'fallback-id');
          if (subtitles.length) {
            results.push(...subtitles);
            console.log(`[StremioSubtitles] SUCCESS: Found ${subtitles.length} subtitles for fallback ID: ${fallbackId}`);
            return;  // توقف: وجدنا نتائج!
          }
        }
      }

      console.warn(`[StremioSubtitles] No subtitles found for addon: ${addon.name}`);
    });

    // ❌ CRITICAL FIX: انتظر جميع الـ Addons بشكل كامل!
    await Promise.all(fetches);
    
    console.log(`[StremioSubtitles] Final result: ${results.length} total subtitles from all addons`);
    return results;
  }

  /**
   * Search for content using Stremio Addon Catalog Search.
   * Follows: GET {base}/catalog/{type}/{id}/search={query}.json
   */
  async searchCatalog(query, type = 'series') {
      const results = [];
      const animeAddon = Object.values(this.addons).find(a => a.types.includes('anime') || a.url.includes('kitsu'));
      if (!animeAddon) return [];
      const kitsuUrl = animeAddon.url;
      // If query is empty, fetch trending catalog. Else, fetch search catalog.
      const catalogId = query ? 'kitsu-anime-list' : 'kitsu-anime-trending';
      const searchUrl = query 
        ? `${kitsuUrl}/catalog/${type}/${catalogId}/search=${encodeURIComponent(query)}.json`
        : `${kitsuUrl}/catalog/${type}/${catalogId}.json`;
      
      try {
          const response = await axios.get(searchUrl, {
              headers: { 'User-Agent': USER_AGENT },
              timeout: REQUEST_TIMEOUT
          });
          if (response.data && Array.isArray(response.data.metas)) {
              response.data.metas.forEach(m => {
                  results.push(normalizeMeta(m, 'kitsu'));
              });
          }
      } catch (err) {
          console.warn(`[StremioCatalog] Search failed for ${kitsuUrl}:`, err.message);
      }
      return results;
  }

  /**
   * Get full metadata for a specific item from an addon.
   * Follows: GET {base}/meta/{type}/{id}.json
   */
  async getMeta(type, id, addonKey = 'animeKitsu') {
      const addon = this.addons[addonKey] || Object.values(this.addons).find(a => a.types.includes('anime') || a.url.includes('kitsu'));
      if (!addon) return null;
      const baseUrl = addon.url;
      const url = `${baseUrl}/meta/${type}/${id}.json`;
      try {
          const response = await axios.get(url, {
              headers: { 'User-Agent': USER_AGENT },
              timeout: REQUEST_TIMEOUT
          });
          if (response.data && response.data.meta) {
              return normalizeMeta(response.data.meta, addonKey);
          }
      } catch (err) {
          console.warn(`[StremioMeta] Fetch failed for ${url}:`, err.message);
      }
      return null;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Fetches a single stream ID from multiple addons in parallel. */
  async _fetchWithId(built, addonKeys, type, season, episode, skipEpisodeVerification = false) {
    if (!built) return [];
    const TorrentFilterService = require('./utils/TorrentFilterService');
    const results = [];

    const fetches = addonKeys.map(async (key) => {
      const addon = this.addons[key];
      if (!addon) return;
      const rawStreams = await fetchAddonStreams(addon, built.stremioType, built.stremioId);

      for (const raw of rawStreams) {
        const torrentTitle = raw.title || raw.name || '';

        // Episode verification for series/anime (skip for movies and when explicitly bypassed)
        // skipEpisodeVerification=true is used for anime with Kitsu IDs because Torrentio already
        // resolves to the correct absolute episode via the kitsu: prefix — no local re-checking needed.
        if (!skipEpisodeVerification && type !== 'movie' && torrentTitle) {
          const isMatch = TorrentFilterService.verifyEpisodeMatch({
            torrentTitle,
            requestedSeason: season,
            requestedEpisode: episode,
            absoluteEpisodeNumber: type === 'anime' ? episode : null,
            isAnime: type === 'anime',
            fileIdx: raw.fileIdx
          });
          if (!isMatch) continue;
        }

        const parsed = TorrentFilterService.parseTitle(torrentTitle);
        const normalized = normalizeStream(raw, addon.name, addon.icon);
        normalized.isPack = parsed.isPack;
        results.push(normalized);
      }
    });

    await Promise.all(fetches);
    return results;
  }

  /** Removes duplicate streams by infoHash. */
  _deduplicateStreams(streams) {
    const seen = new Set();
    return streams.filter(s => {
      if (!s.infoHash) return true;
      if (seen.has(s.infoHash)) return false;
      seen.add(s.infoHash);
      return true;
    });
  }
}

module.exports = { StremioAddonService, buildImdbStreamId, buildKitsuStreamId, detectQuality };
