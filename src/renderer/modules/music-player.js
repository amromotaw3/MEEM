/**
 * MEEM SPOTIFY MUSIC PLAYER MODULE
 * Fully integrated with YouTube Music & Innertube/yt-dlp Backend
 * Real Live Search, Direct Audio Stream Playback, Synced Lyrics (LRCLIB),
 * True File Downloading, and IndexedDB Offline Mode.
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  //  1. INDEXEDDB OFFLINE STORAGE SYSTEM
  // ══════════════════════════════════════════════════════════════════════════
  const DB_NAME = 'MeemSpotifyMusicDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'offline_tracks';

  const openOfflineDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const OfflineStorage = {
    async saveTrack(track, audioBlob, lyrics) {
      try {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const item = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album || 'Single',
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            audioBlob,
            lyrics,
            savedAt: Date.now()
          };
          const req = store.put(item);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      } catch (e) {
        console.error('[MusicDB] Save error:', e);
        return false;
      }
    },

    async getTrack(id) {
      try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch (e) {
        return null;
      }
    },

    async getAllTracks() {
      try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
      } catch (e) {
        return [];
      }
    },

    async removeTrack(id) {
      try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        });
      } catch (e) {
        return false;
      }
    },

    async isOffline(id) {
      const item = await this.getTrack(id);
      return !!item;
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  2. LRC LYRICS PARSER
  // ══════════════════════════════════════════════════════════════════════════
  const parseLRC = (lrcString, duration = 180) => {
    if (!lrcString || typeof lrcString !== 'string') return [];
    const lines = lrcString.split('\n');
    const result = [];
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      const matches = [...line.matchAll(timeRegex)];
      if (matches.length > 0) {
        const text = line.replace(timeRegex, '').trim();
        for (const m of matches) {
          const minutes = parseInt(m[1], 10);
          const seconds = parseInt(m[2], 10);
          const msPart = m[3] || '0';
          const milliseconds = msPart.length === 2 ? parseInt(msPart, 10) * 10 : (msPart.length === 1 ? parseInt(msPart, 10) * 100 : parseInt(msPart, 10));
          const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
          result.push({ time: timeInSeconds, text: text || '...' });
        }
      } else if (line && !line.startsWith('[ti:') && !line.startsWith('[ar:') && !line.startsWith('[al:') && !line.startsWith('[by:') && !line.startsWith('[offset:') && !line.startsWith('[length:')) {
        result.push({ time: -1, text: line });
      }
    });

    const hasTimestamps = result.some(r => r.time >= 0);
    if (hasTimestamps) {
      result.sort((a, b) => a.time - b.time);
    } else if (result.length > 0) {
      const safeDuration = (typeof duration === 'number' && duration > 0) ? duration : 180;
      const step = safeDuration / Math.max(1, result.length);
      result.forEach((r, idx) => { r.time = idx * step; });
    }

    return result;
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  3. CURATED PLAYLISTS PRESETS (ISLAMIC CONTENT - ENGLISH UI)
  // ══════════════════════════════════════════════════════════════════════════
  const CURATED_PLAYLISTS = [
    {
      id: 'pl-nasheed',
      title: 'Inspiring Nasheeds',
      description: 'Vocal melodies and heartfelt spiritual hymns without instruments.',
      genreQuery: 'nasheed',
      cover: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80',
      followers: '15.4M'
    },
    {
      id: 'pl-quran',
      title: 'Soulful Quran Recitations',
      description: 'Revered Quranic recitations by world-renowned Qaris.',
      genreQuery: 'quran',
      cover: 'https://images.unsplash.com/photo-1609599006353-e629aaabfeae?w=600&q=80',
      followers: '28.6M'
    },
    {
      id: 'pl-adkar',
      title: 'Morning & Evening Adkar',
      description: 'Daily remembrance, prayers, and soothing supplications.',
      genreQuery: 'adkar',
      cover: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=600&q=80',
      followers: '11.2M'
    },
    {
      id: 'pl-ruqyah',
      title: 'Al-Ruqyah Al-Shariah',
      description: 'Comprehensive healing verses and spiritual peace.',
      genreQuery: 'ruqyah',
      cover: 'https://images.unsplash.com/photo-1519817650390-64a93db51149?w=600&q=80',
      followers: '9.8M'
    },
    {
      id: 'pl-prophet',
      title: 'Prophetic Praises & Poems',
      description: 'Poetic tributes honoring Prophet Muhammad ﷺ.',
      genreQuery: 'prophet',
      cover: 'https://images.unsplash.com/photo-1564769625905-50e93615e769?w=600&q=80',
      followers: '7.5M'
    },
    {
      id: 'pl-calm',
      title: 'Peaceful Night Recitations',
      description: 'Gentle, calming recitations for deep tranquility and sleep.',
      genreQuery: 'calm',
      cover: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=600&q=80',
      followers: '8.1M'
    }
  ];

  const POPULAR_ARTISTS = [
    { name: 'Mishary Alafasy', query: 'مشاري راشد العفاسي تلاوات واناشيد audio', cover: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80', followers: '35M' },
    { name: 'Maher Zain', query: 'ماهر زين Maher Zain بدون موسيقى audio', cover: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=300&q=80', followers: '29M' },
    { name: 'Abdulbasit Abdulsamad', query: 'عبدالباسط عبدالصمد تلاوات نادرة خاشعة audio', cover: 'https://images.unsplash.com/photo-1609599006353-e629aaabfeae?w=300&q=80', followers: '40M' },
    { name: 'Humood AlKhudher', query: 'حمود الخضر Humood بدون موسيقى audio', cover: 'https://images.unsplash.com/photo-1519817650390-64a93db51149?w=300&q=80', followers: '18M' },
    { name: 'Ahmed Al-Nufais', query: 'الشيخ أحمد النفيس اناشيد وتلاوات audio', cover: 'https://images.unsplash.com/photo-1564769625905-50e93615e769?w=300&q=80', followers: '14M' },
    { name: 'Yasser Al-Dossari', query: 'الشيخ ياسر الدوسري تلاوة خاشعة audio', cover: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=300&q=80', followers: '22M' }
  ];

  // ══════════════════════════════════════════════════════════════════════════
  //  3.5 AUDIO VISUALIZER ENGINE (TRUE WEB-AUDIO SPECTRUM & ORGANIC REACTIVITY)
  // ══════════════════════════════════════════════════════════════════════════
  class AudioVisualizerEngine {
    constructor(playerEngine) {
      this.player = playerEngine;
      this.canvas = null;
      this.ctx = null;
      this.animationFrame = null;
      this.audioCtx = null;
      this.analyser = null;
      this.source = null;
      this.dataArray = null;
      this.bufferLength = 0;
      this.numBars = 40;
      this.barHeights = new Float32Array(this.numBars);
      this.barPeaks = new Float32Array(this.numBars);
      this.phase = 0;
      this.lastTime = 0;
      this.beatEnergy = 0;
    }

    init() {
      this.canvas = document.getElementById('fs-audio-visualizer');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this._attachWebAudio();
      this.start();
    }

    _attachWebAudio() {
      if (this.audioCtx && this.analyser) {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        return;
      }
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.audioCtx = new AudioContextClass();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;

        if (this.player && this.player.audio && !this.source) {
          try {
            if (!this.player.audio.crossOrigin) {
              this.player.audio.crossOrigin = 'anonymous';
            }
            this.source = this.audioCtx.createMediaElementSource(this.player.audio);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
          } catch (e) {
            // If already connected or CORS-restricted
          }
        }
        this.bufferLength = this.analyser.frequencyBinCount || 128;
        this.dataArray = new Uint8Array(this.bufferLength);
      } catch (err) {
        console.warn('[Visualizer] WebAudio attach notice:', err.message);
      }
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor((rect.width || 360) * dpr);
      const h = Math.floor((rect.height || 48) * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    start() {
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      const render = (time) => {
        this.draw(time);
        this.animationFrame = requestAnimationFrame(render);
      };
      this.animationFrame = requestAnimationFrame(render);
    }

    draw(currentTimeMs = 0) {
      if (!this.canvas || !this.ctx) {
        this.canvas = document.getElementById('fs-audio-visualizer');
        if (this.canvas) {
          this.ctx = this.canvas.getContext('2d');
          this.resize();
        } else {
          return;
        }
      }

      const modal = document.getElementById('fullscreen-music-modal');
      if (!modal || !modal.classList.contains('open')) return;

      const ctx = this.ctx;
      const width = this.canvas.width;
      const height = this.canvas.height;
      if (!width || !height) return;

      ctx.clearRect(0, 0, width, height);

      const isPlaying = this.player.isPlaying;
      if (isPlaying && this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      // Check real frequency data from Web Audio Analyser
      let hasRealData = false;
      if (this.analyser && this.dataArray && isPlaying) {
        try {
          this.analyser.getByteFrequencyData(this.dataArray);
          let sum = 0;
          for (let i = 0; i < this.bufferLength; i++) {
            sum += this.dataArray[i];
          }
          if (sum > 50) {
            hasRealData = true;
          }
        } catch (e) {}
      }

      const dt = Math.min((currentTimeMs - this.lastTime) / 1000, 0.1) || 0.016;
      this.lastTime = currentTimeMs;
      this.phase += isPlaying ? dt * 4.5 : dt * 0.8;

      const numBars = this.numBars;
      const dpr = window.devicePixelRatio || 1;
      const gap = 3 * dpr;
      const totalBarWidth = (width - (numBars - 1) * gap) / numBars;
      const barWidth = Math.max(2 * dpr, totalBarWidth);
      const centerY = height / 2;
      const maxBarHeight = height * 0.90;

      // Extract frequency spectrum
      for (let i = 0; i < numBars; i++) {
        let targetIntensity = 0.05;

        if (isPlaying) {
          if (hasRealData) {
            // Symmetrical distribution: bass in center, mids and highs tapering outward
            const centerIdx = (numBars - 1) / 2;
            const distFromCenter = Math.abs(i - centerIdx) / centerIdx; // 0 (center) to 1 (edges)

            // Map center to lower frequencies (bass/mid-bass) and edges to highs/treble
            const binIdx = Math.floor((1 - distFromCenter) * (this.bufferLength * 0.7));
            const clampedBin = Math.min(this.bufferLength - 1, Math.max(0, binIdx));
            const rawFreq = (this.dataArray[clampedBin] || 0) / 255;

            // Apply perceptual loudness weighting
            const loudnessBoost = 1.0 + (1 - distFromCenter) * 0.4;
            targetIntensity = Math.max(0.08, Math.min(1.0, rawFreq * 1.35 * loudnessBoost));
          } else {
            // Organic audio-reactive physics model (synthetic kick/snare harmonic spectrum)
            const centerIdx = (numBars - 1) / 2;
            const distFromCenter = Math.abs(i - centerIdx) / centerIdx;
            const t = this.phase;

            // Multiple dynamic harmonic layers
            const bassKick = Math.pow(Math.max(0, Math.sin(t * 2.2)), 3) * (1 - distFromCenter * 0.6);
            const midWave = Math.sin(t * 3.4 + i * 0.4) * 0.35 + 0.35;
            const highFlutter = Math.cos(t * 5.1 - i * 0.6) * 0.25 * (0.4 + distFromCenter * 0.6);
            const microJitter = (Math.sin(t * 8.7 + i * 1.7) * 0.15);

            const composite = bassKick * 0.55 + midWave * 0.35 + highFlutter * 0.2 + microJitter;
            const centerBell = 1 - Math.pow(distFromCenter, 1.8) * 0.5;
            targetIntensity = Math.max(0.08, Math.min(1.0, composite * centerBell * 1.1));
          }
        } else {
          // Ambient breathing when paused
          targetIntensity = 0.04 + 0.02 * Math.sin(this.phase * 0.5 + i * 0.2);
        }

        // Smooth physics interpolation (instant attack, fluid smooth decay)
        const current = this.barHeights[i];
        const attackSpeed = hasRealData ? 0.45 : 0.35;
        const decaySpeed = isPlaying ? 0.16 : 0.08;
        const lerpFactor = targetIntensity > current ? attackSpeed : decaySpeed;
        this.barHeights[i] += (targetIntensity - current) * lerpFactor;

        const smoothedIntensity = Math.max(0.04, this.barHeights[i]);
        const barH = Math.max(4 * dpr, smoothedIntensity * maxBarHeight);
        const x = i * (barWidth + gap);
        const y = centerY - barH / 2;

        // Luxury High-Contrast White Glow Styling
        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.82)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.45)');

        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
        ctx.shadowBlur = isPlaying ? (6 * dpr) : (2 * dpr);

        const radius = barWidth / 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barH, radius);
        } else {
          ctx.rect(x, y, barWidth, barH);
        }
        ctx.fill();
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  4. GLOBAL AUDIO ENGINE
  // ══════════════════════════════════════════════════════════════════════════
  class SpotifyPlayerEngine {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.currentTrack = null;
      this.isPlaying = false;
      this.currentTime = 0;
      this.duration = 0;
      this.volume = 0.85;
      this.isMuted = false;
      this.isShuffle = false;
      this.repeatMode = 'off';
      this.queue = [];
      this.queueIndex = 0;
      this.lyricsList = [];
      this.quranData = null;
      this.activeLyricIndex = -1;
      this.activeTranslationLang = localStorage.getItem('meem_lyrics_lang') || 'ar';
      this.translationCache = new Map();
      this.visualizer = new AudioVisualizerEngine(this);
      this.sleepTimerEnd = null;
      this.sleepTimerInterval = null;
      this.likedTracks = new Set(JSON.parse(localStorage.getItem('meem_liked_music') || '[]'));
      this.categoryCache = new Map();

      this._initListeners();
    }

    _initListeners() {
      this.audio.volume = this.volume;

      this.audio.addEventListener('play', () => {
        this.isPlaying = true;
        this.updateUI();
      });

      this.audio.addEventListener('pause', () => {
        this.isPlaying = false;
        this.updateUI();
      });

      this.audio.addEventListener('timeupdate', () => {
        this.currentTime = this.audio.currentTime;
        this.duration = this.audio.duration || this.currentTrack?.duration || 0;
        this.syncLyricsPosition();
        this.updateProgressUI();
      });

      this.audio.addEventListener('loadedmetadata', () => {
        this.duration = this.audio.duration || this.currentTrack?.duration || 0;
        this.updateUI();
      });

      this.audio.addEventListener('ended', () => {
        if (this.repeatMode === 'one') {
          this.audio.currentTime = 0;
          this.audio.play();
        } else {
          this.next();
        }
      });

      this.audio.addEventListener('error', (e) => {
        console.warn('[MusicPlayer] Playback error event:', e);
      });
    }

    async playTrack(track, newQueue = null) {
      if (!track) return;
      if (newQueue && Array.isArray(newQueue) && newQueue.length > 0) {
        this.queue = [...newQueue];
        this.queueIndex = this.queue.findIndex(t => String(t.id) === String(track.id));
        if (this.queueIndex === -1) this.queueIndex = 0;
      } else if (!this.queue || this.queue.length === 0) {
        this.queue = [track];
        this.queueIndex = 0;
      } else {
        const foundIdx = this.queue.findIndex(t => String(t.id) === String(track.id));
        if (foundIdx !== -1) {
          this.queueIndex = foundIdx;
        } else {
          this.queue.splice(this.queueIndex + 1, 0, track);
          this.queueIndex = this.queueIndex + 1;
        }
      }

      this.currentTrack = track;
      this.currentTime = 0;
      this.activeLyricIndex = -1;
      this.showBottomBar();
      this.updateUI();
      this.renderQueueUI();

      if (window.showToast) window.showToast('Loading "' + track.title + '"...');

      try {
        // 1. Check if cached in IndexedDB offline
        const offlineItem = await OfflineStorage.getTrack(track.id);
        if (offlineItem && offlineItem.audioBlob) {
          this.audio.src = URL.createObjectURL(offlineItem.audioBlob);
          this.lyricsList = parseLRC(offlineItem.lyrics || '');
        } else {
          // 2. Extract real audio stream URL from backend
          let streamUrl = null;
          if (window.api && window.api.getMusicStreamUrl) {
            const streamRes = await window.api.getMusicStreamUrl(track.id);
            if (streamRes && streamRes.success && streamRes.streamUrl) {
              streamUrl = streamRes.streamUrl;
            }
          }

          if (!streamUrl && track.audioUrl) {
            streamUrl = track.audioUrl;
          }

          if (!streamUrl) {
            throw new Error('Could not resolve audio stream URL');
          }

          this.audio.src = streamUrl;

          // 3. Fetch real Synced Lyrics or Quran Reader Uthmani Text
          this.lyricsList = [];
          this.quranData = null;
          if (window.api && window.api.getMusicLyrics) {
            window.api.getMusicLyrics(track.title, track.artist, track.duration, track.id).then(res => {
              if (this.currentTrack?.id === track.id) {
                if (res && res.success) {
                  if (res.isQuran) {
                    this.quranData = res;
                    this.lyricsList = [];
                  } else if (res.syncedLyrics || res.plainLyrics) {
                    this.quranData = null;
                    this.lyricsList = parseLRC(res.syncedLyrics || res.plainLyrics);
                    if (this.activeTranslationLang && this.activeTranslationLang !== 'off') {
                      this.setTranslationLanguage(this.activeTranslationLang);
                      return;
                    }
                  }
                  this.renderLyricsUI();
                }
              }
            }).catch(() => {});
          }
        }

        await this.audio.play();
        this.isPlaying = true;
      } catch (err) {
        console.error('[MusicPlayer] play error:', err);
        if (window.showToast) window.showToast('Playback failed: ' + err.message);
      }

      this.updateUI();
      this.renderQueueUI();
      if (this.activeTranslationLang && this.activeTranslationLang !== 'off') {
        this.setTranslationLanguage(this.activeTranslationLang);
      } else {
        this.renderLyricsUI();
      }
    }

    addToQueue(track) {
      if (!track) return;
      if (!this.queue || this.queue.length === 0) {
        this.playTrack(track);
        return;
      }
      this.queue.push(track);
      if (window.showToast) window.showToast(`Added "${track.title}" to queue`);
      this.renderQueueUI();
    }

    removeFromQueue(index) {
      if (index < 0 || index >= this.queue.length) return;
      const removed = this.queue.splice(index, 1)[0];
      if (index < this.queueIndex) {
        this.queueIndex--;
      } else if (index === this.queueIndex) {
        if (this.queueIndex >= this.queue.length) {
          this.queueIndex = Math.max(0, this.queue.length - 1);
        }
        if (this.queue.length > 0) {
          this.playTrack(this.queue[this.queueIndex]);
        } else {
          this.audio.pause();
          this.currentTrack = null;
          this.isPlaying = false;
          this.updateUI();
        }
      }
      this.renderQueueUI();
      if (window.showToast) window.showToast(`Removed "${removed?.title || 'track'}" from queue`);
    }

    clearQueue() {
      if (this.currentTrack) {
        this.queue = [this.currentTrack];
        this.queueIndex = 0;
      } else {
        this.queue = [];
        this.queueIndex = 0;
      }
      this.renderQueueUI();
      if (window.showToast) window.showToast('Upcoming queue cleared');
    }

    playQueueTrack(index) {
      if (index >= 0 && index < this.queue.length) {
        this.queueIndex = index;
        this.playTrack(this.queue[index]);
      }
    }

    renderQueueUI() {
      const container = document.getElementById('fs-queue-list');
      const countEl = document.getElementById('fs-queue-count');
      if (countEl) {
        countEl.textContent = `${this.queue.length} track${this.queue.length === 1 ? '' : 's'}`;
      }
      if (!container) return;

      if (!this.queue || this.queue.length === 0) {
        container.innerHTML = `
          <div class="fs-queue-empty-box">
            <i class="fas fa-list-ul"></i>
            <h4>Queue is empty</h4>
            <p>Play a track or collection to build your playback queue.</p>
          </div>
        `;
        return;
      }

      let html = '';

      // Section 1: Now Playing
      if (this.currentTrack) {
        const cur = this.currentTrack;
        html += `
          <div class="fs-queue-section-label"><i class="fas fa-play" style="font-size: 10px;"></i> Now Playing</div>
          <div class="fs-queue-item active" data-queue-idx="${this.queueIndex}">
            <div class="fs-queue-idx-col">
              <i class="fas fa-volume-high fs-queue-playing-icon"></i>
            </div>
            <img class="fs-queue-thumb" src="${cur.thumbnail || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100&q=80'}" alt="Cover">
            <div class="fs-queue-meta">
              <span class="fs-queue-title">${escapeHTML(cur.title)}</span>
              <span class="fs-queue-artist">${escapeHTML(cur.artist || 'Unknown Artist')}</span>
            </div>
            <span class="fs-queue-dur">${cur.durationFormatted || formatTime(cur.duration) || ''}</span>
          </div>
        `;
      }

      // Section 2: Next Up
      const upcoming = [];
      for (let i = 0; i < this.queue.length; i++) {
        if (i !== this.queueIndex) {
          upcoming.push({ track: this.queue[i], index: i });
        }
      }

      if (upcoming.length > 0) {
        html += `<div class="fs-queue-section-label" style="margin-top: 20px;"><i class="fas fa-forward-step" style="font-size: 10px;"></i> Next in Queue (${upcoming.length})</div>`;
        upcoming.forEach(({ track, index }) => {
          html += `
            <div class="fs-queue-item" data-queue-idx="${index}">
              <div class="fs-queue-idx-col">${index + 1}</div>
              <img class="fs-queue-thumb" src="${track.thumbnail || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100&q=80'}" alt="Cover">
              <div class="fs-queue-meta">
                <span class="fs-queue-title">${escapeHTML(track.title)}</span>
                <span class="fs-queue-artist">${escapeHTML(track.artist || 'Unknown Artist')}</span>
              </div>
              <span class="fs-queue-dur">${track.durationFormatted || formatTime(track.duration) || ''}</span>
              <button class="fs-queue-del-btn" data-del-idx="${index}" title="Remove from queue">
                <i class="fas fa-xmark"></i>
              </button>
            </div>
          `;
        });
      } else {
        html += `
          <div class="fs-queue-section-label" style="margin-top: 20px;"><i class="fas fa-forward-step" style="font-size: 10px;"></i> Next in Queue</div>
          <div style="padding: 16px; text-align: center; font-size: 0.82rem; color: rgba(255,255,255,0.4);">
            No upcoming tracks. Play a playlist to queue more items.
          </div>
        `;
      }

      container.innerHTML = html;

      // Event listeners on queue items
      container.querySelectorAll('.fs-queue-item[data-queue-idx]').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.fs-queue-del-btn')) return;
          const idx = parseInt(item.dataset.queueIdx, 10);
          if (!isNaN(idx)) {
            this.playQueueTrack(idx);
          }
        });
      });

      container.querySelectorAll('.fs-queue-del-btn[data-del-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.delIdx, 10);
          if (!isNaN(idx)) {
            this.removeFromQueue(idx);
          }
        });
      });
    }

    togglePlay() {
      if (!this.currentTrack) {
        if (this.queue.length > 0) this.playTrack(this.queue[0]);
        return;
      }
      if (this.isPlaying) {
        this.audio.pause();
      } else {
        this.audio.play();
      }
    }

    next() {
      if (!this.queue || this.queue.length === 0) return;
      if (this.isShuffle) {
        if (this.queue.length > 1) {
          let nextIdx;
          do {
            nextIdx = Math.floor(Math.random() * this.queue.length);
          } while (nextIdx === this.queueIndex && this.queue.length > 1);
          this.queueIndex = nextIdx;
        }
      } else {
        if (this.queueIndex < this.queue.length - 1) {
          this.queueIndex++;
        } else if (this.repeatMode === 'all') {
          this.queueIndex = 0;
        } else {
          this.isPlaying = false;
          this.updateUI();
          return;
        }
      }
      this.playTrack(this.queue[this.queueIndex]);
    }

    prev() {
      if (this.audio.currentTime > 4) {
        this.audio.currentTime = 0;
        return;
      }
      if (!this.queue || this.queue.length === 0) return;
      if (this.queueIndex > 0) {
        this.queueIndex--;
      } else if (this.repeatMode === 'all') {
        this.queueIndex = this.queue.length - 1;
      } else {
        this.queueIndex = 0;
      }
      this.playTrack(this.queue[this.queueIndex]);
    }

    seek(timeSeconds) {
      if (isFinite(timeSeconds)) {
        this.audio.currentTime = Math.max(0, Math.min(timeSeconds, this.duration || 1000));
      }
    }

    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, val));
      this.audio.volume = this.volume;
      this.isMuted = this.volume === 0;
      this.updateVolumeUI();
    }

    toggleMute() {
      this.isMuted = !this.isMuted;
      this.audio.muted = this.isMuted;
      this.updateVolumeUI();
    }

    toggleShuffle() {
      this.isShuffle = !this.isShuffle;
      const btn = document.getElementById('music-bar-shuffle-btn');
      if (btn) btn.classList.toggle('active', this.isShuffle);
    }

    toggleRepeat() {
      if (this.repeatMode === 'off') this.repeatMode = 'all';
      else if (this.repeatMode === 'all') this.repeatMode = 'one';
      else this.repeatMode = 'off';

      const btn = document.getElementById('music-bar-repeat-btn');
      if (btn) {
        btn.classList.toggle('active', this.repeatMode !== 'off');
        btn.innerHTML = this.repeatMode === 'one' ? '<i class="fas fa-repeat-1"></i>' : '<i class="fas fa-repeat"></i>';
      }
    }

    toggleLike(trackId) {
      if (this.likedTracks.has(trackId)) {
        this.likedTracks.delete(trackId);
      } else {
        this.likedTracks.add(trackId);
      }
      localStorage.setItem('meem_liked_music', JSON.stringify([...this.likedTracks]));
      this.updateLikeUI();
    }

    async downloadTrack(track, forceDelete = false) {
      if (!track) return;
      const isAlreadyOffline = await OfflineStorage.isOffline(track.id);

      if (isAlreadyOffline && !forceDelete) {
        // Show confirm modal to delete from offline downloads
        const existing = document.getElementById('offline-delete-confirm-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'offline-delete-confirm-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(5,5,8,0.85);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
          <div style="background:rgba(255,255,255,0.04);backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.12);border-radius:28px;padding:36px;width:440px;max-width:90vw;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,0.8);">
            <div style="width:56px;height:56px;border-radius:18px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:24px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:18px;">
              <i class="fas fa-trash-alt"></i>
            </div>
            <h3 style="margin:0 0 10px 0;color:#fff;font-size:1.35rem;font-weight:800;">Remove Download?</h3>
            <p style="margin:0 0 24px 0;color:rgba(255,255,255,0.7);font-size:0.92rem;line-height:1.5;">Do you want to remove "<strong>${escapeHTML(track.title)}</strong>" from offline storage?</p>
            <div style="display:flex;gap:12px;justify-content:center;">
              <button id="modal-cancel-del" style="padding:12px 24px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:14px;color:#fff;font-weight:700;cursor:pointer;">Cancel</button>
              <button id="modal-confirm-del" style="padding:12px 26px;background:#ef4444;border:none;border-radius:14px;color:#fff;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(239,68,68,0.4);">Delete Download</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#modal-cancel-del').onclick = () => overlay.remove();
        overlay.querySelector('#modal-confirm-del').onclick = async () => {
          overlay.remove();
          await OfflineStorage.removeTrack(track.id);
          if (window.showToast) window.showToast('Removed "' + track.title + '" from offline downloads');
          this.updateDownloadUI();
          this.refreshCardDownloadState(track.id, false);
        };
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        return;
      }

      if (isAlreadyOffline && forceDelete) {
        await OfflineStorage.removeTrack(track.id);
        if (window.showToast) window.showToast('Removed "' + track.title + '" from offline downloads');
        this.updateDownloadUI();
        this.refreshCardDownloadState(track.id, false);
        return;
      }

      const dlBtn = document.getElementById('music-bar-download-btn');
      if (dlBtn && this.currentTrack?.id === track.id) {
        dlBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      }

      if (window.showToast) window.showToast('Downloading "' + track.title + '"...');

      try {
        if (window.api && window.api.downloadMusicTrack) {
          const res = await window.api.downloadMusicTrack(track);
          if (res && res.success) {
            try {
              const streamRes = await window.api.getMusicStreamUrl(track.id);
              if (streamRes && streamRes.streamUrl) {
                const audioBlob = await fetch(streamRes.streamUrl).then(r => r.blob());
                const lrcText = this.lyricsList.length ? this.lyricsList.map(l => '[' + formatTime(l.time) + '] ' + l.text).join('\n') : '';
                await OfflineStorage.saveTrack(track, audioBlob, lrcText);
              }
            } catch (e) {}

            if (window.showToast) window.showToast('Saved "' + track.title + '" to offline library!');
            this.refreshCardDownloadState(track.id, true);
          } else {
            throw new Error(res?.error || 'Download failed');
          }
        }
      } catch (err) {
        console.error('[MusicPlayer] Download error:', err);
        if (window.showToast) window.showToast('Download failed: ' + err.message);
      }

      this.updateDownloadUI();
    }

    async refreshCardDownloadState(trackId, isDownloaded) {
      const cardBtns = document.querySelectorAll(`.spotify-card-dl-btn[data-dl-id="${trackId}"]`);
      cardBtns.forEach(btn => {
        btn.classList.toggle('downloaded', isDownloaded);
        btn.innerHTML = isDownloaded ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-download"></i>';
        btn.title = isDownloaded ? 'Downloaded (Click to delete)' : 'Download for Offline';
      });
      const countEl = document.getElementById('music-offline-count');
      const offList = await OfflineStorage.getAllTracks();
      if (countEl) countEl.textContent = offList.length;
    }

    openAddToPlaylistModal(track) {
      if (!track) return;
      const currentProfile = window.currentProfile;
      if (!currentProfile) {
        if (window.showToast) window.showToast('Please select a profile first');
        return;
      }

      const existing = document.getElementById('music-add-playlist-modal');
      if (existing) existing.remove();

      currentProfile.custom_lists = currentProfile.custom_lists || [];
      const musicLists = currentProfile.custom_lists.filter(l => l.type === 'music');

      const overlay = document.createElement('div');
      overlay.id = 'music-add-playlist-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(5,5,8,0.85);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);display:flex;align-items:center;justify-content:center;';

      const renderListsHtml = () => {
        return musicLists.map(l => {
          const count = l.items?.length || 0;
          const containsThis = (l.items || []).some(t => t.id === track.id);
          return `
            <div class="playlist-choice-item ${containsThis ? 'already-added' : ''}" data-list-id="${l.id}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;cursor:pointer;transition:all 0.2s;margin-bottom:8px;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;">
                  <i class="fas fa-music"></i>
                </div>
                <div style="text-align:left;">
                  <div style="font-size:0.95rem;font-weight:700;color:#fff;">${escapeHTML(l.name)}</div>
                  <div style="font-size:0.75rem;color:rgba(255,255,255,0.6);">${count} ${count === 1 ? 'song' : 'songs'}</div>
                </div>
              </div>
              <button class="playlist-add-action-btn" style="padding:6px 14px;border-radius:8px;border:none;background:${containsThis ? '#10b981' : '#ffffff'};color:${containsThis ? '#ffffff' : '#000000'};font-weight:700;font-size:12px;cursor:pointer;">
                ${containsThis ? '<i class="fas fa-check"></i> Added' : '<i class="fas fa-plus"></i> Add'}
              </button>
            </div>
          `;
        }).join('');
      };

      const renderModalContent = () => `
        <div style="background:rgba(20,20,24,0.95);backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.12);border-radius:28px;padding:32px;width:460px;max-width:92vw;box-shadow:0 30px 80px rgba(0,0,0,0.85);display:flex;flex-direction:column;gap:18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;">
                <i class="fas fa-list-ul"></i>
              </div>
              <div>
                <h3 style="margin:0;font-size:1.25rem;font-weight:800;color:#fff;">Add to Playlist</h3>
                <p style="margin:2px 0 0 0;font-size:0.8rem;color:rgba(255,255,255,0.6);">${escapeHTML(track.title)}</p>
              </div>
            </div>
            <button id="close-add-pl-modal" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:18px;cursor:pointer;"><i class="fas fa-times"></i></button>
          </div>

          <div id="playlist-choices-container" style="max-height:260px;overflow-y:auto;padding-right:4px;">
            ${musicLists.length > 0 ? renderListsHtml() : `
              <div style="text-align:center;padding:30px 10px;color:rgba(255,255,255,0.5);">
                <i class="fas fa-folder-plus" style="font-size:32px;margin-bottom:10px;display:block;opacity:0.4;"></i>
                No music playlists yet. Create your first playlist below!
              </div>
            `}
          </div>

          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;display:flex;gap:10px;">
            <input id="quick-new-pl-input" type="text" placeholder="New Playlist Name..." style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;color:#fff;padding:10px 14px;font-size:13px;font-weight:600;outline:none;">
            <button id="quick-new-pl-btn" style="padding:10px 18px;background:#fff;color:#000;border:none;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;">
              <i class="fas fa-plus"></i> Create & Add
            </button>
          </div>
        </div>
      `;

      overlay.innerHTML = renderModalContent();
      document.body.appendChild(overlay);

      const bindActions = () => {
        overlay.querySelector('#close-add-pl-modal')?.addEventListener('click', () => overlay.remove());

        overlay.querySelectorAll('.playlist-choice-item[data-list-id]').forEach(item => {
          item.addEventListener('click', () => {
            const listId = item.dataset.listId;
            const targetList = currentProfile.custom_lists.find(l => l.id === listId);
            if (!targetList) return;
            targetList.items = targetList.items || [];
            const exists = targetList.items.some(t => t.id === track.id);
            if (exists) {
              targetList.items = targetList.items.filter(t => t.id !== track.id);
              if (window.showToast) window.showToast(`Removed "${track.title}" from ${targetList.name}`);
            } else {
              targetList.items.push({
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album || 'Single',
                thumbnail: track.thumbnail,
                duration: track.duration,
                durationFormatted: track.durationFormatted,
                added_at: new Date().toISOString(),
                added_by: {
                  id: currentProfile.id,
                  name: currentProfile.name,
                  avatar: currentProfile.avatar
                }
              });
              if (window.showToast) window.showToast(`Added "${track.title}" to ${targetList.name}`);
            }
            if (window.persist) window.persist(true);
            overlay.innerHTML = renderModalContent();
            bindActions();
          });
        });

        const quickInput = overlay.querySelector('#quick-new-pl-input');
        const quickBtn = overlay.querySelector('#quick-new-pl-btn');

        const createAndAdd = () => {
          const name = quickInput?.value?.trim();
          if (!name) return;
          if (typeof window.createNewCustomList === 'function') {
            window.createNewCustomList(name, track, 'music');
          } else {
            const nList = {
              id: 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
              name,
              type: 'music',
              profile_id: currentProfile.id,
              items: [{
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album || 'Single',
                thumbnail: track.thumbnail,
                duration: track.duration,
                durationFormatted: track.durationFormatted,
                added_at: new Date().toISOString(),
                added_by: {
                  id: currentProfile.id,
                  name: currentProfile.name,
                  avatar: currentProfile.avatar
                }
              }]
            };
            currentProfile.custom_lists.push(nList);
            if (window.persist) window.persist(true);
            if (window.showToast) window.showToast(`Created playlist "${name}" and added "${track.title}"`);
          }
          overlay.remove();
        };

        quickBtn?.addEventListener('click', createAndAdd);
        quickInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') createAndAdd(); });
      };

      bindActions();
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    setSleepTimer(minutes) {
      if (this.sleepTimerInterval) {
        clearInterval(this.sleepTimerInterval);
        this.sleepTimerInterval = null;
      }
      if (!minutes || minutes <= 0) {
        this.sleepTimerEnd = null;
        this.updateTimerBadge();
        if (window.showToast) window.showToast('Sleep timer cancelled');
        return;
      }

      this.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
      if (window.showToast) window.showToast('Sleep timer set for ' + minutes + ' minutes');

      this.sleepTimerInterval = setInterval(() => {
        const remainingMs = this.sleepTimerEnd - Date.now();
        if (remainingMs <= 0) {
          clearInterval(this.sleepTimerInterval);
          this.sleepTimerInterval = null;
          this.sleepTimerEnd = null;
          this.fadeOutAndPause();
        }
        this.updateTimerBadge();
      }, 1000);
      this.updateTimerBadge();
    }

    fadeOutAndPause() {
      let currentVol = this.audio.volume;
      const step = currentVol / 10;
      const fade = setInterval(() => {
        currentVol = Math.max(0, currentVol - step);
        this.audio.volume = currentVol;
        if (currentVol <= 0) {
          clearInterval(fade);
          this.audio.pause();
          this.audio.volume = this.volume;
          if (window.showToast) window.showToast('Sleep timer finished');
        }
      }, 300);
    }

    showBottomBar() {
      const bar = document.getElementById('global-music-player-bar');
      if (bar) bar.classList.remove('hidden-bar');
    }

    updateUI() {
      if (!this.currentTrack) return;
      const t = this.currentTrack;

      // Sticky Bottom Bar
      const barThumb = document.getElementById('music-bar-thumb-img');
      const barTitle = document.getElementById('music-bar-title');
      const barArtist = document.getElementById('music-bar-artist');
      const playBtn = document.getElementById('music-bar-play-circle');

      if (barThumb) barThumb.src = t.thumbnail;
      if (barTitle) {
        barTitle.textContent = t.title;
        barTitle.title = t.title;
      }
      if (barArtist) barArtist.textContent = t.artist;
      if (playBtn) {
        playBtn.innerHTML = this.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play" style="margin-left:2px;"></i>';
      }

      // Fullscreen Player Backdrop & Cover
      const fsBackdrop = document.getElementById('fs-music-backdrop');
      const fsCover = document.getElementById('fs-large-cover-img');
      const fsTitle = document.getElementById('fs-track-title');
      const fsArtist = document.getElementById('fs-track-artist');
      const fsPlayBtn = document.getElementById('fs-play-btn');

      if (fsBackdrop) fsBackdrop.style.backgroundImage = 'url("' + t.thumbnail + '")';
      if (fsCover) fsCover.src = t.thumbnail;
      if (fsTitle) fsTitle.textContent = t.title;
      if (fsArtist) fsArtist.textContent = t.artist;
      if (fsPlayBtn) {
        fsPlayBtn.innerHTML = this.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play" style="margin-left:2px;"></i>';
      }

      // Fullscreen Lyrics Split Sidebar
      const fsLyricsCover = document.getElementById('fs-lyrics-cover-img');
      const fsLyricsTitle = document.getElementById('fs-lyrics-title');
      const fsLyricsArtist = document.getElementById('fs-lyrics-artist');
      if (fsLyricsCover) fsLyricsCover.src = t.thumbnail;
      if (fsLyricsTitle) fsLyricsTitle.textContent = t.title;
      if (fsLyricsArtist) fsLyricsArtist.textContent = t.artist;

      // Fullscreen Mini Bottom Bar Meta
      const fsMiniThumb = document.getElementById('fs-bar-mini-thumb-img');
      const fsMiniTitle = document.getElementById('fs-bar-mini-title');
      const fsMiniArtist = document.getElementById('fs-bar-mini-artist');
      if (fsMiniThumb) fsMiniThumb.src = t.thumbnail;
      if (fsMiniTitle) fsMiniTitle.textContent = t.title;
      if (fsMiniArtist) fsMiniArtist.textContent = t.artist;

      this.updateLikeUI();
      this.updateDownloadUI();
      this.updateVolumeUI();
    }

    updateProgressUI() {
      const curStr = formatTime(this.currentTime);
      const durStr = formatTime(this.duration);
      const pct = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;

      const curEl = document.getElementById('music-bar-current-time');
      const durEl = document.getElementById('music-bar-duration');
      const fillEl = document.getElementById('music-bar-progress-fill');
      if (curEl) curEl.textContent = curStr;
      if (durEl) durEl.textContent = durStr;
      if (fillEl) fillEl.style.width = pct + '%';

      const fsCurEl = document.getElementById('fs-current-time');
      const fsDurEl = document.getElementById('fs-duration');
      const fsFillEl = document.getElementById('fs-progress-fill');
      if (fsCurEl) fsCurEl.textContent = curStr;
      if (fsDurEl) fsDurEl.textContent = durStr;
      if (fsFillEl) fsFillEl.style.width = pct + '%';
    }

    syncLyricsPosition() {
      if (this.quranData || !this.lyricsList || this.lyricsList.length === 0) return;
      const t = this.currentTime;
      let activeIdx = -1;

      for (let i = 0; i < this.lyricsList.length; i++) {
        if (t >= this.lyricsList[i].time) {
          activeIdx = i;
        } else {
          break;
        }
      }

      if (activeIdx !== this.activeLyricIndex) {
        this.activeLyricIndex = activeIdx;
        const container = document.getElementById('fs-lyrics-container');
        if (!container) return;

        const lines = container.querySelectorAll('.lyric-line');
        lines.forEach((line, idx) => {
          line.classList.toggle('active', idx === activeIdx);
          line.classList.toggle('passed', idx < activeIdx);
        });

        if (activeIdx !== -1 && lines[activeIdx]) {
          lines[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    async setTranslationLanguage(lang) {
      this.activeTranslationLang = lang || 'off';
      try { localStorage.setItem('meem_lyrics_lang', this.activeTranslationLang); } catch (e) {}

      const langNames = {
        'off': 'Original',
        'ar': 'العربية',
        'en': 'English',
        'fr': 'Français',
        'es': 'Español',
        'de': 'Deutsch',
        'tr': 'Türkçe',
        'ru': 'Русский',
        'ja': '日本語',
        'ko': '한국어',
        'it': 'Italiano'
      };

      const textEl = document.getElementById('fs-current-lang-text');
      if (textEl) {
        textEl.textContent = langNames[this.activeTranslationLang] || 'العربية';
      }

      document.querySelectorAll('.fs-lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === this.activeTranslationLang);
      });

      if (this.activeTranslationLang === 'off' || !this.lyricsList || this.lyricsList.length === 0) {
        this.renderLyricsUI();
        return;
      }

      const trackKey = `${this.currentTrack?.id || this.currentTrack?.title || 'track'}_${this.activeTranslationLang}`;
      if (this.translationCache.has(trackKey)) {
        const cached = this.translationCache.get(trackKey);
        this.lyricsList.forEach((line, idx) => {
          line.translatedText = cached[idx] || '';
        });
        this.renderLyricsUI();
        return;
      }

      if (window.showToast) window.showToast('Translating lyrics...');
      try {
        const textBlock = this.lyricsList.map(l => l.text).join('\n');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${this.activeTranslationLang}&dt=t&q=${encodeURIComponent(textBlock)}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json[0])) {
            const fullTranslated = json[0].map(x => x[0]).join('');
            const transLines = fullTranslated.split('\n');
            this.translationCache.set(trackKey, transLines);
            this.lyricsList.forEach((line, idx) => {
              line.translatedText = (transLines[idx] || '').trim();
            });
          }
        }
      } catch (err) {
        console.error('[MusicLyrics] Translation failed:', err);
      }
      this.renderLyricsUI();
    }

    renderLyricsUI() {
      const container = document.getElementById('fs-lyrics-container');
      if (!container) return;

      // 1. Quran Reader Mode (Uthmani Typography)
      if (this.quranData && this.quranData.isQuran) {
        if (this.quranData.ayahs && this.quranData.ayahs.length > 0) {
          const ayahsHtml = this.quranData.ayahs.map(a => {
            let text = a.text;
            if (this.quranData.surahNumber !== 1 && a.numberInSurah === 1) {
              text = text.replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, '').replace(/^بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\s*/, '');
            }
            return `<span class="quran-ayah-text">${escapeHTML(text)} <span class="quran-ayah-badge">﴿${toArabicDigits(a.numberInSurah)}﴾</span></span>`;
          }).join(' ');

          container.innerHTML = `
            <div class="quran-reader-wrapper">
              <div class="quran-surah-header">
                <div class="quran-surah-badge">سورة ${escapeHTML(this.quranData.surahNameAr || '')} — ${escapeHTML(this.quranData.surahNameEn || '')}</div>
                ${this.quranData.surahNumber !== 9 ? '<div class="quran-bismillah">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>' : ''}
              </div>
              <div class="quran-surah-body">
                ${ayahsHtml}
              </div>
            </div>
          `;
          return;
        }

        // Generic Quran Recitation View
        container.innerHTML = `
          <div class="quran-reader-wrapper" style="text-align: center;">
            <div class="quran-surah-header">
              <div class="quran-surah-badge" style="font-size: 1.35rem;">${escapeHTML(this.quranData.surahNameAr || 'القرآن الكريم')}</div>
              <div class="quran-bismillah" style="margin-top: 14px;">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>
              <div style="font-size: 1.05rem; color: rgba(255, 255, 255, 0.75); margin-top: 18px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.8;">
                تلاوة مباركة خاشعة من القرآن الكريم. استمع بخشوع وتدبر لآيات الذكر الحكيم.
              </div>
            </div>
          </div>
        `;
        return;
      }

      // 2. Empty State (No Lyrics)
      if (!this.lyricsList || this.lyricsList.length === 0) {
        const title = this.currentTrack?.title || 'This Track';
        container.innerHTML = `
          <div class="no-lyrics-state">
            <i class="fas fa-compact-disc fa-spin" style="animation-duration: 8s; font-size: 3.5rem; color: rgba(255, 255, 255, 0.4);"></i>
            <div style="font-size: 1.35rem; font-weight: 800; color: #fff; margin-top: 8px;">No Lyrics Available</div>
            <div style="font-size: 0.95rem; color: rgba(255, 255, 255, 0.7); max-width: 400px; line-height: 1.5;">
              Lyrics for "${escapeHTML(title)}" were not found in the community database. Enjoy the pure high-fidelity audio stream!
            </div>
            <button id="btn-retry-lyrics" class="music-hero-sec-btn" style="margin-top: 12px; padding: 10px 20px;">
              <i class="fas fa-rotate-right"></i> Retry Lyrics
            </button>
          </div>
        `;
        document.getElementById('btn-retry-lyrics')?.addEventListener('click', async () => {
          if (this.currentTrack && window.api?.getMusicLyrics) {
            if (window.showToast) window.showToast('Searching lyrics for ' + this.currentTrack.title + '...');
            try {
              const res = await window.api.getMusicLyrics(this.currentTrack.title, this.currentTrack.artist, this.currentTrack.duration, this.currentTrack.id);
              if (res && res.success) {
                if (res.isQuran) {
                  this.quranData = res;
                  this.lyricsList = [];
                } else if (res.syncedLyrics || res.plainLyrics) {
                  this.quranData = null;
                  this.lyricsList = parseLRC(res.syncedLyrics || res.plainLyrics);
                  if (this.activeTranslationLang && this.activeTranslationLang !== 'off') {
                    this.setTranslationLanguage(this.activeTranslationLang);
                    return;
                  }
                }
                this.renderLyricsUI();
                if (window.showToast) window.showToast('Loaded successfully');
              } else {
                if (window.showToast) window.showToast('Lyrics not available for this track.');
              }
            } catch (e) {}
          }
        });
        return;
      }

      // 3. Synced Karaoke Lines (with optional bilingual translation)
      const isTranslated = this.activeTranslationLang && this.activeTranslationLang !== 'off';
      const isRtl = this.activeTranslationLang === 'ar';

      container.innerHTML = this.lyricsList.map((item, idx) => {
        const origText = `<div class="lyric-line-original">${escapeHTML(item.text)}</div>`;
        const transText = (isTranslated && item.translatedText)
          ? `<div class="lyric-line-translated ${isRtl ? 'rtl-text' : ''}">${escapeHTML(item.translatedText)}</div>`
          : '';
        return `<div class="lyric-line" data-index="${idx}" data-time="${item.time}">${origText}${transText}</div>`;
      }).join('');

      container.querySelectorAll('.lyric-line').forEach(line => {
        line.addEventListener('click', () => {
          const time = parseFloat(line.dataset.time);
          if (!isNaN(time)) this.seek(time);
        });
      });

      this.syncLyricsPosition();
    }

    updateLikeUI() {
      if (!this.currentTrack) return;
      const currentProfile = window.currentProfile;
      const musicLists = (currentProfile?.custom_lists || []).filter(l => l.type === 'music');
      const isInPlaylist = musicLists.some(l => (l.items || []).some(t => t.id === this.currentTrack.id));
      ['music-bar-heart-btn', 'fs-bar-heart-btn', 'fs-lyrics-heart-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.classList.toggle('active', isInPlaylist);
          btn.innerHTML = isInPlaylist ? '<i class="fas fa-check" style="color:#ffffff;"></i>' : '<i class="fas fa-plus"></i>';
          btn.title = isInPlaylist ? 'In Playlist (Click to manage)' : 'Add to Playlist';
        }
      });
    }

    async updateDownloadUI() {
      if (!this.currentTrack) return;
      const isDl = await OfflineStorage.isOffline(this.currentTrack.id);
      const dlBtn = document.getElementById('music-bar-download-btn');
      if (dlBtn) {
        dlBtn.classList.toggle('active', isDl);
        dlBtn.innerHTML = isDl ? '<i class="fas fa-check-circle" style="color:#10b981;"></i>' : '<i class="fas fa-download"></i>';
        dlBtn.title = isDl ? 'Downloaded (Click to delete)' : 'Download for Offline Playback';
      }
    }

    updateVolumeUI() {
      const volVal = this.isMuted ? 0 : this.volume * 100;
      const iconClass = (this.isMuted || this.volume === 0)
        ? 'fas fa-volume-xmark'
        : (this.volume < 0.5 ? 'fas fa-volume-low' : 'fas fa-volume-high');

      ['music-bar-vol-slider', 'fs-vol-slider'].forEach(id => {
        const s = document.getElementById(id);
        if (s) s.value = volVal;
      });

      ['music-bar-vol-icon', 'fs-vol-icon'].forEach(id => {
        const ic = document.getElementById(id);
        if (ic) ic.className = iconClass;
      });
    }

    updateTimerBadge() {
      const badge = document.getElementById('music-timer-badge');
      if (!badge) return;
      if (!this.sleepTimerEnd) {
        badge.style.display = 'none';
        return;
      }
      const remainingSecs = Math.max(0, Math.round((this.sleepTimerEnd - Date.now()) / 1000));
      const mins = Math.floor(remainingSecs / 60);
      badge.textContent = mins + 'm';
      badge.style.display = 'block';
    }
  }

  const toArabicDigits = (num) => {
    const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    return String(num).replace(/[0-9]/g, d => arabicDigits[d]);
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const Player = new SpotifyPlayerEngine();
  window.MeemAudioPlayer = Player;
  window.SpotifyAudioPlayer = Player;

  // ══════════════════════════════════════════════════════════════════════════
  //  5. DISCOVER MUSIC PAGE RENDERER (LIVE REAL SEARCH & TRENDING)
  // ══════════════════════════════════════════════════════════════════════════
  let activeFilter = 'all';
  let searchDebounceTimer = null;
  let currentLoadedTracks = [];

  const loadCategoryTracks = async (category) => {
    if (category === 'offline') {
      return OfflineStorage.getAllTracks();
    }

    if (Player.categoryCache.has(category)) {
      return Player.categoryCache.get(category);
    }

    if (window.api && window.api.getTrendingMusic) {
      try {
        const res = await window.api.getTrendingMusic(category);
        if (res && res.success && Array.isArray(res.results)) {
          Player.categoryCache.set(category, res.results);
          return res.results;
        }
      } catch (e) {}
    }
    return [];
  };

  const ensureMusicPageShell = () => {
    const view = document.getElementById('view-music');
    if (!view) return null;

    let shell = view.querySelector('.music-page-inner');
    if (!shell) {
      view.innerHTML = `
        <div class="music-page-inner">
          <!-- Static Top Nav & Search Bar -->
          <div class="music-top-bar">
            <div class="music-search-container">
              <i class="fas fa-search music-search-icon"></i>
              <input type="text" id="music-search-main-input" class="music-search-input" placeholder="Search songs, reciters, albums..." autocomplete="off">
              <button id="music-search-clear-btn" class="music-search-clear-btn" style="display:none;" title="Clear Search">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="music-actions-group">
              <button class="music-pill-btn" id="btn-toggle-offline-tab" title="View Offline Downloaded Audio">
                <i class="fas fa-arrow-down-to-bracket"></i> Offline (<span id="music-offline-count">0</span>)
              </button>
            </div>
          </div>

          <!-- Dynamic Feed Content -->
          <div id="music-feed-content" class="music-feed-content">
            <div class="music-loading-state" style="text-align: center; padding: 100px 0; color: rgba(255,255,255,0.4);">
              <i class="fas fa-spinner fa-spin" style="font-size: 28px; margin-bottom: 12px;"></i>
              <div>Loading audio...</div>
            </div>
          </div>
        </div>
      `;

      // Attach search input listeners once
      const searchInput = document.getElementById('music-search-main-input');
      const clearBtn = document.getElementById('music-search-clear-btn');

      searchInput?.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          renderDiscoverFeed();
        }, 350);
      });

      searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          renderDiscoverFeed();
        }
      });

      clearBtn?.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        if (clearBtn) clearBtn.style.display = 'none';
        renderDiscoverFeed();
      });

      document.getElementById('btn-toggle-offline-tab')?.addEventListener('click', () => {
        activeFilter = activeFilter === 'offline' ? 'all' : 'offline';
        renderDiscoverFeed();
      });
    }

    return view;
  };

  const renderDiscoverFeed = async () => {
    const feedContainer = document.getElementById('music-feed-content');
    if (!feedContainer) return;

    let offlineTracks = await OfflineStorage.getAllTracks();
    const offlineCountEl = document.getElementById('music-offline-count');
    if (offlineCountEl) offlineCountEl.textContent = offlineTracks.length;

    const offlineBtn = document.getElementById('btn-toggle-offline-tab');
    if (offlineBtn) offlineBtn.classList.toggle('active', activeFilter === 'offline');

    const searchInput = document.getElementById('music-search-main-input');
    const query = (searchInput?.value || '').trim();

    let tracks = [];
    if (query) {
      if (window.api && window.api.searchMusic) {
        try {
          const sRes = await window.api.searchMusic(query);
          if (sRes && sRes.success && Array.isArray(sRes.results)) {
            tracks = sRes.results;
          }
        } catch (e) {}
      }
    } else {
      tracks = await loadCategoryTracks(activeFilter);
    }

    currentLoadedTracks = tracks;
    const heroTrack = tracks[0] || null;

    feedContainer.innerHTML = `
      <!-- Category Filter Chips -->
      <div class="music-filter-row">
        <button class="music-filter-chip ${activeFilter === 'all' ? 'active' : ''}" data-cat="all">All</button>
        <button class="music-filter-chip ${activeFilter === 'nasheed' ? 'active' : ''}" data-cat="nasheed">Nasheed</button>
        <button class="music-filter-chip ${activeFilter === 'quran' ? 'active' : ''}" data-cat="quran">Quran</button>
        <button class="music-filter-chip ${activeFilter === 'adkar' ? 'active' : ''}" data-cat="adkar">Adkar & Dua</button>
        <button class="music-filter-chip ${activeFilter === 'ruqyah' ? 'active' : ''}" data-cat="ruqyah">Ruqyah</button>
        <button class="music-filter-chip ${activeFilter === 'prophet' ? 'active' : ''}" data-cat="prophet">Prophet Praises</button>
        <button class="music-filter-chip ${activeFilter === 'calm' ? 'active' : ''}" data-cat="calm">Calm & Sleep</button>
      </div>

      ${!query && activeFilter === 'all' && heroTrack ? `
      <!-- Hero Spotlight Banner -->
      <div class="music-hero-banner">
        <img src="${heroTrack.thumbnail}" class="music-hero-backdrop-img">
        <div class="music-hero-content">
          <div class="music-hero-badge"><i class="fas fa-sparkles"></i> Spotlight</div>
          <h1 class="music-hero-title">${escapeHTML(heroTrack.title)}</h1>
          <p class="music-hero-desc">${escapeHTML(heroTrack.artist)} • Stream in high fidelity with real-time lyrics.</p>
          <div class="music-hero-actions">
            <button class="music-hero-play-btn" id="hero-play-btn">
              <i class="fas fa-play"></i> Play Now
            </button>
          </div>
        </div>
        <div class="music-hero-artwork">
          <img src="${heroTrack.thumbnail}">
        </div>
      </div>
      ` : ''}

      <!-- 1. Track Results / Carousel -->
      <div class="music-section">
        <div class="music-section-header">
          <div class="music-section-title-wrap">
            <h3>${query ? ('Search Results for "' + escapeHTML(query) + '"') : (activeFilter === 'offline' ? 'Offline Downloads' : 'Featured Audio')}</h3>
            <div class="music-section-subtitle">${tracks.length} tracks</div>
          </div>
          ${!query ? `
          <div class="music-carousel-nav">
            <button class="music-carousel-arrow" onclick="document.getElementById('trending-track-row').scrollBy({left: -360, behavior: 'smooth'})"><i class="fas fa-chevron-left"></i></button>
            <button class="music-carousel-arrow" onclick="document.getElementById('trending-track-row').scrollBy({left: 360, behavior: 'smooth'})"><i class="fas fa-chevron-right"></i></button>
          </div>` : ''}
        </div>

        <div class="${query || activeFilter === 'offline' ? 'spotify-grid' : 'music-carousel-track'}" id="trending-track-row">
          ${tracks.map(track => {
            const isOffline = offlineTracks.some(o => o.id === track.id);
            return `
            <div class="spotify-card" data-id="${track.id}" title="${escapeHTML(track.title)}">
              <div class="spotify-card-cover-wrap">
                <img src="${track.thumbnail}" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80'">
                <span class="spotify-card-badge">${track.durationFormatted || ''}</span>
                <button class="spotify-card-queue-btn" data-queue-id="${track.id}" title="Add to Queue">
                  <i class="fas fa-list-ul"></i>
                </button>
                <button class="spotify-card-add-btn" data-add-id="${track.id}" title="Add to Playlist">
                  <i class="fas fa-plus"></i>
                </button>
                <button class="spotify-card-dl-btn ${isOffline ? 'downloaded' : ''}" data-dl-id="${track.id}" title="${isOffline ? 'Downloaded (Click to delete)' : 'Download for Offline'}">
                  <i class="${isOffline ? 'fas fa-check-circle' : 'fas fa-download'}"></i>
                </button>
                <button class="spotify-card-play-btn" title="Play"><i class="fas fa-play"></i></button>
              </div>
              <div class="spotify-card-title">${escapeHTML(track.title)}</div>
              <div class="spotify-card-artist">${escapeHTML(track.artist)}</div>
            </div>
          `}).join('')}

          ${tracks.length === 0 ? `
            <div style="text-align: center; padding: 60px 20px; color: var(--meem-music-subtext); width: 100%; grid-column: 1/-1;">
              <i class="fas fa-music" style="font-size: 38px; opacity: 0.3; margin-bottom: 12px; color: #ffffff;"></i>
              <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">No audio found</div>
              <div style="font-size: 0.85rem; margin-top: 4px;">Try searching for another recitation, surah, or artist.</div>
            </div>
          ` : ''}
        </div>
      </div>

      ${!query && activeFilter === 'all' ? `
      <!-- 2. Curated Playlists Carousel -->
      <div class="music-section">
        <div class="music-section-header">
          <div class="music-section-title-wrap">
            <h3>Curated Playlists</h3>
            <div class="music-section-subtitle">Handpicked spiritual collections</div>
          </div>
          <div class="music-carousel-nav">
            <button class="music-carousel-arrow" onclick="document.getElementById('playlists-track-row').scrollBy({left: -360, behavior: 'smooth'})"><i class="fas fa-chevron-left"></i></button>
            <button class="music-carousel-arrow" onclick="document.getElementById('playlists-track-row').scrollBy({left: 360, behavior: 'smooth'})"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>

        <div class="music-carousel-track" id="playlists-track-row">
          ${CURATED_PLAYLISTS.map(pl => `
            <div class="spotify-card" style="flex: 0 0 200px; width: 200px;" data-pl-genre="${pl.genreQuery}">
              <div class="spotify-card-cover-wrap">
                <img src="${pl.cover}">
                <button class="spotify-card-play-btn" title="Open Playlist"><i class="fas fa-play"></i></button>
              </div>
              <div class="spotify-card-title">${escapeHTML(pl.title)}</div>
              <div class="spotify-card-artist" style="white-space: normal; line-height: 1.3; font-size: 0.74rem;">${escapeHTML(pl.description)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 3. Popular Artists Circles -->
      <div class="music-section">
        <div class="music-section-header">
          <div class="music-section-title-wrap">
            <h3>Featured Reciters & Artists</h3>
            <div class="music-section-subtitle">Top spiritual voices this week</div>
          </div>
        </div>

        <div class="music-carousel-track">
          ${POPULAR_ARTISTS.map(art => `
            <div class="spotify-card spotify-artist-card" style="flex: 0 0 160px; width: 160px;" data-art-query="${art.query}">
              <div class="spotify-card-cover-wrap">
                <img src="${art.cover}">
                <button class="spotify-card-play-btn" title="Play"><i class="fas fa-play"></i></button>
              </div>
              <div class="spotify-card-title">${escapeHTML(art.name)}</div>
              <div class="spotify-card-artist">${escapeHTML(art.followers)} streams</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;

    // Re-bind dynamic events in feed
    feedContainer.querySelectorAll('.music-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.cat;
        renderDiscoverFeed();
      });
    });

    document.getElementById('hero-play-btn')?.addEventListener('click', () => {
      if (heroTrack && heroTrack.id !== 'hero-default') {
        Player.playTrack(heroTrack, currentLoadedTracks);
      }
    });

    // Direct Card Download Button
    feedContainer.querySelectorAll('.spotify-card-dl-btn[data-dl-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.dlId;
        const target = currentLoadedTracks.find(t => t.id === id);
        if (target) {
          await Player.downloadTrack(target);
        }
      });
    });

    // Direct Card Add to Queue Button
    feedContainer.querySelectorAll('.spotify-card-queue-btn[data-queue-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.queueId;
        const target = currentLoadedTracks.find(t => t.id === id);
        if (target) {
          Player.addToQueue(target);
        }
      });
    });

    // Direct Card Add to Playlist Button
    feedContainer.querySelectorAll('.spotify-card-add-btn[data-add-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.addId;
        const target = currentLoadedTracks.find(t => t.id === id);
        if (target) {
          Player.openAddToPlaylistModal(target);
        }
      });
    });

    // Card Click Listeners
    feedContainer.querySelectorAll('.spotify-card[data-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const target = currentLoadedTracks.find(t => t.id === id);
        if (target) Player.playTrack(target, currentLoadedTracks);
      });
    });

    feedContainer.querySelectorAll('.spotify-card[data-pl-genre]').forEach(card => {
      card.addEventListener('click', async () => {
        const genre = card.dataset.plGenre;
        activeFilter = genre;
        await renderDiscoverFeed();
        if (currentLoadedTracks.length > 0) {
          Player.playTrack(currentLoadedTracks[0], currentLoadedTracks);
        }
      });
    });

    feedContainer.querySelectorAll('.spotify-card[data-art-query]').forEach(card => {
      card.addEventListener('click', async () => {
        const q = card.dataset.artQuery;
        const input = document.getElementById('music-search-main-input');
        if (input) input.value = q;
        const clearBtn = document.getElementById('music-search-clear-btn');
        if (clearBtn) clearBtn.style.display = 'flex';
        await renderDiscoverFeed();
      });
    });
  };

  const renderDiscoverMusic = async () => {
    ensureMusicPageShell();
    await renderDiscoverFeed();
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  6. FULLSCREEN MODAL & LYRICS CONTROLLER
  // ══════════════════════════════════════════════════════════════════════════
  const openFullscreenModal = (defaultTab = 'artwork') => {
    const modal = document.getElementById('fullscreen-music-modal');
    if (!modal) return;
    modal.classList.add('open');
    switchFullscreenTab(defaultTab);
    if (Player.visualizer) {
      Player.visualizer.init();
      Player.visualizer.resize();
    }
    Player.setTranslationLanguage(Player.activeTranslationLang || 'ar');
  };

  const closeFullscreenModal = () => {
    const modal = document.getElementById('fullscreen-music-modal');
    if (modal) modal.classList.remove('open');
    const dd = document.getElementById('fs-translate-dropdown');
    if (dd) dd.style.display = 'none';
    document.getElementById('fs-translate-trigger-btn')?.classList.remove('active');
  };

  const switchFullscreenTab = (tab) => {
    const artView = document.getElementById('fs-artwork-view');
    const lyricsView = document.getElementById('fs-lyrics-view');
    const queueView = document.getElementById('fs-queue-view');
    const tabArt = document.getElementById('fs-tab-artwork');
    const tabLyrics = document.getElementById('fs-tab-lyrics');
    const tabQueue = document.getElementById('fs-tab-queue');

    [artView, lyricsView, queueView].forEach(v => { if (v) v.style.display = 'none'; });
    [tabArt, tabLyrics, tabQueue].forEach(t => { if (t) t.classList.remove('active'); });

    if (tab === 'lyrics') {
      if (lyricsView) lyricsView.style.display = 'flex';
      if (tabLyrics) tabLyrics.classList.add('active');
      if (Player.activeTranslationLang && Player.activeTranslationLang !== 'off') {
        Player.setTranslationLanguage(Player.activeTranslationLang);
      } else {
        Player.renderLyricsUI();
      }
    } else if (tab === 'queue') {
      if (queueView) queueView.style.display = 'flex';
      if (tabQueue) tabQueue.classList.add('active');
      Player.renderQueueUI();
    } else {
      if (artView) artView.style.display = 'flex';
      if (tabArt) tabArt.classList.add('active');
      if (Player.visualizer) {
        Player.visualizer.resize();
      }
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  7. SLEEP TIMER MODAL CONTROLLER
  // ══════════════════════════════════════════════════════════════════════════
  const openSleepTimerModal = () => {
    const modal = document.getElementById('music-sleep-timer-modal');
    if (modal) modal.classList.add('open');
  };

  const closeSleepTimerModal = () => {
    const modal = document.getElementById('music-sleep-timer-modal');
    if (modal) modal.classList.remove('open');
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  8. INITIALIZATION & GLOBAL BINDINGS
  // ══════════════════════════════════════════════════════════════════════════
  const initBottomBarListeners = () => {
    document.getElementById('music-bar-play-circle')?.addEventListener('click', () => Player.togglePlay());
    document.getElementById('music-bar-next-btn')?.addEventListener('click', () => Player.next());
    document.getElementById('music-bar-prev-btn')?.addEventListener('click', () => Player.prev());
    document.getElementById('music-bar-shuffle-btn')?.addEventListener('click', () => Player.toggleShuffle());
    document.getElementById('music-bar-repeat-btn')?.addEventListener('click', () => Player.toggleRepeat());
    document.getElementById('music-bar-heart-btn')?.addEventListener('click', () => {
      if (Player.currentTrack) Player.openAddToPlaylistModal(Player.currentTrack);
    });
    document.getElementById('music-bar-download-btn')?.addEventListener('click', () => {
      if (Player.currentTrack) Player.downloadTrack(Player.currentTrack);
    });
    document.getElementById('music-bar-lyrics-btn')?.addEventListener('click', () => openFullscreenModal('lyrics'));
    document.getElementById('music-bar-queue-btn')?.addEventListener('click', () => openFullscreenModal('queue'));
    document.getElementById('music-bar-timer-btn')?.addEventListener('click', () => openSleepTimerModal());
    document.getElementById('music-bar-fullscreen-btn')?.addEventListener('click', () => openFullscreenModal('artwork'));
    document.getElementById('music-bar-title')?.addEventListener('click', () => openFullscreenModal('artwork'));

    const volSlider = document.getElementById('music-bar-vol-slider');
    volSlider?.addEventListener('input', (e) => {
      Player.setVolume(parseFloat(e.target.value) / 100);
    });

    document.getElementById('music-bar-vol-icon')?.parentElement?.addEventListener('click', () => {
      Player.toggleMute();
    });

    const progressContainer = document.getElementById('music-bar-progress-container');
    progressContainer?.addEventListener('click', (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      Player.seek(pct * Player.duration);
    });

    document.getElementById('fs-close-btn')?.addEventListener('click', closeFullscreenModal);
    document.getElementById('fs-tab-artwork')?.addEventListener('click', () => switchFullscreenTab('artwork'));
    document.getElementById('fs-tab-lyrics')?.addEventListener('click', () => switchFullscreenTab('lyrics'));
    document.getElementById('fs-tab-queue')?.addEventListener('click', () => switchFullscreenTab('queue'));
    document.getElementById('btn-clear-queue')?.addEventListener('click', () => Player.clearQueue());

    document.getElementById('fs-play-btn')?.addEventListener('click', () => Player.togglePlay());
    document.getElementById('fs-next-btn')?.addEventListener('click', () => Player.next());
    document.getElementById('fs-prev-btn')?.addEventListener('click', () => Player.prev());
    document.getElementById('fs-shuffle-btn')?.addEventListener('click', () => Player.toggleShuffle());
    document.getElementById('fs-repeat-btn')?.addEventListener('click', () => Player.toggleRepeat());
    document.getElementById('fs-bar-heart-btn')?.addEventListener('click', () => {
      if (Player.currentTrack) Player.openAddToPlaylistModal(Player.currentTrack);
    });
    document.getElementById('fs-lyrics-heart-btn')?.addEventListener('click', () => {
      if (Player.currentTrack) Player.openAddToPlaylistModal(Player.currentTrack);
    });
    document.getElementById('fs-tool-lyrics-btn')?.addEventListener('click', () => {
      const isLyrics = document.getElementById('fs-tab-lyrics')?.classList.contains('active');
      switchFullscreenTab(isLyrics ? 'artwork' : 'lyrics');
    });
    document.getElementById('fs-tool-queue-btn')?.addEventListener('click', () => {
      const isQueue = document.getElementById('fs-tab-queue')?.classList.contains('active');
      switchFullscreenTab(isQueue ? 'artwork' : 'queue');
    });
    document.getElementById('fs-tool-timer-btn')?.addEventListener('click', () => openSleepTimerModal());
    document.getElementById('fs-tool-dl-btn')?.addEventListener('click', () => {
      if (Player.currentTrack) Player.downloadTrack(Player.currentTrack);
    });

    // Custom Lyrics Translation Dropdown Menu
    const transTrigger = document.getElementById('fs-translate-trigger-btn');
    const transDropdown = document.getElementById('fs-translate-dropdown');

    transTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = transDropdown && transDropdown.style.display !== 'none';
      if (transDropdown) {
        transDropdown.style.display = isVisible ? 'none' : 'flex';
      }
      transTrigger.classList.toggle('active', !isVisible);
    });

    document.querySelectorAll('.fs-lang-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = opt.dataset.lang;
        if (lang) {
          Player.setTranslationLanguage(lang);
        }
        if (transDropdown) transDropdown.style.display = 'none';
        transTrigger?.classList.remove('active');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#fs-translate-menu-wrap')) {
        if (transDropdown) transDropdown.style.display = 'none';
        transTrigger?.classList.remove('active');
      }
    });

    const fsVolSlider = document.getElementById('fs-vol-slider');
    fsVolSlider?.addEventListener('input', (e) => {
      Player.setVolume(parseFloat(e.target.value) / 100);
    });
    document.getElementById('fs-vol-icon-btn')?.addEventListener('click', () => {
      Player.toggleMute();
    });

    const fsProgress = document.getElementById('fs-progress-container');
    fsProgress?.addEventListener('click', (e) => {
      const rect = fsProgress.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      Player.seek(pct * Player.duration);
    });

    document.getElementById('timer-close-btn')?.addEventListener('click', closeSleepTimerModal);
    document.querySelectorAll('.timer-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.mins, 10);
        Player.setSleepTimer(mins);
        closeSleepTimerModal();
      });
    });
  };

  window.initMeemMusicView = () => { renderDiscoverMusic(); };
  window.initSpotifyMusicView = () => {
    renderDiscoverMusic();
  };

  window.openMeemMusicFullscreen = (mode) => { openFullscreenModal(mode); };
  window.openSpotifyMusicFullscreen = (mode) => {
    openFullscreenModal(mode);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initBottomBarListeners();
    });
  } else {
    initBottomBarListeners();
  }

})();
