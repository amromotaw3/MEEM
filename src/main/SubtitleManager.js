const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getCleanMetadata, isLocalFilePath } = require('./utils/MetadataNormalizer');

const SUBDL_API_BASE = 'https://api.subdl.com/api/v1/subtitles';
const SUBDL_DOWNLOAD_BASE = 'https://dl.subdl.com';

class SubtitleProvider {
  constructor(name, priority) {
    this.name = name;
    this.priority = priority;
  }

  async getSubtitles() {
    throw new Error('SubtitleProvider.getSubtitles must be implemented');
  }
}

class LocalSubtitleProvider extends SubtitleProvider {
  constructor() {
    super('Local File', 10);
  }

  async getSubtitles(context) {
    const videoPath = context?.media?.path;
    if (!videoPath || /^https?:\/\//i.test(videoPath) || String(videoPath).startsWith('local-file')) return [];

    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
    const out = [];

    try {
      for (const file of fs.readdirSync(dir)) {
        const ext = path.extname(file).toLowerCase();
        const stem = path.basename(file, ext).toLowerCase();
        if (!['.srt', '.vtt', '.ass', '.ssa'].includes(ext) || !stem.startsWith(base)) continue;
        const fullPath = path.join(dir, file);
        out.push({
          id: `local:${fullPath}`,
          source: 'local',
          sourceLabel: this.name,
          label: file,
          lang: 'und',
          format: ext.slice(1),
          url: fullPath,
          priority: this.priority
        });
      }
    } catch (err) {
      console.warn('[SubtitleManager] LocalSubtitleProvider failed:', err.message);
    }

    return out;
  }
}

/**
 * SubDL Direct API Provider — calls https://api.subdl.com/api/v1/subtitles directly
 * using the user's API key + IMDb ID. No Stremio addon protocol wrapper.
 */
class SubDLDirectProvider extends SubtitleProvider {
  constructor(getAppData) {
    super('SubDL', 20);
    this.getAppData = getAppData;
  }

