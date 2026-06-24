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
    async fetchTmdbStill(imdbId, episodeNum) {
      const tmdbKey = appData.tmdbKey;
      if (!tmdbKey) return null;

      try {
        const tvId = await this.getTmdbTvId(imdbId);
        if (tvId) {
          const seasonUrl = `https://api.themoviedb.org/3/tv/${tvId}/season/1/episode/${episodeNum}?api_key=${tmdbKey}`;
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
    async resolveEpisode(show, kitsuId, malId, imdbId, episodeNum) {
      const cacheKey = `${show.id || show.title || 'anime'}_E${episodeNum}`;
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
        const tmdbData = await this.fetchTmdbStill(imdbId, episodeNum);
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
    const row = btn.closest('.discover-section').querySelector('.discover-row');
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
      for (let i = 0; i < 12; i++) {
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
    const section = $('#discover-continue-section');
    const row = $('#discover-continue-row');
    if (!section || !row) return;

    row.innerHTML = '';

    const items = Object.entries(currentProfile.playback).map(([key, pb]) => {
      if (!pb.meta) {
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
      }
      if (pb.meta) {
        if (pb.torrentMagnet) {
          pb.meta.torrentMagnet = pb.torrentMagnet;
        }
        if (pb.fileIdx !== undefined && pb.fileIdx !== null) {
          pb.meta.fileIdx = pb.fileIdx;
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
            displayTitle = `S${String(sn).padStart(2, '0')}E${String(en).padStart(2, '0')} ┬╖ ${epData.name || 'Episode ' + en}`;

            let still = '';
            if (epData.local_still) {
              still = `local-file:///${epData.local_still.replace(/\\/g, "/")}`;
            }

            if (still) {
              bPath = still;
            }
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
            const metaId = item.id || item.tmdbId;
            backdropUrl = metaId ? `https://images.metahub.space/background/medium/${metaId}${String(metaId).startsWith('tt') && !String(metaId).endsWith('/background.jpg') ? '/background.jpg' : ''}` : 'imgs/no-backdrop.png';
          }
        } else if (pPath) {
          const metaId = item.id || item.tmdbId;
          backdropUrl = metaId ? `https://images.metahub.space/poster/medium/${metaId}${String(metaId).startsWith('tt') && !String(metaId).endsWith('/poster.jpg') ? '/poster.jpg' : ''}` : 'imgs/no-backdrop.png';
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
      section.style.display = 'block';
    } else {
      row.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; background: rgba(255,255,255,0.03); border-radius: 20px; border: 1px dashed rgba(255,255,255,0.12); margin: 0 10px;">
          <div style="width: 50px; height: 50px; background: var(--accent-glow); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 15px; box-shadow: 0 0 30px var(--accent-glow);">
             <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          </div>
          <h3 style="font-size: 16px; margin: 0; opacity: 0.8; font-weight: 700;">Start your next adventure</h3>
          <p style="font-size: 13px; margin: 5px 0 0; opacity: 0.4;">Your recently watched movies and shows will appear here.</p>
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
    const removeBtn = createBtn('fa-trash-alt', 'Remove from List', () => {
      const key = getPlaybackKey(item);
      if (currentProfile?.playback && currentProfile.playback[key]) {
        delete currentProfile.playback[key];
        persist();
        renderContinueWatchingDiscover();
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
      let posterUrl = item.poster || '';
      const inLib = localTitles.has(title.toLowerCase());
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
      if (typeof enableHoverPreview === 'function') enableHoverPreview(card, item, '.discover-poster-wrap');
      grid.appendChild(card);
    });
  }

  function updateDiscoverHeroDisplay() {
    const hero = $('#discover-hero');
    if (!hero || discoverHeroItems.length === 0) return;
    const item = discoverHeroItems[discoverHeroIndex];
    if (!item) return;

    const title = item.title || item.name || 'Unknown';
    const backdrop = item.backdrop_path || item.background || item.poster_path || item.poster || '';
    const year = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
    const rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : (item.score || 'N/A');
    const isAnime = item.source === 'anilist' || item.source === 'mal' || item.format;
    const type = isAnime ? 'ANIME' : (item.media_type === 'tv' ? 'SERIES' : 'MOVIE');

    hero.innerHTML = `
      <div class="hero-backdrop" style="background-image: url('${backdrop}')"></div>
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

  async function loadDiscover(force = false) {
    if ($('#discover-genre-view')) $('#discover-genre-view').style.display = 'none';
    if ($('#discover-results')) $('#discover-results').style.display = 'none';
    if ($('#discover-content')) $('#discover-content').style.display = 'block';

    if (isDiscoverLoading && !force) return;
    
    if (force) {
      discoverHeroItems = [];
      discoverHeroIndex = 0;
      if (discoverHeroInterval) clearInterval(discoverHeroInterval);
    }
    
    isDiscoverLoading = true;
    const dm = $('.discover-main');
    if (dm) dm.scrollTop = 0;

    setTimeout(() => renderContinueWatchingDiscover(), 100);

    const rows = ['#trending-row', '#trending-series-row', '#popular-movies-row', '#top-rated-row', '#anime-row', '#upcoming-row'];
    rows.forEach(sel => {
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

    $$('.discover-section').forEach(s => s.style.display = 'block');
    
    const fetchAndRender = async (selector, apiCall) => {
      try {
        const data = await apiCall;
        if (!data || data.error) {
          const row = $(selector);
          if (row) {
            if (!selector.includes('anime')) {
              row.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:0.8rem">${data?.error || 'Section requires TMDB API Key.'}</div>`;
            } else {
              row.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:0.8rem">Failed to load Anime content.</div>';
            }
          }
          return;
        }
        const items = (data.results || []).filter(item => item.adult !== true);
        renderDiscoverRow(selector, items);
        if ((selector === '#trending-row' || selector === '#anime-row') && items.length > 0) {
          addDiscoverHeroItem(items[0]);
        }
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    const fetchCinemetaAndRender = async (selector, type, catalogId) => {
      try {
        const data = await window.api.invoke('cinemeta-catalog', { type, id: catalogId });
        if (!data || !data.metas || data.metas.length === 0) {
          const row = $(selector);
          if (row) row.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:0.8rem">Failed to load from Cinemeta.</div>`;
          return;
        }
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
        renderDiscoverRow(selector, items);
        if ((selector === '#trending-row' || selector === '#trending-series-row') && items.length > 0) {
          addDiscoverHeroItem(items[0]);
        }
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    const fetchCinemetaGenreAndRender = async (selector, genre) => {
      try {
        const data = await window.api.cinemetaDiscoverByGenre(genre);
        if (!data || !data.results || data.results.length === 0) {
          const row = $(selector);
          if (row) row.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:0.8rem">Failed to load from Cinemeta.</div>`;
          return;
        }
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
        renderDiscoverRow(selector, items);
        if (items.length > 0) {
          addDiscoverHeroItem(items[0]);
        }
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    try {
      await Promise.all([
        fetchCinemetaAndRender('#trending-row', 'movie', 'top'),
        fetchCinemetaAndRender('#trending-series-row', 'tv', 'top'),
        fetchCinemetaAndRender('#popular-movies-row', 'movie', 'imdbRating'),
        fetchCinemetaAndRender('#top-rated-row', 'tv', 'imdbRating'),
        fetchCinemetaGenreAndRender('#anime-row', 'Animation'),
        fetchCinemetaAndRender('#upcoming-row', 'movie', 'year')
      ]);

      const hasContent = $('#trending-row')?.querySelector('.discover-card');
      if (!hasContent) {
        setTimeout(() => {
          if (currentView === 'discover' && !isDiscoverLoading) loadDiscover();
        }, 5000);
      }
    } catch (err) {
      console.error("Discover load error:", err);
    } finally {
      isDiscoverLoading = false;
    }
  }

  function renderDiscoverRow(sel, items) {
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

    allowedItems.slice(0, 20).forEach(item => {
      const card = document.createElement('div');
      card.className = 'discover-card';

      const title = item.title || item.name || 'Unknown';
      let posterUrl = item.poster || item.poster_path || '';

      const rating = parseFloat(item.vote_average || item.score) || 0;
      const year = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
      const inLib = localTitles.has(title.toLowerCase());

      card.innerHTML = `
        <div class="discover-poster-wrap">
          <div class="discover-poster-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-2); ${posterUrl ? 'display:none;' : ''}"><i class="fas fa-image fa-2x" style="opacity: 0.3;"></i></div>
          ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy" onerror="this.style.display='none'; const ph=this.parentElement?.querySelector('.discover-poster-placeholder'); if(ph) ph.style.display='flex';">` : ''}
          ${inLib ? '<div class="lib-poster-badge"><i class="fas fa-check-circle"></i> LIB</div>' : ''}
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
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
      row.appendChild(card);
      getTraktOrImdbPoster(item, null, card);
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
    if (grid) grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);grid-column: 1/-1">Searching content...</div>';
    
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
                if (imdbMapping) imdbIdForCinemeta = imdbMapping.attributes.externalId;
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

  async function loadStreams(item, type) {
    const container = $('#dd-streams-list');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px; color:var(--text-muted); text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">Searching for best links...</div>';

    try {
      if (!item.imdb_id || item.imdb_id === 'null') {
        const isAnimeItem = item.source === 'anilist' || item.source === 'mal' || item.source === 'kitsu' || item.source === 'jikan';
        
        if (!isAnimeItem) {
          item.imdb_id = (item.id && String(item.id).startsWith('tt')) ? item.id : null;
          console.log(`[MediaVault] ID resolved for ${type}: ${item.imdb_id}`);
        } else {
          item.imdb_id = null;
        }
      }

      let showMeta = currentShow ? (typeof getMetadataForItem === 'function' ? getMetadataForItem(currentShow) : null) : null;
      let itemMeta = typeof getMetadataForItem === 'function' ? getMetadataForItem(item) : null;
      let resolvedImdb = item.imdb_id || itemMeta?.cinemetaId || itemMeta?.imdbId || itemMeta?.imdb_id || showMeta?.cinemetaId || showMeta?.imdbId || showMeta?.imdb_id || null;

      if (resolvedImdb && (typeof isLocalFilePath === 'function' ? isLocalFilePath(resolvedImdb) : (resolvedImdb.includes('/') || resolvedImdb.includes('\\')))) {
        resolvedImdb = null;
      }

      let streams;
      try {
        const query = {
          imdbId: resolvedImdb || item.imdb_id,
          tmdbId: item.id,
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

      streams.forEach(s => {
        const card = document.createElement('div'); card.className = 'stream-card';
        const isBrowser = s.type === 'browser';
        const isPeario = (s.addon || '').toLowerCase().includes('peario');

        const titleLines = (s.title || '').split('\n');
        let mainTitle = titleLines[0] || '';
        if (isBrowser) {
          // Strip leading/trailing emojis from browser session titles
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

        const vlcIcon = `<div class="stream-btn-vlc" title="Play in VLC"><svg viewBox="0 0 512 512" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M256 32c-19 0-36 12-42 30L96 416h320L298 62c-6-18-23-30-42-30zM64 448l32-64 352 0 32 64H64z"/></svg></div>`;
        const vlcHtml = (window.Capacitor || isBrowser) ? '' : vlcIcon;
        const downloadHtml = isBrowser ? '' : `<div class="stream-btn-download" title="Copy Torrent Link"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div>`;
        
        const playTitle = isBrowser ? 'Open Link' : 'Play Internally';
        const playIcon = isBrowser 
          ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` 
          : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

        card.innerHTML = `<div class="stream-top"><div class="stream-icon-box">${streamIconSvg}</div><div class="stream-main-info"><div class="stream-title" title="${escapeHTML(mainTitle)}">${escapeHTML(mainTitle)}</div><div class="stream-badges">${isBrowser ? '' : `<span class="quality-badge">${s.quality}</span>`}<span class="source-badge">${s.addon}</span></div></div></div><div class="stream-footer"><div class="stream-stats">${seeds ? `<div class="stream-stat-badge seeds">${seedsIcon}${seeds}</div>` : ''}${size ? `<div class="stream-stat-badge size">${sizeIcon}${size}</div>` : ''}</div><div class="stream-actions-group">${downloadHtml}${vlcHtml}<div class="stream-btn-play" title="${playTitle}">${playIcon}</div></div></div>`;

        const vlcBtn = card.querySelector('.stream-btn-vlc');
        if (vlcBtn) vlcBtn.onclick = async (e) => {
          e.stopPropagation();
          let vUrl = s.url || s.infoHash;
          const isMobile = !window.api.isElectron;

          if (vUrl && vUrl.length === 40 && !vUrl.startsWith('http') && !vUrl.startsWith('magnet:')) {
            vUrl = `magnet:?xt=urn:btih:${vUrl}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
          }

          if (isMobile) {
            showToast('Opening in VLC...');
            await window.api.invoke('open-in-vlc', vUrl);
          } else {
            if (s.type === 'torrent' || vUrl.startsWith('magnet:')) {
              showToast('Preparing stream for VLC...');
              try {
                const res = await window.api.invoke('start-torrent-stream', vUrl, s.fileIdx);
                if (res && (res.localUrl || res.url) && !res.error) {
                  vUrl = res.localUrl || res.url;
                }
              } catch (err) {
                console.warn('[VLC] Stream prep failed, using magnet:', err.message);
              }
            }
            const result = await window.api.invoke('open-in-vlc', vUrl);
            if (result && !result.success) showToast(result.error || 'Failed to open VLC');
            else showToast('Opening in VLC...');
          }
        };

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
              showToast('Torrent link copied to clipboard! Paste it in the Downloads tab.');
            } catch (err) {
              showToast('Failed to copy: ' + err.message);
            }
          };
        }
        container.appendChild(card);
      });
    } catch (err) { container.innerHTML = 'Error searching streams.'; }
  }

  async function playStream(stream, meta, cardEl = null) {
    if (meta && typeof isAgeAllowed === 'function' && !isAgeAllowed(meta)) {
      showToast('This content is restricted by age rating filters.');
      return;
    }
    if (cardEl) {
      const iconWrap = cardEl.querySelector('.dd-stream-play-icon');
      if (iconWrap) {
        iconWrap.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        iconWrap.classList.add('loading');
      }
      else if (cardEl.classList.contains('stream-btn-play') || cardEl.classList.contains('stream-btn-vlc')) {
        const svg = cardEl.querySelector('svg');
        if (svg) svg.style.display = 'none';
        
        if (!cardEl.querySelector('.fa-spinner')) {
          const spinner = document.createElement('i');
          spinner.className = 'fas fa-spinner fa-spin';
          spinner.style.fontSize = '16px';
          cardEl.appendChild(spinner);
        }
        cardEl.classList.add('btn-loading');
      }
    }

    if (stream.type === 'browser') {
      window.api.openExternal(stream.url);
      if (cardEl) cardEl.classList.remove('btn-loading');
      return;
    }

    const isMobile = !!(window.Capacitor);

    if (isMobile) {
      let handoffUrl = stream.url || stream.infoHash || '';

      if (handoffUrl && handoffUrl.length === 40 && !handoffUrl.startsWith('http') && !handoffUrl.startsWith('magnet:')) {
        handoffUrl = `magnet:?xt=urn:btih:${handoffUrl}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
      }

      if (!handoffUrl) {
        if (cardEl) cardEl.classList.remove('btn-loading');
        showToast('No playable link found');
        return;
      }

      showToast(`Opening ${stream.addon} in external player...`);
      console.log('[playStream] Mobile external handoff:', handoffUrl);

      const result = await (window.PlayMediaService
        ? window.PlayMediaService.play(handoffUrl, { title: meta?.title || stream.name })
        : window.api.playExternal
          ? window.api.playExternal(handoffUrl, { title: meta?.title || stream.name })
          : window.api.playMedia({ url: handoffUrl, title: meta?.title || stream.name })
      );

      if (cardEl) cardEl.classList.remove('btn-loading');

      if (!result || !result.success) {
        showToast('Failed to open external player: ' + (result?.error || 'Unknown error'));
      } else if (result.streamUrl) {
        console.log('[playStream] Launching intent for streamUrl:', result.streamUrl);
        try {
          await window.api.invoke('open-external-url', result.streamUrl);
        } catch (e) {
          window.open(result.streamUrl, '_system');
        }
      }
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

          const res = await window.api.invoke('start-torrent-stream', stream.url || stream.infoHash, stream.fileIdx);
          if (!res || !res.success) throw new Error(res?.error || 'Failed to start torrent stream');

          finalUrl = (window.api.isElectron) ? (res.localUrl || res.url) : res.url;
          if (res.files) meta.torrentFiles = res.files;
          if (res.infoHash) meta.torrentMagnet = stream.url || stream.infoHash;
          if (res.duration) meta.duration = res.duration;
          meta.fileIdx = stream.fileIdx ?? res.fileIdx;
        }
      }

      if (stream.type === 'torrent') {
        try { showToast('Torrent stream started — buffering...'); } catch (e) { }
      }

      if (!finalUrl) throw new Error('No playable stream found');

      if (typeof playVideo === 'function') {
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
          showName: meta?.showName,
          type: meta ? (meta.media_type || meta.type || (meta.title ? 'movie' : 'tv')) : 'movie',
          season: meta?.season,
          episode: meta?.episode,
          showId: meta?.showId || meta?.id,
          isStream: true
        }, meta?.showName ? { title: meta.showName, id: meta.showId || meta.id } : null);
      }
    } catch (err) {
      console.error('[playStream] Error:', err);
      showToast('Streaming failed: ' + err.message);
    } finally {
      if (cardEl) cardEl.classList.remove('btn-loading');
    }
  }

  // Search input event listener
  $('#search-discover')?.addEventListener('input', debounce(async () => {
    await performDiscoverSearch();
  }, 500));

  // Expose discover/anime functions to window
  window.loadDiscover = loadDiscover;
  window.renderDiscoverRow = renderDiscoverRow;
  window.performDiscoverSearch = performDiscoverSearch;
  window.openDiscoverDetail = openDiscoverDetail;
  window.renderCinemetaEpisodes = renderCinemetaEpisodes;
  window.loadStreams = loadStreams;
  window.playStream = playStream;
  window.clearContinueWatching = clearContinueWatching;
  window.renderContinueWatchingDiscover = renderContinueWatchingDiscover;

})();
