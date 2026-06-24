/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TraktService.js — MediaVault v11.6.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Native Trakt.tv Integration Service.
 *  Handles Device OAuth flow, watchlist sync, search, and scrobbling.
 */

const axios = require('axios');

// Always resolve store fresh via require() (Node caches internally).
// Caching locally could hold a stale partial-export reference when
// circular-require order causes the module to be imported before its
// `module.exports = {...}` assignment runs.
function getStore() {
  return require('./store');
}

// Premium Trakt API Client Details (Embedded default client)
const DEFAULT_CLIENT_ID = 'd9f5e01379b335de9ee8e5ebbc1db059f749ef5124b648470bd7659b97f4727f';
const DEFAULT_CLIENT_SECRET = '1eb022e45e56cf1343251bccf74a1f3d0868f53313006406413ba71c0caea6b0';

const API_BASE = 'https://api.trakt.tv';

class TraktService {
  constructor() {
    this.clientId = DEFAULT_CLIENT_ID;
    this.clientSecret = DEFAULT_CLIENT_SECRET;
    try {
      const creds = this.getCredentials();
      if (creds) {
        if (creds.clientId) this.clientId = creds.clientId;
        if (creds.clientSecret) this.clientSecret = creds.clientSecret;
      }
    } catch (e) {
      console.warn('[TraktService] Failed to load saved credentials:', e.message);
    }
  }

  /**
   * Retrieves active Trakt configuration from local storage
   */
  getCredentials() {
    const data = getStore().getInMemorySession() || {};
    const activeProfileId = data.activeProfileId;
    if (activeProfileId && Array.isArray(data.profiles)) {
      const activeProfile = data.profiles.find(p => p.id === activeProfileId);
      if (activeProfile && activeProfile.trakt) {
        return activeProfile.trakt;
      }
    }
    return data.trakt || null;
  }

  /**
   * Saves Trakt credentials to local storage and syncs to cloud
   */
  saveCredentials(traktData) {
    const store = getStore();
    const data = store.getInMemorySession() || {};
    
    // Attempt profile-isolated save
    const activeProfileId = data.activeProfileId;
    let targetTrakt = null;
    if (activeProfileId && Array.isArray(data.profiles)) {
      const activeProfile = data.profiles.find(p => p.id === activeProfileId);
      if (activeProfile) {
        activeProfile.trakt = activeProfile.trakt || {};
        targetTrakt = activeProfile.trakt;
      }
    }

    if (!targetTrakt) {
      data.trakt = data.trakt || {};
      targetTrakt = data.trakt;
    }
    
    // Merge new credentials
    Object.assign(targetTrakt, traktData);
    
    // Completely clean up and remove empty, null, or undefined keys to allow fallback
    if (targetTrakt.clientId === null || targetTrakt.clientId === undefined || targetTrakt.clientId === '') {
      delete targetTrakt.clientId;
    }
    if (targetTrakt.clientSecret === null || targetTrakt.clientSecret === undefined || targetTrakt.clientSecret === '') {
      delete targetTrakt.clientSecret;
    }
    
    store.saveData(data).catch(err => {
      console.error('[TraktService] Failed to sync saved credentials to cloud:', err.message);
    });
    
    // Sync instance properties
    this.clientId = targetTrakt.clientId || DEFAULT_CLIENT_ID;
    this.clientSecret = targetTrakt.clientSecret || DEFAULT_CLIENT_SECRET;
  }

  /**
   * Clears Trakt credentials (logout) and syncs to cloud
   */
  clearCredentials() {
    const store = getStore();
    const data = store.getInMemorySession() || {};
    
    const activeProfileId = data.activeProfileId;
    if (activeProfileId && Array.isArray(data.profiles)) {
      const activeProfile = data.profiles.find(p => p.id === activeProfileId);
      if (activeProfile) {
        delete activeProfile.trakt;
      }
    }
    delete data.trakt;
    
    store.saveData(data).catch(err => {
      console.error('[TraktService] Failed to sync cleared credentials to cloud:', err.message);
    });

    // Reset to defaults
    this.clientId = DEFAULT_CLIENT_ID;
    this.clientSecret = DEFAULT_CLIENT_SECRET;
  }

  /**
   * Generates headers required for authenticated Trakt API requests
   */
  getHeaders(token) {
    const creds = this.getCredentials() || {};
    const clientId = creds.clientId || DEFAULT_CLIENT_ID;
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Step 1 of Device Auth: Request a device code
   */
  async generateDeviceCode() {
    try {
      console.log('[TraktService] Generating device code...');
      const creds = this.getCredentials() || {};
      const clientId = creds.clientId || DEFAULT_CLIENT_ID;
      const response = await axios.post(`${API_BASE}/oauth/device/code`, {
        client_id: clientId
      }, {
        headers: this.getHeaders()
      });
      return response.data; // { device_code, user_code, verification_url, expires_in, interval }
    } catch (err) {
      console.error('[TraktService] generateDeviceCode failed:', err.message);
      throw err;
    }
  }

  /**
   * Step 2 of Device Auth: Poll for token after user activation
   */
  async pollDeviceToken(deviceCode) {
    try {
      const creds = this.getCredentials() || {};
      const clientId = creds.clientId || DEFAULT_CLIENT_ID;
      const clientSecret = creds.clientSecret || DEFAULT_CLIENT_SECRET;
      const response = await axios.post(`${API_BASE}/oauth/device/token`, {
        code: deviceCode,
        client_id: clientId,
        client_secret: clientSecret
      }, {
        headers: this.getHeaders()
      });

      // Successful token return
      const tokenData = response.data; // { access_token, token_type, expires_in, refresh_token, scope, created_at }
      this.saveCredentials({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        createdAt: tokenData.created_at,
        expiresIn: tokenData.expires_in,
        connected: true
      });
      return { success: true, tokenData };
    } catch (err) {
      // 400: pending or slow down is normal during polling
      if (err.response && err.response.status === 400) {
        return { success: false, status: 'pending' };
      }
      console.error('[TraktService] pollDeviceToken failed:', err.message);
      throw err;
    }
  }

  /**
   * Fetches the user's Trakt watchlist
   */
  async getWatchlist() {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken) throw new Error('Trakt not connected');

    try {
      console.log('[TraktService] Fetching watchlist...');
      const response = await axios.get(`${API_BASE}/sync/watchlist`, {
        headers: this.getHeaders(creds.accessToken)
      });
      return response.data; // Array of items: { id, listing_at, type, movie, show }
    } catch (err) {
      console.error('[TraktService] getWatchlist failed:', err.message);
      throw err;
    }
  }

