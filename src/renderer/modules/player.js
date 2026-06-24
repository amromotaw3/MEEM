(function () {
  'use strict';

  const video = $('#video-element');

  function getPlaybackKey(item) {
    if (!item) return '';
    // Stable identifier so Torrents/Streams (which change path URL) don't lose progress
    const baseKey = item.tmdbId || item.id || item.path;
    const type = item.type || item.media_type || (item.format === 'MOVIE' ? 'movie' : (item.format ? 'anime' : (item.title ? 'movie' : 'tv')));
    
    if (type === 'movie' || type === 'character' || type === 'actor') {
        return baseKey;
    }
    
    // For series and anime
    if (item.episode !== undefined) {
        if (item.season !== undefined && item.season !== null && item.season !== '') {
            return `${baseKey}_S${item.season}E${item.episode}`;
        }
        return `${baseKey}_E${item.episode}`;
    }
    return baseKey;
  }

  function togglePlayerMode(mode) {
    const musicPoster = $('#music-poster-container');
    const videoEl = $('#video-element');
    const btnArt = $('#btn-player-art');
    const btnVideo = $('#btn-player-video');
    const playerControls = $('#player-controls');

    if (mode === 'art') {
      if (musicPoster) {
        musicPoster.style.display = 'flex';
        setTimeout(() => musicPoster.classList.add('active'), 10);
      }
      if (videoEl) videoEl.style.visibility = 'visible';
      if (playerControls) playerControls.style.display = 'none';
      if (btnArt) btnArt.classList.add('active');
      if (btnVideo) btnVideo.classList.remove('active');
      if (typeof renderMusicPlayerPlaylist === 'function') renderMusicPlayerPlaylist();
    } else {
      if (musicPoster) {
        musicPoster.classList.remove('active');
        setTimeout(() => musicPoster.style.display = 'none', 600);
      }
      if (videoEl) videoEl.style.visibility = 'visible';
      if (playerControls) playerControls.style.display = 'block';
      if (btnArt) btnArt.classList.remove('active');
      if (btnVideo) btnVideo.classList.add('active');
    }
  }

  function renderMusicPlayerPlaylist() {
    const container = $('#music-player-playlist');
    if (!container) return;

    let playlistSource = [];
    let headerText = 'Playlist';

    if (currentItem) {
      if (currentItem.isSocial || currentItem.type === 'social') {
        playlistSource = [...(appData.socialVideos || [])];
        headerText = 'Social Media';
      } else {
        playlistSource = [...(appData.music || [])];
        headerText = 'Music Library';
      }

      // Ensure current playing item is in the list so it can be shown and selected
      const exists = playlistSource.some(m => m.id === currentItem.id || m.path === currentItem.path);
      if (!exists) {
        playlistSource.unshift(currentItem);
      }
    } else {
      playlistSource = [...(appData.music || [])];
      headerText = 'Music Library';
    }

    if (playlistSource.length === 0) {
      container.innerHTML = `<div style="color:rgba(255,255,255,0.5);text-align:center;padding:40px 0;">No other songs available</div>`;
      return;
    }

    let html = `<div class="music-playlist-header"><i class="fas fa-list-ul" style="color:var(--accent)"></i> ${headerText} (${playlistSource.length})</div>`;

    playlistSource.forEach(item => {
      const { title, artist, cover } = getMusicMeta(item);
      const isActive = currentItem && (currentItem.id === item.id || currentItem.path === item.path);
      const imgHtml = cover ? `<img src="${localImg(cover)}" class="music-playlist-item-img">` : `<div class="music-playlist-item-img" style="background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);"><i class="fas fa-music"></i></div>`;

      html += `
        <div class="music-playlist-item ${isActive ? 'active' : ''}" data-id="${item.id || item.path}" data-path="${item.path}">
          ${imgHtml}
          <div class="music-playlist-item-info">
            <div class="music-playlist-item-title">${escapeHTML(title)}</div>
            <div class="music-playlist-item-artist">${escapeHTML(artist)}</div>
          </div>
          ${isActive ? `<div style="color:var(--accent)"><i class="fas fa-volume-up"></i></div>` : ''}
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.music-playlist-item').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const targetId = el.dataset.id;
        const targetPath = el.dataset.path;
        const targetItem = playlistSource.find(m => m.id === targetId || m.path === targetPath);
        if (targetItem) {
          playMusic(targetItem);
        }
      };
    });
  }

  // ── Video Player ──
  async function playVideo(item, show, extra = {}) {
    if (!isAgeAllowed(item) || (show && !isAgeAllowed(show))) {
      showToast('This content is restricted by age rating filters.');
      return;
    }
    if (item?.path && isStaleStreamUrl(item.path) && !item.torrentMagnet) {
      const resolved = findLibraryItemForPlayback(item);
      if (resolved.item?.path && isLocalFilePath(resolved.item.path)) {
        item = { ...item, ...resolved.item, path: resolved.item.path };
        show = show || resolved.show;
      }
    }

    // Refresh stale torrent stream URLs before playing (Electron only)
    if (window.api?.isElectron && item?.torrentMagnet && (!item.path || isStaleStreamUrl(item.path))) {
      try {
        showToast('Resuming torrent stream...');
        const res = await window.api.invoke('start-torrent-stream', item.torrentMagnet, item.fileIdx ?? null);
        if (res && res.success) {
          const newUrl = res.localUrl || res.url;
          item.path = newUrl;
          item.url = newUrl;
          item.torrentFiles = res.files;
          if (res.fileIdx != null) item.fileIdx = res.fileIdx;
        } else {
          showToast('Failed to resume torrent stream: ' + (res?.error || 'Unknown error'));
          return;
        }
      } catch (err) {
        showToast('Failed to resume torrent stream: ' + err.message);
        return;
      }
    }

    const isMobile = !!(window.Capacitor);
    const useNativeDesktop = !isMobile && window.api?.isElectron && !isNativePlayerWindow();
    if (useNativeDesktop) {
      const res = await requestNativePlayback(item, show);
      if (res?.success !== false) return;
      showToast('Failed to open native player' + (res?.error ? ': ' + res.error : ''));
      return;
    }

    if (isMobile) {
      console.log('[playVideo] Mobile detected, forcing external player:', item.path);
      // We still want to save progress eventually, but without an internal player 
      // reporting back, we just mark it as "started" for now.
      const pbKey = getPlaybackKey(item);
      if (currentProfile) {
        if (!currentProfile.playback) currentProfile.playback = {};
        currentProfile.playback[pbKey] = {
          ...(currentProfile.playback[pbKey] || {}),
          lastWatched: Date.now(),
          meta: item
        };
        persist();
      }

      window.api.openInExternalPlayer(item.path || item.id);
      showToast('Opening in External Player...');
      return;
    }

    if (currentItem) {
      await exitPlayer(false, true);
    }

    playerSubCurrentDir = ''; // Reset subtitle folder navigation
    window.activeSubtitleUrl = null; // Clear active remote subtitle track
    document.body.classList.add('playing-mode');
    currentItem = item;

    // AUTO-METADATA: If local file and no metadata found in cache/library, try matching it
    const isLocal = item.path && !item.path.startsWith('http') && !item.path.startsWith('local-file') && !item.tmdbId && !item.id?.includes('kitsu');
    if (isLocal && !show && window.api && window.api.isElectron) {
      const pbKey = getPlaybackKey(item);
      const tmdbCache = appData.tmdbCache || {};
      if (!tmdbCache[pbKey]) {
        console.log('[playVideo] Triggering auto-metadata resolution for:', item.path);
        window.api.invoke('resolve-local-metadata', item.path).then(meta => {
          if (meta) {
            appData.tmdbCache = appData.tmdbCache || {};
            appData.tmdbCache[pbKey] = {
              ...meta,
              posterPath: meta.poster_path,
              backdropPath: meta.backdrop_path,
              tmdbId: meta.id
            };
            if (currentView === 'discover') renderContinueWatchingDiscover();
            
            // Enrich running currentItem with resolved metadata & re-trigger subtitles fetch
            if (currentItem && getPlaybackKey(currentItem) === pbKey) {
              currentItem.imdb_id = meta.imdb_id || meta.imdbId;
              currentItem.imdbId = meta.imdb_id || meta.imdbId;
              if (meta.season !== undefined) currentItem.season = meta.season;
              if (meta.episode !== undefined) currentItem.episode = meta.episode;
              if (meta.season_number !== undefined) currentItem.season_number = meta.season_number;
              if (meta.episode_number !== undefined) currentItem.episode_number = meta.episode_number;
              
              console.log('[playVideo] Local metadata resolved, re-fetching subtitles reactive...');
              fetchAndRenderManagedSubtitles();
            }
          }
        });
      }
    }

    // Show detected audio/subtitle hints (from stream metadata) so user knows they're available
    if (item && item.detected) {
      const d = item.detected;
      const a = (d.audio && d.audio.length) ? `Audio: ${d.audio.join(', ')}` : '';
      const s = d.hasSubs ? (d.subs && d.subs.length ? `Subs: ${d.subs.join(', ')}` : 'Subs: Yes') : 'Subs: No';
      console.log('[playVideo] Detected tracks:', d);
      showToast(`${a} ${s}`.trim());
    }
    // Auto-resolve show if it's an episode but show is missing
    if (!show && (item.season !== undefined || item.episode !== undefined)) {
      show = (appData.shows || []).find(s => (s.episodes || []).some(e => getPlaybackKey(e) === getPlaybackKey(item)));
    }

    if (show) {
      currentShow = show;
      currentShowId = show.id;
      currentEpisodes = show.episodes || [];
      currentEpisodeIndex = currentEpisodes.findIndex(e => getPlaybackKey(e) === getPlaybackKey(item));
      const showMetaForPlayback = getMetadataForItem(show);
      const resolvedImdbId = show.imdb_id || show.imdbId || show.cinemetaId || showMetaForPlayback?.imdb_id || showMetaForPlayback?.cinemetaId;
      if (resolvedImdbId && String(resolvedImdbId).startsWith('tt')) {
        currentItem.imdb_id = resolvedImdbId;
        currentItem.imdbId = resolvedImdbId;
      }
    } else if (item.season !== undefined && currentShow) {
      currentEpisodeIndex = currentEpisodes.findIndex(e => getPlaybackKey(e) === getPlaybackKey(item));
    } else {
      currentShow = null;
      currentEpisodes = [];
      currentEpisodeIndex = -1;
    }

    switchView('player');
    const playerContainer = $('#player-container');
    if (playerContainer) playerContainer.style.display = '';
    const viewPlayer = $('#view-player');
    if (viewPlayer && viewPlayer.style.display === 'none') viewPlayer.style.display = '';

    // Enrich Episode Metadata for Header
    let displayTitle = cleanTechnicalTitle(item.title);
    if (show) {
      const tmdb = (appData.tmdbCache || {})[show.id];
      const sn = item.season || 1;
      const tmdbEps = (tmdb && tmdb.seasons && tmdb.seasons[sn]) ? tmdb.seasons[sn] : {};
      const epNum = parseInt(item.episode);
      const tE = tmdbEps[epNum] || tmdbEps[String(item.episode)];

      if (tE?.name) {
        displayTitle = `S${String(sn).padStart(2, '0')}E${String(item.episode).padStart(2, '0')} · ${tE.name}`;
      } else if (!isNaN(epNum)) {
        // Fallback for valid episode numbers even if name is missing from TMDB cache
        displayTitle = `S${String(sn).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
      }
    }

    $('#player-title').textContent = displayTitle;
    currentItem.displayTitle = displayTitle; // Store for mini-player usage
    $('#player-show-name').textContent = show?.title || '';
    $('#player-loading').style.display = 'flex';
    // Hide overlay when entering player view
    if (typeof window.closeUnifiedDetail === 'function') {
      window.closeUnifiedDetail(true);
    }
    $('#player-progress-text').textContent = '';
    $('#player-speed-text').textContent = '';
    // Reset circular loader to spinner mode (not torrent progress)
    const circLoader = document.querySelector('.circular-loader');
    if (circLoader) circLoader.classList.remove('torrent-mode');
    const loaderFill = document.getElementById('loader-progress');
    if (loaderFill) loaderFill.style.strokeDashoffset = '263.89';
    const loaderPct = document.getElementById('loader-percent');
    if (loaderPct) loaderPct.textContent = '';
    const playerErr = document.getElementById('player-error-overlay');
    if (playerErr) playerErr.style.display = 'none';

    // Codec Warning for high-end audio
    if (item.title.match(/atmos|truehd|dts|remux/i)) {
      showToast("Note: This file has high-end audio that may not play in-app. Try downloading it.");
    }

    // Hide playlist button for YouTube/Streams or standalone movies
    const isYT = item.isYoutube || item.type === 'youtube' || item.type === 'stream';
    const isPack = !!(item.torrentFiles && item.torrentFiles.length > 1);
    const isMovie = !currentEpisodes || currentEpisodes.length <= 1;

    $('#btn-toggle-playlist').style.display = (isYT || (isMovie && !isPack)) ? 'none' : 'flex';
    if (isYT || (isMovie && !isPack)) closeSidePanel();

    // Music Mode Handling
    const playerWrapper = $('#player-wrapper');
    const playerMusicToggle = $('#player-music-toggle');
    const musicPoster = $('#music-poster-container');
    const musicPosterImg = $('#music-poster-img');
    const musicPosterBg = $('#music-poster-bg');

    const isAudioFile = (p) => {
      if (!p) return false;
      const ext = p.substring(p.lastIndexOf('.')).toLowerCase();
      return ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma'].includes(ext);
    };
    isPlayingMusic = !!(item.isVideoMusic || item.type === 'music' || isAudioFile(item.path));
    if (isPlayingMusic && !item.type) {
      item.type = 'music';
    }
    playerWrapper.classList.remove('is-music-mode');
    if (playerMusicToggle) playerMusicToggle.style.display = 'none';

    if (isPlayingMusic) {
      const { title, artist } = getMusicMeta(item);
      $('#music-title').textContent = title;
      $('#music-artist').textContent = artist;
      togglePlayerMode('art');
    } else {
      if (musicPoster) musicPoster.style.display = 'none';
      togglePlayerMode('video');
      $('#video-element').style.visibility = 'visible';
    }

    video.querySelectorAll('track').forEach(t => t.remove());
    try { removeSubtitleOverlay(); } catch (e) { }
    subtitleTrack = null; subtitlesEnabled = false; $('#btn-subtitle').classList.remove('subtitle-on'); $('#btn-subtitle').classList.add('subtitle-off');

    $('#btn-player-art').onclick = () => togglePlayerMode('art');
    $('#btn-player-video').onclick = () => togglePlayerMode('video');

    // Music Cluster Events
    $('#music-btn-play-pause').onclick = () => engine.togglePause();
    $('#music-btn-prev').onclick = playPrevMusic;
    $('#music-btn-next').onclick = playNextMusic;

    const mSeekBar = $('#music-seek-bar');
    let mLastSeekTime = 0;
    let mSeekThrottleTimeout = null;

    function applyMusicSeekThrottled(targetTime) {
      if (Date.now() - mLastSeekTime > 150) {
        mLastSeekTime = Date.now();
        engine.seek(targetTime);
      } else {
        clearTimeout(mSeekThrottleTimeout);
        mSeekThrottleTimeout = setTimeout(() => {
          mLastSeekTime = Date.now();
          engine.seek(targetTime);
        }, 150);
      }
    }

    if (mSeekBar) {
      mSeekBar.onmousedown = () => { isSeeking = true; };
      mSeekBar.oninput = () => {
        const dur = engine.duration;
        if (!dur || isNaN(dur)) return;
        isSeeking = true;
        const val = parseFloat(mSeekBar.value) || 0;
        const targetTime = (val / 1000) * dur;

        // Instant Visual Feedback
        updateSeekFill((val / 1000) * 100);
        updateTimeDisplay(targetTime);

        // Throttled Seek
        if (!isNaN(targetTime)) applyMusicSeekThrottled(targetTime);
      };
      mSeekBar.onmouseup = mSeekBar.ontouchend = () => {
        const dur = engine.duration;
        if (dur && !isNaN(dur)) {
          const val = parseFloat(mSeekBar.value) || 0;
          const targetTime = (val / 1000) * dur;
          if (!isNaN(targetTime)) engine.seek(targetTime);
        }
        setTimeout(() => { isSeeking = false; }, 500);
      };
    }
    // Set Discord RPC
    let subtitle = currentShow ? `${currentShow.title} - S${item.season}E${item.episode}` : '';
    if (window.api.updateDiscordActivity) {
      window.api.updateDiscordActivity({ type: 'playing', title: cleanTechnicalTitle(item.title), subtitle });
    }

    // Handle file paths with special characters properly
    let pathUrl = item.path || item.url || item.streamUrl || item.mediaUrl || item.sourceUrl;
    if (!pathUrl && item.id && isLocalFilePath(item.id)) {
      pathUrl = item.id;
    }
    if (!pathUrl && item.id && /[\\\/]/.test(item.id)) {
      pathUrl = item.id;
    }
    if (!pathUrl && item.tmdbId && item.type === 'music' && appData.music) {
      const track = (appData.music || []).find(m => m.tmdbId === item.tmdbId || m.id === item.id);
      if (track) pathUrl = track.path;
    }

    if (!pathUrl) {
      const resolvedImdb = item.imdb_id || item.imdbId || (item.id && String(item.id).startsWith('tt') ? item.id : null);
      if (item.tmdbId || resolvedImdb || item.id) {
        console.log('[playVideo] No local path found, redirecting to Discover Details to choose a stream:', item);
        const detailItem = {
          ...item,
          id: item.id || resolvedImdb || item.tmdbId,
          imdb_id: resolvedImdb,
          media_type: item.type === 'show' ? 'tv' : 'movie'
        };
        if (typeof openDiscoverDetail === 'function') {
          $('#player-loading').style.display = 'none';
          openDiscoverDetail(detailItem);
          showToast('Redirecting to choose a streaming link...');
          return;
        }
      }

      console.error('[playVideo] Missing item path for playback:', item);
      showToast('Playback failed: missing source path');
      $('#player-loading').style.display = 'none';
      return;
    }

    // RESET PLAYER STATE FOR NEW ITEM
    window.activeSubtitlePath = null;
    currentAudioTrackIndex = -1;
    currentInternalSubIndex = -1;
    subtitlesEnabled = false;
    $('#btn-subtitle').classList.remove('subtitle-on');
    $('#btn-subtitle').classList.add('subtitle-off');
    video.querySelectorAll('track').forEach(t => t.remove());
    try { removeSubtitleOverlay(); } catch (e) { }

    // CRITICAL: Ensure old video stream is completely detached before loading new one
    // This prevents the renderer from keeping a lock on the old stream URL
    await new Promise(resolve => {
      if (engine._video && engine._video.src) {
        console.log('[playVideo] Detaching old video stream...');
        try {
          engine._video.pause();
          engine._video.removeAttribute('src');
          engine._video.load();
        } catch (e) { console.warn('[playVideo] Error detaching old stream:', e.message); }
        // Wait 200ms for the browser to fully release the old stream
        setTimeout(resolve, 200);
      } else {
        resolve();
      }
    });

    // Defensive Mini-player Reset
    const btnPlayPause = $('#mp-btn-play-pause');
    if (btnPlayPause) btnPlayPause.style.display = 'flex';
    $('#mp-info-click').style.cursor = 'pointer';

    const engineMsg = engine.isUsingMpv ? 'mpv Engine' : 'HTML5 Fallback';
    $('#player-progress-text').textContent = `Loading via ${engineMsg}...`;

    // Resolve duration from TMDB or metadata for accurate seeking
    let knownDur = 0;
    try {
      const cache = appData.tmdbCache[item.tmdbId || item.id] || {};
      if (cache.runtime) knownDur = cache.runtime * 60;
      else if (item.runtime) knownDur = item.runtime * 60;
      else if (item.duration) knownDur = item.duration;
    } catch (e) { }

    // Restore progress — try primary key, then fallbacks (path or meta match)
    const pbKey = getPlaybackKey(item);
    let pb = currentProfile?.playback?.[pbKey];
    // Fallback: try to find by matching stored meta.path, meta.id, or IMDb ID if key lookup failed
    if (!pb && currentProfile?.playback) {
      try {
        const entries = Object.values(currentProfile.playback || {});
        const match = entries.find(e => {
          if (!e.meta) return false;
          if (e.meta.path && item.path && e.meta.path === item.path) return true;
          if (e.meta.id && item.id && e.meta.id === item.id) return true;

          // Support matching IMDb ID fallback (highly critical for Trakt synced entries)
          const eImdb = e.meta.imdb_id || e.meta.imdbId || (String(e.meta.id).startsWith('tt') ? e.meta.id : null);
          const iImdb = item.imdb_id || item.imdbId || (String(item.id).startsWith('tt') ? item.id : null);
          if (eImdb && iImdb && eImdb === iImdb) {
            const eType = e.meta.type;
            const iType = item.type;
            const isSeries = eType === 'series' || eType === 'tv' || iType === 'series' || iType === 'tv' || e.meta.season !== undefined || item.season !== undefined;
            if (isSeries) {
              return String(e.meta.season) === String(item.season) && String(e.meta.episode) === String(item.episode);
            }
            return true;
          }
          return false;
        });
        if (match) {
          pb = match;
          console.log('[RESUME] Found playback entry by meta/IMDb match for', item.title || item.path);
        }
      } catch (e) { console.warn('[RESUME] fallback lookup failed', e); }
    }

    let startTime = extra.startTime;
    if (startTime === undefined) {
      if (pb && pb.time > 2) {
        startTime = pb.time;
      } else {
        startTime = 0;
        // Attempt Trakt lookup if connected as a fallback/support
        try {
          const creds = await window.api.invoke('trakt-connection-status');
          if (creds && creds.connected) {
            console.log('[RESUME] Attempting Trakt playback progress fallback lookup...');
            const traktProgress = await window.api.invoke('trakt-playback-progress');
            if (traktProgress && Array.isArray(traktProgress)) {
              const cache = (appData.tmdbCache || {})[pbKey] || {};
              const imdbId = item.id || item.imdbId || item.imdb_id || cache.imdb_id || cache.imdbId;
              
              if (imdbId && String(imdbId).startsWith('tt')) {
                const match = traktProgress.find(tp => {
                  const type = tp.type;
                  const detail = tp[type];
                  if (!detail) return false;
                  if (type === 'movie') {
                    return detail.ids?.imdb === imdbId;
                  } else {
                    const isEpMatch = tp.show?.ids?.imdb === imdbId;
                    const matchSeason = item.season !== undefined ? (detail.season === parseInt(item.season)) : true;
                    const matchEpisode = item.episode !== undefined ? (detail.number === parseInt(item.episode)) : true;
                    return isEpMatch && matchSeason && matchEpisode;
                  }
                });

                if (match) {
                  const dur = knownDur || (item.type === 'movie' ? 7200 : 2700);
                  const computedTime = (match.progress / 100) * dur;
                  startTime = computedTime;
                  console.log(`[RESUME] Found playback progress on Trakt: ${match.progress}% (${formatTime(startTime)})`);
                  showToast(`Resuming from Trakt: ${match.progress.toFixed(0)}%`);
                }
              }
            }
          }
        } catch (traktErr) {
          console.warn('[RESUME] Trakt progress fallback fetch failed:', traktErr.message);
        }
      }
    }

    // ─── Android: INTERNAL PLAYER via Local HTTP Server ───
    // On mobile, local files are served via http://localhost:8976 to bypass
    // Android's file:// CORS restrictions. HTTP streams are passed directly.
    // Magnets are handed off to the OS (not a player concern).
    let finalUrl = pathUrl;
    if (window.api && window.api.isMobile && window.api.isMobile()) {
      console.log('[playVideo] Mobile: routing through PlayMediaService:', pathUrl);
      $('#player-progress-text').textContent = 'Preparing stream...';

      const playResult = await (window.PlayMediaService
        ? window.PlayMediaService.play(pathUrl, { title: displayTitle || item.title })
        : { success: false, error: 'PlayMediaService not available' }
      );

      console.log('[playVideo] PlayMediaService result:', playResult);

      if (playResult.success && playResult.streamUrl) {
        // Got a streamable URL (localhost or direct HTTP) — use it
        finalUrl = playResult.streamUrl;
        console.log('[playVideo] Mobile stream URL:', finalUrl);

        // Lock to landscape for immersive viewing
        try { await window.api.invoke('lock-orientation', 'landscape'); } catch (e) { }
      } else if (playResult.method === 'native-intent' || playResult.method === 'intent-scheme' || playResult.method === 'window.open') {
        // Magnet link was handed off to OS — exit player
        showToast('Opening in Torrent App...');
        $('#player-loading').style.display = 'none';
        clearInterval(saveInterval);
        try { await engine.stop(); } catch (e) { }
        document.body.classList.remove('playing-mode');
        return;
      }
    }

    try {
      const engineLoaded = await engine.load(finalUrl, { startTime: startTime, paused: false, duration: knownDur });
      if (!engineLoaded) throw new Error('Engine failed to load media');
    } catch (err) {
      console.error('[playVideo] engine.load failed, attempting HTML5 fallback:', err);
      // Try basic HTML5 fallback to ensure playback (audio) still works
      try {
        const fallbackUrl = toMediaPlayUrl(item.path || finalUrl);
        video.src = fallbackUrl;
        await video.play();
      } catch (e) {
        console.error('[playVideo] HTML5 fallback failed:', e);
        showToast('Playback failed');
        $('#player-loading').style.display = 'none';
        return;
      }
    }

    // Ensure mini-player & poster are synchronized (prevents audio-only/no-image states)
    try {
      const posterCandidates = [item.backdrop_path, item.backdropPath, item.poster_path, item.posterPath, item.thumbnail, item.cover, item.image];
      let bg = posterCandidates.find(p => !!p);
      if (bg) bg = localImg(bg);
      else bg = 'imgs/no-backdrop.png';

      const mpPoster = $('#mp-poster');
      if (mpPoster) {
        mpPoster.src = bg;
        mpPoster.style.display = 'block';
      }
      if ($('#mp-title')) $('#mp-title').textContent = currentItem?.displayTitle || item.title || '';
      if ($('#mini-player') && currentView !== 'player') {
        $('#mini-player').style.display = 'flex';
        document.body.classList.add('mini-player-active');
      }
    } catch (e) { console.warn('[playVideo] mini-player sync failed', e); }

    // Start periodic save — every 5s, lightweight IPC (no full-data write)
    clearInterval(saveInterval);
    saveInterval = setInterval(() => saveProgress(false, true), 5000);

    // Auto-search for local subtitles
    try {
      if (!item.isStream && item.path && !item.path.startsWith('http')) {
        const subs = await window.api.findSubtitles(item.path);
        if (subs && subs.length > 0) {
          await loadSubtitleLocal(subs[0].path);
        }
      }
    } catch (err) {
      console.error('[SUBTITLE-LOAD] Failed to load subtitle:', err.message);
    }

    // Loading screen will be hidden by video 'loadedmetadata' event
    populateSidePanel();
  }

  // Debounced lightweight progress saver — avoids triggering a full appData write
  let _pbSaveDebounce = null;
  async function saveProgress(forceImmediate = false, localOnly = false) {
    if (!currentItem || !currentProfile) return;
    try {
      const time = await engine.getAccurateTime();
      const dur = await engine.getAccurateDuration();
      if (dur > 0 && time > 2) {
        const pbKey = getPlaybackKey(currentItem);
        const pb = currentProfile.playback?.[pbKey] || {};

        const isFinished = pb.watched || (dur > 0 && (time / dur) > 0.9);

        const entry = {
          ...pb,
          time,
          duration: dur,
          lastWatched: Date.now(),
          watched: isFinished,
          source: currentItem.torrentMagnet ? 'torrent' : (currentItem.isStream ? 'stream' : 'local'),
          torrentMagnet: currentItem.torrentMagnet || pb.torrentMagnet || null,
          fileIdx: currentItem.fileIdx != null ? currentItem.fileIdx : (pb.fileIdx != null ? pb.fileIdx : null),
          meta: {
            ...(pb.meta || {}),
            id: currentItem.id || ((appData.tmdbCache || {})[pbKey]?.tmdbId) || ((appData.tmdbCache || {})[pbKey]?.id) || null,
            imdb_id: currentItem.imdb_id || currentItem.imdbId || ((appData.tmdbCache || {})[pbKey]?.imdb_id) || ((appData.tmdbCache || {})[pbKey]?.imdbId) || null,
            imdbId: currentItem.imdbId || currentItem.imdb_id || ((appData.tmdbCache || {})[pbKey]?.imdbId) || ((appData.tmdbCache || {})[pbKey]?.imdb_id) || null,
            title: currentItem.title || ((appData.tmdbCache || {})[pbKey]?.title) || null,
            type: currentItem.type || ((appData.tmdbCache || {})[pbKey]?.type) || null,
            season: currentItem.season !== undefined ? currentItem.season : ((appData.tmdbCache || {})[pbKey]?.season),
            episode: currentItem.episode !== undefined ? currentItem.episode : ((appData.tmdbCache || {})[pbKey]?.episode),
            path: currentItem.path || (pb.meta && pb.meta.path) || null,
            cover: currentItem.cover || ((appData.tmdbCache || {})[pbKey]?.cover) || ((appData.tmdbCache || {})[pbKey]?.posterPath) || (pb.meta && pb.meta.cover) || null,
            artist: currentItem.artist || (pb.meta && pb.meta.artist) || null,
            poster_path: currentItem.poster_path || currentItem.posterPath || ((appData.tmdbCache || {})[pbKey]?.posterPath) || ((appData.tmdbCache || {})[pbKey]?.poster_path) || (pb.meta && pb.meta.poster_path) || null,
            backdrop_path: currentItem.backdrop_path || currentItem.backdropPath || ((appData.tmdbCache || {})[pbKey]?.backdropPath) || ((appData.tmdbCache || {})[pbKey]?.backdrop_path) || (pb.meta && pb.meta.backdrop_path) || null,
            thumbnail: currentItem.thumbnail || (pb.meta && pb.meta.thumbnail) || null,
            showName: currentItem.showName || ((appData.tmdbCache || {})[pbKey]?.showName) || (pb.meta && pb.meta.showName) || null
          }
        };

        // Update in-memory profile (instant)
        if (!currentProfile.playback) currentProfile.playback = {};
        currentProfile.playback[pbKey] = entry;

        const performSave = async () => {
          try {
            if (window.api.savePlaybackPosition) {
              await window.api.savePlaybackPosition(currentProfile.id, pbKey, entry, localOnly, forceImmediate);
            } else {
              await persist(forceImmediate); // fallback
            }
          } catch (e) {
            console.error('[SAVE-PROGRESS] savePlaybackPosition failed:', e.message);
          }
        };

        if (forceImmediate) {
          clearTimeout(_pbSaveDebounce);
          await performSave();
        } else {
          clearTimeout(_pbSaveDebounce);
          _pbSaveDebounce = setTimeout(performSave, 2000);
        }
      }
    } catch (e) { console.error('[SAVE-PROGRESS] Failed:', e.message); }
  }

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
  }
  async function exitPlayer(shouldSwitchView = true, shouldStop = true) {
    document.body.classList.remove('playing-mode');
    if (window.api && window.api.isMobile && window.api.isMobile()) {
      window.api.invoke('unlock-orientation');
    }
    $('#player-wrapper').classList.remove('is-music-mode');
    isPlayingMusic = false;

    // Save state before exiting
    if (currentItem && currentProfile) {
      try {
        const time = await engine.getAccurateTime();
        const dur = await engine.getAccurateDuration();
        const isFinished = (dur > 0 && (time / dur) > 0.9);
        const action = isFinished ? 'stop' : 'pause';
        const progress = dur > 0 ? Math.min((time / dur) * 100, 100) : 0;
        const scrobble = window.scrobbleToTrakt || (typeof scrobbleToTrakt !== 'undefined' ? scrobbleToTrakt : null);
        if (typeof scrobble === 'function') {
          await scrobble(action, progress);
        }
      } catch (e) {
        console.warn('[Player] Trakt scrobble failed:', e.message);
      }
      try { await saveProgress(true, false); } catch (e) { console.warn('[Player] saveProgress failed:', e.message); }
    }

    if (isNativePlayerWindow() && shouldSwitchView) {
      if (window.api && window.api.closeWindow) {
        window.api.closeWindow();
      }
      return;
    }

    // Aggressive, ordered nuke sequence
    if (shouldStop) {
      try {
        // 1-3: Detach media pipeline (pause, clear src, load)
        if (video) {
          try { video.pause(); } catch (e) { /* ignore */ }
          try { video.removeAttribute('src'); } catch (e) { /* ignore */ }
          try { video.load(); } catch (e) { /* ignore */ }
        }

        // Force-hide player DOM immediately to avoid UI freeze/desync
        try {
          const playerContainerEl = document.getElementById('player-container') || $('#player-container');
          if (playerContainerEl) {
            playerContainerEl.style.display = 'none';
            playerContainerEl.classList.remove('active', 'visible');
          }
          const viewPlayerEl = document.getElementById('view-player') || $('#view-player');
          if (viewPlayerEl) {
            viewPlayerEl.classList.remove('active');
            viewPlayerEl.style.display = 'none';
          }

          // Force-show the previous view explicitly
          const targetViewName = playerSourceView || appData.lastView || 'movies';
          let previousViewEl = null;
          try { previousViewEl = (typeof views !== 'undefined' && views[targetViewName]) ? views[targetViewName] : document.getElementById('view-' + targetViewName); } catch (e) {}
          if (previousViewEl) {
            previousViewEl.classList.add('active');
            previousViewEl.style.display = 'block';
          }
        } catch (e) {
          console.warn('[Player] DOM force-hide/show failed:', e);
        }

        // 4: Ensure backend stops (local HTTP server + torrent engine)
        if (window.api && window.api.invoke) {
          await window.api.invoke('stop-torrent-stream');
        }

        // Also stop renderer-side engine housekeeping
        try { await engine.stop(); } catch (e) { /* ignore */ }

        clearInterval(saveInterval);
        currentInternalSubIndex = -1;

        subtitlesEnabled = false;
        if ($('#btn-subtitle')) {
          $('#btn-subtitle').classList.remove('subtitle-on');
          $('#btn-subtitle').classList.add('subtitle-off');
        }

        // Clear Discord RPC
        if (window.api.updateDiscordActivity) {
          window.api.updateDiscordActivity({ type: 'browsing' });
        }

        // Ensure no mini-player limbo
        const mpHide = $('#mini-player');
        if (mpHide) {
          mpHide.style.display = 'none';
          document.body.classList.remove('mini-player-active');
        }

        // Reset current item so UI fully reflects closed player
        currentItem = null;
      } catch (e) {
        console.error('[Player] exitPlayer nuke error:', e);
      }
    }

    // Final cleanup & view switching
    cancelAutoNext();
    if (isFullscreen) await toggleFullscreen();
    closeSidePanel();

    console.log('[Player] Switching view to:', playerSourceView || appData.lastView || 'movies');
    if (!shouldStop) {
      suppressStopOnViewChange = true;
      const mp = $('#mini-player');
      if (mp) mp.style.display = 'flex';
      document.body.classList.add('mini-player-active');
    }
    if (shouldSwitchView) {
      if (playerSourceView) switchView(playerSourceView);
      else switchView(appData.lastView || 'movies');
    }
    renderLibrary();
    renderContinueWatchingDiscover();

    // Sync Tray to reflect Idle state after player exit
    syncTray();
    console.log('[Player] exitPlayer completed');
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
            video.querySelectorAll('track').forEach(t => t.remove());
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
            video.querySelectorAll('track').forEach(t => t.remove());
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

  function populateSidePanel() {
    const pl = $('#panel-episode-list');
    if (!pl) return;
    pl.innerHTML = '';

    // Update Side Panel Title to "Episode List"
    const panelTitle = $('#panel-show-title');
    if (panelTitle) panelTitle.textContent = 'Episode List';

    // CASE 1: Playing from a Torrent Pack (Show torrent files)
    if (currentItem && currentItem.torrentFiles && currentItem.torrentFiles.length > 0) {
      // 1. Natural Sort files by name
      const sortedFiles = [...currentItem.torrentFiles].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );

      sortedFiles.forEach((file, i) => {
        const d = document.createElement('div');
        d.className = 'panel-ep-item' + (file.idx === currentItem.fileIdx ? ' active' : '');

        // 2. Simple regex for episode detection
        const epMatch = file.name.match(/[Ee](\d+)/) || file.name.match(/(\d+)\s*\./) || file.name.match(/\s(\d+)\s/);
        const epNum = epMatch ? parseInt(epMatch[1]) : null;

        let displayTitle = file.name.replace(/\[.*?\]/g, '').replace(/\.(mkv|mp4|avi|webm)$/i, '').replace(/[\._]/g, ' ').trim();
        let displayNum = epNum || (i + 1);
        let thumbHTML = `<div class="panel-ep-thumb-ph">${displayNum}</div>`;
        let metaStr = (file.size / 1024 / 1024 / 1024).toFixed(2) + ' GB';

        // 3. Smart Match with TMDB (Search across ALL seasons for Anime/Packs)
        if (currentShow && epNum) {
          const showId = currentItem.showId || currentShow.id;
          const tmdb = (appData.tmdbCache || {})[showId];

          if (tmdb && tmdb.seasons) {
            let foundEp = null;
            // Track total episodes to support absolute numbering (Anime style)
            let absoluteCounter = 0;

            for (const sn of Object.keys(tmdb.seasons).sort((a, b) => a - b)) {
              const eps = tmdb.seasons[sn];
              // Check if epNum matches season-relative number
              if (eps[epNum]) { foundEp = eps[epNum]; break; }

              // Check absolute numbering
              for (const eKey in eps) {
                absoluteCounter++;
                if (absoluteCounter === parseInt(epNum)) {
                  foundEp = eps[eKey];
                  break;
                }
              }
              if (foundEp) break;
            }

            if (foundEp) {
              displayTitle = foundEp.name;
              metaStr = `S${foundEp.season_number}E${foundEp.episode_number} · ${metaStr}`;
              const still = foundEp.local_still ? `local-file:///${foundEp.local_still.replace(/\\/g, '/')}` : (foundEp.still_path ? localImg(foundEp.still_path) : '');
              if (still) thumbHTML = `<img class="panel-ep-thumb" src="${still}" loading="lazy" onerror="this.style.display='none'">`;
            }
          } else if (showId && !currentItem.metaFetched) {
            console.log('[SIDE-PANEL] Metadata missing, fetching for show:', showId);
            currentItem.metaFetched = true;
            const type = currentItem.type || 'tv';
            ensureSeasonMetadata(showId, currentItem.season || 1, type).then(() => {
              populateSidePanel();
            });
          }
        }

        d.innerHTML = `
          <div class="panel-ep-thumb-wrap">${thumbHTML}<div class="panel-ep-play-overlay"><svg viewBox="0 0 24 24"><polygon points="8 5 20 12 8 19"/></svg></div></div>
          <div class="panel-ep-info">
            <div class="panel-ep-title" title="${escapeHTML(file.name)}">${escapeHTML(displayTitle)}</div>
            <div class="panel-ep-meta">${metaStr}</div>
          </div>`;

        d.onclick = async () => {
          showToast('Switching to: ' + file.name);
          try {
            // Capture values for the new stream before nuking the current player
            const magnetToStart = currentItem?.torrentMagnet || null;
            const idxToStart = file.idx;

            // If something is currently playing, run the aggressive nuke and await completion
            if (currentItem) await exitPlayer(false, true);

            const res = await window.api.invoke('start-torrent-stream', magnetToStart, idxToStart);
            if (res && res.success) {
              const newUrl = (window.api.isElectron) ? (res.localUrl || res.url) : res.url;
              
              if (isNativePlayerWindow()) {
                const newPlayItem = {
                  ...(currentItem || {}),
                  path: newUrl,
                  url: newUrl,
                  title: file.name || currentItem?.title || '',
                  fileIdx: idxToStart,
                  torrentFiles: res.files,
                  torrentMagnet: magnetToStart
                };
                playVideo(newPlayItem, currentShow);
              } else {
                try {
                  const openRes = await requestNativePlayback({ path: newUrl, title: file.name || currentItem?.title || '' }, currentShow);
                  if (openRes?.success !== false) return;
                  console.error('[SIDE-PANEL] Native playback unavailable');
                  showToast('External player unavailable');
                } catch (e) {
                  console.error('[SIDE-PANEL] open external failed:', e?.message || e);
                  showToast('Failed to open external player');
                }
              }
            } else {
              showToast(res?.error || 'Failed to switch episode');
            }
          } catch (e) {
            console.error('[SIDE-PANEL] torrent switch failed:', e?.message || e);
            showToast('Failed to switch episode');
          }
        };

        pl.appendChild(d);
      });
      setTimeout(() => { pl.querySelector('.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 100);
      return;
    }

    if (!currentEpisodes.length) return;

    const tmdb = currentShow ? (appData.tmdbCache || {})[currentShow.id] : null;

    currentEpisodes.forEach((ep, i) => {
      const sn = ep.season || 1;
      const tmdbEps = (tmdb && tmdb.seasons && tmdb.seasons[sn]) ? tmdb.seasons[sn] : {};
      const epNum = parseInt(ep.episode);
      const tE = tmdbEps[epNum] || tmdbEps[String(ep.episode)];

      const epTitle = tE?.name || ep.title;
      const still = tE?.local_still ? `file:///${tE.local_still.replace(/\\/g, '/')}` : (tE?.still_path ? `https://image.tmdb.org/t/p/w300${tE.still_path}` : '');

      const d = document.createElement('div');
      d.className = 'panel-ep-item' + (i === currentEpisodeIndex ? ' active' : '');

      const thumbHTML = still
        ? `<img class="panel-ep-thumb" src="${still}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="panel-ep-thumb-ph">${ep.episode}</div>`;

      d.innerHTML = `<div class="panel-ep-thumb-wrap">${thumbHTML}<div class="panel-ep-play-overlay"><svg viewBox="0 0 24 24"><polygon points="8 5 20 12 8 19"/></svg></div></div><div class="panel-ep-info"><div class="panel-ep-title">${escapeHTML(epTitle)}</div><div class="panel-ep-meta">S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}</div></div>`;
      d.onclick = () => { currentEpisodeIndex = i; playVideo(ep, currentShow); };
      pl.appendChild(d);
    });
    setTimeout(() => { pl.querySelector('.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 100);
  }

  function triggerAutoNext() {
    if (!currentEpisodes.length || currentEpisodeIndex < 0) return;
    const ni = currentEpisodeIndex + 1;
    if (ni >= currentEpisodes.length) {
      showToast('End of series');
      return;
    }
    const next = currentEpisodes[ni];
    let cd = 5;

    // Calculate Rich Title for Up Next (SxxExx - Title)
    let displayTitle = cleanTechnicalTitle(next.title);
    if (currentShow) {
      const tmdb = (appData.tmdbCache || {})[currentShow.id];
      const sn = next.season || 1;
      const tmdbEps = (tmdb && tmdb.seasons && tmdb.seasons[sn]) ? tmdb.seasons[sn] : {};
      const epNum = parseInt(next.episode);
      const tE = tmdbEps[epNum] || tmdbEps[String(next.episode)];
      if (tE?.name) {
        displayTitle = `S${String(sn).padStart(2, '0')}E${String(next.episode).padStart(2, '0')} ┬╖ ${tE.name}`;
      } else if (!isNaN(epNum)) {
        displayTitle = `S${String(sn).padStart(2, '0')}E${String(next.episode).padStart(2, '0')}`;
      }
    }

    $('#auto-next-title').textContent = displayTitle;
    const ov = $('#auto-next-overlay');
    ov.style.display = 'block';

    const fill = $('#auto-next-bar-fill');
    fill.style.transition = 'none';
    fill.style.width = '100%';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.transition = `width ${cd}s linear`;
      fill.style.width = '0%';
    }));

    autoNextTimer = setInterval(async () => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoNextTimer);
        autoNextTimer = null;
        ov.style.display = 'none';
        // CRITICAL: Force-stop the old video and reset state
        // before loading the next episode. Without this, the
        // HTML5 video element stays in 'ended' state and the
        // new .play() call is silently ignored.
        try { await engine.stop(); } catch (e) { }
        currentEpisodeIndex = ni;

        // SMART AUTONEXT: Resolve sources if needed
        if (!next.path || next.path.startsWith('magnet:') || next.isScraped || (!next.path.startsWith('http') && !next.path.includes(':') && !next.path.includes('/') && !next.path.includes('\\'))) {
          console.log('[AutoNext] Resolving source for:', next.title);
          if (typeof openDiscoverDetail === 'function') {
            openDiscoverDetail(next, currentShow ? (currentShow.media_type || 'tv') : 'tv');
            // Wait for detail to open then try to auto-load streams
            setTimeout(() => {
              const epItems = document.querySelectorAll('.episode-item');
              if (epItems && epItems[ni]) epItems[ni].click(); // This triggers loadStreams
            }, 1000);
          } else {
            playVideo(next, currentShow);
          }
        } else {
          playVideo(next, currentShow);
        }
      }
    }, 1000);
  }
  function cancelAutoNext() { clearInterval(autoNextTimer); autoNextTimer = null; $('#auto-next-overlay').style.display = 'none'; }

  function applySubtitleStyles() {
    const size = $('#sub-style-size')?.value || 100;
    const bgOpacity = ($('#sub-style-bg')?.value || 50) / 100;
    const isBold = $('#btn-sub-bold')?.classList.contains('active');
    const hasShadow = $('#btn-sub-shadow')?.classList.contains('active');

    let styleEl = $('#sub-dynamic-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'sub-dynamic-styles';
      document.head.appendChild(styleEl);
    }

    styleEl.innerHTML = `
      video::cue {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        font-size: 0px !important;
      }
      #custom-subtitles-text {
        background-color: rgba(0, 0, 0, ${bgOpacity}) !important;
        font-size: ${(size / 100) * 22}px !important;
        font-weight: ${isBold ? 'bold' : 'normal'} !important;
        text-shadow: ${hasShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none'} !important;
        color: white !important;
        font-family: inherit !important;
        unicode-bidi: plaintext !important;
        direction: rtl !important;
        text-align: center !important;
      }
    `;

    if ($('#label-sub-size')) $('#label-sub-size').textContent = `${size}%`;
    if ($('#label-sub-bg')) $('#label-sub-bg').textContent = `${Math.round(bgOpacity * 100)}%`;
  }

  // ───────────────────────────────────────────



  function playMusic(item) {
    if (typeof item === 'string') {
      const found = (appData.music || []).find(m => m.id === item || m.path === item);
      if (found) {
        item = found;
      } else {
        item = { id: item, path: item, title: item.split(/[/\\]/).pop() };
      }
    }
    if (item.isVideoMusic) {
      playVideo(item, null);
      return;
    }
    currentItem = { ...item, type: 'music' };
    
    // Use local-file:// protocol
    video.src = 'local-file:///' + item.path.replace(/\\/g, '/');
    video.play().catch(err => {
      console.error('[MUSIC] Playback error:', err);
      showToast('Playback failed');
    });

    const { title, artist, cover } = getMusicMeta(item);

    const titleEl = $('#music-title');
    if (titleEl) titleEl.textContent = title;
    const artistEl = $('#music-artist');
    if (artistEl) artistEl.textContent = artist;

    // Set Poster
    const bgUrl = (typeof localImg === 'function' ? localImg(cover) : window.localImg ? window.localImg(cover) : cover) || 'https://api.dicebear.com/7.x/shapes/svg?seed=music';
    const posterImg = $('#music-poster-img');
    if (posterImg) posterImg.src = bgUrl;

    // Update mini-player poster
    const mpPoster = $('#mp-poster');
    if (mpPoster) {
      mpPoster.src = bgUrl;
      mpPoster.style.display = cover ? 'block' : 'none';
    }

    const mpTitle = $('#mp-title');
    if (mpTitle) mpTitle.textContent = title;
    const mpMeta = $('#mp-meta');
    if (mpMeta) mpMeta.textContent = artist;

    const miniPlayer = $('#mini-player');
    if (miniPlayer) miniPlayer.style.display = 'flex';
    isPlayingMusic = true;
    switchView('player');

    // Guaranteed Audio Resume on Interaction
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    if (typeof window.initVisualizer === 'function') {
      window.initVisualizer();
    } else if (typeof initVisualizer === 'function') {
      initVisualizer();
    }

    showToast(`Playing: ${title}`);
  }

  function playNextMusic() {
    if (!appData.music || !currentItem) return;
    const idx = appData.music.findIndex(m => m.id === currentItem.id);
    if (idx !== -1 && idx < appData.music.length - 1) {
      playMusic(appData.music[idx + 1]);
    }
  }

  function playPrevMusic() {
    if (!appData.music || !currentItem) return;
    const idx = appData.music.findIndex(m => m.id === currentItem.id);
    if (idx > 0) {
      playMusic(appData.music[idx - 1]);
    }
  }

  // Expose player functions to window
  window.getPlaybackKey = getPlaybackKey;
  window.togglePlayerMode = togglePlayerMode;
  window.renderMusicPlayerPlaylist = renderMusicPlayerPlaylist;
  window.playVideo = playVideo;
  window.cancelAutoNext = cancelAutoNext;
  window.triggerAutoNext = triggerAutoNext;
  
  window.playMusic = playMusic;
  window.playNextMusic = playNextMusic;
  window.playPrevMusic = playPrevMusic;
  if (typeof playStream !== 'undefined') window.playStream = playStream;
  if (typeof exitPlayer !== 'undefined') window.exitPlayer = exitPlayer;
  if (typeof saveProgress !== 'undefined') window.saveProgress = saveProgress;
  if (typeof createSubtitleOverlay !== 'undefined') window.createSubtitleOverlay = createSubtitleOverlay;
  if (typeof applySubtitleStyles !== 'undefined') window.applySubtitleStyles = applySubtitleStyles;
  if (typeof getMusicMeta !== 'undefined') window.getMusicMeta = getMusicMeta;
})();
