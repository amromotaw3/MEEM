/**
 * iptv-player-controls.js
 * MediaVault — Premium Live TV Player Controller
 * Handles: play/pause, mute/volume, fullscreen, PiP,
 *          buffering UI, live latency display, auto-idle
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let videoEl = null;
  let idleTimer = null;
  let latencyInterval = null;
  let liveBarAnimFrame = null;
  let lastLatencySec = null;
  let isIdle = false;
  let initialized = false;

  // ── DOM refs (populated in init) ──────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Latency helpers ────────────────────────────────────────────────────────
  function getHlsLatency(hls) {
    // hls.js exposes latency as latency property (v1.x)
    if (hls && typeof hls.latency === 'number' && hls.latency > 0) {
      return Math.round(hls.latency);
    }
    // Fallback: compute from video.buffered
    if (videoEl && videoEl.buffered && videoEl.buffered.length > 0) {
      const buffEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
      const diff = buffEnd - videoEl.currentTime;
      if (diff >= 0) return Math.round(diff);
    }
    return null;
  }

  function formatLatency(sec) {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return `${sec}s delay`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s delay`;
  }

  function updateLatencyChip() {
    const latencyVal = $('iptv-latency-val');
    const barLabel   = $('iptv-bar-latency-label');
    const timeDisp   = $('iptv-time-display');

    // Try to get hls instance from the iptv module
    const hls = window._iptvHlsInstance || null;
    const sec = getHlsLatency(hls);
    lastLatencySec = sec;

    const label = formatLatency(sec);
    if (latencyVal)  latencyVal.textContent  = label;
    if (barLabel)    barLabel.textContent    = sec !== null ? `~${sec}s behind live` : 'LIVE EDGE';

    // Time display
    if (timeDisp) {
      if (sec !== null && sec > 5) {
        timeDisp.textContent = `🔴 -${label}`;
      } else {
        timeDisp.textContent = '🔴 LIVE';
      }
    }
  }

  // ── Live bar animation ─────────────────────────────────────────────────────
  // The bar fill slowly approaches 100% to simulate a live clock,
  // then resets — giving a visual "marching" feel without real VOD data.
  let liveBarPct = 97; // starts near full
  function animateLiveBar() {
    liveBarPct += 0.004; // very slow march
    if (liveBarPct > 100) liveBarPct = 97;
    const fill = $('iptv-live-fill');
    if (fill) fill.style.width = liveBarPct + '%';
    liveBarAnimFrame = requestAnimationFrame(animateLiveBar);
  }

  // ── Idle / show-controls logic ─────────────────────────────────────────────
  function showControls() {
    const wrap = $('iptv-player-wrap');
    if (!wrap) return;
    wrap.classList.remove('player-idle');
    isIdle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, 4000);
  }

  function goIdle() {
    const wrap = $('iptv-player-wrap');
    if (wrap && videoEl && !videoEl.paused) {
      wrap.classList.add('player-idle');
      isIdle = true;
    }
  }

  // ── Spinner helpers ────────────────────────────────────────────────────────
  function showSpinner(msg) {
    const spinner = $('iptv-spinner');
    const txtEl   = spinner && spinner.querySelector('.iptv-spinner-text');
    if (spinner)  spinner.classList.add('active');
    if (txtEl && msg) txtEl.textContent = msg;
  }

  function hideSpinner() {
    const spinner = $('iptv-spinner');
    if (spinner) spinner.classList.remove('active');
  }

  // ── Error overlay helpers ─────────────────────────────────────────────────
  function showError(msg) {
    const ov  = $('iptv-error-overlay');
    const txt = $('iptv-error-msg');
    if (txt) txt.textContent = msg || 'Stream offline or geo-blocked';
    if (ov)  ov.classList.add('active');
    hideSpinner();
  }

  function hideError() {
    const ov = $('iptv-error-overlay');
    if (ov) ov.classList.remove('active');
  }

  // ── No-channel placeholder ─────────────────────────────────────────────────
  function showNoChannel() {
    const nc = $('iptv-no-channel');
    if (nc) nc.classList.remove('hidden');
  }

  function hideNoChannel() {
    const nc = $('iptv-no-channel');
    if (nc) nc.classList.add('hidden');
  }

  // ── Channel name + quality overlay sync ───────────────────────────────────
  function syncOverlayMeta(channel) {
    const nameEl = $('iptv-overlay-ch-name');
    const qualEl = $('iptv-overlay-quality');
    if (nameEl) nameEl.textContent = channel ? channel.name : '—';
    if (qualEl) qualEl.textContent = channel ? (channel.quality || 'HD') : 'HD';
  }

  // ── Volume helpers ─────────────────────────────────────────────────────────
  function updateVolumeIcon(vol, muted) {
    const muteBtn = $('iptv-mute-btn');
    if (!muteBtn) return;
    const icon = muteBtn.querySelector('i');
    if (!icon) return;
    icon.className = 'fas ' + (
      muted || vol === 0 ? 'fa-volume-mute' :
      vol < 0.5          ? 'fa-volume-down' :
                           'fa-volume-up'
    );
  }

  // ── Fullscreen helpers ─────────────────────────────────────────────────────
  function toggleFullscreen() {
    const wrap = $('iptv-player-wrap');
    if (!wrap) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrap.requestFullscreen().catch(e => console.warn('[IPTV Player] FS error:', e));
    }
  }

  function updateFsIcon() {
    const btn  = $('iptv-fs-btn');
    const icon = btn && btn.querySelector('i');
    if (icon) {
      icon.className = 'fas ' + (document.fullscreenElement ? 'fa-compress' : 'fa-expand');
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (initialized) return;
    videoEl = $('iptv-video-player');
    if (!videoEl) return;
    initialized = true;

    // Grab buttons
    const playBtn   = $('iptv-play-btn');
    const muteBtn   = $('iptv-mute-btn');
    const volSlider = $('iptv-vol-slider');
    const fsBtn     = $('iptv-fs-btn');
    const pipBtn    = $('iptv-pip-btn');
    const skipBack  = $('iptv-skip-back');
    const reloadBtn = $('iptv-btn-reload-stream');
    const jumpLive  = $('iptv-jump-live');
    const errRetry  = $('iptv-error-retry');
    const wrap      = $('iptv-player-wrap');

    // ── Play / Pause ──
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (videoEl.paused) {
          videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
        showControls();
      });
    }

    videoEl.addEventListener('play', () => {
      const icon = playBtn && playBtn.querySelector('i');
      if (icon) icon.className = 'fas fa-pause';
      hideError();
      showControls();
    });

    videoEl.addEventListener('pause', () => {
      const icon = playBtn && playBtn.querySelector('i');
      if (icon) icon.className = 'fas fa-play';
    });

    // ── Buffering spinner ──
    videoEl.addEventListener('waiting',  () => showSpinner('Buffering…'));
    videoEl.addEventListener('stalled',  () => showSpinner('Loading…'));
    videoEl.addEventListener('playing',  () => { hideSpinner(); hideError(); hideNoChannel(); });
    videoEl.addEventListener('canplay',  hideSpinner);
    videoEl.addEventListener('error',    () => {
      hideSpinner();
      showError('Unable to play stream');
    });

    // ── Volume ──
    if (volSlider) {
      volSlider.addEventListener('input', () => {
        videoEl.volume = parseFloat(volSlider.value);
        videoEl.muted  = (videoEl.volume === 0);
        updateVolumeIcon(videoEl.volume, videoEl.muted);
        showControls();
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        videoEl.muted = !videoEl.muted;
        if (volSlider) volSlider.value = videoEl.muted ? 0 : videoEl.volume;
        updateVolumeIcon(videoEl.volume, videoEl.muted);
        showControls();
      });
    }

    videoEl.addEventListener('volumechange', () => {
      if (volSlider) volSlider.value = videoEl.muted ? 0 : videoEl.volume;
      updateVolumeIcon(videoEl.volume, videoEl.muted);
    });

    // ── Fullscreen ──
    if (fsBtn) {
      fsBtn.addEventListener('click', () => { toggleFullscreen(); showControls(); });
    }
    document.addEventListener('fullscreenchange', updateFsIcon);

    // ── PiP ──
    if (pipBtn) {
      pipBtn.addEventListener('click', async () => {
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else {
            await videoEl.requestPictureInPicture();
          }
        } catch (e) {
          console.warn('[IPTV Player] PiP error:', e.message);
        }
        showControls();
      });
    }

    // ── Skip back 10s (catchup) ──
    if (skipBack) {
      skipBack.addEventListener('click', () => {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        showControls();
      });
    }

    // ── Reload ──
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        const evt = new CustomEvent('iptv-reload-channel');
        document.dispatchEvent(evt);
        showSpinner('Reloading…');
        showControls();
      });
    }

    // ── Jump to live edge ──
    if (jumpLive) {
      jumpLive.addEventListener('click', () => {
        const hls = window._iptvHlsInstance;
        if (hls && hls.liveSyncPosition) {
          videoEl.currentTime = hls.liveSyncPosition;
        } else if (videoEl.seekable && videoEl.seekable.length > 0) {
          videoEl.currentTime = videoEl.seekable.end(videoEl.seekable.length - 1);
        }
        videoEl.play().catch(() => {});
        showControls();
      });
    }

    // ── Error retry ──
    if (errRetry) {
      errRetry.addEventListener('click', () => {
        hideError();
        const evt = new CustomEvent('iptv-reload-channel');
        document.dispatchEvent(evt);
        showSpinner('Retrying…');
      });
    }

    // ── Idle / mouse movement ──
    if (wrap) {
      wrap.addEventListener('mousemove', showControls);
      wrap.addEventListener('click', showControls);
      // Double-click = fullscreen
      wrap.addEventListener('dblclick', toggleFullscreen);
    }

    // Click on video itself = toggle play/pause
    videoEl.addEventListener('click', () => {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    });

    // ── Start live bar animation ──
    animateLiveBar();

    // ── Latency polling every 2s ──
    latencyInterval = setInterval(updateLatencyChip, 2000);
    updateLatencyChip();

    // ── Expose helpers for iptv.js ──────────────────────────────────────────
    window.iptvPlayerUI = {
      showSpinner,
      hideSpinner,
      showError,
      hideError,
      showNoChannel,
      hideNoChannel,
      syncOverlayMeta,
      showControls
    };
  }

  // ── Wait for DOM ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Defer slightly so iptv.js DOM injection finishes
    setTimeout(init, 500);
  }

  // Re-init if view changes (iptv view activated)
  document.addEventListener('iptv-view-activated', () => {
    if (!initialized) init();
  });

})();
