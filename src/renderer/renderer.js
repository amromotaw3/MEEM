const SVG_MUSIC = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

(async function () {
  'use strict';

  // Helper: Convert a local file path to a protocol URL that works with webSecurity=true
  // Returns the original value if it's already a URL (http/https/data:)
  const APP_VERSION = '8.5.4'; // Sync with package.json
  function localImg(p) { if (!p) return ""; if (p.startsWith("http") || p.startsWith("data:") || p.startsWith("blob:") || p.startsWith("src/") || p.startsWith("assets/") || p.startsWith("imgs/")) return p; if (window.api && window.api.isElectron) { const safePath = p.replace(/\\/g, "/"); const encodedPath = encodeURI(safePath).replace(/#/g, "%23").replace(/\?/g, "%3F"); return "local-file:///" + encodedPath; } return p; }

  function getMusicMeta(item) {
    if (!item) return { title: 'Unknown', artist: 'Unknown Artist', cover: null };
    const custom = appData.banners[item.id];
    const override = appData.musicMetadata[item.id] || {};
    return {
      title: override.title || item.title || item.filename?.replace(/\.[^/.]+$/, '') || 'Unknown Title',
      artist: override.artist || item.artist || 'Unknown Artist',
      cover: custom || override.cover || item.cover
    };
  }

  function refreshCurrentView() {
    if (currentView === 'movies') renderMovies();
    else if (currentView === 'shows') renderShows();
    else if (currentView === 'social') renderSocial();
    else if (currentView === 'music') renderMusic();
    else if (currentView === 'discover') renderDiscover();
    else if (currentView === 'watchlist') renderWatchlist();
    updateBadges();
  }

  // ── State ──
  let appData = {
    libraryFolders: [], libraryPath: '', movies: [], shows: [], music: [],
    thumbnails: {}, banners: {}, pinned: [], lastView: 'movies',
    tmdbCache: {}, downloadHistory: [], theme: 'dark', downloadPath: '',
    youtubeFolder: '', youtubeVideos: [], socialVideos: [], uiState: { collapsedGroups: [] },
    tmdbKey: null,
    profiles: [], // { id, name, avatar, playback: {}, watchlist: [], pinned: [], vaultPin: null, lockedItems: [] }
    activeProfileId: null,
    musicMetadata: {}, // { itemId: { title, artist, album, cover } }
    eqGains: [0, 0, 0, 0, 0],
    eqPreset: 'flat',
    autoUpdate: true,
    firstRun: true,
    remoteStreamingServer: '192.168.31.125' // Default PC IP for mobile streaming
  };

  let currentProfileId = null; // Defined here to match init logic
  let isEditingProfiles = false;

  const AVATARS = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Jack',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Sasha',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Bubba',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Midnight',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Shadow'
  ];

  let currentProfile = null;

  let currentView = 'movies', prevView = 'discover', discoverStack = [], currentDiscoverItem = null, playerSourceView = null, currentShowId = null, currentShow = null, currentEpisodes = [], currentEpisodeIndex = -1;
  let isDiscoverLoading = false; // Moved here to prevent hoisting errors
  let contextTarget = null;
  let isFullscreen = false, autoNextTimer = null, panelOpen = false, currentItem = null, currentMediaMetadata = null, isVaultUnlocked = false;
  let isSeeking = false, isPlayingMusic = false, saveInterval = null, ctrlTimeout = null;
  let subtitleTrack = null, subtitlesEnabled = false, currentPart = null;
  let editingProfileId = null; // Track if we are editing a profile
  let currentAudioTrackIndex = -1, currentInternalSubIndex = -1;
  let analyser = null, dataArray = null, visualizerAnim = null; // Visualizer state
  let currentStreamUrl = null; // The actual playback URL (differs from item.path for torrent streams)

  let currentDlType = 'youtube'; // 'youtube', 'tiktok', 'instagram', 'direct', 'series'
  const activeDownloads = new Map();
  const TMDB_IMG = 'https://image.tmdb.org/t/p';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let subCurrentDir = ''; // Current subdirectory in Subtitle Center
  let playerSubCurrentDir = ''; // Current subdirectory in Player Sidebar
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
  // PlayerEngine — HTML5 <video>
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

      this._initHtml5Listeners();
      this._watchdogTimer = null;
      this._isRadio = false;
    }

    _initHtml5Listeners() {
      this._video.addEventListener('ended', () => {
        this._emit('ended');
      });
      this._video.addEventListener('timeupdate', () => {
        if (!isSeeking) {
          this._currentTime = this._video.currentTime;
          this._emit('timeupdate', this._currentTime);
        }
      });
      this._video.addEventListener('durationchange', () => {
        this._duration = this._video.duration;
        this._emit('durationchange', this._duration);
      });
      this._video.addEventListener('pause', () => {
        this._paused = true;
        this._emit('pausechange', true);
      });
      this._video.addEventListener('play', () => {
        this._paused = false;
        this._emit('pausechange', false);
      });
      this._video.addEventListener('error', (e) => {
        const err = this._video.error;
        let msg = 'Media playback error';
        if (err) {
          if (err.code === 1) msg = 'Playback aborted';
          if (err.code === 2) msg = 'Network error';
          if (err.code === 3) msg = 'Video codec not supported on this device';
          if (err.code === 4) msg = 'Source not found or unplayable format';
        }
        console.error('[Engine] Video Error:', err, e);
        const playerErr = $('#player-error-overlay');
        if (playerErr) {
          playerErr.style.display = 'flex';
          const errMsg = $('#player-error-msg');
          if (errMsg) errMsg.textContent = msg;
        }
        showToast(msg);
        this._emit('error', msg);
      });
      this._video.addEventListener('stalled', () => {
        console.warn('[Engine] Playback stalled');
        this._emit('stalled');
      });
    }

    _startWatchdog(timeoutMs = 15000) {
      this._clearWatchdog();
      this._watchdogTimer = setTimeout(() => {
        if (this._currentTime === 0 && !this._paused) {
          console.error('[Engine] Playback watchdog timeout');
          this._emit('error', 'Connection failed or timeout. Please check your network.');
        }
      }, timeoutMs);
    }

    _clearWatchdog() {
      if (this._watchdogTimer) {
        clearTimeout(this._watchdogTimer);
        this._watchdogTimer = null;
      }
    }

    // ─── Event system ───
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

    // ─── Properties ───
    get currentTime() { return this._currentTime; }
    get duration() { return this._duration; }
    get paused() { return this._paused; }
    get volume() { return this._volume / 100; }
    get muted() { return this._muted; }
    get tracks() { return { audio: [], video: [], subtitle: [] }; }
    get isUsingMpv() { return false; }

    async init() {
      return true;
    }

    // ─── Load a file ───
    async load(filePath, options = {}) {
      // FORCE RESET before loading new media to prevent "stuck" state
      this.stop(); 
      
      // Clear any previous error messages from the UI
      const playerErr = document.getElementById('player-error-overlay');
      if (playerErr) playerErr.style.display = 'none';

      this._isRadio = false;

      this._currentTime = 0;
      this._duration = 0;
      this._paused = false;
      this._isRadio = !!options.isRadio;

      let url = filePath;
      const isHttp = filePath.startsWith('http');
      const isMobile = !!(window.Capacitor);

      if (!isHttp) { 
        if (isMobile) { 
          url = window.Capacitor.convertFileSrc(filePath); 
        } else if (window.api && window.api.isElectron) { 
          url = "local-file:///" + encodeURIComponent(filePath.replace(/\\/g, "/")).replace(/%2F/g, "/").replace(/%3A/g, ":"); 
        } else { 
          url = filePath; 
        } 
      }

      console.log(`[Engine] Loading ${options.isRadio ? 'Radio' : 'Media'}:`, url);
      this._video.src = url;
      this._video.load();

      if (options.startTime > 2) {
        this._video.addEventListener('loadedmetadata', () => {
          if (!isNaN(this._video.duration)) this._video.currentTime = options.startTime;
        }, { once: true });
      }

      if (!options.paused) {
        this._video.play().catch(err => {
          console.warn('[Engine] Auto-play blocked or failed:', err.message);
          if (options.isRadio) showToast('Tap Play to start stream');
        });
        this._startWatchdog(options.isRadio ? 25000 : 15000);
      }
      return true;
    }


    async play() {
      this._video.play().catch(() => { });
      this._paused = false;
    }

    async pause() {
      this._video.pause();
      this._paused = true;
    }

    async togglePause() {
      this._video.paused ? this._video.play().catch(() => { }) : this._video.pause();
    }

    async seek(timeSeconds) {
      this._currentTime = timeSeconds;
      this._video.currentTime = timeSeconds;
    }

    async seekRelative(seconds) {
      this._video.currentTime = Math.max(0, this._video.currentTime + seconds);
    }

    async setVolume(level) {
      this._volume = Math.max(0, Math.min(100, level));
      this._video.volume = this._volume / 100;
      this._video.muted = false;
      this._muted = false;
    }

    async setMute(muted) {
      this._muted = muted;
      this._video.muted = muted;
    }

    async setAudioTrack(trackId) { }
    async setSubtitleTrack(trackId) { }
    async addSubtitle(subPath) { }
    async setSubDelay(delaySec) { }
    async setSubFontSize(size) { }

    async stop() {
      this._clearWatchdog();
      this._video.pause();
      this._video.removeAttribute('src');
      this._video.load();
      this._currentTime = 0;
      this._paused = true;
    }

    async getAccurateTime() {
      return this._currentTime;
    }

    async getAccurateDuration() {
      return this._duration || this._video.duration || 0;
    }

  }

  // Create the global engine instance
  const engine = new PlayerEngine(document.getElementById('video-element'));

  let toastT; function showToast(msg) {

    const t = $('#toast');
    const icon = msg.includes('✓') || msg.includes('Setup') ? '<i class="fas fa-check-circle" style="margin-right:8px; color:#6366f1;"></i>' :
      msg.includes('Error') || msg.includes('Failed') ? '<i class="fas fa-exclamation-circle" style="margin-right:8px; color:#ff5555;"></i>' :
        '<i class="fas fa-info-circle" style="margin-right:8px; color:#6366f1;"></i>';
    t.innerHTML = icon + msg.replace('✓', '').trim();
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }
  async function persist() {
    let retries = 3;
    while (retries > 0) {
      try {
        await window.api.saveData(appData);
        return;
      } catch (err) {
        retries--;
        console.error(`[PERSIST] Save failed (${retries} retries left):`, err.message);
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 500)); // Wait 500ms before retry
        }
      }
    }
    console.error('[PERSIST] All save attempts failed');
    showToast('⚠️ Warning: Data may not be saved. Please ensure disk space is available.');
  }

  // Update the Dashboard Hero name too if in library view
  if (name === 'library' && msTitle) msTitle.textContent = currentProfile?.name || 'User';



  // When a video/movie starts playing, ensure mini player is reset
  engine.on('pausechange', (paused) => {
    if (!paused && !engine._isRadio) {
      const btnPlayPause = $('#mp-btn-play-pause');
      const vizSmall = $('#mp-radio-visualizer');
      const infoClick = $('#mp-info-click');

      if (btnPlayPause) btnPlayPause.style.display = 'flex';
      if (vizSmall) vizSmall.style.display = 'none';
      if (infoClick) infoClick.style.cursor = 'pointer';
    }
  });
  function deepMerge(t, s) { if (!s || typeof s !== 'object') return t; const o = { ...t }; for (const k of Object.keys(s)) { o[k] = s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? deepMerge(o[k] || {}, s[k]) : s[k]; } return o; }
  function allItems() { const shows = appData.shows || []; return [...(appData.movies || []), ...shows, ...shows.flatMap(s => s.episodes || [])]; }
  function isLocked(id) { return !isVaultUnlocked && (currentProfile?.lockedItems || []).includes(id); }

  // ── Profile Logic ──
  function migrateToProfiles() {
    if (appData.profiles.length > 0) return;

    // Check if we have legacy data worth migrating
    const hasData = (appData.playback && Object.keys(appData.playback).length) ||
      (appData.watchlist && appData.watchlist.length) ||
      (appData.pinned && appData.pinned.length);

    if (!hasData) return;

    // Create first profile from legacy data ONLY if data exists
    const legacyProfile = {
      id: 'p1_' + Date.now(),
      name: 'Main',
      avatar: AVATARS[0],
      playback: appData.playback || {},
      watchlist: appData.watchlist || [],
      pinned: appData.pinned || [],
      vaultPin: appData.vaultPin,
      lockedItems: appData.lockedItems || []
    };
    appData.profiles = [legacyProfile];
    appData.activeProfileId = legacyProfile.id;

    // Cleanup root legacy fields
    delete appData.playback; delete appData.watchlist; delete appData.pinned; delete appData.vaultPin; delete appData.lockedItems;
    console.log('[PROFILES] Migrated legacy data to Main profile');
  }

  function renderProfilePicker() {
    const picker = $('#profile-picker');
    const list = $('#profile-list');
    const addBtn = $('#btn-add-profile');

    // Clear list but keep add button
    list.querySelectorAll('.profile-item').forEach(el => el.remove());

    // Reset animation classes on add button
    addBtn.classList.remove('fade-out', 'selected');

    // Default background to active profile, or first available banner
    let activeProf = appData.profiles.find(p => p.id === appData.activeProfileId);
    if (!activeProf || !activeProf.banner) {
      activeProf = appData.profiles.find(p => p.banner) || appData.profiles[0];
    }
    
    if (activeProf && activeProf.banner) {
      picker.style.backgroundImage = `linear-gradient(rgba(15,15,19,0.5), rgba(15,15,19,0.95)), url('${localImg(activeProf.banner)}')`;
      picker.style.backgroundSize = 'cover';
      picker.style.backgroundPosition = 'center';
      picker.style.transition = 'background 0.5s ease';
    } else {
      picker.style.backgroundImage = '';
    }

    appData.profiles.forEach(p => {
      const card = document.createElement('div');
      card.className = 'profile-card profile-item';
      card.dataset.profileId = p.id;
      card.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:15px; cursor:pointer; position:relative;';
      card.onclick = () => {
        if (isEditingProfiles) {
          openProfileModal(p.id);
        } else {
          selectProfile(p.id);
        }
      };

      card.onmouseenter = () => {
        if (p.banner && !window.api.isMobile()) {
          picker.style.backgroundImage = `linear-gradient(rgba(15,15,19,0.5), rgba(15,15,19,0.95)), url('${localImg(p.banner)}')`;
          picker.style.backgroundSize = 'cover';
          picker.style.backgroundPosition = 'center';
          picker.style.transition = 'background 0.5s ease';
        }
      };
      card.onmouseleave = () => {
        if (!window.api.isMobile()) {
          // Instead of clearing, reset to the active profile's banner
          const activeProf = appData.profiles.find(prof => prof.id === appData.activeProfileId) || appData.profiles[0];
          if (activeProf && activeProf.banner) {
            picker.style.backgroundImage = `linear-gradient(rgba(15,15,19,0.5), rgba(15,15,19,0.95)), url('${localImg(activeProf.banner)}')`;
          } else {
            picker.style.backgroundImage = '';
          }
        }
      };

      const disableDelete = appData.profiles.length <= 1;
      card.innerHTML = `
        <div class="profile-actions" style="position:absolute; top:-10px; right:-10px; display:flex; gap:5px; opacity:${isEditingProfiles ? '1' : '0'}; transition:opacity 0.2s; z-index:10;">
          <button class="profile-edit-btn" title="Edit Profile" style="background:#4F46E5; color:#fff; border:none; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${disableDelete ? '' : `
          <button class="profile-delete-btn" title="Delete Profile" style="background:#EF4444; color:#fff; border:none; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`}
        </div>
        <div class="profile-avatar-box" style="width: 150px; height: 150px; border-radius: 50%; background: #222;">
          <img src="${localImg(p.avatar)}" alt="${escapeHTML(p.name)}" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/avataaars/svg?seed='+encodeURIComponent('${escapeHTML(p.name)}');">
        </div>
        <span style="font-size: 1.2rem; font-weight: 600; color: #999;">${escapeHTML(p.name)}</span>
      `;

      // Stop propagation for action buttons so they don't trigger selectProfile
      const editBtn = card.querySelector('.profile-edit-btn');
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          openProfileModal(p.id);
        };
      }

      const delBtn = card.querySelector('.profile-delete-btn');
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete the profile "${p.name}"?`)) {
            appData.profiles = appData.profiles.filter(x => x.id !== p.id);
            if (appData.activeProfileId === p.id) appData.activeProfileId = appData.profiles[0].id;
            persist();
            renderProfilePicker();
          }
        };
      }
      list.insertBefore(card, addBtn);
    });

    picker.style.display = 'flex';
  }

  function selectProfile(id) {
    const profile = appData.profiles.find(p => p.id === id);
    if (!profile) return;

    // Animate: scale up the selected card, fade out others
    const picker = $('#profile-picker');
    const header = picker.querySelector('h1');
    const list = $('#profile-list');
    const allCards = $$('#profile-list .profile-card');

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
      } else {
        card.style.transition = 'all 0.5s ease';
        card.classList.add('fade-out');
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8) blur(5px)';
      }
    });

    // Wait for the animation to finish, then load the profile
    setTimeout(async () => {
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
        if (actions) actions.style.display = 'none'; // Keep hidden after selection
      });
      isEditingProfiles = false; // Reset editing mode
      const toggleBtn = $('#btn-toggle-edit-profiles');
      if (toggleBtn) {
        toggleBtn.textContent = 'Edit Profiles';
        toggleBtn.style.background = 'rgba(255,255,255,0.05)';
      }
      appData.activeProfileId = id;
      currentProfileId = id;
      currentProfile = profile;

      // Reset animation classes before hiding
      allCards.forEach(c => c.classList.remove('selected', 'fade-out'));
      $('#profile-picker').style.display = 'none';

      // Update sidebar profile widget
      renderProfileWidget();

      // Scan the full library for this profile
      await scanLibrary();

      renderLibrary(); renderSidebar(); renderDownloadHistory(); renderSocial();
      switchView('discover');

      showToast(`Welcome back, ${profile.name}!`);
      persist();

      // Mandatory API Check
      const tmdbVal = await window.api.invoke('get-tmdb-key-masked');
      if (!tmdbVal) {
        document.body.classList.remove('api-setup-mode');
        $('#api-onboarding-overlay').classList.remove('setup-active');
        $('#api-onboarding-overlay').style.display = 'flex';
      }
    }, 1200);
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

        const rootName = overlay.querySelector('#mobile-root-input').value || 'MediaVault';
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
    if (!window.api?.isElectron) showMobileOnboarding();
    else {
      // Avoid flicker: check if we actually have a key before showing
      window.api.invoke('get-tmdb-key-masked').then(tmdbVal => {
        if (!tmdbVal) {
          $('#api-onboarding-overlay').style.display = 'flex';
          $('#api-onboarding-overlay').classList.add('setup-active');
        } else {
          // If we have a key but it's "firstRun", maybe we just need to set it to false
          appData.firstRun = false;
          persist();
        }
      });
    }
  }

  function renderProfileWidget() {
    if (!currentProfile) return;

    // Apply Profile Banner Background
    if (currentProfile.banner) {
      document.body.style.backgroundImage = `linear-gradient(to top, var(--bg-main) 0%, rgba(18,18,28,0.7) 100%), url('${localImg(currentProfile.banner)}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'top center';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }

    // Update top titlebar avatar
    const titleAvatar = $('#current-profile-avatar');
    if (titleAvatar) {
      titleAvatar.src = localImg(currentProfile.avatar);
      titleAvatar.onerror = () => { titleAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(currentProfile.name); };
    }

    const mainAvatar = $('#current-profile-avatar-main');
    if (mainAvatar) {
      mainAvatar.src = localImg(currentProfile.avatar);
      mainAvatar.onerror = () => { mainAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(currentProfile.name); };
    }

    $$('.current-profile-avatar-main-dynamic').forEach(img => {
      img.src = localImg(currentProfile.avatar);
      img.onerror = () => { img.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(currentProfile.name); };
    });

    const mobileGlobalAvatar = $('#mobile-profile-avatar');
    if (mobileGlobalAvatar) {
      mobileGlobalAvatar.src = localImg(currentProfile.avatar);
      mobileGlobalAvatar.onerror = () => { mobileGlobalAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(currentProfile.name); };
    }

    // New My Space Dashboard Elements
    const msAvatar = $('#myspace-avatar-img');
    if (msAvatar) {
      msAvatar.src = localImg(currentProfile.avatar);
      msAvatar.onerror = () => { msAvatar.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(currentProfile.name); };
    }
    const msName = $('#myspace-profile-name');
    if (msName) msName.textContent = currentProfile.name;

    const sidebarName = $('#sidebar-profile-name');
    if (sidebarName) {
      sidebarName.textContent = currentProfile.name;
    }


    // Fallback/Legacy widget in sidebar (optional but kept for internal DOM logic if needed)
    let widget = $('#sidebar-profile-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'sidebar-profile-widget';
      widget.className = 'profile-btn-sidebar';
      widget.onclick = () => renderProfilePicker();
      $('#sidebar').insertBefore(widget, $('#sidebar').firstChild);
    }
    widget.style.display = 'none'; // Hide sidebar widget since we use the top bar now
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

  let selectedAvatar = AVATARS[0];
  let selectedBanner = null;

  function openProfileModal(id = null) {
    editingProfileId = id;
    const profile = id ? appData.profiles.find(p => p.id === id) : null;

    const modalTitle = $('#profile-modal h2');
    const confirmBtn = $('#profile-confirm');
    const nameInput = $('#profile-name-input');

    if (modalTitle) modalTitle.textContent = id ? 'Edit Profile' : 'Create Profile';
    if (confirmBtn) confirmBtn.textContent = id ? 'Save Changes' : 'Create';
    if (nameInput) nameInput.value = profile ? profile.name : '';

    selectedAvatar = profile ? profile.avatar : AVATARS[0];
    selectedBanner = profile ? profile.banner || null : null;

    const bannerBtn = $('#btn-upload-banner');
    if (bannerBtn) {
      bannerBtn.innerHTML = selectedBanner 
        ? '<i class="fas fa-check"></i> Background Banner Selected' 
        : '<i class="fas fa-image"></i> Choose Background Banner';
        
      bannerBtn.onclick = async () => {
        if (window.api.isElectron) {
          const dest = await window.api.invoke('set-custom-banner', 'profile_banner_' + Date.now());
          if (dest) {
            selectedBanner = dest;
            bannerBtn.innerHTML = '<i class="fas fa-check"></i> Background Banner Selected';
          }
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            selectedBanner = await compressImageFile(file, 1280);
            bannerBtn.innerHTML = '<i class="fas fa-check"></i> Background Banner Selected';
          };
          input.click();
        }
      };
    }

    const selector = $('#avatar-selector');
    if (!selector) return;
    selector.innerHTML = '';

    // Add default avatars
    AVATARS.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'avatar-opt' + (url === selectedAvatar ? ' selected' : '');
      img.onerror = () => { img.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=MediaVault'; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = url;
      };
      selector.appendChild(img);
    });

    // If selectedAvatar is a custom one (not in default list), show it too
    if (selectedAvatar && !AVATARS.includes(selectedAvatar)) {
      const img = document.createElement('img');
      img.src = localImg(selectedAvatar);
      img.className = 'avatar-opt selected';
      img.onerror = () => { img.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=User'; };
      img.onclick = () => {
        selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
        img.classList.add('selected');
        selectedAvatar = profile.avatar;
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
      if (window.api.isElectron) {
        const localPath = await window.api.invoke('select-user-avatar');
        if (localPath) {
          selectedAvatar = localPath;
          const img = document.createElement('img');
          img.src = localImg(localPath);
          img.className = 'avatar-opt selected';
          img.onerror = () => { img.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=New'; };
          selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
          selector.insertBefore(img, uploadBtn);
          img.onclick = () => {
            selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
            img.classList.add('selected');
            selectedAvatar = localPath;
          };
        }
      } else {
        // Fallback for Android/Web (Capacitor)
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          selectedAvatar = await compressImageFile(file, 300);
          const img = document.createElement('img');
          img.src = selectedAvatar;
          img.className = 'avatar-opt selected';
          selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
          selector.insertBefore(img, uploadBtn);
          img.onclick = () => {
            selector.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
            img.classList.add('selected');
            selectedAvatar = img.src;
          };
        };
        input.click();
      }
    };
    selector.appendChild(uploadBtn);

    $('#profile-modal').style.display = 'flex';
    if (nameInput) nameInput.focus();
  }

  $('#btn-add-profile').onclick = () => openProfileModal();

  $('#btn-toggle-edit-profiles').onclick = () => {
    isEditingProfiles = !isEditingProfiles;
    const btn = $('#btn-toggle-edit-profiles');
    if (isEditingProfiles) {
      btn.textContent = 'Done Editing';
      btn.style.background = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
    } else {
      btn.textContent = 'Edit Profiles';
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.borderColor = 'rgba(255,255,255,0.1)';
    }
    renderProfilePicker();
  };
  $('#btn-intro-start').onclick = () => {
    $('#intro-screen').style.display = 'none';
    openProfileModal();
    $('#profile-modal').style.display = 'flex';
  };

  $('#profile-cancel').onclick = () => $('#profile-modal').style.display = 'none';
  $('#profile-confirm').onclick = async () => {
    const nameInput = $('#profile-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) { showToast('Please enter a name'); return; }

    // Check for duplicate names (excluding current profile being edited)
    const duplicate = appData.profiles.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== editingProfileId);
    if (duplicate) {
      showToast('A profile with this name already exists');
      return;
    }

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
        profile.banner = selectedBanner;
        if (profile.id === currentProfileId) {
          currentProfile = profile;
          renderProfileWidget();
        }
      }
    } else {
      const newProfile = {
        id: 'p' + Date.now(),
        name: name,
        avatar: selectedAvatar,
        banner: selectedBanner,
        playback: {},
        watchlist: [],
        pinned: [],
        vaultPin: null,
        lockedItems: []
      };
      // Automation: Create physical folders on disk
      await window.api.invoke('ensure-profile-folders', name);
      appData.profiles.push(newProfile);
    }

    $('#profile-modal').style.display = 'none';
    $('#intro-screen').style.display = 'none';
    renderProfilePicker();
    persist();
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
    player: $('#view-player'),
    discover: $('#view-discover'),
    'discover-detail': $('#view-discover-detail'),
    downloads: $('#view-downloads'),
    library: $('#view-library'), // Mobile Hub
    hub: $('#view-hub'),
    watchlist: $('#view-watchlist'),
    music: $('#view-music'),
    subtitles: $('#view-subtitles'),
    radio: $('#view-radio')
  };

  // Set Home as the default landing page
  Object.values(views).forEach(v => { if (v) v.classList.remove('active'); });
  if (views.home) views.home.classList.add('active');
  $$('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  if ($('#nav-home')) $('#nav-home').classList.add('active');

  const video = $('#video-element');

  function cleanTechnicalTitle(t) {
    if (!t) return 'Unknown';
    let clean = t.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i, '')
      .replace(/[.\-_]/g, ' ')
      // Strip English tags (Quality, Codecs, Releases)
      .replace(/\b(2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|web-dl|bluray|brrip|bdrip|remux|uhd|hdr|dts|dd5\.1|ac3|atmos|truehd|aac|dual|audio|multi|sub|eng|ita|ger|fra|spa|por|pt|gb|ru|rus|ukr|hq|10bit|6ch|5\.1|stereo)\b/gi, '')
      // Strip common site tags and download groups
      .replace(/\b(Project|Comando|Dub|YTS|YIFY|RARBG|ETRG|SPARKS|AMIABLE|DRONES|ROVERS|GECKOS|VPPV|WIKI|EVO|TIGOLE|PSA|QxR|YOL0|ARWEN|MFL|TDR|DDR|KOC|SEL|DoMiNo|Rutor|Selezen|MovieDalen|DUAL|AUDIO|GB|PT)\b/gi, '')
      // Strip year patterns if at the end or surrounded by spaces
      .replace(/\b(19|20)\d{2}\b/g, '')
      // Cleanup extra symbols and multi-spaces
      .replace(/[«»\[\]\(\)]/g, '')
      .replace(/\s+/g, ' ').trim();

    // Capitalize each word for a premium feel
    return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || t;
  }
  const SVG_MOVIE = '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#B0B0B8" stroke-width="1.5"><rect x="6" y="6" width="36" height="36" rx="4"/><line x1="6" y1="14" x2="42" y2="14"/><polygon points="19 22 33 28 19 34 19 22" fill="#B0B0B8" stroke="none"/></svg>';
  const SVG_SHOW = '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#B0B0B8" stroke-width="1.5"><rect x="4" y="8" width="40" height="26" rx="3"/><polyline points="16 38 32 38"/><line x1="24" y1="34" x2="24" y2="38"/><polygon points="19 17 33 21 19 29 19 17" fill="#B0B0B8" stroke="none"/></svg>';

  // ══════════════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════════════
  $('#btn-minimize').onclick = () => window.api.minimizeWindow();
  $('#btn-maximize').onclick = () => window.api.maximizeWindow();
  $('#btn-close').onclick = () => window.api.closeWindow();
  $('#btn-theme-toggle').onclick = () => {
    const isAndroid = !!(window.Capacitor);
    if (isAndroid) {
      showToast('Dark Mode is optimized for your screen.');
      return;
    }
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    appData.theme = isDark ? 'dark' : 'light';
    updateSignature();
    persist();
  };

  function updateSignature() {
    const sig = $('#sidebar-signature');
    if (!sig) return;
    const isDark = document.body.classList.contains('dark-theme');
    sig.src = isDark ? 'imgs/signature_w.png' : 'imgs/signature_b.png';
  }
  const btnRescanMain = $('#btn-rescan-main');
  if (btnRescanMain) btnRescanMain.onclick = () => {
    $('#btn-rescan')?.click();
  };
  $$('.nav-btn[data-view]').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  // --- Mobile Hub Nav ---
  $$('.library-hub-card').forEach(card => {
    card.onclick = () => {
      if (card.dataset.view) switchView(card.dataset.view);
      else if (card.dataset.subview) switchView(card.dataset.subview);
    };
  });

  // --- Mobile App Controls ---
  const btnRescanMob = $('#btn-rescan-mobile');
  if (btnRescanMob) btnRescanMob.onclick = () => {
    $('#btn-rescan')?.click();
    showToast('Scanning Library...');
  };

  const btnRescanQuick = $('#btn-rescan-mobile-quick');
  if (btnRescanQuick) btnRescanQuick.onclick = () => {
    $('#btn-rescan')?.click();
    showToast('Refreshing Library Database...');
  };


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
      for (const f of files) {
        if (f.name.toLowerCase().match(/\.(srt|vtt|ass)$/)) {
          await window.api.invoke('save-subtitle-local', {
            profileName: currentProfile?.name || 'Default',
            libraryRoot: appData.libraryFolders?.[0] || '',
            filePath: window.api.getFilePath(f)
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
  }

  const subFileInput = $('#sub-file-input');
  if (subFileInput) {
    subFileInput.onchange = async (e) => {
      for (const f of e.target.files) {
        await window.api.invoke('save-subtitle-local', {
          profileName: currentProfile?.name || 'Default',
          libraryRoot: appData.libraryFolders?.[0] || '',
          filePath: window.api.getFilePath(f)
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
    el.oninput = () => { if (el.value.length === 1 && idx < 3) $$('.pin-digit')[idx + 1].focus(); };
    el.onkeydown = (e) => { if (e.key === 'Backspace' && !el.value && idx > 0) $$('.pin-digit')[idx - 1].focus(); };
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
  const btnRescan = $('#btn-rescan');
  if (btnRescan) {
    btnRescan.onclick = async () => {
      btnRescan.disabled = true;
      const oldHtml = btnRescan.innerHTML;
      btnRescan.textContent = 'Refreshing...';
      showToast('⏳ Refreshing Library... searching for local files.');
      try {
        await scanLibrary();
        showToast('✅ Library Refresh Complete');
      } catch (err) {
        showToast('❌ Refresh Failed');
      } finally {
        btnRescan.disabled = false;
        btnRescan.innerHTML = oldHtml;
      }
    };
  }

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


  // ───────── TMDB API KEY MANAGEMENT ─────────
  const initTmdbKeyUI = async () => {
    const masked = await window.api.getTmdbKeyMasked();
    const maskedInput = $('#tmdb-key-masked');
    if (maskedInput) maskedInput.value = masked || '';
  };

  $('#btn-copy-tmdb-key')?.addEventListener('click', () => {
    showToast('API keys cannot be copied for security reasons. Update only through this form.');
  });

  $('#btn-verify-tmdb-key')?.addEventListener('click', async () => {
    const btn = $('#btn-verify-tmdb-key');
    const input = $('#tmdb-key-input');
    const status = $('#tmdb-key-status');
    const val = input?.value.trim();

    if (!val) {
      showToast('❌ Please enter an API key to test');
      return;
    }

    if (val.startsWith('tt')) {
      showToast('⚠️ This looks like an IMDB ID. Please use a TMDB API Key (32-character code).');
      if (status) {
        status.textContent = 'Use TMDB API Key, not IMDB ID';
        status.style.color = '#ffaa00';
        status.style.display = 'block';
      }
      return;
    }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Testing...';
    showToast('⏳ Verifying API Key with TMDB servers...');

    try {
      const isValid = await window.api.verifyTmdbKey(val);
      if (isValid) {
        showToast('✅ Success! TMDB API Key is valid.');
        if (status) { status.textContent = '✓ API key is valid!'; status.style.color = '#10b981'; status.style.display = 'block'; }
      } else {
        showToast('❌ Invalid API Key. Please check the code.');
        if (status) { status.textContent = '✗ API key is invalid'; status.style.color = '#ff5555'; status.style.display = 'block'; }
      }
    } catch (err) {
      showToast('❌ Network Error: Could not connect to TMDB.');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });

  $('#btn-update-tmdb-key')?.addEventListener('click', async () => {
    const input = $('#tmdb-key-input');
    const status = $('#tmdb-key-status');
    if (!input || !input.value.trim()) {
      showToast('❌ Please enter an API key to update');
      return;
    }
    showToast('💾 Saving API Key...');
    const keyVal = input.value.trim();
    const result = await window.api.setTmdbKey(keyVal);
    if (result && result.success) {
      input.value = '';
      appData.tmdbKey = keyVal; // Update renderer's copy
      await persist(); // Force immediate persistence
      await initTmdbKeyUI();
      if (status) {
        status.textContent = '✔ API key updated successfully!';
        status.style.color = '#10b981';
        status.style.display = 'block';
      }
      showToast('✅ TMDB API Key Updated Successfully');

      // Check if both are set to unlock
      checkAndUnlockApp();

      setTimeout(() => { if (status) status.style.display = 'none'; }, 3000);
    } else {
      showToast('Failed to update API key');
    }
  });

  const checkAndUnlockApp = async () => {
    const tmdbVal = await window.api.invoke('get-tmdb-key-masked');
    if (tmdbVal) {
      document.body.classList.remove('api-setup-mode');
      const overlay = $('#api-onboarding-overlay');
      if (overlay) {
        overlay.classList.remove('setup-active');
        overlay.style.display = 'none';
      }
      showToast('Setup complete! Application unlocked.');
    }
  };

  initTmdbKeyUI();


  $('#btn-onboarding-setup').onclick = () => {
    // We stay on the current view but enter a focused setup state
    document.body.classList.add('api-setup-mode');
    const overlay = $('#api-onboarding-overlay');
    overlay.classList.add('setup-active');
  };

  // --- WIZARD HANDLERS ---
  $('#btn-wizard-verify-tmdb')?.addEventListener('click', async () => {
    const input = $('#wizard-tmdb-key');
    const status = $('#wizard-tmdb-status');
    const btn = $('#btn-wizard-verify-tmdb');
    if (!input.value.trim()) { showToast('Please enter a key'); return; }

    status.textContent = 'Verifying...';
    status.style.display = 'block';
    status.style.color = 'var(--text-muted)';
    btn.disabled = true;

    try {
      const isValid = await window.api.invoke('verify-tmdb-key', input.value.trim());
      if (isValid) {
        await window.api.invoke('set-tmdb-key', input.value.trim());
        appData.tmdbKey = input.value.trim();
        status.innerHTML = '<i class="fas fa-check-circle"></i> TMDB Key Verified & Saved!';
        status.style.color = '#10b981';
        input.disabled = true;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        checkAndUnlockApp(); // Try auto-unlocking
      } else {
        status.innerHTML = '<i class="fas fa-times-circle"></i> Invalid TMDB API Key';
        status.style.color = '#ff5555';
        btn.disabled = false;
      }
    } catch (e) {
      status.textContent = 'Error verifying key';
      btn.disabled = false;
    }
  });


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

  $('#btn-close-subs').onclick = () => $('#player-subs-panel').classList.remove('open');
  const btnAudioTracks = $('#btn-audio-tracks');
  if (btnAudioTracks) btnAudioTracks.onclick = () => { closeSidePanel(); $('#player-tracks-panel').classList.add('open'); };
  const btnCloseTracks = $('#btn-close-tracks');
  if (btnCloseTracks) btnCloseTracks.onclick = () => $('#player-tracks-panel').classList.remove('open');
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
  $('#btn-fullscreen').onclick = toggleFullscreen;
  $('#btn-pip').onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); } catch (e) { console.warn('[PiP] Picture-in-Picture failed:', e.message); showToast('PiP not supported on this video'); } };
  video.addEventListener('enterpictureinpicture', () => $('#btn-pip').classList.add('subtitle-on'));
  video.addEventListener('leavepictureinpicture', () => $('#btn-pip').classList.remove('subtitle-on'));
  $('#btn-mute').onclick = () => { engine.setMute(!engine.muted); updateVolumeIcon(); };
  $('#btn-back-shows').onclick = () => switchView('shows');
  $('#btn-back-discover').onclick = () => switchView('discover');

  // Discover Sidebar Toggle
  $('#btn-discover-sidebar').onclick = () => {
    $('#view-discover').classList.toggle('sidebar-collapsed');
  };
  // Default to collapsed for a clean first view as requested
  $('#view-discover').classList.add('sidebar-collapsed');

  $('#btn-subtitle').onclick = () => {
    if (subtitlesEnabled) {
      if (engine.isUsingMpv) switchSubtitleTrack('no');
      else {
        // Correctly disable all internal and external text tracks via the TextTrack API
        Array.from(video.textTracks).forEach(track => {
          track.mode = 'hidden';
          track.mode = 'disabled';
        });
        // Also remove external track DOM elements as a fallback
        video.querySelectorAll('track').forEach(t => t.remove());

        subtitlesEnabled = false;
        window.activeSubtitlePath = null;
        renderPlayerSubLibrary(); // Refresh highlight
        $('#btn-subtitle').classList.remove('subtitle-on');
        $('#btn-subtitle').classList.add('subtitle-off');
      }
      showToast('Subtitles Off');
    } else {
      $('#player-subs-panel').classList.toggle('open');
      if ($('#player-subs-panel').classList.contains('open')) {
        renderPlayerSubLibrary();
      }
    }
  };
  $('#btn-toggle-playlist').onclick = () => { panelOpen ? closeSidePanel() : openSidePanel(); };
  $('#btn-close-panel').onclick = closeSidePanel;

  // Mini player
  $('#mp-btn-play-pause').onclick = (e) => { e.stopPropagation(); engine.togglePause(); };
  $('#mp-btn-close').onclick = (e) => { e.stopPropagation(); engine.stop(); $('#mini-player').style.display = 'none'; exitPlayer(false); };
  $('#mp-info-click').onclick = (e) => {
    if (engine && engine._isRadio) {
      e.preventDefault();
      e.stopPropagation();
      return false; // Radio mini-player is unclickable as requested
    }
    if (isPlayingMusic) {
      $('#player-wrapper').classList.add('is-music-mode');
    } else {
      $('#player-wrapper').classList.remove('is-music-mode');
    }
    if (isPlayingMusic) {
      $('#player-wrapper').classList.add('is-music-mode');
    } else {
      $('#player-wrapper').classList.remove('is-music-mode');
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

  seekBar.onmousedown = () => { isSeeking = true; console.log('[SEEK-DEBUG] mousedown → isSeeking=true'); };
  seekBar.oninput = () => {
    const dur = engine.duration;
    if (!dur || isNaN(dur)) { console.log('[SEEK-DEBUG] oninput SKIP: dur=', dur); return; }
    isSeeking = true; // Safety trigger
    const val = parseFloat(seekBar.value) || 0;
    const targetTime = (val / 1000) * dur;
    console.log('[SEEK-DEBUG] oninput: val=', val, 'dur=', dur, 'targetTime=', targetTime, 'engine.isUsingMpv=', engine.isUsingMpv);

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
      console.log('[SEEK-DEBUG] mouseup: seeking to', targetTime, 'dur=', dur);
      engine.seek(targetTime);
    }
    // CRITICAL: Delay clearing isSeeking so mpv has time to reach
    // the new position before we accept its time-pos updates again.
    // Without this, the old pre-seek time overwrites the bar immediately.
    setTimeout(() => { isSeeking = false; console.log('[SEEK-DEBUG] isSeeking cleared after 500ms timeout'); }, 500);
  };

  // Video events
  video.addEventListener('loadedmetadata', () => { $('#player-loading').style.display = 'none'; updateTimeDisplay(); updateSeekFill(); });
  video.addEventListener('waiting', () => { $('#player-loading').style.display = 'flex'; });

  // Buffering & Torrent Progress
  window.api.onTorrentProgress((data) => {
    $('#player-progress-text').textContent = `Buffering... [${data.percent}%]`;
    $('#player-speed-text').textContent = `${data.speed} • ${data.peers} peers`;
  });

  // NOTE: Download event listeners are consolidated in one block below (search: "Download event listeners")

  // Fullscreen Synchronization Fix
  document.addEventListener('fullscreenchange', () => {
    const isNativeFS = !!document.fullscreenElement;
    isFullscreen = isNativeFS;
    document.body.classList.toggle('fullscreen-mode', isFullscreen);
    if ($('#icon-expand')) $('#icon-expand').style.display = isFullscreen ? 'none' : 'block';
    if ($('#icon-shrink')) $('#icon-shrink').style.display = isFullscreen ? 'block' : 'none';
  });

  $('#btn-back-player').onclick = () => exitPlayer(true, false); // Minimize on back arrow

  $('#btn-external-player').onclick = () => {
    if (currentItem && currentItem.path) {
      window.api.invoke('open-in-external-player', currentItem.path);
      showToast('Opening in external player...');
    }
  };
  // Audio Fix button removed (redundant with mpv)
  const btnFixAudio = $('#btn-fix-audio');
  if (btnFixAudio) btnFixAudio.remove();
  video.addEventListener('canplay', () => { $('#player-loading').style.display = 'none'; });

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
  });

  engine.on('pausechange', (paused) => {
    if (paused) {
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
  });

  engine.on('ended', () => {
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

  // HTML5 fallback events (only active when not using mpv)
  video.addEventListener('timeupdate', () => {
    if (!engine.isUsingMpv && !isSeeking) {
      engine._currentTime = video.currentTime;
      engine._duration = video.duration || engine._duration;
      const dur = engine.duration;
      if (dur > 0) {
        seekBar.value = (video.currentTime / dur) * 1000;
        updateSeekFill();
      }
      updateTimeDisplay();
    }
  });
  video.addEventListener('play', () => { if (!engine.isUsingMpv) { engine._paused = false; engine._emit('pausechange', false); } });
  video.addEventListener('pause', () => { if (!engine.isUsingMpv) { engine._paused = true; engine._emit('pausechange', true); } });
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

    tempMusicCover = override.cover || null;
    $('#modal-edit-music').style.display = 'flex';
  }

  $('#ctx-edit-music').onclick = () => {
    $('#context-menu').style.display = 'none';
    openEditMusicModal(contextTarget);
  };

  $('#btn-edit-music-cover').onclick = async () => {
    if (!contextTarget) return;
    const newPath = await window.api.invoke('set-custom-banner', contextTarget.id);
    if (newPath) {
      tempMusicCover = newPath;
      const preview = $('#edit-music-cover-preview');
      const url = localImg(newPath);
      preview.style.backgroundImage = `url("${url}")`;
      preview.innerHTML = '';

      // Also update overall banners for immediate card sync
      appData.banners[contextTarget.id] = newPath;

      // Auto-refresh the library grid immediately so the user sees the change
      renderMusic();
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

      const bgUrl = localImg(cover) || 'https://api.dicebear.com/7.x/shapes/svg?seed=music';
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
    if (isPlayingMusic) return; // Dedicated music UI handles visibility

    // Suppress Sleep Mode if playback is active OR if there are active downloads
    if (activeDownloads.size > 0) return;

    if (video.paused && currentItem) {
      // Skip sleep mode for YouTube videos OR if loading spinner is active
      if (currentItem.isYoutube || currentItem.type === 'youtube') return;
      if ($('#player-loading').style.display !== 'none') return;

      sleepTimer = setTimeout(() => {
        // Bridging lookup: check episode cache first, then fall back to show cache if it's an episode
        let cache = appData.tmdbCache[currentItem.tmdbId || currentItem.id] || {};
        if (currentShow && (!cache.backdrop_path && !cache.backdropPath)) {
          const showCache = appData.tmdbCache[currentShow.id] || appData.tmdbCache[currentShow.title] || {};
          cache = { ...showCache, ...cache }; // Merge so we keep episode specific titles if any
        }

        const backdrop = cache.backdrop_path || cache.backdropPath;
        const poster = cache.poster_path || cache.posterPath;

        const resolveImg = (p, q = 'original') => {
          if (!p) return '';
          if (p.startsWith('http')) return p;
          if (p.startsWith('/')) return `https://image.tmdb.org/t/p/${q}${p}`;
          return localImg(p);
        };

        const bgUrl = resolveImg(backdrop || appData.banners[currentItem.id] || appData.banners[currentShow?.id]);
        const posterUrl = resolveImg(poster || backdrop || appData.banners[currentItem.id] || appData.banners[currentShow?.id], 'w500');

        if (bgUrl) {
          $('#sleep-bg').style.backgroundImage = `url('${bgUrl}')`;
          $('#sleep-poster').src = posterUrl;
          $('#sleep-poster').style.display = 'block';
        } else {
          $('#sleep-bg').style.backgroundImage = 'none';
          $('#sleep-poster').style.display = 'none';
        }

        // Improved Labeling: Show full show name if available
        const showName = cache.title || currentShow?.title || (currentItem.isYoutube ? 'Video' : 'Movie');
        $('#sleep-show').textContent = showName;

        const displayTitle = cache.title ? (currentItem.season ? `Season ${currentItem.season} · Episode ${currentItem.episode}` : cache.title) : cleanTechnicalTitle(currentItem.title);

        // If it's an episode from cache, use the episode name from cache if possible
        let epTitle = displayTitle;
        if (currentItem.season && currentItem.episode && cache.seasons) {
          const se = cache.seasons[currentItem.season];
          if (se && se[currentItem.episode]) epTitle = se[currentItem.episode].name;
        }

        $('#sleep-title').textContent = epTitle;
        $('#sleep-title').style.fontSize = epTitle.length > 25 ? '38px' : '52px';

        let metaParts = [];
        if (cache.year) metaParts.push(cache.year);
        if (cache.rating) metaParts.push(`★ ${cache.rating.toFixed(1)}`);
        if (!cache.year && currentItem.year) metaParts.push(currentItem.year);
        if (currentItem.quality) metaParts.push(currentItem.quality);

        $('#sleep-meta').textContent = metaParts.join('  •  ');

        // Ensure episode description is shown if available
        let finalDesc = cache.overview || '';
        if (currentItem.season && currentItem.episode && cache.seasons) {
          const se = cache.seasons[currentItem.season];
          const ep = se ? se[currentItem.episode] : null;
          if (ep && ep.overview) finalDesc = ep.overview;
        }
        $('#sleep-desc').textContent = finalDesc || (currentItem.season ? `Continuing Season ${currentItem.season} Episode ${currentItem.episode}` : 'Playback Paused');

        $('#sleep-overlay').style.display = 'flex';
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
  });

  // Auto-next
  $('#btn-cancel-next').onclick = cancelAutoNext;
  $('#btn-play-now').onclick = () => { cancelAutoNext(); const ni = currentEpisodeIndex + 1; if (ni < currentEpisodes.length) { currentEpisodeIndex = ni; playVideo(currentEpisodes[ni], currentShow); } };

  // Sleep Timer Removal requested by user

  // Context menu
  document.addEventListener('click', e => { if (!$('#context-menu').contains(e.target)) $('#context-menu').style.display = 'none'; });
  $('#ctx-play').onclick = () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; if (contextTarget.type === 'show') openShowDetail(contextTarget); else playVideo(contextTarget, currentShow); };
  $('#ctx-pin').onclick = () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; const p = appData.pinned || []; const i = p.indexOf(contextTarget.id); if (i >= 0) p.splice(i, 1); else p.push(contextTarget.id); appData.pinned = p; persist(); showToast(i >= 0 ? 'Unpinned' : 'Pinned'); };
  $('#ctx-cover').onclick = async () => { $('#context-menu').style.display = 'none'; if (!contextTarget) return; const dest = await window.api.invoke('set-custom-banner', contextTarget.id); if (dest) { appData.banners[contextTarget.id] = dest; persist(); refreshCurrentView(); showToast('Cover updated!'); } };
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
    const title = contextTarget.title || contextTarget.filename || 'this item';
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

  // TMDB search modal
  $('#tmdb-search-cancel').onclick = () => { $('#tmdb-modal').style.display = 'none'; };
  let tmdbSearchTimeout;
  $('#tmdb-search-input').oninput = () => { clearTimeout(tmdbSearchTimeout); tmdbSearchTimeout = setTimeout(performTmdbSearch, 400); };
  $('#tmdb-search-input').onkeydown = e => { if (e.key === 'Escape') $('#tmdb-modal').style.display = 'none'; };

  // Downloads
  $('#dl-url')?.addEventListener('input', async (e) => {
    const url = e.target.value.trim();
    if (!url) return;

    const v = url.toLowerCase();
    if (v.includes('youtube.com') || v.includes('youtu.be')) currentDlType = 'youtube';
    else if (v.includes('tiktok.com')) currentDlType = 'tiktok';
    else if (v.includes('instagram.com')) currentDlType = 'instagram';
    else if (v.includes('magnet:') || v.endsWith('.mp4') || v.endsWith('.mkv')) currentDlType = 'direct';
    else currentDlType = 'direct'; // Default to direct

    // Visual feedback
    document.querySelectorAll('.dl-type-btn').forEach(b => b.classList.remove('active'));
    $(`#dl-type-${currentDlType === 'youtube' ? 'yt' : currentDlType === 'instagram' ? 'insta' : currentDlType}`)?.classList.add('active');

    if (!$('#dl-name').value) {
      try {
        $('#dl-name').placeholder = 'Fetching title...';
        // Try YouTube OEmbed first for speed if it's youtube
        let titleFound = false;
        if (currentDlType === 'youtube') {
          const res = await fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json');
          if (res.ok) {
            const json = await res.json();
            if (json && json.title && !$('#dl-name').value) {
              $('#dl-name').value = json.title.replace(/[<>:"/\\|?*]/g, '').trim();
              titleFound = true;
            }
          }
        }

        // If not found or not youtube, use backend yt-dlp fetcher
        if (!titleFound) {
          const meta = await window.api.fetchUrlMetadata(url);
          if (meta && meta.success && meta.title && !$('#dl-name').value) {
            $('#dl-name').value = meta.title.replace(/[<>:"/\\|?*]/g, '').trim();
          }
        }
      } catch (err) { } finally { $('#dl-name').placeholder = 'e.g. Breaking Bad'; }
    }
  });
  $('#btn-start-dl').onclick = startDownload;
  if ($('#dl-type-yt')) $('#dl-type-yt').onclick = () => setDlType('youtube');
  if ($('#dl-type-tiktok')) $('#dl-type-tiktok').onclick = () => setDlType('tiktok');
  if ($('#dl-type-insta')) $('#dl-type-insta').onclick = () => setDlType('instagram');
  if ($('#dl-type-direct')) $('#dl-type-direct').onclick = () => setDlType('direct');
  if ($('#dl-type-series')) $('#dl-type-series').onclick = () => setDlType('series');

  $('#btn-clear-history').onclick = () => { appData.downloadHistory = []; persist(); renderDownloadHistory(); showToast('History Cleared'); };

  // Clear TMDB Cache
  const btnClearCache = $('#btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.onclick = async () => {
      btnClearCache.disabled = true;
      btnClearCache.textContent = 'Clearing...';
      appData.tmdbCache = {};
      appData.banners = {};
      await window.api.clearCache();
      persist();
      showToast('Cache and Images Cleared! Please rescan library.');
      setTimeout(() => {
        btnClearCache.disabled = false;
        btnClearCache.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear TMDB Cache & Images';
      }, 2000);
    };
  }

  function renderSettings() {
    if ($('#config-torrentio')) $('#config-torrentio').value = appData.scraperConfig?.torrentio || appData.scraperConfig?.torrentio_url || 'https://torrentio.strem.fun';
    if ($('#config-remote-server')) $('#config-remote-server').value = appData.remoteStreamingServer || '';
    
    // Existing settings
    if ($('#tmdb-key-masked')) $('#tmdb-key-masked').value = appData.tmdbKey ? '••••••••••••' : '';
    if ($('#update-auto-check')) $('#update-auto-check').checked = appData.autoUpdate !== false;
  }

  const btnSaveSettings = $('#btn-save-config');
  if (btnSaveSettings) {
    btnSaveSettings.onclick = () => {
      const torrentio = $('#config-torrentio')?.value.trim() || 'https://torrentio.strem.fun';
      const remoteServer = $('#config-remote-server')?.value.trim() || '';
      
      appData.scraperConfig = appData.scraperConfig || {};
      appData.scraperConfig.torrentio = torrentio;
      appData.scraperConfig.torrentio_url = torrentio; // Maintain backward compatibility
      appData.remoteStreamingServer = remoteServer;
      
      persist();
      showToast('Settings saved ✓');
    };
  }

  // Zoom Controls
  function updateZoom(delta) {
    let current = appData.zoomFactor || 1;
    if (delta === 0) current = 1;
    else current = Math.max(0.5, Math.min(2.0, current + delta));
    appData.zoomFactor = current;
    persist();
    if (window.api.setZoom) window.api.setZoom(current);
  }
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
    activeDownloads.set(data.id, { ...dl, ...data, percent: parseFloat(data.percent) });

    const dlItem = document.querySelector(`[data-dl-id="${data.id}"]`);
    if (!dlItem) { renderActiveDownloads(); return; }

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

  // Automatically refresh when background metadata (like thumbnails) is ready
  window.api.onMetadataReady(data => {
    console.log('[RENDERER] Background metadata ready:', data.path);
    scanLibrary();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ── Library ──
  async function scanLibrary() {
    const btn = $('#btn-rescan');
    if (btn) btn.disabled = true;
    showToast('Scanning library...');
    const allMovies = [], allShows = [];

    // 1. Scan user-added library folders
    for (const folder of appData.libraryFolders) {
      try {
        const { movies, shows } = await window.api.scanLibrary(folder);
        allMovies.push(...movies); allShows.push(...shows);
      } catch (e) { console.error('Scan error:', e); }
    }

    // 2. Scan Profile-specific organized folders
    if (currentProfile) {
      const pPaths = await window.api.invoke('get-profile-media-paths', currentProfile.name);
      if (pPaths) {
        // Movies
        try { const { movies } = await window.api.scanLibrary(pPaths.movies); allMovies.push(...movies); } catch (e) { }
        // Series
        try { const { shows } = await window.api.scanLibrary(pPaths.series); allShows.push(...shows); } catch (e) { }
        // Social — use the already-resolved pPaths (no redeclaration!)
        try {
          console.log('[SCAN] Scanning Social folder:', pPaths.social);
          let socialVids = [];
          try {
            socialVids = await window.api.scanYoutube(pPaths.social);
          } catch (e) {
            console.warn('[SCAN] Social scan failed:', e);
          }
          console.log('[SCAN] Found Social videos:', socialVids?.length || 0);
          if (socialVids) appData.socialVideos = socialVids;
        } catch (e) { console.error('[SCAN] Social scan error:', e); }
        // Music
        try {
          console.log('[SCAN] Scanning Music folder:', pPaths.music);
          const musicData = await window.api.invoke('scan-music', pPaths.music);
          console.log('[SCAN] Found Music tracks:', musicData?.length || 0);
          if (musicData) appData.music = musicData;
        } catch (e) { console.error('[SCAN] Music scan error:', e); }
      }
    }

    appData.movies = allMovies; appData.shows = allShows;

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

    persist(); renderLibrary(); renderSidebar(); renderSocial();
    if (btn) btn.disabled = false;
    showToast('Library updated');
    autoMatchTmdb();
  }

  function renderLibContinueWatching() {
    const row = $('#lib-continue-row');
    const section = $('#lib-continue-section');
    if (!row || !section || !currentProfile?.playback) return;

    const items = [...(appData.movies || []), ...(appData.shows || [])].filter(item => {
      const pb = currentProfile.playback[getPlaybackKey(item)];
      return pb && pb.time > 10 && (pb.time / pb.duration) < 0.9;
    }).sort((a, b) => {
      const pbA = currentProfile.playback[getPlaybackKey(a)] || {};
      const pbB = currentProfile.playback[getPlaybackKey(b)] || {};
      return (pbB.lastWatched || 0) - (pbA.lastWatched || 0);
    }).slice(0, 10);

    if (items.length) {
      section.style.display = 'block';
      row.innerHTML = '';
      items.forEach(item => {
        const card = createMediaCard(item);
        const pb = currentProfile.playback[getPlaybackKey(item)];
        const progress = (pb.time / pb.duration) * 100;
        const bar = document.createElement('div');
        bar.style.cssText = `position:absolute; bottom:0; left:0; right:0; height:4px; background:rgba(255,255,255,0.1); z-index:10;`;
        bar.innerHTML = `<div style="height:100%; width:${progress}%; background:var(--accent);"></div>`;
        card.appendChild(bar);
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
    const watchlist = currentProfile?.watchlist || [];
    $('#lib-recent-watchlist-section').style.display = watchlist.length ? 'block' : 'none';
    watchlist.slice(-10).reverse().forEach(w => {
      const item = [...(appData.movies || []), ...(appData.shows || [])].find(m => m.id === w.id);
      if (item) row.appendChild(createMediaCard(item));
    });
  }



  async function autoMatchTmdb() {
    const cache = appData.tmdbCache = appData.tmdbCache || {};
    const items = [...(appData.movies || []), ...(appData.shows || [])];
    let matched = 0;
    for (const item of items) {
      if (cache[item.id]) continue;
      const type = item.type === 'show' ? 'tv' : 'movie';
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
          const res = await window.api.tmdbSearch(type, query);
          if (res.results?.length) {
            // If we have a year, try to find a result from that year first
            let m = res.results[0];
            if (itemYear) {
              const yearMatch = res.results.find(r => {
                const rYear = (r.release_date || r.first_air_date || '').slice(0, 4);
                return rYear === itemYear;
              });
              if (yearMatch) m = yearMatch;
            }
            cache[item.id] = { tmdbId: m.id, type, title: m.title || m.name, posterPath: m.poster_path, backdropPath: m.backdrop_path, rating: m.vote_average, overview: m.overview, year: (m.release_date || m.first_air_date || '').slice(0, 4) };
            if (m.poster_path && !appData.banners[item.id]) {
              const lp = await window.api.downloadImage(m.poster_path, item.id);
              if (lp) appData.banners[item.id] = lp;
            }
            matched++; found = true; break;
          }
        } catch (err) {
          console.warn('[TMDB-MATCH] Error matching item:', err.message);
        }
        await new Promise(r => setTimeout(r, 150));
      }
      if (!found) await new Promise(r => setTimeout(r, 100));
    }
    if (matched > 0) { persist(); renderLibrary(); showToast(`Matched ${matched} items from TMDB`); }
  }

  // ── Render ──
  function renderLibrary() {
    renderMovies();
    renderShows();
    renderLibContinueWatching();
    renderLibContinueListening();
    renderLibRecentWatchlist();
    updateBadges();

    // Handle My Space Dashboard Empty State
    const hasContent = (appData.movies?.length > 0) || (appData.shows?.length > 0) || (appData.music?.length > 0) || (currentProfile?.watchlist?.length > 0);
    const emptyState = $('#myspace-empty-state');
    if (emptyState) emptyState.style.display = hasContent ? 'none' : 'block';

    const hero = $('#myspace-hero');
    if (hero) hero.style.display = hasContent ? 'block' : 'none';
  }
  function updateBadges() {
    const mc = (appData.movies || []).length, sc = (appData.shows || []).length;
    // Count social videos from both profile and legacy folder
    const socCount = (appData.socialVideos || []).length + (appData.youtubeVideos || []).length;

    const bm = $('#badge-movies'), bs = $('#badge-shows'), by = $('#badge-social');
    if (bm) { bm.textContent = mc; bm.classList.toggle('visible', mc > 0); }
    if (bs) { bs.textContent = sc; bs.classList.toggle('visible', sc > 0); }
    if (by) { by.textContent = socCount; by.classList.toggle('visible', socCount > 0); }

    const cM = $('#movies-count'), cS = $('#shows-count'), cY = $('#social-count'), cMu = $('#music-count'), cW = $('#watchlist-count');
    if (cM) cM.textContent = mc ? mc + ' item' + (mc > 1 ? 's' : '') : '0 items';
    if (cS) cS.textContent = sc ? sc + ' show' + (sc > 1 ? 's' : '') : '0 items';
    const muc = (appData.music || []).length;
    if (cMu) cMu.textContent = muc ? muc + ' track' + (muc > 1 ? 's' : '') : '0 tracks';
    const wlc = (currentProfile?.watchlist || []).length;
    if (cW) cW.textContent = wlc ? wlc + ' item' + (wlc > 1 ? 's' : '') : '0 items';
  }

  function renderMovies() {
    const g = $('#movies-grid'); g.innerHTML = '';
    const movies = (appData.movies || []).filter(m => !isLocked(m.id));
    $('#movies-empty').style.display = movies.length ? 'none' : 'flex';
    const q = ($('#search-movies')?.value || '').toLowerCase();
    (q ? movies.filter(m => m.title.toLowerCase().includes(q)) : movies).forEach(m => g.appendChild(createMediaCard(m)));
  }
  function renderShows() {
    const g = $('#shows-grid'); g.innerHTML = '';
    const shows = (appData.shows || []).filter(s => !isLocked(s.id));
    $('#shows-empty').style.display = shows.length ? 'none' : 'flex';
    const q = ($('#search-shows')?.value || '').toLowerCase();
    (q ? shows.filter(s => s.title.toLowerCase().includes(q)) : shows).forEach(s => g.appendChild(createMediaCard(s)));
  }

  function renderSocial() {
    console.log('[RENDER-SOCIAL] Starting render... ProfileVideos:', appData.socialVideos?.length || 0, 'LegacyVideos:', appData.youtubeVideos?.length || 0);
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
    console.log('[RENDER-SOCIAL] Total videos after filter:', all.length);

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
        } else {
          // Native video frame thumbnail for local files
          const safePath = 'file:///' + encodeURIComponent(v.path.replace(/\\/g, '/')).replace(/%2F/g, '/').replace(/%3A/g, ':');
          // Show the frame at 5 seconds (avoid black screens at 0s)
          imgHTML = `<video src="${safePath}#t=5" style="width:100%;height:100%;object-fit:cover;border-radius:0;" preload="metadata" muted playsinline></video>`;
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
        e.preventDefault();
        contextTarget = { ...v, id: v.path, title, path: v.path, type: 'social', filename: v.name };

        const cm = $('#context-menu');
        cm.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
        cm.style.top = Math.min(e.clientY, window.innerHeight - 250) + 'px';

        // Hide non-relevant items
        $('#ctx-tmdb-search').style.display = 'none';
        $('#ctx-cover').style.display = 'none';
        $('#ctx-edit-music').style.display = 'none';
        $('#ctx-rename').style.display = 'flex';
        $('#ctx-delete').style.display = 'flex';

        cm.style.display = 'block';
      };
      g.appendChild(card);
    });
    updateBadges();
  }

  function createMediaCard(item) {
    const card = document.createElement('div'); card.className = 'media-card';
    const isShow = item.type === 'show', epCount = isShow ? (item.episodes || []).length : 0;
    const isYoutube = item.isYoutube || item.type === 'youtube';
    const bannerPath = appData.banners[item.id];
    const tmdb = (appData.tmdbCache || {})[item.id];
    let progressHTML = '';
    const pbKey = getPlaybackKey(item);
    if (!isShow && currentProfile?.playback[pbKey]?.duration > 0) {
      const pct = Math.min((currentProfile.playback[pbKey].time / currentProfile.playback[pbKey].duration) * 100, 100).toFixed(1);
      progressHTML = `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`;
    }
    let posterInner = '';

    // Priority 1: Local Banner (User uploaded or auto-downloaded)
    if (bannerPath) {
      const fallbackUrl = tmdb?.posterPath ? `https://image.tmdb.org/t/p/w342${tmdb.posterPath}` : (tmdb?.backdropPath ? `https://image.tmdb.org/t/p/w342${tmdb.backdropPath}` : '');
      const errScript = fallbackUrl ? `this.onerror=null;this.src='${fallbackUrl}';` : `this.style.display='none';this.parentElement.querySelector('.card-poster-placeholder')?.style.removeProperty('display')`;
      posterInner = `<img src="${localImg(bannerPath)}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="${errScript}">`;
    }
    // Priority 2: TMDB Backdrop/Poster from cache
    else if (tmdb && (tmdb.posterPath || tmdb.backdropPath)) {
      const url = tmdb.posterPath ? `https://image.tmdb.org/t/p/w342${tmdb.posterPath}` : `https://image.tmdb.org/t/p/w342${tmdb.backdropPath}`;
      posterInner = `<img src="${url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`;
    }
    let ratingHTML = tmdb?.rating > 0 ? `<div class="card-rating"><svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${tmdb.rating.toFixed(1)} <span style="opacity:0.6;font-size:10px;margin-left:4px">ID:${tmdb.tmdbId || item.id}</span></div>` : '';
    let metaText = isShow ? epCount + ' episode' + (epCount > 1 ? 's' : '') : (isYoutube ? 'Video' : 'Movie');
    if (tmdb?.year) metaText += ` · ${tmdb.year}`;
    card.innerHTML = `<div class="card-poster">${posterInner}<div class="card-poster-placeholder" ${posterInner ? 'style="display:none"' : ''}><div class="ph-icon">${isYoutube ? '<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L11.818 12l-6.273 3.568z"/></svg>' : (isShow ? SVG_SHOW : SVG_MOVIE)}</div><span class="ph-text">${escapeHTML(item.title)}</span></div><div class="card-play-overlay"><div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div><button class="btn-tmdb-search" title="Search TMDB"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button></div></div><div class="card-info"><div class="card-title" title="${escapeHTML(tmdb?.title || item.title)}">${escapeHTML(tmdb?.title || item.title)}</div><div class="card-meta">${metaText}</div>${ratingHTML}${progressHTML}</div>`;
    card.querySelector('.btn-tmdb-search').onclick = (e) => { e.stopPropagation(); openTmdbSearchModal(item); };
    card.onclick = () => { if (isShow) openShowDetail(item); else playVideo(item); };
    card.oncontextmenu = e => {
      e.preventDefault();
      contextTarget = item;
      const pl = $('#ctx-pin-label');
      if (pl) pl.textContent = (currentProfile?.pinned || []).includes(item.id) ? 'Unpin' : 'Pin';
      const ll = $('#ctx-lock-label');
      if (ll) ll.textContent = (currentProfile?.lockedItems || []).includes(item.id) ? 'Unlock Item' : 'Lock Item';

      const cm = $('#context-menu');
      cm.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
      cm.style.top = Math.min(e.clientY, window.innerHeight - 250) + 'px';

      const isMusic = item.type === 'music';
      $('#ctx-edit-music').style.display = isMusic ? 'flex' : 'none';
      $('#ctx-delete-music').style.display = isMusic ? 'flex' : 'none';
      $('#ctx-tmdb-search').style.display = isMusic ? 'none' : 'flex';
      $('#ctx-cover').style.display = isMusic ? 'none' : 'flex';
      $('#ctx-rename').style.display = isMusic ? 'none' : 'flex';
      $('#ctx-delete').style.display = isMusic ? 'none' : 'flex';

      cm.style.display = 'block';
    };
    return card;
  }

  // ── Show Detail ──
  function openShowDetail(show, partName = null) {
    currentShowId = show.id; currentShow = show; currentEpisodes = show.episodes || []; currentEpisodeIndex = -1;
    if (!partName && show.parts?.length > 0) currentPart = show.parts[0].name; else currentPart = partName;
    const tmdb = (appData.tmdbCache || {})[show.id];
    $('#show-detail-title').textContent = tmdb?.title || show.title;
    const metaEl = $('#show-detail-meta'); metaEl.innerHTML = '';
    if (tmdb) { if (tmdb.rating) metaEl.innerHTML += `<span class="tmdb-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="#F59E0B" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${tmdb.rating.toFixed(1)} <span style="opacity:0.6;font-size:10px;margin-left:4px">ID:${tmdb.tmdbId || show.id}</span></span>`; if (tmdb.year) metaEl.innerHTML += `<span class="tmdb-badge">${tmdb.year}</span>`; }
    const headerLeft = $('#view-show-detail .view-header-left'); $('#btn-mark-all-watched')?.remove();
    if (currentEpisodes.length > 0) { const b = document.createElement('button'); b.id = 'btn-mark-all-watched'; b.className = 'btn-outline'; b.style.cssText = 'margin-left:12px;padding:4px 10px;font-size:11px'; b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg> Mark All Watched'; b.onclick = markAllWatched; headerLeft.appendChild(b); }
    const el = $('#episode-list'); el.innerHTML = '';
    if (show.parts?.length > 0) { const pt = document.createElement('div'); pt.className = 'season-tabs'; show.parts.forEach(p => { const t = document.createElement('div'); t.className = 'season-tab' + (p.name === currentPart ? ' active' : ''); t.textContent = p.name; t.onclick = () => openShowDetail(show, p.name); pt.appendChild(t); }); el.appendChild(pt); }
    const filtered = currentPart ? currentEpisodes.filter(e => e.partName === currentPart) : currentEpisodes;
    const dc = $('#show-detail-count'); if (dc) dc.textContent = `${filtered.length} episode${filtered.length > 1 ? 's' : ''}`;
    const seasons = {}; filtered.forEach(ep => { (seasons[ep.season] = seasons[ep.season] || []).push(ep); });

    Object.keys(seasons).sort((a, b) => +a - +b).forEach(sn => {
      const h = document.createElement('div'); h.className = 'season-header'; h.style.display = 'flex'; h.style.justifyContent = 'space-between'; h.style.alignItems = 'center';
      const mSn = (appData.seasonOffset && appData.seasonOffset[`${show.id}_${sn}`]) || sn;
      h.innerHTML = `<span>Season ${sn} ${mSn != sn ? `<span style="opacity:0.5;font-size:11.5px;margin-left:6px">(TMDB S${mSn})</span>` : ''}</span><button class="btn-outline" style="padding:4px 10px;font-size:11px;opacity:0.8;border-color:var(--border)">Fix TMDB Match</button>`;
      h.querySelector('button').onclick = (e) => {
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
        h.appendChild(div);
        inp.focus();
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
        seasons[sn].forEach(ep => {
          const idx = currentEpisodes.indexOf(ep);
          const it = document.createElement('div'); it.className = 'episode-item';
          const pb = currentProfile?.playback[ep.path] || {};
          const isW = pb.watched || (pb.duration > 0 && (pb.time / pb.duration) > .9);
          let pH = ''; if (pb.duration > 0) pH = `<div class="episode-progress"><div class="episode-progress-fill" style="width:${Math.min((pb.time / pb.duration) * 100, 100).toFixed(1)}%"></div></div>`;

          const epNum = parseInt(ep.episode);
          const tE = tmdbEps[epNum] || tmdbEps[String(ep.episode)];
          const epTitle = tE?.name || ep.title;
          const epDesc = tE?.overview || '';
          const still = tE?.local_still ? `file:///${tE.local_still.replace(/\\/g, '/')}` : (tE?.still_path ? `https://image.tmdb.org/t/p/w300${tE.still_path}` : '');

          it.innerHTML = `<div class="ep-thumb-wrap">
              ${still ? `<img class="ep-thumb" src="${still}" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div class="ep-number-overlay">${ep.episode}</div>
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
          it.oncontextmenu = e => { e.preventDefault(); contextTarget = ep; };
          seasonContainer.appendChild(it);
        });
      };

      renderEps();

      if (tmdb?.tmdbId && !cachedSeasons[sn]) {
        const mappedSn = (appData.seasonOffset && appData.seasonOffset[`${show.id}_${sn}`]) || sn;
        window.api.tmdbSeasonDetails(tmdb.tmdbId, mappedSn).then(async data => {
          if (data && data.episodes) {
            data.episodes.forEach(e => { tmdbEps[e.episode_number] = e; });

            let currentMappedSn = mappedSn;
            let maxTmdbEp = Math.max(0, ...data.episodes.map(e => e.episode_number));
            const maxPhysicalEp = Math.max(0, ...seasons[sn].map(ep => ep.episode));

            // Allow up to 5 spillover seasons to prevent infinite loops on broken databases
            let spilloverAttempts = 0;
            while (maxPhysicalEp > maxTmdbEp && maxTmdbEp > 0 && spilloverAttempts < 5) {
              currentMappedSn++;
              spilloverAttempts++;
              const nextData = await window.api.tmdbSeasonDetails(tmdb.tmdbId, currentMappedSn);
              if (nextData && nextData.episodes && nextData.episodes.length > 0) {
                nextData.episodes.forEach(e => { tmdbEps[e.episode_number + maxTmdbEp] = e; });
                maxTmdbEp += Math.max(0, ...nextData.episodes.map(e => e.episode_number));
              } else break;
            }

            tmdb.seasons = tmdb.seasons || {};
            tmdb.seasons[sn] = tmdbEps;
            persist();
            renderEps();

            // Background async fetch local stills for true offline viewing
            Object.values(tmdbEps).forEach(e => {
              if (e.still_path && !e.local_still) {
                window.api.downloadImage(e.still_path, `ep_${tmdb.tmdbId}_s${sn}e${e.episode_number}`).then(lp => {
                  if (lp) { e.local_still = lp; persist(); }
                });
              }
            });
          }
        }).catch(() => { });
      }
    });
    switchView('show-detail');
  }

  async function markAllWatched() {
    if (!currentShow || !currentProfile) return;
    (currentPart ? currentEpisodes.filter(e => e.partName === currentPart) : currentEpisodes).forEach(ep => {
      const pbKey = getPlaybackKey(ep);
      currentProfile.playback[pbKey] = { ...(currentProfile.playback[pbKey] || {}), watched: true, time: 0, lastWatched: Date.now() };
    });
    await persist();
    openShowDetail(currentShow, currentPart);
    showToast('Marked as watched');
  }

  // ── Sidebar ──
  function renderSidebar() {
    renderSidebarFolders();
    renderSettingsFolders();

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
  function renderSettingsFolders() { const c = $('#settings-folders-list'); if (!c) return; c.innerHTML = ''; (appData.libraryFolders || []).forEach((fp, i) => { const el = document.createElement('div'); el.className = 'sidebar-folder-item'; el.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="fi-path">${fp}</span><button class="fi-remove" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`; el.querySelector('.fi-remove').onclick = e => { e.stopPropagation(); appData.libraryFolders.splice(i, 1); persist(); renderSettingsFolders(); renderSidebarFolders(); scanLibrary(); }; c.appendChild(el); }); }

  function getPlaybackKey(item) {
    if (!item) return '';
    // Stable identifier so Torrents/Streams (which change path URL) don't lose progress
    const baseKey = item.tmdbId || item.id || item.path;
    return item.season ? `${baseKey}_S${item.season}E${item.episode}` : baseKey;
  }

  // ── Video Player ──
  async function playVideo(item, show) {
    playerSubCurrentDir = ''; // Reset subtitle folder navigation
    document.body.classList.add('playing-mode');
    currentItem = item;
    if (show) {
      currentShow = show;
      currentShowId = show.id;
      currentEpisodes = show.episodes || [];
      currentEpisodeIndex = currentEpisodes.findIndex(e => getPlaybackKey(e) === getPlaybackKey(item));
    } else if (item.season !== undefined && currentShow) {
      currentEpisodeIndex = currentEpisodes.findIndex(e => getPlaybackKey(e) === getPlaybackKey(item));
    } else {
      currentShow = null;
      currentEpisodes = [];
      currentEpisodeIndex = -1;
    }

    switchView('player');

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
    $('#player-progress-text').textContent = 'Initializing...';
    $('#player-speed-text').textContent = '';

    // Codec Warning for high-end audio
    if (item.title.match(/atmos|truehd|dts|remux/i)) {
      showToast("Note: This file has high-end audio that may not play in-app. Try downloading it.");
    }

    // Hide playlist button for YouTube/Streams or standalone movies
    const isYT = item.isYoutube || item.type === 'youtube' || item.type === 'stream';
    const isMovie = !currentEpisodes || currentEpisodes.length <= 1;
    $('#btn-toggle-playlist').style.display = (isYT || isMovie) ? 'none' : 'flex';
    if (isYT || isMovie) closeSidePanel();

    // Music Mode Handling
    const playerWrapper = $('#player-wrapper');
    const playerMusicToggle = $('#player-music-toggle');
    const musicPoster = $('#music-poster-container');
    const musicPosterImg = $('#music-poster-img');
    const musicPosterBg = $('#music-poster-bg');

    isPlayingMusic = !!(item.isVideoMusic || item.type === 'music');
    if (isPlayingMusic) {
      playerWrapper.classList.add('is-music-mode');
      playerMusicToggle.style.display = 'flex';
      const override = appData.musicMetadata[item.id] || {};
      const coverSrc = override.cover || (item.cover ? localImg(item.cover) : '');
      musicPosterImg.src = coverSrc;

      // Populate central metadata
      $('#music-title').textContent = override.title || cleanTechnicalTitle(item.title);
      $('#music-artist').textContent = override.artist || (currentShow?.title || 'Unknown Artist');

      // Default to "Art" mode for Music tab items
      togglePlayerMode('art');
    } else {
      playerWrapper.classList.remove('is-music-mode');
      if (playerMusicToggle) playerMusicToggle.style.display = 'none';
      if (musicPoster) musicPoster.style.display = 'none';
      togglePlayerMode('video');
      $('#video-element').style.visibility = 'visible';
    }
    video.querySelectorAll('track').forEach(t => t.remove()); subtitleTrack = null; subtitlesEnabled = false; $('#btn-subtitle').classList.remove('subtitle-on'); $('#btn-subtitle').classList.add('subtitle-off');

    function togglePlayerMode(mode) {
      const musicPoster = $('#music-poster-container');
      const videoEl = $('#video-element');
      const btnArt = $('#btn-player-art');
      const btnVideo = $('#btn-player-video');
      const playerControls = $('#player-controls');

      if (mode === 'art') {
        musicPoster.style.display = 'flex';
        setTimeout(() => musicPoster.classList.add('active'), 10);
        videoEl.style.visibility = 'hidden';
        if (playerControls) playerControls.style.display = 'none'; // Hide bottom bar in Art mode
        btnArt.classList.add('active');
        btnVideo.classList.remove('active');
      } else {
        musicPoster.classList.remove('active');
        setTimeout(() => musicPoster.style.display = 'none', 600);
        videoEl.style.visibility = 'visible';
        if (playerControls) playerControls.style.display = 'block'; // Restore bottom bar in Video mode
        btnArt.classList.remove('active');
        btnVideo.classList.add('active');
      }
    }

    $('#btn-player-art').onclick = () => togglePlayerMode('art');
    $('#btn-player-video').onclick = () => togglePlayerMode('video');

    // Music Cluster Events
    $('#music-btn-play-pause').onclick = () => engine.togglePause();
    $('#music-btn-prev').onclick = () => engine.seekRelative(-10);
    $('#music-btn-next').onclick = () => engine.seekRelative(10);

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
    const pathUrl = item.path;

    // RESET PLAYER STATE FOR NEW ITEM
    window.activeSubtitlePath = null;
    currentAudioTrackIndex = -1;
    currentInternalSubIndex = -1;
    subtitlesEnabled = false;
    $('#btn-subtitle').classList.remove('subtitle-on');
    $('#btn-subtitle').classList.add('subtitle-off');
    video.querySelectorAll('track').forEach(t => t.remove());

    // Defensive Mini-player Reset (Ensures no radio visualizer sticks)
    const vizSmall = $('#mp-radio-visualizer');
    const btnPlayPause = $('#mp-btn-play-pause');
    if (vizSmall) vizSmall.style.display = 'none';
    if (btnPlayPause) btnPlayPause.style.display = 'flex';
    $('#mp-info-click').style.cursor = 'pointer';

    const engineMsg = engine.isUsingMpv ? 'mpv Engine' : 'HTML5 Fallback';
    $('#player-progress-text').textContent = `Loading via ${engineMsg}...`;

    // Restore progress
    const pbKey = getPlaybackKey(item);
    const pb = currentProfile?.playback[pbKey];
    const startTime = (pb && pb.time > 2) ? pb.time : 0;
    // ─── Android: UNIVERSAL EXTERNAL PLAYER HANDOFF ───
    // On mobile, ALL media is opened in an external player (VLC, MX Player,
    // Stremio, etc.). The internal video player is NEVER used on mobile.
    if (window.api && window.api.isMobile && window.api.isMobile()) {
      showToast('Opening in external player...');
      console.log('[playVideo] Mobile: handing off to PlayMediaService:', pathUrl);

      // Delegate to the global PlayMediaService (defined in bridge.js)
      const externalResult = await (window.PlayMediaService
        ? window.PlayMediaService.play(pathUrl, { title: displayTitle || item.title })
        : window.api.playExternal
          ? window.api.playExternal(pathUrl, { title: displayTitle || item.title })
          : window.api.invoke('open-in-vlc', pathUrl)
      );

      console.log('[playVideo] External handoff result:', externalResult);

      // Clean up — hide loading, exit internal player view
      $('#player-loading').style.display = 'none';
      clearInterval(saveInterval);
      try { await engine.stop(); } catch(e) {}
      document.body.classList.remove('playing-mode');

      // Go back to previous view (don't leave user stuck on player screen)
      if (typeof exitPlayer === 'function') {
        exitPlayer(true, true);
      }
      return;
    }

    await engine.load(pathUrl, { startTime: startTime, paused: false });

    // Start periodic save
    clearInterval(saveInterval);
    saveInterval = setInterval(saveProgress, 10000); // Every 10 seconds

    // Auto-search for local subtitles
    try {
      if (!item.isStream && !item.path.startsWith('http')) {
        const subs = await window.api.findSubtitles(item.path);
        if (subs && subs.length > 0) {
          await loadSubtitleLocal(subs[0].path);
        }
      }
    } catch (err) {
      console.error('[SUBTITLE-LOAD] Failed to load subtitle:', err.message);
    }

    setTimeout(() => { $('#player-loading').style.display = 'none'; }, 800);
    populateSidePanel();
  }

  async function saveProgress() {
    if (!currentItem || !currentProfile) return;
    try {
      const time = await engine.getAccurateTime();
      const dur = await engine.getAccurateDuration();
      if (dur > 0 && time > 2) {
        const pbKey = getPlaybackKey(currentItem);
        currentProfile.playback[pbKey] = { time, duration: dur, lastWatched: Date.now() };
        persist();
      }
    } catch (e) { console.error('[SAVE-PROGRESS] Failed:', e.message); }
  }

  // Legacy Cloud Subtitles Removed

  function updateVolumeIcon() { const off = engine.muted || engine.volume === 0; const vol = $('#icon-vol'); if (vol) vol.style.display = off ? 'none' : 'block'; const mute = $('#icon-mute'); if (mute) mute.style.display = off ? 'block' : 'none'; }
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
      await saveProgress();
    }

    if (shouldStop) {
      await engine.stop();
      clearInterval(saveInterval);

      currentInternalSubIndex = -1;

      if (window.api && window.api.invoke) {
        window.api.invoke('stop-torrent-stream');
      }
      subtitlesEnabled = false;
      if ($('#btn-subtitle')) {
        $('#btn-subtitle').classList.remove('subtitle-on');
        $('#btn-subtitle').classList.add('subtitle-off');
      }

      // Clear Discord RPC
      if (window.api.updateDiscordActivity) {
        window.api.updateDiscordActivity({ type: 'browsing' });
      }
    }

    cancelAutoNext();
    if (isFullscreen) await toggleFullscreen();
    closeSidePanel();
    if (shouldSwitchView) {
      if (playerSourceView) switchView(playerSourceView);
      else switchView(appData.lastView || 'movies');
    }
    renderLibrary();
    // (Sidebar recent removed) 
  }
  function openSidePanel() { $('#player-side-panel').classList.add('open'); panelOpen = true; $('#player-eq-panel').classList.remove('open'); }
  function closeSidePanel() {
    $('#player-side-panel').classList.remove('open');
    $('#player-tracks-panel').classList.remove('open');
    $('#player-subs-panel').classList.remove('open');
    panelOpen = false;
  }


  async function switchAudioTrack(index) {
    if (!currentItem) return;
    currentAudioTrackIndex = index;
    showToast('Switching audio track...');

    if (engine.isUsingMpv) {
      await engine.setAudioTrack(index);
      if (currentMediaMetadata && currentMediaMetadata.audio) {
        currentMediaMetadata.audio.forEach(t => t.selected = t.index === index);
        renderTracksPanel(currentMediaMetadata);
      }
      showToast('Track switched');
    } else {
      showToast('Need mpv to switch tracks. (Using built-in player)');
    }
    closeSidePanel();
  }

  async function switchSubtitleTrack(index) {
    if (!currentItem) return;
    currentInternalSubIndex = index;
    showToast('Switching subtitle track...');

    if (engine.isUsingMpv) {
      await engine.setSubtitleTrack(index);
      if (currentMediaMetadata && currentMediaMetadata.subtitle) {
        currentMediaMetadata.subtitle.forEach(t => t.selected = t.index === index);
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

    } else {
      showToast('Need mpv to switch internal subtitles.');
    }
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

    if (!streams || !streams.subtitles || !streams.subtitles.length) {
      subsList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:10px;">No internal subtitles found.</div>';
    } else {
      streams.subtitles.forEach(s => {
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
  }

  // ── Audio Equalizer ──
  let audioCtx, mediaSource, eqNodes = [];
  const EQ_BANDS = [60, 230, 910, 3600, 14000];
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    movie: [3, 1, 0, 2, 1],
    voice: [-2, 0, 3, 4, 1],
    bass: [6, 3, 0, 0, -1]
  };

  $('#btn-eq').onclick = () => {
    if (!audioCtx) initAudioEQ();
    $('#player-side-panel').classList.remove('open'); panelOpen = false;
    $('#player-eq-panel').classList.toggle('open');
  };
  $('#btn-close-eq').onclick = () => $('#player-eq-panel').classList.remove('open');

  function initAudioEQ() {
    if (audioCtx) return; // Guard against re-initialization

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
      mediaSource = audioCtx.createMediaElementSource(video);
    } catch (e) {
      console.warn('[AUDIO] MediaSource already bound:', e.message);
      // If already bound, we must not exit, but continue setup with existing mediaSource
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
      const v = gains[i] || 0;
      sl.value = v;
      if (sl.nextElementSibling) sl.nextElementSibling.textContent = v;
      if (eqNodes[i]) eqNodes[i].gain.value = v;
    });
  }

  function populateSidePanel() {
    const pl = $('#panel-episode-list'); pl.innerHTML = '';
    if (!currentEpisodes.length) return;

    // Attempt to load TMDB cache
    const tmdb = currentShow ? (appData.tmdbCache || {})[currentShow.id] : null;

    currentEpisodes.forEach((ep, i) => {
      // Resolve TMDB Data for this episode
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
        displayTitle = `S${String(sn).padStart(2, '0')}E${String(next.episode).padStart(2, '0')} · ${tE.name}`;
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
        try { await engine.stop(); } catch(e) {}
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

  // ══════════════════════════════════════════════════════════════════════════
  //  DISCOVER
  // ══════════════════════════════════════════════════════════════════════════
  // Discover Scroll Helper
  window.scrollRow = (btn, dir) => {
    const row = btn.closest('.discover-section').querySelector('.discover-row');
    const amount = row.clientWidth * 0.8 * dir;
    row.scrollBy({ left: amount, behavior: 'smooth' });
  };

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
        const kitsuData = await window.api.kitsuTrending();
        finalItems = kitsuData?.results || [];
      } else {
        const tmdbData = await window.api.tmdbDiscoverByGenre(id);
        finalItems = (tmdbData.results || []).filter(item => item.adult !== true);
      }
      renderDiscoverGrid('#genre-grid', finalItems);
    } catch {
      grid.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load genre content.</div>';
    }
  }

  function renderDiscoverGrid(sel, items) {
    const grid = $(sel);
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
      let posterUrl = '';
      if (item.poster_path) {
        posterUrl = item.poster_path.startsWith('http') ? item.poster_path : `${TMDB_IMG}/w342${item.poster_path}`;
      }
      const inLib = localTitles.has(title.toLowerCase());
      const label = item.media_type === 'tv' ? 'SERIES' : 'MOVIE';
      const year = (item.release_date || item.first_air_date || '').slice(0, 4);
      const rating = item.vote_average || 0;

      card.innerHTML = `
        <div class="discover-poster-wrap">
          ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-surface-2)"><i class="fas fa-image fa-2x"></i></div>`}
          <div class="discover-card-badge">${label}</div>
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="discover-meta">
            <span>${year}</span>
            ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
            ${inLib ? '<span style="color:var(--accent); font-weight:900; font-size:8px; margin-left:4px">LIB</span>' : ''}
          </div>
        </div>
      `;
      card.onclick = () => openDiscoverDetail(item);
      grid.appendChild(card);
    });
  }

  async function loadDiscover(force = false) {
    if ($('#discover-genre-view')) $('#discover-genre-view').style.display = 'none';
    if ($('#discover-results')) $('#discover-results').style.display = 'none';
    if ($('#discover-content')) $('#discover-content').style.display = 'block';

    if (isDiscoverLoading && !force) return;
    isDiscoverLoading = true;
    $('.discover-main').scrollTop = 0;

    const rows = ['#trending-row', '#popular-movies-row', '#top-rated-row', '#anime-row', '#upcoming-row'];
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
        if (selector === '#trending-row' && items.length > 0) renderDiscoverHero(items[0]);
      } catch (err) {
        console.error(`Failed to load ${selector}:`, err);
      }
    };

    try {
      await Promise.all([
        fetchAndRender('#trending-row', window.api.tmdbTrending()),
        fetchAndRender('#popular-movies-row', window.api.tmdbPopular('movie')),
        fetchAndRender('#top-rated-row', window.api.tmdbTopRated('movie')),
        fetchAndRender('#anime-row', window.api.kitsuTrending()),
        fetchAndRender('#upcoming-row', window.api.tmdbUpcoming())
      ]);
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

    if (!items || items.length === 0) {
      row.innerHTML = '<div style="grid-column:1/-1; padding:30px; text-align:center; color:var(--text-muted); font-size:0.85rem">No content available at the moment.</div>';
      return;
    }

    const localTitles = new Set([
      ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
      ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
    ]);

    items.slice(0, 20).forEach(item => {
      const card = document.createElement('div');
      card.className = 'discover-card';

      const title = item.title || item.name || 'Unknown';
      let posterUrl = '';
      if (item.poster_path) {
        posterUrl = item.poster_path.startsWith('http') ? item.poster_path : `${TMDB_IMG}/w342${item.poster_path}`;
      }

      const rating = item.vote_average || item.score || 0;
      const year = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
      const isAnime = item.source === 'anilist' || item.source === 'mal' || item.format;
      const badgeText = isAnime ? 'ANIME' : (item.media_type === 'tv' ? 'SERIES' : 'MOVIE');
      const inLib = localTitles.has(title.toLowerCase());

      card.innerHTML = `
        <div class="discover-poster-wrap">
          ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-surface-2)"><i class="fas fa-image fa-2x"></i></div>`}
          <div class="discover-card-badge">${badgeText}</div>
        </div>
        <div class="discover-info">
          <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="discover-meta">
            <span>${year}</span>
            ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
            ${inLib ? '<span style="color:var(--accent); font-weight:900; font-size:8px; margin-left:4px">LIB</span>' : ''}
          </div>
        </div>
      `;
      card.onclick = () => openDiscoverDetail(item);
      row.appendChild(card);
    });
  }

  function renderDiscoverHero(item) {
    const hero = $('#discover-hero');
    if (!hero || !item) return;

    const title = item.title || item.name || 'Unknown';
    const backdrop = item.backdrop_path ? `${TMDB_IMG}/original${item.backdrop_path}` : '';
    const year = (item.release_date || item.first_air_date || '').toString().slice(0, 4);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    const type = item.media_type === 'tv' ? 'TV SERIES' : 'MOVIE';

    hero.innerHTML = `
      <div class="hero-backdrop" style="background-image: url('${backdrop}')"></div>
      <div class="hero-overlay">
        <div class="hero-content">
          <div class="hero-badge">Featured ${type}</div>
          <h1 class="hero-title">${escapeHTML(title)}</h1>
          <div class="hero-meta">
            <span>★ ${rating}</span>
            <span>${year}</span>
            <span>HD 4K</span>
          </div>
          <div style="margin-top: 15px; font-size: 11px; font-weight: 700; opacity: 0.8; letter-spacing: 1px; text-transform: uppercase;">
             <i class="fas fa-info-circle"></i> Click for Details
          </div>
        </div>
      </div>
    `;

    hero.onclick = () => openDiscoverDetail(item);
  }

  async function performDiscoverSearch() {
    const q = $('#search-discover')?.value.trim();
    if (!q) { $('#discover-results').style.display = 'none'; $('#discover-content').style.display = 'flex'; return; }
    $('#discover-content').style.display = 'none'; $('#discover-results').style.display = 'block';
    const grid = $('#discover-search-grid'); grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Searching content...</div>';
    try {
      const qClean = q.trim();
      const [tmdbResult, kitsuResult] = await Promise.allSettled([
        (async () => {
          const isNumeric = /^\d+$/.test(qClean) && qClean.length < 8;
          if (isNumeric) {
            const movieDetails = await window.api.invoke('tmdb-details', 'movie', qClean);
            if (movieDetails && !movieDetails.error) { movieDetails.media_type = 'movie'; return { results: [movieDetails] }; }
            const tvDetails = await window.api.invoke('tmdb-details', 'tv', qClean);
            if (tvDetails && !tvDetails.error) { tvDetails.media_type = 'tv'; return { results: [tvDetails] }; }
          }
          return await window.api.invoke('tmdb-search-discover', qClean);
        })(),
        (async () => {
          return await window.api.invoke('kitsu-search', qClean);
        })()
      ]);

      console.log('[Search] TMDB fulfilled:', tmdbResult.status === 'fulfilled', 'Value:', tmdbResult.value);
      console.log('[Search] Kitsu fulfilled:', kitsuResult.status === 'fulfilled', 'Value:', kitsuResult.value);

      const allResults = [
        ...(tmdbResult.status === 'fulfilled' ? (tmdbResult.value?.results || []) : []),
        ...(kitsuResult.status === 'fulfilled' ? (kitsuResult.value?.results || []) : [])
      ].filter(item => item.adult !== true);

      grid.innerHTML = '';
      if (!allResults.length) {
        let tmdbErr = tmdbResult.status === 'fulfilled' && tmdbResult.value?.error;
        let kitsuErr = kitsuResult.status === 'fulfilled' && kitsuResult.value?.error;

        let msg = 'No results found';
        if (tmdbErr === 'TMDB API key required') {
          msg = '<i class="fas fa-key" style="display:block;font-size:30px;margin-bottom:15px;opacity:0.5"></i>TMDB API Key required to search.<br><span style="font-size:12px;opacity:0.7;cursor:pointer;text-decoration:underline" onclick="switchView(\'settings\')">Go to Settings</span>';
        } else if (tmdbErr || kitsuErr) {
          msg = tmdbErr || kitsuErr;
        }

        grid.innerHTML = `<div style="padding:60px 40px;text-align:center;color:var(--text-muted);line-height:1.6">${msg}</div>`;
        return;
      }
      const localTitles = new Set([
        ...(appData.movies || []).map(m => (m.title || '').toLowerCase()),
        ...(appData.shows || []).map(s => (s.title || '').toLowerCase())
      ]);
      allResults.slice(0, 40).forEach(item => {
        const card = document.createElement('div');
        card.className = 'discover-card';
        const title = item.title || item.name || 'Unknown';
        const isKitsu = item.source === 'kitsu' || item.source === 'anilist' || item.format;
        let posterUrl = '';
        if (item.poster_path) {
          posterUrl = item.poster_path.startsWith('http') ? item.poster_path : `${TMDB_IMG}/w342${item.poster_path}`;
        }
        const inLib = localTitles.has(title.toLowerCase());
        let label = (item.media_type === 'movie') ? 'MOVIE' : 'SERIES';
        if (isKitsu) {
          const format = (item.format || '').toUpperCase();
          if (format === 'MOVIE') label = 'ANIME MOV';
          else if (['TV', 'ONA', 'OVA', 'SPECIAL'].includes(format)) label = 'ANIME SER';
          else label = 'ANIME';
        }
        const yearStr = (item.release_date || item.first_air_date || item.seasonYear || '').toString().slice(0, 4);
        const rating = item.vote_average || item.score || 0;
        card.innerHTML = `
          <div class="discover-poster-wrap">
            ${posterUrl ? `<img src="${posterUrl}" class="discover-poster" loading="lazy">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-surface-2)"><i class="fas fa-image fa-2x"></i></div>`}
            <div class="discover-card-badge">${label}</div>
          </div>
          <div class="discover-info">
            <div class="discover-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
            <div class="discover-meta">
              <span>${yearStr}</span>
              ${rating ? `<span class="discover-rating-stars"><i class="fas fa-star" style="font-size:8px"></i> ${rating.toFixed(1)}</span>` : ''}
              ${inLib ? '<span style="color:var(--accent); font-weight:900; font-size:8px; margin-left:4px">LIB</span>' : ''}
            </div>
          </div>
        `;
        card.onclick = () => openDiscoverDetail(item);
        grid.appendChild(card);
      });
    } catch (err) {
      console.error('[Search]', err);
      grid.innerHTML = '<div style="padding:40px;text-align:center;color:#EF4444">Error searching content</div>';
    }
  }


  async function openDiscoverDetail(item) {
    currentDiscoverItem = item;

    const isKitsuItem = item.source === 'kitsu';
    const type = isKitsuItem ? 'anime' : (item.media_type || (item.title ? 'movie' : 'tv'));

    const detailView = $('#view-discover-detail');
    if (type === 'movie') detailView.classList.add('layout-full');
    else detailView.classList.remove('layout-full');

    // Cache for Sleep Mode info bridging
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

    const bd = $('#dd-backdrop');
    const poster = $('#dd-poster');

    // Set initial backdrop/poster from what we already have
    if (item.backdrop_path) {
      bd.style.backgroundImage = item.backdrop_path.startsWith('http')
        ? `url(${item.backdrop_path})`
        : `url(${TMDB_IMG}/original${item.backdrop_path})`;
    } else if (item.poster_path && item.poster_path.startsWith('http')) {
      bd.style.backgroundImage = `url(${item.poster_path})`;
    } else {
      bd.style.backgroundImage = 'none';
      bd.style.background = 'var(--bg-surface)';
    }

    if (item.poster_path) {
      poster.src = item.poster_path.startsWith('http') ? item.poster_path : `${TMDB_IMG}/w500${item.poster_path}`;
      poster.style.display = 'block';
    } else {
      poster.style.display = 'none';
    }

    $('#dd-title').textContent = item.title || item.name || 'Unknown';
    $('#dd-overview').textContent = item.overview || item.synopsis || 'No description available.';

    const meta = $('#dd-meta');
    const sourceLabel = isKitsuItem ? 'Kitsu' : 'TMDB';

    if (isKitsuItem) {
      const rating = item.vote_average || 0;
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
    wlBtn.innerHTML = 'Watchlist';
    actions.appendChild(wlBtn);
    updateWatchlistButton(item.id);
    wlBtn.onclick = () => toggleWatchlist(item);

    // Reset sections
    $('#dd-cast').innerHTML = '<h3>Cast</h3><div class="dd-cast-row">Loading cast...</div>';
    $('#dd-seasons').innerHTML = '';
    $('#dd-streams-list').innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted)">Searching for best links...</div>`;

    switchView('discover-detail');

    // ─── Kitsu Detail Flow ───
    if (isKitsuItem) {
      if (item.trailer && item.trailer.site === 'youtube') {
        const btn = document.createElement('button'); btn.className = 'btn-outline';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Watch Trailer';
        btn.onclick = () => window.api.openExternal(`https://www.youtube.com/watch?v=${item.trailer.id}`);
        actions.appendChild(btn);
      }

      $('#dd-cast .dd-cast-row').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading characters...</div>';
      window.api.invoke('kitsu-cast', item.id).then(cast => {
        const castRow = $('#dd-cast .dd-cast-row');
        castRow.innerHTML = '';
        if (!cast || cast.length === 0) {
          castRow.innerHTML = '<div style="padding:20px;color:var(--text-muted)">No character data available.</div>';
          return;
        }
        cast.slice(0, 12).forEach(c => {
          const card = document.createElement('div'); card.className = 'dd-cast-card';
          const img = c.profile_path ? c.profile_path : 'imgs/no-poster.png';
          card.innerHTML = `<img src="${img}" class="dd-cast-img"><div class="dd-cast-info"><span class="dd-cast-name">${escapeHTML(c.name)}</span><span class="dd-cast-char">${escapeHTML(c.character)}</span></div>`;
          castRow.appendChild(card);
        });
      }).catch(e => {
        $('#dd-cast .dd-cast-row').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load cast.</div>';
      });

      const searchTitle = item.title_english || item.title_romaji || item.title || item.name;

      const isMovie = (item.format || '').toUpperCase() === 'MOVIE';

      if (!isMovie && item.episodes >= 1) {
        const wrap = $('#dd-seasons');
        wrap.innerHTML = '<h3 style="margin-bottom:12px">Episodes</h3><div class="episode-list"></div>';
        const epList = wrap.querySelector('.episode-list');

        for (let i = 1; i <= item.episodes; i++) {
          const el = document.createElement('div'); el.className = 'episode-item';
          const thumb = item.poster_path ? item.poster_path : 'imgs/no-poster.png';
          el.innerHTML = `<div class="ep-thumb-wrap"><img src="${thumb}" class="ep-thumb" style="opacity:0.3; object-fit:cover;"><div class="ep-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div></div><div class="episode-info"><div class="episode-title">Episode ${i}</div><div class="episode-desc"></div></div>`;

          el.onclick = () => {
            document.querySelectorAll('.episode-item').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            // Crucial: we pass 'anime' flag and Kitsu ID as imdb_id 
            loadStreams({ ...item, title: searchTitle, name: searchTitle, season: 1, episode: i, media_type: 'anime', imdb_id: item.id }, 'anime');
          };
          epList.appendChild(el);
        }

        if (epList.firstChild) epList.firstChild.click();
      } else {
        loadStreams({ ...item, title: searchTitle, name: searchTitle, media_type: 'anime', imdb_id: item.id, episode: 1, season: 1 }, 'anime');
      }

      return;
    }

    // ─── TMDB Detail Flow (existing) ───
    try {
      const detail = await window.api.tmdbDetails(type, item.id);
      $('#dd-cast').style.display = 'block';
      // Trailer button
      const trailer = (detail.videos?.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        const btn = document.createElement('button'); btn.className = 'btn-outline';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Watch Trailer';
        btn.onclick = () => window.api.openExternal(`https://www.youtube.com/watch?v=${trailer.key}`);
        actions.appendChild(btn);
      }

      // Cast section
      const castRow = $('#dd-cast .dd-cast-row'); castRow.innerHTML = '';
      (detail.credits?.cast || []).slice(0, 12).forEach(c => {
        const card = document.createElement('div'); card.className = 'dd-cast-card';
        const img = c.profile_path ? `${TMDB_IMG}/w185${c.profile_path}` : 'imgs/no-poster.png';
        card.innerHTML = `<img src="${img}" class="dd-cast-img"><div class="dd-cast-info"><span class="dd-cast-name">${escapeHTML(c.name)}</span><span class="dd-cast-char">${escapeHTML(c.character)}</span></div>`;
        castRow.appendChild(card);
      });

      // TV Seasons handling
      if (type === 'tv' && detail.seasons) {
        const wrap = $('#dd-seasons');
        wrap.innerHTML = '<h3 style="margin-bottom:12px">Seasons</h3><div class="season-tabs" style="margin-bottom:15px"></div><div class="episode-list"></div>';
        const tabs = wrap.querySelector('.season-tabs');
        const epList = wrap.querySelector('.episode-list');

        detail.seasons.filter(s => s.season_number > 0).sort((a, b) => a.season_number - b.season_number).forEach((s, idx) => {
          const btn = document.createElement('button');
          btn.className = `season-tab ${idx === 0 ? 'active' : ''}`;
          btn.textContent = `Season ${s.season_number}`;
          btn.onclick = () => {
            tabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            loadDiscoverEpisodes(item.id, s.season_number, epList, item);
          };
          tabs.appendChild(btn);
        });
        if (detail.seasons.length > 0) loadDiscoverEpisodes(item.id, detail.seasons[0].season_number, epList, item);
      } else if (type === 'movie') {
        loadStreams(item, 'movie');
      }
    } catch (e) { console.error(e); }
  }

  async function loadDiscoverEpisodes(tvId, seasonNum, container, meta) {
    container.innerHTML = '<div style="padding:20px; color:var(--text-muted)">Loading episodes...</div>';
    try {
      const season = await window.api.tmdbSeasonDetails(tvId, seasonNum);
      container.innerHTML = '';
      const showName = meta.title || meta.name || 'Series';
      season.episodes.forEach(ep => {
        const el = document.createElement('div'); el.className = 'episode-item';
        const thumb = ep.still_path ? `${TMDB_IMG}/w300${ep.still_path}` : 'imgs/no-poster.png';
        el.innerHTML = `<div class="ep-thumb-wrap"><img src="${thumb}" class="ep-thumb"><div class="ep-number-overlay">${ep.episode_number}</div><div class="ep-play-overlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div></div><div class="episode-info"><div class="episode-title">${escapeHTML(ep.name)}</div><div class="episode-desc">${escapeHTML(ep.overview || 'No description.')}</div></div>`;
        el.onclick = () => {
          document.querySelectorAll('.episode-item').forEach(i => i.classList.remove('active'));
          el.classList.add('active');
          loadStreams({ ...meta, showName, season: seasonNum, episode: ep.episode_number, epTitle: ep.name, media_type: 'tv' }, 'tv');
        };
        container.appendChild(el);
      });
    } catch { container.innerHTML = 'Failed to load episodes.'; }
  }

  async function loadStreams(item, type) {
    const container = $('#dd-streams-list');
    container.innerHTML = '<div style="padding:20px; color:var(--text-muted); text-align:center; background:var(--bg-surface-2); border-radius:12px; grid-column: 1/-1">Searching for best links...</div>';

    try {
      if (!item.imdb_id || item.imdb_id === 'null') {
        let tmdbIdToUse = item.id;

        // If this is an anime from AniList/MAL/Kitsu, item.id is NOT a TMDB ID. We must resolve it by title search.
        if (item.source === 'anilist' || item.source === 'mal' || item.source === 'kitsu') {
          console.log('[Streams] Anime detected, resolving TMDB ID via title search:', item.title);
          // TMDB search needs 'tv' for most anime series
          const searchType = type === 'anime' ? 'tv' : type;
          const searchRes = await window.api.tmdbSearch(searchType, item.title);
          if (searchRes.results && searchRes.results.length > 0) {
            const yearStr = (item.seasonYear || item.release_date || item.first_air_date || '').toString().slice(0, 4);
            let bestMatch = searchRes.results.find(r => yearStr && (r.release_date || r.first_air_date || '').startsWith(yearStr));
            if (!bestMatch) bestMatch = searchRes.results[0];
            tmdbIdToUse = bestMatch.id;
            // Update TMDB ID to the correct one so addons.js works well
            item.id = bestMatch.id;
            console.log(`[Streams] Resolved Anime to TMDB ID: ${item.id}`);
          }
        }

        const detail = await window.api.tmdbDetails(type, tmdbIdToUse);
        // For Movies, imdb_id is direct. For TV, we need separate External ID call.
        item.imdb_id = detail.imdb_id || null;

        if (!item.imdb_id) {
          const ext = await window.api.invoke('tmdb-external-ids', { id: tmdbIdToUse, type });
          if (ext && ext.imdb_id) item.imdb_id = ext.imdb_id;
        }
        console.log(`[MediaVault] IMDb ID resolved for ${type}: ${item.imdb_id}`);
      }

      let streams;
      try {
        const query = {
          imdbId: item.imdb_id,
          tmdbId: item.id,
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
        const titleLines = (s.title || '').split('\n');
        const mainTitle = titleLines[0];

        let seeds = 0, size = '';
        const statsLine = titleLines.slice(1).join(' ');
        const seedsMatch = statsLine.match(/👤\s*(\d+)/) || statsLine.match(/(\d+)\s*seeds/i);
        const sizeMatch = statsLine.match(/💾\s*([\d\.]+\s*[GM]B)/i) || statsLine.match(/([\d\.]+\s*[GM]B)/i);
        if (seedsMatch) seeds = seedsMatch[1];
        if (sizeMatch) size = sizeMatch[1];

        const seedsIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        const sizeIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M12 18V6"/><path d="M7 11l5 5 5-5"/></svg>`;

        const vlcIcon = `<div class="stream-btn-vlc" title="Play in VLC"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.16,19.51L13,10V14.1L15.39,18H15.17L12,9L8.83,18H8.61L11,14.1V10L4.84,19.51C4.4,20.19,4.89,21,5.69,21H18.31C19.11,21,19.6,20.19,19.16,19.51M12,2A1,1,0,0,0,11,3V5H13V3A1,1,0,0,0,12,2M11,6V8H13V6H11Z"/></svg></div>`;
        const vlcHtml = vlcIcon; // Always show on mobile too for fallback


        card.innerHTML = `<div class="stream-top"><div class="stream-icon-box">${s.type === 'torrent' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v8m0 0l-4-4m4 4l4-4M6 20h12a2 2 0 002-2v-4a2 2 0 00-2-2H6a2 2 0 00-2 2v4a2 2 0 002 2z"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>'}</div><div class="stream-main-info"><div class="stream-title" title="${escapeHTML(mainTitle)}">${escapeHTML(mainTitle)}</div><div class="stream-badges"><span class="quality-badge">${s.quality}</span><span class="source-badge">${s.addon}</span></div></div></div><div class="stream-footer"><div class="stream-stats">${seeds ? `<div class="stream-stat-badge seeds">${seedsIcon}${seeds}</div>` : ''}${size ? `<div class="stream-stat-badge size">${sizeIcon}${size}</div>` : ''}</div><div class="stream-actions-group"><div class="stream-btn-download" title="Add to Downloads"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>${vlcHtml}<div class="stream-btn-play" title="Play Internally"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div></div>`;

        const vlcBtn = card.querySelector('.stream-btn-vlc');
        if (vlcBtn) vlcBtn.onclick = async (e) => {
          e.stopPropagation();
          let vUrl = s.url || s.infoHash;
          const isMobile = !window.api.isElectron;

          // Build magnet URL from hash if needed
          if (vUrl && vUrl.length === 40 && !vUrl.startsWith('http') && !vUrl.startsWith('magnet:')) {
            vUrl = `magnet:?xt=urn:btih:${vUrl}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
          }

          if (isMobile) {
            showToast('Opening in VLC...');
            await window.api.invoke('open-in-vlc', vUrl);
          } else {
            // DESKTOP: Convert torrent to HTTP stream first, then pass to VLC
            if (s.type === 'torrent' || vUrl.startsWith('magnet:')) {
              showToast('Preparing stream for VLC...');
              try {
                const res = await window.api.streamTorrent(vUrl, s.fileIdx);
                if (res && res.url && !res.error) {
                  vUrl = res.url;
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

        card.querySelector('.stream-btn-download').onclick = async (e) => {
          e.stopPropagation();
          let dlUrl = s.url || s.infoHash;
          if (dlUrl && dlUrl.length === 40 && !dlUrl.startsWith('http')) {
            dlUrl = `magnet:?xt=urn:btih:${dlUrl}&tr=udp://tracker.opentrackr.org:1337/announce`;
          }
          const dlName = mainTitle || item?.title || item?.name || 'Unknown';
          const dlPath = appData.downloadPath || appData.libraryFolders?.[0] || '';

          // For mobile: if it's a torrent, convert to HTTP stream first
          if (!window.api.isElectron && (s.type === 'torrent' || dlUrl.startsWith('magnet:'))) {
            showToast('Torrents cannot be downloaded directly on mobile.');
            return;
          }

          showToast('Starting download: ' + dlName);
          try {
            const result = await window.api.startDownload({
              url: dlUrl,
              name: dlName,
              downloadPath: dlPath,
              type: type,
              profileName: currentProfile?.name || 'Default',
              libraryFolders: currentProfile?.libraryFolders || appData.libraryFolders,
              isYoutube: false
            });
            if (result && result.success) {
              showToast(`Download started: ${dlName}`);
              switchView('downloads');
            } else {
              showToast(`Error: ${result?.error || 'Unknown error'}`);
            }
          } catch (err) { showToast('Download error: ' + err.message); }
        };
        container.appendChild(card);
      });
    } catch (err) { container.innerHTML = 'Error searching streams.'; }
  }

  async function playStream(stream, meta, btnEl = null) {
    if (stream.type === 'browser') {
      window.api.openExternal(stream.url);
      return;
    }

    const btn = btnEl || document.querySelector(`.stream-btn-play[onclick*="${stream.url || stream.infoHash}"]`);
    if (btn) btn.classList.add('btn-loading');

    const isMobile = !!(window.Capacitor);

    // ─── MOBILE: Direct External Player Handoff ───
    // On mobile, we NEVER use the internal player. Every stream goes
    // straight to an external app (VLC, MX Player, Stremio, etc.)
    if (isMobile) {
      let handoffUrl = stream.url || stream.infoHash || '';

      // Expand bare info-hash to full magnet URI
      if (handoffUrl && handoffUrl.length === 40 && !handoffUrl.startsWith('http') && !handoffUrl.startsWith('magnet:')) {
        handoffUrl = `magnet:?xt=urn:btih:${handoffUrl}&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://open.stealth.si:80/announce`;
      }

      if (!handoffUrl) {
        if (btn) btn.classList.remove('btn-loading');
        showToast('No playable link found');
        return;
      }

      showToast(`Opening ${stream.addon} in external player...`);
      console.log('[playStream] Mobile external handoff:', handoffUrl);

      const result = await (window.PlayMediaService
        ? window.PlayMediaService.play(handoffUrl, { title: meta?.title || stream.name })
        : window.api.playExternal
          ? window.api.playExternal(handoffUrl, { title: meta?.title || stream.name })
          : window.api.invoke('open-in-vlc', handoffUrl)
      );

      if (btn) btn.classList.remove('btn-loading');

      if (!result || !result.success) {
        showToast('Failed to open external player: ' + (result?.error || 'Unknown error'));
      }
      return;
    }

    // ─── DESKTOP: Internal Player Pipeline ───
    showToast(`Initializing ${stream.addon} stream...`);
    try {
      let finalUrl = stream.url?.startsWith('http') ? stream.url : null;

      if (stream.type === 'torrent') {
        // Desktop Standalone (Local Torrent Stream via Electron)
        if (!finalUrl) {
          const res = await window.api.invoke('start-torrent-stream', stream.url);
          if (!res.success) throw new Error(res.error || 'Failed to start torrent stream');
          finalUrl = (window.api.isElectron) ? (res.localUrl || res.url) : res.url;
        }
      }

      if (btn) btn.classList.remove('btn-loading');
      if (!finalUrl) { showToast('No playable stream found'); return; }

      playVideo({
        id: meta?.id || stream.infoHash || stream.url,
        title: meta?.epTitle || meta?.title || meta?.name || stream.name,
        path: finalUrl,
        tmdbId: meta?.id,
        showName: meta?.showName,
        type: meta ? (meta.media_type || (meta.title ? 'movie' : 'tv')) : 'movie',
        season: meta?.season,
        episode: meta?.episode,
        isStream: true
      }, meta?.showName ? { title: meta.showName } : null);
    } catch (err) {
      if (btn) btn.classList.remove('btn-loading');
      showToast('Streaming failed: ' + err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TMDB MANUAL SEARCH
  // ══════════════════════════════════════════════════════════════════════════
  let tmdbSearchTarget = null;
  function openTmdbSearchModal(item) {
    tmdbSearchTarget = item;
    const input = $('#tmdb-search-input');
    if (input) input.value = item.cleanTitle || item.title || '';
    const results = $('#tmdb-search-results');
    if (results) results.innerHTML = '';
    $('#tmdb-modal').style.display = 'flex';
    setTimeout(() => { const inp = $('#tmdb-search-input'); if (inp) inp.focus(); }, 50);
    performTmdbSearch();
  }

  async function performTmdbSearch() {
    const q = $('#tmdb-search-input').value.trim(); if (!q) { $('#tmdb-search-results').innerHTML = ''; return; }
    const el = $('#tmdb-search-results'); el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Searching…</div>';
    try {
      const [movies, shows] = await Promise.all([window.api.tmdbSearch('movie', q), window.api.tmdbSearch('tv', q)]);
      const all = [...(movies.results || []).slice(0, 5).map(r => ({ ...r, _type: 'movie' })), ...(shows.results || []).slice(0, 5).map(r => ({ ...r, _type: 'tv' }))];
      if (!all.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No results</div>'; return; }
      el.innerHTML = '';
      all.forEach(r => { const e = document.createElement('div'); e.className = 'tmdb-result-item'; const t = r.title || r.name; const y = (r.release_date || r.first_air_date || '').slice(0, 4); const p = r.poster_path ? `${TMDB_IMG}/w92${r.poster_path}` : ''; e.innerHTML = `${p ? `<img class="tmdb-result-poster" src="${p}">` : `<div class="tmdb-result-poster" style="background:var(--bg-surface-2)"></div>`}<div class="tmdb-result-info"><div class="tmdb-result-title">${escapeHTML(t)}</div><div class="tmdb-result-year">${y}</div><div class="tmdb-result-type">${r._type}</div></div>`; e.onclick = () => linkTmdbResult(r); el.appendChild(e); });
    } catch (err) { el.innerHTML = `<div style="padding:20px;text-align:center;color:#EF4444">Error: ${escapeHTML(err.message)}</div>`; }
  }

  async function linkTmdbResult(result) {
    if (!tmdbSearchTarget) return;
    const cache = appData.tmdbCache = appData.tmdbCache || {};
    cache[tmdbSearchTarget.id] = { tmdbId: result.id, type: result._type, title: result.title || result.name, posterPath: result.poster_path, backdropPath: result.backdrop_path, rating: result.vote_average, overview: result.overview, year: (result.release_date || result.first_air_date || '').slice(0, 4) };
    if (result.poster_path) { const lp = await window.api.downloadImage(result.poster_path, tmdbSearchTarget.id); if (lp) appData.banners[tmdbSearchTarget.id] = lp; }
    persist(); renderLibrary(); $('#tmdb-modal').style.display = 'none'; showToast(`Linked to "${result.title || result.name}"`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DOWNLOADS
  // ══════════════════════════════════════════════════════════════════════════
  function setDlType(type) {
    currentDlType = type;
    // Remove active from all buttons
    ['youtube', 'tiktok', 'instagram', 'direct', 'series'].forEach(t => {
      const btn = $(`#dl-type-${t}`);
      if (btn) btn.classList.remove('active');
    });
    // Add active to selected button
    const activeBtn = $(`#dl-type-${type}`);
    if (activeBtn) activeBtn.classList.add('active');
    // Show/hide series fields only for series type
    const seriesFields = $('#dl-series-fields');
    if (seriesFields) seriesFields.style.display = type === 'series' ? 'flex' : 'none';
    // Hide save location for social media downloads (auto-saves to Social folder)
    const saveLocEl = $('#dl-save-location');
    if (saveLocEl) saveLocEl.style.display = ['youtube', 'tiktok', 'instagram'].includes(type) ? 'none' : 'block';
  }

  async function startDownload() {
    const urlInput = $('#dl-url');
    const nameInput = $('#dl-name');
    const url = urlInput ? urlInput.value.trim() : '';
    let name = nameInput ? nameInput.value.trim() : '';
    if (!url) { showToast('Please enter a URL'); return; }
    if (!name) name = 'Download';
    const season = currentDlType === 'series' ? ($('#dl-season').value || null) : null;
    const episode = currentDlType === 'series' ? ($('#dl-episode').value || null) : null;
    
    // --- Independent Mobile/Web Download Path ---
    if (!window.api || !window.api.isElectron) {
      const isSocial = ['youtube', 'tiktok', 'instagram'].includes(currentDlType) || 
                       url.includes('youtube.com') || url.includes('youtu.be') || 
                       url.includes('tiktok.com') || url.includes('instagram.com');

      if (isSocial) {
        showToast('🚀 Processing download...');
        try {
          // Try multiple cloud APIs for extraction
          let downloadUrl = null;
          
          // Method 1: Try cobalt.tools
          try {
            const response = await fetch('https://api.cobalt.tools/api/json', {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: url, videoQuality: '720', filenameStyle: 'pretty' })
            });
            if (response.ok) {
              const data = await response.json();
              if (data.url) downloadUrl = data.url;
            }
          } catch (e) { console.warn('[DL] Cobalt failed:', e.message); }

          // Method 2: Try alternative API
          if (!downloadUrl) {
            try {
              const resp2 = await fetch(`https://co.wuk.sh/api/json`, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, vQuality: '720' })
              });
              if (resp2.ok) {
                const data2 = await resp2.json();
                if (data2.url) downloadUrl = data2.url;
              }
            } catch (e2) { console.warn('[DL] Alt API failed:', e2.message); }
          }

          if (downloadUrl) {
            if (window.api && window.api.isMobile()) {
              window.api.startDownload({ url: downloadUrl, name: name || 'download' });
              showToast('✅ Download started!');
            } else {
              const a = document.createElement('a');
              a.href = downloadUrl;
              a.download = name || 'download';
              a.target = '_blank';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              showToast('✅ Download started!');
            }
            if (urlInput) urlInput.value = '';
          } else {
            showToast('Opening in browser to save manually...');
            window.open(url, '_blank');
          }
        } catch (err) {
          console.error('[MOBILE-DL] All extraction methods failed:', err);
          showToast('Opening in browser...');
          window.open(url, '_blank');
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

    // --- Standard Electron Download Path ---
    const isSocialDl = ['youtube', 'tiktok', 'instagram'].includes(currentDlType);
    const libraryRoot = appData.libraryFolders?.[0] || `C:\\Users\\motawa\\Videos\\MediaVault`;
    const socialFolder = `${libraryRoot}\\${currentProfile?.name || 'Default'}\\Social`;
    const dlPath = isSocialDl ? socialFolder : (appData.downloadPath || appData.libraryFolders?.[0] || '');

    const isMusicMode = $('#dl-music-mode') ? $('#dl-music-mode').checked : false;

    try {
      const result = await window.api.startDownload({
        url, name, season, episode,
        downloadPath: dlPath,
        type: isMusicMode ? 'music' : currentDlType,
        isMusicMode: isMusicMode,
        profileName: currentProfile?.name || 'Default',
        libraryFolders: currentProfile?.libraryFolders || appData.libraryFolders
      });
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
      item.innerHTML = `<div class="dl-item-main"><div class="dl-item-info"><div class="dl-name" title="${escapeHTML(dl.name)}">${escapeHTML(dl.name)}</div><div class="dl-item-meta"><span class="dl-item-status">${dl.statusText || (dl.downloaded || '0 B') + ' / ' + (dl.total || '?')}</span><span class="dl-speed" style="color:var(--accent);margin-left:8px;font-weight:700">${dl.speed || ''}</span>${dl.peers !== undefined ? `<span class="dl-peers" style="color:var(--text-muted);margin-left:8px;font-size:11px;">${dl.peers} peers</span>` : ''}</div></div><div class="dl-percent">${(dl.percent || 0).toFixed(1)}%</div><button class="dl-cancel-btn" title="Cancel Download"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="dl-progress-container"><div class="dl-progress-fill" style="width:${dl.percent || 0}%"></div></div>`;

      item.querySelector('.dl-cancel-btn').onclick = () => {
        window.api.cancelDownload(id);
        activeDownloads.delete(id);
        renderActiveDownloads();
        showToast('Cancelled');
      };
      el.appendChild(item);

      if (hubEl) {
        const hItem = item.cloneNode(true);
        hItem.querySelector('.dl-cancel-btn').onclick = () => item.querySelector('.dl-cancel-btn').click();
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
  }

  function updateDownloadBadge() { const b = $('#badge-downloads'); const c = activeDownloads.size; if (b) { b.textContent = c; b.classList.toggle('visible', c > 0); } }

  // ── Vault Logic ──
  function toggleLock(item) {
    if (!currentProfile) return;
    if (!currentProfile.vaultPin) { openVault(); return; } // Force set PIN if not exists
    const index = (currentProfile.lockedItems || []).indexOf(item.id);
    if (index === -1) {
      currentProfile.lockedItems = currentProfile.lockedItems || [];
      currentProfile.lockedItems.push(item.id);
      showToast('Item Locked in Vault');
    } else {
      currentProfile.lockedItems.splice(index, 1);
      showToast('Item Unlocked');
    }
    persist();
    renderAll();
  }

  function openVault() {
    if (!currentProfile) return;
    const isSet = !!currentProfile.vaultPin;
    if (isVaultUnlocked && isSet) { lockVault(); return; }

    $('#vault-modal-title').textContent = isSet ? 'Unlock Vault' : 'Set Vault PIN';
    $('#vault-modal-desc').textContent = isSet ? 'Enter your 4-digit PIN to access locked content.' : 'Set a new 4-digit PIN to secure your private items.';
    $('#vault-confirm').textContent = isSet ? 'Unlock' : 'Set PIN';
    $('#vault-modal').style.display = 'flex';
    resetPinInputs();
    setTimeout(() => $$('.pin-digit')[0].focus(), 100);
  }

  function handleVaultAuth() {
    if (!currentProfile) return;
    const pin = $$('.pin-digit').map(i => i.value).join('');
    if (pin.length < 4) { showToast('Please enter 4 digits'); return; }

    if (!currentProfile.vaultPin) {
      currentProfile.vaultPin = pin;
      showToast('Vault PIN Set!');
      persist();
      $('#vault-modal').style.display = 'none';
      return;
    }

    if (pin === currentProfile.vaultPin) {
      isVaultUnlocked = true;
      $('#vault-modal').style.display = 'none';
      updateVaultUI();
      renderAll();
      showToast('Vault Unlocked');
    } else {
      showToast('Incorrect PIN');
      resetPinInputs();
    }
  }

  function lockVault() {
    isVaultUnlocked = false;
    updateVaultUI();
    renderAll();
    showToast('Vault Locked');
  }

  function updateVaultUI() {
    $('#vault-icon-locked').style.display = isVaultUnlocked ? 'none' : 'block';
    $('#vault-icon-unlocked').style.display = isVaultUnlocked ? 'block' : 'none';
    $('#vault-label').textContent = isVaultUnlocked ? 'Lock Vault' : 'Private Vault';
  }

  function resetPinInputs() {
    $$('.pin-digit').forEach(i => i.value = '');
  }

  function renderAll() {
    renderLibrary(); renderSidebar(); renderWatchlist(); renderSocial(); renderMusic();
    showToast('Library ready');
  }

  // ── FINAL BOOT ──
  (async () => {
    console.log('[INIT] Starting MediaVault Boot Sequence...');
    try {
      // 1. Android Permission Request (Critical for Android 11+)
      if (window.api && window.api.isMobile && window.api.isMobile()) {
         console.log('[INIT] Requesting Mobile Permissions...');
         await window.api.invoke('request-filesystem-permissions');
      }

      const saved = await window.api.loadData();
      appData = deepMerge(appData, saved);
      
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

      if (appData.theme === 'dark') document.body.classList.add('dark-theme');
      updateSignature();

      // Zoom Correction
      if (appData.zoomFactor !== undefined) {
        if (typeof appData.zoomFactor !== 'number' || appData.zoomFactor < 0.5 || appData.zoomFactor > 2.0) appData.zoomFactor = 1.0;
        if (window.api.setZoom) window.api.setZoom(appData.zoomFactor);
      }

      migrateToProfiles();

      if (!appData.profiles || appData.profiles.length === 0) {
        console.log('[INIT] No profiles found, showing intro');
        $('#intro-screen').style.display = 'flex';
      } else {
        currentProfileId = appData.activeProfileId || (appData.profiles[0] ? appData.profiles[0].id : null);
        currentProfile = appData.profiles.find(p => p.id === currentProfileId);

        if (currentProfile) {
          console.log('[INIT] Loading profile:', currentProfile.name, 'ActiveID:', currentProfileId);
          // Android: Ensure folders exist using the new safe logic
          await window.api.invoke('ensure-profile-folders', currentProfile.id);
          await scanLibrary();

          // UI Initialization
          if (appData.libraryPath && !appData.libraryFolders.includes(appData.libraryPath)) appData.libraryFolders.push(appData.libraryPath);
          const fp = $('#folder-path'); if (fp) fp.value = appData.libraryFolders[appData.libraryFolders.length - 1] || '';
          const rb = $('#btn-rescan'); if (rb) rb.disabled = appData.libraryFolders.length === 0 && !appData.youtubeFolder;

          const yp = $('#yt-folder-path'); if (yp && appData.youtubeFolder) yp.value = appData.youtubeFolder;

          renderLibrary(); renderSidebar(); renderDownloadHistory(); renderSocial();

          // Motivational Startup Toast
          setTimeout(() => {
            showToast('الترفيه متعة.. فلا تجعلها وسيلة لجمع ما يؤذي روحك. كن رقيباً على نفسك', 6000);
          }, 1500);
          renderMusic();
          renderProfileWidget();
          initSidebarGroups();
          switchView('discover');
          autoMatchTmdb();
          checkAndUnlockApp(); // Auto-unlock if key exists
        } else {
          console.log('[INIT] Profile mismatch, showing picker');
          renderProfilePicker(); // Corrected function name
        }
      }



      const mainProfileBtn = $('#btn-switch-profile-main');
      if (mainProfileBtn) {
        mainProfileBtn.onclick = () => renderProfilePicker();
      }

      $$('.btn-switch-profile-main-dynamic').forEach(btn => {
        btn.onclick = () => renderProfilePicker();
      });




    } catch (err) {
      console.error('[INIT] FATAL BOOT ERROR:', err);
    }
    document.body.classList.add('app-loaded');
  })();

  function updateSleepClock() {
    // Clock removed as requested
  }




  // ══════════════════════════════════════════════════════════════════════════
  //  FUNCTIONS
  // ══════════════════════════════════════════════════════════════════════════

  function switchView(name) {
    window.switchView = switchView; // Ensure it stays exposed if needed, or just set it once at start
    if (currentView === 'player' && name !== 'player') {
      if (engine) engine.stop();
      // Cleanup standalone torrents on mobile
      if (window.browserWT) {
         window.browserWT.torrents.forEach(t => t.destroy());
      }
    }

    if (name === 'player' || name === 'music-player') {
      prevView = currentView;
      playerSourceView = currentView;
    }
    if (name === 'discover') discoverStack = []; // Reset sub-navigation when going to main list
    if (['library', 'movies', 'shows', 'social', 'music', 'watchlist', 'settings', 'discover', 'downloads', 'discover-detail', 'show-detail', 'subtitles', 'radio'].includes(name)) {
      currentView = name;
      if (!name.includes('detail')) appData.lastView = name;
      persist();
    }
    if (name !== 'show-detail') currentShowId = null;
    $$('.nav-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $$('.myspace-cat-pill').forEach(b => {
      const target = b.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
      b.classList.toggle('active', target === name);
    });
    Object.entries(views).forEach(([k, el]) => { if (el) el.classList.toggle('active', k === name); });

    const isRadioPlaying = engine && engine._isRadio && !engine.paused;
    const isEngineActive = (currentItem && (engine.isUsingMpv || !video.paused || video.currentTime > 0 || isPlayingMusic)) || isRadioPlaying;

    // Strictly hide mini-player if we are in the main player view
    if (name !== 'player' && isEngineActive) {
      let title = '', meta = '';

      if (isRadioPlaying) {
        title = window.currentRadioTitle || 'Radio';
        meta = 'Live Stream';
      } else if (currentShow) {
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
      $('#mini-player').style.display = 'flex';
      document.body.classList.add('mini-player-active');
    } else {
      $('#mini-player').style.display = 'none';
      document.body.classList.remove('mini-player-active');
    }

    // Toggle Contextual Docks on Mobile
    if (window.Capacitor || window.innerWidth < 768) {
       const mainDock = $('#mobile-dock');
       const spaceDock = $('#myspace-dock');
       if (mainDock && spaceDock) {
           if (name === 'library') {
               mainDock.style.display = 'none';
               spaceDock.style.display = 'flex';
           } else {
               mainDock.style.display = 'flex';
               spaceDock.style.display = 'none';
           }
       }
    }


    // Initial visualizer init if music is active and we just switched to player
    if (name === 'player' && isPlayingMusic && typeof initVisualizer === 'function') {
      initVisualizer();
    }

    window.setLibraryTab = function(tab) {
       switchView(tab);
    };

    if (name === 'discover') {
      const trending = $('#trending-row');
      const isBlank = !trending || trending.children.length === 0;
      if (isBlank) loadDiscover(true);
    }
    if (name === 'watchlist') renderWatchlist();
    if (name === 'settings') renderSettings();
    if (name === 'social') renderSocial();
    if (name === 'music') renderMusic();
    if (name === 'subtitles') renderSubtitles();
    if (name === 'library') renderLibrary();
    if (name === 'downloads') {
      renderActiveDownloads();
      renderDownloadHistory();
    }
    if (name === 'radio') renderRadio();

    // --- Mobile Contextual Dock & Title Logic ---
    if (!window.api || !window.api.isElectron) {
      const msTitle = $('#myspace-profile-name');
      const mobHeader = $('#mobile-nav-header');
      const mobTitle = $('#mobile-nav-title');
      const mobileDock = $('#mobile-dock');

      // Define which views are MySpace sub-views (contextual dock territory)
      const myspaceViews = ['library', 'movies', 'shows', 'social', 'music', 'watchlist', 'subtitles'];
      const isMySpaceView = myspaceViews.includes(name);

      const libraryViews = ['library', 'movies', 'shows', 'social', 'music', 'watchlist', 'subtitles'];
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
            { view: 'movies',    icon: 'fa-film',              label: 'Movies' },
            { view: 'shows',     icon: 'fa-tv',                label: 'Series' },
            { view: 'social',    icon: 'fa-share-nodes',       label: 'Social' },
            { view: 'music',     icon: 'fa-music',             label: 'Music'  },
            { view: 'watchlist', icon: 'fa-bookmark',          label: 'Saved'  },
            { view: 'subtitles', icon: 'fa-closed-captioning', label: 'Subs'   },
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
  if (!!window.Capacitor) {
    document.body.classList.add('dark-theme');
    // Ensure all views are clean indigo-dark
    document.documentElement.style.setProperty('--bg', '#0d0d12');

    // Automatically trigger folder creation for first run or profile change
    if (appData.firstRun) {
      window.api.invoke('ensure-profile-folders', 'Default');
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
      back.style = 'background: rgba(255,255,255,0.06); border: 1px dashed rgba(255,255,255,0.2); border-radius: 18px; padding: 8px 14px; display: flex; align-items: center; gap: 20px; cursor: pointer;';
      back.innerHTML = `<div style="font-size: 22px; width: 48px; height: 48px; color: #fff; display: flex; align-items: center; justify-content: center;"><i class="fas fa-arrow-left"></i></div><div style="font-weight: 700;">Back to Parent</div>`;
      back.onclick = () => {
        const parts = subCurrentDir.split(/[\\/]/);
        parts.pop();
        subCurrentDir = parts.join('/');
        renderSubtitles();
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
      item.style = `
        background: rgba(255, 255, 255, 0.04);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        background-clip: padding-box; /* Fix border clipping/chopping */
        border-radius: 18px;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 20px;
        position: relative;
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.2s, border 0.2s, box-shadow 0.2s;
        cursor: pointer;
      `;

      const isDir = sub.isDir;
      const isAss = !isDir && sub.name.toLowerCase().endsWith('.ass');
      const iconColor = isDir ? '#f59e0b' : (isAss ? '#a855f7' : '#3b82f6');
      const iconClass = isDir ? 'fa-folder' : (isAss ? 'fa-wand-magic-sparkles' : 'fa-closed-captioning');

      item.innerHTML = `
        <div style="pointer-events: none; font-size: 22px; width: 48px; height: 48px; background: ${iconColor}15; color: ${iconColor}; border-radius: 14px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 10px ${iconColor}20;">
          <i class="fas ${iconClass}" style="pointer-events: none;"></i>
        </div>
        <div style="pointer-events: none; flex: 1; overflow: hidden;">
          <div class="sub-name-label" style="pointer-events: none; font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; margin-bottom: 2px;">${sub.name}</div>
          <div style="pointer-events: none; font-size: 11px; color: var(--text-muted); opacity: 0.7;">${isDir ? 'Folder' : (isAss ? 'Advanced Substation Alpha' : 'SubRip Subtitle')} ${!isDir ? `• ${(sub.size / 1024).toFixed(1)} KB` : ''}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="sub-action-btn sub-rename-btn" title="Rename" style="background: rgba(255,255,255,0.05); border: none; color: #fff; opacity: 0.5; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; transition: all 0.2s;"><i class="fas fa-edit"></i></button>
          <button class="sub-action-btn sub-delete-btn" title="Delete" style="background: rgba(255,255,255,0.05); border: none; color: #ff5555; opacity: 0.5; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; transition: all 0.2s;"><i class="fas fa-trash"></i></button>
        </div>
      `;

      // DRAG AND DROP LOGIC
      if (!isDir) {
        item.draggable = true;
        item.ondragstart = (e) => {
          e.dataTransfer.effectAllowed = 'move';
          const dragData = { fileName: sub.name, fromDir: subCurrentDir || '' };
          window.activeDragData = dragData;
          e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
          item.style.opacity = '0.5';
          item.style.transform = 'scale(0.92)';
          item.classList.add('dragging-source');
        };
        item.ondragend = () => {
          item.style.opacity = '1';
          item.style.transform = 'scale(1)';
          item.classList.remove('dragging-source');
          window.activeDragData = null;
        };
      } else {
        item.ondragover = (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          item.style.background = 'rgba(79, 70, 229, 0.15)';
          item.style.borderColor = 'var(--accent)';
          item.style.transform = 'scale(1.04)';
          item.style.boxShadow = '0 0 20px rgba(79, 70, 229, 0.4)';
        };
        item.ondragleave = () => {
          item.style.background = 'rgba(255, 255, 255, 0.04)';
          item.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          item.style.transform = 'scale(1)';
          item.style.boxShadow = 'none';
        };
        item.ondrop = async (e) => {
          e.preventDefault();
          item.style.transform = 'scale(1)';
          item.style.boxShadow = 'none';
          item.style.background = 'rgba(255, 255, 255, 0.04)';

          try {
            // Try dataTransfer first, fallback to global tracker
            let dragData = window.activeDragData;
            const rawData = e.dataTransfer.getData('text/plain');
            if (rawData) { try { dragData = JSON.parse(rawData); } catch (ev) { } }

            if (!dragData || !dragData.fileName) return;

            const { fileName, fromDir } = dragData;
            const toDir = subCurrentDir ? subCurrentDir + '/' + sub.name : sub.name;

            if (fileName && fromDir !== toDir) {
              showToast(`Moving ${fileName}...`, 1500);
              const res = await window.api.invoke('move-subtitle-local', {
                profileName: currentProfile?.name || 'Default',
                libraryRoot: appData.libraryFolders?.[0] || '',
                fileName, fromDir, toDir
              });
              if (res.success) {
                showToast(`Successfully moved to "${sub.name}"`, 3000);
                renderSubtitles();
              } else {
                showToast('Execution error: ' + (res.error || 'Unknown'), 4000);
              }
            }
          } catch (err) {
            console.error('[DND-DROP] Error:', err);
            showToast('Logic Error: ' + err.message);
          }
          window.activeDragData = null;
        };
      }

      item.onclick = (e) => {
        if (e.target.closest('.sub-action-btn')) return;
        if (isDir) {
          subCurrentDir = subCurrentDir ? subCurrentDir + '/' + sub.name : sub.name;
          renderSubtitles();
        }
      };
      item.onmouseenter = () => {
        item.style.background = 'rgba(255, 255, 255, 0.07)';
        item.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        item.style.transform = 'translateY(-2px)';
        item.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)';
      };
      item.onmouseleave = () => {
        item.style.background = 'rgba(255, 255, 255, 0.04)';
        item.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        item.style.transform = 'translateY(0)';
        item.style.boxShadow = 'none';
      };

      item.querySelector('.sub-rename-btn').onclick = (e) => {
        e.stopPropagation();
        const ext = isDir ? '' : sub.name.split('.').pop();
        const oldBase = isDir ? sub.name : sub.name.substring(0, sub.name.lastIndexOf('.'));

        showCustomPrompt('Rename ' + (isDir ? 'Folder' : 'Subtitle'), oldBase, async (newBase) => {
          if (newBase && newBase.trim() !== oldBase) {
            const newName = isDir ? newBase.trim() : newBase.trim() + '.' + ext;
            const res = await window.api.invoke('rename-subtitle-local', {
              profileName: currentProfile?.name || 'Default',
              libraryRoot: appData.libraryFolders?.[0] || '',
              oldName: sub.name,
              newName: newName,
              subDir: subCurrentDir
            });
            if (res.success) { showToast('Renamed'); renderSubtitles(); }
            else { showToast('Rename failed: ' + res.error); }
          }
        });
      };

      item.querySelector('.sub-delete-btn').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete ${isDir ? 'folder' : 'subtitle'} "${sub.name}"?`)) {
          await window.api.invoke('delete-subtitle-local', {
            profileName: currentProfile?.name || 'Default',
            libraryRoot: appData.libraryFolders?.[0] || '',
            fileName: sub.name,
            subDir: subCurrentDir
          });
          renderSubtitles();
        }
      };

      grid.appendChild(item);
    });
  }

  function renderSubBreadcrumbs() {
    const bc = $('#sub-breadcrumbs');
    if (!bc) return;
    bc.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'breadcrumb-item';
    root.style = 'cursor: pointer; color: var(--accent); font-weight: 600;';
    root.textContent = 'Library';
    root.onclick = () => { subCurrentDir = ''; renderSubtitles(); };
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
        item.style = `cursor: pointer; ${idx === parts.length - 1 ? 'color: #fff; font-weight: 700;' : ''}`;
        item.textContent = p;
        item.onclick = () => { subCurrentDir = target; renderSubtitles(); };
        bc.appendChild(item);
      });
    }
  }

  // ── Subtitle Studio Support ──
  let subSyncOffset = 0;

  async function loadSubtitleLocal(fp) {
    if (!fp) return;
    try {
      window.activeSubtitlePath = fp; // Track active subtitle
      renderPlayerSubLibrary(); // Refresh list to show highlight

      showToast('Loading local subtitle...');
      const content = await window.api.invoke('read-subtitle-file', fp);
      if (!content) throw new Error('Failed to read file');

      let processedContent = content;
      const ext = fp.toLowerCase().split('.').pop();

      if (ext === 'srt') {
        processedContent = srtToVtt(content);
      } else if (ext === 'ass' || ext === 'ssa') {
        processedContent = assToVtt(content);
      }

      const blob = new Blob([processedContent], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);

      video.querySelectorAll('track').forEach(t => t.remove());
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
          video.textTracks[video.textTracks.length - 1].mode = 'showing';
          subtitleTrack = video.textTracks[video.textTracks.length - 1];
          applySubtitleStyles();
        }
      }, 100);

      showToast('Subtitle applied!');
    } catch (err) {
      console.error('[LOAD-SUB] Error:', err);
      showToast('Failed to load subtitle');
    }
  }

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
        background-color: rgba(0, 0, 0, ${bgOpacity}) !important;
        font-size: ${size / 5}px !important;
        font-weight: ${isBold ? 'bold' : 'normal'} !important;
        text-shadow: ${hasShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none'} !important;
        color: white !important;
        font-family: inherit !important;
        unicode-bidi: plaintext !important; /* Proper RTL handling */
        direction: rtl !important;           /* Forces punctuation to correct side for Arabic */
        text-align: center !important;
      }
    `;

    if ($('#label-sub-size')) $('#label-sub-size').textContent = `${size}%`;
    if ($('#label-sub-bg')) $('#label-sub-bg').textContent = `${Math.round(bgOpacity * 100)}%`;
  }

  function updateSubSyncDisplay() {
    const el = $('#sub-sync-val');
    if (el) el.textContent = `${subSyncOffset > 0 ? '+' : ''}${subSyncOffset.toFixed(1)}s`;
  }

  window.adjustSubSync = (delta) => {
    subSyncOffset += delta;
    updateSubSyncDisplay();
    // Implementation of real sync offset would go here if using a custom renderer
  };


  // ── Music Player ──
  function renderMusic() {
    const grid = $('#music-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const music = (appData.music || []);
    $('#music-empty').style.display = music.length ? 'none' : 'flex';
    const q = ($('#music-search-input')?.value || '').toLowerCase();

    const filtered = q ? music.filter(m =>
      !isLocked(m.id) && (
        (m.title || '').toLowerCase().includes(q) ||
        (m.artist || '').toLowerCase().includes(q)
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
        e.preventDefault();
        contextTarget = item;
        const pl = $('#ctx-pin-label');
        if (pl) pl.textContent = (currentProfile?.pinned || []).includes(item.id) ? 'Unpin' : 'Pin';
        const ll = $('#ctx-lock-label');
        if (ll) ll.textContent = (currentProfile?.lockedItems || []).includes(item.id) ? 'Unlock Item' : 'Lock Item';

        const isMusic = item.type === 'music';
        $('#ctx-edit-music').style.display = isMusic ? 'flex' : 'none';
        $('#ctx-delete-music').style.display = isMusic ? 'flex' : 'none';
        $('#ctx-tmdb-search').style.display = isMusic ? 'none' : 'flex';
        $('#ctx-cover').style.display = 'flex'; // Enable for both music and video
        if ($('#ctx-rename')) $('#ctx-rename').style.display = isMusic ? 'none' : 'flex';
        if ($('#ctx-delete')) $('#ctx-delete').style.display = isMusic ? 'none' : 'flex';

        const cm = $('#context-menu');
        cm.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
        cm.style.top = Math.min(e.clientY, window.innerHeight - 250) + 'px';
        cm.style.display = 'block';
      };
      grid.appendChild(card);
    });
    updateBadges();
  }

  function playMusic(item) {
    if (item.isVideoMusic) {
      playVideo(item, null);
      return;
    }
    currentItem = { ...item, type: 'music' };
    // Use local-file:// protocol (registered as privileged/same-origin)
    // This prevents CORS blocking the AudioContext from capturing audio data
    video.src = 'local-file:///' + item.path.replace(/\\/g, '/');
    video.play().catch(err => {
      console.error('[MUSIC] Playback error:', err);
      showToast('Playback failed');
    });

    const { title, artist, cover } = getMusicMeta(item);

    $('#music-title').textContent = title;
    $('#music-artist').textContent = artist;

    // Set Poster
    const bgUrl = localImg(cover) || 'https://api.dicebear.com/7.x/shapes/svg?seed=music';
    // Removed #music-poster-bg assignment since it is now a static CSS animation
    $('#music-poster-img').src = bgUrl;

    // Update mini-player poster
    if ($('#mp-poster')) {
      $('#mp-poster').src = bgUrl;
      $('#mp-poster').style.display = 'block';
    }

    $('#mp-title').textContent = title;
    $('#mp-meta').textContent = `${artist}`;

    if (cover) {
      $('#mp-poster').src = bgUrl;
      $('#mp-poster').style.display = 'block';
    } else {
      $('#mp-poster').style.display = 'none';
    }
    $('#mini-player').style.display = 'flex';
    isPlayingMusic = true;
    switchView('player');

    // Guaranteed Audio Resume on Interaction
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    initVisualizer();

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
    grid.innerHTML = '';
    const watchlist = (currentProfile?.watchlist || []).filter(i => !isLocked(i.id));
    $('#watchlist-count').textContent = watchlist.length ? `(${watchlist.length})` : '';
    $('#watchlist-empty').style.display = watchlist.length ? 'none' : 'flex';

    watchlist.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card fade-in';
      let posterUrl = '';
      if (item.poster_path) {
        posterUrl = item.poster_path.startsWith('http') ? item.poster_path : `${TMDB_IMG}/w342${item.poster_path}`;
      }
      const isShow = item.media_type === 'tv' || !!item.first_air_date;
      const title = item.title || item.name || 'Unknown';
      const year = (item.release_date || item.first_air_date || '').slice(0, 4);

      card.innerHTML = `
        <div class="card-poster">
          ${posterUrl ? `<img class="card-img" src="${posterUrl}" alt="${escapeHTML(title)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" loading="lazy">` : `<div class="card-poster-placeholder"><div class="ph-icon">${isShow ? SVG_SHOW : SVG_MOVIE}</div></div>`}
          <div class="card-play-overlay">
             <div class="play-circle"><svg viewBox="0 0 24 24" width="22" height="22"><polygon points="8 5 20 12 8 19"/></svg></div>
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
          <div class="card-meta">${year ? year + ' · ' : ''}${isShow ? (item.isYoutube ? 'Video' : 'TV Show') : 'Movie'}${item.vote_average ? ` · ${item.vote_average.toFixed(1)} ★` : ''}</div>
        </div>
      `;
      card.onclick = () => openDiscoverDetail(item);
      grid.appendChild(card);
    });
  }

  function toggleWatchlist(item) {
    if (!currentProfile) return;
    const index = currentProfile.watchlist.findIndex(i => i.id === item.id);
    if (index === -1) {
      currentProfile.watchlist.unshift(item);
      showToast('Added to Watchlist');
    } else {
      currentProfile.watchlist.splice(index, 1);
      showToast('Removed from Watchlist');
    }
    persist();
    updateWatchlistButton(item.id);
    if (currentView === 'watchlist') renderWatchlist();
  }

  function updateWatchlistButton(id) {
    const btn = $('#btn-toggle-watchlist');
    if (!btn || !currentProfile) return;
    const inWatchlist = currentProfile.watchlist.some(i => i.id === id);
    if (inWatchlist) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:6px"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> In Watchlist';
      btn.classList.add('watchlist-active');
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Watchlist';
      btn.classList.remove('watchlist-active');
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-outline');
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
  setInterval(() => {
    const rb = $('#btn-rescan');
    if (rb && rb.disabled) rb.disabled = false;
  }, 2000);

  // ── Auto-Updater Logic ──
  async function checkMobileUpdate(isManual = false) {
    if (window.api?.isElectron) return;
    console.log('[MOBILE-UPDATER] Checking GitHub for updates...');
    try {
      const response = await fetch('https://api.github.com/repos/amromotaw3/MediaVault-Setup/releases/latest');
      if (!response.ok) throw new Error('GitHub API unreachable');
      const data = await response.json();
      const latestVersion = data.tag_name.replace('v', '');
      
      if (latestVersion !== APP_VERSION) {
        console.log('[MOBILE-UPDATER] Update found:', latestVersion);
        handleUpdateStatus({
          status: 'available',
          version: latestVersion,
          msg: `New APK Available: v${latestVersion}`,
          downloadUrl: data.assets.find(a => a.name.endsWith('.apk'))?.browser_download_url || data.html_url
        });
      } else if (isManual) {
        showToast('MediaVault is up to date!');
      }
    } catch (err) {
      console.warn('[MOBILE-UPDATER] Check failed:', err.message);
      if (isManual) showToast('Update check failed. Check your connection.');
    }
  }

  function handleUpdateStatus(data) {
    const toast = $('#update-toast');
    const title = $('#update-toast-title');
    const desc = $('#update-toast-desc');
    const actionBtn = $('#update-btn-action');
    const progressRow = $('#update-progress-row');
    const progressFill = $('#update-progress-fill');
    const percentText = $('#update-percent-text');
    const closeBtn = $('#update-btn-close');
    const statusDetail = $('#update-status-detail');

    if (statusDetail) {
      statusDetail.style.display = 'block';
      statusDetail.textContent = data.msg;
    }

    switch (data.status) {
      case 'available':
        toast.style.display = 'block';
        setTimeout(() => toast.classList.add('active'), 10);
        title.textContent = 'Update Available';
        desc.textContent = data.msg || `Version v${data.version} is ready for you.`;
        actionBtn.style.display = 'block';
        actionBtn.disabled = false;
        actionBtn.textContent = (window.api?.isElectron) ? 'Download Now' : 'Get APK';
        closeBtn.textContent = 'Later';
        closeBtn.classList.remove('btn-update-cancel');
        
        actionBtn.onclick = () => {
          if (window.api?.isElectron) {
            window.api.invoke('start-update-download');
            actionBtn.disabled = true;
            actionBtn.textContent = 'Preparing...';
          } else {
            actionBtn.disabled = true;
            actionBtn.textContent = 'Preparing...';
            const apkName = `MediaVault_v${data.version}.apk`;
            
            const unbindProgress = window.api.onDownloadProgress((e) => {
              if (e.detail?.name === apkName) {
                handleUpdateStatus({
                  status: 'downloading',
                  percent: e.detail.percent,
                  speed: e.detail.speed || '0',
                  msg: `Downloading APK...`
                });
              }
            });

            const unbindComplete = window.api.onDownloadComplete((e) => {
              if (e.detail?.name === apkName) {
                unbindProgress();
                unbindComplete();
                if (unbindError) unbindError();
                
                appData.lastDownloadedApkPath = e.detail.path;
                persist();
                
                handleUpdateStatus({
                  status: 'ready',
                  msg: 'APK Downloaded. Click to install.'
                });
              }
            });

            var unbindError = window.api.onDownloadError((e) => {
              if (e.detail?.name === apkName) {
                unbindProgress();
                unbindComplete();
                unbindError();
                handleUpdateStatus({ status: 'error', msg: e.detail.error });
              }
            });

            window.api.downloadFile(data.downloadUrl || 'https://github.com/amromotaw3/MediaVault-Setup/releases', apkName);
          }
        };
        break;

      case 'downloading':
        progressRow.style.display = 'flex';
        progressFill.style.width = `${data.percent}%`;
        percentText.textContent = `${Math.round(data.percent)}%`;
        desc.textContent = `Downloading update... (${data.speed} MB/s)`;
        actionBtn.style.display = 'none';
        closeBtn.textContent = 'Cancel';
        closeBtn.classList.add('btn-update-cancel');
        break;

      case 'ready':
        toast.style.display = 'block';
        setTimeout(() => toast.classList.add('active'), 10);
        progressRow.style.display = 'none';
        title.textContent = 'Update Ready';
        desc.textContent = data.msg || 'The update is ready to be applied. Restart MediaVault to finish.';
        actionBtn.style.display = 'block';
        actionBtn.disabled = false;
        actionBtn.textContent = (window.api?.isElectron) ? 'Restart & Install' : 'Install APK';
        
        actionBtn.onclick = async () => {
          if (window.api?.isElectron) {
            window.api.invoke('restart-app-and-install');
          } else {
            if (appData.lastDownloadedApkPath) {
              const res = await window.api.openFile(appData.lastDownloadedApkPath, 'application/vnd.android.package-archive');
              if (!res.success) showToast('Failed to open APK installer: ' + res.error);
            } else {
              showToast('APK path not found');
            }
          }
        };
        break;

      case 'error':
        showToast('Update failed: ' + data.msg);
        break;

      case 'none':
        if (statusDetail) {
          statusDetail.textContent = 'MediaVault is up to date.';
          setTimeout(() => { if (statusDetail.textContent === 'MediaVault is up to date.') statusDetail.style.display = 'none'; }, 5000);
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
        const res = await window.api.invoke('check-for-updates');
        if (!res.success) showToast('Update check failed: ' + res.error);
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





  // --- Radio Page Logic ---
  let currentRadioTitle = '';

  const RADIO_STATIONS = [
    { id: 'nida_islam', name: 'إذاعة نداء الإسلام', loc: 'بث مباشر - مكة المكرمة', icon: 'fa-microphone-lines', url: 'https://stream.radiojar.com/4wqre23fytzuv', type: 'LIVE' },
    { id: 'maher', name: 'إذاعة ماهر المعيقلي', loc: 'تلاوات على مدار الساعة', icon: 'fa-book-open', url: 'https://backup.qurango.net/radio/maher', type: 'RECITATION' },
    { id: 'sudais', name: 'إذاعة عبدالرحمن السديس', loc: 'تلاوات على مدار الساعة', icon: 'fa-book-open', url: 'https://backup.qurango.net/radio/abdulrahman_alsudaes', type: 'RECITATION' },
    { id: 'ghamdi', name: 'إذاعة سعد الغامدي', loc: 'تلاوات على مدار الساعة', icon: 'fa-book-open', url: 'https://backup.qurango.net/radio/saad_alghamdi', type: 'RECITATION' }
  ];

  function renderRadio() {
    const grid = $('#radio-grid');
    if (!grid) return;
    grid.innerHTML = '';

    RADIO_STATIONS.forEach(st => {
      const card = document.createElement('div');
      card.className = 'radio-card' + (engine && engine.isUsingMpv && engine.currentUrl === st.url && !engine.paused ? ' playing' : '');
      card.innerHTML = `
        <div class="radio-card-top">
          <span class="radio-card-icon"><i class="fa-solid ${st.icon}"></i></span>
          <div class="radio-card-status">
             <span class="pulse-dot"></span> ${st.type}
          </div>
        </div>
        <div class="radio-card-body">
          <span class="radio-card-name arabic-text">${st.name}</span>
          <span class="radio-card-loc arabic-text">${st.loc}</span>
        </div>
      `;
      card.onclick = () => playQuranRadio(card, st.url, st.name);
      grid.appendChild(card);
    });
  }

  async function playQuranRadio(card, url, title) {
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('playing'));
    if (!engine) return;

    engine.stop();
    try {
      const success = await engine.load(url, { isRadio: true });
      if (success) {
        if (card) card.classList.add('playing');
        currentRadioTitle = title;
        $('#mp-title').textContent = title;
        $('#mp-meta').textContent = 'Live Radio Stream';
        $('#mini-player').style.display = 'flex';
        $('#mp-btn-play-pause').style.display = 'none';
        const vizSmall = $('#mp-radio-visualizer');
        if (vizSmall) vizSmall.style.display = 'flex';
        $('#mp-info-click').style.cursor = 'default';
        showToast(`Connected: ${title}`);
      } else {
        showToast(`Connection Failed: ${title}`);
        stopQuranRadio();
      }
    } catch (err) {
      console.error('Radio play error:', err, title);
      stopQuranRadio();
    }
  }

  function stopQuranRadio() {
    if (engine) engine.stop();
    currentRadioTitle = '';
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('playing'));
    $('#mini-player').style.display = 'none';
    $('#mp-btn-play-pause').style.display = 'flex';
    const vizSmall = $('#mp-radio-visualizer');
    if (vizSmall) vizSmall.style.display = 'none';
    $('#mp-info-click').style.cursor = 'pointer';
    showToast('Radio Stopped');
  }

  const navRadio = $('#nav-radio');
  if (navRadio) {
    navRadio.onclick = () => {
      switchView('radio');
      renderRadio();
    };
  }

  // Ensure initial boot tasks
  renderRadio();

  // ── Discover Search Listener ──
  let discoverSearchTimer = null;
  const searchInput = document.querySelector('#search-discover');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(discoverSearchTimer);
      discoverSearchTimer = setTimeout(() => {
        if (typeof performDiscoverSearch === 'function') {
          performDiscoverSearch();
        }
      }, 500);
    });
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
      const loadingOverlay = document.getElementById('player-loading');

      if (progressText) {
        progressText.innerHTML = `
          <div style="font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 5px;">Buffering Stream...</div>
          <div style="font-size: 0.9rem; color: var(--accent); font-weight: 600;">${data.percent} complete</div>
          <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">Peers: ${data.peers} &bull; ${data.downloaded} / ${data.total}</div>
        `;
      }
      if (speedText) {
        speedText.innerHTML = `<i class="fas fa-bolt" style="color: var(--accent); margin-right: 5px;"></i> ${data.speed}`;
      }
      
      // If we are getting progress and the overlay is hidden, maybe show it?
      // But only if we are in player view and video isn't playing yet
      if (currentView === 'player' && engine && engine.paused && loadingOverlay) {
        // loadingOverlay.style.display = 'flex';
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


})();