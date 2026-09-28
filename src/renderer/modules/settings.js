(function () {
  'use strict';

  function renderSettings() {
    if ($('#config-torrentio')) $('#config-torrentio').value = appData.scraperConfig?.torrentio || appData.scraperConfig?.torrentio_url || 'https://torrentio.strem.fun';
    if ($('#config-remote-server')) $('#config-remote-server').value = appData.remoteStreamingServer || '';

    if ($('#update-auto-check')) $('#update-auto-check').checked = appData.autoUpdate !== false;
    if ($('#mobile-internal-downloader')) $('#mobile-internal-downloader').checked = appData.mobileInternalDownloader !== false;
    if ($('#pref-video-trailers')) $('#pref-video-trailers').checked = appData.enableVideoTrailers !== false;

    // Dynamically show/hide settings cards and options based on installed Mods/Addons
    if (window.AppCapabilities && typeof window.AppCapabilities.refresh === 'function') {
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

    const hasTmdbMod = hasAddon(['tmdb', 'tmdb-addon', 'tmdb.elfhosted', 'com.mediavault.tmdb']);
    const hasSubdlMod = hasAddon(['subdl', 'opensubtitles', 'subscene', 'com.mediavault.subdl']);
    const hasTraktMod = hasAddon(['trakt', 'mytrakt', 'com.mediavault.trakt']);

    const hasYoutubeMod = window.AppCapabilities ? window.AppCapabilities.can('youtube') : addons.some(a => {
      if (a.enabled === false) return false;
      const id = String(a.id || '').toLowerCase();
      const url = String(a.url || a.manifestUrl || '').toLowerCase();
      const name = String(a.name || '').toLowerCase();
      return id === 'com.mediavault.youtube' || url.includes('addon-youtube') || (id.includes('youtube') && !id.includes('music') && !id.includes('ytmusic')) || (name === 'youtube' || name.includes('youtube addon'));
    });

    const hasStreamMod = addons.some(a => {
      if (a.enabled === false) return false;
      const res = Array.isArray(a.resources) ? a.resources : [];
      const hasStreamRes = res.some(r => (typeof r === 'string' ? r : r?.name) === 'stream');
      const u = String(a.url || a.manifestUrl || '').toLowerCase();
      const id = String(a.id || '').toLowerCase();
      const name = String(a.name || '').toLowerCase();
      return hasStreamRes || u.includes('torrentio') || id.includes('torrentio') || name.includes('torrentio') || u.includes('stream') || id.includes('stream');
    });

    const tmdbCard = $('#tmdb-connection-card');
    if (tmdbCard) tmdbCard.style.display = hasTmdbMod ? '' : 'none';

    const subdlCard = $('#subdl-connection-card');
    if (subdlCard) subdlCard.style.display = hasSubdlMod ? '' : 'none';

    const traktCard = $('#trakt-connection-card');
    if (traktCard) traktCard.style.display = hasTraktMod ? '' : 'none';

    // YouTube Mod-Gated Settings
    const ytQualityRow = $('#setting-row-youtube-quality');
    if (ytQualityRow) ytQualityRow.style.display = hasYoutubeMod ? 'flex' : 'none';

    // Stream Mod-Gated Auto-Play Card
    const smartAutoPlayCard = $('#smart-autoplay-settings-card');
    if (smartAutoPlayCard) smartAutoPlayCard.style.display = hasStreamMod ? '' : 'none';

    if ($('#select-youtube-quality') && window.appData?.youtubeQuality) {
      $('#select-youtube-quality').value = window.appData.youtubeQuality;
    }
  }

  function renderSettingsFolders() {
    const c = $('#settings-folders-list');
    if (!c) return;
    c.innerHTML = '';
    (appData.libraryFolders || []).forEach((fp, i) => {
      const el = document.createElement('div');
      el.className = 'sidebar-folder-item';
      el.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="fi-path">${fp}</span><button class="fi-remove" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      el.querySelector('.fi-remove').onclick = e => {
        e.stopPropagation();
        appData.libraryFolders.splice(i, 1);
        persist();
        renderSettingsFolders();
        if (typeof renderSidebarFolders === 'function') renderSidebarFolders();
        if (typeof scanLibrary === 'function') scanLibrary();
      };
      c.appendChild(el);
    });
  }

  function updateZoom(delta) {
    let current = appData.zoomFactor || 1;
    if (delta === 0) current = 1;
    else current = Math.max(0.5, Math.min(2.0, current + delta));
    appData.zoomFactor = current;
    persist();
    if (window.api && window.api.setZoom) window.api.setZoom(current);
  }

  // Setup click and input handlers once DOM loaded or during execution
  const setupSettingsHandlers = () => {
    // Auto-save preference toggles on change
    const trailersCb = $('#pref-video-trailers');
    if (trailersCb) {
      trailersCb.onchange = () => {
        appData.enableVideoTrailers = trailersCb.checked;
        if (!appData.enableVideoTrailers && typeof stopBackgroundTrailer === 'function') {
          stopBackgroundTrailer();
        }
        persist();
      };
    }

    const downloaderCb = $('#mobile-internal-downloader');
    if (downloaderCb) {
      downloaderCb.onchange = () => {
        appData.mobileInternalDownloader = downloaderCb.checked;
        persist();
      };
    }

    const updateCb = $('#update-auto-check');
    if (updateCb) {
      updateCb.onchange = () => {
        appData.autoUpdate = updateCb.checked;
        persist();
      };
    }

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

        if (window.api && window.api.clearCache) await window.api.clearCache();
        persist();
        showToast('Cache and Images Cleared! Please rescan library.');
        setTimeout(() => {
          btnClearCache.disabled = false;
          btnClearCache.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear TMDB Cache & Images';
        }, 2000);
      };
    }

    const btnZoomIn = $("#btn-zoom-in");
    if (btnZoomIn) btnZoomIn.onclick = () => updateZoom(0.1);

    const btnZoomOut = $("#btn-zoom-out");
    if (btnZoomOut) btnZoomOut.onclick = () => updateZoom(-0.1);

    const btnZoomReset = $("#btn-zoom-reset");
    if (btnZoomReset) btnZoomReset.onclick = () => updateZoom(0);

    const btnClearHistory = $('#btn-clear-history');
    if (btnClearHistory) {
      btnClearHistory.onclick = () => {
        appData.downloadHistory = [];
        persist();
        if (typeof renderDownloadHistory === 'function') renderDownloadHistory();
        showToast('History Cleared');
      };
    }

    const btnTestVlc = $('#btn-test-vlc');
    if (btnTestVlc) {
      btnTestVlc.onclick = async () => {
        btnTestVlc.disabled = true;
        showToast('Launching VLC with MEEM Skin...');
        try {
          if (window.api && window.api.invoke) {
            const res = await window.api.invoke('open-in-vlc', {});
            if (res && res.success) {
              showToast('VLC opened successfully with MEEM Skin!');
            } else {
              showToast('Failed to open VLC: ' + (res?.error || 'Unknown error'));
            }
          }
        } catch (e) {
          showToast('Error launching VLC: ' + e.message);
        } finally {
          btnTestVlc.disabled = false;
        }
      };
    }

    const btnLaunchMeemPlayer = $('#btn-launch-meem-player');
    if (btnLaunchMeemPlayer) {
      btnLaunchMeemPlayer.onclick = async () => {
        btnLaunchMeemPlayer.disabled = true;
        showToast('🚀 Starting MEEM Player...');
        try {
          if (window.api && window.api.invoke) {
            const res = await window.api.invoke('open-in-meem-player', { launchOnly: true });
            if (res && res.success) {
              showToast('✅ MEEM Player launched successfully!');
            } else {
              showToast('⚠️ Could not launch MEEM Player: ' + (res?.error || 'Executable not found'));
            }
          }
        } catch (e) {
          showToast('❌ Error launching MEEM Player: ' + e.message);
        } finally {
          btnLaunchMeemPlayer.disabled = false;
        }
      };
    }

    const selYtQuality = $('#select-youtube-quality');
    if (selYtQuality) {
      if (window.appData && window.appData.youtubeQuality) {
        selYtQuality.value = window.appData.youtubeQuality;
      }
      selYtQuality.onchange = () => {
        window.appData = window.appData || {};
        window.appData.youtubeQuality = selYtQuality.value;
        if (typeof window.persist === 'function') window.persist();
        if (typeof showToast === 'function') {
          showToast(`YouTube Quality set to: ${selYtQuality.options[selYtQuality.selectedIndex]?.text || selYtQuality.value}`);
        }
      };
    }
  };

  // Run setup when the file loads or on request
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSettingsHandlers);
  } else {
    setupSettingsHandlers();
  }

  // Expose settings functions to window
  window.renderSettings = renderSettings;
  window.renderSettingsFolders = renderSettingsFolders;
  window.updateZoom = updateZoom;

})();
