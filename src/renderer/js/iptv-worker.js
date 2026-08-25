/**
 * MediaVault v2 - IPTV Web Worker
 * Runs heavy M3U string parsing in a background thread to prevent UI freezing.
 */

self.onmessage = function (e) {
  const { action, sourceId, m3uText } = e.data || {};

  if (action === 'parse') {
    try {
      parseM3uInWorker(sourceId, m3uText);
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  }
};

function parseM3uInWorker(sourceId, content) {
  if (!content) {
    self.postMessage({ type: 'complete', sourceId, channels: [], categories: ['All'] });
    return;
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const channels = [];
  const categorySet = new Set(['All']);
  let currentMeta = null;

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentMeta = parseExtInfLine(line);
    } else if (line.startsWith('#EXTGRP:')) {
      if (currentMeta) {
        currentMeta.category = line.replace('#EXTGRP:', '').trim();
      }
    } else if (!line.startsWith('#')) {
      if (currentMeta) {
        currentMeta.url = line;
        currentMeta.id = 'ch_' + String(sourceId || 'src') + '_' + simpleHash(`${currentMeta.name}_${currentMeta.url}`);
        if (!currentMeta.category) currentMeta.category = 'Uncategorized';

        categorySet.add(currentMeta.category);
        channels.push(currentMeta);
        currentMeta = null;
      }
    }

    // Report progress every 5000 lines
    if (i % 5000 === 0 && totalLines > 0) {
      const percent = Math.round((i / totalLines) * 100);
      self.postMessage({ type: 'progress', percent, parsedCount: channels.length });
    }
  }

  self.postMessage({
    type: 'complete',
    sourceId,
    channels,
    categories: Array.from(categorySet)
  });
}

function parseExtInfLine(line) {
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

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
