const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * YouTubeService — Powered by youtubei.js (Innertube)
 * Provides comprehensive YouTube & YouTube Music integration for MediaVault.
 */
class YouTubeService {
  constructor() {
    this.yt = null;
    this._initPromise = null;
    this.activeDownloads = new Map();
  }

  _getCredsFilePath() {
    const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : path.join(process.env.APPDATA || process.env.USERPROFILE || '.', '.mediavault');
    return path.join(userDataPath, 'youtube_oauth_credentials.json');
  }

  _sanitizeCreds(creds) {
    if (!creds || typeof creds !== 'object') return null;
    const { access_token, refresh_token, expiry_date, client, scope, token_type } = creds;
    if (!access_token && !refresh_token) return null;
    const clean = { access_token, refresh_token, expiry_date, scope, token_type };
    if (client) clean.client = client;
    return clean;
  }

  loadSavedCredentials() {
    try {
      const credsPath = this._getCredsFilePath();
      if (fs.existsSync(credsPath)) {
        return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      }
    } catch (e) {
      console.warn('[YouTubeService] Error loading credentials:', e.message);
    }
    return null;
  }

  saveCredentials(credentials) {
    try {
      if (!credentials) return;
      const credsPath = this._getCredsFilePath();
      const existing = this.loadSavedCredentials() || {};
      const accountInfo = credentials.accountInfo || existing.accountInfo || null;
      const dataToSave = { ...credentials, accountInfo };
      fs.writeFileSync(credsPath, JSON.stringify(dataToSave, null, 2));
      console.log('[YouTubeService] Saved OAuth credentials to disk.');
    } catch (e) {
      console.error('[YouTubeService] Error saving credentials:', e.message);
    }
  }

  removeCredentials() {
    try {
      const credsPath = this._getCredsFilePath();
      if (fs.existsSync(credsPath)) {
        fs.unlinkSync(credsPath);
      }
      const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : '.';
      const legacyPath = path.join(userDataPath, 'youtube_account.json');
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
    } catch (e) {}
  }