  /**
   * Adds items to Trakt watchlist
   * @param {Object} item - { type: 'movie'|'show', ids: { imdb: 'tt...' } }
   */
  async addToWatchlist(item) {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken) return false;

    const payload = {};
    if (item.type === 'movie') {
      payload.movies = [{ ids: { imdb: item.imdbId } }];
    } else {
      payload.shows = [{ ids: { imdb: item.imdbId } }];
    }

    try {
      console.log('[TraktService] Adding to watchlist:', item.imdbId);
      const response = await axios.post(`${API_BASE}/sync/watchlist`, payload, {
        headers: this.getHeaders(creds.accessToken)
      });
      return response.data;
    } catch (err) {
      console.error('[TraktService] addToWatchlist failed:', err.message);
      throw err;
    }
  }

  /**
   * Removes items from Trakt watchlist
   */
  async removeFromWatchlist(item) {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken) return false;

    const payload = {};
    if (item.type === 'movie') {
      payload.movies = [{ ids: { imdb: item.imdbId } }];
    } else {
      payload.shows = [{ ids: { imdb: item.imdbId } }];
    }

    try {
      console.log('[TraktService] Removing from watchlist:', item.imdbId);
      const response = await axios.post(`${API_BASE}/sync/watchlist/remove`, payload, {
        headers: this.getHeaders(creds.accessToken)
      });
      return response.data;
    } catch (err) {
      console.error('[TraktService] removeFromWatchlist failed:', err.message);
      throw err;
    }
  }

  /**
   * Scrobbling Playback events
   * @param {string} action - 'start' | 'pause' | 'stop'
   * @param {Object} media - { type, imdbId, title, season, episode }
   * @param {number} progressPercent - percentage of video watched (0 - 100)
   */
  async scrobble(action, media, progressPercent) {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken) return false;

    const payload = {
      progress: progressPercent
    };

    if (media.type === 'movie') {
      payload.movie = {
        title: media.title,
        ids: { imdb: media.imdbId }
      };
    } else {
      payload.show = {
        title: media.title,
        ids: { imdb: media.imdbId }
      };
      payload.episode = {
        season: media.season || 1,
        number: media.episode || 1
      };
    }

    try {
      console.log(`[TraktService] Scrobble action=${action} progress=${progressPercent}%`);
      const response = await axios.post(`${API_BASE}/scrobble/${action}`, payload, {
        headers: this.getHeaders(creds.accessToken)
      });
      return response.data;
    } catch (err) {
      console.error(`[TraktService] Scrobble ${action} failed:`, err.message);
      return null;
    }
  }

  /**
   * Search Trakt Catalog
   */
  async search(query, type = 'movie') {
    const searchType = type === 'series' || type === 'tv' ? 'show' : 'movie';
    try {
      console.log(`[TraktService] Searching Trakt for "${query}" (type=${searchType})`);
      const response = await axios.get(`${API_BASE}/search/${searchType}?query=${encodeURIComponent(query)}&extended=full`, {
        headers: this.getHeaders()
      });
      return (response.data || []).map(r => {
        const item = r[searchType];
        return {
          id: item.ids.imdb || item.ids.trakt,
          title: item.title,
          poster: item.ids.imdb ? '/' + item.ids.imdb : '',
          type: searchType === 'show' ? 'tv' : 'movie',
          source: 'trakt',
          rating: item.rating ? parseFloat(item.rating.toFixed(1)) : 0,
          releaseYear: item.year || 0,
          synopsis: item.overview || ''
        };
      });
    } catch (err) {
      console.error('[TraktService] Search failed:', err.message);
      return [];
    }
  }

  /**
   * Retrieves the current "Continue Watching" playback status from Trakt
   */
  async getPlaybackProgress() {
    const creds = this.getCredentials();
    if (!creds || !creds.accessToken) return [];

    try {
      console.log('[TraktService] Fetching continue watching progress...');
      const response = await axios.get(`${API_BASE}/sync/playback`, {
        headers: this.getHeaders(creds.accessToken)
      });
      return response.data; // Array of paused states
    } catch (err) {
      console.error('[TraktService] getPlaybackProgress failed:', err.message);
      return [];
    }
  }
}

module.exports = new TraktService();
