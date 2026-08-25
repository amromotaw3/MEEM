const { RadioBrowserApi } = require('radio-browser-api');
const axios = require('axios');

// Initialize RadioBrowserApi with user-agent "MediaVault"
const radioApi = new RadioBrowserApi('MediaVault');

// Direct HTTPS mirrors for fallback if SRV DNS fails
const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info'
];

function initRadioIpc(ipcMain) {
  ipcMain.handle('radio-search', async (_e, { filter, query, limit = 60 }) => {
    // 1. Try RadioBrowserApi package first
    try {
      const searchOptions = {
        limit: Math.min(limit || 60, 100),
        hidebroken: true,
        order: 'votes',
        reverse: true
      };

      if (filter === 'arabic') {
        searchOptions.language = 'arabic';
      } else if (filter === 'egypt') {
        searchOptions.countryCode = 'EG';
      } else if (filter === 'saudi') {
        searchOptions.countryCode = 'SA';
      } else if (filter === 'quran') {
        searchOptions.tag = 'quran';
      } else if (filter === 'topvoted') {
        searchOptions.order = 'votes';
        searchOptions.reverse = true;
      }

      if (query && query.trim()) {
        searchOptions.name = query.trim();
      }

      const stations = await radioApi.searchStations(searchOptions);
      if (stations && stations.length > 0) {
        return normalizeStations(stations);
      }
    } catch (err) {
      console.warn('[Radio IPC] RadioBrowserApi SRV lookup failed, switching to mirror fallback:', err.message);
    }

    // 2. Direct HTTPS Mirror Fallback (bypasses SRV DNS issues)
    for (const mirror of MIRRORS) {
      try {
        const params = new URLSearchParams();
        params.append('limit', String(Math.min(limit || 60, 100)));
        params.append('hidebroken', 'true');
        params.append('order', 'votes');
        params.append('reverse', 'true');

        if (filter === 'arabic') {
          params.append('language', 'arabic');
        } else if (filter === 'egypt') {
          params.append('countrycode', 'EG');
        } else if (filter === 'saudi') {
          params.append('countrycode', 'SA');
        } else if (filter === 'quran') {
          params.append('tag', 'quran');
        }

        if (query && query.trim()) {
          params.append('name', query.trim());
        }

        const res = await axios.get(`${mirror}/json/stations/search?${params.toString()}`, {
          timeout: 6000,
          headers: { 'User-Agent': 'MediaVault' }
        });

        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          return normalizeStations(res.data);
        }
      } catch (err) {
        console.warn(`[Radio IPC] Mirror ${mirror} failed:`, err.message);
      }
    }

    return [];
  });
}

function normalizeStations(list) {
  if (!Array.isArray(list)) return [];
  return list.map(item => ({
    id: item.stationuuid || item.id || item.changeuuid || String(Math.random()),
    name: item.name || 'Unknown Station',
    url: item.url || item.url_resolved || item.urlResolved || '',
    urlResolved: item.url_resolved || item.urlResolved || item.url || '',
    favicon: item.favicon || '',
    country: item.country || 'Global',
    countryCode: item.countrycode || item.countryCode || 'Global',
    bitrate: item.bitrate || 0,
    codec: item.codec || 'MP3',
    votes: item.votes || 0,
    tags: Array.isArray(item.tags) ? item.tags : (item.tags ? String(item.tags).split(',') : [])
  }));
}

module.exports = { initRadioIpc };
