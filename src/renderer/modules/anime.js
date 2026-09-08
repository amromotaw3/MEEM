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
      if (!pb.meta) {
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

        let subtitle = isEpisode ? (item.showName || item.showTitle || (showObj && (showObj.title || showObj.cleanTitle)) || 'TV Show') : '';

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
            item.showId, item.imdb_id, item.imdbId, item.tmdbId, item.tmdb_id, item.id, item.showName, item.showTitle
          ].filter(Boolean);

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
        let episodeStill = null;

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
            epData = metaCache.videos.find(v => parseInt(v.season, 10) === sn && parseInt(v.episode, 10) === en);
          }

          // Also check showObj.episodes if local episode had cached meta
          if (!epData && showObj?.episodes) {
            epData = showObj.episodes.find(e => parseInt(e.season, 10) === sn && parseInt(e.episode, 10) === en);
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
            if (rawStill.startsWith('data:') || rawStill.startsWith('http://') || rawStill.startsWith('https://') || rawStill.startsWith('local-file://')) {
              episodeStill = rawStill;
            } else if (rawStill.startsWith('file:///')) {
              episodeStill = `local-file:///${rawStill.replace('file:///', '')}`;
            } else if (rawStill.startsWith('/')) {
              episodeStill = `https://image.tmdb.org/t/p/w500${rawStill}`;
            } else if (rawStill.includes(':\\') || rawStill.includes(':/') || rawStill.startsWith('\\\\')) {
              episodeStill = `local-file:///${rawStill.replace(/\\/g, "/")}`;
            } else {
              episodeStill = `https://image.tmdb.org/t/p/w500/${rawStill}`;
            }
          }
        }

        const pPath = item.poster_path || item.posterPath || metaCache.posterPath || metaCache.poster_path;

        let backdropUrl = 'imgs/no-backdrop.png';
        if (episodeStill) {
          backdropUrl = episodeStill;
        } else {
          const sId = showObj?.id || item.showId;
          const localBanner = appData.banners ? (appData.banners[item.id] || (sId ? appData.banners[sId] : null)) : null;
          if (localBanner) {
            backdropUrl = `local-file:///${localBanner.replace(/\\/g, "/")}`;
          } else if (bPath) {
            backdropUrl = (bPath.startsWith('http') || bPath.startsWith('local-file')) ? bPath : `https://image.tmdb.org/t/p/w500${bPath}`;
          } else if (item.cover) {
            backdropUrl = (item.cover.startsWith('data:') || item.cover.startsWith('http') || item.cover.startsWith('local-file'))
              ? item.cover
              : `local-file:///${item.cover.replace(/\\/g, "/")}`;
          } else if (item.poster) {
            backdropUrl = `local-file:///${item.poster.replace(/\\/g, "/")}`;
          } else if (item.image) {
            backdropUrl = localImg(item.image);
          } else if (pPath) {
            backdropUrl = (pPath.startsWith('http') || pPath.startsWith('local-file')) ? pPath : `https://image.tmdb.org/t/p/w500${pPath}`;
          }
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
          const resumeTime = (pb && pb.time > 2 && !pb.watched) ? pb.time : 0;
          const magnet = item.torrentMagnet || pb?.torrentMagnet || pb?.meta?.torrentMagnet;
          const fIdx = item.fileIdx ?? pb?.fileIdx ?? pb?.meta?.fileIdx ?? null;
          let rawPath = item.path || pb?.path || pb?.meta?.path || item.url || pb?.meta?.url;

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

          const isValidLocal = rawPath && (rawPath.startsWith('http://') || rawPath.startsWith('https://') || rawPath.includes(':\\') || rawPath.includes(':/') || rawPath.startsWith('\\\\'));

          if (magnet) {
            if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                torrentMagnet: magnet,
                fileIdx: fIdx,
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
          } else if (item.isStream) {
            if (typeof playVideo === 'function') {
              playVideo({
                ...item,
                startTime: resumeTime
              }, item.showName ? { title: item.showName, id: item.showId } : null, { startTime: resumeTime });
            }
          } else {
            // Online item without a direct path: open unified detail to pick stream
            if (typeof openUnifiedDetail === 'function') {
              openUnifiedDetail(showObj || item);
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
        <div style="flex: 1; width: 100%; height: 100%; min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 20px; background: rgba(255,255,255,0.03); border-radius: 20px; border: 1px dashed rgba(255,255,255,0.15); box-sizing: border-box; text-align: center;">
          <div style="width: 52px; height: 52px; background: rgba(255,255,255,0.06); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.1);">
             <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" style="opacity: 0.85;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <h3 style="font-size: 17px; margin: 0; opacity: 0.95; font-weight: 800; color: #fff; letter-spacing: 0.5px;">Start Watching Now!</h3>
          <p style="font-size: 12px; margin: 6px 0 0; opacity: 0.5; max-width: 260px; line-height: 1.4;">Your in-progress movies and episodes will appear here automatically.</p>
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
        if (typeof playVideo === 'function') playVideo(item, item.showName ? { title: item.showName, id: item.showId } : null);
      } else {
        if (typeof playVideo === 'function') playVideo(item, showObj);
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

      const inLib = localTitles.has(title.toLowerCase());
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
          ${posterUrl ? `<img src="${localImg(posterUrl)}" class="${imgClass}" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
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

    hero.innerHTML = `
      <div class="hero-backdrop" id="hero-backdrop-bg" style="background-image: url('${backdrop}')"></div>
      <div class="hero-overlay">
        <div class="hero-content">
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
        </div>
      </div>
      <div class="hero-pagination" id="discover-hero-dots"></div>
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
          const bgEl = hero.querySelector('#hero-backdrop-bg');
          if (bgEl) bgEl.style.backgroundImage = `url('${fallback}')`;
        }
      };
    }

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
    if (discoverHeroItems.length >= 6) return;
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

      // Fetch full metadata (including clearlogos) in background for logo display
      const heroType = isAnime ? 'tv' : (item.media_type || item.type || (item.title ? 'movie' : 'tv'));
      const normalizedType = (heroType === 'series' || heroType === 'tv') ? 'tv' : 'movie';
      
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

    const localMovies = appData.movies || [];
    const localShows = appData.shows || [];
    const activeProf = (window.appData?.profiles?.find(p => p.id === window.appData?.activeProfileId) || window.currentProfile);
    const watchlist = (activeProf?.watchlist || appData.watchlist || []);

    localHomeEl.innerHTML = `
      ${window.AppCapabilities?.can('youtube') ? `
      <!-- Section 0: YouTube Trending -->
      <div class="discover-section" id="home-local-youtube-section">
        <div class="discover-section-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h3 style="font-size:1.4rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
            <i class="fab fa-youtube" style="color:#ffffff;"></i> YouTube Trending
          </h3>
        </div>
        <div id="home-local-youtube-row" class="discover-row" style="display:flex; gap:18px; overflow-x:auto; padding:6px 4px 18px; scrollbar-width:thin;"></div>
      </div>` : ''}

      <!-- Section 1: Local Movies -->
      <div class="discover-section">
        <div class="discover-section-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h3 style="font-size:1.4rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
            <i class="fas fa-film" style="color:#ffffff;"></i> Local Movies
          </h3>
          <span style="font-size:0.85rem; color:rgba(255,255,255,0.5);">${localMovies.length} movies</span>
        </div>
        <div id="home-local-movies-row" class="discover-row" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:20px;"></div>
      </div>

      <!-- Section 2: Local Shows -->
      <div class="discover-section">
        <div class="discover-section-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h3 style="font-size:1.4rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
            <i class="fas fa-tv" style="color:#ffffff;"></i> Local TV Shows
          </h3>
          <span style="font-size:0.85rem; color:rgba(255,255,255,0.5);">${localShows.length} shows</span>
        </div>
        <div id="home-local-shows-row" class="discover-row" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:20px;"></div>
      </div>

      <!-- Section 3: Recent Watchlist -->
      <div class="discover-section">
        <div class="discover-section-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h3 style="font-size:1.4rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
            <i class="fas fa-bookmark" style="color:#ffffff;"></i> Recent Watchlist
          </h3>
          <span style="font-size:0.85rem; color:rgba(255,255,255,0.5);">${watchlist.length} items</span>
        </div>
        <div id="home-watchlist-row" class="discover-row" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:20px;"></div>
      </div>
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

    // Render Section 1: Local Movies
    const moviesRow = $('#home-local-movies-row');
    if (moviesRow) {
      if (!localMovies.length) {
        moviesRow.innerHTML = `<div style="grid-column:1/-1; padding:30px; text-align:center; background:rgba(255,255,255,0.02); border-radius:16px; color:rgba(255,255,255,0.4);">
          No local movies added yet. Add media folders in the Library screen.
        </div>`;
      } else {
        renderDiscoverGrid('#home-local-movies-row', localMovies.slice(0, 12));
      }
    }

    // Render Section 2: Local Shows
    const showsRow = $('#home-local-shows-row');
    if (showsRow) {
      if (!localShows.length) {
        showsRow.innerHTML = `<div style="grid-column:1/-1; padding:30px; text-align:center; background:rgba(255,255,255,0.02); border-radius:16px; color:rgba(255,255,255,0.4);">
          No local TV shows added yet.
        </div>`;
      } else {
        renderDiscoverGrid('#home-local-shows-row', localShows.slice(0, 12));
      }
    }

    // Render Section 3: Watchlist
    const watchlistRow = $('#home-watchlist-row');
    if (watchlistRow) {
      if (!watchlist.length) {
        watchlistRow.innerHTML = `<div style="grid-column:1/-1; padding:30px; text-align:center; background:rgba(255,255,255,0.02); border-radius:16px; color:rgba(255,255,255,0.4);">
          Your Watchlist is empty. Add titles to see them here.
        </div>`;
      } else {
        renderDiscoverGrid('#home-watchlist-row', watchlist.slice(0, 12));
      }
    }
  }

  async function loadDiscover(force = false) {
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
          } else {
            section.style.display = 'block';
          }
        }
      }
    });

    if (isDiscoverLoading && !force) return;
    
    if (force) {
      discoverHeroItems = [];
      discoverHeroIndex = 0;
      if (discoverHeroInterval) clearInterval(discoverHeroInterval);
    }
    
    isDiscoverLoading = true;
    const dm = $('.discover-main');
    if (dm) dm.scrollTop = 0;

    setTimeout(() => {
      renderContinueWatchingDiscover();
      if (typeof window.renderBentoWatchlist === 'function') window.renderBentoWatchlist();
    }, 100);

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
          items.slice(0, 2).forEach(it => addDiscoverHeroItem(it));
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
          items.slice(0, 2).forEach(it => addDiscoverHeroItem(it));
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

      // If Catalog is installed, load Now in Cinemas, Cinemeta Top 10 TV Shows, Top 10 Movies & Popular Rows
      if (hasCatalog) {
        promises.push(
          fetchCinemetaAndRender('#in-cinemas-row', 'movie', 'top', false),
          fetchCinemetaAndRender('#top10-tv-row', 'tv', 'top', true),
          fetchCinemetaAndRender('#top10-movie-row', 'movie', 'top', true),
          fetchCinemetaAndRender('#popular-movies-row', 'movie', 'imdbRating', false),
          fetchCinemetaAndRender('#popular-series-row', 'tv', 'imdbRating', false),
          fetchCinemetaGenreAndRender('#anime-row', 'Animation')
        );
      }

      // If YouTube is installed, load YouTube feeds
      if (hasYoutube) {
        promises.push(
          fetchYouTubeRecommendedAndRender(),
          fetchYouTubeCategoryAndRender('#youtube-trending-row', '#discover-youtube-section', 'Trending on YouTube', 'fab fa-youtube', null),
          fetchYouTubeSubscriptionsAndRender(),
          fetchYouTubeHistoryAndRender()
        );

        // Addon Isolation: If only YouTube is installed (no movie catalog), render 100% isolated YouTube Hub!
        if (!hasCatalog) {
          promises.push(
            fetchYouTubeCategoryAndRender('#yt-gaming-row', '#discover-yt-gaming-section', 'Gaming & Live Streams', 'fas fa-gamepad', 'popular gaming videos'),
            fetchYouTubeCategoryAndRender('#yt-music-row', '#discover-yt-music-section', 'Music & Trending Hits', 'fas fa-music', 'official music videos trending'),
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

    const limit = isTop10 ? 10 : 20;

    allowedItems.slice(0, limit).forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'discover-card';

      const isYT = item.type === 'youtube' || item.isYoutube;
      const title = item.title || item.name || 'Unknown';
      let rawPoster = item.poster || item.thumbnail || item.poster_path || '';
      
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

      const rating = parseFloat(item.vote_average || item.score) || 0;
      const year = (item.release_date || item.first_air_date || item.seasonYear || item.published || '').toString().slice(0, 4);
      const inLib = localTitles.has(title.toLowerCase());

      card.innerHTML = `
        <div class="discover-poster-wrap">
          <div class="discover-poster-placeholder" style="width:100%; height:100%; display:${posterUrl ? 'none' : 'flex'}; align-items:center; justify-content:center; background:var(--bg-surface-2);"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
          ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
          ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
          ${isYT ? `<div style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.85); color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:6px; z-index:2;">${item.duration || 'VIDEO'}</div>` : ''}
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="discover-meta">
            ${isYT ? `<span style="color:#ffffff; font-weight:700;"><i class="fab fa-youtube"></i> ${escapeHTML(item.author || 'YouTube')}</span>` : getBadgeHTML(item)}
            <span>${year}</span>
            ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
            ${!isYT ? `<span class="discover-age-badge-container">${getAgeBadgeHTML(getItemCertification(item))}</span>` : ''}
          </div>
        </div>
      `;

      if (isYT) {
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
      } else {
        card.onclick = () => openDiscoverDetail(item);
        if (typeof getTraktOrImdbPoster === 'function') {
          getTraktOrImdbPoster(item, null, card);
        }
      }

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
            const itemTitle = item.title || item.name || 'Unknown';
            let posterUrl = '';

            if (item.poster) {
              posterUrl = localImg(item.poster);
            } else if (item.poster_path) {
              posterUrl = localImg(item.poster_path);
            }

            const year = (item.release_date || item.first_air_date || item.seasonYear || item.releaseYear || item.year || '').toString().slice(0, 4);
            const rating = parseFloat(item.vote_average || item.score || item.rating) || 0;
            const inLib = localTitles.has(itemTitle.toLowerCase());
            
            card.innerHTML = `
              <div class="discover-poster-wrap">
                <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
                ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
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

  function clearContinueWatching() {
    if (!currentProfile) return;
    if (confirm('Are you sure you want to clear your playback history?')) {
      const profileId = currentProfile.id;
      // Clear local state immediately for responsive UI
      currentProfile.playback = {};
      persist();
      renderContinueWatchingDiscover();
      showToast('Playback history cleared');

      // Also delete from Supabase (this profile only, not other profiles)
      if (profileId && window.api && typeof window.api.clearProfilePlayback === 'function') {
        window.api.clearProfilePlayback(profileId).then(res => {
          if (res && res.error) {
            console.warn('[ContinueWatching] Supabase clear failed (local already cleared):', res.error);
          } else {
            console.log('[ContinueWatching] Supabase playback_history cleared for profile:', profileId);
          }
        }).catch(err => {
          console.warn('[ContinueWatching] clearProfilePlayback error:', err);
        });
      }
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
                <span class="dd-tag" style="background:#F7523922;color:#F75239">★ ${rating ? rating.toFixed(1) : 'N/A'} <span style="opacity:0.6;font-size:10.5px;margin-left:5px">MAL ID: ${malId}</span></span>
                ${imdbIdForCinemeta ? `<span class="dd-tag" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);font-weight:700;">IMDb: ${imdbIdForCinemeta}</span>` : ''}
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
                btn.onclick = () => window.api.openExternal(`https://www.youtube.com/watch?v=${data.trailer.youtube_id}`);
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

        const cinemetaDetail = await window.api.invoke('cinemeta-details', { id: imdbId, type });
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
            btn.onclick = () => window.api.openExternal(`https://www.youtube.com/watch?v=${trailer.id}`);
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

        if (type === 'tv' && meta.videos && meta.videos.length > 0) {
          const wrap = $('#dd-seasons');
          wrap.innerHTML = '<h3 style="margin-bottom:12px">Seasons</h3><div class="season-tabs" style="margin-bottom:15px"></div><div class="episode-list"></div>';
          const tabs = wrap.querySelector('.season-tabs');
          const epList = wrap.querySelector('.episode-list');

          const uniqueSeasons = [...new Set(meta.videos.map(v => v.season))].filter(s => s !== undefined && s !== null && s >= 0).sort((a, b) => a - b);
          
          uniqueSeasons.forEach((seasonNum, idx) => {
            const btn = document.createElement('button');
            btn.className = `season-tab ${idx === 0 ? 'active' : ''}`;
            btn.textContent = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
            btn.onclick = () => {
              tabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
              btn.classList.add('active');
              renderCinemetaEpisodes(meta.videos, seasonNum, epList, item);
            };
            tabs.appendChild(btn);
          });
          
          if (uniqueSeasons.length > 0) renderCinemetaEpisodes(meta.videos, uniqueSeasons[0], epList, item);
        } else if (type === 'movie') {
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
      el.innerHTML = `<div class="ep-thumb-wrap"><img src="${thumb}" class="ep-thumb"><div class="ep-number-overlay">${ep.episode}</div><div class="ep-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div></div><div class="episode-info"><div class="episode-title">${escapeHTML(ep.name || ep.title || `Episode ${ep.episode}`)}</div><div class="episode-desc">${escapeHTML(ep.overview || ep.description || 'No description.')}</div></div>`;
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

    const tmdbKey = appData.tmdbKey;
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
                  if (tmdbEp.name) {
                    const titleEl = epEl.querySelector('.episode-title');
                    if (titleEl) titleEl.textContent = tmdbEp.name;
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

      const statsLine = (s.title || '').split('\n').slice(1).join(' ');
      const seedsMatch = statsLine.match(/≡ƒæñ\s*(\d+)/) || statsLine.match(/(\d+)\s*seeds/i) || statsLine.match(/👥\s*(\d+)/);
      const seeds = seedsMatch ? parseInt(seedsMatch[1], 10) : 0;
      score += Math.min(seeds * 4, 400);

      if (title.includes('hevc') || title.includes('x265')) score += 40;
      if (title.includes('multi') || title.includes('dual') || title.includes('eng')) score += 25;

      const sizeMatch = statsLine.match(/([\d\.]+\s*GB)/i);
      if (sizeMatch && parseFloat(sizeMatch[1]) > 18 && preferredMaxRes !== '4K') {
        score -= 100;
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
    const container = $('#dd-streams-list');
    if (!container) return;

    const autoChoose = window.appData && window.appData.autoChooseBestStream;

    // Show inline spinner immediately — especially useful with Auto-Choose enabled
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

      let showMeta = currentShow ? (typeof getMetadataForItem === 'function' ? getMetadataForItem(currentShow) : null) : null;
      let itemMeta = typeof getMetadataForItem === 'function' ? getMetadataForItem(item) : null;
      let resolvedImdb = item.imdb_id || item.imdbId || itemMeta?.cinemetaId || itemMeta?.imdbId || itemMeta?.imdb_id || showMeta?.cinemetaId || showMeta?.imdbId || showMeta?.imdb_id || window.currentDetailItem?.imdb_id || window.currentDetailItem?.imdbId || null;

      if (resolvedImdb && (typeof isLocalFilePath === 'function' ? isLocalFilePath(resolvedImdb) : (resolvedImdb.includes('/') || resolvedImdb.includes('\\')))) {
        resolvedImdb = null;
      }

      // Normalize tmdbId: strip "tmdb:" prefix so the main process gets a clean numeric ID
      let normalizedTmdbId = item.tmdbId || item.tmdb_id || item.id || window.currentDetailItem?.tmdbId || window.currentDetailItem?.tmdb_id || window.currentDetailItem?.id;
      if (normalizedTmdbId && String(normalizedTmdbId).startsWith('tmdb:')) {
        normalizedTmdbId = String(normalizedTmdbId).replace('tmdb:', '');
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
        container.innerHTML = `<div style="padding:20px; color:#EF4444; text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">Error fetching streams: ${err.message}</div>`;
        return;
      }

      container.innerHTML = '';
      if (!streams || !streams.length) {
        container.innerHTML = `<div style="padding:20px; color:var(--text-muted); text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">No links found for ${item.title || 'this item'} (IMDB: ${item.imdb_id || 'Missing'}). Please try again later.</div>`;
        return;
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

        const downloadHtml = isBrowser ? '' : `<div class="stream-btn-download" title="Copy Torrent Link"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div>`;
        
        const playTitle = isBrowser ? 'Open Link' : 'Play';
        const playIcon = isBrowser 
          ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` 
          : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

        card.innerHTML = `<div class="stream-top"><div class="stream-icon-box">${streamIconSvg}</div><div class="stream-main-info"><div class="stream-title" title="${escapeHTML(mainTitle)}">${escapeHTML(mainTitle)}</div><div class="stream-badges">${isBrowser ? '' : `<span class="quality-badge">${s.quality}</span>`}<span class="source-badge">${s.addon}</span></div></div></div><div class="stream-footer"><div class="stream-stats">${seeds ? `<div class="stream-stat-badge seeds">${seedsIcon}${seeds}</div>` : ''}${size ? `<div class="stream-stat-badge size">${sizeIcon}${size}</div>` : ''}</div><div class="stream-actions-group">${downloadHtml}<div class="stream-btn-play" title="${playTitle}">${playIcon}</div></div></div>`;

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
        container.appendChild(card);
      });

      // 2. Smart Auto-Play Best Stream if enabled
      if (window.appData && window.appData.autoChooseBestStream) {
        const bestStream = selectBestStream(streams, window.appData.autoChooseMaxRes || '1080p');
        if (bestStream) {
          if (typeof window._restorePlayBtn === 'function') {
            window._restorePlayBtn();
            window._restorePlayBtn = null;
          }
          showToast(`Auto-playing best stream (${bestStream.quality || '1080p'})...`);
          setTimeout(() => {
            playStream(bestStream, item, null);
          }, 500);
        } else {
          if (typeof window._restorePlayBtn === 'function') {
            window._restorePlayBtn();
            window._restorePlayBtn = null;
          }
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

  window.openYouTubeSettingsModal = async function() {
    const modal = $('#youtube-settings-modal');
    if (modal) modal.style.display = 'flex';
    await refreshYouTubeAccountUI();
  };

  async function refreshYouTubeAccountUI() {
    try {
      const res = await window.api.invoke('youtube-get-account');
      const nameEl = $('#yt-account-name');
      const emailEl = $('#yt-account-email');
      const avatarEl = $('#yt-account-avatar');
      const statusEl = $('#yt-account-status');
      const btnLabel = $('#yt-auth-btn-label');
      const authBtn = $('#btn-yt-auth-action');
      const switchBtn = $('#btn-yt-switch-action');
      const meemSyncLink = $('#link-yt-meem-sync');

      if (res && res.success && res.signedIn && res.account) {
        if (nameEl) nameEl.textContent = res.account.name || 'Google Account';
        if (emailEl) emailEl.textContent = res.account.email || 'Connected to YouTube';
        if (avatarEl && res.account.avatar) avatarEl.src = res.account.avatar;
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Connected via Google Account';
        }
        if (switchBtn) switchBtn.style.display = 'inline-flex';
        if (meemSyncLink) meemSyncLink.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Sign Out';
        if (authBtn) {
          authBtn.style.background = 'rgba(239,68,68,0.18)';
          authBtn.style.color = '#ef4444';
          authBtn.style.border = '1px solid rgba(239,68,68,0.35)';
          authBtn.style.boxShadow = 'none';
        }
      } else {
        if (nameEl) nameEl.textContent = 'Not Signed In';
        if (emailEl) emailEl.textContent = 'Sign in with any Google account to sync feeds & history';
        if (avatarEl) avatarEl.src = 'https://lh3.googleusercontent.com/a/default-user=s96-c';
        if (statusEl) statusEl.style.display = 'none';
        if (switchBtn) switchBtn.style.display = 'none';
        if (btnLabel) btnLabel.textContent = 'Sign In';
        if (authBtn) {
          authBtn.style.background = '#ffffff';
          authBtn.style.color = '#000000';
          authBtn.style.border = 'none';
          authBtn.style.boxShadow = '0 4px 20px rgba(255,255,255,0.3)';
        }
        if (meemSyncLink) {
          const meemUser = window.state?.user || null;
          if (meemUser && meemUser.email) {
            meemSyncLink.style.display = 'inline-block';
            meemSyncLink.innerHTML = `<i class="fas fa-link" style="margin-right:4px;"></i> Use MEEM Account (${escapeHTML(meemUser.email)})`;
          } else {
            meemSyncLink.style.display = 'none';
          }
        }
      }
    } catch (err) {
      console.error('[YouTube Settings] Account refresh error:', err);
    }
  }
  window.refreshYouTubeAccountUI = refreshYouTubeAccountUI;

  // Auth & Settings Modal Event Handlers
  document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = $('#youtube-settings-modal');
    if (settingsModal) {
      settingsModal.onclick = (e) => {
        if (e.target === settingsModal) settingsModal.style.display = 'none';
      };
    }
    const btnCloseSettings = $('#btn-close-yt-settings');
    if (btnCloseSettings) {
      btnCloseSettings.onclick = () => {
        if (settingsModal) settingsModal.style.display = 'none';
      };
    }

    const authBtn = $('#btn-yt-auth-action');
    if (authBtn) {
      authBtn.onclick = async () => {
        const res = await window.api.invoke('youtube-get-account');
        if (res && res.signedIn) {
          await window.api.invoke('youtube-sign-out');
          showToast('👋 Signed out of YouTube account');
          await refreshYouTubeAccountUI();
          if (typeof window.loadDiscover === 'function') window.loadDiscover(true);
        } else {
          const settingsModal = $('#youtube-settings-modal');
          if (settingsModal) settingsModal.style.display = 'none';
          if (typeof window.openGoogleAuthModal === 'function') {
            window.openGoogleAuthModal();
          } else {
            showToast('Opening Google Authorization...');
          }
        }
      };
    }

    const switchBtn = $('#btn-yt-switch-action');
    if (switchBtn) {
      switchBtn.onclick = async () => {
        await window.api.invoke('youtube-sign-out');
        await refreshYouTubeAccountUI();
        const settingsModal = $('#youtube-settings-modal');
        if (settingsModal) settingsModal.style.display = 'none';
        if (typeof window.openGoogleAuthModal === 'function') {
          window.openGoogleAuthModal();
        }
      };
    }

    const meemSyncLink = $('#link-yt-meem-sync');
    if (meemSyncLink) {
      meemSyncLink.onclick = async (e) => {
        e.preventDefault();
        const syncRes = await window.api.invoke('youtube-sync-meem-account').catch(() => null);
        if (syncRes && syncRes.signedIn && syncRes.account) {
          showToast(`✅ Connected MEEM Account (${syncRes.account.email})`);
          await refreshYouTubeAccountUI();
          if (typeof window.loadDiscover === 'function') window.loadDiscover(true);
        }
      };
    }

    const linkTvAuth = $('#link-yt-device-auth');
    if (linkTvAuth) {
      linkTvAuth.onclick = (e) => {
        e.preventDefault();
        const settingsModal = $('#youtube-settings-modal');
        if (settingsModal) settingsModal.style.display = 'none';
        if (typeof window.openGoogleAuthModal === 'function') {
          window.openGoogleAuthModal();
        }
      };
    }

    const btnOpenHistory = $('#btn-open-yt-history');
    if (btnOpenHistory) {
      btnOpenHistory.onclick = () => {
        const settingsModal = $('#youtube-settings-modal');
        if (settingsModal) settingsModal.style.display = 'none';
        window.openYouTubeHistoryModal();
      };
    }

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
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;">
          ${list.map(anime => {
            const safeTitle = (anime.title || anime.title_english || 'Anime').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeTitleAttr = safeTitle.replace(/'/g, "\\'");
            const nextEpText = anime.nextEpisode ? `Ep ${anime.nextEpisode}` : 'Ongoing';
            const countdown = anime.countdown || anime.airTime || 'Airing Weekly';
            const epTitleStr = anime.lastEpisodeTitle ? (anime.lastEpisodeTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')) : '';
            return `
              <div class="anime-card anime-favorite-card" style="background: rgba(255,255,255,0.04); border-radius: 12px; overflow: hidden; border: 1px solid rgba(251, 191, 36, 0.35); cursor: default; user-select: none; position: relative;">
                <div style="position: relative; aspect-ratio: 2/3; overflow: hidden;">
                  <img src="${anime.poster}" style="width:100%; height:100%; object-fit:cover; pointer-events: none;" loading="lazy">
                  
                  <!-- Remove button -->
                  <button class="btn-anime-unfavorite" onclick="window.toggleFollowAnime({ id: '${anime.id}', mal_id: '${anime.mal_id}', title: '${safeTitleAttr}' }, event)" style="position: absolute; top: 8px; right: 8px; z-index: 5; background: rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.3); color: #ef4444; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; transition: all 0.2s;" title="Remove from Favorites">
                    <i class="fas fa-trash-alt" style="font-size: 11px;"></i>
                  </button>

                  <!-- Episode badge -->
                  <span style="position: absolute; top: 8px; left: 8px; background: rgba(16, 185, 129, 0.95); color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; backdrop-filter: blur(4px);">
                    <i class="fas fa-tv"></i> ${nextEpText}
                  </span>

                  <!-- Air time / Countdown badge -->
                  <span style="position: absolute; bottom: 8px; left: 8px; right: 8px; background: rgba(99, 102, 241, 0.95); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;">
                    <i class="fas fa-clock"></i> ${countdown}
                  </span>
                </div>
                <div style="padding: 10px; pointer-events: none;">
                  <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeTitle}">${safeTitle}</div>
                  ${epTitleStr ? `<div style="font-size: 0.72rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px;" title="${epTitleStr}">${epTitleStr}</div>` : ''}
                  <div style="font-size: 0.72rem; color: #fbbf24; margin-top: 4px; font-weight: 600; display: flex; align-items: center; gap: 5px;">
                    <i class="fas fa-star" style="font-size: 10px;"></i> Favorited
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
      });

      const json = await resp.json();
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

  async function loadAnimeSchedule(filterDay = '') {
    const filterBtns = document.querySelectorAll('.anime-schedule-filter-btn');
    filterBtns.forEach(btn => {
      if (btn.dataset.day === filterDay) {
        btn.classList.add('active');
        btn.style.background = '#fff';
        btn.style.color = '#000';
        btn.style.fontWeight = '800';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'rgba(255,255,255,0.06)';
        btn.style.color = '#fff';
        btn.style.fontWeight = '600';
      }
    });

    const grid = document.querySelector('#anime-schedule-grid') || document.querySelector('#anime-grid') || document.querySelector('#discover-genre-view');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted); font-size:1.1rem;"><i class="fas fa-spinner fa-spin"></i> Loading Anime Release Schedule...</div>';

    try {
      let jikanItems = [];
      try {
        if (window.api && typeof window.api.jikanSchedule === 'function') {
          const res = await window.api.jikanSchedule(filterDay);
          jikanItems = res?.data || [];
        } else if (window.api && typeof window.api.invoke === 'function') {
          const res = await window.api.invoke('jikan-schedule', filterDay);
          jikanItems = res?.data || [];
        } else {
          const res = await fetch(`https://api.jikan.moe/v4/schedules${filterDay ? '?filter=' + filterDay : ''}`);
          const json = await res.json();
          jikanItems = json?.data || [];
        }
      } catch (jikanErr) {
        console.warn('[AnimeSchedule] Jikan schedule warning:', jikanErr.message);
      }

      // 2. AniList Airing Schedule fetch (Complete weekly coverage)
      let anilistItems = [];
      try {
        const now = Math.floor(Date.now() / 1000);
        const daySeconds = 86400;
        const daysNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        
        const gql = `query ($greater: Int, $lesser: Int) {
          Page(page: 1, perPage: 50) {
            airingSchedules(airingAt_greater: $greater, airingAt_lesser: $lesser, sort: TIME) {
              id
              airingAt
              timeUntilAiring
              episode
              media {
                id
                idMal
                title { english romaji native }
                coverImage { extraLarge large medium }
                status
                genres
                episodes
                averageScore
                description
              }
            }
          }
        }`;

        const resp = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            query: gql,
            variables: { greater: now - daySeconds, lesser: now + (7 * daySeconds) }
          })
        });
        const json = await resp.json();
        const rawAiring = json?.data?.Page?.airingSchedules || [];

        rawAiring.forEach(entry => {
          const media = entry.media;
          if (!media) return;
          const date = new Date(entry.airingAt * 1000);
          const dayName = daysNames[date.getDay()];
          
          if (filterDay && !dayName.startsWith(filterDay.toLowerCase()) && !filterDay.toLowerCase().startsWith(dayName)) return;

          const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const diff = entry.airingAt - now;
          let countdown = '';
          if (diff > 0) {
            const days = Math.floor(diff / 86400);
            const hours = Math.floor((diff % 86400) / 3600);
            const mins = Math.floor((diff % 3600) / 60);
            countdown = ` (in ${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m)`;
          }

          const displayTitle = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown Anime';

          anilistItems.push({
            mal_id: media.idMal || media.id,
            id: media.idMal || media.id,
            title: displayTitle,
            title_english: media.title?.english || displayTitle,
            images: {
              jpg: {
                large_image_url: media.coverImage?.extraLarge || media.coverImage?.large,
                image_url: media.coverImage?.large || media.coverImage?.medium
              }
            },
            broadcast: {
              day: dayName,
              string: `Ep ${entry.episode} on ${dayName.toUpperCase()} at ${timeStr}${countdown}`,
              time: timeStr
            },
            score: media.averageScore ? (media.averageScore / 10).toFixed(1) : null,
            status: media.status,
            episodes: media.episodes,
            genres: media.genres || [],
            synopsis: media.description ? media.description.replace(/<[^>]*>/g, '') : ''
          });
        });
      } catch (aniErr) {
        console.warn('[AnimeSchedule] AniList schedule warning:', aniErr.message);
      }

      // 3. AnimeSchedule.net Live Timetable Integration
      let animeScheduleItems = [];
      try {
        const asResp = await fetch('https://animeschedule.net', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html'
          }
        });
        const asHtml = await asResp.text();
        const colBlocks = asHtml.split(/<div[^>]*class="timetable-column[^"]*\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/gi);

        for (let i = 1; i < colBlocks.length; i += 2) {
          const dayName = colBlocks[i].toLowerCase();
          if (filterDay && !dayName.startsWith(filterDay.toLowerCase()) && !filterDay.toLowerCase().startsWith(dayName)) continue;

          const blockHtml = colBlocks[i + 1] || '';
          const showCardMatches = blockHtml.match(/<div[^>]*route="([^"]+)"[\s\S]*?(?=<div[^>]*route=|<\/div>\s*<\/div>\s*<\/div>|$)/g);
          if (!showCardMatches) continue;

          const seenRoutes = new Set();
          showCardMatches.forEach(tile => {
            const routeMatch = tile.match(/route="([^"]+)"/);
            if (!routeMatch) return;
            const route = routeMatch[1];
            if (seenRoutes.has(route)) return;
            seenRoutes.add(route);

            const titleMatch = tile.match(/class="show-title-bar"[^>]*>([^<]+)<\/h[23]>/) || tile.match(/alt="Official promotional poster for ([^"]+)"/);
            const title = titleMatch ? titleMatch[1].trim() : route;

            const epMatch = tile.match(/airedEpisode="([^"]+)"/);
            const epNum = epMatch ? epMatch[1] : '';

            const imgMatch = tile.match(/data-src="([^"]+)"/) || tile.match(/src="([^"]+)"/);
            let poster = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';
            if (poster.startsWith('/')) poster = 'https://animeschedule.net' + poster;

            animeScheduleItems.push({
              id: route,
              mal_id: route,
              route: route,
              title: title,
              title_english: title,
              images: {
                jpg: {
                  large_image_url: poster,
                  image_url: poster
                }
              },
              broadcast: {
                day: dayName,
                string: epNum ? `Ep ${epNum} on ${dayName.toUpperCase()}` : `Airing on ${dayName.toUpperCase()}`
              },
              status: 'Ongoing'
            });
          });
        }
      } catch (asErr) {
        console.warn('[AnimeSchedule] Live timetable fetch warning:', asErr.message);
      }

      // Merge and deduplicate items
      const seenIds = new Set();
      const items = [];
      for (const item of [...anilistItems, ...jikanItems, ...animeScheduleItems]) {
        const key = item.mal_id || item.id || item.title;
        if (!seenIds.has(String(key))) {
          seenIds.add(String(key));
          items.push(item);
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
        const day = (item.broadcast?.day || 'Scheduled').toLowerCase();
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(item);
      });

      Object.keys(grouped).forEach(day => {
        const daySection = document.createElement('div');
        daySection.className = 'anime-schedule-day-group';
        daySection.style.cssText = 'margin-bottom: 28px;';
        
        const dayTitle = document.createElement('h3');
        dayTitle.style.cssText = 'font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; display: flex; align-items: center; gap: 8px;';
        dayTitle.innerHTML = `<i class="fas fa-calendar-day" style="color:var(--accent);"></i> ${day.toUpperCase()} SCHEDULE (${grouped[day].length})`;
        daySection.appendChild(dayTitle);

        const dayGrid = document.createElement('div');
        dayGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;';

        grouped[day].forEach(anime => {
          const card = document.createElement('div');
          card.className = 'anime-card';
          card.style.cssText = 'background: rgba(255,255,255,0.03); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); cursor: default; user-select: none; position: relative; pointer-events: none;';

          const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || 'imgs/poster-placeholder.png';
          const airTime = anime.broadcast?.string || anime.broadcast?.time || 'Airing';
          const score = anime.score ? `⭐ ${anime.score}` : 'NEW';

          const safeTitle = (anime.title_english || anime.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
            <div style="position: relative; aspect-ratio: 2/3; overflow: hidden;">
              <img src="${posterUrl}" style="width:100%; height:100%; object-fit:cover; pointer-events: none;" loading="lazy">
              
              <!-- Favorite Star Toggle -->
              <button class="btn-anime-favorite-toggle" data-anime-id="${anime.mal_id}" onclick="window.toggleFollowAnimeById('${anime.mal_id}', event)" style="position: absolute; top: 8px; left: 8px; z-index: 5; background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.25); color: ${isFollowed ? '#fbbf24' : 'rgba(255,255,255,0.8)'}; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; transition: all 0.2s; backdrop-filter: blur(4px);" title="${isFollowed ? 'Favorited (Click to remove)' : 'Add to Favorites & track episodes'}">
                <i class="${isFollowed ? 'fas fa-star' : 'far fa-star'}" style="font-size: 13px;"></i>
              </button>

              <span style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; backdrop-filter: blur(4px); pointer-events: none;">${score}</span>
              <span style="position: absolute; bottom: 8px; left: 8px; background: rgba(99, 102, 241, 0.9); color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; pointer-events: none;"><i class="fas fa-clock"></i> ${airTime}</span>
            </div>
            <div style="padding: 10px; pointer-events: none;">
              <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeTitle}">${safeTitle}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${anime.episodes ? anime.episodes + ' Episodes' : 'Ongoing'}</div>
            </div>
          `;
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

      // Direct AniList GraphQL fallback if IPC was not ready or returned empty
      if (!results || !results.data || results.data.length === 0) {
        try {
          const gql = `query ($search: String) {
            Page(page: 1, perPage: 25) {
              media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                id
                idMal
                title { romaji english native }
                coverImage { extraLarge large medium }
                nextAiringEpisode { episode airingAt timeUntilAiring }
                status
                episodes
                genres
                averageScore
                description
              }
            }
          }`;
          const resp = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query: gql, variables: { search: query } })
          });
          const json = await resp.json();
          const list = json?.data?.Page?.media || [];
          if (list.length > 0) {
            const now = Math.floor(Date.now() / 1000);
            const daysNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            results = {
              data: list.map(item => {
                const next = item.nextAiringEpisode;
                let broadcastString = 'Status: ' + (item.status || 'Finished');
                let badgeColor = 'rgba(100, 116, 139, 0.9)';
                if (next && next.airingAt) {
                  const date = new Date(next.airingAt * 1000);
                  const dayName = daysNames[date.getDay()];
                  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const diff = next.airingAt - now;
                  let countdown = '';
                  if (diff > 0) {
                    const days = Math.floor(diff / 86400);
                    const hours = Math.floor((diff % 86400) / 3600);
                    const mins = Math.floor((diff % 3600) / 60);
                    countdown = ` (in ${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m)`;
                  }
                  broadcastString = `Ep ${next.episode} on ${dayName} at ${timeStr}${countdown}`;
                  badgeColor = 'rgba(16, 185, 129, 0.95)';
                } else if (item.status === 'RELEASING') {
                  broadcastString = 'Airing Weekly';
                  badgeColor = 'rgba(59, 130, 246, 0.95)';
                } else if (item.status === 'NOT_YET_RELEASED') {
                  broadcastString = 'Upcoming Release';
                  badgeColor = 'rgba(245, 158, 11, 0.95)';
                }

                const displayTitle = item.title?.english || item.title?.romaji || item.title?.native || 'Unknown Anime';
                return {
                  mal_id: item.idMal || item.id,
                  id: item.idMal || item.id,
                  title: displayTitle,
                  images: {
                    jpg: {
                      large_image_url: item.coverImage?.extraLarge || item.coverImage?.large,
                      image_url: item.coverImage?.large || item.coverImage?.medium
                    }
                  },
                  broadcast: { string: broadcastString },
                  badgeColor,
                  score: item.averageScore ? (item.averageScore / 10).toFixed(1) : null,
                  status: item.status,
                  genres: item.genres || [],
                  synopsis: item.description ? item.description.replace(/<[^>]*>/g, '') : ''
                };
              })
            };
          }
        } catch (directErr) {
          console.warn('[AnimeSearchSchedule] Direct AniList fetch error:', directErr.message);
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
      section.style.cssText = 'margin-bottom: 28px;';

      const title = document.createElement('h3');
      title.style.cssText = 'font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; display: flex; align-items: center; gap: 8px;';
      title.innerHTML = `<i class="fas fa-search" style="color:var(--accent);"></i> SEARCH RESULTS FOR "${query.toUpperCase()}" (${items.length})`;
      section.appendChild(title);

      const dayGrid = document.createElement('div');
      dayGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;';

      items.forEach(anime => {
        const card = document.createElement('div');
        card.className = 'anime-card';
        card.style.cssText = 'background: rgba(255,255,255,0.03); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); cursor: default; user-select: none; position: relative; pointer-events: none;';

        const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || 'imgs/poster-placeholder.png';
        const airInfo = anime.broadcast?.string || 'Completed';
        const badgeColor = anime.badgeColor || 'rgba(99, 102, 241, 0.95)';
        const score = anime.score ? `⭐ ${anime.score}` : (anime.status || 'NEW');

        const safeTitle = (anime.title_english || anime.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
          <div style="position: relative; aspect-ratio: 2/3; overflow: hidden;">
            <img src="${posterUrl}" style="width:100%; height:100%; object-fit:cover; pointer-events: none;" loading="lazy">
            
            <!-- Favorite Star Toggle -->
            <button class="btn-anime-favorite-toggle" data-anime-id="${animeId}" onclick="window.toggleFollowAnimeById('${animeId}', event)" style="position: absolute; top: 8px; left: 8px; z-index: 5; background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.25); color: ${isFollowed ? '#fbbf24' : 'rgba(255,255,255,0.8)'}; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; transition: all 0.2s; backdrop-filter: blur(4px);" title="${isFollowed ? 'Favorited (Click to remove)' : 'Add to Favorites & track episodes'}">
              <i class="${isFollowed ? 'fas fa-star' : 'far fa-star'}" style="font-size: 13px;"></i>
            </button>

            <span style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; backdrop-filter: blur(4px); pointer-events: none;">${score}</span>
            <span style="position: absolute; bottom: 8px; left: 8px; right: 8px; background: ${badgeColor}; color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;"><i class="fas fa-clock"></i> ${airInfo}</span>
          </div>
          <div style="padding: 10px; pointer-events: none;">
            <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeTitle}">${safeTitle}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${anime.episodes ? anime.episodes + ' Episodes' : (anime.status || 'Ongoing')}</div>
          </div>
        `;
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
