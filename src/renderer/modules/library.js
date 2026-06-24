(function () {
  'use strict';

  let currentTmdbFolderType = 'tv';
  let metaSearchTarget = null;

  let __isScanning = false;

  async function scanLibrary() {
    if (__isScanning) return; // prevent concurrent/redundant scans
    __isScanning = true;
    const btn = $('#btn-rescan');
    if (btn) btn.disabled = true;
    showToast('Scanning library...');
    const allMovies = [], allShows = [], allMusic = [];

    // 1. Scan user-added library folders
    const foldersToScan = [...(appData.libraryFolders || [])];

    // On mobile, also scan common system folders if they aren't already included
    if (window.api && window.api.isMobile && window.api.isMobile()) {
      try {
        const commonPaths = await window.api.invoke('get-common-paths');
        if (commonPaths) {
          commonPaths.forEach(p => {
            if (!foldersToScan.includes(p)) foldersToScan.push(p);
          });
        }
      } catch (e) { console.warn('Failed to get common paths:', e); }
    }

    for (const folder of foldersToScan) {
      try {
        const { movies, shows } = await window.api.scanLibrary(folder);
        allMovies.push(...movies); allShows.push(...shows);
      } catch (e) { console.error('Scan error:', e); }

      // Check for music inside custom folders
      try {
        const folderLower = folder.toLowerCase().replace(/\\/g, '/');
        let musicPath = null;
        if (folderLower.endsWith('/music') || folderLower === 'music') {
          musicPath = folder;
        } else {
          const sep = folder.endsWith('\\') || folder.endsWith('/') ? '' : '/';
          const possiblePaths = [folder + sep + 'Music', folder + sep + 'music'];
          for (const p of possiblePaths) {
            const exists = await window.api.invoke('dir-exists', p).catch(() => false);
            if (exists) {
              musicPath = p;
              break;
            }
          }
        }
        if (musicPath) {
          const musicData = await window.api.invoke('scan-music', musicPath, false);
          if (musicData && musicData.length > 0) {
            musicData.forEach(item => {
              if (!allMusic.some(m => m.path === item.path)) {
                allMusic.push(item);
              }
            });
          }
        }
      } catch (e) {
        console.error('[SCAN] Music scanning inside library folder failed:', e);
      }
    }

    // 2. Scan Profile-specific organized folders
    if (currentProfile) {
      const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
      if (pPaths) {
        // Movies
        try { const { movies } = await window.api.scanLibrary(pPaths.movies); allMovies.push(...movies); } catch (e) { }
        // Series
        try { const { shows } = await window.api.scanLibrary(pPaths.series); allShows.push(...shows); } catch (e) { }
        // Social
        try {
          let socialVids = [];
          try {
            socialVids = await window.api.scanYoutube(pPaths.social);
          } catch (e) {
            console.warn('[SCAN] Social scan failed:', e);
          }
          if (socialVids) appData.socialVideos = socialVids;
        } catch (e) { console.error('[SCAN] Social scan error:', e); }
        // Music
        try {
          const musicData = await window.api.invoke('scan-music', pPaths.music, true);
          if (musicData) {
            musicData.forEach(item => {
              if (!allMusic.some(m => m.path === item.path)) {
                allMusic.push(item);
              }
            });
          }
        } catch (e) { console.error('[SCAN] Music scan error:', e); }
      }
    }

    appData.movies = allMovies; appData.shows = allShows; appData.music = allMusic;

    // Scan the legacy dedicated YouTube folder if it exists
    if (appData.youtubeFolder) {
      try {
        let ytVideos = [];
        try {
          ytVideos = await window.api.scanYoutube(appData.youtubeFolder);
        } catch (e) {
          console.warn('[SCAN] YT scan failed:', e);
        }
        appData.youtubeVideos = ytVideos;
      } catch (e) { console.error('YouTube Scan error:', e); }
    }

    persist();
    if (typeof renderLibrary === 'function') renderLibrary();
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof renderSocial === 'function') renderSocial();

    if (btn) btn.disabled = false;
    showToast(`Scan complete: ${allMovies.length} movies, ${allShows.length} shows found`);
    autoMatchMetadata();
    __isScanning = false;
  }

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
          await new Promise(r => setTimeout(r, 100));
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
    if (matched > 0) {
      persist();
      if (typeof renderLibrary === 'function') renderLibrary();
      showToast(`Matched ${matched} items`);
    }
  }

  function renderLibrary() {
    if (typeof renderMovies === 'function') renderMovies();
    if (typeof renderShows === 'function') renderShows();
    if (typeof renderLibContinueWatching === 'function') renderLibContinueWatching();
    if (typeof renderLibContinueListening === 'function') renderLibContinueListening();
    if (typeof renderLibRecentWatchlist === 'function') renderLibRecentWatchlist();
    if (typeof renderLibCustomLists === 'function') renderLibCustomLists();
    if (typeof updateBadges === 'function') updateBadges();

    // Handle My Space Dashboard Empty State
    const hasContent = (appData.movies?.length > 0) || (appData.shows?.length > 0) || (appData.music?.length > 0) || (currentProfile?.watchlist?.length > 0) || (currentProfile?.custom_lists?.length > 0);
    const emptyState = $('#myspace-empty-state');
    if (emptyState) emptyState.style.display = hasContent ? 'none' : 'block';

    const hero = $('#myspace-hero');
    if (hero) hero.style.display = hasContent ? 'block' : 'none';

    if (window.socialPresence && typeof window.socialPresence.renderPlaybackPins === 'function') {
      window.socialPresence.renderPlaybackPins('#view-myspace');
      window.socialPresence.renderPlaybackPins('#view-library');
    }
  }

  function openTmdbSearchModal(item) {
    metaSearchTarget = item;
    const input = $('#tmdb-search-input');
    if (input) input.value = item.cleanTitle || item.title || '';
    const results = $('#tmdb-search-results');
    if (results) results.innerHTML = '';
    $('#tmdb-modal').style.display = 'flex';
    setTimeout(() => { const inp = $('#tmdb-search-input'); if (inp) inp.focus(); }, 50);
    performMetaSearch();
  }

  async function performMetaSearch() {
    const q = $('#tmdb-search-input').value.trim(); if (!q) { $('#tmdb-search-results').innerHTML = ''; return; }
    const el = $('#tmdb-search-results'); el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Searching…</div>';
    try {
      const searchRes = await window.api.invoke('cinemeta-search', q);
      const all = (searchRes.results || []).slice(0, 10);
      if (!all.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No results</div>'; return; }
      el.innerHTML = '';
      all.forEach(r => { 
        const e = document.createElement('div'); e.className = 'tmdb-result-item'; 
        const t = r.title || r.name; 
        const y = (r.releaseInfo || r.year || '').toString().slice(0, 4); 
        const p = r.poster || ''; 
        e.innerHTML = `
          ${p ? `<img class="tmdb-result-poster" src="${p}" onerror="this.src='imgs/poster-placeholder.png'">` : `<div class="tmdb-result-poster" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03)"><i class="fas fa-film" style="opacity:0.2"></i></div>`}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title" title="${escapeHTML(t)}">${escapeHTML(t)}</div>
            <div class="tmdb-result-meta-row">
              <span>${y || 'N/A'}</span>
              <span class="tmdb-result-type-pill">${r.type || 'movie'}</span>
            </div>
          </div>
        `; 
        e.onclick = () => linkMetaResult(r); 
        el.appendChild(e); 
      });
    } catch (err) { el.innerHTML = `<div style="padding:20px;text-align:center;color:#EF4444">Error: ${escapeHTML(err.message)}</div>`; }
  }

  async function linkMetaResult(result) {
    if (!metaSearchTarget) return;
    const cache = appData.tmdbCache = appData.tmdbCache || {};
    cache[metaSearchTarget.id] = { tmdbId: result.id, type: result.type, title: result.title || result.name, posterPath: result.poster, backdropPath: result.background, rating: result.imdbRating, year: (result.releaseInfo || result.year || '').toString().slice(0, 4) };
    if (result.poster) {
      // Download image in background without blocking
      window.api.downloadImage(result.poster, metaSearchTarget.id, true).then(lp => {
        if (lp) {
          appData.banners[metaSearchTarget.id] = lp;
          bumpBannerRevision(metaSearchTarget.id);
          persist();
        }
      });
    }
    persist();
    if (typeof renderLibrary === 'function') renderLibrary();
    $('#tmdb-modal').style.display = 'none';
    showToast(`Linked to "${result.title || result.name}"`);
  }

  async function moveNewMovieDialog() {
    const filePaths = await window.api.invoke('select-files');
    if (!filePaths || filePaths.length === 0) return;

    if (!currentProfile) { showToast('Please select a profile first'); return; }
    const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
    const moviesDir = pPaths.movies;

    let movedCount = 0;
    for (const src of filePaths) {
      const fileName = src.split(/[/\\]/).pop();
      const dest = moviesDir + '/' + fileName;
      const res = await window.api.invoke('move-file', { src, dest });
      if (res.success) movedCount++;
    }

    if (movedCount > 0) {
      showToast(`Moved ${movedCount} movie${movedCount > 1 ? 's' : ''} successfully!`);
      scanLibrary();
    } else {
      showToast('No files were moved');
    }
  }

  async function moveNewEpisodeDialog(showId, seasonNum) {
    const filePaths = await window.api.invoke('select-files');
    if (!filePaths || filePaths.length === 0) return;

    const targetDir = showId + (seasonNum ? `/Season ${seasonNum}` : '');

    let movedCount = 0;
    for (const src of filePaths) {
      const fileName = src.split(/[/\\]/).pop();
      const dest = targetDir + '/' + fileName;
      const res = await window.api.invoke('move-file', { src, dest });
      if (res.success) movedCount++;
    }

    if (movedCount > 0) {
      showToast(`Moved ${movedCount} episode${movedCount > 1 ? 's' : ''} to Season ${seasonNum}`);
      scanLibrary();
      setTimeout(() => { if (currentShow && typeof openShowDetail === 'function') openShowDetail(currentShow, currentPart); }, 1000);
    }
  }

  function createSeriesFolderDialog() {
    currentTmdbFolderType = 'tv';
    $('#tmdb-folder-title').textContent = 'Create Series Folder';
    $('#tmdb-folder-search').value = '';
    $('#tmdb-folder-search').placeholder = 'Search for content...';
    $('#tmdb-folder-results').innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 350px; opacity: 0.4;">
        <i class="fas fa-search-plus" style="font-size: 4rem; margin-bottom: 20px; color: var(--accent);"></i>
        <div style="font-size: 1.5rem; font-weight: 700; color: #fff;">Start your search</div>
        <div style="font-size: 1rem; margin-top: 10px;">Find the perfect content for your folder</div>
      </div>
    `;
    $('#modal-tmdb-folder').style.display = 'flex';
    $('#tmdb-folder-search').focus();
  }

  function createMovieFolderDialog() {
    currentTmdbFolderType = 'movie';
    $('#tmdb-folder-title').textContent = 'Create Movie Folder';
    $('#tmdb-folder-search').value = '';
    $('#tmdb-folder-search').placeholder = 'Search for content...';
    $('#tmdb-folder-results').innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 350px; opacity: 0.4;">
        <i class="fas fa-search-plus" style="font-size: 4rem; margin-bottom: 20px; color: var(--accent);"></i>
        <div style="font-size: 1.5rem; font-weight: 700; color: #fff;">Start your search</div>
        <div style="font-size: 1rem; margin-top: 10px;">Find the perfect content for your folder</div>
      </div>
    `;
    $('#modal-tmdb-folder').style.display = 'flex';
    $('#tmdb-folder-search').focus();
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Bind key functions to window
  window.scanLibrary = scanLibrary;
  window.autoMatchMetadata = autoMatchMetadata;
  window.renderLibrary = renderLibrary;
  window.openTmdbSearchModal = openTmdbSearchModal;
  window.performMetaSearch = performMetaSearch;
  window.linkMetaResult = linkMetaResult;
  window.moveNewMovieDialog = moveNewMovieDialog;
  window.moveNewEpisodeDialog = moveNewEpisodeDialog;
  window.createSeriesFolderDialog = createSeriesFolderDialog;
  window.createMovieFolderDialog = createMovieFolderDialog;

  // Add the search listener inside IIFE
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
            <img src="${item.image}" onerror="this.src='imgs/poster-placeholder.png'; this.style.opacity='0.3';" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.6; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);">
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

})();
