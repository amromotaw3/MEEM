const { session } = require('electron');

/**
 * MediaVault v2 - Main Process IPTV IPC & Header Interceptor
 * Intercepts network requests to IPTV stream domains (.m3u8, .ts, live ports)
 * and injects headers to bypass 403 Forbidden / CORS issues enforced by IPTV providers.
 */
function initIptvIpc(ipcMain) {
  try {
    if (session && session.defaultSession) {
      // Unified interceptor — handles IPTV streams AND YouTube googlevideo.com streams.
      // Electron only allows ONE onBeforeSendHeaders handler per session.
      session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
        const requestHeaders = { ...details.requestHeaders };
        const url = details.url || '';

        // ── YouTube googlevideo.com streams ──────────────────────────────
        if (url.includes('googlevideo.com')) {
          delete requestHeaders['Sec-Fetch-Site'];
          delete requestHeaders['Sec-Fetch-Mode'];
          delete requestHeaders['Sec-Fetch-Dest'];
          delete requestHeaders['sec-ch-ua'];
          delete requestHeaders['sec-ch-ua-mobile'];
          delete requestHeaders['sec-ch-ua-platform'];

          if (url.includes('c=ANDROID_VR')) {
            requestHeaders['User-Agent'] = 'com.google.android.apps.youtube.vr.oculus/1.40.16 (Linux; U; Android 10; en_US; Quest 2)';
            delete requestHeaders['Referer'];
            delete requestHeaders['Origin'];
          } else if (url.includes('c=ANDROID')) {
            requestHeaders['User-Agent'] = 'com.google.android.youtube/19.29.37 (Linux; U; Android 11; en_US)';
            delete requestHeaders['Referer'];
            delete requestHeaders['Origin'];
          } else if (url.includes('c=TVHTML5')) {
            requestHeaders['User-Agent'] = 'Mozilla/5.0 (Linux; GoogleTV 12; Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Safari/537.36';
            requestHeaders['Referer'] = 'https://www.youtube.com/tv';
            requestHeaders['Origin'] = 'https://www.youtube.com';
          } else {
            requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
            requestHeaders['Referer'] = 'https://www.youtube.com/';
            requestHeaders['Origin'] = 'https://www.youtube.com';
          }
          return callback({ cancel: false, requestHeaders });
        }

        // ── IPTV streams (.m3u8, .ts, .mpd, live/movie/series paths) ───
        const isIptvStream = url.includes('.m3u8') || url.includes('.ts?') || url.endsWith('.ts')
          || url.includes('.mpd') || /\/(live|movie|series)\//i.test(url);

        if (isIptvStream) {
          if (!requestHeaders['User-Agent'] || requestHeaders['User-Agent'].includes('Electron')) {
            requestHeaders['User-Agent'] = 'IPTVSmartersPro/1.0 (MediaVault/2.0)';
          }
          if (!requestHeaders['Referer']) {
            try {
              const parsed = new URL(url);
              requestHeaders['Referer'] = `${parsed.protocol}//${parsed.host}/`;
            } catch (e) {
              requestHeaders['Referer'] = url;
            }
          }
        }

        callback({ cancel: false, requestHeaders });
      });

      console.log('[IPTV Main IPC] Unified network header interceptor attached successfully.');
    }
  } catch (err) {
    console.error('[IPTV Main IPC] Header interceptor setup failed:', err.message);
  }

  // Fast M3U text parser in Main Process
  ipcMain.handle('iptv-parse-m3u-text', async (event, content) => {
    try {
      if (!content || typeof content !== 'string') return { channels: [], categories: [] };
      return parseM3U(content);
    } catch (err) {
      console.error('[IPTV Main IPC] Parse M3U Error:', err);
      return { error: err.message, channels: [], categories: [] };
    }
  });
}

/**
 * High-performance line-by-line M3U Parser
 */
function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  const categorySet = new Set(['All']);
  let currentMeta = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentMeta = parseExtInf(line);
    } else if (line.startsWith('#EXTGRP:')) {
      if (currentMeta) {
        currentMeta.category = line.replace('#EXTGRP:', '').trim();
      }
    } else if (!line.startsWith('#')) {
      if (currentMeta) {
        currentMeta.url = line;
        currentMeta.id = 'ch_' + hashCode(`${currentMeta.name}_${currentMeta.url}`);
        if (!currentMeta.category) currentMeta.category = 'Uncategorized';

        categorySet.add(currentMeta.category);
        channels.push(currentMeta);
        currentMeta = null;
      }
    }
  }

  return {
    channels,
    categories: Array.from(categorySet)
  };
}

function parseExtInf(line) {
  const meta = {
    name: 'Untitled Channel',
    logo: '',
    category: 'Uncategorized',
    tvgId: '',
    groupTitle: ''
  };

  const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
  if (tvgIdMatch) meta.tvgId = tvgIdMatch[1];

  const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
  if (logoMatch) meta.logo = logoMatch[1];

  const groupMatch = line.match(/group-title="([^"]*)"/i);
  if (groupMatch) {
    meta.category = groupMatch[1];
    meta.groupTitle = groupMatch[1];
  }

  const commaIdx = line.lastIndexOf(',');
  if (commaIdx !== -1) {
    meta.name = line.substring(commaIdx + 1).trim() || meta.name;
  }

  return meta;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

module.exports = { initIptvIpc };
