/**
 * MediaVault v2 - Professional IPTV Subscription Manager & 3-Pane Explorer Player
 * Architected for scalable multi-source management, background worker M3U parsing,
 * IndexedDB caching, and Electron network header bypass.
 */

(function () {
  'use strict';

  // ─── Module State ───────────────────────────────────────────────────────────
  let sourcesList = [];
  let activeSourceId = null;
  let categoriesList = ['All', '⭐ Favorites'];
  let activeCategory = 'All';
  let searchQuery = '';
  let activeChannel = null;
  let channelsList = [];
  let hlsInstance = null;
  let worker = null;

  const DEFAULT_PUBLIC_SOURCES = [];
  const DEFAULT_CHANNELS = [];

  // Helper with timeout to prevent IndexedDB from hanging the UI
  function withStorageTimeout(promise, ms = 1500, fallback = null) {
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  async function initIptvView() {
    initWorker();
    bindEvents();
    initPaneResizers();

    try {
      if (window.IptvStorage) {
        sourcesList = await withStorageTimeout(window.IptvStorage.getSources(), 1500, null);
      }
    } catch (e) {
      console.warn('[IPTV Storage Error]', e);
    }

    if (!sourcesList || sourcesList.length === 0) sourcesList = [...DEFAULT_PUBLIC_SOURCES];

    // Filter out extra built-in iptv_org sources except 'src_iptv_org_ara'
    const allowedDefaultIds = new Set(['src_iptv_org_ara']);
    const toRemove = sourcesList.filter(s => (s.id.startsWith('src_iptv_org_') && !allowedDefaultIds.has(s.id)) || s.id === 'src_default_public');
    for (const rem of toRemove) {
      const idx = sourcesList.findIndex(s => s.id === rem.id);
      if (idx !== -1) sourcesList.splice(idx, 1);
      if (window.IptvStorage) {
        window.IptvStorage.deleteSource(rem.id).catch(() => {});
      }
    }

    // Ensure 'src_iptv_org_ara' exists and is named 'Default Channels'
    let mainDef = sourcesList.find(s => s.id === 'src_iptv_org_ara');
    if (mainDef) {
      mainDef.name = 'Default Channels';
      if (!mainDef.channelCount) mainDef.channelCount = DEFAULT_CHANNELS.length;
      if (window.IptvStorage) {
        window.IptvStorage.saveSource(mainDef).catch(() => {});
      }
    } else {
      mainDef = { ...DEFAULT_PUBLIC_SOURCES[0], channelCount: DEFAULT_CHANNELS.length };
      sourcesList.unshift(mainDef);
      if (window.IptvStorage) {
        window.IptvStorage.saveSource(mainDef).catch(() => {});
      }
    }

    if (!activeSourceId || !sourcesList.some(s => s.id === activeSourceId)) {
      activeSourceId = mainDef.id;
    }

    renderSourcesList();
    await loadActiveSourceChannels();

    // Auto-sync main default source if empty
    const currentActiveSource = sourcesList.find(s => s.id === activeSourceId);
    if (currentActiveSource && (!currentActiveSource.channelCount || currentActiveSource.channelCount === 0)) {
      syncSource(currentActiveSource);
    }
  }

  // ─── Resizable Panes Handler (Draggable Splitters) ──────────────────────────
  let isResizingPanes = false;

  function initPaneResizers() {
    const resizer1 = document.getElementById('iptv-resizer-1');
    const resizer2 = document.getElementById('iptv-resizer-2');
    const panel1 = document.getElementById('iptv-sources-panel');
    const panel2 = document.getElementById('iptv-middle-panel');
    const container = document.querySelector('.iptv-container');

    if (!resizer1 || !resizer2 || !panel1 || !panel2 || !container) return;
    if (resizer1._initialized) return;

    resizer1._initialized = true;
    resizer2._initialized = true;

    function attachResizer(resizer, targetPanel, isPanel1) {
      let startX = 0;
      let startWidth = 0;

      const onMouseMove = (e) => {
        if (!isResizingPanes) return;
        const dx = e.clientX - startX;
        let newWidth = startWidth + dx;

        const minW = isPanel1 ? 140 : 180;
        const maxW = isPanel1 ? 480 : 700;

        if (newWidth < minW) newWidth = minW;
        if (newWidth > maxW) newWidth = maxW;

        targetPanel.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        if (!isResizingPanes) return;
        isResizingPanes = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizingPanes = true;
        startX = e.clientX;
        startWidth = targetPanel.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }

    attachResizer(resizer1, panel1, true);
    attachResizer(resizer2, panel2, false);
  }

  function initWorker() {
    if (!worker && typeof Worker !== 'undefined') {
      try {
        worker = new Worker('js/iptv-worker.js');
        worker.onmessage = handleWorkerMessage;
      } catch (err) {
        console.warn('[IPTV Worker] Worker initialization failed, using main thread fallback:', err.message);
      }
    }
  }

  // ─── Source & Channel Loading ────────────────────────────────────────────────

  async function loadActiveSourceChannels() {
    const grid = document.getElementById('iptv-channels-grid');
    if (grid) {
      grid.innerHTML = `
        <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
          <i class="fas fa-spinner fa-spin fa-2x" style="margin-bottom: 12px; display: block; color: #ffffff;"></i>
          Loading Channels...
        </div>
      `;
    }

    try {
      if (window.IptvStorage && activeSourceId) {
        channelsList = await withStorageTimeout(window.IptvStorage.getChannels(activeSourceId, activeCategory, searchQuery), 1500, null);
      }
    } catch (err) {
      console.error('[IPTV] Failed to load channels:', err);
    }

    if (!channelsList || channelsList.length === 0) {
      channelsList = [...DEFAULT_CHANNELS];
    }

    try {
      const allSourceChannels = (window.IptvStorage && activeSourceId) ? await withStorageTimeout(window.IptvStorage.getChannels(activeSourceId, 'All', ''), 1000, DEFAULT_CHANNELS) : DEFAULT_CHANNELS;
      const cats = new Set(['All', '⭐ Favorites']);
      (allSourceChannels || DEFAULT_CHANNELS).forEach(c => {
        if (c.category || c.groupTitle) cats.add(c.category || c.groupTitle);
      });
      categoriesList = Array.from(cats);
    } catch (err) {
      categoriesList = ['All', '⭐ Favorites', 'News', 'Science', 'Business'];
    }

    renderCategories();
    renderChannelList();

    if (channelsList.length > 0 && !activeChannel) {
      selectChannel(channelsList[0]);
    }
  }

  // ─── UI Renderers ───────────────────────────────────────────────────────────

  function renderSourcesList() {
    const container = document.getElementById('iptv-sources-list');
    if (!container) return;

    container.innerHTML = '';

    sourcesList.forEach(source => {
      const item = document.createElement('div');
      item.className = `iptv-source-item ${source.id === activeSourceId ? 'active' : ''}`;
      
      const iconClass = source.type === 'xtream' ? 'fa-tv' : (source.type === 'file' ? 'fa-file-alt' : 'fa-globe');

      item.innerHTML = `
        <div class="iptv-source-info">
          <span class="iptv-source-name" title="${escapeHTML(source.name)}">
            <i class="fas ${iconClass}" style="color: #ffffff; margin-right: 6px;"></i>${escapeHTML(source.name)}
          </span>
          <span class="iptv-source-count">${source.channelCount || 0} channels</span>
        </div>
        <div class="iptv-source-actions">
          <button class="iptv-action-btn sync" title="Sync/Refresh Source"><i class="fas fa-sync-alt"></i></button>
          ${source.id !== 'src_default_public' ? '<button class="iptv-action-btn delete" title="Delete Source"><i class="fas fa-trash"></i></button>' : ''}
        </div>
      `;

      item.onclick = (e) => {
        if (e.target.closest('.iptv-action-btn')) return;
        activeSourceId = source.id;
        activeCategory = 'All';
        renderSourcesList();
        loadActiveSourceChannels();
      };

      const syncBtn = item.querySelector('.sync');
      if (syncBtn) {
        syncBtn.onclick = () => syncSource(source);
      }

      const delBtn = item.querySelector('.delete');
      if (delBtn) {
        delBtn.onclick = () => deleteSource(source.id);
      }

      container.appendChild(item);
    });
  }

  function renderCategories() {
    const container = document.getElementById('iptv-categories-wrap');
    if (!container) return;

    container.innerHTML = '';

    categoriesList.forEach(cat => {
      const pill = document.createElement('button');
      pill.className = `iptv-cat-pill ${cat === activeCategory ? 'active' : ''}`;
      pill.textContent = cat;
      pill.onclick = () => {
        activeCategory = cat;
        renderCategories();
        loadActiveSourceChannels();
      };
      container.appendChild(pill);
    });
  }

  let renderedChannelCount = 80;
  const CHUNK_SIZE = 80;

  function renderChannelList(resetScroll = true) {
    const grid = document.getElementById('iptv-channels-grid');
    if (!grid) return;

    if (resetScroll) {
      grid.scrollTop = 0;
      renderedChannelCount = CHUNK_SIZE;
    }

    grid.innerHTML = '';

    if (!channelsList || channelsList.length === 0) {
      grid.innerHTML = `
        <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.4);">
          No channels found in this category.
        </div>
      `;
      return;
    }

    const itemsToRender = channelsList.slice(0, renderedChannelCount);
    const fragment = document.createDocumentFragment();
    itemsToRender.forEach(ch => {
      fragment.appendChild(createChannelCardElement(ch));
    });
    grid.appendChild(fragment);

    if (channelsList.length > renderedChannelCount) {
      const loadMoreInfo = document.createElement('div');
      loadMoreInfo.id = 'iptv-load-more-indicator';
      loadMoreInfo.style.cssText = 'padding: 14px; text-align: center; color: rgba(255,255,255,0.45); font-size: 0.78rem; font-weight: 700;';
      loadMoreInfo.innerHTML = `Showing ${renderedChannelCount} of ${channelsList.length} channels <i class="fas fa-chevron-down" style="margin-left: 6px;"></i>`;
      grid.appendChild(loadMoreInfo);
    }

    if (!grid._scrollBound) {
      grid._scrollBound = true;
      grid.addEventListener('scroll', () => {
        if (!channelsList || channelsList.length <= renderedChannelCount) return;
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 250) {
          renderedChannelCount += CHUNK_SIZE;
          appendMoreChannels();
        }
      });
    }
  }

  function appendMoreChannels() {
    const grid = document.getElementById('iptv-channels-grid');
    if (!grid || !channelsList) return;

    const oldIndicator = document.getElementById('iptv-load-more-indicator');
    if (oldIndicator) oldIndicator.remove();

    const currentCount = grid.querySelectorAll('.iptv-channel-card').length;
    const itemsToAppend = channelsList.slice(currentCount, renderedChannelCount);
    if (itemsToAppend.length === 0) return;

    const fragment = document.createDocumentFragment();
    itemsToAppend.forEach(ch => {
      fragment.appendChild(createChannelCardElement(ch));
    });
    grid.appendChild(fragment);

    if (channelsList.length > renderedChannelCount) {
      const loadMoreInfo = document.createElement('div');
      loadMoreInfo.id = 'iptv-load-more-indicator';
      loadMoreInfo.style.cssText = 'padding: 14px; text-align: center; color: rgba(255,255,255,0.45); font-size: 0.78rem; font-weight: 700;';
      loadMoreInfo.innerHTML = `Showing ${renderedChannelCount} of ${channelsList.length} channels <i class="fas fa-chevron-down" style="margin-left: 6px;"></i>`;
      grid.appendChild(loadMoreInfo);
    }
  }

  function createChannelCardElement(ch) {
    const card = document.createElement('div');
    card.className = `iptv-channel-card ${activeChannel && activeChannel.id === ch.id ? 'active' : ''}`;

    const logoUrl = ch.logo || ch.tvgLogo || '';
    const catLabel = ch.category || ch.groupTitle || 'Live';

    card.innerHTML = `
      <div class="iptv-ch-logo-wrap">
        ${logoUrl ? `<img src="${escapeHTML(logoUrl)}" class="iptv-ch-logo" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
        <div style="display: ${logoUrl ? 'none' : 'flex'}; align-items: center; justify-content: center; width: 100%; height: 100%; color: rgba(255,255,255,0.5);">
          <i class="fas fa-tv"></i>
        </div>
      </div>
      <div class="iptv-ch-details">
        <span class="iptv-ch-name" title="${escapeHTML(ch.name)}">${escapeHTML(ch.name)}</span>
        <div class="iptv-ch-meta">
          <span class="iptv-cat-badge">${escapeHTML(catLabel)}</span>
        </div>
      </div>
      <button class="iptv-ch-fav-btn ${ch.isFavorite ? 'active' : ''}" title="Toggle Favorite">
        <i class="${ch.isFavorite ? 'fas' : 'far'} fa-heart"></i>
      </button>
    `;

    card.onclick = (e) => {
      if (e.target.closest('.iptv-ch-fav-btn')) return;
      selectChannel(ch);
    };

    const favBtn = card.querySelector('.iptv-ch-fav-btn');
    if (favBtn) {
      favBtn.onclick = async (e) => {
        e.stopPropagation();
        const iptvMediaItem = {
          id: ch.id || `iptv_${encodeURIComponent(ch.name || ch.url)}`,
          type: 'iptv',
          media_type: 'iptv',
          title: ch.name || 'Live Channel',
          name: ch.name || 'Live Channel',
          poster_path: ch.logo || ch.tvgLogo || 'imgs/appicon-w.png',
          posterPath: ch.logo || ch.tvgLogo || 'imgs/appicon-w.png',
          backdrop_path: ch.logo || ch.tvgLogo || 'imgs/appicon-w.png',
          streamUrl: ch.url,
          url: ch.url,
          category: ch.category || ch.groupTitle || 'Live TV',
          groupTitle: ch.category || ch.groupTitle || 'Live TV'
        };
        if (typeof window.toggleWatchlist === 'function') {
          window.toggleWatchlist(iptvMediaItem);
        }
        ch.isFavorite = !ch.isFavorite;
        if (window.IptvStorage) {
          await window.IptvStorage.toggleFavorite(ch.id, ch.isFavorite);
        }
        updateIptvFavButtonState();
        const isFav = ch.isFavorite;
        favBtn.className = `iptv-ch-fav-btn ${isFav ? 'active' : ''}`;
        const icon = favBtn.querySelector('i');
        if (icon) icon.className = `${isFav ? 'fas' : 'far'} fa-heart`;
      };
    }

    return card;
  }

  // ─── Channel Selection & HLS Player ─────────────────────────────────────────

  function isChannelInWatchlist(ch) {
    if (!ch || !window.currentProfile || !window.currentProfile.watchlist) return false;
    const chId = ch.id || `iptv_${encodeURIComponent(ch.name || ch.url)}`;
    return window.currentProfile.watchlist.some(w => w.id === chId || w.id === ch.id || w.url === ch.url || w.streamUrl === ch.url);
  }

  window.isIptvPlaying = function() {
    const video = document.getElementById('iptv-video-player');
    return !!(video && !video.paused && !video.ended && activeChannel);
  };

  window.getCurrentIptvChannel = function() {
    return activeChannel;
  };

  window.updateIptvPlayerBarUI = function() {
    const bar = document.getElementById('radio-player-bar');
    if (!bar || !activeChannel) return;

    bar.classList.add('active');

    const titleEl = document.getElementById('radio-bar-title');
    const thumbEl = document.getElementById('radio-bar-thumb');
    const toggleBtn = document.getElementById('radio-bar-toggle');
    const stopBtn = document.getElementById('radio-bar-stop');
    const favBarBtn = document.getElementById('radio-bar-favorite');
    const volumeSlider = document.getElementById('radio-bar-volume');

    if (titleEl) {
      titleEl.textContent = activeChannel.name || 'IPTV Live';
      titleEl.onclick = () => window.switchView('iptv');
    }

    if (thumbEl) {
      thumbEl.onclick = () => window.switchView('iptv');
      const logo = activeChannel.logo || activeChannel.tvgLogo;
      if (logo) {
        thumbEl.innerHTML = `<img src="${localImg(logo)}" alt="tv" onerror="this.outerHTML='<i class=\\'fas fa-tv\\'></i>'">`;
      } else {
        thumbEl.innerHTML = `<i class="fas fa-tv"></i>`;
      }
    }

    if (toggleBtn) {
      const video = document.getElementById('iptv-video-player');
      const isPlaying = video && !video.paused;
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.className = `fas ${isPlaying ? 'fa-pause' : 'fa-play'}`;
      }
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleIptvPlayback();
      };
    }

    if (stopBtn) {
      stopBtn.onclick = (e) => {
        e.stopPropagation();
        stopIptvStream();
      };
    }

    if (volumeSlider) {
      const video = document.getElementById('iptv-video-player');
      if (video) volumeSlider.value = video.muted ? 0 : video.volume;
      volumeSlider.oninput = (e) => {
        if (!video) return;
        const val = parseFloat(e.target.value);
        video.volume = val;
        video.muted = (val === 0);
        const muteBtn = document.getElementById('iptv-mute-btn');
        if (muteBtn) {
          const icon = muteBtn.querySelector('i');
          if (icon) icon.className = 'fas ' + (video.muted || val === 0 ? 'fa-volume-mute' : val < 0.5 ? 'fa-volume-down' : 'fa-volume-up');
        }
      };
    }

    if (favBarBtn) {
      const isFav = isChannelInWatchlist(activeChannel);
      favBarBtn.classList.toggle('active', isFav);
      const icon = favBarBtn.querySelector('i');
      if (icon) {
        icon.className = isFav ? 'fas fa-heart' : 'far fa-heart';
        if (isFav) icon.style.color = '#ef4444';
        else icon.style.color = '';
      }
    }
  };

  function updateIptvFavButtonState() {
    const favBtn = document.getElementById('iptv-btn-favorite');
    const favIcon = document.getElementById('iptv-fav-icon');
    const favLabel = document.getElementById('iptv-fav-label');

    if (!activeChannel) return;
    const isFav = isChannelInWatchlist(activeChannel);

    if (favBtn) favBtn.classList.toggle('active', isFav);
    if (favIcon) {
      favIcon.className = isFav ? 'fas fa-heart' : 'far fa-heart';
    }
    if (favLabel) {
      favLabel.textContent = isFav ? 'Favorited' : 'Favorite';
    }
  }

  function selectChannel(channel) {
    if (!channel || !channel.url) return;
    activeChannel = channel;

    // Update active highlight in DOM
    document.querySelectorAll('.iptv-channel-card').forEach(card => card.classList.remove('active'));
    renderChannelList();

    const noChannel = document.getElementById('iptv-no-channel');
    if (noChannel) noChannel.style.display = 'none';

    const overlayChName = document.getElementById('iptv-overlay-ch-name');
    if (overlayChName) overlayChName.textContent = channel.name;

    const overlayQuality = document.getElementById('iptv-overlay-quality');
    if (overlayQuality) overlayQuality.textContent = channel.quality || 'HD';

    // Update bottom EPG metadata card
    const activeLogo = document.getElementById('iptv-active-logo');
    if (activeLogo) activeLogo.src = channel.logo || 'imgs/appicon-w.png';

    const activeTitle = document.getElementById('iptv-active-title');
    if (activeTitle) activeTitle.textContent = channel.name;

    const activeCat = document.getElementById('iptv-active-category');
    if (activeCat) activeCat.textContent = channel.category || channel.groupTitle || 'Live';

    const activeQual = document.getElementById('iptv-active-quality');
    if (activeQual) activeQual.textContent = channel.quality || '1080p';

    const epgCurrent = document.getElementById('iptv-epg-current');
    if (epgCurrent) epgCurrent.textContent = `Category: ${channel.category || channel.groupTitle || 'Live TV'}`;

    const epgNext = document.getElementById('iptv-epg-next');
    if (epgNext) epgNext.textContent = 'Live Broadcast (IPTV Stream)';

    if (typeof window.stopRadioStream === 'function') {
      try { window.stopRadioStream(); } catch (e) {}
    }

    updateIptvFavButtonState();
    playHlsStream(channel.url);
  }

  function playHlsStream(streamUrl) {
    const video = document.getElementById('iptv-video-player');
    const spinner = document.getElementById('iptv-spinner');
    const errorOverlay = document.getElementById('iptv-error-overlay');

    if (!video) return;

    if (spinner) spinner.style.display = 'flex';
    if (errorOverlay) errorOverlay.style.display = 'none';

    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }

    if (window.Hls && window.Hls.isSupported()) {
      hlsInstance = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });

      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(video);

      hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (spinner) spinner.style.display = 'none';
        video.play().catch(e => console.warn('[IPTV Autoplay]', e));
      });

      hlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
        console.warn('[IPTV HLS Error]', data);
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              if (spinner) spinner.style.display = 'none';
              if (errorOverlay) errorOverlay.style.display = 'flex';
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (spinner) spinner.style.display = 'none';
        video.play();
      });
    } else {
      if (spinner) spinner.style.display = 'none';
      if (errorOverlay) errorOverlay.style.display = 'flex';
    }
  }

  // ─── Source Operations & Web Worker Integration ──────────────────────────────

  async function syncSource(source) {
    if (typeof showToast === 'function') showToast(`🔄 Syncing source: ${source.name}...`);

    if (source.type === 'xtream') {
      try {
        const xtreamData = await iptvSmartersService.loadXtreamChannels(source);
        if (xtreamData && xtreamData.channels) {
          source.channelCount = xtreamData.channels.length;
          source.lastSync = Date.now();
          if (window.IptvStorage) {
            await window.IptvStorage.saveSource(source);
            await window.IptvStorage.cacheChannels(source.id, xtreamData.channels);
          }
          if (typeof showToast === 'function') showToast(`✅ Synced ${xtreamData.channels.length} channels`);
          loadActiveSourceChannels();
        }
      } catch (err) {
        if (typeof showToast === 'function') showToast(`❌ Sync failed: ${err.message}`);
      }
    } else if (source.url && source.url.startsWith('http')) {
      try {
        let text = '';
        try {
          const res = await fetch(source.url);
          text = await res.text();
        } catch (fetchErr) {
          console.warn('[IPTV Fetch Warning]', fetchErr);
        }

        if (text && worker) {
          worker.postMessage({ action: 'parse', sourceId: source.id, m3uText: text });
        } else if (text && window.api && typeof window.api.invoke === 'function') {
          const parsed = await window.api.invoke('iptv-parse-m3u-text', text);
          if (parsed && parsed.channels && parsed.channels.length > 0) {
            source.channelCount = parsed.channels.length;
            source.lastSync = Date.now();
            if (window.IptvStorage) {
              await window.IptvStorage.saveSource(source);
              await window.IptvStorage.cacheChannels(source.id, parsed.channels);
            }
            if (typeof showToast === 'function') showToast(`✅ Synced ${parsed.channels.length} channels`);
            loadActiveSourceChannels();
          }
        } else {
          // Fallback to built-in default channels if network fetch yielded nothing
          source.channelCount = DEFAULT_CHANNELS.length;
          source.lastSync = Date.now();
          if (window.IptvStorage) {
            await window.IptvStorage.saveSource(source);
            await window.IptvStorage.cacheChannels(source.id, DEFAULT_CHANNELS);
          }
          if (typeof showToast === 'function') showToast(`✅ Synced ${DEFAULT_CHANNELS.length} default channels`);
          loadActiveSourceChannels();
        }
      } catch (err) {
        console.warn('[IPTV Sync Error]', err);
        // Ensure channels are available
        source.channelCount = DEFAULT_CHANNELS.length;
        if (window.IptvStorage) {
          await window.IptvStorage.cacheChannels(source.id, DEFAULT_CHANNELS);
        }
        loadActiveSourceChannels();
      }
    }
  }

  function handleWorkerMessage(e) {
    const { type, sourceId, channels } = e.data || {};
    if (type === 'complete' && sourceId && channels) {
      const source = sourcesList.find(s => s.id === sourceId);
      if (source) {
        source.channelCount = channels.length;
        source.lastSync = Date.now();
        if (window.IptvStorage) {
          window.IptvStorage.saveSource(source);
          window.IptvStorage.cacheChannels(sourceId, channels).then(() => {
            if (activeSourceId === sourceId) loadActiveSourceChannels();
          });
        }
      }
      if (typeof showToast === 'function') showToast(`✅ Parsed ${channels.length} channels via Worker`);
    }
  }

  async function deleteSource(sourceId) {
    if (!confirm('Are you sure you want to delete this IPTV source?')) return;
    sourcesList = sourcesList.filter(s => s.id !== sourceId);
    if (window.IptvStorage) {
      await window.IptvStorage.deleteSource(sourceId);
    }
    if (activeSourceId === sourceId) {
      activeSourceId = sourcesList[0]?.id || null;
    }
    renderSourcesList();
    loadActiveSourceChannels();
  }

  let searchDebounceTimer = null;

  function bindEvents() {
    const searchInput = document.getElementById('iptv-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        const val = e.target.value.toLowerCase().trim();
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          searchQuery = val;
          loadActiveSourceChannels();
        }, 200);
      };
    }

    const addSourceBtn = document.getElementById('iptv-btn-add-source');
    if (addSourceBtn) {
      addSourceBtn.onclick = () => openAddSourceModal();
    }

    const syncAllBtn = document.getElementById('iptv-btn-sync-all');
    if (syncAllBtn) {
      syncAllBtn.onclick = () => {
        sourcesList.forEach(s => syncSource(s));
      };
    }

    const retryBtn = document.getElementById('iptv-error-retry');
    if (retryBtn) {
      retryBtn.onclick = () => {
        if (activeChannel) selectChannel(activeChannel);
      };
    }

    // Video Player Controls & State Binding
    const video = document.getElementById('iptv-video-player');
    const playerWrap = document.getElementById('iptv-player-wrap');

    if (video) {
      video.onplay = () => updateIptvPlayButtonsUI(true);
      video.onpause = () => updateIptvPlayButtonsUI(false);
      video.onplaying = () => updateIptvPlayButtonsUI(true);
    }

    const iptvFavBtn = document.getElementById('iptv-btn-favorite');
    if (iptvFavBtn) {
      iptvFavBtn.onclick = () => {
        if (!activeChannel) return;
        const iptvMediaItem = {
          id: activeChannel.id || `iptv_${encodeURIComponent(activeChannel.name || activeChannel.url)}`,
          type: 'iptv',
          media_type: 'iptv',
          title: activeChannel.name || 'Live Channel',
          name: activeChannel.name || 'Live Channel',
          poster_path: activeChannel.logo || activeChannel.tvgLogo || 'imgs/appicon-w.png',
          posterPath: activeChannel.logo || activeChannel.tvgLogo || 'imgs/appicon-w.png',
          backdrop_path: activeChannel.logo || activeChannel.tvgLogo || 'imgs/appicon-w.png',
          streamUrl: activeChannel.url,
          url: activeChannel.url,
          category: activeChannel.category || activeChannel.groupTitle || 'Live TV',
          groupTitle: activeChannel.category || activeChannel.groupTitle || 'Live TV'
        };

        if (typeof window.toggleWatchlist === 'function') {
          window.toggleWatchlist(iptvMediaItem);
          updateIptvFavButtonState();
          renderChannelList();
        }
      };
    }

    const reloadBtn = document.getElementById('iptv-btn-reload-stream');
    if (reloadBtn) {
      reloadBtn.onclick = () => {
        if (activeChannel) playHlsStream(activeChannel.url);
      };
    }

    document.addEventListener('iptv-reload-channel', () => {
      if (activeChannel && activeChannel.url) {
        playHlsStream(activeChannel.url);
      }
    });

    const pipBtn = document.getElementById('iptv-pip-btn');
    if (pipBtn && video && document.pictureInPictureEnabled) {
      pipBtn.onclick = async () => {
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else {
            await video.requestPictureInPicture();
          }
        } catch (e) {
          console.warn('[PiP Error]', e);
        }
      };
    }

    const fsBtn = document.getElementById('iptv-fs-btn');
    if (fsBtn && playerWrap) {
      fsBtn.onclick = () => {
        if (!document.fullscreenElement) {
          playerWrap.requestFullscreen().catch(e => console.warn(e));
        } else {
          document.exitFullscreen().catch(e => console.warn(e));
        }
      };
    }
  }

  function openAddSourceModal() {
    const existing = document.getElementById('iptv-add-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'iptv-add-modal';
    modal.className = 'iptv-modal-overlay';
    modal.innerHTML = `
      <div class="iptv-modal-card">
        <div class="iptv-modal-header" style="margin-bottom: 24px;">
          <h3 style="margin: 0; color: #fff; font-size: 1.25rem; font-weight: 800; display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-plus-circle" style="color: #ffffff;"></i> Add IPTV Source
          </h3>
          <button class="iptv-modal-close" id="btn-close-iptv-modal" title="Close"><i class="fas fa-times"></i></button>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 24px;">
          <button type="button" class="iptv-cat-pill active" id="tab-m3u-url" style="flex: 1; padding: 10px; border-radius: 12px; font-weight: 800; text-align: center;">M3U URL</button>
          <button type="button" class="iptv-cat-pill" id="tab-xtream" style="flex: 1; padding: 10px; border-radius: 12px; font-weight: 800; text-align: center;">Xtream Codes</button>
        </div>

        <form id="iptv-source-form" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">Source Name</label>
            <input type="text" id="iptv-input-name" class="iptv-modal-input" placeholder="e.g. Default Channels" required>
          </div>

          <div id="field-m3u-url">
            <label style="font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">M3U Playlist URL</label>
            <input type="url" id="iptv-input-url" class="iptv-modal-input" placeholder="https://example.com/playlist.m3u">

            <div style="margin-top: 14px;">
              <span style="font-size: 0.78rem; font-weight: 700; color: rgba(255,255,255,0.5); display: block; margin-bottom: 8px;">Quick Presets (IPTV-Org):</span>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button type="button" class="iptv-cat-pill" id="preset-iptv-ara" style="font-size: 0.78rem; padding: 6px 14px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff;">🌐 IPTV-Org Arabic</button>
                <button type="button" class="iptv-cat-pill" id="preset-iptv-global" style="font-size: 0.78rem; padding: 6px 14px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff;">🌍 IPTV-Org Global</button>
              </div>
            </div>
          </div>

          <div id="field-xtream" style="display: none; flex-direction: column; gap: 12px;">
            <div>
              <label style="font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.7); display: block; margin-bottom: 6px;">Server URL</label>
              <input type="text" id="iptv-input-server" class="iptv-modal-input" placeholder="http://example.com:8080">
            </div>
            <div>
              <label style="font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.7); display: block; margin-bottom: 6px;">Username</label>
              <input type="text" id="iptv-input-user" class="iptv-modal-input" placeholder="Username">
            </div>
            <div>
              <label style="font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.7); display: block; margin-bottom: 6px;">Password</label>
              <input type="password" id="iptv-input-pass" class="iptv-modal-input" placeholder="Password">
            </div>
          </div>

          <button type="submit" class="iptv-add-source-btn" style="margin-top: 12px; height: 46px; background: #ffffff !important; color: #000000 !important; font-weight: 800; border-radius: 14px; box-shadow: 0 4px 15px rgba(255,255,255,0.25);">Save & Parse Source</button>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    let sourceType = 'm3u_url';
    const tabUrl = modal.querySelector('#tab-m3u-url');
    const tabXtream = modal.querySelector('#tab-xtream');
    const fieldUrl = modal.querySelector('#field-m3u-url');
    const fieldXtream = modal.querySelector('#field-xtream');
    const closeBtn = modal.querySelector('#btn-close-iptv-modal');

    closeBtn.onclick = () => modal.remove();

    tabUrl.onclick = () => {
      sourceType = 'm3u_url';
      tabUrl.classList.add('active');
      tabXtream.classList.remove('active');
      fieldUrl.style.display = 'block';
      fieldXtream.style.display = 'none';
    };

    tabXtream.onclick = () => {
      sourceType = 'xtream';
      tabXtream.classList.add('active');
      tabUrl.classList.remove('active');
      fieldUrl.style.display = 'none';
      fieldXtream.style.display = 'flex';
    };

    const presetAra = modal.querySelector('#preset-iptv-ara');
    const presetGlobal = modal.querySelector('#preset-iptv-global');
    if (presetAra) {
      presetAra.onclick = () => {
        modal.querySelector('#iptv-input-name').value = 'IPTV-Org Arabic';
        modal.querySelector('#iptv-input-url').value = 'https://iptv-org.github.io/iptv/languages/ara.m3u';
      };
    }
    if (presetGlobal) {
      presetGlobal.onclick = () => {
        modal.querySelector('#iptv-input-name').value = 'IPTV-Org Global';
        modal.querySelector('#iptv-input-url').value = 'https://iptv-org.github.io/iptv/index.m3u';
      };
    }

    modal.querySelector('#iptv-source-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = modal.querySelector('#iptv-input-name').value.trim();
      const sourceId = 'src_' + Date.now();

      if (sourceType === 'm3u_url') {
        const url = modal.querySelector('#iptv-input-url').value.trim();
        if (!url) return;

        const newSource = { id: sourceId, name, type: 'url', url, channelCount: 0, lastSync: Date.now() };
        sourcesList.push(newSource);
        if (window.IptvStorage) await window.IptvStorage.saveSource(newSource);
        activeSourceId = sourceId;
        renderSourcesList();
        syncSource(newSource);
      } else {
        const serverUrl = modal.querySelector('#iptv-input-server').value.trim();
        const username = modal.querySelector('#iptv-input-user').value.trim();
        const password = modal.querySelector('#iptv-input-pass').value.trim();

        if (!serverUrl || !username || !password) return;

        const newSource = { id: sourceId, name, type: 'xtream', serverUrl, username, password, channelCount: 0, lastSync: Date.now() };
        sourcesList.push(newSource);
        if (window.IptvStorage) await window.IptvStorage.saveSource(newSource);
        activeSourceId = sourceId;
        renderSourcesList();
        syncSource(newSource);
      }

      modal.remove();
    };
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stopIptvStream() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (e) {}
      hlsInstance = null;
    }
    const video = document.getElementById('iptv-video-player');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    activeChannel = null;
    const noChannel = document.getElementById('iptv-no-channel');
    if (noChannel) noChannel.style.display = 'flex';
    const bar = document.getElementById('radio-player-bar');
    if (bar) bar.classList.remove('active');
  }

  function toggleIptvPlayback() {
    const video = document.getElementById('iptv-video-player');
    if (!video) return;
    if (video.paused || video.ended) {
      const p = video.play();
      if (p !== undefined) {
        p.then(() => updateIptvPlayButtonsUI(true)).catch(e => {
          console.warn('[IPTV] Play error:', e);
          updateIptvPlayButtonsUI(false);
        });
      }
    } else {
      video.pause();
      updateIptvPlayButtonsUI(false);
    }
  }

  function updateIptvPlayButtonsUI(isPlaying) {
    const playBtn = document.getElementById('iptv-play-btn');
    const radioToggleBtn = document.getElementById('radio-bar-toggle');

    if (playBtn) playBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    if (radioToggleBtn) {
      const icon = radioToggleBtn.querySelector('i');
      if (icon) icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }
  }

  // Export module globally
  window.initIptvView = initIptvView;
  window.stopIptvStream = stopIptvStream;
  window.toggleIptvPlayback = toggleIptvPlayback;
})();
