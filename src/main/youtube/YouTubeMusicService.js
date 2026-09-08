const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const { execYtDlp } = require('../downloader-adapter');
const YouTubeService = require('./YouTubeService');

const ALL_QURAN_SURAHS = [
  { no: 1, ar: 'الفاتحة', en: 'Al-Fatihah', alt: ['fatihah', 'fatiha'] },
  { no: 2, ar: 'البقرة', en: 'Al-Baqarah', alt: ['baqara', 'al-baqarah', 'al-baqara'] },
  { no: 3, ar: 'آل عمران', en: 'Ali Imran', alt: ['ali imran', 'aal imran'] },
  { no: 4, ar: 'النساء', en: 'An-Nisa', alt: ['an-nisa'] },
  { no: 5, ar: 'المائدة', en: 'Al-Maidah', alt: ['al-maidah', 'maeda'] },
  { no: 6, ar: 'الأنعام', en: 'Al-Anam', alt: ['al-anam', 'anaam'] },
  { no: 7, ar: 'الأعراف', en: 'Al-Araf', alt: ['al-araf'] },
  { no: 8, ar: 'الأنفال', en: 'Al-Anfal', alt: ['al-anfal'] },
  { no: 9, ar: 'التوبة', en: 'At-Tawbah', alt: ['at-tawbah', 'tawba'] },
  { no: 10, ar: 'يونس', en: 'Yunus' },
  { no: 11, ar: 'هود', en: 'Hud' },
  { no: 12, ar: 'يوسف', en: 'Yusuf', alt: ['yousif', 'yousef'] },
  { no: 13, ar: 'الرعد', en: 'Ar-Rad', alt: ['ar-rad', 'raad'] },
  { no: 14, ar: 'إبراهيم', en: 'Ibrahim' },
  { no: 15, ar: 'الحجر', en: 'Al-Hijr', alt: ['al-hijr'] },
  { no: 16, ar: 'النحل', en: 'An-Nahl', alt: ['an-nahl'] },
  { no: 17, ar: 'الإسراء', en: 'Al-Isra', alt: ['al-isra'] },
  { no: 18, ar: 'الكهف', en: 'Al-Kahf', alt: ['al-kahf', 'kahaf', 'kahf'] },
  { no: 19, ar: 'مريم', en: 'Maryam', alt: ['mariam'] },
  { no: 20, ar: 'طه', en: 'Taha', alt: ['ta-ha'] },
  { no: 21, ar: 'الأنبياء', en: 'Al-Anbiya', alt: ['al-anbiya'] },
  { no: 22, ar: 'الحج', en: 'Al-Hajj', alt: ['al-hajj'] },
  { no: 23, ar: 'المؤمنون', en: 'Al-Muminun', alt: ['al-muminun', 'mouminoun'] },
  { no: 24, ar: 'النور', en: 'An-Nur', alt: ['an-nur', 'an-noor', 'nour'] },
  { no: 25, ar: 'الفرقان', en: 'Al-Furqan', alt: ['al-furqan'] },
  { no: 26, ar: 'الشعراء', en: 'Ash-Shuara', alt: ['ash-shuara'] },
  { no: 27, ar: 'النمل', en: 'An-Naml', alt: ['an-naml'] },
  { no: 28, ar: 'القصص', en: 'Al-Qasas', alt: ['al-qasas'] },
  { no: 29, ar: 'العنكبوت', en: 'Al-Ankabut', alt: ['al-ankabut'] },
  { no: 30, ar: 'الروم', en: 'Ar-Rum', alt: ['ar-rum'] },
  { no: 31, ar: 'لقمان', en: 'Luqman', alt: ['lokman'] },
  { no: 32, ar: 'السجدة', en: 'As-Sajdah', alt: ['as-sajdah', 'sajda'] },
  { no: 33, ar: 'الأحزاب', en: 'Al-Ahzab', alt: ['al-ahzab'] },
  { no: 34, ar: 'سبأ', en: 'Saba' },
  { no: 35, ar: 'فاطر', en: 'Fatir' },
  { no: 36, ar: 'يس', en: 'Ya-Sin', alt: ['ya-sin', 'yaseen', 'yasin'] },
  { no: 37, ar: 'الصافات', en: 'As-Saffat', alt: ['as-saffat'] },
  { no: 38, ar: 'ص', en: 'Sad' },
  { no: 39, ar: 'الزمر', en: 'Az-Zumar', alt: ['az-zumar'] },
  { no: 40, ar: 'غافر', en: 'Ghafir' },
  { no: 41, ar: 'فصلت', en: 'Fussilat' },
  { no: 42, ar: 'الشورى', en: 'Ash-Shura', alt: ['ash-shura'] },
  { no: 43, ar: 'الزخرف', en: 'Az-Zukhruf', alt: ['az-zukhruf'] },
  { no: 44, ar: 'الدخان', en: 'Ad-Dukhan', alt: ['ad-dukhan'] },
  { no: 45, ar: 'الجاثية', en: 'Al-Jathiyah', alt: ['al-jathiyah'] },
  { no: 46, ar: 'الأحقاف', en: 'Al-Ahqaf', alt: ['al-ahqaf'] },
  { no: 47, ar: 'محمد', en: 'Muhammad' },
  { no: 48, ar: 'الفتح', en: 'Al-Fath', alt: ['al-fath'] },
  { no: 49, ar: 'الحجرات', en: 'Al-Hujurat', alt: ['al-hujurat'] },
  { no: 50, ar: 'ق', en: 'Qaf' },
  { no: 51, ar: 'الذاريات', en: 'Adh-Dhariyat', alt: ['adh-dhariyat'] },
  { no: 52, ar: 'الطور', en: 'At-Tur', alt: ['at-tur', 'toor'] },
  { no: 53, ar: 'النجم', en: 'An-Najm', alt: ['an-najm'] },
  { no: 54, ar: 'القمر', en: 'Al-Qamar', alt: ['al-qamar'] },
  { no: 55, ar: 'الرحمن', en: 'Ar-Rahman', alt: ['ar-rahman', 'rehman'] },
  { no: 56, ar: 'الواقعة', en: 'Al-Waqiah', alt: ['al-waqiah', 'waqia'] },
  { no: 57, ar: 'الحديد', en: 'Al-Hadid', alt: ['al-hadid'] },
  { no: 58, ar: 'المجادلة', en: 'Al-Mujadila', alt: ['al-mujadila'] },
  { no: 59, ar: 'الحشر', en: 'Al-Hashr', alt: ['al-hashr'] },
  { no: 60, ar: 'الممتحنة', en: 'Al-Mumtahanah', alt: ['al-mumtahanah'] },
  { no: 61, ar: 'الصف', en: 'As-Saff', alt: ['as-saff'] },
  { no: 62, ar: 'الجمعة', en: 'Al-Jumuah', alt: ['al-jumuah', 'jumua'] },
  { no: 63, ar: 'المنافقون', en: 'Al-Munafiqun', alt: ['al-munafiqun'] },
  { no: 64, ar: 'التغابن', en: 'At-Taghabun', alt: ['at-taghabun'] },
  { no: 65, ar: 'الطلاق', en: 'At-Talaq', alt: ['at-talaq'] },
  { no: 66, ar: 'التحريم', en: 'At-Tahrim', alt: ['at-tahrim'] },
  { no: 67, ar: 'الملك', en: 'Al-Mulk', alt: ['al-mulk', 'tabarak'] },
  { no: 68, ar: 'القلم', en: 'Al-Qalam', alt: ['al-qalam', 'noon'] },
  { no: 69, ar: 'الحاقة', en: 'Al-Haqqah', alt: ['al-haqqah'] },
  { no: 70, ar: 'المعارج', en: 'Al-Maarij', alt: ['al-maarij'] },
  { no: 71, ar: 'نوح', en: 'Nuh' },
  { no: 72, ar: 'الجن', en: 'Al-Jinn', alt: ['al-jinn'] },
  { no: 73, ar: 'المزمل', en: 'Al-Muzzammil', alt: ['al-muzzammil'] },
  { no: 74, ar: 'المدثر', en: 'Al-Muddaththir', alt: ['al-muddaththir'] },
  { no: 75, ar: 'القيامة', en: 'Al-Qiyamah', alt: ['al-qiyamah'] },
  { no: 76, ar: 'الإنسان', en: 'Al-Insan', alt: ['al-insan', 'dahr'] },
  { no: 77, ar: 'المرسلات', en: 'Al-Mursalat', alt: ['al-mursalat'] },
  { no: 78, ar: 'النبأ', en: 'An-Naba', alt: ['an-naba', 'amma'] },
  { no: 79, ar: 'النازعات', en: 'An-Naziat', alt: ['an-naziat'] },
  { no: 80, ar: 'عبس', en: 'Abasa' },
  { no: 81, ar: 'التكوير', en: 'At-Takwir', alt: ['at-takwir'] },
  { no: 82, ar: 'الانفطار', en: 'Al-Infitar', alt: ['al-infitar'] },
  { no: 83, ar: 'المطففين', en: 'Al-Mutaffifin', alt: ['al-mutaffifin'] },
  { no: 84, ar: 'الانشقاق', en: 'Al-Inshiqaq', alt: ['al-inshiqaq'] },
  { no: 85, ar: 'البروج', en: 'Al-Buruj', alt: ['al-buruj'] },
  { no: 86, ar: 'الطارق', en: 'At-Tariq', alt: ['at-tariq'] },
  { no: 87, ar: 'الأعلى', en: 'Al-Ala', alt: ['al-ala'] },
  { no: 88, ar: 'الغاشية', en: 'Al-Ghashiyah', alt: ['al-ghashiyah'] },
  { no: 89, ar: 'الفجر', en: 'Al-Fajr', alt: ['al-fajr'] },
  { no: 90, ar: 'البلد', en: 'Al-Balad', alt: ['al-balad'] },
  { no: 91, ar: 'الشمس', en: 'Ash-Shams', alt: ['ash-shams'] },
  { no: 92, ar: 'الليل', en: 'Al-Layl', alt: ['al-layl'] },
  { no: 93, ar: 'الضحى', en: 'Ad-Duha', alt: ['ad-duha'] },
  { no: 94, ar: 'الشرح', en: 'Ash-Sharh', alt: ['ash-sharh', 'inshirah'] },
  { no: 95, ar: 'التين', en: 'At-Tin', alt: ['at-tin'] },
  { no: 96, ar: 'العلق', en: 'Al-Alaq', alt: ['al-alaq', 'iqra'] },
  { no: 97, ar: 'القدر', en: 'Al-Qadr', alt: ['al-qadr'] },
  { no: 98, ar: 'البينة', en: 'Al-Bayyinah', alt: ['al-bayyinah'] },
  { no: 99, ar: 'الزلزلة', en: 'Az-Zalzalah', alt: ['az-zalzalah'] },
  { no: 100, ar: 'العاديات', en: 'Al-Adiyat', alt: ['al-adiyat'] },
  { no: 101, ar: 'القارعة', en: 'Al-Qariah', alt: ['al-qariah'] },
  { no: 102, ar: 'التكاثر', en: 'At-Takathur', alt: ['at-takathur'] },
  { no: 103, ar: 'العصر', en: 'Al-Asr', alt: ['al-asr'] },
  { no: 104, ar: 'الهمزة', en: 'Al-Humazah', alt: ['al-humazah'] },
  { no: 105, ar: 'الفيل', en: 'Al-Fil', alt: ['al-fil'] },
  { no: 106, ar: 'قريش', en: 'Quraysh' },
  { no: 107, ar: 'الماعون', en: 'Al-Maun', alt: ['al-maun'] },
  { no: 108, ar: 'الكوثر', en: 'Al-Kawthar', alt: ['al-kawthar'] },
  { no: 109, ar: 'الكافرون', en: 'Al-Kafirun', alt: ['al-kafirun'] },
  { no: 110, ar: 'النصر', en: 'An-Nasr', alt: ['an-nasr'] },
  { no: 111, ar: 'المسد', en: 'Al-Masad', alt: ['al-masad', 'lahab'] },
  { no: 112, ar: 'الإخلاص', en: 'Al-Ikhlas', alt: ['al-ikhlas'] },
  { no: 113, ar: 'الفلق', en: 'Al-Falaq', alt: ['al-falaq'] },
  { no: 114, ar: 'الناس', en: 'An-Nas', alt: ['an-nas'] }
];

