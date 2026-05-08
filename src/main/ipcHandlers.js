const { dialog, shell, app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { BANNERS_DIR, ensureDir, loadData, saveData } = require('./store');
const { getMainWindow } = require('./windowManager');

let currentTmdbKey = null;
let currentSubdlKey = null;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const JIKAN_BASE = 'https://api.jikan.moe/v4';

let metadataProvider = 'tmdb'; // 'tmdb' or 'mal'

function tmdbFetch(endpoint) {
  if (!currentTmdbKey) {
    console.warn('[TMDB] No API key set.');
    return Promise.resolve({ error: 'TMDB API key required. Please configure it in settings.' });
  }
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${TMDB_BASE}${endpoint}${sep}api_key=${currentTmdbKey}&include_adult=false`;
  console.log(`[TMDB] Fetching: ${url.replace(currentTmdbKey, '***')}`);
  
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400 || json.success === false) {
            console.error(`[TMDB] API Error ${res.statusCode}:`, json.status_message || data);
            resolve({ error: json.status_message || `API Error ${res.statusCode}` });
          } else {
            console.log(`[TMDB] Success! Results count: ${json.results?.length || 0}`);
            resolve(json);
          }
        } catch (e) {
          console.error('[TMDB] Parse Error:', e.message, data.slice(0, 100));
          resolve({ error: 'Invalid response from TMDB' });
        }
      });
    });
    req.on('error', (err) => {
      console.error('[TMDB] Request Error:', err.message);
      resolve({ error: 'Connectivity Error: ' + err.message });
    });
    req.on('timeout', () => { 
      console.error('[TMDB] Request Timeout');
      req.destroy(); 
      resolve({ error: 'TMDB Request Timed Out' }); 
    });
  });
}

async function jikanFetch(endpoint) {
  try {
    const url = `${JIKAN_BASE}${endpoint}`;
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'MediaVault/3.0' } });
    return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      return { error: 'Jikan API rate limited - please try again later' };
    }
    return { error: 'Jikan API Error: ' + (err.message || 'Unknown error') };
  }
}

function initMiscIpc(ipcMain) {
  const data = loadData();
  if (data.tmdbKey) currentTmdbKey = data.tmdbKey;
  if (data.subdlKey) currentSubdlKey = data.subdlKey;
  if (data.metadataProvider) metadataProvider = data.metadataProvider;
  
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('clear-cache', () => {
    try {
      if (fs.existsSync(BANNERS_DIR)) {
        for (const file of fs.readdirSync(BANNERS_DIR)) fs.unlinkSync(path.join(BANNERS_DIR, file));
      }
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('select-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('select-download-folder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'], title: 'Select Download Location' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('get-default-library-root', () => {
    return path.join(app.getPath('videos'), 'MediaVault');
  });

  ipcMain.handle('open-external', (_e, url) => { shell.openExternal(url); });

  ipcMain.handle('open-in-external-player', (_e, pathOrUrl) => {
    if (pathOrUrl.startsWith('http')) {
      shell.openExternal(pathOrUrl);
    } else {
      shell.openPath(pathOrUrl);
    }
  });

  ipcMain.handle('delete-file', async (_e, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        await shell.trashItem(filePath);
        return { success: true };
      }
      return { success: false, error: 'File not found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-subtitle-dialog', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile'], title: 'Select Subtitle', filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('set-custom-banner', async (_e, itemId) => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile'], title: 'Select Cover', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR); const src = r.filePaths[0], ext = path.extname(src);
    const safe = Buffer.from(itemId).toString('base64').replace(/[/+=]/g, '_');
    const dest = path.join(BANNERS_DIR, safe + ext); fs.copyFileSync(src, dest); return dest;
  });

  ipcMain.handle('select-files', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'm4v'] }] });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('move-file', async (_e, { src, dest }) => {
    try {
      if (!fs.existsSync(src)) return { success: false, error: 'Source missing' };
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(src, dest);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('create-folder', async (_e, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        return true;
      }
      return false;
    } catch (e) { return false; }
  });

  ipcMain.handle('rename-file', (_e, oldPath, newName) => {
    try {
      const newPath = path.join(path.dirname(oldPath), newName);
      fs.renameSync(oldPath, newPath);
      return { success: true, newPath };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // TMDB handlers
  ipcMain.handle('tmdb-search', async (_e, type, query) => {
    try {
      return await tmdbFetch(`/search/${type}?query=${encodeURIComponent(query)}`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-details', async (_e, type, id) => {
    try {
      return await tmdbFetch(`/${type}/${id}?append_to_response=credits,videos,external_ids`);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tmdb-trending', async () => {
    try {
      return await tmdbFetch('/trending/all/week');
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-popular', async (_e, type) => {
    try {
      return await tmdbFetch(`/${type}/popular`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-top-rated', async (_e, type) => {
    try {
      return await tmdbFetch(`/${type}/top_rated`);
    } catch (err) {
      return { results: [], error: err.message };
    }
  });

  ipcMain.handle('tmdb-upcoming', async () => { try { return await tmdbFetch('/movie/upcoming'); } catch (err) { return { results: [], error: err.message }; } });
  
  ipcMain.handle('tmdb-anime-featured', async () => {
    try {
      return await tmdbFetch('/discover/tv?with_genres=16&sort_by=popularity.desc');
    } catch (err) {
      return { results: [], error: err.message };
    }
  });
  ipcMain.handle('tmdb-credits', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/credits`); } catch (err) { return { cast: [], error: err.message }; } });
  ipcMain.handle('tmdb-videos', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/videos`); } catch (err) { return { results: [], error: err.message }; } });
  ipcMain.handle('tmdb-providers', async (_e, type, id) => { try { return await tmdbFetch(`/${type}/${id}/watch/providers`); } catch (err) { return { results: {}, error: err.message }; } });
  ipcMain.handle('tmdb-search-discover', async (_e, query) => {
    try {
      const q = query.trim();
      if (metadataProvider === 'mal') {
        const result = await jikanFetch(`/anime?query=${encodeURIComponent(q)}&status=complete`);
        if (result.data) {
          return {
            results: result.data.map(anime => ({
              id: anime.mal_id,
              mal_id: anime.mal_id,
              name: anime.title,
              title: anime.title,
              poster_path: anime.images?.jpg?.image_url,
              overview: anime.synopsis,
              popularity: anime.score || 0,
              media_type: 'tv',
              source: 'mal'
            }))
          };
        }
        return result;
      }
      const imdbMatch = q.match(/^(tt)?(\d{7,9})$/);
      if (imdbMatch) {
        const imdbId = imdbMatch[1] ? q : `tt${imdbMatch[2]}`;
        const find = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
        const results = [];
        if (find.movie_results?.length) find.movie_results.forEach(r => results.push({ ...r, media_type: 'movie' }));
        if (find.tv_results?.length) find.tv_results.forEach(r => results.push({ ...r, media_type: 'tv' }));
        if (results.length > 0) return JSON.parse(JSON.stringify({ results }));
      }
      const [movies, shows] = await Promise.all([
        tmdbFetch(`/search/movie?query=${encodeURIComponent(q)}`),
        tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}`)
      ]);
      const out = { results: [...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })), ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))] };
      return JSON.parse(JSON.stringify(out));
    } catch (err) { return { results: [], error: err.message }; }
  });

  ipcMain.handle('tmdb-season-details', async (_e, tvId, seasonNumber) => {
    try { return await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`); }
    catch (err) { return { episodes: [], error: err.message }; }
  });

  ipcMain.handle('tmdb-external-ids', async (_e, { id, type }) => {
    try { return await tmdbFetch(`/${type}/${id}/external_ids`); }
    catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('tmdb-discover-by-genre', async (_e, genreId) => {
    try {
      if (metadataProvider === 'mal') {
        const result = await jikanFetch(`/anime?status=complete&orderBy=score&sort=desc&limit=40`);
        if (result.data) {
          return {
            results: result.data.map(anime => ({
              id: anime.mal_id,
              mal_id: anime.mal_id,
              name: anime.title,
              title: anime.title,
              poster_path: anime.images?.jpg?.image_url,
              overview: anime.synopsis,
              popularity: anime.score || 0,
              media_type: 'tv',
              source: 'mal'
            }))
          };
        }
        return result;
      }
      const tvGenreMap = { '28': '10759', '878': '10765', '27': '10765' };
      const movieGenre = genreId;
      const tvGenre = tvGenreMap[genreId] || genreId;
      const [movies, shows] = await Promise.all([
        tmdbFetch(`/discover/movie?with_genres=${movieGenre}&sort_by=popularity.desc`),
        tmdbFetch(`/discover/tv?with_genres=${tvGenre}&sort_by=popularity.desc`)
      ]);
      const results = [
        ...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })),
        ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))
      ];
      results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      return { results: results.slice(0, 40) };
    }
    catch (err) { return { results: [], error: err.message }; }
  });

  ipcMain.handle('download-image', async (_e, imgPath, itemId) => {
    if (!imgPath) return null;
    ensureDir(BANNERS_DIR);
    let url = (imgPath.startsWith('http')) ? imgPath : `${TMDB_IMG}/w500${imgPath}`;
    const safe = Buffer.from(String(itemId)).toString('base64').replace(/[/+=]/g, '_');
    const dest = path.join(BANNERS_DIR, safe + '.jpg');
    if (fs.existsSync(dest)) return dest;
    return new Promise((resolve) => {
      const file = fs.createWriteStream(dest);
      const proto = url.startsWith('https') ? https : require('http');
      const req = proto.get(url, { headers: { 'User-Agent': 'MediaVault/3.0' }, timeout: 10000 }, (res) => {
        if (res.statusCode !== 200) { file.close(); try { fs.unlinkSync(dest); } catch (e) {} resolve(null); return; }
        res.pipe(file); file.on('finish', () => { file.close(); resolve(dest); });
      });
      req.on('error', (err) => { file.close(); try { fs.unlinkSync(dest); } catch (e) {} resolve(null); });
      req.on('timeout', () => { req.destroy(); file.close(); try { fs.unlinkSync(dest); } catch (e) {} resolve(null); });
    });
  });

  ipcMain.handle('fetch-icon', async (_e, faviconUrl) => {
    try {
      const response = await fetch(faviconUrl);
      if (!response.ok) throw new Error('Failed to fetch icon');
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mime = response.headers.get('content-type') || 'image/x-icon';
      return `data:${mime};base64,${base64}`;
    } catch (err) { console.error('Icon fetch error:', err); return null; }
  });

  ipcMain.handle('is-media-link', (_e, url) => {
    const mediaExts = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.wav', '.flac', '.srt', '.vtt'];
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      return mediaExts.includes(ext);
    } catch (e) { return false; }
  });

  ipcMain.handle('save-frame', async (_e, { id, data }) => {
    try {
      ensureDir(BANNERS_DIR);
      const safe = Buffer.from(id).toString('base64').replace(/[/+=]/g, '_');
      const dest = path.join(BANNERS_DIR, safe + '.jpg');
      const base64Data = data.replace(/^data:image\/jpeg;base64,/, "");
      fs.writeFileSync(dest, base64Data, 'base64');
      return { path: dest };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('get-profile-media-paths', (_e, profileName) => {
    if (!profileName) return null;
    const { app: electronApp } = require('electron');
    const p = (sub) => path.join(electronApp.getPath('videos'), 'MediaVault', profileName, sub);
    return { movies: p('Movies'), series: p('Series'), social: p('Social'), music: p('Music') };
  });

  ipcMain.handle('ensure-profile-folders', (_e, profileName) => {
    if (!profileName) return false;
    const { app: electronApp } = require('electron');
    const basePath = path.join(electronApp.getPath('videos'), 'MediaVault', profileName);
    const subDirs = ['Movies', 'Series', 'Social', 'Music'];
    try {
      subDirs.forEach(sub => {
        const fullPath = path.join(basePath, sub);
        if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
      });
      return true;
    } catch (err) { return false; }
  });

  ipcMain.handle('rename-profile-folders', async (_e, oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return false;
    const { app: electronApp } = require('electron');
    const oldPath = path.join(electronApp.getPath('videos'), 'MediaVault', oldName);
    const newPath = path.join(electronApp.getPath('videos'), 'MediaVault', newName);
    try {
      if (fs.existsSync(oldPath)) {
        if (fs.existsSync(newPath)) return false;
        fs.renameSync(oldPath, newPath);
        return true;
      } else {
        const subDirs = ['Movies', 'Series', 'Social', 'Music'];
        subDirs.forEach(sub => {
          const fullPath = path.join(newPath, sub);
          if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
        });
        return true;
      }
    } catch (err) { return false; }
  });

  ipcMain.handle('select-user-avatar', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'], title: 'Select Avatar Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'png'] }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    ensureDir(BANNERS_DIR);
    const src = r.filePaths[0], ext = path.extname(src);
    const dest = path.join(BANNERS_DIR, `avatar_${Date.now()}${ext}`);
    fs.copyFileSync(src, dest); return dest;
  });

  ipcMain.handle('get-metadata-provider', () => metadataProvider);
  ipcMain.handle('set-metadata-provider', (_e, p) => {
    if (['tmdb', 'mal'].includes(p)) {
      metadataProvider = p; const data = loadData(); data.metadataProvider = p; saveData(data); return true;
    }
    return false;
  });

  ipcMain.handle('set-tmdb-key', (_e, key) => {
    if (key && key.trim().length > 0) {
      currentTmdbKey = key.trim(); const data = loadData(); data.tmdbKey = currentTmdbKey; saveData(data); return true;
    }
    return false;
  });

  ipcMain.handle('get-tmdb-key-masked', () => {
    if (!currentTmdbKey) return '';
    if (currentTmdbKey.length <= 4) return '••••••••••••';
    return currentTmdbKey.substring(0, 2) + '••••••••••' + currentTmdbKey.substring(currentTmdbKey.length - 2);
  });

  ipcMain.handle('verify-tmdb-key', async (_e, key) => {
    try {
      const testUrl = `${TMDB_BASE}/movie/550?api_key=${key}`;
      const response = await new Promise((resolve) => {
        https.get(testUrl, { timeout: 5000, headers: { 'User-Agent': 'MediaVault/3.0' } }, (res) => {
          resolve(res.statusCode);
        }).on('error', () => resolve(0));
      });
      return response === 200;
    } catch { return false; }
  });

  ipcMain.handle('get-subdl-key', () => currentSubdlKey);
  ipcMain.handle('set-subdl-key', (_e, key) => {
    if (key && key.trim().length > 0) {
      currentSubdlKey = key.trim(); const data = loadData(); data.subdlKey = currentSubdlKey; saveData(data); return true;
    }
    return false;
  });
  ipcMain.handle('get-subdl-key-masked', () => {
    if (!currentSubdlKey) return '';
    if (currentSubdlKey.length <= 4) return '••••••••••••';
    return currentSubdlKey.substring(0, 2) + '••••••••••' + currentSubdlKey.substring(currentSubdlKey.length - 2);
  });

  ipcMain.handle('verify-subdl-key', async (_e, key) => {
    try {
      const testUrl = `https://api.subdl.com/api/v1/subtitles?api_key=${key}&type=movie&tmdb_id=550`;
      const response = await axios.get(testUrl, { timeout: 5000 });
      return response.status === 200;
    } catch { return false; }
  });

  ipcMain.handle('mal-search', async (_e, query) => {
    if (!query.trim()) return { data: [] };
    try { return await jikanFetch(`/anime?query=${encodeURIComponent(query)}&status=complete`); }
    catch (err) { return { error: err.message, data: [] }; }
  });

  ipcMain.handle('kitsu-search', async (_e, query) => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}`, {
        headers: { 'Accept': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' }, timeout: 8000
      });
      const media = response.data?.data || [];
      const results = media.map(m => {
        const attr = m.attributes;
        const titles = attr.titles || {};
        return {
          id: m.id,
          title: attr.canonicalTitle || titles.en || titles.en_jp || 'Unknown',
          title_english: titles.en || '',
          title_romaji: titles.en_jp || '',
          overview: attr.synopsis,
          poster_path: attr.posterImage?.large || attr.posterImage?.original || '',
          backdrop_path: attr.coverImage?.large || attr.coverImage?.original || '',
          vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
          first_air_date: attr.startDate || '',
          media_type: 'anime',
          source: 'kitsu',
          episodes: attr.episodeCount || 0,
          status: attr.status || ''
        };
      });
      return { results };
    } catch (err) { return { results: [], error: err.message }; }
  });

  ipcMain.handle('kitsu-trending', async () => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/trending/anime`, {
        headers: { 'Accept': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' }, timeout: 8000
      });
      const media = response.data?.data || [];
      const results = media.map(m => {
        const attr = m.attributes;
        const titles = attr.titles || {};
        return {
          id: m.id,
          title: attr.canonicalTitle || titles.en || titles.en_jp || 'Unknown',
          title_english: titles.en || '',
          title_romaji: titles.en_jp || '',
          overview: attr.synopsis,
          poster_path: attr.posterImage?.large || attr.posterImage?.original || '',
          backdrop_path: attr.coverImage?.large || attr.coverImage?.original || '',
          vote_average: attr.averageRating ? parseFloat(attr.averageRating) / 10 : 0,
          first_air_date: attr.startDate || '',
          media_type: 'anime',
          source: 'kitsu',
          episodes: attr.episodeCount || 0,
          status: attr.status || ''
        };
      });
      return { results };
    } catch (err) { return { results: [], error: err.message }; }
  });

  ipcMain.handle('kitsu-episodes', async (_e, animeId) => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/anime/${animeId}/episodes?page[limit]=100&sort=number`, {
        headers: { 'Accept': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' }, timeout: 8000
      });
      const episodes = response.data?.data || [];
      return episodes.map(ep => ({
        id: ep.id,
        number: ep.attributes?.number,
        title: ep.attributes?.canonicalTitle || ep.attributes?.titles?.en_jp || `Episode ${ep.attributes?.number}`,
        overview: ep.attributes?.synopsis || '',
        airdate: ep.attributes?.airdate || '',
        thumbnail: ep.attributes?.thumbnail?.original || ''
      }));
    } catch (err) { return []; }
  });

  ipcMain.handle('kitsu-cast', async (_e, animeId) => {
    try {
      const response = await axios.get(`https://kitsu.io/api/edge/castings?filter[media_id]=${animeId}&filter[media_type]=Anime&include=character,person&page[limit]=20`, {
        headers: { 'Accept': 'application/vnd.api+json', 'User-Agent': 'MediaVault/3.0' }, timeout: 8000
      });
      const castings = response.data?.data || [];
      const included = response.data?.included || [];
      const cast = castings.map(c => {
        const relChar = c.relationships?.character?.data;
        const relPerson = c.relationships?.person?.data;
        const char = included.find(i => i.type === 'characters' && i.id === relChar?.id);
        const person = included.find(i => i.type === 'people' && i.id === relPerson?.id);
        
        let profile = '';
        if (char?.attributes?.image) profile = char.attributes.image.original || char.attributes.image.medium;
        if (!profile && person?.attributes?.image) profile = person.attributes.image.original || person.attributes.image.medium;

        return {
          name: person?.attributes?.name || 'Unknown',
          character: char?.attributes?.name || 'Unknown',
          profile_path: profile || ''
        };
      }).filter(c => c.name !== 'Unknown');
      return cast;
    } catch (err) { 
      console.error('[Kitsu] Cast fetch error:', err);
      return []; 
    }
  });

  ipcMain.handle('open-in-vlc', async (_e, filePath) => {
    try {
      const { spawn } = require('child_process');
      const { startServer } = require('./mediaServer');
      let finalUrl = filePath;
      if (fs.existsSync(filePath)) {
        finalUrl = startServer(filePath);
        console.log('[VLC] Serving local file via stream:', finalUrl);
      }
      if (process.platform === 'win32') {
        const vlcPaths = [
          path.join(process.env['ProgramFiles'], 'VideoLAN', 'VLC', 'vlc.exe'),
          path.join(process.env['ProgramFiles(x86)'], 'VideoLAN', 'VLC', 'vlc.exe'),
          'vlc'
        ];
        let vlcPath = vlcPaths.find(p => p === 'vlc' || fs.existsSync(p));
        if (vlcPath) { spawn(vlcPath, [finalUrl], { detached: true, stdio: 'ignore' }).unref(); return { success: true }; }
        else return { success: false, error: 'VLC not found' };
      } else {
        spawn('vlc', [finalUrl], { detached: true, stdio: 'ignore' }).unref(); return { success: true };
      }
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('fetch-proxy', async (_e, url, options = {}) => {
    try {
      const axios = require('axios');
      const response = await axios({
        url, method: options.method || 'GET', headers: { 'User-Agent': 'Mozilla/5.0' },
        data: options.body, timeout: 15000
      });
      return response.data;
    } catch (err) { return { error: err.message }; }
  });
}

module.exports = { initMiscIpc };
