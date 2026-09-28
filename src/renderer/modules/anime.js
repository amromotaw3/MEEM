(function () {
  'use strict';

  let discoverHeroItems = [];
  let discoverHeroIndex = 0;
  let discoverHeroInterval = null;

  // Cache for TV IDs
  const tmdbShowIdCache = {};

  // Metadata Resolver
  const EpisodeMetadataResolver = {
    cache: {},

    // Fetch TMDB TV ID from IMDb ID
    async getTmdbTvId(imdbId) {
      if (!imdbId || !String(imdbId).startsWith('tt')) return null;
      if (tmdbShowIdCache[imdbId]) return tmdbShowIdCache[imdbId];

      const tmdbKey = appData.tmdbKey || null;
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
      const tmdbKey = appData.tmdbKey || null;
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

  // Discover Scroll Helper
  window.scrollRow = (btn, dir) => {
    const row = btn.closest('.discover-section')?.querySelector('.discover-row, .media-row, .card-grid-row');
    if (!row) return;
    const amount = row.clientWidth * 0.8 * dir;
    row.scrollBy({ left: amount, behavior: 'smooth' });
  };

  // Discover Sidebar Listeners Setup
  const dsButtons = document.querySelectorAll('#discover-sidebar .nav-btn');
  dsButtons.forEach(btn => {
    btn.onclick = async () => {
      dsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const genre = btn.dataset.genre;
      const searchInput = $('#search-discover');
      if (searchInput) searchInput.placeholder = 'Search movies & shows...';
      if (genre === 'trending') {
        loadDiscover();
        return;
      }
      await loadDiscoverByGenre(genre, btn.querySelector('span').textContent);
    };
  });

  async function loadDiscoverByGenre(id, name) {
    window._activeDiscoverGenre = { id, name };
    const content = $('#discover-content');
    const results = $('#discover-results');
    const genreView = $('#discover-genre-view');
    if (content) content.style.display = 'none';
    if (results) results.style.display = 'none';
    if (genreView) genreView.style.display = 'block';

    const title = $('#discover-genre-title');
    if (title) title.textContent = name;

    const grid = $('#genre-grid');
    if (grid) {
      grid.innerHTML = '';
      for (let i = 0; i < 24; i++) {
        const skel = document.createElement('div');
        skel.className = 'discover-card-skeleton';
        skel.innerHTML = `<div class="discover-poster-wrap" style="aspect-ratio:2/3.1;background:var(--bg-surface-2);border-radius:12px;animation:pulse 1.5s infinite"></div>`;
        grid.appendChild(skel);
      }
    }

    try {
      let finalItems = [];
      if (id === '16') {
        const cinData = await window.api.cinemetaDiscoverByGenre('Animation');
        finalItems = (cinData?.results || []).map(m => ({
          id: m.id,
          imdb_id: m.id,
          title: m.name,
          name: m.name,
          overview: m.description,
          vote_average: parseFloat(m.imdbRating || 0),
          poster: m.poster,
          backdrop_path: m.background,
          media_type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          release_date: m.releaseInfo,
          first_air_date: m.releaseInfo,
          year: m.releaseInfo
        }));
      } else {
        const tmdbData = await window.api.tmdbDiscoverByGenre(id);
        finalItems = (tmdbData.results || []).filter(item => item.adult !== true);
      }
      finalItems = finalItems.filter(item => item.isLocal || !!(item.poster || item.poster_path || item.cover || item.thumbnail || item.banner || item.backdrop_path));
      renderDiscoverGrid('#genre-grid', finalItems);
    } catch {
      if (grid) grid.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load genre content.</div>';
    }
  }

  function renderContinueWatchingDiscover() {
    if (!currentProfile?.playback) return;
    const row = $('#discover-continue-row');
    if (!row) return;
    const section = $('#discover-continue-section') || row.closest('.bento-card') || row.parentElement;

    row.innerHTML = '';

    const items = Object.entries(currentProfile.playback).map(([key, pb]) => {
      const isYtKey = Boolean(
        (typeof key === 'string' && (/^[a-zA-Z0-9_-]{11}$/.test(key) || key.startsWith('yt:') || key.startsWith('yt_'))) ||
        pb.isYoutube || pb.type === 'youtube' ||
        pb.meta?.isYoutube || pb.meta?.type === 'youtube' ||
        (typeof pb.meta?.id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(pb.meta.id))
      );
      if (isYtKey) {
        const vId = (key.startsWith('yt:') || key.startsWith('yt_')) ? key.replace(/^yt[:_]/, '') : (pb.meta?.videoId || pb.meta?.id || key);
        const ytCached = (window.appData?.ytCache && window.appData.ytCache[vId]) || {};
        const ytThumb = ytCached.thumbnail || pb.meta?.thumbnail || pb.meta?.poster || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
        const rawTitle = pb.meta?.title || pb.title;
        const cleanTitle = (rawTitle && rawTitle !== vId && rawTitle !== 'Media' && rawTitle !== 'Playback') ? rawTitle : (ytCached.title || 'YouTube Video');
        pb.meta = {
          ...(pb.meta || {}),
          id: vId,
          videoId: vId,
          path: `https://www.youtube.com/watch?v=${vId}`,
          url: `https://www.youtube.com/watch?v=${vId}`,
          type: 'youtube',
          isYoutube: true,
          title: cleanTitle,
          author: ytCached.author || pb.meta?.author || 'YouTube',
          duration: ytCached.duration || pb.meta?.duration || pb.duration || 0,
          poster: ytThumb,
          thumbnail: ytThumb,
          backdrop_path: ytThumb,
          backdrop: ytThumb
        };
      } else if (!pb.meta) {
        const tmdbCache = appData.tmdbCache || {};
        let libItem = null;
        if (typeof allItems === 'function') {
          libItem = allItems().find(i => {
            const pk = getPlaybackKey(i);
            return pk === key || i.path === key || key.startsWith(i.path) || (i.path && key.includes(i.path));
          });
        }
        if (!libItem && Array.isArray(appData.shows)) {
          for (const s of appData.shows) {
            const ep = (s.episodes || []).find(e => e.path === key || key.startsWith(e.path) || (e.path && key.includes(e.path)));
            if (ep) {
              libItem = {
                ...ep,
                show: s,
                showTitle: s.title || s.name,
                backdrop_path: s.backdrop || s.backdropPath || s.cover || s.poster,
                poster_path: ep.thumbnail || s.poster || s.cover
              };
              break;
            }
          }
        }
        if (!libItem && Array.isArray(appData.movies)) {
          libItem = appData.movies.find(m => m.path === key || key.startsWith(m.path) || (m.path && key.includes(m.path)));
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
          } else {
            const cleanName = key.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || 'Media';
            pb.meta = {
              id: key,
              path: key,
              title: cleanName,
              season: seasonNum,
              episode: episodeNum
            };
          }
        }
      }
      if (pb.meta) {
        const isYtItem = pb.meta.isYoutube || pb.meta.type === 'youtube' ||
                         (typeof pb.meta.id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(pb.meta.id)) ||
                         (typeof key === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(key));
        if (isYtItem) {
          const vId = pb.meta.videoId || pb.meta.id || key;
          pb.meta.type = 'youtube';
          pb.meta.isYoutube = true;
          pb.meta.videoId = vId;
          const ytCached = (window.appData?.ytCache && window.appData.ytCache[vId]) || {};
          const ytThumb = ytCached.thumbnail || pb.meta.thumbnail || pb.meta.poster || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
          pb.meta.thumbnail = ytThumb;
          pb.meta.poster = ytThumb;
          pb.meta.backdrop_path = ytThumb;
          pb.meta.backdrop = ytThumb;
          if (!pb.meta.title || pb.meta.title === vId || pb.meta.title === 'Media' || pb.meta.title === 'Playback') {
            pb.meta.title = ytCached.title || 'YouTube Video';
          }
        }
        if (pb.torrentMagnet) {
          pb.meta.torrentMagnet = pb.torrentMagnet;
        }
        if (pb.fileIdx !== undefined && pb.fileIdx !== null) {
          pb.meta.fileIdx = pb.fileIdx;
        }

        // Re-hydrate local file path on app refresh if missing
        if (!pb.meta.path && window.appData) {
          if (typeof key === 'string' && (key.includes(':\\') || key.includes(':/') || key.startsWith('/'))) {
            pb.meta.path = key;
          } else {
            if (Array.isArray(appData.shows)) {
              for (const s of appData.shows) {
                const ep = (s.episodes || []).find(e => {
                  if (e.path && (e.path === key || key.includes(e.path))) return true;
                  if (pb.meta.season != null && pb.meta.episode != null && e.season == pb.meta.season && e.episode == pb.meta.episode) {
                    const sTitle = (s.title || s.cleanTitle || '').toLowerCase();
                    const showTitle = (pb.meta.showTitle || pb.meta.showName || '').toLowerCase();
                    if (!showTitle || !sTitle || sTitle === showTitle || sTitle.includes(showTitle) || showTitle.includes(sTitle)) return true;
                  }
                  return false;
                });
                if (ep && ep.path) {
                  pb.meta.path = ep.path;
                  if (!pb.meta.show) pb.meta.show = s;
                  break;
                }
              }
            }
            if (!pb.meta.path && Array.isArray(appData.movies)) {
              const m = appData.movies.find(mv => mv.path && (mv.path === key || key.includes(mv.path)));
              if (m && m.path) pb.meta.path = m.path;
            }
          }
        }
      }
      return pb;
    }).filter(pb => {
      return pb && pb.time > 5 && !pb.watched && pb.meta && (typeof isAgeAllowed === 'function' ? isAgeAllowed(pb.meta) : true);
    }).sort((a, b) => {
      return (b.lastWatched || 0) - (a.lastWatched || 0);
    });

    const seenShows = new Set();
    const itemsToRender = items.filter(pb => {
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
          if (base.match(/Season\s+\d+|S\d+|╪º┘ä╪¡┘ä┘é╪⌐|Part\s+\d+/i)) {
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

    if (itemsToRender.length > 0) {
      itemsToRender.forEach(pb => {
        const item = pb.meta;
        const card = document.createElement('div');
        card.className = 'continue-card';

        const progress = Math.min((pb.time / pb.duration) * 100, 100).toFixed(1);

        const tmdbCache = appData.tmdbCache || {};
        const cinemetaCache = appData.cinemetaCache || {};
        const isEpisode = item.season !== undefined && item.episode !== undefined;
        let displayTitle = item.title || item.name;

        const isYtItem = Boolean(
          item.isYoutube || item.type === 'youtube' ||
          (typeof item.id === 'string' && (/^[a-zA-Z0-9_-]{11}$/.test(item.id) || item.id.startsWith('yt:'))) ||
          (typeof pb.key === 'string' && (/^[a-zA-Z0-9_-]{11}$/.test(pb.key) || pb.key.startsWith('yt:')))
        );

        if (isYtItem) {
          const vId = (item.videoId || item.id || pb.key || '').replace(/^yt[:_]/, '');
          const cachedYt = (window.appData?.ytCache && window.appData.ytCache[vId]) || {};
          if (!displayTitle || displayTitle === vId || displayTitle === 'Media' || displayTitle === 'Playback') {
            displayTitle = cachedYt.title || 'YouTube Video';
          }
        }

        // 1. Locate showObj reliably
        let showObj = item.show;
        if (isEpisode && !showObj) {
          showObj = (appData.shows || []).find(s => {
            if (item.showId && (s.id === item.showId || s.imdb_id === item.showId)) return true;
            if (item.path && s.path && (item.path === s.path || item.path.startsWith(s.path))) return true;
            if (item.folder && s.folder && item.folder === s.folder) return true;
            if (item.showName && (s.title === item.showName || s.cleanTitle === item.showName)) return true;
            if (item.showTitle && (s.title === item.showTitle || s.cleanTitle === item.showTitle)) return true;
            return (s.episodes || []).some(e => (item.path && e.path === item.path) || (typeof getPlaybackKey === 'function' && getPlaybackKey(e) === getPlaybackKey(item)));
          });
        }

        let subtitle = isYtItem
          ? (((window.appData?.ytCache && window.appData.ytCache[(item.videoId || item.id || pb.key || '').replace(/^yt[:_]/, '')]?.author) || item.author || 'YouTube'))
          : (isEpisode ? (item.showName || item.showTitle || (showObj && (showObj.title || showObj.cleanTitle)) || 'TV Show') : '');

        // 2. Comprehensive metadata lookup across TMDB, Cinemeta, and showObj keys
        let metaCache = null;
        if (typeof getMetadataForItem === 'function') {
          if (showObj) metaCache = getMetadataForItem(showObj);
          if (!metaCache) metaCache = getMetadataForItem(item);
        }

        if (!metaCache || (!metaCache.seasons && !metaCache.videos)) {
          const candidateKeys = [
            showObj?.id, showObj?.imdb_id, showObj?.imdbId, showObj?.tmdbId, showObj?.tmdb_id, showObj?.cinemetaId,
            showObj?.cleanTitle, showObj?.title, showObj?.path,
            item.showId, item.imdb_id, item.imdbId, item.tmdbId, item.tmdb_id, item.id, item.showName, item.showTitle,
            pb.key
          ].filter(Boolean);

          for (const k of [...candidateKeys]) {
            const ttMatch = String(k).match(/(tt\d+)/i);
            if (ttMatch && !candidateKeys.includes(ttMatch[1])) {
              candidateKeys.push(ttMatch[1]);
            }
          }

          for (const k of candidateKeys) {
            if (tmdbCache[k] && (tmdbCache[k].seasons || tmdbCache[k].backdropPath || tmdbCache[k].posterPath || tmdbCache[k].poster)) {
              metaCache = tmdbCache[k];
              break;
            }
            if (cinemetaCache[k] && (cinemetaCache[k].seasons || cinemetaCache[k].videos || cinemetaCache[k].backdrop || cinemetaCache[k].poster)) {
              metaCache = cinemetaCache[k];
              break;
            }
          }
        }

        // Title matching fallback across cached metadata
        if (!metaCache || (!metaCache.seasons && !metaCache.videos)) {
          const targetTitle = (item.showName || item.showTitle || showObj?.title || showObj?.cleanTitle || '').toLowerCase().trim();
          if (targetTitle) {
            for (const cache of [tmdbCache, cinemetaCache]) {
              for (const entry of Object.values(cache)) {
                if (entry && (entry.seasons || entry.videos)) {
                  const entryTitle = (entry.title || entry.name || '').toLowerCase().trim();
                  if (entryTitle === targetTitle || (targetTitle.length > 3 && entryTitle.includes(targetTitle))) {
                    metaCache = entry;
                    break;
                  }
                }
              }
              if (metaCache && (metaCache.seasons || metaCache.videos)) break;
            }
          }
        }
        metaCache = metaCache || {};

        let bPath = item.backdrop_path || item.backdropPath || metaCache.backdropPath || metaCache.backdrop_path || metaCache.backdrop;
        function toCleanImg(p) {
          if (!p || typeof p !== 'string') return null;
          const clean = p.trim();
          if (!clean || clean === 'null' || clean === 'undefined' || clean.endsWith('/null')) return null;
          if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;
          if (clean.startsWith('//')) return 'https:' + clean;
          if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
          if (clean.startsWith('local-file://') || clean.startsWith('media://')) return clean;
          if (clean.startsWith('file:///')) return `local-file:///${clean.replace('file:///', '')}`;
          if (clean.startsWith('/')) return `https://image.tmdb.org/t/p/w500${clean}`;
          if (clean.includes(':\\') || clean.includes(':/') || clean.startsWith('\\\\')) {
            return `local-file:///${clean.replace(/\\/g, '/')}`;
          }
          return `https://image.tmdb.org/t/p/w500/${clean}`;
        }

        let episodeStill = null;
        let targetImdbId = null;

        if (isEpisode) {
          const sn = parseInt(item.season, 10);
          const en = parseInt(item.episode, 10);

          let epData = null;
          // Look up in seasons object or array
          const seasonsData = metaCache.seasons || {};
          const sData = seasonsData[sn] || seasonsData[String(sn)];
          if (Array.isArray(sData)) {
            epData = sData.find(e => parseInt(e.episode || e.episode_number, 10) === en);
          } else if (sData && typeof sData === 'object') {
            epData = sData[en] || sData[String(en)];
          }

          // Also check metaCache.videos (Cinemeta format: videos: [{ season: 1, episode: 1, title: "...", thumbnail: "..." }])
          if (!epData && Array.isArray(metaCache.videos)) {
            epData = metaCache.videos.find(v => parseInt(v.season != null ? v.season : v.seasonNumber, 10) === sn && parseInt(v.episode != null ? v.episode : (v.number != null ? v.number : v.episodeNumber), 10) === en);
          }

          // Also check showObj.episodes if local episode had cached meta
          if (!epData && showObj?.episodes) {
            epData = showObj.episodes.find(e => parseInt(e.season, 10) === sn && parseInt(e.episode, 10) === en);
          }

          // Extract clean IMDB ID if present
          for (const k of [item.imdb_id, item.imdbId, item.id, item.showId, pb.key, showObj?.id, showObj?.imdb_id]) {
            const m = String(k || '').match(/(tt\d+)/i);
            if (m) { targetImdbId = m[1]; break; }
          }

          if (!epData && targetImdbId && cinemetaCache[targetImdbId]?.videos) {
            epData = cinemetaCache[targetImdbId].videos.find(v => parseInt(v.season != null ? v.season : v.seasonNumber, 10) === sn && parseInt(v.episode != null ? v.episode : (v.number != null ? v.number : v.episodeNumber), 10) === en);
          }

          if (epData) {
            const epName = epData.name || epData.title;
            if (epName && !epName.toLowerCase().startsWith('episode') && epName !== String(en)) {
              displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')} • ${epName}`;
            } else {
              displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')}`;
            }
          } else {
            displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')}`;
          }

          // Prioritize Episode Still / Thumbnail Image over anime cover
          const rawStill = item.thumbnail || item.still_path || item.still ||
                           epData?.local_still || epData?.thumbnail || epData?.still_path || epData?.still ||
                           (appData.thumbnails ? (appData.thumbnails[item.id] || appData.thumbnails[item.path]) : null);

          if (rawStill) {
            episodeStill = toCleanImg(rawStill);
          }
        }

        let backdropUrl = 'imgs/no-backdrop.png';
        if (isYtItem) {
          const vId = (item.videoId || item.id || pb.key || '').replace(/^yt[:_]/, '');
          const cachedYt = (window.appData?.ytCache && window.appData.ytCache[vId]) || {};
          backdropUrl = cachedYt.thumbnail || item.thumbnail || item.poster || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
        } else if (episodeStill) {
          backdropUrl = episodeStill;
        } else {
          const sId = showObj?.id || item.showId;
          const localBanner = appData.banners ? (appData.banners[item.id] || (sId ? appData.banners[sId] : null)) : null;
          const candidateImg = localBanner ||
            item.backdrop_path || item.backdropPath || item.backdrop ||
            metaCache.backdropPath || metaCache.backdrop_path || metaCache.backdrop ||
            item.poster_path || item.posterPath || item.poster ||
            metaCache.posterPath || metaCache.poster_path || metaCache.poster ||
            item.cover || item.image ||
            showObj?.backdrop || showObj?.backdrop_path || showObj?.poster || showObj?.poster_path || showObj?.cover;

          const resolvedImg = toCleanImg(candidateImg);
          if (resolvedImg) {
            backdropUrl = resolvedImg;
          }
        }

        const ytIdForImg = isYtItem ? (item.videoId || item.id || pb.key || '').replace(/^yt[:_]/, '') : '';
        card.innerHTML = `
          <img class="continue-card-img" src="${backdropUrl}" onerror="${isYtItem ? `if(!this.src.includes('mqdefault')){this.src='https://i.ytimg.com/vi/${ytIdForImg}/mqdefault.jpg';}else{this.src='imgs/no-backdrop.png';}` : `this.src='imgs/no-backdrop.png';`} this.onerror=null;">
          <div class="continue-card-play"><i class="fas fa-play"></i></div>
          <div class="continue-card-info">
            <div class="continue-card-title">${displayTitle}</div>
            <div class="continue-card-subtitle">${subtitle}</div>
            <div class="continue-card-progress">
              <div class="continue-card-progress-fill" style="width: ${progress}%"></div>
            </div>
          </div>
        `;

        if (isYtItem && ytIdForImg) {
          const cachedYt = window.appData?.ytCache?.[ytIdForImg];
          if (!cachedYt || !cachedYt.title || displayTitle === 'YouTube Video') {
            fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytIdForImg}&format=json`)
              .then(res => res.ok ? res.json() : null)
              .then(data => {
                if (data && data.title) {
                  window.appData = window.appData || {};
                  window.appData.ytCache = window.appData.ytCache || {};
                  window.appData.ytCache[ytIdForImg] = {
                    id: ytIdForImg,
                    title: data.title,
                    author: data.author_name,
                    thumbnail: `https://i.ytimg.com/vi/${ytIdForImg}/hqdefault.jpg`
                  };
                  if (pb.meta) {
                    pb.meta.title = data.title;
                    if (data.author_name) pb.meta.author = data.author_name;
                  }
                  const tEl = card.querySelector('.continue-card-title');
                  if (tEl) tEl.textContent = data.title;
                  const sEl = card.querySelector('.continue-card-subtitle');
                  if (sEl && data.author_name) sEl.textContent = data.author_name;
                }
              })
              .catch(() => {});
          }
        }

        if (isEpisode && !episodeStill) {
          const sn = parseInt(item.season, 10) || 1;
          const en = parseInt(item.episode, 10) || 1;
          const showName = item.showTitle || item.showName || item.title || showObj?.title || showObj?.name || '';

          const applyEpisodeData = (stillUrl, epTitle) => {
            if (stillUrl) {
              const cleanStill = toCleanImg(stillUrl);
              const imgEl = card.querySelector('.continue-card-img');
              if (imgEl && cleanStill) imgEl.src = cleanStill;
            }
            if (epTitle) {
              const tEl = card.querySelector('.continue-card-title');
              if (tEl) tEl.textContent = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')} • ${epTitle}`;
            }
          };

          const tryFetchCinemetaStill = (imdbId) => {
            fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (data?.meta?.videos && Array.isArray(data.meta.videos)) {
                  window.appData = window.appData || {};
                  window.appData.cinemetaCache = window.appData.cinemetaCache || {};
                  window.appData.cinemetaCache[imdbId] = data.meta;
                  const v = data.meta.videos.find(x => (x.season == sn || x.seasonNumber == sn) && (x.episode == en || x.number == en || x.episodeNumber == en));
                  if (v) {
                    applyEpisodeData(v.thumbnail || v.still, v.title || v.name);
                  }
                }
              })
              .catch(() => {});
          };

          const tryFetchTmdbStill = (tmdbId) => {
            const tmdbKey = window.appData?.tmdbKey;
            if (!tmdbKey) return;
            const tmdbEp = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${sn}/episode/${en}?api_key=${tmdbKey}`;
            fetch(tmdbEp)
              .then(r => r.ok ? r.json() : null)
              .then(epInfo => {
                if (epInfo?.still_path) {
                  applyEpisodeData(`https://image.tmdb.org/t/p/w500${epInfo.still_path}`, epInfo.name);
                }
              })
              .catch(() => {});
          };

          if (targetImdbId) {
            tryFetchCinemetaStill(targetImdbId);
          }

          const tmdbKey = window.appData?.tmdbKey;
          let tmdbId = metaCache?.tmdbId || metaCache?.id || item.tmdbId || item.showId;
          if (tmdbId && /^\d+$/.test(String(tmdbId))) {
            tryFetchTmdbStill(tmdbId);
          } else if (tmdbKey && showName && showName.length >= 2) {
            fetch(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(showName)}`)
              .then(r => r.ok ? r.json() : null)
              .then(sData => {
                const found = sData?.results?.[0];
                if (found?.id) {
                  tryFetchTmdbStill(found.id);
                }
              })
              .catch(() => {});
          }
        }

        card.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const resumeTime = (pb && pb.time > 2 && !pb.watched) ? pb.time : 0;

          if (isYtItem) {
            const vId = (item.videoId || item.id || pb.key || '').replace(/^yt[:_]/, '');
            const currentYtMeta = (window.appData?.ytCache && window.appData.ytCache[vId]) || {};
            const effectiveTitle = currentYtMeta.title || (item.title && item.title !== vId ? item.title : 'YouTube Video');
            const effectiveAuthor = currentYtMeta.author || item.author || 'YouTube';
            const effectiveThumb = currentYtMeta.thumbnail || item.thumbnail || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;

            if (typeof window.playVideo === 'function') {
              window.playVideo({
                type: 'youtube',
                isYoutube: true,
                id: vId,
                videoId: vId,
                title: effectiveTitle,
                author: effectiveAuthor,
                poster: effectiveThumb,
                thumbnail: effectiveThumb,
                backdrop_path: effectiveThumb,
                startTime: resumeTime
              }, null, { startTime: resumeTime });
            }
            return;
          }
          // 1. Detect Torrent Magnet
          let magnet = item.torrentMagnet || pb?.torrentMagnet || pb?.meta?.torrentMagnet;
          let fIdx = item.fileIdx ?? pb?.fileIdx ?? pb?.meta?.fileIdx ?? null;

          if (!magnet) {
            const pbKeyStr = String(pb?.key || item?.id || '');
            const magnetMatch = pbKeyStr.match(/magnet_([a-zA-Z0-9]{32,40})/i);
            if (magnetMatch) {
              magnet = `magnet:?xt=urn:btih:${magnetMatch[1]}`;
              const fMatch = pbKeyStr.match(/_f(\d+)/i);
              if (fMatch && fIdx == null) fIdx = parseInt(fMatch[1], 10);
            }
          }

          // 2. Resolve raw local path, but explicitly discard stale localhost/streamer ports
          let rawPath = item.path || pb?.path || pb?.meta?.path || item.url || pb?.meta?.url;
          if (rawPath && typeof isStaleStreamUrl === 'function' && isStaleStreamUrl(rawPath)) {
            rawPath = null;
          }

          if (!rawPath && typeof pb?.key === 'string' && (pb.key.includes(':\\') || pb.key.includes(':/') || pb.key.startsWith('/'))) {
            rawPath = pb.key;
          }
          if (!rawPath && typeof item?.id === 'string' && (item.id.includes(':\\') || item.id.includes(':/') || item.id.startsWith('/'))) {
            rawPath = item.id;
          }

          if (!rawPath && window.appData) {
            if (Array.isArray(appData.shows)) {
              for (const s of appData.shows) {
                const ep = (s.episodes || []).find(ex => {
                  if (ex.path && (ex.path === item.path || ex.path === pb?.key || (pb?.key && pb.key.includes(ex.path)))) return true;
                  if (item.season != null && item.episode != null && ex.season == item.season && ex.episode == item.episode) {
                    const sName = (item.showTitle || item.showName || '').toLowerCase();
                    const sTitle = (s.title || s.cleanTitle || '').toLowerCase();
                    if (!sName || !sTitle || sTitle === sName || sTitle.includes(sName) || sName.includes(sTitle)) return true;
                  }
                  return false;
                });
                if (ep && ep.path) {
                  rawPath = ep.path;
                  if (!showObj) showObj = s;
                  break;
                }
              }
            }
            if (!rawPath && Array.isArray(appData.movies)) {
              const m = appData.movies.find(mv => mv.path && (mv.path === item.path || mv.path === pb?.key || (pb?.key && pb.key.includes(mv.path))));
              if (m && m.path) rawPath = m.path;
            }
          }

          // If rawPath is a series directory, find the target episode inside showObj
          const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.ts', '.m4v', '.flv'];
          let isDirectVideoFile = rawPath && (VIDEO_EXTS.some(ext => rawPath.toLowerCase().endsWith(ext)) || rawPath.startsWith('http://') || rawPath.startsWith('https://'));
          if (rawPath && typeof isStaleStreamUrl === 'function' && isStaleStreamUrl(rawPath)) {
            isDirectVideoFile = false;
            rawPath = null;
          }

          if (!isDirectVideoFile && showObj && Array.isArray(showObj.episodes) && showObj.episodes.length > 0) {
            const targetEp = (item.season != null && item.episode != null)
              ? showObj.episodes.find(e => e.season == item.season && e.episode == item.episode)
              : (showObj.episodes.find(e => e.path === pb?.key) || showObj.episodes[0]);
            if (targetEp && targetEp.path) {
              rawPath = targetEp.path;
              isDirectVideoFile = true;
            }
          }

          const isValidLocal = isDirectVideoFile && (rawPath.includes(':\\') || rawPath.includes(':/') || rawPath.startsWith('\\\\') || (rawPath.startsWith('http') && (!isStaleStreamUrl || !isStaleStreamUrl(rawPath))));

          if (magnet) {
            if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                path: null,
                url: null,
                torrentMagnet: magnet,
                fileIdx: fIdx,
                source: 'torrent',
                startTime: resumeTime
              }, showObj, { startTime: resumeTime });
            }
          } else if (isValidLocal) {
            if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                path: rawPath,
                startTime: resumeTime
              }, showObj, { startTime: resumeTime });
            }
          } else if (item.isStream && rawPath) {
            if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                path: rawPath,
                startTime: resumeTime
              }, item.showName ? { title: item.showName, id: item.showId } : null, { startTime: resumeTime });
            }
          } else if (isEpisode && item.season != null && item.episode != null) {
            const resolvedImdb = item.imdb_id || item.imdbId || (showObj && (showObj.imdb_id || showObj.imdbId)) || (String(item.id || pb?.key || '').match(/(tt\d+)/)?.[1]) || null;
            const streamType = (item.source === 'jikan' || item.source === 'mal' || item.source === 'kitsu' || item.kitsuId) ? 'anime' : 'tv';
            const epThumb = episodeStill || backdropUrl || '';
            const epTitle = displayTitle || `Episode ${item.episode}`;
            const payload = {
              ...item,
              imdb_id: resolvedImdb,
              imdbId: resolvedImdb,
              season: parseInt(item.season, 10),
              episode: parseInt(item.episode, 10),
              epTitle: epTitle,
              thumbnail: epThumb,
              media_type: 'tv',
              startTime: resumeTime
            };
            if (typeof window.loadStreams === 'function') {
              window.loadStreams(payload, streamType);
            } else if (typeof window.openDiscoverDetail === 'function') {
              window.openDiscoverDetail(showObj || item);
            }
          } else if (typeof window.loadStreams === 'function') {
            const resolvedImdb = item.imdb_id || item.imdbId || (showObj && (showObj.imdb_id || showObj.imdbId)) || (String(item.id || pb?.key || '').match(/(tt\d+)/)?.[1]) || null;
            const streamType = (item.source === 'jikan' || item.source === 'mal' || item.source === 'kitsu' || item.kitsuId) ? 'anime' : (isEpisode ? 'tv' : (item.type === 'show' ? 'tv' : 'movie'));
            const payload = {
              ...item,
              imdb_id: resolvedImdb,
              imdbId: resolvedImdb,
              season: item.season,
              episode: item.episode,
              epTitle: displayTitle,
              media_type: isEpisode ? 'tv' : (item.type === 'show' ? 'tv' : 'movie'),
              startTime: resumeTime
            };
            window.loadStreams(payload, streamType);
          } else {
            const targetObj = showObj || item;
            if (typeof openDiscoverDetail === 'function') {
              openDiscoverDetail(targetObj);
            } else if (typeof window.openDiscoverDetail === 'function') {
              window.openDiscoverDetail(targetObj);
            } else if (typeof window.renderUnifiedDetail === 'function') {
              window.renderUnifiedDetail(targetObj);
            } else if (typeof openShowDetail === 'function' && showObj) {
              openShowDetail(showObj);
            } else if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                startTime: resumeTime
              }, showObj, { startTime: resumeTime });
            }
          }
        };

        card.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          showContinueWatchingMenu(e, pb, item, showObj);
        };

        row.appendChild(card);
      });
      section.style.display = 'block';
    } else {
      row.innerHTML = `
        <div style="flex: 1; width: 100%; height: 100%; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 24px; background: transparent; border: none; box-sizing: border-box; text-align: center;">
          <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.06); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.1);">
             <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" style="opacity: 0.9; margin-left: 2px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <h3 style="font-size: 19px; margin: 0; opacity: 0.95; font-weight: 800; color: #fff; letter-spacing: 0.5px;">Start Watching Now!</h3>
          <p style="font-size: 13px; margin: 8px 0 0; opacity: 0.45; max-width: 320px; line-height: 1.45;">Your in-progress movies and episodes will appear here automatically.</p>
        </div>
      `;
      section.style.display = 'block';
    }
  }

  function showContinueWatchingMenu(e, pb, item, showObj) {
    const existing = document.getElementById('continue-watching-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'continue-watching-menu';
    
    // Boundary check so menu doesn't spawn off-screen
    const posX = Math.min(e.clientX, window.innerWidth - 200);
    const posY = Math.min(e.clientY, window.innerHeight - 180);

    menu.style.cssText = `
      position: fixed;
      top: ${posY}px;
      left: ${posX}px;
      background: rgba(18, 18, 22, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 5px;
      z-index: 1000000;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
      min-width: 175px;
      max-width: 220px;
      animation: menuPopIn 0.15s ease-out;
      display: flex;
      flex-direction: column;
      gap: 2px;
    `;

    // Title / Header Preview
    const itemTitle = item.title || item.name || showObj?.title || showObj?.name || 'Media';
    const subTitle = (item.season != null && item.episode != null) ? `Season ${item.season} · Ep ${item.episode}` : (item.showTitle || item.showName || '');
    
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 5px 8px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 3px;
    `;
    header.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(itemTitle)}</div>
      ${subTitle ? `<div style="font-size: 0.7rem; font-weight: 500; color: rgba(255, 255, 255, 0.5); margin-top: 1px;">${escapeHTML(subTitle)}</div>` : ''}
    `;
    menu.appendChild(header);

    const createBtn = (icon, text, onClick) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 6px 9px;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.85);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        transition: all 0.15s ease;
        text-align: left;
      `;

      btn.innerHTML = `
        <i class="fas ${icon}" style="font-size: 11px; width: 14px; text-align: center; color: #fff; opacity: 0.8;"></i>
        <span style="flex: 1;">${text}</span>
      `;

      btn.onmouseenter = () => {
        btn.style.background = 'rgba(255, 255, 255, 0.1)';
        btn.style.color = '#fff';
        const iconEl = btn.querySelector('i');
        if (iconEl) iconEl.style.opacity = '1';
      };
      btn.onmouseleave = () => {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(255, 255, 255, 0.85)';
        const iconEl = btn.querySelector('i');
        if (iconEl) iconEl.style.opacity = '0.8';
      };

      btn.onclick = () => {
        menu.remove();
        onClick();
      };
      return btn;
    };

    // Option 1: Resume Playback
    menu.appendChild(createBtn('fa-play', 'Resume Playback', () => {
      const resumeTime = (pb && pb.time > 2 && !pb.watched) ? pb.time : 0;
      if (item.isStream) {
        if (typeof playVideo === 'function') playVideo(item, item.showName ? { title: item.showName, id: item.showId } : null, { startTime: resumeTime });
      } else {
        if (typeof playVideo === 'function') playVideo(item, showObj, { startTime: resumeTime });
      }
    }));

    // Option 2: View Details
    menu.appendChild(createBtn('fa-info-circle', 'View Details', () => {
      if (item.isStream || item.tmdbId) {
        openDiscoverDetail(item);
      } else if (showObj) {
        if (typeof openShowDetail === 'function') openShowDetail(showObj);
      } else {
        showToast('Details not available for this item');
      }
    }));

    // Option 3: Remove from list
    const removeBtn = createBtn('fa-trash-alt', 'Remove from List', async () => {
      const key = getPlaybackKey(item);
      if (currentProfile?.playback && currentProfile.playback[key]) {
        delete currentProfile.playback[key];
        if (window.currentProfile?.playback) delete window.currentProfile.playback[key];
        if (window.appData && Array.isArray(window.appData.profiles)) {
          const matched = window.appData.profiles.find(p => p.id === currentProfile.id);
          if (matched && matched.playback) delete matched.playback[key];
        }
        if (window.appData && window.appData.playback) delete window.appData.playback[key];

        if (typeof window.persist === 'function') {
          try { await window.persist(true); } catch (_) {}
        }

        // Direct renderer Supabase delete
        try {
          const rClient = typeof window.getSupabaseRendererClient === 'function' ? window.getSupabaseRendererClient() : null;
          if (rClient && currentProfile.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentProfile.id)) {
            rClient.from('playback_history').delete().eq('profile_id', currentProfile.id).eq('media_id', key).catch(() => {});
          }
        } catch (_) {}

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
        if (typeof window.renderLibContinueWatching === 'function') {
          window.renderLibContinueWatching();
        } else if (typeof renderLibContinueWatching === 'function') {
          renderLibContinueWatching();
        }
        if (typeof renderEmptySearchState === 'function') {
          renderEmptySearchState();
        }
        showToast('Removed from Continue Watching');
      }
    });
    menu.appendChild(removeBtn);

    document.body.appendChild(menu);

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
    if (!items.length) { grid.innerHTML = '<div style="padding:40px;color:var(--text-muted)">No items found.</div>'; return; }

    const localTitles = new Set([
      ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
      ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
    ]);

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'discover-card';
      const title = item.title || item.name || 'Unknown';
      const inLib = localTitles.has((title || '').toLowerCase()) || !!item.isLocal || !!item.path;

      // Comprehensive poster resolution matching Movies / Shows views
      const tmdbCached = (window.appData?.tmdbCache && item.id && window.appData.tmdbCache[item.id]) || item.tmdbData;
      const cinemetaCached = (window.appData?.cinemetaCache && (item.imdb_id || item.imdbId || item.id) && window.appData.cinemetaCache[item.imdb_id || item.imdbId || item.id]);
      
      let posterUrl = item.poster || item.poster_path || item.bannerPath || item.banner || item.customPoster || item.cover || '';
      
      if (!posterUrl && tmdbCached) {
        const p = tmdbCached.posterPath || tmdbCached.poster_path || tmdbCached.backdropPath || tmdbCached.backdrop_path;
        if (p) {
          posterUrl = p.startsWith('http') ? p : (p.startsWith('/') ? `https://image.tmdb.org/t/p/w500${p}` : p);
        }
      }
      
      if (!posterUrl && cinemetaCached && cinemetaCached.poster) {
        posterUrl = cinemetaCached.poster;
      }
      
      if (!posterUrl && typeof ensureThumbnail === 'function' && (item.isLocal || (item.path && !item.path.startsWith('http')))) {
        try {
          const thumb = ensureThumbnail(item);
          if (thumb) posterUrl = thumb;
        } catch (_) {}
      }

      if (posterUrl && typeof posterUrl === 'string' && posterUrl.startsWith('/') && !posterUrl.startsWith('//') && !posterUrl.match(/^\/[a-zA-Z]:/)) {
        posterUrl = `https://image.tmdb.org/t/p/w500${posterUrl}`;
      }

      if (!posterUrl && !inLib && !item.isLocal && item.type !== 'iptv' && item.type !== 'channel' && item.type !== 'radio') {
        return; // Hide items with no poster
      }

      const year = (item.release_date || item.first_air_date || item.year || '').toString().slice(0, 4);
      const rating = parseFloat(item.vote_average || item.rating || tmdbCached?.rating || 0) || 0;

      const isChannelOrLogo = item.type === 'iptv' || item.type === 'radio' || item.type === 'channel' || item.isLive || item.isIptv || item.isRadio || !!item.logo || (typeof posterUrl === 'string' && (posterUrl.includes('logo') || posterUrl.includes('channel') || posterUrl.includes('aljazeera') || posterUrl.includes('radio') || posterUrl.includes('iptv') || posterUrl.includes('svg')));

      const fallbackIcon = (item.type === 'iptv' || item.type === 'channel' || item.isLive || item.isIptv) ? 'fa-tv' : (item.type === 'radio' || item.isRadio ? 'fa-radio' : (item.type === 'show' || item.type === 'tv' ? 'fa-desktop' : 'fa-film'));

      const imgClass = `discover-poster${isChannelOrLogo ? ' is-channel-logo' : ''}`;

      card.innerHTML = `
        <div class="discover-poster-wrap">
          <div class="discover-poster-placeholder" style="${posterUrl ? 'display:none;' : ''}">
            <i class="fas ${fallbackIcon}"></i>
            <span class="placeholder-title">${escapeHTML(title)}</span>
          </div>
          ${posterUrl ? `<img src="${localImg(posterUrl)}" class="${imgClass}" loading="lazy" onerror="this.closest('.discover-card')?.remove();">` : ''}
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
      if (typeof enableHoverPreview === 'function') enableHoverPreview(card, item, '.discover-poster-wrap');
      grid.appendChild(card);

      // Trigger async poster fetch from Cinemeta/TMDB if no poster exists yet
      const itemId = item.imdb_id || item.imdbId || (String(item.id || '').startsWith('tt') ? item.id : null);
      if (!posterUrl && itemId && typeof window.getTraktOrImdbPoster === 'function') {
        window.getTraktOrImdbPoster(item, null, card);
      }
    });
  }

  function resolveHeroBackdrop(item) {
    if (!item) return '';
    const raw = item.backdrop_path || item.background || item.backdrop || item.bannerImage || item.fanart || item.poster_path || item.poster || '';
    const imdbId = item.imdb_id || item.imdbId || (String(item.id || '').startsWith('tt') ? item.id : null);

    let url = '';
    if (raw) {
      const s = String(raw).trim();
      if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file://')) {
        url = s;
      } else if (s.startsWith('/tt') || s.startsWith('tt')) {
        const cleanId = s.replace(/^\//, '').split('/')[0];
        url = `https://images.metahub.space/background/medium/${cleanId}/img`;
      } else if (s.startsWith('/')) {
        url = `https://image.tmdb.org/t/p/w1280${s}`;
      } else {
        url = `https://image.tmdb.org/t/p/w1280/${s}`;
      }
    } else if (imdbId) {
      url = `https://images.metahub.space/background/medium/${imdbId}/img`;
    }

    if (url && typeof window.localImg === 'function') {
      return window.localImg(url);
    }
    return url;
  }

  let activeHeroLayer = 0;

  function updateDiscoverHeroDisplay() {
    const hero = $('#discover-hero');
    if (!hero || discoverHeroItems.length === 0) return;
    const item = discoverHeroItems[discoverHeroIndex];
    if (!item) return;

    const title = item.title || item.name || 'Unknown';
    const backdrop = resolveHeroBackdrop(item);
    const year = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
    const rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : (item.score || 'N/A');
    const isAnime = item.source === 'anilist' || item.source === 'mal' || item.format;
    const type = isAnime ? 'ANIME' : (item.media_type === 'tv' ? 'SERIES' : 'MOVIE');
    const imdbId = item.imdb_id || item.imdbId || (String(item.id || '').startsWith('tt') ? item.id : null);
    const totalCount = discoverHeroItems.length;

    // Check if the slider shell already exists inside #discover-hero
    let stage = hero.querySelector('#hero-slider-stage');
    if (!stage) {
      hero.innerHTML = `
        <div id="hero-slider-stage" style="position:absolute; inset:0; overflow:hidden; border-radius:inherit;">
          <div id="hero-layer-0" class="hero-slide-layer" style="position:absolute; inset:0; opacity:1; transition:opacity 0.4s ease-in-out; z-index:1;">
            <div class="hero-backdrop" id="hero-bg-0"></div>
            <div class="hero-overlay">
              <div class="hero-content" id="hero-content-0"></div>
            </div>
          </div>
          <div id="hero-layer-1" class="hero-slide-layer" style="position:absolute; inset:0; opacity:0; transition:opacity 0.4s ease-in-out; z-index:2; pointer-events:none;">
            <div class="hero-backdrop" id="hero-bg-1"></div>
            <div class="hero-overlay">
              <div class="hero-content" id="hero-content-1"></div>
            </div>
          </div>
        </div>

        <div class="hero-pagination" id="discover-hero-dots"></div>
      `;

      hero.onclick = (e) => {
        if (e.target.closest('.hero-dot') || e.target.closest('.hero-pagination')) return;
        const currentItem = discoverHeroItems[discoverHeroIndex];
        if (currentItem) openDiscoverDetail(currentItem);
      };

      hero.onmouseenter = () => {
        if (discoverHeroInterval) clearInterval(discoverHeroInterval);
      };
      hero.onmouseleave = () => {
        resetDiscoverHeroInterval();
      };

      activeHeroLayer = 0;
    }

    // Toggle target layer for seamless cross-fade
    const nextLayerIdx = activeHeroLayer === 0 ? 1 : 0;
    const currentLayer = hero.querySelector(`#hero-layer-${activeHeroLayer}`);
    const nextLayer = hero.querySelector(`#hero-layer-${nextLayerIdx}`);
    const nextBg = hero.querySelector(`#hero-bg-${nextLayerIdx}`);
    const nextContent = hero.querySelector(`#hero-content-${nextLayerIdx}`);

    if (nextBg && nextContent && currentLayer && nextLayer) {
      if (backdrop) nextBg.style.backgroundImage = `url('${backdrop}')`;

      nextContent.innerHTML = `
        <div class="hero-badge">Featured ${type}</div>
        ${item.logoUrl ? 
          `<img id="hero-logo" src="${(typeof window.localImg === 'function') ? window.localImg(item.logoUrl) : item.logoUrl}" onerror="this.style.display='none'; const sibling = this.parentElement?.querySelector('.hero-fallback-title'); if(sibling) sibling.style.display='block';" style="display: block; max-width: 320px; max-height: 80px; object-fit: contain; margin-bottom: 12px; transition: opacity 0.25s ease;">
           <h1 class="hero-title hero-fallback-title" style="display:none">${escapeHTML(title)}</h1>` : 
          `<h1 class="hero-title">${escapeHTML(title)}</h1>`
        }
        <div class="hero-meta">
          <span><i class="fas fa-star" style="color:#F59E0B"></i> ${rating}</span>
          <span>${year}</span>
          <span>HD 4K</span>
        </div>
        <div style="margin-top: 15px; font-size: 11px; font-weight: 700; opacity: 0.8; letter-spacing: 1px; text-transform: uppercase;">
           <i class="fas fa-info-circle"></i> Click for Details
        </div>
      `;

      // Smart Fallback Preloader for Hero Backdrop Image
      if (backdrop) {
        const imgTester = new Image();
        imgTester.src = backdrop;
        imgTester.onerror = () => {
          let fallback = '';
          if (imdbId && !backdrop.includes('metahub.space')) {
            fallback = `https://images.metahub.space/background/medium/${imdbId}/img`;
          } else if (item.poster_path) {
            fallback = `https://image.tmdb.org/t/p/w1280${item.poster_path}`;
          } else if (imdbId) {
            fallback = `https://images.metahub.space/poster/medium/${imdbId}/img`;
          }
          if (fallback) {
            if (typeof window.localImg === 'function') fallback = window.localImg(fallback);
            if (nextBg) nextBg.style.backgroundImage = `url('${fallback}')`;
          }
        };
      }

      // Perform the smooth GPU crossfade transition
      nextLayer.style.opacity = '1';
      nextLayer.style.pointerEvents = 'auto';
      nextLayer.style.zIndex = '2';
      currentLayer.style.opacity = '0';
      currentLayer.style.pointerEvents = 'none';
      currentLayer.style.zIndex = '1';
      activeHeroLayer = nextLayerIdx;
    }

    // Update Dots indicator
    const dots = hero.querySelector('#discover-hero-dots');
    if (dots) {
      if (totalCount <= 1) {
        dots.style.display = 'none';
      } else {
        dots.style.display = 'flex';
        if (dots.children.length !== discoverHeroItems.length) {
          dots.innerHTML = '';
          discoverHeroItems.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'hero-dot' + (i === discoverHeroIndex ? ' active' : '');
            dot.onclick = (e) => {
              e.stopPropagation();
              if (discoverHeroIndex !== i) {
                discoverHeroIndex = i;
                updateDiscoverHeroDisplay();
                resetDiscoverHeroInterval();
              }
            };
            dots.appendChild(dot);
          });
        } else {
          Array.from(dots.children).forEach((dot, i) => {
            dot.className = 'hero-dot' + (i === discoverHeroIndex ? ' active' : '');
          });
        }
      }
    }
  }

  function resetDiscoverHeroInterval() {
    if (discoverHeroInterval) clearInterval(discoverHeroInterval);
    if (discoverHeroItems.length > 1) {
      discoverHeroInterval = setInterval(() => {
        discoverHeroIndex = (discoverHeroIndex + 1) % discoverHeroItems.length;
        updateDiscoverHeroDisplay();
      }, 5500);
    }
  }

  function addDiscoverHeroItem(item) {
    if (!item) return;
    if (discoverHeroItems.length >= 10) return;

    // Robust duplicate detection avoiding undefined === undefined bugs
    const isDuplicate = discoverHeroItems.some(i => {
      if (item.id != null && i.id != null && String(i.id) === String(item.id)) return true;
      if (item.imdb_id && i.imdb_id && String(i.imdb_id) === String(item.imdb_id)) return true;
      if (item.tmdbId && i.tmdbId && String(i.tmdbId) === String(item.tmdbId)) return true;
      const titleA = (i.title || i.name || '').trim().toLowerCase();
      const titleB = (item.title || item.name || '').trim().toLowerCase();
      if (titleA && titleB && titleA === titleB) return true;
      return false;
    });

    if (!isDuplicate) {
      discoverHeroItems.push(item);
      
      const isAnime = item.type === 'anime' || item.source === 'jikan' || item.source === 'kitsu' || item.source === 'mal' || item.source === 'anilist';
      const heroType = isAnime ? 'tv' : (item.media_type || item.type || (item.title ? 'movie' : 'tv'));
      const normalizedType = (heroType === 'series' || heroType === 'tv') ? 'tv' : 'movie';
      const tmdbKey = window.appData?.tmdbKey || null;

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

      // Fetch full metadata (including clearlogos) in background for logo display
      if (!item.logoUrl) {
        if (/^\d+$/.test(String(item.id)) && tmdbKey) {
          fetch(`https://api.themoviedb.org/3/${normalizedType}/${item.id}/images?api_key=${tmdbKey}`, { signal: AbortSignal.timeout(3500) })
            .then(r => r.json())
            .then(res => {
              const logos = res?.logos || [];
              const bestLogo = logos.find(l => l.iso_639_1 === 'en') || logos[0];
              if (bestLogo?.file_path) {
                item.logoUrl = `https://image.tmdb.org/t/p/original${bestLogo.file_path}`;
                updateDiscoverHeroDisplay();
              }
            })
            .catch(() => {});
        } else if (item.id) {
          window.api.invoke('cinemeta-details', { id: item.id, type: normalizedType })
            .then(res => {
              if (res) {
                const logoUrl = res.clearlogos?.[0] || res.meta?.logo || res.meta?.fanart?.hdtvlogo?.[0]?.url || res.meta?.fanart?.clearlogo?.[0]?.url;
                if (logoUrl) {
                  item.logoUrl = logoUrl;
                  updateDiscoverHeroDisplay();
                }
              }
            })
            .catch(err => console.warn('[DiscoverHero] Logo fetch failed:', err));
        }
      }

      updateDiscoverHeroDisplay();
      resetDiscoverHeroInterval();
    }
  }

  function renderLocalHomeDashboard(content) {
    let localHomeEl = $('#discover-local-home');
    if (!localHomeEl) {
      localHomeEl = document.createElement('div');
      localHomeEl.id = 'discover-local-home';
      localHomeEl.style.cssText = 'display:flex; flex-direction:column; gap: 32px; padding: 20px 0; width:100%;';
      content.appendChild(localHomeEl);
    }
    localHomeEl.style.display = 'flex';

    const localMovies = (appData.movies || []).map(m => ({ ...m, isLocal: true, type: 'movie' }));
    const localShows = (appData.shows || []).map(s => ({ ...s, isLocal: true, type: 'show' }));
    const localAnime = (appData.anime || appData.videos || []).map(a => ({ ...a, isLocal: true }));
    const activeProf = (window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId) || window.currentProfile);
    const watchlist = (activeProf?.watchlist || appData.watchlist || []);

    // Social Media videos & downloads
    const profileSocial = (appData.socialVideos || []).map(v => ({ ...v, name: v.filename || v.title || v.name, isLocal: true, social: true, poster: v.poster || v.thumbnail || 'imgs/video-placeholder.png' }));
    const legacySocial = (appData.youtubeVideos || []).map(v => ({ ...v, name: v.filename || v.title || v.name, isLocal: true, social: true, poster: v.poster || v.thumbnail || 'imgs/video-placeholder.png' }));
    const dlSocial = (appData.downloadHistory || []).filter(d => d.status === 'complete' && (d.social || d.isYoutube || d.type === 'video') && d.path).map(v => ({ ...v, name: v.title || v.name || v.filename, isLocal: true, social: true, poster: v.poster || v.thumbnail || 'imgs/video-placeholder.png' }));

    // Music & Audio tracks (local / downloaded)
    const localMusic = (appData.music || []).filter(m => m.path || m.url).map(m => ({
      ...m,
      name: m.title || m.name || m.filename || (m.path ? m.path.split(/[/\\]/).pop() : 'Music Track'),
      title: m.title || m.name || m.filename || (m.path ? m.path.split(/[/\\]/).pop() : 'Music Track'),
      isLocal: true,
      isMusic: true,
      type: 'music',
      poster: m.thumbnail || m.cover || m.image || 'imgs/music-placeholder.png'
    }));
    const dlMusic = (appData.downloadHistory || []).filter(d => d.status === 'complete' && (d.type === 'music' || d.isMusic || (d.path && /\.(m4a|mp3|flac|wav|ogg)$/i.test(d.path)))).map(m => ({
      ...m,
      name: m.title || m.name || m.filename || (m.path ? m.path.split(/[/\\]/).pop() : 'Downloaded Track'),
      title: m.title || m.name || m.filename || (m.path ? m.path.split(/[/\\]/).pop() : 'Downloaded Track'),
      isLocal: true,
      isMusic: true,
      type: 'music',
      poster: m.thumbnail || m.cover || m.image || 'imgs/music-placeholder.png'
    }));

    const seenMusic = new Set();
    const allLocalMusic = [...localMusic, ...dlMusic].filter(m => {
      const key = m.path || m.id || m.url;
      if (!key || seenMusic.has(key)) return false;
      seenMusic.add(key);
      return true;
    });

    const seenSocial = new Set();
    const localSocial = [...profileSocial, ...legacySocial, ...dlSocial, ...allLocalMusic].filter(v => {
      const key = v.path || v.id || v.url;
      if (!key || seenSocial.has(key)) return false;
      seenSocial.add(key);
      return true;
    });

    const hasAnyLocalMedia = (localMovies.length > 0 || localShows.length > 0 || localAnime.length > 0 || watchlist.length > 0 || localSocial.length > 0);

    localHomeEl.innerHTML = `
      <!-- Section: Local Social & Downloads -->
      <div class="discover-section" id="home-local-social-section" style="${localSocial.length ? '' : 'display:none;'}">
        <div class="discover-section-header">
          <div class="section-title-icon" style="display: inline-flex; align-items: center; justify-content: center; color: #ffffff;">
            <i class="fas fa-video" style="font-size: 15px; color: #ffffff !important;"></i>
          </div>
          <h2>Social</h2>
          <span style="font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.45); margin-left: 8px;">(${localSocial.length})</span>
          <div class="header-divider"></div>
          <div class="discover-header-nav">
            <button class="discover-scroll-btn prev" onclick="scrollRow(this, -1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button class="discover-scroll-btn next" onclick="scrollRow(this, 1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        <div id="home-local-social-row" class="discover-row"></div>
      </div>

      <!-- Section 1: Local Movies -->
      <div class="discover-section" id="home-local-movies-section" style="${localMovies.length ? '' : 'display:none;'}">
        <div class="discover-section-header">
          <div class="section-title-icon" style="display: inline-flex; align-items: center; justify-content: center; color: #ffffff;">
            <i class="fas fa-film" style="font-size: 15px; color: #ffffff !important;"></i>
          </div>
          <h2>Local Movies</h2>
          <span style="font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.45); margin-left: 8px;">(${localMovies.length})</span>
          <div class="header-divider"></div>
          <div class="discover-header-nav">
            <button class="discover-scroll-btn prev" onclick="scrollRow(this, -1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button class="discover-scroll-btn next" onclick="scrollRow(this, 1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        <div id="home-local-movies-row" class="discover-row"></div>
      </div>

      <!-- Section 2: Local Shows -->
      <div class="discover-section" id="home-local-shows-section" style="${localShows.length ? '' : 'display:none;'}">
        <div class="discover-section-header">
          <div class="section-title-icon" style="display: inline-flex; align-items: center; justify-content: center; color: #ffffff;">
            <i class="fas fa-tv" style="font-size: 15px; color: #ffffff !important;"></i>
          </div>
          <h2>Local TV Shows</h2>
          <span style="font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.45); margin-left: 8px;">(${localShows.length})</span>
          <div class="header-divider"></div>
          <div class="discover-header-nav">
            <button class="discover-scroll-btn prev" onclick="scrollRow(this, -1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button class="discover-scroll-btn next" onclick="scrollRow(this, 1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        <div id="home-local-shows-row" class="discover-row"></div>
      </div>

      <!-- Section 3: Local Anime / Videos -->
      <div class="discover-section" id="home-local-anime-section" style="${localAnime.length ? '' : 'display:none;'}">
        <div class="discover-section-header">
          <div class="section-title-icon" style="display: inline-flex; align-items: center; justify-content: center; color: #ffffff;">
            <i class="fas fa-play" style="font-size: 15px; color: #ffffff !important;"></i>
          </div>
          <h2>Local Anime & Videos</h2>
          <span style="font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.45); margin-left: 8px;">(${localAnime.length})</span>
          <div class="header-divider"></div>
          <div class="discover-header-nav">
            <button class="discover-scroll-btn prev" onclick="scrollRow(this, -1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button class="discover-scroll-btn next" onclick="scrollRow(this, 1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        <div id="home-local-anime-row" class="discover-row"></div>
      </div>

      <!-- Section 4: Recent Watchlist -->
      <div class="discover-section" id="home-local-watchlist-section" style="${watchlist.length ? '' : 'display:none;'}">
        <div class="discover-section-header">
          <div class="section-title-icon" style="display: inline-flex; align-items: center; justify-content: center; color: #ffffff;">
            <i class="fas fa-bookmark" style="font-size: 15px; color: #ffffff !important;"></i>
          </div>
          <h2>Saved to Watchlist</h2>
          <span style="font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.45); margin-left: 8px;">(${watchlist.length})</span>
          <div class="header-divider"></div>
          <div class="discover-header-nav">
            <button class="discover-scroll-btn prev" onclick="scrollRow(this, -1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button class="discover-scroll-btn next" onclick="scrollRow(this, 1)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        <div id="home-local-watchlist-row" class="discover-row"></div>
      </div>

      ${!hasAnyLocalMedia ? `
      <!-- Empty State Banner -->
      <div class="local-home-empty-banner" style="margin: 15px 0 35px; padding: 36px 24px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12); border-radius: 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; font-size: 20px; color: rgba(255,255,255,0.7);">
          <i class="fas fa-folder-plus"></i>
        </div>
        <div>
          <div style="font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 6px;">No Media or Add-ons Available</div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.5); max-width: 460px; line-height: 1.6; margin: 0 auto;">
            Add your social downloads or local media to play offline files, or install streaming add-ons from the Add-on Store to explore online catalogs.
          </div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
          <button class="btn btn-primary" onclick="if(typeof switchView==='function') switchView('social');" style="padding: 8px 18px; font-size: 12px; font-weight: 700; border-radius: 10px; cursor: pointer; background: #ffffff; color: #000; border: none; display: inline-flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            <span>Open Social</span>
          </button>
          <button class="btn btn-secondary" onclick="if(typeof switchView==='function') switchView('addons');" style="padding: 8px 18px; font-size: 12px; font-weight: 700; border-radius: 10px; cursor: pointer; background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.2); display: inline-flex; align-items: center; gap: 8px;">
            <i class="fas fa-puzzle-piece"></i>
            <span>Add-on Store</span>
          </button>
        </div>
      </div>` : ''}
    `;

    // Fetch and render YouTube Trending if active
    if (window.AppCapabilities?.can('youtube')) {
      const ytRow = $('#home-local-youtube-row');
      if (ytRow) {
        window.api.invoke('youtube-get-trending').then(res => {
          if (res && res.success && res.videos && res.videos.length > 0) {
            renderYouTubeDiscoverRow('#home-local-youtube-row', res.videos);
          } else {
            ytRow.innerHTML = '<div style="padding:20px; color:var(--text-muted); font-size:0.8rem">No YouTube trending items available.</div>';
          }
        }).catch(err => console.warn('[LocalHome] YouTube load failed:', err));
      }
    }

    // Render Section: Local Social & Downloads
    if (localSocial.length > 0) {
      renderDiscoverRow('#home-local-social-row', localSocial);
    }

    // Render Section 1: Local Movies
    if (localMovies.length > 0) {
      renderDiscoverRow('#home-local-movies-row', localMovies);
    }

    // Render Section 2: Local Shows
    if (localShows.length > 0) {
      renderDiscoverRow('#home-local-shows-row', localShows);
    }

    // Render Section 3: Local Anime
    if (localAnime.length > 0) {
      renderDiscoverRow('#home-local-anime-row', localAnime);
    }

    // Render Section 4: Watchlist
    if (watchlist.length > 0) {
      renderDiscoverRow('#home-local-watchlist-row', watchlist);
    }
  }

  async function loadDiscover(force = false) {
    window._activeDiscoverGenre = null;
    if ($('#discover-genre-view')) $('#discover-genre-view').style.display = 'none';
    if ($('#discover-results')) $('#discover-results').style.display = 'none';
    if ($('#discover-content')) $('#discover-content').style.display = 'block';
    // Reset genre pills to Trending
    document.querySelectorAll('#discover-genre-pills .genre-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.genre === 'trending');
    });
    document.querySelectorAll('#discover-sidebar .nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.genre === 'trending');
    });

    if (window.AppCapabilities && typeof window.AppCapabilities.refresh === 'function') {
      window.AppCapabilities.refresh();
    }
    const hasCatalog = !!window.AppCapabilities?.can('catalog');
    const hasYoutube = !!window.AppCapabilities?.can('youtube');

    const addons = appData.installedAddons || [];
    const hasMediaAddon = addons.some(a => {
      if (a.enabled === false) return false;
      const u = String(a.url || a.manifestUrl || '').toLowerCase();
      const id = String(a.id || '').toLowerCase();
      const n = String(a.name || '').toLowerCase();
      const types = Array.isArray(a.types) ? a.types.map(t => String(t).toLowerCase()) : [];

      const hasMediaTypes = types.some(t => t.includes('movie') || t.includes('series') || t.includes('tv') || t.includes('anime') || t.includes('youtube') || t.includes('video'));
      const isKnownAddon = u.includes('cinemeta') || u.includes('tmdb') || u.includes('strem') || id.includes('cinemeta') || id.includes('tmdb') || n.includes('cinemeta') || n.includes('tmdb') || id.includes('youtube') || u.includes('youtube');

      return hasMediaTypes || isKnownAddon;
    });

    // Toggle Category/Genre Pills strip at the top:
    // When there are no catalog add-ons, hide genre pills (Action, Comedy, Drama, Animation, etc.)
    const stickyBar = $('#discover-sticky-bar');
    if (stickyBar) {
      stickyBar.style.display = hasCatalog ? '' : 'none';
    }
    const genrePills = $('#discover-genre-pills');
    if (genrePills) {
      genrePills.style.display = hasCatalog ? '' : 'none';
    }

    const content = $('#discover-content');
    if (content) content.style.display = 'block';

    let localHomeEl = $('#discover-local-home');
    if (localHomeEl) localHomeEl.style.display = 'none';

    const bentoWrapper = $('.bento-dashboard-wrapper');
    if (bentoWrapper) {
      bentoWrapper.classList.toggle('no-hero', !hasCatalog);
    }
    // Show Hero banner ONLY if Cinemeta catalog is installed
    if ($('#discover-hero')) $('#discover-hero').style.display = hasCatalog ? '' : 'none';

    // Continue Watching section MUST ALWAYS remain visible on Home page
    if ($('#discover-continue-section')) $('#discover-continue-section').style.display = '';

    // Hide ONLY the Cinemeta catalog sections when Cinemeta catalog is missing
    const movieSeriesRows = ['#in-cinemas-row', '#top10-tv-row', '#top10-movie-row', '#popular-movies-row', '#popular-series-row', '#anime-row'];
    movieSeriesRows.forEach(sel => {
      const el = $(sel);
      const section = el?.closest('.discover-section');
      if (section) section.style.display = hasCatalog ? 'block' : 'none';
    });

    // Hide YouTube sections when YouTube add-on is missing/uninstalled
    const youtubeSectionIds = [
      '#discover-youtube-section',
      '#discover-youtube-recommended-section',
      '#discover-youtube-subscriptions-section',
      '#discover-youtube-history-section',
      '#discover-yt-gaming-section',
      '#discover-yt-music-section',
      '#discover-yt-tech-section',
      '#discover-yt-comedy-section',
      '#home-local-youtube-section'
    ];
    youtubeSectionIds.forEach(sel => {
      const el = $(sel);
      const section = el?.closest('.discover-section') || el;
      if (section) {
        if (!hasYoutube) {
          section.style.display = 'none';
        } else {
          const isPersonalized = sel.includes('recommended') || sel.includes('subscriptions') || sel.includes('history');
          if (isPersonalized) {
            section.style.display = 'none';
          } else if (sel === '#discover-youtube-section' && appData.hideYouTubeTrending === true) {
            section.style.display = 'none';
          } else {
            section.style.display = 'block';
          }
        }
      }
    });

    if (isDiscoverLoading && !force) return;
    
    discoverHeroItems = [];
    discoverHeroIndex = 0;
    if (discoverHeroInterval) clearInterval(discoverHeroInterval);
    
    isDiscoverLoading = true;
    const dm = $('.discover-main');
    if (dm) dm.scrollTop = 0;

    setTimeout(() => {
      renderContinueWatchingDiscover();
      if (typeof window.renderBentoWatchlist === 'function') window.renderBentoWatchlist();
    }, 100);

    // If no catalog add-ons installed, render local library home view and finish
    if (!hasCatalog) {
      renderLocalHomeDashboard(content);
      isDiscoverLoading = false;
      return;
    }

    if (hasCatalog) {
      movieSeriesRows.forEach(sel => {
        const row = $(sel);
        if (!row) return;
        row.innerHTML = '';
        for (let i = 0; i < 6; i++) {
          const skel = document.createElement('div');
          skel.className = 'discover-card-skeleton';
          skel.innerHTML = `
            <div class="discover-poster-wrap" style="aspect-ratio:2/3.1;background:var(--bg-surface-2);border-radius:12px;animation:pulse 1.5s infinite"></div>
            <div style="height:12px;width:70%;background:var(--bg-surface-1);margin-top:10px;border-radius:4px;animation:pulse 1.5s infinite"></div>
          `;
          row.appendChild(skel);
        }
      });
    }
    
    const fetchTmdbShelfAndRender = async (selector, endpoint, defaultType = 'movie', isTop10 = false, fallbackCinemetaId = null) => {
      if (!hasCatalog) return;
      const tmdbKey = window.appData?.tmdbKey || null;
      if (!tmdbKey) return;
      try {
        const url = `https://api.themoviedb.org/3/${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${tmdbKey}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(6500) });
        if (!resp.ok) throw new Error(`TMDB HTTP ${resp.status}`);
        const data = await resp.json();
        const results = data.results || [];
        if (!results.length) throw new Error('Empty TMDB results');

        const items = results.map(m => {
          const isTv = m.media_type === 'tv' || defaultType === 'tv' || (!m.title && m.name);
          const type = isTv ? 'tv' : 'movie';
          const releaseDate = m.release_date || m.first_air_date || '';
          return {
            id: m.id,
            tmdbId: m.id,
            tmdb_id: m.id,
            title: m.title || m.name || 'Unknown',
            name: m.name || m.title,
            overview: m.overview || '',
            vote_average: parseFloat(m.vote_average || 0),
            poster_path: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
            backdrop_path: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : '',
            background: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : '',
            media_type: type,
            type: type,
            release_date: releaseDate,
            first_air_date: releaseDate,
            year: releaseDate ? releaseDate.slice(0, 4) : ''
          };
        });

        renderDiscoverRow(selector, items, isTop10);
        if (selector === '#in-cinemas-row') {
          items.filter(it => it.backdrop_path || it.background).slice(0, 10).forEach(it => addDiscoverHeroItem(it));
        } else if (items.length > 0 && discoverHeroItems.length < 10) {
          items.filter(it => it.backdrop_path || it.background).slice(0, 4).forEach(it => addDiscoverHeroItem(it));
        }
      } catch (err) {
        console.warn(`[Discover] TMDB fetch failed for ${selector} (${endpoint}):`, err.message, 'Falling back to Cinemeta...');
        if (fallbackCinemetaId) {
          await fetchCinemetaAndRender(selector, defaultType, fallbackCinemetaId, isTop10);
        }
      }
    };

    const fetchCinemetaAndRender = async (selector, type, catalogId, isTop10 = false) => {
      if (!hasCatalog) return;
      const row = $(selector);
      try {
        const data = await window.api.invoke('cinemeta-catalog', { type, id: catalogId });
        if (!data || !data.metas || data.metas.length === 0) return;
        const items = data.metas.map(m => ({
          id: m.id,
          imdb_id: m.id,
          title: m.name,
          overview: m.description,
          vote_average: parseFloat(m.imdbRating || 0),
          poster_path: m.poster,
          backdrop_path: m.background,
          media_type: type,
          release_date: m.releaseInfo,
          year: m.releaseInfo
        }));
        renderDiscoverRow(selector, items, isTop10);
        if (items.length > 0) {
          items.slice(0, 8).forEach(it => addDiscoverHeroItem(it));
        }
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    const fetchCinemetaGenreAndRender = async (selector, genre) => {
      if (!hasCatalog) return;
      const row = $(selector);
      try {
        const data = await window.api.cinemetaDiscoverByGenre(genre);
        if (!data || !data.results || data.results.length === 0) return;
        const items = data.results.map(m => ({
          id: m.id,
          imdb_id: m.id,
          title: m.name,
          overview: m.description,
          vote_average: parseFloat(m.imdbRating || 0),
          poster_path: m.poster,
          backdrop_path: m.background,
          media_type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          type: m.media_type === 'series' || m.type === 'series' ? 'tv' : 'movie',
          release_date: m.releaseInfo,
          year: m.releaseInfo
        }));
        renderDiscoverRow(selector, items, false);
        if (items.length > 0) {
          items.slice(0, 8).forEach(it => addDiscoverHeroItem(it));
        }
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    const fetchYouTubeCategoryAndRender = async (selector, sectionId, title, iconClass, query = null) => {
      if (!hasYoutube) return;
      let sectionEl = $(sectionId);
      if (!sectionEl) {
        sectionEl = document.createElement('div');
        sectionEl.id = sectionId.replace('#', '');
        sectionEl.className = 'discover-section';
        sectionEl.style.marginBottom = '35px';
        sectionEl.innerHTML = `
          <div class="discover-section-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
            <h3 style="display:flex; align-items:center; gap:10px; color:#fff; font-size:1.3rem; font-weight:800;">
              <i class="${iconClass}" style="color:#ffffff; font-size:1.2rem;"></i> ${escapeHTML(title)}
            </h3>
          </div>
          <div class="discover-row" id="${selector.replace('#', '')}"></div>
        `;
        content.appendChild(sectionEl);
      }
      sectionEl.style.display = 'block';

      try {
        let res;
        if (!query) {
          res = await window.api.invoke('youtube-get-trending');
        } else {
          res = await window.api.invoke('youtube-search', { query, filter: 'video' });
          if (res && res.results) res.videos = res.results;
        }
        if (res && res.success && res.videos && res.videos.length > 0) {
          renderYouTubeDiscoverRow(selector, res.videos);
        }
      } catch (ytErr) {
        console.error(`Failed to load YouTube category (${title}):`, ytErr);
      }
    };

    const fetchYouTubeRecommendedAndRender = async () => {
      if (!hasYoutube) return;
      try {
        const acc = await window.api.invoke('youtube-get-account');
        if (acc && acc.signedIn) {
          const res = await window.api.invoke('youtube-get-home');
          if (res && res.success && res.videos && res.videos.length > 0) {
            let sectionEl = $('#discover-youtube-recommended-section');
            if (sectionEl) {
              sectionEl.style.display = 'block';
              renderYouTubeDiscoverRow('#youtube-recommended-row', res.videos);
            }
          }
        }
      } catch (e) {
        console.warn('[YouTube Discover] Recommended feed error:', e);
      }
    };

    const fetchYouTubeSubscriptionsAndRender = async () => {
      if (!hasYoutube) return;
      try {
        const acc = await window.api.invoke('youtube-get-account');
        if (acc && acc.signedIn) {
          const res = await window.api.invoke('youtube-get-subscriptions');
          if (res && res.success && res.videos && res.videos.length > 0) {
            let sectionEl = $('#discover-youtube-subscriptions-section');
            if (sectionEl) {
              sectionEl.style.display = 'block';
              renderYouTubeDiscoverRow('#youtube-subscriptions-row', res.videos);
            }
          }
        }
      } catch (e) {
        console.warn('[YouTube Discover] Subscriptions feed error:', e);
      }
    };

    const fetchYouTubeHistoryAndRender = async () => {
      if (!hasYoutube) return;
      try {
        const res = await window.api.invoke('youtube-get-history');
        if (res && res.success && res.history && res.history.length > 0) {
          let sectionEl = $('#discover-youtube-history-section');
          if (sectionEl) {
            sectionEl.style.display = 'block';
            renderYouTubeDiscoverRow('#youtube-history-row', res.history);
          }
        }
      } catch (e) {
        console.warn('[YouTube Discover] History feed error:', e);
      }
    };

    try {
      const promises = [];

      // Load authentic, real-time TMDB rows: In Cinemas, Trending TV/Movies, Popular Rows & Animation
      if (hasCatalog) {
        promises.push(
          fetchTmdbShelfAndRender('#in-cinemas-row', 'movie/now_playing?page=1', 'movie', false, 'top'),
          fetchTmdbShelfAndRender('#top10-tv-row', 'trending/tv/week', 'tv', true, 'top'),
          fetchTmdbShelfAndRender('#top10-movie-row', 'trending/movie/week', 'movie', true, 'top'),
          fetchTmdbShelfAndRender('#popular-movies-row', 'movie/popular?page=1', 'movie', false, 'imdbRating'),
          fetchTmdbShelfAndRender('#popular-series-row', 'tv/popular?page=1', 'tv', false, 'imdbRating'),
          fetchTmdbShelfAndRender('#anime-row', 'discover/tv?with_genres=16&sort_by=popularity.desc&page=1', 'tv', false, null).catch(() => fetchCinemetaGenreAndRender('#anime-row', 'Animation'))
        );
      }

      // If YouTube is installed, load YouTube feeds
      if (hasYoutube) {
        promises.push(
          fetchYouTubeHistoryAndRender()
        );

        // Addon Isolation: If only YouTube is installed (no movie catalog), render 100% isolated YouTube Hub!
        if (!hasCatalog) {
          promises.push(
            fetchYouTubeCategoryAndRender('#yt-gaming-row', '#discover-yt-gaming-section', 'Gaming & Live Streams', 'fas fa-gamepad', 'popular gaming videos'),
            fetchYouTubeCategoryAndRender('#yt-music-row', '#discover-yt-music-section', 'Music & Hits', 'fas fa-music', 'official music videos'),
            fetchYouTubeCategoryAndRender('#yt-tech-row', '#discover-yt-tech-section', 'Technology & Science', 'fas fa-microchip', 'technology science news'),
            fetchYouTubeCategoryAndRender('#yt-comedy-row', '#discover-yt-comedy-section', 'Entertainment & Podcasts', 'fas fa-podcast', 'popular podcast episodes entertainment')
          );
        }
      }

      await Promise.all(promises);
    } catch (err) {
      console.error("Discover load error:", err);
    } finally {
      isDiscoverLoading = false;
    }
  }

  function renderYouTubeDiscoverRow(sel, items) {
    const row = $(sel);
    if (!row) return;
    row.innerHTML = '';
    row.style.cssText = 'display: flex; gap: 18px; overflow-x: auto; padding: 6px 4px 18px; scrollbar-width: none; -ms-overflow-style: none;';

    const allowedItems = (items || []).filter(isAgeAllowed);
    if (!allowedItems || allowedItems.length === 0) {
      row.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.85rem">No YouTube videos available.</div>';
      return;
    }

    allowedItems.slice(0, 20).forEach(item => {
      const card = document.createElement('div');
      card.className = 'yt-discover-card';
      card.style.cssText = 'min-width: 270px; max-width: 300px; flex: 0 0 280px; display: flex; flex-direction: column; background: rgba(255,255,255,0.03); border-radius: 12px; overflow: hidden; cursor: pointer; border: 1px solid rgba(255,255,255,0.06); transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.4, 1), background 0.2s, box-shadow 0.2s, border-color 0.2s;';

      const itemTitle = item.title || item.name || 'YouTube Video';
      const thumb = item.thumbnail || item.poster || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
      const author = item.author || 'YouTube';
      const duration = item.duration || '';
      const views = item.views || '';
      const published = item.published || '';

      card.innerHTML = `
        <div style="position: relative; width: 100%; aspect-ratio: 16 / 9; background: #111; overflow: hidden;">
          <img src="${thumb}" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease;" loading="lazy" onerror="this.src='imgs/no-backdrop.png'">
          ${duration ? `<div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.85); color: #fff; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; z-index: 2;">${escapeHTML(String(duration))}</div>` : ''}
          <button class="yt-copy-link-btn" title="Copy YouTube Link" style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 8px; background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.2); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; transition: all 0.2s ease;">
            <i class="fas fa-link" style="font-size: 12px;"></i>
          </button>
          <div class="yt-play-hover" style="position: absolute; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: #ff0000; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(255,0,0,0.5);">
              <i class="fas fa-play" style="color: #fff; font-size: 16px; margin-left: 2px;"></i>
            </div>
          </div>
        </div>
        <div style="padding: 12px; display: flex; flex-direction: column; flex: 1; justify-content: space-between;">
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 6px;" title="${escapeHTML(itemTitle)}">
            ${escapeHTML(itemTitle)}
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.7); font-size: 0.8rem; font-weight: 600; margin-bottom: 3px;">
              <i class="fab fa-youtube" style="color: #ffffff; font-size: 13px;"></i>
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

      const copyBtn = card.querySelector('.yt-copy-link-btn');
      if (copyBtn) {
        copyBtn.onmouseenter = (e) => {
          e.stopPropagation();
          copyBtn.style.transform = 'scale(1.1)';
          copyBtn.style.background = 'rgba(0,0,0,0.9)';
          copyBtn.style.borderColor = 'rgba(255,255,255,0.4)';
        };
        copyBtn.onmouseleave = (e) => {
          e.stopPropagation();
          copyBtn.style.transform = 'scale(1)';
          copyBtn.style.background = 'rgba(0,0,0,0.75)';
          copyBtn.style.borderColor = 'rgba(255,255,255,0.2)';
        };
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          const ytUrl = `https://www.youtube.com/watch?v=${item.id}`;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ytUrl);
          }
          if (typeof showToast === 'function') {
            showToast('YouTube link copied!');
          }
          const icon = copyBtn.querySelector('i');
          if (icon) {
            icon.className = 'fas fa-check';
            setTimeout(() => { icon.className = 'fas fa-link'; }, 2000);
          }
        };
      }

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
        card.style.background = 'rgba(255,255,255,0.03)';
        card.style.borderColor = 'rgba(255,255,255,0.06)';
        card.style.boxShadow = 'none';
        const hoverIcon = card.querySelector('.yt-play-hover');
        if (hoverIcon) hoverIcon.style.opacity = '0';
        const img = card.querySelector('img');
        if (img) img.style.transform = 'scale(1)';
      };

      card.onclick = () => {
        window.appData = window.appData || {};
        window.appData.ytCache = window.appData.ytCache || {};
        window.appData.ytCache[item.id] = {
          id: item.id,
          title: item.title,
          author: item.author,
          thumbnail: thumb || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
          duration: item.duration
        };
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

      row.appendChild(card);
    });
  }

  function renderDiscoverRow(sel, items, isTop10 = false) {
    const row = $(sel);
    if (!row) return;
    row.innerHTML = '';

    const allowedItems = (items || []).filter(isAgeAllowed);

    if (!allowedItems || allowedItems.length === 0) {
      row.innerHTML = '<div style="grid-column:1/-1; padding:30px; text-align:center; color:var(--text-muted); font-size:0.85rem">No content available at the moment.</div>';
      return;
    }

    const localTitles = new Set([
      ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
      ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
    ]);

    const isSpecialTenRow = isTop10 || sel === '#popular-movies-row' || sel === '#popular-series-row' || sel === '#anime-row';
    const limit = isSpecialTenRow ? 10 : 20;

    // Pre-filter items that have valid posters so that rows always have exactly `limit` items
    const validItems = allowedItems.filter(item => {
      const isYT = item.type === 'youtube' || item.isYoutube;
      const raw = item.poster || item.thumbnail || item.poster_path || '';
      return Boolean(raw || item.isLocal || isYT || localTitles.has((item.title || item.name || '').toLowerCase()));
    });
    const itemsToRender = (validItems.length >= limit ? validItems : allowedItems).slice(0, limit);

    itemsToRender.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'discover-card';

      const isYT = item.type === 'youtube' || item.isYoutube;
      const title = item.title || item.name || 'Unknown';
      let rawPoster = item.poster || item.thumbnail || item.cover || item.image || item.poster_path || '';
      if (!rawPoster && (item.isMusic || item.type === 'music')) {
        const meta = typeof getMusicMeta === 'function' ? getMusicMeta(item) : {};
        rawPoster = meta?.cover || (appData.banners && (appData.banners[item.path] || appData.banners[item.id])) || '';
      }
      
      // Auto-heal relative paths or dead cinemeta image CDN domains
      if (rawPoster && typeof rawPoster === 'string') {
        if (rawPoster.includes('v3-cinemeta.strem.io') && (rawPoster.includes('/poster/') || rawPoster.includes('/img'))) {
          // cinemeta CDN doesn't serve images — convert to metahub
          const idMatch = rawPoster.match(/\/poster\/\w+\/(tt\d+)\//);
          if (idMatch) rawPoster = `https://images.metahub.space/poster/medium/${idMatch[1]}/img`;
          else rawPoster = '';
        } else if (rawPoster.startsWith('/tt') || rawPoster.startsWith('tt')) {
          const cleanId = rawPoster.replace(/^\//, '').split('/')[0];
          rawPoster = `https://images.metahub.space/poster/medium/${cleanId}/img`;
        } else if (rawPoster === 'img' || rawPoster === '/img' || rawPoster === 'poster.jpg' || rawPoster === '/poster.jpg') {
          const cleanId = item.id || item.imdb_id;
          rawPoster = cleanId ? `https://images.metahub.space/poster/medium/${cleanId}/img` : '';
        } else if (rawPoster.includes('(live|images|episodes).metahub.space')) {
          // leave valid metahub URLs as-is
        }
      }

      let posterUrl = typeof localImg === 'function' ? localImg(rawPoster) : rawPoster;
      // Guard against transparent svg or empty strings
      if (posterUrl && posterUrl.startsWith('data:image/svg+xml')) {
        posterUrl = '';
      }

      const inLib = localTitles.has(title.toLowerCase());
      if (!posterUrl && !inLib && !item.isLocal && !isYT && !isSpecialTenRow && !item.isMusic) {
        return; // Hide items with no poster for non-special shelves
      }

      const rating = parseFloat(item.vote_average || item.score) || 0;
      const year = (item.release_date || item.first_air_date || item.seasonYear || item.published || '').toString().slice(0, 4);

      card.innerHTML = `
        <div class="discover-poster-wrap">
          <div class="discover-poster-placeholder" style="width:100%; height:100%; display:${posterUrl ? 'none' : 'flex'}; align-items:center; justify-content:center; background:var(--bg-surface-2);"><i class="fas ${item.isMusic ? 'fa-music' : 'fa-image'} fa-2x" style="opacity: 0.3; color:${item.isMusic ? '#10b981' : 'inherit'};"></i></div>
          ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy" onerror="this.style.display='none'; this.previousElementSibling.style.display='flex';">` : ''}
          ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
          ${item.isMusic ? `<div style="position:absolute; bottom:8px; right:8px; background:rgba(16,185,129,0.9); color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:6px; z-index:2;">AUDIO</div>` : (isYT ? `<div style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.85); color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:6px; z-index:2;">${item.duration || 'VIDEO'}</div>` : '')}
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="discover-meta">
            ${item.isMusic ? `<span style="color:#10b981; font-weight:700;"><i class="fas fa-music"></i> ${escapeHTML(item.artist || 'Music')}</span>` : (isYT ? `<span style="color:#ffffff; font-weight:700;"><i class="fab fa-youtube"></i> ${escapeHTML(item.author || 'YouTube')}</span>` : getBadgeHTML(item))}
            <span>${year}</span>
            ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
            ${(!isYT && !item.isMusic) ? `<span class="discover-age-badge-container">${getAgeBadgeHTML(getItemCertification(item))}</span>` : ''}
          </div>
        </div>
      `;

      if (item.isMusic || item.type === 'music') {
        card.onclick = () => {
          if (typeof window.playMusic === 'function') {
            window.playMusic(item);
          }
        };
      } else if (isYT) {
        card.onclick = () => {
          const ytThumb = item.thumbnail || item.poster || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
          window.appData = window.appData || {};
          window.appData.ytCache = window.appData.ytCache || {};
          window.appData.ytCache[item.id] = {
            id: item.id,
            title: item.title,
            author: item.author,
            thumbnail: ytThumb,
            duration: item.duration
          };
          if (typeof window.playVideo === 'function') {
            window.playVideo({
              type: 'youtube',
              isYoutube: true,
              id: item.id,
              videoId: item.id,
              title: item.title,
              poster: ytThumb,
              thumbnail: ytThumb,
              author: item.author,
              duration: item.duration
            });
          }
        };
      } else if (item.social || (item.isLocal && item.path && !item.tmdb_id && !item.imdb_id && !item.episodes)) {
        card.onclick = () => {
          if (typeof window.playVideo === 'function') {
            window.playVideo(item);
          } else if (typeof window.playLocalFile === 'function') {
            window.playLocalFile(item.path);
          }
        };
      } else {
        card.onclick = () => openDiscoverDetail(item);
        if (typeof getTraktOrImdbPoster === 'function') {
          getTraktOrImdbPoster(item, null, card);
        }
      }

      card.oncontextmenu = e => {
        if (typeof window.openContextMenuForItem === 'function') {
          window.openContextMenuForItem({
            ...item,
            id: item.path || item.id,
            title: item.title || item.name,
            path: item.path,
            type: item.isMusic ? 'music' : (item.social ? 'social' : (item.type || 'movie')),
            isLocal: true,
            isMusic: !!item.isMusic
          }, e);
        }
      };

      if (typeof enableHoverPreview === 'function') enableHoverPreview(card, item, '.discover-poster-wrap');

      if (isTop10) {
        const wrapper = document.createElement('div');
        wrapper.className = 'top10-item-wrapper';
        const rankEl = document.createElement('div');
        rankEl.className = 'top10-rank-number';
        rankEl.textContent = index + 1;
        wrapper.appendChild(rankEl);
        wrapper.appendChild(card);
        row.appendChild(wrapper);
      } else {
        row.appendChild(card);
      }
    });
  }

  async function performDiscoverSearch() {
    const q = $('#search-discover')?.value.trim();
    if (!q) {
      const results = $('#discover-results');
      const content = $('#discover-content');
      if (results) results.style.display = 'none';
      if (content) content.style.display = 'flex';
      return;
    }
    const content = $('#discover-content');
    const results = $('#discover-results');
    if (content) content.style.display = 'none';
    if (results) results.style.display = 'block';
    
    const grid = $('#discover-search-grid');
    if (grid) {
      grid.innerHTML = '';
      for (let i = 0; i < 24; i++) {
        const skel = document.createElement('div');
        skel.className = 'discover-card-skeleton';
        skel.innerHTML = `
          <div class="discover-poster-wrap" style="aspect-ratio:2/3.1;background:var(--bg-surface-2);border-radius:12px;animation:pulse 1.5s infinite"></div>
          <div style="height:12px;width:70%;background:var(--bg-surface-1);margin-top:10px;border-radius:4px;animation:pulse 1.5s infinite"></div>
        `;
        grid.appendChild(skel);
      }
    }
    
    try {
      const qClean = q.trim();
      let allResults = [];

      const res = await window.api.invoke('unified-search', qClean);
      allResults = res?.results || [];

      const creds = await window.api.invoke('trakt-connection-status');
      if (creds && creds.connected) {
        try {
          const [resMovies, resShows] = await Promise.all([
            window.api.invoke('trakt-search', { query: qClean, type: 'movie' }),
            window.api.invoke('trakt-search', { query: qClean, type: 'series' })
          ]);
          const traktResults = [...(resMovies?.results || []), ...(resShows?.results || [])];
          
          const existingIds = new Set(allResults.map(r => String(r.id || r.imdb_id || '').toLowerCase()));
          const existingTitles = new Set(allResults.map(r => String(r.title || r.name || '').toLowerCase()));
          
          traktResults.forEach(item => {
            const itemId = String(item.id || item.imdb_id || '').toLowerCase();
            const itemTitle = String(item.title || item.name || '').toLowerCase();
            if (!existingIds.has(itemId) && !existingTitles.has(itemTitle)) {
              allResults.push(item);
            }
          });
        } catch (traktErr) {
          console.warn('[Search] Trakt search merging failed:', traktErr);
        }
      }

      if (grid) {
        grid.innerHTML = '';
        const allowedResults = allResults.filter(isAgeAllowed);

        if (!allowedResults.length) {
          grid.innerHTML = `<div style="padding:60px 40px;text-align:center;color:var(--text-muted);line-height:1.6;grid-column: 1/-1">No results found for "${escapeHTML(qClean)}"</div>`;
          return;
        }
        
        const series = allowedResults.filter(r => r.type === 'series' || r.type === 'tv');
        const movies = allowedResults.filter(r => r.type === 'movie');
        
        const localTitles = new Set([
          ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
          ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
        ]);

        const renderSection = (title, items) => {
          if (!items.length) return;
          
          const header = document.createElement('h3');
          header.style.cssText = 'grid-column: 1/-1; margin: 20px 0 10px 0; font-size: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 1px;';
          header.innerText = title;
          grid.appendChild(header);
          
          items.slice(0, 20).forEach(item => {
            const card = document.createElement('div');
            card.className = 'discover-card';
            if (item.poster) {
              posterUrl = localImg(item.poster);
            } else if (item.poster_path) {
              posterUrl = localImg(item.poster_path);
            }

            const inLib = localTitles.has(itemTitle.toLowerCase());
            if (!posterUrl && !inLib && !item.isLocal) {
              return; // Hide items with no poster
            }

            const year = (item.release_date || item.first_air_date || item.seasonYear || item.releaseYear || item.year || '').toString().slice(0, 4);
            const rating = parseFloat(item.vote_average || item.score || item.rating) || 0;
            
            card.innerHTML = `
              <div class="discover-poster-wrap">
                <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
                ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy" onerror="this.closest('.discover-card')?.remove();">` : ''}
                ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
              </div>
              <div class="discover-info">
                <div class="discover-title" title="${escapeHTML(itemTitle)}">${escapeHTML(itemTitle)}</div>
                <div class="discover-meta">
                  ${getBadgeHTML(item)}
                  <span>${year}</span>
                  ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
                  <span class="discover-age-badge-container">${getAgeBadgeHTML(getItemCertification(item))}</span>
                </div>
              </div>
            `;
            card.onclick = () => openDiscoverDetail(item);
            if (typeof enableHoverPreview === 'function') enableHoverPreview(card, item, '.discover-poster-wrap');
            grid.appendChild(card);
            getTraktOrImdbPoster(item, null, card);
          });
        };

        renderSection('Series', series);
        renderSection('Movies', movies);
      }

    } catch (err) {
      console.error('[Search]', err);
      if (grid) grid.innerHTML = '<div style="padding:40px;text-align:center;color:#EF4444;grid-column: 1/-1">Error searching content</div>';
    }
  }

  async function clearContinueWatching() {
    if (!currentProfile) return;
    if (confirm('Are you sure you want to clear your continue watching history?')) {
      const profileId = currentProfile.id;

      // 1. Wipe local in-memory profile state immediately
      currentProfile.playback = {};
      if (window.currentProfile) window.currentProfile.playback = {};

      if (window.appData && Array.isArray(window.appData.profiles)) {
        const matched = window.appData.profiles.find(p => p.id === profileId);
        if (matched) matched.playback = {};
      }
      if (window.appData && window.appData.playback) {
        delete window.appData.playback;
      }

      // 2. Immediate persist to disk and backend session
      if (typeof window.persist === 'function') {
        try {
          await window.persist(true);
        } catch (_) {}
      }

      // 3. Dual-Layer Supabase Deletion
      // Layer A: Direct Renderer Client
      try {
        const rClient = typeof window.getSupabaseRendererClient === 'function' ? window.getSupabaseRendererClient() : null;
        if (rClient && profileId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
          rClient.from('playback_history').delete().eq('profile_id', profileId).then(res => {
            if (res?.error) console.warn('[ContinueWatching] Renderer Supabase clear failed:', res.error.message);
            else console.log('[ContinueWatching] Renderer Supabase playback_history cleared for profile:', profileId);
          }).catch(err => console.warn('[ContinueWatching] Renderer Supabase clear error:', err));
        }
      } catch (clientErr) {
        console.warn('[ContinueWatching] Renderer direct Supabase client error:', clientErr);
      }

      // Layer B: Main Process IPC
      if (profileId && window.api && typeof window.api.clearProfilePlayback === 'function') {
        window.api.clearProfilePlayback(profileId).then(res => {
          if (res && res.error) {
            console.warn('[ContinueWatching] Main IPC clear failed:', res.error);
          } else {
            console.log('[ContinueWatching] Main IPC playback_history cleared for profile:', profileId);
          }
        }).catch(err => {
          console.warn('[ContinueWatching] clearProfilePlayback error:', err);
        });
      }

      // 4. Immediate Re-render across both Discover and Library shelves
      if (typeof renderContinueWatchingDiscover === 'function') {
        renderContinueWatchingDiscover();
      }
      if (typeof window.renderLibContinueWatching === 'function') {
        window.renderLibContinueWatching();
      } else if (typeof renderLibContinueWatching === 'function') {
        renderLibContinueWatching();
      }
      if (typeof renderEmptySearchState === 'function') {
        renderEmptySearchState();
      }

      showToast('Continue watching history cleared');
    }
  }

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

    const genres = (detail.genres || []).map(g => g.name || g);
    addGroup('Genres', genres);

    const directors = (detail.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => c.name);
    addGroup('Directors', directors);

    const cast = (detail.credits?.cast || [])
      .slice(0, 6)
      .map(c => c.name);
    addGroup('Cast', cast);
  }

  async function openDiscoverDetail(item) {
    if (!isAgeAllowed(item)) {
      showToast('This content is restricted by age rating filters.');
      return;
    }
    currentDiscoverItem = item;

    const isKitsuItem = item.source === 'kitsu' || item.source === 'jikan' || item.source === 'mal' || item.source === 'anilist' || (item.id && (String(item.id).startsWith('kitsu:') || String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:') || String(item.id).startsWith('anilist:')));
    const type = isKitsuItem ? 'anime' : (item.media_type || item.type || (item.title ? 'movie' : 'tv'));

    const detailView = $('#view-discover-detail');
    if (detailView) {
      if (type === 'movie') detailView.classList.add('layout-full');
      else detailView.classList.remove('layout-full');
    }

    appData.tmdbCache[item.id] = {
      tmdbId: item.id,
      type: type,
      title: item.title || item.name,
      posterPath: item.poster_path,
      backdropPath: item.backdrop_path,
      rating: item.vote_average,
      overview: item.overview,
      year: (item.release_date || item.first_air_date || '').slice(0, 4)
    };

    if (typeof window.renderUnifiedDetail === 'function' && !$('#dd-backdrop')) {
      await window.renderUnifiedDetail(item);
      return;
    }

    const bd = $('#dd-backdrop');
    const poster = $('#dd-poster');
    if (!bd || !poster) {
      console.warn('[Discover] Legacy detail DOM missing; cannot open detail');
      return;
    }

    if (item.background) {
      bd.style.backgroundImage = `url(${item.background})`;
    } else if (item.backdrop_path) {
      bd.style.backgroundImage = `url(${item.backdrop_path})`;
    } else if (item.poster) {
      bd.style.backgroundImage = `url(${item.poster})`;
    } else if (item.poster_path) {
      bd.style.backgroundImage = `url(${item.poster_path})`;
    } else {
      bd.style.backgroundImage = 'none';
      bd.style.background = 'var(--bg-surface)';
    }

    const itemPoster = item.poster || item.poster_path;
    if (itemPoster) {
      poster.src = itemPoster;
      poster.style.display = 'block';
    } else {
      poster.style.display = 'none';
    }

    $('#dd-title').textContent = item.title || item.name || 'Unknown';
    $('#dd-overview').textContent = item.overview || item.synopsis || 'No description available.';

    const meta = $('#dd-meta');
    const sourceLabel = isKitsuItem ? 'Kitsu' : 'TMDB';

    if (isKitsuItem) {
      const rating = parseFloat(item.vote_average) || 0;
      const year = (item.first_air_date || '').slice(0, 4) || '';
      meta.innerHTML = `
        <span class="dd-tag" style="background:#F7523922;color:#F75239">★ ${rating ? rating.toFixed(1) : 'N/A'} <span style="opacity:0.6;font-size:10.5px;margin-left:5px">Kitsu ID: ${item.id}</span></span>
        ${year ? `<span class="dd-tag">${year}</span>` : ''}
        <span class="dd-tag">${(item.format || 'ANIME').toUpperCase()}</span>
        ${item.episodes ? `<span class="dd-tag">${item.episodes} Episodes</span>` : ''}
        ${item.status ? `<span class="dd-tag">${item.status.toUpperCase()}</span>` : ''}
      `;
    } else {
      meta.innerHTML = `
        <span class="dd-tag">★ ${(item.vote_average || 0).toFixed?.(1) || 'N/A'} <span style="opacity:0.6;font-size:10.5px;margin-left:5px;letter-spacing:0.5px">TMDB ID: ${item.id}</span></span>
        <span class="dd-tag">${(item.release_date || item.first_air_date || '').slice(0, 4)}</span>
        <span class="dd-tag">${type.toUpperCase()}</span>
      `;
    }

    const actions = $('#dd-actions'); actions.innerHTML = '';

    const wlBtn = document.createElement('button');
    wlBtn.id = 'btn-toggle-watchlist';
    wlBtn.className = 'btn-primary';
    wlBtn.innerHTML = 'My List';
    actions.appendChild(wlBtn);
    if (typeof updateWatchlistButton === 'function') updateWatchlistButton(item.id);
    wlBtn.onclick = () => { if (typeof toggleWatchlist === 'function') toggleWatchlist(item); };

    const watchedBtn = document.createElement('button');
    watchedBtn.className = 'btn-outline';
    const isWatched = currentProfile?.playback?.[getPlaybackKey(item)]?.watched;
    watchedBtn.innerHTML = isWatched ?
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:8px"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Watched' :
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="20 6 9 17 4 12"/></svg> Mark as Watched';

    watchedBtn.onclick = () => {
      const key = getPlaybackKey(item);
      currentProfile.playback[key] = currentProfile.playback[key] || { time: 0, duration: 0, lastWatched: Date.now(), meta: item };
      currentProfile.playback[key].watched = !currentProfile.playback[key].watched;
      persist();
      openDiscoverDetail(item);
      showToast(currentProfile.playback[key].watched ? 'Marked as Watched' : 'Marked as Unwatched');
    };
    actions.appendChild(watchedBtn);

    $('#dd-extra-info').innerHTML = '';
    $('#dd-cast').innerHTML = '<h3>Cast</h3><div class="dd-cast-row">Loading cast...</div>';
    $('#dd-seasons').innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted)"><div class="spinner" style="margin: 0 auto 15px auto;"></div>Loading seasons and episodes...</div>';
    $('#dd-streams-list').innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted)"><div class="spinner" style="margin: 0 auto 15px auto;"></div>Searching for best links...</div>`;

    switchView('discover-detail');

    const topPlayBtn = $('#dd-play-btn-top');
    if (topPlayBtn) {
      topPlayBtn.onclick = () => {
        const firstStream = $('#dd-streams-list .stream-item');
        if (firstStream) {
          firstStream.click();
        } else {
          const firstEp = $('#dd-seasons .episode-item');
          if (firstEp) firstEp.click();
          else showToast('No playable links found yet.');
        }
      };
    }

    if (isKitsuItem) {
      (async () => {
        let kitsuId = item.kitsuId || (String(item.id).startsWith('kitsu:') ? String(item.id).replace('kitsu:', '') : null);
        let malId = null;
        let imdbIdForCinemeta = null;

        if (String(item.id).startsWith('kitsu:') || item.source === 'kitsu') {
          if (kitsuId) {
            try {
              const mappingsRes = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/mappings?page[limit]=20`);
              const mappingsJson = await mappingsRes.json();
              if (mappingsJson && mappingsJson.data) {
                const malMapping = mappingsJson.data.find(m => m.attributes?.externalSite === 'myanimelist/anime');
                if (malMapping) malId = malMapping.attributes.externalId;
                
                const imdbMapping = mappingsJson.data.find(m => m.attributes?.externalSite === 'imdb');
                if (imdbMapping) {
                  imdbIdForCinemeta = imdbMapping.attributes.externalId;
                  item.imdb_id = imdbIdForCinemeta;
                  item.imdbId = imdbIdForCinemeta;
                }
              }
            } catch (e) {
              console.warn('[Discover] Resolving Kitsu mappings failed:', e);
            }
          }
        }

        if (!malId) {
          malId = String(item.id).replace('mal:', '').replace('jikan:', '').replace('kitsu:', '');
        }

        if (malId && (!kitsuId || !imdbIdForCinemeta)) {
          try {
            const kitsuRes = await fetch(`https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item&page[limit]=1`);
            const kitsuJson = await kitsuRes.json();
            const mapped = kitsuJson?.included?.[0];
            if (mapped) {
              kitsuId = mapped.id;
              item.kitsuId = mapped.id;
              item.id = `kitsu:${mapped.id}`;
              item.source = 'kitsu';

              const mappingsRes = await fetch(`https://kitsu.io/api/edge/anime/${mapped.id}/mappings`);
              const mappingsJson = await mappingsRes.json();
              const imdbMapping = mappingsJson?.data?.find(m => m.attributes?.externalSite === 'imdb');
              if (imdbMapping) {
                imdbIdForCinemeta = imdbMapping.attributes.externalId;
                item.imdb_id = imdbIdForCinemeta;
                item.imdbId = imdbIdForCinemeta;
              }
            }
          } catch (e) {
            console.warn('[Discover] MAL->Kitsu mapping failed:', e.message);
          }
        }

        try {
          if (malId && !isNaN(malId)) {
            const jikanRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/full`);
            const jikanJson = await jikanRes.json();
            const data = jikanJson.data;
            if (data) {
              $('#dd-title').textContent = data.title_english || data.title || item.title || 'Unknown';
              $('#dd-overview').textContent = data.synopsis || item.overview || 'No description available.';
              const rating = parseFloat(data.score || item.vote_average) || 0;
              const year = data.year || (data.aired?.prop?.from?.year) || '';
              
              let animeCert = null;
              if (data.rating) {
                animeCert = data.rating.split(' - ')[0].trim();
              }
              if (animeCert) {
                item.certification = animeCert;
                appData.cinemetaCache[`mal:${malId}`] = appData.cinemetaCache[`mal:${malId}`] || {};
                appData.cinemetaCache[`mal:${malId}`].certification = animeCert;
                appData.cinemetaCache[`mal:${malId}`].content_rating = animeCert;
                persist();
              }

              meta.innerHTML = `
                <span class="dd-rating-badge dd-rating-mal"><span class="dd-rating-source">MAL</span><span class="dd-rating-val">★ ${rating ? rating.toFixed(1) : 'N/A'}</span></span>
                ${year ? `<span class="dd-tag">${year}</span>` : ''}
                <span class="dd-tag">${(data.type || item.format || 'ANIME').toUpperCase()}</span>
                ${data.episodes ? `<span class="dd-tag">${data.episodes} Episodes</span>` : ''}
                ${data.status ? `<span class="dd-tag">${data.status.toUpperCase()}</span>` : ''}
              `;

              if (!item.poster_path && data.images?.jpg?.large_image_url) {
                poster.src = data.images.jpg.large_image_url;
                poster.style.display = 'block';
              }

              if (data.trailer && data.trailer.youtube_id) {
                const btn = document.createElement('button'); btn.className = 'btn-outline';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Watch Trailer';
                btn.onclick = () => {
                  if (typeof window.playVideo === 'function') {
                    window.playVideo({
                      type: 'youtube',
                      isYoutube: true,
                      id: data.trailer.youtube_id,
                      videoId: data.trailer.youtube_id,
                      title: `${data.title || (item && item.title) || 'Anime'} (Trailer)`
                    });
                  } else {
                    window.api.openExternal(`https://www.youtube.com/watch?v=${data.trailer.youtube_id}`);
                  }
                };
                actions.appendChild(btn);
              }
            }
          }
        } catch (e) {
          console.warn('Failed to load Jikan full details:', e);
        }

        let cinemetaMeta = null;
        if (imdbIdForCinemeta) {
          try {
            const cinemetaDetail = await window.api.invoke('cinemeta-details', { id: imdbIdForCinemeta, type: 'tv' });
            if (cinemetaDetail && cinemetaDetail.meta) {
              cinemetaMeta = cinemetaDetail.meta;
              if (cinemetaDetail.meta.poster) {
                poster.src = cinemetaDetail.meta.poster;
                poster.style.display = 'block';
              }
              if (cinemetaDetail.meta.background) {
                bd.style.backgroundImage = `url(${cinemetaDetail.meta.background})`;
              }
              if (cinemetaDetail.meta.logo) {
                const oldLogo = $('.dd-logo');
                if (oldLogo) oldLogo.remove();

                const logoImg = document.createElement('img');
                logoImg.src = localImg(cinemetaDetail.meta.logo);
                logoImg.className = 'dd-logo';
                logoImg.style = 'max-width:200px; max-height:80px; object-fit:contain; margin-bottom:10px;';
                $('#dd-title').style.display = 'none';
                $('#dd-title').parentElement.insertBefore(logoImg, $('#dd-title'));
              }
            }
          } catch (e) {
            console.warn('Failed to load Cinemeta visuals for Anime:', e);
          }
        }

        const searchTitle = item.title_english || item.title_romaji || item.title || item.name;
        const isMovie = (item.format || '').toUpperCase() === 'MOVIE' || (item.type || '').toUpperCase() === 'MOVIE';

        if (!isMovie) {
          if (cinemetaMeta && cinemetaMeta.videos && cinemetaMeta.videos.length > 0) {
            const wrap = $('#dd-seasons');
            wrap.innerHTML = '<h3 style="margin-bottom:12px">Seasons</h3><div class="season-tabs" style="margin-bottom:15px"></div><div class="episode-list"></div>';
            const tabs = wrap.querySelector('.season-tabs');
            const epList = wrap.querySelector('.episode-list');
            
            const uniqueSeasons = [...new Set(cinemetaMeta.videos.map(v => v.season))].filter(s => s !== undefined && s !== null && s >= 0).sort((a, b) => a - b);
            uniqueSeasons.forEach((seasonNum, idx) => {
              const btn = document.createElement('button');
              btn.className = `season-tab ${idx === 0 ? 'active' : ''}`;
              btn.textContent = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
              btn.onclick = () => {
                tabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                renderCinemetaEpisodes(cinemetaMeta.videos, seasonNum, epList, item);
              };
              tabs.appendChild(btn);
            });
            if (uniqueSeasons.length > 0) renderCinemetaEpisodes(cinemetaMeta.videos, uniqueSeasons[0], epList, item);
          } else {
            const wrap = $('#dd-seasons');
            wrap.innerHTML = '<h3 style="margin-bottom:12px">Episodes</h3><div class="episode-list">Loading episodes...</div>';
            const epList = wrap.querySelector('.episode-list');

            (async () => {
              let episodes = [];
              try {
                if (malId && !isNaN(malId)) {
                  const epRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes`);
                  const epData = await epRes.json();
                  episodes = epData.data || [];
                }
              } catch (e) {
                console.warn('Jikan Episodes fetch failed, using fallback list:', e);
              }

              epList.innerHTML = '';
              const count = episodes.length > 0 ? episodes.length : (item.episodes > 0 ? item.episodes : 12);
              
              const episodeElements = [];
              for (let i = 1; i <= count; i++) {
                const epObj = episodes[i - 1] || { mal_id: i, title: `Episode ${i}` };
                const epEl = renderAnimeEpisode(epList, epObj, item, searchTitle);
                episodeElements.push({ epEl, epNum: i });
              }

              if (epList.firstChild) epList.firstChild.click();

              const kitsuId = item.kitsuId || (item.source === 'kitsu' ? String(item.id).replace('kitsu:', '') : null);
              
              const fetchPromises = episodeElements.map(async ({ epEl, epNum }) => {
                const metaResult = await EpisodeMetadataResolver.resolveEpisode(item, kitsuId, malId, imdbIdForCinemeta, epNum);
                
                if (metaResult.title) {
                  const titleEl = epEl.querySelector('.episode-title');
                  if (titleEl) titleEl.textContent = metaResult.title;
                }
                if (metaResult.overview) {
                  const descEl = epEl.querySelector('.episode-desc');
                  if (descEl) descEl.textContent = metaResult.overview;
                }

                const tryLoadSrc = (srcUrl) => {
                  return new Promise((resolveSrc, rejectSrc) => {
                    const img = epEl.querySelector('.ep-thumb');
                    const pulse = epEl.querySelector('.skeleton-pulse');
                    const blurred = epEl.querySelector('.ep-thumb-blurred');
                    
                    if (img && srcUrl) {
                      img.src = srcUrl;
                      img.onload = () => {
                        img.style.display = 'block';
                        if (pulse) pulse.style.display = 'none';
                        if (blurred) blurred.style.display = 'none';
                        resolveSrc(true);
                      };
                      img.onerror = () => {
                        rejectSrc(new Error('Image failed to load: ' + srcUrl));
                      };
                    } else {
                      resolveSrc(false);
                    }
                  });
                };

                if (metaResult.thumbnail) {
                  try {
                    await tryLoadSrc(metaResult.thumbnail);
                  } catch (err) {
                    console.warn(`[EpisodeImageLoad] Failed to load kitsu thumbnail for ep ${epNum}: ${metaResult.thumbnail}. Retrying with TMDB fallback...`);
                    try {
                      const tmdbFallback = await EpisodeMetadataResolver.fetchTmdbStill(imdbIdForCinemeta, epNum);
                      if (tmdbFallback && tmdbFallback.thumbnail) {
                        await tryLoadSrc(tmdbFallback.thumbnail);
                      } else {
                        const pulse = epEl.querySelector('.skeleton-pulse');
                        if (pulse) pulse.style.display = 'none';
                      }
                    } catch (tmdbErr) {
                      const pulse = epEl.querySelector('.skeleton-pulse');
                      if (pulse) pulse.style.display = 'none';
                    }
                  }
                } else {
                  try {
                    const tmdbFallback = await EpisodeMetadataResolver.fetchTmdbStill(imdbIdForCinemeta, epNum);
                    if (tmdbFallback && tmdbFallback.thumbnail) {
                      await tryLoadSrc(tmdbFallback.thumbnail);
                    } else {
                      const pulse = epEl.querySelector('.skeleton-pulse');
                      if (pulse) pulse.style.display = 'none';
                    }
                  } catch (tmdbErr) {
                    const pulse = epEl.querySelector('.skeleton-pulse');
                    if (pulse) pulse.style.display = 'none';
                  }
                }
              });

              Promise.allSettled(fetchPromises).then(() => {
                console.log('[EpisodeListRefactor] Background metadata resolution complete.');
              });
            })();
          }
        } else {
          const kitsuId = item.kitsuId || (item.source === 'kitsu' ? String(item.id).replace('kitsu:', '') : null);
          loadStreams({ ...item, title: searchTitle, name: searchTitle, media_type: 'anime', kitsuId, episode: 1, season: 1 }, 'anime');
        }

        function renderAnimeEpisode(container, ep, item, searchTitle) {
          const el = document.createElement('div'); el.className = 'episode-item';
          const epNum = ep.mal_id || ep.episode;
          const epTitle = ep.title || `Episode ${epNum}`;
          const epDesc = ep.synopsis || `Episode ${epNum}`;

          let posterPath = item.poster_path || item.poster;
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

          el.innerHTML = `<div class="ep-thumb-wrap"><img src="${fullPosterUrl}" class="ep-thumb-blurred" style="opacity:0.4; filter:blur(4px); object-fit:cover; width:100%; height:100%; position:absolute; inset:0;"><div class="skeleton-pulse"></div><img class="ep-thumb" style="display:none; opacity:0.8; object-fit:cover; width:100%; height:100%; position:absolute; inset:0;"><div class="ep-number-overlay">${epNum}</div><div class="ep-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div></div><div class="episode-info"><div class="episode-title">${escapeHTML(epTitle)}</div><div class="episode-desc">${escapeHTML(epDesc)}</div></div>`;
          el.onclick = () => {
            document.querySelectorAll('.episode-item').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            const kitsuId = item.kitsuId || (item.source === 'kitsu' ? String(item.id).replace('kitsu:', '') : null);
            loadStreams({ ...item, title: searchTitle, name: searchTitle, season: 1, episode: epNum, media_type: 'anime', kitsuId }, 'anime');
          };
          container.appendChild(el);
          return el;
        }

        $('#dd-cast .dd-cast-row').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading characters...</div>';
        (async () => {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const castRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/characters`);
            const castJson = await castRes.json();
            const castRow = $('#dd-cast .dd-cast-row'); castRow.innerHTML = '';
            if (castJson.data && castJson.data.length > 0) {
              castJson.data.slice(0, 12).forEach(c => {
                const card = document.createElement('div'); card.className = 'dd-cast-card';
                const img = c.character?.images?.jpg?.image_url || 'imgs/no-backdrop.png';
                card.innerHTML = `<img src="${img}" class="dd-cast-img"><div class="dd-cast-info"><span class="dd-cast-name">${escapeHTML(c.character?.name || '')}</span><span class="dd-cast-char">${escapeHTML(c.role || '')}</span></div>`;
                castRow.appendChild(card);
              });
            } else {
              castRow.innerHTML = '<div style="padding:20px;color:var(--text-muted)">No character data available.</div>';
            }
          } catch (e) { $('#dd-cast .dd-cast-row').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load cast.</div>'; }
        })();

      })();
      return;
    }

    (async () => {
      try {
        let imdbId = item.imdb_id || item.id;
        item.imdb_id = imdbId;

        const isShowType = type === 'tv' || type === 'series' || type === 'anime' || (item.episodes > 0);
        const cinemetaDetail = await window.api.invoke('cinemeta-details', { id: imdbId, type: isShowType ? 'series' : 'movie' });
        const meta = cinemetaDetail.meta || {};

        if (meta.name) $('#dd-title').textContent = meta.name;
        if (meta.description) $('#dd-desc').textContent = meta.description;
        if (meta.year) $('#dd-year').textContent = meta.year;
        
        if (meta.background) $('#dd-backdrop').style.backgroundImage = `url(${meta.background})`;
        if (meta.poster) {
          $('#dd-poster').src = meta.poster;
          $('#dd-poster').style.display = 'block';
        }

        item.title = meta.name || item.title;
        item.name = meta.name || item.name;

        const ddCast = $('#dd-cast');
        if (ddCast) ddCast.style.display = 'block';
        
        if (meta.trailers && meta.trailers.length > 0) {
          const trailer = meta.trailers.find(t => t.source === 'youtube');
          if (trailer) {
            const btn = document.createElement('button'); btn.className = 'btn-outline';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Watch Trailer';
            btn.onclick = () => {
              if (typeof window.playVideo === 'function') {
                window.playVideo({
                  type: 'youtube',
                  isYoutube: true,
                  id: trailer.id,
                  videoId: trailer.id,
                  title: `${meta.name || meta.title || (item && item.title) || 'Anime'} (Trailer)`
                });
              } else {
                window.api.openExternal(`https://www.youtube.com/watch?v=${trailer.id}`);
              }
            };
            actions.appendChild(btn);
          }
        }

        const castRow = $('#dd-cast .dd-cast-row');
        if (castRow) {
          castRow.innerHTML = '';
          if (meta.cast && meta.cast.length > 0) {
            meta.cast.slice(0, 12).forEach(cName => {
              const card = document.createElement('div'); card.className = 'dd-cast-card';
              const img = 'imgs/no-backdrop.png';
              card.innerHTML = `<img src="${img}" class="dd-cast-img"><div class="dd-cast-info"><span class="dd-cast-name">${escapeHTML(cName)}</span></div>`;
              castRow.appendChild(card);
            });
          } else {
            castRow.innerHTML = '<div style="padding:20px;color:var(--text-muted)">No cast data available.</div>';
          }
        }

        renderPills({
          genres: meta.genres ? meta.genres.map(g => ({ name: g })) : (item.genres || []),
          runtime: meta.runtime || item.runtime || '',
          vote_average: meta.imdbRating || item.vote_average || 0
        });

        if (isShowType) {
          let videos = meta.videos || [];
          if (!videos || videos.length === 0) {
            const seasonRes = await window.api.invoke('tmdb-season-details', imdbId, 1).catch(() => null);
            if (seasonRes && seasonRes.episodes && seasonRes.episodes.length > 0) {
              videos = seasonRes.episodes.map(e => ({
                season: e.season_number || 1,
                episode: e.episode_number,
                name: e.name,
                thumbnail: e.still_path,
                released: e.air_date
              }));
            }
          }

          if (videos.length > 0) {
            const wrap = $('#dd-seasons');
            wrap.innerHTML = '<h3 style="margin-bottom:12px">Seasons</h3><div class="season-tabs" style="margin-bottom:15px"></div><div class="episode-list"></div>';
            const tabs = wrap.querySelector('.season-tabs');
            const epList = wrap.querySelector('.episode-list');

            const uniqueSeasons = [...new Set(videos.map(v => v.season))].filter(s => s !== undefined && s !== null && s >= 0).sort((a, b) => a - b);
            
            uniqueSeasons.forEach((seasonNum, idx) => {
              const btn = document.createElement('button');
              btn.className = `season-tab ${idx === 0 ? 'active' : ''}`;
              btn.textContent = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
              btn.onclick = () => {
                tabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                renderCinemetaEpisodes(videos, seasonNum, epList, item);
              };
              tabs.appendChild(btn);
            });
            
            if (uniqueSeasons.length > 0) renderCinemetaEpisodes(videos, uniqueSeasons[0], epList, item);
          } else {
            loadStreams(item, 'series');
          }
        } else {
          loadStreams(item, 'movie');
        }
      } catch (e) { 
        console.error(e);
        const seasons = $('#dd-seasons');
        if (seasons) seasons.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load show details.</div>';
      }
    })();
  }

  function renderCinemetaEpisodes(videos, seasonNum, container, meta) {
    container.innerHTML = '';
    const seasonVideos = videos.filter(v => v.season === seasonNum).sort((a, b) => a.episode - b.episode);
    const showName = meta.title || meta.name || 'Series';
    
    if (seasonVideos.length === 0) {
      container.innerHTML = '<div style="padding:20px; color:var(--text-muted)">No episodes found for this season.</div>';
      return;
    }

    seasonVideos.forEach(ep => {
      const el = document.createElement('div'); el.className = 'episode-item';
      el.dataset.episodeNum = ep.episode;
      const thumb = ep.thumbnail || meta.poster_path || meta.poster || 'imgs/no-backdrop.png';
      const fallbackImg = meta.backdrop_path || meta.background || meta.poster_path || meta.poster || 'imgs/no-backdrop.png';
      const rawName = ep.name || ep.title || '';
      const displayTitle = (rawName && !rawName.toLowerCase().startsWith('episode') && rawName !== String(ep.episode))
        ? `EP ${ep.episode} • ${rawName}`
        : (rawName || `Episode ${ep.episode}`);
      const voteVal = parseFloat(ep.vote_average || ep.rating || ep.imdbRating);
      const ratingTag = (!isNaN(voteVal) && voteVal > 0)
        ? `<span class="ep-rating-badge" style="display:inline-flex;align-items:center;gap:3px;background:rgba(245,197,24,0.15);color:#F5C518;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:8px;"><i class="fas fa-star" style="font-size:8px;"></i>${voteVal.toFixed(1)}</span>`
        : '';

      el.innerHTML = `<div class="ep-thumb-wrap"><img src="${thumb}" class="ep-thumb" onerror="this.onerror=null; this.src='${escapeHTML(fallbackImg)}';"><div class="ep-number-overlay">${ep.episode}</div><div class="ep-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div></div><div class="episode-info"><div class="episode-title" style="display:flex;align-items:center;justify-content:space-between;"><span>${escapeHTML(displayTitle)}</span>${ratingTag}</div><div class="episode-desc">${escapeHTML(ep.overview || ep.description || 'No description.')}</div></div>`;
      el.onclick = () => {
        document.querySelectorAll('.episode-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        const isAnimeItem = meta.source === 'kitsu' || meta.source === 'jikan' || meta.source === 'mal' || meta.source === 'anilist' || meta.type === 'anime';
        const mediaType = isAnimeItem ? 'anime' : 'tv';
        const kitsuId = meta.kitsuId || (meta.source === 'kitsu' ? String(meta.id).replace('kitsu:', '') : null);
        loadStreams({ ...meta, showName, season: seasonNum, episode: ep.episode, epTitle: ep.name || ep.title, media_type: mediaType, kitsuId }, mediaType);
      };
      container.appendChild(el);
    });

    const tmdbKey = appData.tmdbKey || null;
    const overrideEnabled = appData.tmdbEnabled !== false;
    const imdbId = meta.imdb_id || meta.id || '';

    if (overrideEnabled && tmdbKey && imdbId && String(imdbId).startsWith('tt')) {
      (async () => {
        try {
          let tmdbId = tmdbShowIdCache[imdbId];
          if (!tmdbId) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
            const findRes = await fetch(findUrl);
            const findData = await findRes.json();
            const tmdbItem = findData.tv_results?.[0];
            if (tmdbItem && tmdbItem.id) {
              tmdbId = tmdbItem.id;
              tmdbShowIdCache[imdbId] = tmdbId;
            }
          }
          if (tmdbId) {
            const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}?api_key=${tmdbKey}`;
            const seasonRes = await fetch(seasonUrl);
            const seasonData = await seasonRes.json();
            if (seasonData && seasonData.episodes) {
              seasonData.episodes.forEach(tmdbEp => {
                const epEl = container.querySelector(`[data-episode-num="${tmdbEp.episode_number}"]`);
                if (epEl) {
                  if (tmdbEp.still_path) {
                    const imgEl = epEl.querySelector('.ep-thumb');
                    if (imgEl) {
                      imgEl.src = `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}`;
                    }
                  }
                  const tEpVote = parseFloat(tmdbEp.vote_average);
                  const tEpRatingTag = (!isNaN(tEpVote) && tEpVote > 0)
                    ? `<span class="ep-rating-badge" style="display:inline-flex;align-items:center;gap:3px;background:rgba(245,197,24,0.15);color:#F5C518;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:8px;"><i class="fas fa-star" style="font-size:8px;"></i>${tEpVote.toFixed(1)}</span>`
                    : '';
                  const epRawName = tmdbEp.name || '';
                  const fullTitle = (epRawName && !epRawName.toLowerCase().startsWith('episode'))
                    ? `EP ${tmdbEp.episode_number} • ${epRawName}`
                    : (epRawName || `Episode ${tmdbEp.episode_number}`);

                  const titleEl = epEl.querySelector('.episode-title');
                  if (titleEl) {
                    titleEl.innerHTML = `<span>${escapeHTML(fullTitle)}</span>${tEpRatingTag}`;
                  }
                  if (tmdbEp.overview) {
                    const descEl = epEl.querySelector('.episode-desc');
                    if (descEl) descEl.textContent = tmdbEp.overview;
                  }
                }
              });
            }
          }
        } catch (e) {
          console.warn('[Discover] TMDB Season/Episode fetch failed:', e);
        }
      })();
    }
  }

  function selectBestStream(streams, preferredMaxRes = '1080p') {
    if (!streams || !streams.length) return null;

    const validStreams = streams.filter(s => s && (s.url || s.infoHash || s.type === 'torrent'));
    const pool = validStreams.length > 0 ? validStreams : streams;

    function scoreStream(s) {
      let score = 0;
      const title = (s.title || '').toLowerCase();
      const addon = (s.addon || '').toLowerCase();
      const quality = (s.quality || '').toLowerCase();

      const is4K = quality.includes('4k') || title.includes('2160p') || title.includes('4k');
      const is1080p = quality.includes('1080') || title.includes('1080p');
      const is720p = quality.includes('720') || title.includes('720p');

      if (preferredMaxRes === '4K') {
        if (is4K) score += 500;
        else if (is1080p) score += 350;
        else if (is720p) score += 180;
      } else if (preferredMaxRes === '720p') {
        if (is720p) score += 500;
        else if (is1080p) score += 300;
        else if (is4K) score += 100;
      } else { // Default 1080p
        if (is1080p) score += 500;
        else if (is720p) score += 300;
        else if (is4K) score += 200;
      }

      const isTorrent = s.type === 'torrent' || !s.url?.startsWith('http');
      const statsLine = (s.title || '').split('\n').slice(1).join(' ');
      const seedsMatch = statsLine.match(/≡ƒæñ\s*(\d+)/) || statsLine.match(/(\d+)\s*seeds/i) || statsLine.match(/👥\s*(\d+)/) || statsLine.match(/👤\s*(\d+)/);
      const seeds = seedsMatch ? parseInt(seedsMatch[1], 10) : 0;

      if (isTorrent) {
        if (seeds <= 0) {
          score -= 600; // Heavily penalize dead / 0-seed torrents
        } else {
          score += Math.min(seeds * 8, 600); // Prioritize torrents with healthy active swarm
        }
      } else {
        score += 350; // Direct HTTP streams are reliable and instant
      }

      if (title.includes('hevc') || title.includes('x265')) score += 40;
      if (title.includes('multi') || title.includes('dual') || title.includes('eng')) score += 25;

      const sizeMatch = statsLine.match(/([\d\.]+\s*GB)/i);
      if (sizeMatch && parseFloat(sizeMatch[1]) > 15 && preferredMaxRes !== '4K') {
        score -= 150;
      }

      return score;
    }

    let best = pool[0];
    let maxScore = -Infinity;

    pool.forEach(s => {
      const currentScore = scoreStream(s);
      if (currentScore > maxScore) {
        maxScore = currentScore;
        best = s;
      }
    });

    return best;
  }

  async function loadStreams(item, type) {
    let container = $('#dd-streams-list');
    const autoChoose = window.appData && window.appData.autoChooseBestStream;

    // Show inline spinner if container is present in DOM
    if (container) {
      if (autoChoose) {
        container.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                      padding:32px 20px; gap:14px; grid-column: 1/-1;">
            <div style="width:40px; height:40px; border-radius:50%;
                        border: 3px solid rgba(255,255,255,0.08);
                        border-top-color: #ffffff;
                        animation: ddLoaderSpin 0.8s linear infinite;"></div>
            <div style="font-size:13px; font-weight:600; color:rgba(255,255,255,0.55); letter-spacing:0.3px;">
              Finding best stream...
            </div>
          </div>`;
      } else {
        container.innerHTML = '<div style="padding:20px; color:var(--text-muted); text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">Searching for best links...</div>';
      }
    }

    try {
      if (!item.imdb_id || item.imdb_id === 'null' || !String(item.imdb_id).startsWith('tt')) {
        if (item.imdbId && String(item.imdbId).startsWith('tt')) {
          item.imdb_id = item.imdbId;
        } else if (item.id && String(item.id).startsWith('tt')) {
          item.imdb_id = item.id;
        } else if (window.currentDetailItem?.imdb_id && String(window.currentDetailItem.imdb_id).startsWith('tt')) {
          item.imdb_id = window.currentDetailItem.imdb_id;
        } else if (window.currentDetailItem?.imdbId && String(window.currentDetailItem.imdbId).startsWith('tt')) {
          item.imdb_id = window.currentDetailItem.imdbId;
        } else if (window.currentUnifiedDetailItem?.imdb_id && String(window.currentUnifiedDetailItem.imdb_id).startsWith('tt')) {
          item.imdb_id = window.currentUnifiedDetailItem.imdb_id;
        } else if (window.currentUnifiedDetailItem?.imdbId && String(window.currentUnifiedDetailItem.imdbId).startsWith('tt')) {
          item.imdb_id = window.currentUnifiedDetailItem.imdbId;
        } else {
          const isAnimeItem = item.source === 'anilist' || item.source === 'mal' || item.source === 'kitsu' || item.source === 'jikan';
          if (!isAnimeItem) {
            item.imdb_id = (item.id && String(item.id).startsWith('tt')) ? item.id : null;
          } else {
            item.imdb_id = null;
          }
        }
      }

      // Check caches (tmdbCache, cinemetaCache) if imdb_id or tmdbId is missing on item
      const itemKey = item.id || item.tmdbId || item.imdb_id;
      const cachedTmdb = window.appData?.tmdbCache?.[itemKey] || (item.id ? window.appData?.tmdbCache?.[item.id] : null);
      const cachedCinemeta = window.appData?.cinemetaCache?.[itemKey] || (item.id ? window.appData?.cinemetaCache?.[item.id] : null);

      let showMeta = currentShow ? (typeof getMetadataForItem === 'function' ? getMetadataForItem(currentShow) : null) : null;
      let itemMeta = typeof getMetadataForItem === 'function' ? getMetadataForItem(item) : null;
      let resolvedImdb = item.imdb_id || item.imdbId || itemMeta?.cinemetaId || itemMeta?.imdbId || itemMeta?.imdb_id || showMeta?.cinemetaId || showMeta?.imdbId || showMeta?.imdb_id || window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId || window.currentUnifiedDetailItem?.imdb_id || window.currentUnifiedDetailItem?.imdbId || cachedTmdb?.external_ids?.imdb_id || cachedTmdb?.imdb_id || cachedCinemeta?.imdb_id || null;

      if (resolvedImdb && (typeof isLocalFilePath === 'function' ? isLocalFilePath(resolvedImdb) : (resolvedImdb.includes('/') || resolvedImdb.includes('\\')))) {
        resolvedImdb = null;
      }

      // Normalize tmdbId: strip "tmdb:" prefix so the main process gets a clean numeric ID
      let rawTmdbId = item.tmdbId || item.tmdb_id || (item.id && !String(item.id).startsWith('tt') && !String(item.id).startsWith('kitsu:') && !String(item.id).startsWith('mal:') ? item.id : null) || window.currentDetailItem?.tmdbId || window.currentDetailItem?.tmdb_id || window.currentUnifiedDetailItem?.tmdbId || window.currentUnifiedDetailItem?.tmdb_id || cachedTmdb?.id || null;
      let normalizedTmdbId = rawTmdbId ? String(rawTmdbId).replace('tmdb:', '') : null;
      if (normalizedTmdbId && (normalizedTmdbId.startsWith('tt') || normalizedTmdbId.startsWith('kitsu:') || normalizedTmdbId.startsWith('mal:'))) {
        normalizedTmdbId = null;
      }

      let streams;
      try {
        const query = {
          imdbId: resolvedImdb || item.imdb_id,
          tmdbId: normalizedTmdbId,
          kitsuId: item.kitsuId || (String(item.id).startsWith('kitsu:') ? String(item.id).replace('kitsu:', '') : null),
          malId: item.mal_id || ((String(item.id).startsWith('mal:') || String(item.id).startsWith('jikan:')) ? String(item.id).replace('mal:', '').replace('jikan:', '') : null),
          type: type,
          season: item.season,
          episode: item.episode,
          title: item.title || item.name || item.showName
        };
        console.log('[Streams] Calling searchAddons with:', query);
        streams = await window.api.searchAddons(query);
      } catch (err) {
        console.error('[Streams] searchAddons failed:', err);
        if (typeof window._restorePlayBtn === 'function') {
          window._restorePlayBtn();
          window._restorePlayBtn = null;
        }
        if (container) {
          container.innerHTML = `<div style="padding:20px; color:#EF4444; text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">Error fetching streams: ${err.message}</div>`;
        }
        showToast('Error searching streams: ' + err.message);
        return;
      }

      if (container) container.innerHTML = '';
      if (!streams || !streams.length) {
        if (typeof window._restorePlayBtn === 'function') {
          window._restorePlayBtn();
          window._restorePlayBtn = null;
        }
        if (container) {
          container.innerHTML = `<div style="padding:20px; color:var(--text-muted); text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">No links found for ${item.title || 'this item'} (IMDB: ${item.imdb_id || 'Missing'}). Please try again later.</div>`;
        } else {
          showToast(`No links found for ${item.title || 'this item'}.`);
        }
        return;
      }

      // Re-query container in case panel was opened during search
      container = $('#dd-streams-list');
      if (container) {
        container.innerHTML = '';
      }

      // 1. Render ALL streams to container so all links appear
      streams.forEach(s => {
        const card = document.createElement('div'); card.className = 'stream-card';
        const isBrowser = s.type === 'browser';
        const isPeario = (s.addon || '').toLowerCase().includes('peario');

        const titleLines = (s.title || '').split('\n');
        let mainTitle = titleLines[0] || '';
        if (isBrowser) {
          mainTitle = mainTitle.replace(/[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{1F1E0}-\u{1F1FF}\u{2B50}👥]/gu, '').trim();
        }

        let seeds = 0, size = '';
        const statsLine = titleLines.slice(1).join(' ');
        const seedsMatch = statsLine.match(/≡ƒæñ\s*(\d+)/) || statsLine.match(/(\d+)\s*seeds/i);
        const sizeMatch = statsLine.match(/≡ƒÆ╛\s*([\d\.]+\s*[GM]B)/i) || statsLine.match(/([\d\.]+\s*[GM]B)/i);
        if (seedsMatch) seeds = seedsMatch[1];
        if (sizeMatch) size = sizeMatch[1];

        const seedsIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        const sizeIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M12 18V6"/><path d="M7 11l5 5 5-5"/></svg>`;

        let streamIconSvg = '';
        if (s.type === 'torrent') {
          streamIconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v8m0 0l-4-4m4 4l4-4M6 20h12a2 2 0 002-2v-4a2 2 0 00-2-2H6a2 2 0 00-2 2v4a2 2 0 002 2z"/></svg>';
        } else if (isBrowser) {
          if (isPeario) {
            streamIconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
          } else {
            streamIconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
          }
        } else {
          streamIconSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
        }

        const downloadHtml = isBrowser ? '' : `<div class="stream-btn-download" title="Copy Torrent Link"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div>`;
        
        const playTitle = isBrowser ? 'Open Link' : 'Play';
        const playIcon = isBrowser 
          ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` 
          : `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

        card.innerHTML = `
          <div class="stream-icon-box">${streamIconSvg}</div>
          <div class="stream-main-info">
            <div class="stream-title" title="${escapeHTML(mainTitle)}">${escapeHTML(mainTitle)}</div>
            <div class="stream-meta-row">
              ${isBrowser ? '' : `<span class="quality-badge">${s.quality || 'HD'}</span>`}
              <span class="source-badge">${escapeHTML(s.addon || 'Stream')}</span>
              ${size ? `<span class="stream-stat-badge size">${size}</span>` : ''}
              ${seeds ? `<span class="stream-stat-badge seeds">${seeds} seeds</span>` : ''}
            </div>
          </div>
          <div class="stream-actions-group">
            ${downloadHtml}
            <div class="stream-btn-play" title="${playTitle}">${playIcon}</div>
          </div>
        `;

        card.querySelector('.stream-btn-play').onclick = (e) => { e.stopPropagation(); playStream(s, item, e.currentTarget); };
        card.onclick = (e) => playStream(s, item, e.currentTarget.querySelector('.stream-btn-play'));

        const dlBtn = card.querySelector('.stream-btn-download');
        if (dlBtn) {
          dlBtn.onclick = async (e) => {
            e.stopPropagation();
            let dlUrl = s.url || s.infoHash;
            if (dlUrl && dlUrl.length === 40 && !dlUrl.startsWith('http')) {
              dlUrl = `magnet:?xt=urn:btih:${dlUrl}&tr=udp://tracker.opentrackr.org:1337/announce`;
            }
            try {
              await navigator.clipboard.writeText(dlUrl);
              showToast('Torrent link copied to clipboard!');
            } catch (err) {
              showToast('Failed to copy: ' + err.message);
            }
          };
        }
        if (container) container.appendChild(card);
      });

      // 2. Smart Auto-Play Best Stream if enabled or if called outside detail panel
      const bestStream = selectBestStream(streams, (window.appData && window.appData.autoChooseMaxRes) || '1080p');
      if ((window.appData && window.appData.autoChooseBestStream) || !container) {
        if (bestStream) {
          if (typeof window._restorePlayBtn === 'function') {
            window._restorePlayBtn();
            window._restorePlayBtn = null;
          }
          // Close side panels so stream links UI doesn't remain behind player
          const sidePanel = document.getElementById('dd-side-panel');
          const mobilePanel = document.getElementById('dd-mobile-panel');
          if (sidePanel) sidePanel.classList.remove('active');
          if (mobilePanel) mobilePanel.classList.remove('active');

          showToast(`⚡ Auto-playing best stream (${bestStream.quality || '1080p'})...`);
          playStream(bestStream, item, null);
          return;
        } else {
          if (typeof window._restorePlayBtn === 'function') {
            window._restorePlayBtn();
            window._restorePlayBtn = null;
          }
          const isMobile = window.innerWidth <= 768;
          const panel = document.getElementById(isMobile ? 'dd-mobile-panel' : 'dd-side-panel');
          if (panel) panel.classList.add('active');
          const list = document.getElementById('dd-unified-ep-list');
          const streamContainer = document.getElementById('dd-streams-container-unified');
          if (list) list.style.display = 'none';
          if (streamContainer) streamContainer.style.display = 'block';
        }
      }
    } catch (err) { container.innerHTML = 'Error searching streams.'; }
  }

  async function playStream(stream, meta, cardEl = null) {
    // All anime streams are external content — always gate with the disclaimer.
    if (typeof showDisclaimerAndProceed === 'function') {
      showDisclaimerAndProceed(() => _doPlayStream(stream, meta, cardEl));
      return;
    }
    _doPlayStream(stream, meta, cardEl);
  }

  async function _doPlayStream(stream, meta, cardEl = null) {
    if (meta && typeof isAgeAllowed === 'function' && !isAgeAllowed(meta)) {
      showToast('This content is restricted by age rating filters.');
      return;
    }

    // ── BROWSER / PEARIO INTERCEPT ──────────────────────────────────────────
    // Must run BEFORE any spinner or player initialization.
    // Peario returns externalUrl (a web-room link) and should NEVER reach the
    // internal <video> player.  Three conditions cover all edge-cases:
    //   1. stream.type === 'browser'       — set by normalizeStream (primary path)
    //   2. stream.externalUrl is present   — safety net if type was wrong
    //   3. addon name contains 'peario'    — explicit brand guard
    const isPeario = (stream.addon || '').toLowerCase().includes('peario');
    const isExternalLink = stream.type === 'browser' || !!stream.externalUrl || isPeario;

    const clearCardLoading = (el) => {
      if (!el) return;
      el.classList.remove('btn-loading');
      const spinners = el.querySelectorAll('.fa-spinner, .btn-spinner-svg');
      spinners.forEach(s => s.remove());
      const svgs = el.querySelectorAll('svg');
      svgs.forEach(s => s.style.display = '');
      const iconWrap = el.querySelector('.dd-stream-play-icon');
      if (iconWrap) {
        iconWrap.classList.remove('loading');
        iconWrap.innerHTML = '<i class="fas fa-play"></i>';
      }
    };

    if (isExternalLink) {
      const target = stream.externalUrl || stream.url;
      if (!target) {
        showToast('No external URL found for this stream.');
        clearCardLoading(cardEl);
        return;
      }
      
      // Clear loading state immediately before opening external link
      clearCardLoading(cardEl);
      
      try {
        // Electron: use shell.openExternal via preload bridge
        if (window.api?.openExternal) {
          window.api.openExternal(target);
        } else if (window.api?.invoke) {
          await window.api.invoke('open-external', target);
        } else {
          window.open(target, '_blank');
        }
        showToast('Opening external player...');
      } catch (e) {
        console.error('[playStream] Failed to open external URL:', e);
        showToast('Failed to open external link. Opening in browser...');
        window.open(target, '_blank');
      }
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    if (cardEl) {
      const iconWrap = cardEl.querySelector('.dd-stream-play-icon');
      if (iconWrap) {
        iconWrap.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        iconWrap.classList.add('loading');
      }
      else if (cardEl.classList.contains('stream-btn-play') || cardEl.classList.contains('stream-btn-vlc')) {
        cardEl.classList.add('btn-loading');
      }
    }

    const isMobile = !!(window.Capacitor);

    if (isMobile) {
      let handoffUrl = stream.url || stream.infoHash || '';

      if (handoffUrl && handoffUrl.length === 40 && !handoffUrl.startsWith('http') && !handoffUrl.startsWith('magnet:')) {
        handoffUrl = `magnet:?xt=urn:btih:${handoffUrl}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
      }

      if (!handoffUrl) {
        clearCardLoading(cardEl);
        showToast('No playable link found');
        return;
      }

      showToast(`Opening ${stream.addon} in external player...`);
      console.log('[playStream] Mobile external handoff:', handoffUrl);

      // On Android/Capacitor, open the URL via _system to trigger the native App Chooser.
      // magnet: links will open torrent clients (LibreTorrent, etc.)
      // http(s): links will open video players (VLC, MX Player, Amnis, etc.)
      try {
        window.open(handoffUrl, '_system');
      } catch (e) {
        console.error('[playStream] window.open(_system) failed, fallback intent:', e);
        // Fallback: try intent URL for video
        if (handoffUrl.startsWith('http')) {
          const scheme = handoffUrl.startsWith('https') ? 'https' : 'http';
          const cleanUrl = handoffUrl.replace(/^https?:\/\//, '');
          const intentUrl = `intent://${cleanUrl}#Intent;scheme=${scheme};type=video/*;action=android.intent.action.VIEW;end;`;
          window.location.href = intentUrl;
        } else {
          window.location.href = handoffUrl;
        }
      }

      clearCardLoading(cardEl);
      return;
    }

    showToast(`Initializing ${stream.addon} stream...`);
    const useNativeDesktop = !isMobile && window.api?.isElectron && !isNativePlayerWindow();
    if (!useNativeDesktop) {
      switchView('player');
    }

    try {
      let finalUrl = stream.url?.startsWith('http') ? stream.url : null;

      if (stream.type === 'torrent') {
        if (!finalUrl) {
          try {
            if (currentItem && typeof exitPlayer === 'function') await exitPlayer(false, true);
          } catch (e) { console.warn('[Player] exitPlayer before start failed:', e?.message || e); }

          const torrentSource = stream.infoHash || stream.url;
          const res = await window.api.invoke('start-torrent-stream', torrentSource, stream.fileIdx);
          if (!res || !res.success) throw new Error(res?.error || 'Failed to start torrent stream');

          finalUrl = (window.api.isElectron) ? (res.localUrl || res.url) : res.url;
          window._activeStreamUrl = finalUrl;
          if (res.files) meta.torrentFiles = res.files;
          if (res.infoHash) meta.torrentMagnet = torrentSource;
          if (res.duration) meta.duration = res.duration;
          meta.fileIdx = stream.fileIdx ?? res.fileIdx;
        }
      }

      if (stream.type === 'torrent') {
        try { showToast('Torrent stream started — buffering...'); } catch (e) { }
      }

      if (!finalUrl) throw new Error('No playable stream found');
      window._activeStreamUrl = finalUrl;

      if (typeof playVideo === 'function') {
        const showTitle = meta?.showName || meta?.title || meta?.name;
        playVideo({
          ...meta,
          detected: stream.detected || {},
          id: meta?.id || stream.infoHash || stream.url,
          title: meta?.epTitle || meta?.title || meta?.name || stream.name,
          path: finalUrl,
          torrentMagnet: meta.torrentMagnet,
          fileIdx: meta.fileIdx,
          torrentFiles: meta.torrentFiles,
          tmdbId: meta?.id,
          showTitle: showTitle,
          type: meta ? (meta.media_type || meta.type || (meta.title ? 'movie' : 'tv')) : 'movie',
          season: meta?.season,
          episode: meta?.episode,
          showId: meta?.showId || meta?.id,
          isStream: true
        }, showTitle ? {
          title: showTitle,
          id: meta.showId || meta.id,
          episodes: window.currentDetailEpisodes || []
        } : null);
      }
    } catch (err) {
      console.error('[playStream] Error:', err);
      showToast('Streaming failed: ' + err.message);
      // Re-open stream selection panel so user can choose another working stream
      const isMobile = window.innerWidth <= 768;
      const panel = document.getElementById(isMobile ? 'dd-mobile-panel' : 'dd-side-panel');
      if (panel) panel.classList.add('active');
      const list = document.getElementById('dd-unified-ep-list');
      const streamContainer = document.getElementById('dd-streams-container-unified');
      if (list) list.style.display = 'none';
      if (streamContainer) streamContainer.style.display = 'block';
    } finally {
      clearCardLoading(cardEl);
    }
  }

  // Search input event listener – redirect to main search page instead of inline discover search
  const _discoverInput = $('#search-discover');
  if (_discoverInput) {
    _discoverInput.addEventListener('input', debounce(() => {
      const val = _discoverInput.value.trim();
      if (!val) return;
      const mainSearchInput = document.querySelector('#search-input-main');
      if (mainSearchInput) mainSearchInput.value = val;
      _discoverInput.value = '';
      if (typeof switchView === 'function') switchView('search');
      if (typeof window.performUnifiedSearch === 'function') window.performUnifiedSearch(val);
      if (mainSearchInput) mainSearchInput.focus();
    }, 600));
    _discoverInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = _discoverInput.value.trim();
        if (!val) return;
        const mainSearchInput = document.querySelector('#search-input-main');
        if (mainSearchInput) mainSearchInput.value = val;
        _discoverInput.value = '';
        if (typeof switchView === 'function') switchView('search');
        if (typeof window.performUnifiedSearch === 'function') window.performUnifiedSearch(val);
        if (mainSearchInput) mainSearchInput.focus();
      }
    });
  }

  // ─── YOUTUBE ADD-ON SETTINGS, AUTH & WATCH HISTORY ─────────────────────

  // ─── YOUTUBE WATCH HISTORY & DOWNLOADS ─────────────────────

  // Watch History & Modal Event Handlers
  document.addEventListener('DOMContentLoaded', () => {
    const histModal = $('#youtube-history-modal');
    if (histModal) {
      histModal.onclick = (e) => {
        if (e.target === histModal) histModal.style.display = 'none';
      };
    }
    const btnCloseHistory = $('#btn-close-yt-history');
    if (btnCloseHistory) {
      btnCloseHistory.onclick = () => {
        if (histModal) histModal.style.display = 'none';
      };
    }

    const btnClearHistory = $('#btn-clear-yt-history');
    if (btnClearHistory) {
      btnClearHistory.onclick = async () => {
        if (confirm('Are you sure you want to clear your YouTube watch history?')) {
          await window.api.invoke('youtube-clear-history');
          showToast('Watch history cleared');
          window.openYouTubeHistoryModal();
        }
      };
    }

    const btnCloseDlWidget = $('#btn-close-yt-dl-widget');
    if (btnCloseDlWidget) {
      btnCloseDlWidget.onclick = () => {
        const widget = $('#yt-download-progress-widget');
        if (widget) widget.style.display = 'none';
      };
    }
  });

  window.clearYouTubeHistory = async function() {
    if (confirm('Clear your YouTube watch history?')) {
      try {
        const res = await window.api.invoke('youtube-clear-history');
        if (res && res.success) {
          showToast('YouTube watch history cleared');
          const sectionEl = $('#discover-youtube-history-section');
          if (sectionEl) sectionEl.style.display = 'none';
          const modal = $('#youtube-history-modal');
          if (modal) modal.style.display = 'none';
        }
      } catch (err) {
        showToast('Failed to clear history: ' + err.message);
      }
    }
  };

  window.openYouTubeHistoryModal = async function() {
    const modal = $('#youtube-history-modal');
    const list = $('#yt-history-list');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted)">Loading history...</div>';

    try {
      const res = await window.api.invoke('youtube-get-history');
      if (res && res.success && res.history && res.history.length > 0) {
        list.innerHTML = '';
        res.history.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex; align-items:center; gap:14px; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; cursor:pointer; transition:background 0.2s;';
          row.onmouseover = () => row.style.background = 'rgba(255,255,255,0.08)';
          row.onmouseout = () => row.style.background = 'rgba(255,255,255,0.03)';
          row.onclick = () => {
            modal.style.display = 'none';
            if (typeof window.playMedia === 'function') {
              window.playMedia({ ...item, type: 'youtube' });
            }
          };

          const dateStr = item.watchedAt ? new Date(item.watchedAt).toLocaleDateString() : '';

          row.innerHTML = `
            <div style="width:120px; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:#000; flex-shrink:0;">
              <img src="${item.thumbnail}" style="width:100%; height:100%; object-fit:cover;">
            </div>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; font-size:0.9rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</div>
              <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${escapeHTML(item.author || 'YouTube')}</div>
              <div style="font-size:0.75rem; color:rgba(255,255,255,0.4); margin-top:4px;">Watched ${dateStr}</div>
            </div>
            <i class="fas fa-play-circle" style="font-size:24px; color:var(--accent); margin-right:8px;"></i>
          `;
          list.appendChild(row);
        });
      } else {
        list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">No watch history yet. Start watching YouTube videos to track your history!</div>';
      }
    } catch (err) {
      list.innerHTML = `<div style="padding:20px; text-align:center; color:#ef4444">Error loading history: ${err.message}</div>`;
    }
  };

  // Listen to download progress IPC events
  if (window.api && typeof window.api.on === 'function') {
    window.api.on('youtube-download-progress', (data) => {
      const widget = $('#yt-download-progress-widget');
      if (!widget) return;
      widget.style.display = 'flex';

      const statusEl = $('#yt-dl-widget-status');
      const titleEl = $('#yt-dl-widget-title');
      const barEl = $('#yt-dl-widget-bar');
      const speedEl = $('#yt-dl-widget-speed');
      const etaEl = $('#yt-dl-widget-eta');
      const errEl = $('#yt-dl-widget-error');
      const iconEl = $('#yt-dl-widget-icon');

      if (titleEl) titleEl.textContent = data.title || 'YouTube Media';
      if (barEl) barEl.style.width = `${data.percent || 0}%`;

      if (data.status === 'completed') {
        if (statusEl) statusEl.textContent = '✅ Download Completed!';
        if (iconEl) iconEl.className = 'fas fa-check-circle';
        if (speedEl) speedEl.textContent = 'Finished';
        if (etaEl) etaEl.textContent = 'Saved to folder';
        if (errEl) errEl.style.display = 'none';
        setTimeout(() => { widget.style.display = 'none'; }, 6000);
      } else if (data.status === 'error') {
        if (statusEl) statusEl.textContent = '❌ Download Failed';
        if (iconEl) iconEl.className = 'fas fa-exclamation-triangle';
        if (errEl) {
          errEl.textContent = data.error || 'Unknown error occurred';
          errEl.style.display = 'block';
        }
      } else {
        if (statusEl) statusEl.textContent = `Downloading (${data.percent || 0}%)`;
        if (iconEl) iconEl.className = 'fas fa-spinner fa-spin';
        if (speedEl) speedEl.textContent = data.speed || '0 MB/s';
        if (etaEl) etaEl.textContent = `${data.eta || '00:00'} remaining`;
        if (errEl) errEl.style.display = 'none';
      }
    });
  }

  // Expose discover/anime functions to window
  window.loadDiscover = loadDiscover;
  window.renderDiscoverRow = renderDiscoverRow;
  window.performDiscoverSearch = performDiscoverSearch;
  window.openDiscoverDetail = openDiscoverDetail;
  window.renderCinemetaEpisodes = renderCinemetaEpisodes;
  window.renderCinemetaEpisodes = renderCinemetaEpisodes;
  window.loadStreams = loadStreams;

  // --- ANIME SCHEDULE FAVORITES & EPISODE NOTIFICATIONS ---
  window._animeScheduleCache = window._animeScheduleCache || new Map();

  function getFollowedAnimeList() {
    let list = null;
    if (window.currentProfile && Array.isArray(window.currentProfile.followedAnime) && window.currentProfile.followedAnime.length > 0) {
      list = window.currentProfile.followedAnime;
    } else if (window.appData && Array.isArray(window.appData.followedAnime) && window.appData.followedAnime.length > 0) {
      list = window.appData.followedAnime;
    }
    if (!list || list.length === 0) {
      try {
        const saved = localStorage.getItem('meem_followed_anime');
        if (saved) list = JSON.parse(saved);
      } catch {}
    }
    list = Array.isArray(list) ? list : [];
    if (window.appData) window.appData.followedAnime = list;
    if (window.currentProfile) window.currentProfile.followedAnime = list;
    return list;
  }

  function saveFollowedAnimeList(list) {
    if (window.appData) window.appData.followedAnime = list;
    if (window.currentProfile) window.currentProfile.followedAnime = list;
    try {
      localStorage.setItem('meem_followed_anime', JSON.stringify(list));
    } catch {}
    if (typeof window.persist === 'function') {
      window.persist(true);
    }
  }

  function isAnimeFollowed(id) {
    const list = getFollowedAnimeList();
    const strId = String(id);
    return list.some(a => String(a.id) === strId || String(a.mal_id) === strId);
  }

  window.toggleFollowAnimeById = function(id, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const strId = String(id);
    const cached = window._animeScheduleCache.get(strId);
    if (cached) {
      window.toggleFollowAnime(cached, event);
    } else {
      const list = getFollowedAnimeList();
      const existing = list.find(a => String(a.id) === strId || String(a.mal_id) === strId);
      if (existing) {
        window.toggleFollowAnime(existing, event);
      }
    }
  };

  window.toggleFollowAnime = function(anime, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!anime) return;
    const animeId = anime.mal_id || anime.id;
    let list = getFollowedAnimeList();
    const existingIndex = list.findIndex(a => String(a.id) === String(animeId) || String(a.mal_id) === String(animeId));

    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
      saveFollowedAnimeList(list);
      if (typeof window.showToast === 'function') {
        window.showToast(`Removed from Favorites: ${anime.title_english || anime.title}`);
      }
    } else {
      const item = {
        id: anime.mal_id || anime.id,
        mal_id: anime.mal_id || anime.id,
        title: anime.title_english || anime.title,
        title_english: anime.title_english || anime.title,
        poster: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || anime.poster || 'imgs/poster-placeholder.png',
        airTime: anime.broadcast?.string || anime.broadcast?.time || anime.airTime || 'Airing',
        broadcastDay: (anime.broadcast?.day || '').toLowerCase(),
        nextEpisode: anime.nextEpisode || null,
        lastEpisodeTitle: anime.lastEpisodeTitle || null,
        airingAt: anime.airingAt || null,
        status: anime.status || 'RELEASING',
        score: anime.score || null,
        lastNotifiedEpisode: anime.nextEpisode ? anime.nextEpisode - 1 : 0,
        followedAt: Date.now()
      };
      list.unshift(item);
      saveFollowedAnimeList(list);
      if (typeof window.showToast === 'function') {
        window.showToast(`⭐ Added to Favorites & tracking episodes: ${item.title}`);
      }
      checkFollowedAnimeEpisodes();
    }

    renderFollowedAnimeSection();
    updateVisibleFollowButtons();
  };

  function updateVisibleFollowButtons() {
    document.querySelectorAll('.btn-anime-favorite-toggle').forEach(btn => {
      const id = btn.dataset.animeId;
      if (!id) return;
      const followed = isAnimeFollowed(id);
      btn.style.color = followed ? '#fbbf24' : 'rgba(255,255,255,0.8)';
      btn.title = followed ? 'Favorited (Click to remove)' : 'Add to Favorites & track episodes';
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = followed ? 'fas fa-star' : 'far fa-star';
      }
    });
  }

  function renderFollowedAnimeSection() {
    let container = document.querySelector('#anime-schedule-followed-container');
    if (!container) return;
    const list = getFollowedAnimeList();
    if (!list || list.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = `
      <div class="anime-favorites-section" style="margin-bottom: 28px; background: linear-gradient(180deg, rgba(251, 191, 36, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%); border: 1.5px solid rgba(251, 191, 36, 0.3); border-radius: 16px; padding: 18px 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 10px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-star" style="color: #fbbf24; font-size: 1.25rem;"></i>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 0.5px;">
              MY FAVORITES (${list.length})
            </h3>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.12); padding: 4px 12px; border-radius: 20px; border: 1px solid rgba(16, 185, 129, 0.3);">
            <i class="fas fa-bell"></i> Episode Notifications Active
          </div>
        </div>
        <div class="anime-schedule-day-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;">
          ${list.map(anime => {
            const safeTitle = (anime.title || anime.title_english || 'Anime').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeTitleAttr = safeTitle.replace(/'/g, "\\'");
            const nextEpText = anime.nextEpisode ? `Ep ${anime.nextEpisode}` : 'Ongoing';
            const countdown = anime.countdown || anime.airTime || 'Airing Weekly';
            const epTitleStr = anime.lastEpisodeTitle ? (anime.lastEpisodeTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')) : '';
            const animeId = anime.mal_id || anime.id;
            return `
              <div class="media-card anime-card anime-favorite-card">
                <div class="anime-card-poster">
                  <img src="${anime.poster}" loading="lazy" onerror="this.src='imgs/poster-placeholder.png'">
                </div>
                
                <!-- Remove button -->
                <button class="btn-anime-unfavorite" onclick="event.stopPropagation(); window.toggleFollowAnime({ id: '${anime.id}', mal_id: '${anime.mal_id}', title: '${safeTitleAttr}' }, event)" title="Remove from Favorites">
                  <i class="fas fa-trash-alt" style="font-size: 11px;"></i>
                </button>

                <!-- Info Overlay: Appears ONLY on Hover -->
                <div class="card-info">
                  <div class="card-title" title="${safeTitle}">${safeTitle}</div>
                  <div class="card-meta">
                    <span class="card-badge-air"><i class="fas fa-tv" style="font-size: 10px;"></i> ${nextEpText}</span>
                    <span class="card-badge-score"><i class="fas fa-star" style="font-size: 10px;"></i> Favorited</span>
                  </div>
                  <div style="font-size: 10.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                    <i class="fas fa-clock" style="font-size: 9px; margin-right: 3px;"></i>${countdown}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  async function checkFollowedAnimeEpisodes() {
    const list = getFollowedAnimeList();
    if (!list || list.length === 0) return;

    try {
      const ids = list.map(a => parseInt(a.mal_id || a.id)).filter(id => !isNaN(id) && id > 0);
      if (ids.length === 0) return;

      const query = `query ($ids: [Int]) {
        Page(page: 1, perPage: 50) {
          media(idMal_in: $ids, type: ANIME) {
            id
            idMal
            title { english romaji native }
            coverImage { large }
            nextAiringEpisode { episode airingAt timeUntilAiring }
            streamingEpisodes { title }
            status
          }
        }
      }`;

      const resp = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables: { ids } })
      }).catch(() => null);

      if (!resp || !resp.ok) return;

      const json = await resp.json().catch(() => null);
      const mediaList = json?.data?.Page?.media || [];
      const now = Math.floor(Date.now() / 1000);
      let updated = false;

      mediaList.forEach(media => {
        const animeId = media.idMal || media.id;
        const tracked = list.find(a => String(a.id) === String(animeId) || String(a.mal_id) === String(animeId));
        if (!tracked) return;

        const next = media.nextAiringEpisode;
        if (next && next.episode) {
          tracked.nextEpisode = next.episode;
          tracked.airingAt = next.airingAt;

          if (next.airingAt) {
            const diff = next.airingAt - now;
            if (diff > 0) {
              const days = Math.floor(diff / 86400);
              const hours = Math.floor((diff % 86400) / 3600);
              const mins = Math.floor((diff % 3600) / 60);
              tracked.countdown = `Ep ${next.episode} in ${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m`;
            } else {
              tracked.countdown = `Ep ${next.episode} Airing Now`;
            }
          }

          // Check if an episode has aired
          const airedEpisode = next.episode - 1;
          if (airedEpisode > (tracked.lastNotifiedEpisode || 0) && airedEpisode > 0) {
            tracked.lastNotifiedEpisode = airedEpisode;
            updated = true;

            // Resolve episode title if available from streamingEpisodes
            let epTitle = null;
            if (Array.isArray(media.streamingEpisodes) && media.streamingEpisodes.length > 0) {
              const match = media.streamingEpisodes.find(se => {
                const t = se.title || '';
                return t.includes(`Episode ${airedEpisode} `) || t.includes(`Episode ${airedEpisode}:`) || t.includes(`Episode ${airedEpisode} -`) || t.startsWith(`Episode ${airedEpisode}`);
              });
              if (match && match.title) {
                epTitle = match.title;
              } else if (media.streamingEpisodes[0]?.title) {
                epTitle = media.streamingEpisodes[0].title;
              }
            }
            if (epTitle) {
              tracked.lastEpisodeTitle = epTitle;
            }

            const displayTitle = tracked.title || media.title?.english || media.title?.romaji || 'Anime';
            const notifTitle = `New Episode: ${displayTitle}! 🔥`;
            const notifBody = epTitle ? `${epTitle} is officially out now!` : `Episode ${airedEpisode} is officially out now!`;

            console.log('[AnimeSchedule] Sending episode push notification:', notifTitle, notifBody);

            if (typeof window.addNotification === 'function') {
              window.addNotification(notifTitle, notifBody, 'anime');
            } else if (typeof window.showNativeNotification === 'function') {
              window.showNativeNotification(notifTitle, notifBody);
            }
          }
        }
      });

      if (updated) {
        saveFollowedAnimeList(list);
        renderFollowedAnimeSection();
      }
    } catch (err) {
      console.warn('[AnimeSchedule] checkFollowedAnimeEpisodes error:', err.message);
    }
  }

  // Periodic episode notification check every 15 minutes
  setInterval(checkFollowedAnimeEpisodes, 15 * 60 * 1000);
  // Also check shortly after boot
  setTimeout(checkFollowedAnimeEpisodes, 10000);

  window._animeWeeklyScheduleCache = window._animeWeeklyScheduleCache || { timestamp: 0, items: [] };

  async function fetchAniListWeeklySchedule() {
    try {
      const d = new Date();
      const dayOfWeek = d.getDay(); // 0 = Sunday
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek, 0, 0, 0);
      const startOfWeek = Math.floor(startOfDay.getTime() / 1000);
      const endOfWeek = startOfWeek + (7 * 86400);

      const query = `query ($start: Int, $end: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
            id
            airingAt
            episode
            media {
              id
              idMal
              title { romaji english native }
              coverImage { extraLarge large medium }
              bannerImage
              format
              status
              genres
              averageScore
              isAdult
            }
          }
        }
      }`;

      let allSchedules = [];
      for (let page = 1; page <= 4; page++) {
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { start: startOfWeek, end: endOfWeek, page }
          })
        });
        if (!res.ok) break;
        const json = await res.json();
        const list = json.data?.Page?.airingSchedules || [];
        allSchedules.push(...list);
        if (!json.data?.Page?.pageInfo?.hasNextPage) break;
      }

      const mapped = [];
      const seenMediaIds = new Set();
      for (const s of allSchedules) {
        if (!s.media || s.media.isAdult) continue;
        const mediaId = s.media.idMal || s.media.id;
        if (seenMediaIds.has(String(mediaId))) continue;
        seenMediaIds.add(String(mediaId));

        const airDate = new Date(s.airingAt * 1000);
        const dayName = airDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const timeString = airDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const title = s.media.title?.english || s.media.title?.romaji || 'Anime';
        const poster = s.media.coverImage?.extraLarge || s.media.coverImage?.large || s.media.coverImage?.medium || '';
        const score = s.media.averageScore ? (s.media.averageScore / 10).toFixed(1) : null;

        mapped.push({
          id: mediaId,
          mal_id: mediaId,
          anilist_id: s.media.id,
          title: title,
          title_english: s.media.title?.english || title,
          images: {
            jpg: {
              large_image_url: poster,
              image_url: poster
            }
          },
          broadcast: {
            day: dayName,
            time: timeString,
            string: `Ep ${s.episode} · ${timeString}`
          },
          score: score,
          status: 'Ongoing',
          isUpcoming: false
        });
      }

      // Also fetch Top Upcoming Anime from AniList
      try {
        const upcomingQuery = `query {
          Page(page: 1, perPage: 25) {
            media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) {
              id
              idMal
              title { romaji english native }
              coverImage { extraLarge large medium }
              status
              startDate { year month day }
              genres
              averageScore
            }
          }
        }`;
        const upRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query: upcomingQuery })
        });
        if (upRes.ok) {
          const upJson = await upRes.json();
          const upList = upJson.data?.Page?.media || [];
          for (const m of upList) {
            const mediaId = m.idMal || m.id;
            if (seenMediaIds.has(String(mediaId))) continue;
            seenMediaIds.add(String(mediaId));
            const poster = m.coverImage?.extraLarge || m.coverImage?.large || '';
            const title = m.title?.english || m.title?.romaji || 'Upcoming Anime';
            const year = m.startDate?.year ? `${m.startDate.year}` : '';
            const month = m.startDate?.month ? `/${m.startDate.month}` : '';
            const dateStr = year ? `Releasing ${year}${month}` : 'Upcoming Season';
            mapped.push({
              id: mediaId,
              mal_id: mediaId,
              anilist_id: m.id,
              title: title,
              title_english: m.title?.english || title,
              images: { jpg: { large_image_url: poster, image_url: poster } },
              broadcast: {
                day: 'upcoming',
                time: dateStr,
                string: dateStr
              },
              score: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
              status: 'Not yet aired',
              isUpcoming: true
            });
          }
        }
      } catch (upErr) {
        console.warn('[AnimeSchedule] Upcoming fetch failed:', upErr.message);
      }

      return mapped;
    } catch (err) {
      console.warn('[AnimeSchedule] AniList schedule fetch failed:', err.message);
      return [];
    }
  }

  async function loadAnimeSchedule(filterDay = '', forceRefresh = false) {
    const filterBtns = document.querySelectorAll('.anime-schedule-filter-btn');
    filterBtns.forEach(btn => {
      const isMatch = (btn.dataset.day || '') === (filterDay || '');
      if (isMatch) {
        btn.classList.add('active');
        btn.style.background = '#ffffff';
        btn.style.color = '#000000';
        btn.style.borderColor = '#ffffff';
        btn.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.35)';
        btn.style.fontWeight = '700';
      } else {
        btn.classList.remove('active');
        btn.style.boxShadow = 'none';
        btn.style.background = 'rgba(255, 255, 255, 0.06)';
        btn.style.color = '#ffffff';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        btn.style.fontWeight = '600';
      }
    });

    const grid = document.querySelector('#anime-schedule-grid') || document.querySelector('#anime-grid') || document.querySelector('#discover-genre-view');
    if (!grid) return;

    try {
      const hasCached = !forceRefresh &&
        window._animeWeeklyScheduleCache &&
        Array.isArray(window._animeWeeklyScheduleCache.items) &&
        window._animeWeeklyScheduleCache.items.length > 0 &&
        (Date.now() - window._animeWeeklyScheduleCache.timestamp < 30 * 60 * 1000);

      let items = [];

      if (hasCached) {
        items = window._animeWeeklyScheduleCache.items;
      } else {
        grid.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted); font-size:1.1rem;"><i class="fas fa-spinner fa-spin"></i> Loading Anime Release Schedule...</div>';

        // 1. Primary: Official AniList GraphQL API (Ultra fast & 100% reliable)
        const anilistItems = await fetchAniListWeeklySchedule();

        // 2. Secondary: Main process IPC or Jikan API
        let jikanItems = [];
        try {
          if (window.api && typeof window.api.jikanSchedule === 'function') {
            const res = await window.api.jikanSchedule('');
            jikanItems = res?.data || [];
          } else if (window.api && typeof window.api.invoke === 'function') {
            const res = await window.api.invoke('jikan-schedule', '');
            jikanItems = res?.data || [];
          }
        } catch (jikanErr) {
          console.warn('[AnimeSchedule] Jikan schedule warning:', jikanErr.message);
        }

        // Merge and deduplicate items
        const seenIds = new Set();
        items = [];
        for (const item of [...anilistItems, ...jikanItems]) {
          const key = item.mal_id || item.id || item.title;
          if (!seenIds.has(String(key))) {
            seenIds.add(String(key));
            items.push(item);
          }
        }

        if (items.length > 0) {
          window._animeWeeklyScheduleCache = {
            timestamp: Date.now(),
            items: items
          };
        }
      }

    if (!items || items.length === 0) {
      grid.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted)">No schedule entries found for this day.</div>';
      return;
    }

    grid.innerHTML = '';
      
      // Render Followed / Favorites section at the top
      const followedContainer = document.createElement('div');
      followedContainer.id = 'anime-schedule-followed-container';
      grid.appendChild(followedContainer);
      renderFollowedAnimeSection();

      // Group items by broadcast day
      const grouped = {};
      items.forEach(item => {
        const day = (item.isUpcoming ? 'upcoming' : (item.broadcast?.day || 'Scheduled')).toLowerCase();
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(item);
      });

      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const todayDayName = dayNames[new Date().getDay()];

      // 1. TODAY Section: If viewing All or Today, render TODAY'S RELEASES at the very top
      if (!filterDay || filterDay.toLowerCase() === todayDayName) {
        const todayItems = grouped[todayDayName] || [];
        if (todayItems.length > 0) {
          const todaySection = document.createElement('div');
          todaySection.className = 'anime-schedule-day-group anime-today-section';
          todaySection.style.marginBottom = '32px';

          const todayTitle = document.createElement('h3');
          todayTitle.className = 'anime-schedule-day-title';
          todayTitle.style.cssText = 'color:#fff; font-size:1.2rem; font-weight:800; display:flex; align-items:center; gap:10px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:10px;';
          todayTitle.innerHTML = `<span style="background:var(--accent); color:#000; padding:4px 12px; border-radius:8px; font-size:0.82rem; font-weight:900; letter-spacing:0.5px;">TODAY</span> <i class="fas fa-calendar-check" style="color:var(--accent);"></i> TODAY'S RELEASES - ${todayDayName.toUpperCase()} (${todayItems.length})`;
          todaySection.appendChild(todayTitle);

          const todayGrid = document.createElement('div');
          todayGrid.className = 'anime-schedule-day-grid';

          todayItems.forEach(anime => {
            const card = document.createElement('div');
            card.className = 'media-card anime-card';

            const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || 'imgs/poster-placeholder.png';
            const airTime = anime.broadcast?.string || anime.broadcast?.time || 'Airing Today';
            const score = anime.score ? `⭐ ${anime.score}` : '';

            const safeTitle = (anime.title_english || anime.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeTitleAttr = safeTitle.replace(/'/g, "\\'");
            const isFollowed = isAnimeFollowed(anime.mal_id);
            const animeItem = {
              id: anime.mal_id,
              mal_id: anime.mal_id,
              title: anime.title_english || anime.title,
              title_english: anime.title_english || anime.title,
              poster: posterUrl,
              airTime,
              broadcastDay: todayDayName,
              score: anime.score
            };
            window._animeScheduleCache.set(String(anime.mal_id), animeItem);

            card.innerHTML = `
              <div class="anime-card-poster">
                <img src="${posterUrl}" loading="lazy" onerror="this.src='imgs/poster-placeholder.png'">
              </div>

              <!-- Favorite Star Toggle -->
              <button class="btn-anime-favorite-toggle ${isFollowed ? 'is-followed' : ''}" data-anime-id="${anime.mal_id}" onclick="event.stopPropagation(); window.toggleFollowAnimeById('${anime.mal_id}', event)" title="${isFollowed ? 'Favorited' : 'Add to Favorites'}">
                <i class="${isFollowed ? 'fas fa-star' : 'far fa-star'}" style="color: ${isFollowed ? '#fbbf24' : '#fff'}; font-size: 13px;"></i>
              </button>

              <!-- Info Overlay: Appears ONLY on Hover -->
              <div class="card-info">
                <div class="card-title" title="${safeTitle}">${safeTitle}</div>
                <div class="card-meta">
                  <span class="card-badge-air"><i class="fas fa-clock" style="font-size: 10px;"></i> ${airTime}</span>
                  ${score ? `<span class="card-badge-score">${score}</span>` : ''}
                </div>
              </div>
            `;

            card.style.cursor = 'pointer';
            card.onclick = (e) => {
              e.preventDefault();
              const q = anime.title_english || anime.title;
              if (!q) return;
              const searchInput = document.querySelector('#search-input-main');
              if (searchInput) searchInput.value = q;
              if (typeof switchView === 'function') switchView('search');
              if (typeof window.performUnifiedSearch === 'function') window.performUnifiedSearch(q);
            };

            todayGrid.appendChild(card);
          });

          todaySection.appendChild(todayGrid);
          grid.appendChild(todaySection);
        }
      }

      // 2. Weekly breakdown by day + Upcoming section
      const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'upcoming'];
      const sortedDays = Object.keys(grouped).sort((a, b) => {
        const ia = dayOrder.indexOf(a);
        const ib = dayOrder.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });

      sortedDays.forEach(day => {
        if (filterDay && day !== filterDay.toLowerCase()) return;

        const daySection = document.createElement('div');
        daySection.className = 'anime-schedule-day-group';
        
        const dayTitle = document.createElement('h3');
        dayTitle.className = 'anime-schedule-day-title';
        const isToday = day === todayDayName;
        const isUpcoming = day === 'upcoming';
        const iconClass = isUpcoming ? 'fa-rocket' : 'fa-calendar-day';
        const titleText = isUpcoming ? 'UPCOMING ANIME SEASONS' : `${day.toUpperCase()} SCHEDULE`;
        const accentBadge = isUpcoming ? '<span style="font-size:0.75rem; background:rgba(255,255,255,0.12); color:#ffffff; border:1px solid rgba(255,255,255,0.25); padding:2px 8px; border-radius:10px; margin-left:8px; font-weight:700;">SOON</span>' : (isToday ? ' <span style="font-size:0.75rem; background:rgba(255,255,255,0.12); padding:2px 8px; border-radius:10px; margin-left:8px; font-weight:700;">TODAY</span>' : '');

        dayTitle.innerHTML = `<i class="fas ${iconClass}" style="color:var(--accent);"></i> ${titleText} (${grouped[day].length})${accentBadge}`;
        daySection.appendChild(dayTitle);

        const dayGrid = document.createElement('div');
        dayGrid.className = 'anime-schedule-day-grid';

        grouped[day].forEach(anime => {
          const card = document.createElement('div');
          card.className = 'media-card anime-card';

          const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || 'imgs/poster-placeholder.png';
          const airTime = anime.broadcast?.string || anime.broadcast?.time || (anime.isUpcoming ? 'Coming Soon' : 'Airing');
          const score = anime.score ? `⭐ ${anime.score}` : '';

          const safeTitle = (anime.title_english || anime.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const safeTitleAttr = safeTitle.replace(/'/g, "\\'");
          const isFollowed = isAnimeFollowed(anime.mal_id);
          const animeItem = {
            id: anime.mal_id,
            mal_id: anime.mal_id,
            title: anime.title_english || anime.title,
            title_english: anime.title_english || anime.title,
            poster: posterUrl,
            airTime,
            broadcastDay: (anime.broadcast?.day || '').toLowerCase(),
            score: anime.score
          };
          window._animeScheduleCache.set(String(anime.mal_id), animeItem);

          card.innerHTML = `
            <div class="anime-card-poster">
              <img src="${posterUrl}" loading="lazy" onerror="this.src='imgs/poster-placeholder.png'">
            </div>

            <!-- Favorite Star Toggle -->
            <button class="btn-anime-favorite-toggle ${isFollowed ? 'is-followed' : ''}" data-anime-id="${anime.mal_id}" onclick="event.stopPropagation(); window.toggleFollowAnimeById('${anime.mal_id}', event)" title="${isFollowed ? 'Favorited' : 'Add to Favorites'}">
              <i class="${isFollowed ? 'fas fa-star' : 'far fa-star'}" style="color: ${isFollowed ? '#fbbf24' : '#fff'}; font-size: 13px;"></i>
            </button>

            <!-- Info Overlay: Appears ONLY on Hover -->
            <div class="card-info">
              <div class="card-title" title="${safeTitle}">${safeTitle}</div>
              <div class="card-meta">
                <span class="card-badge-air"><i class="fas ${anime.isUpcoming ? 'fa-calendar-alt' : 'fa-clock'}" style="font-size: 10px;"></i> ${airTime}</span>
                ${score ? `<span class="card-badge-score">${score}</span>` : ''}
              </div>
            </div>
          `;

          card.style.cursor = 'pointer';
          card.onclick = (e) => {
            e.preventDefault();
            const q = anime.title_english || anime.title;
            if (!q) return;
            const searchInput = document.querySelector('#search-input-main');
            if (searchInput) searchInput.value = q;
            if (typeof switchView === 'function') switchView('search');
            if (typeof window.performUnifiedSearch === 'function') window.performUnifiedSearch(q);
          };

          dayGrid.appendChild(card);
        });

        daySection.appendChild(dayGrid);
        grid.appendChild(daySection);
      });

    } catch (err) {
      console.error('[Anime Schedule] Load error:', err);
      grid.innerHTML = `<div style="padding:40px; text-align:center; color:#ef4444">Failed to load anime schedule: ${err.message}</div>`;
    }
  };

  let scheduleSearchDebounce = null;

  async function searchAnimeSchedule(query) {
    const grid = document.querySelector('#anime-schedule-grid');
    if (!grid) return;

    if (!query || !query.trim()) {
      return loadAnimeSchedule('');
    }

    grid.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted); font-size:1.1rem;"><i class="fas fa-spinner fa-spin"></i> Searching release schedule for "${query}"...</div>`;

    // Unselect day filter buttons during search
    document.querySelectorAll('.anime-schedule-filter-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = '#fff';
      btn.style.fontWeight = '600';
    });

    try {
      let results = null;
      if (window.api && typeof window.api.animeSearchSchedule === 'function') {
        try {
          results = await window.api.animeSearchSchedule(query);
        } catch (ipcErr) {
          console.warn('[AnimeSearchSchedule] IPC failed, falling back to direct AniList GraphQL:', ipcErr.message);
        }
      } else if (window.api && typeof window.api.invoke === 'function') {
        try {
          results = await window.api.invoke('anime-search-schedule', query);
        } catch (ipcErr) {
          console.warn('[AnimeSearchSchedule] IPC invoke failed, falling back to direct AniList GraphQL:', ipcErr.message);
        }
      }

      // Jikan search fallback if IPC was not ready or returned empty
      if (!results || !results.data || results.data.length === 0) {
        try {
          const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=15`);
          if (res.ok) {
            const jData = await res.json();
            const list = jData?.data || [];
            if (list.length > 0) {
              results = {
                data: list.map(item => {
                  let broadcastString = item.broadcast?.string || ('Status: ' + (item.status || 'Finished'));
                  let badgeColor = 'rgba(100, 116, 139, 0.9)';
                  if (item.airing) {
                    badgeColor = 'rgba(16, 185, 129, 0.95)';
                  } else if (item.status === 'Not yet aired') {
                    badgeColor = 'rgba(245, 158, 11, 0.95)';
                  }

                  const displayTitle = item.title_english || item.title || 'Unknown Anime';
                  return {
                    mal_id: item.mal_id,
                    id: item.mal_id,
                    title: displayTitle,
                    images: {
                      jpg: {
                        large_image_url: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url,
                        image_url: item.images?.webp?.image_url || item.images?.jpg?.image_url
                      }
                    },
                    broadcast: { string: broadcastString },
                    badgeColor,
                    score: item.score ? item.score.toFixed(1) : null,
                    status: item.status,
                    genres: (item.genres || []).map(g => g.name),
                    synopsis: item.synopsis || ''
                  };
                })
              };
            }
          }
        } catch (directErr) {
          console.warn('[AnimeSearchSchedule] Direct Jikan fetch error:', directErr.message);
        }
      }

      const items = results?.data || [];
      if (!items || items.length === 0) {
        grid.innerHTML = '';
        const followedContainer = document.createElement('div');
        followedContainer.id = 'anime-schedule-followed-container';
        grid.appendChild(followedContainer);
        renderFollowedAnimeSection();

        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'padding:40px; text-align:center; color:var(--text-muted)';
        emptyMsg.textContent = `No anime matching "${query}" found in release schedules.`;
        grid.appendChild(emptyMsg);
        return;
      }

      grid.innerHTML = '';

      // Render Followed / Favorites section at the top
      const followedContainer = document.createElement('div');
      followedContainer.id = 'anime-schedule-followed-container';
      grid.appendChild(followedContainer);
      renderFollowedAnimeSection();

      const section = document.createElement('div');
      section.className = 'anime-schedule-day-group';

      const title = document.createElement('h3');
      title.className = 'anime-schedule-day-title';
      title.innerHTML = `<i class="fas fa-search" style="color:var(--accent);"></i> SEARCH RESULTS FOR "${query.toUpperCase()}" (${items.length})`;
      section.appendChild(title);

      const dayGrid = document.createElement('div');
      dayGrid.className = 'anime-schedule-day-grid';

      items.forEach(anime => {
        const card = document.createElement('div');
        card.className = 'media-card anime-card';

        const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || 'imgs/poster-placeholder.png';
        const airInfo = anime.broadcast?.string || 'Completed';
        const score = anime.score ? `⭐ ${anime.score}` : '';

        const safeTitle = (anime.title_english || anime.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeTitleAttr = safeTitle.replace(/'/g, "\\'");
        const animeId = anime.mal_id || anime.id;
        const isFollowed = isAnimeFollowed(animeId);
        const animeItem = {
          id: animeId,
          mal_id: animeId,
          title: anime.title_english || anime.title,
          title_english: anime.title_english || anime.title,
          poster: posterUrl,
          airTime: airInfo,
          score: anime.score
        };
        window._animeScheduleCache.set(String(animeId), animeItem);

        card.innerHTML = `
          <div class="anime-card-poster">
            <img src="${posterUrl}" loading="lazy" onerror="this.src='imgs/poster-placeholder.png'">
          </div>

          <!-- Favorite Star Toggle -->
          <button class="btn-anime-favorite-toggle ${isFollowed ? 'is-followed' : ''}" data-anime-id="${animeId}" onclick="event.stopPropagation(); window.toggleFollowAnimeById('${animeId}', event)" title="${isFollowed ? 'Favorited' : 'Add to Favorites'}">
            <i class="${isFollowed ? 'fas fa-star' : 'far fa-star'}" style="color: ${isFollowed ? '#fbbf24' : '#fff'}; font-size: 13px;"></i>
          </button>

          <!-- Info Overlay: Appears ONLY on Hover -->
          <div class="card-info">
            <div class="card-title" title="${safeTitle}">${safeTitle}</div>
            <div class="card-meta">
              <span class="card-badge-air"><i class="fas fa-clock" style="font-size: 10px;"></i> ${airInfo}</span>
              ${score ? `<span class="card-badge-score">${score}</span>` : ''}
            </div>
          </div>
        `;

        // Hover motion is preserved in CSS; clicking does nothing
        card.onclick = (e) => { e.preventDefault(); };

        dayGrid.appendChild(card);
      });

      section.appendChild(dayGrid);
      grid.appendChild(section);

    } catch (err) {
      console.error('[Anime Search Schedule] Error:', err);
      grid.innerHTML = `<div style="padding:40px; text-align:center; color:#ef4444">Failed to search schedule: ${err.message}</div>`;
    }
  }

  function initAnimeScheduleSearch() {
    const searchInput = document.querySelector('#anime-schedule-search-input');
    const clearBtn = document.querySelector('#anime-schedule-search-clear');
    if (!searchInput || searchInput.dataset.bound) return;
    searchInput.dataset.bound = 'true';

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      clearTimeout(scheduleSearchDebounce);
      scheduleSearchDebounce = setTimeout(() => {
        if (!q) {
          loadAnimeSchedule('');
        } else if (q.length >= 2) {
          searchAnimeSchedule(q);
        }
      }, 400);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(scheduleSearchDebounce);
        const q = searchInput.value.trim();
        if (q) searchAnimeSchedule(q);
      }
    });

    if (clearBtn) {
      clearBtn.onclick = () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        loadAnimeSchedule('');
      };
    }
  }

  // Bind initAnimeScheduleSearch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnimeScheduleSearch);
  } else {
    initAnimeScheduleSearch();
  }

  window.playStream = playStream;
  window.clearContinueWatching = clearContinueWatching;
  window.renderContinueWatchingDiscover = renderContinueWatchingDiscover;
  window.loadAnimeSchedule = loadAnimeSchedule;
  window.searchAnimeSchedule = searchAnimeSchedule;
  window.checkFollowedAnimeEpisodes = checkFollowedAnimeEpisodes;
  window.renderFollowedAnimeSection = renderFollowedAnimeSection;

})();
