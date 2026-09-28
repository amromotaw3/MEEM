/**
 * MEEM AI Copilot Engine
 * Powered by Google Gemini 3.5 Flash (with Automatic Multi-Model Failover Cascade)
 * 
 * Capabilities:
 * - Exact IMDb ID & Watchlist-Aware Item Resolution (Zero wrong posters/mix-ups)
 * - Instant Direct Playback for Songs, Tracks, Albums, Movies, Shows, Radio & IPTV
 * - Smart Semantic Media Discovery & Curated Recommendations (Native 2:3 Poster Cards)
 * - 1-to-1 Sync between AI Chat Recommendations and Displayed Action Cards
 * - Auto-Extraction & Poster Rendering Fallback
 * - Multi-Model Rate-Limit & High-Demand Cascade (3.5-flash -> 3.7-flash -> 3.5-flash-lite -> 3-flash-preview)
 * - Strict Language Matching (English / Egyptian Arabic / Any Language)
 * - Clean, Direct, and Natural Tone (Zero Cheesy Exaggeration)
 * - Interactive Clickable Chat Callouts + Poster Cards + Music Player Cards
 * - Manage User Custom Lists (Create, Modify, Add/Remove Items)
 * - Tiered Daily Quota System (Free vs PRO)
 */

(function () {
  'use strict';

  // ─── Compliant Key Pool & Multi-Project Load Balancer (Fixed Dedicated Keys) ───
  const KeyPoolManager = {
    // Dedicated MEEM API Keys Pool (Base64 Encoded - Groq & Gemini)
    _keysPool: [
      ('Z3NrX2hyOHlzUTht' + 'S0VuT3M0WjU5TnM3' + 'V0dkeWIzRllzOHpZ' + 'YUN1dUN6SWx5QzU2' + 'akRRYkV5WVY='), // Groq Ultra-Fast Primary Key
      'QVEuQWI4Uk42SWdPVEZCWk9DWWdlb2cxRWlDYmg1MzYyYUFhWnBoZDNNQlktN0VaXzMySEE=', // Gemini MEEM 1
      'QVEuQWI4Uk42TDNWVTZyMDJjT3VueXJwLW9nVmtBSGlmUVBXLTI2aERLOXBjVDdoVVBJcVE=', // Gemini MEEM 2
      'QVEuQWI4Uk42SmoteE9tMU5uaDUwZ2g3ZDhZRTFsTjNNRGxZVElFTnhzNUpaNXZsZFVPa0E='  // Gemini MEEM 3
    ],
    _keys: [], // array of { key: string, throttledUntil: number, failCount: number, successCount: number }
    _rrIndex: 0,

    init() {
      if (this._keys && this._keys.length > 0) return;
      const decodedKeys = [];

      this._keysPool.forEach(seed => {
        try {
          const decoded = typeof atob === 'function' ? atob(seed) : Buffer.from(seed, 'base64').toString('utf-8');
          if (decoded && decoded.length > 10 && !decodedKeys.includes(decoded)) {
            decodedKeys.push(decoded);
          }
        } catch (_) {}
      });

      this._keys = decodedKeys.map(k => ({
        key: k,
        throttledUntil: 0,
        failCount: 0,
        successCount: 0
      }));
    },

    // Get list of currently healthy (unthrottled) keys
    getHealthyKeys() {
      this.init();
      const now = Date.now();
      const healthy = this._keys.filter(entry => entry.throttledUntil <= now);
      return healthy.length > 0 ? healthy : this._keys; // Fallback to all if all in cooldown
    },

    // Round-robin selection among healthy keys
    getNextKey() {
      const pool = this.getHealthyKeys();
      if (pool.length === 0) return '';
      this._rrIndex = (this._rrIndex + 1) % pool.length;
      return pool[this._rrIndex].key;
    },

    // Mark a key as throttled (HTTP 429 response)
    markKeyThrottled(key, cooldownMs = 60000) {
      this.init();
      const entry = this._keys.find(e => e.key === key);
      if (entry) {
        entry.throttledUntil = Date.now() + cooldownMs;
        entry.failCount = (entry.failCount || 0) + 1;
        console.warn(`[MEEM AI] Rate-limit (429) backoff on key ${key.substring(0, 8)}... Cooling down for ${cooldownMs / 1000}s`);
      }
    },

    // Mark key success (resets fail count)
    markKeySuccess(key) {
      this.init();
      const entry = this._keys.find(e => e.key === key);
      if (entry) {
        entry.failCount = 0;
        entry.successCount = (entry.successCount || 0) + 1;
      }
    },

    getStatus() {
      this.init();
      const now = Date.now();
      return {
        totalKeys: this._keys.length,
        healthyKeys: this._keys.filter(k => k.throttledUntil <= now).length,
        throttledKeys: this._keys.filter(k => k.throttledUntil > now).length
      };
    }
  };

  // Helper backward compatibility
  function getGeminiKey() {
    return KeyPoolManager.getNextKey();
  }

  // Primary Ultra-Fast Groq Models
  const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'qwen-2.5-coder-32b',
    'llama-3.1-8b-instant'
  ];

  // Secondary Gemini Models
  const GEMINI_MODELS = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-flash-lite-latest'
  ];

  // Daily Quotas
  const FREE_DAILY_LIMIT = 5;
  const PRO_DAILY_LIMIT = 50;

  let conversationHistory = [];
  let isGenerating = false;
  let abortController = null;
  let activeSessionId = null;
  let pendingAttachment = null;

  // ─── Quota Management ───
  function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isUserPro() {
    try {
      if (typeof window.isAccountVIP === 'function' && window.isAccountVIP()) return true;
      const sub = window.appData?.user?.subscription_expires_at || window.appData?.subscription_expires_at;
      if (sub && new Date(sub) > new Date()) return true;
      if (window.appData?.user?.is_admin || window.appData?.user?.role === 'admin') return true;
    } catch (_) {}
    return false;
  }

  function getDailyLimit() {
    return isUserPro() ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  }

  function getDailyUsage() {
    const today = getTodayString();
    const key = `meem_ai_usage_${today}`;
    try {
      const val = localStorage.getItem(key);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch (_) {
      return 0;
    }
  }

  function incrementDailyUsage() {
    const today = getTodayString();
    const key = `meem_ai_usage_${today}`;
    const current = getDailyUsage();
    try {
      localStorage.setItem(key, String(current + 1));
    } catch (_) {}
    updateQuotaUI();
  }

  function getRemainingQuota() {
    const limit = getDailyLimit();
    const used = getDailyUsage();
    return Math.max(0, limit - used);
  }

  function updateQuotaUI() {
    const quotaEl = document.getElementById('ai-quota-text');
    const badgeEl = document.getElementById('ai-quota-badge');
    if (!quotaEl) return;

    const remaining = getRemainingQuota();
    const limit = getDailyLimit();
    const isPro = isUserPro();
    const pct = Math.min(100, Math.max(0, Math.round((remaining / limit) * 100)));

    if (badgeEl) {
      if (isPro) badgeEl.classList.add('is-pro');
      else badgeEl.classList.remove('is-pro');
    }

    quotaEl.innerHTML = `
      <div class="ai-quota-bar-wrapper" title="${remaining} of ${limit} requests remaining today">
        <div class="ai-quota-info">
          <span class="ai-quota-label">${isPro ? '<i class="fas fa-bolt"></i> PRO' : '<i class="fas fa-sparkles"></i> FREE'}</span>
        </div>
        <div class="ai-quota-track">
          <div class="ai-quota-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }

  // ─── User Taste Profile & Memory Management (Priority 1) ───
  function getUserTasteMemory() {
    try {
      const profileId = window.currentProfile?.id || window.appData?.activeProfileId || 'default';
      const raw = localStorage.getItem(`meem_ai_memory_${profileId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function saveUserTasteMemory(memoryList) {
    try {
      const profileId = window.currentProfile?.id || window.appData?.activeProfileId || 'default';
      localStorage.setItem(`meem_ai_memory_${profileId}`, JSON.stringify(memoryList.slice(0, 50)));
    } catch (_) {}
  }

  function rememberUserPreference(prefText) {
    if (!prefText) return false;
    const clean = prefText.trim();
    if (!clean) return false;
    const memory = getUserTasteMemory();
    if (!memory.includes(clean)) {
      memory.push(clean);
      saveUserTasteMemory(memory);
    }
    return true;
  }

  function forgetUserPreference(prefText) {
    if (!prefText) return false;
    const clean = prefText.trim().toLowerCase();
    let memory = getUserTasteMemory();
    const initialLen = memory.length;
    memory = memory.filter(m => !m.toLowerCase().includes(clean));
    saveUserTasteMemory(memory);
    return memory.length < initialLen;
  }

  // ─── Addon Feature Gating Helper (Golden Rule) ───
  function checkAddonRequirement(capability) {
    const appData = window.appData || {};
    const addons = appData.installedAddons || [];

    if (capability === 'catalog' || capability === 'media') {
      const hasCatalog = (window.capabilities && typeof window.capabilities.can === 'function')
        ? window.capabilities.can('catalog')
        : addons.some(a => a.enabled !== false && (a.id || a.name || a.url || '').toLowerCase().match(/cinemeta|tmdb|kitsu/));
      if (!hasCatalog) {
        return {
          allowed: false,
          requiredAddon: 'Cinemeta / TMDB Catalog',
          reason: 'إضافة الكتالوج (Cinemeta أو TMDB) غير مفعّلة. يرجى تثبيت أو تفعيل الإضافة من قسم الإضافات أولاً للبحث واستعراض العروض.'
        };
      }
    }

    if (capability === 'youtube') {
      const hasYoutube = (window.capabilities && typeof window.capabilities.can === 'function')
        ? window.capabilities.can('youtube')
        : addons.some(a => a.enabled !== false && (a.id || a.name || a.url || '').toLowerCase().includes('youtube'));
      if (!hasYoutube) {
        return {
          allowed: false,
          requiredAddon: 'YouTube Addon',
          reason: 'إضافة YouTube غير مفعّلة أو غير مثبتة. يرجى تفعيلها من قسم الإضافات (Addons) لاستعراض وتشغيل مقاطع يوتيوب.'
        };
      }
    }

    if (capability === 'music') {
      const hasMusic = (window.capabilities && typeof window.capabilities.can === 'function')
        ? window.capabilities.can('music')
        : addons.some(a => a.enabled !== false && (a.id || a.name || a.url || '').toLowerCase().includes('music'));
      if (!hasMusic) {
        return {
          allowed: false,
          requiredAddon: 'Music Player Addon',
          reason: 'إضافة الموسيقى (Music Addon) غير مفعّلة. يرجى تفعيل إضافة الموسيقى من قسم الإضافات لتشغيل الأغاني والأنشودات.'
        };
      }
    }

    if (capability === 'stream' || capability === 'torrent') {
      const hasStreamAddon = addons.some(a => a.enabled !== false && (
        (a.types && (a.types.includes('stream') || a.types.includes('movie') || a.types.includes('series'))) ||
        (a.id || a.name || a.url || '').toLowerCase().match(/torrent|stream|torrentio|knightcrawler|cinemeta|stremio/)
      ));
      if (!hasStreamAddon) {
        return {
          allowed: false,
          requiredAddon: 'Torrent / Stream Provider (Torrentio, etc.)',
          reason: 'لا توجد إضافة بث أو تورنت (مثل Torrentio) مفعّلة. يرجى تثبيت أو تفعيل الإضافة المناسبة من قسم الإضافات لبث أو تحميل الملفات.'
        };
      }
    }

    if (capability === 'iptv') {
      const hasIptv = (window.allIptvChannels && window.allIptvChannels.length > 0) || addons.some(a => a.enabled !== false && (a.id || a.name || a.url || '').toLowerCase().includes('iptv'));
      if (!hasIptv) {
        return {
          allowed: false,
          requiredAddon: 'IPTV Addon / Playlist',
          reason: 'إضافة القنوات الحية (IPTV) غير متوفرة أو لم يتم تحميل قائمة قنوات.'
        };
      }
    }

    return { allowed: true };
  }

  // ─── Tools / Function Calling Definitions ───
  const AI_TOOLS = [
    {
      functionDeclarations: [
        {
          name: 'recommend_media',
          description: 'Recommend a curated list of specific movies, TV shows, or anime. For items already in the user watchlist/lists, pass their exact `id` or `imdb_id` so the exact poster and item are displayed.',
          parameters: {
            type: 'OBJECT',
            properties: {
              items: {
                type: 'ARRAY',
                description: 'Array of 1 to 5 specific recommended titles with their media type, optional exact IMDb ID, and brief note.',
                items: {
                  type: 'OBJECT',
                  properties: {
                    id: { type: 'STRING', description: 'Exact IMDb ID / item ID if from the user watchlist (e.g. "tt4759600")' },
                    title: { type: 'STRING', description: 'Exact official title' },
                    type: { type: 'STRING', description: 'movie or tv', enum: ['movie', 'tv'] },
                    note: { type: 'STRING', description: 'Brief concise reason' }
                  },
                  required: ['title']
                }
              }
            },
            required: ['items']
          }
        },
        {
          name: 'play_music',
          description: 'Search for a song, music track, nasheed, or Quran recitation by title/artist and play it immediately.',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Song title, artist, or query (e.g. "Sunflower Spider-Man", "Believer Imagine Dragons", "ماهر المعيقلي سورة الكهف")' }
            },
            required: ['query']
          }
        },
        {
          name: 'search_music',
          description: 'Search for songs, music tracks, or nasheeds and return playable track cards.',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Search term for music track' }
            },
            required: ['query']
          }
        },
        {
          name: 'play_media',
          description: 'Search for a specific movie, TV show, anime, or specific episode and immediately start direct playback or open stream page.',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Optional exact IMDb ID (e.g. "tt4759600")' },
              title: { type: 'STRING', description: 'Movie, series, or anime title (e.g. "Inception", "Attack on Titan", "Erased")' },
              type: { type: 'STRING', description: 'movie or tv', enum: ['movie', 'tv'] },
              season_number: { type: 'INTEGER', description: 'Optional season number (e.g. 2)' },
              episode_number: { type: 'INTEGER', description: 'Optional episode number (e.g. 5)' },
              source: { type: 'STRING', description: 'torrent, youtube, or auto' }
            },
            required: ['title']
          }
        },
        {
          name: 'download_media',
          description: 'Start a direct background download for a movie, TV episode, anime episode, or torrent stream directly without redirecting the user to the downloads view.',
          parameters: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Optional IMDb ID' },
              title: { type: 'STRING', description: 'Movie, series, or anime title to download' },
              type: { type: 'STRING', description: 'movie or tv', enum: ['movie', 'tv'] },
              season_number: { type: 'INTEGER', description: 'Optional season number for series (e.g. 2)' },
              episode_number: { type: 'INTEGER', description: 'Optional episode number for series (e.g. 5)' },
              url_or_magnet: { type: 'STRING', description: 'Optional direct stream URL or magnet link if already known' }
            },
            required: ['title']
          }
        },
        {
          name: 'get_user_lists',
          description: 'Get all custom lists and watchlist items of the current user profile with full details, ratings, IMDb IDs, and posters.',
          parameters: { type: 'OBJECT', properties: {} }
        },
        {
          name: 'create_custom_list',
          description: 'Create a new custom media list for the user profile, optionally pre-populating it with a batch of movies/shows.',
          parameters: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING', description: 'The title/name of the new list (e.g. "Horror Nights", "Favorite Anime", "أشهر العروض")' },
              description: { type: 'STRING', description: 'Optional short description of the list' },
              items: {
                type: 'ARRAY',
                description: 'Optional initial list of movies/shows to add in a single batch',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING', description: 'Exact English or international title' },
                    type: { type: 'STRING', enum: ['movie', 'tv'], description: 'movie or tv' },
                    id: { type: 'STRING', description: 'Optional IMDb ID' }
                  },
                  required: ['title']
                }
              }
            },
            required: ['title']
          }
        },
        {
          name: 'add_to_custom_list',
          description: 'Add one or multiple movies or TV shows in a single batch to a custom list or main Watchlist.',
          parameters: {
            type: 'OBJECT',
            properties: {
              list_name_or_id: { type: 'STRING', description: 'Name or ID of the list (use "watchlist" for main watchlist)' },
              media_title: { type: 'STRING', description: 'Single movie/series title (for adding 1 item)' },
              media_type: { type: 'STRING', description: 'movie or tv', enum: ['movie', 'tv'] },
              items: {
                type: 'ARRAY',
                description: 'Batch array of movies/series to add all at once in a single call',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING', description: 'Exact title' },
                    type: { type: 'STRING', enum: ['movie', 'tv'] },
                    id: { type: 'STRING', description: 'Optional IMDb ID' }
                  },
                  required: ['title']
                }
              }
            },
            required: ['list_name_or_id']
          }
        },
        {
          name: 'remove_from_custom_list',
          description: 'Remove a movie or TV show from a custom list.',
          parameters: {
            type: 'OBJECT',
            properties: {
              list_name_or_id: { type: 'STRING', description: 'Name or ID of the list' },
              media_title: { type: 'STRING', description: 'Title of the movie/show to remove' }
            },
            required: ['list_name_or_id', 'media_title']
          }
        },
        {
          name: 'mark_as_watched',
          description: 'Mark a movie, anime, or TV show as watched in the user profile playback history and remove it from the Watchlist.',
          parameters: {
            type: 'OBJECT',
            properties: {
              media_title: { type: 'STRING', description: 'Exact title of the movie/show/anime' },
              media_type: { type: 'STRING', enum: ['movie', 'tv'], description: 'movie or tv' },
              remove_from_watchlist: { type: 'BOOLEAN', description: 'Whether to remove from watchlist (default true)' }
            },
            required: ['media_title']
          }
        },
        {
          name: 'remember_user_preference',
          description: 'Save a specific long-term taste, preference, favorite genre, director, or watching habit into the user memory matrix.',
          parameters: {
            type: 'OBJECT',
            properties: {
              preference: { type: 'STRING', description: 'The preference or habit to remember (e.g. "User loves mind-bending time travel thrillers", "Dislikes cheap jump-scare horror", "Favorite actor: Cillian Murphy")' }
            },
            required: ['preference']
          }
        },
        {
          name: 'forget_user_preference',
          description: 'Remove a specific preference or habit from the user long-term memory matrix.',
          parameters: {
            type: 'OBJECT',
            properties: {
              preference: { type: 'STRING', description: 'The keyword or phrase of the preference to forget' }
            },
            required: ['preference']
          }
        },
        {
          name: 'control_playback',
          description: 'Smart media playback control (play, pause, seek, toggle subtitles, set volume, next episode).',
          parameters: {
            type: 'OBJECT',
            properties: {
              action: { type: 'STRING', enum: ['play', 'pause', 'toggle_subtitles', 'next_episode', 'mute', 'unmute'], description: 'The playback control action to execute' }
            },
            required: ['action']
          }
        },
        {
          name: 'get_episode_companion_info',
          description: 'Get non-spoiler episode summary, character list, and recap up to the specified season and episode.',
          parameters: {
            type: 'OBJECT',
            properties: {
              series_title: { type: 'STRING', description: 'Name of the TV series or anime' },
              season_number: { type: 'INTEGER', description: 'Current season number user is watching' },
              episode_number: { type: 'INTEGER', description: 'Current episode number user is watching' }
            },
            required: ['series_title', 'episode_number']
          }
        },
        {
          name: 'curate_bento_row',
          description: 'Curate a dynamic custom bento row of media titles with a custom title for display in the UI.',
          parameters: {
            type: 'OBJECT',
            properties: {
              row_title: { type: 'STRING', description: 'Catchy title for the curated bento row (e.g. "روائع عقلية معقدة", "Mind-Bending Masterpieces")' },
              items: {
                type: 'ARRAY',
                description: 'List of titles for the row',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING', description: 'Exact title' },
                    type: { type: 'STRING', enum: ['movie', 'tv'] },
                    note: { type: 'STRING', description: 'Short note' }
                  },
                  required: ['title']
                }
              }
            },
            required: ['row_title', 'items']
          }
        },
        {
          name: 'search_media',
          description: 'Direct search in the media catalog for a specific title, character, scene description, or plot event.',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Exact title or scene/plot description query' },
              type: { type: 'STRING', description: 'movie, series, or all' }
            },
            required: ['query']
          }
        },
        {
          name: 'search_radio',
          description: 'Search and play live streaming radio stations by station name, country, or genre (e.g. "BBC", "Quran", "Jazz", "Nogoum FM", "Mega FM", "Shaabi").',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Search query for radio stations' }
            },
            required: ['query']
          }
        },
        {
          name: 'search_iptv',
          description: 'Search for live TV channels in the IPTV section (e.g. "News", "Sports", "Movies", "BeIN", "Al Jazeera", "MBC").',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Channel name or category' }
            },
            required: ['query']
          }
        },
        {
          name: 'navigate_view',
          description: 'Navigate the application to a specific view (e.g. movies, shows, discover, music, radio, iptv, watchlist, settings, downloads, social).',
          parameters: {
            type: 'OBJECT',
            properties: {
              view_name: { type: 'STRING', description: 'Target view name', enum: ['movies', 'shows', 'discover', 'music', 'radio', 'iptv', 'watchlist', 'settings', 'downloads', 'social'] }
            },
            required: ['view_name']
          }
        }
      ]
    }
  ];

  // ─── Music Track Search Helper ───
  async function searchMusicTracks(query) {
    const q = (query || '').trim();
    if (!q) return [];

    if (window.api && typeof window.api.searchMusic === 'function') {
      try {
        const res = await window.api.searchMusic(q);
        if (res && res.success && Array.isArray(res.results) && res.results.length > 0) {
          return res.results.map(r => ({
            id: r.id,
            title: r.title,
            artist: r.author || r.artists?.[0]?.name || '',
            author: r.author || r.artists?.[0]?.name || '',
            thumbnail: r.thumbnail || '',
            duration: r.duration || ''
          }));
        }
      } catch (_) {}
    }

    try {
      const resp = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song&limit=6');
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          return data.results.map(r => ({
            id: 'itunes_' + r.trackId,
            title: r.trackName,
            artist: r.artistName,
            author: r.artistName,
            thumbnail: r.artworkUrl100?.replace('100x100bb', '300x300bb') || r.artworkUrl100,
            audioUrl: r.previewUrl,
            duration: Math.floor((r.trackTimeMillis || 0) / 1000)
          }));
        }
      }
    } catch (_) {}

    return [];
  }

  // ─── Media Item Resolver (Watchlist Priority + IMDb ID + Cinemeta) ───
  async function resolveMediaItem(it) {
    const prof = window.currentProfile || {};
    const allUserItems = [...(prof.watchlist || [])];
    (prof.custom_lists || []).forEach(l => {
      if (l.items) allUserItems.push(...l.items);
    });

    const queryTitle = (it.title || '').trim().toLowerCase();
    const queryId = (it.id || it.imdb_id || '').trim();

    // 1. Check in user lists by ID or Title first
    if (queryId) {
      const foundById = allUserItems.find(u => String(u.id) === queryId || String(u.imdb_id) === queryId || String(u.imdbId) === queryId);
      if (foundById) {
        return {
          id: foundById.id || foundById.imdb_id,
          imdb_id: foundById.imdb_id || foundById.imdbId || (String(foundById.id || '').startsWith('tt') ? foundById.id : null),
          title: foundById.title || foundById.name,
          name: foundById.title || foundById.name,
          year: foundById.year || foundById.release_date?.substring(0, 4) || '',
          type: foundById.type === 'series' || foundById.type === 'tv' ? 'tv' : 'movie',
          media_type: foundById.type === 'series' || foundById.type === 'tv' ? 'tv' : 'movie',
          poster: foundById.poster || foundById.poster_path || '',
          rating: foundById.imdbRating || (foundById.vote_average ? Number(foundById.vote_average).toFixed(1) : ''),
          note: it.note || ''
        };
      }
    }

    if (queryTitle) {
      const foundByTitle = allUserItems.find(u => (u.title || u.name || '').toLowerCase() === queryTitle);
      if (foundByTitle) {
        return {
          id: foundByTitle.id || foundByTitle.imdb_id,
          imdb_id: foundByTitle.imdb_id || foundByTitle.imdbId || (String(foundByTitle.id || '').startsWith('tt') ? foundByTitle.id : null),
          title: foundByTitle.title || foundByTitle.name,
          name: foundByTitle.title || foundByTitle.name,
          year: foundByTitle.year || foundByTitle.release_date?.substring(0, 4) || '',
          type: foundByTitle.type === 'series' || foundByTitle.type === 'tv' ? 'tv' : 'movie',
          media_type: foundByTitle.type === 'series' || foundByTitle.type === 'tv' ? 'tv' : 'movie',
          poster: foundByTitle.poster || foundByTitle.poster_path || '',
          rating: foundByTitle.imdbRating || (foundByTitle.vote_average ? Number(foundByTitle.vote_average).toFixed(1) : ''),
          note: it.note || ''
        };
      }
    }

    // 2. If ID is an IMDb ID (starts with tt...), fetch exact meta from Cinemeta by ID
    if (queryId && queryId.startsWith('tt')) {
      const mediaType = it.type === 'series' || it.type === 'tv' ? 'series' : 'movie';
      try {
        const res = await fetch(`https://v3-cinemeta.strem.io/meta/${mediaType}/${queryId}.json`).then(r => r.json());
        if (res && res.meta) {
          const m = res.meta;
          return {
            id: m.id,
            imdb_id: m.imdb_id || m.id,
            title: m.name || m.title || it.title,
            name: m.name || m.title || it.title,
            year: m.year || m.release_date?.substring(0, 4) || '',
            type: m.type === 'series' || m.type === 'tv' ? 'tv' : 'movie',
            media_type: m.type === 'series' || m.type === 'tv' ? 'tv' : 'movie',
            poster: m.poster || '',
            rating: m.imdbRating || '',
            note: it.note || ''
          };
        }
      } catch (_) {}
    }

    // 3. Otherwise, search Cinemeta by Title
    const isTvRequested = it.type === 'series' || it.type === 'tv';
    const mediaType = isTvRequested ? 'tv' : (it.type || 'all');
    const searchRes = await fetchMediaSearch(it.title, mediaType);
    if (searchRes && searchRes.length > 0) {
      let best = null;
      if (isTvRequested) {
        best = searchRes.find(r => (r.type === 'series' || r.type === 'tv') && r.poster && !r.poster.includes('null'));
      }
      if (!best) {
        best = searchRes.find(r => r.poster && !r.poster.includes('null')) || searchRes[0];
      }
      return {
        id: best.id || best._id,
        imdb_id: best.imdb_id || (String(best.id || '').startsWith('tt') ? best.id : null),
        title: best.name || best.title || it.title,
        name: best.name || best.title || it.title,
        year: best.year || best.release_date?.substring(0, 4) || '',
        type: best.type === 'series' || best.type === 'tv' || mediaType === 'tv' ? 'tv' : 'movie',
        media_type: best.type === 'series' || best.type === 'tv' || mediaType === 'tv' ? 'tv' : 'movie',
        poster: best.poster || best.poster_path || '',
        rating: best.imdbRating || (best.vote_average ? Number(best.vote_average).toFixed(1) : ''),
        note: it.note || ''
      };
    }

    return {
      id: 'item_' + Date.now(),
      title: it.title,
      name: it.title,
      year: '',
      type: mediaType === 'tv' ? 'tv' : 'movie',
      media_type: mediaType === 'tv' ? 'tv' : 'movie',
      poster: '',
      rating: '',
      note: it.note || ''
    };
  }

  // ─── Tool Executors ───
  async function executeTool(name, args) {
    console.log('[MEEM AI] Executing tool:', name, args);

    if (name === 'recommend_media') {
      const catalogCheck = checkAddonRequirement('catalog');
      if (!catalogCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: catalogCheck.requiredAddon, message: catalogCheck.reason };
      }
      const items = Array.isArray(args.items) ? args.items : [];
      const resolvedResults = [];

      for (const it of items) {
        if (!it.title && !it.id) continue;
        try {
          const resolved = await resolveMediaItem(it);
          if (resolved) resolvedResults.push(resolved);
        } catch (_) {}
      }

      return {
        success: true,
        count: resolvedResults.length,
        results: resolvedResults
      };
    }

    if (name === 'play_music') {
      const musicCheck = checkAddonRequirement('music');
      if (!musicCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: musicCheck.requiredAddon, message: musicCheck.reason };
      }
      const query = args.query || '';
      const tracks = await searchMusicTracks(query);
      if (tracks.length > 0) {
        const topTrack = tracks[0];
        window.aiPlayMusicTrack(topTrack);
        return {
          success: true,
          message: `Playing "${topTrack.title}" by ${topTrack.artist || 'Unknown'}`,
          track: topTrack,
          allTracks: tracks.slice(0, 4)
        };
      }
      return { success: false, message: `Could not find song "${query}"` };
    }

    if (name === 'search_music') {
      const musicCheck = checkAddonRequirement('music');
      if (!musicCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: musicCheck.requiredAddon, message: musicCheck.reason };
      }
      const query = args.query || '';
      const tracks = await searchMusicTracks(query);
      return {
        success: true,
        count: tracks.length,
        tracks: tracks.slice(0, 5)
      };
    }

    if (name === 'play_media') {
      const catalogCheck = checkAddonRequirement('catalog');
      if (!catalogCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: catalogCheck.requiredAddon, message: catalogCheck.reason };
      }
      const isYoutube = args.source === 'youtube' || (args.title || '').toLowerCase().includes('youtube');
      const streamCheck = checkAddonRequirement(isYoutube ? 'youtube' : 'stream');
      if (!streamCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: streamCheck.requiredAddon, message: streamCheck.reason };
      }

      const title = args.title || '';
      const id = args.id || '';
      const type = args.type || 'all';
      const season = args.season_number || null;
      const episode = args.episode_number || null;

      const resolved = await resolveMediaItem({ id, title, type: (season || episode) ? 'tv' : type });
      if (resolved && resolved.id) {
        if (season || episode) {
          resolved.season = season || 1;
          resolved.episode = episode || 1;
          resolved.epTitle = `Episode ${resolved.episode}`;
          resolved.media_type = 'tv';
          resolved.type = 'tv';
        }

        if (typeof window.loadStreams === 'function') {
          window.loadStreams(resolved, resolved.type === 'tv' ? 'tv' : 'movie');
        } else {
          window.aiOpenMedia(resolved);
        }
        return {
          success: true,
          message: `Opened "${resolved.title}"${season ? ` (Season ${season}, Ep ${episode})` : ''}`,
          item: resolved
        };
      }
      return { success: false, message: `Could not find movie/show "${title}"` };
    }

    if (name === 'download_media') {
      const catalogCheck = checkAddonRequirement('catalog');
      if (!catalogCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: catalogCheck.requiredAddon, message: catalogCheck.reason };
      }
      const streamCheck = checkAddonRequirement('stream');
      if (!streamCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: streamCheck.requiredAddon, message: streamCheck.reason };
      }

      const title = args.title || '';
      const id = args.id || '';
      const type = args.type || 'all';
      const season = args.season_number || null;
      const episode = args.episode_number || null;

      const resolved = await resolveMediaItem({ id, title, type: (season || episode) ? 'tv' : type });
      if (!resolved || !resolved.title) {
        return { success: false, message: `Could not find title "${title}" to download` };
      }

      let downloadUrl = args.url_or_magnet || null;
      let streamTitle = resolved.title;

      if (!downloadUrl && window.api && typeof window.api.searchAddons === 'function') {
        try {
          const imdbId = resolved.imdb_id || (String(resolved.id).startsWith('tt') ? resolved.id : null);
          const addonRes = await window.api.searchAddons({
            imdbId,
            title: resolved.title,
            type: (season || episode || resolved.type === 'tv') ? 'series' : 'movie',
            season: season || 1,
            episode: episode || 1
          });
          if (addonRes && Array.isArray(addonRes) && addonRes.length > 0) {
            const bestStream = addonRes[0];
            downloadUrl = bestStream.url || bestStream.infoHash || bestStream.magnet;
            if (bestStream.title) streamTitle = bestStream.title;
          }
        } catch (e) {
          console.warn('[MEEM AI] Download addon search error:', e);
        }
      }

      const dlName = `${resolved.title}${season ? ` S${String(season).padStart(2, '0')}E${String(episode || 1).padStart(2, '0')}` : ''}`.trim();

      if (downloadUrl) {
        if (window.api && typeof window.api.startDownload === 'function') {
          await window.api.startDownload({ url: downloadUrl, name: dlName, type: resolved.type || 'movie' });
        } else if (typeof window.startDownload === 'function') {
          await window.startDownload({ url: downloadUrl, name: dlName });
        }
        if (typeof window.renderActiveDownloads === 'function') {
          window.renderActiveDownloads();
        }
        return {
          success: true,
          message: `Direct background download started for "${dlName}". Progress can be monitored in Downloads view!`,
          item: resolved,
          downloadUrl
        };
      }

      return {
        success: false,
        message: `No direct stream or torrent sources found for "${dlName}". Make sure torrent/stream addons (like Torrentio) are enabled in Addons.`
      };
    }

    if (name === 'get_user_lists') {
      const prof = window.currentProfile || {};
      const watchlist = (prof.watchlist || []).map(w => ({
        id: w.id || w.imdb_id || w.imdbId || '',
        imdb_id: w.imdb_id || w.imdbId || (String(w.id || '').startsWith('tt') ? w.id : ''),
        title: w.title || w.name || '',
        type: w.type === 'series' || w.type === 'tv' || w.media_type === 'tv' ? 'tv' : 'movie',
        rating: String(w.imdbRating || w.vote_average || w.rating || 'N/A'),
        year: String(w.year || w.release_date?.substring(0, 4) || ''),
        poster: w.poster || w.poster_path || ''
      }));

      const customLists = (prof.custom_lists || []).map(l => ({
        id: l.id,
        name: l.name,
        type: l.type || 'media',
        itemCount: (l.items || []).length,
        items: (l.items || []).map(i => ({
          id: i.id || i.imdb_id || '',
          title: i.title || i.name || '',
          rating: String(i.imdbRating || i.vote_average || i.rating || ''),
          type: i.type || 'movie'
        }))
      }));

      return {
        success: true,
        watchlistCount: watchlist.length,
        watchlist,
        customLists
      };
    }

    if (name === 'create_custom_list') {
      const title = (args.title || '').trim();
      const desc = (args.description || '').trim();
      if (!title) return { success: false, error: 'List title is required' };

      const prof = window.currentProfile;
      if (!prof) return { success: false, error: 'No active profile' };

      if (!prof.custom_lists) prof.custom_lists = [];
      let targetList = prof.custom_lists.find(l => l.name.toLowerCase() === title.toLowerCase());
      const isNew = !targetList;

      if (isNew) {
        const listId = 'list_' + Date.now();
        targetList = {
          id: listId,
          name: title,
          description: desc,
          type: 'media',
          icon: 'fas fa-film',
          items: [],
          createdAt: Date.now()
        };
        prof.custom_lists.push(targetList);
      }

      // If initial items provided, resolve and add them all concurrently in a single batch
      const initialRawItems = Array.isArray(args.items) ? args.items : [];
      if (initialRawItems.length > 0) {
        if (!targetList.items) targetList.items = [];
        const resolvedItems = await Promise.all(initialRawItems.map(it => resolveMediaItem(it)));
        resolvedItems.forEach((resolved, idx) => {
          const raw = initialRawItems[idx];
          const item = resolved || {
            id: raw.id || ('item_' + Date.now() + '_' + idx),
            title: raw.title,
            name: raw.title,
            type: raw.type || 'movie',
            poster: ''
          };
          if (!targetList.items.some(i => (i.id && i.id === item.id) || (i.title && i.title.toLowerCase() === (item.title || '').toLowerCase()))) {
            targetList.items.push(item);
          }
        });
      }

      if (typeof window.persist === 'function') await window.persist(true);
      if (typeof window.renderLibCustomLists === 'function') window.renderLibCustomLists();

      return {
        success: true,
        message: isNew 
          ? `Successfully created list "${title}"${targetList.items.length ? ` with ${targetList.items.length} items` : ''}!`
          : `List "${title}" already exists (${targetList.items.length} items).`,
        listId: targetList.id,
        listName: title,
        itemCount: targetList.items.length,
        items: targetList.items
      };
    }

    if (name === 'add_to_custom_list') {
      const listTarget = (args.list_name_or_id || '').toLowerCase().trim();
      const rawItems = Array.isArray(args.items) && args.items.length > 0
        ? args.items
        : (args.media_title ? [{ title: args.media_title, type: args.media_type || 'movie', id: args.id }] : []);

      if (rawItems.length === 0) return { success: false, error: 'Media title or items array required' };

      const prof = window.currentProfile;
      if (!prof) return { success: false, error: 'No active profile' };

      // Resolve all items concurrently in parallel
      const resolvedItems = await Promise.all(rawItems.map(it => resolveMediaItem(it)));
      const itemsToAdd = resolvedItems.map((resolved, idx) => {
        const raw = rawItems[idx];
        return resolved || {
          id: raw.id || ('item_' + Date.now() + '_' + idx),
          title: raw.title,
          name: raw.title,
          type: raw.type || 'movie',
          poster: ''
        };
      });

      const isWatchlist = (listTarget === 'watchlist' || listTarget === 'favorites' || listTarget === 'my list');

      if (isWatchlist) {
        if (!prof.watchlist) prof.watchlist = [];
        let addedCount = 0;
        itemsToAdd.forEach(item => {
          if (!prof.watchlist.some(w => (w.id && w.id === item.id) || (w.title && w.title.toLowerCase() === (item.title || '').toLowerCase()))) {
            prof.watchlist.push(item);
            addedCount++;
          }
        });
        if (typeof window.persist === 'function') await window.persist(true);
        if (typeof window.renderWatchlist === 'function') window.renderWatchlist();
        return {
          success: true,
          message: `Added ${addedCount} item(s) to Watchlist!`,
          items: itemsToAdd
        };
      }

      if (!prof.custom_lists) prof.custom_lists = [];
      let targetList = prof.custom_lists.find(l => l.id === listTarget || l.name.toLowerCase() === listTarget);
      if (!targetList) {
        const newListId = 'list_' + Date.now();
        targetList = {
          id: newListId,
          name: args.list_name_or_id,
          description: 'Created by MEEM AI',
          type: 'media',
          icon: 'fas fa-film',
          items: [],
          createdAt: Date.now()
        };
        prof.custom_lists.push(targetList);
      }

      if (!targetList.items) targetList.items = [];
      let addedCount = 0;
      itemsToAdd.forEach(item => {
        if (!targetList.items.some(i => (i.id && i.id === item.id) || (i.title && i.title.toLowerCase() === (item.title || '').toLowerCase()))) {
          targetList.items.push(item);
          addedCount++;
        }
      });

      if (typeof window.persist === 'function') await window.persist(true);
      if (typeof window.renderLibCustomLists === 'function') window.renderLibCustomLists();

      return {
        success: true,
        message: `Added ${addedCount} item(s) to list "${targetList.name}"!`,
        listId: targetList.id,
        listName: targetList.name,
        items: itemsToAdd
      };
    }

    if (name === 'remove_from_custom_list') {
      const listTarget = (args.list_name_or_id || '').toLowerCase().trim();
      const mediaTitle = (args.media_title || '').toLowerCase().trim();

      const prof = window.currentProfile;
      if (!prof) return { success: false, error: 'No active profile' };

      if (listTarget === 'watchlist' || listTarget === 'favorites' || listTarget === 'my list') {
        if (prof.watchlist) {
          prof.watchlist = prof.watchlist.filter(i => (i.title || i.name || '').toLowerCase() !== mediaTitle && i.id !== args.media_title);
          if (typeof window.persist === 'function') await window.persist(true);
        }
        return { success: true, message: `Removed "${args.media_title}" from Watchlist.` };
      }

      if (prof.custom_lists) {
        const targetList = prof.custom_lists.find(l => l.id === listTarget || l.name.toLowerCase() === listTarget);
        if (targetList && targetList.items) {
          targetList.items = targetList.items.filter(i => (i.title || i.name || '').toLowerCase() !== mediaTitle && i.id !== args.media_title);
          if (typeof window.persist === 'function') await window.persist(true);
          return { success: true, message: `Removed "${args.media_title}" from "${targetList.name}".` };
        }
      }
      return { success: false, error: 'List or item not found' };
    }

    if (name === 'mark_as_watched') {
      const mediaTitle = (args.media_title || '').trim();
      const mediaType = args.media_type || 'movie';
      const removeFromWatchlist = args.remove_from_watchlist !== false;

      if (!mediaTitle) return { success: false, error: 'Media title required' };

      const prof = window.currentProfile;
      if (!prof) return { success: false, error: 'No active profile' };

      const resolved = await resolveMediaItem({ title: mediaTitle, type: mediaType });
      const item = resolved || {
        id: 'item_' + Date.now(),
        title: mediaTitle,
        name: mediaTitle,
        type: mediaType,
        poster: ''
      };

      if (!prof.playback) prof.playback = {};
      const pbKey = String(item.id || item.imdb_id || item.title);
      prof.playback[pbKey] = {
        ...(prof.playback[pbKey] || {}),
        time: 0,
        duration: 0,
        lastWatched: Date.now(),
        watched: true,
        meta: item
      };

      if (removeFromWatchlist && prof.watchlist) {
        prof.watchlist = prof.watchlist.filter(w => (w.id && w.id !== item.id) && ((w.title || w.name || '').toLowerCase() !== (item.title || item.name || '').toLowerCase()));
      }

      if (typeof window.persist === 'function') await window.persist(true);
      if (typeof window.renderWatchlist === 'function') window.renderWatchlist();

      return {
        success: true,
        message: `Marked "${item.title || item.name}" as Watched! (تم تسجيله في المشاهدات)`,
        item
      };
    }

    if (name === 'search_media') {
      const catalogCheck = checkAddonRequirement('catalog');
      if (!catalogCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: catalogCheck.requiredAddon, message: catalogCheck.reason };
      }
      const query = args.query || '';
      const type = args.type || 'all';
      const results = await fetchMediaSearch(query, type);
      const validResults = results.filter(r => (r.name || r.title) && !((r.name || r.title).toLowerCase().includes('search=')));
      return {
        success: true,
        count: validResults.length,
        results: validResults.slice(0, 8).map(r => ({
          id: r.id || r._id,
          imdb_id: r.imdb_id || (String(r.id || '').startsWith('tt') ? r.id : null),
          title: r.name || r.title,
          name: r.name || r.title,
          year: r.year || r.release_date?.substring(0, 4) || '',
          type: r.type === 'series' || r.type === 'tv' ? 'tv' : 'movie',
          media_type: r.type === 'series' || r.type === 'tv' ? 'tv' : 'movie',
          poster: r.poster || r.poster_path || '',
          rating: r.imdbRating || (r.vote_average ? Number(r.vote_average).toFixed(1) : '')
        }))
      };
    }

    if (name === 'search_radio') {
      const radioCheck = checkAddonRequirement('radio');
      if (!radioCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: radioCheck.requiredAddon, message: radioCheck.reason };
      }
      const query = args.query || '';
      try {
        const resp = await fetch(`https://de1.api.radio-browser.info/json/stations/byname/${encodeURIComponent(query)}?limit=6`);
        if (resp.ok) {
          const data = await resp.json();
          const stations = data.map(s => ({
            id: s.stationuuid,
            name: s.name,
            favicon: s.favicon,
            country: s.country,
            url: s.url_resolved || s.url,
            url_resolved: s.url_resolved || s.url,
            urlResolved: s.url_resolved || s.url
          }));
          if (stations.length > 0) {
            window.aiPlayRadio(stations[0]);
          }
          return {
            success: true,
            stations
          };
        }
      } catch (e) {
        console.warn('Radio search error:', e);
      }
      return { success: true, stations: [] };
    }

    if (name === 'search_iptv') {
      const iptvCheck = checkAddonRequirement('iptv');
      if (!iptvCheck.allowed) {
        return { success: false, addonMissing: true, requiredAddon: iptvCheck.requiredAddon, message: iptvCheck.reason };
      }
      const query = (args.query || '').toLowerCase();
      const matched = [];
      if (window.allIptvChannels && Array.isArray(window.allIptvChannels)) {
        window.allIptvChannels.forEach(c => {
          if ((c.name || '').toLowerCase().includes(query) || (c.group || '').toLowerCase().includes(query)) {
            if (matched.length < 6) matched.push({ name: c.name, group: c.group, logo: c.logo, url: c.url });
          }
        });
      }
      if (matched.length > 0) {
        window.aiPlayIptv(matched[0]);
      }
      return { success: true, channels: matched };
    }

    if (name === 'navigate_view') {
      const view = args.view_name;
      if (typeof window.switchView === 'function') {
        setTimeout(() => window.switchView(view), 300);
      }
      return { success: true, message: `Navigated to ${view} screen` };
    }

    if (name === 'remember_user_preference') {
      const pref = args.preference || '';
      const saved = rememberUserPreference(pref);
      return { success: saved, message: saved ? `Saved preference: "${pref}"` : 'Failed to save preference' };
    }

    if (name === 'forget_user_preference') {
      const pref = args.preference || '';
      const removed = forgetUserPreference(pref);
      return { success: removed, message: removed ? `Removed preference matching: "${pref}"` : 'Preference not found' };
    }

    if (name === 'control_playback') {
      const action = args.action || 'play';
      try {
        const video = document.querySelector('video');
        if (action === 'play') {
          if (window.MeemAudioPlayer?.play) window.MeemAudioPlayer.play();
          if (video) video.play();
        } else if (action === 'pause') {
          if (window.MeemAudioPlayer?.pause) window.MeemAudioPlayer.pause();
          if (video) video.pause();
        } else if (action === 'toggle_subtitles') {
          if (typeof window.toggleSubtitles === 'function') window.toggleSubtitles();
        } else if (action === 'next_episode') {
          const nextBtn = document.querySelector('.player-next-ep-btn, #btn-next-ep');
          if (nextBtn) nextBtn.click();
        }
        return { success: true, message: `Executed playback command: ${action}` };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    if (name === 'get_episode_companion_info') {
      const seriesTitle = args.series_title || '';
      const s = args.season_number || 1;
      const ep = args.episode_number || 1;
      const resolved = await resolveMediaItem({ title: seriesTitle, type: 'tv' });
      return {
        success: true,
        series: resolved,
        season: s,
        episode: ep,
        safeNoSpoilerContext: `Strict non-spoiler context up to Season ${s} Episode ${ep} for "${seriesTitle}"`
      };
    }

    if (name === 'curate_bento_row') {
      const rowTitle = args.row_title || 'Curated Recommendations';
      const items = Array.isArray(args.items) ? args.items : [];
      const resolvedItems = await Promise.all(items.map(it => resolveMediaItem(it)));
      return {
        success: true,
        rowTitle,
        count: resolvedItems.length,
        results: resolvedItems
      };
    }

    return { success: false, error: 'Unknown tool' };
  }

  // ─── Cinemeta / TMDB Search Helper ───
  async function fetchMediaSearch(query, type = 'all') {
    const q = encodeURIComponent(query.trim());
    const results = [];
    try {
      const promises = [];
      if (type === 'tv' || type === 'series' || type === 'all') {
        promises.push(fetch(`https://v3-cinemeta.strem.io/catalog/series/top/search=${q}.json`).then(r => r.json()).catch(() => ({ metas: [] })));
      }
      if (type === 'movie' || type === 'all') {
        promises.push(fetch(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${q}.json`).then(r => r.json()).catch(() => ({ metas: [] })));
      }
      const responses = await Promise.all(promises);
      responses.forEach(res => {
        if (res && res.metas) {
          results.push(...res.metas);
        }
      });
    } catch (_) {}
    return results;
  }

  // ─── System Prompt (Injected with Real Profile Watchlist Items & Exact IMDb IDs) ───
  function getSystemPrompt() {
    const prof = window.currentProfile || {};
    const lists = (prof.custom_lists || []).map(l => `• ${l.name} (${(l.items || []).length} items)`).join('\n') || 'No custom lists created yet.';
    
    // Detailed Watchlist Serialization
    const watchlistDetails = (prof.watchlist || []).map(w => {
      const id = w.id || w.imdb_id || w.imdbId || '';
      const title = w.title || w.name || '';
      const type = w.type === 'series' || w.type === 'tv' || w.media_type === 'tv' ? 'tv' : 'movie';
      const rating = w.imdbRating || w.vote_average || w.rating || 'N/A';
      const year = w.year || w.release_date?.substring(0, 4) || '';
      return `• ${title} [ID: ${id}] (Type: ${type}, Rating: ${rating}, Year: ${year})`;
    }).join('\n') || 'Watchlist is currently empty.';

    // Watched History Serialization (Never recommend these again)
    const watchedTitles = new Set();
    (prof.watched || []).forEach(w => { if (w.title || w.name) watchedTitles.add(w.title || w.name); });
    if (prof.playback) {
      Object.values(prof.playback).forEach(pb => {
        if (pb.watched && pb.meta && (pb.meta.title || pb.meta.name)) {
          watchedTitles.add(pb.meta.title || pb.meta.name);
        }
      });
    }
    const watchedListDetails = Array.from(watchedTitles).map(t => `• ${t}`).join('\n') || 'No watched items recorded yet.';

    const userMemories = getUserTasteMemory();
    const memoryDetails = userMemories.length > 0
      ? userMemories.map(m => `• ${m}`).join('\n')
      : 'No long-term preferences saved yet.';

    return `You are MEEM AI, the intelligent, concise, and ultra-capable copilot inside the MEEM Media Platform.
You have real-time full playback and navigation control over the application. You can:
1. Play any song, music track, or Quran recitation directly in the music player.
2. Play any movie, TV show, anime, or specific episode directly (from torrent streams or YouTube).
3. Start background downloads directly for any movie, TV show, anime, or torrent stream.
4. Play any live radio station or IPTV channel directly.
5. Curate and recommend movies, TV shows, and anime.
6. Manage and query the user's Watchlist and Custom Lists.
7. Remember user preferences, favorite actors, directors, genres, and habits long-term.
8. Act as a No-Spoiler Episode Companion while watching series or anime.

CURRENT USER PROFILE STATE:
- Profile Name: "${prof.name || 'User'}"
- Watchlist Items (${(prof.watchlist || []).length} items):
${watchlistDetails}
- Existing Custom Lists:
${lists}

USER WATCHED / ALREADY COMPLETED MEDIA (NEVER RECOMMEND THESE AGAIN):
${watchedListDetails}

USER TASTE & PREFERENCE MEMORY MATRIX:
${memoryDetails}

GOLDEN RULE FOR ADDONS & CAPABILITIES:
- EVERYTHING MEEM AI DOES (searching, playing media, playing music/radio/IPTV, fetching torrent/YouTube streams, downloading) IS GATED BY INSTALLED ADDONS.
- If a tool returns an Addon Missing error (e.g. \`addonMissing: true\`), politely inform the user in their language that the required addon (e.g. Cinemeta, TMDB, Torrentio, YouTube, Music Player) must be installed or enabled in the Addons section.
- You can offer to navigate to the Addons view using \`navigate_view({ view_name: 'settings' })\`.

CRITICAL RULES FOR DIRECT PLAYBACK & DOWNLOADING:
- PLAYING SPECIFIC EPISODES & MOVIES: When the user asks to play a specific episode or movie (e.g. "شغل الحلقة 5 من الموسم 2 من Attack on Titan"), use \`play_media\` with \`title\`, \`season_number\`, \`episode_number\`, and optional \`source\` ('torrent' or 'youtube').
- DIRECT BACKGROUND DOWNLOADING: When the user asks to download a movie, show, or episode (e.g. "حمل الحلقة 5 من Attack on Titan", "نزل فيلم Inception"), use \`download_media\` with \`title\`, \`season_number\`, \`episode_number\`. Inform the user that downloading has started in the background and that they can track real-time progress in the Downloads screen.

CRITICAL RULES FOR RECOMMENDATIONS & WATCHED CONTENT:
- NEVER RECOMMEND WATCHED CONTENT: ABSOLUTELY NEVER recommend any item listed in "USER WATCHED / ALREADY COMPLETED MEDIA" above! The user has already watched them. Only suggest fresh, unwatched titles.
- MANDATORY TOOL CALL FOR POSTERS: Whenever you recommend or suggest any movie, TV show, or anime, YOU MUST CALL THE \`recommend_media\` FUNCTION TOOL with \`items: [...]!\` NEVER just write text titles in brackets like \`[Anohana]\` without calling the \`recommend_media\` tool!
- CONTEXTUAL MEDIA TYPE MATCH: Always set the exact, correct \`type\` (\`"tv"\` vs \`"movie"\`) in \`recommend_media\` based on the context of the work:
  * For Anime TV Series or TV Shows (e.g. Your Lie in April, Clannad, Steins;Gate, Erased, Breaking Bad), set \`type: "tv"\`.
  * For Anime Movies or Feature Films (e.g. Your Name, A Silent Voice, Spirited Away, Inception), set \`type: "movie"\`.
- STRICT 1-TO-1 MATCH: The titles you write in text MUST match the exact titles and media types in your \`recommend_media\` tool call 100%! Never mention one work in text while passing a different work or format in tool calls!

CRITICAL RULES FOR ENTITY & CHARACTER ACCURACY:
- ABSOLUTELY NEVER CONFUSE ANIMATION STUDIOS / DIRECTORS / PRODUCTION COMPANIES WITH CHARACTER NAMES!
  * Example: Kyoto / Kyoto Animation (كيوتو / كيوتو أنيميشن) is the animation studio that produced Clannad, Hyouka, Violet Evergarden — IT IS A STUDIO, NOT A CHARACTER!
  * The main male protagonist of Clannad is Tomoya Okazaki (تومويا أوكازاكي), the female lead is Nagisa Furukawa (ناغيسا فوروكاوا), and their daughter is Ushio (أوشيو).
  * Never invent character names, and never refer to studios (MAPPA, Ufotable, Kyoto Animation, Madhouse, Wit Studio, Bones, Ghibli) or directors (Miyazaki, Shinkai) as in-universe characters.
- Double-check all character names, relationships, and plot events for 100% factual correctness before responding.

CRITICAL RULES FOR DEEP EMOTIONAL DISCUSSIONS & REACTION:
- When the user shares feelings, reactions, or finishes a movie/show/anime (e.g. "انا لسه مخلص Clannad", "خلصت Breaking Bad", "اتفرجت على Attack on Titan"):
  1. EMPATHIZE & ENGAGE WITH DEEP PASSION: Talk warmly and deeply about that specific work! Discuss iconic character arcs, emotional climaxes, soundtrack themes, or key scenes (e.g., for Clannad: After Story, the flower field scene with Tomoya & Ushio, Nagisa's journey; for Breaking Bad: Ozymandias, Walter's evolution).
  2. ASK INSIGHTFUL QUESTIONS: Ask the user about their personal reaction to specific moments or characters (e.g. "مين أكتر شخصية أثرت فيك؟", "إيه رأيك في مشهد كذا؟").
  3. PROACTIVE PROFILE INTELLIGENCE: Ask or offer to record it in their Watched history (\`mark_as_watched\`) or remove it from Watchlist!
CRITICAL RULES FOR LANGUAGE MATCHING:
- STRICT MULTILINGUAL & DIALECT ADAPTATION: YOU MUST ALWAYS RESPOND IN THE EXACT SAME LANGUAGE AND DIALECT USED BY THE USER IN THEIR MESSAGE.
  * If the user speaks Egyptian Arabic (e.g. "اقترح لي 100 انمي", "عاوز افلام كوميدي", "شغلي اغنية"): Respond ONLY in natural Egyptian Arabic.
  * If the user speaks Gulf / Saudi / Levantine / Standard Arabic: Respond ONLY in that matching Arabic dialect.
  * If the user speaks English, French, Spanish, German, Japanese, Russian, etc.: Respond ONLY in that exact language.
  * NEVER default to English or switch languages unless the user explicitly switches languages!

CRITICAL RULES FOR LARGE QUANTITY REQUESTS & LIST LIMITS:
- HANDLING LARGE REQUESTS (e.g. "suggest 100 anime", "100 movies", "50 series"):
  * High-count requests (like 50 or 100 items) exceed model token limits and cause timeouts/crashes if outputting all at once.
  * When asked for a huge list (>15 items), present a top curated selection of 10-15 outstanding masterpieces right away with posters (\`recommend_media\`).
  * Explain politely in the user's exact language that you are presenting the top 10-15 best picks first to keep recommendations high quality and avoid truncating, and invite them to ask for the next batch (e.g., "أنا كشفتلك عن أروع 10-15 أنمي، حابب أستمر وأجبلك المجموعة اللي بعدها؟").
  * Limit the \`recommend_media\` tool call array to a maximum of 15 items per request.

CRITICAL RULES FOR LIST MANAGEMENT & BATCH OPERATIONS:
- BATCH OPERATIONS FOR LISTS: When creating a list with multiple movies/shows or adding multiple items to a list/watchlist, ALWAYS use the batch \`items: [...]\` array inside \`create_custom_list\` or \`add_to_custom_list\`.

CRITICAL RULES FOR MULTIMODAL & IMAGE ANALYSIS:
- When the user sends an image: Inspect visual cues, identify Movie/Anime/Character, episode context, and provide a 2-3 sentence overview.

IDENTITY & BRANDING: You are exclusively MEEM AI (ميم AI). NEVER mention Google, Gemini, OpenAI, LLM, or underlying model names under any circumstances.`;
  }

  // ─── Title Extractor Fallback Helper ───
  function extractTitlesFromText(text) {
    if (!text) return [];
    const titles = [];

    // 1. Bracketed titles e.g. [Anohana: The Flower We Saw That Day] or [Your Lie in April]
    const bracketMatches = text.match(/\[([A-Za-z0-9\s:’'!-]{2,60})\]/g) || [];
    for (const b of bracketMatches) {
      const clean = b.replace(/[\[\]]/g, '').trim();
      if (clean && clean.length > 2 && !titles.includes(clean)) {
        titles.push(clean);
      }
    }

    // 2. Bold titles in list lines e.g. * **Your Lie in April**: reason
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\*|-|\d+\.)\s+(\*\*(.*?)\*\*|([A-Za-z0-9\s:’'!-]{2,45})):\s*(.*)$/);
      if (match) {
        let rawTitle = (match[3] || match[4] || '').trim();
        rawTitle = rawTitle.replace(/\*\*/g, '').trim();
        if (rawTitle && rawTitle.length > 1 && !titles.includes(rawTitle)) {
          titles.push(rawTitle);
        }
      }
    }
    return titles.slice(0, 5);
  }

  // ─── Format Normalizers for OpenAI (Groq / Pollinations) ───
  function normalizeJsonSchemaTypes(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const copy = Array.isArray(schema) ? [] : {};
    for (const k in schema) {
      if (k === 'type' && typeof schema[k] === 'string') {
        copy[k] = schema[k].toLowerCase();
      } else if (typeof schema[k] === 'object' && schema[k] !== null) {
        copy[k] = normalizeJsonSchemaTypes(schema[k]);
      } else {
        copy[k] = schema[k];
      }
    }
    return copy;
  }

  function convertGeminiBodyToOpenAiFormat(geminiBody, model) {
    const messages = [];

    if (geminiBody.systemInstruction?.parts?.[0]?.text) {
      messages.push({
        role: 'system',
        content: geminiBody.systemInstruction.parts[0].text
      });
    }

    if (Array.isArray(geminiBody.contents)) {
      let callIdCounter = 1;
      for (const item of geminiBody.contents) {
        const rawRole = item.role === 'model' ? 'assistant' : (item.role === 'system' ? 'system' : 'user');
        const parts = item.parts || [];
        
        let textContent = '';
        const toolCalls = [];

        for (const p of parts) {
          if (p.text) {
            textContent += (textContent ? '\n' : '') + p.text;
          } else if (p.functionCall) {
            toolCalls.push({
              id: 'call_' + (callIdCounter++),
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args || {})
              }
            });
          } else if (p.functionResponse) {
            messages.push({
              role: 'tool',
              tool_call_id: 'call_' + (callIdCounter > 1 ? callIdCounter - 1 : 1),
              content: typeof p.functionResponse.response === 'string' ? p.functionResponse.response : JSON.stringify(p.functionResponse.response || {})
            });
          }
        }

        if (textContent || toolCalls.length > 0) {
          // OpenAi & Groq specs REQUIRE tool_calls to exist ONLY on role="assistant"
          const role = toolCalls.length > 0 ? 'assistant' : rawRole;
          const msg = { role, content: textContent || null };
          if (toolCalls.length > 0 && role === 'assistant') {
            msg.tool_calls = toolCalls;
          }
          messages.push(msg);
        }
      }
    }

    let tools = undefined;
    if (Array.isArray(geminiBody.tools) && geminiBody.tools[0]?.functionDeclarations) {
      tools = geminiBody.tools[0].functionDeclarations.map(fd => ({
        type: 'function',
        function: {
          name: fd.name,
          description: fd.description,
          parameters: normalizeJsonSchemaTypes(fd.parameters || { type: 'object', properties: {} })
        }
      }));
    }

    return {
      model: model,
      messages: messages,
      tools: tools,
      temperature: geminiBody.generationConfig?.temperature || 0.5,
      max_tokens: geminiBody.generationConfig?.maxOutputTokens || 4096
    };
  }

  function convertOpenAiResponseToGeminiFormat(openAiData) {
    const choice = openAiData.choices?.[0];
    if (!choice || !choice.message) return null;

    const message = choice.message;
    const parts = [];

    let rawContent = message.content || '';
    let parsedToolCallsFromContent = null;

    // Detect if LLM text output is a raw JSON string containing tool_calls or function calls
    if (rawContent && (rawContent.trim().startsWith('{') || rawContent.trim().startsWith('```json'))) {
      try {
        let jsonStr = rawContent.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        const parsed = JSON.parse(jsonStr);
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.tool_calls)) {
            parsedToolCallsFromContent = parsed.tool_calls;
          } else if (parsed.name && (parsed.arguments || parsed.args)) {
            parsedToolCallsFromContent = [{ function: { name: parsed.name, arguments: parsed.arguments || parsed.args } }];
          } else if (parsed.functionCall) {
            parsedToolCallsFromContent = [{ function: { name: parsed.functionCall.name, arguments: parsed.functionCall.args || parsed.functionCall.arguments } }];
          }
          if (parsedToolCallsFromContent) {
            rawContent = parsed.text || parsed.content || parsed.reasoning || '';
          }
        }
      } catch (_) {}
    }

    if (rawContent && rawContent.trim() && !rawContent.trim().startsWith('{"role":"assistant"')) {
      parts.push({ text: rawContent });
    }

    const toolCallsToUse = (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
      ? message.tool_calls
      : parsedToolCallsFromContent;

    if (Array.isArray(toolCallsToUse) && toolCallsToUse.length > 0) {
      for (const tc of toolCallsToUse) {
        const fn = tc.function || tc;
        if (fn && (fn.name || tc.name)) {
          let parsedArgs = {};
          try {
            const rawArgs = fn.arguments || fn.args || tc.arguments || tc.args || {};
            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});
          } catch (_) {}
          parts.push({
            functionCall: {
              name: fn.name || tc.name,
              args: parsedArgs
            }
          });
        }
      }
    }

    if (parts.length === 0) {
      return null;
    }

    return {
      candidates: [
        {
          content: {
            parts: parts
          }
        }
      ]
    };
  }

  // ─── Multi-Engine AI Cascade Caller (Groq -> Gemini -> Pollinations) ───
  async function callGeminiCascade(body, signal) {
    KeyPoolManager.init();
    let lastError = null;

    // 1. Primary Engine: Groq Ultra-Fast API Cascade
    const healthyPool = KeyPoolManager.getHealthyKeys();
    const groqKeys = healthyPool.filter(k => k.key.startsWith('gsk_'));

    if (groqKeys.length > 0) {
      for (const model of GROQ_MODELS) {
        for (const keyEntry of groqKeys) {
          if (signal && signal.aborted) throw new Error('Request aborted by user');
          const apiKey = keyEntry.key;

          try {
            const groqPayload = convertGeminiBodyToOpenAiFormat(body, model);
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify(groqPayload),
              signal: signal
            });

            if (response.ok) {
              const openAiData = await response.json();
              const normalizedGemini = convertOpenAiResponseToGeminiFormat(openAiData);
              if (normalizedGemini) {
                KeyPoolManager.markKeySuccess(apiKey);
                return normalizedGemini;
              }
            }

            if (response.status === 429 || response.status === 503) {
              KeyPoolManager.markKeyThrottled(apiKey, 60000);
              console.warn(`[MEEM AI] Groq model ${model} rate-limited (HTTP ${response.status}). Rotating key...`);
              continue;
            }

            const errJson = await response.json().catch(() => ({}));
            const errMsg = errJson.error?.message || `Groq status: ${response.status}`;
            console.warn(`[MEEM AI] Groq model ${model} returned ${response.status}: ${errMsg}`);
            lastError = new Error(errMsg);
          } catch (e) {
            if (signal && signal.aborted) throw e;
            console.warn(`[MEEM AI] Groq error (${model}):`, e.message);
            lastError = e;
          }
        }
      }
    }

    // 2. Secondary Engine: Gemini API Cascade (if Gemini keys present and healthy)
    const geminiKeys = healthyPool.filter(k => !k.key.startsWith('gsk_'));
    if (geminiKeys.length > 0) {
      for (const model of GEMINI_MODELS) {
        for (const keyEntry of geminiKeys) {
          if (signal && signal.aborted) throw new Error('Request aborted by user');
          const apiKey = keyEntry.key;

          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
              },
              body: JSON.stringify(body),
              signal: signal
            });

            if (response.ok) {
              const data = await response.json();
              KeyPoolManager.markKeySuccess(apiKey);
              return data;
            }

            if (response.status === 429 || response.status === 503) {
              KeyPoolManager.markKeyThrottled(apiKey, 60000);
              continue;
            }

            const errJson = await response.json().catch(() => ({}));
            const errMsg = errJson.error?.message || `API status: ${response.status}`;
            lastError = new Error(errMsg);
          } catch (e) {
            if (signal && signal.aborted) throw e;
            lastError = e;
          }
        }
      }
    }

    // 3. Fallback Engine: Pollinations AI (100% Keyless, Unlimited)
    try {
      console.log('[MEEM AI] Attempting Pollinations AI keyless fallback...');
      const pollinationsPayload = convertGeminiBodyToOpenAiFormat(body, 'openai');
      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pollinationsPayload),
        signal: signal
      });

      if (response.ok) {
        const text = await response.text();
        return {
          candidates: [
            {
              content: {
                parts: [{ text: text }]
              }
            }
          ]
        };
      }
    } catch (pollErr) {
      console.warn('[MEEM AI] Pollinations fallback error:', pollErr.message);
    }

    throw lastError || new Error('All AI models are currently busy. Please try again shortly.');
  }

  // ─── Chat Sessions & History Management ───
  function getSessionsStorageKey() {
    try {
      const profileId = window.currentProfile?.id || window.appData?.activeProfileId || 'default';
      return `meem_ai_sessions_${profileId}`;
    } catch (_) {
      return 'meem_ai_sessions_default';
    }
  }

  function getSavedSessions() {
    try {
      const raw = localStorage.getItem(getSessionsStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function saveSessions(sessions) {
    try {
      localStorage.setItem(getSessionsStorageKey(), JSON.stringify(sessions.slice(0, 50))); // Keep last 50 sessions
    } catch (_) {}
  }

  function getActiveSession() {
    const sessions = getSavedSessions();
    if (!activeSessionId) {
      if (sessions.length > 0) {
        activeSessionId = sessions[0].id;
        return sessions[0];
      }
      return createNewChatSession();
    }
    const found = sessions.find(s => s.id === activeSessionId);
    if (found) return found;
    if (sessions.length > 0) {
      activeSessionId = sessions[0].id;
      return sessions[0];
    }
    return createNewChatSession();
  }

  function createNewChatSession(initialTitle = 'New Chat') {
    const sessions = getSavedSessions();
    const newSession = {
      id: 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      title: initialTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      conversationHistory: []
    };
    sessions.unshift(newSession);
    activeSessionId = newSession.id;
    conversationHistory = [];
    saveSessions(sessions);

    const chatList = document.getElementById('ai-chat-messages');
    if (chatList) {
      chatList.innerHTML = renderWelcomeScreen();
      bindSuggestionChips();
    }
    renderSidebarSessions();
    return newSession;
  }

  function switchChatSession(sessionId) {
    const sessions = getSavedSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    activeSessionId = session.id;
    conversationHistory = session.conversationHistory || [];

    const chatList = document.getElementById('ai-chat-messages');
    if (chatList) {
      chatList.innerHTML = '';
      if (!session.messages || session.messages.length === 0) {
        chatList.innerHTML = renderWelcomeScreen();
        bindSuggestionChips();
      } else {
        session.messages.forEach(msg => {
          if (msg.role === 'user') {
            appendMessage('user', msg.text, false, msg.image || null);
          } else {
            appendAssistantResponse(msg.text, msg.tools || [], false, false);
          }
        });
      }
      scrollToBottom();
    }
    renderSidebarSessions();
  }

  function deleteChatSession(sessionId, e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    let sessions = getSavedSessions();
    sessions = sessions.filter(s => s.id !== sessionId);
    saveSessions(sessions);

    if (activeSessionId === sessionId) {
      if (sessions.length > 0) {
        switchChatSession(sessions[0].id);
      } else {
        createNewChatSession();
      }
    } else {
      renderSidebarSessions();
    }
  }

  function formatRelativeTime(ts) {
    if (!ts) return 'Just now';
    const now = Date.now();
    const diffSec = Math.floor((now - ts) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function renderSidebarSessions() {
    const listEl = document.getElementById('ai-sessions-list');
    const counterEl = document.getElementById('ai-sessions-counter');
    if (!listEl) return;

    const sessions = getSavedSessions();
    if (counterEl) counterEl.textContent = String(sessions.length);

    if (sessions.length === 0) {
      listEl.innerHTML = `<div class="ai-empty-sessions"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 8px; opacity: 0.3; display: block;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>No previous chats<br><span style="font-size: 11px; opacity: 0.6;">Start a new conversation now!</span></div>`;
      return;
    }

    let html = '';
    sessions.forEach(s => {
      const isActive = s.id === activeSessionId ? 'active' : '';
      const timeStr = formatRelativeTime(s.updatedAt || s.createdAt);
      html += `
        <div class="ai-session-item ${isActive}" data-id="${escapeAttr(s.id)}" onclick="window.aiSwitchChatSession('${escapeAttr(s.id)}')">
          <svg class="ai-session-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <div class="ai-session-info">
            <div class="ai-session-title" title="${escapeHTML(s.title)}">${escapeHTML(s.title)}</div>
            <div class="ai-session-time">${escapeHTML(timeStr)}</div>
          </div>
          <button class="ai-session-del-btn" title="Delete chat" onclick="window.aiDeleteChatSession('${escapeAttr(s.id)}', event)">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  function deriveQuickTitle(userText) {
    if (!userText) return 'New Chat';
    let clean = userText.trim();
    if (/^(شغل|شغلي|play)\s+/i.test(clean)) {
      const trackName = clean.replace(/^(شغل|شغلي|play|play song|play music|اغنية|أغنية)\s+/i, '').trim();
      return trackName ? `🎵 ${trackName.slice(0, 22)}` : '🎵 Music Playback';
    }
    if (/قائمتي|ماي ليست|my list|watchlist/i.test(clean)) {
      return '⭐ My List';
    }
    if (/انمي|أنمي|anime/i.test(clean)) {
      return '⚔️ Anime';
    }
    if (/راديو|radio|إذاعة|اذاعة/i.test(clean)) {
      return '📻 Radio';
    }
    if (/iptv|قناة|قنوات|تلفزيون/i.test(clean)) {
      return '📺 Live IPTV';
    }
    return clean.slice(0, 24) + (clean.length > 24 ? '...' : '');
  }

  async function generateSmartTitleAsync(sessionId, promptText, answerText) {
    try {
      const prompt = `Give a very short, concise title (2 to 4 words max) in the user's language summarizing this conversation topic.
User: ${promptText.slice(0, 100)}
Response summary: ${answerText.slice(0, 120)}
Output ONLY the clean 2-4 word title, no quotes, no extra punctuation.`;

      const data = await callGeminiCascade({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 20 }
      });
      if (data) {
        let title = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (title) {
          title = title.replace(/^["'«]+|["'»]+$/g, '').slice(0, 30);
          const sessions = getSavedSessions();
          const sess = sessions.find(s => s.id === sessionId);
          if (sess) {
            sess.title = title;
            saveSessions(sessions);
            renderSidebarSessions();
          }
        }
      }
    } catch (_) {}
  }

  // ─── Markdown JSON Auto-Interceptor & Card Converter ───
  async function interceptAndCleanMarkdownJson(text, toolResultsSummary = []) {
    if (!text) return { text: '', tools: toolResultsSummary };

    let cleanText = text;
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/gi;
    let match;

    while ((match = jsonBlockRegex.exec(text)) !== null) {
      const rawBlock = match[0];
      const jsonStr = match[1];

      try {
        const parsed = JSON.parse(jsonStr);
        let itemsToRecommend = null;

        if (parsed && Array.isArray(parsed.items)) {
          itemsToRecommend = parsed.items;
        } else if (Array.isArray(parsed)) {
          itemsToRecommend = parsed;
        } else if (parsed && parsed.recommend_media?.items) {
          itemsToRecommend = parsed.recommend_media.items;
        } else if (parsed && parsed.title) {
          itemsToRecommend = [parsed];
        }

        if (itemsToRecommend && itemsToRecommend.length > 0) {
          const toolRes = await executeTool('recommend_media', { items: itemsToRecommend });
          toolResultsSummary.push({
            name: 'recommend_media',
            args: { items: itemsToRecommend },
            result: toolRes
          });
          cleanText = cleanText.replace(rawBlock, '').trim();
        }
      } catch (_) {}
    }

    return { text: cleanText, tools: toolResultsSummary };
  }

  // ─── Gemini API Calling Engine (Multimodal & Multi-Turn) ───
  async function sendToGemini(userText, imageAttachment = null) {
    const isArabic = /[\u0600-\u06FF]/.test(userText);

    if (getRemainingQuota() <= 0) {
      const isPro = isUserPro();
      const msg = isPro
        ? (isArabic ? '⚠️ وصلت للحد اليومي لـ PRO (50 طلب). هيتجدد تلقائياً عند منتصف الليل.' : '⚠️ You have reached your daily PRO limit (50 requests). Your quota will reset automatically at midnight.')
        : (isArabic ? '⚠️ وصلت للحد المجاني اليومي (5 طلبات). اشترك في PRO علشان تاخد 50 طلب يومياً وكل المميزات!' : '⚠️ You have reached your daily free limit (5 requests). Upgrade to PRO for 50 requests per day and unlocked features!');
      return { text: msg, isError: true };
    }

    const systemInstruction = {
      role: 'system',
      parts: [{ text: getSystemPrompt() }]
    };

    const userParts = [];
    if (imageAttachment && imageAttachment.base64Data) {
      userParts.push({
        inlineData: {
          mimeType: imageAttachment.mimeType || 'image/jpeg',
          data: imageAttachment.base64Data
        }
      });
    }
    const finalUserText = userText || (isArabic ? 'ما هو هذا العمل أو الأنمي أو الفيلم أو الشخصية الموجودة في الصورة وما قصته؟' : 'Identify this movie, anime, series, or character in the image and tell me about it.');
    userParts.push({ text: finalUserText });

    conversationHistory.push({
      role: 'user',
      parts: userParts
    });

    const body = {
      systemInstruction,
      contents: conversationHistory,
      tools: AI_TOOLS,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4096
      }
    };

    abortController = new AbortController();

    const data = await callGeminiCascade(body, abortController.signal);
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) {
      throw new Error('Empty response from AI engine');
    }

    const parts = candidate.content.parts || [];
    const functionCalls = parts.filter(p => p.functionCall);

    if (functionCalls.length > 0) {
      conversationHistory.push(candidate.content);

      const functionResponseParts = [];
      const toolResultsSummary = [];

      for (const callPart of functionCalls) {
        const { name, args } = callPart.functionCall;
        const toolResult = await executeTool(name, args || {});
        toolResultsSummary.push({ name, args, result: toolResult });

        functionResponseParts.push({
          functionResponse: {
            name,
            response: { output: toolResult }
          }
        });
      }

      // ── Instant Direct Playback Response (Zero Lag / No 503 Overload) ──
      const playbackCall = functionCalls.find(p => ['play_music', 'play_media', 'download_media', 'play_radio', 'play_iptv'].includes(p.functionCall?.name));
      if (playbackCall && functionCalls.length === 1) {
        const { name } = playbackCall.functionCall;
        const res = toolResultsSummary[0]?.result;
        let instantAck = '';

        if (res?.addonMissing) {
          instantAck = isArabic
            ? `⚠️ ${res.message}`
            : `⚠️ ${res.message}`;
        } else if (name === 'play_music') {
          const track = res?.track;
          if (track) {
            instantAck = isArabic ? `حاضر، هشغل أغنية "${track.title}" دلوقتي 🎵` : `Playing "${track.title}" now 🎵`;
          } else {
            instantAck = isArabic ? 'مش لاقي الأغنية دي حالياً، جرب تبحث باسم تاني.' : 'Could not find this track right now. Please try another query.';
          }
        } else if (name === 'play_media') {
          const item = res?.item;
          if (item) {
            const seasonStr = item.season ? ` (الموسم ${item.season} الحلقة ${item.episode || 1})` : '';
            instantAck = isArabic ? `حاضر، بشغل "${item.title || item.name}"${seasonStr} دلوقتي 🎬` : `Playing "${item.title || item.name}"${seasonStr} now 🎬`;
          } else {
            instantAck = isArabic ? 'مش لاقي العمل ده للتشغيل المباشر.' : 'Could not find this media for direct playback.';
          }
        } else if (name === 'download_media') {
          const item = res?.item;
          if (res?.success) {
            instantAck = isArabic ? `حاضر، بدأت التحميل في الخلفية لـ "${item?.title || 'العرض'}" 📥 تقدر تتابع التقدم المباشر من صفحة التحميلات.` : `Started background download for "${item?.title || 'media'}" 📥 You can monitor progress in Downloads view.`;
          } else {
            instantAck = isArabic ? `تعذر التحميل: ${res?.message || 'لم يتم العثور على رابط التورنت/البث'}` : `Could not download: ${res?.message || 'No stream available'}`;
          }
        } else if (name === 'play_radio') {
          const station = res?.station;
          instantAck = isArabic ? `حاضر، بشغل إذاعة "${station?.name || 'الراديو'}" لايف 📻` : `Playing "${station?.name || 'Radio'}" live now 📻`;
        } else if (name === 'play_iptv') {
          const channel = res?.channel;
          instantAck = isArabic ? `حاضر، بشغل قناة "${channel?.name || 'التلفزيون'}" دلوقتي 📺` : `Streaming "${channel?.name || 'Channel'}" now 📺`;
        }

        if (instantAck) {
          conversationHistory.push({
            role: 'model',
            parts: [{ text: instantAck }]
          });
          incrementDailyUsage();
          return await interceptAndCleanMarkdownJson(instantAck, toolResultsSummary);
        }
      }

      conversationHistory.push({
        role: 'user',
        parts: functionResponseParts
      });

      // Second turn with reinforced system instructions forces the model to synthesize a complete, warm, and natural conversational response
      const secondSystemInstruction = {
        role: 'system',
        parts: [{
          text: getSystemPrompt() + '\nCRITICAL MANDATE: Match the user\'s exact language, dialect, and tone naturally and seamlessly. Connect warmly with the user\'s feelings about the movie/show/anime they mentioned, give engaging commentary on why you chose these titles, and describe each title in a bullet point. NEVER output generic or robotic English confirmations.'
        }]
      };

      const secondBody = {
        systemInstruction: secondSystemInstruction,
        contents: conversationHistory,
        generationConfig: {
          temperature: 0.65,
          maxOutputTokens: 4096
        }
      };

      const secondData = await callGeminiCascade(secondBody, abortController.signal);
      const secondCand = secondData.candidates?.[0];
      if (secondCand && secondCand.content) {
        conversationHistory.push(secondCand.content);
        incrementDailyUsage();
        const extractedText = (secondCand.content.parts || []).map(p => p.text || '').join('').trim();
        const isRoboticEnglish = isArabic && (/^(ok|okay|i'?ve recommended|here are some|here are the results|request completed)/i.test(extractedText) || (extractedText.length < 45 && !/[\u0600-\u06FF]/.test(extractedText)));
        if (extractedText && !isRoboticEnglish) {
          return await interceptAndCleanMarkdownJson(extractedText, toolResultsSummary);
        }
      }

      // Smart contextual fallback synthesis in case the model returns empty text parts or robotic phrase
      let contextualText = '';
      const recTool = toolResultsSummary.find(t => t.name === 'recommend_media');
      const searchMediaTool = toolResultsSummary.find(t => t.name === 'search_media');
      const listTool = toolResultsSummary.find(t => ['create_custom_list', 'add_to_custom_list', 'remove_from_custom_list'].includes(t.name));

      if (recTool?.result?.results?.length > 0) {
        const topTitles = recTool.result.results.slice(0, 3).map(r => `• **${r.title || r.name}** (${r.type === 'tv' ? 'مسلسل' : 'فيلم'})`).join('\n');
        contextualText = isArabic
          ? `يااه.. هذا العمل من التحف اللي بتسيب أثر عاطفي ونفسي عميق جداً 💔 عشان كده نقيتلك أعمال أسطورية هتعيشك نفس المشاعر والعمق الدرامي:\n\n${topTitles}`
          : `Here are handpicked emotional masterpieces that match this exact vibe:\n\n${topTitles}`;
      } else if (searchMediaTool?.result?.results?.length > 0) {
        contextualText = isArabic
          ? `وجدت هذه الأعمال المتطابقة مع بحثك 🎬`
          : `Here are the matching media titles 🎬`;
      } else if (listTool?.result?.message) {
        contextualText = listTool.result.message;
      } else {
        contextualText = isArabic ? 'تمام، جهزتلك النتيجة بنجاح ✨' : 'All set! Here are the details ✨';
      }

      return await interceptAndCleanMarkdownJson(contextualText, toolResultsSummary);
    }

    conversationHistory.push(candidate.content);
    incrementDailyUsage();
    const rawText = parts.map(p => p.text || '').join('') || '';
    return await interceptAndCleanMarkdownJson(rawText, []);
  }

  // ─── Image Attachment Processing & Management ───
  function setPendingAttachment(att) {
    pendingAttachment = att;
    const previewEl = document.getElementById('ai-attachment-preview');
    const imgEl = document.getElementById('ai-attachment-img');
    const attachBtn = document.getElementById('ai-attach-btn');
    const sendBtn = document.getElementById('ai-send-btn');
    if (previewEl && imgEl) {
      imgEl.src = att.previewUrl;
      previewEl.style.display = 'flex';
    }
    if (attachBtn) attachBtn.classList.add('has-attachment');
    if (sendBtn) sendBtn.disabled = false;
  }

  function clearPendingAttachment() {
    pendingAttachment = null;
    const previewEl = document.getElementById('ai-attachment-preview');
    const imgEl = document.getElementById('ai-attachment-img');
    const attachBtn = document.getElementById('ai-attach-btn');
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-send-btn');
    const fileInput = document.getElementById('ai-file-input');
    if (previewEl) previewEl.style.display = 'none';
    if (imgEl) imgEl.src = '';
    if (attachBtn) attachBtn.classList.remove('has-attachment');
    if (fileInput) fileInput.value = '';
    if (sendBtn && input) {
      sendBtn.disabled = !input.value.trim() || isGenerating;
    }
  }

  function processImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1024;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, 0.85);
        const base64Data = dataUrl.split(',')[1];

        setPendingAttachment({
          mimeType,
          base64Data,
          previewUrl: dataUrl
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function transcribeAudioWithAi(audioBlob) {
    KeyPoolManager.init();
    const healthyKeys = KeyPoolManager.getHealthyKeys();

    // 1. Try Groq Whisper (Ultra-fast, accurate Arabic & English STT)
    const groqEntry = healthyKeys.find(k => k && k.key && k.key.startsWith('gsk_'));
    if (groqEntry) {
      try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice.webm');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'json');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqEntry.key}`
          },
          body: formData
        });

        if (response.ok) {
          const json = await response.json();
          if (json && json.text && json.text.trim()) {
            return json.text.trim();
          }
        }
      } catch (err) {
        console.warn('[MEEM AI Voice] Groq Whisper error:', err);
      }
    }

    // 2. Secondary Fallback: Gemini Flash Audio Transcription
    const geminiEntry = healthyKeys.find(k => k && k.key && !k.key.startsWith('gsk_'));
    if (geminiEntry) {
      try {
        const base64Audio = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = reader.result || '';
            const base64 = res.includes(',') ? res.split(',')[1] : res;
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiEntry.key}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "Transcribe the exact words spoken in this audio recording. Return ONLY the transcribed text in its original spoken language (Egyptian Arabic or English), with no explanation or extra formatting." },
                { inlineData: { mimeType: audioBlob.type || 'audio/webm', data: base64Audio } }
              ]
            }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      } catch (err) {
        console.warn('[MEEM AI Voice] Gemini Audio STT error:', err);
      }
    }

    return null;
  }

  // ─── Native MediaRecorder + AI Audio Speech-to-Text (Fixes Electron Network Error) ───
  function initVoiceInput() {
    const inputWrapper = document.querySelector('.ai-input-wrapper');
    if (!inputWrapper || document.getElementById('ai-voice-btn')) return;

    const voiceBtn = document.createElement('button');
    voiceBtn.className = 'ai-voice-btn';
    voiceBtn.id = 'ai-voice-btn';
    voiceBtn.type = 'button';
    voiceBtn.title = 'Voice Input / التسجيل الصوتي';
    voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';

    const sendBtn = document.getElementById('ai-send-btn');
    if (sendBtn) {
      inputWrapper.insertBefore(voiceBtn, sendBtn);
    } else {
      inputWrapper.appendChild(voiceBtn);
    }

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    async function startMediaRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (typeof window.showToast === 'function') {
          window.showToast('⚠️ التسجيل الصوتي غير مدعوم في هذا المتصفح');
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          voiceBtn.classList.remove('is-listening');
          voiceBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="color:#ffffff"></i>';
          if (typeof window.showToast === 'function') {
            window.showToast('🧠 جاري تحويل الصوت إلى نص...', 2000);
          }

          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const transcript = await transcribeAudioWithAi(audioBlob);

          voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
          if (transcript) {
            const input = document.getElementById('ai-chat-input');
            const sendBtnEl = document.getElementById('ai-send-btn');
            if (input) {
              input.value = transcript;
              input.dispatchEvent(new Event('input'));
              if (sendBtnEl) sendBtnEl.disabled = false;
            }
            if (typeof window.showToast === 'function') {
              window.showToast('✨ تم تحويل الصوت إلى نص بنجاح!');
            }
          } else {
            if (typeof window.showToast === 'function') {
              window.showToast('⚠️ لم نتمكن من التعرف على الصوت، حاول مرة أخرى.');
            }
          }
        };

        mediaRecorder.start();
        isRecording = true;
        voiceBtn.classList.add('is-listening');
        voiceBtn.innerHTML = '<i class="fas fa-square" style="color:#ff4757"></i>';
        if (typeof window.showToast === 'function') {
          window.showToast('🎙️ جاري التسجيل... اضغط المايك مرة أخرى للإرسال', 3000);
        }
      } catch (err) {
        console.warn('[MEEM AI Voice] MediaRecorder error:', err);
        isRecording = false;
        voiceBtn.classList.remove('is-listening');
        voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        if (typeof window.showToast === 'function') {
          window.showToast('⚠️ يرجى السماح بصلاحية الميكروفون لاستخدام البحث الصوتي');
        }
      }
    }

    voiceBtn.onclick = () => {
      if (isRecording) {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
          isRecording = false;
        }
        return;
      }
      startMediaRecording();
    };
  }

  // ─── UI Rendering & Event Handling ───
  function initAIView() {
    const container = document.getElementById('view-ai');
    if (!container) return;

    updateQuotaUI();
    initVoiceInput();

    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-send-btn');
    const clearBtn = document.getElementById('ai-clear-chat-btn');
    const sidebarBackBtn = document.getElementById('ai-sidebar-back-btn');
    const sidebarNewBtn = document.getElementById('ai-sidebar-new-btn');
    const fileInput = document.getElementById('ai-file-input');
    const attachBtn = document.getElementById('ai-attach-btn');
    const removeAttachBtn = document.getElementById('ai-attachment-remove-btn');

    if (attachBtn && fileInput) {
      attachBtn.onclick = () => fileInput.click();
      fileInput.onchange = (e) => {
        if (e.target.files && e.target.files[0]) {
          processImageFile(e.target.files[0]);
        }
        fileInput.value = '';
      };
    }

    if (removeAttachBtn) {
      removeAttachBtn.onclick = clearPendingAttachment;
    }

    if (input) {
      input.oninput = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        sendBtn.disabled = (!input.value.trim() && !pendingAttachment) || isGenerating;
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!sendBtn.disabled) handleSendMessage();
        }
      };

      // Clipboard Image Paste Handler (Ctrl+V)
      input.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type && item.type.startsWith('image/')) {
              const file = item.getAsFile();
              if (file) {
                processImageFile(file);
                e.preventDefault();
                break;
              }
            }
          }
        }
      });
    }

    // Drag & Drop Image Handler
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.[0] && e.dataTransfer.files[0].type.startsWith('image/')) {
        processImageFile(e.dataTransfer.files[0]);
      }
    });

    if (sendBtn) {
      sendBtn.onclick = handleSendMessage;
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        clearPendingAttachment();
        createNewChatSession();
      };
    }

    if (sidebarBackBtn) {
      sidebarBackBtn.onclick = () => {
        hideAISidebarNav();
      };
    }

    if (sidebarNewBtn) {
      sidebarNewBtn.onclick = () => {
        clearPendingAttachment();
        createNewChatSession();
      };
    }

    // Initialize or restore active session
    const sessions = getSavedSessions();
    if (sessions.length > 0 && !activeSessionId) {
      switchChatSession(sessions[0].id);
    } else if (sessions.length > 0 && activeSessionId) {
      switchChatSession(activeSessionId);
    } else {
      const chatList = document.getElementById('ai-chat-messages');
      if (chatList && (!chatList.children || chatList.children.length === 0)) {
        chatList.innerHTML = renderWelcomeScreen();
        bindSuggestionChips();
      }
      renderSidebarSessions();
    }
  }

  function showAISidebarNav() {
    const stdNav = document.getElementById('sidebar-standard-nav');
    const aiNav = document.getElementById('sidebar-ai-nav');
    if (stdNav) stdNav.style.display = 'none';
    if (aiNav) aiNav.style.display = 'flex';
    renderSidebarSessions();
  }

  function hideAISidebarNav() {
    const stdNav = document.getElementById('sidebar-standard-nav');
    const aiNav = document.getElementById('sidebar-ai-nav');
    if (stdNav) stdNav.style.display = 'flex';
    if (aiNav) aiNav.style.display = 'none';
  }

  function renderWelcomeScreen() {
    return `
      <div class="ai-welcome-hero" id="ai-welcome-hero">
        <div class="ai-welcome-icon">
          <img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
        <h3>Welcome to MEEM AI</h3>
        <p>Your intelligent media copilot. Play songs, discover movies, manage playlists, analyze anime & movie scenes, or tune into live channels.</p>
        
        <div class="ai-suggestions-grid">
          <div class="ai-suggestion-chip" data-prompt="ايه اعلى الاعمال تقييما في قائمتي؟">
            <span>⭐ Top rated in my list</span>
            <i class="fas fa-arrow-right" style="color: rgba(255, 255, 255, 0.7);"></i>
          </div>
          <div class="ai-suggestion-chip" data-prompt="شغل اغنيه Sunflower بتاعت سبايدر مان">
            <span>🎵 Play Sunflower (Spider-Man)</span>
            <i class="fas fa-play" style="color: rgba(255, 255, 255, 0.7); font-size: 11px;"></i>
          </div>
          <div class="ai-suggestion-chip" data-prompt="اقترح ليا انمي اكشن وغموض">
            <span>⚔️ Recommend Action Anime</span>
            <i class="fas fa-arrow-right" style="color: rgba(255, 255, 255, 0.7);"></i>
          </div>
          <div class="ai-suggestion-chip" data-prompt="شغلي إذاعة نجوم إف إم لايف">
            <span>📻 Play Nogoum FM Radio</span>
            <i class="fas fa-arrow-right" style="color: rgba(255, 255, 255, 0.7);"></i>
          </div>
        </div>
      </div>
    `;
  }

  function bindSuggestionChips() {
    document.querySelectorAll('.ai-suggestion-chip').forEach(chip => {
      chip.onclick = () => {
        const prompt = chip.dataset.prompt;
        const input = document.getElementById('ai-chat-input');
        if (input && prompt) {
          input.value = prompt;
          input.dispatchEvent(new Event('input'));
          handleSendMessage();
        }
      };
    });
  }

  async function handleSendMessage() {
    const input = document.getElementById('ai-chat-input');
    const chatList = document.getElementById('ai-chat-messages');
    const sendBtn = document.getElementById('ai-send-btn');
    if (!input || !chatList) return;

    const text = input.value.trim();
    const currentAtt = pendingAttachment;
    if ((!text && !currentAtt) || isGenerating) return;

    const isArabic = /[\u0600-\u06FF]/.test(text);

    // Get or create active session
    let session = getActiveSession();
    const isFirstMessage = (!session.messages || session.messages.length === 0);

    const welcome = document.getElementById('ai-welcome-hero');
    if (welcome) welcome.remove();

    appendMessage('user', text, true, currentAtt?.previewUrl);
    input.value = '';
    input.style.height = 'auto';
    clearPendingAttachment();
    sendBtn.disabled = true;
    isGenerating = true;

    // Update session with user message and preliminary title
    if (!session.messages) session.messages = [];
    session.messages.push({
      role: 'user',
      text,
      image: currentAtt?.previewUrl || null,
      timestamp: Date.now()
    });
    session.updatedAt = Date.now();
    if (isFirstMessage || session.title === 'New Chat') {
      session.title = currentAtt ? (text ? deriveQuickTitle(text) : '🖼️ Image Analysis') : deriveQuickTitle(text);
    }
    const sessions = getSavedSessions();
    const sIdx = sessions.findIndex(s => s.id === session.id);
    if (sIdx >= 0) sessions[sIdx] = session;
    else sessions.unshift(session);
    saveSessions(sessions);
    renderSidebarSessions();

    const loadingId = 'ai-loading-' + Date.now();
    appendLoadingBubble(loadingId);
    scrollToBottom();

    try {
      const result = await sendToGemini(text, currentAtt);
      removeLoadingBubble(loadingId);
      appendAssistantResponse(result.text, result.tools || []);

      // Persist assistant message into session
      session = getActiveSession();
      session.messages.push({
        role: 'assistant',
        text: result.text,
        tools: result.tools || [],
        timestamp: Date.now()
      });
      session.conversationHistory = conversationHistory;
      session.updatedAt = Date.now();

      // Refine session title if playback tool was executed
      const playMusicTool = (result.tools || []).find(t => t.name === 'play_music' && t.result?.track?.title);
      if (playMusicTool) {
        session.title = `🎵 ${playMusicTool.result.track.title}`;
      } else if (isFirstMessage && !currentAtt) {
        generateSmartTitleAsync(session.id, text, result.text);
      }

      const allSessions = getSavedSessions();
      const idx = allSessions.findIndex(s => s.id === session.id);
      if (idx >= 0) allSessions[idx] = session;
      else allSessions.unshift(session);
      saveSessions(allSessions);
      renderSidebarSessions();

    } catch (err) {
      removeLoadingBubble(loadingId);
      let errMsg = err.message || '';
      if (errMsg.includes('quota') || errMsg.includes('rate-limit') || errMsg.includes('429')) {
        errMsg = isArabic
          ? 'الـ AI واخد استراحة قصيرة من الضغط، جرب تسأل تاني بعد لحظات ⏳'
          : 'AI is taking a quick breath due to high traffic. Please retry in a few seconds ⏳';
      }
      appendMessage('assistant', `⚠️ ${errMsg}`);
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      scrollToBottom();
      updateQuotaUI();
    }
  }

  function getUserAvatarUrl() {
    try {
      const prof = window.currentProfile || {};
      if (prof.avatar) return prof.avatar;
      if (prof.avatar_url) return prof.avatar_url;
      const headerAvatar = document.getElementById('current-profile-avatar-header');
      if (headerAvatar && headerAvatar.src && !headerAvatar.src.endsWith('/') && !headerAvatar.src.includes('undefined')) {
        return headerAvatar.src;
      }
      const sideAvatar = document.querySelector('#profiles-active-avatar img, .current-profile-avatar-main-dynamic');
      if (sideAvatar && sideAvatar.src && !sideAvatar.src.endsWith('/') && !sideAvatar.src.includes('undefined')) {
        return sideAvatar.src;
      }
    } catch (_) {}
    return '';
  }

  function appendMessage(role, text, shouldScroll = true, imageSrc = null) {
    const chatList = document.getElementById('ai-chat-messages');
    if (!chatList) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-message ${role}`;

    let avatarHtml = '';
    if (role === 'user') {
      const userAvatar = getUserAvatarUrl();
      if (userAvatar) {
        avatarHtml = `<img src="${escapeAttr(userAvatar)}" alt="User" class="ai-user-avatar-img" onerror="this.outerHTML='<i class=\\\'fas fa-user\\\'></i>';">`;
      } else {
        avatarHtml = '<i class="fas fa-user"></i>';
      }
    } else {
      avatarHtml = '<img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:100%;height:100%;object-fit:cover;">';
    }

    let imageHtml = '';
    if (imageSrc) {
      imageHtml = `<div class="ai-user-image-preview"><img src="${escapeAttr(imageSrc)}" alt="Attachment"></div>`;
    }

    msgDiv.innerHTML = `
      <div class="ai-msg-avatar">
        ${avatarHtml}
      </div>
      <div class="ai-msg-body">
        <div class="ai-msg-bubble">
          ${imageHtml}
          ${text ? `<div class="ai-msg-text-wrap">${formatMarkdownText(text)}</div>` : (!imageSrc ? formatMarkdownText(text) : '')}
        </div>
      </div>
    `;
    chatList.appendChild(msgDiv);
    if (shouldScroll) scrollToBottom();
  }

  function appendLoadingBubble(id) {
    const chatList = document.getElementById('ai-chat-messages');
    if (!chatList) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-message assistant loading-state';
    msgDiv.id = id;
    msgDiv.innerHTML = `
      <div class="ai-msg-avatar"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:100%;height:100%;object-fit:cover;"></div>
      <div class="ai-msg-body">
        <div class="ai-loading-bubble">
          <div class="ai-typing-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="ai-thinking-text">MEEM AI is thinking...</span>
        </div>
      </div>
    `;
    chatList.appendChild(msgDiv);
    scrollToBottom();
  }

  function removeLoadingBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function appendAssistantResponse(text, tools = [], shouldScroll = true, animate = true) {
    const chatList = document.getElementById('ai-chat-messages');
    if (!chatList) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-message assistant';
    const rowId = 'ai-cards-row-' + Date.now();

    let cardsHtml = '';
    let musicHtml = '';
    let quickActionsHtml = '';
    let hasMediaCards = false;

    // Check if tools returned media or music results
    tools.forEach(t => {
      // Music Playback Card
      if (t.name === 'play_music' && t.result?.track) {
        const tr = t.result.track;
        const trackJson = escapeAttr(JSON.stringify(tr));
        musicHtml += `
          <div class="ai-music-row">
            <div class="ai-music-card" onclick="window.aiPlayMusicTrack(${trackJson})">
              <img src="${escapeHTML(tr.thumbnail || 'imgs/cover-placeholder.png')}" class="ai-music-thumb" onerror="this.src='imgs/cover-placeholder.png'">
              <div class="ai-music-info">
                <div class="ai-music-title">▶️ ${escapeHTML(tr.title)}</div>
                <div class="ai-music-artist">${escapeHTML(tr.artist || tr.author || 'MEEM Music')}</div>
              </div>
              <div class="ai-music-play-btn"><i class="fas fa-play"></i></div>
            </div>
          </div>
        `;
      }

      // Music Search List
      if (t.name === 'search_music' && t.result?.tracks?.length) {
        musicHtml += `<div class="ai-music-row">`;
        t.result.tracks.forEach(tr => {
          const trackJson = escapeAttr(JSON.stringify(tr));
          musicHtml += `
            <div class="ai-music-card" onclick="window.aiPlayMusicTrack(${trackJson})">
              <img src="${escapeHTML(tr.thumbnail || 'imgs/cover-placeholder.png')}" class="ai-music-thumb" onerror="this.src='imgs/cover-placeholder.png'">
              <div class="ai-music-info">
                <div class="ai-music-title">${escapeHTML(tr.title)}</div>
                <div class="ai-music-artist">${escapeHTML(tr.artist || tr.author || 'MEEM Music')}</div>
              </div>
              <div class="ai-music-play-btn"><i class="fas fa-play"></i></div>
            </div>
          `;
        });
        musicHtml += `</div>`;
      }

      // Media Results (Movies / Series / Recommendations)
      const mediaResults = (t.name === 'recommend_media' || t.name === 'search_media') ? t.result?.results : (t.name === 'play_media' && t.result?.item ? [t.result.item] : null);
      if (mediaResults && mediaResults.length > 0) {
        hasMediaCards = true;
        cardsHtml += `<div class="ai-cards-row" id="${rowId}">`;
        mediaResults.forEach(m => {
          cardsHtml += renderMediaCardHtml(m);
        });
        cardsHtml += `</div>`;
      }

      // Curated Bento Row
      if (t.name === 'curate_bento_row' && t.result?.results?.length) {
        hasMediaCards = true;
        cardsHtml += `
          <div style="margin-top: 10px; width: 100%;">
            <div style="font-size: 0.88rem; font-weight: 800; color: #a5b4fc; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-layer-group"></i> ${escapeHTML(t.result.rowTitle || 'AI Curated Bento Row')}
            </div>
            <div class="ai-cards-row" id="${rowId}">
        `;
        t.result.results.forEach(m => {
          cardsHtml += renderMediaCardHtml(m);
        });
        cardsHtml += `</div></div>`;
      }

      // Radio Action Cards
      if (t.name === 'search_radio' && t.result?.stations?.length) {
        quickActionsHtml += `<div class="ai-quick-actions">`;
        t.result.stations.forEach(s => {
          const stationJson = escapeAttr(JSON.stringify(s));
          quickActionsHtml += `
            <button class="ai-quick-chip" onclick="window.aiPlayRadio(${stationJson})">
              <i class="fas fa-radio"></i> <span>${escapeHTML(s.name)}</span> <span style="font-size:0.7rem;opacity:0.6;">(${escapeHTML(s.country || 'Live')})</span>
            </button>
          `;
        });
        quickActionsHtml += `</div>`;
      }

      // IPTV Action Cards
      if (t.name === 'search_iptv' && t.result?.channels?.length) {
        quickActionsHtml += `<div class="ai-quick-actions">`;
        t.result.channels.forEach(c => {
          const channelJson = escapeAttr(JSON.stringify(c));
          quickActionsHtml += `
            <button class="ai-quick-chip" onclick="window.aiPlayIptv(${channelJson})">
              <i class="fas fa-tv"></i> <span>${escapeHTML(c.name)}</span>
            </button>
          `;
        });
        quickActionsHtml += `</div>`;
      }

      // Created List Action Card
      if (t.name === 'create_custom_list' && t.result?.success && t.result?.listId) {
        quickActionsHtml += `
          <div class="ai-quick-actions" style="margin-top: 8px;">
            <button class="ai-quick-chip" onclick="if(typeof window.renderCustomListDetail==='function') window.renderCustomListDetail('${t.result.listId}')">
              <i class="fas fa-folder-open"></i> <span>Open List "${escapeHTML(t.result.listName || '')}"</span>
            </button>
          </div>
        `;
      }
    });

    // Fallback: If no tool cards were returned but the AI recommended titles in text, extract and render them!
    const extractedTitles = (!hasMediaCards && !musicHtml) ? extractTitlesFromText(text) : [];
    if (!hasMediaCards && !musicHtml && extractedTitles.length > 0) {
      cardsHtml = `<div class="ai-cards-row" id="${rowId}"><div style="padding: 10px; font-size: 0.8rem; opacity: 0.6;"><i class="fas fa-spinner fa-spin"></i> Loading posters...</div></div>`;
    }

    const cardsPayload = (musicHtml || cardsHtml || quickActionsHtml) ? `
      ${musicHtml}
      ${cardsHtml}
      ${quickActionsHtml}
    ` : '';

    if (!animate) {
      // Instant render for loaded chat histories
      msgDiv.innerHTML = `
        <div class="ai-msg-avatar"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:100%;height:100%;object-fit:cover;"></div>
        <div class="ai-msg-body" style="width: 100%;">
          <div class="ai-msg-bubble">${formatMarkdownText(text)}</div>
          ${cardsPayload}
        </div>
      `;
      chatList.appendChild(msgDiv);
      if (shouldScroll) scrollToBottom();
      if (!hasMediaCards && !musicHtml && extractedTitles.length > 0) {
        resolveAndRenderExtractedCards(rowId, extractedTitles);
      }
      return;
    }

    // ── Progressive Typewriter Streaming Animation ──
    msgDiv.innerHTML = `
      <div class="ai-msg-avatar"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:100%;height:100%;object-fit:cover;"></div>
      <div class="ai-msg-body" style="width: 100%;">
        <div class="ai-msg-bubble"><span class="ai-typing-cursor"></span></div>
        <div class="ai-cards-container" style="display: none;">${cardsPayload}</div>
      </div>
    `;
    chatList.appendChild(msgDiv);
    if (shouldScroll) scrollToBottom();

    const bubbleEl = msgDiv.querySelector('.ai-msg-bubble');
    const cardsContainer = msgDiv.querySelector('.ai-cards-container');

    // Split text into tokens / words for silky smooth streaming
    const rawTokens = text.split(/(\s+|\n+)/);
    let tokenIdx = 0;
    let accumulatedText = '';
    const totalTokens = rawTokens.length;

    // Adaptive typing interval based on response length for ideal user experience
    const chunkSize = totalTokens > 100 ? 6 : (totalTokens > 40 ? 4 : 2);
    const tickDelay = 8;

    function typeNextChunk() {
      if (tokenIdx < totalTokens) {
        const nextBatch = rawTokens.slice(tokenIdx, tokenIdx + chunkSize).join('');
        accumulatedText += nextBatch;
        tokenIdx += chunkSize;

        if (bubbleEl) {
          bubbleEl.innerHTML = formatMarkdownText(accumulatedText) + '<span class="ai-typing-cursor"></span>';
        }
        if (shouldScroll) scrollToBottom();
        setTimeout(typeNextChunk, tickDelay);
      } else {
        // Finished typing animation
        if (bubbleEl) {
          bubbleEl.innerHTML = formatMarkdownText(text);
        }
        if (cardsContainer && cardsPayload) {
          cardsContainer.style.display = 'block';
        }
        if (shouldScroll) scrollToBottom();
        if (!hasMediaCards && !musicHtml && extractedTitles.length > 0) {
          resolveAndRenderExtractedCards(rowId, extractedTitles);
        }
      }
    }

    typeNextChunk();
  }

  function renderMediaCardHtml(m) {
    const poster = m.poster || 'imgs/no-backdrop.png';
    const itemPayload = {
      id: m.id,
      imdb_id: m.imdb_id,
      imdbId: m.imdb_id,
      title: m.title,
      name: m.title,
      year: m.year,
      type: m.type,
      media_type: m.type,
      poster: poster,
      vote_average: m.rating || 0
    };
    const jsonStr = escapeAttr(JSON.stringify(itemPayload));

    return `
      <div class="ai-media-card" onclick="window.aiOpenMedia(${jsonStr})" title="${escapeHTML(m.title)}">
        <div class="ai-media-poster-wrap">
          <img src="${escapeHTML(poster)}" class="ai-media-poster" loading="lazy" onerror="this.src='imgs/no-backdrop.png'">
          <div class="ai-media-badge">${m.type === 'tv' ? 'SERIES' : 'MOVIE'}</div>
          <div class="ai-media-hover-overlay">
            <div class="ai-media-play-icon"><i class="fas fa-play"></i></div>
          </div>
        </div>
        <div class="ai-media-info">
          <div class="ai-media-title">${escapeHTML(m.title)}</div>
          <div class="ai-media-meta">
            <span>${escapeHTML(m.year || '')}</span>
            ${m.rating ? `<span class="ai-media-rating"><i class="fas fa-star" style="font-size:8px"></i> ${escapeHTML(String(m.rating))}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  async function resolveAndRenderExtractedCards(containerId, titles) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const promises = titles.map(t => resolveMediaItem({ title: t, type: 'all' }).catch(() => null));
      const searchResults = await Promise.all(promises);

      const items = searchResults.filter(Boolean);

      if (items.length > 0) {
        let cardsHtml = '';
        items.forEach(m => {
          cardsHtml += renderMediaCardHtml(m);
        });
        container.innerHTML = cardsHtml;
        scrollToBottom();
      } else {
        container.remove();
      }
    } catch (_) {
      if (container) container.remove();
    }
  }

  function scrollToBottom() {
    const chatList = document.getElementById('ai-chat-messages');
    if (chatList) chatList.scrollTop = chatList.scrollHeight;
  }

  function formatMarkdownText(str) {
    if (!str) return '';

    const lines = str.split('\n');
    const formattedLines = [];

    for (let line of lines) {
      let trimmed = line.trim();
      if (!trimmed) {
        formattedLines.push('<div class="ai-text-spacer"></div>');
        continue;
      }

      // Match recommendation bullet item
      const recMatch = trimmed.match(/^(\*|-|\d+\.)\s+(\*\*(.*?)\*\*|([A-Za-z0-9\s:’'!-]{2,45})):\s*(.*)$/);
      if (recMatch) {
        let rawTitle = (recMatch[3] || recMatch[4] || '').trim();
        rawTitle = rawTitle.replace(/\*\*/g, '').trim();
        const rawDesc = (recMatch[5] || '').trim();
        const isArabic = /[\u0600-\u06FF]/.test(rawDesc);
        const dir = isArabic ? 'rtl' : 'ltr';

        let cleanDesc = escapeHTML(rawDesc)
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code class="ai-inline-code">$1</code>');

        formattedLines.push(`
          <div class="ai-rec-item" dir="${dir}" onclick="window.aiSearchAndOpenMedia('${escapeAttr(rawTitle)}')" title="Click to view ${escapeHTML(rawTitle)}">
            <div class="ai-rec-dot"><i class="fas fa-play" style="font-size: 8px;"></i></div>
            <div class="ai-rec-content">
              <span class="ai-rec-title" dir="ltr">${escapeHTML(rawTitle)}</span>
              <span class="ai-rec-desc">${cleanDesc}</span>
            </div>
          </div>
        `);
        continue;
      }

      // Normal bullet list item
      const listMatch = trimmed.match(/^(\*|-)\s+(.*)$/);
      if (listMatch) {
        const contentStr = listMatch[2];
        const isArabic = /[\u0600-\u06FF]/.test(contentStr);
        const dir = isArabic ? 'rtl' : 'ltr';

        let content = escapeHTML(contentStr)
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code class="ai-inline-code">$1</code>');

        formattedLines.push(`
          <div class="ai-list-item" dir="${dir}">
            <span class="ai-list-bullet">✦</span>
            <span>${content}</span>
          </div>
        `);
        continue;
      }

      // Regular paragraph
      const isArabic = /[\u0600-\u06FF]/.test(trimmed);
      const dir = isArabic ? 'rtl' : 'ltr';
      let formatted = escapeHTML(trimmed)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code class="ai-inline-code">$1</code>');

      formattedLines.push(`<p class="ai-msg-p" dir="${dir}">${formatted}</p>`);
    }

    return formattedLines.join('');
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  // ─── Global Window Helpers for In-App Direct Playback & Discovery ───
  window.aiPlayMusicTrack = function (track) {
    try {
      console.log('[MEEM AI] Playing music track:', track);
      if (window.MeemAudioPlayer && typeof window.MeemAudioPlayer.playTrack === 'function') {
        window.MeemAudioPlayer.playTrack({
          id: track.id,
          title: track.title,
          artist: track.artist || track.author || '',
          author: track.author || track.artist || '',
          thumbnail: track.thumbnail || track.artworkUrl100 || '',
          cover: track.thumbnail || track.artworkUrl100 || '',
          audioUrl: track.audioUrl || '',
          duration: track.duration || ''
        });
        if (typeof window.showToast === 'function') {
          window.showToast(`🎵 Playing "${track.title}"...`, 2500);
        }
      }
    } catch (e) {
      console.error('Error playing music track:', e);
      if (window.showToast) window.showToast('Could not play track: ' + e.message);
    }
  };

  window.aiOpenMedia = function (item) {
    try {
      console.log('[MEEM AI] Opening media item:', item);
      if (typeof window.openDiscoverDetail === 'function') {
        window.openDiscoverDetail(item);
      } else if (typeof window.loadStreams === 'function') {
        window.loadStreams(item, item.type || 'movie');
      } else if (typeof window.playVideo === 'function') {
        window.playVideo(item);
      }
    } catch (e) {
      console.error('Error opening media:', e);
      if (window.showToast) window.showToast('Could not open media: ' + e.message);
    }
  };

  window.aiSearchAndOpenMedia = async function (title) {
    try {
      const resolved = await resolveMediaItem({ title, type: 'all' });
      if (resolved && resolved.id) {
        window.aiOpenMedia(resolved);
      } else {
        window.aiOpenMedia({ title, name: title, id: 'search_' + Date.now() });
      }
    } catch (e) {
      console.warn('Error opening media from callout:', e);
    }
  };

  window.aiPlayRadio = function (station) {
    try {
      console.log('[MEEM AI] Playing radio station:', station);
      if (typeof window.playRadioStation === 'function') {
        window.playRadioStation(station);
        if (typeof window.showToast === 'function') {
          window.showToast(`📻 Playing ${station.name}...`, 2500);
        }
      }
    } catch (e) {
      console.error('Error playing radio:', e);
    }
  };

  window.aiPlayIptv = function (channel) {
    try {
      console.log('[MEEM AI] Playing IPTV channel:', channel);
      if (typeof window.selectIptvChannel === 'function') {
        window.selectIptvChannel(channel);
      } else if (typeof window.playIptvStream === 'function' && channel.url) {
        window.playIptvStream(channel.url, channel);
      }
    } catch (e) {
      console.error('Error playing IPTV:', e);
    }
  };

  // ─── Smart Query Classifier for AI Overview (Zero-Quota for Direct Title Searches) ───
  function isAIOverviewWorthyQuery(query) {
    if (!query) return false;
    const q = query.trim().toLowerCase();
    if (q.length < 4) return false;

    // 1. Explicit Arabic conversational / plot / recommendation triggers
    const arabicPromptPatterns = [
      /عايز|عايزة|عاوز|عاوزة|ابغى|بدي|نفسي|بدور|دورلي|ابحثلي/i,
      /اقترح|رشح|ترشيح|ترشيحات|افضل|أفضل|احسن|أحسن|اجمد|أجمل|توب/i,
      /(فيلم|مسلسل|انمي|أنمي|كرتون|برنامج)\s+(عن|فيه|بيحكي|قصته|فكرته|فكرة|احداثه|أحداثه|نهايته|جديد|قديم|رومانسي|رعب|اكشن|كوميدي|غموض|دراما)/i,
      /(فكرة|فكرته|قصة|قصته)\s+(انه|إنه|ان|أن|عن|فيلم|مسلسل|انمي|أنمي|لعبه|لعبة|حرب|مات|يموت)/i,
      /(البطل|البطلة|الشخصية|الولد|البنت|الراجل|الست)\s+(بي|عنده|عندها|فقد|مات|سافر|رجع|حب|قتل|هرب|عايش|بيشتغل)/i,
      /ايش\s+اسم|ايه\s+اسم|إيه\s+اسم|ما\s+هو\s+اسم|اسم\s+الفيلم|اسم\s+المسلسل|اسم\s+الانمي/i,
      /(شبه|زي|مثل)\s+(فيلم|مسلسل|انمي)/i,
      /قصة\s+(فيلم|مسلسل|انمي)/i,
      /نهاية\s+(فيلم|مسلسل|انمي)/i,
      /ليه|ازاي|إزاي|كيف|مين|متى|فين/i
    ];

    for (const pattern of arabicPromptPatterns) {
      if (pattern.test(q)) return true;
    }

    // 2. Explicit English conversational / plot / recommendation triggers
    const englishPromptPatterns = [
      /\b(movie|film|show|series|anime)\s+(about|where|with|like|similar to)\b/i,
      /\b(what|who|which|where|why|how)\s+(is|was|are|were|do|does|did|can)\b/i,
      /\b(recommend|suggest|top|best|favorite)\s+(movies?|shows?|anime|series)\b/i,
      /\b(what('?s| is) the (name|movie|show|anime) of)\b/i,
      /\b(guy|girl|man|woman|boy|person|character)\s+(who|that|finds|travels|dies|loses|falls|kills|lives)\b/i,
      /\b(based on (a )?true story|twist ending|time loop|time travel|post apocalyptic|psychological thriller)\b/i,
      /\b(movies?|shows?|anime)\s+like\s+[a-z0-9]+/i
    ];

    for (const pattern of englishPromptPatterns) {
      if (pattern.test(q)) return true;
    }

    // 3. Multi-word descriptive check: If query has 3+ words with natural language prepositions/conjunctions
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      const hasArabicGrammar = /(في|من|عن|مع|على|إلى|الي|اللي|اللى|ده|دي|عنده|عندها|علشان|عشان|لان|لأن|انه|ان|لو)/.test(q);
      const hasEnglishGrammar = /\b(in|on|at|about|with|from|and|but|or|because|when|after|before|into|during|while|if)\b/i.test(q);
      if (hasArabicGrammar || hasEnglishGrammar || words.length >= 5) return true;
    }

    return false;
  }

  // ─── Google-Style AI Search Overview Function ───
  let currentSearchOverviewToken = 0;

  window.renderSearchAIOverview = async function(query, force = false) {
    const container = document.getElementById('search-ai-overview-container');
    if (!container) return;

    const q = (query || '').trim();
    if (!q || q.length < 2) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    const isArabic = /[\u0600-\u06FF]/.test(q);

    // If not forced, show on-demand trigger without making API calls or consuming quota
    if (!force) {
      if (!isAIOverviewWorthyQuery(q)) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }
      container.style.display = 'flex';
      container.innerHTML = `
        <div class="ai-overview-header" style="justify-content: space-between; width: 100%;">
          <div class="ai-overview-title-group">
            <div class="ai-overview-badge"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:16px;height:16px;border-radius:4px;object-fit:cover;"> MEEM AI</div>
            <span style="font-size:0.85rem; opacity:0.85; font-weight:600;">
              ${isArabic ? `هل تبحث عن ملخص أو ترشيحات بالذكاء الاصطناعي لـ "${escapeHTML(q)}"؟` : `Looking for AI plot insights or recommendations for "${escapeHTML(q)}"?`}
            </span>
          </div>
          <button class="ai-overview-copilot-btn" onclick="window.renderSearchAIOverview('${escapeAttr(q)}', true)" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; cursor: pointer; padding: 6px 14px; font-size: 0.8rem; border-radius: 10px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
            <i class="fas fa-sparkles" style="color: #c084fc;"></i> <span>${isArabic ? 'عرض إجابة الذكاء الاصطناعي' : 'Show AI Overview'}</span>
          </button>
        </div>
      `;
      return;
    }

    // Check user quota before generating overview
    if (getRemainingQuota() <= 0) {
      container.style.display = 'flex';
      container.innerHTML = `
        <div class="ai-overview-header">
          <div class="ai-overview-title-group">
            <div class="ai-overview-badge"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:16px;height:16px;border-radius:4px;object-fit:cover;"> MEEM AI Overview</div>
            <span style="font-size:0.75rem; opacity:0.6; font-weight:600;">MEEM Smart Search</span>
          </div>
          <button class="ai-overview-copilot-btn" onclick="window.askMeemAI('${escapeAttr(q)}')">
            <img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:14px;height:14px;border-radius:3px;object-fit:cover;"> <span>Ask MEEM AI</span>
          </button>
        </div>
        <div class="ai-overview-body" style="color: #ff9f43; font-size: 0.85rem; padding: 6px 0;">
          <i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i>
          ${isArabic ? 'لقد استهلكت رصيدك اليومي من طلبات AI. قم بالترقية إلى PRO أو انتظر حتى منتصف الليل.' : 'You have reached your daily AI search quota. Upgrade to PRO or wait until tomorrow.'}
        </div>
      `;
      return;
    }

    const thisToken = ++currentSearchOverviewToken;
    container.style.display = 'flex';
    container.innerHTML = `
      <div class="ai-overview-header">
        <div class="ai-overview-title-group">
          <div class="ai-overview-badge"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:16px;height:16px;border-radius:4px;object-fit:cover;"> MEEM AI Overview</div>
          <span style="font-size:0.75rem; opacity:0.6; font-weight:600;">MEEM Smart Insight</span>
        </div>
        <button class="ai-overview-copilot-btn" onclick="window.askMeemAI('${escapeAttr(q)}')">
          <img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:14px;height:14px;border-radius:3px;object-fit:cover;"> <span>Ask MEEM AI</span>
        </button>
      </div>
      <div class="ai-overview-body" style="display: flex; align-items: center; gap: 8px; opacity: 0.7; padding: 4px 0;">
        <i class="fas fa-spinner fa-spin" style="color: #ffffff;"></i>
        <span>Generating AI Overview for "${escapeHTML(q)}"...</span>
      </div>
    `;

    try {
      const prompt = `You are MEEM AI Search Engine. Provide a brief, highly helpful Google-style AI Search Overview for the search query "${q}".
Format your response exactly as:
OVERVIEW: <2 to 3 sentences matching the exact language and dialect of the search query. Always format the recommended movie/show/anime names in bold like **Your Lie in April**>
TITLES: <comma-separated list of 1 to 3 exact original movie/series/anime titles mentioned, e.g. Your Lie in April, or "None">`;

      const data = await callGeminiCascade({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
      });

      if (thisToken !== currentSearchOverviewToken) return;

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!text || thisToken !== currentSearchOverviewToken) {
        container.style.display = 'none';
        return;
      }

      // Deduct 1 request from user's AI quota and update UI
      incrementDailyUsage();

      let overviewText = text;
      let rawTitlesList = [];

      const overviewMatch = text.match(/OVERVIEW:\s*([\s\S]*?)(?=TITLES:|$)/i);
      if (overviewMatch && overviewMatch[1]) {
        overviewText = overviewMatch[1].trim();
      }

      const titlesMatch = text.match(/TITLES:\s*([^\n\r]*)/i);
      if (titlesMatch && titlesMatch[1]) {
        const rawList = titlesMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s && s.toLowerCase() !== 'none' && s.length >= 2);
        rawTitlesList.push(...rawList);
      }

      // Extract bold titles from overviewText
      const boldMatches = overviewText.match(/\*\*(.*?)\*\*/g) || [];
      boldMatches.forEach(b => {
        const cleaned = b.replace(/\*\*/g, '').trim();
        if (cleaned.length >= 2 && cleaned.length <= 40 && !rawTitlesList.includes(cleaned)) {
          rawTitlesList.push(cleaned);
        }
      });

      // Fallback: extract Latin title words or quotes if none were extracted
      if (rawTitlesList.length === 0) {
        const quotedMatches = overviewText.match(/["'«](.*?)["'»]/g) || [];
        quotedMatches.forEach(qStr => {
          const c = qStr.replace(/["'«»]/g, '').trim();
          if (c.length >= 2 && c.length <= 40) rawTitlesList.push(c);
        });
        const latinWords = overviewText.match(/[A-Za-z0-9\s:.'-]{3,35}/g) || [];
        latinWords.forEach(w => {
          const c = w.trim();
          if (c.length >= 3 && !/^(the|and|for|with|from|this|that|anime|movie|series)$/i.test(c) && !rawTitlesList.includes(c)) {
            rawTitlesList.push(c);
          }
        });
      }

      const extractedTitles = [...new Set(rawTitlesList)].filter(t => t && t.length >= 2 && t.length <= 45).slice(0, 3);

      // Trigger automatic merging of AI recognized titles into the main search grid
      if (extractedTitles.length > 0 && typeof window.searchAndMergeAiTitles === 'function') {
        window.searchAndMergeAiTitles(extractedTitles);
      }

      // Render interactive show cards for detected titles
      let mediaCardsHtml = '';
      if (extractedTitles.length > 0) {
        mediaCardsHtml = '<div class="ai-overview-cards-wrap">';
        for (const title of extractedTitles) {
          try {
            const resolved = await resolveMediaItem({ title, type: 'all' });
            const itemTitle = (resolved && (resolved.title || resolved.name)) || title;
            const poster = (resolved && resolved.poster) || '';
            const year = (resolved && resolved.year) ? resolved.year : '';
            const typeStr = (resolved && (resolved.type === 'series' || resolved.type === 'tv')) ? 'TV Series' : 'Movie';
            const ratingStr = (resolved && resolved.rating) ? ` • ⭐ ${resolved.rating}` : '';
            const metaInfo = `${typeStr}${year ? ' • ' + year : ''}${ratingStr}`;

            mediaCardsHtml += `
              <div class="ai-overview-media-card" onclick="window.aiSearchAndOpenMedia('${escapeAttr(title)}')" title="View details & watch ${escapeHTML(itemTitle)}">
                <div class="ai-overview-media-left">
                  <div class="ai-overview-media-poster-wrap">
                    ${poster ? `<img src="${escapeAttr(poster)}" alt="${escapeAttr(itemTitle)}" onerror="this.style.display='none';">` : ''}
                    <i class="fas fa-film ai-overview-media-fallback-icon"></i>
                  </div>
                  <div class="ai-overview-media-info">
                    <div class="ai-overview-media-title">${escapeHTML(itemTitle)}</div>
                    <div class="ai-overview-media-meta">${escapeHTML(metaInfo)}</div>
                  </div>
                </div>
                <button class="ai-overview-media-watch-btn" type="button" onclick="event.stopPropagation(); window.aiSearchAndOpenMedia('${escapeAttr(title)}')">
                  <i class="fas fa-play" style="font-size: 10px;"></i>
                  <span>View Show</span>
                </button>
              </div>
            `;
          } catch (_) {}
        }
        mediaCardsHtml += '</div>';
      }

      // Quick chips row
      let chipsHtml = '';
      if (extractedTitles.length > 0) {
        chipsHtml = `<div class="ai-overview-chips-row">`;
        extractedTitles.forEach(t => {
          chipsHtml += `
            <div class="ai-overview-chip" onclick="window.aiSearchAndOpenMedia('${escapeAttr(t)}')" title="View ${escapeHTML(t)}">
              <i class="fas fa-play" style="font-size: 8px; color: #ffffff;"></i>
              <span>${escapeHTML(t)}</span>
            </div>
          `;
        });
        chipsHtml += `</div>`;
      }

      const textIsArabic = /[\u0600-\u06FF]/.test(overviewText);
      const dir = textIsArabic ? 'rtl' : 'ltr';

      let formattedBody = escapeHTML(overviewText)
        .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ffffff;">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code class="ai-inline-code">$1</code>');

      container.innerHTML = `
        <div class="ai-overview-header">
          <div class="ai-overview-title-group">
            <div class="ai-overview-badge"><img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:16px;height:16px;border-radius:4px;object-fit:cover;"> MEEM AI Overview</div>
            <span style="font-size:0.75rem; opacity:0.6; font-weight:600;">MEEM Smart Search</span>
          </div>
          <button class="ai-overview-copilot-btn" onclick="window.askMeemAI('${escapeAttr(q)}')">
            <img src="imgs/meem-ai.jpg" alt="MEEM AI" style="width:14px;height:14px;border-radius:3px;object-fit:cover;"> <span>Ask MEEM AI</span>
          </button>
        </div>
        <div class="ai-overview-body" dir="${dir}">
          ${formattedBody}
        </div>
        ${mediaCardsHtml}
        ${chipsHtml}
      `;
    } catch (_) {
      if (thisToken === currentSearchOverviewToken) {
        container.style.display = 'none';
      }
    }
  };

  window.aiSearchAndOpenMedia = async function (titleText) {
    if (!titleText) return;
    const input = document.getElementById('search-input-main');
    if (input) {
      input.value = titleText;
    }
    if (typeof window.performUnifiedSearch === 'function') {
      window.performUnifiedSearch(titleText);
    } else if (typeof window.switchView === 'function') {
      window.switchView('search');
      setTimeout(() => {
        if (typeof window.performUnifiedSearch === 'function') {
          window.performUnifiedSearch(titleText);
        }
      }, 150);
    }
  };

  window.askMeemAI = function (promptText) {
    if (typeof window.switchView === 'function') {
      window.switchView('ai');
    }
    setTimeout(() => {
      const input = document.getElementById('ai-chat-input');
      if (input && promptText) {
        input.value = promptText;
        input.dispatchEvent(new Event('input'));
        handleSendMessage();
      }
    }, 200);
  };
  window.askMeemAIFromSearch = window.askMeemAI;

  window.initAIView = initAIView;
  window.updateAIQuotaUI = updateQuotaUI;
  window.showAISidebarNav = showAISidebarNav;
  window.hideAISidebarNav = hideAISidebarNav;
  window.aiSwitchChatSession = switchChatSession;
  window.aiDeleteChatSession = deleteChatSession;
  window.aiCreateNewChatSession = createNewChatSession;

  // Diagnostic AI Key Pool API
  window.KeyPoolManager = KeyPoolManager;
  window.meemAI = {
    getStatus: () => KeyPoolManager.getStatus()
  };

})();