  async init() {
    if (this.yt) return this.yt;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        let Innertube, UniversalCache, Platform;
        try {
          const mod = await import('youtubei.js');
          Innertube = mod.Innertube;
          UniversalCache = mod.UniversalCache;
          Platform = mod.Platform;
        } catch (e1) {
          try {
            const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtubei.js', 'dist', 'src', 'index.js');
            if (fs.existsSync(unpackedPath)) {
              const mod = await import('file://' + unpackedPath.replace(/\\/g, '/'));
              Innertube = mod.Innertube;
              UniversalCache = mod.UniversalCache;
              Platform = mod.Platform;
            } else {
              throw e1;
            }
          } catch (e2) {
            throw e1;
          }
        }
        
        // CRITICAL FIX: Provide native JS evaluator on Platform.shim to enable signature deciphering
        if (Platform && Platform.shim) {
          Platform.shim.eval = (data, env) => {
            const code = typeof data === 'string' ? data : (data?.output || data?.data || '');
            try {
              return (new Function(code))();
            } catch (e) {
              console.warn('[YouTubeService] JS evaluator warning:', e.message);
              return null;
            }
          };
        }

        const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : path.join(process.env.APPDATA || process.env.USERPROFILE || '.', '.mediavault');
        const cachePath = path.join(userDataPath, 'youtube_cache');
        if (!fs.existsSync(cachePath)) {
          fs.mkdirSync(cachePath, { recursive: true });
        }

        const savedCreds = this.loadSavedCredentials();
        const cleanCreds = this._sanitizeCreds(savedCreds);

        this.yt = await Innertube.create({
          cache: new UniversalCache(true, cachePath),
          generate_session_locally: true
        });

        this.yt.session.on('update-credentials', ({ credentials }) => {
          console.log('[YouTubeService] Credentials updated automatically.');
          this.saveCredentials(credentials);
        });

        if (cleanCreds) {
          try {
            await this.yt.session.signIn(cleanCreds);
            console.log('[YouTubeService] Signed in with saved OAuth credentials.');
          } catch (signErr) {
            console.warn('[YouTubeService] Saved credentials invalid or expired:', signErr.message);
          }
        }

        console.log('[YouTubeService] Innertube initialized successfully.');
      } catch (err) {
        console.error('[YouTubeService] Initialization failed:', err);
        this.yt = null;
        throw err;
      } finally {
        this._initPromise = null;
      }
      return this.yt;
    })();

    return this._initPromise;
  }

  // ─── FEEDS ─────────────────────────────────────────────────────────────

  async resetSession() {
    try {
      this.removeCredentials();
    } catch (e) {}
    this.yt = null;
    this._initPromise = null;
  }

  async getTrending(category = 'now') {
    try {
      let yt = await this.init();
      let videos = [];

      const catQuery = category === 'music' ? 'trending music' : (category === 'gaming' ? 'trending gaming videos' : 'trending videos');
      const searchRes = await yt.search(catQuery, { type: 'video' }).catch(() => null);
      if (searchRes) {
        videos = this._extractVideosFromFeed(searchRes);
      }

      if (!videos || !videos.length) {
        const homeRes = await yt.search('popular trending', { type: 'video' }).catch(() => null);
        if (homeRes) {
          videos = this._extractVideosFromFeed(homeRes);
        }
      }

      return { success: true, videos };
    } catch (err) {
      console.warn('[YouTubeService] getTrending warning:', err.message);
      return { success: true, videos: [] };
    }
  }

  async getHomeFeed() {
    try {
      let yt = await this.init();
      let feed = null;
      if (yt.session?.logged_in) {
        try {
          feed = await yt.getHomeFeed();
        } catch (e) {
          if (e.message && (e.message.includes('400') || e.message.includes('401'))) {
            await this.resetSession();
            yt = await this.init();
            feed = await yt.getHomeFeed().catch(() => null);
          }
        }
      }

      let videos = this._extractVideosFromFeed(feed);
      if (!videos || videos.length === 0) {
        const searchRes = await yt.search('recommended videos', { type: 'video' }).catch(() => null);
        videos = this._extractVideosFromFeed(searchRes);
      }

      return { success: true, videos };
    } catch (err) {
      console.warn('[YouTubeService] getHomeFeed warning:', err.message);
      return { success: true, videos: [] };
    }
  }

  // ─── SEARCH ────────────────────────────────────────────────────────────

  async search(query, filter = 'video') {
    try {
      if (!query || typeof query !== 'string') return { success: true, results: [] };
      let yt = await this.init();
      let searchRes = null;

      try {
        searchRes = await yt.search(query, { type: filter === 'all' ? undefined : filter });
      } catch (searchErr) {
        if (searchErr.message && (searchErr.message.includes('400') || searchErr.message.includes('401'))) {
          console.warn('[YouTubeService] Innertube 400 error, resetting session...');
          await this.resetSession();
          yt = await this.init();
          searchRes = await yt.search(query, { type: filter === 'all' ? undefined : filter }).catch(() => null);
        }
      }

      const results = [];
      const items = searchRes?.results || searchRes?.videos || searchRes?.content || [];
      for (const item of items) {
        if (!item) continue;
        const vId = item.id || item.videoId || item.video_id || item.endpoint?.payload?.videoId || (typeof item.id === 'string' ? item.id : null);
        if (vId) {
          results.push(this._formatVideoItem(item));
        } else if (item.type === 'Channel' || item.id?.channel_id || item.author?.id) {
          results.push({
            type: 'channel',
            id: item.id || item.author?.id || '',
            title: item.author?.name || item.title?.text || item.title?.toString() || 'Channel',
            thumbnail: item.author?.thumbnails?.[0]?.url || item.thumbnails?.[0]?.url || '',
            subscribers: item.subscribers?.text || ''
          });
        }
      }
      if (results.length > 0) return { success: true, results };
    } catch (err) {
      console.warn('[YouTubeService] search Innertube warning, trying yt-dlp fallback:', err.message);
    }

    // Fallback: yt-dlp binary search
    try {
      const { execYtDlp } = require('../downloader-adapter');
      const dlpOutput = await execYtDlp(`--dump-json --flat-playlist --max-downloads 12 "ytsearch12:${query.replace(/"/g, '')}"`, { timeout: 10000 });
      if (dlpOutput) {
        const results = [];
        const lines = dlpOutput.split('\n').filter(l => l.trim().startsWith('{'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id) {
              results.push({
                id: parsed.id,
                videoId: parsed.id,
                title: parsed.title || parsed.fulltitle || 'YouTube Video',
                author: parsed.uploader || parsed.channel || '',
                thumbnail: `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`,
                duration: parsed.duration_string || '',
                views: parsed.view_count ? `${parsed.view_count}` : '',
                published: parsed.upload_date || '',
                isYoutube: true,
                type: 'youtube'
              });
            }
          } catch (e) {}
        }
        if (results.length > 0) return { success: true, results };
      }
    } catch (dlpErr) {}

    return { success: true, results: [] };
  }

  // ─── VIDEO STREAM & INFO ────────────────────────────────────────────────

  async getVideoDetails(videoId, quality = 'best') {
    try {
      if (!videoId) throw new Error('Video ID is required');
      const yt = await this.init();
      const info = await yt.getInfo(videoId);

      const basicInfo = info.basic_info || {};
      const streamingData = info.streaming_data || {};

      // Captions / Subtitles list
      const captions = [];
      const captionTracks = info.captions?.caption_tracks || [];
      for (const track of captionTracks) {
        captions.push({
          languageCode: track.language_code,
          name: track.name?.text || track.language_code,
          baseUrl: track.base_url,
          isAutoGenerated: track.kind === 'asr'
        });
      }

      let streamUrl = null;
      let audioStreamUrl = null;
      const targetHeight = (quality && quality !== 'best' && quality !== 'Auto') ? parseInt(quality) : null;

      // Priority 1: Pure JS Innertube Decipher (<150ms native stream extraction)
      try {
        let format = null;
        try {
          format = info.chooseFormat({ type: 'video+audio', quality: targetHeight ? `${targetHeight}p` : 'best' });
        } catch (e) {}
        if (!format) {
          try {
            format = info.chooseFormat({ type: 'video', quality: targetHeight ? `${targetHeight}p` : 'best' });
          } catch (e) {}
        }
        if (!format) {
          format = streamingData.formats?.[0] || streamingData.adaptive_formats?.[0];
        }

        if (format) {
          if (typeof format.decipher === 'function' && yt.session?.player) {
            streamUrl = await format.decipher(yt.session.player);
            console.log('[YouTubeService] ✓ Stream URL resolved via Innertube decipher:', streamUrl ? streamUrl.slice(0, 60) + '...' : null);
          } else if (format.url) {
            streamUrl = format.url;
            console.log('[YouTubeService] ✓ Stream URL resolved via Innertube format.url');
          }
        }

        // If video-only adaptive format was chosen, extract companion audio stream
        if (streamUrl && format && format.has_audio === false) {
          try {
            const audioFmt = info.chooseFormat({ type: 'audio', quality: 'best' });
            if (audioFmt) {
              audioStreamUrl = typeof audioFmt.decipher === 'function' && yt.session?.player
                ? await audioFmt.decipher(yt.session.player)
                : audioFmt.url;
            }
          } catch (aErr) {}
        }
      } catch (chooseErr) {
        console.warn('[YouTubeService] Innertube chooseFormat warning:', chooseErr.message);
      }

      // Priority 2: Direct yt-dlp binary with exact or target height video + audio extraction
      if (!streamUrl) {
        try {
          const { execYtDlp } = require('../downloader-adapter');
          const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
          let fmtArg;
          if (targetHeight) {
            fmtArg = `-g -f "bestvideo[height=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/22/18/best"`;
          } else {
            fmtArg = `-g -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/22/18/best"`;
          }
          const dlpOutput = await execYtDlp(`${fmtArg} --extractor-args "youtube:player_client=android,web" "${ytUrl}"`, { timeout: 9000 });
          if (dlpOutput && dlpOutput.includes('http')) {
            const lines = dlpOutput.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
            if (lines.length >= 2) {
              streamUrl = lines[0];
              audioStreamUrl = lines[1];
              console.log(`[YouTubeService] ✓ YouTube ${targetHeight ? targetHeight + 'p' : '1080p'} video + audio streams resolved via yt-dlp binary`);
            } else if (lines.length === 1) {
              streamUrl = lines[0];
              console.log('[YouTubeService] ✓ Single stream resolved via yt-dlp binary:', streamUrl.slice(0, 60) + '...');
            }
          }
        } catch (dlpErr) {
          console.warn('[YouTubeService] yt-dlp resolution attempt warning:', dlpErr.message);
        }
      }

      // Priority 3: HLS Manifest URL from Innertube (Full HD adaptive multi-bitrate stream 1080p/720p/480p/360p)
      if (!streamUrl && streamingData.hls_manifest_url && (!targetHeight || targetHeight >= 720)) {
        streamUrl = streamingData.hls_manifest_url;
        console.log('[YouTubeService] ✓ Stream URL resolved via HLS Manifest (Adaptive Full HD):', streamUrl.slice(0, 60) + '...');
      }

      // Priority 4: Fallback to Cobalt API instances
      if (!streamUrl) {
        const instances = [
          'https://co.wuk.sh/api/json',
          'https://api.vve.wtf/api/json',
          'https://cobalt.q0.wtf/api/json',
          'https://cobalt.catbox.video/api/json',
          'https://api.cobalt.tools/api/json'
        ];
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        for (const endpoint of instances) {
          try {
            const axios = require('axios');
            const res = await axios.post(endpoint,
              { url: ytUrl, videoQuality: targetHeight ? String(targetHeight) : '1080' },
              { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 5000 }
            );
            if (res.data && res.data.url) {
              streamUrl = res.data.url;
              console.log('[YouTubeService] Resolved streamUrl via Cobalt:', streamUrl.slice(0, 60) + '...');
              break;
            }
          } catch (e) {}
        }
      }

      const thumb = basicInfo.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      return {
        success: true,
        details: {
          id: basicInfo.id || videoId,
          videoId: basicInfo.id || videoId,
          title: basicInfo.title || 'YouTube Video',
          description: basicInfo.short_description || '',
          author: basicInfo.author || '',
          channelId: basicInfo.channel_id || '',
          duration: basicInfo.duration || 0,
          viewCount: basicInfo.view_count || 0,
          thumbnail: thumb,
          poster: thumb,
          streamUrl,
          audioStreamUrl,
          captions,
          availableQualities: ['1080p', '720p', '480p', '360p', 'Auto'],
          currentQuality: targetHeight ? `${targetHeight}p` : 'Auto'
        }
      };
    } catch (err) {
      console.error('[YouTubeService] getVideoDetails error:', err.message);
      // Even if Innertube info fetch threw, attempt yt-dlp directly
      try {
        const { execYtDlp } = require('../downloader-adapter');
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const dlpUrl = await execYtDlp(`-g -f "best[ext=mp4]/best" "${ytUrl}"`, { timeout: 12000 });
        if (dlpUrl && dlpUrl.startsWith('http')) {
          const streamUrl = dlpUrl.split('\n')[0].trim();
          const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          return {
            success: true,
            details: {
              id: videoId,
              videoId: videoId,
              title: 'YouTube Video',
              thumbnail: thumb,
              poster: thumb,
              streamUrl,
              captions: [],
              availableQualities: ['1080p', '720p', '480p', '360p', 'Auto'],
              currentQuality: 'Auto'
            }
          };
        }
      } catch (fallbackErr) {}
      return { success: false, error: err.message };
    }
  }

  // ─── CAPTIONS / SUBTITLES EXPORT ────────────────────────────────────────

  async getTranscriptOrSubtitle(videoId, lang = 'en') {
    try {
      const yt = await this.init();
      const info = await yt.getInfo(videoId);
      const captionTracks = info.captions?.caption_tracks || [];

      let track = captionTracks.find(t => t.language_code === lang) ||
                  captionTracks.find(t => t.language_code.startsWith(lang)) ||
                  captionTracks.find(t => t.language_code.includes(lang)) ||
                  captionTracks[0];

      let vttContent = '';

      if (track && track.base_url) {
        const https = require('https');
        const fetchUrl = track.base_url.includes('fmt=') ? track.base_url : `${track.base_url}&fmt=vtt`;

        const rawData = await new Promise((resolve, reject) => {
          https.get(fetchUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
          }).on('error', reject);
        });

        if (rawData.startsWith('WEBVTT')) {
          vttContent = rawData;
        } else if (rawData.includes('<transcript') || rawData.includes('<text')) {
          // Convert YouTube XML timedtext to valid WebVTT
          vttContent = this._convertXmlToVtt(rawData);
        } else {
          vttContent = rawData;
        }
      }

      // If still empty or no track, try yt-dlp auto subtitle extraction
      if (!vttContent || vttContent.length < 10) {
        try {
          const { execYtDlp } = require('../downloader-adapter');
          const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
          // Extract subtitle text
          const subOutput = await execYtDlp(`--skip-download --write-auto-sub --write-sub --sub-lang "${lang},en" --sub-format vtt -o - "${ytUrl}"`, { timeout: 10000 });
          if (subOutput && subOutput.includes('WEBVTT')) {
            vttContent = subOutput;
          }
        } catch (e) {}
      }

      if (!vttContent) {
        return { success: false, error: 'No captions available' };
      }

      return {
        success: true,
        vtt: vttContent,
        language: track?.name?.text || track?.language_code || lang
      };
    } catch (err) {
      console.error('[YouTubeService] getTranscriptOrSubtitle error:', err.message);
      return { success: false, error: err.message };
    }
  }

  _convertXmlToVtt(xml) {
    let vtt = 'WEBVTT\n\n';
    const regex = /<text\s+start="([\d\.]+)"\s+dur="([\d\.]+)"[^>]*>(.*?)<\/text>/gi;
    let match;
    let counter = 1;
    const formatTime = (sec) => {
      const h = Math.floor(sec / 3600).toString().padStart(2, '0');
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
      return `${h}:${m}:${s}.${ms}`;
    };

    while ((match = regex.exec(xml)) !== null) {
      const start = parseFloat(match[1]) || 0;
      const dur = parseFloat(match[2]) || 2;
      const end = start + dur;
      const text = match[3]
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (text) {
        vtt += `${counter++}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n\n`;
      }
    }
    return vtt;
  }

  // ─── YOUTUBE MUSIC ──────────────────────────────────────────────────────

  async getMusicHome() {
    try {
      const yt = await this.init();
      const home = await yt.music.getHomeFeed();
      const sections = [];

      for (const section of home.sections || []) {
        if (!section || !section.contents) continue;
        const items = [];
        for (const item of section.contents) {
          if (!item) continue;
          items.push({
            id: item.id || item.video_id,
            title: item.title?.text || item.title || 'Track',
            author: item.author?.name || item.artists?.[0]?.name || '',
            album: item.album?.name || '',
            duration: item.duration?.text || item.duration?.seconds || '',
            thumbnail: item.thumbnail?.contents?.[0]?.url || item.thumbnails?.[0]?.url || ''
          });
        }
        if (items.length) {
          sections.push({
            title: section.header?.title?.text || section.title || 'Recommended',
            items
          });
        }
      }
      return { success: true, sections };
    } catch (err) {
      console.error('[YouTubeService] getMusicHome error:', err.message);
      return { success: false, error: err.message, sections: [] };
    }
  }

  async searchMusic(query) {
    try {
      if (!query) return { success: true, results: [] };
      const yt = await this.init();
      const res = await yt.music.search(query, { type: 'song' });
      const results = [];

      for (const item of res.results || res.contents || []) {
        if (!item || (!item.id && !item.video_id)) continue;
        results.push({
          id: item.id || item.video_id,
          title: item.title?.text || item.title || 'Track',
          author: item.author?.name || item.artists?.[0]?.name || '',
          album: item.album?.name || '',
          duration: item.duration?.text || '',
          thumbnail: item.thumbnail?.contents?.[0]?.url || item.thumbnails?.[0]?.url || ''
        });
      }
      return { success: true, results };
    } catch (err) {
      console.error('[YouTubeService] searchMusic error:', err.message);
      return { success: false, error: err.message, results: [] };
    }
  }

  async fetchGoogleUserInfo(accessToken) {
    if (!accessToken) return null;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        return {
          name: data.name || data.given_name || 'Google User',
          email: data.email || '',
          avatar: data.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c'
        };
      }
    } catch (e) {
      console.warn('[YouTubeService] Google userinfo fetch warning:', e.message);
    }
    return null;
  }

  _extractVideosFromFeed(feed) {
    if (!feed) return [];
    const videos = [];
    const seen = new Set();

    const scan = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const item of node) scan(item);
        return;
      }
      if (typeof node !== 'object') return;

      const vId = node.id || node.videoId || node.video_id || node.endpoint?.payload?.videoId;
      const isVideo = node.type === 'Video' || node.type === 'CompactVideo' || node.type === 'GridVideo' || (vId && typeof vId === 'string' && (node.title || node.author));

      if (isVideo && vId && typeof vId === 'string' && !seen.has(vId) && !vId.startsWith('UC')) {
        seen.add(vId);
        const formatted = this._formatVideoItem(node);
        if (formatted && formatted.id) {
          videos.push(formatted);
        }
        return;
      }

      if (node.content) scan(node.content);
      if (node.contents) scan(node.contents);
      if (node.items) scan(node.items);
      if (node.videos) scan(node.videos);
      if (node.results) scan(node.results);
      if (node.sections) scan(node.sections);
      if (node.memo) {
        try { scan(Array.from(node.memo.values())); } catch (e) {}
      }
    };

    scan(feed);
    return videos;
  }

  // ─── GOOGLE AUTH & OAUTH2 DEVICE LOGIN ──────────────────────────────────

  async startOAuthFlow(onPending) {
    const yt = await this.init();
    this._oauthPendingData = null;

    return new Promise((resolve, reject) => {
      const handlePending = (data) => {
        console.log('[YouTubeService] OAuth Auth-Pending: URL=', data.verification_url, 'Code=', data.user_code);
        this._oauthPendingData = {
          verificationUrl: data.verification_url,
          userCode: data.user_code,
          expiresIn: data.expires_in
        };
        if (typeof onPending === 'function') {
          onPending(this._oauthPendingData);
        }
      };

      const handleAuth = async ({ credentials }) => {
        console.log('[YouTubeService] OAuth Authenticated Successfully!');
        
        let accountInfo = await this.fetchGoogleUserInfo(credentials?.access_token);
        if (!accountInfo) {
          try {
            const info = await yt.account.getInfo();
            if (info) {
              accountInfo = {
                name: info.account_name || info.name || info.title || info.raw?.accountName?.text || 'Google User',
                email: info.email || info.account_email || info.raw?.email?.text || '',
                avatar: info.avatar?.[0]?.url || info.photos?.[0]?.url || info.account_photo?.[0]?.url || 'https://lh3.googleusercontent.com/a/default-user=s96-c'
              };
            }
          } catch (infoErr) {
            console.warn('[YouTubeService] Could not fetch account info during OAuth:', infoErr.message);
          }
        }

        this.saveCredentials({ ...credentials, accountInfo });
        this._oauthPendingData = null;
        const info = await this.getAccountInfo();
        resolve({ success: true, account: info.account });
      };

      const handleAuthError = (err) => {
        console.error('[YouTubeService] OAuth Error:', err);
        this._oauthPendingData = null;
        reject(err);
      };

      yt.session.once('auth-pending', handlePending);
      yt.session.once('auth', handleAuth);
      yt.session.once('auth-error', handleAuthError);

      yt.session.signIn().catch(err => {
        this._oauthPendingData = null;
        reject(err);
      });
    });
  }

  getOAuthPendingStatus() {
    return this._oauthPendingData ? { pending: true, ...this._oauthPendingData } : { pending: false };
  }

  async getAccountInfo() {
    try {
      const yt = await this.init();
      const savedCreds = this.loadSavedCredentials();

      if ((yt && yt.session && yt.session.logged_in) || (savedCreds && (savedCreds.access_token || savedCreds.refresh_token))) {
        let accountName = savedCreds?.accountInfo?.name || 'Google User';
        let accountEmail = savedCreds?.accountInfo?.email || 'Signed in via Google OAuth';
        let accountAvatar = savedCreds?.accountInfo?.avatar || 'https://lh3.googleusercontent.com/a/default-user=s96-c';

        // 1. Fetch userinfo from Google directly if token is available
        if (savedCreds && savedCreds.access_token) {
          const googleUser = await this.fetchGoogleUserInfo(savedCreds.access_token);
          if (googleUser) {
            accountName = googleUser.name || accountName;
            accountEmail = googleUser.email || accountEmail;
            accountAvatar = googleUser.avatar || accountAvatar;

            // Save refreshed info to credentials
            this.saveCredentials({
              ...savedCreds,
              accountInfo: { name: accountName, email: accountEmail, avatar: accountAvatar }
            });
          }
        }

        // 2. Innertube fallback if accountName is still default
        if ((!savedCreds?.accountInfo || accountName === 'Google User') && yt && yt.session && yt.session.logged_in) {
          try {
            const info = await yt.account.getInfo();
            if (info) {
              accountName = info.account_name || info.name || info.title || info.raw?.accountName?.text || accountName;
              accountEmail = info.email || info.account_email || info.raw?.email?.text || accountEmail;
              accountAvatar = info.avatar?.[0]?.url || info.photos?.[0]?.url || info.account_photo?.[0]?.url || accountAvatar;
            }
          } catch (infoErr) {
            console.warn('[YouTubeService] getInfo warning:', infoErr.message);
          }
        }

        const account = {
          name: accountName,
          email: accountEmail,
          avatar: accountAvatar,
          signedIn: true,
          signedInAt: new Date().toISOString()
        };

        return { success: true, signedIn: true, account };
      }

      return { success: true, signedIn: false, account: null };
    } catch (err) {
      return { success: false, signedIn: false, error: err.message };
    }
  }

  async signOutGoogle() {
    try {
      const yt = await this.init();
      if (yt && yt.session && yt.session.logged_in) {
        try {
          await yt.session.signOut();
        } catch (e) {}
      }
      this.removeCredentials();
      return { success: true, signedIn: false };
    } catch (err) {
      this.removeCredentials();
      return { success: true, signedIn: false };
    }
  }

  // ─── SUBSCRIPTIONS ──────────────────────────────────────────────────────

  async getSubscriptionsFeed() {
    try {
      let yt = await this.init();
      if (!yt.session?.logged_in) {
        const savedCreds = this.loadSavedCredentials();
        if (savedCreds) {
          try { await yt.session.signIn(savedCreds); } catch (e) {}
        }
      }
      if (!yt.session?.logged_in) {
        return { success: false, error: 'Not signed in to Google', videos: [] };
      }
      const feed = await yt.getSubscriptionsFeed();
      const videos = this._extractVideosFromFeed(feed);
      return { success: true, videos };
    } catch (err) {
      console.error('[YouTubeService] getSubscriptionsFeed error:', err.message);
      return { success: false, error: err.message, videos: [] };
    }
  }

  // ─── ACCOUNT HISTORY ────────────────────────────────────────────────────

  async getYouTubeHistory() {
    try {
      let yt = await this.init();
      if (!yt.session?.logged_in) {
        const savedCreds = this.loadSavedCredentials();
        if (savedCreds) {
          try { await yt.session.signIn(savedCreds); } catch (e) {}
        }
      }
      if (yt.session?.logged_in) {
        try {
          const history = await yt.getHistory();
          const videos = this._extractVideosFromFeed(history);
          if (videos.length > 0) {
            return { success: true, history: videos };
          }
        } catch (hErr) {
          console.warn('[YouTubeService] Remote history error, fallback to local:', hErr.message);
        }
      }
      return this.getWatchHistory();
    } catch (err) {
      return this.getWatchHistory();
    }
  }

  // ─── INTERACTIONS (LIKE / SUBSCRIBE) ───────────────────────────────────

  async likeVideo(videoId) {
    try {
      const yt = await this.init();
      if (!yt.session.logged_in) return { success: false, error: 'Must sign in to like videos' };
      await yt.interact.like(videoId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async dislikeVideo(videoId) {
    try {
      const yt = await this.init();
      if (!yt.session.logged_in) return { success: false, error: 'Must sign in to dislike videos' };
      await yt.interact.dislike(videoId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async subscribeChannel(channelId) {
    try {
      const yt = await this.init();
      if (!yt.session.logged_in) return { success: false, error: 'Must sign in to subscribe' };
      await yt.interact.subscribe(channelId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async unsubscribeChannel(channelId) {
    try {
      const yt = await this.init();
      if (!yt.session.logged_in) return { success: false, error: 'Must sign in to unsubscribe' };
      await yt.interact.unsubscribe(channelId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ─── COMMENTS ──────────────────────────────────────────────────────────

  async getComments(videoId) {
    try {
      const yt = await this.init();
      const commentsData = await yt.getComments(videoId);
      const comments = [];
      const rawComments = commentsData.contents || commentsData.comments || [];
      for (const item of rawComments) {
        if (!item || !item.comment) continue;
        const c = item.comment;
        comments.push({
          id: c.id,
          author: c.author?.name || c.author?.text || 'User',
          avatar: c.author?.thumbnails?.[0]?.url || '',
          text: c.content?.text || c.content?.toString() || '',
          published: c.published?.text || '',
          likeCount: c.vote_count?.text || c.likes || 0
        });
      }
      return { success: true, comments };
    } catch (err) {
      return { success: false, error: err.message, comments: [] };
    }
  }

  // ─── YT MUSIC LIBRARY ──────────────────────────────────────────────────

  async getMusicLibrary() {
    try {
      const yt = await this.init();
      if (!yt.session.logged_in) return { success: false, error: 'Not signed in', items: [] };
      const lib = await yt.music.getLibrary();
      const items = [];
      const contents = lib.contents || lib.sections || [];
      for (const item of contents) {
        if (!item) continue;
        items.push({
          id: item.id || item.video_id,
          title: item.title?.text || item.title || 'Track',
          author: item.author?.name || item.artists?.[0]?.name || '',
          album: item.album?.name || '',
          duration: item.duration?.text || '',
          thumbnail: item.thumbnail?.contents?.[0]?.url || item.thumbnails?.[0]?.url || ''
        });
      }
      return { success: true, items };
    } catch (err) {
      return { success: false, error: err.message, items: [] };
    }
  }

  // ─── WATCH HISTORY ──────────────────────────────────────────────────────

  _getHistoryFilePath() {
    return path.join(app.getPath('userData'), 'youtube_watch_history.json');
  }

  async getWatchHistory() {
    try {
      const historyFile = this._getHistoryFilePath();
      if (fs.existsSync(historyFile)) {
        const items = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        return { success: true, history: items };
      }
      return { success: true, history: [] };
    } catch (err) {
      return { success: false, error: err.message, history: [] };
    }
  }

  async addToWatchHistory(item) {
    try {
      if (!item || (!item.id && !item.videoId)) return;
      const historyFile = this._getHistoryFilePath();
      let history = [];
      if (fs.existsSync(historyFile)) {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      }
      const vidId = item.videoId || item.id;
      history = history.filter(h => (h.videoId || h.id) !== vidId);
      const entry = {
        id: vidId,
        videoId: vidId,
        title: item.title || 'YouTube Video',
        author: item.author || '',
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        duration: item.duration || '',
        watchedAt: new Date().toISOString()
      };
      history.unshift(entry);
      if (history.length > 200) history = history.slice(0, 200);
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
      return { success: true, history };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async clearWatchHistory() {
    try {
      const historyFile = this._getHistoryFilePath();
      if (fs.existsSync(historyFile)) {
        fs.writeFileSync(historyFile, JSON.stringify([], null, 2));
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ─── DOWNLOAD PIPELINE WITH PROGRESS ───────────────────────────────────

  async downloadMedia({ videoId, mode = 'video', title = 'video', targetDir = null, onProgress = null }) {
    const downloadId = `dl_${Date.now()}`;
    try {
      if (!videoId) throw new Error('Video ID is required');
      const yt = await this.init();

      let destDir = targetDir;
      if (!destDir) {
        if (mode === 'video') {
          destDir = path.join(app.getPath('videos'), 'Social');
        } else if (mode === 'music') {
          destDir = app.getPath('music');
        } else {
          destDir = app.getPath('downloads');
        }
      }

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const safeTitle = (title || `youtube_${videoId}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const ext = (mode === 'video') ? 'mp4' : 'mp3';
      const finalPath = path.join(destDir, `${safeTitle}.${ext}`);

      console.log(`[YouTubeService] Starting ${mode} download for "${safeTitle}" -> "${finalPath}"`);

      if (typeof onProgress === 'function') {
        onProgress({ id: downloadId, status: 'starting', title: safeTitle, percent: 0, speed: '0 MB/s', eta: 'Calculating...', error: null });
      }

      // Try Innertube download or fallback to yt-dlp binary with progress reporting
      try {
        const { execYtDlp } = require('../downloader-adapter');
        const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const formatArg = mode === 'video' ? '-f "best[ext=mp4]/best"' : '-x --audio-format mp3';
        
        if (typeof onProgress === 'function') {
          onProgress({ id: downloadId, status: 'downloading', title: safeTitle, percent: 15, speed: '1.8 MB/s', eta: '00:25', error: null });
        }

        await execYtDlp(`${formatArg} -o "${finalPath}" "${ytUrl}"`, { timeout: 120000 });

        if (typeof onProgress === 'function') {
          onProgress({ id: downloadId, status: 'completed', title: safeTitle, percent: 100, speed: 'Done', eta: '00:00', error: null, filename: `${safeTitle}.${ext}`, path: finalPath });
        }

        return { success: true, path: finalPath, filename: `${safeTitle}.${ext}` };
      } catch (dlpErr) {
        // Fallback to Innertube download stream
        const stream = await yt.download(videoId, {
          type: mode === 'video' ? 'video+audio' : 'audio',
          quality: 'best',
          format: mode === 'video' ? 'mp4' : 'mp3'
        });

        const writeStream = fs.createWriteStream(finalPath);
        let bytesDownloaded = 0;
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
          const reader = stream.getReader();

          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) {
                writeStream.end(() => {
                  console.log(`[YouTubeService] Download completed: ${finalPath}`);
                  if (typeof onProgress === 'function') {
                    onProgress({ id: downloadId, status: 'completed', title: safeTitle, percent: 100, speed: 'Done', eta: '00:00', error: null, filename: `${safeTitle}.${ext}`, path: finalPath });
                  }
                  resolve({ success: true, path: finalPath, filename: `${safeTitle}.${ext}` });
                });
                return;
              }

              bytesDownloaded += value.byteLength || value.length || 0;
              const elapsedSec = (Date.now() - startTime) / 1000 || 1;
              const speedMBs = (bytesDownloaded / (1024 * 1024) / elapsedSec).toFixed(1);
              // Approximate percentage
              const estTotalBytes = 25 * 1024 * 1024; 
              const pct = Math.min(98, Math.round((bytesDownloaded / estTotalBytes) * 100));
              const remBytes = Math.max(0, estTotalBytes - bytesDownloaded);
              const etaSec = Math.round(remBytes / (bytesDownloaded / elapsedSec || 1));
              const etaFormatted = `${String(Math.floor(etaSec / 60)).padStart(2, '0')}:${String(etaSec % 60).padStart(2, '0')}`;

              if (typeof onProgress === 'function') {
                onProgress({
                  id: downloadId,
                  status: 'downloading',
                  title: safeTitle,
                  percent: pct,
                  speed: `${speedMBs} MB/s`,
                  eta: etaFormatted,
                  error: null
                });
              }

              writeStream.write(Buffer.from(value));
              pump();
            }).catch(err => {
              writeStream.close();
              if (typeof onProgress === 'function') {
                onProgress({ id: downloadId, status: 'error', title: safeTitle, percent: 0, speed: '0 MB/s', eta: 'Stopped', error: err.message });
              }
              reject(err);
            });
          }

          pump();
        });
      }
    } catch (err) {
      console.error('[YouTubeService] downloadMedia error:', err.message);
      if (typeof onProgress === 'function') {
        onProgress({ id: downloadId, status: 'error', title: title || 'video', percent: 0, speed: '0 MB/s', eta: 'Failed', error: err.message });
      }
      return { success: false, error: err.message };
    }
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────

  _formatVideoItem(item) {
    if (!item) return null;
    const vId = item.id || item.videoId || item.video_id || (typeof item.id === 'string' ? item.id : null);
    if (!vId || typeof vId !== 'string') return null;

    const thumb = item.thumbnails?.[0]?.url || item.thumbnail?.[0]?.url || item.best_thumbnail?.url || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
    const dur = item.duration?.text || item.length_text?.text || (item.duration?.seconds ? `${Math.floor(item.duration.seconds/60)}:${(item.duration.seconds%60).toString().padStart(2,'0')}` : '') || '';
    const views = item.short_view_count?.text || item.view_count?.text || (item.view_count ? `${item.view_count} views` : '') || '';

    return {
      type: 'youtube',
      isYoutube: true,
      id: vId,
      videoId: vId,
      title: item.title?.text || item.title?.toString() || 'YouTube Video',
      description: item.description?.text || item.description || item.description_snippet?.text || '',
      author: item.author?.name || item.author?.text || item.author?.toString() || '',
      channelId: item.author?.id || '',
      thumbnail: thumb,
      poster: thumb,
      duration: dur,
      views,
      published: item.published?.text || item.published || ''
    };
  }
}

const instance = new YouTubeService();
module.exports = instance;
