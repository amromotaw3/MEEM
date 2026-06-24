const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { extractCleanTitle, parseEpisode } = require('../libraryScanner');

/**
 * Returns true if path looks like a Windows or Posix absolute/relative path.
 */
function isLocalFilePath(p) {
  if (!p || typeof p !== 'string') return false;
  return p.includes('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p);
}

/**
 * Normalizes a local file path to a unified metadata structure:
 * { title, imdbId, season, episode, kitsuId, type }
 */
async function getCleanMetadata(filePath, getAppData) {
  if (!filePath || typeof filePath !== 'string') return null;

  // Ignore absolute URLs and custom protocol links
  if (/^(https?|data|blob|media-img|local-file|media):/i.test(filePath)) {
    return null;
  }

  const appData = typeof getAppData === 'function' ? getAppData() : {};
  const cinemetaCache = appData.cinemetaCache || {};
  const tmdbCache = appData.tmdbCache || {};

  // 1. Parse filename and determine structure
  const filename = path.basename(filePath);
  const parentDir = path.basename(path.dirname(filePath));
  const parsed = parseEpisode(filename);

  const hasEpisodePattern = parsed.season !== null || parsed.episode > 0;
  let cleanTitle = '';
  let type = 'movie';

  if (hasEpisodePattern) {
    type = 'series';
    // If the parent folder name is "Season X" or similar, use grandparent directory as show name
    const parentIsSeason = /season\s*\d+|part\s*\d+|cour\s*\d+|^s\d{1,2}$|^\d{1,2}$/i.test(parentDir);
    const showFolderName = parentIsSeason ? path.basename(path.dirname(path.dirname(filePath))) : parentDir;
    cleanTitle = extractCleanTitle(showFolderName) || extractCleanTitle(filename);
  } else {
    cleanTitle = extractCleanTitle(filename);
  }

  const season = parsed.season || 1;
  const episode = parsed.episode || 1;

  // 2. Search cache first
  let matchedMeta = null;

  // Search exact filepath matches
  if (tmdbCache[filePath]) matchedMeta = tmdbCache[filePath];
  else if (cinemetaCache[filePath]) matchedMeta = cinemetaCache[filePath];

  // Try title-based cache fallback
  if (!matchedMeta && cleanTitle) {
    const cleanLower = cleanTitle.toLowerCase().trim();
    
    for (const key in tmdbCache) {
      const entry = tmdbCache[key];
      if (entry && entry.title && entry.title.toLowerCase().trim() === cleanLower) {
        matchedMeta = entry;
        break;
      }
    }

    if (!matchedMeta) {
      for (const key in cinemetaCache) {
        const entry = cinemetaCache[key];
        if (entry && entry.title && entry.title.toLowerCase().trim() === cleanLower) {
          matchedMeta = entry;
          break;
        }
      }
    }
  }

  let imdbId = matchedMeta?.cinemetaId || matchedMeta?.imdbId || matchedMeta?.imdb_id || null;
  let kitsuId = matchedMeta?.kitsuId || matchedMeta?.kitsu_id || null;

  // 3. Fallback: Query Cinemeta API on-the-fly using clean title
  if (!imdbId && cleanTitle && cleanTitle.length > 1) {
    try {
      console.log(`[MetadataNormalizer] Cache miss. Searching Cinemeta for clean title: "${cleanTitle}"`);
      const searchType = type === 'series' ? 'series' : 'movie';
      const searchUrl = `https://v3-cinemeta.strem.io/catalog/${searchType}/top/search=${encodeURIComponent(cleanTitle)}.json`;
      
      const response = await axios.get(searchUrl, { timeout: 8000 });
      const metas = response.data?.metas || [];
      if (metas.length > 0) {
        const firstMatch = metas[0];
        imdbId = firstMatch.id;
        
        // Cache this match
        const metaObj = {
          cinemetaId: firstMatch.id,
          type: type === 'series' ? 'tv' : 'movie',
          title: firstMatch.name || firstMatch.title,
          poster: firstMatch.poster || null,
          backdrop: firstMatch.background || null,
          year: firstMatch.year || (firstMatch.release_date || '').slice(0, 4)
        };
        appData.cinemetaCache = appData.cinemetaCache || {};
        appData.cinemetaCache[filePath] = metaObj;

        // If it is a series, fetch episode details to populate seasons in background
        if (type === 'series' && firstMatch.id) {
          const detailUrl = `https://v3-cinemeta.strem.io/meta/series/${firstMatch.id}.json`;
          const detailResp = await axios.get(detailUrl, { timeout: 8000 }).catch(() => null);
          const detailMeta = detailResp?.data?.meta || detailResp?.data || null;
          if (detailMeta && detailMeta.videos && detailMeta.videos.length) {
            metaObj.seasons = {};
            detailMeta.videos.forEach(v => {
              const s = String(v.season);
              metaObj.seasons[s] = metaObj.seasons[s] || {};
              metaObj.seasons[s][v.episode] = {
                episode_number: v.episode,
                name: v.name || v.title || null,
                overview: v.overview || null,
                still_path: v.thumbnail || null
              };
            });
          }
        }

        // Save back to local store
        const { writeLocalAppData } = require('../store');
        writeLocalAppData(appData);
      }
    } catch (err) {
      console.warn(`[MetadataNormalizer] Cinemeta search failed for "${cleanTitle}":`, err.message);
    }
  }

  return {
    title: cleanTitle,
    imdbId: imdbId || null,
    kitsuId: kitsuId || null,
    season: type === 'series' ? season : null,
    episode: type === 'series' ? episode : null,
    type
  };
}

module.exports = {
  getCleanMetadata,
  isLocalFilePath
};
