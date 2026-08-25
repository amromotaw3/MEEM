/**
 * iptv-smarters-service.js
 * Senior JS / Frontend Module for IPTV Smarters Pro (Xtream Codes API) integration.
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'mediavault_iptv_smarters_account';

  /**
   * Helper function to sanitize server URL
   */
  function sanitizeServerUrl(url) {
    let clean = (url || '').trim();
    if (!clean) return '';
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    // Remove trailing slashes or /player_api.php if user included it
    clean = clean.replace(/\/+$/, '').replace(/\/player_api\.php.*$/i, '');
    return clean;
  }

  /**
   * Universal fetch helper supporting Electron IPC proxy fallback
   */
  async function fetchJson(url) {
    if (global.api && typeof global.api.invoke === 'function') {
      try {
        const proxyRes = await global.api.invoke('fetch-proxy', url);
        if (proxyRes && !proxyRes.error) {
          return typeof proxyRes === 'string' ? JSON.parse(proxyRes) : proxyRes;
        }
      } catch (err) {
        console.warn('[Xtream] fetch-proxy failed, falling back to direct fetch:', err.message);
      }
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Login & Authenticate Xtream Codes API account
   * 
   * @param {string} serverUrl - e.g. "http://example.com:8080"
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<Object>} Account user_info & server_info
   */
  async function login(serverUrl, username, password) {
    const cleanUrl = sanitizeServerUrl(serverUrl);
    const cleanUser = (username || '').trim();
    const cleanPass = (password || '').trim();

    if (!cleanUrl || !cleanUser || !cleanPass) {
      throw new Error('Please enter Server URL, Username, and Password');
    }

    const apiUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}`;
    console.log('[Xtream] Authenticating:', apiUrl);

    const data = await fetchJson(apiUrl);

    if (!data || !data.user_info) {
      throw new Error('Invalid response from Xtream Codes server');
    }

    if (data.user_info.auth === 0 || data.user_info.status === 'Disabled') {
      throw new Error('Invalid Username or Password (or account disabled)');
    }

    const accountData = {
      serverUrl: cleanUrl,
      username: cleanUser,
      password: cleanPass,
      userInfo: data.user_info,
      serverInfo: data.server_info
    };

    // Save to local storage
    saveAccount(accountData);

    return accountData;
  }

  /**
   * Load Live Categories & Live Streams from Xtream Codes API
   * 
   * @param {Object} account - { serverUrl, username, password }
   * @returns {Promise<{channels: Array<Object>, categories: Array<string>}>}
   */
  async function loadXtreamChannels(account) {
    const { serverUrl, username, password } = account || getSavedAccount() || {};

    if (!serverUrl || !username || !password) {
      throw new Error('No IPTV Smarters account logged in');
    }

    const cleanUrl = sanitizeServerUrl(serverUrl);

    // 1. Fetch Categories
    const catUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;
    let categoriesMap = {};
    try {
      const catsData = await fetchJson(catUrl);
      if (Array.isArray(catsData)) {
        catsData.forEach(c => {
          categoriesMap[c.category_id] = c.category_name;
        });
      }
    } catch (e) {
      console.warn('[Xtream] Category fetch failed:', e.message);
    }

    // 2. Fetch Live Streams Catalog
    const streamUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
    console.log('[Xtream] Fetching streams catalog:', streamUrl);

    const streamsData = await fetchJson(streamUrl);

    if (!Array.isArray(streamsData)) {
      throw new Error('Failed to retrieve streams catalog from Xtream server');
    }

    const channels = streamsData.map(st => {
      const catName = categoriesMap[st.category_id] || st.category_name || 'General';
      const streamId = st.stream_id;
      
      // Construct playback URLs (HLS .m3u8 & direct TS)
      const playUrl = `${cleanUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`;
      const tsUrl = `${cleanUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.ts`;

      return {
        id: `xtream-${streamId}`,
        streamId: streamId,
        name: st.name || 'Live Channel',
        logo: st.stream_icon || 'imgs/appicon-w.png',
        category: catName,
        url: playUrl,
        fallbackUrl: tsUrl,
        epgCurrent: st.epg_channel_id ? `EPG: ${st.epg_channel_id}` : 'Live Stream',
        epgNext: '',
        quality: st.custom_sid ? 'FHD' : 'HD',
        isXtream: true
      };
    });

    const categorySet = new Set(channels.map(c => c.category).filter(Boolean));
    const categories = ['All', ...Array.from(categorySet).sort()];

    return { channels, categories };
  }

  /**
   * Save account details to LocalStorage
   */
  function saveAccount(account) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    } catch (e) {}
  }

  /**
   * Get saved account details from LocalStorage
   */
  function getSavedAccount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Clear saved account
   */
  function logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // Export module globally as `iptvSmartersService`
  global.iptvSmartersService = {
    login,
    loadXtreamChannels,
    saveAccount,
    getSavedAccount,
    logout,
    sanitizeServerUrl
  };

})(typeof window !== 'undefined' ? window : this);
