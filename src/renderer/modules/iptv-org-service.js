/**
 * iptv-org-service.js
 * Senior JS / Frontend Module for fetching and parsing IPTV-Org playlists.
 * Repository: https://github.com/iptv-org/iptv
 */

(function (global) {
  'use strict';

  // Preset URLs for iptv-org public playlists
  const IPTV_ORG_PRESETS = {
    arabic: 'https://iptv-org.github.io/iptv/languages/ara.m3u',
    global: 'https://iptv-org.github.io/iptv/index.m3u',
    news: 'https://iptv-org.github.io/iptv/categories/news.m3u',
    sports: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    movies: 'https://iptv-org.github.io/iptv/categories/movies.m3u'
  };

  /**
   * Fetch M3U text content from a given URL or preset.
   * Handles CORS proxying if available via window.api (Electron IPC proxy).
   * 
   * @param {string} url - Target M3U playlist URL or preset key ('arabic', 'global')
   * @returns {Promise<string>} Raw M3U text contents
   */
  async function fetchM3uContent(url = IPTV_ORG_PRESETS.arabic) {
    const targetUrl = IPTV_ORG_PRESETS[url] || url;
    
    // Electron IPC proxy fallback to avoid browser CORS limits
    if (global.api && typeof global.api.invoke === 'function') {
      try {
        const proxyRes = await global.api.invoke('fetch-proxy', targetUrl);
        if (proxyRes && typeof proxyRes === 'string') return proxyRes;
        if (proxyRes && proxyRes.content) return proxyRes.content;
      } catch (err) {
        console.warn('[IPTV-Org] Proxy fetch failed, trying standard fetch:', err.message);
      }
    }

    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: Failed to fetch playlist from ${targetUrl}`);
    }
    return await response.text();
  }

  /**
   * Parse M3U playlist text into structured channel objects.
   * Extracts: Name, tvg-logo, group-title (category), tvg-id, and stream URL (.m3u8).
   * 
   * @param {string} m3uText - Raw M3U text file
   * @returns {Array<Object>} List of parsed channel objects
   */
  function parseM3U(m3uText) {
    if (!m3uText || typeof m3uText !== 'string') return [];

    const lines = m3uText.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        // Extract display title (everything after the last comma)
        const commaIndex = line.lastIndexOf(',');
        const title = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Live Channel';

        // Extract metadata attributes using Regex
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const idMatch = line.match(/tvg-id="([^"]*)"/i);
        const languageMatch = line.match(/tvg-language="([^"]*)"/i);
        const countryMatch = line.match(/tvg-country="([^"]*)"/i);

        currentChannel = {
          id: idMatch ? idMatch[1] : `ch-${Math.random().toString(36).substr(2, 9)}`,
          name: title || 'Unknown Channel',
          logo: logoMatch && logoMatch[1] ? logoMatch[1] : 'imgs/appicon-w.png',
          category: groupMatch && groupMatch[1] ? groupMatch[1].trim() : 'General',
          language: languageMatch ? languageMatch[1] : '',
          country: countryMatch ? countryMatch[1] : '',
          url: '' // Will be set by the next URL line
        };
      } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://')) {
        if (currentChannel) {
          currentChannel.url = line;
          channels.push(currentChannel);
          currentChannel = null;
        }
      }
    }

    return channels;
  }

  /**
   * Extract all unique category names (group-title) from parsed channel list.
   * 
   * @param {Array<Object>} channels 
   * @returns {Array<string>} List of unique category names
   */
  function extractCategories(channels) {
    if (!Array.isArray(channels)) return ['All'];
    const categories = new Set();
    channels.forEach(ch => {
      if (ch.category) categories.add(ch.category);
    });
    return ['All', ...Array.from(categories).sort()];
  }

  /**
   * Filter channel list by selected category and live search query text.
   * 
   * @param {Array<Object>} channels 
   * @param {string} category - Selected category name or 'All'
   * @param {string} query - Live search query text
   * @returns {Array<Object>} Filtered list of channels
   */
  function filterChannels(channels, category = 'All', query = '') {
    if (!Array.isArray(channels)) return [];
    
    const cleanQuery = (query || '').toLowerCase().trim();
    const cleanCategory = (category || 'All').toLowerCase();

    return channels.filter(ch => {
      const matchCategory = cleanCategory === 'all' || (ch.category && ch.category.toLowerCase() === cleanCategory);
      const matchQuery = !cleanQuery || (ch.name && ch.name.toLowerCase().includes(cleanQuery));
      return matchCategory && matchQuery;
    });
  }

  /**
   * Main service function to fetch, parse, and process an IPTV playlist.
   * 
   * @param {string} url - Target M3U playlist URL or preset ('arabic', 'global')
   * @returns {Promise<{channels: Array<Object>, categories: Array<string>}>}
   */
  async function loadPlaylist(url = IPTV_ORG_PRESETS.arabic) {
    const rawText = await fetchM3uContent(url);
    const channels = parseM3U(rawText);
    const categories = extractCategories(channels);
    return { channels, categories };
  }

  // Export module as global object `iptvOrgService`
  global.iptvOrgService = {
    PRESETS: IPTV_ORG_PRESETS,
    fetchM3uContent,
    parseM3U,
    extractCategories,
    filterChannels,
    loadPlaylist
  };

})(typeof window !== 'undefined' ? window : this);
