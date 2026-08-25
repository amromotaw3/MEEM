/**
 * MediaVault Capability Registry
 * Centralized capability management system. Feature gates and UI elements check
 * capabilities here rather than scattered inline condition checks.
 */
(function () {
  'use strict';

  const listeners = new Set();
  const state = {
    catalog: false,
    bannerSearch: false,
    subtitles: false,
    tmdbImages: false,
    animeSearch: true,
    localMovies: false,
    localShows: false,
    youtube: false
  };

  function normalizeAddonUrl(url) {
    if (!url) return '';
    return String(url).toLowerCase().trim().replace(/\/manifest\.json$/, '');
  }

  function hasAddon(addons, patterns) {
    if (!Array.isArray(addons)) return false;
    const urls = addons.map(a => normalizeAddonUrl(a.url || a.manifestUrl || ''));
    const ids = addons.map(a => String(a.id || '').toLowerCase());
    const names = addons.map(a => String(a.name || '').toLowerCase());

    return patterns.some(p =>
      urls.some(u => u.includes(p)) ||
      ids.some(i => i.includes(p)) ||
      names.some(n => n.includes(p))
    );
  }

  function refresh() {
    const appData = window.appData || {};
    const addons = appData.installedAddons || [];

    const hasCatalogAddon = hasAddon(addons, ['cinemeta', 'tmdb', 'tmdb-addon', 'tmdb.elfhosted']);
    const hasSubAddon = hasAddon(addons, ['subdl', 'opensubtitles', 'subscene']);
    const hasYoutubeAddon = addons.some(a => {
      if (a.enabled === false) return false;
      const id = String(a.id || '').toLowerCase();
      const url = String(a.url || a.manifestUrl || '').toLowerCase();
      return id === 'com.mediavault.youtube' || url.includes('addon-youtube') || (id.includes('youtube') && !id.includes('music') && !id.includes('ytmusic'));
    });
    const hasTmdbConfig = Boolean(appData.tmdbKey && appData.tmdbEnabled !== false);

    const prevBannerSearch = state.bannerSearch;
    const prevCatalog = state.catalog;
    const prevSubtitles = state.subtitles;
    const prevYoutube = state.youtube;

    state.catalog = hasCatalogAddon;
    state.bannerSearch = hasCatalogAddon; // Banner search relies on Cinemeta / TMDB addons
    state.subtitles = hasSubAddon;
    state.tmdbImages = hasTmdbConfig;
    state.animeSearch = true;
    state.localMovies = Array.isArray(appData.movies) && appData.movies.length > 0;
    state.localShows = Array.isArray(appData.shows) && appData.shows.length > 0;
    state.youtube = hasYoutubeAddon;

    const changed = (
      prevBannerSearch !== state.bannerSearch ||
      prevCatalog !== state.catalog ||
      prevSubtitles !== state.subtitles ||
      prevYoutube !== state.youtube
    );

    if (changed) {
      notify();
    }

    return state;
  }


  function can(feature) {
    refresh();
    switch (feature) {
      case 'banner':
      case 'bannerSearch':
      case 'banner-search':
        return state.bannerSearch;
      case 'catalog':
      case 'movies':
      case 'shows':
        return state.catalog || state.localMovies || state.localShows;
      case 'subtitles':
        return state.subtitles;
      case 'tmdb-images':
        return state.tmdbImages;
      case 'anime':
      case 'avatar':
        return state.animeSearch;
      default:
        return Boolean(state[feature]);
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') {
      listeners.add(fn);
    }
    return () => listeners.delete(fn);
  }

  function notify() {
    listeners.forEach(fn => {
      try { fn(state); } catch (e) { console.error('[Capabilities Listener Error]', e); }
    });
  }

  window.AppCapabilities = {
    refresh,
    can,
    onChange,
    getState: () => ({ ...state })
  };
})();