  async getSubtitles(context) {
    const appData = this.getAppData() || {};

    // Ensure Direct SubDL integration is enabled by the user (always enabled now)
    const isEnabled = true;

    // Get API key from subdlConfig or top-level subdlKey
    const apiKey = appData.subdlConfig?.apiKey || appData.subdlKey || '';
    if (!apiKey) {
      console.warn('[SubDL Direct] No API key configured. Skipping.');
      return [];
    }

    const metadata = context?.metadata || {};
    const { imdbId, type, season, episode, title } = metadata;

    if (!imdbId && !title) {
      console.warn('[SubDL Direct] No IMDb ID or title available.');
      return [];
    }

    // Get user language preferences
    const languages = appData.subdlConfig?.languages || ['EN', 'AR'];
    const hearingImpairment = appData.subdlConfig?.hearingImpairment || 'hiInclude';

    // Build query params for SubDL API
    const params = {
      api_key: apiKey,
      languages: languages.join(',').toLowerCase(),
      subs_per_page: 30
    };

    // Set hearing impairment filter
    if (hearingImpairment === 'hiOnly') {
      params.hi = true;
    } else if (hearingImpairment === 'hiExclude') {
      params.hi = false;
    }

    let isKeyInvalid = false;

    const querySubDL = async (qParams) => {
      if (isKeyInvalid) return null;
      try {
        const resp = await axios.get(SUBDL_API_BASE, {
          params: qParams,
          timeout: 4000,
          headers: {
            'User-Agent': 'MediaVault/3.0',
            'Accept': 'application/json'
          }
        });
        return resp.data;
      } catch (err) {
        console.warn('[SubDL Direct] API Query failed:', err.message);
        if (err.response) {
          const status = err.response.status;
          const errorMsg = String(err.response.data?.error || '').toLowerCase();
          if (status === 401 || status === 403 || status === 429 || (status === 400 && errorMsg.includes('api_key'))) {
            console.warn('[SubDL Direct] Fatal SubDL API Key or authentication error. Skipping subsequent search fallback requests.');
            isKeyInvalid = true;
          }
        }
        return null;
      }
    };

    let data = null;
    let shouldFilterClientSide = false;

    // Primary: search by IMDb ID
    if (imdbId && String(imdbId).startsWith('tt') && !metadata.isManualSearch) {
      params.imdb_id = imdbId;
      if (type !== 'movie' && season != null && episode != null) {
        // Step 1: Try narrow search with season and episode
        params.season_number = season;
        params.episode_number = episode;
        params.type = 'tv';
        console.log('[SubDL Direct] Querying with narrow IMDb search...', { imdbId, season, episode });
        data = await querySubDL(params);
        
        // Step 2: If narrow search returns no results, try broad search (whole show)
        if (!data || !data.status || !data.subtitles || data.subtitles.length === 0) {
          console.log('[SubDL Direct] Narrow search returned nothing. Trying broad IMDb search...');
          const broadParams = { ...params, subs_per_page: 100 };
          delete broadParams.season_number;
          delete broadParams.episode_number;
          data = await querySubDL(broadParams);
          if (data && data.status && data.subtitles && data.subtitles.length > 0) {
            shouldFilterClientSide = true;
          }
        }
      } else {
        params.type = 'movie';
        data = await querySubDL(params);
      }
    }

    // Step 3: Fallback to film_name search if IMDb search returned nothing or wasn't available
    if ((!data || !data.status || !data.subtitles || data.subtitles.length === 0) && title) {
      console.log('[SubDL Direct] IMDb search failed/unavailable. Querying by film_name:', title);
      const nameParams = {
        api_key: apiKey,
        languages: params.languages,
        subs_per_page: 30,
        film_name: title
      };
      if (params.hi !== undefined) nameParams.hi = params.hi;

      if (type !== 'movie' && season != null && episode != null) {
        // Try narrow film_name search
        nameParams.type = 'tv';
        nameParams.season_number = season;
        nameParams.episode_number = episode;
        data = await querySubDL(nameParams);

        // Try broad film_name search
        if (!data || !data.status || !data.subtitles || data.subtitles.length === 0) {
          console.log('[SubDL Direct] Narrow film_name search returned nothing. Trying broad film_name search...');
          const broadNameParams = { ...nameParams, subs_per_page: 100 };
          delete broadNameParams.season_number;
          delete broadNameParams.episode_number;
          data = await querySubDL(broadNameParams);
          if (data && data.status && data.subtitles && data.subtitles.length > 0) {
            shouldFilterClientSide = true;
          }
        }
      } else {
        nameParams.type = type === 'movie' ? 'movie' : 'tv';
        data = await querySubDL(nameParams);
      }
    }

    if (!data || !data.status) {
      console.warn('[SubDL Direct] API returned unsuccessful status:', JSON.stringify(data));
      return [];
    }

    const subtitles = data.subtitles || [];
    console.log(`[SubDL Direct] Found ${subtitles.length} raw subtitle entries`);

    if (!subtitles.length) return [];

    const matchEpisode = (sub, s, e) => {
      if (s == null || e == null) return true;
      const release = (sub.release_name || '').toLowerCase();
      const label = (sub.label || '').toLowerCase();
      
      const sStr = String(s).padStart(2, '0');
      const eStr = String(e).padStart(2, '0');
      
      const patterns = [
        `s${sStr}e${eStr}`,
        `s${s}e${e}`,
        `${s}x${eStr}`,
        `${s}x${e}`,
        `s${sStr} e${eStr}`,
        `s${s} e${e}`
      ];
      
      for (const p of patterns) {
        if (release.includes(p) || label.includes(p)) return true;
      }
      
      if (s === 1) {
        const epPatterns = [
          `episode ${e}`,
          `episode ${eStr}`,
          `ep ${e}`,
          `ep ${eStr}`,
          `ep${eStr}`,
          `ep${e}`
        ];
        for (const ep of epPatterns) {
          if (release.includes(ep) || label.includes(ep)) return true;
        }
      }
      
      const regexes = [
        new RegExp(`s(eason)?\\s*0*${s}\\s*e(pisode)?\\s*0*${e}\\b`, 'i'),
        new RegExp(`\\b0*${s}x0*${e}\\b`, 'i')
      ];
      for (const rx of regexes) {
        if (rx.test(release) || rx.test(label)) return true;
      }
      
      return false;
    };

    // Normalize SubDL API response to our format
    let results = subtitles.map((sub, index) => {
      let downloadUrl = sub.url || null;
      if (downloadUrl && !downloadUrl.startsWith('http')) {
        downloadUrl = `${SUBDL_DOWNLOAD_BASE}${downloadUrl}`;
      }
      if (!downloadUrl) return null;

      const lang = sub.lang || sub.language || 'Unknown';
      const langUpper = String(lang).toUpperCase();
      const hiTag = sub.hi ? ' [HI]' : '';
      const authorTag = sub.author ? ` by ${sub.author}` : '';
      const releaseTag = sub.release_name ? ` • ${sub.release_name}` : '';

      return {
        id: `subdl:${sub.sd_id || sub.subtitle_id || index}`,
        source: 'subdl',
        sourceLabel: 'SubDL',
        label: `${langUpper}${hiTag}${releaseTag}${authorTag}`,
        lang: langUpper,
        format: sub.format || 'zip',
        url: downloadUrl,
        priority: this.priority,
        hi: !!sub.hi,
        releaseName: sub.release_name || '',
        author: sub.author || ''
      };
    }).filter(sub => sub !== null && sub.url);

    if (shouldFilterClientSide && type !== 'movie' && season != null && episode != null) {
      const beforeCount = results.length;
      results = results.filter(sub => matchEpisode(sub, season, episode));
      console.log(`[SubDL Direct] Client-side filtering reduced subtitles from ${beforeCount} to ${results.length} for S${season}E${episode}`);
    }

    console.log(`[SubDL Direct] Returning ${results.length} normalized subtitles`);
    return results;
  }
}

class StremioSubtitleProvider extends SubtitleProvider {
  constructor(getAppData) {
    super('Stremio Addon', 15);
    this.getAppData = getAppData;
  }