/**
 * YouTubeMusicService — Powered by YouTube Music Innertube Client & yt-dlp
 * Retrieves official music tracks from YouTube Music with clean metadata,
 * direct audio streaming, and dual-engine Synced Lyrics (LRCLIB + YT Music).
 */
class YouTubeMusicService {
  constructor() {
    this.cache = new Map();
  }

  _cleanTitle(title) {
    if (!title) return 'Track';
    return String(title)
      .replace(/\(Official (Music )?Video\)/gi, '')
      .replace(/\(Official Audio\)/gi, '')
      .replace(/\[Official (Music )?Video\]/gi, '')
      .replace(/\[Official Audio\]/gi, '')
      .replace(/\(Audio\)/gi, '')
      .replace(/\[Audio\]/gi, '')
      .replace(/\(Lyric(s)? Video\)/gi, '')
      .replace(/\[Lyric(s)? Video\]/gi, '')
      .replace(/\(Visualizer\)/gi, '')
      .replace(/\| Official Audio/gi, '')
      .trim();
  }

  _parseDuration(dur) {
    if (!dur) return 0;
    if (typeof dur === 'number') return dur;
    if (typeof dur === 'object' && dur.seconds) return dur.seconds;
    const parts = String(dur).split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  _formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  _optimizeThumbnail(url) {
    if (!url) return '';
    // Upgrade YouTube Music square thumbnails from 120px to 544px for ultra crisp covers
    return url.replace(/=w\d+-h\d+-l\d+-rj/g, '=w544-h544-l90-rj');
  }

  /**
   * Search specifically on YouTube Music catalog
   */
  async search(query, limit = 30) {
    try {
      if (!query || !query.trim()) return { success: true, results: [] };
      const q = query.trim();
      const yt = await YouTubeService.init();

      const results = [];
      const seen = new Set();

      // Priority 1: YouTube Music dedicated song search (Official Music Catalog)
      if (yt && yt.music) {
        try {
          const musicSearch = await yt.music.search(q, { type: 'song' });
          const songs = musicSearch.songs?.contents || musicSearch.contents || [];

          for (const item of songs) {
            if (!item || !item.id || seen.has(item.id)) continue;
            seen.add(item.id);

            const title = item.title?.text || item.title || 'Track';
            const artists = Array.isArray(item.artists)
              ? item.artists.map(a => a.name).filter(Boolean).join(', ')
              : (item.artist?.name || item.author?.name || item.author || 'Artist');
            const albumName = item.album?.name || 'Single';
            const dur = item.duration?.seconds || this._parseDuration(item.duration?.text);
            const thumb = this._optimizeThumbnail(item.thumbnails?.[0]?.url || item.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`);

            results.push({
              id: item.id,
              title: title,
              rawTitle: title,
              artist: artists || 'Artist',
              album: albumName,
              duration: dur,
              durationFormatted: this._formatDuration(dur),
              thumbnail: thumb,
              views: ''
            });

            if (results.length >= limit) break;
          }
        } catch (mErr) {
          console.warn('[YouTubeMusicService] yt.music.search warning, trying fallback:', mErr.message);
        }
      }

      // Priority 2: Fallback to general YouTube search if no music results
      if (results.length === 0) {
        const searchRes = await yt.search(q, { type: 'video' });
        for (const item of searchRes.videos || []) {
          if (!item || !item.id || seen.has(item.id)) continue;
          seen.add(item.id);

          const rawTitle = item.title?.text || item.title || 'Track';
          const cleanTitle = this._cleanTitle(rawTitle);
          const author = item.author?.name || item.author || 'Artist';
          const durationSecs = this._parseDuration(item.duration?.text || item.duration?.seconds);
          const thumb = item.thumbnails?.[0]?.url || (`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`);

          results.push({
            id: item.id,
            title: cleanTitle,
            rawTitle,
            artist: author,
            album: 'Single',
            duration: durationSecs,
            durationFormatted: this._formatDuration(durationSecs),
            thumbnail: thumb,
            views: item.views?.text || ''
          });

          if (results.length >= limit) break;
        }
      }

      return { success: true, results };
    } catch (err) {
      console.error('[YouTubeMusicService] search error:', err.message);
      return { success: false, error: err.message, results: [] };
    }
  }

  async getTrending(genre = 'all') {
    const genreQueries = {
      all: 'أناشيد إسلامية مشهورة بدون موسيقى',
      trending: 'أناشيد إسلامية تريند بدون إيقاع',
      nasheed: 'أجمل أناشيد إسلامية هادفة بدون موسيقى',
      quran: 'تلاوات خاشعة مؤثرة جدا قرآن كريم',
      adkar: 'أذكار الصباح والمساء وأدعية خاشعة',
      ruqyah: 'الرقية الشرعية الشاملة لعلاج العين والحسد',
      prophet: 'قصائد ومدائح نبوية في حب النبي صلى الله عليه وسلم',
      calm: 'تلاوات هادئة تريح القلب للنوم والاسترخاء'
    };

    const q = genreQueries[genre.toLowerCase()] || genreQueries.all;
    return this.search(q, 30);
  }

  async getAudioStreamUrl(videoId) {
    if (!videoId) return { success: false, error: 'Video ID is required' };

    const cached = this.cache.get(videoId);
    if (cached && (Date.now() - cached.timestamp < 3 * 3600 * 1000)) {
      return { success: true, streamUrl: cached.streamUrl, duration: cached.duration };
    }

    try {
      const videoUrl = 'https://www.youtube.com/watch?v=' + videoId;

      // Priority 1: yt-dlp binary with android client
      try {
        const dlpOut = await execYtDlp('--no-check-certificate --extractor-args "youtube:player_client=android,web" -g -f "bestaudio[ext=m4a]/bestaudio/best" "' + videoUrl + '"', { timeout: 12000 });
        if (dlpOut && dlpOut.includes('http')) {
          const streamUrl = dlpOut.split('\n').map(l => l.trim()).find(l => l.startsWith('http'));
          if (streamUrl) {
            this.cache.set(videoId, { streamUrl, timestamp: Date.now() });
            return { success: true, streamUrl };
          }
        }
      } catch (dlpErr) {
        console.warn('[YouTubeMusicService] yt-dlp stream extraction warning:', dlpErr.message);
      }

      // Priority 2: Innertube audio format decipher
      try {
        const yt = await YouTubeService.init();
        const info = await yt.getInfo(videoId);
        const audioFmt = info.chooseFormat({ type: 'audio', quality: 'best' });
        if (audioFmt) {
          let streamUrl = null;
          if (typeof audioFmt.decipher === 'function' && yt.session?.player) {
            streamUrl = await audioFmt.decipher(yt.session.player);
          } else if (audioFmt.url) {
            streamUrl = audioFmt.url;
          }
          if (streamUrl) {
            this.cache.set(videoId, { streamUrl, timestamp: Date.now() });
            return { success: true, streamUrl };
          }
        }
      } catch (innerErr) {
        console.warn('[YouTubeMusicService] Innertube audio format warning:', innerErr.message);
      }

      // Priority 3: Invidious / Piped audio mirrors
      const mirrors = [
        'https://pipedapi.kavin.rocks/streams/' + videoId,
        'https://api.piped.privacydev.net/streams/' + videoId
      ];

      for (const mirror of mirrors) {
        try {
          const resp = await fetch(mirror, { signal: AbortSignal.timeout(5000) });
          if (resp.ok) {
            const data = await resp.json();
            const audioStream = (data.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (audioStream && audioStream.url) {
              return { success: true, streamUrl: audioStream.url };
            }
          }
        } catch (mErr) {}
      }

      throw new Error('Could not resolve playable audio stream for track');
    } catch (err) {
      console.error('[YouTubeMusicService] getAudioStreamUrl error:', err.message);
      return { success: false, error: err.message };
    }
  }

  async downloadTrack(track, customFolder = null) {
    try {
      if (!track || !track.id) throw new Error('Track metadata is required');

      let destDir = customFolder;
      if (!destDir) {
        try {
          destDir = (app && typeof app.getPath === 'function') ? app.getPath('music') : path.join(os.homedir(), 'Music');
        } catch (e) {
          destDir = path.join(os.homedir(), 'Music');
        }
      }

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const streamRes = await this.getAudioStreamUrl(track.id);
      if (!streamRes.success || !streamRes.streamUrl) {
        throw new Error(streamRes.error || 'Failed to extract audio stream URL');
      }

      const safeArtist = (track.artist || 'Unknown Artist').replace(/[\\/:*?"<>|]/g, '_');
      const safeTitle = (track.title || 'Track').replace(/[\\/:*?"<>|]/g, '_');
      const filename = safeArtist + ' - ' + safeTitle + '.m4a';
      const targetPath = path.join(destDir, filename);

      const resp = await fetch(streamRes.streamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/'
        }
      });

      if (!resp.ok) throw new Error('HTTP download failed with status ' + resp.status);

      const arrayBuffer = await resp.arrayBuffer();
      fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

      console.log('[YouTubeMusicService] ✓ Downloaded ' + filename + ' (' + arrayBuffer.byteLength + ' bytes) to ' + targetPath);

      return {
        success: true,
        filePath: targetPath,
        filename,
        size: arrayBuffer.byteLength
      };
    } catch (err) {
      console.error('[YouTubeMusicService] downloadTrack error:', err.message);
      return { success: false, error: err.message };
    }
  }

  _isQuran(title) {
    if (!title) return false;
    const lower = title.toLowerCase();
    const quranKeywords = ['سورة', 'سوره', 'surah', 'sourate', 'surat', 'تلاوة', 'تلاوه', 'مصحف', 'قرآن', 'قران', 'quran', 'qari', 'البقرة', 'الكهف', 'يوسف', 'مريم', 'الملك', 'يس', 'الرحمن', 'الواقعة', 'تبارك', 'جزء عم'];
    return quranKeywords.some(kw => lower.includes(kw));
  }

  _detectSurah(title) {
    if (!title) return null;
    const clean = title.toLowerCase();
    const titleNorm = clean
      .replace(/[أإآ]/g, 'ا')
      .replace(/[ى]/g, 'ي')
      .replace(/[ة]/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '');

    // Sort surahs by Arabic length descending so longer surahs match first
    const sortedSurahs = [...ALL_QURAN_SURAHS].sort((a, b) => b.ar.length - a.ar.length);

    for (const s of sortedSurahs) {
      const arClean = s.ar
        .replace(/[أإآ]/g, 'ا')
        .replace(/[ى]/g, 'ي')
        .replace(/[ة]/g, 'ه')
        .replace(/[\u064B-\u065F]/g, '');
      const arNoAl = arClean.replace(/^ال/, '');

      // For 1-letter surahs like 'ص' or 'ق', require explicit prefix like 'سورة ص' or 'سوره ص'
      if (arClean.length <= 1) {
        if (new RegExp('(?:سورة|سوره)\\s*' + arClean).test(titleNorm)) return s;
        continue;
      }

      // Check with 'سورة' or 'سوره'
      const patternWithPrefix = new RegExp('(?:سورة|سوره)\\s*(?:ال)?' + arNoAl);
      if (patternWithPrefix.test(titleNorm)) return s;

      // Check standalone whole word match if surah name has at least 3 letters
      if (arClean.length >= 3) {
        const patternWord = new RegExp('(?:^|[\\s\\-_|/(\\[])(?:' + arClean + '|' + arNoAl + ')(?:[\\s\\-_|/)\\]]|$)');
        if (patternWord.test(titleNorm)) return s;
      }

      // English Match
      const enNames = [s.en.toLowerCase(), ...(s.alt || [])];
      for (const name of enNames) {
        const enRegex = new RegExp('(?:surah|sourate|surat|chapter)?\\s*\\b' + name.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\$&') + '\\b', 'i');
        if (enRegex.test(clean)) return s;
      }
    }
    return null;
  }

  /**
   * Dual-engine lyrics resolver: Quran Uthmani Reader + LRCLIB (Synced LRC) + YouTube Music Native Lyrics
   */
  async getLyrics(rawTitle, rawArtist, duration, videoId) {
    try {
      // 0. Quran Recitation Detection & Uthmani Text Resolver
      if (this._isQuran(rawTitle) || this._isQuran(rawArtist)) {
        const surah = this._detectSurah(rawTitle);
        if (surah) {
          try {
            const qRes = await fetch(`https://api.alquran.cloud/v1/surah/${surah.no}/quran-uthmani`, { timeout: 8000 });
            if (qRes.ok) {
              const qData = await qRes.json();
              if (qData?.data?.ayahs && Array.isArray(qData.data.ayahs)) {
                return {
                  success: true,
                  isQuran: true,
                  surahNumber: surah.no,
                  surahNameAr: surah.ar,
                  surahNameEn: surah.en,
                  ayahs: qData.data.ayahs.map(a => ({
                    numberInSurah: a.numberInSurah,
                    text: a.text
                  }))
                };
              }
            }
          } catch (qErr) {
            console.warn('[YouTubeMusicService] Quran Cloud API error:', qErr.message);
          }
        }
        return {
          success: true,
          isQuran: true,
          isGenericQuran: true,
          surahNameAr: 'القرآن الكريم',
          surahNameEn: 'Holy Quran Recitation'
        };
      }

      // 1. Advanced title sanitization
      let cleanTitle = (rawTitle || '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/official\s+(music\s+)?(video|audio|lyric\s+video|visualizer)/gi, ' ')
        .replace(/\s+(ft|feat|featuring)\.?\s+[^-\n\r]+/gi, ' ')
        .replace(/\b(4k|hd|hq|audio|video|remastered|lyrics?)\b/gi, ' ');

      if (cleanTitle.includes('-')) {
        const parts = cleanTitle.split('-');
        if (parts.length >= 2) {
          cleanTitle = parts.slice(1).join(' ');
        }
      }
      cleanTitle = cleanTitle.replace(/[|#@!~_]/g, ' ').replace(/\s+/g, ' ').trim();

      // 2. Clean artist
      let cleanArtist = (rawArtist || '')
        .replace(/\s*-\s*Topic/i, '')
        .replace(/\s+(ft|feat|featuring)\.?\s+.*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      const userAgentHeader = { 'User-Agent': 'MEEM-Music-Player/2.0 (github.com/amromotaw3/MEEM)' };

      // Strategy A: Exact LRCLIB match with clean track_name and artist_name
      try {
        let u1 = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        if (duration) u1 += `&duration=${Math.round(duration)}`;
        const r1 = await fetch(u1, { headers: userAgentHeader });
        if (r1.ok) {
          const d1 = await r1.json();
          if (d1.syncedLyrics || d1.plainLyrics) {
            return {
              success: true,
              syncedLyrics: d1.syncedLyrics || null,
              plainLyrics: d1.plainLyrics || null
            };
          }
        }
      } catch (e) {}

      // Strategy B: YouTube Music Native Lyrics via Innertube
      if (videoId) {
        try {
          const yt = await YouTubeService.init();
          if (yt && yt.music) {
            const trackInfo = await yt.music.getInfo(videoId);
            if (trackInfo) {
              const nativeLyrics = await trackInfo.getLyrics();
              if (nativeLyrics && nativeLyrics.description?.text) {
                return {
                  success: true,
                  syncedLyrics: null,
                  plainLyrics: nativeLyrics.description.text
                };
              }
            }
          }
        } catch (ytLyricsErr) {}
      }

      // Strategy C: LRCLIB Combined Fuzzy Search
      try {
        const q1 = `${cleanArtist} ${cleanTitle}`.trim();
        const r2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q1)}`, { headers: userAgentHeader });
        if (r2.ok) {
          const d2 = await r2.json();
          if (Array.isArray(d2) && d2.length > 0) {
            const matched = d2.find(r => r.syncedLyrics) || d2[0];
            return {
              success: true,
              syncedLyrics: matched.syncedLyrics || null,
              plainLyrics: matched.plainLyrics || null
            };
          }
        }
      } catch (e) {}

      // Strategy D: Search with title only
      try {
        const r3 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`, { headers: userAgentHeader });
        if (r3.ok) {
          const d3 = await r3.json();
          if (Array.isArray(d3) && d3.length > 0) {
            const matched = d3.find(r => r.syncedLyrics) || d3[0];
            return {
              success: true,
              syncedLyrics: matched.syncedLyrics || null,
              plainLyrics: matched.plainLyrics || null
            };
          }
        }
      } catch (e) {}
    } catch (err) {
      console.warn('[YouTubeMusicService] getLyrics error:', err.message);
    }
    return { success: false, error: 'No lyrics found' };
  }
}

module.exports = new YouTubeMusicService();
