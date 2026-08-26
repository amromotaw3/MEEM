// ─── Live Radio View Module ───
// Enhanced with AAC+ (HE-AAC v1/v2) & HLS Stream Fallback Decoder Engine
(function () {
  let activeFilter = 'arabic';
  let searchQuery = '';
  let currentStation = null;
  let isPlaying = false;
  let searchDebounceTimeout = null;
  let audioElement = null;
  let radioHlsInstance = null;

  const MIRRORS = [
    'https://de1.api.radio-browser.info',
    'https://at1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info'
  ];

  // Initialize module
  function initRadioView() {
    setupAudioElement();
    bindEvents();
    loadRadioStations(activeFilter, searchQuery);
  }

  // Set up persistent audio element for radio streaming with AAC+ fallback decoder
  function setupAudioElement() {
    if (!audioElement) {
      audioElement = document.getElementById('radio-audio-element');
      if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.id = 'radio-audio-element';
        audioElement.preload = 'none';
        document.body.appendChild(audioElement);
      }

      // Audio Event Listeners
      audioElement.addEventListener('playing', () => {
        isPlaying = true;
        updatePlayerBarUI();
        updateGridPlayingStates();
      });

      audioElement.addEventListener('pause', () => {
        isPlaying = false;
        updatePlayerBarUI();
        updateGridPlayingStates();
      });

      audioElement.addEventListener('error', (e) => {
        console.warn('[Radio Player] Native playback error encountered, attempting fallback:', e);
        if (currentStation) {
          attemptRadioFallback(currentStation);
        } else {
          isPlaying = false;
          updatePlayerBarUI();
          updateGridPlayingStates();
        }
      });

      audioElement.addEventListener('stalled', () => {
        console.warn('[Radio Player] Stream stalled');
      });
    }
  }

  // Bind UI Events
  function bindEvents() {
    // Filter Chips
    const chips = document.querySelectorAll('.radio-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.dataset.filter || 'arabic';
        loadRadioStations(activeFilter, searchQuery);
      });
    });

    // Search Input
    const searchInput = document.getElementById('radio-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchQuery = e.target.value;
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
          loadRadioStations(activeFilter, searchQuery);
        }, 350);
      };
    }

    // Player Bar Controls
    const btnToggle = document.getElementById('radio-bar-toggle');
    if (btnToggle) {
      btnToggle.onclick = toggleRadioPlayback;
    }

    const btnStop = document.getElementById('radio-bar-stop');
    if (btnStop) {
      btnStop.onclick = stopRadioPlayback;
    }

    const volumeSlider = document.getElementById('radio-bar-volume');
    if (volumeSlider) {
      volumeSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        if (audioElement) audioElement.volume = val;
      };
    }
  }

  // Fetch & Render Stations
  async function loadRadioStations(filter, query) {
    const grid = document.getElementById('radio-stations-grid');
    if (!grid) return;

    // Show realistic radio card skeletons
    const skeletonCardHTML = `
      <div class="radio-skeleton-card">
        <div class="radio-card-top">
          <div class="radio-skeleton-block" style="width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0;"></div>
          <div class="radio-skeleton-block" style="width: 50px; height: 18px; border-radius: 6px;"></div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin: 12px 0;">
          <div class="radio-skeleton-block" style="width: 75%; height: 16px; border-radius: 6px;"></div>
          <div class="radio-skeleton-block" style="width: 40%; height: 11px; border-radius: 4px;"></div>
        </div>
        <div class="radio-card-footer" style="display: flex; align-items: center; justify-content: space-between;">
          <div class="radio-skeleton-block" style="width: 65px; height: 22px; border-radius: 8px;"></div>
          <div class="radio-skeleton-block" style="width: 36px; height: 36px; border-radius: 50%;"></div>
        </div>
      </div>
    `;
    grid.innerHTML = Array(12).fill(skeletonCardHTML).join('');

    try {
      let stations = [];
      if (window.api && typeof window.api.searchRadio === 'function') {
        stations = await window.api.searchRadio({ filter, query });
      } else if (window.api && typeof window.api.invoke === 'function') {
        stations = await window.api.invoke('radio-search', { filter, query });
      }

      // Client-side Direct Mirror Fallback if IPC returned empty or failed
      if (!stations || !stations.length) {
        stations = await fetchRadioDirect(filter, query);
      }

      renderRadioCards(stations);
    } catch (err) {
      console.warn('[Radio View] Primary IPC failed, trying direct browser fetch:', err.message);
      try {
        const stations = await fetchRadioDirect(filter, query);
        renderRadioCards(stations);
      } catch (fallbackErr) {
        console.error('[Radio View] Direct fallback failed:', fallbackErr);
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);"><i class="fas fa-exclamation-triangle fa-2x" style="margin-bottom:10px; display:block; color:#f59e0b;"></i>Failed to load radio stations. Please check network connection.</div>';
      }
    }
  }

  // Direct fetch fallback from browser window
  async function fetchRadioDirect(filter, query) {
    const params = new URLSearchParams();
    params.append('limit', '60');
    params.append('hidebroken', 'true');
    params.append('order', 'votes');
    params.append('reverse', 'true');

    if (filter === 'arabic') params.append('language', 'arabic');
    else if (filter === 'egypt') params.append('countrycode', 'EG');
    else if (filter === 'saudi') params.append('countrycode', 'SA');
    else if (filter === 'quran') params.append('tag', 'quran');

    if (query && query.trim()) params.append('name', query.trim());

    for (const mirror of MIRRORS) {
      try {
        const resp = await fetch(`${mirror}/json/stations/search?${params.toString()}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            return data.map(item => ({
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
        }
      } catch (e) {
        console.warn(`[Radio Direct] Mirror ${mirror} failed:`, e.message);
      }
    }
    return [];
  }

  // Render station cards in glassmorphic grid
  function renderRadioCards(stations) {
    const grid = document.getElementById('radio-stations-grid');
    if (!grid) return;

    if (!stations || !stations.length) {
      grid.innerHTML = '<div style="grid-column: 1/-1; padding: 60px 20px; text-align: center; color: var(--text-muted); font-size: 1rem;"><i class="fas fa-radio fa-2x" style="margin-bottom: 12px; display: block; opacity: 0.4;"></i>No radio stations found for this query.</div>';
      return;
    }

    grid.innerHTML = '';

    stations.forEach(station => {
      const card = document.createElement('div');
      const isCurrentPlaying = currentStation && currentStation.id === station.id && isPlaying;
      card.className = `radio-card ${isCurrentPlaying ? 'playing' : ''}`;
      card.dataset.stationId = station.id;

      let faviconUrl = (station.favicon || '').trim();
      if (faviconUrl && faviconUrl !== 'null' && faviconUrl !== 'undefined') {
        if (faviconUrl.startsWith('//')) {
          faviconUrl = 'https:' + faviconUrl;
        } else if (!faviconUrl.startsWith('http://') && !faviconUrl.startsWith('https://') && !faviconUrl.startsWith('data:')) {
          faviconUrl = 'https://' + faviconUrl;
        }
      } else {
        faviconUrl = '';
      }

      const countryLabel = station.countryCode || station.country || 'Global';
      const bitrateLabel = station.bitrate ? `${station.bitrate} kbps` : 'HD';
      const cleanName = (station.name || 'Radio Station').trim();

      const isFav = currentProfile?.watchlist?.some(item => item.id === station.id || item.radioUrl === station.url);

      card.innerHTML = `
        <div class="radio-card-top">
          <div class="radio-favicon-wrap">
            ${faviconUrl ? `<img src="${escapeAttr(faviconUrl)}" class="radio-favicon-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';"><div class="radio-favicon-fallback" style="display:none;"><i class="fas fa-broadcast-tower"></i></div>` : `<div class="radio-favicon-fallback"><i class="fas fa-broadcast-tower"></i></div>`}
          </div>
          <div class="radio-badges-col">
            <button class="radio-fav-btn ${isFav ? 'active' : ''}" type="button" title="${isFav ? 'Remove from My List' : 'Add to My List'}">
              <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
            </button>
            <span class="radio-badge radio-badge-bitrate">${escapeHTML(bitrateLabel)}</span>
          </div>
        </div>
        <div class="radio-card-body">
          <h4 class="radio-station-name" title="${escapeAttr(cleanName)}">${escapeHTML(cleanName)}</h4>
          <div class="radio-station-meta">
            <span><i class="fas fa-globe" style="margin-right: 4px;"></i>${escapeHTML(station.country || 'International')}</span>
            ${station.codec ? `• <span>${escapeHTML(station.codec)}</span>` : ''}
          </div>
        </div>
        <div class="radio-card-footer">
          <button class="radio-play-btn" type="button">
            <i class="fas ${isCurrentPlaying ? 'fa-pause' : 'fa-play'}"></i>
            <span>${isCurrentPlaying ? 'Playing' : 'Listen Now'}</span>
          </button>
        </div>
      `;

      const favBtn = card.querySelector('.radio-fav-btn');
      if (favBtn) {
        favBtn.onclick = (e) => {
          e.stopPropagation();
          const radioMediaItem = {
            id: station.id,
            type: 'radio',
            media_type: 'radio',
            title: station.name,
            name: station.name,
            poster_path: station.favicon || 'imgs/appicon-w.png',
            posterPath: station.favicon || 'imgs/appicon-w.png',
            backdrop_path: station.favicon || 'imgs/appicon-w.png',
            radioUrl: station.url || station.urlResolved,
            favicon: station.favicon,
            country: station.country,
            bitrate: station.bitrate
          };
          if (typeof toggleWatchlist === 'function') {
            toggleWatchlist(radioMediaItem);
            renderRadioCards(stations);
          }
        };
      }

      card.onclick = () => playRadioStation(station);
      grid.appendChild(card);
    });
  }

  // Play specified station with AAC+ / HE-AAC & HLS decoder fallback
  async function playRadioStation(station) {
    setupAudioElement();

    if (typeof window.stopIptvStream === 'function') {
      try { window.stopIptvStream(); } catch (e) {}
    }

    if (currentStation && currentStation.id === station.id && isPlaying) {
      toggleRadioPlayback();
      return;
    }

    currentStation = station;
    const streamUrl = station.urlResolved || station.url;

    if (!streamUrl) {
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ Invalid stream URL for this station.', 3000);
      }
      return;
    }

    playStreamWithFallback(streamUrl, station);
  }

  // Stream Player with HLS / AAC+ Fallback Mechanism
  function playStreamWithFallback(url, station) {
    // Destroy previous HLS instance
    if (radioHlsInstance) {
      try { radioHlsInstance.destroy(); } catch (e) {}
      radioHlsInstance = null;
    }

    const codecUpper = (station?.codec || '').toUpperCase();
    const isAacPlus = url.includes('.aac') || url.includes('.aacp') || codecUpper.includes('AAC');
    const isHls = url.includes('.m3u8');

    if ((isHls || isAacPlus) && typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
      try {
        console.log('[Radio AAC+] Attaching Hls.js decoder fallback for stream:', url);
        radioHlsInstance = new window.Hls({
          enableWorker: true,
          lowLatencyMode: true
        });
        radioHlsInstance.loadSource(url);
        radioHlsInstance.attachMedia(audioElement);
        radioHlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
          audioElement.play().then(() => {
            isPlaying = true;
            updatePlayerBarUI();
            updateGridPlayingStates();
          }).catch(err => {
            console.warn('[Radio Hls] Play call failed, retrying direct:', err.message);
            playDirectAudio(url, station);
          });
        });
        radioHlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('[Radio Hls] Fatal error, retrying direct audio:', data.type);
            try { radioHlsInstance.destroy(); } catch (e) {}
            radioHlsInstance = null;
            playDirectAudio(url, station);
          }
        });
        return;
      } catch (err) {
        console.warn('[Radio Hls] Initialization error:', err.message);
      }
    }

    playDirectAudio(url, station);
  }

  // Direct HTML5 audio element playback
  function playDirectAudio(url, station) {
    audioElement.src = url;
    audioElement.play().then(() => {
      isPlaying = true;
      updatePlayerBarUI();
      updateGridPlayingStates();
    }).catch(err => {
      console.warn('[Radio Player] Direct play error:', err.message);
      attemptRadioFallback(station);
    });
    updatePlayerBarUI();
    updateGridPlayingStates();
  }

  // Attempt alternative stream mirror URL on error
  function attemptRadioFallback(station) {
    const fallbackUrl = station?.url;
    if (fallbackUrl && fallbackUrl !== audioElement.src) {
      console.log('[Radio Player] Trying secondary stream URL:', fallbackUrl);
      audioElement.src = fallbackUrl;
      audioElement.play().then(() => {
        isPlaying = true;
        updatePlayerBarUI();
        updateGridPlayingStates();
      }).catch(e => {
        isPlaying = false;
        updatePlayerBarUI();
        updateGridPlayingStates();
        if (typeof window.showToast === 'function') {
          window.showToast('⚠️ Radio stream connection offline.', 3500);
        }
      });
    } else {
      isPlaying = false;
      updatePlayerBarUI();
      updateGridPlayingStates();
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ Unable to connect to station stream.', 3500);
      }
    }
  }

  // Toggle play/pause state
  function toggleRadioPlayback() {
    if (!audioElement || !currentStation) return;
    if (isPlaying) {
      audioElement.pause();
    } else {
      audioElement.play().catch(e => {
        console.warn('[Radio View] Toggle play failed:', e);
      });
    }
  }

  // Stop playback completely
  function stopRadioPlayback() {
    if (radioHlsInstance) {
      try { radioHlsInstance.destroy(); } catch (e) {}
      radioHlsInstance = null;
    }
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute('src');
      audioElement.load();
    }
    isPlaying = false;
    currentStation = null;
    updatePlayerBarUI();
    updateGridPlayingStates();
    hidePlayerBar();
  }

  // Update Player Bar UI at right of screen
  function updatePlayerBarUI() {
    const bar = document.getElementById('radio-player-bar');
    if (!bar) return;

    if (!currentStation) {
      bar.classList.remove('active');
      return;
    }

    bar.classList.add('active');

    const titleEl = document.getElementById('radio-bar-title');
    const thumbEl = document.getElementById('radio-bar-thumb');
    const toggleBtn = document.getElementById('radio-bar-toggle');
    const favBarBtn = document.getElementById('radio-bar-favorite');

    if (titleEl) titleEl.textContent = currentStation.name || 'Radio Stream';

    if (thumbEl) {
      let fav = (currentStation.favicon || '').trim();
      if (fav && fav !== 'null' && fav !== 'undefined') {
        if (fav.startsWith('//')) fav = 'https:' + fav;
        else if (!fav.startsWith('http://') && !fav.startsWith('https://') && !fav.startsWith('data:')) fav = 'https://' + fav;
        thumbEl.innerHTML = `<img src="${escapeAttr(fav)}" alt="station" onerror="this.outerHTML='<i class=\\'fas fa-broadcast-tower\\'></i>'">`;
      } else {
        thumbEl.innerHTML = `<i class="fas fa-broadcast-tower"></i>`;
      }
    }

    if (toggleBtn) {
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.className = `fas ${isPlaying ? 'fa-pause' : 'fa-play'}`;
      }
    }

    updateRadioBarFavorite();

    if (favBarBtn && !favBarBtn._bound) {
      favBarBtn._bound = true;
      favBarBtn.onclick = () => {
        if (!currentStation) return;
        const radioMediaItem = {
          id: currentStation.id,
          type: 'radio',
          media_type: 'radio',
          title: currentStation.name,
          name: currentStation.name,
          poster_path: currentStation.favicon || 'imgs/appicon-w.png',
          posterPath: currentStation.favicon || 'imgs/appicon-w.png',
          backdrop_path: currentStation.favicon || 'imgs/appicon-w.png',
          radioUrl: currentStation.url || currentStation.urlResolved,
          favicon: currentStation.favicon,
          country: currentStation.country,
          bitrate: currentStation.bitrate
        };
        if (typeof window.toggleWatchlist === 'function') {
          window.toggleWatchlist(radioMediaItem);
          updateRadioBarFavorite();
          renderRadioCards(lastStations);
        }
      };
    }
  }

  function updateRadioBarFavorite() {
    const favBarBtn = document.getElementById('radio-bar-favorite');
    if (!favBarBtn || !currentStation) return;
    const isFav = window.currentProfile?.watchlist?.some(w => w.id === currentStation.id || w.radioUrl === currentStation.url);
    favBarBtn.classList.toggle('active', isFav);
    const icon = favBarBtn.querySelector('i');
    if (icon) {
      icon.className = isFav ? 'fas fa-heart' : 'far fa-heart';
      if (isFav) icon.style.color = '#ef4444';
      else icon.style.color = '';
    }
  }

  function hidePlayerBar() {
    const bar = document.getElementById('radio-player-bar');
    if (bar) bar.classList.remove('active');
  }

  // Update playing state styling on grid cards
  function updateGridPlayingStates() {
    const cards = document.querySelectorAll('.radio-card');
    cards.forEach(card => {
      const id = card.dataset.stationId;
      const isCardPlaying = currentStation && currentStation.id === id && isPlaying;
      card.classList.toggle('playing', isCardPlaying);

      const btnIcon = card.querySelector('.radio-play-btn i');
      const btnSpan = card.querySelector('.radio-play-btn span');

      if (btnIcon && btnSpan) {
        btnIcon.className = `fas ${isCardPlaying ? 'fa-pause' : 'fa-play'}`;
        btnSpan.textContent = isCardPlaying ? 'Playing' : 'Listen Now';
      }
    });
  }

  // Escape HTML helper
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    return escapeHTML(str);
  }

  // Global exports
  window.initRadioView = initRadioView;
  window.playRadioStation = playRadioStation;
  window.stopRadioPlayback = stopRadioPlayback;
  window.stopRadioStream = stopRadioPlayback;
})();