  async getSubtitles(context) {
    try {
      const appData = typeof this.getAppData === 'function' ? this.getAppData() : {};
      const metadata = context?.metadata || {};
      const { imdbId, kitsuId, type, season, episode, title } = metadata;

      if (!imdbId && !kitsuId && !title) return [];

      const sc = appData.scraperConfig || {};
      sc.installedAddons = [...(appData.installedAddons || [])].filter(a => {
        const url = String(a.url || a.manifestUrl || '').toLowerCase();
        const id = String(a.id || '').toLowerCase();
        const name = String(a.name || '').toLowerCase();
        return a.enabled !== false && (url.includes('subdl') || id.includes('subdl') || name.includes('subdl'));
      });

      if (!sc.installedAddons.length) {
        return [];
      }

      const { StremioAddonService } = require('./StremioAddonService');
      const service = new StremioAddonService(sc);
      const res = await service.getSubtitles({ imdbId, kitsuId, type: type === 'series' || type === 'tv' ? 'series' : type, season, episode, title });
      
      return (res || []).map(sub => ({
        id: `stremio:${sub.id}`,
        source: sub.addon.toLowerCase().includes('opensubtitles') ? 'opensubtitles' : 'stremio',
        sourceLabel: sub.addon,
        label: sub.label,
        lang: sub.lang,
        format: sub.format || 'srt',
        url: sub.url,
        priority: this.priority
      }));
    } catch (err) {
      console.warn('[StremioSubtitleProvider] Failed:', err.message);
      return [];
    }
  }
}

class SubtitleManager {
  constructor(providers) {
    this.providers = providers;
  }

  async getSubtitles(context) {
    const settled = await Promise.allSettled(this.providers.map(provider => provider.getSubtitles(context)));
    return settled
      .flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [])
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  }
}

function initSubtitleManagerIpc(ipcMain, getAppData) {
  const manager = new SubtitleManager([
    new LocalSubtitleProvider(),
    new SubDLDirectProvider(getAppData),
    new StremioSubtitleProvider(getAppData)
  ]);

  ipcMain.handle('get-managed-subtitles', async (_event, context) => {
    try {
      const mediaPath = context?.media?.path || context?.media?.id;
      const hasImdb = context?.metadata?.imdbId;
      if (mediaPath && isLocalFilePath(mediaPath) && !hasImdb && !context?.metadata?.isManualSearch) {
        const cleanMeta = await getCleanMetadata(mediaPath, getAppData);
        if (cleanMeta) {
          context.metadata = context.metadata || {};
          context.metadata.imdbId = cleanMeta.imdbId || context.metadata.imdbId;
          context.metadata.season = cleanMeta.season || context.metadata.season;
          context.metadata.episode = cleanMeta.episode || context.metadata.episode;
          context.metadata.title = cleanMeta.title || context.metadata.title;
          context.metadata.type = cleanMeta.type === 'series' ? 'series' : 'movie';
        }
      }
      return await manager.getSubtitles(context || {});
    } catch (err) {
      console.error('[SubtitleManager] Failed:', err.message);
      return [];
    }
  });
}

module.exports = {
  SubtitleProvider,
  LocalSubtitleProvider,
  SubDLDirectProvider,
  SubtitleManager,
  initSubtitleManagerIpc
};
