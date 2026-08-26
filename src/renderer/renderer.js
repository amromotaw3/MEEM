class TMDBImage extends HTMLElement {
  connectedCallback() {
    const path = this.getAttribute('path');
    const type = this.getAttribute('type') || 'poster';
    if (!path || path === 'null' || path === 'undefined' || path.trim() === '') return;
    let src = path;
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
      src = path;
    } else if (path.startsWith('/tt') || path.startsWith('tt')) {
      const cleanId = path.replace(/^\//, '').split('/')[0];
      src = `https://images.metahub.space/poster/medium/${cleanId}/img`;
    } else if (path.startsWith('/')) {
      const size = type === 'still' ? 'w500' : (type === 'backdrop' ? 'w780' : 'w342');
      src = `https://image.tmdb.org/t/p/${size}${path}`;
    } else {
      const size = type === 'still' ? 'w500' : (type === 'backdrop' ? 'w780' : 'w342');
      src = `https://image.tmdb.org/t/p/${size}/${path}`;
    }
    this.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;" loading="lazy"
      onload="const wrap=this.closest('.ep-thumb-wrap')||this.closest('.card-poster');if(wrap){const ph=wrap.querySelector('.ep-thumb-placeholder')||wrap.querySelector('.card-poster-placeholder');if(ph)ph.style.display='none';}"
      onerror="this.style.display='none';const wrap=this.closest('.ep-thumb-wrap')||this.closest('.card-poster');if(wrap){const ph=wrap.querySelector('.ep-thumb-placeholder')||wrap.querySelector('.card-poster-placeholder');if(ph)ph.style.display='flex';}">`;
  }
}
customElements.define('tmdb-image', TMDBImage);

const SVG_MUSIC = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

(async function () {
  'use strict';

  // Create stub for persist function (will be overwritten later)
  // This allows modules to call persist() before full renderer initialization
  if (!window.persist) {
    window.persist = async function(forceImmediate = false) {
      console.warn('[PERSIST] Called before initialization, queuing...');
      // Small delay and retry mechanism
      let retries = 5;
      while (retries > 0 && !window.persistReady) {
        await new Promise(r => setTimeout(r, 100));
        retries--;
      }
      if (window.persistReady && window.persistImpl) {
        return window.persistImpl(forceImmediate);
      }
    };
  }

  // Disable local agent telemetry by default (set true to re-enable)
  window.__ENABLE_AGENT_LOGS = false;

  // Global error capture for unhandled promise rejections and uncaught errors (dev aids)
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      console.error('[RENDERER/ERROR] Unhandled Rejection:', ev.reason);
      if (ev.reason && ev.reason.stack) console.error(ev.reason.stack);
    } catch (e) { console.error('[RENDERER/ERROR] failed logging unhandledrejection', e); }
  });
  window.addEventListener('error', (ev) => {
    try {
      console.error('[RENDERER/ERROR] Uncaught Error:', ev.error || ev.message, ev);
      if (ev.error && ev.error.stack) console.error(ev.error.stack);
    } catch (e) { console.error('[RENDERER/ERROR] failed logging error', e); }
  });

  // Self-healing image cache fallback:
  // If a cached local image (media-img:// or local-file://) fails to load,
  // we catch it in the capture phase, clear the broken localStorage entry,
  // and redirect the image src back to its original remote URL so it loads instantly.
  window.addEventListener('error', (ev) => {
    try {
      if (ev.target && ev.target.tagName === 'IMG') {
        const img = ev.target;
        const failedUrl = img.src || '';
        if (failedUrl.startsWith('media-img:') || failedUrl.startsWith('local-file:')) {
          // Look up which remote URL mapped to this cached path
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cache_banner_')) {
              const val = localStorage.getItem(key);
              if (val === failedUrl) {
                const originalUrl = key.replace('cache_banner_', '');
                console.warn('[IMAGE-FALLBACK] Clearing broken cache and falling back to:', originalUrl);
                localStorage.removeItem(key);
                img.src = originalUrl;
                ev.preventDefault(); // Stop error logging or propagation
                return;
              }
            }
          }
        }
      }
    } catch (e) { console.error('[RENDERER/ERROR] failed handling image error fallback:', e); }
  }, true); // true = use capture phase so we catch resource loading errors

  // Small helper to safely set innerHTML when needed
  function safeSetInnerHTML(selOrEl, html) {
    try {
      const el = (typeof selOrEl === 'string') ? document.querySelector(selOrEl) : selOrEl;
      if (!el) { console.warn('[RENDERER/WARN] safeSetInnerHTML: element not found', selOrEl); return false; }
      el.innerHTML = html;
      return true;
    } catch (e) { console.error('[RENDERER/ERROR] safeSetInnerHTML failed', e); return false; }
  }

  // Helper: Convert a local file path to a protocol URL that works with webSecurity=true
  // Returns the original value if it's already a URL (http/https/data:)
  const APP_VERSION = '29.4.7'; // Sync with package.json
  function getSafeId(itemId) {
    try {
      const utf8Bytes = new TextEncoder().encode(String(itemId));
      let binary = '';
      for (let i = 0; i < utf8Bytes.length; i++) binary += String.fromCharCode(utf8Bytes[i]);
      return btoa(binary).replace(/[/+=]/g, '_');
    } catch (e) {
      return btoa(String(itemId)).replace(/[/+=]/g, '_');
    }
  }

  function bumpBannerRevision(itemId) {
    const safe = getSafeId(itemId);
    appData.bannerRevisions = appData.bannerRevisions || {};
    appData.bannerRevisions[safe] = Date.now();
  }

  function localImg(p) {
    if (!p || typeof p !== 'string' || p.trim() === '' || p === 'null' || p === 'undefined' || p === 'img' || p === 'poster.jpg' || p === '/img' || p === '/poster.jpg' || p.length < 3 || p.endsWith('/null') || p.endsWith('/undefined') || p.endsWith('w500null') || p.endsWith('w1280null') || p.endsWith('originalnull')) {
      return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==';
    }


    // Check localStorage cache for remote banners/images
    if (p.startsWith('http')) {
      const cached = localStorage.getItem('cache_banner_' + p);
      if (cached) {
        return cached;
      }
      // Trigger background cache download if running in Electron
      if (window.api && window.api.downloadImage) {
        const cacheKey = 'cache_banner_' + p;
        if (!window._downloadingBanners) window._downloadingBanners = new Set();
        if (!window._downloadingBanners.has(p)) {
          window._downloadingBanners.add(p);
          const safeId = getSafeId(p);
          window.api.downloadImage(p, safeId).then(localPath => {
            window._downloadingBanners.delete(p);
            if (localPath) {
              let safePath = localPath.replace(/\\/g, "/");
              let localUrl;
              const hasSeparators = safePath.includes('/') || safePath.includes('\\');
              if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
                if (safePath.match(/^[a-zA-Z]:/)) {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else if (safePath.startsWith("/")) {
                  localUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                }
              } else {
                localUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
              }
              localStorage.setItem(cacheKey, localUrl);
              console.log('[CACHE] Cached remote banner locally:', localUrl);
              
              // Find and update active banner containers in DOM immediately
              const activeView = $('#view-account');
              if (activeView && activeView.style.display !== 'none') {
                const bannerContainer = activeView.querySelector('#account-banner-container');
                if (bannerContainer && bannerContainer.style.backgroundImage.includes(p)) {
                  bannerContainer.style.backgroundImage = `url('${localUrl}')`;
                }
              }
              const picker = $('#profile-picker');
              if (picker && picker.style.display !== 'none') {
                renderProfilePicker();
              }
            }
          }).catch(err => {
            window._downloadingBanners.delete(p);
            console.warn('[CACHE] Failed to cache banner:', err);
          });
        }
      }
      return p;
    }

    let finalUrl = p;
    if (p.includes('.metahub.space')) {
      return p.replace(/(live|episodes)\.metahub\.space/gi, 'images.metahub.space');
    }
    if (!(p.startsWith("http") || p.startsWith("data:") || p.startsWith("blob:") || p.startsWith("src/") || p.startsWith("assets/") || p.startsWith("imgs/") || p.startsWith("local-file:") || p.startsWith("media-img:"))) {
      // If it's a relative path fragment (starts with / and doesn't look like a drive letter), assume it's from Cinemeta Metahub
      if (p.startsWith("/") && !p.match(/^\/[a-zA-Z]:/)) {
        if (p.startsWith("/tt")) {
          const cleanId = p.replace(/^\//, '').split('/')[0];
          return `https://images.metahub.space/poster/medium/${cleanId}/img`;
        } else if (p.match(/^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i)) {
          // TMDB Image path (e.g. /h5J4W4ceyxUcMs0cxxhYx5F54i1.jpg)
          finalUrl = `https://image.tmdb.org/t/p/w500${p}`;
        }
      } else if (p.startsWith("tt")) {
        const cleanId = p.split('/')[0];
        return `https://images.metahub.space/poster/medium/${cleanId}/img`;
      } else if (window.api && window.api.isElectron) {

        let safePath = p.replace(/\\/g, "/");
        // Ensure absolute paths (Windows C: or Unix /) use media-img:///
        const hasSeparators = safePath.includes('/') || safePath.includes('\\');
        if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
          // For Windows paths with drive letter, format as media-img:///C:/path
          if (safePath.match(/^[a-zA-Z]:/)) {
            finalUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
          } else if (safePath.startsWith("/")) {
            // For Unix absolute paths starting with /
            finalUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
          } else {
            // For relative bare filenames
            finalUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
          }
        } else {
          finalUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
        }
      } else if (window.Capacitor) {
        finalUrl = window.Capacitor.convertFileSrc(p);
      }
    }

    if (p.includes('banners') || p.includes('banners/')) {
      try {
        const basename = p.split(/[\\/]/).pop();
        const safeName = basename.replace(/\.[^/.]+$/, "");
        const rev = appData.bannerRevisions?.[safeName];
        if (rev) {
          return finalUrl + (finalUrl.includes('?') ? '&' : '?') + 't=' + rev;
        }
      } catch (e) {}
    }
    return finalUrl;
  }

  const tmdbShowIdCache = {};

  const EpisodeMetadataResolver = {
    cache: {},

    // Fetch TMDB TV ID from IMDb ID
    async getTmdbTvId(imdbId) {
      if (!imdbId || !String(imdbId).startsWith('tt')) return null;
      if (tmdbShowIdCache[imdbId]) return tmdbShowIdCache[imdbId];

      const tmdbKey = appData.tmdbKey;
      if (!tmdbKey) return null;

      try {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
        const res = await fetch(findUrl);
        if (res.ok) {
          const data = await res.json();
          const tvResult = data.tv_results?.[0];
          if (tvResult && tvResult.id) {
            tmdbShowIdCache[imdbId] = tvResult.id;
            return tvResult.id;
          }
        }
      } catch (e) {
        console.warn('[EpisodeMetadataResolver] Failed to find TMDB TV ID:', e);
      }
      return null;
    },

    // Fetch specific episode still/metadata from TMDB
    async fetchTmdbStill(imdbId, episodeNum, seasonNum = 1) {
      const tmdbKey = appData.tmdbKey;
      if (!tmdbKey) return null;

      try {
        const tvId = await this.getTmdbTvId(imdbId);
        if (tvId) {
          const seasonUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbKey}`;
          const res = await fetch(seasonUrl);
          if (res.ok) {
            const epData = await res.json();
            if (epData) {
              return {
                thumbnail: epData.still_path ? `https://image.tmdb.org/t/p/w500${epData.still_path}` : null,
                title: epData.name || null,
                overview: epData.overview || null
              };
            }
          }
        }
      } catch (e) {
        console.warn(`[EpisodeMetadataResolver] TMDB fetch failed for ep ${episodeNum}:`, e);
      }
      return null;
    },

    // Resolve specific episode data (returns { thumbnail, title, overview })
    async resolveEpisode(show, kitsuId, malId, imdbId, episodeNum, seasonNum = 1) {
      const cacheKey = `${show.id || show.title || 'anime'}_S${seasonNum}_E${episodeNum}`;
      if (this.cache[cacheKey]) {
        return this.cache[cacheKey];
      }

      let result = {
        thumbnail: null,
        title: null,
        overview: null
      };

      // 1. Try Kitsu
      if (kitsuId) {
        try {
          const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}/episodes?filter[number]=${episodeNum}`;
          const res = await fetch(kitsuUrl);
          if (res.ok) {
            const json = await res.json();
            const epObj = json.data?.[0];
            if (epObj) {
              const attributes = epObj.attributes || {};
              const thumb = attributes.thumbnail?.original || attributes.thumbnail?.medium || attributes.thumbnail?.small;
              if (thumb) {
                result.thumbnail = thumb;
              }
              result.title = attributes.titles?.en || attributes.titles?.en_jp || attributes.titles?.ja_jp || null;
              result.overview = attributes.synopsis || null;
            }
          }
        } catch (e) {
          console.warn(`[EpisodeMetadataResolver] Kitsu fetch failed for ep ${episodeNum}:`, e);
        }
      }

      // 2. Try TMDB if thumbnail not found or Kitsu isn't available
      if (!result.thumbnail && imdbId && String(imdbId).startsWith('tt')) {
        const tmdbData = await this.fetchTmdbStill(imdbId, episodeNum, seasonNum);
        if (tmdbData) {
          if (tmdbData.thumbnail) result.thumbnail = tmdbData.thumbnail;
          if (!result.title) result.title = tmdbData.title;
          if (!result.overview) result.overview = tmdbData.overview;
        }
      }

      this.cache[cacheKey] = result;
      return result;
    }
  };

  let playerSplashDismissed = false;
  let playerSplashMinTimeDone = false;
  let playerSplashVideoReady = false;

  window.tryDismissPlayerSplash = function() {
    if (playerSplashMinTimeDone && playerSplashVideoReady && !playerSplashDismissed) {
      playerSplashDismissed = true;
      const splash = document.getElementById('player-splash');
      if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => {
          splash.style.display = 'none';
        }, 600);
      }
    }
  };

  function isNativePlayerWindow() {
    return new URLSearchParams(window.location.search).get('mvWindow') === 'player';
  }

  function isChatWindow() {
    return new URLSearchParams(window.location.search).get('mvWindow') === 'chat';
  }

  function isLocalFilePath(p) {
    if (!p || typeof p !== 'string') return false;
    return p.includes('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p);
  }

  function normalizeAddonUrl(url) {
    if (!url) return '';
    let u = String(url).trim().toLowerCase();
    u = u.replace(/^(stremio|http|https):\/\//, '');
    if (u.endsWith('/manifest.json')) {
      u = u.slice(0, -14);
    }
    if (u.endsWith('/')) {
      u = u.slice(0, -1);
    }
    return u;
  }

  function getMediaMetadataKeys(item) {
    const keys = [];
    const push = (v) => {
      if (v !== undefined && v !== null && String(v).trim() && !keys.includes(String(v).trim())) keys.push(String(v).trim());
    };
    push(item?.imdb_id);
    push(item?.imdbId);
    push(item?.cinemetaId);
    push(item?.cinemeta_id);
    push(item?.tmdbId);
    push(item?.tmdb_id);
    push(item?.id);
    return keys;
  }

  function getMetadataForItem(item) {
    const tmdbCache = appData?.tmdbCache || {};
    const cinemetaCache = appData?.cinemetaCache || {};
    for (const key of getMediaMetadataKeys(item)) {
      if (tmdbCache[key]) return tmdbCache[key];
      if (cinemetaCache[key]) return cinemetaCache[key];
    }
    return null;
  }

  function certificationToAge(cert) {
    if (!cert) return 0;
    const s = String(cert).toUpperCase().trim();
    
    // NC-17, X, 18, 18+, TV-AO, Adult, 19
    if (/\b(NC-17|NC17|X|AO|ADULT)\b/i.test(s) || s.includes('18') || s.includes('19') || s.includes('RX')) {
      return 18;
    }
    
    // R, TV-MA, 15, 16, 17, 16+, MA15+
    if (/\b(R|TV-MA|MA|M)\b/i.test(s) || s.includes('15') || s.includes('16') || s.includes('17')) {
      return 16;
    }
    
    // PG-13, TV-14, 12A, 12, 13, 14, 13+
    if (/\b(PG-13|PG13|TV-14)\b/i.test(s) || s.includes('12') || s.includes('13') || s.includes('14')) {
      return 13;
    }
    
    // PG, TV-PG, GP, 6, 7, 8, 9, 7+
    if (/\b(PG|GP)\b/i.test(s) || s === '6' || s === '7' || s === '8' || s === '9' || s === '7+') {
      return 7;
    }
    
    // G, TV-G, U, All, etc.
    if (/\b(G|TV-G|U|AL|TP)\b/i.test(s) || s.includes('ALL') || s.includes('EVERYONE') || s === '0+') {
      return 0;
    }
    
    // Parse pure numbers in the certification string if any, e.g. "12", "16", "18", "7"
    const match = s.match(/(\d+)/);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val >= 18) return 18;
      if (val >= 16) return 16;
      if (val >= 13) return 13;
      if (val >= 7) return 7;
    }
    
    return 0;
  }

  function getItemAgeRating(item) {
    if (!item) return 0;
    
    // 1. Check direct properties
    let cert = item.certification || item.contentRating || item.content_rating;
    if (cert && typeof cert === 'string' && cert.trim().length > 0) {
      return certificationToAge(cert);
    }
    
    // 2. Check metadata cache
    const meta = getMetadataForItem(item);
    if (meta) {
      cert = meta.certification || meta.contentRating || meta.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return certificationToAge(cert);
      }
    }
    
    // 3. Fallback if the item itself has tmdbData or similar nested structure
    if (item.tmdbData) {
      cert = item.tmdbData.certification || item.tmdbData.contentRating || item.tmdbData.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return certificationToAge(cert);
      }
    }
    
    // 4. Fallback if item.meta has it (e.g. Cinemeta details object)
    if (item.meta) {
      cert = item.meta.certification || item.meta.contentRating || item.meta.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return certificationToAge(cert);
      }
    }
    
    return 0;
  }

  function getItemCertification(item) {
    if (!item) return 'NR';
    
    // 1. Check direct properties
    let cert = item.certification || item.contentRating || item.content_rating;
    if (cert && typeof cert === 'string' && cert.trim().length > 0) {
      return cert.trim();
    }
    
    // 2. Check metadata cache
    const meta = getMetadataForItem(item);
    if (meta) {
      cert = meta.certification || meta.contentRating || meta.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return cert.trim();
      }
    }
    
    // 3. Fallback if the item itself has tmdbData or similar nested structure
    if (item.tmdbData) {
      cert = item.tmdbData.certification || item.tmdbData.contentRating || item.tmdbData.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return cert.trim();
      }
    }
    
    // 4. Fallback if item.meta has it (e.g. Cinemeta details object)
    if (item.meta) {
      cert = item.meta.certification || item.meta.contentRating || item.meta.content_rating;
      if (cert && typeof cert === 'string' && cert.trim().length > 0) {
        return cert.trim();
      }
    }
    
    return 'NR';
  }

  function getAgeBadgeHTML(cert) {
    const cleanCert = (cert || 'NR').trim().toUpperCase();
    const isUnrated = cleanCert === 'NR' || cleanCert === 'NOT RATED' || cleanCert === 'UNRATED';
    
    const bgColor = 'rgba(255, 255, 255, 0.05)';
    const textColor = isUnrated ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)';
    const borderColor = 'rgba(255, 255, 255, 0.08)';
    const label = isUnrated ? 'NR' : cleanCert;
    
    return `<span class="discover-age-badge" style="background: ${bgColor}; padding: 2px 8px; border-radius: 12px; font-size: 9px; font-weight: 600; color: ${textColor}; margin-left: 6px; border: 1px solid ${borderColor}; display: inline-flex; align-items: center; white-space: nowrap; line-height: 1.2; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">${label}</span>`;
  }

  function isAgeAllowed(item) {
    if (!item) return true;
    const maxAge = currentProfile && typeof currentProfile.max_age_rating !== 'undefined'
      ? parseInt(currentProfile.max_age_rating, 10)
      : 18;
    const itemAge = getItemAgeRating(item);
    return itemAge <= maxAge;
  }

  function getTraktOrImdbPoster(item, imgElement, cardElement = null) {
    const id = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
    if (!id) return;

    // ── Addon Gate ────────────────────────────────────────────────────────────
    // Only fetch remote posters when a media metadata addon is installed & enabled.
    // Local-cached posters (cinemetaCache) are always served regardless.
    const installedAddons = appData.installedAddons || [];
    const hasMetadataAddon = installedAddons.some(a => {
      if (a.enabled === false) return false;
      const u = String(a.url || a.manifestUrl || '').toLowerCase();
      const aid = String(a.id || '').toLowerCase();
      const n = String(a.name || '').toLowerCase();
      const types = Array.isArray(a.types) ? a.types.map(t => String(t).toLowerCase()) : [];
      const hasMediaTypes = types.some(t => t.includes('movie') || t.includes('series') || t.includes('tv') || t.includes('anime'));
      const isMetaAddon = u.includes('cinemeta') || u.includes('tmdb') || u.includes('strem') ||
                          aid.includes('cinemeta') || aid.includes('tmdb') ||
                          n.includes('cinemeta') || n.includes('tmdb');
      return hasMediaTypes || isMetaAddon;
    });
    // Also allow if TMDB API key is configured directly
    const hasTmdbKey = !!(appData.tmdbKey && appData.tmdbEnabled !== false);
    const canFetchRemote = hasMetadataAddon || hasTmdbKey;
    // ─────────────────────────────────────────────────────────────────────────

    const maxAge = currentProfile && typeof currentProfile.max_age_rating !== 'undefined'
      ? parseInt(currentProfile.max_age_rating, 10)
      : 18;

    const checkAgeAndHide = (certVal) => {
      if (certVal) {
        const itemAge = certificationToAge(certVal);
        if (itemAge > maxAge) {
          if (cardElement) {
            cardElement.style.display = 'none';
            console.log(`[Age Filtering] Hiding restricted card for "${item.title || id}" (Age: ${itemAge} > Max: ${maxAge})`);
            // Check if card is child of a grid or row to handle empty states
            const parent = cardElement.parentElement;
            if (parent) {
              const visibleCards = Array.from(parent.children).filter(c => c.style.display !== 'none');
              if (visibleCards.length === 0) {
                const emptyEl = parent.parentElement?.querySelector('.empty-state') || parent.querySelector('.empty-state');
                if (emptyEl) emptyEl.style.display = 'flex';
              }
            }
          }
          return true;
        }
      }
      return false;
    };

    // Check direct property or cached metadata immediately
    const directCert = item.certification || item.contentRating || item.content_rating;
    if (directCert && checkAgeAndHide(directCert)) return;

    const cache = appData.cinemetaCache = appData.cinemetaCache || {};
    if (cache[id]) {
      const cachedCert = cache[id].certification || cache[id].content_rating;
      if (cachedCert && checkAgeAndHide(cachedCert)) return;
    }

    const fallbackToTmdbAddon = (onFail) => {
      // Use the TMDB ElfHosted Stremio addon (no API key required, reliable TMDB CDN images)
      const type = item.type === 'series' || item.type === 'tv' || item.type === 'show' ? 'series' : 'movie';
      fetch(`https://tmdb.elfhosted.com/meta/${type}/${id}.json`, { signal: AbortSignal.timeout(6000) })
        .then(r => r.json())
        .then(data => {
          const meta = data?.meta;
          if (meta && meta.poster) {
            const resCert = meta.certification || meta.contentRating || null;
            cache[id] = {
              cinemetaId: meta.id || id,
              type: type === 'series' ? 'tv' : 'movie',
              title: meta.name || meta.title || item.title,
              poster: meta.poster || null,
              backdrop: meta.background || null,
              year: meta.year || (meta.release_date || meta.first_air_date || '').slice(0, 4),
              rating: meta.imdbRating || meta.rating || 0,
              genres: meta.genres || [],
              certification: resCert,
              content_rating: resCert,
              description: meta.description || meta.synopsis || ''
            };
            
            if (checkAgeAndHide(resCert)) { persist(); return; }
            
            if (img) {
              img.src = meta.poster;
              img.style.display = 'block';
              const ph = img.parentElement?.querySelector('.discover-poster-placeholder') || img.parentElement?.querySelector('.card-poster-placeholder');
              if (ph) ph.style.display = 'none';
            }
            
            if (cardElement) {
              const titleEl = cardElement.querySelector('.card-title') || cardElement.querySelector('.discover-title');
              if (titleEl && (!item.title || item.title === 'Unknown' || item.title === id)) {
                titleEl.textContent = meta.name || meta.title;
              }
              const metaEl = cardElement.querySelector('.card-meta') || cardElement.querySelector('.discover-meta span:not(.discover-rating-stars)');
              if (metaEl && meta.year) metaEl.textContent = meta.year;
              const ratingEl = cardElement.querySelector('.card-rating') || cardElement.querySelector('.discover-rating-stars');
              if (ratingEl && meta.imdbRating) {
                if (cardElement.querySelector('.card-rating')) {
                  ratingEl.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${parseFloat(meta.imdbRating).toFixed(1)}`;
                } else {
                  ratingEl.innerHTML = `<i class="fas fa-star" style="font-size:8px"></i> ${parseFloat(meta.imdbRating).toFixed(1)}`;
                }
              }
            }
            persist();
            triggerLocalCaching(meta.poster, id);
          } else if (typeof onFail === 'function') {
            onFail();
          }
        })
        .catch(() => {
          if (typeof onFail === 'function') onFail();
        });
    };

    let img = imgElement;
    const wrap = cardElement?.querySelector('.discover-poster-wrap') || cardElement?.querySelector('.card-poster');
    if (!img && wrap) {
      img = wrap.querySelector('.search-poster-img') || wrap.querySelector('.discover-poster') || wrap.querySelector('.dynamic-imdb-poster');
      if (!img) {
        img = document.createElement('img');
        img.className = wrap.classList.contains('discover-poster-wrap') ? 'discover-poster search-poster-img' : 'dynamic-imdb-poster';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'none';
        img.loading = 'lazy';
        wrap.prepend(img);
      }
    }
    
    if (img) {
      img.onerror = () => {
        const failedSrc = img.src || '';
        // If metahub.space failed, try the alternate metahub subdomain once
        if (failedSrc.includes('images.metahub.space') && !img._metahubRetried) {
          img._metahubRetried = true;
          img.src = failedSrc.replace('images.metahub.space', 'live.metahub.space');
          return;
        }
        img.onerror = null; // Prevent double-firing
        // Clear stale cached poster so fallbacks can overwrite it
        if (id && cache[id]) {
          const cachedPoster = cache[id].poster || '';
          if (cachedPoster.includes('metahub.space') || cachedPoster.includes('cinemeta')) {
            delete cache[id].poster;
          }
        }
        // Try TMDB addon as fallback
        fallbackToTmdbAddon(() => {
          // Final fallback: hide image and show placeholder
          img.style.display = 'none';
          const ph = img.parentElement?.querySelector('.discover-poster-placeholder') || img.parentElement?.querySelector('.card-poster-placeholder');
          if (ph) ph.style.display = 'flex';
        });
      };
    }
    
    const triggerLocalCaching = (posterUrl, targetId) => {
      if (!posterUrl || !posterUrl.startsWith('http')) return;
      window.api.invoke('download-image', posterUrl, targetId).then(localPath => {
        if (localPath && localPath !== posterUrl) {
          cache[targetId].poster = localPath;
          persist();
          if (img) img.src = localImg(localPath);
        }
      }).catch(() => null);
    };

    if (cache[id] && cache[id].poster) {
      const cert = cache[id].certification || cache[id].content_rating;
      if (cert && checkAgeAndHide(cert)) return;

      if (cardElement) {
        if (cert) {
          const ageBadgeContainer = cardElement.querySelector('.discover-age-badge-container');
          if (ageBadgeContainer) {
            ageBadgeContainer.innerHTML = getAgeBadgeHTML(cert);
          }
        }
      }
      if (img) {
        img.src = localImg(cache[id].poster);
        img.style.display = 'block';
        const ph = img.parentElement?.querySelector('.discover-poster-placeholder') || img.parentElement?.querySelector('.card-poster-placeholder');
        if (ph) ph.style.display = 'none';
      }
      
      if (cache[id].poster.startsWith('http')) {
        triggerLocalCaching(cache[id].poster, id);
      }
      return;
    }

    if (!canFetchRemote) return;

    const fallbackToCinemeta = () => {
      const type = item.type === 'series' || item.type === 'tv' || item.type === 'show' ? 'series' : 'movie';
      window.api.invoke('cinemeta-details', { id, type }).then(res => {
        if (res && res.meta && res.meta.poster) {
          const resCert = res.certification || res.meta.certification || res.meta.contentRating || res.meta.content_rating || null;
          cache[id] = {
            cinemetaId: res.meta.id,
            type: type === 'series' ? 'tv' : 'movie',
            title: res.meta.name || res.meta.title,
            poster: res.meta.poster || null,
            backdrop: res.meta.background || null,
            year: res.meta.year || (res.meta.release_date || res.meta.first_air_date || '').slice(0, 4),
            rating: res.meta.behaviorHints?.rating || res.meta.imdbRating || 0,
            genres: res.meta.genres || [],
            certification: resCert,
            content_rating: resCert,
            description: res.meta.description || res.meta.synopsis || ''
          };
          
          if (checkAgeAndHide(resCert)) {
            persist();
            return;
          }
          
          if (img) {
            img.src = localImg(res.meta.poster);
            img.style.display = 'block';
            
            const ph = img.parentElement?.querySelector('.discover-poster-placeholder') || img.parentElement?.querySelector('.card-poster-placeholder');
            if (ph) ph.style.display = 'none';
          }
          
          if (cardElement) {
            const titleEl = cardElement.querySelector('.card-title') || cardElement.querySelector('.discover-title');
            if (titleEl && (!item.title || item.title === 'Unknown' || item.title === id)) {
              titleEl.textContent = res.meta.name || res.meta.title;
            }
            const metaEl = cardElement.querySelector('.card-meta') || cardElement.querySelector('.discover-meta span:not(.discover-rating-stars)');
            if (metaEl && res.meta.year) {
              metaEl.textContent = res.meta.year;
            }
            const ratingEl = cardElement.querySelector('.card-rating') || cardElement.querySelector('.discover-rating-stars');
            if (ratingEl && res.meta.imdbRating) {
              if (cardElement.querySelector('.card-rating')) {
                ratingEl.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${parseFloat(res.meta.imdbRating).toFixed(1)}`;
              } else {
                ratingEl.innerHTML = `<i class="fas fa-star" style="font-size:8px"></i> ${parseFloat(res.meta.imdbRating).toFixed(1)}`;
              }
            }
            const genreEl = cardElement.querySelector('.card-genres');
            if (genreEl && res.meta.genres?.length) {
              genreEl.textContent = res.meta.genres.slice(0, 2).join(' · ');
            }
            if (resCert) {
              const ageBadgeContainer = cardElement.querySelector('.discover-age-badge-container');
              if (ageBadgeContainer) {
                ageBadgeContainer.innerHTML = getAgeBadgeHTML(resCert);
              }
            }
          }
          
          persist();
          triggerLocalCaching(res.meta.poster, id);
        }
      }).catch(err => {
        console.warn('[METADATA-ASYNC] Failed to fetch poster for', id, err.message);
      });
    };

    const tmdbKey = appData.tmdbKey;
    const overrideEnabled = appData.tmdbEnabled !== false && appData.tmdbImageOverride !== false;
    const scope = appData.tmdbImageScope || 'both';

    if (overrideEnabled && tmdbKey && id.startsWith('tt') && (scope === 'both' || scope === 'posters')) {
      const type = item.type === 'series' || item.type === 'tv' || item.type === 'show' ? 'tv' : 'movie';
      const url = `https://api.themoviedb.org/3/find/${id}?api_key=${tmdbKey}&external_source=imdb_id`;
      fetch(url).then(r => r.json()).then(data => {
        const results = type === 'tv' ? data.tv_results : data.movie_results;
        const tmdbItem = results?.[0];
        if (tmdbItem && tmdbItem.poster_path) {
          const posterUrl = `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}`;
          
          cache[id] = {
            cinemetaId: id,
            type: type === 'tv' ? 'tv' : 'movie',
            title: tmdbItem.title || tmdbItem.name,
            poster: posterUrl,
            backdrop: tmdbItem.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbItem.backdrop_path}` : null,
            year: (tmdbItem.release_date || tmdbItem.first_air_date || '').slice(0, 4),
            rating: tmdbItem.vote_average || 0,
            genres: [],
            description: tmdbItem.overview || ''
          };
          
          // Asynchronously fetch certification from TMDB
          try {
            const certEndpoint = type === 'tv' ? `tv/${tmdbItem.id}/content_ratings` : `movie/${tmdbItem.id}/release_dates`;
            const certUrl = `https://api.themoviedb.org/3/${certEndpoint}?api_key=${tmdbKey}`;
            fetch(certUrl).then(cr => cr.json()).then(certData => {
              let cert = null;
              if (certData && certData.results) {
                if (type === 'tv') {
                  const usRating = certData.results.find(r => r.iso_3166_1 === 'US');
                  cert = usRating ? usRating.rating : null;
                  if (!cert) {
                    const found = certData.results.find(r => r.rating);
                    if (found) cert = found.rating;
                  }
                } else {
                  const usRelease = certData.results.find(r => r.iso_3166_1 === 'US');
                  if (usRelease && usRelease.release_dates) {
                    const found = usRelease.release_dates.find(d => d.certification);
                    if (found) cert = found.certification;
                  }
                  if (!cert) {
                    for (const r of certData.results) {
                      if (r.release_dates) {
                        const found = r.release_dates.find(d => d.certification);
                        if (found) {
                          cert = found.certification;
                          break;
                        }
                      }
                    }
                  }
                }
              }
              if (cert) {
                cache[id].certification = cert;
                cache[id].content_rating = cert;
                persist();
                checkAgeAndHide(cert);
                if (cardElement) {
                  const ageBadgeContainer = cardElement.querySelector('.discover-age-badge-container');
                  if (ageBadgeContainer) {
                    ageBadgeContainer.innerHTML = getAgeBadgeHTML(cert);
                  }
                }
              }
            }).catch(() => null);
          } catch (cErr) {
            console.warn('[TMDB Certification Fetch] Failed:', cErr);
          }
          
          if (img) {
            img.src = posterUrl;
            img.style.display = 'block';
            const ph = img.parentElement?.querySelector('.discover-poster-placeholder') || img.parentElement?.querySelector('.card-poster-placeholder');
            if (ph) ph.style.display = 'none';
          }
          
          if (cardElement) {
            const titleEl = cardElement.querySelector('.card-title') || cardElement.querySelector('.discover-title');
            if (titleEl && (!item.title || item.title === 'Unknown' || item.title === id)) {
              titleEl.textContent = tmdbItem.title || tmdbItem.name;
            }
            const metaEl = cardElement.querySelector('.card-meta') || cardElement.querySelector('.discover-meta span:not(.discover-rating-stars)');
            if (metaEl && (tmdbItem.release_date || tmdbItem.first_air_date)) {
              metaEl.textContent = (tmdbItem.release_date || tmdbItem.first_air_date).slice(0, 4);
            }
            const ratingEl = cardElement.querySelector('.card-rating') || cardElement.querySelector('.discover-rating-stars');
            if (ratingEl && tmdbItem.vote_average) {
              if (cardElement.querySelector('.card-rating')) {
                ratingEl.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${parseFloat(tmdbItem.vote_average).toFixed(1)}`;
              } else {
                ratingEl.innerHTML = `<i class="fas fa-star" style="font-size:8px"></i> ${parseFloat(tmdbItem.vote_average).toFixed(1)}`;
              }
            }
          }
          persist();
          triggerLocalCaching(posterUrl, id);
        } else {
          fallbackToTmdbAddon(fallbackToCinemeta);
        }
      }).catch(() => fallbackToTmdbAddon(fallbackToCinemeta));
    } else {
      fallbackToTmdbAddon(fallbackToCinemeta);
    }
  }

  function hasEnabledOpenSubtitlesAddon() {
    return true; // Always return true since direct SubDL is always enabled
  }
  window.hasEnabledOpenSubtitlesAddon = hasEnabledOpenSubtitlesAddon;

  window.buildMediaMetadataContext = function(item, show) {
    const showMeta = show ? getMetadataForItem(show) : null;
    const itemMeta = getMetadataForItem(item);

    const itemCache = window.appData?.tmdbCache?.[item?.id] || {};
    const showCache = show ? (window.appData?.tmdbCache?.[show?.id] || {}) : {};

    let finalImdbId = item?.imdb_id || item?.imdbId || item?.cinemetaId ||
                      itemCache.imdb_id || itemCache.imdbId || itemCache.imdbID ||
                      item?.meta?.imdb_id || item?.meta?.imdbId || item?.meta?.cinemetaId || item?.meta?.id ||
                      show?.imdb_id || show?.imdbId ||
                      showCache.imdb_id || showCache.imdbId || showCache.imdbID ||
                      showMeta?.imdb_id || showMeta?.cinemetaId || 
                      itemMeta?.imdb_id || itemMeta?.cinemetaId;

    if (!finalImdbId && item.isLocal && item.tmdbData && item.tmdbData.imdb_id) {
      finalImdbId = item.tmdbData.imdb_id;
    }
    
    let parsedSeason = item?.season !== undefined ? item?.season : (item?.season_number !== undefined ? item?.season_number : (item?.meta?.season !== undefined ? item?.meta?.season : item?.meta?.season_number));
    let parsedEpisode = item?.episode !== undefined ? item?.episode : (item?.episode_number !== undefined ? item?.episode_number : (item?.meta?.episode !== undefined ? item?.meta?.episode : item?.meta?.episode_number));

    if (finalImdbId && String(finalImdbId).startsWith('tt')) {
      const parts = String(finalImdbId).split(':');
      if (parts.length >= 3) {
        finalImdbId = parts[0];
        if (parsedSeason === undefined || parsedSeason === null) {
          parsedSeason = parseInt(parts[1]);
        }
        if (parsedEpisode === undefined || parsedEpisode === null) {
          parsedEpisode = parseInt(parts[2]);
        }
      } else {
        finalImdbId = parts[0];
      }
    } else {
      finalImdbId = null;
    }

    const resolvedKitsuId = item?.kitsuId || item?.kitsu_id || item?.meta?.kitsuId || item?.meta?.kitsu_id;
    const type = (parsedSeason !== undefined && parsedSeason !== null && parsedEpisode !== undefined && parsedEpisode !== null) 
      ? 'series' 
      : (item?.media_type || item?.type || item?.meta?.media_type || item?.meta?.type || 'movie');
    const isAnime = (item?.source === 'jikan' || item?.source === 'mal' || item?.source === 'kitsu' || 
                     item?.meta?.source === 'jikan' || item?.meta?.source === 'mal' || item?.meta?.source === 'kitsu' || 
                     type === 'anime' || (item?.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:'))) || (item?.meta?.id && (String(item.meta.id).startsWith('kitsu:') || String(item.meta.id).startsWith('mal:') || String(item.meta.id).startsWith('jikan:') || String(item.meta.id).startsWith('anilist:'))));

    return {
      imdbId: finalImdbId || null,
      kitsuId: resolvedKitsuId || null,
      malId: item?.mal_id || item?.meta?.mal_id || ((String(item?.id || item?.meta?.id).startsWith('mal:') || String(item?.id || item?.meta?.id).startsWith('jikan:')) ? String(item?.id || item?.meta?.id).replace('mal:', '').replace('jikan:', '') : null),
      type: isAnime ? 'anime' : type,
      season: parsedSeason || null,
      episode: parsedEpisode || null,
      title: item?.title || item?.name || item?.filename || item?.meta?.title || item?.meta?.name || show?.title || show?.name || null
    };
  };

  /** 
   * Ensures a thumbnail exists for a local video. 
   * If not in cache, triggers generation and refreshes UI when done.
   */
  const _thumbnailQueue = new Set();
  function ensureThumbnail(item, force = false) {
    if (!item || !item.path) return null;
    const cacheId = item.id || item.path;

    // Return cached if available
    if (!force && appData.thumbnails[cacheId]) return appData.thumbnails[cacheId];

    // Avoid duplicate requests for the same item
    if (_thumbnailQueue.has(cacheId)) return null;
    _thumbnailQueue.add(cacheId);

    const mediaUrl = toMediaPlayUrl(item.path);
    // Use the Canvas-based generator
    window.generateVideoThumbnail(mediaUrl, 5).then(base64 => {
      appData.thumbnails[cacheId] = base64;
      _thumbnailQueue.delete(cacheId);
      persist();

      // Smart UI Refresh: only refresh if the item is currently visible
      if (currentView === 'social') renderSocial();
      else if (currentView === 'movies' || currentView === 'library') renderLibrary();
    }).catch(err => {
      console.warn('[Thumbnail] Failed to generate for:', item.path, err.message);
      _thumbnailQueue.delete(cacheId);
    });

    return null; // Return null while generating
  }

  function refreshCurrentView() {
    if (currentView === 'movies') renderMovies();
    else if (currentView === 'shows') renderShows();
    else if (currentView === 'social') renderSocial();
    else if (currentView === 'music') renderMusic();
    else if (currentView === 'discover') renderDiscover();
    else if (currentView === 'watchlist') renderWatchlist();
    else if (currentView === 'account') renderAccount();
    updateBadges();
  }

  const AVATARS = [
    'imgs/avatars/default.png'
  ];

  const DEFAULT_AVATAR_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="%23333"><circle cx="12" cy="12" r="10" fill="%23222"/><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%23666"/></svg>';

  window.appData = appData;
  window.localImg = localImg;
  window.playLocalItem = (item, show) => playVideo(item, show || null);
  window.currentProfile = currentProfile;

  // ---------- AUTH / PROFILE FLOW ----------
  let hardwareIdCache = null;
  let authFlowCompleted = false;
  const supabaseStorage = {
    getItem: async (key) => {
      try {
        if (window.api && typeof window.api.storageGet === 'function') {
          return await window.api.storageGet(key);
        }
      } catch (e) { console.warn('[SupabaseStorage] getItem failed:', e); }
      return window.localStorage.getItem(key);
    },
    setItem: async (key, value) => {
      try {
        if (window.api && typeof window.api.storageSet === 'function') {
          await window.api.storageSet(key, value);
          return;
        }
      } catch (e) { console.warn('[SupabaseStorage] setItem failed:', e); }
      window.localStorage.setItem(key, value);
    },
    removeItem: async (key) => {
      try {
        if (window.api && typeof window.api.storageRemove === 'function') {
          await window.api.storageRemove(key);
          return;
        }
      } catch (e) { console.warn('[SupabaseStorage] removeItem failed:', e); }
      window.localStorage.removeItem(key);
    }
  };

  function getSupabaseRendererClient() {
    if (!window.supabase) throw new Error('Supabase not available');
    if (!window._supabaseRendererClientShared) {
      window._supabaseRendererClientShared = window.supabase.createClient(
        window.MEDIAVAULT_SUPABASE_URL || window.SUPABASE_URL,
        window.MEDIAVAULT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            storage: supabaseStorage
          }
        }
      );

      // Auto-sync refreshed session to main process
      window._supabaseRendererClientShared.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          console.log('[AUTH] onAuthStateChange event in renderer.js:', event);
          await window.api.invoke('cloud-sync-user-session', {
            userId: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.username || '',
            session: {
              access_token: session.access_token,
              refresh_token: session.refresh_token
            }
          }).catch(err => console.error('[AUTH] Failed to sync session on auth state change:', err));
        }
      });
    }
    return window._supabaseRendererClientShared;
  }

  window.getSupabaseRendererClient = getSupabaseRendererClient;

  if (window.api && typeof window.api.on === 'function') {
    window.api.on('session-refreshed', async (newSession) => {
      if (!newSession || !newSession.access_token) return;
      try {
        const client = getSupabaseRendererClient();
        await client.auth.setSession(newSession);
        console.log('[AUTH] Renderer JWT updated from main-process refresh broadcast.');
      } catch (e) {
        console.warn('[AUTH] Failed to apply refreshed session in renderer:', e.message);
      }
    });

    window.api.on('force-logout', async () => {
      console.warn('[AUTH] Force logout request received from main process.');
      await finalizeLogout();
    });
  }

  async function finalizeLogout() {
    try {
      console.log('[LOGOUT] Starting final logout cleanup...');
      if (window.supabase) {
        try {
          const client = getSupabaseRendererClient();
          await client.auth.signOut();
          window._supabaseRendererClientShared = null;
          console.log('[LOGOUT] Supabase session signed out');
        } catch (e) {
          console.warn('[LOGOUT] Supabase signOut error (non-critical):', e.message);
        }
      }
      
      try {
        const clearResult = await window.api.invoke('clear-session');
        console.log('[LOGOUT] Local session cleared:', clearResult);
      } catch (e) {
        console.warn('[LOGOUT] Local session clear error:', e.message);
      }
      
      localStorage.clear();
      appData.user = null;
      appData.authenticated = false;
      // Do not call persist() here to avoid overwriting the clean logout state with cached renderer data.
      
      console.log('[LOGOUT] Clearing app data and reloading...');
      await new Promise(r => setTimeout(r, 500));
      window.location.href = window.location.pathname;
    } catch (err) {
      console.error('[LOGOUT] Error during final logout:', err);
      showToast('Error during logout: ' + err.message);
    }
  }

  async function performLogout() {
    try {
      console.log('[LOGOUT] User triggered logout. Displaying confirmation modal...');
      const email = appData.user?.email;
      if (!email) {
        console.log('[LOGOUT] No user email found. Performing instant local logout.');
        await finalizeLogout();
        return;
      }

      const modal = document.getElementById('modal-account-logout');
      if (modal) {
        modal.style.display = 'flex';
      } else {
        await finalizeLogout();
      }
    } catch (err) {
      console.error('[LOGOUT] Failed to show logout confirmation modal:', err);
      showToast('Failed to initialize logout: ' + err.message);
    }
  }

  async function getHardwareIdForClient() {
    try {
      if (window.api) {
        return await window.api.invoke('get-hardware-id');
      }
    } catch (e) { console.warn('[AUTH] getHardwareId failed', e); }
    return 'unknown-device';
  }

  function showBannedOverlay(reason, hwId) {
    // Remove existing if any
    const existing = document.getElementById('banned-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'banned-overlay';
    overlay.style = 'position:fixed;inset:0;background:radial-gradient(circle at center, #1a0505 0%, #050000 100%) !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;z-index:9999999 !important;padding:30px !important;flex-direction:column !important;font-family:\'Inter\', sans-serif !important;';
    
    overlay.innerHTML = `
      <div style="max-width:500px;width:100%;text-align:center;background:rgba(20, 10, 10, 0.4);border:1px solid rgba(239, 68, 68, 0.15);border-radius:24px;padding:40px;box-shadow:0 20px 50px rgba(0,0,0,0.8), 0 0 40px rgba(239,68,68,0.1);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg, #ef4444, #b91c1c);"></div>
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;box-shadow:0 0 20px rgba(239,68,68,0.2);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:12px;color:#ef4444;text-shadow:0 0 10px rgba(239,68,68,0.3);">Access Restricted</h1>
        <p style="font-size:15px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:24px;">This device is permanently blacklisted from the MediaVault network due to a hardware restriction or security ban.</p>
        
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Ban Reason</div>
          <div style="font-size:14px;color:#fca5a5;font-weight:500;">${reason || 'Violation of service terms.'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:12px;margin-bottom:4px;">Device Signature</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);font-family:monospace;word-break:break-all;">${hwId || 'Unknown'}</div>
        </div>
        
        <p style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.5;">If you believe this restriction is an error, please contact support with your device signature above.</p>
      </div>
    `;
    
    document.body.appendChild(overlay);

    window.addEventListener('keydown', (e) => {
      if (['Escape', 'Tab', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    }, { capture: true });

    document.body.style.overflow = 'hidden';

    // Hide splash screen since we are blocking the app with this overlay
    if (window.hideSplash) window.hideSplash();
  }

  /**
   * Check if the user's subscription has expired. If so, block the entire app.
   * Returns true if the overlay was shown (subscription expired), false otherwise.
   */
  function checkSubscriptionStatus() {
    const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at || null;
    if (!sub) return false; // No subscription info - allow access (free/local users)
    const now = new Date();
    const expDate = new Date(sub);
    if (expDate > now) return false; // Still active
    showSubscriptionExpiredOverlay(sub);
    return true;
  }

  function showSubscriptionExpiredOverlay(expirationDate) {
    const existing = document.getElementById('subscription-expired-overlay');
    if (existing) existing.remove();

    let formattedDate = expirationDate;
    try {
      formattedDate = new Date(expirationDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {}

    const overlay = document.createElement('div');
    overlay.id = 'subscription-expired-overlay';
    overlay.style = 'position:fixed;inset:0;background:radial-gradient(circle at center, #0f0a1a 0%, #050008 100%) !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;z-index:9999998 !important;padding:30px !important;flex-direction:column !important;font-family:\'Inter\', sans-serif !important;';
    
    overlay.innerHTML = `
      <div style="max-width:520px;width:100%;text-align:center;background:rgba(15, 10, 30, 0.5);border:1px solid rgba(139, 92, 246, 0.15);border-radius:24px;padding:45px 40px;box-shadow:0 20px 60px rgba(0,0,0,0.8), 0 0 40px rgba(139,92,246,0.08);backdrop-filter:blur(25px);-webkit-backdrop-filter:blur(25px);position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg, #8b5cf6, #6366f1, #a855f7);"></div>
        <div style="width:72px;height:72px;border-radius:50%;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;box-shadow:0 0 20px rgba(139,92,246,0.2);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:12px;color:#a855f7;text-shadow:0 0 10px rgba(139,92,246,0.3);">
          انتهى الاشتراك / Subscription Expired
        </h1>
        <p style="font-size:15px;color:rgba(255,255,255,0.8);line-height:1.6;margin-bottom:24px;">
          لقد انتهت فترة الاشتراك الخاصة بحسابك. يرجى تجديد الاشتراك لمواصلة استخدام التطبيق.
          <br>
          Your subscription period has ended. Please renew to continue using the application.
        </p>
        
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">تاريخ الانتهاء / Expiration Date</div>
          <div style="font-size:14px;color:#c084fc;font-weight:500;">${formattedDate}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-top:12px;margin-bottom:4px;">البريد الإلكتروني / Account Email</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);font-family:monospace;word-break:break-all;">${appData.user?.email || 'Unknown'}</div>
        </div>
        
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button id="sub-expired-logout" style="padding:12px 28px;border-radius:12px;border:1px solid rgba(139,92,246,0.3);background:rgba(139,92,246,0.15);color:#c084fc;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:\'Inter\',sans-serif;">
            <i class="fas fa-sign-out-alt" style="margin-right:6px;"></i> تسجيل الخروج / Logout
          </button>
          <button id="sub-expired-exit" style="padding:12px 28px;border-radius:12px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.1);color:#fca5a5;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s;font-family:\'Inter\',sans-serif;">
            <i class="fas fa-power-off" style="margin-right:6px;"></i> إغلاق التطبيق / Exit App
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);

    overlay.querySelector('#sub-expired-logout').onclick = async () => {
      overlay.remove();
      await finalizeLogout();
    };
    overlay.querySelector('#sub-expired-exit').onclick = () => {
      if (window.api && window.api.closeWindow) {
        window.api.closeWindow();
      } else {
        window.close();
      }
    };

    // Block keyboard escape
    window.addEventListener('keydown', (e) => {
      if (document.getElementById('subscription-expired-overlay')) {
        if (['Escape', 'Tab', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
      }
    }, { capture: true });

    document.body.style.overflow = 'hidden';

    // Hide splash screen since we are blocking the app with this overlay
    if (window.hideSplash) window.hideSplash();
  }

  // (Auth logic and showAuthOverlay are implemented in modules/auth.js)

  // Active connectivity verification — probes multiple endpoints to overcome
  // Electron's net.isOnline() false negatives after network changes (travel, VPN, ISP switch).
  async function checkRealOnlineStatus() {
    if (navigator.onLine) return true;

    try {
      if (window.api && window.api.invoke) {
        const isOnline = await window.api.invoke('check-network-status');
        if (typeof isOnline === 'boolean' && isOnline) return true;
      }
    } catch (e) {}

    const tryFetch = (url) => fetch(url, {
      method: 'GET', mode: 'no-cors', cache: 'no-store',
      signal: AbortSignal.timeout(2000)
    }).then(() => true).catch(() => false);

    try {
      const results = await Promise.all([
        tryFetch('https://www.google.com/generate_204'),
        tryFetch('https://1.1.1.1'),
      ]);
      return results.some(r => r === true);
    } catch (e) {
      return true;
    }
  }


  let _isReallyOnline = true;

  async function updateOfflineStatusIndicator(isOnline) {
    if (navigator.onLine) {
      isOnline = true;
    } else if (typeof isOnline !== 'boolean') {
      if (window.api && window.api.checkNetworkStatus) {
        try {
          const res = await window.api.checkNetworkStatus();
          isOnline = res ? res.isOnline : true;
        } catch (e) {
          isOnline = true;
        }
      } else {
        isOnline = true;
      }
    }
    _isReallyOnline = isOnline;
    const indicator = $('#btn-offline-status');
    if (indicator) {
      if (isOnline) {
        indicator.style.setProperty('display', 'none', 'important');
      } else {
        indicator.style.removeProperty('display');
        indicator.style.display = 'flex';
      }
    }
  }

  window.updateOfflineStatusIndicator = updateOfflineStatusIndicator;

  window.addEventListener('online',  () => updateOfflineStatusIndicator(true));
  window.addEventListener('offline', () => updateOfflineStatusIndicator(false));
  setInterval(() => updateOfflineStatusIndicator(), 15000);

  if (window.api && window.api.on) {
    window.api.on('connectivity-changed', ({ isOnline }) => {
      updateOfflineStatusIndicator(isOnline);
    });
  }


  function initSidebarHoverTrigger() {
    const wrapper = document.querySelector('.sidebar-wrapper');
    const sidebarNav = $('#sidebar');
    if (wrapper && sidebarNav) {
      let timeoutId = null;
      
      const handleEnter = () => {
        if (timeoutId) clearTimeout(timeoutId);
        sidebarNav.classList.add('hovered');
      };
      
      const handleLeave = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          sidebarNav.classList.remove('hovered');
        }, 150); // 150ms debounce prevents flickering during transition reflows
      };

      wrapper.addEventListener('mouseenter', handleEnter);
      wrapper.addEventListener('mouseleave', handleLeave);
      sidebarNav.addEventListener('mouseenter', handleEnter);
      sidebarNav.addEventListener('mouseleave', handleLeave);
    }
  }

  // Initialize click event for offline status button
  document.addEventListener('DOMContentLoaded', () => {
    // Set up MutationObserver to toggle 'auth-active' class on body when auth-overlay is present
    const authObserver = new MutationObserver(() => {
      const hasAuth = !!document.getElementById('auth-overlay');
      document.body.classList.toggle('auth-active', hasAuth);
    });
    authObserver.observe(document.body, { childList: true });
    // Run initial check
    document.body.classList.toggle('auth-active', !!document.getElementById('auth-overlay'));

    // Clear old banner cache entries with 'banner_' prefix from localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cache_banner_')) {
        const cached = localStorage.getItem(key);
        if (cached && cached.includes('banner_')) {
          localStorage.removeItem(key);
        }
      }
    }
    // Clear stale metahub cache entries that used the old /poster.jpg format (now /img)
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cache_banner_') && key.includes('metahub.space') && key.includes('poster.jpg')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    // Clear stale/broken poster URLs (v3-cinemeta CDN doesn't serve images) from cinemetaCache.
    // We delete them so fresh lookups happen on next render rather than migrating to another dead URL.
    try {
      const cinemetaCache = appData.cinemetaCache;
      if (cinemetaCache && typeof cinemetaCache === 'object') {
        let staleFound = false;
        for (const id in cinemetaCache) {
          const entry = cinemetaCache[id];
          if (entry) {
            const posterStr = String(entry.poster || '');
            const backdropStr = String(entry.backdrop || '');
            // Remove any poster/backdrop pointing to v3-cinemeta image CDN (returns 404)
            if (posterStr.includes('v3-cinemeta.strem.io') && (posterStr.includes('/poster/') || posterStr.includes('/img'))) {
              delete entry.poster;
              staleFound = true;
            }
            if (backdropStr.includes('v3-cinemeta.strem.io') && (backdropStr.includes('/poster/') || backdropStr.includes('/img'))) {
              delete entry.backdrop;
              staleFound = true;
            }
          }
        }
        if (staleFound) {
          console.log('[INIT] Cleared stale v3-cinemeta image URLs from cache — will refresh on next render.');
          persist();
        }
      }
    } catch (e) { /* ignore */ }

    // Clear old banner paths with 'banner_' prefix from appData.banners
    if (appData.banners) {
      for (const id in appData.banners) {
        if (appData.banners[id] && appData.banners[id].includes('banner_')) {
          delete appData.banners[id];
        }
      }
      persist();
    }
    updateOfflineStatusIndicator();
    initSidebarHoverTrigger();
    const indicator = $('#btn-offline-status');
    if (indicator) {
      indicator.onclick = () => {
        const modal = $('#modal-offline');
        if (modal) modal.style.display = 'flex';
      };
    }
  });
  // Fallback direct register if DOMContentLoaded has already fired
  setTimeout(() => {
    updateOfflineStatusIndicator();
    initSidebarHoverTrigger();
    const indicator = $('#btn-offline-status');
    if (indicator) {
      indicator.onclick = () => {
        const modal = $('#modal-offline');
        if (modal) modal.style.display = 'flex';
      };
    }
  }, 1000);


  // Start auth flow asynchronously (non-blocking)
  (async () => { await runAuthFlow(); })();

  // ---------- END AUTH / PROFILE FLOW ----------

  // Global devtools shortcut (Ctrl/Cmd + Shift + I)
  window.addEventListener('keydown', (e) => {
    try {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key || '').toLowerCase() === 'i') {
        if (window.api && window.api.openDevTools) window.api.openDevTools();
      }
    } catch (err) { }
  });

  // When true, `switchView` will NOT call `engine.stop()` when leaving the player view.
  // Used when minimizing to mini-player so the playback engine keeps running.
  // Moved here to prevent hoisting errors
  // Track if we are editing a profile
  // Visualizer state
  // The actual playback URL (differs from item.path for torrent streams)

  // 'downloads', 'movies', 'series', 'music', 'custom'
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  // Current subdirectory in Subtitle Center
  // Current subdirectory in Player Sidebar
  window.activeDragData = null; // Global fallback for DND
  window.$ = $; window.$$ = $$;
  function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function formatTime(s) { if (!s || isNaN(s)) return '0:00'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60); return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; }
  function srtToVtt(srt) { return 'WEBVTT\n\n' + srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); }

  function assToVtt(ass) {
    const lines = ass.split(/\r?\n/);
    let vtt = 'WEBVTT\n\n';
    let format = null;
    let eventsSection = false;

    const formatTime = (str) => {
      const p = str.replace('.', ':').split(':');
      const h = p[0].padStart(2, '0'), m = p[1].padStart(2, '0'), s = p[2].padStart(2, '0'), ms = (p[3] || '0').padEnd(3, '0').slice(0, 3);
      return `${h}:${m}:${s}.${ms}`;
    };

    for (let line of lines) {
      line = line.trim();
      if (line.match(/^\[Events\]/i)) { eventsSection = true; continue; }
      if (line.startsWith('Format:') && eventsSection) {
        format = line.substring(7).split(',').map(s => s.trim());
        continue;
      }
      if (line.startsWith('Dialogue:') && eventsSection && format) {
        const parts = line.substring(9).split(',');
        const fields = {};
        format.forEach((k, i) => fields[k] = (i === format.length - 1) ? parts.slice(i).join(',') : parts[i]);

        if (fields.Start && fields.End) {
          // Robust tag stripping: removes {\...} and handles \N / \n line breaks
          let text = (fields.Text || '')
            .replace(/\{.*?\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim();

          if (text) {
            vtt += `${formatTime(fields.Start)} --> ${formatTime(fields.End)}\n${text}\n\n`;
          }
        }
      }
    }
    return vtt;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PlayerEngine — Internal HTML5 Video Player
  // ═══════════════════════════════════════════════════════════════════════════
    class PlayerEngine {
    constructor(videoElement) {
      this._video = videoElement;
      this._listeners = {};
      this._currentTime = 0;
      this._duration = 0;
      this._paused = true;
      this._volume = 100;
      this._muted = false;
      this._loadId = 0;
      this._initialized = false;
      this._url = null;

      this._onLoadedListener = null;
      this._onErrorListener = null;
      this._shakaPlayer = null;

      this._initPromise = this.init();
    }

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }
    off(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
    _emit(event, ...args) {
      (this._listeners[event] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error('[Engine]', e); } });
    }

    get currentTime() { return this._currentTime; }
    get duration() { return this._duration; }
    get paused() { return this._paused; }
    get volume() { return this._volume / 100; }
    get muted() { return this._muted; }
    get tracks() {
      if (this._shakaPlayer) {
        const trks = this._shakaPlayer.getVariantTracks() || [];
        const subTrks = this._shakaPlayer.getTextTracks() || [];
        return {
          audio: trks.filter(t => t.type === 'variant'),
          video: trks.filter(t => t.type === 'variant'),
          subtitle: subTrks
        };
      }
      return { audio: [], video: [], subtitle: [] };
    }
    get isUsingMpv() { return false; }
    get url() { return this._url; }

    async init() {
      if (!this._video) return false;

      if (window.shaka) {
        shaka.polyfill.installAll();
        if (shaka.Player.isBrowserSupported()) {
          this._shakaPlayer = new shaka.Player();
          await this._shakaPlayer.attach(this._video);
          this._shakaPlayer.addEventListener('error', (event) => {
             console.error('[Engine] Shaka Error', event.detail);
          });
        }
      }

      this._initialized = true;

      this._video.addEventListener('loadedmetadata', () => {
        const isTranscoding = this._video && this._video.src && this._video.src.includes('transcode=true');
        if (!isTranscoding) {
          this._duration = this._video.duration || this._duration;
        }
        this._emit('durationchange', this._duration);
      });

      this._video.addEventListener('timeupdate', () => {
        this._currentTime = this._video.currentTime || 0;
        this._emit('timeupdate', this._currentTime);
      });

      this._video.addEventListener('play', () => {
        this._paused = false;
        this._emit('pausechange', false);
      });

      this._video.addEventListener('pause', () => {
        this._paused = true;
        this._emit('pausechange', true);
      });

      // Forward the native 'ended' event so series auto-next / exit-on-end work.
      this._video.addEventListener('ended', () => {
        this._paused = true;
        this._emit('ended');
      });

      return true;
    }

    _cleanupListeners() {
      if (this._onLoadedListener) {
        this._video.removeEventListener('loadedmetadata', this._onLoadedListener);
        this._onLoadedListener = null;
      }
      if (this._onErrorListener) {
        this._video.removeEventListener('error', this._onErrorListener);
        this._onErrorListener = null;
      }
    }

    async load(filePath, options = {}) {
      const currentLoadId = ++this._loadId;
      console.log(`[Engine] Loading Media [ID:${currentLoadId}]:`, filePath);

      if (!filePath) {
        console.error('[Engine] Cannot load media: filePath is undefined', { options, currentLoadId });
        return false;
      }

      await this._initPromise;

      let url = filePath;
      const isHttp = /^https?:/i.test(filePath);
      const isMobile = !!window.Capacitor;

      if (!isHttp) {
        if (isMobile) {
          url = window.Capacitor.convertFileSrc(filePath);
        } else if (window.api && window.api.isElectron) {
          url = typeof toMediaPlayUrl === 'function' ? toMediaPlayUrl(filePath) : filePath;
        }
      }

      this._url = url;
      this._cleanupListeners();

      try {
        this._video.pause();
        if (this._shakaPlayer) await this._shakaPlayer.unload();
        this._video.src = '';
      } catch (e) {
        console.warn('[Engine] Failed to reset video element before load:', e.message);
      }

      this._paused = true;
      if (options.duration) {
        this._duration = options.duration;
        this._emit('durationchange', this._duration);
      }

      const loadResult = await new Promise((resolve) => {
        const finalizeLoad = async () => {
          if (this._loadId !== currentLoadId) return resolve(false);

          if (options.startTime > 2) {
            try {
              this._video.currentTime = Math.min(options.startTime, this._video.duration || options.startTime);
            } catch (e) {
              console.warn('[Engine] Could not set start time before metadata:', e.message);
            }
          }

          this._duration = this._video.duration || this._duration;
          this._emit('durationchange', this._duration);

          if (options.paused) {
            this._paused = true;
            return resolve(true);
          }

          try {
            await this._video.play();
            if (this._loadId !== currentLoadId) return resolve(false);
            this._paused = false;
            resolve(true);
          } catch (err) {
            console.warn('[Engine] HTML5 playback failed:', err.message);
            this._paused = true;
            resolve(false);
          }
        };

        this._onLoadedListener = () => {
          this._cleanupListeners();
          finalizeLoad();
        };

        this._onErrorListener = () => {
          this._cleanupListeners();
          if (this._loadId !== currentLoadId) return resolve(false);
          console.error('[Engine] Video load error for URL:', url);
          resolve(false);
        };

        this._video.addEventListener('loadedmetadata', this._onLoadedListener);
        this._video.addEventListener('error', this._onErrorListener);

        // Always try Shaka Player first for DASH/HLS manifests
        const isDashOrHls = url.includes('.mpd') || url.includes('.m3u8') || url.includes('manifest');
        if (this._shakaPlayer && isDashOrHls) {
          this._shakaPlayer.load(url).catch(async (e) => {
            console.error('[Engine] Shaka Load Error:', e);
            // Fallback to HTML5 video if Shaka fails
            if (this._video.readyState < 2) {
              try {
                if (this._shakaPlayer) await this._shakaPlayer.unload();
              } catch (err) {}
              this._video.src = url;
            }
          });
        } else {
          // Bypassing Shaka Player for progressive MKV/MP4 files or local streams
          this._video.src = url;
        }

        if (this._video.readyState >= 2) {
          this._onLoadedListener();
        }
      });

      return loadResult;
    }

    async play() {
      try { await this._video.play(); } catch (e) { console.error('[Engine] Play failed:', e.message); }
    }

    async pause() {
      try { this._video.pause(); } catch (e) { console.error('[Engine] Pause failed:', e.message); }
    }

    async togglePause() {
      this._paused ? this.play() : this.pause();
    }

    async seek(timeSeconds) {
      try {
        if (!isNaN(timeSeconds) && this._duration > 0) {
          const targetTime = Math.max(0, Math.min(timeSeconds, this._duration));
          const isTranscoding = this._video && this._video.src && this._video.src.includes('transcode=true');
          
          if (isTranscoding) {
            const urlObj = new URL(this._video.src);
            urlObj.searchParams.set('start', targetTime.toString());
            this._video.src = urlObj.toString();
            this._video.play().catch(() => {});
          } else {
            this._video.currentTime = targetTime;
          }
          this._currentTime = targetTime;
          this._emit('timeupdate', this._currentTime);
        }
      } catch (e) { console.error('[Engine] Seek failed:', e.message); }
    }

    async seekRelative(seconds) {
      await this.seek(this._currentTime + seconds);
    }

    async setVolume(level) {
      try {
        this._volume = Math.max(0, Math.min(100, level));
        this._video.volume = this._volume / 100;
      } catch (e) { console.error('[Engine] Set volume failed:', e.message); }
    }

    async setMute(muted) {
      try {
        this._muted = Boolean(muted);
        this._video.muted = this._muted;
      } catch (e) { console.error('[Engine] Set mute failed:', e.message); }
    }

    async setAudioTrack(trackId) {
      if (this._shakaPlayer) {
        const tracks = this._shakaPlayer.getVariantTracks();
        const t = tracks.find(x => x.id === trackId || x.language === trackId);
        if (t) this._shakaPlayer.selectVariantTrack(t, true);
      }
    }

    async setSubtitleTrack(trackId) {
      if (this._shakaPlayer) {
        const tracks = this._shakaPlayer.getTextTracks();
        const t = tracks.find(x => x.id === trackId || x.language === trackId);
        if (t) {
            this._shakaPlayer.selectTextTrack(t);
            this._shakaPlayer.setTextTrackVisibility(true);
        } else {
            this._shakaPlayer.setTextTrackVisibility(false);
        }
      }
    }

    async addSubtitle(subPath) {
      if (this._shakaPlayer) {
         try {
             await this._shakaPlayer.addTextTrackAsync(subPath, 'en', 'subtitles', 'text/vtt');
         } catch(e) {
             console.error('[Engine] addSubtitle failed', e);
         }
      }
    }

    async setSubDelay(delaySec) {
      subSyncOffset = delaySec;
      updateSubSyncDisplay();
      if (this._video) {
        this._video.dispatchEvent(new Event('timeupdate'));
      }
    }
    async setSubFontSize(size) {
      const slider = $('#sub-style-size');
      if (slider) {
        slider.value = size;
        applySubtitleStyles();
      }
    }

    async stop() {
      try {
        this._loadId++;
        this._cleanupListeners();
        this._video.pause();
        if (this._shakaPlayer) await this._shakaPlayer.unload();
        this._video.src = '';
        this._currentTime = 0;
        this._duration = 0;
        this._paused = true;
      } catch (e) {
        console.error('[Engine] Stop failed:', e.message);
      }
    }

    async getAccurateTime() {
      return this._video ? (this._video.currentTime || 0) : this._currentTime;
    }

    async getAccurateDuration() {
      const isTranscoding = this._video && this._video.src && this._video.src.includes('transcode=true');
      if (isTranscoding && this._duration > 0) return this._duration;
      return this._video ? (this._video.duration || this._duration || 0) : this._duration || 0;
    }
  }

  engine = new PlayerEngine(document.getElementById('video-element'));

  window.positionContextMenu = function(e) {
    const cm = $('#context-menu');
    if (!cm) return;
    cm.style.display = 'block';
    const menuWidth = cm.offsetWidth || 200;
    const menuHeight = cm.offsetHeight || 300;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth) {
      left = window.innerWidth - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight) {
      top = window.innerHeight - menuHeight - 10;
    }
    if (left < 0) left = 10;
    if (top < 0) top = 10;
    cm.style.left = left + 'px';
    cm.style.top = top + 'px';
  };

  window.hideContextMenu = function() {
    const cm = $('#context-menu');
    if (cm) cm.style.display = 'none';
  };

  // Capture phase listener to reliably dismiss context menu on any pointer click outside
  window.addEventListener('pointerdown', e => {
    const cm = $('#context-menu');
    if (cm && cm.style.display !== 'none' && !cm.contains(e.target)) {
      cm.style.display = 'none';
    }
  }, true);

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      window.hideContextMenu();
    }
  });

  window.addEventListener('contextmenu', e => {
    const isCard = e.target.closest('.media-card, .card, .season-episode-item, .collection-card, .ctx-item, #context-menu');
    if (isCard) return;

    const activeDetailItem = window.currentUnifiedDetailItem || currentShow;
    if ((currentView === 'show-detail' || currentView === 'discover-detail') && activeDetailItem) {
      e.preventDefault();
      window.openContextMenuForItem(activeDetailItem, e);
      return;
    }

    e.preventDefault();
    window.hideContextMenu();
  }, false);

  window.openContextMenuForItem = function(item, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    contextTarget = item;
    if (!item) return;

    const cm = $('#context-menu');
    if (!cm) return;

    // Reset ALL menu buttons and dividers to hidden first using setProperty to override any inline styles
    cm.querySelectorAll('.ctx-item').forEach(el => el.style.setProperty('display', 'none', 'important'));
    cm.querySelectorAll('.ctx-divider').forEach(el => el.style.setProperty('display', 'none', 'important'));

    const isCustomList = !!(item.isCustomList);
    if (isCustomList) {
      const deleteBtn = $('#ctx-delete');
      if (deleteBtn) {
        deleteBtn.style.setProperty('display', 'flex', 'important');
        const deleteLabel = $('#ctx-delete-label');
        if (deleteLabel) deleteLabel.textContent = 'Delete Collection';
      }
      if (e) window.positionContextMenu(e);
      return;
    }

    const isShow = item.type === 'show' || item.type === 'series' || item.type === 'tv' || item.media_type === 'tv' || !!(item.episodes);
    const isMovie = item.type === 'movie' || item.media_type === 'movie';
    const isMovieOrShow = isMovie || isShow;
    const isMusic = !isMovieOrShow && (item.type === 'music' || item.isMusic === true || !!(item.audioUrl));
    const isRadio = item.type === 'radio' || !!(item.radioUrl);
    const isIptv = item.type === 'iptv' || !!(item.streamUrl && !item.path);
    const isLive = isRadio || isIptv;
    const isLocalVideo = (item.isLocal || (item.path && !item.path.startsWith('http') && !item.path.startsWith('tmdb:') && !item.path.startsWith('stremio:'))) && !isMovieOrShow && !isLive && !isMusic;
    const isOnlineMedia = !isLocalVideo && !isLive && !isMusic;

    // Pin & Lock Labels
    const pl = $('#ctx-pin-label');
    if (pl) pl.textContent = (currentProfile?.pinned || []).includes(item.id) ? 'Unpin' : 'Pin';
    const ll = $('#ctx-lock-label');
    if (ll) ll.textContent = (currentProfile?.lockedItems || []).includes(item.id) ? 'Unlock Item' : 'Lock Item';

    // Group 1: Play & Pin
    let showDiv1 = false;
    if ($('#ctx-play')) { $('#ctx-play').style.setProperty('display', 'flex', 'important'); showDiv1 = true; }
    if ($('#ctx-pin')) { $('#ctx-pin').style.setProperty('display', 'flex', 'important'); showDiv1 = true; }

    // Group 2: Metadata / Customization
    let showDiv2 = false;
    if (isMusic) {
      // STRICTLY MUSIC ONLY!
      if ($('#ctx-edit-music')) { $('#ctx-edit-music').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
      if ($('#ctx-delete-music')) { $('#ctx-delete-music').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
    } else {
      // MOVIES & SERIES & VIDEOS (NEVER MUSIC!)
      if ($('#ctx-tmdb-search') && (isLocalVideo || (isOnlineMedia && !isLive))) { $('#ctx-tmdb-search').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
      if ($('#ctx-cover') && isLocalVideo) { $('#ctx-cover').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
      if ($('#ctx-rename') && isLocalVideo) { $('#ctx-rename').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
      if ($('#ctx-rename-tmdb') && isLocalVideo && (item.tmdbId || item.id || item._tmdbName)) { $('#ctx-rename-tmdb').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
      if ($('#ctx-regen-thumb') && isLocalVideo) { $('#ctx-regen-thumb').style.setProperty('display', 'flex', 'important'); showDiv2 = true; }
    }

    // Group 3: Progress & Removal
    let showDiv3 = false;
    const watchedBtn = $('#ctx-watched');
    if (watchedBtn && (isLocalVideo || isOnlineMedia || isShow) && !isLive && !isMusic) {
      watchedBtn.style.display = 'flex';
      showDiv3 = true;
      const wl = $('#ctx-watched-label');
      if (wl) {
        const pbKey = getPlaybackKey(item);
        const isW = currentProfile?.playback?.[pbKey]?.watched || (currentProfile?.playback?.[pbKey]?.duration > 0 && (currentProfile.playback[pbKey].time / currentProfile.playback[pbKey].duration) > .9);
        wl.textContent = isW ? 'Remove from Watched' : 'Mark as Watched';
      }
    }

    const canDelete = isLocalVideo || ['watchlist', 'custom-list-detail'].includes(currentView);
    if ($('#ctx-delete') && canDelete && !isMusic) {
      $('#ctx-delete').style.display = 'flex';
      showDiv3 = true;
      const deleteLabel = $('#ctx-delete-label');
      if (deleteLabel) {
        if (currentView === 'custom-list-detail') {
          deleteLabel.textContent = 'Remove from Collection';
        } else if (currentView === 'watchlist') {
          deleteLabel.textContent = 'Remove from Watchlist';
        } else {
          deleteLabel.textContent = 'Delete File';
        }
      }
    }

    // Group 4: Security
    if ($('#ctx-lock')) $('#ctx-lock').style.display = 'flex';

    // Set Dividers
    if ($('#ctx-div-1')) $('#ctx-div-1').style.display = (showDiv1 && showDiv2) ? 'block' : 'none';
    if ($('#ctx-div-2')) $('#ctx-div-2').style.display = (showDiv2 && showDiv3) ? 'block' : 'none';
    if ($('#ctx-div-3')) $('#ctx-div-3').style.display = 'block';

    if (e) window.positionContextMenu(e);
  };

  // ── Toast Queue System ──────────────────────────────────────────────────
  // Each showToast() call is enqueued. Toasts fire one at a time, each for
  // its full requested duration before the next one dequeues.
  const _toastQueue = [];
  let _toastBusy = false;

  function _processToastQueue() {
    if (_toastBusy || _toastQueue.length === 0) return;
    _toastBusy = true;
    const { msg, duration } = _toastQueue.shift();

    const toast = $('#update-toast');
    const title = $('#update-toast-title');
    const desc = $('#update-toast-desc');
    const iconContainer = $('#update-toast-icon');
    const actionBtn = $('#update-btn-action');
    const closeBtn = $('#update-btn-close');
    const progressRow = $('#update-progress-row');

    if (!toast || !desc) { _toastBusy = false; _processToastQueue(); return; }

    // Reset components to generic state
    if (progressRow) progressRow.style.display = 'none';
    if (actionBtn) actionBtn.style.display = 'none';

    const _advanceQueue = () => {
      toast.classList.remove('active');
      _toastBusy = false;
      // Small gap between toasts for visual clarity
      setTimeout(_processToastQueue, 360);
    };

    if (closeBtn) {
      closeBtn.style.display = 'block';
      closeBtn.onclick = _advanceQueue;
    }
    const xBtn = $('#update-toast-close');
    if (xBtn) {
      xBtn.onclick = (e) => { e.stopPropagation(); _advanceQueue(); };
    }

    // Determine Type & Icon
    let icon = 'fa-info-circle';
    let label = 'Notification';

    if (msg.includes('✓') || msg.includes('Success') || msg.includes('Complete') || msg.includes('Done')) {
      icon = 'fa-check-circle';
      label = 'Success';
    } else if (msg.includes('Error') || msg.includes('Failed') || msg.includes('❌') || msg.includes('Incorrect')) {
      icon = 'fa-exclamation-circle';
      label = 'Error';
    } else if (msg.includes('⚠️') || msg.includes('Note') || msg.includes('Warning')) {
      icon = 'fa-triangle-exclamation';
      label = 'Warning';
    } else if (msg.includes('الترفيه متعة')) {
      icon = 'fa-heart-pulse';
      label = 'MEEM';
    }

    if (title) title.textContent = label;
    if (iconContainer) iconContainer.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    const cleanedMsg = msg.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d✅❌⚠️✓]/gu, '').trim();
    desc.textContent = cleanedMsg;

    // NOTE: Toasts are NOT logged to the Notification Center to avoid spam.
    // Only meaningful events (invitations, friend messages, downloads) add notifications.

    toast.classList.add('active');

    if (duration > 0) {
      setTimeout(_advanceQueue, duration);
    }
    // If duration <= 0, toast stays until user manually closes it
  }

  window.showToast = function (msg, duration = 3200) {
    if (isNativePlayerWindow()) return;
    _toastQueue.push({ msg, duration });
    _processToastQueue();
  };

  let persistTimeout = null;
  let _lastPersistState = '';
  async function persist(forceImmediate = false) {
    // Optimization: Skip if state hasn't changed to prevent IPC spam
    const currentState = JSON.stringify(appData);
    if (currentState === _lastPersistState) return;
    _lastPersistState = currentState;

    if (persistTimeout) clearTimeout(persistTimeout);

    const performSave = async () => {
      let retries = 3;
      while (retries > 0) {
        try {
          let session = null;
          let isOfflineMode = false;
          try {
            const client = getSupabaseRendererClient();
            const { data: sessionData } = await client.auth.getSession();
            if (sessionData && sessionData.session) {
              session = {
                access_token: sessionData.session.access_token,
                refresh_token: sessionData.session.refresh_token
              };
            } else {
              isOfflineMode = true;
            }
          } catch (e) {
            isOfflineMode = true;
            console.debug('[PERSIST] Offline mode detected:', e.message);
          }
          
          // Ensure all profiles have custom_lists for offline persistence
          if (appData.profiles && Array.isArray(appData.profiles)) {
            appData.profiles.forEach(p => {
              if (!p.custom_lists) p.custom_lists = [];
            });
          }
          
          let activeListName = null;
          if (typeof activeCustomListId !== 'undefined' && activeCustomListId && typeof currentProfile !== 'undefined' && currentProfile) {
            const activeList = currentProfile.custom_lists?.find(l => l.id === activeCustomListId);
            if (activeList) {
              activeListName = activeList.name;
            }
          }

          const result = await window.api.saveData({
            appData,
            session
          });

          if (!result) {
            throw new Error('Save returned empty result');
          }

          if (typeof result === 'object' && result.profiles) {
            // Verify custom_lists are present in returned profiles
            if (result.profiles && Array.isArray(result.profiles)) {
              result.profiles.forEach(p => {
                if (!p.custom_lists) p.custom_lists = [];
              });
            }
            appData.profiles = result.profiles;
            window.appData.profiles = result.profiles;
            if (typeof currentProfile !== 'undefined' && currentProfile) {
              const matched = result.profiles.find(p => p.id === currentProfile.id);
              if (matched) {
                currentProfile = matched;
                window.currentProfile = matched;
              }
            }
            if (activeListName && typeof currentProfile !== 'undefined' && currentProfile && currentProfile.custom_lists) {
              const updatedList = currentProfile.custom_lists.find(l => l.name.toLowerCase() === activeListName.toLowerCase());
              if (updatedList && updatedList.id !== activeCustomListId) {
                console.log(`[PERSIST] Updating activeCustomListId from ${activeCustomListId} to synced UUID: ${updatedList.id}`);
                activeCustomListId = updatedList.id;
              }
            }
          }
          if (isOfflineMode) {
            console.debug('[PERSIST] Data saved successfully in offline mode');
          }
          return;
        } catch (err) {
          retries--;
          console.error(`[PERSIST] Save failed (${retries} retries left):`, err.message);
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      console.error('[PERSIST] All save attempts failed');
      showToast('⚠️ Warning: Data may not be saved.');
    };

    if (forceImmediate) {
      await performSave();
    } else {
      persistTimeout = setTimeout(performSave, 500); // 500ms debounce
    }
  }

  // Export persist to global scope for modules
  window.persistImpl = persist;
  window.persist = persist;
  window.persistReady = true;

  // Update the Dashboard Hero name too if in library view
  if (name === 'library' && msTitle) msTitle.textContent = currentProfile?.name || 'User';



  engine.on('pausechange', (paused) => {
    if (!paused) {
      const btnPlayPause = $('#mp-btn-play-pause');
      const infoClick = $('#mp-info-click');

      if (btnPlayPause) btnPlayPause.style.display = 'flex';
      if (infoClick) infoClick.style.cursor = 'pointer';
    }
  });


  function deepMerge(t, s) { if (!s || typeof s !== 'object') return t; const o = { ...t }; for (const k of Object.keys(s)) { o[k] = s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? deepMerge(o[k] || {}, s[k]) : s[k]; } return o; }
  

  // ensureDefaultAddons is defined in state.js and exposed as window.ensureDefaultAddons.
  // MediaVault is a neutral player — no addons are injected here by default.

  function allItems() { const shows = appData.shows || []; return [...(appData.movies || []), ...shows, ...shows.flatMap(s => s.episodes || [])]; }
  function isLocked(id) { return !isVaultUnlocked && (currentProfile?.lockedItems || []).includes(id); }

  // ── Profile Logic ──
  function closeProfilePickerOverlay() {
    const picker = $('#profile-picker');
    if (picker) {
      picker.style.display = 'none';
      picker.classList.remove('modal-active');
    }
    try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
    window.isTransitioningAway = false;
  }

  function applyProfilePickerBackdrop(url) {
    const picker = $('#profile-picker');
    if (!picker) return;
    if (url) {
      const imgUrl = localImg(url);
      const bg = `linear-gradient(to bottom, rgba(5,5,8,0.35) 0%, rgba(5,5,8,0.75) 60%, rgba(5,5,8,0.97) 100%), url('${imgUrl}')`;
      picker.style.setProperty('background-image', bg, 'important');
      picker.style.setProperty('background-size', 'cover', 'important');
      picker.style.setProperty('background-position', 'center top', 'important');
      picker.style.setProperty('background-repeat', 'no-repeat', 'important');
      picker.style.setProperty('background-color', '#050508', 'important');
    } else {
      picker.style.removeProperty('background-image');
      picker.style.removeProperty('background-size');
      picker.style.removeProperty('background-position');
      picker.style.removeProperty('background-repeat');
      picker.style.removeProperty('background-color');
    }
  }

  function selectProfile(id, skipAnimation = false) {
    const profile = appData.profiles.find(p => p.id === id);
    if (!profile) {

      return;
    }

    // Immediately apply selected banner (or global fallback)
    const selBanner = profile.banner || appData.globalBanner || null;
    applyProfilePickerBackdrop(selBanner);

    window.isTransitioningAway = true; // Trigger instant hide
    const editContainer = $('#edit-profiles-container');
    if (editContainer) {
      editContainer.style.opacity = '0';
      editContainer.style.pointerEvents = 'none';
      editContainer.style.display = 'none';
    }

    const picker = $('#profile-picker');
    const header = picker ? picker.querySelector('h1') : null;
    const allCards = $$('#profile-list .profile-card');

    if (!skipAnimation) {
      // Animate: scale up the selected card, fade out others
      if (header) {
        header.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        header.style.opacity = '0';
        header.style.transform = 'translateY(-20px)';
      }

      allCards.forEach(card => {
        if (card.dataset.profileId === id) {
          card.classList.add('selected');
          const cardRect = card.getBoundingClientRect();
          const pickerRect = picker.getBoundingClientRect();
          const deltaX = (pickerRect.width / 2) - (cardRect.left + cardRect.width / 2);
          const deltaY = (pickerRect.height / 2) - (cardRect.top + cardRect.height / 2);

          card.style.transition = 'all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';
          card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.5)`;
          const name = card.querySelector('span');
          if (name) name.style.opacity = '0';
          const actions = card.querySelector('.profile-actions');
          if (actions) actions.style.display = 'none';
          const ageBadge = card.querySelector('.profile-age-badge');
          if (ageBadge) ageBadge.style.display = 'none';
        } else {
          card.style.transition = 'all 0.5s ease';
          card.classList.add('fade-out');
          card.style.opacity = '0';
          card.style.transform = 'scale(0.8) blur(5px)';
        }
      });
    }

    const performSelection = async () => {
      try {
        window.isEditingProfiles = false;
        const toggleBtn = $('#btn-toggle-edit-profiles');
        if (toggleBtn) {
          const label = toggleBtn.querySelector('.btn-label');
          const icon = toggleBtn.querySelector('i');
          if (label) label.textContent = 'Edit Profiles';
          else toggleBtn.textContent = 'Edit Profiles';
          if (icon) icon.className = 'fas fa-user-edit';
          toggleBtn.classList.remove('editing-active');
          toggleBtn.style.background = '';
        }
        appData.activeProfileId = id;
        currentProfile = profile;
        window.currentProfile = profile;
        isVaultUnlocked = false;
        updateVaultUI();
        
        // Hydrate playback (Continue Watching) from Cloud
        if (window.api && window.api.getProfilePlayback) {
          try {
            const pbData = await window.api.getProfilePlayback(profile.id);
            if (pbData) {
              currentProfile.playback = currentProfile.playback || {};
              for (const k in pbData) {
                currentProfile.playback[k] = {
                  ...currentProfile.playback[k],
                  ...pbData[k]
                };
              }
            }
          } catch (e) {
            console.warn('[PROFILES] Failed to hydrate playback from cloud:', e);
          }
        }

        closeProfilePickerOverlay();

        if (!skipAnimation) {
          setTimeout(() => {
            if (header) {
              header.style.opacity = '';
              header.style.transform = '';
            }
            allCards.forEach(c => {
              c.classList.remove('selected', 'fade-out');
              c.style.transform = '';
              c.style.opacity = '';
              const name = c.querySelector('span');
              if (name) name.style.opacity = '';
              const actions = c.querySelector('.profile-actions');
              if (actions) actions.style.display = 'none';
            });
          }, 400);
        }

        renderProfileWidget();

        // Block app if subscription expired (post-profile-selection check)
        if (checkSubscriptionStatus()) return;

        if (isChatWindow()) {
          const listId = new URLSearchParams(window.location.search).get('listId');
          if (typeof window.subscribeToListChat === 'function') {
            window.subscribeToListChat(listId);
          }
          if (typeof window.toggleVaultChat === 'function') {
            window.toggleVaultChat(true);
          }
          if (window.hideSplash) window.hideSplash();
          return;
        }

        await scanLibrary();

        renderLibrary(); renderSidebar(); renderDownloadHistory(); renderSocial();
        if (currentView !== 'player') {
          switchView('discover');
          renderContinueWatchingDiscover();
        }

        // Hide splash screen now that everything is rendered and loaded
        if (window.hideSplash) window.hideSplash();

        initStremioAddonsUI();
        if (typeof initGlobalNotifications === 'function') {
          initGlobalNotifications();
        }
        if (typeof initSubdlUI === 'function') {
          initSubdlUI();
        }
        if (typeof initTraktUI === 'function') {
          initTraktUI().then(() => {
            syncTraktWatchlistToLocal();
            syncTraktContinueWatching();
          });
        }

      } catch (err) {
        console.error('[PROFILES] selectProfile failed:', err);
        closeProfilePickerOverlay();

        showToast('Could not load profile: ' + (err.message || 'unknown error'));
        if (window.hideSplash) window.hideSplash();
      }
    };

    if (skipAnimation) {
      performSelection();
    } else {
      // Wait for the animation to finish, then load the profile
      setTimeout(performSelection, 1200);
    }
  }

  // --- Mobile Onboarding ---
  function showMobileOnboarding() {
    if (window.api?.isElectron) return;

    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.style = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);padding:20px;text-align:center;color:#fff;';

    overlay.innerHTML = `
      <div style="max-width:400px; background: rgba(30,30,45,0.95); padding: 30px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
        <div style="font-size:60px;margin-bottom:20px;">🚀</div>
        <h2 style="font-size:24px;margin-bottom:15px;font-weight:800;">Welcome to MediaVault</h2>
        <p style="opacity:0.7;line-height:1.6;margin-bottom:25px;">Ready to build your cinematic library? Let's name your mobile storage folder.</p>
        
        <div style="text-align:left; margin-bottom: 25px;">
           <label style="font-size:12px; opacity:0.5; margin-bottom:8px; display:block;">Library Name</label>
           <input id="mobile-root-input" type="text" value="MediaVault" style="width:100%; height:50px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:15px; color:#fff; padding:0 15px; font-weight:600;">
           <p style="font-size:11px; opacity:0.4; margin-top:8px;">Note: On mobile, files are saved to your system Downloads under this folder name.</p>
        </div>

        <button id="btn-mobile-start" class="btn-primary" style="width:100%;height:50px;border-radius:15px;font-weight:700;">Start Building</button>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#btn-mobile-start').onclick = async () => {
      const btn = overlay.querySelector('#btn-mobile-start');
      btn.textContent = 'Requesting Permission...';
      btn.disabled = true;

      try {
        const hasPerms = await window.api.invoke('request-filesystem-permissions');
        if (!hasPerms) {
          showToast('Storage permission is required for MediaVault to work.');
          btn.textContent = 'Retry Permissions';
          btn.disabled = false;
          return;
        }

        const rootName = overlay.querySelector('#mobile-root-input')?.value || 'MEEM';
        appData.mobileRoot = rootName;
        appData.firstRun = false;
        persist();
        overlay.remove();
        showToast('Library ready: ' + rootName);
      } catch (err) {
        console.error('[Onboarding] Permission error:', err);
        showToast('Failed to request permissions.');
        btn.textContent = 'Start Building';
        btn.disabled = false;
      }
    };
  }

  // --- Factory Reset Logic ---
  const btnFactoryReset = $('#btn-factory-reset');
  if (btnFactoryReset) {
    btnFactoryReset.onclick = () => {
      if (!confirm('⚠️ CRITICAL: This will delete ALL your data, profiles, and settings. Are you absolutely sure?')) return;

      if (window.api?.isElectron) {
        window.api.invoke('factory-reset').then(() => window.location.reload());
      } else {
        localStorage.clear();
        window.location.reload();
      }
    };
  }


  if (appData.firstRun) {
    appData.firstRun = false;
    persist();
  }

  // Helper to compress images for Web/Android LocalStorage
  function compressImageFile(file, maxWidth) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function openProfileModal(id = null) {
    editingProfileId = id;
    const profile = id ? appData.profiles.find(p => p.id === id) : null;

    const modalTitle = $('#inline-profile-title') || $('#profile-modal h2');
    const confirmBtn = $('#profile-confirm');
    const nameInput = $('#profile-name-input');

    if (modalTitle) modalTitle.textContent = id ? 'Edit Profile' : 'Create Profile';
    if (confirmBtn) confirmBtn.textContent = id ? 'Save Changes' : 'Create';
    if (nameInput) nameInput.value = profile ? profile.name : '';

    const ageInput = $('#profile-age-input');
    if (ageInput) {
      ageInput.value = (profile && typeof profile.max_age_rating !== 'undefined') ? profile.max_age_rating : '18';
    }

    selectedAvatar = profile ? profile.avatar : AVATARS[0];

    const picker = $('#profile-picker');
    if (picker) {
      picker.style.display = 'flex';
      picker.classList.add('modal-active');
      try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
    }
    const modal = $('#profile-editor-inline');
    if (modal) {
      $('#profile-picker-main').style.display = 'none';
      modal.style.display = 'flex';
    }
    const selector = $('#avatar-selector');
    if (!selector) {

      return;
    }

    selector.innerHTML = '';

    // Add default avatars
    AVATARS.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'avatar-opt' + (url === selectedAvatar ? ' selected' : '');
      img.style.borderRadius = '50%';
      img.style.objectFit = 'cover';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = url;
        const targetId = editingProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
        if (prof) {
          prof.avatar = url;
          persist();
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };
      selector.appendChild(img);
    });

    // If selectedAvatar is a custom one (not in default list), show it too
    if (selectedAvatar && !AVATARS.includes(selectedAvatar)) {
      const img = document.createElement('img');
      img.src = localImg(selectedAvatar);
      img.className = 'avatar-opt selected';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = profile ? profile.avatar : selectedAvatar;
        const targetId = editingProfileId || (currentProfile ? currentProfile.id : null) || appData.activeProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : appData.profiles?.[0];
        if (prof) {
          prof.avatar = selectedAvatar;
          if (currentProfile && currentProfile.id === prof.id) {
            currentProfile.avatar = selectedAvatar;
          }
          persist(true);
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };
      selector.appendChild(img);
    }

    // RE-ADD the upload button
    const uploadBtn = document.createElement('div');
    uploadBtn.id = 'btn-upload-avatar';
    uploadBtn.className = 'avatar-opt upload-opt';
    uploadBtn.title = 'Upload Custom Avatar';
    uploadBtn.innerHTML = `
      <div class="upload-vibe">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>`;
    uploadBtn.onclick = async () => {
      let pathOrDataUrl = null;
      if (window.api?.isElectron) {
        try {
          pathOrDataUrl = await window.api.invoke('select-user-avatar');
        } catch (err) {
          console.error('[Avatar Upload Error]', err);
          showToast('Failed to select avatar.');
          return;
        }
      } else {
        pathOrDataUrl = await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) { resolve(null); return; }
            try {
              const dataUrl = await compressImageFile(file, 300);
              resolve(dataUrl);
            } catch (err) {
              console.error('[Avatar Upload Error]', err);
              showToast('Failed to process image.');
              resolve(null);
            }
          };
          input.click();
        });
      }

      if (!pathOrDataUrl) return;

      try {
        if (window.supabase) {
          showToast('Uploading avatar to cloud...', 'info');
          // Use the authenticated renderer client so RLS allows the upload
          const client = getSupabaseRendererClient();
          
          let blob;
          if (pathOrDataUrl.startsWith('data:')) {
            const res = await fetch(pathOrDataUrl);
            blob = await res.blob();
          } else {
            const res = await fetch(localImg(pathOrDataUrl));
            blob = await res.blob();
          }

          const fileName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
          
          const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
            cacheControl: '3600',
            upsert: false,
            contentType: blob.type || 'image/jpeg'
          });
          
          if (error) {
            console.error('Supabase upload error:', error);
            showToast('Cloud upload failed, using local copy.');
            setSelectedAvatar(pathOrDataUrl);
          } else {
            const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
            const publicUrl = publicUrlData.publicUrl;
            setSelectedAvatar(publicUrl);
            const targetId = editingProfileId || (currentProfile ? currentProfile.id : null) || appData.activeProfileId;
            const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : appData.profiles?.[0];
            if (prof) {
              prof.avatar = publicUrl;
              if (currentProfile && currentProfile.id === prof.id) {
                currentProfile.avatar = publicUrl;
              }
            }
            if (typeof renderProfileWidget === 'function') renderProfileWidget();
            if (typeof renderProfilePicker === 'function') renderProfilePicker();
            await persist(true);
            showToast('Avatar uploaded successfully!');
          }
        } else {
          setSelectedAvatar(pathOrDataUrl);
          showToast('Avatar saved locally!');
        }
      } catch (err) {
        console.error('[Avatar Upload Error]', err);
        showToast('Failed to upload avatar.');
        setSelectedAvatar(pathOrDataUrl);
      }
    };
    // Add "From Favorites" quick picker
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.id = 'btn-avatar-from-favs';
    favBtn.className = 'avatar-opt fav-opt';
    favBtn.title = 'Choose from favorites';
    favBtn.setAttribute('aria-label', 'Choose avatar from favorites');
    favBtn.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-size:12px;color:rgba(255,255,255,0.9)"><i class="fas fa-search" style="font-size:18px"></i><div style="font-size:10px;margin-top:4px">Browse</div></div>`;
    favBtn.onclick = () => openFavoritesAvatarModal('avatar');

    selector.appendChild(favBtn);
    selector.appendChild(uploadBtn);

    // Inline Editor is already shown, just focus the input
    if (nameInput) nameInput.focus();
  }

  if ($('#btn-add-profile')) $('#btn-add-profile').onclick = () => openProfileModal();

  // Favorites Avatar Picker: create modal and helpers (Cinematic UI)
  function createFavModal() {
    if ($('#fav-avatar-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'fav-avatar-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.style.zIndex = '2000020';
    modal.style.cssText += 'background: var(--bg-base) !important;';
    modal.innerHTML = `
      <div class="acoustic-waves-bg">
        <div class="wave wave1"></div>
        <div class="wave wave2"></div>
        <div class="wave wave3"></div>
      </div>
      <div class="modal-card tmdb-search-modal" style="width: 100%; height: 100%; max-width: none; background: transparent; border: none; box-shadow: none; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; z-index: 10;">
        <button class="modal-close-custom" id="fav-modal-close" style="position: fixed; top: 40px; left: 40px; width: 50px; height: 50px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 100; transition: all 0.3s;">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div class="search-container" style="width: 1000px; max-width: 90vw; text-align: center;">
          <h2 style="font-size: 3rem; font-weight: 800; color: #fff; margin-bottom: 40px; letter-spacing: -1.5px;">Choose Asset</h2>
          
          <div class="search-box" style="width: 100%; max-width: none; margin-bottom: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.15); border-radius: 30px; height: 90px; padding: 0 15px 0 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 15px;">
            <i class="fas fa-search" style="font-size: 30px; color: var(--accent); margin-right: 10px;"></i>
            <input type="text" id="fav-search-input" placeholder="Search movies, shows or anime..." style="font-size: 24px; font-weight: 700; flex: 1; background: transparent; border: none; outline: none; color: #fff;">
            
            <button id="btn-upload-custom-banner" style="display: none; align-items: center; gap: 8px; background: var(--accent); color: #000; border: none; border-radius: 20px; padding: 10px 20px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.3s; margin-right: 15px;">
              <i class="fas fa-upload"></i> Upload custom banner
            </button>

            <div id="fav-search-source" style="display: none;"></div>
          </div>

          <div id="fav-main-container" style="width: 100%; min-height: 500px; height: 60vh; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.15); border-radius: 30px; overflow: hidden; position: relative; display: flex; flex-direction: column;">
            <div id="fav-back-btn" style="display: none; align-items: center; gap: 10px; padding: 20px 30px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: background 0.3s; z-index: 10;">
              <i class="fas fa-arrow-left" style="color: var(--accent);"></i>
              <span style="font-weight: 700; font-size: 1.1rem;">Back to List</span>
            </div>
            <div id="fav-results-list" class="tmdb-result-grid" style="flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 30px; align-items: start;"></div>
            <div id="fav-media-grid" class="tmdb-result-grid" style="display: none; flex: 1; overflow: hidden; position: relative; width: 100%; height: 100%;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    $('#fav-modal-close').onclick = () => { 
      if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
      modal.style.display = 'none'; 
      modal.classList.remove('modal-active');
      try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
    };
    $('#fav-back-btn').onclick = () => {
      $('#fav-results-list').style.display = 'grid';
      $('#fav-media-grid').style.display = 'none';
      $('#fav-back-btn').style.display = 'none';
      // $('#fav-search-source').style.display = 'flex'; // Removed per user request to rely only on AniList
    };

    let searchTimeout = null;
    $('#fav-search-input').oninput = (e) => {
      clearTimeout(searchTimeout);
      const val = e.target.value;
      searchTimeout = setTimeout(() => {
        $('#fav-results-list').style.display = 'grid';
        $('#fav-media-grid').style.display = 'none';
        $('#fav-back-btn').style.display = 'none';
        populateFavResults(val);
      }, 500);
    };

    const uploadCustomBannerBtn = $('#btn-upload-custom-banner');
    if (uploadCustomBannerBtn) {
      uploadCustomBannerBtn.onclick = async () => {
        let pathOrDataUrl = null;
        if (window.api?.isElectron) {
          try {
            pathOrDataUrl = await window.api.invoke('select-user-banner');
          } catch (err) {
            console.error('[Banner Upload Error]', err);
            showToast('Failed to select banner.');
            return;
          }
        } else {
          pathOrDataUrl = await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
              const file = e.target.files?.[0];
              if (!file) { resolve(null); return; }
              try {
                const dataUrl = await compressImageFile(file, 1200);
                resolve(dataUrl);
              } catch (err) {
                console.error('[Banner Upload Error]', err);
                showToast('Failed to process image.');
                resolve(null);
              }
            };
            input.click();
          });
        }

        if (!pathOrDataUrl) return;

        try {
          if (window.supabase) {
            showToast('Uploading banner to cloud...', 'info');
            const client = getSupabaseRendererClient();
            
            let blob;
            if (pathOrDataUrl.startsWith('data:')) {
              const res = await fetch(pathOrDataUrl);
              blob = await res.blob();
            } else {
              const res = await fetch(localImg(pathOrDataUrl));
              blob = await res.blob();
            }

            const fileName = `banners/banner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
            
            const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
              cacheControl: '3600',
              upsert: false,
              contentType: blob.type || 'image/jpeg'
            });
            
            if (error) {
              console.error('Supabase upload error:', error);
              showToast('Cloud upload failed, using local copy.');
              setSelectedBanner(pathOrDataUrl);
            } else {
              const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
              const publicUrl = publicUrlData.publicUrl;
              let safePath = pathOrDataUrl.replace(/\\/g, "/");
              let localUrl;
              const hasSeparators = safePath.includes('/') || safePath.includes('\\');
              if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
                if (safePath.match(/^[a-zA-Z]:/)) {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else if (safePath.startsWith("/")) {
                  localUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
                } else {
                  localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                }
              } else {
                localUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
              }
              localStorage.setItem('cache_banner_' + publicUrl, localUrl);
              setSelectedBanner(publicUrl);
              showToast('Banner uploaded successfully!');
              
              const m = $('#fav-avatar-modal');
              if (m) {
                if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
                m.style.display = 'none';
                m.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) {}
              }
            }
          } else {
            setSelectedBanner(pathOrDataUrl);
            showToast('Banner saved locally!');
            
            const m = $('#fav-avatar-modal');
            if (m) {
              if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
              m.style.display = 'none';
              m.classList.remove('modal-active');
              try { document.body.classList.remove('modal-open'); } catch (e) {}
            }
          }
        } catch (err) {
          console.error('[Banner Upload Error]', err);
          showToast('Failed to upload banner.');
          setSelectedBanner(pathOrDataUrl);
          
          const m = $('#fav-avatar-modal');
          if (m) {
            if (m._bannerCleanup) { m._bannerCleanup(); m._bannerCleanup = null; }
            m.style.display = 'none';
            m.classList.remove('modal-active');
            try { document.body.classList.remove('modal-open'); } catch (e) {}
          }
        }
      };
    }
  }

  function openFavoritesAvatarModal(mode = 'avatar') {
    if (mode === 'banner' && window.AppCapabilities && !window.AppCapabilities.can('banner-search')) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Banner search requires Cinemeta or TMDB add-on to be installed');
      }
      return;
    }
    window.currentFavModalMode = mode;
    createFavModal();
    const title = $('#fav-avatar-modal h2');
    if (title) title.textContent = mode === 'avatar' ? 'Choose Avatar' : 'Choose Banner';
    
    const uploadBtn = $('#btn-upload-custom-banner');
    if (uploadBtn) {
      uploadBtn.style.display = mode === 'banner' ? 'flex' : 'none';
    }

    // Dynamic re-binding of DOM listeners to ensure the active file context's callbacks are triggered
    const modal = $('#fav-avatar-modal');
    if (modal) {
      const closeBtn = $('#fav-modal-close');
      if (closeBtn) {
        closeBtn.onclick = () => { 
          if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
          modal.style.display = 'none'; 
          modal.classList.remove('modal-active');
          try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
        };
      }

      const backBtn = $('#fav-back-btn');
      if (backBtn) {
        backBtn.onclick = () => {
          $('#fav-results-list').style.display = 'grid';
          $('#fav-media-grid').style.display = 'none';
          backBtn.style.display = 'none';
        };
      }

      const searchInput = $('#fav-search-input');
      if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = (e) => {
          clearTimeout(searchInput._searchTimeout);
          const val = e.target.value;
          searchInput._searchTimeout = setTimeout(() => {
            $('#fav-results-list').style.display = 'grid';
            $('#fav-media-grid').style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            populateFavResults(val);
          }, 500);
        };
      }

      const uploadCustomBannerBtn = $('#btn-upload-custom-banner');
      if (uploadCustomBannerBtn) {
        uploadCustomBannerBtn.onclick = async () => {
          let pathOrDataUrl = null;
          if (window.api?.isElectron) {
            try {
              pathOrDataUrl = await window.api.invoke('select-user-banner');
            } catch (err) {
              console.error('[Banner Upload Error]', err);
              showToast('Failed to select banner.');
              return;
            }
          } else {
            pathOrDataUrl = await new Promise((resolve) => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = async (e) => {
                const file = e.target.files?.[0];
                if (!file) { resolve(null); return; }
                try {
                  const dataUrl = await compressImageFile(file, 1200);
                  resolve(dataUrl);
                } catch (err) {
                  console.error('[Banner Upload Error]', err);
                  showToast('Failed to process image.');
                  resolve(null);
                }
              };
              input.click();
            });
          }

          if (!pathOrDataUrl) return;

          try {
            if (window.supabase) {
              showToast('Uploading banner to cloud...', 'info');
              const client = getSupabaseRendererClient();
              
              let blob;
              if (pathOrDataUrl.startsWith('data:')) {
                const res = await fetch(pathOrDataUrl);
                blob = await res.blob();
              } else {
                const res = await fetch(localImg(pathOrDataUrl));
                blob = await res.blob();
              }

              const fileName = `banners/banner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;
              
              const { data, error } = await client.storage.from('avatars').upload(fileName, blob, {
                cacheControl: '3600',
                upsert: false,
                contentType: blob.type || 'image/jpeg'
              });
              
              if (error) {
                console.error('Supabase upload error:', error);
                showToast('Cloud upload failed, using local copy.');
                setSelectedBanner(pathOrDataUrl);
              } else {
                const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(fileName);
                const publicUrl = publicUrlData.publicUrl;
                let safePath = pathOrDataUrl.replace(/\\/g, "/");
                let localUrl;
                const hasSeparators = safePath.includes('/') || safePath.includes('\\');
                if (safePath.match(/^[a-zA-Z]:/) || safePath.startsWith("/") || !hasSeparators) {
                  if (safePath.match(/^[a-zA-Z]:/)) {
                    localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  } else if (safePath.startsWith("/")) {
                    localUrl = "media-img:///" + encodeURI(safePath.slice(1)).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  } else {
                    localUrl = "media-img:///" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                  }
                } else {
                  localUrl = "local-file://" + encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
                }
                localStorage.setItem('cache_banner_' + publicUrl, localUrl);
                setSelectedBanner(publicUrl);
                showToast('Banner uploaded successfully!');
                
                if (modal) {
                  if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
                  modal.style.display = 'none';
                  modal.classList.remove('modal-active');
                  try { document.body.classList.remove('modal-open'); } catch (e) {}
                }
              }
            } else {
              setSelectedBanner(pathOrDataUrl);
              showToast('Banner saved locally!');
              
              if (modal) {
                if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
                modal.style.display = 'none';
                modal.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) {}
              }
            }
          } catch (err) {
            console.error('[Banner Upload Error]', err);
            showToast('Failed to upload banner.');
            setSelectedBanner(pathOrDataUrl);
            
            if (modal) {
              if (modal._bannerCleanup) { modal._bannerCleanup(); modal._bannerCleanup = null; }
              modal.style.display = 'none';
              modal.classList.remove('modal-active');
              try { document.body.classList.remove('modal-open'); } catch (e) {}
            }
          }
        };
      }
    }

    populateFavResults('');
    const m = $('#fav-avatar-modal'); if (m) {
      // Remove active flag from other overlays so they hide behind this modal
      document.querySelectorAll('body > .modal-overlay.modal-active').forEach(el => el.classList.remove('modal-active'));
      m.classList.add('modal-active');
      m.style.display = 'flex';
      try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
      setTimeout(() => { m.style.opacity = '1'; }, 10);
    }
  }

  async function searchUnified(query) {
    try {
      const q = (query || '').trim();
      if (!q) return [];
      console.log('[Unified Search] Searching for:', q);
      const result = await window.api.unifiedSearch(q);
      return result?.results || [];
    } catch (err) {
      console.error('[Search Error]', err);
      return [];
    }
  }

  async function populateFavResults(filter) {
    const list = $('#fav-results-list');
    const grid = $('#fav-media-grid');
    if (!list || !grid) return;
    list.innerHTML = '';
    grid.innerHTML = '';

    const q = (filter || '').trim();
    let results = [];

    if (!q) {
      const isBannerMode = window.currentFavModalMode === 'banner';
      list.innerHTML = `
        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 400px; opacity: 0.6;">
          <div style="background: rgba(109, 40, 217, 0.1); width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 25px;">
            <i class="fas ${isBannerMode ? 'fa-image' : 'fa-search-plus'}" style="font-size: 40px; color: var(--accent);"></i>
          </div>
          <h3 style="font-size: 1.8rem; font-weight: 800; color: #fff; margin-bottom: 10px;">${isBannerMode ? 'Find a Movie or Show' : 'Start your search'}</h3>
          <p style="color: rgba(255,255,255,0.5); font-weight: 500;">${isBannerMode ? 'Search for a title to find beautiful banners' : 'Search Jikan or TMDB'}</p>
        </div>
      `;
      return;
    }else {
      list.innerHTML = '<div style="grid-column: 1 / -1; padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--accent);"></i></div>';
      try {
        // If user is choosing an avatar, prefer AniList character search first (better character coverage)
        if (window.currentFavModalMode === 'avatar') {
          let animeResults = [];
          try {
            const al = await window.api.invoke('anilist-search', q);
            if (al && al.length) {
              const chars = al.filter(r => r.type === 'character');
              if (chars.length) animeResults = chars;
              else animeResults = al;
            } else {
              // AniList returned empty, fallback to Jikan Characters
              const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=15`);
              const data = await res.json();
              animeResults = (data.data || []).map(c => ({
                id: c.mal_id,
                title: c.name,
                poster: c.images?.webp?.image_url || c.images?.jpg?.image_url,
                source: 'jikan',
                type: 'character'
              }));
            }
          } catch (e) {
            // AniList failed, fallback to Jikan Characters
            try {
              const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=15`);
              const data = await res.json();
              animeResults = (data.data || []).map(c => ({
                id: c.mal_id,
                title: c.name,
                poster: c.images?.webp?.image_url || c.images?.jpg?.image_url,
                source: 'jikan',
                type: 'character'
              }));
            } catch (err2) {
              animeResults = [];
            }
          }

          let tmdbResults = [];
          const tmdbEnabled = appData.tmdbEnabled !== false;
          const tmdbKey = appData.tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
          if (tmdbEnabled && tmdbKey) {
            try {
              const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}`;
              const searchResp = await fetch(searchUrl).then(r => r.json()).catch(() => null);
              if (searchResp && searchResp.results) {
                tmdbResults = searchResp.results
                  .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
                  .map(r => ({
                    id: r.id,
                    tmdbId: r.id,
                    title: r.title || r.name || '',
                    poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : '',
                    media_type: r.media_type,
                    type: r.media_type
                  }));
              }
            } catch (err) {
              console.error('[TMDB Avatar search error]', err);
            }
          }

          results = [...animeResults, ...tmdbResults];
        } else if (window.currentFavModalMode === 'banner') {
          const tmdbEnabled = appData.tmdbEnabled !== false;
          const tmdbKey = appData.tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
          if (tmdbEnabled && tmdbKey) {
            try {
              const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(q)}`;
              const searchResp = await fetch(searchUrl).then(r => r.json()).catch(() => null);
              if (searchResp && searchResp.results) {
                results = searchResp.results
                  .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
                  .map(r => ({
                    id: r.id,
                    tmdbId: r.id,
                    title: r.title || r.name || '',
                    poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : '',
                    media_type: r.media_type,
                    type: r.media_type
                  }));
              }
            } catch (err) {
              console.error('[TMDB Modal Search Error]', err);
            }
          }

          if (!results || !results.length) {
            if (window.AppCapabilities && !window.AppCapabilities.can('banner-search')) {
              list.innerHTML = `<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.6);">
                <i class="fas fa-plug-circle-xmark" style="font-size:2.5rem; color:var(--accent); margin-bottom:15px; display:block;"></i>
                Banner search requires Cinemeta or TMDB add-on to be installed.
              </div>`;
              return;
            }
            // User requested explicit Cinemeta search for Banners to avoid Jikan mapping issues
            const res = await window.api.invoke('cinemeta-search', q);
            results = res?.results || [];
          }
        } else {
          results = await searchUnified(q);
        }
        if (!results.length) {
          list.innerHTML = `<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.4);">No matches found for "${escapeHTML(q)}" on Jikan/TMDB.</div>`;
          return;
        }
        list.innerHTML = '';
      } catch (err) {
        list.innerHTML = '<div style="grid-column: 1 / -1; padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Search failed.</div>';
        return;
      }
    }

    results.forEach(item => {
      const title = item.title || item.name || item.name_en || item.title_english || '';
      const el = document.createElement('div');
      el.className = 'fav-list-item';
      el.style = 'cursor:pointer; text-align:center; padding:15px; border-radius:24px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1); display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';

      // Hover effects via JS since it's inline-styled
      el.onmouseenter = () => {
        el.style.transform = 'translateY(-8px) scale(1.03)';
        el.style.background = 'rgba(255,255,255,0.08)';
        el.style.borderColor = 'var(--accent)';
        el.style.boxShadow = '0 15px 35px rgba(0,0,0,0.4)';
      };
      el.onmouseleave = () => {
        el.style.transform = 'translateY(0) scale(1)';
        el.style.background = 'rgba(255,255,255,0.04)';
        el.style.borderColor = 'rgba(255,255,255,0.08)';
        el.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
      };

      const poster = item.poster || item.poster_path || 'imgs/no-backdrop.png';
      el.innerHTML = `
        <div style="width: 100%; aspect-ratio: 2/3; overflow: hidden; border-radius: 16px; margin-bottom: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); position: relative;">
          <img src="${localImg(poster)}" alt="${escapeHTML(title)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='imgs/no-backdrop.png'">
          <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%); pointer-events: none;"></div>
        </div>
        <div style="font-size: 13.5px; font-weight: 800; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; padding: 0 5px; min-height: 2.6em; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">${escapeHTML(title)}</div>
      `;
      el.onclick = () => {
        if (window.currentFavModalMode === 'avatar' && (item.type === 'character' || item.source === 'jikan' || item.source === 'anilist')) {
          const src = item.poster || item.poster_path || item.image;
          if (src) {
            setSelectedAvatar(src.startsWith('http') ? src : localImg(src));
            showToast('Avatar updated');
            const _m = $('#fav-avatar-modal');
            if (_m) { _m.style.display = 'none'; _m.classList.remove('modal-active'); }
            try { document.body.classList.remove('modal-open'); } catch (e) { }

            return;
          }
        }
        $('#fav-results-list').style.display = 'none';
        $('#fav-media-grid').style.display = 'grid';
        $('#fav-back-btn').style.display = 'flex';
        grid.innerHTML = '<div style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px;"><i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--accent); margin-bottom:15px;"></i><div>Fetching cinematic assets...</div></div>';
        fetchFavoriteAssets(item, grid);
      };
      list.appendChild(el);
    });
  }

  async function fetchKitsuAvatars(item, targetGrid) {
    try {
      let kitsuId = item.kitsuId || item.kitsu_id;
      const title = item.title || item.name || item.name_en || item.title_english || '';

      if (!kitsuId && title) {
        const kSearch = await window.api.invoke('kitsu-search', title);
        if (kSearch?.results?.length > 0) {
          kitsuId = kSearch.results[0].id;
        }
      }

      if (!kitsuId) return [];

      const cast = await window.api.invoke('kitsu-cast', kitsuId);
      if (cast && cast.length) {
        return cast.filter(c => c.profile_path || c.image).map(c => ({
          src: c.profile_path || c.image,
          label: (c.character || c.name) + (c.role ? ` • ${c.role}` : ''),
          type: 'avatar'
        }));
      }
    } catch (err) {
      console.error('[Kitsu Error]', err);
    }
    return [];
  }

  async function fetchFavoriteAssets(item, targetGrid) {
    try {
      let type = item.media_type || item.type || (item.title ? 'movie' : 'tv');
      let id = item.tmdbId || item.id;
      const isAnime = (type === 'anime' || item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || item.kitsuId || item.kitsu_id || item.kitsu || item.mal_id || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:'))));
      const searchTitle = item.title || item.name || item.name_en || item.title_english || '';
      const releaseDate = item.release_date || item.first_air_date || item.startDate || '';
      const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : null;

      let resolvedMatches = []; // [{id, type}]

      const isKitsuItem = item.source === 'kitsu' || item.source === 'mal' || item.source === 'jikan' || !!item.kitsuId || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
      const isAvatarMode = window.currentFavModalMode === 'avatar';

      targetGrid.innerHTML = '';
      $('#fav-search-source').style.display = 'none';

      // Initialize Grid
      if (isAvatarMode) {
        // Avatar carousel: make it horizontally swipeable like banners
        if (!targetGrid.classList.contains('fav-avatar-mode')) targetGrid.classList.add('fav-avatar-mode');
        targetGrid.style.display = 'flex';
        targetGrid.style.flexDirection = 'row';
        targetGrid.style.flexWrap = 'nowrap';
        targetGrid.style.overflowX = 'auto';
        targetGrid.style.overflowY = 'hidden';
        targetGrid.style.scrollSnapType = 'x mandatory';
        targetGrid.style.gap = '12px';
        targetGrid.style.padding = '12px';
        targetGrid.style.webkitOverflowScrolling = 'touch';
        targetGrid.style.scrollBehavior = 'smooth';
        targetGrid.style.alignItems = 'center';
        targetGrid.style.width = '100%';
        targetGrid.style.minWidth = '100%';
        // hide parent's overflow to create a neat card area
        if (targetGrid.parentElement) targetGrid.parentElement.style.overflow = 'hidden';
      } else {
        // ensure avatar-mode class removed when showing banners
        if (targetGrid.classList.contains('fav-avatar-mode')) targetGrid.classList.remove('fav-avatar-mode');
        targetGrid.style.display = 'flex';
        targetGrid.style.flexDirection = 'row';
        targetGrid.style.flexWrap = 'nowrap';
        targetGrid.style.overflowX = 'auto';
        targetGrid.style.overflowY = 'hidden';
        targetGrid.style.scrollSnapType = 'x mandatory';
        targetGrid.style.gap = '0px';
        targetGrid.style.width = '100%';
        targetGrid.style.height = '100%';
        targetGrid.style.padding = '0px';
        targetGrid.style.webkitOverflowScrolling = 'touch';
        targetGrid.style.scrollBehavior = 'smooth';
        targetGrid.style.scrollbarWidth = 'none'; // Firefox
        targetGrid.style.msOverflowStyle = 'none'; // IE/Edge
        // Hide scrollbar for Chrome/Safari
        const styleId = 'fav-media-grid-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = '#fav-media-grid::-webkit-scrollbar { display: none; }';
          document.head.appendChild(style);
        }
        if (targetGrid.parentElement) targetGrid.parentElement.style.overflow = 'hidden';
      }

      let items = [];

      // 1. Avatars: Use Kitsu characters AND TMDB cast for maximum coverage
      if (isAvatarMode) {
        try {
          // A. Try AniList by Title for anime characters
          let animeChars = [];
          if (isAnime && searchTitle) {
            const cleanTitle = searchTitle.replace(/\s+(2|II|III|IV|V|Season\s+\d+|S\d+|[0-9]+)$/i, '').trim();
            const alSearch = await window.api.invoke('anilist-search', cleanTitle).catch(() => []);
            const mediaMatch = alSearch.find(r => r.type === 'media' || r.type === 'anime');
            if (mediaMatch) {
              animeChars = await window.api.invoke('anilist-media-assets', mediaMatch.id).catch(() => []);
            }
          }

          if (animeChars && animeChars.length) {
            items.push(...animeChars);
          }

          // B. Try TMDB Cast (Great for live action and mapped anime)
          let tmdbId = item.tmdbId || item.id;
          let tmdbType = item.media_type || item.type || (item.title ? 'movie' : 'tv');

          if (!tmdbId && searchTitle) {
            const tSearch = await window.api.invoke('tmdb-search-discover', searchTitle).catch(() => null);
            if (tSearch?.results?.length) {
              tmdbId = tSearch.results[0].id;
              tmdbType = tSearch.results[0].media_type || tmdbType;
            }
          }

          if (tmdbId && tmdbType !== 'person') {
            const tmdbKey = appData.tmdbKey;
            if (tmdbKey) {
              try {
                const creditsUrl = `https://api.themoviedb.org/3/${tmdbType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/credits?api_key=${tmdbKey}`;
                const creditsResp = await fetch(creditsUrl).then(r => r.json()).catch(() => null);
                if (creditsResp && creditsResp.cast) {
                  creditsResp.cast.forEach(cast => {
                    if (cast.profile_path) {
                      const url = `https://image.tmdb.org/t/p/h632${cast.profile_path}`;
                      items.push({ src: url, label: cast.name, type: 'avatar' });
                    }
                  });
                }
              } catch (e) {
                console.error('[TMDB Credits Fetch Error]', e);
              }
            }
          }

        } catch (e) {
          console.error('[Avatar Resolve Error]', e);
        }
      }

      // 2. Banners: Use Fanart.tv exclusively for external backgrounds (plus the item's own)
      if (!isAvatarMode) {
        let fanartId = item.tmdbId;
        // Only fallback to item.id if it's not a Jikan/AniList ID (which Fanart doesn't support)
        if (!fanartId && item.source !== 'jikan' && item.source !== 'anilist') {
          fanartId = item.id;
        }
        let fanartType = item.media_type || item.type || (item.title ? 'movie' : 'tv');

        // Fanart.tv does NOT support IMDB IDs ('tt...') for TV shows. It requires TVDB or TMDB ID.
        // If we only have an IMDB ID for a series, we MUST resolve it.
        const isImdbTvShow = fanartId && String(fanartId).startsWith('tt') && (fanartType === 'series' || fanartType === 'tv');

        // If we don't have a valid Fanart ID, or it's an IMDB TV show, RESOLVE it
        if ((!fanartId || isImdbTvShow) && searchTitle) {
          try {
            if (item.source === 'jikan' && item.id) {
              // It's an Anime, get TVDB ID using MAL ID map
              const external = await window.api.invoke('map-mal-id', item.id);
              if (external) {
                fanartId = external.tvdb || external.tmdb || null;
                fanartType = external.tvdb ? 'tv' : 'movies';
              }
            }
            
            // If still no ID or we need to resolve IMDB TV ID
            if (!fanartId || isImdbTvShow) {
              // If we already have an IMDB ID, skip search and go straight to details
              let targetId = fanartId;
              let targetType = fanartType;

              if (!targetId) {
                const res = await window.api.invoke('cinemeta-search', searchTitle);
                if (res?.results?.length) {
                  const match = res.results[0];
                  targetId = match.id;
                  targetType = match.type || 'movie';
                }
              }

              if (targetId && (targetType === 'series' || targetType === 'tv')) {
                const details = await window.api.invoke('cinemeta-details', { id: targetId, type: targetType }).catch(() => null);
                if (details?.meta) {
                  // Cinemeta details might return tvdb_id or moviedb_id
                  fanartId = details.meta.tvdb_id || details.meta.tmdb_id || details.meta.moviedb_id || targetId;
                  fanartType = 'tv';
                }
              } else if (targetId) {
                fanartId = targetId;
                fanartType = targetType;
              }
            }
          } catch (e) { console.error('[ID Resolve Error]', e); }
        }

        if (fanartId) {
          try {
            const fanart = await window.api.invoke('fanart-images', fanartType, fanartId).catch(() => null);

            if (fanart) {
              // 1. Full 16:9 Backgrounds (Textless usually)
              const bgs = fanart.moviebackground || fanart.tvbackground || fanart.showbackground || [];
              bgs.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Background', type: 'banner' }));
              
              // 2. Wide Banners (1000x185) - Excluded because they are narrow strips that stretch poorly on 16:9 switcher backgrounds
              // const banners = fanart.moviebanner || fanart.tvbanner || [];
              // banners.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Banner', type: 'banner' }));
              
              // 3. Thumbnails (16:9 usually 1000x562 - great for profile banners)
              const thumbs = fanart.moviethumb || fanart.tvthumb || [];
              thumbs.forEach(bg => items.push({ src: bg.url, label: 'Fanart.tv Thumbnail', type: 'banner' }));
            }
          } catch (e) { console.error('[Banner Fetch Error]', e); }
        }

        // Fetch from TMDB if tmdb is enabled
        const tmdbEnabled = appData.tmdbEnabled !== false;
        const tmdbKey = appData.tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
        if (tmdbEnabled && tmdbKey) {
          try {
            let tmdbId = item.tmdbId;
            let tmdbType = item.media_type || item.type || (item.title ? 'movie' : 'tv');
            if (tmdbType === 'series') tmdbType = 'tv';

            // Resolve IMDB ID to TMDB ID if needed
            if (!tmdbId && item.id && String(item.id).startsWith('tt')) {
              const findUrl = `https://api.themoviedb.org/3/find/${item.id}?api_key=${tmdbKey}&external_source=imdb_id`;
              const findResp = await fetch(findUrl).then(r => r.json()).catch(() => null);
              if (findResp) {
                const movie = findResp.movie_results?.[0];
                const tv = findResp.tv_results?.[0];
                if (movie) {
                  tmdbId = movie.id;
                  tmdbType = 'movie';
                } else if (tv) {
                  tmdbId = tv.id;
                  tmdbType = 'tv';
                }
              }
            }

            // Resolve by title if we still don't have TMDB ID
            if (!tmdbId && searchTitle) {
              const cleanTitle = searchTitle.replace(/\s+(2|II|III|IV|V|Season\s+\d+|S\d+|[0-9]+)$/i, '').trim();
              const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(cleanTitle)}`;
              const searchResp = await fetch(searchUrl).then(r => r.json()).catch(() => null);
              if (searchResp && searchResp.results?.length) {
                const match = searchResp.results[0];
                tmdbId = match.id;
                tmdbType = match.media_type || tmdbType;
                if (tmdbType === 'person') {
                  const nextMatch = searchResp.results.find(r => r.media_type !== 'person');
                  if (nextMatch) {
                    tmdbId = nextMatch.id;
                    tmdbType = nextMatch.media_type;
                  }
                }
              }
            }

            if (tmdbId && tmdbType !== 'person') {
              const imagesUrl = `https://api.themoviedb.org/3/${tmdbType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/images?api_key=${tmdbKey}`;
              const imgResp = await fetch(imagesUrl).then(r => r.json()).catch(() => null);
              if (imgResp && imgResp.backdrops) {
                imgResp.backdrops.forEach(img => {
                  const url = `https://image.tmdb.org/t/p/original${img.file_path}`;
                  items.push({ src: url, label: 'TMDB Backdrop', type: 'banner' });
                });
              }
            }
          } catch (err) {
            console.error('[TMDB Banner Fetch Error]', err);
          }
        }
      }

      // Final Fallback: If still no assets found (or in addition), use the item's own poster/banner
      if (items.length === 0 || !isAvatarMode) {
        if (item.banner && !isAvatarMode) {
          items.push({ src: localImg(item.banner), label: 'Original Banner', type: 'banner' });
        }
        const mainPoster = item.poster || item.poster_path;
        if (mainPoster && isAvatarMode) {
          items.push({ src: localImg(mainPoster), label: 'Main Poster', type: 'avatar' });
        }
      }
      // Deduplicate and filter
      items = items.filter((v, i, a) => a.findIndex(t => t.src === v.src) === i).slice(0, 60);

      if (!items.length) {
        targetGrid.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4); grid-column:1/-1;">Could not find extra assets.</div>';
        return;
      }

      // Render Items
      items.forEach(it => {
        const isAvatar = it.type === 'avatar';

        if (isAvatar) {
          // Create a carousel slide for each avatar with name and select button
          const slide = document.createElement('div');
          const basis = window.innerWidth < 480 ? '64%' : '36%';
          slide.style = `flex:0 0 ${basis}; scroll-snap-align:center; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:8px; box-sizing:border-box;`;

          const avatarWrap = document.createElement('div');
          const avatarSize = window.innerWidth < 420 ? 120 : 160;
          avatarWrap.style = `width:${avatarSize}px; height:${avatarSize}px; border-radius:50%; overflow:hidden; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 30px rgba(0,0,0,0.4);`;

          const img = document.createElement('img');
          img.src = localImg(it.src);
          img.style = 'width:100%; height:100%; object-fit:cover; object-position:center center; display:block;';
          img.onerror = () => { img.style.opacity = '0'; };
          avatarWrap.appendChild(img);

          const nameEl = document.createElement('div');
          nameEl.style = 'margin-top:10px; font-size:1rem; font-weight:800; color:#fff; text-align:center; min-height:2.2em;';
          nameEl.textContent = it.label || '';

          const selectBtn = document.createElement('button');
          selectBtn.className = 'btn-primary';
          selectBtn.style = 'margin-top:10px; padding:10px 16px; border-radius:12px; font-weight:700;';
          selectBtn.textContent = 'Select Avatar';
          selectBtn.onclick = () => {
            setSelectedAvatar(it.src);
            showToast('Avatar updated');
            const _m = $('#fav-avatar-modal'); if (_m?._bannerCleanup) { _m._bannerCleanup(); _m._bannerCleanup = null; }
            if (_m) _m.style.display = 'none';
          };

          slide.appendChild(avatarWrap);
          slide.appendChild(nameEl);
          slide.appendChild(selectBtn);
          targetGrid.appendChild(slide);
        } else {
          // High-Quality Dynamic Slider for Banners (responsive)
          const slide = document.createElement('div');
          // Make slides slightly narrower on mobile to allow peeking and swiping
          const slideBasis = window.innerWidth < 480 ? '90%' : '100%';
          slide.style = `flex: 0 0 ${slideBasis}; height: 100%; scroll-snap-align: center; position: relative; display: flex; align-items: center; justify-content: center; background: transparent; padding: 12px; box-sizing: border-box;`;

          const tile = document.createElement('div');
          tile.className = 'fav-media-tile';
          tile.style = `width: 100%; max-width: ${window.innerWidth < 480 ? '92vw' : '900px'}; aspect-ratio: 16/9; border-radius: 16px; position: relative; overflow: hidden; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.2); box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);`;

          const imgEl = document.createElement('img');
          imgEl.src = localImg(it.src);
          imgEl.style = 'width:100%; height:100%; object-fit:cover; display:block;';
          imgEl.onerror = () => { imgEl.style.opacity = '0.3'; };
          tile.appendChild(imgEl);

          // Centered overlay select button for better visibility on all screens
          const selectOverlay = document.createElement('div');
          selectOverlay.style = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.1); transition: background 0.3s;';

          const selectBtn = document.createElement('button');
          selectBtn.className = 'btn-primary';
          selectBtn.style = 'padding:14px 28px; border-radius:14px; font-weight:800; font-size:1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); transform: translateY(0); transition: all 0.2s;';
          selectBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:8px;"></i> Apply This Banner';

          selectBtn.onmouseenter = () => { selectBtn.style.transform = 'scale(1.05)'; };
          selectBtn.onmouseleave = () => { selectBtn.style.transform = 'scale(1)'; };

          selectBtn.onclick = () => {
            setSelectedBanner(it.src);
            showToast('Banner applied');
            
            // Show checkmark on the button and highlight it in green
            selectBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:8px; color: #22C55E;"></i> Applied';
            selectBtn.style.background = 'rgba(16, 185, 129, 0.2)';
            selectBtn.style.borderColor = '#10B981';
            selectBtn.style.color = '#10B981';
            selectBtn.disabled = true;

            setTimeout(() => {
              const _m = $('#fav-avatar-modal'); 
              if (_m?._bannerCleanup) { _m._bannerCleanup(); _m._bannerCleanup = null; }
              if (_m) {
                _m.style.display = 'none';
                _m.classList.remove('modal-active');
                try { document.body.classList.remove('modal-open'); } catch (e) { /* ignore */ }
              }
            }, 1000);
          };


          selectOverlay.appendChild(selectBtn);
          tile.appendChild(selectOverlay);

          slide.appendChild(tile);
          targetGrid.appendChild(slide);
        }
      });

      // ── Arrow Key Navigation for Banner Carousel (PC only) ──
      if (!isAvatarMode && items.length > 1) {
        let currentSlideIndex = 0;
        const slides = targetGrid.querySelectorAll(':scope > div');

        const scrollToSlide = (index) => {
          if (index < 0) index = slides.length - 1;
          if (index >= slides.length) index = 0;
          currentSlideIndex = index;

          const slideWidth = targetGrid.offsetWidth;
          targetGrid.scrollTo({
            left: index * slideWidth,
            behavior: 'smooth'
          });
          updateDots();
        };

        const keyHandler = (e) => {
          const modal = $('#fav-avatar-modal');
          if (!modal || modal.style.display === 'none') return;
          if (e.key === 'ArrowRight') { e.preventDefault(); scrollToSlide(currentSlideIndex + 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToSlide(currentSlideIndex - 1); }
        };

        document.addEventListener('keydown', keyHandler);

        // Prev/Next arrows (visible on wider screens)
        const leftBtn = document.createElement('button');
        const rightBtn = document.createElement('button');
        leftBtn.className = 'fav-carousel-arrow';
        rightBtn.className = 'fav-carousel-arrow';
        leftBtn.innerHTML = '&#9664;';
        rightBtn.innerHTML = '&#9654;';
        leftBtn.style = rightBtn.style = 'position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px; border-radius:24px; background:rgba(0,0,0,0.5); color:#fff; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:30;';
        leftBtn.style.left = '12px';
        rightBtn.style.right = '12px';
        // Show arrows on most phones too (smaller) so users can tap to move slides
        const shouldShowArrows = true; // enabled for all sizes
        leftBtn.style.display = shouldShowArrows ? 'flex' : 'none';
        rightBtn.style.display = shouldShowArrows ? 'flex' : 'none';
        // Make arrows more touch-friendly on small screens
        if (window.innerWidth < 480) {
          leftBtn.style.width = leftBtn.style.height = '44px';
          leftBtn.style.borderRadius = '22px';
          rightBtn.style.width = rightBtn.style.height = '44px';
          rightBtn.style.borderRadius = '22px';
          leftBtn.style.left = '8px';
          rightBtn.style.right = '8px';
          leftBtn.style.opacity = '0.95';
        }
        leftBtn.onclick = () => scrollToSlide(currentSlideIndex - 1);
        rightBtn.onclick = () => scrollToSlide(currentSlideIndex + 1);
        targetGrid.parentElement.appendChild(leftBtn);
        targetGrid.parentElement.appendChild(rightBtn);
        const resizeHandler = () => {
          // Keep arrows visible across sizes; adjust sizing on resize
          if (window.innerWidth < 480) {
            leftBtn.style.width = leftBtn.style.height = '44px';
            leftBtn.style.borderRadius = '22px';
            rightBtn.style.width = rightBtn.style.height = '44px';
            rightBtn.style.borderRadius = '22px';
            leftBtn.style.left = '8px';
            rightBtn.style.right = '8px';
          } else {
            leftBtn.style.width = leftBtn.style.height = '48px';
            leftBtn.style.borderRadius = '24px';
            rightBtn.style.width = rightBtn.style.height = '48px';
            rightBtn.style.borderRadius = '24px';
            leftBtn.style.left = '12px';
            rightBtn.style.right = '12px';
          }
        };
        window.addEventListener('resize', resizeHandler);

        // Dot indicator bar
        const counter = document.createElement('div');
        counter.style = 'position:absolute; bottom:20px; left:50%; transform:translateX(-50%); display:flex; gap:8px; z-index:20; padding:6px 12px; background:rgba(0,0,0,0.4); border-radius:20px; backdrop-filter:blur(8px);';
        slides.forEach((_, i) => {
          const dot = document.createElement('div');
          dot.style = `width:8px; height:8px; border-radius:50%; background:${i === 0 ? '#fff' : 'rgba(255,255,255,0.3)'}; transition:all 0.3s; cursor:pointer;`;
          dot.onclick = () => scrollToSlide(i);
          counter.appendChild(dot);
        });
        targetGrid.parentElement.style.position = 'relative';
        targetGrid.parentElement.appendChild(counter);

        const updateDots = () => {
          const dots = counter.children;
          for (let i = 0; i < dots.length; i++) {
            dots[i].style.background = i === currentSlideIndex ? '#fff' : 'rgba(255,255,255,0.3)';
            dots[i].style.transform = i === currentSlideIndex ? 'scale(1.4)' : 'scale(1)';
          }
        };

        // Sync scroll position via scroll event (fallback for manual swipes)
        let isInternalScroll = false;
        targetGrid.onscroll = () => {
          if (isInternalScroll) return;
          const index = Math.round(targetGrid.scrollLeft / targetGrid.offsetWidth);
          if (index !== currentSlideIndex) {
            currentSlideIndex = index;
            updateDots();
          }
        };

        // Cleanup when modal closes
        const cleanup = () => {
          document.removeEventListener('keydown', keyHandler);
          targetGrid.onscroll = null;
          if (counter.parentElement) counter.remove();
          if (leftBtn.parentElement) leftBtn.remove();
          if (rightBtn.parentElement) rightBtn.remove();
          window.removeEventListener('resize', resizeHandler);
        };
        const modal = $('#fav-avatar-modal');
        if (modal) {
          if (modal._bannerCleanup) modal._bannerCleanup();
          modal._bannerCleanup = cleanup;
        }
      }
    } catch (err) {
      console.error('fetchFavoriteAssets error', err);
      targetGrid.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Error fetching assets.</div>';
    }
  }

  function setSelectedAvatar(url) {
    selectedAvatar = url;
    const selector = $('#avatar-selector'); if (selector) {
      // Remove ANY previous custom/favorite avatars to prevent duplication
      selector.querySelectorAll('.avatar-opt.custom-avatar').forEach(el => el.remove());
      selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));

      const img = document.createElement('img');
      img.src = localImg(url);
      img.className = 'avatar-opt selected custom-avatar';
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_AVATAR_SVG; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = url;
        // Also persist if user clicks the added custom avatar
        const targetId = editingProfileId;
        const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
        if (prof) {
          prof.avatar = url;
          persist();
          renderProfilePicker();
          renderProfileWidget();
          renderAccount();
        }
      };

      const upload = selector.querySelector('#btn-upload-avatar');
      if (upload) selector.insertBefore(img, upload);
      else selector.appendChild(img);
    }

    // Immediately update the profile avatar in appData and persist
    const targetId = editingProfileId;
    const prof = targetId ? appData.profiles?.find(p => p.id === targetId) : null;
    if (prof) {
      prof.avatar = url;
      persist();
      renderProfilePicker();
      renderProfileWidget();
      renderAccount();
    }
  }

  function setSelectedBanner(url) {
    appData.globalBanner = url;
    if (Array.isArray(appData.profiles)) {
      appData.profiles.forEach((p) => { p.banner = url; });
    }
    applyProfilePickerBackdrop(url);
    persist();
    renderProfilePicker();
    renderProfileWidget();
    renderAccount();
    if (typeof window.updateSettingsBanner === 'function') {
      window.updateSettingsBanner();
    }
  }

  const globalBannerBtn = $('#btn-fav-banner');
  if (globalBannerBtn) {
    const canBanner = window.AppCapabilities ? window.AppCapabilities.can('banner-search') : true;
    globalBannerBtn.style.display = canBanner ? 'flex' : 'none';
    globalBannerBtn.onclick = () => openFavoritesAvatarModal('banner');
  }
  const btnToggleEdit = $('#btn-toggle-edit-profiles');
  if (btnToggleEdit) {
    btnToggleEdit.onclick = () => {
      window.isEditingProfiles = !window.isEditingProfiles;
      const bannerBtn = $('#btn-fav-banner');
      const label = btnToggleEdit.querySelector('.btn-label');
      const icon = btnToggleEdit.querySelector('i');
      const canBanner = window.AppCapabilities ? window.AppCapabilities.can('banner-search') : true;
      if (window.isEditingProfiles) {
        if (label) label.textContent = 'Done Editing';
        else btnToggleEdit.textContent = 'Done Editing';
        if (icon) icon.className = 'fas fa-check';
        btnToggleEdit.classList.add('editing-active');
        btnToggleEdit.style.background = '';
        btnToggleEdit.style.borderColor = '';
        btnToggleEdit.style.color = '';
        if (bannerBtn) bannerBtn.style.display = canBanner ? 'flex' : 'none';
      } else {
        if (label) label.textContent = 'Edit Profiles';
        else btnToggleEdit.textContent = 'Edit Profiles';
        if (icon) icon.className = 'fas fa-user-edit';
        btnToggleEdit.classList.remove('editing-active');
        btnToggleEdit.style.background = '';
        btnToggleEdit.style.borderColor = '';
        btnToggleEdit.style.color = '';
        if (bannerBtn) bannerBtn.style.display = canBanner ? 'flex' : 'none';
      }
      renderProfilePicker();
    };
  }

  const btnIntroStart = $('#btn-intro-start');
  if (btnIntroStart) {
    btnIntroStart.onclick = () => {
      $('#intro-screen').style.display = 'none';
      openProfileModal();
    };
  }

  $('#profile-cancel').onclick = () => {
    $('#profile-editor-inline').style.display = 'none';
    $('#profile-picker-main').style.display = 'flex';
    const picker = $('#profile-picker');
    if (picker) {
      picker.style.display = 'flex';
      picker.classList.add('modal-active');
      try { document.body.classList.add('modal-open'); } catch (e) { /* ignore */ }
    }

    // If we have no profiles and we cancelled creation, show profile picker main screen
    if (appData.profiles.length === 0) {
      renderProfilePicker();
    }
  };
  $('#profile-confirm').onclick = async () => {
    const confirmBtn = $('#profile-confirm');
    const nameInput = $('#profile-name-input');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
      showToast('Please enter a name');
      if (nameInput) nameInput.focus();
      return;
    }

    // Check for duplicate names (excluding current profile being edited)
    const duplicate = appData.profiles.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== editingProfileId);
    if (duplicate) {
      showToast('A profile with this name already exists');
      return;
    }

    // Add loading state
    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
      const maxAgeRating = parseInt($('#profile-age-input')?.value || '18', 10);

      if (editingProfileId) {
        const profile = appData.profiles.find(p => p.id === editingProfileId);
        if (profile) {
          const oldName = profile.name;
          // If name changed, rename folder on disk
          if (oldName !== name) {
            await window.api.invoke('rename-profile-folders', oldName, name);
          }
          profile.name = name;
          profile.avatar = selectedAvatar;
          profile.max_age_rating = maxAgeRating;
          if (!profile.banner && appData.globalBanner) profile.banner = appData.globalBanner;
          if (profile.id === appData.activeProfileId) {
            currentProfile = profile;
            renderProfileWidget();
          }
        }
      } else {
        const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'prof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newProfile = {
          id: newId,
          name: name,
          avatar: selectedAvatar,
          max_age_rating: maxAgeRating,
          banner: appData.globalBanner || null,
          playback: {},
          watchlist: [],
          pinned: [],
          vaultPin: null,
          lockedItems: []
        };

        // Automation: Create physical folders on disk
        const folderResult = await window.api.invoke('ensure-profile-folders', name);
        if (folderResult === false) {
          console.warn('[PROFILES] Folder creation might have failed, continuing anyway...');
        }

        appData.profiles.push(newProfile);

        // If this is the only profile, make it active
        if (appData.profiles.length === 1) {
          appData.activeProfileId = newId;
        }
      }

      const modal = $('#profile-editor-inline');
      if (modal) {
        modal.style.display = 'none';
      }
      $('#profile-picker-main').style.display = 'flex';
      $('#intro-screen').style.display = 'none';
      renderProfilePicker();
      persist();

      if (!editingProfileId) {
        showToast(`Profile "${name}" created successfully!`);
      }
    } catch (err) {
      console.error('[PROFILES] Error saving profile:', err);
      showToast('Error: ' + err.message);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
    }
  };

  // ── Views ──
  // Views
  const views = {
    home: $('#view-home'),
    movies: $('#view-movies'),
    shows: $('#view-shows'),
    social: $('#view-social'),
    'show-detail': $('#view-show-detail'),
    settings: $('#view-settings'),
    profiles: $('#view-profiles'),
    player: $('#view-player'),
    discover: $('#view-discover'),
    'discover-detail': $('#view-discover-detail'),
    downloads: $('#view-downloads'),
    library: $('#view-library'), // Mobile Hub
    hub: $('#view-hub'),
    watchlist: $('#view-watchlist'),
    music: $('#view-music'),
    subtitles: $('#view-subtitles'),
    account: $('#view-account'),
    search: $('#view-search'),
    sync: $('#view-sync'),
    radio: $('#view-radio'),
    addons: $('#view-addons'),
    'custom-list-detail': $('#view-custom-list-detail'),
    iptv: $('#view-iptv')
  };

  // Set Home as the default landing page
  Object.values(views).forEach(v => { if (v) v.classList.remove('active'); });
  if (views.home) views.home.classList.add('active');
  $$('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  if ($('#nav-home')) $('#nav-home').classList.add('active');

  const video = $('#video-element');

  const SVG_MOVIE = '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#B0B0B8" stroke-width="1.5"><rect x="6" y="6" width="36" height="36" rx="4"/><line x1="6" y1="14" x2="42" y2="14"/><polygon points="19 22 33 28 19 34 19 22" fill="#B0B0B8" stroke="none"/></svg>';
  const SVG_SHOW = '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#B0B0B8" stroke-width="1.5"><rect x="4" y="8" width="40" height="26" rx="3"/><polyline points="16 38 32 38"/><line x1="24" y1="34" x2="24" y2="38"/><polygon points="19 17 33 21 19 29 19 17" fill="#B0B0B8" stroke="none"/></svg>';

  // ══════════════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════════════
  if ($('#btn-minimize')) $('#btn-minimize').onclick = () => window.api.minimizeWindow();
  if ($('#btn-maximize')) $('#btn-maximize').onclick = () => window.api.maximizeWindow();
  if ($('#btn-close')) $('#btn-close').onclick = () => window.api.closeWindow();
  if ($('#btn-player-minimize')) $('#btn-player-minimize').onclick = () => {
    if (window.api && window.api.minimizeWindow) window.api.minimizeWindow();
  };
  if ($('#btn-player-fullscreen')) $('#btn-player-fullscreen').onclick = toggleFullscreen;
  if ($('#btn-account-logout')) $('#btn-account-logout').onclick = performLogout;
  window.applyTheme = function(themeName = null) {
    const targetTheme = themeName || (window.appData && window.appData.theme) || 'minimalist';
    document.body.classList.remove('theme-minimalist', 'dark-theme', 'theme-dark', 'light-theme');

    if (targetTheme === 'dark' || targetTheme === 'theme-dark') {
      document.body.classList.add('dark-theme');
    } else if (targetTheme === 'light' || targetTheme === 'light-theme') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.add('theme-minimalist');
    }

    if (window.appData) {
      window.appData.theme = targetTheme;
      if (typeof persist === 'function') persist();
    }

    // Update UI active indicator on theme preview cards
    document.querySelectorAll('.theme-card-preview').forEach(card => {
      const cardTheme = card.getAttribute('data-theme');
      if (cardTheme === targetTheme || (cardTheme === 'dark' && (targetTheme === 'dark' || targetTheme === 'theme-dark')) || (cardTheme === 'minimalist' && targetTheme === 'minimalist')) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  };

  // Apply default theme on init
  window.applyTheme(window.appData?.theme || 'minimalist');


  const performRescan = async (btn) => {
    if (btn) btn.disabled = true;
    showToast('⏳ Refreshing Library... searching for local files.');
    try {
      await scanLibrary();
      showToast('✅ Library Refresh Complete');
    } catch (err) {
      showToast('❌ Refresh Failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  const btnRescanMain = $('#btn-rescan-main');
  if (btnRescanMain) btnRescanMain.onclick = () => performRescan(btnRescanMain);

  // Initialize Auto-Choose Stream controls
  const autoChooseToggle = $('#setting-auto-choose-stream');
  const autoChooseResSelect = $('#setting-auto-choose-res');

  if (autoChooseToggle) {
    autoChooseToggle.checked = !!(window.appData && window.appData.autoChooseBestStream);
    autoChooseToggle.onchange = (e) => {
      if (window.appData) {
        window.appData.autoChooseBestStream = e.target.checked;
        if (typeof persist === 'function') persist();
        showToast(e.target.checked ? '⚡ Auto-Choose Best Stream Enabled' : 'Auto-Choose Best Stream Disabled');
      }
    };
  }

  if (autoChooseResSelect) {
    autoChooseResSelect.value = (window.appData && window.appData.autoChooseMaxRes) || '1080p';
    autoChooseResSelect.onchange = (e) => {
      if (window.appData) {
        window.appData.autoChooseMaxRes = e.target.value;
        if (typeof persist === 'function') persist();
        showToast(`Preferred resolution set to ${e.target.value}`);
      }
    };
  }

  $$('.nav-btn[data-view]').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  // Floating Search Button Handler
  const floatingSearchBtn = $('#floating-search-btn');
  if (floatingSearchBtn) {
    floatingSearchBtn.onclick = () => switchView('search');
  }

  // Profiles dropdown: render and handlers
  function toggleProfilesDropdown() {
    const dd = $('#nav-profiles-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none' && dd.style.display !== '';
    if (isOpen) return closeProfilesDropdown();
    renderProfilesDropdown();
    dd.style.display = 'block';
    dd.classList.add('profiles-dropdown');
    // close when clicking outside
    setTimeout(() => {
      const closeHandler = (ev) => { if (!ev.target.closest('#nav-profiles-dropdown') && ev.target.id !== 'nav-profiles') { closeProfilesDropdown(); document.removeEventListener('click', closeHandler); } };
      document.addEventListener('click', closeHandler);
    }, 10);
  }
  function closeProfilesDropdown() {
    const dd = $('#nav-profiles-dropdown'); if (!dd) return; dd.style.display = 'none'; dd.classList.remove('profiles-dropdown');
  }
  function renderProfilesDropdown() {
    const dd = $('#nav-profiles-dropdown'); if (!dd) return;
    // Active profile
    let active = null;
    try { active = appData.profiles?.find(p => p.id === appData.activeProfileId) || appData.profiles?.[0] || null; } catch(e) { active = null; }
    const avatarEl = dd.querySelector('#profiles-active-avatar img');
    const nameEl = dd.querySelector('#profiles-active-name');
    const emailEl = dd.querySelector('#profiles-master-email');
    const subEl = dd.querySelector('#profiles-sub-expires');
    if (active) {
      nameEl.textContent = active.name || 'Profile';
      avatarEl.src = active.avatar ? localImg(active.avatar) : DEFAULT_AVATAR_SVG;
    } else {
      nameEl.textContent = 'Profile'; avatarEl.src = DEFAULT_AVATAR_SVG;
    }
    const userEmail = appData.user?.email || (appData.user && appData.user.email) || 'Not signed in';
    emailEl.textContent = userEmail;
    const sub = appData.user?.subscription_expires_at || appData.subscription_expires_at || null;
    const isPremium = sub && new Date(sub) > new Date();
    if (isPremium) {
      try {
        subEl.textContent = new Date(sub).toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
      } catch (e) {
        subEl.textContent = sub;
      }
      subEl.style.color = '#a855f7';
    } else {
      subEl.textContent = 'Free Tier (Not Active)';
      subEl.style.color = 'var(--text-muted)';
    }
    const logoutBtn = dd.querySelector('#profiles-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = performLogout;
    }
  }

  // --- Mobile Hub Nav ---
  $$('.library-hub-card').forEach(card => {
    card.onclick = () => {
      if (card.dataset.view) switchView(card.dataset.view);
      else if (card.dataset.subview) switchView(card.dataset.subview);
    };
  });

  // --- Mobile App Controls ---
  const btnRescanMob = $('#btn-rescan-mobile');
  if (btnRescanMob) btnRescanMob.onclick = () => performRescan(btnRescanMob);

  const btnRescanQuick = $('#btn-rescan-mobile-quick');
  if (btnRescanQuick) btnRescanQuick.onclick = () => performRescan(btnRescanQuick);



  const btnZoomInMob = $('#btn-zoom-in-mobile');
  if (btnZoomInMob) btnZoomInMob.onclick = () => $('#btn-zoom-in')?.click();
  const btnZoomOutMob = $('#btn-zoom-out-mobile');
  if (btnZoomOutMob) btnZoomOutMob.onclick = () => $('#btn-zoom-out')?.click();
  const btnZoomResetMob = $('#btn-zoom-reset-mobile');
  if (btnZoomResetMob) btnZoomResetMob.onclick = () => $('#btn-zoom-reset')?.click();

  // ── Subtitle Drag & Drop ──
  const dropZone = $('#sub-drop-zone');
  if (dropZone) {
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = '#4f46e5'; dropZone.style.background = 'rgba(79, 70, 229, 0.1)'; };
    dropZone.ondragleave = () => { dropZone.style.borderColor = 'rgba(79, 70, 233, 0.3)'; dropZone.style.background = 'rgba(79, 70, 233, 0.05)'; };
    dropZone.ondrop = async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'rgba(79, 70, 233, 0.3)';
      dropZone.style.background = 'rgba(79, 70, 233, 0.05)';
      const files = Array.from(e.dataTransfer.files);
      let count = 0;
      showToast(`Importing ${files.length} file(s) to current folder...`);
      for (const f of files) {
        if (f.name.toLowerCase().match(/\.(srt|vtt|ass)$/)) {
          await window.api.invoke('save-subtitle-local', {
            profileName: currentProfile?.name || 'Default',
            libraryRoot: appData.libraryFolders?.[0] || '',
            filePath: window.api.getFilePath(f),
            subDir: subCurrentDir // FIXED: Now uses current directory in drop zone
          });
          count++;
        }
      }
      if (count > 0) {
        showToast(`${count} subtitle(s) added to library`);
        renderSubtitles();
      }
    };
    dropZone.onclick = () => $('#sub-file-input').click();

    // Multi-select bulk actions
    $('#btn-sub-bulk-delete').onclick = async () => {
      if (subSelectedItems.size === 0) return;
      if (confirm(`Are you sure you want to delete ${subSelectedItems.size} items permanently?`)) {
        showToast(`Deleting ${subSelectedItems.size} items...`);
        for (const name of subSelectedItems) {
          await window.api.invoke('delete-subtitle-local', {
            profileName: currentProfile?.name || 'Default',
            libraryRoot: appData.libraryFolders?.[0] || '',
            fileName: name,
            subDir: subCurrentDir
          });
        }
        subSelectedItems.clear();
        updateSubMultiSelectUI();
        renderSubtitles();
      }
    };

    $('#btn-sub-clear-selection').onclick = () => {
      subSelectedItems.clear();
      updateSubMultiSelectUI();
      renderSubtitles();
    };
  }

  const subFileInput = $('#sub-file-input');
  if (subFileInput) {
    subFileInput.onchange = async (e) => {
      const files = e.target.files;
      if (!files.length) return;
      showToast(`Importing ${files.length} file(s) to current folder...`);
      for (const f of files) {
        await window.api.invoke('save-subtitle-local', {
          profileName: currentProfile?.name || 'Default',
          libraryRoot: appData.libraryFolders?.[0] || '',
          filePath: window.api.getFilePath(f),
          subDir: subCurrentDir // FIXED: Now uses current directory
        });
      }
      showToast('Subtitles imported');
      renderSubtitles();
    };
  }

  // ── Player Subtitle Studio Listeners ──
  $('#sub-style-size')?.addEventListener('input', applySubtitleStyles);
  $('#sub-style-bg')?.addEventListener('input', applySubtitleStyles);
  $('#btn-sub-bold')?.addEventListener('click', (e) => { e.currentTarget.classList.toggle('active'); applySubtitleStyles(); });
  const btnSubItalic = $('#btn-sub-italic');
  if (btnSubItalic) {
    btnSubItalic.innerHTML = '<i class="fas fa-italic"></i>';
    btnSubItalic.addEventListener('click', (e) => { e.currentTarget.classList.toggle('active'); applySubtitleStyles(); });
  }
  $('#btn-sub-shadow')?.addEventListener('click', (e) => { e.currentTarget.classList.toggle('active'); applySubtitleStyles(); });
  $('#btn-sub-sync-minus')?.addEventListener('click', () => adjustSubSync(-0.1));
  $('#btn-sub-sync-plus')?.addEventListener('click', () => adjustSubSync(0.1));

  const playerSubUpload = $('#player-sub-upload');
  if (playerSubUpload) {
    playerSubUpload.onchange = (e) => {
      if (e.target.files.length > 0) {
        loadSubtitleLocal(e.target.files[0].path);
      }
    };
  }

  // Subtitle Center Listeners
  $('#btn-sub-new-folder').onclick = () => {
    showCustomPrompt('New Folder', '', async (name) => {
      if (name && name.trim()) {
        const res = await window.api.invoke('create-subtitle-folder', {
          profileName: currentProfile?.name || 'Default',
          libraryRoot: appData.libraryFolders?.[0] || '',
          folderName: name.trim(),
          parentDir: subCurrentDir
        });
        if (res.success) { showToast('Folder created'); renderSubtitles(); }
        else showToast('Failed: ' + res.error);
      }
    });
  };

  $('#sub-file-input').onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    showToast(`Importing ${files.length} file(s)...`);
    for (const f of files) {
      await window.api.invoke('save-subtitle-local', {
        profileName: currentProfile?.name || 'Default',
        libraryRoot: appData.libraryFolders?.[0] || '',
        filePath: f.path,
        subDir: subCurrentDir
      });
    }
    renderSubtitles();
  };

  // Helper for Custom Prompt UI (Replaces unsupported window.prompt)
  function showCustomPrompt(title, defaultVal, onSave) {
    const overlay = $('#modal-prompt-overlay');
    const input = $('#modal-prompt-input');
    $('#modal-prompt-title').textContent = title;
    input.value = defaultVal;

    overlay.style.display = 'flex';
    setTimeout(() => { overlay.style.opacity = '1'; input.focus(); input.select(); }, 10);

    const close = () => {
      overlay.style.opacity = '0';
      setTimeout(() => { overlay.style.display = 'none'; }, 300);
      $('#btn-modal-prompt-save').onclick = null;
      $('#btn-modal-prompt-cancel').onclick = null;
    };

    $('#btn-modal-prompt-cancel').onclick = close;
    $('#btn-modal-prompt-save').onclick = () => {
      if (onSave) onSave(input.value);
      close();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') $('#btn-modal-prompt-save').click();
      if (e.key === 'Escape') close();
    };
  }
  async function renderPlayerSubLibrary() {
    const list = $('#player-sub-library-list');
    if (!list) return;

    const subs = await window.api.invoke('list-profile-subtitles', {
      profileName: currentProfile?.name || 'Default',
      libraryRoot: appData.libraryFolders?.[0] || '',
      subDir: playerSubCurrentDir
    });
    list.innerHTML = '';

    if (playerSubCurrentDir) {
      const back = document.createElement('div');
      back.className = 'subs-result-item';
      back.style = 'padding: 10px; border-radius: 8px; background: rgba(255,150,0,0.1); cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 10px; border: 1px dashed rgba(255,150,0,0.3);';
      back.innerHTML = `<i class="fas fa-arrow-left"></i> <span>Back to Parent</span>`;
      back.onclick = () => {
        const parts = playerSubCurrentDir.split(/[\\/]/);
        parts.pop();
        playerSubCurrentDir = parts.join('/');
        renderPlayerSubLibrary();
      };
      list.appendChild(back);
    }

    if ((!subs || subs.length === 0) && !playerSubCurrentDir) {
      list.innerHTML = '<div class="sidebar-empty-hint" style="font-size: 11px;">Library is empty. Add files in Subtitle Center.</div>';
      return;
    }

    subs.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'subs-result-item';
      item.style = 'box-sizing: border-box; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid transparent; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 10px; transition: all 0.2s;';

      const isDir = sub.isDir;
      const icon = isDir ? 'fa-folder' : 'fa-file-invoice';
      const color = isDir ? '#f59e0b' : 'inherit';
      item.innerHTML = `<i class="fas ${icon}" style="opacity:0.6; color:${color}"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sub.name}</span>`;


      const norm = p => (p || '').replace(/\\/g, '/').toLowerCase();
      if (!isDir && norm(window.activeSubtitlePath) === norm(sub.path)) {
        item.classList.add('active');
        item.style.background = 'rgba(79, 70, 229, 0.2)';
        item.style.border = '1px solid #4f46e5';
        item.innerHTML = `<i class="fas fa-check-circle" style="color: #4f46e5;"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700;">${sub.name}</span>`;
      }

      item.onclick = () => {
        if (isDir) {
          playerSubCurrentDir = playerSubCurrentDir ? playerSubCurrentDir + '/' + sub.name : sub.name;
          renderPlayerSubLibrary();
        } else {
          loadSubtitleLocal(sub.path);
        }
      };
      list.appendChild(item);
    });
  }

  $('#btn-vault').onclick = () => openVault();
  $('#vault-cancel').onclick = () => { $('#vault-modal').style.display = 'none'; resetPinInputs(); };
  $('#vault-confirm').onclick = handleVaultAuth;
  $('#ctx-lock').onclick = () => { if (contextTarget) toggleLock(contextTarget); $('#context-menu').style.display = 'none'; };

  // PIN Input auto-focus and behavior
  $$('.pin-digit').forEach((el, idx) => {
    el.oninput = () => {
      if (el.value.length === 1) {
        if (idx < 3) $$('.pin-digit')[idx + 1].focus();
        else handleVaultAuth(); // Auto-submit on 4th digit
      }
    };
    el.onkeydown = (e) => {
      if (e.key === 'Backspace') {
        if (!el.value && idx > 0) {
          $$('.pin-digit')[idx - 1].focus();
        }
      }
    };
  });




  $('#btn-select-folder').onclick = async () => {
    const f = await window.api.selectFolder();
    if (f && !appData.libraryFolders.includes(f)) {
      appData.libraryFolders.push(f);
      appData.libraryPath = f;
      const input = $('#folder-path');
      if (input) input.value = f;
      const rescanBtn = $('#btn-rescan');
      if (rescanBtn) rescanBtn.disabled = false;
      persist();
      renderSidebar();
      renderSettingsFolders();
      await scanLibrary();
    }
  };
  $('#btn-select-yt-folder').onclick = async () => {
    const f = await window.api.selectFolder();
    if (f) {
      appData.youtubeFolder = f;
      const input = $('#yt-folder-path');
      if (input) input.value = f;
      persist();
      await scanLibrary();
    }
  };


  const btnGlobalScan = $('#btn-global-scan');
  if (btnGlobalScan) {
    btnGlobalScan.onclick = async () => {
      btnGlobalScan.disabled = true;
      showToast('⏳ Starting Global Scan...');
      try {
        await scanLibrary();
        showToast('✅ Global Scan Complete');
      } catch (err) {
        showToast('❌ Scan Failed');
      } finally {
        btnGlobalScan.disabled = false;
      }
    };
  }



  const checkAndUnlockApp = async () => {
    document.body.classList.remove('api-setup-mode');
    const overlay = $('#api-onboarding-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('setup-active');
    }

    // Force app refresh
    appData.firstRun = false;
    persist();

    // Refresh UI
    if (typeof scanLibrary === 'function') scanLibrary();
    if (typeof renderLibrary === 'function') renderLibrary();
    if (typeof renderSidebar === 'function') renderSidebar();
    switchView('discover');
  };

  // --- ONBOARDING HANDLERS ---



  // ───────── STREMIO ADD-ONS STORE & MANAGER ─────────
  let stremioAddonsCatalog = [];
  let addonsActiveTab = 'store'; // 'store' or 'installed'

  const resolveAddonLogo = (addon) => {
    const isDeadDomain = (url) => {
      if (!url || typeof url !== 'string') return true;
      const dead = ['knightcrawler.elfhosted.com', 'subdl.strem.fun', 'mediafusion.elfhosted.com', 'cyberflix.elfhosted.com', 'anime-kitsu.strem.fun'];
      return dead.some(d => url.includes(d));
    };

    if (addon.icon && typeof addon.icon === 'string' && !isDeadDomain(addon.icon) && (addon.icon.startsWith('http') || addon.icon.startsWith('data:'))) {
      return addon.icon;
    }
    if (addon.logo && typeof addon.logo === 'string' && !isDeadDomain(addon.logo) && (addon.logo.startsWith('http') || addon.logo.startsWith('data:'))) {
      return addon.logo;
    }
    const u = (addon.url || addon.manifestUrl || '').toLowerCase();
    const name = (addon.name || '').toLowerCase();
    if (u.includes('cinemeta') || name.includes('cinemeta')) return 'https://v3-cinemeta.strem.io/logo.png';
    if (u.includes('torrentio') || name.includes('torrentio')) return 'https://torrentio.strem.fun/logo.png';
    if (u.includes('comet') || name.includes('comet')) return 'https://comet.feels.legal/logo.png';
    if (u.includes('tmdb') || name.includes('tmdb')) return 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/logo.png';
    if (u.includes('subtitles') || name.includes('opensubtitles')) return 'https://subtitles.strem.io/logo.png';
    if (u.includes('trakt') || name.includes('trakt')) return 'https://walter-2.trakt.tv/images/shows/000/001/390/posters/thumb/93df9e2172.jpg';
    return null;
  };

  const DEFAULT_COMMUNITY_ADDONS = [
    {
      id: 'org.stremio.cinemeta',
      name: 'Cinemeta',
      version: '3.0.12',
      description: 'Official metadata provider for Movies and TV Series with synopsis, cast, release dates, and posters.',
      url: 'https://v3-cinemeta.strem.io',
      manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json',
      icon: 'https://v3-cinemeta.strem.io/logo.png',
      types: ['movie', 'series'],
      category: 'catalogs'
    },
    {
      id: 'com.stremio.torrentio.lite',
      name: 'Torrentio (Lite)',
      version: '1.0.8',
      description: 'Ultra-fast torrent stream provider scraping high quality 4K, 1080p, 720p streams for Movies & TV Series.',
      url: 'https://torrentio.strem.fun/lite',
      manifestUrl: 'https://torrentio.strem.fun/lite/manifest.json',
      icon: 'https://torrentio.strem.fun/logo.png',
      types: ['movie', 'series'],
      category: 'movie'
    },
    {
      id: 'com.feels.comet',
      name: 'Comet',
      version: '1.2.0',
      description: 'High-performance Stremio addon providing real-time torrent stream links with debrid & P2P support.',
      url: 'https://comet.feels.legal',
      manifestUrl: 'https://comet.feels.legal/manifest.json',
      icon: 'https://comet.feels.legal/logo.png',
      types: ['movie', 'series'],
      category: 'movie'
    },
    {
      id: 'com.elfhosted.tmdb-addon',
      name: 'ElfHosted TMDB Addon',
      version: '2.1.0',
      description: 'Provides official TMDB movie & show catalogs and direct TMDB CDN posters without requiring API keys.',
      url: 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club',
      manifestUrl: 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json',
      icon: 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/logo.png',
      types: ['movie', 'series'],
      category: 'catalogs'
    },
    {
      id: 'com.knightcrawler.addon',
      name: 'KnightCrawler',
      version: '1.1.4',
      description: 'Reliable community torrent scraper for movies and TV series streams with high seed count filtering.',
      url: 'https://main.knightcrawler.elfhosted.com',
      manifestUrl: 'https://main.knightcrawler.elfhosted.com/manifest.json',
      icon: null,
      iconClass: 'fas fa-[#10b981] fa-shield-alt',
      types: ['movie', 'series'],
      category: 'movie'
    },
    {
      id: 'com.cyberflix.catalog',
      name: 'CyberFlix Catalog',
      version: '1.4.2',
      description: 'Adds streaming service catalogs (Netflix, Disney+, Apple TV+, HBO Max, Prime) directly to Discover.',
      url: 'https://cyberflix.elfhosted.com',
      manifestUrl: 'https://cyberflix.elfhosted.com/manifest.json',
      icon: null,
      iconClass: 'fas fa-tv',
      types: ['movie', 'series'],
      category: 'catalogs'
    },
    {
      id: 'com.stremio.subtitles.official',
      name: 'OpenSubtitles v3',
      version: '3.0.0',
      description: 'Official OpenSubtitles add-on fetching Arabic, English, and multi-language subtitles for any video.',
      url: 'https://subtitles.strem.io',
      manifestUrl: 'https://subtitles.strem.io/manifest.json',
      icon: 'https://subtitles.strem.io/logo.png',
      types: ['subtitles'],
      category: 'subtitles'
    },
    {
      id: 'com.subdl.stremio',
      name: 'SubDL Subtitles',
      version: '1.0.5',
      description: 'Dedicated SubDL subtitles provider for Arabic and global movie & series subtitles.',
      url: 'https://subdl.strem.fun',
      manifestUrl: 'https://subdl.strem.fun/manifest.json',
      icon: 'https://subdl.strem.fun/logo.png',
      types: ['subtitles'],
      category: 'subtitles'
    },
    {
      id: 'com.kitsu.anime',
      name: 'Anime Kitsu',
      version: '2.0.1',
      description: 'Anime metadata and episode discovery catalog powered by Kitsu.',
      url: 'https://anime-kitsu.strem.fun',
      manifestUrl: 'https://anime-kitsu.strem.fun/manifest.json',
      icon: 'https://anime-kitsu.strem.fun/logo.png',
      types: ['anime'],
      category: 'anime'
    },
    {
      id: 'com.mediafusion.addon',
      name: 'MediaFusion',
      version: '3.2.0',
      description: 'Live TV channels, sports streams, and international media catalogs.',
      url: 'https://mediafusion.elfhosted.com',
      manifestUrl: 'https://mediafusion.elfhosted.com/manifest.json',
      icon: 'https://mediafusion.elfhosted.com/logo.png',
      types: ['movie', 'series', 'tv'],
      category: 'catalogs'
    },
    {
      id: 'com.mediavault.youtube',
      name: 'YouTube',
      version: '1.0.0',
      description: 'Watch Trending & Recommended YouTube videos, stream with subtitles in player, and download to Social folder.',
      url: 'local://addon-youtube',
      manifestUrl: 'local://addon-youtube/manifest.json',
      icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/120px-YouTube_full-color_icon_%282017%29.svg.png',
      types: ['video', 'youtube', 'social'],
      category: 'youtube'
    }
  ];

  let supabaseAddonsCatalog = [];

  const loadSupabaseAddonsCatalog = async () => {
    try {
      if (window.supabase && typeof getSupabaseRendererClient === 'function') {
        const client = getSupabaseRendererClient();
        if (client) {
          const { data, error } = await client.from('stremio_addons').select('*');
          if (!error && Array.isArray(data) && data.length > 0) {
            console.log('[AddonStore] Loaded', data.length, 'addons from Supabase stremio_addons table');
            supabaseAddonsCatalog = data.map(item => ({
              id: item.id || item.addon_id || item.url,
              name: item.name || item.title || 'Add-on',
              version: item.version || '1.0.0',
              description: item.description || '',
              url: item.url || item.manifest_url,
              manifestUrl: item.manifest_url || item.url,
              icon: item.icon || item.logo,
              iconClass: item.iconClass || 'fas fa-puzzle-piece',
              iconColor: item.iconColor || 'var(--accent)',
              types: Array.isArray(item.types) ? item.types : (typeof item.types === 'string' ? JSON.parse(item.types) : ['movie', 'series']),
              category: item.category || 'movie'
            }));
          }
        }
      }
    } catch (e) {
      console.warn('[AddonStore] Supabase addons fetch error:', e.message);
    }
  };

  const initStremioAddonsUI = async () => {
    const pageGrid = $('#addons-page-grid') || $('#addon-store-grid');
    const pageSearch = $('#addons-page-search') || $('#addon-store-search');
    const pageFilter = $('#addons-page-filter') || $('#addon-store-filter');
    const pageCustomInput = $('#addon-custom-url-page-input') || $('#addon-custom-url-input');
    const pageBtnCustomInstall = $('#btn-install-custom-addon-page') || $('#btn-install-custom-addon');
    const pageCustomStatus = $('#custom-addon-page-status') || $('#custom-addon-status');
    const tabStore = $('#addons-tab-store');
    const tabInstalled = $('#addons-tab-installed');
    const installedBadge = $('#addons-installed-count-badge');

    if (!pageGrid) return;

    if (!appData.installedAddons) {
      appData.installedAddons = [];
    }

    const updateBadge = () => {
      const count = (appData.installedAddons || []).length;
      if (installedBadge) installedBadge.textContent = String(count);
    };

    const renderAddonsCatalog = () => {
      updateBadge();
      const query = pageSearch?.value.trim().toLowerCase() || '';
      const filter = pageFilter?.value || 'all';

      pageGrid.innerHTML = '';

      const installedNormalized = new Set((appData.installedAddons || []).map(a => normalizeAddonUrl(a.url)));
      // Always include built-in addons (YouTube, YouTube Music, etc.) even when Supabase catalog is loaded
      let baseCatalog = supabaseAddonsCatalog.length > 0 ? [...supabaseAddonsCatalog] : [...DEFAULT_COMMUNITY_ADDONS];
      if (supabaseAddonsCatalog.length > 0) {
        // Only append internal app addons (like local YouTube addon) when Supabase catalog is loaded
        DEFAULT_COMMUNITY_ADDONS.forEach(builtIn => {
          if (builtIn.url && builtIn.url.startsWith('local://')) {
            const alreadyIn = baseCatalog.some(a => normalizeAddonUrl(a.url) === normalizeAddonUrl(builtIn.url) || a.id === builtIn.id);
            if (!alreadyIn) baseCatalog.push(builtIn);
          }
        });
      }


      let itemsToRender = [];
      if (addonsActiveTab === 'installed') {
        itemsToRender = [...(appData.installedAddons || [])];
      } else {
        // 'store': Available Addons catalog
        itemsToRender = [...baseCatalog];
        (appData.installedAddons || []).forEach(inst => {
          if (!itemsToRender.some(c => normalizeAddonUrl(c.url) === normalizeAddonUrl(inst.url))) {
            itemsToRender.push(inst);
          }
        });
      }

      const filtered = itemsToRender.filter(addon => {
        // Search filter
        const name = (addon.name || '').toLowerCase();
        const desc = (addon.description || '').toLowerCase();
        if (query && !name.includes(query) && !desc.includes(query)) {
          return false;
        }

        // Category filter
        if (filter !== 'all') {
          const cat = (addon.category || '').toLowerCase();
          const types = (addon.types || []).map(t => String(t).toLowerCase());
          if (filter === 'movie') {
            return cat === 'movie' || types.some(t => t.includes('movie') || t.includes('series') || t.includes('tv'));
          }
          if (filter === 'anime') {
            return cat === 'anime' || types.some(t => t.includes('anime')) || (addon.url || '').includes('kitsu');
          }
          if (filter === 'subtitles') {
            return cat === 'subtitles' || types.some(t => t.includes('sub'));
          }
          if (filter === 'catalogs') {
            return cat === 'catalogs' || types.some(t => t.includes('catalog'));
          }
        }
        return true;
      });

      if (filtered.length === 0) {
        const msg = addonsActiveTab === 'installed'
          ? 'No add-ons installed yet. Switch to Available Addons tab or paste a manifest URL to install add-ons!'
          : 'No add-ons match your search or filter.';
        pageGrid.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); width: 100%;">
            <i class="fas fa-puzzle-piece" style="font-size: 36px; opacity: 0.3; margin-bottom: 12px; color: var(--accent);"></i>
            <div style="font-size: 14px; max-width: 360px; margin: 0 auto; line-height: 1.5;">${msg}</div>
          </div>
        `;
        return;
      }

      filtered.forEach(addon => {
        const isInstalled = installedNormalized.has(normalizeAddonUrl(addon.url));
        const card = document.createElement('div');
        card.className = 'addon-card';
        card.style.cssText = `
          background: rgba(255, 255, 255, 0.025);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid ${isInstalled ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 14px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 10px;
          min-height: auto;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          box-sizing: border-box;
          width: 100%;
        `;

        // Smart Logo Resolver
        const logoUrl = resolveAddonLogo(addon);
        let iconHtml = '';
        if (logoUrl) {
          iconHtml = `<div class="addon-card-icon" style="width: 44px; height: 44px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; padding: 2px; box-sizing: border-box;"><img src="${escapeHTML(logoUrl)}" style="width:100%; height:100%; object-fit:contain; border-radius: 8px;" onerror="this.onerror=null; this.parentNode.innerHTML='<i class=\\'fas fa-puzzle-piece\\' style=\\'color: var(--accent); font-size: 20px;\\'></i>';"></div>`;
        } else {
          const iconClass = addon.iconClass || 'fas fa-puzzle-piece';
          const iconColor = addon.iconColor || 'var(--accent)';
          iconHtml = `<div class="addon-card-icon" style="font-size: 20px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; flex-shrink: 0;"><i class="${iconClass}" style="color: ${iconColor};"></i></div>`;
        }

        // Action Column: Gear button + Install/Uninstall
        let actionColumnHtml = '';
        if (isInstalled) {
          actionColumnHtml = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <button class="btn-addon-configure" style="width: 32px; height: 32px; border-radius: 50%; background: #10b981; border: none; color: #fff; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: transform 0.2s;" title="Configure Add-on">
                <i class="fas fa-cog"></i>
              </button>
              <button class="btn-addon-uninstall" data-url="${addon.url}" style="background: transparent; border: none; color: rgba(239, 68, 68, 0.85); font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: color 0.2s;" title="Uninstall Add-on">
                Uninstall
              </button>
            </div>
          `;
        } else {
          actionColumnHtml = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <button class="btn-addon-install btn-primary" data-url="${addon.url}" style="padding: 6px 14px; border-radius: 16px; font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; gap: 5px; cursor: pointer;">
                <i class="fas fa-plus-circle"></i> Install
              </button>
            </div>
          `;
        }

        // Types subtitle formatting
        const rawTypes = addon.types || [];
        const typesStr = rawTypes.map(t => String(t).charAt(0).toUpperCase() + String(t).slice(1)).join(', ') || 'Movies, Series, Anime';

        card.innerHTML = `
          <div>
            <div style="display: flex; align-items: flex-start; gap: 12px; width: 100%;">
              ${iconHtml}
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%;">
                  <h4 style="font-size: 1rem; font-weight: 700; color: #fff; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;" title="${escapeHTML(addon.name)}">${escapeHTML(addon.name)}</h4>
                  <span style="font-size: 0.72rem; color: rgba(255, 255, 255, 0.45); font-family: monospace; flex-shrink: 0;">v${escapeHTML(addon.version || '1.0')}</span>
                </div>
                <div style="font-size: 0.76rem; color: rgba(255, 255, 255, 0.5); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHTML(typesStr)}
                </div>
              </div>
            </div>

            <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; margin: 8px 0 0 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; overflow-wrap: anywhere;" title="${escapeHTML(addon.description)}">
              ${escapeHTML(addon.description)}
            </p>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); width: 100%;">
            ${actionColumnHtml}
            <button class="btn-share-addon" data-url="${escapeHTML(addon.url || addon.manifestUrl || '')}" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.5); font-size: 0.76rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; padding: 0; transition: color 0.2s;" title="Share Addon Manifest">
              <i class="fas fa-share-alt" style="font-size: 11px;"></i> Share
            </button>
          </div>
        `;

        // Event listeners
        card.querySelector('.btn-addon-install')?.addEventListener('click', () => installAddon(addon));
        card.querySelector('.btn-addon-uninstall')?.addEventListener('click', () => uninstallAddon(addon.url));
        card.querySelector('.btn-addon-configure')?.addEventListener('click', () => {
          let configUrl = (addon.manifestUrl || addon.url || '').replace(/\/manifest\.json$/i, '');
          // Handle built-in local addons
          if (configUrl.startsWith('local://')) {
            if (addon.id === 'com.mediavault.youtube') {
              if (typeof window.openYouTubeSettingsModal === 'function') {
                window.openYouTubeSettingsModal();
              } else {
                switchView('discover');
                showToast('📺 YouTube Add-on Settings');
              }
            } else if (addon.id === 'com.mediavault.ytmusic') {
              switchView('music');
              showToast('🎵 YouTube Music is active — it appears in Music search & playback!');
            }
            return;
          }
          if (!configUrl.startsWith('http')) return;
          if (window.api && window.api.invoke) {
            window.api.invoke('open-external', configUrl);
          } else {
            window.open(configUrl, '_blank');
          }
        });
        card.querySelector('.btn-share-addon')?.addEventListener('click', (e) => {
          const shareUrl = e.currentTarget.dataset.url || addon.url;
          if (shareUrl) {
            navigator.clipboard.writeText(shareUrl).then(() => {
              showToast('📋 Addon manifest URL copied to clipboard!');
            }).catch(() => {
              showToast('📋 Link: ' + shareUrl, 5000);
            });
          }
        });

        pageGrid.appendChild(card);
      });
    };

    const _doInstallAddon = async (addon) => {
      showToast(`🧩 Installing ${addon.name}...`);
      if (!appData.installedAddons) appData.installedAddons = [];

      const normUrl = normalizeAddonUrl(addon.url);
      if (appData.installedAddons.some(a => normalizeAddonUrl(a.url) === normUrl)) {
        showToast('Add-on is already installed!');
        return;
      }

      const entry = {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        url: addon.url,
        manifestUrl: addon.manifestUrl || `${addon.url}/manifest.json`,
        icon: addon.icon,
        version: addon.version,
        types: addon.types,
        isCustom: addon.isCustom || false
      };

      appData.installedAddons.push(entry);
      await persist();
      updateSubdlVisibility();
      renderAddonsCatalog();
      if (typeof updateModGatedViews === 'function') updateModGatedViews();
      if (typeof loadDiscover === 'function') loadDiscover(true);
      if (typeof renderEmptySearchState === 'function') renderEmptySearchState();
      showToast(`✅ Installed ${addon.name} successfully!`);
    };

    const installAddon = async (addon) => {
      if (typeof window.showModInstallDisclaimer === 'function') {
        window.showModInstallDisclaimer(addon, () => _doInstallAddon(addon));
      } else {
        _doInstallAddon(addon);
      }
    };

    const uninstallAddon = async (url) => {
      if (!appData.installedAddons) return;
      const normTarget = normalizeAddonUrl(url);
      const idx = appData.installedAddons.findIndex(a => normalizeAddonUrl(a.url) === normTarget);
      if (idx !== -1) {
        const name = appData.installedAddons[idx].name;
        showToast(`🗑 Uninstalling ${name}...`);
        appData.installedAddons.splice(idx, 1);
        await persist();
        updateSubdlVisibility();
        renderAddonsCatalog();
        if (typeof updateModGatedViews === 'function') updateModGatedViews();
        if (typeof loadDiscover === 'function') loadDiscover(true);
        if (typeof renderEmptySearchState === 'function') renderEmptySearchState();
        showToast(`🗑 Uninstalled ${name} successfully!`);
      }
    };

    // Tab Buttons Handling (Available Addons vs My Addons)
    const setTabState = (tabKey) => {
      addonsActiveTab = tabKey;
      [
        { key: 'store', el: tabStore },
        { key: 'installed', el: tabInstalled }
      ].forEach(t => {
        if (!t.el) return;
        const badge = t.el.querySelector('#addons-installed-count-badge');
        if (t.key === tabKey) {
          t.el.classList.add('active');
          t.el.style.background = '#ffffff';
          t.el.style.borderColor = '#ffffff';
          t.el.style.color = '#0f0f13';
          t.el.style.boxShadow = '0 4px 15px rgba(255, 255, 255, 0.25)';
          if (badge) {
            badge.style.background = '#0f0f13';
            badge.style.color = '#ffffff';
          }
        } else {
          t.el.classList.remove('active');
          t.el.style.background = 'rgba(255, 255, 255, 0.05)';
          t.el.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          t.el.style.color = 'rgba(255, 255, 255, 0.7)';
          t.el.style.boxShadow = 'none';
          if (badge) {
            badge.style.background = 'rgba(255, 255, 255, 0.15)';
            badge.style.color = 'rgba(255, 255, 255, 0.9)';
          }
        }
      });
      renderAddonsCatalog();
    };

    if (tabStore) tabStore.onclick = () => setTabState('store');
    if (tabInstalled) tabInstalled.onclick = () => setTabState('installed');

    // Input & Filter Change Handlers
    pageSearch?.addEventListener('input', () => renderAddonsCatalog());
    pageFilter?.addEventListener('change', () => renderAddonsCatalog());

    // Custom Manifest URL Installer
    window.installAddonFromUrl = async (rawUrl) => {
      if (rawUrl.startsWith('stremio://')) {
        rawUrl = rawUrl.replace('stremio://', 'https://');
      }

      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        showToast('❌ Invalid URL! Must start with http or https');
        return false;
      }

      if (!rawUrl.endsWith('/manifest.json') && !rawUrl.endsWith('manifest.json')) {
        rawUrl = rawUrl.replace(/\/$/, '') + '/manifest.json';
      }

      try {
        console.log('[StremioStore] Loading custom manifest:', rawUrl);
        let manifest = null;
        if (window.api && window.api.invoke) {
          const proxyRes = await window.api.invoke('fetch-proxy', rawUrl);
          if (proxyRes && !proxyRes.error) {
            manifest = proxyRes;
          }
        }

        if (!manifest) {
          const resp = await fetch(rawUrl);
          if (!resp.ok) throw new Error('Network returned failure');
          manifest = await resp.json();
        }

        if (!manifest || !manifest.id || !manifest.name) {
          throw new Error('Invalid manifest structure. Missing ID or Name.');
        }

        let baseUrl = rawUrl;
        if (manifest.transportUrl && typeof manifest.transportUrl === 'string' && manifest.transportUrl.trim()) {
          baseUrl = manifest.transportUrl.trim().replace(/\/$/, '');
        } else if (rawUrl.toLowerCase().endsWith('/manifest.json')) {
          baseUrl = rawUrl.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
        }

        const newAddon = {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description || 'Custom user add-on',
          url: baseUrl,
          manifestUrl: rawUrl,
          icon: manifest.logo || manifest.icon || '🧩',
          version: manifest.version || '1.0.0',
          types: manifest.types || ['movie', 'series'],
          isCustom: true
        };

        await installAddon(newAddon);
        return true;
      } catch (err) {
        console.error('[StremioStore] Failed to install custom addon:', err.message);
        showToast('❌ Addon manifest unreachable or invalid.');
        return false;
      }
    };

    pageBtnCustomInstall?.addEventListener('click', async () => {
      let rawUrl = pageCustomInput?.value.trim();
      if (!rawUrl) {
        showToast('❌ Please enter a manifest URL first');
        return;
      }

      if (pageCustomStatus) {
        pageCustomStatus.textContent = 'Fetching manifest details...';
        pageCustomStatus.style.color = 'var(--text-muted)';
        pageCustomStatus.style.display = 'block';
      }

      const success = await window.installAddonFromUrl(rawUrl);
      if (success) {
        if (pageCustomInput) pageCustomInput.value = '';
        if (pageCustomStatus) pageCustomStatus.style.display = 'none';
      } else {
        if (pageCustomStatus) {
          pageCustomStatus.textContent = '❌ Failed to connect to manifest. Make sure URL is correct.';
          pageCustomStatus.style.color = '#ff5555';
        }
      }
    });

    await loadSupabaseAddonsCatalog();
    renderAddonsCatalog();
  };

  // ─── NATIVE TRAKT.TV INTEGRATION FUNCTIONS ───
  let _lastTraktScrobbleTime = 0;
  let activeSearchTab = 'unified'; // default

  const initTraktUI = async () => {
    const btnConnect = $('#btn-connect-trakt');
    const btnDisconnect = $('#btn-disconnect-trakt');
    const codeEl = $('#trakt-device-code');
    const disconnectedState = $('#trakt-disconnected-state');
    const connectingState = $('#trakt-connecting-state');
    const connectedState = $('#trakt-connected-state');

    if (!btnConnect) return;

    let pollInterval = null;

    const advToggle = $('#trakt-advanced-toggle');
    const setupBox = $('#trakt-credentials-setup');

    if (advToggle && setupBox) {
      advToggle.onclick = () => {
        if (setupBox.style.display === 'none') {
          setupBox.style.display = 'block';
          advToggle.style.color = 'var(--accent)';
        } else {
          setupBox.style.display = 'none';
          advToggle.style.color = 'var(--text-muted)';
        }
      };
    }

    window.setupEditLockInput = (inputId) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      
      let btn = input.parentElement.querySelector(`.btn-edit-lock[data-target="${inputId}"]`);
      if (!btn) {
        const parent = input.parentElement;
        const isFlexRow = parent.classList.contains('flex-row-wrapper') || (parent.style.display === 'flex' && parent.style.flexDirection !== 'column');
        
        let container = parent;
        if (!isFlexRow) {
          container = document.createElement('div');
          container.className = 'flex-row-wrapper';
          container.style.cssText = 'display: flex; gap: 8px; width: 100%; align-items: center;';
          input.parentNode.insertBefore(container, input);
          container.appendChild(input);
        }
        
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-edit-lock btn-ghost';
        btn.dataset.target = inputId;
        btn.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 8px; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; flex-shrink: 0;';
        btn.innerHTML = '<i class="fas fa-lock"></i>';
        container.appendChild(btn);
      }
      
      const updateState = () => {
        if (input.value.trim()) {
          input.readOnly = true;
          input.style.opacity = '0.65';
          btn.innerHTML = '<i class="fas fa-lock" title="Locked - Click Edit to change"></i>';
          btn.style.color = '#ffffff';
        } else {
          input.readOnly = false;
          input.style.opacity = '1';
          btn.innerHTML = '<i class="fas fa-lock-open" title="Unlocked"></i>';
          btn.style.color = '#ffffff';
        }
      };
      
      btn.onclick = () => {
        if (input.readOnly) {
          input.readOnly = false;
          input.style.opacity = '1';
          btn.innerHTML = '<i class="fas fa-edit" title="Editing..."></i>';
          btn.style.color = '#ffffff';
          input.focus();
          input.select();
        } else {
          input.readOnly = true;
          input.style.opacity = '0.65';
          btn.innerHTML = '<i class="fas fa-lock"></i>';
          btn.style.color = '#ffffff';
        }
      };

      
      input.addEventListener('change', updateState);
      updateState();
    };

    const updateTraktStatusUI = async () => {
      const creds = await window.api.invoke('trakt-connection-status');
      
      if (creds) {
        const inpId = $('#trakt-config-client-id');
        const inpSecret = $('#trakt-config-client-secret');
        if (inpId && creds.clientId) inpId.value = creds.clientId;
        if (inpSecret && creds.clientSecret) inpSecret.value = creds.clientSecret;
        if (typeof window.setupEditLockInput === 'function') {
          window.setupEditLockInput('trakt-config-client-id');
          window.setupEditLockInput('trakt-config-client-secret');
        }
      }

      if (creds && creds.connected) {
        disconnectedState.style.display = 'none';
        connectingState.style.display = 'none';
        connectedState.style.display = 'flex';
        if (setupBox) setupBox.style.display = 'none';
        if (advToggle) advToggle.style.display = 'none';
        // Show trakt search tab
        const traktTab = $('#btn-search-tab-trakt');
        if (traktTab) {
          traktTab.style.display = 'inline-block';
          traktTab.style.opacity = '1';
        }
      } else {
        disconnectedState.style.display = 'block';
        connectingState.style.display = 'none';
        connectedState.style.display = 'none';
        if (setupBox) setupBox.style.display = 'none';
        if (advToggle) {
          advToggle.style.display = 'flex';
          advToggle.style.color = 'var(--text-muted)';
        }
        // Faded trakt search tab when disconnected to prompt user interaction
        const traktTab = $('#btn-search-tab-trakt');
        if (traktTab) {
          traktTab.style.display = 'inline-block';
          traktTab.style.opacity = '0.6';
        }
      }
    };

    btnConnect.onclick = async () => {
      const clientId = $('#trakt-config-client-id')?.value.trim() || '';
      const clientSecret = $('#trakt-config-client-secret')?.value.trim() || '';

      if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
        showToast('⚠️ Please enter both Client ID and Client Secret, or leave both empty to use defaults.');
        return;
      }

      disconnectedState.style.display = 'none';
      connectingState.style.display = 'block';
      if (setupBox) setupBox.style.display = 'none';
      if (advToggle) advToggle.style.display = 'none';
      codeEl.textContent = 'LOADING...';

      try {
        const res = await window.api.invoke('trakt-get-auth-code', { clientId, clientSecret });
        console.log('[Trakt] Auth code response:', JSON.stringify(res));
        if (res && res.device_code) {
          codeEl.textContent = res.user_code;
          
          // Start Polling
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = setInterval(async () => {
            const pollRes = await window.api.invoke('trakt-check-auth-status', res.device_code);
            if (pollRes && pollRes.success) {
              clearInterval(pollInterval);
              showToast('✅ Trakt.tv successfully connected!');
              updateTraktStatusUI();
              // Sync watchlist immediately
              await syncTraktWatchlistToLocal();
              await syncTraktContinueWatching();
            } else if (pollRes && pollRes.error) {
              clearInterval(pollInterval);
              showToast('❌ Trakt authentication timed out. Please try again.');
              updateTraktStatusUI();
            }
          }, (res.interval || 5) * 1000);
        } else {
          const errMsg = (res && res.error) ? res.error : 'Unknown error';
          console.error('[Trakt] Failed to get auth code:', errMsg);
          showToast(`❌ Trakt.tv: ${errMsg}`);
          updateTraktStatusUI();
        }
      } catch (err) {
        console.error('[Trakt] Connection exception:', err);
        showToast(`❌ Error: ${err.message || 'Unknown error'}`);
        updateTraktStatusUI();
      }
    };

    btnDisconnect.onclick = async () => {
      if (confirm('Are you sure you want to disconnect Trakt.tv?')) {
        await window.api.invoke('trakt-disconnect');
        showToast('🗑 Trakt.tv disconnected.');
        updateTraktStatusUI();
      }
    };

    // Bind Search Tabs click listeners here to ensure they exist
    const tabUnified = $('#btn-search-tab-unified');
    const tabTrakt = $('#btn-search-tab-trakt');
    if (tabUnified && tabTrakt) {
      tabUnified.onclick = () => {
        activeSearchTab = 'unified';
        tabUnified.classList.add('active-tab');
        tabUnified.style.background = 'rgba(255,255,255,0.1)';
        tabUnified.style.color = '#fff';
        tabTrakt.classList.remove('active-tab');
        tabTrakt.style.background = 'none';
        tabTrakt.style.color = 'var(--text-muted)';
        performDiscoverSearch();
      };
      tabTrakt.onclick = async () => {
        const creds = await window.api.invoke('trakt-connection-status');
        if (!creds || !creds.connected) {
          showToast('⚠️ Please connect Trakt.tv in application Settings to search the Trakt catalog!');
          return;
        }
        activeSearchTab = 'trakt';
        tabTrakt.classList.add('active-tab');
        tabTrakt.style.background = 'rgba(255,255,255,0.1)';
        tabTrakt.style.color = '#fff';
        tabUnified.classList.remove('active-tab');
        tabUnified.style.background = 'none';
        tabUnified.style.color = 'var(--text-muted)';
        performDiscoverSearch();
      };
    }

    await updateTraktStatusUI();
  };

  // ─── SUBDL SUBTITLES NATIVE INTEGRATION ───
  function updateSubdlVisibility() {
    const btnPlayerSubdl = $('#btn-player-subdl');
    if (btnPlayerSubdl) {
      btnPlayerSubdl.style.display = ''; // ALWAYS SHOW SUBDL PLAYER BUTTON
    }
    const subdlCard = $('#subdl-connection-card');
    if (subdlCard) {
      subdlCard.style.display = 'block'; // ALWAYS SHOW SETTINGS CARD
    }
    return true; // Always return true
  }

  const initSubdlUI = () => {
    const apiKeyInput = $('#subdl-api-key');
    const verifyBtn = $('#btn-subdl-verify');
    const hiSelect = $('#subdl-hearing-impairment');
    const saveBtn = $('#btn-save-subdl');
    const container = $('#subdl-languages-container');
    const statusBadge = $('#subdl-status-badge');
    const statusIcon = $('#subdl-status-icon');
    const statusText = $('#subdl-status-text');
    const enabledToggle = $('#subdl-enabled-toggle');
    const configFields = $('#subdl-config-fields');

    updateSubdlVisibility();

    if (!saveBtn) return;

    // Toggle behavior (Always force-enabled and fields visible)
    if (enabledToggle) {
      enabledToggle.checked = true;
      if (configFields) {
        configFields.style.display = 'flex';
      }
      enabledToggle.onchange = async () => {
        enabledToggle.checked = true;
        if (configFields) {
          configFields.style.display = 'flex';
        }
        if (!appData.subdlConfig) appData.subdlConfig = {};
        appData.subdlConfig.enabled = true;
        await persist();
        updateSubdlVisibility();
      };
    }

    const SUBDL_LANGUAGES = [
      {label:"Arabic",value:"AR"},
      {label:"English",value:"EN"},
      {label:"French",value:"FR"},
      {label:"Spanish",value:"ES"},
      {label:"German",value:"DE"},
      {label:"Italian",value:"IT"},
      {label:"Portuguese",value:"PT"},
      {label:"Turkish",value:"TR"},
      {label:"Russian",value:"RU"},
      {label:"Albanian",value:"SQ"},
      {label:"Azerbaijani",value:"AZ"},
      {label:"Belarusian",value:"BE"},
      {label:"Bengali",value:"BN"},
      {label:"Big 5 code",value:"ZH_BG"},
      {label:"Bosnian",value:"BS"},
      {label:"Brazillian Portuguese",value:"BR_PT"},
      {label:"Bulgarian",value:"BG"},
      {label:"Bulgarian_English",value:"BG_EN"},
      {label:"Burmese",value:"MY"},
      {label:"Catalan",value:"CA"},
      {label:"Chinese BG code",value:"ZH"},
      {label:"Croatian",value:"HR"},
      {label:"Czech",value:"CS"},
      {label:"Danish",value:"DA"},
      {label:"Dutch",value:"NL"},
      {label:"Dutch_English",value:"NL_EN"},
      {label:"English_German",value:"EN_DE"},
      {label:"Esperanto",value:"EO"},
      {label:"Estonian",value:"ET"},
      {label:"Farsi_Persian",value:"FA"},
      {label:"Finnish",value:"FI"},
      {label:"Georgian",value:"KA"},
      {label:"Greek",value:"EL"},
      {label:"Greenlandic",value:"KL"},
      {label:"Hebrew",value:"HE"},
      {label:"Hindi",value:"HI"},
      {label:"Hungarian",value:"HU"},
      {label:"Hungarian_English",value:"HU_EN"},
      {label:"Icelandic",value:"IS"},
      {label:"Indonesian",value:"ID"},
      {label:"Japanese",value:"JA"},
      {label:"Korean",value:"KO"},
      {label:"Kurdish",value:"KU"},
      {label:"Latvian",value:"LV"},
      {label:"Lithuanian",value:"LT"},
      {label:"Macedonian",value:"MK"},
      {label:"Malay",value:"MS"},
      {label:"Malayalam",value:"ML"},
      {label:"Manipuri",value:"MNI"},
      {label:"Norwegian",value:"NO"},
      {label:"Polish",value:"PL"},
      {label:"Romanian",value:"RO"},
      {label:"Serbian",value:"SR"},
      {label:"Sinhalese",value:"SI"},
      {label:"Slovak",value:"SK"},
      {label:"Slovenian",value:"SL"},
      {label:"Swedish",value:"SV"},
      {label:"Tamil",value:"TA"},
      {label:"Telugu",value:"TE"},
      {label:"Thai",value:"TH"},
      {label:"Ukrainian",value:"UK"},
      {label:"Urdu",value:"UR"},
      {label:"Vietnamese",value:"VI"}
    ];

    // Render language checkboxes
    if (container) {
      const selectedLangs = appData.subdlConfig?.languages || ['AR', 'EN'];
      container.innerHTML = SUBDL_LANGUAGES.map(lang => {
        const isChecked = selectedLangs.includes(lang.value);
        const checkedAttr = isChecked ? 'checked' : '';
        const activeClass = isChecked ? 'active' : '';
        return `
          <label class="subdl-lang-badge ${activeClass}">
            <input type="checkbox" class="subdl-lang-chk" value="${lang.value}" ${checkedAttr}>
            <span>${lang.label}</span>
          </label>
        `;
      }).join('');

      container.querySelectorAll('.subdl-lang-chk').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const label = e.target.closest('.subdl-lang-badge');
          if (label) {
            if (e.target.checked) {
              label.classList.add('active');
            } else {
              label.classList.remove('active');
            }
          }
        });
      });
    }

    const updateStatusBadge = (status, errorMsg = '') => {
      if (!statusBadge) return;
      statusBadge.style.display = 'flex';
      if (status === 'valid') {
        statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
        statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        statusBadge.style.color = '#10b981';
        statusIcon.className = 'fas fa-check-circle';
        statusText.textContent = 'API Key is Valid!';
      } else if (status === 'invalid') {
        statusBadge.style.background = 'rgba(239, 68, 68, 0.1)';
        statusBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusBadge.style.color = '#ef4444';
        statusIcon.className = 'fas fa-times-circle';
        statusText.textContent = 'Invalid API Key: ' + (errorMsg || 'Failed verification');
      } else if (status === 'verifying') {
        statusBadge.style.background = 'rgba(255, 255, 255, 0.05)';
        statusBadge.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        statusBadge.style.color = 'var(--text-muted)';
        statusIcon.className = 'fas fa-spinner fa-spin';
        statusText.textContent = 'Verifying key...';
      } else {
        statusBadge.style.display = 'none';
      }
    };

    // Load initial values
    if (apiKeyInput && appData.subdlConfig?.apiKey) {
      apiKeyInput.value = appData.subdlConfig.apiKey;
      updateStatusBadge('valid');
    } else {
      updateStatusBadge('none');
    }

    if (hiSelect && appData.subdlConfig?.hearingImpairment) {
      hiSelect.value = appData.subdlConfig.hearingImpairment;
    }

    if (typeof window.setupEditLockInput === 'function') {
      window.setupEditLockInput('subdl-api-key');
    }

    // Verify key action
    if (verifyBtn) {
      verifyBtn.onclick = async () => {
        const key = apiKeyInput?.value.trim() || '';
        if (!key) {
          showToast('⚠️ Please enter an API key to verify.');
          return;
        }

        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        updateStatusBadge('verifying');

        try {
          const res = await window.api.invoke('subdl-verify-key', key);
          if (res && res.success) {
            updateStatusBadge('valid');
            showToast('✅ SubDL API Key successfully verified!');
          } else {
            const errDetail = res?.error || 'Failed verification';
            updateStatusBadge('invalid', errDetail);
            showToast(`❌ Failed to verify SubDL API Key: ${errDetail}`);
          }
        } catch (err) {
          console.error('[SubDL] Verification error:', err);
          updateStatusBadge('invalid', err.message);
          showToast('❌ Error verifying API key.');
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }
      };
    }

    // Save configuration action
    saveBtn.onclick = async () => {
      if (!appData.subdlConfig) appData.subdlConfig = {};
      appData.subdlConfig.enabled = true; // Always enabled

      const apiKey = apiKeyInput?.value.trim() || '';
        if (!apiKey) {
          showToast('⚠️ API Key is required.');
          return;
        }

        const selectedLangs = Array.from(container.querySelectorAll('.subdl-lang-chk:checked')).map(el => el.value);
        if (selectedLangs.length === 0) {
          showToast('⚠️ Please select at least one language.');
          return;
        }

        const hearingImpairment = hiSelect?.value || 'hiInclude';

        appData.subdlConfig.apiKey = apiKey;
        appData.subdlConfig.languages = selectedLangs;
        appData.subdlConfig.hearingImpairment = hearingImpairment;

      // Guarantee appData.installedAddons exists
      if (!appData.installedAddons) appData.installedAddons = [];

      // Clean up legacy OpenSubtitles or old SubDL addons
      appData.installedAddons = appData.installedAddons.filter(addon => {
        const url = String(addon?.url || addon?.manifestUrl || '').toLowerCase();
        const id = String(addon?.id || '').toLowerCase();
        const name = String(addon?.name || '').toLowerCase();
        const isLegacyOpenSubs = url.includes('opensubtitles') || id.includes('opensubtitles') || name.includes('opensubtitles');
        const isOldSubdl = url.includes('subdl') || id.includes('subdl') || name.includes('subdl');
        return !isLegacyOpenSubs && !isOldSubdl;
      });

      await persist(); // Save to local storage JSON + sync to database
      updateSubdlVisibility();

      showToast('✅ SubDL Subtitles configured successfully!');
      
      // Update catalog store UI
      if (typeof initStremioAddonsUI === 'function') {
        initStremioAddonsUI();
      }
    };
  };

  // ─── TMDB API KEY NATIVE INTEGRATION ───
  const initTmdbUI = () => {
    const apiKeyInput = $('#tmdb-api-key');
    const verifyBtn = $('#btn-tmdb-verify');
    const saveBtn = $('#btn-save-tmdb');
    const statusBadge = $('#tmdb-status-badge');
    const statusIcon = $('#tmdb-status-icon');
    const statusText = $('#tmdb-status-text');
    const enabledToggle = $('#tmdb-enabled-toggle');
    const configFields = $('#tmdb-config-fields');

    if (!saveBtn) return;

    const updateStatusBadge = (status, errorMsg = '') => {
      if (!statusBadge) return;
      statusBadge.style.display = 'flex';
      if (status === 'valid') {
        statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
        statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        statusBadge.style.color = '#10b981';
        statusIcon.className = 'fas fa-check-circle';
        statusText.textContent = 'API Key is Valid!';
      } else if (status === 'invalid') {
        statusBadge.style.background = 'rgba(239, 68, 68, 0.1)';
        statusBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusBadge.style.color = '#ef4444';
        statusIcon.className = 'fas fa-times-circle';
        statusText.textContent = 'Invalid API Key: ' + (errorMsg || 'Failed verification');
      } else if (status === 'verifying') {
        statusBadge.style.background = 'rgba(255, 255, 255, 0.05)';
        statusBadge.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        statusBadge.style.color = 'var(--text-muted)';
        statusIcon.className = 'fas fa-spinner fa-spin';
        statusText.textContent = 'Verifying key...';
      } else {
        statusBadge.style.display = 'none';
      }
    };

    // Load initial values
    if (apiKeyInput && appData.tmdbKey) {
      apiKeyInput.value = appData.tmdbKey;
      updateStatusBadge('valid');
    } else {
      updateStatusBadge('none');
    }

    if (enabledToggle) {
      enabledToggle.checked = appData.tmdbEnabled !== false;
      if (configFields) {
        configFields.style.display = enabledToggle.checked ? 'flex' : 'none';
      }
      enabledToggle.onchange = () => {
        appData.tmdbEnabled = enabledToggle.checked;
        if (configFields) {
          configFields.style.display = enabledToggle.checked ? 'flex' : 'none';
        }
        persist();
      };
    }

    if (typeof window.setupEditLockInput === 'function') {
      window.setupEditLockInput('tmdb-api-key');
    }

    // Verify key action
    if (verifyBtn) {
      verifyBtn.onclick = async () => {
        const key = apiKeyInput?.value.trim() || '';
        if (!key) {
          showToast('⚠️ Please enter an API key to verify.');
          return;
        }

        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        updateStatusBadge('verifying');

        try {
          const res = await window.api.invoke('tmdb-verify-key', key);
          if (res && res.success) {
            updateStatusBadge('valid');
            showToast('✅ TMDB API Key successfully verified!');
          } else {
            const errDetail = res?.error || 'Failed verification';
            updateStatusBadge('invalid', errDetail);
            showToast(`❌ Failed to verify TMDB API Key: ${errDetail}`);
          }
        } catch (err) {
          console.error('[TMDB] Verification error:', err);
          updateStatusBadge('invalid', err.message);
          showToast('❌ Error verifying API key.');
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify';
        }
      };
    }

    // Save key action
    saveBtn.onclick = async () => {
      const apiKey = apiKeyInput?.value.trim() || '';
      if (!apiKey) {
        showToast('⚠️ TMDB API Key is required to save.');
        return;
      }

      appData.tmdbKey = apiKey;
      appData.tmdbImageOverride = true;
      appData.tmdbImageScope = 'both';
      persist(); // Save to local storage JSON
      showToast('✅ TMDB API Key saved successfully!');
    };
  };

  async function syncTraktWatchlistToLocal() {
    if (!currentProfile) return;
    const creds = await window.api.invoke('trakt-connection-status');
    if (!creds || !creds.connected) return;

    try {
      console.log('[Trakt] Performing bidirectional watchlist sync...');
      const traktList = await window.api.invoke('trakt-sync-watchlist');
      if (traktList && Array.isArray(traktList)) {
        const localWatchlist = (currentProfile.watchlist || []).map(item => {
          if (typeof item === 'string') {
            return {
              id: item,
              imdb_id: item.startsWith('tt') ? item : undefined,
              title: item,
              name: item,
              type: 'movie',
              poster: '',
              source: 'local',
              listedAt: Date.now()
            };
          }
          return item;
        });
        const merged = [...localWatchlist];

        for (const tItem of traktList) {
          const type = tItem.type; // 'movie' or 'show'
          const detail = tItem[type];
          if (!detail) continue;

          const imdbId = detail.ids?.imdb;
          if (!imdbId) continue;

          const listedAtTime = new Date(tItem.listed_at || tItem.listing_at || Date.now()).getTime();

          // Check if already in local watchlist
          const localIndex = merged.findIndex(l => {
            const lImdb = l.id || l.imdb_id || l.imdbId;
            return lImdb === imdbId;
          });

          if (localIndex === -1) {
            // Convert Trakt item format to standard MediaVault card format
            merged.push({
              id: imdbId,
              imdb_id: imdbId,
              title: detail.title,
              name: detail.title,
              type: type === 'show' ? 'series' : 'movie',
              year: detail.year || '',
              rating: detail.rating || 0,
              poster: '', // Will fall back to Cinemeta poster fetching dynamically in UI
              source: 'trakt',
              listedAt: listedAtTime
            });
          } else {
            // Update listedAt & source if missing/older
            if (!merged[localIndex].listedAt || merged[localIndex].source !== 'trakt') {
              merged[localIndex].listedAt = listedAtTime;
              merged[localIndex].source = 'trakt';
            }
          }
        }

        // Upload local items to Trakt if they are NOT on Trakt (complete bidirectional sync)
        for (const lItem of localWatchlist) {
          const cache = (appData.tmdbCache || {})[lItem.id] || {};
          const lImdb = lItem.imdb_id || lItem.imdbId || cache.imdb_id || cache.imdbId || (String(lItem.id).startsWith('tt') ? lItem.id : null);
          if (lImdb && String(lImdb).startsWith('tt')) {
            const onTrakt = traktList.some(t => {
              const type = t.type;
              return t[type]?.ids?.imdb === lImdb;
            });
            if (!onTrakt) {
              await window.api.invoke('trakt-toggle-watchlist', {
                action: 'add',
                item: {
                  type: lItem.type === 'series' || lItem.type === 'tv' ? 'show' : 'movie',
                  imdbId: lImdb
                }
              });
            }
          }
        }

        // Ensure all items have a listedAt timestamp for stable sorting
        merged.forEach((item, index) => {
          if (!item.listedAt) {
            item.listedAt = Date.now() - index * 1000;
          }
        });

        // Sort descending (newest first)
        merged.sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0));

        currentProfile.watchlist = merged;
        persist();
        if (currentView === 'watchlist') renderWatchlist();
      }
    } catch (err) {
      console.error('[Trakt] Watchlist sync failed:', err.message);
    }
  }

  async function syncTraktContinueWatching() {
    if (!currentProfile) return;
    const creds = await window.api.invoke('trakt-connection-status');
    if (!creds || !creds.connected) return;

    try {
      console.log('[Trakt] Syncing continue watching progress...');
      const traktProgress = await window.api.invoke('trakt-playback-progress');
      if (traktProgress && Array.isArray(traktProgress)) {
        if (!currentProfile.playback) currentProfile.playback = {};
        let updatedAny = false;

        for (const tp of traktProgress) {
          const type = tp.type; // 'movie' or 'episode'
          const detail = tp[type];
          if (!detail) continue;

          let imdbId = null;
          let season = 1;
          let episode = 1;

          if (type === 'movie') {
            imdbId = detail.ids?.imdb;
          } else {
            imdbId = tp.show?.ids?.imdb;
            season = detail.season || 1;
            episode = detail.number || 1;
          }

          if (!imdbId) continue;

          const targetKey = type === 'movie' ? imdbId : `${imdbId}_S${season}E${episode}`;

          let localEntry = currentProfile.playback[targetKey];
          if (!localEntry) {
            const foundKey = Object.keys(currentProfile.playback).find(k => {
              const meta = currentProfile.playback[k].meta || {};
              const mImdb = meta.id || meta.imdb_id || meta.imdbId;
              if (type === 'movie') return mImdb === imdbId;
              return mImdb === imdbId && meta.season === season && meta.episode === episode;
            });
            if (foundKey) {
              localEntry = currentProfile.playback[foundKey];
            }
          }

          const traktTime = new Date(tp.paused_at || Date.now()).getTime();
          if (localEntry) {
            const localTime = localEntry.lastWatched || 0;
            // Enrich metadata if it is missing
            if (!localEntry.meta) {
              localEntry.meta = {
                id: imdbId,
                showName: type === 'movie' ? undefined : tp.show?.title,
                title: type === 'movie' ? detail.title : (detail.title || `Episode ${episode}`),
                type: type === 'movie' ? 'movie' : 'series',
                season: type === 'movie' ? undefined : season,
                episode: type === 'movie' ? undefined : episode
              };
              localEntry.source = 'trakt';
              updatedAny = true;
            }
            // Only overwrite if Trakt is newer by at least 2 seconds
            if (traktTime > localTime + 2000) {
              const dur = localEntry.duration || (type === 'movie' ? 7200 : 2700);
              const computedTime = (tp.progress / 100) * dur;
              localEntry.time = computedTime;
              localEntry.lastWatched = traktTime;
              localEntry.watched = tp.progress > 90;
              updatedAny = true;
              console.log(`[Trakt] Updated local entry ${targetKey} from Trakt (Trakt is newer: ${traktTime} > ${localTime})`);
            } else {
              console.log(`[Trakt] Kept local entry ${targetKey} (Local is newer or same: ${localTime} >= ${traktTime})`);
            }
          } else {
            const dur = type === 'movie' ? 7200 : 2700;
            const computedTime = (tp.progress / 100) * dur;
            currentProfile.playback[targetKey] = {
              time: computedTime,
              duration: dur,
              lastWatched: traktTime,
              watched: tp.progress > 90,
              source: 'trakt',
              meta: {
                id: imdbId,
                showName: type === 'movie' ? undefined : tp.show?.title,
                title: type === 'movie' ? detail.title : (detail.title || `Episode ${episode}`),
                type: type === 'movie' ? 'movie' : 'series',
                season: type === 'movie' ? undefined : season,
                episode: type === 'movie' ? undefined : episode
              }
            };
            updatedAny = true;
            console.log(`[Trakt] Created local entry ${targetKey} from Trakt (not found locally)`);
          }
        }
        if (updatedAny) {
          persist();
          // Dynamic UI Refresh when background Trakt sync finishes
          if (typeof renderContinueWatchingDiscover === 'function' && currentView === 'discover') {
            renderContinueWatchingDiscover();
          }
          if (typeof renderLibContinueWatching === 'function' && currentView === 'library') {
            renderLibContinueWatching();
          }
        }
      }
    } catch (err) {
      console.error('[Trakt] Sync continue watching failed:', err.message);
    }
  }

  async function scrobbleToTrakt(action, customProgress) {
    if (!currentItem) return;
    const pbKey = getPlaybackKey(currentItem);
    const cachedMeta = (appData.tmdbCache || {})[pbKey] || {};
    const imdbId = currentItem.id || currentItem.imdbId || currentItem.imdb_id || cachedMeta.imdb_id || cachedMeta.imdbId;
    if (!imdbId || !String(imdbId).startsWith('tt')) return;

    const creds = await window.api.invoke('trakt-connection-status');
    if (!creds || !creds.connected) return;

    const time = engine.currentTime || 0;
    const dur = engine.duration || 1;
    const progressPercent = customProgress !== undefined ? customProgress : Math.min((time / dur) * 100, 100);

    if (action === 'progress') {
      const now = Date.now();
      if (now - _lastTraktScrobbleTime < 10000) return; // 10s throttle
      _lastTraktScrobbleTime = now;
      action = 'start';
    }

    try {
      console.log(`[Trakt Scrobble] Sending action=${action} progress=${progressPercent.toFixed(1)}%`);
      await window.api.invoke('trakt-scrobble-event', {
        action,
        media: {
          type: currentItem.type === 'series' || currentItem.type === 'tv' ? 'show' : 'movie',
          imdbId: imdbId,
          title: currentItem.title,
          season: currentItem.season || 1,
          episode: currentItem.episode || 1
        },
        progress: progressPercent
      });
    } catch (e) {
      console.warn('[Trakt Scrobble] Error:', e.message);
    }
  }

  const unsubLibraryUpdated = window.api.onLibraryUpdated(() => scanLibrary());


  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (typeof unsubLibraryUpdated === 'function') unsubLibraryUpdated();
  });

  // Sleep Clock Updater
  setInterval(() => {
    const clock = $('#sleep-clock');
    if (clock && $('#sleep-overlay').style.display !== 'none') {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      clock.textContent = `${h}:${m}:${s}`;
    }
  }, 1000);

  $('#btn-close-subs')?.addEventListener('click', (e) => { e.stopPropagation(); closeSidePanel(); });
  // Removed redundant btn-audio-tracks listener (consolidated at bottom)

  const btnCloseTracks = $('#btn-close-tracks');
  if (btnCloseTracks) btnCloseTracks.addEventListener('click', () => closeSidePanel());
  // Player
  $('#btn-play-pause').onclick = () => { engine.togglePause(); };

  // Art/Video Toggle Listeners
  const playerMusicToggle = $('#player-music-toggle');
  const btnArt = $('#btn-player-art');
  const btnVideo = $('#btn-player-video');
  const musicPoster = $('#music-poster-container');

  if (btnArt && btnVideo) {
    btnArt.onclick = () => {
      btnArt.classList.add('active');
      btnVideo.classList.remove('active');
      musicPoster.style.display = 'flex';
    };
    btnVideo.onclick = () => {
      btnVideo.classList.add('active');
      btnArt.classList.remove('active');
      musicPoster.style.display = 'none';
    };
  }
  $('#btn-skip-back').onclick = () => { engine.seekRelative(-10); };
  $('#btn-skip-forward').onclick = () => { engine.seekRelative(10); };
  if ($('#btn-fullscreen')) $('#btn-fullscreen').onclick = toggleFullscreen;
  $('#btn-pip').onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); } catch (e) { console.warn('[PiP] Picture-in-Picture failed:', e.message); showToast('PiP not supported on this video'); } };
  video.addEventListener('enterpictureinpicture', () => $('#btn-pip').classList.add('subtitle-on'));
  video.addEventListener('leavepictureinpicture', () => $('#btn-pip').classList.remove('subtitle-on'));
  $('#btn-mute').onclick = () => { engine.setMute(!engine.muted); updateVolumeIcon(); };
  if ($('#btn-back-shows')) $('#btn-back-shows').onclick = () => switchView('shows');
  if ($('#btn-back-discover')) {
    $('#btn-back-discover').onclick = () => {
      if (prevView && prevView !== 'discover-detail') switchView(prevView);
      else switchView('discover');
    };
  }

  // Discover Sidebar Toggle
  const btnDiscoverSidebar = $('#btn-discover-sidebar');
  if (btnDiscoverSidebar) {
    btnDiscoverSidebar.onclick = () => {
      $('#view-discover').classList.toggle('sidebar-collapsed');
    };
  }
  // Hide native Capacitor splash screen after the extended splash duration
  if (window.Capacitor?.Plugins?.SplashScreen) {
    setTimeout(() => {
      try { window.Capacitor.Plugins.SplashScreen.hide(); } catch (e) { console.warn('Splash hide failed:', e); }
    }, 12000); // match extended splash (12s)
  }

  // Long-press helper for subtitles
  let subLongPressTimer;
  let wasLongPress = false;
  const subBtn = $('#btn-subtitle');

  subBtn.onmousedown = subBtn.ontouchstart = (e) => {
    wasLongPress = false;
    if (!subtitlesEnabled) return;
    subLongPressTimer = setTimeout(() => {
      // Long press detected: Turn OFF subtitles
      wasLongPress = true;
      if (engine.isUsingMpv) switchSubtitleTrack('no');
      else {
        Array.from(video.textTracks).forEach(track => {
          track.mode = 'hidden';
          track.mode = 'disabled';
        });
        video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
        try { removeSubtitleOverlay(); } catch (e) { }
        subtitlesEnabled = false;
        window.activeSubtitlePath = null;
        window.activeSubtitleUrl = null;
        renderPlayerSubLibrary();
        subBtn.classList.remove('subtitle-on');
        subBtn.classList.add('subtitle-off');
      }
      showToast('Subtitles Off');
      subLongPressTimer = null;
    }, 800); // 800ms for long press
  };

  subBtn.onmouseup = subBtn.onmouseleave = subBtn.ontouchend = () => {
    if (subLongPressTimer) {
      clearTimeout(subLongPressTimer);
      subLongPressTimer = null;
    }
  };

  subBtn.addEventListener('click', () => {
    // If we just finished a long press, don't trigger click
    if (wasLongPress) {
      wasLongPress = false;
      return;
    }

    renderPlayerSubLibrary();
    openPanel('#player-subs-panel');
  });
  $('#btn-toggle-playlist')?.addEventListener('click', () => openPanel('#player-side-panel'));
  $('#btn-close-panel')?.addEventListener('click', closeSidePanel);

  // Mini player
  $('#mp-btn-play-pause').onclick = (e) => { e.stopPropagation(); engine.togglePause(); };
  $('#mp-btn-close').onclick = (e) => { e.stopPropagation(); engine.stop(); $('#mini-player').style.display = 'none'; exitPlayer(false); };
  $('#mini-player').onclick = (e) => {
    $('#player-wrapper').classList.remove('is-music-mode');

    // Hide cinematic overlay if present so player is visible
    if (typeof window.closeUnifiedDetail === 'function' && currentView !== 'player') {
      window.closeUnifiedDetail(true);
    }

    // Ensure playing-mode is active when restoring player from mini-player
    document.body.classList.add('playing-mode');
    switchView('player');
  };

  // Volume & Seek
  $('#volume-bar').oninput = () => {
    const vbar = $('#volume-bar');
    if (vbar) { engine.setVolume(parseInt(vbar.value)); updateVolumeIcon(); }
  };
  const seekBar = $('#seek-bar');
  let lastSeekTime = 0;
  let seekThrottleTimeout = null;

  function applySeekThrottled(targetTime) {
    if (Date.now() - lastSeekTime > 150) {
      lastSeekTime = Date.now();
      engine.seek(targetTime);
    } else {
      clearTimeout(seekThrottleTimeout);
      seekThrottleTimeout = setTimeout(() => {
        lastSeekTime = Date.now();
        engine.seek(targetTime);
      }, 150);
    }
  }

  seekBar.onmousedown = () => { isSeeking = true; };
  seekBar.oninput = () => {
    const dur = engine.duration;
    if (!dur || isNaN(dur)) { return; }
    isSeeking = true; // Safety trigger
    const val = parseFloat(seekBar.value) || 0;
    const targetTime = (val / 1000) * dur;

    // Instant Visual Feedback
    updateSeekFill((val / 1000) * 100);
    updateTimeDisplay(targetTime);

    // Throttled Seek for Stability
    if (!isNaN(targetTime)) applySeekThrottled(targetTime);
  };
  seekBar.onmouseup = seekBar.ontouchend = () => {
    // Final definitive seek on release
    const dur = engine.duration;
    if (dur) {
      const targetTime = (seekBar.value / 1000) * dur;
      engine.seek(targetTime);
    }
    // CRITICAL: Delay clearing isSeeking so mpv has time to reach
    // the new position before we accept its time-pos updates again.
    // Without this, the old pre-seek time overwrites the bar immediately.
    setTimeout(() => { isSeeking = false; }, 500);
  };

  // --- Video Chapter Thumbnails ---
  const seekThumbnailPopup = $('#seek-thumbnail-popup');
  const seekThumbnailImg = $('#seek-thumbnail-img');
  const seekThumbnailTime = $('#seek-thumbnail-time');
  const seekBarWrap = document.querySelector('#player-controls .seek-bar-wrap');
  
  window.hoverThumbnailTrack = null; // Array of {start, end, url, x, y, w, h}
  let hoverDebounceTimeout = null;

  window.parseThumbnailsVTT = async function(vttUrl) {
    try {
      const res = await fetch(vttUrl);
      const text = await res.text();
      const lines = text.split('\n');
      const track = [];
      let currentCue = null;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes('-->')) {
          const parts = line.split('-->');
          currentCue = {
            start: parseVttTime(parts[0].trim()),
            end: parseVttTime(parts[1].trim())
          };
        } else if (line && currentCue && !line.startsWith('WEBVTT')) {
          // e.g., sprite.jpg#xywh=0,0,160,90
          const urlParts = line.split('#xywh=');
          currentCue.url = urlParts[0];
          if (urlParts.length > 1) {
            const [x, y, w, h] = urlParts[1].split(',').map(Number);
            currentCue.x = x; currentCue.y = y; currentCue.w = w; currentCue.h = h;
          }
          track.push(currentCue);
          currentCue = null;
        }
      }
      window.hoverThumbnailTrack = track;
    } catch (err) {
      console.warn('[Thumbnails] Failed to parse VTT:', err.message);
      window.hoverThumbnailTrack = null;
    }
  };

  function parseVttTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(timeStr) || 0;
  }

  if (seekBarWrap && seekThumbnailPopup) {
    seekBarWrap.addEventListener('mousemove', (e) => {
      const dur = engine.duration;
      if (!dur || isNaN(dur)) return;
      
      const rect = seekBarWrap.getBoundingClientRect();
      let percent = (e.clientX - rect.left) / rect.width;
      percent = Math.max(0, Math.min(1, percent));
      const hoverTime = percent * dur;
      
      seekThumbnailPopup.style.display = 'flex';
      seekThumbnailPopup.style.opacity = '1';
      // Center popup over cursor, bound to edges
      const popupWidth = 168; // approx width including padding
      const maxLeft = rect.width - (popupWidth / 2);
      const minLeft = popupWidth / 2;
      const calcLeft = percent * rect.width;
      const boundedLeft = Math.max(minLeft, Math.min(maxLeft, calcLeft));
      seekThumbnailPopup.style.left = `${(boundedLeft / rect.width) * 100}%`;
      
      seekThumbnailTime.textContent = formatTime(hoverTime);

      const imgWrap = seekThumbnailImg.parentElement;

      if (window.hoverThumbnailTrack && window.hoverThumbnailTrack.length > 0) {
        const cue = window.hoverThumbnailTrack.find(c => hoverTime >= c.start && hoverTime <= c.end);
        if (cue) {
          imgWrap.style.display = 'block';
          seekThumbnailImg.style.backgroundImage = `url('${cue.url}')`;
          if (cue.w && cue.h) {
            seekThumbnailImg.style.backgroundPosition = `-${cue.x}px -${cue.y}px`;
            seekThumbnailImg.style.width = `${cue.w}px`;
            seekThumbnailImg.style.height = `${cue.h}px`;
            imgWrap.style.width = `${cue.w}px`;
            imgWrap.style.height = `${cue.h}px`;
          } else {
            seekThumbnailImg.style.backgroundPosition = 'center';
            seekThumbnailImg.style.width = '100%';
            seekThumbnailImg.style.height = '100%';
          }
          return;
        }
      }

      // Fallback: hide image wrap by default until we have something to show
      imgWrap.style.display = 'none';
      seekThumbnailImg.style.backgroundImage = 'none'; // clear stale image

      // Fallback: Dynamic Extraction
      clearTimeout(hoverDebounceTimeout);
      hoverDebounceTimeout = setTimeout(() => {
        if (window.generateVideoThumbnail && engine && engine.url) {
          if (engine.url.includes('http://127.0.0.1:') && engine.url.includes('/stream')) return; 
          window.generateVideoThumbnail(engine.url, hoverTime).then(dataUrl => {
             imgWrap.style.display = 'block';
             seekThumbnailImg.style.backgroundImage = `url('${dataUrl}')`;
             seekThumbnailImg.style.backgroundPosition = 'center';
             seekThumbnailImg.style.width = '100%';
             seekThumbnailImg.style.height = '100%';
          }).catch(() => {
             // Leave it hidden on failure
          });
        }
      }, 400);
    });

    seekBarWrap.addEventListener('mouseleave', () => {
      seekThumbnailPopup.style.opacity = '0';
      setTimeout(() => { if (seekThumbnailPopup.style.opacity === '0') seekThumbnailPopup.style.display = 'none'; }, 200);
      clearTimeout(hoverDebounceTimeout);
    });
  }
  // --- End Video Chapter Thumbnails ---

  // Video events
  video.addEventListener('loadedmetadata', () => {
    if (engine && engine._gatingActive) {
      // Metadata arrived but we're gating until buffer/timeout — update UI but keep loader visible
      updateTimeDisplay(); updateSeekFill();
      return;
    }
    $('#player-loading').style.display = 'none'; updateTimeDisplay(); updateSeekFill();

    // Dismiss player splash screen
    playerSplashVideoReady = true;
    if (typeof window.tryDismissPlayerSplash === 'function') {
      window.tryDismissPlayerSplash();
    }
  });
  video.addEventListener('waiting', () => {
    $('#player-loading').style.display = 'flex';
    // Clear any stale poster/backdrop metadata immediately so previous item
    // visuals do not persist while the new stream initializes.
    try {
      const mpPosterEl = $('#mp-poster'); if (mpPosterEl) { mpPosterEl.style.display = 'none'; mpPosterEl.removeAttribute('src'); }
      const sleepPoster = $('#sleep-poster'); if (sleepPoster) { sleepPoster.removeAttribute('src'); }
      const musicPosterImg = $('#music-poster-img'); if (musicPosterImg) { musicPosterImg.removeAttribute('src'); }
      const ddBackdrop = $('#dd-backdrop') || $('#dd-backdrop-img'); if (ddBackdrop && ddBackdrop.tagName === 'IMG') { ddBackdrop.removeAttribute('src'); }
    } catch (e) { /* defensive */ }
    // Show simple spinner for normal buffering (torrent handler overrides if active)
    const cl = document.querySelector('.circular-loader');
    if (cl && !cl.classList.contains('torrent-mode')) {
      $('#player-progress-text').textContent = '';
    }
  });

  // Buffering & Torrent Progress — drives the circular loader & live diagnostics
  const LOADER_CIRCUMFERENCE = 2 * Math.PI * 42; // ~263.89
  window.api.onTorrentProgress((data) => {
    const loader = document.querySelector('.circular-loader');
    const fill = document.getElementById('loader-progress');
    const pctEl = document.getElementById('loader-percent');
    if (loader) loader.classList.add('torrent-mode');

    const pct = parseFloat(data.percent) || 0;
    if (fill) fill.style.strokeDashoffset = LOADER_CIRCUMFERENCE * (1 - pct / 100);
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

    const progEl = $('#player-progress-text');
    const speedEl = $('#player-speed-text');
    if (progEl) {
      if (data.status === 'fetching_metadata') {
        progEl.textContent = (data.peers > 0) ? `جاري جلب بيانات التورنت (${data.peers} peers)...` : 'جاري الاتصال بالأقران (Connecting to peers)...';
      } else {
        progEl.textContent = 'جاري التخزين المؤقت (Buffering)...';
      }
    }
    if (speedEl) {
      speedEl.textContent = `${data.speed || '0.00 MB/s'} · ${data.peers || 0} peers`;
    }

    // Update Live Diagnostic Card
    const diagCard = document.getElementById('player-torrent-diag');
    if (diagCard) {
      diagCard.style.display = 'block';
      const dStatus = document.getElementById('diag-status');
      const dSpeed = document.getElementById('diag-speed');
      const dFile = document.getElementById('diag-filename');
      const dPeers = document.getElementById('diag-peers');
      const dDown = document.getElementById('diag-downloaded');

      if (dStatus) dStatus.textContent = data.status === 'fetching_metadata' ? 'Connecting to DHT & Peers...' : 'Streaming Chunks...';
      if (dSpeed) dSpeed.textContent = data.speed || '0.00 MB/s';
      if (dFile) dFile.textContent = `🎬 ${data.fileName || 'Resolving file...'}`;
      if (dPeers) dPeers.textContent = `👥 ${data.peers || 0} Peers connected`;
      if (dDown) dDown.textContent = `💾 ${data.downloaded || '0 MB'} / ${data.total || '...'}`;
    }
  });

  // NOTE: Download event listeners are consolidated in one block below (search: "Download event listeners")

  // Fullscreen Synchronization Fix
  document.addEventListener('fullscreenchange', () => {
    const isNativeFS = !!document.fullscreenElement;
    isFullscreen = isNativeFS;
    document.body.classList.toggle('fullscreen-mode', isFullscreen);
    if ($('#icon-expand')) $('#icon-expand').style.display = isFullscreen ? 'none' : 'block';
    if ($('#icon-shrink')) $('#icon-shrink').style.display = isFullscreen ? 'block' : 'none';

    // Synchronize topbar fullscreen icons
    const topExpand = $('#btn-player-fullscreen .icon-player-expand');
    if (topExpand) topExpand.style.display = isFullscreen ? 'none' : 'block';
    const topShrink = $('#btn-player-fullscreen .icon-player-shrink');
    if (topShrink) topShrink.style.display = isFullscreen ? 'block' : 'none';
  });

  $('#btn-back-player').onclick = () => {
    console.log('[Player] Back button clicked (closing player)');
    try {
      // Invoke the nuke sequence and ensure DOM is hidden immediately
      exitPlayer(true, true).catch(e => console.error('[Player] exitPlayer error:', e));
    } catch (e) {
      console.error('[Player] Back handler error:', e);
    }
  };
  window.closePlayer = () => exitPlayer(true, true);

  const speedBtn = $('#btn-playback-speed');
  if (speedBtn) {
    const speeds = [1, 1.25, 1.5, 2];
    speedBtn.onclick = () => {
      let currentIdx = speeds.indexOf(video.playbackRate);
      if (currentIdx === -1) currentIdx = 0;
      const nextIdx = (currentIdx + 1) % speeds.length;
      video.playbackRate = speeds[nextIdx];
      speedBtn.textContent = speeds[nextIdx] === 1 ? 'Normal' : speeds[nextIdx] + 'x';
      showToast('Speed: ' + (speeds[nextIdx] === 1 ? 'Normal' : speeds[nextIdx] + 'x'));
    };
    video.addEventListener('ratechange', () => {
      speedBtn.textContent = video.playbackRate === 1 ? 'Normal' : video.playbackRate + 'x';
    });
  }

  const btnExternalPlayer = $('#btn-external-player');
  if (btnExternalPlayer) {
    if (window.api && window.api.isElectron) {
      btnExternalPlayer.style.display = 'flex';
      btnExternalPlayer.onclick = async () => {
        if (!currentItem) return;
        showToast('Opening in MEEM Player...');
        const pathUrl = currentItem.path || currentItem.url;
        const res = await window.api.invoke('open-in-meem-player', {
          path: pathUrl,
          fileIdx: currentItem.fileIdx,
          startTime: video.currentTime
        });
        if (res && res.success) {
          engine.pause();
          exitPlayer(true, true);
        } else {
          showToast('Failed to open in MEEM Player: ' + (res?.error || 'Unknown error'));
        }
      };
    } else {
      btnExternalPlayer.style.display = 'none';
    }
  }

  // Setup Player Error Overlay and external play button
  video.addEventListener('error', () => {
    // Only show error if we are currently active in the player view
    if (!currentItem || !$('#view-player').classList.contains('active')) return;

    // Dismiss player splash screen
    playerSplashVideoReady = true;
    if (typeof window.tryDismissPlayerSplash === 'function') {
      window.tryDismissPlayerSplash();
    }
    
    const playerErr = document.getElementById('player-error-overlay');
    const errorMsg = document.getElementById('player-error-msg');
    const vlcBtn = document.getElementById('player-error-vlc');
    const retryBtn = document.querySelector('.error-btn-premium.retry');

    if (playerErr) {
      playerErr.style.display = 'flex';
      $('#player-loading').style.display = 'none';
    }

    let msg = 'حدث خطأ في التشغيل. يرجى التحقق من الملف أو المحاولة مرة أخرى.';
    if (video.error) {
      switch (video.error.code) {
        case 1: msg = 'تم إلغاء التشغيل بواسطة المستخدم.'; break;
        case 2: msg = 'خطأ في الشبكة: لا يمكن الوصول إلى الملف أو انقطع الاتصال.'; break;
        case 3: msg = 'خطأ في فك التشفير: صيغة غير مدعومة أو ملف تالف.'; break;
        case 4: msg = 'الملف أو البث غير مدعوم في هذا المشغل.'; break;
      }
    }
    if (errorMsg) errorMsg.textContent = msg;

    if (vlcBtn) {
      if (window.api && window.api.isElectron && currentItem) {
        vlcBtn.style.display = 'inline-block';
        vlcBtn.textContent = 'Open in MEEM Player';
        vlcBtn.onclick = async () => {
          showToast('Opening in MEEM Player...');
          const pathUrl = currentItem.path || currentItem.url;
          await window.api.invoke('open-in-meem-player', {
            path: pathUrl,
            fileIdx: currentItem.fileIdx,
            startTime: video.currentTime
          });
          exitPlayer(true, true);
        };
      } else {
        vlcBtn.style.display = 'none';
      }
    }

    if (retryBtn) {
      retryBtn.removeAttribute('onclick');
      retryBtn.onclick = () => {
        if (playerErr) playerErr.style.display = 'none';
        if (currentItem) {
          playVideo(currentItem, currentShow);
        } else {
          location.reload();
        }
      };
    }
  });

  // Audio Fix button removed (redundant with mpv)
  const btnFixAudio = $('#btn-fix-audio');
  if (btnFixAudio) btnFixAudio.remove();
  video.addEventListener('canplay', () => {
    if (engine && engine._gatingActive) return; // keep loader until gating finishes
    $('#player-loading').style.display = 'none';
  });

  // Hide loader when actual playback starts (covers edge-cases where metadata fired
  // earlier but gating prevented the overlay from being hidden). Also show loader
  // while seeking and hide it when playback resumes.
  video.addEventListener('playing', () => {
    if (engine && engine._gatingActive) return;
    $('#player-loading').style.display = 'none';
  });

  video.addEventListener('seeking', () => {
    $('#player-loading').style.display = 'flex';
    $('#player-progress-text').textContent = 'Seeking...';
  });

  video.addEventListener('seeked', () => {
    // Allow a short grace for the new range to start; if playback resumes hide loader
    setTimeout(() => {
      if (engine && engine._gatingActive) return;
      if (!video.paused) $('#player-loading').style.display = 'none';
    }, 400);
  });

  video.addEventListener('timeupdate', () => {
    // If gating is inactive and we have progressed, hide the loader (robust fallback)
    try {
      if (engine && engine._gatingActive) return;
      const pl = $('#player-loading');
      if (pl && pl.style.display !== 'none' && video.currentTime > 0) {
        pl.style.display = 'none';
      }
    } catch (e) { }
  });

  // ─── mpv-driven UI updates ───
  engine.on('timeupdate', (time) => {
    if (!isSeeking) {
      const dur = engine.duration;
      if (dur > 0) {
        seekBar.value = (time / dur) * 1000;
        const msBar = $('#music-seek-bar');
        if (msBar) msBar.value = (time / dur) * 1000;
        updateSeekFill();
      }
      updateTimeDisplay();
    }
    const now = Date.now();
    if (now - lastTrayUpdate > 2000) {
      syncTray();
      lastTrayUpdate = now;
    }
    if (typeof scrobbleToTrakt === 'function') {
      scrobbleToTrakt('progress');
    }
  });

  engine.on('pausechange', (paused) => {
    if (typeof scrobbleToTrakt === 'function') {
      scrobbleToTrakt(paused ? 'pause' : 'start');
    }
    if (paused) {
      if (typeof window.saveProgress === 'function') {
        window.saveProgress(true, false);
      }
      $('#icon-play')?.style && ($('#icon-play').style.display = 'block');
      $('#icon-pause')?.style && ($('#icon-pause').style.display = 'none');
      $('#mp-icon-play')?.style && ($('#mp-icon-play').style.display = 'block');
      $('#mp-icon-pause')?.style && ($('#mp-icon-pause').style.display = 'none');

      // Music icons
      $('#music-icon-play')?.style && ($('#music-icon-play').style.display = 'block');
      $('#music-icon-pause')?.style && ($('#music-icon-pause').style.display = 'none');
    } else {
      $('#icon-play')?.style && ($('#icon-play').style.display = 'none');
      $('#icon-pause')?.style && ($('#icon-pause').style.display = 'block');
      $('#mp-icon-play')?.style && ($('#mp-icon-play').style.display = 'none');
      $('#mp-icon-pause')?.style && ($('#mp-icon-pause').style.display = 'block');

      // Music icons
      $('#music-icon-play')?.style && ($('#music-icon-play').style.display = 'none');
      $('#music-icon-pause')?.style && ($('#music-icon-pause').style.display = 'block');
    }
    syncTray();
  });

  engine.on('ended', () => {
    // Safety Guard: ignore false ended events during active transitions
    if (window.isTransitioningEpisode) {
      console.log('[Engine] Ignored false ended event during active transition');
      return;
    }

    // Music Auto-Next
    if (currentItem?.type === 'music' || isPlayingMusic) {
      playNextMusic();
      return;
    }
    // Series Auto-Next
    if (currentEpisodes && currentEpisodes.length > 0 && currentEpisodeIndex < currentEpisodes.length - 1) {
      triggerAutoNext();
    } else {
      // Standalone Movie or Last Episode: Exit player
      exitPlayer(true, true);
    }
  });

  // ── Music Visualizer (The \"Guaranteed Method\") ──
  function initVisualizer() {
    if (!audioCtx) initAudioEQ();
    if (!audioCtx || !analyser) { console.warn('[VISUALIZER] Audio system not ready'); return; }

    // Ensure state is running
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (visualizerAnim) cancelAnimationFrame(visualizerAnim);

    const canvas = $('#music-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Explicit sizing
    const resize = () => {
      const w = canvas.offsetWidth || 400;
      const h = canvas.offsetHeight || 60;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
    };
    resize();

    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    function draw() {
      visualizerAnim = requestAnimationFrame(draw);
      if (currentView !== 'player' || !isPlayingMusic) return;

      resize();
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        // Sensitivity boost + smoothing
        const val = Math.min(dataArray[i] * 1.5, 255);
        const barHeight = (val / 255) * canvas.height;

        // Visual Polish: Gradient and rounded corners
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)'); // Indigo
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.8)'); // Purple

        ctx.fillStyle = gradient;

        // Use fillRect for now, but with high density
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }
    }
    draw();
  }

  engine.on('tracks', (tracks) => {
    // Update the tracks panel with mpv's detected tracks
    if (tracks) {
      currentMediaMetadata = { audio: tracks.audio || [], video: tracks.video || [], subtitle: tracks.subtitle || [], duration: engine.duration };
      renderTracksPanel(currentMediaMetadata);
    }
  });

  // ── FFprobe Stream Metadata (Torrent Streams) ──
  if (window.api?.onStreamMetadataReady) {
    window.api.onStreamMetadataReady((meta) => {
      if (!meta) return;
      console.log('[FFprobe] Received stream metadata:', meta.audioTracks?.length, 'audio,', meta.subtitleTracks?.length, 'subs');

      const audio = (meta.audioTracks || []).map((t, i) => ({
        typeIndex: i,
        streamIndex: t.index,
        title: t.title || `Audio ${i + 1} (${t.language})`,
        lang: t.language || '??',
        format: t.codec || 'unknown',
        selected: i === 0
      }));

      const subtitle = (meta.subtitleTracks || []).map((t, i) => ({
        typeIndex: i,
        streamIndex: t.index,
        title: t.title || `Subtitle ${i + 1} (${t.language})`,
        lang: t.language || '??',
        format: t.codec || 'unknown',
        selected: false,
        extractUrl: meta.streamUrl ? `${meta.streamUrl}/stream/subtitle/${t.index}` : null
      }));

      if (audio.length > 0 || subtitle.length > 0) {
        currentMediaMetadata = { audio, subtitle, video: [], duration: engine.duration };
        renderTracksPanel(currentMediaMetadata);
        if (audio.length > 1 || subtitle.length > 0) {
          showToast(`Found ${audio.length} audio & ${subtitle.length} subtitle tracks`);
        }
      }
    });
  }

  // HTML5 fallback events (only active when not using mpv)
  video.addEventListener('timeupdate', () => {
    if (!engine.isUsingMpv && !isSeeking) {
      const isTranscoding = video && video.src && video.src.includes('transcode=true');
      let offset = 0;
      if (isTranscoding) {
        try { offset = parseFloat(new URL(video.src).searchParams.get('start')) || 0; } catch(e) {}
      }
      
      engine._currentTime = video.currentTime + offset;
      
      if (!isTranscoding) {
        engine._duration = video.duration || engine._duration;
      }
      
      const dur = engine.duration;
      if (dur > 0) {
        seekBar.value = (engine._currentTime / dur) * 1000;
        updateSeekFill();
      }
      updateTimeDisplay();
    }
  });
  video.addEventListener('play', () => { engine._paused = false; engine._emit('pausechange', false); });
  video.addEventListener('pause', () => { engine._paused = true; engine._emit('pausechange', true); });
  video.addEventListener('click', () => { engine.togglePause(); });
  video.addEventListener('dblclick', toggleFullscreen);

  // Fallback: If YouTube thumbnail loading fails, capture frame from video
  video.addEventListener('loadeddata', () => {
    if ((currentItem?.isYoutube || currentItem?.type === 'youtube') && !appData.banners[currentItem.id]) {
      captureVideoFrame();
    }
  });

  async function captureVideoFrame() {
    if (!video || !currentItem || video.readyState < 2) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.8);
      const res = await window.api.invoke('save-frame', { id: currentItem.id, data });
      if (res && res.path) {
        appData.banners[currentItem.id] = res.path;
        bumpBannerRevision(currentItem.id);
        persist();
      }
    } catch (e) { console.error('[THUMBNAIL] Frame capture failed:', e.message); }
  }

  // --- Music Metadata Editing ---
  let tempMusicCover = null;

  async function openEditMusicModal(item) {
    if (!item) return;
    const override = appData.musicMetadata[item.id] || {};
    $('#edit-music-title').value = override.title || item.title || '';
    $('#edit-music-artist').value = override.artist || item.artist || '';

    const currentCover = override.cover || item.cover;
    const preview = $('#edit-music-cover-preview');
    if (currentCover) {
      preview.style.backgroundImage = `url("${localImg(currentCover)}")`;
      preview.innerHTML = '';
    } else {
      preview.style.backgroundImage = 'none';
      preview.innerHTML = `<div class="ph-icon" style="opacity:0.3">${SVG_MUSIC}</div>`;
    }

    let videoUrl = item.path || item.url;
    if (videoUrl) {
      if (!videoUrl.startsWith('http')) {
        videoUrl = toMediaPlayUrl(videoUrl);
      }
      
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.objectFit = 'cover';
      v.style.borderRadius = '20px';
      v.src = videoUrl;
      
      preview.innerHTML = '';
      preview.appendChild(v);
      
      const seekBar = $('#edit-music-seek-bar');
      const timeDisplay = $('#edit-music-time-display');
      
      const formatTime = (s) => {
        if (isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
      };

      v.onloadedmetadata = () => {
        seekBar.max = v.duration;
        seekBar.value = 0;
        timeDisplay.textContent = formatTime(0);
        v.currentTime = 0;
      };

      seekBar.oninput = () => {
        const t = parseFloat(seekBar.value) || 0;
        v.currentTime = t;
        timeDisplay.textContent = formatTime(t);
      };
    }

    tempMusicCover = override.cover || null;
    $('#modal-edit-music').style.display = 'flex';
  }

  $('#ctx-edit-music').onclick = () => {
    $('#context-menu').style.display = 'none';
    openEditMusicModal(contextTarget);
  };


  $('#btn-edit-music-capture').onclick = async () => {
    if (!contextTarget) return;
    const preview = $('#edit-music-cover-preview');
    const v = preview.querySelector('video');
    
    if (!v) {
      showToast('No video available to capture.');
      return;
    }

    const captureBtn = $('#btn-edit-music-capture');
    captureBtn.disabled = true;
    captureBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturing...';

    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.85);

      const res = await window.api.invoke('save-frame', { id: contextTarget.id, data });
      if (res && res.path) {
        tempMusicCover = res.path;
        appData.banners[contextTarget.id] = res.path;
        bumpBannerRevision(contextTarget.id);
        renderMusic();
        showToast('Frame captured successfully!');
      } else {
        showToast('Failed to save captured frame');
      }
    } catch (err) {
      showToast(err.message || 'Capture failed');
    } finally {
      captureBtn.disabled = false;
      captureBtn.innerHTML = '<i class="fas fa-camera"></i> Capture Selected Frame';
    }
  };

  $('#btn-save-music-metadata').onclick = () => {
    if (!contextTarget) return;
    const id = contextTarget.id;
    appData.musicMetadata[id] = {
      title: $('#edit-music-title').value.trim(),
      artist: $('#edit-music-artist').value.trim(),
      cover: tempMusicCover
    };

    persist();
    $('#modal-edit-music').style.display = 'none';
    showToast('Metadata updated');

    // Refresh library
    renderMusic();

    // Update player if currently playing this item
    if (currentItem && currentItem.id === id) {
      const { title, artist, cover } = getMusicMeta(contextTarget);
      $('#music-title').textContent = title;
      $('#music-artist').textContent = artist;

      const fallbackMusicSVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nbm9uZScgc3Ryb2tlPScjNjM2NmYxJyBzdHJva2Utd2lkdGg9JzEnIGQ9J005IDE4VjVsMTItMnYxMycvPjxjaXJjbGUgY3g9JzYnIGN5PScxOCcgcj0nMycgZmlsbD0nbm9uZScgc3Ryb2tlPScjNjM2NmYxJyBzdHJva2Utd2lkdGg9JzEnLz48Y2lyY2xlIGN4PScxOCcgY3k9JzE2JyByPSczJyBmaWxsPSdub25lJyBzdHJva2U9JyM2MzY2ZjEnIHN0cm9rZS13aWR0aD0nMScvPjwvc3ZnPg==";
      const bgUrl = localImg(cover) || fallbackMusicSVG;
      if ($('#music-poster-img')) $('#music-poster-img').src = bgUrl;

      // Sync opacity for the static background
      const bgEls = document.querySelectorAll('.music-poster-bg, #music-poster-bg');
      bgEls.forEach(el => {
        el.style.opacity = '1';
      });

      // Update mini-player
      if ($('#mp-title')) $('#mp-title').textContent = title;
      if ($('#mp-meta')) $('#mp-meta').textContent = artist;
      if ($('#mp-poster')) {
        $('#mp-poster').src = bgUrl;
        $('#mp-poster').style.display = 'block';
      }
    }

    // Final force refresh to be 100% sure everything UI-wise is synced
    renderMusic();
  };

  // Auto-hide controls & Sleep Mode
  let sleepTimer = null;
  const playerWrapper = $('#player-wrapper'), playerContainer = $('#player-container');

  function resetSleep() {
    $('#sleep-overlay').style.display = 'none';
    clearTimeout(sleepTimer);
    if (isPlayingMusic || currentView === 'music') return; // Dedicated music UI handles visibility

    // Suppress Sleep Mode if playback is active OR if there are active downloads
    if (activeDownloads.size > 0) return;

    if (video.paused && currentItem) {
      // Skip sleep mode for YouTube/Social videos OR if loading spinner is active
      if (currentItem.isYoutube || currentItem.type === 'youtube' || currentItem.isSocial || currentItem.type === 'social') return;
      if ($('#player-loading').style.display !== 'none') return;

      const _sleepItem = currentItem; // capture currentItem at timer creation to avoid race
      const _sleepShow = currentShow;
      sleepTimer = setTimeout(() => {
        if (!_sleepItem) return; // item vanished
        // Bridging lookup: check episode cache first, then fall back to show cache if it's an episode
        let cache = appData.tmdbCache[(_sleepItem && (_sleepItem.tmdbId || _sleepItem.id)) || ''] || {};
        if (_sleepShow && (!cache.backdrop_path && !cache.backdropPath)) {
          const showCache = appData.tmdbCache[_sleepShow?.id] || appData.tmdbCache[_sleepShow?.title] || {};
          cache = { ...showCache, ...cache }; // Merge so we keep episode specific titles if any
        }

        const backdrop = cache.backdrop_path || cache.backdropPath;
        const poster = cache.poster_path || cache.posterPath;

        const resolveImg = (path, type = 'poster', quality = 'original') => {
          if (!path) return '';
          if (typeof path !== 'string') return '';
          if (path.startsWith('http') || path.startsWith('data:')) return path;
          if (path.startsWith('local-file:')) return path;
          if (path.startsWith('/')) {
            // Explicitly use window.tmdbService to ensure global access
            const service = window.tmdbService || tmdbService;
            if (!service) return '';
            return type === 'backdrop'
              ? service.getBackdropUrl(path, quality === 'original' ? 'original' : 'large')
              : service.getPosterUrl(path, quality === 'original' ? 'original' : 'large');
          }
          return localImg(path);
        };

        // Fallback chain: TMDB backdrop -> Anime banner -> TMDB poster -> App-level banner
        const rawBackdrop = backdrop || _sleepItem.backdrop_path || _sleepItem.banner || _sleepItem.backdrop || appData.banners[_sleepItem.id] || appData.banners[_sleepShow?.id] || poster;
        const bgUrl = resolveImg(rawBackdrop, 'backdrop');
        const posterUrl = resolveImg(poster || rawBackdrop, 'poster', 'original');

        if (bgUrl) {
          console.log('[Sleep] Setting background:', bgUrl);
          $('#sleep-bg').style.backgroundImage = `url("${bgUrl}")`;
          $('#sleep-poster').src = posterUrl;
          $('#sleep-poster').style.display = posterUrl ? 'block' : 'none';
        } else {
          console.warn('[Sleep] No backdrop found for:', _sleepItem.title);
          $('#sleep-bg').style.backgroundImage = 'none';
          $('#sleep-poster').style.display = 'none';
        }

        // Improved Labeling: Show full show name if available
        const showName = cache.title || _sleepShow?.title || (_sleepItem.isYoutube ? 'Video' : 'Movie');
        $('#sleep-show').textContent = showName;

        const displayTitle = cache.title ? (_sleepItem.season ? `Season ${_sleepItem.season} · Episode ${_sleepItem.episode}` : cache.title) : cleanTechnicalTitle(_sleepItem.title);

        // If it's an episode from cache, use the episode name from cache if possible
        let epTitle = displayTitle;
        if (_sleepItem.season && _sleepItem.episode && cache.seasons) {
          const se = cache.seasons[_sleepItem.season];
          if (se && se[_sleepItem.episode]) epTitle = se[_sleepItem.episode].name;
        }

        $('#sleep-title').textContent = epTitle;
        $('#sleep-title').style.fontSize = epTitle.length > 25 ? '38px' : '52px';

        let metaParts = [];
        if (cache.year) metaParts.push(cache.year);
        if (cache.rating) {
          const rVal = parseFloat(cache.rating);
          if (!isNaN(rVal) && rVal > 0) {
            metaParts.push(`★ ${rVal.toFixed(1)}`);
          }
        }
        if (!cache.year && _sleepItem.year) metaParts.push(_sleepItem.year);
        if (_sleepItem.quality) metaParts.push(_sleepItem.quality);

        $('#sleep-meta').textContent = metaParts.join('  •  ');

        // Ensure episode description is shown if available
        let finalDesc = cache.overview || '';
        if (_sleepItem.season && _sleepItem.episode && cache.seasons) {
          const se = cache.seasons[_sleepItem.season];
          const ep = se ? se[_sleepItem.episode] : null;
          if (ep && ep.overview) finalDesc = ep.overview;
        }
        $('#sleep-desc').textContent = finalDesc || (_sleepItem.season ? `Continuing Season ${_sleepItem.season} Episode ${_sleepItem.episode}` : 'Playback Paused');

        $('#sleep-overlay').style.display = 'flex';
        updateSleepUI();
      }, 6000);
    }
  }

  playerWrapper.addEventListener('mousemove', () => {
    playerWrapper.classList.add('ui-visible');
    playerContainer.classList.remove('hide-cursor');
    resetSleep();
    clearTimeout(ctrlTimeout);
    ctrlTimeout = setTimeout(() => {
      if (!video.paused) { playerWrapper.classList.remove('ui-visible'); playerContainer.classList.add('hide-cursor'); }
    }, 3000);
  });
  playerWrapper.addEventListener('mouseleave', () => { if (!video.paused) { playerWrapper.classList.remove('ui-visible'); playerContainer.classList.add('hide-cursor'); } });
  // Fix: Controls staying visible after mouseup — restart the auto-hide timer
  playerWrapper.addEventListener('mouseup', () => {
    clearTimeout(ctrlTimeout);
    ctrlTimeout = setTimeout(() => {
      if (!video.paused) { playerWrapper.classList.remove('ui-visible'); playerContainer.classList.add('hide-cursor'); }
    }, 3000);
  });
  video.addEventListener('pause', () => {
    playerWrapper.classList.add('ui-visible');
    playerContainer.classList.remove('hide-cursor');
    clearTimeout(ctrlTimeout);
    resetSleep();
  });
  video.addEventListener('play', () => {
    $('#sleep-overlay').style.display = 'none';
    clearTimeout(sleepTimer);
    syncTray();
  });
  video.addEventListener('pause', () => syncTray());
  video.addEventListener('ended', () => syncTray());

  function syncTray() {
    let status = 'Idle';
    let isPlaying = false;
    let progress = 0;
    let image = null;

    if (currentItem && (views.player.classList.contains('active') || isPlayingMusic)) {
      isPlaying = !engine.paused;
      const title = currentItem?.title || currentItem?.name || 'Unknown';
      status = cleanTechnicalTitle(title);

      // SLEEP MODE MATCHING RESOLVER
      let cache = appData.tmdbCache[currentItem.tmdbId || currentItem.id] || {};
      if (currentShow && (!cache.backdrop_path && !cache.backdropPath)) {
        const showCache = appData.tmdbCache[currentShow.id] || appData.tmdbCache[currentShow.title] || {};
        cache = { ...showCache, ...cache };
      }

      const backdrop = cache.backdrop_path || cache.backdropPath;
      const poster = cache.poster_path || cache.posterPath;
      const localBanner = appData.banners[currentItem.id] || (currentShow && appData.banners[currentShow.id]);

      let rawImg = localBanner || poster || backdrop;

      // Fallback for Social/Music if no TMDB/Local Banner
      if (!rawImg) {
        if (currentItem.type === 'music' || isPlayingMusic) {
          rawImg = getMusicMeta(currentItem).cover;
        } else {
          rawImg = currentItem.thumbnail || currentItem.cover || currentItem.image;
        }
      }

      // Convert to usable URL
      if (rawImg) {
        if (rawImg.startsWith('http') || rawImg.startsWith('data:')) {
          image = rawImg;
        } else if (rawImg.startsWith('/')) {
          // TMDB Path
          image = `https://image.tmdb.org/t/p/w500${rawImg}`;
        } else {
          // Local Path
          image = localImg(rawImg);
        }
      }

      // Final Fallback: .cover.jpg or .png same name for Social
      if (!image && currentItem.path && !currentItem.isStream) {
        const base = currentItem.path.substring(0, currentItem.path.lastIndexOf('.'));
        image = localImg(currentItem.path + '.cover.jpg');
        // We can't check existence here, but we can send the most likely path
        // The tray img.onerror will handle it if it fails.
      }

      if (engine.duration) {
        progress = Math.round((engine.currentTime / engine.duration) * 100);
      }
    }

    let mediaType = 'movie';
    if (typeof isPlayingMusic !== 'undefined' && isPlayingMusic) {
      mediaType = 'music';
    } else if (currentItem && (currentItem.type === 'social' || currentItem.isSocial)) {
      mediaType = 'social';
    }

    let volVal = 0;
    try {
      if (typeof engine !== 'undefined' && engine) {
        volVal = engine.isUsingMpv ? (engine.mpvVolume || 0) : (video ? (video.volume * 100) : 0);
      }
    } catch (e) { }
    const volume = Math.round(volVal || 0);

    if (typeof window.api.send === 'function') {
      window.api.send('update-tray-status', { status, isPlaying, progress, image, volume, mediaType });
    }
  }

  // Throttled Progress Update for Tray
  let lastTrayUpdate = 0;
  video.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastTrayUpdate > 2000 && $('#sleep-overlay').style.display === 'none') {
      syncTray();
      lastTrayUpdate = now;
    }
  });

  video.addEventListener('volumechange', () => {
    syncTray();
  });



  // Listen for Tray-initiated commands
  window.api.on('player-control', (cmd) => {
    // Handle both string commands and object-based actions (like volume)
    if (typeof cmd === 'string') {
      if (cmd === 'play') {
        video.play().catch(() => { });
      }
      if (cmd === 'pause') {
        video.pause();
      }
      if (cmd === 'toggle') {
        if (video.paused) video.play().catch(() => { });
        else video.pause();
      }
      if (cmd === 'next') {
        if (typeof isPlayingMusic !== 'undefined' && isPlayingMusic) playNextMusic();
        else if (typeof playNextEpisode === 'function') playNextEpisode();
      }
      if (cmd === 'prev') {
        if (typeof isPlayingMusic !== 'undefined' && isPlayingMusic) playPrevMusic();
        else if (typeof playPrevEpisode === 'function') playPrevEpisode();
      }
    } else if (cmd && cmd.action === 'volume') {
      const vol = cmd.value / 100;
      if (typeof engine !== 'undefined' && engine.isUsingMpv) {
        engine.setVolume(cmd.value);
      } else {
        video.volume = vol;
      }
      // Update UI sliders in main app
      const mainVolBar = $('#volume-bar');
      if (mainVolBar) mainVolBar.value = cmd.value;
      const musicVolBar = $('#music-volume-bar');
      if (musicVolBar) musicVolBar.value = cmd.value;

      if (typeof updateVolumeIcon === 'function') updateVolumeIcon();
    }
    syncTray();
  });

  window.api.on('playback-updated', (data) => {
    if (currentProfile && currentProfile.id === data.profileId) {
      currentProfile.playback = currentProfile.playback || {};
      currentProfile.playback[data.key] = data.entry;
      if (currentView === 'discover') renderContinueWatchingDiscover();
      if (currentView === 'library') renderLibContinueWatching();
    }
  });
  window.api.on('player-window-closed', async () => {
    console.log('[MAIN] Player window closed. Refreshing app state.');
    try {
      const saved = await window.api.loadData();
      appData = deepMerge(appData, saved);
      if (saved?.profiles?.length) appData.profiles = normalizeProfiles(appData.profiles);
      if (currentProfile) {
        currentProfile = appData.profiles?.find(p => p.id === currentProfile.id) || currentProfile;
      }
    } catch (e) {
      console.warn('[MAIN] Failed to reload appData after player close:', e);
    }
    if (currentView === 'discover') renderContinueWatchingDiscover();
    if (currentView === 'library') renderLibContinueWatching();
  });
  window.api.on('switch-view', (viewId) => switchView(viewId));
  window.api.on('session-refreshed', async (newSession) => {
    console.log('[AUTH] Received refreshed session from main process');
    try {
      const client = getSupabaseRendererClient();
      const { data, error } = await client.auth.setSession(newSession);
      if (error) {
        console.error('[AUTH] Failed to apply main process session refresh:', error.message);
      } else {
        console.log('[AUTH] Successfully applied main process session refresh to renderer client');
      }
    } catch (e) {
      console.warn('[AUTH] Error setting refreshed session in renderer:', e.message);
    }
  });
  window.api.on('open-player', async (options = {}) => {
    try {
      if (!isNativePlayerWindow()) return;

      // ── Player Splash: Show media logo if available ────────────────
      const splashMedia = document.getElementById('player-splash-media');
      const splashDefault = document.getElementById('player-splash-default');
      const splashLogoImg = document.getElementById('player-splash-media-logo');
      const splashItem = options.item || options.show || null;
      
      function isRealLogoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const lower = url.toLowerCase();
        // Reject posters, backdrops, covers, stills, thumbnails, and default images
        if (
          lower.includes('/poster') ||
          lower.includes('/backdrop') ||
          lower.includes('/cover') ||
          lower.includes('/still') ||
          lower.includes('/thumb') ||
          lower.includes('poster.') ||
          lower.includes('backdrop.') ||
          lower.includes('cover.') ||
          lower.includes('default.png') ||
          lower.includes('no-backdrop')
        ) {
          return false;
        }
        return true;
      }

      let splashLogoUrl = null;
      if (splashItem) {
        const candidateLogos = [
          splashItem.clearlogo,
          Array.isArray(splashItem.clearlogos) ? splashItem.clearlogos[0] : null,
          options.show?.clearlogo,
          Array.isArray(options.show?.clearlogos) ? options.show?.clearlogos[0] : null,
          splashItem.clearart,
          splashItem.logoUrl,
          (typeof splashItem.logo === 'string' && isRealLogoUrl(splashItem.logo)) ? splashItem.logo : null
        ].filter(Boolean);

        for (const cand of candidateLogos) {
          if (isRealLogoUrl(cand)) {
            splashLogoUrl = cand;
            break;
          }
        }
      }

      if (splashLogoUrl && splashMedia && splashLogoImg) {
        splashLogoImg.src = typeof localImg === 'function' ? localImg(splashLogoUrl) : splashLogoUrl;
        splashLogoImg.onerror = () => {
          // Logo failed to load — fall back to default splash
          if (splashMedia) splashMedia.style.display = 'none';
          if (splashDefault) splashDefault.style.display = 'flex';
        };
        splashMedia.style.display = 'flex';
        if (splashDefault) splashDefault.style.display = 'none';
      } else {
        // No real logo — show default app icon + spinner
        if (splashMedia) splashMedia.style.display = 'none';
        if (splashDefault) splashDefault.style.display = 'flex';
      }
      // ──────────────────────────────────────────────────────────────

      // Ensure profiles/appData are loaded in this window
      if (!appData || !appData.profiles || appData.profiles.length === 0) {
        const saved = await window.api.loadData();
        appData = deepMerge(appData, saved);
        if (saved?.profiles?.length) appData.profiles = normalizeProfiles(appData.profiles);
      }

      // Auto-select profile in player window
      const profileId = options.profileId || appData.activeProfileId;
      const profile = appData.profiles?.find(p => p.id === profileId) || appData.profiles?.[0];
      if (profile) {
        currentProfile = profile;
        window.currentProfile = profile;

        // Hydrate playback history
        if (window.api && window.api.getProfilePlayback) {
          try {
            const pbData = await window.api.getProfilePlayback(profile.id);
            if (pbData) {
              currentProfile.playback = currentProfile.playback || {};
              for (const k in pbData) {
                currentProfile.playback[k] = {
                  ...currentProfile.playback[k],
                  ...pbData[k]
                };
              }
            }
          } catch (e) {
            console.warn('[PLAYER-WINDOW] Playback hydration failed:', e);
          }
        }
      }

      const mediaPath = options.path || options.url;
      const payload = options.item || (mediaPath ? {
        path: mediaPath,
        url: mediaPath,
        title: options.title || 'Playback',
        displayTitle: options.title || 'Playback'
      } : null);
      if (!payload) return;
      if (typeof playVideo === 'function') {
        playVideo(payload, options.show || null, { startTime: options.startTime });
      }
    } catch (e) {
      console.warn('[Renderer] open-player event failed', e);
    }
  });

  window.api.on('open-modal', (modalId) => {
    if (modalId === 'magnet') {
      const modal = $('#modal-add-stream');
      if (modal) {
        modal.style.display = 'flex';
        $('#stream-input-url')?.focus();
      }
    }
  });

  window.api.on('sync-toggle', (enabled) => {
    appData.syncEnabled = enabled;
    persist();
    showToast(`Mobile Sync ${enabled ? 'Enabled' : 'Disabled'}`);
  });

  window.api.on('downloads-control', (cmd) => {
    if (cmd === 'pause-all') {
      // Logic for pausing downloads would go here
      showToast('Pausing all downloads...');
    }
  });

  // Auto-next
  
  $('#btn-cancel-next').onclick = () => { if (typeof window.cancelAutoNext === 'function') window.cancelAutoNext(); };
  $('#btn-play-now').onclick = () => {
    if (typeof window.cancelAutoNext === 'function') window.cancelAutoNext();
    const ni = currentEpisodeIndex + 1;
    if (ni < currentEpisodes.length) {
      currentEpisodeIndex = ni;
      const next = currentEpisodes[ni];
      if (!next.path || next.path.startsWith('magnet:') || next.isScraped || (!next.path.startsWith('http') && !next.path.includes(':') && !next.path.includes('/') && !next.path.includes('\\'))) {
        if (typeof window.playNextEpisodeAuto === 'function') {
          window.playNextEpisodeAuto(next);
        } else {
          playVideo(next, currentShow);
        }
      } else {
        playVideo(next, currentShow);
      }
    }
  };

  // Sleep Timer Removal requested by user

  // Context menu
  document.addEventListener('click', e => { if (!$('#context-menu').contains(e.target)) $('#context-menu').style.display = 'none'; });
  $('#ctx-play').onclick = () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; if (contextTarget.type === 'show') openShowDetail(contextTarget); else playVideo(contextTarget, currentShow); };
  $('#ctx-pin').onclick = () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; const p = appData.pinned || []; const i = p.indexOf(contextTarget.id); if (i >= 0) p.splice(i, 1); else p.push(contextTarget.id); appData.pinned = p; persist(); showToast(i >= 0 ? 'Unpinned' : 'Pinned'); };
  $('#ctx-watched').onclick = () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget) return;
    window.toggleUnifiedWatched(contextTarget);
    if (currentView === 'show-detail') {
      openShowDetail(currentShow, currentPart);
    }
  };
  $('#ctx-cover').onclick = async () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; const dest = await window.api.invoke('set-custom-banner', contextTarget.id); if (dest) { appData.banners[contextTarget.id] = dest; bumpBannerRevision(contextTarget.id); persist(); refreshCurrentView(); showToast('Cover updated!'); } };
  $('#ctx-rename').onclick = () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget || !contextTarget.filename) return;
    const rI = $('#rename-input'); if (rI) rI.value = contextTarget.filename;
    $('#rename-modal').style.display = 'flex';
    setTimeout(() => {
      const inp = $('#rename-input');
      if (inp) {
        inp.focus();
        const d = contextTarget.filename.lastIndexOf('.');
        if (d > 0) inp.setSelectionRange(0, d);
      }
    }, 50);
  };
  $('#ctx-tmdb-search').onclick = () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; openTmdbSearchModal(contextTarget); };
  $('#ctx-delete').onclick = async () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget) return;

    if (contextTarget.isCustomList) {
      if (!currentProfile) return;
      const listName = contextTarget.name;
      const listId = contextTarget.id;
      const isShared = contextTarget.profile_id && contextTarget.profile_id !== currentProfile.id;

      // Show custom confirm modal matching Rename theme
      const existingModal = document.getElementById('confirm-delete-modal-overlay');
      if (existingModal) existingModal.remove();
      const overlay = document.createElement('div');
      overlay.id = 'confirm-delete-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(5,5,8,0.88);backdrop-filter:blur(35px);-webkit-backdrop-filter:blur(35px);display:flex;align-items:center;justify-content:center;';
      const actionText = isShared ? 'Leave' : 'Delete';
      const actionDesc = isShared ? 'leave' : 'delete';
      overlay.innerHTML = `
        <div style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;">
          <svg style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="720" cy="450" r="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
            <path d="M-100 220 C350 420, 750 -20, 1540 320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2000" stroke-dashoffset="2000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
          </svg>
        </div>
        <div class="modal" style="width: 480px; max-width: 92vw; position: relative; z-index: 2; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 36px; padding: 44px 38px; box-shadow: 0 40px 100px rgba(0, 0, 0, 0.85); text-align: center;">
          <div style="margin-bottom: 22px; display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 20px; background: rgba(255, 75, 75, 0.15); border: 1px solid rgba(255, 75, 75, 0.3);">
            <i class="fas fa-${isShared ? 'sign-out-alt' : 'trash-alt'}" style="font-size: 26px; color: #ff4b4b;"></i>
          </div>
          <h2 style="margin: 0 0 10px; font-size: 1.6rem; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${actionText} Collection?</h2>
          <p style="color: rgba(255, 255, 255, 0.65); font-size: 0.95rem; margin-bottom: 28px; line-height: 1.5;">Are you sure you want to ${actionDesc} "<strong style="color:#ffffff;">${escapeHTML(listName)}</strong>"?${isShared ? ' You can rejoin if invited again.' : ' This cannot be undone.'}</p>
          <div class="modal-actions" style="display: flex; gap: 14px; justify-content: center;">
            <button id="confirm-del-cancel" class="btn-outline" style="flex: 1; padding: 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.18); color: rgba(255,255,255,0.85); background: transparent; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.2s;">Cancel</button>
            <button id="confirm-del-ok" class="btn-primary" style="flex: 1; padding: 14px; border-radius: 16px; background: #ff4b4b !important; color: #ffffff !important; border: none; font-weight: 800; font-size: 0.95rem; cursor: pointer; box-shadow: 0 4px 20px rgba(255,75,75,0.4); transition: all 0.2s;">${actionText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirm-del-cancel').onclick = () => overlay.remove();
      overlay.querySelector('#confirm-del-ok').onclick = async () => {
        const confirmBtn = overlay.querySelector('#confirm-del-ok');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${actionText}ing...`;
        
        try {
          const res = await window.api.invoke('cloud-delete-custom-list', { 
            listId: listId, 
            profileId: currentProfile.id 
          });
          if (!res.success) throw new Error(res.error || 'Failed to delete custom list');
          
          overlay.remove();
          
          // Remove list completely from local storage (both owned and shared)
          currentProfile.custom_lists = currentProfile.custom_lists.filter(l => l.id !== listId);
          persist(true);
          showToast(isShared ? 'Left collection' : 'Collection deleted');
          
          if (currentView === 'custom-list-detail' && activeCustomListId === listId) {
            const targetView = (prevView && prevView !== 'custom-list-detail' && prevView !== 'library') ? prevView : 'watchlist';
            switchView(targetView);
          }
          renderLibCustomLists();
        } catch (err) {
          console.error('[COLLAB] Delete list failed:', err);
          showToast('Failed to delete: ' + err.message);
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = actionText;
        }
      };
      return;
    }

    const title = contextTarget.title || contextTarget.filename || 'this item';

    if (currentView === 'custom-list-detail') {
      if (!activeCustomListId || !currentProfile) return;
      const list = currentProfile.custom_lists?.find(l => l.id === activeCustomListId);
      if (!list) return;

      if (confirm(`Are you sure you want to remove "${title}" from this collection?`)) {
        try {
          const mediaId = contextTarget.id || contextTarget.media_id;
          const res = await window.api.invoke('cloud-remove-list-item', { 
            listId: activeCustomListId, 
            mediaId: mediaId 
          });
          if (!res.success) throw new Error(res.error || 'Failed to remove item');
          
          list.items = (list.items || []).filter(item => String(item.id || item.media_id) !== String(mediaId));
          persist(true);
          showToast('Removed from collection');
          renderCustomListDetail(activeCustomListId);
        } catch (err) {
          console.error('[COLLAB] Remove item failed:', err);
          showToast('Failed to remove: ' + err.message);
        }
      }
      return;
    }

    if (currentView === 'watchlist') {
      if (confirm(`Are you sure you want to remove "${title}" from your watchlist?`)) {
        toggleWatchlist(contextTarget);
      }
      return;
    }

    if (confirm(`Are you sure you want to permanently delete "${title}"? This will move the physical file to the Recycle Bin.`)) {
      const res = await window.api.invoke('delete-file', contextTarget.path);
      if (res.success) {
        showToast('File deleted');
        await scanLibrary();
      } else {
        showToast('Delete failed: ' + res.error);
      }
    }
  };

  $('#rename-cancel').onclick = () => { $('#rename-modal').style.display = 'none'; };
  $('#rename-confirm').onclick = async () => { if (!contextTarget) return; const nn = $('#rename-input').value.trim(); if (!nn) return; const r = await window.api.renameFile(contextTarget.path, nn); if (r.success) { $('#rename-modal').style.display = 'none'; contextTarget.filename = nn; contextTarget.title = nn.replace(/\.[^/.]+$/, ''); if (r.newPath) { if (appData.playback[contextTarget.path]) { appData.playback[r.newPath] = appData.playback[contextTarget.path]; delete appData.playback[contextTarget.path]; } contextTarget.path = r.newPath; contextTarget.id = r.newPath; } persist(); renderLibrary(); showToast('File renamed'); } else showToast('Failed: ' + r.error); };
  $('#rename-input').onkeydown = e => { if (e.key === 'Enter') $('#rename-confirm').click(); if (e.key === 'Escape') $('#rename-cancel').click(); };

  $('#ctx-rename-tmdb').onclick = async () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget || !contextTarget._tmdbName || !contextTarget.path) return;
    const nn = contextTarget._tmdbName + (contextTarget.filename.substring(contextTarget.filename.lastIndexOf('.')) || '');
    const oldKey = getPlaybackKey(contextTarget);
    const r = await window.api.renameFile(contextTarget.path, nn);
    if (r.success && r.newPath) {
      contextTarget.path = r.newPath;
      contextTarget.id = r.newPath;
      contextTarget.filename = nn;
      contextTarget.title = contextTarget._tmdbName;
      const newKey = getPlaybackKey(contextTarget);
      if (currentProfile?.playback && currentProfile.playback[oldKey]) {
        currentProfile.playback[newKey] = currentProfile.playback[oldKey];
        delete currentProfile.playback[oldKey];
      }
      persist(); scanLibrary(); showToast('File renamed to TMDB name');
    } else showToast('Failed: ' + r.error);
  };

  // TMDB search modal - enabled (Using Cinemeta metadata search)
  $('#tmdb-search-cancel').onclick = () => { $('#tmdb-modal').style.display = 'none'; };
  let tmdbSearchTimeout;
  $('#tmdb-search-input').oninput = () => {
    clearTimeout(tmdbSearchTimeout);
    tmdbSearchTimeout = setTimeout(performMetaSearch, 300);
  };
  $('#tmdb-search-input').onkeydown = e => {
    if (e.key === 'Escape') $('#tmdb-modal').style.display = 'none';
    if (e.key === 'Enter') { clearTimeout(tmdbSearchTimeout); performMetaSearch(); }
  };

  // Downloads: Auto-detection & Metadata resolution
  let dlAutoDetectTimeout = null;
  async function handleUrlAutoDetect(inputUrl) {
    const urlInput = $('#dl-url');
    const nameInput = $('#dl-name');
    const rawVal = (inputUrl || urlInput?.value || '').trim();
    if (!rawVal) return;

    let effectiveUrl = rawVal;
    if ((rawVal.includes('/start?url=') || rawVal.includes('/stream?url=')) && (rawVal.includes('127.0.0.1') || rawVal.includes('localhost') || rawVal.includes(':1147'))) {
      try {
        const parsed = new URL(rawVal);
        const innerUrl = parsed.searchParams.get('url');
        if (innerUrl && innerUrl.startsWith('magnet:')) {
          effectiveUrl = innerUrl;
          if (urlInput) urlInput.value = innerUrl;
        }
      } catch(e) {}
    }

    // 1. Instant local parsing for Magnet links
    if (effectiveUrl.startsWith('magnet:')) {
      const dnMatch = effectiveUrl.match(/[?&]dn=([^&]+)/);
      let magnetTitle = 'Torrent Download';
      if (dnMatch) {
        try {
          magnetTitle = decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').replace(/[._+]/g, ' ').trim();
        } catch(e) {}
      }
      if (nameInput) nameInput.value = magnetTitle.replace(/[<>:"/\\|?*]/g, '').trim();

      if (/S(\d{1,2})E(\d{1,3})/i.test(magnetTitle)) {
        const seriesPill = document.querySelector('.dl-cat-pill[data-cat="series"]');
        if (seriesPill && !seriesPill.classList.contains('active')) seriesPill.click();
      } else if (/(19\d{2}|20\d{2})/i.test(magnetTitle)) {
        const moviePill = document.querySelector('.dl-cat-pill[data-cat="movies"]');
        if (moviePill && !moviePill.classList.contains('active')) moviePill.click();
      }
      return;
    }

    // 2. Immediate placeholder feedback
    if (nameInput) nameInput.placeholder = '🔍 Auto-detecting title & category...';

    try {
      const meta = await window.api.fetchUrlMetadata(effectiveUrl);
      if (meta && meta.success) {
        if (nameInput && meta.title) {
          nameInput.value = meta.title;
        }

        // Auto select category pill
        if (meta.category) {
          const pill = document.querySelector(`.dl-cat-pill[data-cat="${meta.category}"]`);
          if (pill && !pill.classList.contains('active')) {
            pill.click();
          }
        }

        // Auto populate series info if detected
        if (meta.seriesInfo && (meta.category === 'series' || currentDlType === 'series')) {
          setTimeout(() => {
            const seriesInput = $('#dl-series-name');
            const seriesSelect = $('#dl-series-select');
            const seasonInput = $('#dl-series-season');
            const seasonSelect = $('#dl-season-select');

            if (meta.seriesInfo.seriesName) {
              if (seriesInput) {
                seriesInput.value = meta.seriesInfo.seriesName;
                seriesInput.style.display = 'block';
              }
              if (seriesSelect) seriesSelect.style.display = 'none';
            }
            if (meta.seriesInfo.season && seasonInput) {
              seasonInput.value = meta.seriesInfo.season;
              seasonInput.style.display = 'block';
              if (seasonSelect) seasonSelect.style.display = 'none';
            }
          }, 60);
        }
      }
    } catch (err) {
      console.warn('[Downloader AutoDetect]', err.message);
    } finally {
      if (nameInput) nameInput.placeholder = 'e.g. Breaking Bad';
    }
  }

  const dlUrlInput = $('#dl-url');
  if (dlUrlInput) {
    dlUrlInput.addEventListener('input', (e) => {
      if (dlAutoDetectTimeout) clearTimeout(dlAutoDetectTimeout);
      dlAutoDetectTimeout = setTimeout(() => handleUrlAutoDetect(e.target.value), 300);
    });

    dlUrlInput.addEventListener('paste', (e) => {
      setTimeout(() => {
        if (dlUrlInput.value) handleUrlAutoDetect(dlUrlInput.value);
      }, 50);
    });

    dlUrlInput.addEventListener('change', () => {
      if (dlUrlInput.value) handleUrlAutoDetect(dlUrlInput.value);
    });
  }

  $('#btn-start-dl').onclick = startDownload;

  // Save To Category Pills Logic
  const catPills = document.querySelectorAll('.dl-cat-pill');
  catPills.forEach(pill => {
    pill.onclick = () => {
      catPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentDlType = pill.getAttribute('data-cat');
      
      const seriesMeta = $('#dl-series-meta');
      const customRow = $('#dl-custom-path-row');
      const prevText = $('#dl-path-preview-text');
      
      if (seriesMeta) seriesMeta.style.display = currentDlType === 'series' ? 'flex' : 'none';
      if (customRow) customRow.style.display = currentDlType === 'custom' ? 'block' : 'none';
      
      if (currentDlType === 'custom') {
        prevText.textContent = customDlPath ? customDlPath : 'Select a custom folder...';
      } else {
        const catName = currentDlType.charAt(0).toUpperCase() + currentDlType.slice(1);
        prevText.textContent = `Library / ${catName}`;
      }
      
      if (currentDlType === 'series') {
        const seriesSelect = $('#dl-series-select');
        const seriesInput = $('#dl-series-name');
        const seasonSelect = $('#dl-season-select');
        const seasonInput = $('#dl-series-season');

        function updateSeasonsForShow(showTitle) {
          if (!showTitle || showTitle === '_new_') {
            if (seasonSelect) seasonSelect.style.display = 'none';
            if (seasonInput) { seasonInput.style.display = 'block'; seasonInput.value = '1'; }
            return;
          }

          const showObj = (appData.shows || []).find(s => s.title && s.title.toLowerCase() === showTitle.toLowerCase());
          let seasons = [];
          if (showObj) {
            if (Array.isArray(showObj.episodes)) {
              seasons = [...new Set(showObj.episodes.map(e => e.seasonNumber || e.season || 1).filter(Boolean))].sort((a, b) => a - b);
            }
            if (seasons.length === 0 && Array.isArray(showObj.seasons)) {
              seasons = showObj.seasons.map((s, idx) => s.seasonNumber || idx + 1);
            }
          }

          if (seasons.length > 0 && seasonSelect) {
            const nextSeason = Math.max(...seasons) + 1;
            seasonSelect.innerHTML = `<option value="">-- Choose Season --</option>` +
              seasons.map(sn => `<option value="${sn}">Season ${sn}</option>`).join('') +
              `<option value="_new_">➕ Create Season ${nextSeason}...</option>`;
            seasonSelect.style.display = 'block';
            if (seasonInput) seasonInput.style.display = 'none';

            seasonSelect.onchange = () => {
              if (seasonSelect.value === '_new_') {
                seasonSelect.style.display = 'none';
                if (seasonInput) { seasonInput.style.display = 'block'; seasonInput.value = nextSeason; seasonInput.focus(); }
              } else if (seasonSelect.value !== '') {
                if (seasonInput) seasonInput.value = seasonSelect.value;
              }
            };
            if (seasonInput) seasonInput.value = seasons[0] || '1';
          } else {
            if (seasonSelect) seasonSelect.style.display = 'none';
            if (seasonInput) { seasonInput.style.display = 'block'; seasonInput.value = '1'; }
          }
        }

        if (seriesSelect && appData.shows) {
          const uniqueShows = [...new Set(appData.shows.map(s => s.title).filter(Boolean))].sort();
          if (uniqueShows.length > 0) {
            seriesSelect.innerHTML = `<option value="">-- Choose Existing Series --</option>` + 
                                     uniqueShows.map(title => `<option value="${escapeHTML(title)}">${escapeHTML(title)}</option>`).join('') + 
                                     `<option value="_new_">➕ Create New Series...</option>`;
            seriesSelect.style.display = 'block';
            if (seriesInput) seriesInput.style.display = 'none';
            seriesSelect.onchange = () => {
              if (seriesSelect.value === '_new_') {
                seriesSelect.style.display = 'none';
                if (seriesInput) { seriesInput.style.display = 'block'; seriesInput.value = ''; seriesInput.focus(); }
                updateSeasonsForShow('_new_');
              } else if (seriesSelect.value !== '') {
                if (seriesInput) seriesInput.value = seriesSelect.value;
                updateSeasonsForShow(seriesSelect.value);
              }
            };
            if (seriesInput) seriesInput.value = '';
            updateSeasonsForShow('');
          } else {
             if (seriesSelect) seriesSelect.style.display = 'none';
             if (seriesInput) seriesInput.style.display = 'block';
             updateSeasonsForShow('');
          }
        }
      }
    };
  });

  // Custom Path Browse Button
  const btnBrowse = $('#btn-browse-dl-path');
  if (btnBrowse) {
    btnBrowse.onclick = async () => {
      if (window.api && window.api.isElectron) {
        const path = await window.api.invoke('select-folder');
        if (path) {
          customDlPath = path;
          $('#dl-custom-path').value = path;
          if (currentDlType === 'custom') {
            $('#dl-path-preview-text').textContent = path;
          }
        }
      }
    };
  }

  $('#btn-clear-history').onclick = () => { appData.downloadHistory = []; persist(); renderDownloadHistory(); showToast('History Cleared'); };

  // Clear Metadata Cache
  const btnClearCache = $('#btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.onclick = async () => {
      btnClearCache.disabled = true;
      btnClearCache.textContent = 'Clearing...';
      appData.tmdbCache = {};
      appData.cinemetaCache = {};
      appData.banners = {};
      
      // Clear all image cache references from localStorage
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cache_banner_')) {
          localStorage.removeItem(key);
        }
      }

      await window.api.clearCache();
      persist();
      showToast('Cache and Images Cleared! Please rescan library.');
      setTimeout(() => {
        btnClearCache.disabled = false;
        btnClearCache.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear TMDB Cache & Images';
      }, 2000);
    };
  }



  // Zoom Controls
  if ($("#btn-zoom-in")) $("#btn-zoom-in").onclick = () => updateZoom(0.1);
  if ($("#btn-zoom-out")) $("#btn-zoom-out").onclick = () => updateZoom(-0.1);
  if ($("#btn-zoom-reset")) $("#btn-zoom-reset").onclick = () => updateZoom(0);

  // Manual OpenSubtitles Search
  let osSearchTimeout;
  const osInput = $('#os-search-input');
  if (osInput) {
    osInput.oninput = (e) => {
      clearTimeout(osSearchTimeout);
      osSearchTimeout = setTimeout(() => {
        const q = e.target.value.trim();
        // Legacy subtitle search removed
      }, 600);
    };
  }

  // Keyboard
  document.addEventListener('keydown', e => {
    if (!views.player.classList.contains('active')) return;
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); video.paused ? video.play() : video.pause(); break;
      case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); break;
      case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); break;
      case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + .05); const vU = $('#volume-bar'); if (vU) vU.value = video.volume * 100; updateVolumeIcon(); break;
      case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - .05); const vD = $('#volume-bar'); if (vD) vD.value = video.volume * 100; updateVolumeIcon(); break;
      case 'f': toggleFullscreen(); break;
      case 'm': video.muted = !video.muted; updateVolumeIcon(); break;
      case 'Escape': if (isFullscreen) toggleFullscreen(); else exitPlayer(); break;
    }
  });

  $('#search-movies')?.addEventListener('input', () => renderMovies());
  $('#search-shows')?.addEventListener('input', () => renderShows());
  $('#search-social')?.addEventListener('input', () => renderSocial());
  $('#search-music')?.addEventListener('input', () => renderMusic());

  // YouTube view nav
  $('#btn-yt-go-download')?.addEventListener('click', () => switchView('downloads'));
  $('#btn-yt-empty-dl')?.addEventListener('click', () => switchView('downloads'));
  $('#search-youtube')?.addEventListener('input', () => renderSocial());

  // Download event listeners (SINGLE authoritative set — no duplicates!)
  const unsubDownloadProgress = window.api.onDownloadProgress(data => {
    // Ignore trailing progress events for downloads that have already completed
    if (appData.downloadHistory?.some(h => h.id === data.id && h.status === 'complete')) return;

    const dl = activeDownloads.get(data.id) || { name: data.name };
    const statusChanged = dl.status !== data.status;
    activeDownloads.set(data.id, { ...dl, ...data, percent: parseFloat(data.percent) });

    const dlItem = document.querySelector(`[data-dl-id="${data.id}"]`);
    if (!dlItem || statusChanged) { renderActiveDownloads(); return; }

    // Efficient inline DOM updates (no full re-render)
    const statusEl = dlItem.querySelector('.dl-item-status');
    if (statusEl) statusEl.textContent = data.statusText || `${data.downloaded || '0 B'} / ${data.total || '?'}`;
    const fillEl = dlItem.querySelector('.dl-progress-fill');
    if (fillEl) fillEl.style.width = `${data.percent}%`;
    const pctEl = dlItem.querySelector('.dl-percent');
    if (pctEl) pctEl.textContent = `${parseFloat(data.percent).toFixed(1)}%`;
    const speedEl = dlItem.querySelector('.dl-speed');
    if (speedEl && data.speed) speedEl.textContent = data.speed;
    const peersEl = dlItem.querySelector('.dl-peers');
    if (peersEl && data.peers !== undefined) peersEl.textContent = `${data.peers} peers`;
  });
  window.api.onDownloadComplete(data => {
    activeDownloads.delete(data.id);
    appData.downloadHistory = appData.downloadHistory || [];
    // Prevent duplicate entries if event fires twice
    const exists = appData.downloadHistory.some(h => h.id === data.id);
    if (!exists) {
      appData.downloadHistory.unshift({
        id: data.id,
        name: data.name,
        path: data.path,
        url: data.url,
        date: Date.now(),
        status: 'complete',
        type: data.type || currentDlType
      });
      addNotification('Download Complete', data.name, 'download');
    }
    persist();
    renderActiveDownloads();
    renderDownloadHistory();
    renderSocial();
    scanLibrary(); // 🔥 Trigger rescan to show new metadata/covers
    showToast(`Download complete: ${data.name}`);
  });
  window.api.onDownloadError(data => {
    activeDownloads.delete(data.id);
    appData.downloadHistory = appData.downloadHistory || [];
    appData.downloadHistory.unshift({ name: data.name, error: data.error, date: Date.now(), status: 'error' });
    persist(); renderActiveDownloads(); renderDownloadHistory();
    showToast(`Download failed: ${data.error}`);
  });
  if (window.api.onDownloadCancelled) {
    window.api.onDownloadCancelled(data => {
      if (data && data.id) {
        activeDownloads.delete(data.id);
        renderActiveDownloads();
        showToast(`Cancelled download: ${data.name || ''}`);
      }
    });
  }

  // Automatically refresh when background metadata (like thumbnails) is ready
  window.api.onMetadataReady(data => {
    console.log('[RENDERER] Background metadata ready:', data.path);
    scanLibrary();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── Library ──

  window.addEventListener('toast', (e) => {
    if (e.detail) showToast(e.detail);
  });

  function renderLibContinueWatching() {
    const row = $('#lib-continue-row');
    const section = $('#lib-continue-section');
    if (!row || !section || !currentProfile?.playback) return;

    const playbacks = Object.entries(currentProfile.playback);
    const continueItems = [];

    // Filter playback entries that are in progress
    playbacks.forEach(([key, pb]) => {
      if (!pb || pb.time <= 10 || (pb.time / pb.duration) >= 0.9) return;

      const meta = pb.meta || {};
      // Determine if this entry is for an episode or a movie/single video
      const isMovie = meta.type === 'movie' || !key.includes('_E');

      if (isMovie) {
        const item = (appData.movies || []).find(m => m.id === pb.id || m.id === key || m.imdb_id === meta.imdb_id);
        if (item) {
          continueItems.push({
            item,
            pb,
            lastWatched: pb.lastWatched || 0
          });
        }
      } else {
        // Show episode! Key format: [ShowID]_S[Season]E[Episode]
        const showId = key.split('_S')[0];
        const show = (appData.shows || []).find(s => s.id === showId || s.imdb_id === meta.imdb_id);
        if (show) {
          // If we already added this show, keep only the most recently watched episode
          const existing = continueItems.find(x => x.item.id === show.id);
          if (existing) {
            if ((pb.lastWatched || 0) > existing.lastWatched) {
              existing.pb = pb;
              existing.lastWatched = pb.lastWatched || 0;
            }
          } else {
            continueItems.push({
              item: show,
              pb,
              lastWatched: pb.lastWatched || 0
            });
          }
        }
      }
    });

    // Sort by last watched date descending
    continueItems.sort((a, b) => b.lastWatched - a.lastWatched);
    const displayItems = continueItems.slice(0, 10);

    if (displayItems.length) {
      section.style.display = 'block';
      row.innerHTML = '';
      displayItems.forEach(({ item, pb }) => {
        const card = createMediaCard(item);
        const progress = (pb.time / pb.duration) * 100;

        // Show episode tag (e.g. S1:E2) for shows
        if (pb.meta && pb.meta.season != null && pb.meta.episode != null) {
          const indicator = document.createElement('div');
          indicator.style.cssText = `position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.75); color:#fff; font-size:10px; font-weight:800; padding:4px 8px; border-radius:6px; z-index:10; border:1px solid rgba(255,255,255,0.1);`;
          indicator.textContent = `S${pb.meta.season}:E${pb.meta.episode}`;
          card.appendChild(indicator);
        }

        const bar = document.createElement('div');
        bar.style.cssText = `position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(255,255,255,0.1); z-index:10;`;
        bar.innerHTML = `<div style="height:100%; width:${progress}%; background:var(--accent);"></div>`;
        card.appendChild(bar);

        // Clicking the card in Continue Watching plays/opens the specific episode directly
        card.onclick = () => {
          if (pb.meta && pb.meta.type === 'tv') {
            openDiscoverDetail(item).then(() => {
              if (typeof window.selectUnifiedEpisode === 'function') {
                window.selectUnifiedEpisode(pb.meta.season, pb.meta.episode, pb.meta.title || `Episode ${pb.meta.episode}`, pb.meta.thumbnail || '', pb.meta.path || '');
              }
            });
          } else {
            openDiscoverDetail(item);
          }
        };

        row.appendChild(card);
      });
    } else {
      section.style.display = 'none';
    }
  }

  function renderLibContinueListening() {
    const row = $('#lib-listening-row'); if (!row) return; row.innerHTML = '';
    const music = (appData.music || []).slice(-10).reverse();
    $('#lib-listening-section').style.display = music.length ? 'block' : 'none';
    music.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card music-card fade-in';
      card.style.width = '180px';
      card.style.flexShrink = '0';
      const { title, artist, cover } = getMusicMeta(item);
      card.innerHTML = `
        <div class="poster-wrap" style="aspect-ratio:1/1; border-radius:15px; overflow:hidden; position:relative;">
          <img src="${localImg(cover || 'imgs/music-placeholder.png')}" style="width:100%; height:100%; object-fit:cover;">
          <div class="video-card-overlay"><button class="vco-btn" onclick="playMusic('${item.id}')"><i class="fas fa-play"></i></button></div>
        </div>
        <div class="card-info" style="padding:10px 0;">
          <div class="card-title" style="font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(title)}</div>
          <div class="card-meta" style="font-size:12px; opacity:0.6;">${escapeHTML(artist)}</div>
        </div>
      `;
      row.appendChild(card);
    });
  }

  function renderLibRecentWatchlist() {
    const row = $('#lib-recent-watchlist-row'); if (!row) return; row.innerHTML = '';
    const watchlist = (currentProfile?.watchlist || []).filter(isAgeAllowed);
    $('#lib-recent-watchlist-section').style.display = watchlist.length ? 'block' : 'none';
    watchlist.slice(-10).reverse().forEach(w => {
      const item = [...(appData.movies || []), ...(appData.shows || [])].find(m => m.id === w.id);
      if (item) {
        const card = createMediaCard(item);
        card.onclick = () => openDiscoverDetail(item);
        row.appendChild(card);
      }
    });
  }

  let activeCustomListId = null;
  let customListRealtimeChannel = null;
  let customListSourceView = 'watchlist';

  function subscribeToCustomListRealtime(listId) {
    // Realtime subscription removed to strictly conserve realtime limits
  }

  async function inviteCollaboratorToList(listId, email) {
    if (!appData.authenticated) {
      showToast('You must be signed in to share lists');
      return;
    }
    showToast('Resolving user email...');
    try {
      const client = getSupabaseRendererClient();
      
      // 1. Resolve email to user ID
      const { data: userId, error: rpcError } = await client.rpc('get_user_id_by_email', { email_addr: email.trim().toLowerCase() });
      if (rpcError) throw rpcError;
      
      if (!userId) {
        showToast('No user account found with this email');
        return;
      }
      
      // 2. Insert into list_members
      const { error: insertError } = await client
        .from('list_members')
        .insert({
          list_id: listId,
          user_id: userId,
          role: 'member'
        });
      
      if (insertError) {
        if (insertError.code === '23505') {
          showToast('This user is already a collaborator on this list');
        } else {
          throw insertError;
        }
        return;
      }
      
      showToast(`Successfully invited ${email} to this list!`);
    } catch (err) {
      console.error('[COLLAB] Invite failed:', err);
      showToast('Failed to invite collaborator: ' + err.message);
    }
  }

  function renderLibCustomLists() {
    if (typeof loadAndRenderInvitations === 'function') {
      loadAndRenderInvitations();
    }
    const row = $('#lib-custom-lists-row');
    const section = $('#lib-custom-lists-section');
    const watchRow = $('#watchlist-custom-lists-row');
    const watchSection = $('#watchlist-custom-lists-section');

    if (row) row.innerHTML = '';
    if (watchRow) watchRow.innerHTML = '';

    if (!currentProfile) return;
    const lists = currentProfile.custom_lists || [];

    if (lists.length === 0) {
      if (section) section.style.display = 'none';
      if (watchSection) watchSection.style.display = 'none';
      return;
    }

    if (section) section.style.display = 'block';
    if (watchSection) watchSection.style.display = 'block';

    lists.forEach(list => {
      const createCardElement = () => {
        const card = document.createElement('div');
        card.className = 'myspace-collection-card glass-premium';
        card.style.cssText = `
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          min-width: 180px;
          max-width: 220px;
          height: 250px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(8px);
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        card.onmouseover = () => {
          card.style.transform = 'translateY(-6px)';
          card.style.borderColor = 'var(--accent)';
          card.style.background = 'rgba(255, 255, 255, 0.06)';
          card.style.boxShadow = '0 12px 40px rgba(0, 173, 181, 0.15)';
        };

        card.onmouseout = () => {
          card.style.transform = 'translateY(0)';
          card.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          card.style.background = 'rgba(255, 255, 255, 0.03)';
          card.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.2)';
        };

        const count = list.items?.length || 0;
        let visualContent = '';

        if (count > 0) {
          const itemsWithPoster = list.items.filter(i => i.poster || i.poster_path).slice(0, 3);
          if (itemsWithPoster.length > 0) {
            visualContent = `<div class="collection-poster-stack" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; top: -20px;">`;
            itemsWithPoster.forEach((item, idx) => {
              const poster = item.poster || item.poster_path;
              const posterUrl = localImg(poster);
              const rotation = (idx - (itemsWithPoster.length - 1) / 2) * 12;
              const offset = (idx - (itemsWithPoster.length - 1) / 2) * 15;
              visualContent += `
                <img src="${posterUrl}" onerror="this.src='imgs/no-backdrop.png'" style="
                  width: 90px;
                  height: 130px;
                  object-fit: cover;
                  border-radius: 12px;
                  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                  transform: translateX(${offset}px) rotate(${rotation}deg);
                  z-index: ${idx + 1};
                  border: 1px solid rgba(255,255,255,0.1);
                  position: absolute;
                  transition: all 0.3s ease;
                ">`;
            });
            visualContent += `</div>`;
          } else {
            visualContent = `
              <div style="position: absolute; inset: 0; top: -20px; display: flex; align-items: center; justify-content: center; color: var(--accent); opacity: 0.6;">
                <i class="fas fa-folder-open" style="font-size: 70px;"></i>
              </div>`;
          }
        } else {
          visualContent = `
            <div style="position: absolute; inset: 0; top: -20px; display: flex; align-items: center; justify-content: center; color: var(--accent); opacity: 0.4;">
              <i class="fas fa-folder" style="font-size: 70px;"></i>
            </div>`;
        }

        card.innerHTML = `
          ${visualContent}
          <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.5) 45%, transparent 100%); z-index: 10;"></div>
          <div style="position: relative; z-index: 20; padding: 20px; display: flex; flex-direction: column; gap: 4px; text-align: left;">
            <div style="font-weight: 800; font-size: 16px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.2px;">${escapeHTML(list.name)}</div>
            <div style="font-size: 12px; color: var(--text-muted); font-weight: 700; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-video" style="font-size: 10px; color: var(--accent);"></i> ${count} ${count === 1 ? 'item' : 'items'}
            </div>
          </div>
        `;

        card.onclick = () => {
          customListSourceView = currentView;
          switchView('custom-list-detail');
          renderCustomListDetail(list.id);
        };
        card.oncontextmenu = e => {
          window.openContextMenuForItem({ id: list.id, name: list.name, isCustomList: true }, e);
        };
        return card;
      };

      if (row) row.appendChild(createCardElement());
      if (watchRow) watchRow.appendChild(createCardElement());
    });
  }

  async function renderCustomListDetail(listId) {
    if (currentView !== 'custom-list-detail' && currentView !== 'player') {
      customListSourceView = currentView;
    }
    activeCustomListId = listId;

    // Immediately clear/reset the detail view elements to a loading state:
    const titleEl = $('#custom-list-title');
    if (titleEl) titleEl.textContent = 'Loading...';
    const membersEl = document.getElementById('custom-list-members');
    if (membersEl) membersEl.innerHTML = '';
    const searchEl = $('#search-custom-list');
    if (searchEl) searchEl.value = '';
    const gridEl = $('#custom-list-grid');
    if (gridEl) {
      gridEl.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; grid-column: 1 / -1; min-height: 200px;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent);"></i></div>';
    }
    const emptyEl = $('#custom-list-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    // Refresh custom lists from DB to get latest updates via REST API (non-realtime)
    await refreshCustomListsFromDb().catch(e => console.warn('[Collab] Failed to refresh custom lists:', e));

    const list = currentProfile?.custom_lists?.find(l => l.id === listId);
    if (!list) {
      switchView('watchlist');
      return;
    }

    if (window.socialPresence && typeof window.socialPresence.subscribeChat === 'function') {
      window.socialPresence.subscribeChat(listId);
    }

    if (titleEl) titleEl.textContent = list.name;

    // Fetch members and owner profile info to draw avatars in the header
    (async () => {
      const membersEl = document.getElementById('custom-list-members');
      if (!membersEl) return;
      membersEl.innerHTML = '';

      try {
        const res = await window.api.invoke('cloud-get-list-sharing-members', {
          listId,
          ownerProfileId: list.profile_id
        });
        if (!res.success) throw new Error(res.error || 'Failed to fetch members');
        
        const { ownerProf, joinedMemberProfiles } = res;

        const uniqueProfiles = [];
        const profileIds = new Set();

        // Add Owner first
        if (ownerProf) {
          uniqueProfiles.push({ ...ownerProf, isOwner: true });
          profileIds.add(ownerProf.id);
        }

        // Add other members
        joinedMemberProfiles.forEach(p => {
          if (p && !profileIds.has(p.id)) {
            uniqueProfiles.push({ ...p, isOwner: p.id === list.profile_id });
            profileIds.add(p.id);
          }
        });

        // Chat/Notes button participant count dynamic label and visibility
        const chatBtn = $('#btn-chat-custom-list');
        if (chatBtn) {
          chatBtn.style.display = 'flex';
          const chatBtnText = $('#btn-chat-custom-list-text');
          if (chatBtnText) {
            if (uniqueProfiles.length <= 1) {
              chatBtnText.textContent = 'Chat / Notes (Only Me)';
            } else {
              chatBtnText.textContent = `Chat / Notes (${uniqueProfiles.length})`;
            }
          }
        }

        // 3. Render Avatars
        uniqueProfiles.forEach(p => {
          const isMe = p.id === currentProfile.id;
          const avWrap = document.createElement('div');
          avWrap.style.cssText = `
            position: relative;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 1.5px solid ${p.isOwner ? '#fbbf24' : '#818cf8'};
            box-shadow: 0 0 8px ${p.isOwner ? 'rgba(251,191,36,0.3)' : 'rgba(129,140,248,0.3)'};
            background-image: url('${p.avatar || 'imgs/avatars/default.png'}');
            background-size: cover;
            background-position: center;
          `;
          avWrap.title = `${p.name}${p.isOwner ? ' (Owner)' : ''}${isMe ? ' (You)' : ''}`;

          if (p.isOwner) {
            // Crown overlay for list owner
            const crown = document.createElement('i');
            crown.className = 'fas fa-crown';
            crown.style.cssText = `
              color: #fbbf24;
              font-size: 9px;
              position: absolute;
              top: -8px;
              left: 50%;
              transform: translateX(-50%);
              filter: drop-shadow(0 0 2px rgba(251,191,36,0.5));
            `;
            avWrap.appendChild(crown);
          }

          membersEl.appendChild(avWrap);
        });
      } catch (e) {
        console.warn('[Collab] Failed to load member list avatars:', e);
      }
    })();

    const inviteBtn = $('#btn-invite-collaborator');
    if (inviteBtn) {
      if (list.profile_id && list.profile_id !== currentProfile.id) {
        inviteBtn.style.display = 'none';
      } else {
        inviteBtn.style.display = 'flex';
      }
    }

    const deleteBtn = $('#btn-delete-custom-list');
    if (deleteBtn) {
      const isOwner = !list.profile_id || list.profile_id === currentProfile.id;
      if (isOwner) {
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete List';
      } else {
        deleteBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Leave List';
      }
    }

    const grid = $('#custom-list-grid');
    const empty = $('#custom-list-empty');
    if (!grid) return;
    grid.innerHTML = '';

    let items = (list.items || []).filter(isAgeAllowed);

    const q = ($('#search-custom-list')?.value || '').toLowerCase();
    if (q) {
      items = items.filter(i =>
        (i.title || i.name || i.original_title || '').toLowerCase().includes(q)
      );
    }

    const listCountEl = $('#custom-list-count');
    if (listCountEl) {
      listCountEl.textContent = `${items.length} ${items.length === 1 ? 'ITEM' : 'ITEMS'}`;
      listCountEl.style.display = 'inline-block';
    }

    if (items.length === 0) {
      empty.style.display = 'flex';
    } else {
      empty.style.display = 'none';
      items.forEach(item => {
        const card = createMediaCard(item);
        card.onclick = () => openDiscoverDetail(item);
        grid.appendChild(card);
      });
      if (window.socialPresence && typeof window.socialPresence.renderPlaybackPins === 'function') {
        window.socialPresence.renderPlaybackPins('#custom-list-grid');
      }
    }
  }

  function createNewCustomList(name, itemToAdd = null) {
    if (!currentProfile) {
      console.error('[LISTS] Cannot create list: No active profile');
      showToast('⚠️ No active profile selected');
      return;
    }
    currentProfile.custom_lists = currentProfile.custom_lists || [];

    if (currentProfile.custom_lists.some(l => l.name.toLowerCase() === name.toLowerCase())) {
      showToast('A list with this name already exists');
      return;
    }

    const newList = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      name: name,
      profile_id: currentProfile.id,
      items: []
    };

    if (itemToAdd) {
      const toAdd = {
        id: itemToAdd.id,
        title: itemToAdd.title || itemToAdd.name || '',
        type: itemToAdd.type || '',
        poster: itemToAdd.poster || itemToAdd.poster_path || '',
        backdrop: itemToAdd.backdrop || itemToAdd.backdrop_path || '',
        release_date: itemToAdd.release_date || itemToAdd.first_air_date || '',
        vote_average: itemToAdd.vote_average || 0,
        overview: itemToAdd.overview || ''
      };
      newList.items.push(toAdd);
      showToast(`Created "${name}" and added item`);
    } else {
      showToast(`Created collection "${name}"`);
    }

    currentProfile.custom_lists.push(newList);
    console.log('[LISTS] Created new custom list:', { name, itemsCount: newList.items.length, listId: newList.id });
    persist(true);
    if (typeof renderLibCustomLists === 'function') renderLibCustomLists();
  }

  // ── Custom List Name Modal (replaces prompt() which is unreliable in Electron) ──
  function showCreateListModal(onConfirm, initialValue = '', title = 'Create New Collection', confirmLabel = 'Create') {
    // Remove existing modal if any
    const existing = document.getElementById('create-list-modal-overlay');
    if (existing) existing.remove();

    const isRename = confirmLabel !== 'Create';
    const iconClass = isRename ? 'fa-pen' : 'fa-folder-plus';

    const overlay = document.createElement('div');
    overlay.id = 'create-list-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,5,8,0.88);backdrop-filter:blur(35px);-webkit-backdrop-filter:blur(35px);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;">
        <svg style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="720" cy="450" r="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
          <path d="M-100 220 C350 420, 750 -20, 1540 320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2000" stroke-dashoffset="2000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
        </svg>
      </div>
      <div id="create-list-modal-box" style="background:rgba(255,255,255,0.03);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.1);border-radius:36px;padding:44px 38px;width:480px;max-width:92vw;box-shadow:0 40px 100px rgba(0,0,0,0.85);display:flex;flex-direction:column;gap:24px;position:relative;z-index:2;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:52px;height:52px;border-radius:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas ${iconClass}" style="color:#ffffff;font-size:22px;"></i>
          </div>
          <h3 style="margin:0;font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-0.4px;">${title}</h3>
        </div>
        <input id="create-list-modal-input" type="text" placeholder="e.g. To Watch, Favorites..." autocomplete="off" value="${initialValue.replace(/"/g, '&quot;')}"
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:16px;color:#fff;padding:16px 20px;font-size:1rem;font-weight:600;outline:none;transition:all 0.2s;">
        <div style="display:flex;gap:14px;justify-content:flex-end;margin-top:6px;">
          <button id="create-list-modal-cancel" style="padding:14px 28px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.18);border-radius:16px;color:rgba(255,255,255,0.85);font-size:0.95rem;font-weight:700;cursor:pointer;transition:background 0.2s;">Cancel</button>
          <button id="create-list-modal-confirm" style="padding:14px 30px;background:#ffffff !important;color:#000000 !important;border:none;border-radius:16px;font-size:0.95rem;font-weight:800;cursor:pointer;box-shadow:0 4px 20px rgba(255,255,255,0.3);transition:opacity 0.2s;">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#create-list-modal-input');
    const confirmBtn = overlay.querySelector('#create-list-modal-confirm');
    const cancelBtn = overlay.querySelector('#create-list-modal-cancel');

    // Focus input immediately and select text (useful for rename)
    setTimeout(() => { try { input.focus(); if (initialValue) input.select(); } catch(e) {} }, 50);

    cancelBtn.onclick = () => overlay.remove();
    confirmBtn.onclick = () => {
      const val = input.value.trim();
      if (!val) return;
      overlay.remove();
      if (typeof onConfirm === 'function') onConfirm(val);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    };
  }

  function showInviteCollaboratorModal(listId) {
    const existing = document.getElementById('invite-collab-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'invite-collab-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,5,8,0.88);backdrop-filter:blur(35px);-webkit-backdrop-filter:blur(35px);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;">
        <svg style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="720" cy="450" r="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
          <path d="M-100 220 C350 420, 750 -20, 1540 320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2000" stroke-dashoffset="2000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
        </svg>
      </div>
      <div id="invite-collab-modal-box" style="background:rgba(255,255,255,0.03);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.1);border-radius:36px;padding:44px 38px;width:480px;max-width:92vw;box-shadow:0 40px 100px rgba(0,0,0,0.85);display:flex;flex-direction:column;gap:22px;position:relative;z-index:2;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:52px;height:52px;border-radius:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-user-plus" style="color:#ffffff;font-size:22px;"></i>
          </div>
          <h3 style="margin:0;font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-0.4px;">Invite Collaborator</h3>
        </div>
        <div style="position:relative;">
          <input id="invite-collab-input" type="text" placeholder="Search or type username..." autocomplete="off" autocapitalize="none" autocorrect="off"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:#fff;padding:14px 16px;font-size:15px;font-weight:600;outline:none;transition:all 0.2s;">
          <div id="invite-collab-suggestions" style="position:absolute;top:100%;left:0;right:0;background:rgba(18,18,28,0.98);border:1px solid rgba(255,255,255,0.15);border-radius:12px;margin-top:6px;max-height:200px;overflow-y:auto;display:none;z-index:100000;box-shadow:0 10px 30px rgba(0,0,0,0.7);backdrop-filter:blur(30px);scrollbar-width:thin;"></div>
        </div>
        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:4px;">
          <button id="invite-collab-cancel" style="padding:12px 24px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:rgba(255,255,255,0.8);font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s;">Cancel</button>
          <button id="invite-collab-confirm" style="padding:12px 26px;background:#ffffff !important;color:#000000 !important;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 15px rgba(255,255,255,0.25);transition:opacity 0.2s;">Invite</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#invite-collab-input');
    const suggestionsBox = overlay.querySelector('#invite-collab-suggestions');
    const confirmBtn = overlay.querySelector('#invite-collab-confirm');
    const cancelBtn = overlay.querySelector('#invite-collab-cancel');

    let selectedUser = null; // { user_id, email, profile_name, allow_invitations }
    let debounceTimeout = null;

    setTimeout(() => { try { input.focus(); } catch(e) {} }, 50);

    input.addEventListener('focus', () => { 
      input.style.borderColor = '#00adb5'; 
      if (input.value.trim().length >= 1) handleSearch();
    });
    input.addEventListener('blur', () => { 
      input.style.borderColor = 'rgba(255,255,255,0.15)'; 
      setTimeout(() => { suggestionsBox.style.display = 'none'; }, 250);
    });

    const handleSearch = async () => {
      const val = input.value.trim();
      if (!val || val.length < 1) {
        suggestionsBox.innerHTML = '';
        suggestionsBox.style.display = 'none';
        return;
      }

      try {
        const res = await window.api.invoke('cloud-search-collaborators', { query_str: val });
        if (!res.success) throw new Error(res.error || 'Search failed');
        const data = res.data || [];

        suggestionsBox.innerHTML = '';
        if (data.length > 0) {
          data.forEach(user => {
            const div = document.createElement('div');
            div.style.cssText = 'padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.06);transition:background 0.2s;display:flex;align-items:center;gap:12px;';
            const statusText = user.allow_invitations === false ? ' <span style="color:#EF4444;font-size:11px;font-weight:bold;margin-left:5px;">(الدعوات مغلقة)</span>' : '';
            const avatarUrl = user.avatar || 'https://lh3.googleusercontent.com/a/default-user=s96-c';
            
            div.innerHTML = `
              <img src="${escapeHTML(avatarUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(255,255,255,0.2);flex-shrink:0;">
              <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">
                <span style="color:#fff;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(user.profile_name)}${statusText}</span>
                <span style="color:var(--text-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user.email ? escapeHTML(user.email) : '@' + escapeHTML(user.profile_name)}</span>
              </div>
            `;
            div.onmouseover = () => { div.style.background = 'rgba(255,255,255,0.08)'; };
            div.onmouseout = () => { div.style.background = ''; };
            
            const selectThisUser = (e) => {
              if (e) {
                e.preventDefault();
                e.stopPropagation();
              }
              selectedUser = user;
              input.value = user.profile_name;
              suggestionsBox.innerHTML = '';
              suggestionsBox.style.display = 'none';
            };

            div.onpointerdown = selectThisUser;
            div.onclick = selectThisUser;
            suggestionsBox.appendChild(div);
          });
          suggestionsBox.style.display = 'block';
        } else {
          suggestionsBox.innerHTML = '<div style="padding:14px;color:rgba(255,255,255,0.5);font-size:13px;text-align:center;">No users found</div>';
          suggestionsBox.style.display = 'block';
        }
      } catch (e) {
        console.warn('[COLLAB] Search failed:', e.message);
      }
    };

    input.addEventListener('input', () => {
      selectedUser = null;
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(handleSearch, 200);
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') {
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        overlay.remove();
      }
    });

    confirmBtn.addEventListener('click', async () => {
      const val = input.value.trim();
      if (!val) return;

      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      
      try {
        let targetUserId = selectedUser ? selectedUser.user_id : null;
        let allowInvitations = selectedUser ? selectedUser.allow_invitations : null;
        let displayName = selectedUser ? selectedUser.profile_name : val;

        // Try exact username or email resolution first
        if (!targetUserId) {
          const res = await window.api.invoke('cloud-get-user-id-by-username', { username: val });
          if (res.success && res.data && res.data.length > 0) {
            targetUserId = res.data[0].user_id;
            allowInvitations = res.data[0].allow_invitations;
            if (res.data[0].profile_name) displayName = res.data[0].profile_name;
          }
        }

        // Fallback to search query if not matched
        if (!targetUserId) {
          const res = await window.api.invoke('cloud-search-collaborators', { query_str: val });
          if (res.success && res.data && res.data.length > 0) {
            targetUserId = res.data[0].user_id;
            allowInvitations = res.data[0].allow_invitations;
            displayName = res.data[0].profile_name;
          }
        }

        if (!targetUserId) {
          showToast('No user account found');
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
          return;
        }

        // Check if the user has disabled invitations
        if (allowInvitations === false) {
          showToast('الشخص دا قافل الدعوات !');
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
          return;
        }

        // Ensure list is persisted / synced to cloud before inviting
        if (typeof persist === 'function') persist(true);

        const inviteRes = await window.api.invoke('cloud-invite-collaborator', {
          listId,
          targetUserId
        });

        if (!inviteRes.success) {
          if (inviteRes.blocked) {
            showToast('الشخص دا قافل الدعوات !');
          } else if (inviteRes.exists) {
            showToast('This user is already a collaborator/invited');
          } else {
            throw new Error(inviteRes.error || 'Invitation failed');
          }
        } else {
          showToast(`✅ Invitation sent to ${displayName}!`);
          overlay.remove();
        }
      } catch (err) {
        console.error('[COLLAB] Invite failed:', err);
        showToast('Invite failed: ' + err.message);
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
      }
    });

    cancelBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  async function refreshCustomListsFromDb() {
    if (!appData.authenticated || !currentProfile) return;
    try {
      const res = await window.api.invoke('cloud-refresh-custom-lists', { profileId: currentProfile.id });
      if (!res.success) throw new Error(res.error || 'Failed to refresh lists');
      
      const { listsData, sharedLists } = res;
      
      // Preserve local-only lists (not yet synced to DB)
      const localOnlyLists = (currentProfile.custom_lists || []).filter(localList => {
        const isInDb = (listsData || []).some(dbList => dbList.id === localList.id);
        const isInShared = sharedLists.some(sharedList => sharedList.id === localList.id);
        return !isInDb && !isInShared;
      });

      const combinedLists = [...(listsData || [])];
      const ownedIds = new Set(combinedLists.map(l => l.id));
      for (const list of sharedLists) {
        if (!ownedIds.has(list.id)) {
          combinedLists.push(list);
        }
      }

      // Merge local-only lists with DB lists
      const finalLists = [...combinedLists];
      for (const localList of localOnlyLists) {
        if (!finalLists.some(l => l.id === localList.id)) {
          finalLists.push(localList);
        }
      }

      currentProfile.custom_lists = finalLists.map(row => ({
        id: row.id,
        // DB rows use list_name; local-only lists use name
        profile_id: row.profile_id || currentProfile.id,
        name: row.list_name || row.name,
        theme_color: row.theme_color || '#6366f1',
        items: (row.list_items || row.items || []).map(item => ({
          id: item.media_id || item.id,
          type: item.type,
          media_type: item.type,
          title: item.title,
          poster: item.poster_path || item.poster,
          backdrop: item.backdrop_path || item.backdrop,
          release_date: item.release_date,
          vote_average: item.vote_average,
          overview: item.overview,
          source: item.source || null,
          mal_id: item.mal_id || null,
          anime_id: item.anime_id || null
        }))
      }));
      
      persist(true);
      renderLibCustomLists();
    } catch (e) {
      console.error('[COLLAB] Failed to refresh custom lists:', e);
    }
  }

  async function loadAndRenderInvitations() {
    if (!appData.authenticated || !currentProfile) {
      const wlSec = $('#watchlist-invitations-section');
      const libSec = $('#lib-invitations-section');
      if (wlSec) wlSec.style.display = 'none';
      if (libSec) libSec.style.display = 'none';
      return;
    }
    
    try {
      // Call our IPC handler to fetch pending invitations
      const res = await window.api.invoke('cloud-get-pending-invitations');
      if (!res.success) throw new Error(res.error || 'Failed to load invitations');
      const data = res.data;
      
      data?.forEach(inv => {
        if (!notifiedInvitationIds.has(inv.membership_id)) {
          notifiedInvitationIds.add(inv.membership_id);
          addNotification(
            'New Invitation 🎉',
            `${inv.invited_by_profile_name} invited you to "${inv.list_name}"`,
            'invite'
          );
        }
      });
      
      const hasInvitations = data && data.length > 0;
      
      const renderRow = (rowId) => {
        const row = $(rowId);
        if (!row) return;
        row.innerHTML = '';
        
        if (!hasInvitations) return;
        
        data.forEach(inv => {
          const banner = document.createElement('div');
          banner.className = 'glass-premium';
          banner.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 20px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.08);
            background: rgba(255,255,255,0.02);
            gap: 15px;
            margin-bottom: 10px;
          `;
          banner.innerHTML = `
            <div style="flex: 1; min-width: 0;">
              <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">${escapeHTML(inv.list_name)}</h4>
              <p style="margin: 3px 0 0 0; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">Invited by: <strong>${escapeHTML(inv.invited_by_profile_name)}</strong></p>
            </div>
            <div style="display: flex; gap: 8px; flex-shrink: 0;">
              <button class="btn-accept" data-id="${inv.membership_id}" style="padding: 7px 14px; background: linear-gradient(135deg,#00adb5,#00f2fe); border: none; border-radius: 8px; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 10px rgba(0,173,181,0.25); transition: opacity 0.2s;">Accept</button>
              <button class="btn-decline" data-id="${inv.membership_id}" style="padding: 7px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #ccc; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;">Decline</button>
            </div>
          `;
          
          // Accept action
          banner.querySelector('.btn-accept').onclick = async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.style.opacity = '0.5';
            showToast('Accepting invitation...');
            try {
              const acceptRes = await window.api.invoke('cloud-accept-invitation', { membershipId: inv.membership_id });
              if (!acceptRes.success) throw new Error(acceptRes.error || 'Accept failed');
              
              showToast('Invitation accepted!');
              await refreshCustomListsFromDb();
              await loadAndRenderInvitations();
            } catch (err) {
              console.error('[COLLAB] Accept failed:', err);
              showToast('Failed to accept: ' + err.message);
              btn.disabled = false;
              btn.style.opacity = '1';
            }
          };
          
          // Decline action
          banner.querySelector('.btn-decline').onclick = async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.style.opacity = '0.5';
            showToast('Declining invitation...');
            try {
              const declineRes = await window.api.invoke('cloud-decline-invitation', { membershipId: inv.membership_id });
              if (!declineRes.success) throw new Error(declineRes.error || 'Decline failed');
              
              showToast('Invitation declined.');
              await refreshCustomListsFromDb();
              await loadAndRenderInvitations();
            } catch (err) {
              console.error('[COLLAB] Decline failed:', err);
              showToast('Failed to decline: ' + err.message);
              btn.disabled = false;
              btn.style.opacity = '1';
            }
          };
          
          row.appendChild(banner);
        });
      };
      
      renderRow('#watchlist-invitations-row');
      renderRow('#lib-invitations-row');
      
      const wlSec = $('#watchlist-invitations-section');
      const libSec = $('#lib-invitations-section');
      if (wlSec) wlSec.style.display = hasInvitations ? 'block' : 'none';
      if (libSec) libSec.style.display = hasInvitations ? 'block' : 'none';
      
    } catch (e) {
      console.error('[COLLAB] Failed to load pending invitations:', e.message);
    }
  }

  // Bind key actions/events using robust event delegation
  document.addEventListener('click', (e) => {
    // Watchlist or Library create custom list button
    const createBtn = e.target.closest('#btn-create-watchlist-collection, #btn-create-library-collection');
    if (createBtn) {
      showCreateListModal((name) => {
        createNewCustomList(name);
      });
      return;
    }

    // Custom list back button
    const backBtn = e.target.closest('#btn-custom-list-back');
    if (backBtn) {
      let target = customListSourceView || 'watchlist';
      if (target === 'discover-detail' || target === 'player' || target === 'music-player' || target === 'custom-list-detail') {
        target = 'watchlist';
      }
      switchView(target);
      return;
    }

    // Custom list invite collaborator button
    const inviteBtn = e.target.closest('#btn-invite-collaborator');
    if (inviteBtn) {
      if (!activeCustomListId || !currentProfile) return;
      const list = currentProfile.custom_lists.find(l => l.id === activeCustomListId);
      if (!list) return;

      if (list.profile_id && list.profile_id !== currentProfile.id) {
        showToast('Only the list creator can invite collaborators');
        return;
      }

      showInviteCollaboratorModal(activeCustomListId);
      return;
    }

    // Custom list rename button
    const renameBtn = e.target.closest('#btn-rename-custom-list');
    if (renameBtn) {
      if (!activeCustomListId || !currentProfile) return;
      const list = currentProfile.custom_lists.find(l => l.id === activeCustomListId);
      if (!list) return;

      showCreateListModal((newName) => {
        if (newName && newName.trim() && newName.trim() !== list.name) {
          list.name = newName.trim();
          persist(true);
          showToast('Collection renamed successfully');
          renderCustomListDetail(activeCustomListId);
          renderLibCustomLists();
        }
      }, list.name, 'Rename Collection', 'Rename');
      return;
    }

    // Custom list delete button
    const deleteBtn = e.target.closest('#btn-delete-custom-list');
    if (deleteBtn) {
      if (!activeCustomListId || !currentProfile) return;
      const list = currentProfile.custom_lists.find(l => l.id === activeCustomListId);
      if (!list) return;
      const isShared = list.profile_id && list.profile_id !== currentProfile.id;

      // Show custom confirm modal matching Rename theme
      const existingModal = document.getElementById('confirm-delete-modal-overlay');
      if (existingModal) existingModal.remove();
      const overlay = document.createElement('div');
      overlay.id = 'confirm-delete-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(5,5,8,0.88);backdrop-filter:blur(35px);-webkit-backdrop-filter:blur(35px);display:flex;align-items:center;justify-content:center;';
      const actionText = isShared ? 'Leave' : 'Delete';
      const actionDesc = isShared ? 'leave' : 'delete';
      overlay.innerHTML = `
        <div style="position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;">
          <svg style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="720" cy="450" r="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="1000" stroke-dashoffset="1000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
            <path d="M-100 220 C350 420, 750 -20, 1540 320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2000" stroke-dashoffset="2000" style="animation: splashDraw 2.2s cubic-bezier(0.25, 1, 0.5, 1) forwards; opacity: 0.18;" />
          </svg>
        </div>
        <div class="modal" style="width: 480px; max-width: 92vw; position: relative; z-index: 2; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 36px; padding: 44px 38px; box-shadow: 0 40px 100px rgba(0, 0, 0, 0.85); text-align: center;">
          <div style="margin-bottom: 22px; display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 20px; background: rgba(255, 75, 75, 0.15); border: 1px solid rgba(255, 75, 75, 0.3);">
            <i class="fas fa-${isShared ? 'sign-out-alt' : 'trash-alt'}" style="font-size: 26px; color: #ff4b4b;"></i>
          </div>
          <h2 style="margin: 0 0 10px; font-size: 1.6rem; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${actionText} Collection?</h2>
          <p style="color: rgba(255, 255, 255, 0.65); font-size: 0.95rem; margin-bottom: 28px; line-height: 1.5;">Are you sure you want to ${actionDesc} "<strong style="color:#ffffff;">${escapeHTML(list.name)}</strong>"?${isShared ? ' You can rejoin if invited again.' : ' This cannot be undone.'}</p>
          <div class="modal-actions" style="display: flex; gap: 14px; justify-content: center;">
            <button id="confirm-del-cancel" class="btn-outline" style="flex: 1; padding: 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.18); color: rgba(255,255,255,0.85); background: transparent; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.2s;">Cancel</button>
            <button id="confirm-del-ok" class="btn-primary" style="flex: 1; padding: 14px; border-radius: 16px; background: #ff4b4b !important; color: #ffffff !important; border: none; font-weight: 800; font-size: 0.95rem; cursor: pointer; box-shadow: 0 4px 20px rgba(255,75,75,0.4); transition: all 0.2s;">${actionText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirm-del-cancel').onclick = () => overlay.remove();
      overlay.querySelector('#confirm-del-ok').onclick = async () => {
        const confirmBtn = overlay.querySelector('#confirm-del-ok');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${actionText}ing...`;
        
        try {
          const res = await window.api.invoke('cloud-delete-custom-list', { 
            listId: activeCustomListId, 
            profileId: currentProfile.id 
          });
          if (!res.success) throw new Error(res.error || 'Failed to delete custom list');
          
          overlay.remove();
          
          // Remove list completely from local storage (both owned and shared)
          currentProfile.custom_lists = currentProfile.custom_lists.filter(l => l.id !== activeCustomListId);
          persist(true);
          showToast(isShared ? 'Left collection' : 'Collection deleted');
          
          const targetView = (prevView && prevView !== 'custom-list-detail' && prevView !== 'library') ? prevView : 'watchlist';
          switchView(targetView);
          renderLibCustomLists();
        } catch (err) {
          console.error('[COLLAB] Delete list failed:', err);
          showToast('Failed to delete: ' + err.message);
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = actionText;
        }
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      return;
    }
  });

  document.addEventListener('input', (e) => {
    const searchInput = e.target.closest('#search-custom-list');
    if (searchInput) {
      if (activeCustomListId) renderCustomListDetail(activeCustomListId);
    }
  });

  async function autoMatchMetadata() {
    const cache = appData.cinemetaCache = appData.cinemetaCache || {};
    const tmdbCache = appData.tmdbCache || {};
    const items = [
      ...(appData.movies || []),
      ...(appData.shows || []),
      ...(currentProfile?.watchlist || [])
    ];
    let matched = 0;
    for (const item of items) {
      const id = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
      if (id && String(id).startsWith('tt')) {
        // Direct Cinemeta Details lookup for IMDb IDs (accurate and fast!)
        if (!tmdbCache[id] && !cache[id] && !cache[item.id]) {
          try {
            const type = item.type === 'series' || item.type === 'tv' || item.type === 'show' ? 'series' : 'movie';
            const res = await window.api.invoke('cinemeta-details', { id, type });
            if (res && res.meta) {
              const m = res.meta;
              const resCert = res.certification || res.content_rating || m.certification || m.contentRating || m.content_rating || null;
              const metaObj = {
                cinemetaId: m.id,
                type: type === 'series' ? 'tv' : 'movie',
                title: m.name || m.title,
                poster: m.poster || null,
                backdrop: m.background || null,
                year: m.year || (m.release_date || m.first_air_date || '').slice(0, 4),
                rating: m.behaviorHints?.rating || m.imdbRating || 0,
                genres: m.genres || [],
                certification: resCert,
                content_rating: resCert
              };
              cache[id] = metaObj;
              cache[item.id] = metaObj;
              if ((m.poster || m.background) && !appData.banners[item.id]) {
                // Download image in background without blocking
                window.api.downloadImage(m.poster || m.background, item.id).then(lp => {
                  if (lp) {
                    appData.banners[item.id] = lp;
                    bumpBannerRevision(item.id);
                    persist();
                  }
                });
              }
              matched++;
            }
          } catch(e) {
            console.warn('[METADATA-ID] Failed direct lookup for', id, e.message);
          }
          // Remove blocking delay for faster processing
        }
        continue;
      }
      
      if (tmdbCache[item.id]) continue;
      
      const isShow = item.type === 'show' || !!(item.episodes);
      const isMovie = item.type === 'movie';
      const cached = cache[item.id];
      
      if (cached) {
        const cachedType = cached.type || cached.media_type;
        const mismatch = (isShow && cachedType === 'movie') || (isMovie && (cachedType === 'tv' || cachedType === 'series'));
        if (mismatch) {
          delete cache[item.id];
        } else {
          // If no mismatch, check if banner is missing and retry download
          if (!appData.banners[item.id] && (cached.poster || cached.backdrop)) {
            // Download image in background without blocking
            window.api.downloadImage(cached.poster || cached.backdrop, item.id).then(lp => {
              if (lp) {
                appData.banners[item.id] = lp;
                bumpBannerRevision(item.id);
                matched++;
                persist();
              }
            }).catch(err => {
              console.warn('[METADATA-RETRY] Error downloading banner:', err.message);
            });
          }
          continue;
        }
      }
      
      const itemYear = item.year || null;

      // Clean the title: remove year from the search query itself
      const rawTitle = item.title || '';
      let cleanTitle = item.cleanTitle || rawTitle;
      // Strip year from the clean title so "Inception 2010" becomes "Inception"
      if (itemYear) cleanTitle = cleanTitle.replace(new RegExp(`\\b${itemYear}\\b`), '').trim();
      const shortTitle = cleanTitle.split(' ').slice(0, 4).join(' ');
      const candidates = [...new Set([cleanTitle, rawTitle, shortTitle].filter(s => s && s.length > 1))];

      let found = false;
      for (const query of candidates) {
        try {
          const res = await window.api.cinemetaSearch(query);
          if (res.results?.length) {
            const targetType = isShow ? 'tv' : 'movie';
            let m = null;
            if (itemYear) {
              m = res.results.find(r => {
                const rYear = (r.release_date || r.first_air_date || '').slice(0, 4);
                return r.media_type === targetType && rYear === itemYear;
              });
            }
            if (!m) {
              m = res.results.find(r => r.media_type === targetType);
            }
            if (!m) {
              m = res.results[0];
            }
            
            const resCert = m.certification || m.contentRating || m.content_rating || null;
            cache[item.id] = {
              cinemetaId: m.id,
              type: m.media_type,
              title: m.name || m.title,
              poster: m.poster || null,
              backdrop: m.background || null,
              year: (m.release_date || m.first_air_date || '').slice(0, 4),
              certification: resCert,
              content_rating: resCert
            };
            if ((m.poster || m.background) && !appData.banners[item.id]) {
              // Download image in background without blocking
              window.api.downloadImage(m.poster || m.background, item.id).then(lp => {
                if (lp) {
                  appData.banners[item.id] = lp;
                  bumpBannerRevision(item.id);
                  persist();
                }
              });
            }
            matched++; found = true; break;
          }
        } catch (err) {
          console.warn('[METADATA-MATCH] Error matching item:', err.message);
        }
        // Remove blocking delay for faster processing
      }
      if (!found) {
        // Remove blocking delay for faster processing
      }
    }
    if (matched > 0) { persist(); renderLibrary(); showToast(`Matched ${matched} items`); }
  }

  // ── Render ──
  function updateBadges() {
    const mc = (appData.movies || []).length, sc = (appData.shows || []).length;
    // Count social videos from both profile and legacy folder
    const socCount = (appData.socialVideos || []).length + (appData.youtubeVideos || []).length;
    const muc = (appData.music || []).length;

    const bm = $('#badge-movies'), bs = $('#badge-shows'), by = $('#badge-social'), bmu = $('#badge-music');
    if (bm) { bm.textContent = mc; bm.classList.toggle('visible', mc > 0); }
    if (bs) { bs.textContent = sc; bs.classList.toggle('visible', sc > 0); }
    if (by) { by.textContent = socCount; by.classList.toggle('visible', socCount > 0); }
    if (bmu) { bmu.textContent = muc; bmu.classList.toggle('visible', muc > 0); }

    const cM = $('#movies-count'), cS = $('#shows-count'), cY = $('#social-count'), cMu = $('#music-count'), cW = $('#watchlist-count');
    if (cM) cM.textContent = mc ? mc + ' item' + (mc > 1 ? 's' : '') : '0 items';
    if (cS) cS.textContent = sc ? sc + ' show' + (sc > 1 ? 's' : '') : '0 items';
    if (cMu) cMu.textContent = muc ? muc + ' track' + (muc > 1 ? 's' : '') : '0 tracks';
    const wlc = (currentProfile?.watchlist || []).length;
    if (cW) cW.textContent = wlc ? wlc + ' item' + (wlc > 1 ? 's' : '') : '0 items';
  }

  function hasImage(item) {
    if (!item) return false;

    const isPlaceholder = (val) => {
      if (!val || typeof val !== 'string') return false;
      const v = val.toLowerCase();
      return v.includes('no-backdrop') || v.includes('placeholder') || v.includes('no-poster');
    };

    const metadataKeys = getMediaMetadataKeys(item);
    const bannerKey = metadataKeys.find(k => appData.banners?.[k]) || item.id;
    const bannerPath = appData.banners ? appData.banners[bannerKey] : null;
    const tmdbRaw = getMetadataForItem(item);

    if (bannerPath && !isPlaceholder(bannerPath)) return true;

    if (tmdbRaw) {
      if (tmdbRaw.posterPath && !isPlaceholder(tmdbRaw.posterPath)) return true;
      if (tmdbRaw.poster && !isPlaceholder(tmdbRaw.poster)) return true;
      if (tmdbRaw.backdropPath && !isPlaceholder(tmdbRaw.backdropPath)) return true;
      if (tmdbRaw.backdrop && !isPlaceholder(tmdbRaw.backdrop)) return true;
    }

    const fields = [
      item.poster_path, item.backdrop_path, item.poster, item.cover,
      item.image, item.thumbnail, item.thumb, item.banner
    ];
    for (const f of fields) {
      if (f && !isPlaceholder(f)) return true;
    }

    // Items with a resolvable IMDb ID can load a poster dynamically via getTraktOrImdbPoster
    // → treat them as having a potential image so they stay in the main grid
    const resolvedImdb =
      item?.imdb_id ||
      item?.imdbId ||
      item?.cinemetaId ||
      (String(item?.id || '').startsWith('tt') ? item.id : null) ||
      (item?.tmdbData && item.tmdbData.imdb_id);
    if (resolvedImdb && String(resolvedImdb).startsWith('tt')) return true;

    const isShow = item.type === 'show' || item.type === 'series' || item.type === 'tv' || item.media_type === 'tv' || item.media_type === 'series' || !!(item.episodes && item.episodes.length > 0);
    if (!isShow && (item.isLocal || (item.path && !item.path.startsWith('http')))) {
      if (appData.thumbnails && appData.thumbnails[item.id]) return true;
    }
    return false;
  }

  window.toggleNoImages = function(type) {
    const sec = $(`#${type}-no-images-section`);
    const grid = $(`#${type}-no-images-grid`);
    if (!sec || !grid) return;
    const icon = sec.querySelector('.toggle-icon');
    if (grid.style.display === 'none') {
      grid.style.display = 'grid';
      if (icon) icon.style.transform = 'rotate(90deg)';
    } else {
      grid.style.display = 'none';
      if (icon) icon.style.transform = 'rotate(0deg)';
    }
  };

  function renderMovies() {
    const g = $('#movies-grid'); if (!g) return;
    g.innerHTML = '';
    const movies = (appData.movies || []).filter(m => !isLocked(m.id)).filter(isAgeAllowed);
    const empty = $('#movies-empty');
    if (empty) empty.style.display = movies.length ? 'none' : 'flex';
    const q = ($('#search-movies')?.value || '').toLowerCase();
    const filtered = q ? movies.filter(m => m.title.toLowerCase().includes(q)) : movies;
    
    const withImages = [];
    const withoutImages = [];
    filtered.forEach(m => {
      if (hasImage(m)) withImages.push(m);
      else withoutImages.push(m);
    });

    withImages.forEach(m => g.appendChild(createMediaCard(m)));

    const noImgSec = $('#movies-no-images-section');
    const noImgGrid = $('#movies-no-images-grid');
    if (noImgSec && noImgGrid) {
      noImgGrid.innerHTML = '';
      if (withoutImages.length > 0) {
        noImgSec.style.display = 'block';
        noImgSec.querySelector('.count').textContent = withoutImages.length;
        withoutImages.forEach(m => noImgGrid.appendChild(createMediaCard(m)));
      } else {
        noImgSec.style.display = 'none';
      }
    }
  }

  function renderShows() {
    const g = $('#shows-grid'); if (!g) return;
    g.innerHTML = '';
    const shows = (appData.shows || []).filter(s => !isLocked(s.id)).filter(isAgeAllowed);
    const empty = $('#shows-empty');
    if (empty) empty.style.display = shows.length ? 'none' : 'flex';
    const q = ($('#search-shows')?.value || '').toLowerCase();
    const filtered = q ? shows.filter(s => s.title.toLowerCase().includes(q)) : shows;

    const withImages = [];
    const withoutImages = [];
    filtered.forEach(s => {
      if (hasImage(s)) withImages.push(s);
      else withoutImages.push(s);
    });

    withImages.forEach(s => g.appendChild(createMediaCard(s)));

    const noImgSec = $('#shows-no-images-section');
    const noImgGrid = $('#shows-no-images-grid');
    if (noImgSec && noImgGrid) {
      noImgGrid.innerHTML = '';
      if (withoutImages.length > 0) {
        noImgSec.style.display = 'block';
        noImgSec.querySelector('.count').textContent = withoutImages.length;
        withoutImages.forEach(s => noImgGrid.appendChild(createMediaCard(s)));
      } else {
        noImgSec.style.display = 'none';
      }
    }
  }

  function renderSocial() {
    // console.log('[RENDER-SOCIAL] Starting render... ProfileVideos:', appData.socialVideos?.length || 0, 'LegacyVideos:', appData.youtubeVideos?.length || 0);
    const g = $('#social-grid'), empty = $('#social-empty');
    if (!g) return;
    const q = ($('#search-social')?.value || '').toLowerCase();

    // Combine Profile Social videos + Legacy Folder videos
    const profileVideos = (appData.socialVideos || []).map(v => ({ ...v, name: v.filename, date: v.date || Date.now(), isLocal: true, social: true }));
    const legacyVideos = (appData.youtubeVideos || []).map(v => ({ ...v, name: v.filename, date: v.date || Date.now(), isLocal: true, social: true }));
    const dlHistory = (appData.downloadHistory || []).filter(d => d.status === 'complete' && (d.social || d.isYoutube) && d.path);

    const seen = new Set();
    const all = [...profileVideos, ...legacyVideos, ...dlHistory].filter(v => {
      if (!v.path || seen.has(v.path)) return false;
      seen.add(v.path);
      return true;
    });
    // console.log('[RENDER-SOCIAL] Total videos after filter:', all.length);

    const list = q ? all.filter(v => (v.name || '').toLowerCase().includes(q)) : all;
    g.innerHTML = '';
    if (!list.length) {
      if (empty) empty.style.display = 'flex';
      const ct = $('#social-count'); if (ct) ct.textContent = '';
      updateBadges();
      return;
    }
    if (empty) empty.style.display = 'none';
    const ct = $('#social-count'); if (ct) ct.textContent = `(${list.length})`;

    list.forEach(v => {
      const card = document.createElement('div'); card.className = 'media-card';
      const title = (v.name || 'Untitled Content').replace(/\.[^.]+$/, '');
      let imgHTML = '<svg viewBox="0 0 48 48" width="40" height="40" fill="var(--accent)"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>';

      let isYtThumb = false;
      if (v.url) {
        const ytMatch = v.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        if (ytMatch && ytMatch[1]) {
          imgHTML = `<img src="https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;border-radius:0;">`;
          isYtThumb = true;
        }
      }

      if (!isYtThumb && v.path) {
        const custom = appData.banners[v.path];
        if (custom) {
          imgHTML = `<img src="${localImg(custom)}" style="width:100%;height:100%;object-fit:cover;border-radius:0;">`;
        } else if (v.image) {
          imgHTML = `<img src="${localImg(v.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:0;" onerror="this.style.display='none'">`;
        } else {
          // Canvas-based high quality thumbnail for local files
          const thumb = ensureThumbnail(v);
          if (thumb) {
            imgHTML = `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover;border-radius:0;">`;
          } else {
            imgHTML = `<div style="width:100%;height:100%;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;"><i class="fas fa-spinner fa-spin" style="opacity:0.2"></i></div>`;
          }
        }
      }

      card.innerHTML = `
        <div style="position:relative;width:100%;padding-top:56.25%;background:#0a0a0a;overflow:hidden;">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${imgHTML}</div>
          <div class="card-play-overlay">
            <div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div>
          </div>
          ${v.isLocal ? '<div class="local-badge" title="Local Video Folder">SOCIAL</div>' : ''}
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="card-meta">${new Date(v.date || Date.now()).toLocaleDateString()}</div>
        </div>`;

      card.onclick = () => playVideo({ ...v, id: v.path, title, path: v.path, type: 'social', isSocial: true }, null);
      card.oncontextmenu = e => {
        window.openContextMenuForItem({ ...v, id: v.path, title, path: v.path, type: 'social', filename: v.name, isLocal: true }, e);
      };
      g.appendChild(card);
    });
    updateBadges();
  }

  const hoverPreviewCache = new Map();

  async function resolvePreviewUrl(item) {
    if (!item) return null;
    const cacheKey = item.id;
    if (hoverPreviewCache.has(cacheKey)) {
      return hoverPreviewCache.get(cacheKey);
    }

    try {
      const directPreview = item.preview_url || item.video_url;
      if (directPreview) {
        hoverPreviewCache.set(cacheKey, directPreview);
        return directPreview;
      }

      let youtubeUrl = null;
      const isAnime = item.source === 'kitsu' || item.source === 'jikan' || item.source === 'mal' || item.source === 'anilist' || (item.format && item.format !== 'MOVIE') || (item.type === 'anime') || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));

      if (isAnime) {
        const malId = String(item.id).replace('mal:', '').replace('jikan:', '').replace('kitsu:', '');
        if (malId && !isNaN(malId)) {
          const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`);
          const json = await res.json();
          if (json?.data?.trailer?.youtube_id) {
            youtubeUrl = `https://www.youtube.com/watch?v=${json.data.trailer.youtube_id}`;
          }
        }
      } else {
        const imdbId = item.imdb_id || (item.id && String(item.id).startsWith('tt') ? item.id : null);
        if (imdbId) {
          const cinemetaDetail = await window.api.invoke('cinemeta-details', { id: imdbId, type: item.type || item.media_type || 'movie' });
          if (cinemetaDetail?.meta?.trailers) {
            const yt = cinemetaDetail.meta.trailers.find(t => t.source === 'youtube');
            if (yt) {
              youtubeUrl = `https://www.youtube.com/watch?v=${yt.id}`;
            }
          } else if (cinemetaDetail?.meta?.youtubeId) {
            youtubeUrl = `https://www.youtube.com/watch?v=${cinemetaDetail.meta.youtubeId}`;
          }
        } else {
          const tmdbId = item.tmdb_id || (item.id && !String(item.id).startsWith('tt') ? item.id : null);
          if (tmdbId) {
            const cinemetaDetail = await window.api.invoke('cinemeta-details', { id: String(tmdbId).startsWith('tmdb:') ? tmdbId : `tmdb:${tmdbId}`, type: item.type || item.media_type || 'movie' });
            if (cinemetaDetail?.meta?.trailers) {
              const yt = cinemetaDetail.meta.trailers.find(t => t.source === 'youtube');
              if (yt) {
                youtubeUrl = `https://www.youtube.com/watch?v=${yt.id}`;
              }
            } else if (cinemetaDetail?.meta?.youtubeId) {
              youtubeUrl = `https://www.youtube.com/watch?v=${cinemetaDetail.meta.youtubeId}`;
            }
          }
        }
      }

      if (youtubeUrl) {
        const instances = [
          'https://co.wuk.sh/api/json',
          'https://api.vve.wtf/api/json',
          'https://cobalt.q0.wtf/api/json',
          'https://cobalt.catbox.video/api/json',
          'https://api.cobalt.tools/api/json'
        ];

        for (const endpoint of instances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: youtubeUrl, videoQuality: '1080' }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await response.json();
            if (data && data.url) {
              hoverPreviewCache.set(cacheKey, data.url);
              return data.url;
            }
          } catch (e) {
            console.warn(`Cobalt resolution failed at ${endpoint}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('Failed to resolve preview URL:', e);
    }
    return null;
  }

  function enableHoverPreview(card, item, posterSelector) {
    let hoverTimeout = null;
    let previewVideo = null;
    let isHovered = false;

    card.addEventListener('mouseenter', () => {
      if (appData.authenticated === false || !navigator.onLine) return;
      isHovered = true;

      hoverTimeout = setTimeout(async () => {
        if (!isHovered || previewVideo) return;

        const previewUrl = await resolvePreviewUrl(item);
        if (!previewUrl || !isHovered) return;

        previewVideo = document.createElement('video');
        previewVideo.className = 'card-preview-video';
        previewVideo.src = previewUrl;
        previewVideo.muted = true;
        previewVideo.loop = true;
        previewVideo.playsInline = true;
        previewVideo.autoplay = true;

        previewVideo.onloadedmetadata = () => {
          if (previewVideo && previewVideo.duration > 0) {
            previewVideo.currentTime = previewVideo.duration * 0.1;
          }
        };

        previewVideo.onplaying = () => {
          if (previewVideo) previewVideo.style.opacity = '1';
        };

        previewVideo.onerror = () => {
          if (previewVideo) {
            previewVideo.remove();
            previewVideo = null;
          }
        };

        const posterContainer = card.querySelector(posterSelector);
        if (posterContainer && isHovered) {
          posterContainer.appendChild(previewVideo);
        }
      }, 300);
    });

    card.addEventListener('mouseleave', () => {
      isHovered = false;
      if (hoverTimeout) clearTimeout(hoverTimeout);
      if (previewVideo) {
        try {
          previewVideo.pause();
          previewVideo.removeAttribute('src');
          previewVideo.load();
        } catch (e) {}
        previewVideo.remove();
        previewVideo = null;
      }
    });
  }

  function createMediaCard(item) {
    const card = document.createElement('div'); card.className = 'media-card';
    const isRadio = item.type === 'radio' || item.media_type === 'radio';
    if (isRadio) {
      const radioName = item.title || item.name || 'Radio Station';
      const radioFavicon = item.favicon || item.logo || item.poster_path || item.posterPath || item.poster;
      let radioPoster = '';
      if (radioFavicon && radioFavicon !== 'imgs/appicon-w.png') {
        radioPoster = `<img src="${localImg(radioFavicon)}" style="width:100%;height:100%;object-fit:contain;padding:16px;box-sizing:border-box;position:relative;z-index:2;" loading="lazy" onerror="this.style.display='none';var ph=this.parentElement.querySelector('.card-poster-placeholder');if(ph){ph.style.display='flex';ph.style.opacity='1';}">`;
      }
      card.innerHTML = `
        <div class="card-poster" style="background: linear-gradient(135deg, rgba(30, 20, 50, 0.95), rgba(12, 10, 24, 0.98)); position: relative;">
          ${radioPoster}
          <div class="card-poster-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; position: absolute; inset: 0; padding: 14px; text-align: center; z-index: 1;">
            <div class="ph-icon" style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;box-shadow: 0 0 20px rgba(255,255,255,0.15);">
              <i class="fas fa-broadcast-tower" style="font-size: 26px; color: #ffffff;"></i>
            </div>
            <span class="ph-text" style="font-weight:700;color:#fff;font-size:13px;line-height:1.2;">${escapeHTML(radioName)}</span>
          </div>
          <div class="card-play-overlay">
            <div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHTML(radioName)}">${escapeHTML(radioName)}</div>
          <div class="card-meta"><i class="fas fa-radio" style="color: #ffffff; margin-right: 4px;"></i>Live Radio ${item.country ? `· ${escapeHTML(item.country)}` : ''}</div>
        </div>
      `;
      card.onclick = () => {
        if (typeof window.playRadioStation === 'function') {
          window.playRadioStation({
            id: item.id,
            name: radioName,
            url: item.radioUrl || item.url,
            favicon: radioFavicon,
            country: item.country,
            bitrate: item.bitrate
          });
          switchView('radio');
        } else {
          switchView('radio');
        }
      };
      return card;
    }

    const isIptv = item.type === 'iptv' || item.media_type === 'iptv';
    if (isIptv) {
      const chName = item.title || item.name || 'Live Channel';
      const chLogo = item.logo || item.tvgLogo || item.poster_path || item.posterPath || item.poster;
      let logoHTML = '';
      if (chLogo && chLogo !== 'imgs/appicon-w.png') {
        logoHTML = `<img src="${localImg(chLogo)}" style="width:100%;height:100%;object-fit:contain;padding:16px;box-sizing:border-box;position:relative;z-index:2;" loading="lazy" onerror="this.style.display='none';var ph=this.parentElement.querySelector('.card-poster-placeholder');if(ph){ph.style.display='flex';ph.style.opacity='1';}">`;
      }
      card.innerHTML = `
        <div class="card-poster" style="background: linear-gradient(135deg, rgba(15, 25, 40, 0.95), rgba(8, 12, 22, 0.98)); position: relative;">
          ${logoHTML}
          <div class="card-poster-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; position: absolute; inset: 0; padding: 14px; text-align: center; z-index: 1;">
            <div class="ph-icon" style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;box-shadow: 0 0 20px rgba(255,255,255,0.15);">
              <i class="fas fa-tv" style="font-size: 26px; color: #ffffff;"></i>
            </div>
            <span class="ph-text" style="font-weight:700;color:#fff;font-size:13px;line-height:1.2;">${escapeHTML(chName)}</span>
          </div>
          <div class="card-play-overlay">
            <div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHTML(chName)}">${escapeHTML(chName)}</div>
          <div class="card-meta"><i class="fas fa-tv" style="color: #ffffff; margin-right: 4px;"></i>IPTV ${item.category || item.groupTitle ? `· ${escapeHTML(item.category || item.groupTitle)}` : ''}</div>
        </div>
      `;
      card.onclick = () => {
        switchView('iptv');
        if (typeof window.selectIptvChannel === 'function') {
          window.selectIptvChannel({
            id: item.id,
            name: chName,
            url: item.streamUrl || item.url,
            logo: chLogo,
            category: item.category || item.groupTitle
          });
        }
      };
      return card;
    }

    const resolvedImdb = item?.imdb_id || item?.imdbId || item?.cinemetaId || (String(item?.id).startsWith('tt') ? item.id : null) || (item?.tmdbData && item.tmdbData.imdb_id);
    const isShow = item.type === 'show' || item.type === 'series' || item.type === 'tv' || item.media_type === 'tv' || item.media_type === 'series' || !!(item.episodes && item.episodes.length > 0);
    const epCount = isShow ? (item.episodes || []).length : 0;
    const isYoutube = item.isYoutube || item.type === 'youtube';
    const metadataKeys = getMediaMetadataKeys(item);
    const bannerKey = metadataKeys.find(k => appData.banners?.[k]) || item.id;
    const bannerPath = appData.banners[bannerKey];
    const tmdbRaw = getMetadataForItem(item);
    const tmdb = tmdbRaw ? {
      posterPath: tmdbRaw.posterPath || tmdbRaw.poster,
      backdropPath: tmdbRaw.backdropPath || tmdbRaw.backdrop,
      rating: tmdbRaw.rating,
      year: tmdbRaw.year,
      title: tmdbRaw.title || tmdbRaw.name,
      genreIds: tmdbRaw.genreIds
    } : null;
    let progressHTML = '';
    const pbKey = getPlaybackKey(item);
    if (!isShow && currentProfile?.playback?.[pbKey]?.duration > 0) {
      const pct = Math.min((currentProfile.playback[pbKey].time / currentProfile.playback[pbKey].duration) * 100, 100).toFixed(1);
      progressHTML = `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`;
    }
    let posterInner = '';

    // Priority 1: Local Banner (User uploaded or auto-downloaded)
    if (bannerPath) {
      const getSafeUrl = (p, t) => {
        if (!p) return '';
        if (p.startsWith('http')) return p;
        const size = t === 'backdrop' ? 'w780' : 'w342';
        return `https://image.tmdb.org/t/p/${size}${p}`;
      };
      const fallbackUrl = tmdb?.posterPath ? getSafeUrl(tmdb.posterPath, 'poster') : (tmdb?.backdropPath ? getSafeUrl(tmdb.backdropPath, 'backdrop') : '');
      const errScript = fallbackUrl ? `this.onerror=null;this.src='${fallbackUrl}';` : `this.style.display='none';this.parentElement.querySelector('.card-poster-placeholder')?.style.removeProperty('display')`;
      posterInner = `<img src="${localImg(bannerPath)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="${errScript}">`;
    }
    // Priority 2: TMDB Backdrop/Poster from cache (or Cinemeta fallback)
    else if (tmdb && (tmdb.posterPath || tmdb.backdropPath)) {
      const tmdbPath = tmdb.posterPath || tmdb.backdropPath;
      const tmdbType = tmdb.posterPath ? 'poster' : 'backdrop';
      posterInner = `<tmdb-image path="${tmdbPath}" type="${tmdbType}" style="width:100%;height:100%"></tmdb-image>`;
    }
    // Priority 2.5: Dynamic IMDb ID Poster Loader (Trakt watchlist/search results)
    else if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
      posterInner = `<img class="dynamic-imdb-poster" data-imdb="${resolvedImdb}" style="width:100%;height:100%;object-fit:cover;display:none" loading="lazy">`;
    }
    // Priority 3: Item's direct properties (Discover/Watchlist)
    else if (item.poster_path || item.backdrop_path || item.poster || item.cover) {
      const p = item.poster_path || item.backdrop_path || item.poster || item.cover;
      if (typeof p === 'string' && p.startsWith('/')) {
        posterInner = `<tmdb-image path="${p}" type="${item.poster_path ? 'poster' : 'backdrop'}" style="width:100%;height:100%"></tmdb-image>`;
      } else {
        posterInner = `<img src="${localImg(p)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display='none';this.parentElement.querySelector('.card-poster-placeholder')?.style.removeProperty('display')">`;
      }
    }
    // Priority 4: Canvas Thumbnail for local items (Movies/Single videos)
    else if (!isShow && (item.isLocal || (item.path && !item.path.startsWith('http')))) {
      const thumb = ensureThumbnail(item);
      if (thumb) posterInner = `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`;
    }
    const cardCert = getItemCertification(item);
    const cardAgeBadgeHtml = getAgeBadgeHTML(cardCert);

    const rVal = tmdb?.rating ? parseFloat(tmdb.rating) : 0;
    let ratingHTML = (!isNaN(rVal) && rVal > 0) ? `<div class="card-rating"><svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${rVal.toFixed(1)}</div>` : '';
    let metaText = isShow ? (epCount > 0 ? epCount + ' episodes' : 'TV Show') : (isYoutube ? 'Video' : 'Movie');
    if (tmdb?.year) metaText += ` · ${tmdb.year}`;

    // Add Genre Topics
    let genreHTML = '';
    if (tmdb?.genreIds && Array.isArray(tmdb.genreIds)) {
      const gNames = tmdb.genreIds.slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean);
      if (gNames.length > 0) {
        genreHTML = `<div class="card-genres">${gNames.join(' · ')}</div>`;
      }
    } else if (item.genre) {
      genreHTML = `<div class="card-genres">${escapeHTML(item.genre)}</div>`;
    }

    let imdbIdDisplay = '';
    if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
      imdbIdDisplay = `<div class="card-imdb-id" style="font-size: 10px; color: #e5a00d; margin-top: 4px; font-family: monospace; font-weight: bold; background: rgba(229,160,13,0.1); padding: 2px 6px; border-radius: 4px; display: inline-block;">IMDb: ${escapeHTML(resolvedImdb)}</div>`;
    }

    const displayTitle = tmdb?.title || tmdb?.name || item.title || item.name || 'Unknown';
    card.innerHTML = `<div class="card-poster">${posterInner}<div class="card-poster-placeholder" ${posterInner ? 'style="display:none"' : ''}><div class="ph-icon">${isYoutube ? '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L11.818 12l-6.273 3.568z"/></svg>' : (isShow ? SVG_SHOW : SVG_MOVIE)}</div><span class="ph-text">${escapeHTML(item.title || item.name || 'Unknown')}</span></div><div class="card-play-overlay"><div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div><button class="btn-tmdb-search" title="Search TMDB"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button></div></div><div class="card-info"><div class="card-title" title="${escapeHTML(displayTitle)}">${escapeHTML(displayTitle)}</div>${genreHTML}<div class="card-meta">${metaText}</div>${imdbIdDisplay}${ratingHTML}<span class="discover-age-badge-container">${cardAgeBadgeHtml}</span>${progressHTML}</div>`;
    card.querySelector('.btn-tmdb-search').onclick = (e) => { e.stopPropagation(); openTmdbSearchModal(item); };
    const isTV = item.type === 'show' || item.media_type === 'tv' || !!(item.episodes);
    card.onclick = () => {
      // Robust check to identify local media files from user's hard drive / library
      const isLocalItem = !!(
        item.isLocal ||
        (item.path && !item.path.startsWith('http') && !item.path.startsWith('tmdb:') && !item.path.startsWith('stremio:')) ||
        (item.localPath && !item.localPath.startsWith('http')) ||
        (appData.movies || []).some(m => m.id === item.id || (m.path && item.path && m.path === item.path)) ||
        (appData.shows || []).some(s => s.id === item.id)
      );

      const isLibraryView = ['library', 'movies', 'shows', 'social', 'music', 'downloads', 'hub'].includes(currentView);

      if (isLocalItem || isLibraryView) {
        if (isTV) {
          openShowDetail(item);
        } else {
          // Play local movie file directly with native player
          playVideo(item);
        }
        return;
      }
      // DISCOVER / ONLINE items: open discover detail page
      if (!item.media_type) item.media_type = isTV ? 'tv' : 'movie';
      openDiscoverDetail(item);
    };
    card.oncontextmenu = e => {
      window.openContextMenuForItem(item, e);
    };

    // --- Dynamic Hover Preview ---
    enableHoverPreview(card, item, '.card-poster');

    // Trigger dynamic poster/certification load if the card requires it or has resolved IMDb
    if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
      setTimeout(() => {
        getTraktOrImdbPoster(item, card.querySelector('.dynamic-imdb-poster'), card);
      }, 0);
    }

    return card;
  }

  function openShowDetail(show, partName = null) {
    if (!show) return;
    if (!isAgeAllowed(show)) {
      showToast('This content is restricted by age rating filters.');
      return;
    }
    currentShowId = show.id;
    currentShow = show;
    currentEpisodes = Array.isArray(show.episodes) ? show.episodes : [];
    currentEpisodeIndex = -1;
    if (!partName && show.parts?.length > 0) currentPart = show.parts[0].name; else currentPart = partName;
    let tmdb = getMetadataForItem(show);
    if (!tmdb) {
      // Prefer fetching by IMDb ID directly (Trakt items always have one) to avoid
      // wrong-result title-search collisions (e.g. "Arcane" returning a Dutch thriller).
      const resolvedImdb = show.imdb_id || show.imdbId ||
        (String(show.id).startsWith('tt') ? show.id : null);
      const isShow = show.type === 'show' || show.type === 'series' || show.type === 'tv' || !!(show.episodes);
      const targetType = isShow ? 'tv' : 'movie';
      const stremioType = isShow ? 'series' : 'movie';

      const handleCinemetaMeta = (meta, sourceId) => {
        if (!meta) return false;
        const metaObj = {
          cinemetaId: meta.id || sourceId,
          type: targetType,
          title: meta.name || meta.title || show.title,
          poster: meta.poster || null,
          backdrop: meta.background || null,
          year: meta.year || (meta.release_date || meta.first_air_date || '').slice(0, 4),
          rating: meta.imdbRating || meta.rating || 0,
          genres: meta.genres || [],
          description: meta.description || meta.synopsis || ''
        };
        appData.cinemetaCache = appData.cinemetaCache || {};
        appData.cinemetaCache[show.id] = metaObj;
        if (appData.banners) delete appData.banners[show.id]; // Clear any wrong banner
        persist();

        if (isShow && meta.videos && meta.videos.length) {
          metaObj.seasons = {};
          meta.videos.forEach(v => {
            const s = String(v.season);
            metaObj.seasons[s] = metaObj.seasons[s] || {};
            metaObj.seasons[s][v.episode] = {
              episode_number: v.episode,
              name: v.name || v.title || null,
              overview: v.overview || null,
              still_path: v.thumbnail || null
            };
          });
          persist();
        }
        if (currentShowId === show.id) openShowDetail(show, currentPart);
        return true;
      };

      if (resolvedImdb) {
        // Direct lookup by IMDb ID — guaranteed correct result
        window.api.invoke('cinemeta-details', { id: resolvedImdb, type: stremioType })
          .then(data => {
            const meta = data?.meta || data;
            if (!handleCinemetaMeta(meta, resolvedImdb) && isShow) {
              // If cinemeta-details returned no data, also try episodes fetch with same id
              window.api.invoke('cinemeta-details', { id: resolvedImdb, type: 'series' })
                .then(d2 => handleCinemetaMeta(d2?.meta || d2, resolvedImdb))
                .catch(() => {});
            }
          }).catch(() => {
            // Fallback to title search only if direct ID fetch fails
            const query = show.cleanTitle || show.title;
            if (!query || query.length < 2) return;
            window.api.cinemetaSearch(query).then(res => {
              if (!res.results?.length) return;
              let m = res.results.find(r => r.id === resolvedImdb);
              if (!m) m = res.results.find(r => r.media_type === targetType);
              if (!m) m = res.results[0];
              if (m) handleCinemetaMeta({ ...m, name: m.name || m.title }, m.id);
            }).catch(() => {});
          });
      } else {
        // No IMDb ID available — use title search
        const query = show.cleanTitle || show.title;
        if (query && query.length > 1) {
          window.api.cinemetaSearch(query).then(res => {
            if (res.results?.length) {
              let m = res.results.find(r => r.media_type === targetType);
              if (!m) m = res.results.find(r => r.id && r.id.startsWith('tt'));
              if (!m) m = res.results[0];
              if (m) {
                handleCinemetaMeta({ ...m, name: m.name || m.title }, m.id);
                if (isShow && m.id) {
                  window.api.invoke('cinemeta-details', { id: m.id, type: 'series' })
                    .then(data => handleCinemetaMeta(data?.meta || data, m.id))
                    .catch(() => {});
                }
              }
            }
          }).catch(err => console.warn('[DYNAMIC-MATCH] Cinemeta matching failed:', err));
        }
      }
    }

    // Clear header title as we move it below
    $('#show-detail-title').textContent = '';
    const metaEl = $('#show-detail-meta'); metaEl.innerHTML = '';

    const headerLeft = $('#view-show-detail .view-header-left');
    $('#btn-mark-all-watched')?.remove();

    const el = $('#episode-list'); el.innerHTML = '';

    // 1. Season/Parts Tabs at the very top
    if (show.parts?.length > 1) {
      const pt = document.createElement('div');
      pt.className = 'season-tabs';
      pt.style = 'margin-bottom: 20px; padding: 0 10px;';
      show.parts.forEach(p => {
        const t = document.createElement('div');
        t.className = 'season-tab' + (p.name === currentPart ? ' active' : '');
        t.textContent = p.name;
        t.onclick = () => openShowDetail(show, p.name);
        pt.appendChild(t);
      });
      el.appendChild(pt);
    }

    // 2. Info Hero Area (Split Layout)
    const hero = document.createElement('div');
    hero.className = 'show-hero';
    hero.style = 'display:flex; gap:40px; margin: 20px 0 40px 0; padding: 0 10px; align-items: flex-start;';

    // Left Side: Poster (The "Show Card")
    const posterWrap = document.createElement('div');
    posterWrap.style = 'width: 260px; flex-shrink: 0; border-radius: 20px; overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); background: #111; position: sticky; top: 20px;';

    // Poster Source Logic: Handle TMDB paths correctly
    let posterPath = tmdb?.posterPath || tmdb?.poster || show.poster;
    let fullPosterUrl = 'imgs/no-backdrop.png';
    if (posterPath) {
      if (posterPath.startsWith('http') || posterPath.startsWith('data:') || posterPath.startsWith('src/')) {
        fullPosterUrl = posterPath;
      } else if (posterPath.startsWith('/')) {
        fullPosterUrl = `https://image.tmdb.org/t/p/w500${posterPath}`;
      } else {
        fullPosterUrl = localImg(posterPath);
      }
    }

    const posterImg = document.createElement('img');
    posterImg.style = 'width: 100%; display: block; aspect-ratio: 2/3; object-fit: cover;';
    posterImg.src = fullPosterUrl;
    posterImg.onerror = () => { posterImg.onerror = null; posterImg.src = 'imgs/no-backdrop.png'; };
    posterWrap.appendChild(posterImg);

    // Dynamic Age Rating under poster
    const localAgeRating = show.certification || show.contentRating || show.content_rating || tmdb?.certification || tmdb?.content_rating;
    if (localAgeRating) {
      const ageText = document.createElement('div');
      ageText.style = 'padding: 12px; text-align: center; font-size: 12px; font-weight: 800; color: #fff; background: rgba(0,0,0,0.75); border-top: 1px solid rgba(255,255,255,0.08);';
      const numericAge = typeof certificationToAge === 'function' ? certificationToAge(localAgeRating) : 0;
      ageText.textContent = `Age Rating: ${localAgeRating} (${numericAge > 0 ? numericAge + '+' : 'All Ages'})`;
      posterWrap.appendChild(ageText);
    }

    hero.appendChild(posterWrap);

    // Right Side: Details
    const details = document.createElement('div');
    details.style = 'flex: 1; min-width: 0; padding-top: 10px;';

    const titleH1 = document.createElement('h1');
    titleH1.style = 'font-size:48px; font-weight:900; margin:0 0 12px 0; color:#fff; line-height:1; letter-spacing:-1px;';
    titleH1.textContent = tmdb?.title || show.title;
    details.appendChild(titleH1);

    const badgeRow = document.createElement('div');
    badgeRow.className = 'show-detail-meta';
    badgeRow.style = 'display:flex; gap:12px; flex-wrap:wrap; margin-bottom: 25px; align-items: center;';

    if (localAgeRating) {
      badgeRow.innerHTML += `<span class="tmdb-badge" style="background:rgba(0,173,181,0.15); border-color:rgba(0,173,181,0.3); color:#00adb5; font-weight:800;">${localAgeRating}</span>`;
    }

    let countBadge = null;
    const epCount = currentEpisodes.length;
    const epText = epCount > 0 ? `${epCount} ${epCount === 1 ? 'Episode' : 'Episodes'}` : (show.parts?.length ? `${show.parts.length} Parts` : '');
    if (epText) {
      countBadge = document.createElement('span');
      countBadge.className = 'tmdb-badge';
      countBadge.style = 'background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.7); font-weight: 700;';
      countBadge.textContent = epText;
      badgeRow.appendChild(countBadge);
      
      const countEl = $('#show-detail-count');
      if (countEl) {
        countEl.textContent = `${epCount || show.parts?.length || 0} ITEMS`;
        countEl.style.display = 'inline-block';
      }
    }

    if (tmdb) {
      const rVal = tmdb.rating ? parseFloat(tmdb.rating) : 0;
      if (!isNaN(rVal) && rVal > 0) badgeRow.innerHTML += `<span class="tmdb-badge" style="background:rgba(245,158,11,0.15); border-color:rgba(245,158,11,0.3); color:#F59E0B; font-weight:800;"><svg viewBox="0 0 24 24" width="13" height="13" fill="#F59E0B" stroke="none" style="margin-right:6px; margin-top:-2px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${rVal.toFixed(1)}</span>`;
      if (tmdb.year) badgeRow.innerHTML += `<span class="tmdb-badge" style="background: rgba(255,255,255,0.08); font-weight:700;">${tmdb.year}</span>`;

      // Add Genres
      const gIds = tmdb.genres || tmdb.genre_ids || [];
      if (Array.isArray(gIds) && gIds.length > 0) {
        gIds.slice(0, 3).forEach(g => {
          const gName = (typeof g === 'object') ? g.name : GENRE_MAP[g];
          if (gName) {
            badgeRow.innerHTML += `<span class="tmdb-badge" style="background:transparent; border: 1px solid rgba(255,255,255,0.15); opacity:0.8; font-size:11px">${gName}</span>`;
          }
        });
      }
    }
    details.appendChild(badgeRow);

    // Overview/Description
    if (tmdb?.overview) {
      const overviewP = document.createElement('p');
      overviewP.style = 'font-size: 16px; color: rgba(255,255,255,0.6); line-height: 1.7; margin: 25px 0; max-width: 900px; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;';
      overviewP.textContent = tmdb.overview;
      details.appendChild(overviewP);
    }

    // Mark All Watched Button
    if (currentEpisodes.length > 0) {
      const b = document.createElement('button');
      b.id = 'btn-mark-all-watched';
      b.className = 'btn-outline';
      b.style.cssText = 'padding:12px 24px; font-size:14px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); margin-top: 15px; font-weight: 700;';
      b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:10px"><polyline points="20 6 9 17 4 12"/></svg> Mark All Watched';
      b.onclick = markAllWatched;
      details.appendChild(b);

      // Classification Area
      const classification = document.createElement('div');
      classification.style = 'margin-top: 25px; display: flex; flex-direction: column; gap: 8px;';

      let typeText = tmdb?.type === 'tv' ? 'TV Series' : 'Movie';
      const certification = tmdb?.certification || tmdb?.content_rating;

      classification.innerHTML = `
        <div style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.5px;">Classification</div>
        <div style="font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.8); display: flex; align-items: center; gap: 10px;">
          <span style="color: var(--accent);">${typeText}</span>
          ${certification ? `<span style="width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.2);"></span><span>${certification}</span>` : ''}
        </div>
      `;
      details.appendChild(classification);
    }

    // TMDB API suggestion banner notice
    const isTmdbActive = appData.tmdbKey && appData.tmdbEnabled !== false;
    if (!isTmdbActive) {
      const banner = document.createElement('div');
      banner.className = 'tmdb-notice-banner';
      banner.style.cssText = 'margin: 25px 0 0 0; padding: 18px 24px; background: #000000; border: 1.5px solid rgba(255, 255, 255, 0.45); border-radius: 16px; display: flex; align-items: center; justify-content: space-between; gap: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.95), 0 0 25px rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); max-width: 750px; transition: all 0.3s ease; flex-wrap: wrap;';
      banner.innerHTML = `
        <div style="display: flex; gap: 15px; align-items: center; flex: 1; min-width: 280px;">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); border: 1.5px solid rgba(255, 255, 255, 0.7); display: flex; align-items: center; justify-content: center; color: #ffffff; box-shadow: 0 0 20px rgba(255, 255, 255, 0.15); flex-shrink: 0;">
                <i class="fas fa-magic" style="font-size: 18px; color: #ffffff;"></i>
            </div>
            <div style="display: flex; flex-direction: column; gap: 3px; text-align: left;">
                <div style="font-size: 14px; font-weight: 800; color: #ffffff; letter-spacing: 0.3px;">Enhance Your TV Show Experience</div>
                <div style="font-size: 12.5px; color: rgba(255, 255, 255, 0.75); line-height: 1.5; font-weight: 500;">
                    Missing those episode posters? We can fix that! Simply add your TMDB API key in Settings, and we'll handle the rest.
                </div>
            </div>
        </div>
        <button class="btn-primary" style="background: #ffffff; border: none; color: #000000; padding: 10px 22px; font-size: 12px; font-weight: 800; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s ease; box-shadow: 0 4px 20px rgba(255, 255, 255, 0.3); white-space: nowrap;" onclick="switchView('settings')" onmouseover="this.style.background='#f4f4f5'; this.style.transform='translateY(-2px)';" onmouseout="this.style.background='#ffffff'; this.style.transform='none';">
            <i class="fas fa-cog" style="color: #000000;"></i> <span style="color: #000000; font-weight: 800;">GO TO SETTINGS</span>
        </button>
      `;
      details.appendChild(banner);
    }

    hero.appendChild(details);
    el.appendChild(hero);

    const filtered = (currentPart && Array.isArray(currentEpisodes)) ? currentEpisodes.filter(e => e.partName === currentPart) : (Array.isArray(currentEpisodes) ? currentEpisodes : []);
    if (countBadge) countBadge.textContent = `${filtered.length} Episodes`;

    const seasons = {};
    if (Array.isArray(filtered)) {
      filtered.forEach(ep => { (seasons[ep.season] = seasons[ep.season] || []).push(ep); });
    }
    const cachedSeasons = (tmdb?.seasons || {});



    Object.keys(seasons).sort((a, b) => +a - +b).forEach(sn => {
      const h = document.createElement('div'); h.className = 'season-header'; h.style.display = 'flex'; h.style.justifyContent = 'space-between'; h.style.alignItems = 'center';
      const mSn = (appData.seasonOffset && appData.seasonOffset[`${show.id}_${sn}`]) || sn;
      const seasonLabel = parseInt(sn) === 0 ? 'Specials' : `Season ${sn}`;
      h.innerHTML = `<span>${seasonLabel} ${mSn != sn ? `<span style="opacity:0.5;font-size:11.5px;margin-left:6px">(TMDB S${mSn})</span>` : ''}</span><div style="display:flex;gap:6px;"><button class="btn-outline btn-move-episode" style="padding:4px 10px;font-size:11px;opacity:0.8;border-color:var(--border)" title="Move a video file into this season folder">Move Episode</button><button class="btn-outline btn-rename-season" style="padding:4px 10px;font-size:11px;opacity:0.8;border-color:var(--border)" title="Rename files to TMDB episode names">Rename Files</button><button class="btn-outline btn-fix-tmdb" style="padding:4px 10px;font-size:11px;opacity:0.8;border-color:var(--border)">Fix TMDB Match</button></div>`;
      h.querySelector('.btn-move-episode').onclick = () => moveNewEpisodeDialog(show.id, sn);
      h.querySelector('.btn-fix-tmdb').onclick = (e) => {
        const btn = e.target;
        btn.style.display = 'none';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.className = 'no-spinners'; inp.placeholder = 'Real S#'; inp.style.cssText = 'width:60px;font-size:12px;padding:3px;margin-right:6px;background:transparent;color:var(--text-primary);border:1px solid var(--border);border-radius:6px;outline:none;text-align:center;font-weight:600';
        const save = document.createElement('button');
        save.className = 'btn-primary'; save.innerHTML = 'Save'; save.style.cssText = 'padding:4px 10px;font-size:11px;min-width:0;border-radius:6px';
        save.onclick = () => {
          const offset = parseInt(inp.value);
          if (!isNaN(offset)) {
            appData.seasonOffset = appData.seasonOffset || {};
            appData.seasonOffset[`${show.id}_${sn}`] = offset;
            const tmdb = (appData.tmdbCache || {})[show.id];
            if (tmdb && tmdb.seasons) delete tmdb.seasons[sn];
            persist(); openShowDetail(show, currentPart);
          }
        };
        const div = document.createElement('div'); div.style.display = 'flex'; div.appendChild(inp); div.appendChild(save);
        btn.parentNode.insertBefore(div, btn);
        inp.focus();
      };

      h.querySelector('.btn-rename-season').onclick = async (e) => {
        const btn = e.target;
        btn.textContent = 'Renaming...';
        btn.style.pointerEvents = 'none';
        let renamedCount = 0;

        const cachedSeasons = (tmdb?.seasons || {});
        const tmdbEps = cachedSeasons[sn] || {};

        for (const ep of seasons[sn]) {
          const epNum = parseInt(ep.episode);
          const tE = tmdbEps[epNum] || tmdbEps[String(ep.episode)];
          if (tE?.name && !ep.isStream && !ep.path.startsWith('http')) {
            const cleanName = tE.name.replace(/[\\/:*?"<>|]/g, '').trim();
            const targetName = `E${ep.episode} - ${cleanName}`;

            const currentFilename = ep.filename || ep.path.split(/[/\\]/).pop();
            const currentNameNoExt = currentFilename.substring(0, currentFilename.lastIndexOf('.')) || currentFilename;

            if (currentNameNoExt !== targetName) {
              const oldKey = getPlaybackKey(ep);
              const ext = currentFilename.substring(currentFilename.lastIndexOf('.'));
              const res = await window.api.renameFile(ep.path, targetName + ext);
              if (res && res.success && res.newPath) {
                ep.path = res.newPath;
                ep.id = res.newPath;
                ep.filename = res.newPath.split(/[/\\]/).pop();
                ep.title = targetName;

                const newKey = getPlaybackKey(ep);
                if (currentProfile?.playback && currentProfile.playback[oldKey]) {
                  currentProfile.playback[newKey] = currentProfile.playback[oldKey];
                  delete currentProfile.playback[oldKey];
                }
                renamedCount++;
              }
            }
          }
        }

        btn.textContent = `Renamed ${renamedCount}`;
        if (renamedCount > 0) {
          persist();
          scanLibrary();
          setTimeout(() => openShowDetail(currentShow, currentPart), 1000);
        } else {
          setTimeout(() => { btn.textContent = 'Rename Files'; btn.style.pointerEvents = 'auto'; }, 2000);
        }
      };
      el.appendChild(h);
      const cachedSeasons = (tmdb?.seasons || {});
      const tmdbEps = cachedSeasons[sn] || {};

      const seasonContainer = document.createElement('div');
      seasonContainer.className = 'season-container';
      seasonContainer.style.display = 'contents';
      el.appendChild(seasonContainer);

      const renderEps = () => {
        seasonContainer.innerHTML = '';

        seasons[sn].forEach((ep, epIdx) => {
          const idx = currentEpisodes.indexOf(ep);
          const it = document.createElement('div');
          it.className = 'episode-item';
          it.style.animationDelay = `${Math.min(epIdx * 0.05, 1)}s`;
          const pb = currentProfile?.playback?.[ep.path] || {};
          const isW = pb.watched || (pb.duration > 0 && (pb.time / pb.duration) > .9);
          let pH = ''; if (pb.duration > 0) pH = `<div class="episode-progress"><div class="episode-progress-fill" style="width:${Math.min((pb.time / pb.duration) * 100, 100).toFixed(1)}%"></div></div>`;

          const epNum = parseInt(ep.episode);
          const tE = tmdbEps[epNum] || tmdbEps[String(ep.episode)];
          const epTitle = tE?.name || ep.title;
          const epDesc = tE?.overview || '';
          let stillPath = tE?.local_still ? `file:///${tE.local_still.replace(/\\/g, '/')}` : (tE?.still_path || '');
          if (!stillPath) {
            stillPath = tmdb?.backdrop_path || tmdb?.backdropPath || show?.backdrop_path || show?.backdrop || tmdb?.poster_path || tmdb?.posterPath || show?.poster_path || show?.poster || '';
          }

          it.innerHTML = `<div class="ep-thumb-wrap">
              <tmdb-image class="ep-thumb" type="still" path="${stillPath}"></tmdb-image>
              <div class="ep-thumb-placeholder" style="display:${stillPath ? 'none' : 'flex'};position:absolute;inset:0;align-items:center;justify-content:center;background:#141414;flex-direction:column;gap:4px">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16"/></svg>
                <span style="font-size:11px;opacity:0.4;font-weight:700">E${ep.episode}</span>
              </div>
              <div class="ep-play-overlay"><svg viewBox="0 0 24 24"><polygon points="8 5 20 12 8 19"/></svg></div>
            </div>
            <div class="episode-info">
              <div class="episode-title">${escapeHTML(epTitle)} ${isW ? '<span class="watched-badge">WATCHED</span>' : ''}</div>
              ${epDesc ? `<div class="episode-desc">${escapeHTML(epDesc)}</div>` : ''}
              <div class="episode-meta-row">
                <span class="episode-meta">S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}</span>
                ${pH}
              </div>
            </div>`;
          it.onclick = () => { currentEpisodeIndex = idx; playVideo(ep, show); };
          it.oncontextmenu = e => {
            ep._tmdbName = tE?.name ? `E${ep.episode} - ${tE.name.replace(/[\\/:*?"<>|]/g, '').trim()}` : null;
            window.openContextMenuForItem(ep, e);
          };
          seasonContainer.appendChild(it);
        });
      };

      renderEps();

      // ── Async episode enrichment via TMDB (with key) or Cinemeta (fallback) ──
      if (!cachedSeasons[sn]) {
        const tmdbKey = appData.tmdbKey;
        const tmdbEnabled = appData.tmdbEnabled !== false;
        const mappedSn = (appData.seasonOffset && appData.seasonOffset[`${show.id}_${sn}`]) || sn;
        const showId = tmdb?.tmdbId || tmdb?.id || tmdb?.cinemetaId || null;

        const fetchFromCinemeta = () => {
          const cinemetaId = tmdb?.cinemetaId || (tmdb?.tmdbId ? String(tmdb.tmdbId) : (tmdb?.id || null));
          if (cinemetaId) {
            window.api.invoke('cinemeta-details', { id: cinemetaId, type: 'series' }).then(data => {
              const meta = data?.meta || data;
              if (meta?.videos?.length) {
                meta.videos.forEach(v => {
                  if (Number(v.season) === Number(mappedSn)) {
                    tmdbEps[v.episode] = {
                      episode_number: v.episode,
                      name: v.name || v.title || null,
                      overview: v.overview || null,
                      still_path: v.thumbnail || null
                    };
                  }
                });
              }
              if (tmdb) {
                tmdb.seasons = tmdb.seasons || {};
                tmdb.seasons[sn] = tmdbEps;
                persist();
                renderEps();
              }
            }).catch(() => {
              if (tmdb) {
                tmdb.seasons = tmdb.seasons || {};
                tmdb.seasons[sn] = tmdb.seasons[sn] || {};
                persist();
                renderEps();
              }
            });
          } else {
            if (tmdb) {
              tmdb.seasons = tmdb.seasons || {};
              tmdb.seasons[sn] = tmdb.seasons[sn] || {};
              persist();
              renderEps();
            }
          }
        };

        if (tmdbEnabled && tmdbKey && showId) {
          const getTvDetails = async (tvId) => {
            const seasonUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/${mappedSn}?api_key=${tmdbKey}`;
            try {
              const resp = await fetch(seasonUrl);
              const data = await resp.json();
              if (data && data.episodes) {
                data.episodes.forEach(e => {
                  tmdbEps[e.episode_number] = {
                    episode_number: e.episode_number,
                    name: e.name || null,
                    overview: e.overview || null,
                    still_path: e.still_path || null
                  };
                });
                if (tmdb) {
                  tmdb.seasons = tmdb.seasons || {};
                  tmdb.seasons[sn] = tmdbEps;
                  persist();
                  renderEps();
                }
              } else {
                fetchFromCinemeta();
              }
            } catch (err) {
              console.warn('[TMDB Season Fetch] failed, falling back to Cinemeta:', err.message);
              fetchFromCinemeta();
            }
          };

          if (String(showId).startsWith('tt')) {
            const findUrl = `https://api.themoviedb.org/3/find/${showId}?api_key=${tmdbKey}&external_source=imdb_id`;
            fetch(findUrl)
              .then(r => r.json())
              .then(data => {
                const tvItem = data?.tv_results?.[0];
                if (tvItem && tvItem.id) {
                  getTvDetails(tvItem.id);
                } else {
                  fetchFromCinemeta();
                }
              })
              .catch(err => {
                console.warn('[TMDB Find TV ID] failed:', err.message);
                fetchFromCinemeta();
              });
          } else {
            getTvDetails(showId);
          }
        } else {
          fetchFromCinemeta();
        }
      }
    });
    switchView('show-detail');
  }

  async function ensureSeasonMetadata(showId, seasonNum, type) {
    if (!showId) return;
    let tmdb = (appData.tmdbCache || {})[showId] || (appData.cinemetaCache || {})[showId];
    if (!tmdb) {
      appData.tmdbCache = appData.tmdbCache || {};
      appData.tmdbCache[showId] = { id: showId, seasons: {} };
      tmdb = appData.tmdbCache[showId];
    }
    tmdb.seasons = tmdb.seasons || {};
    if (tmdb.seasons[seasonNum]) return;

    let resolveId = showId;
    if (typeof showId === 'string' && (showId.includes('\\') || showId.includes('/'))) {
        const showIdNorm = showId.replace(/\\/g, '/').toLowerCase();
        const matchedShow = (appData.shows || []).find(s => s.id && s.id.replace(/\\/g, '/').toLowerCase() === showIdNorm);
        if (matchedShow && matchedShow.tmdbId) {
            resolveId = matchedShow.tmdbId;
        } else {
            resolveId = tmdb.tmdbId || tmdb.id || tmdb.tmdb_id || showId;
        }
    }

    const tmdbKey = appData.tmdbKey || '14cc163152a514d455d31590ab8d4d8c';
    const tmdbEnabled = appData.tmdbEnabled !== false;
    const tmdbEps = {};

    const saveSeasonsMetadata = (eps) => {
      if (Object.keys(eps).length > 0) {
        tmdb.seasons[seasonNum] = eps;
        // Keep both path key and resolved numeric/imdb ID mapped to the cache
        if (resolveId && resolveId !== showId) {
          appData.tmdbCache[resolveId] = tmdb;
        }
        persist();
      }
    };

    const fetchFromCinemeta = async () => {
      const cinemetaId = tmdb.cinemetaId || (tmdb.tmdbId ? String(tmdb.tmdbId) : resolveId);
      try {
        const data = await window.api.invoke('cinemeta-details', { id: cinemetaId, type: 'series' });
        const meta = data?.meta || data;
        if (meta && meta.videos && meta.videos.length) {
          meta.videos.forEach(v => {
            if (Number(v.season) === Number(seasonNum)) {
              tmdbEps[v.episode] = {
                episode_number: v.episode,
                name: v.name || v.title || null,
                overview: v.overview || null,
                still_path: v.thumbnail || null
              };
            }
          });
          saveSeasonsMetadata(tmdbEps);
        }
      } catch (e) {
        console.warn('[Cinemeta Side Panel Fetch] failed:', e.message);
      }
    };

    if (tmdbEnabled && tmdbKey) {
      const getTvDetails = async (tvId) => {
        const seasonUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNum}?api_key=${tmdbKey}`;
        try {
          const resp = await fetch(seasonUrl);
          const data = await resp.json();
          if (data && data.episodes) {
            data.episodes.forEach(e => {
              tmdbEps[e.episode_number] = {
                episode_number: e.episode_number,
                name: e.name || null,
                overview: e.overview || null,
                still_path: e.still_path || null
              };
            });
            saveSeasonsMetadata(tmdbEps);
          } else {
            await fetchFromCinemeta();
          }
        } catch (err) {
          console.warn('[TMDB Side Panel Fetch] failed:', err.message);
          await fetchFromCinemeta();
        }
      };

      if (String(resolveId).startsWith('tt')) {
        try {
          const findUrl = `https://api.themoviedb.org/3/find/${resolveId}?api_key=${tmdbKey}&external_source=imdb_id`;
          const r = await fetch(findUrl);
          const data = await r.json();
          const tvItem = data?.tv_results?.[0];
          if (tvItem && tvItem.id) {
            await getTvDetails(tvItem.id);
          } else {
            await fetchFromCinemeta();
          }
        } catch (err) {
          console.warn('[TMDB Find TV ID Side Panel] failed:', err.message);
          await fetchFromCinemeta();
        }
      } else {
        await getTvDetails(resolveId);
      }
    } else {
      await fetchFromCinemeta();
    }
  }

  async function markAllWatched() {
    if (!currentShow || !currentProfile) return;
    if (!currentProfile.playback) currentProfile.playback = {};
    (currentPart ? currentEpisodes.filter(e => e.partName === currentPart) : currentEpisodes).forEach(ep => {
      const pbKey = getPlaybackKey(ep);
      currentProfile.playback[pbKey] = { ...(currentProfile.playback[pbKey] || {}), watched: true, time: 0, lastWatched: Date.now() };
    });
    await persist();
    openShowDetail(currentShow, currentPart);
    showToast('Marked as watched');
  }

  // ── Mod-Gated Sidebar Visibility ──
  // Controls which sidebar sections are visible based on installed addons (Mods).
  // MediaVault is a neutral player — content-discovery features only appear
  // when the user has installed the corresponding Mod.
  function updateModGatedViews() {
    if (window.AppCapabilities) {
      window.AppCapabilities.refresh();
    }

    const addons = appData.installedAddons || [];
    const urls = addons.map(a => (a.url || a.manifestUrl || '').toLowerCase());
    const ids = addons.map(a => (a.id || '').toLowerCase());
    const names = addons.map(a => (a.name || '').toLowerCase());

    const hasAddon = (patterns) => patterns.some(p =>
      urls.some(u => u.includes(p)) ||
      ids.some(i => i.includes(p)) ||
      names.some(n => n.includes(p))
    );

    // Determine which feature categories are available via AppCapabilities or fallback
    const showMoviesBtn = window.AppCapabilities ? window.AppCapabilities.can('catalog') : (hasAddon(['cinemeta', 'tmdb', 'tmdb-addon', 'tmdb.elfhosted']) || (appData.movies || []).length > 0);
    const showShowsBtn = window.AppCapabilities ? window.AppCapabilities.can('catalog') : (hasAddon(['cinemeta', 'tmdb', 'tmdb-addon', 'tmdb.elfhosted']) || (appData.shows || []).length > 0);
    const showSubtitlesBtn = window.AppCapabilities ? window.AppCapabilities.can('subtitles') : hasAddon(['subdl', 'opensubtitles', 'subscene']);
    const showBannerBtn = window.AppCapabilities ? window.AppCapabilities.can('banner-search') : true;

    // Discover requires a catalog addon (Cinemeta/TMDB) to be installed
    const showDiscoverBtn = window.AppCapabilities ? window.AppCapabilities.can('catalog') : hasAddon(['cinemeta', 'tmdb', 'tmdb-addon', 'tmdb.elfhosted']);
    // Search & Watchlist are ALWAYS visible as core features
    const showSearchBtn = true;
    const showWatchlistBtn = true;

    // Apply visibility
    const applyNav = (id, visible) => {
      const el = $(id);
      if (!el) return;
      el.style.display = visible ? '' : 'none';
    };

    applyNav('#nav-movies', showMoviesBtn);
    applyNav('#nav-shows', showShowsBtn);
    applyNav('#nav-discover', showDiscoverBtn);
    applyNav('#nav-search', showSearchBtn);
    applyNav('#nav-watchlist', showWatchlistBtn);
    applyNav('#nav-subtitles', showSubtitlesBtn);

    const bannerBtn = $('#btn-fav-banner');
    if (bannerBtn) {
      bannerBtn.style.display = showBannerBtn ? 'flex' : 'none';
    }

    // Keep EXPLORE group visible
    const exploreLabel = document.querySelector('.sidebar-label[data-group="explore"]');
    if (exploreLabel) {
      const exploreGroup = exploreLabel.parentElement;
      if (exploreGroup) {
        exploreGroup.style.display = '';
        const prevSeparator = exploreGroup.previousElementSibling;
        if (prevSeparator && prevSeparator.classList.contains('sidebar-separator')) {
          prevSeparator.style.display = '';
        }
      }
    }

    // If the current view became hidden, redirect to a safe view
    const hiddenViews = [];
    if (!showSubtitlesBtn) hiddenViews.push('subtitles');
    if (!showMoviesBtn) hiddenViews.push('movies');
    if (!showShowsBtn) hiddenViews.push('shows');

    if (typeof currentView !== 'undefined' && hiddenViews.includes(currentView)) {
      const safeViews = ['discover', 'search', 'watchlist', 'music', 'downloads', 'settings'];
      if (showMoviesBtn) safeViews.unshift('movies');
      if (showShowsBtn) safeViews.unshift('shows');
      const fallback = safeViews[0] || 'settings';
      switchView(fallback);
    }
  }

  // ── Sidebar ──
  function renderSidebar() {
    renderSidebarFolders();
    renderSettingsFolders();
    // Refresh mod-gated visibility each time the sidebar renders
    updateModGatedViews();

    // Apply initial collapsed states
    const ui = appData.uiState || { collapsedGroups: [] };
    $$('.sidebar-group').forEach(group => {
      const label = group.querySelector('.sidebar-label');

      if (label && ui.collapsedGroups.includes(label.dataset.group)) {
        group.classList.add('collapsed');
      }
    });
  }

  function initSidebarGroups() {
    $$('.sidebar-label').forEach(label => {
      const groupId = label.dataset.group;
      if (!groupId) return;

      label.onclick = () => {
        const group = label.parentElement;
        const isCollapsed = group.classList.toggle('collapsed');

        if (!appData.uiState) appData.uiState = { collapsedGroups: [] };
        if (isCollapsed) {
          if (!appData.uiState.collapsedGroups.includes(groupId)) appData.uiState.collapsedGroups.push(groupId);
        } else {
          appData.uiState.collapsedGroups = appData.uiState.collapsedGroups.filter(id => id !== groupId);
        }
        persist();
      };
    });
  }

  function renderSidebarFolders() {
    const c = $('#sidebar-folders'); if (!c) return;
    c.innerHTML = '';
    (appData.libraryFolders || []).forEach(fp => {
      const el = document.createElement('div');
      el.className = 'sidebar-folder-item';
      el.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="fi-path" title="${escapeHTML(fp)}">${escapeHTML(fp.split(/[/\\]/).pop())}</span>`;
      el.onclick = () => {
        const input = $('#folder-path');
        if (input) input.value = fp;
        switchView('settings');
      };
      c.appendChild(el);
    });
  }


  // ── Responsibility Disclaimer ──
  // Session-aware gate: shows a legal/religious responsibility disclaimer before
  // any external stream or download. Acceptance is remembered for the session
  // (sessionStorage) so the user is not prompted on every single click,
  // but the modal reappears after every app restart.
  const DISCLAIMER_SESSION_KEY = 'mediavault_disclaimer_accepted';

  function showDisclaimerAndProceed(callback) {
    // If already accepted this session, proceed immediately
    if (sessionStorage.getItem(DISCLAIMER_SESSION_KEY) === '1') {
      callback();
      return;
    }

    const overlay = $('#modal-responsibility-disclaimer');
    const checkbox = $('#disclaimer-checkbox');
    const confirmBtn = $('#disclaimer-confirm-btn');
    const cancelBtn = $('#disclaimer-cancel-btn');

    if (!overlay || !checkbox || !confirmBtn || !cancelBtn) {
      // Modal not found — fail open (don't block) but log a warning
      console.warn('[Disclaimer] Modal elements not found. Proceeding without disclaimer.');
      callback();
      return;
    }

    // Reset state
    checkbox.checked = false;
    confirmBtn.style.opacity = '0.45';
    confirmBtn.style.pointerEvents = 'none';

    // Show the modal
    overlay.style.display = 'flex';

    // Enable confirm button only when checkbox is checked
    const onCheckboxChange = () => {
      if (checkbox.checked) {
        confirmBtn.style.opacity = '1';
        confirmBtn.style.pointerEvents = 'auto';
      } else {
        confirmBtn.style.opacity = '0.45';
        confirmBtn.style.pointerEvents = 'none';
      }
    };
    checkbox.addEventListener('change', onCheckboxChange);

    const cleanup = () => {
      overlay.style.display = 'none';
      checkbox.removeEventListener('change', onCheckboxChange);
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    confirmBtn.onclick = () => {
      if (!checkbox.checked) return;
      // Remember acceptance for the rest of this session
      sessionStorage.setItem(DISCLAIMER_SESSION_KEY, '1');
      cleanup();
      callback();
    };

    cancelBtn.onclick = () => {
      cleanup();
      // User cancelled — do not call callback
    };
  }

  // ── Video Player ──
  // Debounced lightweight progress saver — avoids triggering a full appData write
  let _pbSaveDebounce = null;
  // Legacy Cloud Subtitles Removed

  function updateVolumeIcon() {
    const isMuted = engine.muted;
    const volVal = engine.volume; // 0.0 to 1.0
    const off = isMuted || volVal === 0;

    const iconVol = $('#icon-vol');
    const iconMute = $('#icon-mute');
    if (iconVol) iconVol.style.display = off ? 'none' : 'block';
    if (iconMute) iconMute.style.display = off ? 'block' : 'none';

    if (!off && iconVol) {
      const paths = iconVol.querySelectorAll('path');
      if (paths.length >= 2) {
        // Outer wave (index 0 in index.html line 1801)
        paths[0].style.display = volVal > 0.5 ? 'block' : 'none';
        // Inner wave (index 1 in index.html line 1802)
        paths[1].style.display = volVal > 0.1 ? 'block' : 'none';
      }
    }

    // Update music icon too
    const mIconVol = $('#music-icon-vol');
    const mIconMute = $('#music-icon-mute');
    if (mIconVol) mIconVol.style.display = off ? 'none' : 'block';
    if (mIconMute) mIconMute.style.display = off ? 'block' : 'none';
  }
  function updateSeekFill(manualPercent = null) {
    const dur = engine.duration;
    const displayTime = engine.currentTime;

    // If manualPercent is provided (during drag), use it. Otherwise use engine time.
    const percent = manualPercent !== null ? manualPercent : (dur ? Math.min((displayTime / dur) * 100, 100) : 0);

    const seekFilled = $('#seek-filled');
    if (seekFilled) seekFilled.style.width = percent + '%';

    // Music seek bar
    const mSeekFilled = $('#music-seek-filled');
    if (mSeekFilled && isPlayingMusic) mSeekFilled.style.width = percent + '%';
  }
  function updateTimeDisplay(manualTime = null) {
    const dur = engine.duration;
    const displayTime = manualTime !== null ? manualTime : engine.currentTime;
    const timeDisplay = $('#time-display');
    if (timeDisplay) timeDisplay.textContent = `${formatTime(displayTime)} / ${formatTime(dur)}`;

    // Music time display
    const mTimeCur = $('#music-time-current');
    const mTimeTot = $('#music-time-total');
    if (isPlayingMusic) {
      if (mTimeCur) mTimeCur.textContent = formatTime(displayTime);
      if (mTimeTot) mTimeTot.textContent = formatTime(dur);
    }
  }
  async function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    await window.api.setFullScreen(isFullscreen);

    // Mobile Orientation Locking
    if (window.api && window.api.isMobile && window.api.isMobile()) {
      if (isFullscreen) {
        await window.api.invoke('lock-orientation', 'landscape');
      } else {
        await window.api.invoke('unlock-orientation');
      }
    }

    document.body.classList.toggle('fullscreen-mode', isFullscreen);
    const expand = $('#icon-expand');
    if (expand) expand.style.display = isFullscreen ? 'none' : 'block';
    const shrink = $('#icon-shrink');
    if (shrink) shrink.style.display = isFullscreen ? 'block' : 'none';

    // Synchronize topbar fullscreen icons
    const topExpand = $('#btn-player-fullscreen .icon-player-expand');
    if (topExpand) topExpand.style.display = isFullscreen ? 'none' : 'block';
    const topShrink = $('#btn-player-fullscreen .icon-player-shrink');
    if (topShrink) topShrink.style.display = isFullscreen ? 'block' : 'none';
  }
  function openPanel(id) {
    const el = $(id);
    if (!el) return;
    const isAlreadyOpen = el.classList.contains('open');
    closeSidePanel();
    if (!isAlreadyOpen) {
      el.classList.add('open');
      const wrapper = $('#player-wrapper');
      if (wrapper) wrapper.classList.add('panel-active');
      panelOpen = true;
    }
  }

  function openSidePanel() { openPanel('#player-side-panel'); }
  function closeSidePanel() {
    ['#player-side-panel', '#player-tracks-panel', '#player-subs-panel', '#player-eq-panel', '#player-subdl-panel'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('open');
    });
    const wrapper = $('#player-wrapper');
    if (wrapper) wrapper.classList.remove('panel-active');
    panelOpen = false;
  }


  async function switchAudioTrack(index) {
    if (!currentItem) return;
    currentAudioTrackIndex = index;
    console.log('[Player] Switching audio track to index:', index);

    if (engine.isUsingMpv) {
      await engine.setAudioTrack(index);
    } else if (video.audioTracks) {
      // HTML5 Native Audio Track Switching
      for (let i = 0; i < video.audioTracks.length; i++) {
        video.audioTracks[i].enabled = (i === index);
      }
    }

    if (currentMediaMetadata && currentMediaMetadata.audio) {
      currentMediaMetadata.audio.forEach(t => t.selected = t.typeIndex === index);
      renderTracksPanel(currentMediaMetadata);
    }

    showToast('Audio track switched');
    closeSidePanel();
  }

  async function switchSubtitleTrack(index) {
    if (!currentItem) return;
    currentInternalSubIndex = index;
    window.activeSubtitleUrl = null; // Clear active remote subtitle URL
    console.log('[Player] Switching internal subtitle track to index:', index);

    if (engine.isUsingMpv) {
      await engine.setSubtitleTrack(index);
    } else {
      // Remove all previously injected FFmpeg subtitle tracks
      video.querySelectorAll('track[data-ffmpeg-sub]').forEach(t => t.remove());

      // Hide all existing HTML5 text tracks
      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }

      // If selecting a track (not 'no'), check if it has an extractUrl (FFprobe/FFmpeg)
      if (index !== 'no' && index !== false && currentMediaMetadata?.subtitle) {
        const subMeta = currentMediaMetadata.subtitle.find(s => s.typeIndex === index);
        if (subMeta?.extractUrl) {
          // Dynamically inject a <track> pointing to FFmpeg WebVTT extraction endpoint
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.label = subMeta.title || `Subtitle ${index + 1}`;
          track.srclang = subMeta.lang || 'und';
          track.src = subMeta.extractUrl;
          track.default = true;
          track.setAttribute('data-ffmpeg-sub', 'true');
          video.appendChild(track);
          // Wait a tick for the track to load, then show it
          setTimeout(() => {
            for (let i = 0; i < video.textTracks.length; i++) {
              if (video.textTracks[i].label === track.label) {
                video.textTracks[i].mode = 'showing';
                if (typeof window.attachTrackToOverlay === 'function') {
                  window.attachTrackToOverlay(video.textTracks[i]);
                }
              }
            }
          }, 100);
          console.log('[Player] Injected FFmpeg subtitle track:', subMeta.extractUrl);
        } else if (video.textTracks) {
          // Standard HTML5 text track switching
          for (let i = 0; i < video.textTracks.length; i++) {
            const shouldShow = (i === index);
            if (shouldShow) {
              video.textTracks[i].mode = 'showing';
              if (typeof window.attachTrackToOverlay === 'function') {
                window.attachTrackToOverlay(video.textTracks[i]);
              }
            } else {
              video.textTracks[i].mode = 'disabled';
            }
          }
        }
      } else {
        if (typeof window.removeSubtitleOverlay === 'function') {
          window.removeSubtitleOverlay();
        }
      }
    }

    if (currentMediaMetadata && currentMediaMetadata.subtitle) {
      currentMediaMetadata.subtitle.forEach(t => t.selected = t.typeIndex === index);
      renderTracksPanel(currentMediaMetadata);
    }

    subtitlesEnabled = index !== 'no' && index !== false;
    if (subtitlesEnabled) {
      $('#btn-subtitle').classList.remove('subtitle-off');
      $('#btn-subtitle').classList.add('subtitle-on');
    } else {
      $('#btn-subtitle').classList.remove('subtitle-on');
      $('#btn-subtitle').classList.add('subtitle-off');
    }

    showToast(subtitlesEnabled ? 'Subtitles enabled' : 'Subtitles disabled');
    closeSidePanel();
  }

  function renderTracksPanel(streams) {
    const audioList = $('#audio-tracks-list');
    const subsList = $('#internal-subs-list');
    if (!audioList || !subsList) return;
    audioList.innerHTML = ''; subsList.innerHTML = '';

    if (!streams || !streams.audio || !streams.audio.length) {
      audioList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No multiple audio tracks found.</div>';
    } else {
      // Native Default Track
      const defBtn = document.createElement('div');
      defBtn.className = 'subs-result-item' + (currentAudioTrackIndex === -1 ? ' active-track' : '');
      defBtn.innerHTML = `<div class="sr-header"><span class="sr-name">Native / Default</span>${currentAudioTrackIndex === -1 ? '<span class="active-badge">ACTIVE</span>' : ''}</div>`;
      defBtn.onclick = () => switchAudioTrack(-1);
      audioList.appendChild(defBtn);

      streams.audio.forEach(a => {
        const isActive = currentAudioTrackIndex === a.typeIndex;
        const el = document.createElement('div');
        el.className = 'subs-result-item' + (isActive ? ' active-track' : '');
        el.innerHTML = `
                <div class="sr-header">
                  <span class="sr-name">${escapeHTML(a.title)}</span>
                  ${isActive ? '<span class="active-badge">ACTIVE</span>' : `<span class="sr-lang">${a.lang.toUpperCase()}</span>`}
                </div>
                <div class="sr-meta">${a.format.toUpperCase()}</div>
              `;
        el.onclick = () => switchAudioTrack(a.typeIndex);
        audioList.appendChild(el);
      });
    }

    if (!streams || !streams.subtitle || !streams.subtitle.length) {
      subsList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No internal subtitles found.</div>';
    } else {
      // Option to turn OFF subtitles
      const offBtn = document.createElement('div');
      offBtn.className = 'subs-result-item' + (currentInternalSubIndex === 'no' ? ' active-track' : '');
      offBtn.innerHTML = `<div class="sr-header"><span class="sr-name">None / Off</span>${currentInternalSubIndex === 'no' ? '<span class="active-badge">ACTIVE</span>' : ''}</div>`;
      offBtn.onclick = () => switchSubtitleTrack('no');
      subsList.appendChild(offBtn);

      streams.subtitle.forEach(s => {
        const isActive = currentInternalSubIndex === s.typeIndex;
        const el = document.createElement('div');
        el.className = 'subs-result-item' + (isActive ? ' active-track' : '');
        el.innerHTML = `
                <div class="sr-header">
                  <span class="sr-name">${escapeHTML(s.title)}</span>
                  ${isActive ? '<span class="active-badge">ACTIVE</span>' : `<span class="sr-lang">${s.lang.toUpperCase()}</span>`}
                </div>
                <div class="sr-meta">${s.format.toUpperCase()}</div>
              `;
        el.onclick = () => switchSubtitleTrack(s.typeIndex);
        subsList.appendChild(el);
      });
    }

    fetchAndRenderManagedSubtitles();
  }

  async function fetchAndRenderManagedSubtitles() {
    const listContainer = $('#addon-subs-list');
    if (!listContainer) return;

    const addonSubsSection = listContainer.parentElement;
    if (!hasEnabledOpenSubtitlesAddon()) {
      if (addonSubsSection) addonSubsSection.style.display = 'none';
      listContainer.innerHTML = '';
      return;
    }
    if (addonSubsSection) addonSubsSection.style.display = '';

    listContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); padding: 15px; font-size: 13px;">
        <i class="fas fa-spinner fa-spin" style="color: var(--accent);"></i>
        <span>Loading subtitles...</span>
      </div>
    `;

    if (!currentItem) {
      listContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No active media.</div>';
      return;
    }

    try {
      const metadata = buildMediaMetadataContext(currentItem, currentShow);
      const context = { media: currentItem, metadata };
      const subtitles = await window.api.invoke('get-managed-subtitles', context);

      listContainer.innerHTML = '';

      if (!subtitles || subtitles.length === 0) {
        listContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No subtitles found.</div>';
        return;
      }

      subtitles.forEach(sub => {
        const isActive = (window.activeSubtitleUrl === sub.url) || (window.activeSubtitlePath === sub.url);
        const el = document.createElement('div');
        el.className = 'subs-result-item' + (isActive ? ' active-track' : '');
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '2px';
        el.style.cursor = 'pointer';

        const badgeColor = sub.source === 'local' ? '#10b981' : '#8b5cf6';
        const badgeText = sub.sourceLabel || sub.source;

        el.innerHTML = `
          <div class="sr-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span class="sr-name" style="font-weight: 600; color: var(--text-primary); font-size: 13px;">${escapeHTML(sub.label)}</span>
            ${isActive ? '<span class="active-badge" style="font-size: 10px; background: var(--accent); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: bold;">ACTIVE</span>' : `<span class="sr-lang" style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">${sub.lang}</span>`}
          </div>
          <div class="sr-meta" style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span style="background: ${badgeColor}; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700;">${badgeText}</span>
            <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 100%;">${escapeHTML(sub.format || 'remote')}</span>
          </div>
        `;

        el.onclick = async () => {
          if (isActive) {
            window.activeSubtitleUrl = null;
            window.activeSubtitlePath = null;
            currentInternalSubIndex = 'no';
            video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
            subtitlesEnabled = false;
            $('#btn-subtitle')?.classList.remove('subtitle-on');
            $('#btn-subtitle')?.classList.add('subtitle-off');
            showToast('Subtitles disabled');
            searchSubdlPlayerSubtitles(queryOverride);
            return;
          }

          window.activeSubtitleUrl = (sub.source === 'subdl' || sub.source === 'opensubtitles') ? sub.url : null;
          window.activeSubtitlePath = sub.source === 'local' ? sub.url : null;
          currentInternalSubIndex = 'no';

          if (sub.source === 'subdl' || sub.source === 'opensubtitles') {
            await loadSubtitleFromUrl(sub.url, `${sub.lang} (${sub.sourceLabel})`);
          } else if (sub.source === 'local') {
            await loadSubtitleLocal(sub.url);
          }

          if (currentMediaMetadata) renderTracksPanel(currentMediaMetadata);
          searchSubdlPlayerSubtitles(queryOverride); // Re-render to show active state
        };

        listContainer.appendChild(el);
      });
    } catch (err) {
      console.error('[SubtitleManager] Failed:', err);
      listContainer.innerHTML = `<div style="font-size:12px; color:#EF4444; padding:10px;">Failed to fetch: ${escapeHTML(err.message)}</div>`;
    }
  }

  // ── Audio Equalizer ──
  let audioCtx = window._mv_audioCtx || null;
  let mediaSource = window._mv_mediaSource || null;
  let eqNodes = [];
  const EQ_BANDS = [60, 230, 910, 3600, 14000];
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    movie: [3, 1, 0, 2, 1],
    voice: [-2, 0, 3, 4, 1],
    bass: [6, 3, 0, 0, -1]
  };

  $('#btn-transcode-audio').onclick = () => {
    if (!video || !video.src || !video.src.startsWith('http')) return;
    
    if (video.src.includes('127.0.0.1:1147') || video.src.includes('localhost:1147')) {
      try {
        const urlObj = new URL(video.src);
        if (urlObj.searchParams.get('transcode') === 'true') {
          showToast('Audio fix is already active');
          return;
        }
        
        showToast('Applying audio fix (transcoding)...');
        urlObj.searchParams.set('transcode', 'true');
        
        const currentTime = video.currentTime;
        if (currentTime > 0) {
          urlObj.searchParams.set('start', currentTime.toString());
        }
        
        video.src = urlObj.toString();
        // Since transcode re-encodes from the start parameter, the video itself will see time 0 as the 'current' time for the segment
        // Wait, if we set video.src, the video resets to 0. But the stream itself STARTS at 'currentTime'.
        // This causes the progress bar to show 0:00 instead of 35:00.
        // Actually, for a quick "Audio fix" it's better than silence. 
        // We'll let it play from the offset.
        video.play().catch(e => console.warn('Failed to auto-resume after transcode:', e));
        
        $('#btn-transcode-audio').style.color = 'var(--accent)';
      } catch (e) {
        console.error('Error applying audio transcode:', e);
      }
    } else {
      showToast('Audio fix is only available for internal streams');
    }
  };

  // ─── dedicated subdl subtitles panel integration ───
  const btnPlayerSubdl = $('#btn-player-subdl');
  if (btnPlayerSubdl) {
    btnPlayerSubdl.onclick = () => {
      // Clear cache to force a fresh search when opening the panel
      lastSubdlResults = null;
      lastSubdlQueryKey = null;

      const searchInput = $('#subdl-search-input');
      if (searchInput && currentItem) {
        searchInput.value = currentItem.title || currentItem.name || '';
      }
      searchSubdlPlayerSubtitles();
      openPanel('#player-subdl-panel');
    };
  }

  const btnCloseSubdlPanel = $('#btn-close-subdl-panel');
  if (btnCloseSubdlPanel) {
    btnCloseSubdlPanel.addEventListener('click', (e) => { e.stopPropagation(); closeSidePanel(); });
  }

  const btnSubdlSearchSubmit = $('#btn-subdl-search-submit');
  if (btnSubdlSearchSubmit) {
    btnSubdlSearchSubmit.onclick = () => {
      const q = $('#subdl-search-input')?.value.trim() || '';
      if (q) {
        searchSubdlPlayerSubtitles(q);
      } else {
        showToast('⚠️ Please enter a title to search.');
      }
    };
  }

  const subdlSearchInput = $('#subdl-search-input');
  if (subdlSearchInput) {
    subdlSearchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const q = subdlSearchInput.value.trim();
        if (q) {
          searchSubdlPlayerSubtitles(q);
        }
      }
    };
  }

  let lastSubdlResults = null;
  let lastSubdlQueryKey = null;

  async function searchSubdlPlayerSubtitles(queryOverride = null) {
    const listContainer = $('#subdl-results-list');
    if (!listContainer) return;

    const apiKey = appData.subdlConfig?.apiKey || appData.subdlKey || '';
    if (!apiKey) {
      listContainer.innerHTML = `
        <div style="font-size:12px; color:var(--text-muted); padding:20px; text-align:center; display:flex; flex-direction:column; gap:10px; align-items:center;">
          <i class="fas fa-exclamation-circle" style="font-size:24px; color:#e5a00d;"></i>
          <span style="line-height:1.5;">SubDL API Key is not configured. Please enter your API key in the app Settings to retrieve subtitles.</span>
          <button class="btn-primary-sm" onclick="switchView('settings'); closeSidePanel();" style="background:#00adb5; border:none; padding:8px 16px; border-radius:8px; margin-top:8px; cursor:pointer; color:#fff; font-weight:bold; font-size:11px;">Go to Settings</button>
        </div>`;
      return;
    }

    if (!currentItem) {
      listContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No active media.</div>';
      return;
    }

    const currentQueryKey = `${currentItem.id}_${queryOverride || ''}`;

    try {
      let subtitles = [];
      if (lastSubdlQueryKey === currentQueryKey && lastSubdlResults) {
        subtitles = lastSubdlResults;
      } else {
        listContainer.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:center; gap:8px; color:var(--text-muted); padding:20px; font-size:13px;">
            <i class="fas fa-spinner fa-spin" style="color:var(--accent);"></i>
            <span>Searching SubDL...</span>
          </div>
        `;

        let metadata = buildMediaMetadataContext(currentItem, currentShow);
        
        if (queryOverride) {
          metadata = {
            ...metadata,
            title: queryOverride,
            imdbId: null,
            kitsuId: null,
            malId: null,
            isManualSearch: true
          };
        }

        const context = { media: currentItem, metadata };
        subtitles = await window.api.invoke('get-managed-subtitles', context);
        
        // Cache results
        lastSubdlResults = subtitles;
        lastSubdlQueryKey = currentQueryKey;
      }

    listContainer.innerHTML = '';

    if (!subtitles || subtitles.length === 0) {
      listContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px; text-align:center;">No subtitles found. Try refining the search query!</div>';
      return;
    }

    const subdlSubs = subtitles.filter(sub => sub.source === 'subdl');

    if (subdlSubs.length === 0) {
      const apiKey = appData.subdlConfig?.apiKey || appData.subdlKey || '';
      if (!apiKey) {
        listContainer.innerHTML = `
          <div style="font-size:12px; color:var(--text-muted); padding:20px; text-align:center; display:flex; flex-direction:column; gap:10px; align-items:center;">
            <i class="fas fa-exclamation-circle" style="font-size:24px; color:#e5a00d;"></i>
            <span style="line-height:1.5;">SubDL API Key is not configured. Please enter your API key in the app Settings to retrieve subtitles.</span>
            <button class="btn-primary-sm" onclick="switchView('settings'); closeSidePanel();" style="background:#00adb5; border:none; padding:8px 16px; border-radius:8px; margin-top:8px; cursor:pointer; color:#fff; font-weight:bold; font-size:11px;">Go to Settings</button>
          </div>`;
        return;
      }
      listContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px; text-align:center;">No SubDL subtitles found.</div>';
      return;
    }

      subdlSubs.forEach(sub => {
        const isActive = (window.activeSubtitleUrl === sub.url) || (window.activeSubtitlePath === sub.url);
        const el = document.createElement('div');
        el.className = 'subs-result-item' + (isActive ? ' active-track' : '');
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '4px';
        el.style.padding = '12px';
        el.style.background = isActive ? 'rgba(0, 173, 181, 0.1)' : 'rgba(255, 255, 255, 0.02)';
        el.style.border = isActive ? '1px solid rgba(0, 173, 181, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)';
        el.style.borderRadius = '8px';
        el.style.cursor = 'pointer';
        el.style.transition = 'all 0.2s ease';

        el.innerHTML = `
          <div class="sr-header" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <span class="sr-name" style="font-weight:600; color:var(--text-primary); font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:80%;">${escapeHTML(sub.label)}</span>
            ${isActive ? '<span class="active-badge" style="font-size:10px; background:#00adb5; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold;">ACTIVE</span>' : `<span class="sr-lang" style="font-size:10px; color:#00adb5; font-weight:700; text-transform:uppercase;">${sub.lang}</span>`}
          </div>
          <div class="sr-meta" style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
            <span style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-size:9px;">${escapeHTML(sub.format || 'SRT')}</span>
            <span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:100%;">${escapeHTML(sub.sourceLabel || 'SubDL')}</span>
          </div>
        `;

        el.onclick = async () => {
          if (isActive) {
            window.activeSubtitleUrl = null;
            window.activeSubtitlePath = null;
            currentInternalSubIndex = 'no';
            video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
            subtitlesEnabled = false;
            $('#btn-subtitle')?.classList.remove('subtitle-on');
            $('#btn-subtitle')?.classList.add('subtitle-off');
            showToast('Subtitles disabled');
            searchSubdlPlayerSubtitles(queryOverride);
            return;
          }

          window.activeSubtitleUrl = sub.url;
          window.activeSubtitlePath = null;
          currentInternalSubIndex = 'no';

          try {
            await loadSubtitleFromUrl(sub.url, `${sub.lang.toUpperCase()} (SubDL)`);
            showToast('✅ Subtitle loaded successfully!');
            searchSubdlPlayerSubtitles(queryOverride);
          } catch (err) {
            window.activeSubtitleUrl = null;
            window.activeSubtitlePath = null;
            showToast('❌ Failed to load subtitle');
            searchSubdlPlayerSubtitles(queryOverride);
          }
        };

        listContainer.appendChild(el);
      });

    } catch (err) {
      console.error('[SubDL Player Subtitles] Failed:', err);
      listContainer.innerHTML = `<div style="font-size:12px; color:#EF4444; padding:10px;">Failed to fetch: ${escapeHTML(err.message)}</div>`;
    }
  }

  $('#btn-close-tracks').onclick = () => closeSidePanel();

  $('#btn-eq').onclick = () => {
    if (!audioCtx) initAudioEQ();
    openPanel('#player-eq-panel');
  };
  $('#music-btn-eq').onclick = () => {
    if (!audioCtx) initAudioEQ();
    openPanel('#player-eq-panel');
  };
  $('#btn-close-eq').onclick = () => closeSidePanel();

  function initAudioEQ() {
    if (!audioCtx) {
      if (window._mv_audioCtx) {
        audioCtx = window._mv_audioCtx;
        mediaSource = window._mv_mediaSource;
      } else {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window._mv_audioCtx = audioCtx;
      }
    }

    if (!mediaSource) {
      try {
        mediaSource = audioCtx.createMediaElementSource(video);
        window._mv_mediaSource = mediaSource;
      } catch (e) {
        console.warn('[AUDIO] MediaSource already bound:', e.message);
      }
    }

    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
    }

    // Clear existing nodes if any
    eqNodes = [];

    for (let i = 0; i < 5; i++) {
      const filter = audioCtx.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking';
      filter.frequency.value = EQ_BANDS[i];
      filter.gain.value = (appData.eqGains || EQ_PRESETS.flat)[i];
      eqNodes.push(filter);
    }

    // MEDIA -> EQ[0] -> ... -> EQ[4] -> ANALYSER -> DESTINATION
    if (mediaSource) {
      try {
        mediaSource.disconnect();
      } catch (e) {}
      mediaSource.connect(eqNodes[0]);
      for (let i = 0; i < 4; i++) eqNodes[i].connect(eqNodes[i + 1]);
      eqNodes[4].connect(analyser); // Analyser comes AFTER EQ so it sees modified signal
      analyser.connect(audioCtx.destination);
    }

    const dp = $('#eq-preset'); if (dp) dp.value = appData.eqPreset || 'flat';
    dp.onchange = () => {
      appData.eqPreset = dp.value;
      if (EQ_PRESETS[dp.value]) {
        appData.eqGains = [...EQ_PRESETS[dp.value]];
        updateEQUI();
      }
      persist();
    };

    $$('.eq-slider').forEach((sl, i) => {
      sl.value = eqNodes[i].gain.value;
      sl.nextElementSibling.textContent = sl.value;
      sl.oninput = () => {
        eqNodes[i].gain.value = parseFloat(sl.value);
        sl.nextElementSibling.textContent = sl.value;
        dp.value = 'custom';
        appData.eqPreset = 'custom';
        appData.eqGains = eqNodes.map(n => n.gain.value);
        persist();
      };
    });

    $('#btn-eq-reset').onclick = () => {
      dp.value = 'flat'; dp.onchange();
    };
    updateEQUI();
  }

  function updateEQUI() {
    const gains = appData.eqGains || EQ_PRESETS.flat;
    $$('.eq-slider').forEach((sl, i) => {
      const targetV = gains[i] || 0;
      const startV = parseFloat(sl.value) || 0;

      // Smooth audio transition
      if (eqNodes[i] && audioCtx) {
        eqNodes[i].gain.setTargetAtTime(targetV, audioCtx.currentTime, 0.1);
      } else if (eqNodes[i]) {
        eqNodes[i].gain.value = targetV;
      }

      // Smooth UI animation
      const duration = 400; // ms
      const startTime = performance.now();

      // Cancel previous animation if exists
      if (sl._animId) cancelAnimationFrame(sl._animId);

      function animate(time) {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const currentV = startV + (targetV - startV) * ease;

        sl.value = currentV;
        if (sl.nextElementSibling) sl.nextElementSibling.textContent = Math.round(currentV);

        if (progress < 1) {
          sl._animId = requestAnimationFrame(animate);
        } else {
          sl.value = targetV;
          if (sl.nextElementSibling) sl.nextElementSibling.textContent = targetV;
        }
      }
      sl._animId = requestAnimationFrame(animate);
    });
  }

  // Removed duplicate populateSidePanel, triggerAutoNext, cancelAutoNext functions, now correctly loaded from player.js

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
  //  DISCOVER
  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
  // Discover Scroll Helper
  // Discover Scroll Helper
  window.scrollRow = (btn, dir) => {
    const row = btn.closest('.discover-section')?.querySelector('.discover-row, .media-row, .card-grid-row');
    if (!row) return;
    const amount = row.clientWidth * 0.8 * dir;
    row.scrollBy({ left: amount, behavior: 'smooth' });
  };

  window.updateRowScrollButtons = () => {
    document.querySelectorAll('.discover-section, .media-row-section, .carousel-section, .hub-section').forEach(section => {
      const row = section.querySelector('.discover-row, .media-row, .card-grid-row, .horizontal-scroll-row');
      const actionContainer = section.querySelector('.discover-header-actions, .section-actions');
      const btns = section.querySelectorAll('.discover-scroll-btn, .row-scroll-btn');
      if (!row) return;

      const hasOverflow = (row.scrollWidth - row.clientWidth) > 10;

      btns.forEach(btn => {
        if (hasOverflow) {
          btn.style.display = 'flex';
        } else {
          btn.style.setProperty('display', 'none', 'important');
        }
      });

      if (actionContainer && actionContainer.children.length > 0) {
        const onlyScrollBtns = Array.from(actionContainer.children).every(child => child.classList.contains('discover-scroll-btn') || child.classList.contains('row-scroll-btn'));
        if (onlyScrollBtns) {
          if (hasOverflow) {
            actionContainer.style.display = 'flex';
          } else {
            actionContainer.style.setProperty('display', 'none', 'important');
          }
        }
      }
    });
  };

  window.addEventListener('resize', () => window.updateRowScrollButtons());
  setTimeout(() => window.updateRowScrollButtons(), 500);
  setInterval(() => window.updateRowScrollButtons(), 2500);

  // Discover Sidebar Listeners
  const dsButtons = document.querySelectorAll('#discover-sidebar .nav-btn');
  dsButtons.forEach(btn => {
    btn.onclick = async () => {
      dsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const genre = btn.dataset.genre;
      $('#search-discover').placeholder = 'Search movies & shows...';
      if (genre === 'trending') {
        loadDiscover();
        return;
      }
      await loadDiscoverByGenre(genre, btn.querySelector('span').textContent);
    };
  });

  // Sticky Genre Pills Listeners
  const genrePills = document.querySelectorAll('#discover-genre-pills .genre-pill');
  genrePills.forEach(pill => {
    pill.onclick = async () => {
      genrePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      // Also sync sidebar buttons
      dsButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.genre === pill.dataset.genre);
      });
      const genre = pill.dataset.genre;
      if (genre === 'trending') {
        loadDiscover();
        return;
      }
      const name = pill.textContent.trim();
      await loadDiscoverByGenre(genre, name);
    };
  });

  // TMDB genre ID → Cinemeta genre string mapping for fallback
  const GENRE_ID_TO_NAME = {
    '28': 'Action', '35': 'Comedy', '18': 'Drama', '878': 'Science-Fiction',
    '27': 'Horror', '10749': 'Romance', '53': 'Thriller', '12': 'Adventure',
    '16': 'Animation', '80': 'Crime', '99': 'Documentary', '14': 'Fantasy',
    '36': 'History', '10402': 'Music', '9648': 'Mystery', '10752': 'War',
    '37': 'Western'
  };

  async function loadDiscoverByGenre(id, name) {
    $('#discover-content').style.display = 'none';
    $('#discover-results').style.display = 'none';
    $('#discover-genre-view').style.display = 'block';

    $('#discover-genre-title').textContent = name;

    const grid = $('#genre-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const skel = document.createElement('div');
      skel.className = 'discover-card-skeleton';
      skel.innerHTML = `<div class="discover-poster-wrap" style="aspect-ratio:2/3.1;background:var(--bg-surface-2);border-radius:12px;animation:pulse 1.5s infinite"></div>`;
      grid.appendChild(skel);
    }

    try {
      let finalItems = [];

      if (id === '16') {
        // Animation: use Cinemeta
        const cinData = await window.api.cinemetaDiscoverByGenre('Animation');
        finalItems = (cinData?.results || []).map(m => ({
          id: m.id, imdb_id: m.id, title: m.name, name: m.name,
          overview: m.description, vote_average: parseFloat(m.imdbRating || 0),
          poster: m.poster, backdrop_path: m.background,
          media_type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          release_date: m.releaseInfo, first_air_date: m.releaseInfo, year: m.releaseInfo
        }));
      } else {
        // Try TMDB first
        const tmdbData = await window.api.tmdbDiscoverByGenre(id);
        finalItems = (tmdbData?.results || []).filter(item => item.adult !== true);

        // Fallback to Cinemeta if TMDB returned nothing (no key or error)
        if (!finalItems.length) {
          const cinGenreName = GENRE_ID_TO_NAME[id] || name;
          const cinData = await window.api.cinemetaDiscoverByGenre(cinGenreName);
          finalItems = (cinData?.results || []).map(m => ({
            id: m.id, imdb_id: m.id, title: m.name, name: m.name,
            overview: m.description, vote_average: parseFloat(m.imdbRating || 0),
            poster: m.poster, backdrop_path: m.background,
            media_type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
            type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
            release_date: m.releaseInfo, first_air_date: m.releaseInfo, year: m.releaseInfo
          }));
        }
      }

      renderDiscoverGrid('#genre-grid', finalItems);
    } catch (err) {
      console.error('[loadDiscoverByGenre]', err);
      grid.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load genre content.</div>';
    }
  }

  function showContinueWatchingMenu(e, pb, item, showObj) {
    // Remove existing menu if any
    const existing = document.getElementById('continue-watching-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'continue-watching-menu';
    menu.style.cssText = `
      position: fixed;
      top: ${e.clientY}px;
      left: ${e.clientX}px;
      background: #1a1a1e;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 8px;
      z-index: 1000000;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      min-width: 200px;
      animation: fadeIn 0.2s ease-out;
    `;

    const createBtn = (icon, text, onClick) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 15px;
        background: transparent;
        border: none;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        transition: background 0.2s;
        text-align: left;
      `;
      btn.innerHTML = `<i class="fas ${icon}" style="width: 16px; opacity: 0.7;"></i> ${text}`;
      btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.05)';
      btn.onmouseleave = () => btn.style.background = 'transparent';
      btn.onclick = () => {
        menu.remove();
        onClick();
      };
      return btn;
    };

    // Option 1: Resume Playback
    menu.appendChild(createBtn('fa-play', 'Resume Playback', () => {
      if (item.isStream) {
        playVideo(item, item.showName ? { title: item.showName, id: item.showId } : null);
      } else {
        playVideo(item, showObj);
      }
    }));

    // Option 2: View Details
    menu.appendChild(createBtn('fa-info-circle', 'View Details', () => {
      if (item.isStream || item.tmdbId) {
        openDiscoverDetail(item);
      } else if (showObj) {
        openShowDetail(showObj);
      } else {
        showToast('Details not available for this item');
      }
    }));

    // Option 3: Remove from list
    const removeBtn = createBtn('fa-trash-alt', 'Remove from List', async () => {
      const key = getPlaybackKey(item);
      if (currentProfile?.playback && currentProfile.playback[key]) {
        delete currentProfile.playback[key];
        persist();

        if (window.api && window.api.invoke) {
          try {
            await window.api.invoke('cloud-delete-playback-position', {
              profileId: currentProfile.id,
              mediaId: key
            });
          } catch (err) {
            console.error('[PLAYBACK] Failed to delete playback position from cloud:', err);
          }
        }

        if (typeof renderContinueWatchingDiscover === 'function') {
          renderContinueWatchingDiscover();
        }
        if (typeof renderEmptySearchState === 'function') {
          renderEmptySearchState();
        }
        showToast('Removed from Continue Watching');
      }
    });
    removeBtn.style.color = '#ff4d4d';
    menu.appendChild(removeBtn);

    document.body.appendChild(menu);

    // Close on click outside
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeMenu), 10);
  }

  const getBadgeHTML = (item) => {
    const isKitsu = item.source === 'kitsu' || item.source === 'anilist' || item.format;
    const source = isKitsu ? 'KITSU' : 'TMDB';
    const typeLabel = (item.media_type === 'movie' || (isKitsu && item.format === 'MOVIE')) ? 'MOVIE' : 'SERIES';
    return `<span class="discover-meta-badge">${source} ┬╖ ${typeLabel}</span>`;
  };

  function renderDiscoverGrid(sel, items) {
    const grid = $(sel);
    if (!grid) return;
    grid.innerHTML = '';
    const allowedItems = (items || []).filter(isAgeAllowed);
    if (!allowedItems.length) { grid.innerHTML = '<div style="padding:40px;color:var(--text-muted)">No items found.</div>'; return; }

    const localTitles = new Set([
      ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
      ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
    ]);

    allowedItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'discover-card';
      const title = item.title || item.name || 'Unknown';
      let posterUrl = item.poster || '';
      const inLib = localTitles.has(title.toLowerCase());
      const label = item.media_type === 'tv' ? 'SERIES' : 'MOVIE';
      const year = (item.release_date || item.first_air_date || '').slice(0, 4);
      const rating = parseFloat(item.vote_average) || 0;

      card.innerHTML = `
        <div class="discover-poster-wrap">
          <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
          ${posterUrl ? `<img src="${localImg(posterUrl)}" class="discover-poster" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
          ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="discover-meta">
            ${getBadgeHTML(item)}
            <span>${year}</span>
            ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
          </div>
        </div>
      `;
      card.onclick = () => openDiscoverDetail(item);
      enableHoverPreview(card, item, '.discover-poster-wrap');
      grid.appendChild(card);
      
      const resolvedImdb = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
      if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
        getTraktOrImdbPoster(item, null, card);
      }
    });
  }

  let discoverHeroItems = [];
  let discoverHeroIndex = 0;
  let discoverHeroInterval = null;

  function resolveHeroBackdrop(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file://')) {
      return s;
    }
    if (s.startsWith('/tt') || s.startsWith('tt')) {
      const cleanId = s.replace(/^\//, '').split('/')[0];
      return `https://images.metahub.space/poster/medium/${cleanId}/img`;
    }
    if (s.startsWith('/')) {
      return `https://image.tmdb.org/t/p/w1280${s}`;
    }
    return `https://image.tmdb.org/t/p/w1280/${s}`;
  }

  function updateDiscoverHeroDisplay() {
    const hero = $('#discover-hero');
    if (!hero || discoverHeroItems.length === 0) return;
    const item = discoverHeroItems[discoverHeroIndex];
    if (!item) return;

    const title = item.title || item.name || 'Unknown';
    const rawBackdrop = item.backdrop_path || item.background || item.backdrop || item.poster_path || item.poster || '';
    const backdrop = resolveHeroBackdrop(rawBackdrop);
    const year = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
    const rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : (item.score || 'N/A');
    const isAnime = item.source === 'anilist' || item.source === 'mal' || item.format;
    const type = isAnime ? 'ANIME' : (item.media_type === 'tv' ? 'SERIES' : 'MOVIE');

    hero.innerHTML = `
      <div class="hero-backdrop" style="background-image: url('${backdrop}')"></div>
      <div class="hero-overlay">
        <div class="hero-content">
          <div class="hero-badge">Featured ${type}</div>
          <h1 class="hero-title">${escapeHTML(title)}</h1>
          <div class="hero-meta">
            <span><i class="fas fa-star" style="color:#F59E0B"></i> ${rating}</span>
            <span>${year}</span>
            <span>HD 4K</span>
          </div>
          <div style="margin-top: 15px; font-size: 11px; font-weight: 700; opacity: 0.8; letter-spacing: 1px; text-transform: uppercase;">
             <i class="fas fa-info-circle"></i> Click for Details
          </div>
        </div>
      </div>
      <div class="hero-pagination" id="discover-hero-dots"></div>
    `;

    hero.onclick = (e) => {
      if (e.target.classList.contains('hero-dot')) return;
      openDiscoverDetail(item);
    };

    const dots = hero.querySelector('#discover-hero-dots');
    if (dots) {
      discoverHeroItems.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = 'hero-dot' + (i === discoverHeroIndex ? ' active' : '');
        dot.onclick = (e) => {
          e.stopPropagation();
          discoverHeroIndex = i;
          updateDiscoverHeroDisplay();
          resetDiscoverHeroInterval();
        };
        dots.appendChild(dot);
      });
    }
  }

  function resetDiscoverHeroInterval() {
    if (discoverHeroInterval) clearInterval(discoverHeroInterval);
    if (discoverHeroItems.length > 1) {
      discoverHeroInterval = setInterval(() => {
        discoverHeroIndex = (discoverHeroIndex + 1) % discoverHeroItems.length;
        updateDiscoverHeroDisplay();
      }, 6000);
    }
  }

  function addDiscoverHeroItem(item) {
    if (!item) return;
    if (!discoverHeroItems.find(i => (i.id === item.id) || (i.imdb_id === item.imdb_id))) {
      discoverHeroItems.push(item);
      
      const isAnime = item.type === 'anime' || item.source === 'jikan' || item.source === 'kitsu' || item.source === 'mal' || item.source === 'anilist';
      if (isAnime) {
        const queryTitle = item.title_english || item.title || item.name || '';
        if (queryTitle) {
          window.api.invoke('cinemeta-search', queryTitle)
            .then(res => {
              const data = res?.results || [];
              if (data && data.length > 0) {
                const matched = data[0];
                if (matched.background) {
                  item.backdrop_path = matched.background;
                  item.background = matched.background;
                }
                if (matched.poster) {
                  item.poster_path = matched.poster;
                  item.poster = matched.poster;
                }
                updateDiscoverHeroDisplay();
              } else {
                const fallbackTitle = item.title || item.name || '';
                if (fallbackTitle && fallbackTitle !== queryTitle) {
                  window.api.invoke('cinemeta-search', fallbackTitle)
                    .then(resFallback => {
                      const dataFallback = resFallback?.results || [];
                      if (dataFallback && dataFallback.length > 0) {
                        const matchedFallback = dataFallback[0];
                        if (matchedFallback.background) {
                          item.backdrop_path = matchedFallback.background;
                          item.background = matchedFallback.background;
                        }
                        if (matchedFallback.poster) {
                          item.poster_path = matchedFallback.poster;
                          item.poster = matchedFallback.poster;
                        }
                        updateDiscoverHeroDisplay();
                      }
                    });
                }
              }
            })
            .catch(err => console.warn('[DiscoverHero] Cinemeta enrichment failed:', err));
        }
      } else if (!item.backdrop_path && !item.background) {
        const queryTitle = item.title || item.name || '';
        if (queryTitle) {
          const itemType = (item.media_type === 'tv' || item.type === 'series') ? 'tv' : 'movie';
          window.api.searchTmdb(queryTitle, itemType)
            .then(res => {
              const results = Array.isArray(res) ? res : (res?.results || []);
              if (results && results.length > 0 && results[0].backdrop_path) {
                item.backdrop_path = results[0].backdrop_path;
                updateDiscoverHeroDisplay();
              }
            })
            .catch(e => console.warn('[DiscoverHero] TMDB backdrop enrichment failed:', e));
        }
      }

      updateDiscoverHeroDisplay();
      resetDiscoverHeroInterval();
    }
  }

  window.clearContinueWatching = clearContinueWatching;

  function renderPills(detail) {
    const container = document.getElementById('dd-extra-info');
    if (!container) return;
    container.innerHTML = '';

    const addGroup = (label, items) => {
      if (!items || items.length === 0) return;
      const group = document.createElement('div');
      group.className = 'dd-pill-group';
      group.innerHTML = `
        <div class="dd-pill-label">${label}</div>
        <div class="dd-pill-list">
          ${items.map(it => `<div class="dd-pill">${escapeHTML(it)}</div>`).join('')}
        </div>
      `;
      container.appendChild(group);
    };

    // Genres
    const genres = (detail.genres || []).map(g => g.name || g);
    addGroup('Genres', genres);

    // Directors (TMDB only)
    const directors = (detail.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => c.name);
    addGroup('Directors', directors);

    // Cast (Top 6)
    const cast = (detail.credits?.cast || [])
      .slice(0, 6)
      .map(c => c.name);
    addGroup('Cast', cast);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  //  METADATA MANUAL SEARCH
  // ══════════════════════════════════════════════════════════════════════════
  let metaSearchTarget = null;
  // ══════════════════════════════════════════════════════════════════════════
  //  DOWNLOADS
  // ══════════════════════════════════════════════════════════════════════════

        // Inline torrent file picker — renders inside the download form, not as a popup
        window.showTorrentFilePicker = function(magnetUrl, files, itemMeta, streamObj) {
          try {
            const container = document.getElementById('torrent-files-container');
            if (!container) { console.error('[FilePicker] #torrent-files-container not found'); return; }

            // Filter to video files only
            const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i;
            const videoFiles = files.filter(f => videoExts.test(f.name));
            const displayFiles = videoFiles.length > 0 ? videoFiles : files;

            container.innerHTML = '';
            container.style.display = 'block';

            // Header
            const header = document.createElement('div');
            header.style = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
            const titleEl = document.createElement('div');
            titleEl.style = 'font-weight:700;font-size:14px;color:var(--text);';
            titleEl.innerHTML = `<i class="fas fa-folder-open" style="margin-right:6px;opacity:.7"></i> ${displayFiles.length} files found — select to download`;
            header.appendChild(titleEl);
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn-outline';
            closeBtn.style = 'padding:2px 10px;font-size:11px;';
            closeBtn.textContent = '✕ Close';
            closeBtn.onclick = () => { container.style.display = 'none'; container.innerHTML = ''; };
            header.appendChild(closeBtn);
            container.appendChild(header);

            // Select all row
            const selectAllRow = document.createElement('div');
            selectAllRow.style = 'display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;border-radius:6px;background:var(--bg-surface-2,#1a1a2e);';
            const selectAllCb = document.createElement('input');
            selectAllCb.type = 'checkbox';
            selectAllCb.id = 'torrent-select-all';
            selectAllCb.className = 'dl-custom-cb';
            const selectAllLabel = document.createElement('label');
            selectAllLabel.htmlFor = 'torrent-select-all';
            selectAllLabel.style = 'cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);flex:1;';
            selectAllLabel.textContent = 'Select All';
            const dlSelectedBtn = document.createElement('button');
            dlSelectedBtn.className = 'btn-primary';
            dlSelectedBtn.style = 'padding:4px 14px;font-size:12px;';
            dlSelectedBtn.innerHTML = '<i class="fas fa-download" style="margin-right:4px"></i> Download Selected';
            dlSelectedBtn.disabled = true;
            selectAllRow.appendChild(selectAllCb);
            selectAllRow.appendChild(selectAllLabel);
            selectAllRow.appendChild(dlSelectedBtn);
            container.appendChild(selectAllRow);

            // File list
            const list = document.createElement('div');
            list.style = 'display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;padding-right:4px;';

            const checkboxes = [];

            displayFiles.forEach((f, i) => {
              const row = document.createElement('div');
              row.style = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:var(--bg-surface-2,#1a1a2e);transition:background .15s;cursor:pointer;';
              row.onmouseenter = () => row.style.background = 'var(--bg-surface-3,#252545)';
              row.onmouseleave = () => row.style.background = 'var(--bg-surface-2,#1a1a2e)';

              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.dataset.fileIdx = f.idx !== undefined ? f.idx : i;
              cb.className = 'dl-custom-cb';
              checkboxes.push(cb);

              const info = document.createElement('div');
              info.style = 'flex:1;overflow:hidden;';
              const nameEl = document.createElement('div');
              nameEl.textContent = f.name;
              nameEl.style = 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text);';
              nameEl.title = f.name;
              const sizeEl = document.createElement('div');
              const sizeMB = (f.size / 1024 / 1024);
              sizeEl.textContent = sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(2)} GB` : `${sizeMB.toFixed(1)} MB`;
              sizeEl.style = 'font-size:11px;color:var(--text-muted);';
              info.appendChild(nameEl);
              info.appendChild(sizeEl);

              const dlBtn = document.createElement('button');
              dlBtn.className = 'btn-outline';
              dlBtn.style = 'padding:4px 10px;font-size:11px;flex-shrink:0;';
              dlBtn.innerHTML = '<i class="fas fa-download"></i>';
              dlBtn.title = 'Download this file';
              dlBtn.onclick = async (e) => {
                e.stopPropagation();
                const idx = f.idx !== undefined ? f.idx : i;
                
                let dlPath = null;
                if (currentProfile) {
                  try {
                    const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
                    const isMusicMode = currentDlType === 'music';
                    if (currentDlType === 'custom' && customDlPath) dlPath = customDlPath;
                    else if (isMusicMode && pPaths?.music) dlPath = pPaths.music;
                    else if (currentDlType === 'movies' && pPaths?.movies) dlPath = pPaths.movies;
                    else if (currentDlType === 'series' && pPaths?.series) dlPath = pPaths.series;
                  } catch (e) {}
                }

                const dlOpts = {
                  url: magnetUrl,
                  name: f.name || 'Torrent File',
                  season: currentDlType === 'series' ? ($('#dl-series-season')?.value || null) : null,
                  episode: currentDlType === 'series' ? ($('#dl-series-episode')?.value || null) : null,
                  downloadPath: dlPath,
                  type: currentDlType,
                  isMusicMode: currentDlType === 'music',
                  profileName: currentProfile?.name || 'Default',
                  libraryFolders: currentProfile?.libraryFolders || appData.libraryFolders,
                  fileIdx: idx
                };

                try {
                  dlBtn.disabled = true;
                  dlBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                  const result = await window.api.startDownload(dlOpts);
                  if (result.success) {
                    showToast(`Download started: ${f.name}`);
                    dlBtn.innerHTML = '<i class="fas fa-check"></i>';
                    updateDownloadBadge();
                  } else {
                    showToast(`Error: ${result.error}`);
                    dlBtn.disabled = false;
                    dlBtn.innerHTML = '<i class="fas fa-download"></i>';
                  }
                } catch (err) {
                  showToast('Failed to copy magnet link: ' + err.message);
                }
              };

              // Click row = toggle checkbox
              row.onclick = (e) => { if (e.target !== cb && e.target !== dlBtn && !dlBtn.contains(e.target)) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } };

              row.appendChild(cb);
              row.appendChild(info);
              row.appendChild(dlBtn);
              list.appendChild(row);
            });

            container.appendChild(list);

            // Checkbox logic
            const updateSelectAll = () => {
              const checked = checkboxes.filter(c => c.checked).length;
              selectAllCb.checked = checked === checkboxes.length && checkboxes.length > 0;
              selectAllCb.indeterminate = checked > 0 && checked < checkboxes.length;
              dlSelectedBtn.disabled = checked === 0;
              dlSelectedBtn.innerHTML = checked > 0
                ? `<i class="fas fa-download" style="margin-right:4px"></i> Download ${checked} Selected`
                : '<i class="fas fa-download" style="margin-right:4px"></i> Download';
            };
            checkboxes.forEach(cb => cb.addEventListener('change', updateSelectAll));
            selectAllCb.addEventListener('change', () => {
              checkboxes.forEach(cb => { cb.checked = selectAllCb.checked; });
              updateSelectAll();
            });

            // Download selected button
            dlSelectedBtn.onclick = async () => {
              const selected = checkboxes.filter(c => c.checked);
              if (selected.length === 0) { showToast('Select at least one file'); return; }
              const idxs = selected.map(cb => parseInt(cb.dataset.fileIdx, 10));
              
              let dlPath = null;
              if (currentProfile) {
                try {
                  const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
                  const isMusicMode = currentDlType === 'music';
                  if (currentDlType === 'custom' && customDlPath) dlPath = customDlPath;
                  else if (isMusicMode && pPaths?.music) dlPath = pPaths.music;
                  else if (currentDlType === 'movies' && pPaths?.movies) dlPath = pPaths.movies;
                  else if (currentDlType === 'series' && pPaths?.series) dlPath = pPaths.series;
                } catch (e) {}
              }

              const dlOpts = {
                url: magnetUrl,
                name: (itemMeta?.title || 'Torrent') + ' (Batch)',
                season: currentDlType === 'series' ? ($('#dl-series-season')?.value || null) : null,
                episode: currentDlType === 'series' ? ($('#dl-series-episode')?.value || null) : null,
                downloadPath: dlPath,
                type: currentDlType,
                isMusicMode: currentDlType === 'music',
                profileName: currentProfile?.name || 'Default',
                libraryFolders: currentProfile?.libraryFolders || appData.libraryFolders,
                fileIdx: idxs.join(',')
              };

              try {
                dlSelectedBtn.disabled = true;
                dlSelectedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
                const result = await window.api.startDownload(dlOpts);
                if (result.success) {
                  showToast(`Batch download started for ${selected.length} files!`);
                  container.style.display = 'none';
                  container.innerHTML = '';
                  const uI = $('#dl-url'); if (uI) uI.value = '';
                  updateDownloadBadge();
                } else {
                  showToast(`Error: ${result.error}`);
                  dlSelectedBtn.disabled = false;
                  updateSelectAll();
                }
              } catch (err) {
                showToast(`Error: ${err.message}`);
                dlSelectedBtn.disabled = false;
                updateSelectAll();
              }
            };

            // Scroll container into view
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (ex) { console.error('[FilePicker] Error:', ex); }
        }

  async function startDownload() {
    // Gate: require responsibility disclaimer before starting any download
    showDisclaimerAndProceed(_doStartDownload);
  }

  async function _doStartDownload() {
    const urlInput = $('#dl-url');
    const nameInput = $('#dl-name');
    let url = urlInput ? urlInput.value.trim() : '';
    let name = nameInput ? nameInput.value.trim() : '';
    if (!url) { showToast('Please enter a URL'); return; }

    // --- STREAMER URL EXTRACTION ---
    // Detect internal streamer control URLs like:
    //   http://127.0.0.1:11471/start?url=magnet:...&fileIdx=8
    // Extract the actual magnet link and fileIdx from them.
    let extractedFileIdx = null;
    try {
      if ((url.includes('/start?url=') || url.includes('/stream?url=')) && (url.includes('127.0.0.1') || url.includes('localhost') || url.includes(':1147'))) {
        const parsed = new URL(url);
        const innerUrl = parsed.searchParams.get('url');
        const fIdx = parsed.searchParams.get('fileIdx');
        if (innerUrl && innerUrl.startsWith('magnet:')) {
          console.log('[Renderer] Extracted magnet from streamer URL:', innerUrl.substring(0, 60));
          url = innerUrl;
          if (fIdx !== null && fIdx !== undefined) extractedFileIdx = parseInt(fIdx, 10);
          // Update the input field to show the clean magnet link
          if (urlInput) urlInput.value = url;
          // Extract name from dn= if not already set
          if (!name || name === 'Download' || name === 'start') {
            const dnMatch = url.match(/[?&]dn=([^&]+)/);
            if (dnMatch) {
              try { name = decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').replace(/\./g, ' ').replace(/[<>:"/\\|?*]/g, '').trim(); } catch(e){}
            }
            if (!name) name = 'Torrent Download';
            if (nameInput) nameInput.value = name;
          }
        }
      }
    } catch (e) { console.warn('[Renderer] Streamer URL extraction failed:', e); }

    // Download limit (prevent server overload)
    if (activeDownloads.size >= 3) {
      showToast('⚠️ Max 3 active downloads allowed. Please finish current tasks first.');
      return;
    }

    if (!name) name = 'Download';
    const season = currentDlType === 'series' ? ($('#dl-series-season').value || null) : null;
    const episode = currentDlType === 'series' ? ($('#dl-series-episode').value || null) : null;
    const seriesName = currentDlType === 'series' ? ($('#dl-series-name').value || null) : null;
    if (seriesName) name = seriesName;

    // --- Independent Mobile/Web Download Path ---
    if (!window.api || !window.api.isElectron) {
      const isSocial = ['youtube', 'tiktok', 'instagram'].includes(currentDlType) ||
        url.includes('youtube.com') || url.includes('youtu.be') ||
        url.includes('tiktok.com') || url.includes('instagram.com');

      if (isSocial) {
        showToast('🚀 Processing download...');
        if (window.api && window.api.startDownload) {
          window.api.startDownload({
            url: url,
            name: name || 'download',
            type: 'social',
            profileName: currentProfile?.name || 'Default'
          });
          if (urlInput) urlInput.value = '';
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = name || 'download';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast('✅ Download started!');
          if (urlInput) urlInput.value = '';
        }
      } else {
        // Direct link download for Mobile
        if (window.api && window.api.isMobile()) {
          window.api.startDownload({ url: url, name: name });
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }
      return;
    }

    // --- SMART TORRENT PARSER INTERCEPT ---
    if (url.startsWith('magnet:') || (url.length === 40 && !url.includes('http'))) {
      if (window.api && window.api.isElectron) {
        showToast('⏳ Fetching torrent file list... please wait');
        console.log('[Renderer] Smart Torrent: Parsing magnet:', url.substring(0, 60));
        try {
          const res = await window.api.invoke('parse-torrent', url);
          console.log('[Renderer] Smart Torrent: parse result:', JSON.stringify(res).substring(0, 200));
          if (res && res.success && res.files && res.files.length > 0) {
            const uI = $('#dl-url'); if (uI) uI.value = '';
            window.showTorrentFilePicker(url, res.files, { title: name || res.name || 'Torrent' }, null);
            return;
          } else {
            // Parse failed but torrent might still be valid — offer to download full torrent
            console.warn('[Renderer] Smart Torrent: Parse returned no files. Error:', res?.error);
            showToast('⚠️ Could not list files. Starting full torrent download...');
            // Fall through to standard download path to download full torrent via backend
          }
        } catch (e) {
          console.warn('[Renderer] Smart Torrent: invoke error:', e);
          showToast('⚠️ Torrent parsing failed. Starting full download...');
          // Fall through to standard download path
        }
        // FALLBACK: If parse failed, let the backend downloadTorrent handle it
        // (don't return — let it fall through to the standard Electron path below)
      }
    }

    // --- Standard Electron Download Path ---
    // Resolve the correct download path based on UI selection
    let dlPath = null;
    const isMusicMode = currentDlType === 'music';

    if (currentDlType === 'custom' && customDlPath) {
      dlPath = customDlPath;
    } else if (isMusicMode && currentProfile) {
      try {
        const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
        if (pPaths && pPaths.music) dlPath = pPaths.music;
      } catch (e) { console.warn('[DL] Failed to resolve Music folder path:', e); }
    } else if (currentDlType === 'movies' && currentProfile) {
      try {
        const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
        if (pPaths && pPaths.movies) dlPath = pPaths.movies;
      } catch (e) {}
    } else if (currentDlType === 'series' && currentProfile) {
      try {
        const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
        if (pPaths && pPaths.series) dlPath = pPaths.series;
      } catch (e) {}
    }

    try {
      const dlOpts = {
        url, name, season, episode,
        downloadPath: dlPath,
        type: currentDlType,
        isMusicMode: isMusicMode,
        profileName: currentProfile?.name || 'Default',
        libraryFolders: currentProfile?.libraryFolders || appData.libraryFolders
      };
      // If we extracted a fileIdx from a streamer URL, pass it through
      if (extractedFileIdx !== null && !isNaN(extractedFileIdx)) {
        dlOpts.fileIdx = extractedFileIdx;
      }
      const result = await window.api.startDownload(dlOpts);
      if (result.success) {
        showToast(`Download started: ${name}`);
        const uI = $('#dl-url'); if (uI) uI.value = '';
        const nI = $('#dl-name'); if (nI) nI.value = '';
        const sI = $('#dl-season'); if (sI) sI.value = '';
        const eI = $('#dl-episode'); if (eI) eI.value = '';
        updateDownloadBadge();
      }
      else showToast(`Error: ${result.error}`);
    } catch (err) { showToast(`Error: ${err.message}`); }
  }

  function renderActiveDownloads() {
    const el = $('#dl-active-list'); if (!el) return;
    const hubEl = $('#hub-dl-list');
    const badge = $('#hub-dl-badge');

    if (!activeDownloads.size) {
      el.innerHTML = '<div class="sidebar-empty-hint">No active downloads</div>';
      if (hubEl) hubEl.innerHTML = '<div class="sidebar-empty-hint">No active downloads</div>';
      if (badge) badge.style.display = 'none';
      updateDownloadBadge();
      return;
    }

    el.innerHTML = '';
    if (hubEl) hubEl.innerHTML = '';
    if (badge) { badge.textContent = activeDownloads.size; badge.style.display = 'block'; }

    activeDownloads.forEach((dl, id) => {
      const item = document.createElement('div');
      item.className = 'dl-item';
      item.setAttribute('data-dl-id', id);

      const isPaused = dl.status === 'paused';
      const pauseBtnHTML = dl.canPause ? `
        <button class="dl-pause-btn" title="${isPaused ? 'Resume Download' : 'Pause Download'}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; transition:all 0.2s; margin-left:6px; margin-right:2px;">
          ${isPaused ? 
            `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>` : 
            `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
          }
        </button>
      ` : '';

      item.innerHTML = `<div class="dl-item-main"><div class="dl-item-info"><div class="dl-name" title="${escapeHTML(dl.name)}">${escapeHTML(dl.name)}</div><div class="dl-item-meta"><span class="dl-item-status">${dl.statusText || (dl.downloaded || '0 B') + ' / ' + (dl.total || '?')}</span><span class="dl-speed" style="color:var(--accent);margin-left:8px;font-weight:700">${dl.speed || ''}</span>${dl.peers !== undefined ? `<span class="dl-peers" style="color:var(--text-muted);margin-left:8px;font-size:11px;">${dl.peers} peers</span>` : ''}</div></div><div class="dl-percent">${(dl.percent || 0).toFixed(1)}%</div>${pauseBtnHTML}<button class="dl-cancel-btn" title="Cancel Download"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="dl-progress-container"><div class="dl-progress-fill" style="width:${dl.percent || 0}%"></div></div>`;

      item.querySelector('.dl-cancel-btn').onclick = () => {
        window.api.cancelDownload(id);
        activeDownloads.delete(id);
        renderActiveDownloads();
        showToast('Cancelled');
      };

      if (dl.canPause) {
        item.querySelector('.dl-pause-btn').onclick = () => {
          if (dl.status === 'paused') {
            window.api.resumeDownload(id);
            dl.status = 'downloading';
            dl.speed = 'Resuming...';
          } else {
            window.api.pauseDownload(id);
            dl.status = 'paused';
            dl.speed = 'Paused';
          }
          renderActiveDownloads();
        };
      }

      el.appendChild(item);

      if (hubEl) {
        const hItem = item.cloneNode(true);
        hItem.querySelector('.dl-cancel-btn').onclick = () => item.querySelector('.dl-cancel-btn').click();
        if (dl.canPause) {
          hItem.querySelector('.dl-pause-btn').onclick = () => item.querySelector('.dl-pause-btn').click();
        }
        hubEl.appendChild(hItem);
      }
    });
    updateDownloadBadge();
  }

  function renderDownloadHistory() {
    const el = $('#dl-history-list'); if (!el) return;
    const h = appData.downloadHistory || [];
    if (!h.length) { el.innerHTML = '<div class="sidebar-empty-hint">No downloads yet</div>'; return; }
    el.innerHTML = '';
    h.slice(0, 20).forEach(dl => {
      const item = document.createElement('div');
      item.className = 'dl-item';
      item.innerHTML = `<div class="dl-item-info"><div class="dl-item-name">${escapeHTML(dl.name)}</div><div class="dl-item-status">${new Date(dl.date).toLocaleDateString()}</div></div>${dl.status === 'complete' ? '<span class="dl-complete">✓ Complete</span>' : `<span class="dl-error">✗ ${escapeHTML(dl.error || 'Failed')}</span>`}`;
      el.appendChild(item);
    });

    // Update popout if open
    const popoutList = document.getElementById('popout-dl-list');
    if (popoutList && document.getElementById('downloads-popout')) {
      const history = appData.downloadHistory || [];
      let html = '';
      if (activeDownloads.size > 0) {
        activeDownloads.forEach((dl, id) => {
          html += `
              <div style="padding: 10px; margin-bottom: 5px; border-radius: 12px; background: rgba(255,255,255,0.03);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px; align-items: center;">
                  <div style="font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 180px; color: #fff;">${escapeHTML(dl.name)}</div>
                  <div style="font-size: 10px; color: var(--accent); font-weight: 800;">${(dl.percent || 0).toFixed(1)}%</div>
                </div>
                <div style="height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                  <div style="width: ${dl.percent}%; height: 100%; background: var(--accent); box-shadow: 0 0 10px var(--accent);"></div>
                </div>
              </div>`;
        });
      }
      history.slice(0, 10).forEach(dl => {
        const icon = dl.status === 'complete' ? 'fa-check-circle' : 'fa-exclamation-circle';
        const color = dl.status === 'complete' ? '#4ade80' : '#f87171';
        html += `
              <div class="popout-history-item" style="padding: 10px; display: flex; align-items: center; gap: 12px; border-radius: 10px; position: relative; group;">
                <i class="fas ${icon}" style="color: ${color}; font-size: 14px; opacity: 0.8;"></i>
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(255,255,255,0.9);">${escapeHTML(dl.name)}</div>
                  <div style="font-size: 9px; opacity: 0.4;">${dl.status === 'complete' ? 'Completed' : (escapeHTML(dl.error) || 'Failed')}</div>
                </div>
                <div class="popout-item-actions" style="display: flex; gap: 8px; opacity: 0.4;">
                  ${dl.path ? `<i class="fas fa-folder-open" onclick="window.api.invoke('show-item-in-folder', '${dl.path.replace(/\\/g, '/').replace(/'/g, "\\'")}')" title="Open Location" style="cursor: pointer; font-size: 12px;"></i>` : ''}
                  <i class="fas fa-times" onclick="removeFromDownloadHistory('${(dl.id || dl.name).toString().replace(/'/g, "\\'")}')" title="Remove" style="cursor: pointer; font-size: 12px; color: #ff4d4d;"></i>
                </div>
              </div>`;
      });
      if (html) popoutList.innerHTML = html;
      else popoutList.innerHTML = '<div style="padding: 30px; text-align: center; opacity: 0.4; font-size: 11px;">No recent activity</div>';
    }
  }

  function removeFromDownloadHistory(idOrName) {
    if (!appData.downloadHistory) return;
    appData.downloadHistory = appData.downloadHistory.filter(h => (h.id || h.name) !== idOrName);
    persist();
    renderDownloadHistory();
  }

  function updateDownloadBadge() {
    const b = $('#badge-downloads');
    const hb = $('#header-dl-badge');
    const c = activeDownloads.size;
    if (b) { b.textContent = c; b.classList.toggle('visible', c > 0); }
    if (hb) { hb.textContent = c; hb.style.display = c > 0 ? 'block' : 'none'; }
  }

  // ── Vault Logic ──
  function resetPinInputs() {
    $$('.pin-digit').forEach(i => i.value = '');
  }

  function updateVaultUI() {
    const iconLocked = document.getElementById('vault-icon-locked');
    const iconUnlocked = document.getElementById('vault-icon-unlocked');
    const label = document.getElementById('vault-label');
    const btn = document.getElementById('btn-vault');
    const btnMobile = document.getElementById('btn-vault-mobile');
    if (isVaultUnlocked) {
      if (iconLocked) iconLocked.style.display = 'none';
      if (iconUnlocked) iconUnlocked.style.display = 'block';
      if (label) label.textContent = 'Vault Unlocked';
      if (btn) {
        btn.setAttribute('title', 'Lock Private Vault');
        btn.style.color = 'var(--accent, #00adb5)';
        btn.style.filter = 'drop-shadow(0 0 4px rgba(0, 173, 181, 0.6))';
      }
      if (btnMobile) {
        btnMobile.innerHTML = '<i class="fas fa-lock-open"></i> Private Vault (Unlocked)';
        btnMobile.style.borderColor = 'var(--accent, #00adb5)';
        btnMobile.style.color = 'var(--accent, #00adb5)';
      }
    } else {
      if (iconLocked) iconLocked.style.display = 'block';
      if (iconUnlocked) iconUnlocked.style.display = 'none';
      if (label) label.textContent = 'Private Vault';
      if (btn) {
        btn.setAttribute('title', 'Unlock Private Vault');
        btn.style.color = '';
        btn.style.filter = '';
      }
      if (btnMobile) {
        btnMobile.innerHTML = '<i class="fas fa-lock"></i> Private Vault';
        btnMobile.style.borderColor = '';
        btnMobile.style.color = '';
      }
    }
  }

  function openVault() {
    if (!currentProfile) {
      showToast('Please select a profile first.');
      return;
    }
    if (isVaultUnlocked) {
      lockVault();
      return;
    }
    
    const hasPin = !!currentProfile.vaultPin;
    const modal = document.getElementById('vault-modal');
    const title = document.getElementById('vault-modal-title');
    const desc = document.getElementById('vault-modal-desc');
    
    if (modal) {
      resetPinInputs();
      if (!hasPin) {
        title.textContent = 'Setup Private Vault';
        desc.textContent = 'Create a 4-digit PIN to secure your vault.';
        modal.dataset.mode = 'setup';
      } else {
        title.textContent = 'Private Vault';
        desc.textContent = 'Enter your 4-digit PIN to access locked content.';
        modal.dataset.mode = 'unlock';
      }
      modal.style.display = 'flex';
      setTimeout(() => {
        const firstInput = modal.querySelector('.pin-digit');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  }

  function lockVault() {
    isVaultUnlocked = false;
    updateVaultUI();
    showToast('Vault locked');
    renderLibrary();
    renderWatchlist();
    renderMusic();
  }

  function toggleLock(item) {
    if (!currentProfile) return;
    
    currentProfile.lockedItems = currentProfile.lockedItems || [];
    const isCurrentlyLocked = currentProfile.lockedItems.includes(item.id);
    
    if (isCurrentlyLocked) {
      const hasPin = !!currentProfile.vaultPin;
      if (!hasPin) {
        currentProfile.lockedItems = currentProfile.lockedItems.filter(id => id !== item.id);
        persist(true);
        showToast('Item unlocked');
        renderLibrary(); renderWatchlist(); renderMusic();
        return;
      }
      
      const modal = document.getElementById('vault-modal');
      const title = document.getElementById('vault-modal-title');
      const desc = document.getElementById('vault-modal-desc');
      if (modal) {
        resetPinInputs();
        title.textContent = 'Unlock Item';
        desc.textContent = `Enter your 4-digit PIN to unlock "${item.title || item.name}".`;
        modal.dataset.mode = 'unlock-item';
        modal.dataset.targetId = item.id;
        modal.style.display = 'flex';
        setTimeout(() => {
          const firstInput = modal.querySelector('.pin-digit');
          if (firstInput) firstInput.focus();
        }, 100);
      }
    } else {
      const hasPin = !!currentProfile.vaultPin;
      if (!hasPin) {
        const modal = document.getElementById('vault-modal');
        const title = document.getElementById('vault-modal-title');
        const desc = document.getElementById('vault-modal-desc');
        if (modal) {
          resetPinInputs();
          title.textContent = 'Setup Private Vault';
          desc.textContent = 'Create a 4-digit PIN to lock items.';
          modal.dataset.mode = 'setup-lock-item';
          modal.dataset.targetId = item.id;
          modal.style.display = 'flex';
          setTimeout(() => {
            const firstInput = modal.querySelector('.pin-digit');
            if (firstInput) firstInput.focus();
          }, 100);
        }
      } else {
        currentProfile.lockedItems.push(item.id);
        persist(true);
        showToast('Item locked');
        renderLibrary(); renderWatchlist(); renderMusic();
      }
    }
  }

  function handleVaultAuth() {
    if (!currentProfile) return;
    const modal = document.getElementById('vault-modal');
    if (!modal) return;
    
    const digits = Array.from(modal.querySelectorAll('.pin-digit')).map(i => i.value).join('');
    if (digits.length < 4) {
      showToast('Please enter a 4-digit PIN');
      return;
    }
    
    const mode = modal.dataset.mode;
    const targetId = modal.dataset.targetId;
    
    if (mode === 'setup' || mode === 'setup-lock-item') {
      currentProfile.vaultPin = digits;
      persist(true);
      showToast('PIN set successfully');
      modal.style.display = 'none';
      resetPinInputs();
      
      if (mode === 'setup-lock-item' && targetId) {
        currentProfile.lockedItems = currentProfile.lockedItems || [];
        if (!currentProfile.lockedItems.includes(targetId)) {
          currentProfile.lockedItems.push(targetId);
          persist(true);
        }
        showToast('Item locked');
      } else {
        isVaultUnlocked = true;
        updateVaultUI();
      }
      
      renderLibrary(); renderWatchlist(); renderMusic();
    } else if (mode === 'unlock' || mode === 'unlock-item') {
      const correctPin = currentProfile.vaultPin;
      if (digits === correctPin) {
        modal.style.display = 'none';
        resetPinInputs();
        
        if (mode === 'unlock-item' && targetId) {
          currentProfile.lockedItems = (currentProfile.lockedItems || []).filter(id => id !== targetId);
          persist(true);
          showToast('Item unlocked');
          renderLibrary(); renderWatchlist(); renderMusic();
        } else {
          isVaultUnlocked = true;
          updateVaultUI();
          showToast('Vault unlocked');
          renderLibrary(); renderWatchlist(); renderMusic();
        }
      } else {
        showToast('Incorrect PIN. Please try again.');
        resetPinInputs();
        const firstInput = modal.querySelector('.pin-digit');
        if (firstInput) firstInput.focus();
      }
    }
  }

  function renderAll() {
    renderLibrary(); renderSidebar(); renderWatchlist(); renderSocial(); renderMusic();
    showToast('Library ready');
  }

  // ── FINAL BOOT ──
  (async () => {
    console.log('[INIT] Starting MediaVault Boot Sequence...');
    if (isNativePlayerWindow()) {
      document.body.classList.add('mv-native-player-window');
      if (window.hideSplash) window.hideSplash();
      else document.body.classList.add('app-ready');

      // Start player splash screen countdown (minimum display time 2200ms)
      setTimeout(() => {
        playerSplashMinTimeDone = true;
        if (typeof window.tryDismissPlayerSplash === 'function') {
          window.tryDismissPlayerSplash();
        }
      }, 2200);
    } else if (isChatWindow()) {
      document.body.classList.add('mv-chat-window');
      if (window.hideSplash) window.hideSplash();
      else document.body.classList.add('app-ready');
    }

    try {
      // 1. Android Permission Request (Critical for Android 11+)
      if (window.api && window.api.isMobile && window.api.isMobile()) {
        console.log('[INIT] Requesting Mobile Permissions...');
        await window.api.invoke('request-filesystem-permissions');
      }

      const saved = await window.api.loadData();
      appData = deepMerge(appData, saved);
      if (saved?.profiles?.length) appData.profiles = normalizeProfiles(appData.profiles);
      if (saved?.authenticated) appData.authenticated = saved.authenticated;
      if (saved?.user) appData.user = saved.user;
      
      // Re-apply stored theme from disk
      if (typeof window.applyTheme === 'function') {
        window.applyTheme(appData.theme || 'minimalist');
      }

      const autoChooseToggle = $('#setting-auto-choose-stream');
      const autoChooseResSelect = $('#setting-auto-choose-res');
      if (autoChooseToggle) autoChooseToggle.checked = !!appData.autoChooseBestStream;
      if (autoChooseResSelect) autoChooseResSelect.value = appData.autoChooseMaxRes || '1080p';

      ensureDefaultAddons();
      updateSubdlVisibility();

      appData.thumbnails = appData.thumbnails || {};

      // Initialize default library if missing
      if (!appData.libraryFolders || appData.libraryFolders.length === 0) {
        const defaultRoot = await window.api.invoke('get-default-library-root');
        appData.libraryFolders = [defaultRoot];
      }


      // Auto-set default Remote IP for mobile if not configured
      if (window.api && window.api.isMobile && window.api.isMobile()) {
        if (!appData.remoteStreamingServer || appData.remoteStreamingServer === '') {
          appData.remoteStreamingServer = '192.168.31.125';
        }
      }

      console.log('[INIT] Data Loaded. Profiles:', appData.profiles?.length || 0);

      // Purge physically deleted files from download history
      if (appData.downloadHistory && appData.downloadHistory.length) {
        appData.downloadHistory = await window.api.cleanMissingDownloads(appData.downloadHistory) || [];
      }

      // Apply saved theme or default to dark
      if (!appData.theme) {
        appData.theme = 'dark';
      }

      // Zoom Correction
      if (appData.zoomFactor !== undefined) {
        if (typeof appData.zoomFactor !== 'number' || appData.zoomFactor < 0.5 || appData.zoomFactor > 2.0) appData.zoomFactor = 1.0;
        if (window.api.setZoom) window.api.setZoom(appData.zoomFactor);
      }

      migrateToProfiles();

      // Safety: Ensure profiles is always an array
      if (!appData.profiles) appData.profiles = [];

      if (appData.profiles.length === 0) {
        console.log('[INIT] No profiles found. Awaiting authentication flow...');
      } else {
        if (!isNativePlayerWindow() && !isChatWindow()) {
          console.log('[INIT] Profiles ready. Awaiting authentication flow...');
        }

        if (window.api && window.api.isMobile && window.api.isMobile()) {
          for (const p of appData.profiles) {
            await window.api.invoke('ensure-profile-folders', p.name);
          }
        }

        if (appData.libraryPath && !appData.libraryFolders.includes(appData.libraryPath)) appData.libraryFolders.push(appData.libraryPath);

        const fp = $('#folder-path');
        if (fp) fp.value = appData.libraryFolders[appData.libraryFolders.length - 1] || '';

        const rb = $('#btn-rescan');
        if (rb) rb.disabled = appData.libraryFolders.length === 0 && !appData.youtubeFolder;

        const yp = $('#yt-folder-path');
        if (yp && appData.youtubeFolder) yp.value = appData.youtubeFolder;

        if (!isNativePlayerWindow() && !isChatWindow()) {
          renderSidebar();
          renderDownloadHistory();
          renderSocial();
          setTimeout(() => {
            showToast('الترفيه متعة.. فلا تجعلها وسيلة لجمع ما يؤذي روحك. كن رقيباً على نفسك', 6000);
          }, 1500);
          renderMusic();
          renderProfileWidget();
          initSidebarGroups();
          if (currentView !== 'player') {
            switchView('discover');
          }
          autoMatchMetadata();
          checkAndUnlockApp();
        } else if (isChatWindow()) {
          checkAndUnlockApp();
        } else {
          // Native Player Window Overrides
          const backBtn = $('#btn-back-player');
          if (backBtn) {
            backBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>`;
            backBtn.title = "Close Player";
          }
          const playerWrapper = $('#player-wrapper');
          if (playerWrapper) {
            ['top', 'bottom', 'left', 'right'].forEach(dir => {
              const div = document.createElement('div');
              div.className = `window-drag-edge-${dir}`;
              playerWrapper.appendChild(div);
            });
          }
          switchView('player');
        }
      }



      const mainProfileBtn = $('#btn-switch-profile-main');
      if (mainProfileBtn) {
        mainProfileBtn.onclick = () => renderProfilePicker();
      }

      const headerProfileBtn = $('#btn-switch-profile-header');
      if (headerProfileBtn) {
        headerProfileBtn.onclick = () => renderProfilePicker();
      }

      $$('.btn-switch-profile-main-dynamic').forEach(btn => {
        btn.onclick = () => renderProfilePicker();
      });




    } catch (err) {
      console.error('[INIT] FATAL BOOT ERROR:', err);
    }
    document.body.classList.add('app-loaded');
    // Note: Splash screen removal is now fully coordinated with runAuthFlow and profile selection
    // to prevent it from disappearing before account/profile details are fetched.

    // --- Swipe to Dismiss for Notifications ---
    (function setupNotificationSwipe() {
      const toast = document.getElementById('update-toast');
      if (!toast) return;

      let touchStartY = 0;
      toast.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      toast.addEventListener('touchmove', (e) => {
        const touchY = e.touches[0].clientY;
        const diff = touchStartY - touchY;
        if (diff > 10) { // Swipe up
          toast.style.transform = `translateY(${-diff}px) scale(0.95)`;
          toast.style.opacity = Math.max(0, 1 - diff / 100);
        }
      }, { passive: true });

      toast.addEventListener('touchend', (e) => {
        const touchY = e.changedTouches[0].clientY;
        if (touchStartY - touchY > 50) {
          toast.classList.remove('active');
        }
        // Reset styles after transition
        setTimeout(() => {
          toast.style.transform = '';
          toast.style.opacity = '';
        }, 300);
      }, { passive: true });

      // Also allow clicking to dismiss if not on mobile
      toast.onclick = () => toast.classList.remove('active');
    })();

  })();

  function updateSleepUI() {
    if ($('#sleep-overlay').style.display !== 'none') {
      // Update Progress in Sleep Mode
      if (video && video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        const fill = $('#sleep-progress-fill');
        if (fill) fill.style.width = pct + '%';

        const curr = $('#sleep-time-current');
        const tot = $('#sleep-time-total');
        if (curr) curr.textContent = formatTime(video.currentTime);
        if (tot) tot.textContent = formatTime(video.duration);
      }

      setTimeout(updateSleepUI, 1000);
    }
  }




  // ══════════════════════════════════════════════════════════════════════════
  //  FUNCTIONS
  // ══════════════════════════════════════════════════════════════════════════

  window.switchView = switchView;
  window.switchSocialMusicSubTab = function(tab) {
    if (tab === 'audio') switchView('music');
    else switchView('social');
  };
  window.escapeHTML = escapeHTML;
  window.saveData = persist;
  window.getPlaybackKey = getPlaybackKey;
  window.toggleWatchlist = toggleWatchlist;
  window.playStream = playStream;
  window.loadStreams = loadStreams;
  window.TMDB_IMG = null;

  function switchView(name) {
    if (name === 'home') name = 'discover';
    window.switchView = switchView;
    if (name !== 'custom-list-detail' && name !== 'discover-detail' && name !== 'player' && name !== 'music-player') {
      activeCustomListId = null;
      if (customListRealtimeChannel) {
        try {
          customListRealtimeChannel.unsubscribe();
        } catch (e) {}
        customListRealtimeChannel = null;
      }
    }
    if (typeof window.stopBackgroundTrailer === 'function') window.stopBackgroundTrailer();
    if (currentView === 'iptv' && name !== 'iptv') {
      if (typeof window.stopIptvPlayback === 'function') {
        window.stopIptvPlayback();
      }
    }
    if (currentView === 'player' && name !== 'player') {
      if (!suppressStopOnViewChange) {
        if (engine) engine.stop();
        // Cleanup standalone torrents on mobile only when NOT minimizing
        if (window.browserWT) {
          window.browserWT.torrents.forEach(t => t.destroy());
        }
      }
      // Always reset the suppression flag after handling the transition
      suppressStopOnViewChange = false;
    }

    if (name === 'player' || name === 'music-player' || name === 'discover-detail' || name === 'custom-list-detail') {
      if (currentView && currentView !== 'player' && currentView !== 'music-player' && currentView !== 'discover-detail') {
        prevView = currentView;
        window.prevView = currentView;
      }
      // Only set source view if we're not already in a player/detail view to avoid overwriting with 'player'
      if (name !== 'discover-detail' && name !== 'custom-list-detail' && currentView !== 'player' && currentView !== 'music-player' && currentView !== 'discover-detail') {
        playerSourceView = currentView;
      }
    }
    if (name === 'discover') discoverStack = []; // Reset sub-navigation when going to main list
    if (['library', 'movies', 'shows', 'social', 'music', 'radio', 'iptv', 'addons', 'watchlist', 'settings', 'account', 'discover', 'downloads', 'discover-detail', 'show-detail', 'subtitles', 'sync', 'player', 'music-player', 'profiles', 'hub', 'search', 'custom-list-detail'].includes(name)) {
      if (name === 'custom-list-detail') {
        if (activeCustomListId && (currentView === 'discover-detail' || currentView === 'player' || currentView === 'music-player')) {
          renderCustomListDetail(activeCustomListId);
        }
      }
      currentView = name;
      if (!name.includes('detail')) appData.lastView = name;
      persist();
      window.scrollTo(0, 0); // Smart scroll: Reset scroll to top when changing views
      if (name === 'radio') {
        if (typeof initRadioView === 'function') initRadioView();
      }
      if (name === 'iptv') {
        if (typeof initIptvView === 'function') initIptvView();
      }
      if (name === 'addons') {
        if (typeof initStremioAddonsUI === 'function') initStremioAddonsUI();
      }
      if (name === 'settings') {
        if (typeof initSubdlUI === 'function') initSubdlUI();
        if (typeof initTmdbUI === 'function') initTmdbUI();
        // Update the settings account banner with live profile data
        window.updateSettingsBanner = function updateSettingsBanner() {
          try {
            const profile = window.currentProfile || (window.appData && window.appData.profiles && window.appData.profiles.find(p => p.id === window.appData.activeProfileId));
            const user = window.appData && window.appData.user;

            const nameEl = document.getElementById('settings-user-name');
            const emailEl = document.getElementById('settings-user-email');
            const avatarEl = document.getElementById('settings-user-avatar');

            const displayName = user?.user_metadata?.username || user?.user_metadata?.display_name || user?.user_metadata?.full_name || profile?.name || 'My Account';
            const displayEmail = user?.email || (profile ? `Profile: ${profile.name}` : 'Local Account');
            const avatarSrc = (profile?.avatar && window.localImg) ? window.localImg(profile.avatar) : (profile?.avatar || 'imgs/appicon-w.png');

            if (nameEl) nameEl.textContent = displayName;
            if (emailEl) emailEl.textContent = displayEmail;
            if (avatarEl) {
              avatarEl.src = avatarSrc || 'imgs/appicon-w.png';
              avatarEl.onerror = () => { avatarEl.onerror = null; avatarEl.src = 'imgs/appicon-w.png'; };
            }

            // Update banner background if profile has a banner image
            const bannerUrl = profile?.banner || (window.appData && window.appData.globalBanner);
            const coverEl = document.querySelector('#settings-account-banner .settings-account-cover');
            if (coverEl && bannerUrl && window.localImg) {
              coverEl.style.backgroundImage = `url('${window.localImg(bannerUrl)}')`;
              coverEl.style.backgroundSize = 'cover';
              coverEl.style.backgroundPosition = 'center';
            }
          } catch (e) { /* ignore - profile may not be loaded yet */ }
        };
        window.updateSettingsBanner();
      }
      if (name === 'library' || name === 'watchlist') {
        if (typeof loadAndRenderInvitations === 'function') {
          loadAndRenderInvitations();
        }
      }
    }
    if (name !== 'show-detail') currentShowId = null;
    $$('.nav-btn[data-view]').forEach(b => {
      const v = b.dataset.view;
      const isAct = v === name || (v === 'social' && (name === 'social' || name === 'music'));
      b.classList.toggle('active', isAct);
    });

    const liveWrap = $('#nav-live-wrapper');
    if (liveWrap) {
      const isLiveAct = (name === 'iptv' || name === 'radio');
      liveWrap.classList.toggle('active', isLiveAct);
      if (isLiveAct) {
        liveWrap.classList.add('open');
      }
      const liveBtn = $('#nav-live-channels');
      if (liveBtn) liveBtn.classList.toggle('active', isLiveAct);

      // Highlight active sub-item (IPTV vs Live Radio)
      $$('#nav-live-wrapper .flyout-item').forEach(item => {
        const itemTarget = item.getAttribute('data-view') || item.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        item.classList.toggle('active', itemTarget === name);
      });

      // Dynamically update the main button label on sidebar when active
      const mainLabel = $('#nav-live-main-label') || (liveBtn ? liveBtn.querySelector('span') : null);
      if (mainLabel) {
        if (name === 'iptv') {
          mainLabel.textContent = 'IPTV';
        } else if (name === 'radio') {
          mainLabel.textContent = 'Live Radio';
        } else {
          mainLabel.textContent = 'Live';
        }
      }
    }

    // Update floating mini player bar for Radio & IPTV live streams outside their views
    try {
      const bar = document.getElementById('radio-player-bar');
      if (bar) {
        const isRadioPlaying = typeof window.isRadioPlaying === 'function' && window.isRadioPlaying();
        const isIptvPlaying = typeof window.isIptvPlaying === 'function' && window.isIptvPlaying();

        if (name === 'radio' || name === 'iptv' || name === 'player') {
          bar.classList.remove('active');
        } else if (isRadioPlaying) {
          if (typeof window.updateRadioPlayerBarUI === 'function') window.updateRadioPlayerBarUI();
          bar.classList.add('active');
        } else if (isIptvPlaying) {
          if (typeof window.updateIptvPlayerBarUI === 'function') window.updateIptvPlayerBarUI();
          bar.classList.add('active');
        } else {
          bar.classList.remove('active');
        }
      }
    } catch (e) {}

    $$('.myspace-cat-pill').forEach(b => {
      const target = b.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
      b.classList.toggle('active', target === name);
    });
    Object.entries(views).forEach(([k, el]) => {
      if (el) {
        const isActive = k === name;
        if (isActive && !el.classList.contains('active')) {
          // Trigger transition
          el.classList.remove('page-fade');
          void el.offsetWidth;
          el.classList.add('page-fade');
        }
        el.classList.toggle('active', isActive);
        // Explicitly set display to avoid relying purely on CSS class (fixes settings/account blank)
        if (isActive) {
          // Some views need flex layout instead of block
          if (k === 'addons') {
            el.style.display = 'flex';
          } else if (k === 'iptv') {
            el.style.display = 'block';
          } else {
            el.style.display = 'block';
          }
        } else {
          el.style.display = 'none';
        }
      }
    });

    // Handle Sidebar Visibility for Immersive Views
    const sidebar = $('#sidebar');
    if (sidebar) {
      if (name === 'discover-detail' || name === 'player') {
        sidebar.style.display = 'none';
      } else {
        sidebar.style.display = 'flex';
      }
    }

    if (name === 'search') {
      setTimeout(() => {
        const input = $('#search-input-main');
        if (input) input.focus();
      }, 100);
      performUnifiedSearch($('#search-input-main')?.value || '');
      // Hide floating search button when in search view
      const floatingSearchBtn = $('#floating-search-btn');
      if (floatingSearchBtn) floatingSearchBtn.style.display = 'none';
    } else {
      const previewPanel = $('#search-preview-panel');
      if (previewPanel) {
        previewPanel.classList.remove('active');
      }
    }

    const isBuffering = $('#player-loading') && $('#player-loading').style.display !== 'none';
    const isEngineActive = currentItem && (engine.isUsingMpv || !video.paused || video.currentTime > 0 || isPlayingMusic || isBuffering);

    // Strictly hide mini-player if we are in the main player view
    if (name !== 'player' && isEngineActive) {
      let title = '', meta = '';

      if (currentShow) {
        title = currentItem.displayTitle || currentItem.title;
        meta = currentShow.title;
      } else if (currentItem.type === 'music' || isPlayingMusic) {
        const musicMeta = getMusicMeta(currentItem);
        title = musicMeta.title;
        meta = musicMeta.artist;
      } else {
        title = currentItem.title;
        meta = 'Now Playing';
      }

      $('#mp-title').textContent = title;
      $('#mp-meta').textContent = meta;

      // Update mini-player poster for video
      const mpPoster = $('#mp-poster');
      if (mpPoster) {
        mpPoster.onerror = function () { this.style.display = 'none'; };
        let pUrl = '';
        if (currentItem) {
          pUrl = localImg(currentItem.poster_path || currentItem.posterPath || currentItem.thumbnail || currentItem.backdrop_path || (currentShow && currentShow.poster_path));
        }

        if (pUrl) {
          mpPoster.src = pUrl;
          mpPoster.style.display = 'block';
        } else {
          mpPoster.style.display = 'none';
        }
      }

      $('#mini-player').style.display = 'flex';
      document.body.classList.add('mini-player-active');
    } else {
      $('#mini-player').style.display = 'none';
      document.body.classList.remove('mini-player-active');
    }

    // Mobile dock visibility is now handled completely by the Contextual Dock Swap logic below.
    // Initial visualizer init if music is active and we just switched to player
    if (name === 'player' && isPlayingMusic && typeof initVisualizer === 'function') {
      initVisualizer();
    }

    window.setLibraryTab = function (tab) {
      switchView(tab);
    };

    if (name === 'discover') {
      const trending = $('#trending-row');
      const isBlank = !trending || trending.children.length === 0 || trending.querySelector('.discover-card-skeleton');
      if (isBlank && !isDiscoverLoading) loadDiscover();
    }
    if (name === 'watchlist') {
      renderWatchlist();
      syncTraktWatchlistToLocal();
    }
    if (name === 'settings') renderSettings();
    if (name === 'social') renderSocial();
    if (name === 'music') renderMusic();
    if (name === 'subtitles') renderSubtitles();
    if (name === 'library') {
      renderLibrary();
      if (window.socialPresence && window.socialPresence.renderInvitedFriends) {
        window.socialPresence.renderInvitedFriends();
      }
    }
    if (name === 'downloads') {
      renderActiveDownloads();
      renderDownloadHistory();
    }

    if (name === 'sync') renderSync();
    if (name === 'account') renderAccount();

    // --- Mobile Contextual Dock & Title Logic ---
    if (!window.api || !window.api.isElectron) {
      const msTitle = $('#myspace-profile-name');
      const mobHeader = $('#mobile-nav-header');
      const mobTitle = $('#mobile-nav-title');
      const mobileDock = $('#mobile-dock');

      // Define which views are MySpace sub-views (contextual dock territory)
      const myspaceViews = ['library', 'movies', 'shows', 'social', 'music', 'subtitles'];
      const isMySpaceView = myspaceViews.includes(name);

      const libraryViews = ['library', 'movies', 'shows', 'social', 'music', 'subtitles'];
      const isLibraryView = libraryViews.includes(name);
      const prevLibraryIdx = window.prevLibIdx !== undefined ? window.prevLibIdx : 0;
      const currentLibraryIdx = libraryViews.indexOf(name);

      if (mobHeader && mobTitle) {
        if (isLibraryView) {
          mobHeader.classList.add('visible');
          const viewNames = {
            'library': 'Dashboard',
            'movies': 'Movies',
            'shows': 'Series',
            'social': 'Social',
            'music': 'Music',
            'watchlist': 'Watchlist',
            'subtitles': 'Subtitles'
          };

          const newTitle = viewNames[name] || 'Library';
          if (mobTitle.textContent !== newTitle) {
            const isNext = currentLibraryIdx > prevLibraryIdx;
            mobTitle.textContent = newTitle;
            mobTitle.classList.remove('title-push-next', 'title-push-prev');
            void mobTitle.offsetWidth; // Trigger reflow
            mobTitle.classList.add(isNext ? 'title-push-next' : 'title-push-prev');
          }
          window.prevLibIdx = currentLibraryIdx;
        } else {
          mobHeader.classList.remove('visible');
        }
      }

      // --- Contextual Dock Swap ---
      // When inside MySpace sub-views, the bottom dock transforms to show
      // page-specific tabs (Movies, Series, Social, etc.) + a Step Back button.
      // When leaving to a global view, the original dock is restored.
      if (mobileDock) {
        // Save the original global dock HTML on first call
        if (!window._originalDockHTML) {
          window._originalDockHTML = mobileDock.innerHTML;
        }

        if (isMySpaceView) {
          const myspaceTabs = [
            { view: 'movies', icon: 'fa-film', label: 'Movies' },
            { view: 'shows', icon: 'fa-tv', label: 'Series' },
            { view: 'music', icon: 'fa-music', label: 'Music' },
            { view: 'social', icon: 'fa-share-nodes', label: 'Social' }
          ];

          let dockHTML = '<button class="nav-btn dock-back-btn" data-view="__step_back__">'
            + '<i class="fas fa-arrow-left"></i>'
            + '<span>Back</span>'
            + '</button>';

          myspaceTabs.forEach(tab => {
            const isActive = name === tab.view ? ' active' : '';
            dockHTML += '<button class="nav-btn' + isActive + '" data-view="' + tab.view + '">'
              + '<i class="fas ' + tab.icon + '"></i>'
              + '<span>' + tab.label + '</span>'
              + '</button>';
          });

          mobileDock.innerHTML = dockHTML;

          // Re-bind click handlers for contextual dock
          mobileDock.querySelectorAll('.nav-btn').forEach(btn => {
            btn.onclick = () => {
              const targetView = btn.dataset.view;
              if (targetView === '__step_back__') {
                // Step Back → go to the global "Explore" view
                switchView('discover');
              } else {
                switchView(targetView);
              }
            };
          });
        } else {
          // Restore original global dock when not in MySpace
          if (window._originalDockHTML) {
            mobileDock.innerHTML = window._originalDockHTML;
            // Re-bind global dock click handlers
            mobileDock.querySelectorAll('.nav-btn').forEach(btn => {
              btn.onclick = () => {
                mobileDock.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                switchView(btn.dataset.view);
              };
            });
            // Highlight the active global tab
            mobileDock.querySelectorAll('.nav-btn').forEach(b => {
              b.classList.toggle('active', b.dataset.view === name);
            });
          }
        }
      }

      // Update the Dashboard Hero name too if in library view
      if (name === 'library' && msTitle) msTitle.textContent = currentProfile?.name || 'User';
    }
  }

  // --- Mobile Swipe Navigation Logic ---
  /*
  let touchStartX = 0;
  let touchEndX = 0;
  let touchStartY = 0;

  if (!window.api || !window.api.isElectron) {
    const swipeViews = ['library', 'movies', 'shows', 'social', 'music', 'watchlist', 'subtitles'];

    window.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    window.addEventListener('touchend', e => {
      touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;

      const diffX = touchStartX - touchEndX;
      const diffY = Math.abs(touchStartY - touchEndY);

      // Only swipe if in a library view and horizontal movement is dominant
      if (swipeViews.includes(currentView) && Math.abs(diffX) > 80 && diffY < 80) {
        const currentIdx = swipeViews.indexOf(currentView);
        if (currentIdx === -1) return;

        // Apply slide animation class to current view
        const currentViewEl = views[currentView];
        if (currentViewEl) {
          currentViewEl.classList.add(diffX > 0 ? 'swiping-left' : 'swiping-right');
          setTimeout(() => currentViewEl.classList.remove('swiping-left', 'swiping-right'), 400);
        }

        if (diffX > 0) {
          const nextIdx = (currentIdx + 1) % swipeViews.length;
          switchView(swipeViews[nextIdx]);
        } else {
          const prevIdx = (currentIdx - 1 + swipeViews.length) % swipeViews.length;
          switchView(swipeViews[prevIdx]);
        }
      }
    }, { passive: true });
  }
  */

  function updateHeroSlide() {
    const item = homeHeroItems[homeHeroIndex];
    if (!item) return;
    $('#home-hero-backdrop').style.backgroundImage = `url("${item.backdrop}")`;
    $('#home-hero-title').textContent = item.title;
    $('#home-hero-desc').textContent = item.desc || '';
    $('#home-hero-tag').textContent = item.tag;
    $('#home-hero-play').onclick = () => openDiscoverDetail(item.tmdbItem);
    $('#home-hero-info').onclick = () => openDiscoverDetail(item.tmdbItem);
  }

  function renderHeroDots() {
    const dots = $('#home-hero-dots');
    if (!dots) return;
    dots.innerHTML = '';
    homeHeroItems.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'home-hero-dot' + (i === homeHeroIndex ? ' active' : '');
      dot.onclick = () => { homeHeroIndex = i; updateHeroSlide(); renderHeroDots(); };
      dots.appendChild(dot);
    });
  }

  // Trigger Home render on initial load
  if (window.Capacitor) {
    document.body.classList.add('dark-theme');
    // Ensure all views are clean indigo-dark
    document.documentElement.style.setProperty('--bg', '#0d0d12');

    // Sync firstRun state
    if (appData.firstRun && appData.profiles.length > 0) {
      appData.firstRun = false;
      persist();
    }
  }

  // Update mobile tab listeners
  $$('#mobile-dock .nav-btn').forEach(btn => {
    btn.onclick = () => {
      $$('#mobile-dock .nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchView(btn.dataset.view);
    };
  });

  // ── Subtitle Center ──
  let subSelectedItems = new Set();

  function updateSubMultiSelectUI() {
    const bar = $('#sub-multi-select-bar');
    const count = $('#sub-selected-count');
    const checkAll = $('#sub-check-all');
    if (!bar) return;

    if (subSelectedItems.size > 0) {
      bar.style.display = 'flex';
      bar.classList.add('premium-anim-slide-up');
      count.textContent = `${subSelectedItems.size} Selected`;

      if (checkAll) {
        checkAll.style.background = 'var(--accent)';
        checkAll.style.borderColor = 'var(--accent)';
        checkAll.innerHTML = '<i class="fas fa-check" style="font-size: 9px; color: #fff;"></i>';
      }
    } else {
      bar.style.display = 'none';
      if (checkAll) {
        checkAll.style.background = 'transparent';
        checkAll.style.borderColor = 'rgba(255,255,255,0.2)';
        checkAll.innerHTML = '';
      }
    }
  }

  // Select All logic
  const selectAllWrap = $('#sub-select-all-wrap');
  if (selectAllWrap) {
    selectAllWrap.onclick = async () => {
      const subs = await window.api.invoke('list-profile-subtitles', {
        profileName: currentProfile?.name || 'Default',
        libraryRoot: appData.libraryFolders?.[0] || '',
        subDir: subCurrentDir
      });

      if (!subs || subs.length === 0) return;

      const allNames = subs.map(s => s.name);
      const allSelected = allNames.every(n => subSelectedItems.has(n));

      if (allSelected) {
        allNames.forEach(n => subSelectedItems.delete(n));
      } else {
        allNames.forEach(n => subSelectedItems.add(n));
      }

      updateSubMultiSelectUI();
      renderSubtitles();
    };
  }

  // Bulk actions for Subtitle Center
  const btnSubBulkDel = $('#btn-sub-bulk-delete');
  if (btnSubBulkDel) btnSubBulkDel.onclick = async () => {
    if (subSelectedItems.size === 0) return;
    if (confirm(`Delete ${subSelectedItems.size} items permanently?`)) {
      showToast(`Deleting ${subSelectedItems.size} items...`);
      for (const fileName of subSelectedItems) {
        await window.api.invoke('delete-subtitle-local', {
          profileName: currentProfile?.name || 'Default',
          libraryRoot: appData.libraryFolders?.[0] || '',
          fileName,
          subDir: subCurrentDir
        });
      }
      subSelectedItems.clear();
      updateSubMultiSelectUI();
      renderSubtitles();
    }
  };

  const btnSubClearSel = $('#btn-sub-clear-selection');
  if (btnSubClearSel) btnSubClearSel.onclick = () => {
    subSelectedItems.clear();
    updateSubMultiSelectUI();
    renderSubtitles();
  };

  async function renderSubtitles() {
    const grid = $('#sub-library-grid');
    if (!grid) return;

    renderSubBreadcrumbs();

    const subs = await window.api.invoke('list-profile-subtitles', {
      profileName: currentProfile?.name || 'Default',
      libraryRoot: appData.libraryFolders?.[0] || '',
      subDir: subCurrentDir
    });
    grid.innerHTML = '';

    if (subCurrentDir) {
      const back = document.createElement('div');
      back.className = 'media-card sub-lib-card';
      back.style = 'background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.2); border-radius: 18px; padding: 8px 14px; display: flex; align-items: center; gap: 20px; cursor: pointer; transition: all 0.2s;';
      back.innerHTML = `<div style="font-size: 22px; width: 48px; height: 48px; color: #fff; display: flex; align-items: center; justify-content: center;"><i class="fas fa-arrow-left"></i></div><div style="font-weight: 700;">Back to Parent</div>`;
      back.onclick = () => {
        const parts = subCurrentDir.split(/[\\/]/);
        parts.pop();
        subCurrentDir = parts.join('/');
        subSelectedItems.clear();
        renderSubtitles();
      };

      // Allow dropping into parent
      back.ondragover = (e) => {
        e.preventDefault();
        back.style.background = 'rgba(255,255,255,0.15)';
        back.style.borderColor = 'var(--accent)';
      };
      back.ondragleave = () => {
        back.style.background = 'rgba(255,255,255,0.06)';
        back.style.borderColor = 'rgba(255,255,255,0.2)';
      };
      back.ondrop = (e) => {
        e.preventDefault();
        const parts = subCurrentDir.split(/[\\/]/);
        parts.pop();
        const targetDir = parts.join('/');
        handleSubMoveDrop(targetDir);
      };

      grid.appendChild(back);
    }

    if ((!subs || subs.length === 0) && !subCurrentDir) {
      grid.innerHTML = '<div class="sidebar-empty-hint" style="grid-column: 1/-1; padding: 60px; text-align: center;">Library is empty. Drop files above.</div>';
      return;
    }

    subs.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'media-card sub-lib-card';
      const isDir = sub.isDir;
      const isAss = !isDir && sub.name.toLowerCase().endsWith('.ass');
      const iconColor = isDir ? '#f59e0b' : (isAss ? '#a855f7' : '#3b82f6');
      const iconClass = isDir ? 'fa-folder' : (isAss ? 'fa-wand-magic-sparkles' : 'fa-closed-captioning');
      const isSelected = subSelectedItems.has(sub.name);

      item.style = `
        background: ${isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)'};
        backdrop-filter: blur(10px);
        border: 1px solid ${isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)'};
        border-radius: 18px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 20px;
        position: relative;
        transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        cursor: pointer;
      `;

      item.innerHTML = `
        <div class="sub-checkbox" style="width: 20px; height: 20px; border: 2px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; ${isSelected ? 'background: var(--accent);' : ''}">
            ${isSelected ? '<i class="fas fa-check" style="font-size: 10px; color: #fff;"></i>' : ''}
        </div>
        <div style="pointer-events: none; font-size: 22px; width: 48px; height: 48px; background: ${iconColor}15; color: ${iconColor}; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 10px ${iconColor}20;">
          <i class="fas ${iconClass}" style="pointer-events: none;"></i>
        </div>
        <div style="pointer-events: none; flex: 1; overflow: hidden;">
          <div class="sub-name-label" style="pointer-events: none; font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; margin-bottom: 2px;">${sub.name}</div>
          <div style="pointer-events: none; font-size: 11px; color: var(--text-muted); opacity: 0.7;">${isDir ? 'Folder' : (isAss ? 'Advanced Substation Alpha' : 'SubRip Subtitle')} ${!isDir ? `• ${(sub.size / 1024).toFixed(1)} KB` : ''}</div>
        </div>
        <div class="sub-actions-row" style="display: flex; gap: 8px;">
          <button class="sub-action-btn sub-rename-btn" title="Rename" style="background: rgba(255,255,255,0.05); border: none; color: #fff; opacity: 0.5; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; transition: all 0.2s;"><i class="fas fa-edit"></i></button>
          <button class="sub-action-btn sub-delete-btn" title="Delete" style="background: rgba(255,255,255,0.05); border: none; color: #ff5555; opacity: 0.5; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; transition: all 0.2s;"><i class="fas fa-trash"></i></button>
        </div>
      `;

      item.onclick = (e) => {
        if (e.target.closest('.sub-action-btn')) return;

        const isCheckbox = e.target.closest('.sub-checkbox');
        if (isCheckbox || e.ctrlKey || e.metaKey || subSelectedItems.size > 0) {
          if (subSelectedItems.has(sub.name)) subSelectedItems.delete(sub.name);
          else subSelectedItems.add(sub.name);
          updateSubMultiSelectUI();
          renderSubtitles();
          return;
        }

        if (isDir) {
          subCurrentDir = subCurrentDir ? subCurrentDir + '/' + sub.name : sub.name;
          subSelectedItems.clear();
          updateSubMultiSelectUI();
          renderSubtitles();
        }
      };

      // DRAG AND DROP LOGIC
      if (!isDir) {
        item.draggable = true;
        item.ondragstart = (e) => {
          e.dataTransfer.effectAllowed = 'move';

          let filesToMove = [];
          if (subSelectedItems.has(sub.name)) {
            filesToMove = Array.from(subSelectedItems);
          } else {
            filesToMove = [sub.name];
          }

          const dragData = {
            fileNames: filesToMove,
            fromDir: subCurrentDir || ''
          };

          window.activeDragData = dragData;
          e.dataTransfer.setData('text/plain', JSON.stringify(dragData));

          // Visual feedback for all being dragged
          const sourceCards = document.querySelectorAll('.sub-lib-card');
          sourceCards.forEach(card => {
            const label = card.querySelector('.sub-name-label')?.textContent;
            if (filesToMove.includes(label)) {
              card.style.opacity = '0.4';
              card.style.transform = 'scale(0.95)';
              card.classList.add('dragging-source');
            }
          });
        };
        item.ondragend = () => {
          document.querySelectorAll('.sub-lib-card').forEach(card => {
            card.style.opacity = '1';
            card.style.transform = 'scale(1)';
            card.classList.remove('dragging-source');
          });
          window.activeDragData = null;
        };
      } else {
        // Drop target logic (Folder)
        item.ondragover = (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          item.style.background = 'rgba(79, 70, 229, 0.15)';
          item.style.borderColor = 'var(--accent)';
          item.style.transform = 'scale(1.02)';
          item.style.boxShadow = '0 0 20px rgba(79, 70, 229, 0.4)';
        };
        item.ondragleave = () => {
          item.style.background = isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)';
          item.style.borderColor = isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)';
          item.style.transform = 'scale(1)';
          item.style.boxShadow = 'none';
        };
        item.ondrop = async (e) => {
          e.preventDefault();
          const targetDir = subCurrentDir ? subCurrentDir + '/' + sub.name : sub.name;
          handleSubMoveDrop(targetDir);

          item.style.transform = 'scale(1)';
          item.style.boxShadow = 'none';
          item.style.background = isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.04)';
        };
      }

      // Action Listeners
      item.querySelector('.sub-rename-btn').onclick = (e) => {
        e.stopPropagation();
        const oldName = sub.name;
        showCustomPrompt('Rename Item', oldName, async (newName) => {
          if (newName && newName !== oldName) {
            const res = await window.api.invoke('rename-subtitle-local', {
              profileName: currentProfile?.name || 'Default',
              libraryRoot: appData.libraryFolders?.[0] || '',
              oldName, newName, subDir: subCurrentDir
            });
            if (res.success) { showToast('Renamed'); renderSubtitles(); }
          }
        });
      };

      item.querySelector('.sub-delete-btn').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${sub.name}"?`)) {
          await window.api.invoke('delete-subtitle-local', {
            profileName: currentProfile?.name || 'Default',
            libraryRoot: appData.libraryFolders?.[0] || '',
            fileName: sub.name,
            subDir: subCurrentDir
          });
          renderSubtitles();
        }
      };

      item.onmouseenter = () => { if (!isSelected) item.style.background = 'rgba(255, 255, 255, 0.07)'; };
      item.onmouseleave = () => { if (!isSelected) item.style.background = 'rgba(255, 255, 255, 0.04)'; };


      grid.appendChild(item);
    });
  }

  async function handleSubMoveDrop(toDir) {
    let dragData = window.activeDragData;
    if (!dragData || !dragData.fileNames) return;

    const { fileNames, fromDir } = dragData;
    if (fromDir === toDir) return;

    showToast(`Moving ${fileNames.length} items...`, 1500);
    let successCount = 0;
    for (const fileName of fileNames) {
      const res = await window.api.invoke('move-subtitle-local', {
        profileName: currentProfile?.name || 'Default',
        libraryRoot: appData.libraryFolders?.[0] || '',
        fileName, fromDir, toDir
      });
      if (res.success) successCount++;
    }

    if (successCount > 0) {
      showToast(`Moved ${successCount} items to folder`, 3000);
      subSelectedItems.clear();
      updateSubMultiSelectUI();
      renderSubtitles();
    }
    window.activeDragData = null;
  }

  function renderSubBreadcrumbs() {
    const bc = $('#sub-breadcrumbs');
    if (!bc) return;
    bc.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'breadcrumb-item';
    root.style = 'cursor: pointer; color: var(--accent); font-weight: 600; padding: 4px 8px; border-radius: 6px; transition: 0.2s;';
    root.textContent = 'Library';
    root.onclick = () => { subCurrentDir = ''; subSelectedItems.clear(); renderSubtitles(); };

    // Breadcrumb drop targets
    root.ondragover = (e) => { e.preventDefault(); root.style.background = 'rgba(255,255,255,0.1)'; };
    root.ondragleave = () => { root.style.background = 'transparent'; };
    root.ondrop = (e) => { e.preventDefault(); root.style.background = 'transparent'; handleSubMoveDrop(''); };

    bc.appendChild(root);

    if (subCurrentDir) {
      const parts = subCurrentDir.split(/[\\/]/).filter(p => p.trim());
      let currentPath = '';
      parts.forEach((p, idx) => {
        const sep = document.createElement('span'); sep.textContent = ' / '; bc.appendChild(sep);
        currentPath = currentPath ? currentPath + '/' + p : p;
        const target = currentPath;
        const item = document.createElement('div');
        item.className = 'breadcrumb-item';
        item.style = `cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: 0.2s; ${idx === parts.length - 1 ? 'color: #fff; font-weight: 700;' : ''}`;
        item.textContent = p;
        item.onclick = () => { subCurrentDir = target; subSelectedItems.clear(); renderSubtitles(); };

        item.ondragover = (e) => { e.preventDefault(); item.style.background = 'rgba(255,255,255,0.1)'; };
        item.ondragleave = () => { item.style.background = 'transparent'; };
        item.ondrop = (e) => { e.preventDefault(); item.style.background = 'transparent'; handleSubMoveDrop(target); };

        bc.appendChild(item);
      });
    }
  }

  // ── Subtitle Studio Support ──
  let subSyncOffset = 0;

  // Custom subtitle overlay (draggable) to allow user repositioning of subtitles
  let subtitleOverlay = null;
  let subtitleOverlayPos = null; // { bottomPx }

  function removeSubtitleOverlay() {
    if (window._cleanupActiveSubtitle) {
      try { window._cleanupActiveSubtitle(); } catch (e) {}
      window._cleanupActiveSubtitle = null;
    }
    if (!subtitleOverlay) return;
    try {
      const txt = $('#custom-subtitles-text'); if (txt) txt.innerHTML = '';
      subtitleOverlay.style.display = 'none';
      subtitleOverlay.style.bottom = '60px';
    } catch (e) { /* ignore */ }
  }

  createSubtitleOverlay = function() {
    if (subtitleOverlay) return subtitleOverlay;
    const wrapper = $('#player-wrapper');
    if (!wrapper) return null;

    const ov = document.createElement('div');
    ov.id = 'custom-subtitles-overlay';
    ov.style.cssText = 'position:absolute; left:0; right:0; bottom:60px; z-index:60; display:' + (document.body.classList.contains('playing-mode') ? 'flex' : 'none') + '; justify-content:center; pointer-events:auto; transition: bottom 0.3s ease;';

    const text = document.createElement('div');
    text.id = 'custom-subtitles-text';
    text.style.cssText = 'background:rgba(0,0,0,0.55); color:#fff; padding:8px 18px; border-radius:10px; max-width:86%; text-align:center; font-size:22px; line-height:1.35; user-select:none; pointer-events:none; unicode-bidi:plaintext; direction:rtl;';
    ov.appendChild(text);

    wrapper.appendChild(ov);
    subtitleOverlay = ov;

    const bodyObs = new MutationObserver(() => {
      const show = document.body.classList.contains('playing-mode');
      ov.style.display = show ? 'flex' : 'none';
    });
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    const CONTROLS_HEIGHT = 160;
    const DEFAULT_BOTTOM = 60;
    const uiObs = new MutationObserver(() => {
      const controlsVisible = wrapper.classList.contains('ui-visible');
      ov.style.bottom = controlsVisible ? CONTROLS_HEIGHT + 'px' : DEFAULT_BOTTOM + 'px';
    });
    uiObs.observe(wrapper, { attributes: true, attributeFilter: ['class'] });

    if (typeof applySubtitleStyles === 'function') {
      applySubtitleStyles();
    } else if (typeof window.applySubtitleStyles === 'function') {
      window.applySubtitleStyles();
    }

    return ov;
  };

  attachTrackToOverlay = function(track) {
    if (!track) return;
    try { track.mode = 'showing'; } catch (e) { }
    const ov = createSubtitleOverlay();
    if (!ov) return;
    const textEl = $('#custom-subtitles-text');

    if (window._cleanupActiveSubtitle) {
      try { window._cleanupActiveSubtitle(); } catch (e) {}
      window._cleanupActiveSubtitle = null;
    }

    const update = () => {
      if (!video) return;
      const targetTime = video.currentTime + (typeof subSyncOffset === 'number' ? subSyncOffset : 0);
      const cues = track.cues;
      let activeText = '';
      if (cues && cues.length > 0) {
        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i];
          if (cue.startTime <= targetTime && cue.endTime >= targetTime) {
            activeText = cue.text || '';
            break;
          }
        }
      } else {
        const activeCues = track.activeCues || [];
        if (activeCues && activeCues.length > 0) {
          activeText = activeCues[0].text || '';
        }
      }

      if (activeText.trim()) {
        textEl.innerHTML = activeText.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        textEl.style.display = 'inline-block';
      } else {
        textEl.innerHTML = '';
        textEl.style.display = 'none';
      }
    };

    track.addEventListener('cuechange', update);
    video.addEventListener('timeupdate', update);

    window._cleanupActiveSubtitle = () => {
      try { track.removeEventListener('cuechange', update); } catch (e) {}
      try { video.removeEventListener('timeupdate', update); } catch (e) {}
    };

    update();
  };

  loadSubtitleLocal = async function(fp) {
    if (!fp) return;
    try {
      window.activeSubtitlePath = fp;
      if (typeof renderPlayerSubLibrary === 'function') renderPlayerSubLibrary();

      const ext = fp.toLowerCase().split('.').pop();

      // ── ASS / SSA: Use libass-wasm (SubtitlesOctopus) for full VLC-like rendering ──
      if (ext === 'ass' || ext === 'ssa') {
        showToast('Loading ASS subtitle (full rendering)...');
        const content = await window.api.invoke('read-subtitle-file', fp);
        if (!content) throw new Error('Failed to read ASS file');

        // Detect encoding — Windows-1256 fallback for Arabic .ass files
        let finalContent = content;
        if (content.includes('\uFFFD')) {
          const enc = new TextEncoder();
          const bytes = enc.encode(content);
          finalContent = new TextDecoder('windows-1256').decode(bytes);
        }

        // Create blob URL from raw .ass content (NOT converted to VTT)
        const blob = new Blob([finalContent], { type: 'text/plain' });
        const assUrl = URL.createObjectURL(blob);

        // Destroy old instance, remove any old HTML5 <track> elements
        if (window.AssSubtitleEngine) window.AssSubtitleEngine.destroy();
        video.querySelectorAll('track').forEach(t => { try { if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); } catch (_) {} });
        if (video.textTracks) for (let i = 0; i < video.textTracks.length; i++) { try { video.textTracks[i].mode = 'disabled'; } catch (_) {} }

        // Attach SubtitlesOctopus
        const instance = await (window.AssSubtitleEngine && window.AssSubtitleEngine.attach(video, assUrl));
        if (!instance) {
          // Fallback: plain VTT (loses all styling)
          console.warn('[ASS] libass-wasm unavailable, falling back to stripped VTT...');
          const vttContent = assToVtt(finalContent);
          const vttBlob = new Blob([vttContent], { type: 'text/vtt' });
          const vttUrl = URL.createObjectURL(vttBlob);
          URL.revokeObjectURL(assUrl);
          const track = document.createElement('track');
          track.kind = 'subtitles'; track.label = 'ASS Subtitle'; track.srclang = 'und';
          track.src = vttUrl; track.default = true;
          video.appendChild(track);
          setTimeout(() => { if (video.textTracks.length > 0) { const t = video.textTracks[video.textTracks.length - 1]; try { t.mode = 'showing'; } catch (e) {} if (typeof attachTrackToOverlay === 'function') attachTrackToOverlay(t); } }, 150);
          showToast('⚠️ ASS rendered in basic mode (no effects)');
        } else {
          showToast('✅ ASS subtitle loaded with full effects!');
        }

        subtitlesEnabled = true;
        $('#btn-subtitle').classList.remove('subtitle-off');
        $('#btn-subtitle').classList.add('subtitle-on');
        subSyncOffset = 0;
        updateSubSyncDisplay();
        return;
      }

      // ── SRT / VTT / other: Standard HTML5 track path ──
      showToast('Loading local subtitle...');
      const content = await window.api.invoke('read-subtitle-file', fp);
      if (!content) throw new Error('Failed to read file');

      // Destroy any active ASS instance if switching to non-ASS
      if (window.AssSubtitleEngine) window.AssSubtitleEngine.destroy();

      let processedContent = (ext === 'srt') ? srtToVtt(content) : content;
      if (!processedContent.startsWith('WEBVTT')) processedContent = 'WEBVTT\n\n' + processedContent;

      const blob = new Blob([processedContent], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);

      video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Local Subtitle';
      track.srclang = 'und';
      track.src = url;
      track.default = true;
      video.appendChild(track);

      subtitlesEnabled = true;
      $('#btn-subtitle').classList.remove('subtitle-off');
      $('#btn-subtitle').classList.add('subtitle-on');
      subSyncOffset = 0;
      updateSubSyncDisplay();

      setTimeout(() => {
        if (video.textTracks.length > 0) {
          const t = video.textTracks[video.textTracks.length - 1];
          try { t.mode = 'showing'; } catch (e) { }
          subtitleTrack = t;
          if (typeof applySubtitleStyles === 'function') {
            applySubtitleStyles();
          } else if (typeof window.applySubtitleStyles === 'function') {
            window.applySubtitleStyles();
          }
          attachTrackToOverlay(t);
        }
      }, 150);

      showToast('Subtitle applied!');
    } catch (err) {
      console.error('[LOAD-SUB] Error:', err);
      showToast('Failed to load subtitle');
    }
  };

  loadSubtitleFromUrl = async function(url, label = 'Online Subtitle') {
    if (!url) return;
    try {
      showToast('Downloading subtitle...');
      
      let finalUrl = url;
      let isZip = url.toLowerCase().includes('.zip') || url.toLowerCase().includes('subdl');
      
      if (isZip) {
        console.log('[Subtitles] Loading ZIP subtitle from URL:', url);
        const result = await window.api.invoke('fetch-zip-subtitle', url);
        if (!result || !result.content) {
          throw new Error('Failed to fetch/extract ZIP subtitle');
        }
        
        const decodedBytes = Uint8Array.from(atob(result.content), c => c.charCodeAt(0));
        let content = new TextDecoder('utf-8').decode(decodedBytes);
        if (content.includes('\uFFFD')) {
          content = new TextDecoder('windows-1256').decode(decodedBytes);
        }
        
        let processedContent = content;
        const filename = result.filename || '';
        const ext = filename.toLowerCase().split('.').pop();
        
        if (ext === 'ass' || ext === 'ssa') {
          // ASS/SSA from ZIP: Use libass-wasm, NOT VTT conversion
          let finalContent = content;
          if (content.includes('\uFFFD')) {
            const bytes = new TextEncoder().encode(content);
            finalContent = new TextDecoder('windows-1256').decode(bytes);
          }
          const assBlob = new Blob([finalContent], { type: 'text/plain' });
          const assUrl = URL.createObjectURL(assBlob);
          if (window.AssSubtitleEngine) window.AssSubtitleEngine.destroy();
          video.querySelectorAll('track').forEach(t => { try { if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); } catch (_) {} });
          const inst = await (window.AssSubtitleEngine && window.AssSubtitleEngine.attach(video, assUrl));
          if (!inst) {
            const vttContent = assToVtt(finalContent);
            const vttBlob = new Blob([vttContent], { type: 'text/vtt' });
            finalUrl = URL.createObjectURL(vttBlob);
            URL.revokeObjectURL(assUrl);
          } else {
            subtitlesEnabled = true;
            $('#btn-subtitle').classList.remove('subtitle-off');
            $('#btn-subtitle').classList.add('subtitle-on');
            showToast('✅ ASS subtitle loaded with full effects!');
            return { success: true };
          }
        } else if (ext === 'srt') {
          processedContent = srtToVtt(content);
        }

        const blob = new Blob([processedContent || content], { type: 'text/vtt' });
        finalUrl = URL.createObjectURL(blob);
        label = filename || label;
      } else {
        console.log('[Subtitles] Loading direct subtitle from URL:', url);
        const ext = url.toLowerCase().split('?')[0].split('.').pop();
        if (ext === 'ass' || ext === 'ssa') {
          // ASS/SSA from URL: Use libass-wasm directly (pass URL, no fetch needed)
          if (window.AssSubtitleEngine) window.AssSubtitleEngine.destroy();
          video.querySelectorAll('track').forEach(t => { try { if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); } catch (_) {} });
          const inst = await (window.AssSubtitleEngine && window.AssSubtitleEngine.attach(video, url));
          if (inst) {
            subtitlesEnabled = true;
            $('#btn-subtitle').classList.remove('subtitle-off');
            $('#btn-subtitle').classList.add('subtitle-on');
            showToast('✅ ASS subtitle loaded with full effects!');
            return { success: true };
          }
          // If libass unavailable, fall through to VTT conversion below
          const response2 = await fetch(url);
          const buf2 = await response2.arrayBuffer();
          const bytes2 = new Uint8Array(buf2);
          let content2 = new TextDecoder('utf-8').decode(bytes2);
          if (content2.includes('\uFFFD')) content2 = new TextDecoder('windows-1256').decode(bytes2);
          const vtt2 = assToVtt(content2);
          const vblob2 = new Blob([vtt2], { type: 'text/vtt' });
          finalUrl = URL.createObjectURL(vblob2);
        } else if (ext === 'srt') {
          const response = await fetch(url);
          const buf = await response.arrayBuffer();
          const decodedBytes = new Uint8Array(buf);
          let content = new TextDecoder('utf-8').decode(decodedBytes);
          if (content.includes('\uFFFD')) content = new TextDecoder('windows-1256').decode(decodedBytes);
          const vtt = srtToVtt(content);
          const vblob = new Blob([vtt], { type: 'text/vtt' });
          finalUrl = URL.createObjectURL(vblob);
        }
      }
      
      video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = label;
      track.srclang = 'und';
      track.src = finalUrl;
      track.default = true;
      video.appendChild(track);

      subtitlesEnabled = true;
      $('#btn-subtitle').classList.remove('subtitle-off');
      $('#btn-subtitle').classList.add('subtitle-on');
      subSyncOffset = 0;
      updateSubSyncDisplay();

      setTimeout(() => {
        if (video.textTracks.length > 0) {
          const t = video.textTracks[video.textTracks.length - 1];
          try { t.mode = 'showing'; } catch (e) { }
          subtitleTrack = t;
          if (typeof applySubtitleStyles === 'function') {
            applySubtitleStyles();
          } else if (typeof window.applySubtitleStyles === 'function') {
            window.applySubtitleStyles();
          }
          attachTrackToOverlay(t);
        }
      }, 150);

      showToast('Subtitle applied!');
      return { success: true };
    } catch (err) {
      console.error('[LOAD-SUB-URL] Error:', err);
      showToast('Failed to load subtitle');
      throw err;
    }
  };

  // Assign functions to globals
  window.createSubtitleOverlay = createSubtitleOverlay;
  window.attachTrackToOverlay = attachTrackToOverlay;
  window.removeSubtitleOverlay = removeSubtitleOverlay;
  window.loadSubtitleLocal = loadSubtitleLocal;
  window.loadSubtitleFromUrl = loadSubtitleFromUrl;


  window.loadExternalSubtitle = async (url, label = 'External Subtitle', srclang = 'und') => {
    try {
      console.log('[Subtitles] Dynamically loading external subtitle track:', url);
      
      let finalUrl = url;
      
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('blob:')) {
        return await loadSubtitleLocal(url);
      }
      
      if (url.endsWith('.srt')) {
        showToast('Fetching and converting SRT subtitle...');
        const response = await fetch(url);
        const content = await response.text();
        const processedContent = srtToVtt(content);
        const blob = new Blob([processedContent], { type: 'text/vtt' });
        finalUrl = URL.createObjectURL(blob);
      }

      video.querySelectorAll('track').forEach(t => { if (t.src && t.src.startsWith('blob:')) { try { URL.revokeObjectURL(t.src); } catch (_) {} } t.remove(); });
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = label;
      track.srclang = srclang;
      track.src = finalUrl;
      track.default = true;
      video.appendChild(track);

      subtitlesEnabled = true;
      $('#btn-subtitle').classList.remove('subtitle-off');
      $('#btn-subtitle').classList.add('subtitle-on');

      setTimeout(() => {
        if (video.textTracks.length > 0) {
          const t = video.textTracks[video.textTracks.length - 1];
          try { t.mode = 'showing'; } catch (e) { }
          subtitleTrack = t;
          applySubtitleStyles();
          attachTrackToOverlay(t);
        }
      }, 150);

      showToast(`Subtitle "${label}" applied!`);
      return { success: true };
    } catch (err) {
      console.error('[Subtitles] Failed to load external subtitle:', err);
      showToast('Failed to load subtitle');
      return { success: false, error: err.message };
    }
  };

  function updateSubSyncDisplay() {
    const el = $('#sub-sync-val');
    if (el) el.textContent = `${subSyncOffset > 0 ? '+' : ''}${subSyncOffset.toFixed(1)}s`;
  }

  window.adjustSubSync = (delta) => {
    subSyncOffset += delta;
    updateSubSyncDisplay();
    const videoEl = document.querySelector('video');
    if (videoEl) {
      videoEl.dispatchEvent(new Event('timeupdate'));
    }
  };


  // ── Music Player ──
  async function renderMusic() {
    const grid = $('#music-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const music = (appData.music || []);
    const empty = $('#music-empty');
    const q = ($('#music-search-input')?.value || $('#search-music')?.value || '').trim();

    const filtered = q ? music.filter(m =>
      !isLocked(m.id) && (
        (m.title || '').toLowerCase().includes(q.toLowerCase()) ||
        (m.artist || '').toLowerCase().includes(q.toLowerCase())
      )
    ) : music.filter(m => !isLocked(m.id));

    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card music-card fade-in';

      const { title, artist, cover } = getMusicMeta(item);
      const meta = `${artist}`;

      card.innerHTML = `
        <div class="card-poster">
          ${cover ? `<img src="${localImg(cover)}" class="card-img" style="aspect-ratio:1/1;object-fit:cover">` : `<div class="card-poster-placeholder music-placeholder"><div class="ph-icon">${SVG_MUSIC}</div></div>`}
          <div class="card-play-overlay">
             <div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="card-meta">${escapeHTML(meta)}</div>
        </div>
      `;
      card.onclick = () => playMusic(item);
      card.oncontextmenu = e => {
        window.openContextMenuForItem({ ...item, type: 'music', isMusic: true }, e);
      };
      grid.appendChild(card);
    });


    if (empty) {
      empty.style.display = grid.children.length ? 'none' : 'flex';
    }
    updateBadges();
  }

  $('#music-btn-next').onclick = playNextMusic;
  $('#music-btn-prev').onclick = playPrevMusic;
  $('#music-btn-eq')?.addEventListener('click', () => {
    $('#player-eq-panel').classList.toggle('open');
  });

  // Music Volume Logic
  $('#music-volume-bar')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    engine.setVolume(val);
    if ($('#volume-bar')) $('#volume-bar').value = val;
    updateMusicVolIcon(val / 100);
  });

  $('#music-btn-mute')?.addEventListener('click', () => {
    const isMuted = !engine._muted;
    engine.setMuted(isMuted);
    updateMusicVolIcon(isMuted ? 0 : (engine._volume / 100 || 1));
  });

  function updateMusicVolIcon(vol) {
    const isMuted = vol === 0 || video.muted;
    $('#music-icon-vol').style.display = isMuted ? 'none' : 'block';
    $('#music-icon-mute').style.display = isMuted ? 'block' : 'none';
  }

  $('#ctx-delete-music').onclick = async () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget) return;
    if (confirm(`Delete track "${contextTarget.filename}" forever?`)) {
      const ok = await window.api.invoke('delete-file', contextTarget.path);
      if (ok) {
        showToast('Deleted');
        appData.music = appData.music.filter(m => m.id !== contextTarget.id);
        persist();
        renderMusic();
      }
    }
  };

  $('#music-search-input')?.addEventListener('input', () => renderMusic());
  $('#btn-music-select-folder')?.addEventListener('click', async () => {
    const f = await window.api.selectFolder();
    if (f && !appData.libraryFolders.includes(f)) {
      appData.libraryFolders.push(f);
      appData.libraryPath = f;
      persist();
      renderSidebar();
      await scanLibrary();
    }
  });

  // ── Watchlist ──
  function renderWatchlist() {
    const grid = $('#watchlist-grid');
    const watchedGrid = $('#watched-grid');
    const liveGrid = $('#watchlist-live-grid');
    const watchedTitle = $('#watched-title');
    const watchlistTitle = $('#watchlist-title');
    const liveTitle = $('#watchlist-live-title');
    const empty = $('#watchlist-empty');
    if (!grid || !currentProfile) return;
    grid.innerHTML = '';
    if (watchedGrid) watchedGrid.innerHTML = '';
    if (liveGrid) liveGrid.innerHTML = '';

    let watchlist = (currentProfile?.watchlist || []).filter(i => !isLocked(i.id)).filter(isAgeAllowed);

    const q = ($('#search-watchlist')?.value || '').toLowerCase();
    if (q) {
      watchlist = watchlist.filter(i =>
        (i.title || i.name || i.original_title || '').toLowerCase().includes(q)
      );
    }

    // Split into live, pending, and watched
    const liveItems = [];
    const pending = [];
    const watched = [];

    watchlist.forEach(item => {
      const isLive = item.type === 'radio' || item.type === 'iptv' || item.media_type === 'radio' || item.media_type === 'iptv' || !!item.radioUrl || !!item.streamUrl;
      if (isLive) {
        liveItems.push(item);
      } else {
        const pb = currentProfile.playback?.[getPlaybackKey(item)];
        if (pb?.watched) watched.push(item);
        else pending.push(item);
      }
    });

    if (watchlist.length === 0) {
      empty.style.display = 'flex';
      if (liveTitle) liveTitle.style.display = 'none';
      if (watchedTitle) watchedTitle.style.display = 'none';
      if (watchlistTitle) watchlistTitle.style.display = 'none';
    } else {
      empty.style.display = 'none';

      const renderItem = (item, targetGrid) => {
        const card = createMediaCard(item);
        if (targetGrid) targetGrid.appendChild(card);
      };

      if (liveItems.length > 0) {
        if (liveTitle) liveTitle.style.display = 'flex';
        liveItems.forEach(item => renderItem(item, liveGrid));
      } else {
        if (liveTitle) liveTitle.style.display = 'none';
      }

      if (pending.length > 0) {
        if (watchlistTitle) watchlistTitle.style.display = 'flex';
        pending.forEach(item => renderItem(item, grid));
      } else {
        if (watchlistTitle) watchlistTitle.style.display = 'none';
      }

      if (watched.length > 0) {
        if (watchedTitle) watchedTitle.style.display = 'flex';
        watched.forEach(item => renderItem(item, watchedGrid));
      } else {
        if (watchedTitle) watchedTitle.style.display = 'none';
      }
    }

    // Dynamic Personalized Recommendations Row
    const recTitle = $('#recommendations-title');
    const recHeading = $('#recommendations-heading');
    const recGrid = $('#recommendations-grid');

    if (q) {
      if (recTitle) recTitle.style.display = 'none';
      if (recGrid) recGrid.style.display = 'none';
    } else if (recTitle && recGrid) {
      if (!watchlist || watchlist.length === 0) {
        recTitle.style.display = 'none';
        recGrid.style.display = 'none';
      } else {
        window.RecommendationService.generatePersonalizedRecommendations(watchlist).then(({ recommendations, seedTitle, isRecent }) => {
          if (recommendations && recommendations.length > 0) {
            recGrid.innerHTML = '';
            recommendations.forEach(item => {
              const card = createMediaCard(item);
              recGrid.appendChild(card);
            });
            if (recHeading) {
              recHeading.textContent = isRecent 
                ? `Because you recently added "${seedTitle}"...` 
                : `Because you like "${seedTitle}"...`;
            }
            recTitle.style.display = 'flex';
            recGrid.style.display = 'flex';
          } else {
            recTitle.style.display = 'none';
            recGrid.style.display = 'none';
          }
        }).catch(err => {
          console.error('[RECOMMENDATIONS] Render failed', err);
          recTitle.style.display = 'none';
          recGrid.style.display = 'none';
        });
      }
    }
    if (typeof renderLibCustomLists === 'function') {
      renderLibCustomLists();
    }
  }

  function getTmdbIdStr(i) {
    if (!i) return null;
    let tid = i.tmdbId || i.tmdb_id;
    if (i.id && String(i.id).startsWith('tmdb:')) tid = String(i.id).replace('tmdb:', '');
    if (i.id && String(i.id).startsWith('kitsu:')) tid = null; // Do not mix up kitus IDs
    return tid ? String(tid) : null;
  }

  function isSameItem(a, b) {
    if (!a || !b) return false;
    const idA = (typeof a === 'object' && a !== null) ? String(a.id) : String(a);
    const idB = (typeof b === 'object' && b !== null) ? String(b.id) : String(b);
    if (idA === idB) return true;
    const tA = (typeof a === 'object' && a !== null) ? getTmdbIdStr(a) : null;
    const tB = (typeof b === 'object' && b !== null) ? getTmdbIdStr(b) : null;
    if (tA && tB && tA === tB) return true;
    // For local files
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.path && b.path && a.path === b.path) return true;
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.radioUrl && b.radioUrl && a.radioUrl === b.radioUrl) return true;
    return false;
  }

  function toggleWatchlist(item) {
    if (!currentProfile) return;
    if (!item.id) {
      item.id = item.radioUrl || item.streamUrl || item.url || item.path || ('wl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
    }
    const index = currentProfile.watchlist.findIndex(i => isSameItem(i, item));
    const isAdding = index === -1;
    if (isAdding) {
      item.listedAt = Date.now();
      currentProfile.watchlist.unshift(item);
      showToast('Added to My List');
      
      const posterUrl = item.poster || item.poster_path;
      if (posterUrl && posterUrl.startsWith('http')) {
        window.api.invoke('download-image', posterUrl, item.id).then(localPath => {
          if (localPath && localPath !== posterUrl) {
            item.poster = localPath;
            persist(true);
            if (currentView === 'watchlist') renderWatchlist();
          }
        }).catch(() => null);
      }
    } else {
      currentProfile.watchlist.splice(index, 1);
      showToast('Removed from My List');
    }

    // Sort watchlist descending (newest first)
    currentProfile.watchlist.forEach((wlItem, wlIdx) => {
      if (!wlItem.listedAt) wlItem.listedAt = Date.now() - wlIdx * 1000;
    });
    currentProfile.watchlist.sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0));

    persist(true);
    updateWatchlistButton(item);
    if (currentView === 'watchlist') renderWatchlist();

    // Trakt Sync
    window.api.invoke('trakt-connection-status').then(creds => {
      if (creds && creds.connected) {
        const cache = (appData.tmdbCache || {})[item.id] || {};
        const imdbId = item.imdb_id || item.imdbId || cache.imdb_id || cache.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
        if (imdbId && imdbId.startsWith('tt')) {
          window.api.invoke('trakt-toggle-watchlist', {
            action: isAdding ? 'add' : 'remove',
            item: {
              type: item.type === 'series' || item.type === 'tv' ? 'show' : 'movie',
              imdbId: imdbId
            }
          }).catch(err => console.error('[Trakt Watchlist] Toggle failed:', err.message));
        }
      }
    });
  }

  function updateWatchlistButton(item) {
    const btn = $('#btn-toggle-watchlist');
    if (!btn || !currentProfile) return;
    const inWatchlist = currentProfile.watchlist.some(i => isSameItem(i, item));
    if (inWatchlist) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> In My List';
      btn.className = 'btn-slate watchlist-active';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> My List';
      btn.className = 'btn-slate';
    }
  }
  // Global Search Input
  const globalSearch = $('#search-discover-global');
  if (globalSearch) {
    globalSearch.addEventListener('input', (e) => {
      const q = e.target.value;
      const discoverSearch = $('#search-discover');
      if (discoverSearch) {
        discoverSearch.value = q;
        switchView('discover');
        performDiscoverSearch();
      }
    });
  }

  // Watchlist Search Input
  const watchlistSearch = $('#search-watchlist');
  if (watchlistSearch) {
    watchlistSearch.addEventListener('input', () => {
      renderWatchlist();
    });
  }

  setInterval(() => {
    const rb = $('#btn-rescan');
    if (rb && rb.disabled) rb.disabled = false;
  }, 2000);

  // Sync custom lists and invitations automatically every 15 seconds
  setInterval(() => {
    if (appData.authenticated && currentProfile) {
      if (typeof loadAndRenderInvitations === 'function') {
        loadAndRenderInvitations();
      }
      if (typeof refreshCustomListsFromDb === 'function' && (currentView === 'watchlist' || currentView === 'library' || currentView === 'custom-list-detail')) {
        refreshCustomListsFromDb().catch(e => console.warn('[Collab] Failed to sync custom lists:', e.message));
      }
    }
  }, 15000);

  // ── Auto-Updater Logic ──
  function isNewerVersion(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
      const lv = l[i] || 0;
      const cv = c[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }

  async function checkMobileUpdate(isManual = false) {
    if (window.api?.isElectron) return;
    console.log('[MOBILE-UPDATER] Checking GitHub for updates...');
    try {
      const response = await fetch('https://api.github.com/repos/amromotaw3/MediaVault-Landing/releases/latest');
      if (!response.ok) throw new Error('GitHub API unreachable');
      const data = await response.json();
      const latestVersion = data.tag_name.replace('v', '');

      if (isNewerVersion(latestVersion, APP_VERSION)) {
        console.log('[MOBILE-UPDATER] Update found:', latestVersion);
        handleUpdateStatus({
          status: 'available',
          version: latestVersion,
          msg: `New APK Available: v${latestVersion}`,
          downloadUrl: data.assets.find(a => a.name.endsWith('.apk'))?.browser_download_url || data.html_url
        });
      } else if (isManual) {
        showToast('MEEM is up to date!');
      }
    } catch (err) {
      console.warn('[MOBILE-UPDATER] Check failed:', err.message);
      if (isManual) showToast('Update check failed. Check your connection.');
    }
  }

  function handleUpdateStatus(data) {
    const toast = $('#update-toast');
    const toastTitle = $('#update-toast-title');
    const toastDesc = $('#update-toast-desc');
    const toastAction = $('#update-btn-action');
    
    // Settings UI Elements
    const statusDetail = $('#update-status-detail');
    const checkBtn = $('#btn-check-updates');
    const doUpdateBtn = $('#btn-do-update');
    const progressRow = $('#settings-update-progress');
    const progressFill = $('#settings-update-bar');
    const percentText = $('#settings-update-percent');

    if (statusDetail) {
      statusDetail.style.display = 'block';
      statusDetail.textContent = data.msg;
    }

    switch (data.status) {
      case 'available':
        if (checkBtn) checkBtn.style.display = 'none';
        if (doUpdateBtn) {
          doUpdateBtn.style.display = 'block';
          doUpdateBtn.textContent = 'Download Update';
          doUpdateBtn.onclick = () => {
            if (window.api?.isElectron) {
              window.api.invoke('start-update-download');
              doUpdateBtn.disabled = true;
              doUpdateBtn.textContent = 'Preparing...';
            } else {
              doUpdateBtn.disabled = true;
              doUpdateBtn.textContent = 'Downloading...';
              const apkName = `MediaVault_v${data.version}.apk`;
              window.api.downloadFile(data.downloadUrl || 'https://github.com/amromotaw3/MediaVault-Landing/releases', apkName);
            }
          };
        }
        
        // Show Toast if we are not already on the settings page looking at it
        if (!document.getElementById('view-settings').classList.contains('active')) {
          if (toast && toastTitle && toastDesc) {
             toastTitle.textContent = 'Update Available!';
             toastDesc.textContent = `Version v${data.version} is ready to download.`;
             if (toastAction) {
               toastAction.style.display = 'block';
               toastAction.textContent = 'View';
               toastAction.onclick = () => {
                 showView('settings');
                 hideUpdateToast();
               };
             }
             toast.classList.add('active');
          }
        }
        break;

      case 'downloading':
        if (doUpdateBtn) doUpdateBtn.style.display = 'none';
        if (checkBtn) checkBtn.style.display = 'none';
        if (progressRow) progressRow.style.display = 'block';
        if (progressFill) progressFill.style.width = `${data.percent}%`;
        if (percentText) percentText.textContent = `${Math.round(data.percent)}%`;
        if (statusDetail) statusDetail.textContent = `Downloading... ${data.speed || '0'} MB/s`;
        break;

      case 'ready':
        if (progressRow) progressRow.style.display = 'none';
        if (doUpdateBtn) {
          doUpdateBtn.style.display = 'block';
          doUpdateBtn.disabled = false;
          doUpdateBtn.textContent = (window.api?.isElectron) ? 'Restart & Install' : 'Install APK';
          doUpdateBtn.onclick = () => {
            if (window.api?.isElectron) {
              window.api.invoke('restart-app-and-install');
            } else {
              if (appData.lastDownloadedApkPath) {
                window.api.openFile(appData.lastDownloadedApkPath);
              } else {
                showToast('Please check your downloads folder for the APK.');
              }
            }
          };
        }
        if (statusDetail) statusDetail.textContent = 'Update Downloaded. Ready to install.';
        
        // Auto-install logic - if PC, just invoke restart automatically or notify User.
        // User asked: "وبعد ما اخلص يفتح النسخه الجديده علطول !" (After it finishes, open the new version immediately)
        if (window.api?.isElectron) {
          showToast("Update ready. Restarting in 3 seconds...");
          setTimeout(() => {
             window.api.invoke('restart-app-and-install');
          }, 3000);
        } else {
           // For mobile, prompt user to install
           if (toast && toastTitle && toastDesc) {
             toastTitle.textContent = 'Download Complete';
             toastDesc.textContent = 'Tap to install the new APK.';
             if (toastAction) {
               toastAction.style.display = 'block';
               toastAction.textContent = 'Install';
               toastAction.onclick = () => {
                 if (appData.lastDownloadedApkPath) {
                    window.api.openFile(appData.lastDownloadedApkPath);
                 }
                 hideUpdateToast();
               };
             }
             toast.classList.add('active');
          }
        }
        break;

      case 'error':
        if (doUpdateBtn) doUpdateBtn.style.display = 'none';
        if (checkBtn) {
           checkBtn.style.display = 'block';
           checkBtn.disabled = false;
           checkBtn.textContent = 'Retry';
        }
        if (progressRow) progressRow.style.display = 'none';
        showToast(data.msg || 'Update failed');
        break;

      case 'none':
        if (checkBtn) {
           checkBtn.style.display = 'block';
           checkBtn.disabled = false;
           checkBtn.textContent = 'Check Now';
        }
        if (doUpdateBtn) doUpdateBtn.style.display = 'none';
        if (progressRow) progressRow.style.display = 'none';
        if (statusDetail) {
          statusDetail.textContent = 'MEEM is up to date.';
          setTimeout(() => { if (statusDetail.textContent === 'MEEM is up to date.') statusDetail.style.display = 'none'; }, 5000);
        }
        break;
    }
  }

  if (window.api?.isElectron) {
    window.api.on('update-status', (data) => handleUpdateStatus(data));
  }

  const btnCheck = $('#btn-check-updates');
  if (btnCheck) {
    btnCheck.onclick = async () => {
      const detail = $('#update-status-detail');
      if (detail) {
        detail.style.display = 'block';
        detail.textContent = 'Checking for updates...';
      }
      if (window.api?.isElectron) {
        btnCheck.disabled = true;
        btnCheck.textContent = 'Checking...';
        try {
          const res = await window.api.invoke('check-for-updates');
          if (!res.success) {
            showToast('Update check failed: ' + res.error);
            // Offer manual fallback link in modal
            handleUpdateStatus({ status: 'error', msg: 'Update check failed. Open releases page to download manually.' });
          } else {
            // If result contains no update, the main process will emit 'update-status' event.
            // If in development environment, present a helpful hint with manual link.
            if (!res.result || !res.result.updateInfo) {
              // Leave it to update-status event, but restore button after short timeout
              setTimeout(() => { btnCheck.disabled = false; btnCheck.textContent = 'Check'; }, 3000);
            } else {
              btnCheck.disabled = false;
              btnCheck.textContent = 'Check';
            }
          }
        } catch (e) {
          showToast('Update check failed: ' + e.message);
          handleUpdateStatus({ status: 'error', msg: 'Update check failed. Open releases page to download manually.' });
          btnCheck.disabled = false;
          btnCheck.textContent = 'Check';
        }
      } else {
        await checkMobileUpdate(true);
      }
    };
  }

  const toggleCheck = $('#update-auto-check');
  if (toggleCheck) {
    toggleCheck.onchange = (e) => {
      appData.autoUpdate = e.target.checked;
      persist();
    };
  }

  // Initial Auto-Check
  setTimeout(() => {
    if (appData.autoUpdate !== false) {
      if (window.api?.isElectron) {
        window.api.invoke('check-for-updates');
      } else {
        checkMobileUpdate();
      }
    }
  }, 10000); // 10s wait for app to settle

  window.api.invoke('get-app-version').then(v => {
    const label = $('#app-version-label');
    if (label) label.textContent = `v${v}`;
  });







  // ── Discover Search Listener ──
  let discoverSearchTimer = null;
  // ── Discover Search Listener ──
  const searchInput = document.querySelector('#search-discover');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value;
        if (val) {
          const mainSearchInput = $('#search-input-main');
          if (mainSearchInput) {
            mainSearchInput.value = val;
          }
          searchInput.value = ''; // Clean up discover's input so Discover isn't cluttered
          switchView('search');
          performUnifiedSearch(val);
          if (mainSearchInput) mainSearchInput.focus();
        }
      }
    });
  }

  // ── Main Search View Setup & Event Listeners ──
  const mainSearchInput = $('#search-input-main');
  if (mainSearchInput) {
    mainSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        performUnifiedSearch(mainSearchInput.value);
      }
    });
  }

  // ── Cinematic Search View Functions ──
  async function renderEmptySearchState() {
    const grid = $('#search-results-grid');
    if (!grid) return;

    const addons = appData.installedAddons || [];
    const hasMediaAddon = addons.some(a => {
      const u = (a.url || a.manifestUrl || '').toLowerCase();
      const id = (a.id || '').toLowerCase();
      const n = (a.name || '').toLowerCase();
      return u.includes('cinemeta') || u.includes('tmdb') || id.includes('cinemeta') || id.includes('tmdb') || n.includes('cinemeta') || n.includes('tmdb');
    });

    if (!hasMediaAddon) {
      grid.innerHTML = `
        <div class="empty-media-source-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 70px 24px; text-align:center; min-height: 60vh; background: radial-gradient(circle at center, rgba(99, 102, 241, 0.08) 0%, rgba(18, 20, 29, 0) 70%); border-radius: 24px; margin: 20px 0; border: 1px dashed rgba(255, 255, 255, 0.08); grid-column: 1 / -1;">
          <div style="width: 84px; height: 84px; border-radius: 24px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2)); border: 1px solid rgba(255, 255, 255, 0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 24px; box-shadow: 0 15px 35px rgba(99, 102, 241, 0.25); backdrop-filter: blur(10px);">
            <i class="fas fa-cubes" style="font-size: 36px; color: #a855f7;"></i>
          </div>
          <h2 style="font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 12px; letter-spacing: -0.5px; font-family: var(--font);">No Search Provider Available</h2>
          <p style="font-size: 14px; color: rgba(255,255,255,0.65); max-width: 480px; line-height: 1.6; margin-bottom: 30px;">
            You don't have any search catalog addons installed yet. Visit the Addons Store to enable Cinemeta, TMDB, or custom search addons.
          </p>
          <button class="btn btn-primary" onclick="switchView('addons')" style="padding: 12px 28px; font-weight: 700; border-radius: 14px; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; background: linear-gradient(135deg, var(--accent), #8b5cf6); color: #fff; border: none; box-shadow: 0 10px 25px rgba(99, 102, 241, 0.35); transition: transform 0.2s ease, box-shadow 0.2s ease;">
            <i class="fas fa-store" style="font-size: 15px;"></i>
            <span>Open Addons Store</span>
          </button>
        </div>
      `;
      return;
    }

    const history = appData.searchHistory || [];
    
    // Clear search preview panel default view
    const previewPanel = $('#search-preview-panel');
    if (previewPanel) {
      previewPanel.classList.remove('active');
    }

    // Fetch and compute Continue Watching items
    let continueItemsToRender = [];
    if (history.length === 0 && currentProfile?.playback) {
      const pbEntries = Object.entries(currentProfile.playback).map(([key, pb]) => {
        if (pb.meta) return pb;
        const tmdbCache = appData.tmdbCache || {};
        let libItem = null;
        if (typeof allItems === 'function') {
          libItem = allItems().find(i => getPlaybackKey(i) === key);
        }
        if (libItem) {
          pb.meta = libItem;
        } else {
          let baseId = key;
          let seasonNum = undefined;
          let episodeNum = undefined;
          if (key.includes('_S') && key.includes('E')) {
            const match = key.match(/^(.+?)_S(\d+)E(\d+)$/);
            if (match) {
              baseId = match[1];
              seasonNum = parseInt(match[2], 10);
              episodeNum = parseInt(match[3], 10);
            }
          } else if (key.includes('_E')) {
            const match = key.match(/^(.+?)_E(\d+)$/);
            if (match) {
              baseId = match[1];
              episodeNum = parseInt(match[2], 10);
            }
          }
          const cached = tmdbCache[baseId] || tmdbCache[key];
          if (cached) {
            pb.meta = { 
              ...cached, 
              id: key, 
              tmdbId: cached.tmdbId || baseId, 
              season: seasonNum, 
              episode: episodeNum 
            };
          }
        }
        return pb;
      }).filter(pb => {
        return pb && pb.time > 5 && !pb.watched && pb.meta && (typeof isAgeAllowed === 'function' ? isAgeAllowed(pb.meta) : true);
      }).sort((a, b) => {
        return (b.lastWatched || 0) - (a.lastWatched || 0);
      });

      const seenShows = new Set();
      continueItemsToRender = pbEntries.filter(pb => {
        const item = pb.meta;
        const isEpisode = item.season !== undefined && item.episode !== undefined;
        let uniqueShowId = null;
        if (isEpisode) {
          uniqueShowId = item.showId || (item.show && item.show.id);
          if (!uniqueShowId) {
            const parentShow = (appData.shows || []).find(s =>
              (s.episodes || []).some(e => e.path === item.path)
            );
            if (parentShow) uniqueShowId = parentShow.id;
          }
          if (!uniqueShowId && item.path) {
            const sep = item.path.includes('\\') ? '\\' : '/';
            let dir = item.path.substring(0, item.path.lastIndexOf(sep));
            const base = dir.substring(dir.lastIndexOf(sep) + 1);
            if (base.match(/Season\s+\d+|S\d+|Episode|Part\s+\d+/i)) {
              dir = dir.substring(0, dir.lastIndexOf(sep));
            }
            uniqueShowId = 'folder_' + dir;
          }
        } else {
          uniqueShowId = item.id || item.tmdbId || item.path;
        }
        if (uniqueShowId && seenShows.has(uniqueShowId)) return false;
        if (uniqueShowId) seenShows.add(uniqueShowId);
        return true;
      }).slice(0, 18);
    }

    let historyHtml = '';
    if (history.length > 0) {
      historyHtml = history.map(item => `
        <div class="search-history-pill" data-query="${escapeHTML(item)}" style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          <i class="fas fa-history" style="font-size: 0.8rem; opacity: 0.6; color: var(--accent);"></i>
          <span>${escapeHTML(item)}</span>
        </div>
      `).join('');
    } else {
      historyHtml = '<div style="color: var(--text-muted); font-size: 0.95rem;">No recent searches. Start typing to search!</div>';
    }

    grid.innerHTML = `
      <div class="search-empty-state" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 35px; width: 100%; padding: 10px 0; animation: premiumFadeSlide 0.4s cubic-bezier(0.22, 1, 0.36, 1);">
        <!-- Search History / Continue Watching -->
        <div style="display: flex; flex-direction: column; gap: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 1.5px; border-left: 3px solid var(--accent); padding-left: 10px; margin: 0;">${history.length > 0 ? 'Recent Searches' : 'Continue Watching'}</h3>
            ${history.length > 0 ? `
              <button id="btn-clear-search-history" style="background: transparent; border: none; color: var(--accent); font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 4px 8px; transition: opacity 0.2s;">
                <i class="fas fa-trash-alt"></i> Clear History
              </button>
            ` : ''}
          </div>
          <div id="search-history-container" style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; width: 100%;">
            ${history.length > 0 ? historyHtml : '<div id="search-continue-container" style="width: 100%;"></div>'}
          </div>
        </div>

        <!-- Suggestions / Similar Items -->
        <div style="display: flex; flex-direction: column; gap: 15px;">
          <h3 id="search-suggestions-title" style="font-size: 1.1rem; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 1.5px; border-left: 3px solid var(--accent); padding-left: 10px; margin: 0;">Suggested for You</h3>
          <div id="search-suggestions-grid" class="tmdb-result-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; width: 100%;">
            <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted);"><i class="fas fa-spinner fa-spin fa-2x" style="color: var(--accent);"></i></div>
          </div>
        </div>
      </div>
    `;

    if (history.length === 0) {
      const continueContainer = grid.querySelector('#search-continue-container');
      if (continueContainer) {
        if (continueItemsToRender.length > 0) {
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; gap: 15px; overflow-x: auto; padding: 10px 0; width: 100%; scrollbar-width: none; -ms-overflow-style: none;';
          row.id = 'search-continue-row';
          
          continueItemsToRender.forEach(pb => {
            const item = pb.meta;
            const card = document.createElement('div');
            card.className = 'continue-card';
            
            const progress = Math.min((pb.time / pb.duration) * 100, 100).toFixed(1);
            const tmdbCache = appData.tmdbCache || {};
            const isEpisode = item.season !== undefined && item.episode !== undefined;
            let displayTitle = item.title || item.name;
            
            let showObj = item.show;
            if (isEpisode && !showObj) {
              showObj = (appData.shows || []).find(s => (s.episodes || []).some(e => getPlaybackKey(e) === getPlaybackKey(item)));
            }
            
            let subtitle = isEpisode ? (item.showName || (showObj && showObj.title) || 'TV Show') : '';
            const showId = showObj?.id || item.showId;
            const metaCache = tmdbCache[showId] || tmdbCache[item.id] || tmdbCache[item.tmdbId] || {};
            
            let bPath = item.backdrop_path || item.backdropPath || metaCache.backdropPath || metaCache.backdrop_path;
            
            if (isEpisode) {
              const sn = item.season;
              const en = item.episode;
              const sData = (metaCache.seasons) ? (metaCache.seasons[sn] || metaCache.seasons[String(sn)]) : null;
              const epData = (sData) ? (sData[en] || sData[String(en)]) : null;
              
              if (epData) {
                displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')} • ${epData.name || 'Episode ' + en}`;
                let still = '';
                if (epData.local_still) {
                  still = `local-file:///${epData.local_still.replace(/\\/g, "/")}`;
                }
                if (still) bPath = still;
              } else {
                displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')}`;
              }
            }
            
            const pPath = item.poster_path || item.posterPath || metaCache.posterPath || metaCache.poster_path;
            let backdropUrl = 'imgs/no-backdrop.png';
            const localBanner = appData.banners ? (appData.banners[item.id] || (showObj ? appData.banners[showId] : null)) : null;
            
            if (localBanner) {
              backdropUrl = `local-file:///${localBanner.replace(/\\/g, "/")}`;
            } else if (item.cover) {
              if (item.cover.startsWith('data:') || item.cover.startsWith('http') || item.cover.startsWith('local-file')) {
                backdropUrl = item.cover;
              } else {
                backdropUrl = `local-file:///${item.cover.replace(/\\/g, "/")}`;
              }
            } else if (item.poster) {
              backdropUrl = `local-file:///${item.poster.replace(/\\/g, "/")}`;
            } else if (item.thumbnail) {
              backdropUrl = `local-file:///${item.thumbnail.replace(/\\/g, "/")}`;
            } else if (item.image) {
              backdropUrl = localImg(item.image);
            } else if (bPath) {
              if (bPath.startsWith('http') || bPath.startsWith('local-file')) {
                backdropUrl = bPath;
              } else {
                // metahub.space is down — fall back to placeholder
                backdropUrl = 'imgs/no-backdrop.png';
              }
            } else if (pPath) {
              backdropUrl = 'imgs/no-backdrop.png';
            }
            
            card.innerHTML = `
              <img class="continue-card-img" src="${backdropUrl}" onerror="this.src='imgs/no-backdrop.png'; this.onerror=null;">
              <div class="continue-card-play"><i class="fas fa-play"></i></div>
              <div class="continue-card-info">
                <div class="continue-card-title">${displayTitle}</div>
                <div class="continue-card-subtitle">${subtitle}</div>
                <div class="continue-card-progress">
                  <div class="continue-card-progress-fill" style="width: ${progress}%"></div>
                </div>
              </div>
            `;
            
            card.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              showContinueWatchingMenu(e, pb, item, showObj);
            };
            
            row.appendChild(card);
          });
          continueContainer.appendChild(row);
        } else {
          continueContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.95rem;">No recent searches. Start typing to search!</div>';
        }
      }
    }

    // Add listeners to history pills
    grid.querySelectorAll('.search-history-pill').forEach(pill => {
      pill.onclick = () => {
        const query = pill.getAttribute('data-query');
        const input = $('#search-input-main');
        if (input) {
          input.value = query;
          performUnifiedSearch(query);
        }
      };
      pill.onmouseenter = () => {
        pill.style.background = 'rgba(255, 255, 255, 0.1)';
        pill.style.borderColor = 'var(--accent)';
      };
      pill.onmouseleave = () => {
        pill.style.background = 'rgba(255, 255, 255, 0.05)';
        pill.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      };
    });

    // Add listener to clear history button
    const clearBtn = grid.querySelector('#btn-clear-search-history');
    if (clearBtn) {
      clearBtn.onclick = () => {
        appData.searchHistory = [];
        persist();
        renderEmptySearchState();
      };
    }

    // Load recommendations
    try {
      let recs = [];
      let sectionTitle = 'Suggested for You';
      
      if (history.length > 0) {
        const lastQuery = history[0];
        sectionTitle = `Suggested based on "${lastQuery}"`;
        // Fetch search results for lastQuery as similar items
        const res = await window.api.invoke('unified-search', lastQuery).catch(() => null);
        recs = res?.results || [];
      } else {
        // Fetch trending/top movies - try Cinemeta catalog directly
        sectionTitle = 'Trending Movies & TV Shows';
        let recItems = [];
        try {
          const res = await window.api.invoke('cinemeta-catalog', { type: 'movie', id: 'top' }).catch(() => null);
          if (res && Array.isArray(res.metas) && res.metas.length > 0) {
            recItems = res.metas.map(movie => ({
              id: movie.id,
              title: movie.name,
              poster: movie.poster ? (movie.poster.startsWith('http') ? movie.poster : `https://images.metahub.space/poster/medium/${movie.id}/img`) : (movie.id ? `https://images.metahub.space/poster/medium/${movie.id}/img` : ''),
              type: 'movie',
              source: 'cinemeta',
              rating: movie.imdbRating ? parseFloat(movie.imdbRating) : 0,
              releaseYear: movie.releaseInfo ? parseInt(movie.releaseInfo.substring(0, 4)) : 0,
              synopsis: movie.description || ''
            }));
          }
        } catch (e) {
          console.warn('[EmptySearch] Cinemeta catalog fetch failed:', e.message);
        }

        if (recItems.length === 0) {
          try {
            const resp = await fetch('https://v3-cinemeta.strem.io/catalog/movie/top.json', { signal: AbortSignal.timeout(6000) });
            const data = await resp.json();
            recItems = (data?.metas || []).map(movie => ({
              id: movie.id,
              title: movie.name,
              poster: movie.poster ? (movie.poster.startsWith('http') ? movie.poster : `https://images.metahub.space/poster/medium/${movie.id}/img`) : (movie.id ? `https://images.metahub.space/poster/medium/${movie.id}/img` : ''),
              type: 'movie',
              source: 'cinemeta',
              rating: movie.imdbRating ? parseFloat(movie.imdbRating) : 0,
              releaseYear: movie.year ? parseInt(movie.year) : 0,
              synopsis: movie.description || ''
            }));
          } catch (e2) {
            console.warn('[EmptySearch] Direct Cinemeta fetch fallback failed:', e2.message);
          }
        }
        recs = recItems;
      }


      const recGrid = grid.querySelector('#search-suggestions-grid');
      const titleEl = grid.querySelector('#search-suggestions-title');
      if (titleEl && sectionTitle) {
        titleEl.textContent = sectionTitle;
      }

      if (recGrid) {
        recGrid.innerHTML = '';
        if (recs.length === 0) {
          recGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted);">No suggestions available.</div>';
          return;
        }

        const localMap = new Map();
        (appData.movies || []).forEach(m => { if (m.title) localMap.set(m.title.toLowerCase(), m); });
        (appData.shows || []).forEach(s => { if (s.title) localMap.set(s.title.toLowerCase(), s); });

        const allowedRecs = (recs || []).filter(isAgeAllowed);
        allowedRecs.slice(0, 12).forEach(item => {
          const card = document.createElement('div');
          card.className = 'discover-card search-result-card';
          const itemTitle = item.title || item.name || 'Unknown';
          
          let posterUrl = '';
          const resolvedImdb = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
          
          if (item.poster) {
            posterUrl = localImg(item.poster);
          } else if (item.poster_path) {
            posterUrl = localImg(item.poster_path);
          }
          
          const localItem = localMap.get(itemTitle.toLowerCase());
          const inLib = !!localItem;
          
          if (!posterUrl && localItem) {
            if (localItem.poster) posterUrl = localImg(localItem.poster);
            else if (localItem.poster_path) posterUrl = localImg(localItem.poster_path);
          }

          // Force TMDB override if configured & enabled
          const tmdbKey = appData.tmdbKey;
          const overrideEnabled = appData.tmdbEnabled !== false && appData.tmdbImageOverride !== false;
          const scope = appData.tmdbImageScope || 'both';
          const hasTmdbOverride = overrideEnabled && tmdbKey && resolvedImdb && String(resolvedImdb).startsWith('tt') && (scope === 'both' || scope === 'posters');
          
          if (hasTmdbOverride) {
            posterUrl = ''; // Force dynamic premium TMDB poster fetch
          }
          
          const year = (item.release_date || item.first_air_date || item.seasonYear || item.releaseYear || item.year || '').toString().slice(0, 4);
          const rating = item.vote_average || item.score || item.rating || 0;
          
          card.innerHTML = `
            <div class="discover-poster-wrap">
              <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
              ${posterUrl ? `<img src="${posterUrl}" class="discover-poster search-poster-img" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
              ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
            </div>
            <div class="discover-info">
              <div class="discover-title" title="${escapeHTML(itemTitle)}">${escapeHTML(itemTitle)}</div>
              <div class="discover-meta">
                ${getBadgeHTML(item)}
                <span>${year || 'N/A'}</span>
                ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${parseFloat(rating).toFixed(1)}</span>` : ''}
              </div>
            </div>
          `;
          
          card.onclick = () => {
            $$('.search-result-card').forEach(c => c.classList.remove('active-preview'));
            card.classList.add('active-preview');
            updateSearchPreview(item);
          };
          recGrid.appendChild(card);
          const imgEl = card.querySelector('.search-poster-img');
          if (imgEl) {
            imgEl.onerror = () => {
              imgEl.onerror = null;
              imgEl.style.display = 'none';
              const ph = imgEl.parentElement?.querySelector('.discover-poster-placeholder') || imgEl.parentElement?.querySelector('.card-poster-placeholder');
              if (ph) ph.style.display = 'flex';
              
              if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
                getTraktOrImdbPoster(item, imgEl, card);
              }
            };
          }
          
          if (resolvedImdb && String(resolvedImdb).startsWith('tt')) {
            getTraktOrImdbPoster(item, null, card);
          }
        });
      }
    } catch (e) {
      console.error('[EmptySearch] Failed to load suggestions:', e);
      const recGrid = grid.querySelector('#search-suggestions-grid');
      if (recGrid) {
        recGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted);">Could not load suggestions.</div>';
      }
    }
  }

  async function performUnifiedSearch(q) {
    const grid = $('#search-results-grid');
    if (!grid) return;
    if (!performUnifiedSearch._searchId) performUnifiedSearch._searchId = 0;
    
    // Hide search preview panel until a new card is clicked
    const previewPanel = $('#search-preview-panel');
    if (previewPanel) {
      previewPanel.classList.remove('active');
    }
    
    if (!q || !q.trim()) {
      renderEmptySearchState();
      return;
    }
    
    // Save to search history
    const qClean = q.trim();
    if (qClean.length >= 2) {
      let history = appData.searchHistory || [];
      history = history.filter(h => h.toLowerCase() !== qClean.toLowerCase());
      history.unshift(qClean);
      history = history.slice(0, 10);
      appData.searchHistory = history;
      persist();
    }
    // Create beautiful cinematic skeleton grid cards
    let skeletonHTML = '';
    for (let i = 0; i < 20; i++) {
      skeletonHTML += `
        <div class="discover-card search-skeleton-card" style="pointer-events: none; position: relative; overflow: hidden; border-radius: 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); padding: 8px;">
          <div class="discover-poster-wrap" style="aspect-ratio: 2/3; width: 100%; border-radius: 12px; background: rgba(255, 255, 255, 0.06); position: relative; overflow: hidden;"></div>
          <div class="discover-info" style="padding: 10px 4px 4px;">
            <div style="height: 14px; width: 75%; background: rgba(255, 255, 255, 0.08); border-radius: 6px; margin-bottom: 8px;"></div>
            <div style="height: 10px; width: 40%; background: rgba(255, 255, 255, 0.05); border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }
    grid.innerHTML = skeletonHTML;
    
    // Inject keyframes style if not already present
    if (!document.getElementById('skeleton-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'skeleton-pulse-style';
      style.innerHTML = `
        .search-skeleton-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255, 255, 255, 0.06) 50%, rgba(255,255,255,0) 100%);
          background-size: 200% 100%;
          animation: searchShimmerSweep 1.5s infinite ease-in-out;
          pointer-events: none;
        }
        @keyframes searchShimmerSweep {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Track search request ID to avoid stale results overwriting newer ones
    const searchId = ++performUnifiedSearch._searchId;

    // Use setTimeout 0 to force DOM repaint before heavy async work
    setTimeout(async () => {
      try {
        const qClean = q.trim();

        // ─── Helper: dedup merged results ───────────────────────────────────
        const mergeDedup = (items) => {
          const byImdb = new Map();
          const byTitle = new Map();
          const byTitleNoYear = new Map();
          const merged = [];

          for (const item of items) {
            const imdbId = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
            const tmdbId = item.tmdb_id || item.tmdbId || (!String(item.id).startsWith('tt') && !isNaN(item.id) ? item.id : null);
            const typeNorm = (item.type === 'tv' || item.type === 'show') ? 'series' : item.type;
            const year = (item.release_date || item.first_air_date || item.seasonYear || item.releaseYear || item.year || '').toString().slice(0, 4);
            const titleClean = (item.title || item.name || '').toLowerCase().trim();

            const titleKey = `${titleClean}_${year}_${typeNorm}`;
            const titleKeyNoYear = `${titleClean}_${typeNorm}`;

            let existingIdx = -1;
            if (imdbId && byImdb.has(imdbId)) existingIdx = byImdb.get(imdbId);
            else if (year && byTitle.has(titleKey)) existingIdx = byTitle.get(titleKey);
            else if (!year && byTitleNoYear.has(titleKeyNoYear)) existingIdx = byTitleNoYear.get(titleKeyNoYear);

            if (existingIdx !== -1) {
              const existing = merged[existingIdx];
              if (imdbId && !existing.imdb_id && !existing.imdbId) { existing.imdb_id = imdbId; existing.imdbId = imdbId; byImdb.set(imdbId, existingIdx); }
              if (tmdbId && !existing.tmdb_id && !existing.tmdbId) { existing.tmdb_id = tmdbId; existing.tmdbId = tmdbId; }
              const existingHasRealPoster = existing.poster && !existing.poster.match(/^\/tt\d+$/) && existing.poster !== '';
              const newHasRealPoster = item.poster && !item.poster.match(/^\/tt\d+$/) && item.poster !== '';
              if (!existingHasRealPoster && newHasRealPoster) { existing.poster = item.poster; existing.backdrop = item.backdrop || existing.backdrop; }
              else if (item.backdrop && !existing.backdrop) existing.backdrop = item.backdrop;
              if (!existing.synopsis && item.synopsis) existing.synopsis = item.synopsis;
              if (!existing.rating && item.rating) existing.rating = item.rating;
              if (!existing.releaseYear && item.releaseYear) existing.releaseYear = item.releaseYear;
              if (!existing.year && item.year) existing.year = item.year;
              continue;
            }

            const idx = merged.length;
            merged.push(item);
            if (imdbId) byImdb.set(imdbId, idx);
            if (year) byTitle.set(titleKey, idx);
            byTitleNoYear.set(titleKeyNoYear, idx);
          }
          return merged;
        };

        const localMap = new Map();
        (appData.movies || []).forEach(m => { if (m.title) localMap.set(m.title.toLowerCase(), m); });
        (appData.shows || []).forEach(s => { if (s.title) localMap.set(s.title.toLowerCase(), s); });

        // ─── Render helper ─────────────────────────────────────────────────
        const renderSearchSection = (title, items, sectionId) => {
          if (!items || !items.length) return;

          let sectionEl = grid.querySelector(`[data-section="${sectionId}"]`);
          if (!sectionEl) {
            const header = document.createElement('h3');
            header.style.cssText = 'grid-column: 1/-1; margin: 30px 0 15px 0; font-size: 1.15rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; color: #fff; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; display: flex; align-items: center; gap: 10px;';
            if (sectionId === 'youtube') {
              header.innerHTML = `<i class="fab fa-youtube" style="color: #ff0000; font-size: 1.4rem;"></i> <span>${escapeHTML(title)}</span>`;
            } else if (sectionId === 'youtube_music') {
              header.innerHTML = `<i class="fab fa-youtube" style="color: #ff0033; font-size: 1.4rem;"></i> <span>${escapeHTML(title)}</span>`;
            } else {
              header.innerText = title;
            }
            header.setAttribute('data-section', sectionId);
            grid.appendChild(header);
            sectionEl = header;
          }

          // ── YouTube Horizontal 16:9 Video Cards ──────────────────────────────
          if (sectionId === 'youtube') {
            let ytContainer = grid.querySelector('.youtube-search-grid-container');
            if (!ytContainer) {
              ytContainer = document.createElement('div');
              ytContainer.className = 'youtube-search-grid-container';
              ytContainer.style.cssText = 'grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; width: 100%; margin-bottom: 24px;';
              grid.appendChild(ytContainer);
            }

            items.slice(0, 30).forEach(item => {
              const card = document.createElement('div');
              card.className = 'yt-search-card';
              card.style.cssText = 'display: flex; flex-direction: column; background: rgba(255,255,255,0.02); border-radius: 12px; overflow: hidden; cursor: pointer; border: 1px solid rgba(255,255,255,0.06); transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.4, 1), background 0.2s, box-shadow 0.2s, border-color 0.2s;';

              const itemTitle = item.title || 'YouTube Video';
              const thumb = item.thumbnail || item.poster || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
              const author = item.author || 'YouTube';
              const duration = item.duration || '';
              const views = item.views || '';
              const published = item.published || '';

              card.innerHTML = `
                <div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #111; overflow: hidden;">
                  <img src="${thumb}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease;" loading="lazy" onerror="this.src='imgs/no-backdrop.png'">
                  ${duration ? `<div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.85); color: #fff; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; z-index: 2; letter-spacing: 0.5px;">${escapeHTML(String(duration))}</div>` : ''}
                  <div class="yt-play-hover" style="position: absolute; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s;">
                    <div style="width: 48px; height: 48px; border-radius: 50%; background: #ff0000; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(255,0,0,0.5);">
                      <i class="fas fa-play" style="color: #fff; font-size: 18px; margin-left: 2px;"></i>
                    </div>
                  </div>
                </div>
                <div style="padding: 12px 14px; display: flex; flex-direction: column; flex: 1; justify-content: space-between;">
                  <div style="font-size: 0.95rem; font-weight: 700; color: #fff; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 6px;" title="${escapeHTML(itemTitle)}">
                    ${escapeHTML(itemTitle)}
                  </div>
                  <div>
                    <div style="display: flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.7); font-size: 0.8rem; font-weight: 600; margin-bottom: 4px;">
                      <i class="fab fa-youtube" style="color: #ff0000; font-size: 13px;"></i>
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(author)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.4); font-size: 0.75rem;">
                      ${views ? `<span>${escapeHTML(String(views))}</span>` : ''}
                      ${views && published ? `<span>•</span>` : ''}
                      ${published ? `<span>${escapeHTML(String(published))}</span>` : ''}
                    </div>
                  </div>
                </div>
              `;

              card.onmouseenter = () => {
                card.style.transform = 'translateY(-4px)';
                card.style.background = 'rgba(255,255,255,0.06)';
                card.style.borderColor = 'rgba(255,255,255,0.18)';
                card.style.boxShadow = '0 10px 24px rgba(0,0,0,0.45)';
                const hoverIcon = card.querySelector('.yt-play-hover');
                if (hoverIcon) hoverIcon.style.opacity = '1';
                const img = card.querySelector('img');
                if (img) img.style.transform = 'scale(1.04)';
              };
              card.onmouseleave = () => {
                card.style.transform = 'translateY(0)';
                card.style.background = 'rgba(255,255,255,0.02)';
                card.style.borderColor = 'rgba(255,255,255,0.06)';
                card.style.boxShadow = 'none';
                const hoverIcon = card.querySelector('.yt-play-hover');
                if (hoverIcon) hoverIcon.style.opacity = '0';
                const img = card.querySelector('img');
                if (img) img.style.transform = 'scale(1)';
              };

              card.onclick = () => {
                if (typeof window.playVideo === 'function') {
                  window.playVideo({
                    type: 'youtube',
                    isYoutube: true,
                    id: item.id,
                    videoId: item.id,
                    title: item.title,
                    poster: thumb,
                    thumbnail: thumb,
                    author: item.author,
                    duration: item.duration
                  });
                }
              };

              ytContainer.appendChild(card);
            });
            return;
          }

          items.slice(0, 36).forEach(item => {
            const card = document.createElement('div');
            card.className = 'discover-card search-result-card';
            const itemTitle = item.title || item.name || 'Unknown';

            let posterUrl = '';
            const resolvedImdb = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);

            if (item.poster) posterUrl = localImg(item.poster);
            else if (item.poster_path) posterUrl = localImg(item.poster_path);

            const localItem = localMap.get(itemTitle.toLowerCase());
            const inLib = !!localItem;

            if (!posterUrl && localItem) {
              if (localItem.poster) posterUrl = localImg(localItem.poster);
              else if (localItem.poster_path) posterUrl = localImg(localItem.poster_path);
              else if (localItem.cover) posterUrl = localImg(localItem.cover);
              else if (localItem.banner) posterUrl = localImg(localItem.banner);
            }

            const tmdbKey = appData.tmdbKey;
            const overrideEnabled = appData.tmdbEnabled !== false && appData.tmdbImageOverride !== false;
            const scope = appData.tmdbImageScope || 'both';
            const hasTmdbOverride = overrideEnabled && tmdbKey && resolvedImdb && String(resolvedImdb).startsWith('tt') && (scope === 'both' || scope === 'posters');
            if (hasTmdbOverride) posterUrl = '';

            const year = (item.release_date || item.first_air_date || item.seasonYear || item.releaseYear || item.year || '').toString().slice(0, 4);
            const rating = item.vote_average || item.score || item.rating || 0;

            card.innerHTML = `
              <div class="discover-poster-wrap">
                <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
                ${posterUrl ? `<img src="${posterUrl}" class="discover-poster search-poster-img" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
                ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
              </div>
              <div class="discover-info">
                <div class="discover-title" title="${escapeHTML(itemTitle)}">${escapeHTML(itemTitle)}</div>
                <div class="discover-meta">
                  ${getBadgeHTML(item)}
                  <span>${year || 'N/A'}</span>
                  ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${parseFloat(rating).toFixed(1)}</span>` : ''}
                </div>
              </div>
            `;

            if (item.type === 'youtube' || item.isYoutube) {
              card.onclick = () => {
                if (typeof window.playVideo === 'function') {
                  window.playVideo({
                    type: 'youtube',
                    isYoutube: true,
                    id: item.id,
                    videoId: item.id,
                    title: item.title,
                    poster: item.thumbnail || item.poster,
                    author: item.author,
                    duration: item.duration
                  });
                }
              };
            } else if (item.type === 'youtube_music' || item.isYoutubeMusic) {
              card.onclick = () => {
                if (typeof window.playMusic === 'function') {
                  window.playMusic({
                    type: 'youtube_music',
                    isYoutubeMusic: true,
                    id: item.id,
                    videoId: item.id,
                    title: item.title,
                    artist: item.author || item.artist,
                    cover: item.thumbnail || item.poster
                  });
                }
              };
            } else {
              card.onclick = () => {
                $$('.search-result-card').forEach(c => c.classList.remove('active-preview'));
                card.classList.add('active-preview');
                updateSearchPreview(item);
              };
            }
            grid.appendChild(card);

            const imgEl = card.querySelector('.search-poster-img');
            if (imgEl) {
              imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.style.display = 'none';
                const ph = imgEl.parentElement?.querySelector('.discover-poster-placeholder') || imgEl.parentElement?.querySelector('.card-poster-placeholder');
                if (ph) ph.style.display = 'flex';
                if (resolvedImdb && String(resolvedImdb).startsWith('tt')) getTraktOrImdbPoster(item, imgEl, card);
              };
            }
            if (resolvedImdb && String(resolvedImdb).startsWith('tt')) getTraktOrImdbPoster(item, null, card);
          });
        };

        // ─── PHASE 1: fire enabled search providers ────
        const canCatalog = window.AppCapabilities?.can('catalog');
        const canYT = window.AppCapabilities?.can('youtube');

        const catalogPromise = canCatalog ? window.api.invoke('unified-search', qClean).catch(() => null) : Promise.resolve(null);
        const ytPromise = canYT ? window.api.invoke('youtube-search', { query: qClean, filter: 'video' }).catch(() => null) : Promise.resolve(null);

        const [unifiedRes, ytSearchRes] = await Promise.all([catalogPromise, ytPromise]);

        // Bail if a newer search was started
        if (searchId !== performUnifiedSearch._searchId) return;

        const allUnified = unifiedRes?.results || [];
        const unifiedMovies = mergeDedup(allUnified.filter(r => r.type === 'movie')).filter(isAgeAllowed);
        const unifiedSeries = mergeDedup(allUnified.filter(r => r.type === 'series' || r.type === 'tv')).filter(isAgeAllowed);
        const ytVideos = (ytSearchRes && ytSearchRes.success && ytSearchRes.results) ? ytSearchRes.results : [];

        // Show results now (clear skeleton)
        grid.innerHTML = '';
        let hasAnyResults = false;

        if (ytVideos.length) { hasAnyResults = true; renderSearchSection('YouTube Videos', ytVideos, 'youtube'); }
        if (unifiedSeries.length) { hasAnyResults = true; renderSearchSection('Series', unifiedSeries, 'series'); }
        if (unifiedMovies.length) { hasAnyResults = true; renderSearchSection('Movies', unifiedMovies, 'movies'); }

        if (!hasAnyResults) {
          grid.innerHTML = `<div style="padding:60px 40px;text-align:center;color:var(--text-muted);line-height:1.6;grid-column: 1/-1">No results found for "${escapeHTML(qClean)}"</div>`;
        }

        // ─── PHASE 2: Trakt enrichment in background (only if catalog is enabled) ───────────────────────
        if (canCatalog) {
          const [traktMoviesRes, traktShowsRes] = await Promise.all([
            window.api.invoke('trakt-search', { query: qClean, type: 'movie' }).catch(() => null),
            window.api.invoke('trakt-search', { query: qClean, type: 'series' }).catch(() => null)
          ]);

          if (searchId !== performUnifiedSearch._searchId) return;

          const traktMovies = (traktMoviesRes?.results || []).map(r => ({ ...r, type: 'movie' }));
          const traktShows = (traktShowsRes?.results || []).map(r => ({ ...r, type: 'tv' }));

          const allMovieItems = mergeDedup([...unifiedMovies, ...traktMovies]).filter(isAgeAllowed);
          const allSeriesItems = mergeDedup([...unifiedSeries, ...traktShows]).filter(isAgeAllowed);

          const newMovieCount = allMovieItems.length - unifiedMovies.length;
          const newSeriesCount = allSeriesItems.length - unifiedSeries.length;

          if (newMovieCount > 0 || newSeriesCount > 0) {
            grid.innerHTML = '';
            if (ytVideos.length) renderSearchSection('YouTube Videos', ytVideos, 'youtube');
            if (allSeriesItems.length) renderSearchSection('Series', allSeriesItems, 'series');
            if (allMovieItems.length) renderSearchSection('Movies', allMovieItems, 'movies');
          }
        }

      } catch (err) {
        console.error('[UnifiedSearch] Failed:', err);
        grid.innerHTML = '<div style="padding:40px;text-align:center;color:#EF4444;grid-column: 1/-1">Error performing unified search</div>';

      }
    }, 0);
  }

  let currentTrailerSessionId = 0;
  let trailerStopTimeout = null;

  function stopBackgroundTrailer() {
    if (trailerStopTimeout) {
      clearTimeout(trailerStopTimeout);
      trailerStopTimeout = null;
    }
    const iframe = $('#preview-youtube-backdrop');
    if (iframe) {
      iframe.remove();
    }
    const video = $('#preview-video-backdrop');
    if (video) {
      try {
        video.pause();
        video.src = '';
      } catch (e) {}
      video.style.opacity = '0';
    }
    const img = $('#preview-backdrop');
    if (img) {
      img.style.opacity = '0.65';
    }

    if (typeof window.stopDetailBackgroundTrailer === 'function') {
      try { window.stopDetailBackgroundTrailer(); } catch (e) {}
    }
  }

  window.stopBackgroundTrailer = stopBackgroundTrailer;

  function extractYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  async function playBackgroundTrailer(meta) {
    if (appData.enableVideoTrailers === false) return;
    
    stopBackgroundTrailer();
    
    const panel = $('#search-preview-panel');
    const img = $('#preview-backdrop');
    if (!panel || !img) return;

    let youtubeId = null;
    if (meta.trailers && Array.isArray(meta.trailers)) {
      // Cinemeta format: { source: "video_id", type: "Trailer" }
      const yt = meta.trailers.find(t => t.type === 'Trailer' || t.type === 'trailer' || t.source);
      if (yt && yt.source) {
        youtubeId = (yt.source.includes('://') || yt.source.includes('watch?')) ? extractYoutubeId(yt.source) : yt.source;
      }
    } else if (meta.trailer && typeof meta.trailer === 'string') {
      youtubeId = meta.trailer.startsWith('http') ? extractYoutubeId(meta.trailer) : meta.trailer;
    }

    if (!youtubeId) {
      const tmdbKey = appData.tmdbKey;
      if (tmdbKey) {
        let imdbId = meta.imdb_id || meta.imdbId || (meta.id && String(meta.id).startsWith('tt') ? meta.id : null);
        let tmdbId = meta.tmdbId || meta.tmdb_id || meta.moviedb_id;
        
        if (tmdbKey && (imdbId || tmdbId)) {
          if (!tmdbId && imdbId) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
            const findRes = await fetch(findUrl).then(r => r.json()).catch(() => null);
            const isTv = meta.type === 'series' || meta.type === 'tv' || meta.media_type === 'tv';
            const resultsList = isTv ? findRes?.tv_results : findRes?.movie_results;
            if (resultsList && resultsList[0]) {
              tmdbId = resultsList[0].id;
            }
          }
          if (tmdbId) {
            const isTv = meta.type === 'series' || meta.type === 'tv' || meta.media_type === 'tv';
            const videoUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}/videos?api_key=${tmdbKey}`;
            const videoRes = await fetch(videoUrl).then(r => r.json()).catch(() => null);
            if (videoRes && videoRes.results && videoRes.results.length > 0) {
              const trailer = videoRes.results.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                              videoRes.results.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                              videoRes.results.find(v => v.site === 'YouTube');
              if (trailer) {
                youtubeId = trailer.key;
              }
            }
          }
        }
      }
    }

    if (!youtubeId) return;

    const sessionId = ++currentTrailerSessionId;

    // Wait for the preview backdrop image to be fully loaded first
    if (img && img.src && !img.complete) {
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 4000);
      });
    }

    // Attempt to resolve direct stream url
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    let directUrl = null;
    try {
      directUrl = await window.api.invoke('resolve-trailer-stream', youtubeUrl);
    } catch (err) {
      console.warn('[Trailer] Failed to resolve direct URL via IPC in preview:', err);
    }


    if (directUrl) {
      const video = $('#preview-video-backdrop');
      if (video) {
        const onReady = () => {
          if (sessionId !== currentTrailerSessionId) {
            try { video.pause(); video.src = ''; } catch (e) {}
            return;
          }
          video.style.opacity = '0.65';
          if (img) img.style.opacity = '0';
        };

        const isHls = directUrl.includes('.m3u8') || directUrl.includes('manifest');
        if (isHls && window.shaka && window.shaka.Player) {
          try {
            shaka.polyfill.installAll();
            const shakaPlayer = new shaka.Player(video);
            shakaPlayer.configure({
              streaming: {
                bufferingGoal: 15,
                rebufferingGoal: 2,
              },
              abr: {
                enabled: false, // We manually select max quality
                defaultBandwidthEstimate: 100000000, // 100 Mbps initial estimate
              }
            });
            shakaPlayer.load(directUrl).then(() => {
              // Force highest quality track
              const tracks = shakaPlayer.getVariantTracks();
              if (tracks && tracks.length) {
                const bestTrack = tracks.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
                shakaPlayer.selectVariantTrack(bestTrack, true);
              }
              video.play().catch(() => {});
              video.onloadeddata = onReady;
            }).catch(err => {
              console.warn('[Trailer Preview] Shaka HLS load failed:', err);
              video.src = directUrl;
              video.play().catch(() => {});
              video.onloadeddata = onReady;
            });
          } catch (e) {
            console.warn('[Trailer Preview] Shaka init failed:', e);
            video.src = directUrl;
            video.play().catch(() => {});
            video.onloadeddata = onReady;
          }
        } else {
          video.src = directUrl;
          video.play().catch(() => {});
          video.onloadeddata = onReady;
        }
      }
    }
    // No iframe fallback — YouTube embeds produce Error 153 under file:// protocol.
    // If yt-dlp failed, the banner image stays visible.

    if (trailerStopTimeout) clearTimeout(trailerStopTimeout);
    trailerStopTimeout = setTimeout(() => {
      if (sessionId === currentTrailerSessionId) {
        stopBackgroundTrailer();
      }
    }, 25000);
  }

  function updateSearchPreview(item) {
    const previewPanel = $('#search-preview-panel');
    const backdropImg = $('#preview-backdrop');
    const previewContent = $('#preview-content');
    if (!previewPanel || !previewContent || !backdropImg) return;
    
    previewPanel.classList.add('active');
    
    const title = item.title || item.name || 'Unknown';
    const imdbId = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
    const type = item.type === 'series' || item.type === 'tv' || item.type === 'show' ? 'series' : 'movie';
    
    previewContent.innerHTML = '';
    
    const renderPreview = (meta) => {
      let bdUrl = meta.backdrop;
      if (bdUrl && bdUrl.includes('image.tmdb.org/t/p/')) {
        bdUrl = bdUrl.replace(/\/t\/p\/[^\/]+/, '/t/p/original');
      }
      let posterUrl = meta.poster;
      if (posterUrl && posterUrl.includes('image.tmdb.org/t/p/')) {
        posterUrl = posterUrl.replace(/\/t\/p\/[^\/]+/, '/t/p/w500');
      }

      if (bdUrl) {
        backdropImg.src = localImg(bdUrl);
        backdropImg.style.opacity = '0.65';
      } else if (posterUrl) {
        backdropImg.src = localImg(posterUrl);
        backdropImg.style.opacity = '0.4';
      } else {
        backdropImg.style.opacity = '0';
      }
      
      stopBackgroundTrailer();

      if (window.trailerDebounceTimeout) clearTimeout(window.trailerDebounceTimeout);
      window.trailerDebounceTimeout = setTimeout(() => {
        const currentActiveCard = $('.search-result-card.active-preview');
        if (currentActiveCard) {
          const activeTitle = currentActiveCard.querySelector('.discover-title')?.textContent;
          if (activeTitle === title) {
            playBackgroundTrailer(meta);
          }
        }
      }, 1200);

      const rating = meta.rating || item.rating || 0;
      const year = meta.year || item.releaseYear || '';
      const genresList = meta.genres || item.genres || [];
      const description = meta.description || meta.synopsis || item.synopsis || 'No description available for this item.';
      
      const inWatchlist = currentProfile?.watchlist?.some(w => isSameItem(w, item));
      
      const watchlistText = inWatchlist ? 'In My List' : 'Add to My List';
      const watchlistIcon = inWatchlist ? '<i class="fas fa-check"></i>' : '<i class="fas fa-plus"></i>';
      
      const logoHtml = meta.logo ? `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <img src="${localImg(meta.logo)}" alt="${escapeHTML(title)}" style="max-width: 260px; max-height: 80px; object-fit: contain; align-self: flex-start;" onerror="this.style.display='none'; const fallback = this.parentElement.querySelector('.preview-fallback-title'); if (fallback) fallback.style.display='block';">
          <h2 class="preview-fallback-title" style="display: none; font-size: 1.6rem; font-weight: 800; color: #fff; line-height: 1.3; margin: 0;">${escapeHTML(title)}</h2>
        </div>
      ` : `
        <h2 style="font-size: 1.6rem; font-weight: 800; color: #fff; line-height: 1.3; margin: 0;">${escapeHTML(title)}</h2>
      `;

      previewContent.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; text-align: left; padding: 10px 0;">
          ${posterUrl ? `<img src="${localImg(posterUrl)}" style="width: 130px; height: 195px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); object-fit: cover; align-self: flex-start; border: 1px solid rgba(255,255,255,0.1);">` : ''}
          
          ${logoHtml}
          
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.9rem; color: var(--text-secondary);">
            ${year ? `<span style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px;">${year}</span>` : ''}
            ${rating ? `<span style="color: #F59E0B; display: flex; align-items: center; gap: 4px; font-weight: bold;"><i class="fas fa-star" style="font-size:10px"></i> ${parseFloat(rating).toFixed(1)}</span>` : ''}
            <span style="text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px; font-weight: 700; color: var(--accent);">${type === 'series' ? 'TV Series' : 'Movie'}</span>
            ${imdbId ? `<span style="font-family: monospace; font-size: 0.8rem; background: rgba(229,160,13,0.1); color: #e5a00d; padding: 2px 6px; border-radius: 4px; font-weight: bold;">IMDb: ${imdbId}</span>` : ''}
          </div>
          
          ${genresList.length ? `
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${genresList.slice(0, 3).map(g => `<span style="font-size: 0.8rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 20px; color: #d1d5db;">${escapeHTML(g.name || g)}</span>`).join('')}
            </div>
          ` : ''}
          
          <div style="font-size: 0.95rem; line-height: 1.6; color: #d1d5db; max-height: 180px; overflow-y: auto; padding-right: 8px; scrollbar-width: thin;">
            ${escapeHTML(description)}
          </div>
          
          <div style="display: flex; gap: 12px; margin-top: 10px;">
            <button id="preview-btn-play" class="btn-primary" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; font-weight: 700; border-radius: 12px; box-shadow: 0 4px 15px var(--accent-glow);">
              <i class="fas fa-info-circle"></i> Show Details
            </button>
            <button id="preview-btn-watchlist" class="btn-secondary" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; font-weight: 700; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff;">
              ${watchlistIcon} ${watchlistText}
            </button>
          </div>
        </div>
      `;
      
      const playBtn = $('#preview-btn-play');
      if (playBtn) {
        playBtn.onclick = () => {
          openDiscoverDetail(item);
        };
      }
      
      const wlBtn = $('#preview-btn-watchlist');
      if (wlBtn) {
        wlBtn.onclick = () => {
          toggleWatchlist(item);
          updateSearchPreview(item);
        };
      }
    };
    
    const cache = appData.cinemetaCache = appData.cinemetaCache || {};
    if (imdbId && cache[imdbId]) {
      renderPreview(cache[imdbId]);
    } else if (imdbId) {
      renderPreview({
        poster: item.poster || item.poster_path || '',
        rating: item.rating || item.vote_average || 0,
        year: item.releaseYear || item.year || '',
        genres: item.genres || [],
        description: item.synopsis || 'Loading cinematic details...'
      });
      
      window.api.invoke('cinemeta-details', { id: imdbId, type }).then(res => {
        if (res && res.meta) {
          cache[imdbId] = {
            cinemetaId: res.meta.id,
            type: type === 'series' ? 'tv' : 'movie',
            title: res.meta.name || res.meta.title,
            poster: res.meta.poster || null,
            backdrop: res.meta.background || null,
            year: res.meta.year || (res.meta.release_date || '').slice(0, 4),
            rating: res.meta.behaviorHints?.rating || res.meta.imdbRating || 0,
            genres: res.meta.genres || [],
            description: res.meta.description || res.meta.synopsis || '',
            trailers: res.meta.trailers || null,
            trailer: res.meta.trailer || null,
            logo: res.meta.logo || null
          };
          persist();
          const currentActiveCard = $('.search-result-card.active-preview');
          if (currentActiveCard) {
            const activeTitle = currentActiveCard.querySelector('.discover-title')?.textContent;
            if (activeTitle === title) {
              renderPreview(cache[imdbId]);
            }
          }
        } else {
          // If response came back but metadata is null, fall back to item properties
          const fallback = {
            poster: item.poster || item.poster_path || '',
            rating: item.rating || item.vote_average || 0,
            year: item.releaseYear || item.year || '',
            genres: item.genres || [],
            description: item.synopsis || 'No description available for this item.'
          };
          cache[imdbId] = fallback;
          persist();
          
          const currentActiveCard = $('.search-result-card.active-preview');
          if (currentActiveCard) {
            const activeTitle = currentActiveCard.querySelector('.discover-title')?.textContent;
            if (activeTitle === title) {
              renderPreview(fallback);
            }
          }
        }
      }).catch(err => {
        console.warn('[PREVIEW-ASYNC] Failed to fetch details for', imdbId, err.message);
        const fallback = {
          poster: item.poster || item.poster_path || '',
          rating: item.rating || item.vote_average || 0,
          year: item.releaseYear || item.year || '',
          genres: item.genres || [],
          description: item.synopsis || 'No description available for this item.'
        };
        const currentActiveCard = $('.search-result-card.active-preview');
        if (currentActiveCard) {
          const activeTitle = currentActiveCard.querySelector('.discover-title')?.textContent;
          if (activeTitle === title) {
            renderPreview(fallback);
          }
        }
      });
    } else {
      renderPreview({
        poster: item.poster || item.poster_path || '',
        rating: item.rating || item.vote_average || item.score || 0,
        year: item.releaseYear || item.year || item.seasonYear || '',
        genres: item.genres || [],
        description: item.synopsis || 'No further details available.'
      });
    }
  }

  // Search Source Toggles
  const btnTmdb = $('#toggle-search-tmdb');
  const btnKitsu = $('#toggle-search-kitsu');

  if (btnTmdb) {
    btnTmdb.onclick = () => {
      isSearchTmdbEnabled = true;
      isSearchKitsuEnabled = false;
      btnTmdb.classList.add('active');
      if (btnKitsu) btnKitsu.classList.remove('active');
      performDiscoverSearch();
    };
  }

  if (btnKitsu) {
    btnKitsu.onclick = () => {
      isSearchKitsuEnabled = true;
      isSearchTmdbEnabled = false;
      btnKitsu.classList.add('active');
      if (btnTmdb) btnTmdb.classList.remove('active');
      performDiscoverSearch();
    };
  }

  // --- Mobile Player Gesture Controls ---
  if (!window.api || !window.api.isElectron) {
    let gStartX = 0;
    let gStartY = 0;
    let gStartVal = 0;
    let gType = null; // 'volume' or 'brightness'
    let currentBrightness = 1.0; // 0 to 1

    const pContainer = document.querySelector('#player-container');
    const gOverlay = document.querySelector('#gesture-overlay');
    const gIcon = document.querySelector('#gesture-icon');
    const gBarFill = document.querySelector('#gesture-bar-fill');
    const gText = document.querySelector('#gesture-text');
    const bOverlay = document.querySelector('#brightness-overlay');

    if (pContainer) {
      pContainer.addEventListener('touchstart', e => {
        if (currentView !== 'player') return;
        const touch = e.touches[0];
        gStartX = touch.clientX;
        gStartY = touch.clientY;

        const width = pContainer.offsetWidth;
        if (gStartX < width / 2) {
          gType = 'brightness';
          gStartVal = currentBrightness;
        } else {
          gType = 'volume';
          gStartVal = (videoElement && !isNaN(videoElement.volume)) ? videoElement.volume : 1;
        }
      }, { passive: true });

      pContainer.addEventListener('touchmove', e => {
        if (currentView !== 'player' || !gType) return;
        const touch = e.touches[0];
        const diffY = gStartY - touch.clientY;
        const sensitivity = 200; // pixels for 0-100%

        let newVal = gStartVal + (diffY / sensitivity);
        newVal = Math.max(0, Math.min(1, newVal));

        if (gType === 'volume' && videoElement) {
          videoElement.volume = newVal;
          updateGestureOverlay('volume', newVal);
        } else if (gType === 'brightness') {
          currentBrightness = newVal;
          if (bOverlay) bOverlay.style.opacity = 1 - newVal;
          updateGestureOverlay('brightness', newVal);
        }
      }, { passive: true });

      pContainer.addEventListener('touchend', () => {
        gType = null;
        if (gOverlay) {
          setTimeout(() => {
            if (!gType) gOverlay.style.display = 'none';
          }, 800);
        }
      });
    }

    function updateGestureOverlay(type, val) {
      if (!gOverlay) return;
      gOverlay.style.display = 'flex';
      const percent = Math.round(val * 100);
      gText.textContent = percent + '%';
      gBarFill.style.width = percent + '%';

      if (type === 'volume') {
        gIcon.className = val === 0 ? 'fas fa-volume-mute' : (val < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up');
      } else {
        gIcon.className = 'fas fa-sun';
      }
    }
  }

  // --- Torrent Progress Handling ---
  if (window.api && window.api.onTorrentProgress) {
    window.api.onTorrentProgress((data) => {
      const progressText = document.getElementById('player-progress-text');
      const speedText = document.getElementById('player-speed-text');

      if (progressText) {
        if (data.status === 'fetching_metadata') {
          progressText.innerHTML = `
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 5px;">Connecting to Peers...</div>
            <div style="font-size: 0.9rem; color: var(--accent); font-weight: 600;">Fetching torrent metadata</div>
            <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">Peers: ${data.peers || 0}</div>
          `;
        } else {
          progressText.innerHTML = `
            <div style="font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 5px;">Buffering Stream...</div>
            <div style="font-size: 0.9rem; color: var(--accent); font-weight: 600;">${data.percent} complete</div>
            <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">Peers: ${data.peers} &bull; ${data.downloaded} / ${data.total}</div>
          `;
        }
      }
      if (speedText) {
        speedText.innerHTML = `<i class="fas fa-bolt" style="color: var(--accent); margin-right: 5px;"></i> ${data.speed || '0.00 MB/s'}`;
      }
    });
  }

  // --- Remote Torrent Progress (from PC to Mobile) ---
  window.addEventListener('torrent-progress-remote', (e) => {
    const data = e.detail;
    const progressText = document.getElementById('player-progress-text');
    const speedText = document.getElementById('player-speed-text');

    if (progressText) {
      progressText.innerHTML = `
        <div style="font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 5px;">Buffering from PC...</div>
        <div style="font-size: 0.9rem; color: var(--accent); font-weight: 600;">${data.percent} complete</div>
        <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">Peers: ${data.peers} &bull; ${data.downloaded} / ${data.total}</div>
      `;
    }
    if (speedText) {
      speedText.innerHTML = `<i class="fas fa-bolt" style="color: var(--accent); margin-right: 5px;"></i> ${data.speed}`;
    }
  });







  console.log('[Renderer] Initialization core loaded.');

  // ── Library Management Helpers ──

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  let currentTmdbFolderType = 'tv';
  $('#tmdb-folder-search')?.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (!query) {
      $('#tmdb-folder-results').innerHTML = `
        <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 350px; opacity: 0.4;">
          <i class="fas fa-search-plus" style="font-size: 4rem; margin-bottom: 20px; color: var(--accent);"></i>
          <div style="font-size: 1.5rem; font-weight: 700; color: #fff;">Start your search</div>
          <div style="font-size: 1rem; margin-top: 10px;">Find the perfect content for your folder</div>
        </div>
      `;
      return;
    }

    $('#tmdb-folder-results').innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; height: 350px;">
        <i class="fas fa-circle-notch fa-spin" style="font-size: 3.5rem; color: var(--accent); opacity: 0.8;"></i>
      </div>
    `;

    try {
      // Search Cinemeta (replaces TMDB search)
      const cinemetaRes = await window.api.cinemetaSearch(query);
      const results = [];

      if (cinemetaRes && cinemetaRes.results) {
        cinemetaRes.results.slice(0, 10).forEach(item => {
          results.push({
            title: item.name || item.title,
            year: (item.first_air_date || item.release_date || '').slice(0, 4),
            image: item.backdrop || item.background || (item.poster_path ? item.poster_path : 'imgs/poster-placeholder.png'),
            source: 'cinemeta'
          });
        });
      }

      if (results.length > 0) {
        $('#tmdb-folder-results').innerHTML = '';
        results.forEach(item => {
          const div = document.createElement('div');
          div.className = 'tmdb-banner-card';
          div.style.cssText = 'display: flex; flex-direction: column; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; position: relative; height: 150px;';

          div.onmouseover = () => {
            div.style.transform = 'translateY(-5px)';
            div.style.borderColor = 'var(--accent)';
            div.style.background = 'rgba(255,255,255,0.06)';
            div.querySelector('img').style.transform = 'scale(1.1)';
            div.querySelector('img').style.opacity = '0.8';
          };
          div.onmouseout = () => {
            div.style.transform = 'translateY(0)';
            div.style.borderColor = 'rgba(255,255,255,0.08)';
            div.style.background = 'rgba(255,255,255,0.03)';
            div.querySelector('img').style.transform = 'scale(1)';
            div.querySelector('img').style.opacity = '0.6';
          };

          const sourceBadge = item.source === 'kitsu' ?
            '<span style="background:#F75239; color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:800;">ANIME</span>' :
            '<span style="background:#00d4ff; color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:800;">CINEMETA</span>';

          div.innerHTML = `
            <img src="${item.image}" onerror="this.src='imgs/no-backdrop.png'; this.style.opacity='0.3';" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.6; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);">
            <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 70%); display: flex; flex-direction: column; justify-content: flex-end; padding: 20px; z-index: 2;">
              <div style="display:flex; align-items:center;">
                <div style="font-weight: 800; font-size: 16px; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.5); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(item.title)}</div>
                ${sourceBadge}
              </div>
              <div style="font-size: 12px; opacity: 0.6; margin-top: 5px; font-weight: 700; letter-spacing: 0.5px;">${item.year}</div>
            </div>
          `;

          div.onclick = async () => {
            $('#modal-tmdb-folder').style.display = 'none';
            if (!currentProfile) return;
            const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
            const baseDir = (currentTmdbFolderType === 'tv' || item.source === 'kitsu') ? pPaths.series : pPaths.movies;

            // Create safe folder name
            const safeName = item.title.replace(/[\\/:*?"<>|]/g, '').trim();
            const folderPath = baseDir + '/' + safeName;

            // Subtitle select all UI insertion
            const subWrap = document.createElement('div');
            subWrap.style.display = 'flex';
            subWrap.style.alignItems = 'center';
            subWrap.style.gap = '15px';
            subWrap.innerHTML = `
              <div id="sub-select-all-wrap" onclick="toggleAllSubtitles()" style="display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;">
                <div id="sub-check-all" class="sub-checkbox" style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-radius: 5px; display: flex; align-items: center; justify-content: center;"></div>
                <span style="font-size: 13px; font-weight: 700; color: #fff; opacity: 0.8;">Select All</span>
              </div>
              <h3 style="font-size: 1.4rem; color: #fff; font-weight: 700;">Profile Library</h3>
            `;

            const success = await window.api.invoke('create-folder', folderPath);
            if (success) {
              showToast(`Folder created: ${safeName}`);
              scanLibrary();
            } else {
              showToast(`Folder already exists: ${safeName}`);
            }
          };

          $('#tmdb-folder-results').appendChild(div);
        });
      } else {
        $('#tmdb-folder-results').innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 50px; color: var(--text-muted); font-size: 1.1rem;">No results found in Cinemeta.</div>';
      }
    } catch (err) {
      console.error('Search error:', err);
      $('#tmdb-folder-results').innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 50px; color: #ef4444;">Search failed. Please try again.</div>';
    }
  }, 500));

  // ══════════════════════════════════════════════════════════════════════════
  //  LOCAL NETWORK SYNC (PC TO MOBILE)
  // ══════════════════════════════════════════════════════════════════════════
  let discoveredPCs = [];
  let currentSyncPC = null;
  let syncLibraryData = null;
  let currentSyncTab = 'movies';

  async function renderSync() {
    const discoveryPanel = $('#sync-discovery-panel');
    const mainContent = $('#sync-main-content');

    if (!currentSyncPC) {
      discoveryPanel.style.display = 'block';
      mainContent.style.display = 'none';

      // Setup rescan button once
      const rescanBtn = $('#btn-rescan-sync');
      if (rescanBtn && !rescanBtn._hasListener) {
        rescanBtn.onclick = () => {
          discoveredPCs = [];
          startPCDiscovery();
        };
        rescanBtn._hasListener = true;
      }

      startPCDiscovery();
    } else {
      discoveryPanel.style.display = 'none';
      mainContent.style.display = 'block';
      renderSyncLibrary();
    }
  }

  async function startPCDiscovery() {
    const panel = $('#sync-discovery-panel');
    const isMobile = window.api && window.api.isMobile && window.api.isMobile();

    if (window.api && window.api.isElectron) {
      // PC SIDE: Show server info
      const ip = window.syncServerIp || '0.0.0.0';
      const port = window.syncServerPort || '...';

      panel.innerHTML = `
        <div class="sync-card host-card" style="background: var(--bg-surface-2); padding: 40px; border-radius: 24px; border: 1px solid var(--border); text-align: center; max-width: 500px; margin: 0 auto;">
            <div class="sync-icon-box" style="font-size: 4rem; color: var(--accent); margin-bottom: 25px;"><i class="fas fa-server"></i></div>
            <h3 style="font-size: 24px; font-weight: 800; color: #fff; margin-bottom: 12px;">Sync Server Active</h3>
            <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6; margin-bottom: 25px;">To connect your mobile device, enter this IP in the MediaVault mobile app:</p>
            
            <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); display: inline-block; min-width: 250px;">
                <div style="font-family: monospace; font-size: 22px; color: var(--accent); font-weight: 700; letter-spacing: 1px;">${ip}:${port}</div>
                ${(window.syncServerAllIps && window.syncServerAllIps.length > 1) ? `
                  <div style="font-size: 10px; color: var(--text-muted); margin-top: 10px; text-align: left; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.05);">
                    <div style="margin-bottom: 5px;">Alternative Addresses:</div>
                    ${window.syncServerAllIps.map(i => i !== ip ? `<div>${i}:${port}</div>` : '').join('')}
                  </div>
                ` : ''}
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; text-transform: uppercase;">Local Network Address</div>
            </div>
            
            <div style="margin-top: 30px; padding-top: 25px; border-top: 1px solid rgba(255,255,255,0.05);">
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 0;">Server Status: <span style="color: #22c55e; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;"><span class="pulse-dot" style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block; animation: pulse 1.5s infinite;"></span> ONLINE</span></p>
            </div>
        </div>
      `;
      return;
    }

    // MOBILE SIDE: Show discovery
    panel.innerHTML = `
      <div class="sync-card discovery-card" style="background: var(--bg-surface-2); padding: 30px; border-radius: 20px; border: 1px solid var(--border); text-align: center;">
          <div class="sync-icon-box" style="font-size: 3rem; color: var(--accent); margin-bottom: 20px;"><i class="fas fa-satellite-dish fa-spin"></i></div>
          <h3 style="font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 10px;">Searching for PCs...</h3>
          <p style="color: var(--text-muted); font-size: 13px; line-height: 1.6; max-width: 300px; margin: 0 auto 20px;">Ensure MediaVault is running on your computer and both devices are on the same Wi-Fi.</p>
          
          <div id="discovered-pcs-list" style="margin-bottom: 25px;"></div>

          <div id="manual-sync-box" style="margin-top: 25px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.05);">
              <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Discovery not working? Enter PC IP manually:</p>
              <div style="display: flex; gap: 8px; justify-content: center;">
                  <input type="text" id="input-manual-ip" placeholder="e.g. 192.168.1.5" style="width: 150px; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #fff;">
                  <button id="btn-manual-connect" class="btn-primary-sm" style="border-radius: 8px; height: 35px;">Connect</button>
              </div>
          </div>
      </div>
    `;

    // Handle Manual Connect click
    const btn = $('#btn-manual-connect');
    if (btn) {
      btn.onclick = () => {
        const raw = $('#input-manual-ip').value.trim();
        if (!raw) return showToast('Please enter an IP address');

        let ip = raw, port = window.syncServerPort || 3000;
        if (raw.includes(':')) {
          const parts = raw.split(':');
          ip = parts[0];
          port = parts[1];
        }

        connectToSyncPC({ name: 'Manual Connection', ip, port });
      };
    }

    // Auto-fill last manual IP if available
    const lastIp = await window.api.storageGet('last-sync-ip');
    const ipInput = document.getElementById('input-manual-ip');
    if (lastIp && ipInput) {
      ipInput.value = lastIp;
    }
  }

  function updateDiscoveryUI() {
    const panel = $('#sync-discovery-panel');
    if (!discoveredPCs.length) {
      panel.innerHTML = `<div style="padding: 40px; color: var(--text-muted);">No PCs found. Retry?</div>`;
      return;
    }

    panel.innerHTML = `
      <div class="view-header" style="padding-top: 0;">
        <h2 style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 20px;">Available Computers</h2>
      </div>
      <div class="pc-list" style="display: grid; gap: 15px;"></div>
    `;
    const list = panel.querySelector('.pc-list');
    discoveredPCs.forEach(pc => {
      const card = document.createElement('div');
      card.className = 'pc-card';
      card.style = "background: var(--bg-surface-2); padding: 20px; border-radius: 16px; border: 1px solid var(--border); display: flex; align-items: center; gap: 15px; cursor: pointer; transition: all 0.2s;";
      card.innerHTML = `
        <div style="width: 45px; height: 45px; background: var(--accent); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 20px;">
          <i class="fas fa-laptop"></i>
        </div>
        <div style="text-align: left;">
          <div style="font-weight: 800; color: #fff;">${pc.name}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${pc.ip}:${pc.port}</div>
        </div>
        <i class="fas fa-chevron-right" style="margin-left: auto; opacity: 0.3;"></i>
      `;
      card.onclick = () => connectToSyncPC(pc);
      list.appendChild(card);
    });
  }

  async function connectToSyncPC(pc) {
    currentSyncPC = pc;
    showToast(`Connecting to ${pc.name}...`);

    const fetchWithTimeout = async (url, options, timeout = 5000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    };

    try {
      // Try to verify connection first (Increased timeout for stability)
      const statusRes = await fetchWithTimeout(`http://${pc.ip}:${pc.port}/api/status`, {}, 10000);
      if (!statusRes.ok) throw new Error('Server not responding correctly');

      // Fetch library JSON from PC
      const res = await fetchWithTimeout(`http://${pc.ip}:${pc.port}/api/library`, {}, 8000);
      if (!res.ok) throw new Error('PC rejected library request');

      syncLibraryData = await res.json();
      await window.api.storageSet('last-sync-ip', pc.ip); // Save for later
      renderSync();
      showToast('Connected Successfully!');
    } catch (e) {
      console.error('[SYNC] Connection failed:', e);
      let errorMsg = 'Sync Error: ';
      if (e.name === 'AbortError') errorMsg += 'Connection Timeout (Check Wi-Fi)';
      else errorMsg += e.message;

      showToast(errorMsg);
      currentSyncPC = null;
      renderSync();
    }
  }

  function renderSyncLibrary() {
    const grid = $('#sync-grid');
    grid.innerHTML = '';

    const list = (syncLibraryData ? syncLibraryData[currentSyncTab] : []) || [];

    $('#sync-pc-name').textContent = currentSyncPC.name;
    $('#sync-pc-ip').textContent = `Local Server: ${currentSyncPC.ip}:${currentSyncPC.port}`;

    if (!list || list.length === 0) {
      $('#sync-empty').style.display = 'block';
      return;
    }

    $('#sync-empty').style.display = 'none';
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card fade-in';

      let poster = 'imgs/no-backdrop.png';
      if (item.poster_path) poster = localImg(item.poster_path);
      else if (item.id) poster = `http://${currentSyncPC.ip}:${currentSyncPC.port}/api/poster/${item.id}`;

      card.innerHTML = `
        <div class="poster-wrap">
          <img src="${poster}" class="poster" loading="lazy">
          <div class="play-overlay"><i class="fas fa-play"></i></div>
        </div>
        <div class="info">
          <div class="title" title="${escapeHTML(item.title || item.name)}">${escapeHTML(item.title || item.name)}</div>
          <div class="meta">${item.year || ''} • Remote</div>
        </div>
      `;
      card.onclick = () => playSyncMedia(item);
      grid.appendChild(card);
    });
  }

  function playSyncMedia(item) {
    if (!currentSyncPC) return;
    const streamUrl = `http://${currentSyncPC.ip}:${currentSyncPC.port}/stream?path=${encodeURIComponent(item.path)}`;

    showToast('Streaming from PC...');
    playVideo({
      ...item,
      id: item.id || item.path,
      path: streamUrl,
      isStream: true,
      remoteSync: true
    }, null);
  }

  // Sync View Event Listeners
  if (window.api && window.api.on) {
    window.api.on('sync-server-started', (data) => {
      console.log('[SYNC] Local server detected:', data.ip, ':', data.port);
      window.syncServerPort = data.port;
      window.syncServerIp = data.ip;
      window.syncServerAllIps = data.allIps || [data.ip];
    });
  }

  $('#btn-rescan-sync').onclick = () => {
    currentSyncPC = null;
    discoveredPCs = []; // Reset list on rescan
    renderSync();
  };

  $('#btn-manual-connect').onclick = () => {
    const manualIp = $('#input-manual-ip').value.trim();
    if (!manualIp) return showToast('Please enter an IP address');

    const port = window.syncServerPort || 52686;
    const pc = {
      name: `Manual PC (${manualIp})`,
      ip: manualIp,
      port: port
    };
    connectToSyncPC(pc);
  };

  $('#btn-disconnect-sync').onclick = () => {
    currentSyncPC = null;
    syncLibraryData = null;
    renderSync();
  };

  $$('.sync-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.sync-tab').forEach(t => {
        t.classList.remove('active', 'btn-primary-sm');
        t.classList.add('btn-outline-sm');
        t.style.borderColor = 'rgba(255,255,255,0.05)';
      });
      tab.classList.add('active', 'btn-primary-sm');
      tab.classList.remove('btn-outline-sm');
      tab.style.borderColor = 'transparent';
      currentSyncTab = tab.dataset.type;
      renderSyncLibrary();
    };
  });

  // Finalize UI with current version
  try {
    const ver = APP_VERSION || '11.6.0';
    if ($('#app-version-label')) $('#app-version-label').textContent = `MediaVault v${ver}`;
    if ($('#settings-app-version')) $('#settings-app-version').textContent = `v${ver}`;
  } catch (e) { }

  // --- Unified Cinematic Helpers ---
  window.toggleUnifiedLibrary = (item) => {
    toggleWatchlist(item);
    // Instant UI feedback for unified detail page
    if (typeof window.updateUnifiedWatchlistUI === 'function') {
      window.updateUnifiedWatchlistUI();
    }
  };

  window.toggleUnifiedWatched = (item) => {
    if (!currentProfile) return;
    const key = window.getPlaybackKey ? window.getPlaybackKey(item) : (item.id || item.path);
    if (!currentProfile.playback) currentProfile.playback = {};
    if (!currentProfile.playback[key]) {
      currentProfile.playback[key] = { time: 0, duration: 1, watched: true };
    } else {
      const pb = currentProfile.playback[key];
      const isW = pb.watched || (pb.duration > 0 && (pb.time / pb.duration) > .9);
      if (isW) {
        pb.watched = false;
        pb.time = 0;
      } else {
        pb.watched = true;
      }
    }

    // Automatically add to watchlist if it's marked as watched and not already in library
    if (currentProfile.playback[key].watched) {
      const inWatchlist = currentProfile.watchlist.some(i => isSameItem(i, item));
      if (!inWatchlist) {
        currentProfile.watchlist.unshift(item);
      }
    }

    persist(true);
    if (typeof window.updateUnifiedWatchlistUI === 'function') {
      window.updateUnifiedWatchlistUI();
    }
    if (currentView === 'watchlist') renderWatchlist();
    showToast(currentProfile.playback[key].watched ? 'Marked as Watched' : 'Marked as Unwatched');
  };

  // Provide a safe isInLibrary helper. `window.api` can be non-extensible
  // (exposed via contextBridge), so avoid assigning properties on it directly.
  const _isInLibrary = (id) => {
    if (!currentProfile) return false;
    return (currentProfile.watchlist || []).some(i => String(i.id) === String(id));
  };
  try {
    if (window.api && Object.isExtensible(window.api)) {
      window.api.isInLibrary = _isInLibrary;
    } else {
      // Fallback to a global helper used by renderer modules
      window.isInLibrary = _isInLibrary;
    }
  } catch (e) {
    // In case of any unexpected runtime protection, ensure fallback exists
    window.isInLibrary = _isInLibrary;
  }

  // ── Notification Center Implementation ──
  appData.notifications = appData.notifications || [];
  const notifiedInvitationIds = new Set();

  function updateNotificationBadge() {
    const badge = $('#header-notif-badge');
    if (!badge) return;
    const unread = (appData.notifications || []).filter(n => !n.read).length;
    if (unread > 0) {
      badge.textContent = unread;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  function showNativeNotification(title, message) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, { body: message });
          }
        });
      }
    } catch (e) {
      console.warn('Native notification failed:', e);
    }
  }

  function addNotification(title, message, type = 'system') {
    appData.notifications = appData.notifications || [];
    
    // Prevent duplicate entries within 3 seconds
    const duplicate = appData.notifications.some(n => n.title === title && n.message === message && (Date.now() - n.time < 3000));
    if (duplicate) return;

    const notif = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      message,
      time: Date.now(),
      type,
      read: false
    };
    appData.notifications.unshift(notif);
    
    if (appData.notifications.length > 50) {
      appData.notifications.pop();
    }
    
    persist();
    updateNotificationBadge();
    
    // Trigger OS notification for chat, download, and invite types
    if (type === 'chat' || type === 'download' || type === 'invite') {
      showNativeNotification(title, message);
    }
    
    const popout = document.getElementById('notifications-popout');
    if (popout) {
      renderNotificationsList(popout);
    }
  }
  window.addNotification = addNotification;

  $('#btn-header-notifications')?.addEventListener('click', (e) => showNotificationsPopout(e));

  function showNotificationsPopout(e) {
    const existing = document.getElementById('notifications-popout');
    if (existing) { existing.remove(); return; }
    
    document.getElementById('downloads-popout')?.remove();

    const popout = document.createElement('div');
    popout.id = 'notifications-popout';
    popout.style.cssText = `
      position: fixed;
      top: 45px;
      right: 140px;
      width: 340px;
      max-height: 480px;
      background: #12121a;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.8);
      z-index: 1000001;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: popIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    popout.innerHTML = `
      <div style="padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02);">
        <span style="font-weight: 800; font-size: 14px; letter-spacing: 0.5px; color: #fff;">NOTIFICATIONS</span>
        <div style="display: flex; gap: 14px; align-items: center;">
           <i class="fas fa-check-double" id="btn-popout-mark-all" title="Mark All as Read" style="cursor: pointer; opacity: 0.6; font-size: 14px; transition: all 0.2s; color: var(--accent);"></i>
           <i class="fas fa-trash-alt" id="btn-popout-clear-all" title="Clear All" style="cursor: pointer; opacity: 0.6; font-size: 14px; transition: all 0.2s; color: #ef4444;"></i>
        </div>
      </div>
      <div id="popout-notif-list" style="flex: 1; overflow-y: auto; padding: 10px; min-height: 120px; display: flex; flex-direction: column; gap: 8px;">
      </div>
    `;

    document.body.appendChild(popout);

    renderNotificationsList(popout);

    const markAllBtn = popout.querySelector('#btn-popout-mark-all');
    if (markAllBtn) {
      markAllBtn.onclick = () => {
        (appData.notifications || []).forEach(n => n.read = true);
        persist();
        updateNotificationBadge();
        renderNotificationsList(popout);
        showToast('All notifications marked as read');
      };
    }

    const clearAllBtn = popout.querySelector('#btn-popout-clear-all');
    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        appData.notifications = [];
        persist();
        updateNotificationBadge();
        renderNotificationsList(popout);
        showToast('Notifications cleared');
      };
    }

    const closeNotifPopout = (ev) => {
      if (!popout.contains(ev.target) && !document.getElementById('btn-header-notifications').contains(ev.target)) {
        popout.remove();
        document.removeEventListener('mousedown', closeNotifPopout);
        (appData.notifications || []).forEach(n => n.read = true);
        persist();
        updateNotificationBadge();
      }
    };
    document.addEventListener('mousedown', closeNotifPopout);
  }

  function renderNotificationsList(popout) {
    const listEl = popout.querySelector('#popout-notif-list');
    if (!listEl) return;
    const notifs = appData.notifications || [];
    if (notifs.length === 0) {
      listEl.innerHTML = `<div style="padding: 40px 20px; text-align: center; opacity: 0.4; font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
        <i class="fas fa-bell-slash" style="font-size: 24px;"></i>
        <span>No notifications yet</span>
      </div>`;
      return;
    }

    listEl.innerHTML = '';
    notifs.forEach(n => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        cursor: pointer;
        background: ${n.read ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.07)'};
        border: 1px solid ${n.read ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.2)'};
        position: relative;
        transition: all 0.2s;
      `;

      // Icon per type
      const iconMap = {
        invite:   { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', icon: 'fa-user-plus' },
        chat:     { bg: 'rgba(99,102,241,0.12)',   color: '#818cf8', icon: 'fa-comment-alt' },
        download: { bg: 'rgba(16,185,129,0.12)',   color: '#10b981', icon: 'fa-download' },
        status:   { bg: 'rgba(0,173,181,0.12)',    color: '#00adb5', icon: 'fa-circle-dot' },
        system:   { bg: 'rgba(245,158,11,0.10)',   color: '#f59e0b', icon: 'fa-bell' },
      };
      const iconInfo = n.read
        ? { bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)', icon: 'fa-check' }
        : (iconMap[n.type] || iconMap.system);

      const iconHTML = `<div style="width: 30px; height: 30px; border-radius: 9px; background: ${iconInfo.bg}; color: ${iconInfo.color}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;"><i class="fas ${iconInfo.icon}" style="font-size: 12px;"></i></div>`;

      const diffMs = Date.now() - n.time;
      let timeStr = 'Just now';
      if (diffMs > 60000) {
        const mins = Math.floor(diffMs / 60000);
        timeStr = mins < 60 ? `${mins}m ago` : (mins < 1440 ? `${Math.floor(mins/60)}h ago` : new Date(n.time).toLocaleDateString());
      }

      item.innerHTML = `
        ${iconHTML}
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span style="font-weight: 700; font-size: 12px; color: ${n.read ? 'rgba(255,255,255,0.5)' : '#fff'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(n.title)}</span>
            <span style="font-size: 9px; color: var(--text-muted); flex-shrink: 0; margin-left: 8px;">${timeStr}</span>
          </div>
          <p style="margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4; word-break: break-word;">${escapeHTML(n.message)}</p>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; opacity: 0; transition: opacity 0.2s;" class="notif-actions">
          ${!n.read ? `<button class="notif-read-btn" title="Mark as read" style="background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); color: #818cf8; cursor: pointer; padding: 3px 5px; border-radius: 6px; line-height: 1;"><i class="fas fa-check" style="font-size: 9px;"></i></button>` : ''}
          <button class="notif-delete-btn" title="Delete" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171; cursor: pointer; padding: 3px 5px; border-radius: 6px; line-height: 1;"><i class="fas fa-times" style="font-size: 9px;"></i></button>
        </div>
        ${!n.read ? `<div style="position: absolute; top: 10px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: #6366f1; class="notif-unread-dot"></div>` : ''}
      `;

      item.onmouseenter = () => { const a = item.querySelector('.notif-actions'); if (a) a.style.opacity = '1'; };
      item.onmouseleave = () => { const a = item.querySelector('.notif-actions'); if (a) a.style.opacity = '0'; };

      // Click item → mark as read
      item.addEventListener('click', (e) => {
        if (e.target.closest('.notif-actions')) return;
        if (!n.read) {
          n.read = true;
          persist();
          updateNotificationBadge();
          renderNotificationsList(popout);
        }
      });

      // Read button
      const readBtn = item.querySelector('.notif-read-btn');
      if (readBtn) {
        readBtn.onclick = (e) => {
          e.stopPropagation();
          n.read = true;
          persist();
          updateNotificationBadge();
          renderNotificationsList(popout);
        };
      }

      // Delete button
      const delBtn = item.querySelector('.notif-delete-btn');
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          item.style.opacity = '0';
          item.style.transform = 'translateX(10px)';
          setTimeout(() => {
            appData.notifications = (appData.notifications || []).filter(x => x.id !== n.id);
            persist();
            updateNotificationBadge();
            renderNotificationsList(popout);
          }, 200);
        };
      }

      listEl.appendChild(item);
    });
  }

  let globalMessagesChannel = null;
  async function initGlobalNotifications() {
    updateNotificationBadge();

    const client = window.getSupabaseRendererClient?.();
    if (!client) return;

    if (globalMessagesChannel) {
      globalMessagesChannel.unsubscribe();
      globalMessagesChannel = null;
    }

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user?.id) return;

    globalMessagesChannel = client
      .channel('global-messages-channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collection_messages'
        },
        async (payload) => {
          if (!payload.new) return;
          const listId = payload.new.list_id;

          const belongsToList = window.currentProfile?.custom_lists?.some(l => String(l.id) === String(listId));
          if (!belongsToList) return;

          const isMyMessage = window.currentProfile && String(payload.new.profile_id) === String(window.currentProfile.id);
          if (isMyMessage) return;

          const listObj = window.currentProfile?.custom_lists?.find(l => String(l.id) === String(listId));
          const listName = listObj?.name || 'Collection';

          let senderName = 'A friend';
          try {
            const { data: prof } = await client
              .from('account_profiles')
              .select('name')
              .eq('id', payload.new.profile_id)
              .maybeSingle();
            if (prof?.name) senderName = prof.name;
          } catch (e) {}

          const messageText = payload.new.message || 'sent a message';
          addNotification(
            `New Message in ${listName}`,
            `${senderName}: ${messageText}`,
            'chat'
          );
        }
      )
      .subscribe();
  }

  window.removeFromDownloadHistory = removeFromDownloadHistory;
  window.isInLibrary = _isInLibrary; // redundant but safe for both branches

  $('#btn-header-downloads')?.addEventListener('click', (e) => showDownloadsPopout(e));

  function showDownloadsPopout(e) {
    const existing = document.getElementById('downloads-popout');
    if (existing) { existing.remove(); return; }

    document.getElementById('notifications-popout')?.remove();

    const popout = document.createElement('div');
    popout.id = 'downloads-popout';
    popout.style.cssText = `
      position: fixed;
      top: 45px;
      right: 100px;
      width: 320px;
      max-height: 450px;
      background: #12121a;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.8);
      z-index: 1000001;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: popIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    popout.innerHTML = `
      <div style="padding: 15px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02);">
        <span style="font-weight: 800; font-size: 14px; letter-spacing: 0.5px; color: #fff;">DOWNLOADS</span>
        <div style="display: flex; gap: 14px; align-items: center;">
           <i class="fas fa-folder-open" id="btn-popout-open-folder" title="Open Folder" style="cursor: pointer; opacity: 0.6; font-size: 15px; transition: all 0.2s;"></i>
           <i class="fas fa-external-link-alt" onclick="switchView('downloads'); document.getElementById('downloads-popout')?.remove();" title="View Full List" style="cursor: pointer; opacity: 0.6; font-size: 14px; transition: all 0.2s;"></i>
        </div>
      </div>
      <div id="popout-dl-list" style="flex: 1; overflow-y: auto; padding: 10px; min-height: 100px;">
        <div style="padding: 30px; text-align: center; opacity: 0.4; font-size: 12px;">No recent activity</div>
      </div>
    `;

    document.body.appendChild(popout);

    // Initial render call to fill the list
    if (typeof renderDownloadHistory === 'function') renderDownloadHistory();
    if (typeof renderActiveDownloads === 'function') renderActiveDownloads();

    const openFolderBtn = popout.querySelector('#btn-popout-open-folder');
    if (openFolderBtn) {
      openFolderBtn.onmouseenter = () => { openFolderBtn.style.opacity = '1'; openFolderBtn.style.color = 'var(--accent)'; };
      openFolderBtn.onmouseleave = () => { openFolderBtn.style.opacity = '0.6'; openFolderBtn.style.color = ''; };
      openFolderBtn.onclick = () => window.api.invoke('open-downloads-folder');
    }

    const closePopout = (ev) => {
      if (!popout.contains(ev.target) && !document.getElementById('btn-header-downloads').contains(ev.target)) {
        popout.remove();
        document.removeEventListener('mousedown', closePopout);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closePopout), 10);
  }

  // Android Hardware Back Button Handling
  if (window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
      // 1. Close any open modals
      const activeModal = document.querySelector('.modal[style*="display: flex"], .modal[style*="display: block"]');
      if (activeModal) {
        activeModal.style.display = 'none';
        return;
      }
      // 2. If in details view, go back to previous view
      if (currentView === 'details') {
        $('#btn-back-discover')?.click();
        return;
      }
      // 3. If not on Vault home, go there
      if (currentView !== 'vault') {
        switchView('vault');
        return;
      }
      // 4. Exit if already on vault
      window.Capacitor.Plugins.App.exitApp();
    });
  }

  $('#ctx-regen-thumb').onclick = () => {
    $('#context-menu').style.display = 'none';
    if (!contextTarget) return;
    showToast('Regenerating thumbnail...');
    ensureThumbnail(contextTarget, true);
  };

  window.scrollRecommendations = function(direction) {
    const grid = document.getElementById('recommendations-grid');
    if (!grid) return;
    const scrollAmount = window.innerWidth < 768 ? 300 : 600;
    if (direction === 'left') {
      grid.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
      grid.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // ── Deep link handler (non-OAuth: add-ons, etc.) ─────────────────────────
  window.handleAppDeepLink = async (urlStr) => {
    if (urlStr.startsWith('mediavault://') && window.installAddonFromUrl) {
      try {
        const manifestUrl = urlStr.replace('mediavault://', 'https://');
        await window.installAddonFromUrl(manifestUrl);
      } catch (err) {
        console.error('[DeepLink] Addon installation error:', err);
      }
    }
  };

  const recovCancel = document.getElementById('recovery-cancel-btn');
  const recovUpdate = document.getElementById('recovery-update-btn');
  if (recovCancel) recovCancel.onclick = () => document.getElementById('modal-password-recovery').style.display = 'none';
  if (recovUpdate) {
    recovUpdate.onclick = async () => {
      const newPass = document.getElementById('recovery-new-password').value;
      if (!newPass || newPass.trim().length < 6) {
        showToast('Password must be at least 6 characters');
        return;
      }
      try {
        const client = getSupabaseRendererClient();
        recovUpdate.disabled = true;
        recovUpdate.textContent = 'Updating...';
        const { error } = await client.auth.updateUser({ password: newPass.trim() });
        if (error) throw error;
        document.getElementById('modal-password-recovery').style.display = 'none';
        document.getElementById('recovery-new-password').value = '';
        showToast('Password successfully updated!');
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        recovUpdate.disabled = false;
        recovUpdate.textContent = 'Update Password';
      }
    };
  }



  const logoutCancel = document.getElementById('logout-cancel-btn');
  const logoutConfirm = document.getElementById('logout-confirm-btn');
  if (logoutCancel) logoutCancel.onclick = () => document.getElementById('modal-account-logout').style.display = 'none';
  if (logoutConfirm) {
    logoutConfirm.onclick = async () => {
      try {
        logoutConfirm.disabled = true;
        logoutConfirm.textContent = 'Logging out...';
        
        // Hide modal
        document.getElementById('modal-account-logout').style.display = 'none';
        
        showToast('Logged out successfully.');
        await finalizeLogout();
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        logoutConfirm.disabled = false;
        logoutConfirm.textContent = 'Confirm Logout';
      }
    };
  }

  const resetCancel = document.getElementById('reset-otp-cancel-btn');
  const resetConfirm = document.getElementById('reset-otp-confirm-btn');
  if (resetCancel) resetCancel.onclick = () => document.getElementById('modal-password-reset-otp').style.display = 'none';
  if (resetConfirm) {
    resetConfirm.onclick = async () => {
      const code = document.getElementById('reset-otp-code').value;
      const newPass = document.getElementById('reset-new-password').value;
      if (!code || code.trim().length !== 8) {
        showToast('Please enter a valid 8-digit verification code');
        return;
      }
      if (!newPass || newPass.trim().length < 6) {
        showToast('Password must be at least 6 characters');
        return;
      }
      try {
        const client = getSupabaseRendererClient();
        resetConfirm.disabled = true;
        resetConfirm.textContent = 'Verifying...';
        
        const { error: otpError } = await client.auth.verifyOtp({
          email: appData.user.email,
          token: code.trim(),
          type: 'recovery'
        });
        if (otpError) throw otpError;
        
        resetConfirm.textContent = 'Updating Password...';
        const { error: updateError } = await client.auth.updateUser({ password: newPass.trim() });
        if (updateError) throw updateError;
        
        document.getElementById('modal-password-reset-otp').style.display = 'none';
        document.getElementById('reset-otp-code').value = '';
        document.getElementById('reset-new-password').value = '';
        showToast('Password successfully reset!');
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        resetConfirm.disabled = false;
        resetConfirm.textContent = 'Reset Password';
      }
    };
  }

  const emailChangeCancel = document.getElementById('email-change-otp-cancel-btn');
  const emailChangeConfirm = document.getElementById('email-change-otp-confirm-btn');
  const emailChangeModal = document.getElementById('modal-email-change-otp');
  if (emailChangeCancel) emailChangeCancel.onclick = () => document.getElementById('modal-email-change-otp').style.display = 'none';
  if (emailChangeConfirm) {
    emailChangeConfirm.onclick = async () => {
      const code = document.getElementById('email-change-otp-code').value;
      const newEmail = emailChangeModal.dataset.newEmail;
      if (!code || code.trim().length < 6) {
        showToast('Please enter a valid verification code');
        return;
      }
      if (!newEmail) {
        showToast('Error: Target email not found');
        return;
      }
      try {
        const client = getSupabaseRendererClient();
        emailChangeConfirm.disabled = true;
        emailChangeConfirm.textContent = 'Verifying...';
        
        const { error: otpError } = await client.auth.verifyOtp({
          email: newEmail,
          token: code.trim(),
          type: 'email_change'
        });
        if (otpError) throw otpError;
        
        document.getElementById('modal-email-change-otp').style.display = 'none';
        document.getElementById('email-change-otp-code').value = '';
        
        appData.user.email = newEmail;
        persist();
        
        showToast('Email successfully updated!');
        renderAccount();
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        emailChangeConfirm.disabled = false;
        emailChangeConfirm.textContent = 'Verify & Update';
      }
    };
  }
  const emailChangeCheckLink = document.getElementById('email-change-check-link-btn');
  if (emailChangeCheckLink) {
    emailChangeCheckLink.onclick = async () => {
      const newEmail = emailChangeModal.dataset.newEmail;
      if (!newEmail) {
        showToast('Error: Target email not found');
        return;
      }
      try {
        emailChangeCheckLink.disabled = true;
        emailChangeCheckLink.textContent = 'Checking...';
        
        const client = getSupabaseRendererClient();
        const { data: { user }, error } = await client.auth.getUser();
        
        if (error) throw error;
        
        if (user && user.email === newEmail) {
          document.getElementById('modal-email-change-otp').style.display = 'none';
          document.getElementById('email-change-otp-code').value = '';
          
          appData.user.email = newEmail;
          persist();
          
          showToast('Email successfully updated!');
          renderAccount();
        } else {
          showToast('Email not verified yet. Please make sure you clicked the activation link in the email.');
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        emailChangeCheckLink.disabled = false;
        emailChangeCheckLink.textContent = 'I\'ve Clicked the Link / التحقق من التفعيل';
      }
    };
  }
  // ── Global Window Bindings for Modular Logic ──
  window.persist = persist;
  window.showDisclaimerAndProceed = showDisclaimerAndProceed;
  window.showToast = showToast;
  window.switchView = switchView;
  window.renderMovies = renderMovies;
  window.renderShows = renderShows;
  window.renderLibContinueWatching = renderLibContinueWatching;
  window.renderLibContinueListening = renderLibContinueListening;
  window.renderLibRecentWatchlist = renderLibRecentWatchlist;
  window.updateBadges = updateBadges;
  window.renderSidebar = renderSidebar;
  window.updateModGatedViews = updateModGatedViews;
  window.renderWatchlist = renderWatchlist;
  window.renderLibCustomLists = renderLibCustomLists;
  window.renderCustomListDetail = renderCustomListDetail;
  window.createNewCustomList = createNewCustomList;
  window.showCreateListModal = showCreateListModal;
  window.renderSocial = renderSocial;
  window.renderMusic = renderMusic;
  window.createMediaCard = createMediaCard;
  window.isLocked = isLocked;
  window.isAgeAllowed = isAgeAllowed;
  window.bumpBannerRevision = bumpBannerRevision;
  window.localImg = localImg;
  window.escapeHTML = escapeHTML;
  window.openShowDetail = openShowDetail;
  window.renderActiveDownloads = renderActiveDownloads;
  window.renderDownloadHistory = renderDownloadHistory;
  window.updateDownloadBadge = updateDownloadBadge;
  window.removeFromDownloadHistory = removeFromDownloadHistory;
  window.resetPinInputs = resetPinInputs;
  window.openVault = openVault;
  window.lockVault = lockVault;
  window.updateVaultUI = updateVaultUI;
  window.toggleLock = toggleLock;
  window.handleVaultAuth = handleVaultAuth;
  window.renderAll = renderAll;
  window.isNativePlayerWindow = isNativePlayerWindow;
  window.isChatWindow = isChatWindow;
  window.ensureDefaultAddons = ensureDefaultAddons;
  window.selectProfile = selectProfile;
  window.openProfileModal = openProfileModal;
  window.initStremioAddonsUI = initStremioAddonsUI;
  window.initSubdlUI = initSubdlUI;
  window.initTraktUI = initTraktUI;
  window.syncTraktWatchlistToLocal = syncTraktWatchlistToLocal;
  window.syncTraktContinueWatching = syncTraktContinueWatching;
  window.scrobbleToTrakt = scrobbleToTrakt;
  window.initVisualizer = initVisualizer;
  window.allItems = allItems;
  window.updateWatchlistButton = updateWatchlistButton;
  window.toggleWatchlist = toggleWatchlist;
  window.getMetadataForItem = getMetadataForItem;
  window.isLocalFilePath = isLocalFilePath;
  window.renderSidebarFolders = renderSidebarFolders;
  window.certificationToAge = certificationToAge;
  window.getItemAgeRating = getItemAgeRating;
  window.getItemCertification = getItemCertification;
  window.getAgeBadgeHTML = getAgeBadgeHTML;
  window.getTraktOrImdbPoster = getTraktOrImdbPoster;
  window.tmdbShowIdCache = tmdbShowIdCache;
  window.EpisodeMetadataResolver = EpisodeMetadataResolver;
  window.syncTray = syncTray;
  window.ensureSeasonMetadata = ensureSeasonMetadata;

  // ── Sidebar Accordion Submenu Manager ──────────────────────────────────────
  function initFlyoutMenus() {
    const flyoutWraps = document.querySelectorAll('.sidebar-flyout-wrap');

    flyoutWraps.forEach(wrap => {
      const btn = wrap.querySelector('.nav-flyout-btn');
      const menu = wrap.querySelector('.sidebar-flyout-menu');
      if (!btn || !menu) return;

      // Ensure menu is inside wrap (inline accordion under button)
      if (menu.parentElement !== wrap) {
        wrap.appendChild(menu);
      }

      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = wrap.classList.contains('open');

        // Close other accordion menus if any
        flyoutWraps.forEach(w => {
          if (w !== wrap) w.classList.remove('open');
        });

        // Toggle open
        wrap.classList.toggle('open', !isOpen);
      };
    });
  }

  // Init flyouts after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFlyoutMenus);
  } else {
    setTimeout(initFlyoutMenus, 0);
  }
  window.initFlyoutMenus = initFlyoutMenus;

  // ─── YOUTUBE OAUTH2 & SETTINGS MODALS ───
  window.openYouTubeSettingsModal = async () => {
    let modal = $('#youtube-settings-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'youtube-settings-modal';
      modal.className = 'modal-backdrop fade-in';
      modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:99999;';
      modal.innerHTML = `
        <div style="background:var(--bg-surface-1, #1e1e24); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:32px; width:480px; max-width:92vw; text-align:left; box-shadow:0 20px 50px rgba(0,0,0,0.6);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:14px;">
            <h2 style="font-size:1.3rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px; margin:0;">
              <i class="fab fa-youtube" style="color:#ff4b4b; font-size:24px;"></i> YouTube Add-on Settings
            </h2>
            <button onclick="closeYouTubeSettingsModal()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:18px;"><i class="fas fa-times"></i></button>
          </div>

          <div id="yt-settings-account-box" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:18px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:14px;">
              <img id="yt-settings-avatar" src="https://lh3.googleusercontent.com/a/default-user=s96-c" style="width:44px; height:44px; border-radius:50%; border:2px solid #ff4b4b; object-fit:cover;">
              <div>
                <div id="yt-settings-name" style="font-weight:700; color:#fff; font-size:0.95rem;">Checking Google Account...</div>
                <div id="yt-settings-email" style="font-size:0.8rem; color:var(--text-muted);">---</div>
              </div>
            </div>
            <button id="yt-settings-auth-btn" class="btn btn-primary" style="background:#ff4b4b; border:none; padding:8px 16px; font-size:0.85rem; border-radius:8px; font-weight:700; cursor:pointer;">Sign in</button>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.9rem; color:#ccc;">
              <span><i class="fas fa-history" style="color:#ff4b4b; margin-right:8px;"></i> Watch History Sync</span>
              <span style="color:#4caf50; font-weight:700; font-size:0.8rem;">ENABLED</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.9rem; color:#ccc;">
              <span><i class="fas fa-bell" style="color:#ff4b4b; margin-right:8px;"></i> Subscriptions Feed</span>
              <span style="color:#4caf50; font-weight:700; font-size:0.8rem;">ENABLED</span>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn btn-secondary" onclick="closeYouTubeSettingsModal()" style="padding:8px 20px; border-radius:8px;">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    updateYouTubeSettingsAccountUI();
  };

  window.closeYouTubeSettingsModal = () => {
    const modal = $('#youtube-settings-modal');
    if (modal) modal.style.display = 'none';
  };

  async function updateYouTubeSettingsAccountUI() {
    try {
      const res = await window.api.invoke('youtube-get-account');
      const nameEls = [$('#yt-account-name'), $('#yt-settings-name')].filter(Boolean);
      const emailEls = [$('#yt-account-email'), $('#yt-settings-email')].filter(Boolean);
      const avatarEls = [$('#yt-account-avatar'), $('#yt-settings-avatar')].filter(Boolean);
      const authBtns = [$('#btn-yt-auth-action'), $('#yt-settings-auth-btn')].filter(Boolean);
      const authLabel = $('#yt-auth-btn-label');

      if (res && res.signedIn && res.account) {
        nameEls.forEach(el => el.textContent = res.account.name || 'Google User');
        emailEls.forEach(el => el.textContent = res.account.email || 'Signed in via Google OAuth');
        avatarEls.forEach(el => el.src = res.account.avatar || 'https://lh3.googleusercontent.com/a/default-user=s96-c');
        if (authLabel) authLabel.textContent = 'Sign Out';
        authBtns.forEach(btn => {
          if (!authLabel) btn.textContent = 'Sign Out';
          btn.style.background = 'rgba(255,255,255,0.1)';
          btn.onclick = async () => {
            await window.api.invoke('youtube-sign-out');
            showToast('👋 Signed out of Google.');
            updateYouTubeSettingsAccountUI();
            if (typeof loadDiscover === 'function') loadDiscover(true);
          };
        });
      } else {
        nameEls.forEach(el => el.textContent = 'Not Signed In');
        emailEls.forEach(el => el.textContent = 'Sign in to sync subscriptions & watch history');
        avatarEls.forEach(el => el.src = 'https://lh3.googleusercontent.com/a/default-user=s96-c');
        if (authLabel) authLabel.textContent = 'Sign In';
        authBtns.forEach(btn => {
          if (!authLabel) btn.textContent = 'Sign in with Google';
          btn.style.background = '#ff0000';
          btn.onclick = () => {
            closeYouTubeSettingsModal();
            openGoogleAuthModal();
          };
        });
      }
    } catch (e) {
      console.warn('[YouTube Settings] Error fetching account info:', e);
    }
  }

  window.updateYouTubeSettingsAccountUI = updateYouTubeSettingsAccountUI;
  setTimeout(() => updateYouTubeSettingsAccountUI(), 1000);

  window.openGoogleAuthModal = async () => {
    let modal = $('#google-auth-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'google-auth-modal';
      modal.className = 'modal-backdrop fade-in';
      modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:99999;';
      modal.innerHTML = `
        <div style="background:var(--bg-surface-1, #1e1e24); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:32px; width:480px; max-width:92vw; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.6);">
          <div style="width:60px; height:60px; background:rgba(255,75,75,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto; color:#ff4b4b;">
            <i class="fab fa-youtube" style="font-size:32px;"></i>
          </div>
          <h2 style="font-size:1.4rem; font-weight:800; color:#fff; margin-bottom:8px;">Sign in with Google</h2>
          <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:24px; line-height:1.5;">Connect your YouTube account to sync Watch History, Subscriptions & Recommendations.</p>

          <div id="yt-auth-loading" style="padding:20px; color:var(--text-muted); font-size:0.9rem;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color:#ff4b4b; margin-bottom:12px; display:block;"></i>
            Generating device authorization code...
          </div>

          <div id="yt-auth-instructions" style="display:none; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:20px; margin-bottom:24px; text-align:left;">
            <div style="font-weight:700; color:#fff; margin-bottom:10px; font-size:0.95rem;">Follow these simple steps:</div>
            <ol style="margin:0; padding-left:20px; font-size:0.88rem; color:#ccc; line-height:1.9;">
              <li>Open <a id="yt-auth-url-link" href="#" target="_blank" style="color:#ff4b4b; font-weight:700; text-decoration:underline;">google.com/device</a> in your browser.</li>
              <li>Enter code: <strong id="yt-auth-user-code" style="color:#fff; font-size:1.15rem; background:rgba(255,75,75,0.2); padding:3px 10px; border-radius:6px; letter-spacing:2px; font-family:monospace; user-select:all;">---</strong></li>
              <li>Authorize MEEM on your Google account.</li>
            </ol>
            <div style="margin-top:16px; display:flex; gap:10px; align-items:center;">
              <button id="btn-copy-yt-code" class="btn btn-primary btn-sm" style="flex:1; background:#ff4b4b; border-color:#ff4b4b; font-size:0.82rem; padding:8px 12px; border-radius:8px;">
                <i class="fas fa-copy"></i> Copy Code & Open Browser
              </button>
            </div>
            <div style="margin-top:14px; display:flex; align-items:center; gap:10px; font-size:0.82rem; color:var(--text-muted);">
              <i class="fas fa-sync-alt fa-spin" style="color:#ff4b4b;"></i> Waiting for authorization from browser...
            </div>
          </div>

          <div style="display:flex; gap:12px; justify-content:center;">
            <button class="btn btn-secondary" onclick="closeGoogleAuthModal()" style="padding:10px 24px; border-radius:10px;">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    $('#yt-auth-loading').style.display = 'block';
    $('#yt-auth-instructions').style.display = 'none';

    try {
      const unbindPending = window.api.on('youtube-auth-pending', (data) => {
        if (data && data.userCode) {
          $('#yt-auth-loading').style.display = 'none';
          $('#yt-auth-instructions').style.display = 'block';
          $('#yt-auth-user-code').textContent = data.userCode;
          const targetUrl = data.verificationUrl || 'https://www.google.com/device';
          const link = $('#yt-auth-url-link');
          if (link) {
            link.href = targetUrl;
            link.onclick = (e) => {
              e.preventDefault();
              window.api.openExternal(targetUrl);
            };
          }
          const copyBtn = $('#btn-copy-yt-code');
          if (copyBtn) {
            copyBtn.onclick = () => {
              navigator.clipboard?.writeText(data.userCode);
              window.api.openExternal(targetUrl);
              showToast('📋 Code copied to clipboard!');
            };
          }
        }
      });

      const res = await window.api.invoke('youtube-auth-start');
      if (unbindPending) unbindPending();

      if (res && res.success && res.account) {
        showToast(`✅ Successfully signed in as ${res.account.name}!`);
        closeGoogleAuthModal();
        updateYouTubeSettingsAccountUI();
        if (typeof loadDiscover === 'function') loadDiscover(true);
      } else {
        showToast(`❌ Sign in failed or cancelled: ${res?.error || 'Unknown error'}`);
        closeGoogleAuthModal();
      }
    } catch (err) {
      showToast(`❌ OAuth Error: ${err.message}`);
      closeGoogleAuthModal();
    }
  };

  window.closeGoogleAuthModal = () => {
    const modal = $('#google-auth-modal');
    if (modal) modal.style.display = 'none';
  };

})();
