const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../src/renderer/renderer.js');
let js = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  if (js.includes(to.split('\n')[0].trim().slice(0, 40))) {
    console.log('skip:', label);
    return;
  }
  if (!js.includes(from)) {
    console.warn('MISSING:', label);
    return;
  }
  js = js.replace(from, to);
  console.log('applied:', label);
}

replaceOnce(
  'open-player',
  `  window.api.on('open-player', (options = {}) => {
    try {
      const payload = options.item || (options.url ? { path: options.url, title: options.title || 'Playback' } : null);
      if (!payload) return;
      if (typeof playVideo === 'function') {
        playVideo(payload, options.show || null);
      }
    } catch (e) {
      console.warn('[Renderer] open-player event failed', e);
    }
  });`,
  `  window.api.on('open-player', (options = {}) => {
    try {
      if (!isNativePlayerWindow()) return;
      const mediaPath = options.path || options.url;
      const payload = options.item || (mediaPath ? {
        path: mediaPath,
        url: mediaPath,
        title: options.title || 'Playback',
        displayTitle: options.title || 'Playback'
      } : null);
      if (!payload) return;
      if (typeof playVideo === 'function') {
        playVideo(payload, options.show || null);
      }
    } catch (e) {
      console.warn('[Renderer] open-player event failed', e);
    }
  });`
);

replaceOnce(
  'playStream torrent vlc',
  `          // Open torrent streams in external player (VLC) instead of internal playback
          try {
            if (window.api && window.api.invoke) {
              await window.api.invoke('open-in-external-player', { url: finalUrl, title: meta?.epTitle || meta?.title || meta?.name || '' });
              showToast('Opening torrent in external player...');
              return;
            } else if (window.api && window.api.openInVlc) {
              window.api.openInVlc(finalUrl);
              showToast('Opening torrent in external player...');
              return;
            }
          } catch (e) {
            console.warn('[Player] Failed to open external player, falling back to internal:', e?.message || e);
            // If external open fails, continue and let internal playVideo attempt playback
          }`,
  ''
);

replaceOnce(
  'playStream native',
  `      if (!finalUrl) throw new Error('No playable stream found');

      playVideo({`,
  `      if (!finalUrl) throw new Error('No playable stream found');

      if (window.api?.isElectron && !window.Capacitor) {
        const res = await requestNativePlayback({
          ...meta,
          path: finalUrl,
          title: meta?.epTitle || meta?.title || meta?.name || stream.name
        }, meta?.showName ? { title: meta.showName, id: meta.showId } : null);
        if (cardEl) cardEl.classList.remove('btn-loading');
        if (res?.success !== false) return;
      }

      playVideo({`
);

// player window boot
if (!js.includes('mv-native-player-window')) {
  replaceOnce(
    'boot player window',
    `      console.log('[INIT] Starting MediaVault Boot Sequence...');
    try {`,
    `      console.log('[INIT] Starting MediaVault Boot Sequence...');
    if (isNativePlayerWindow()) {
      document.body.classList.add('mv-native-player-window');
      try { await window.api.loadData(); } catch (e) { /* ignore */ }
      switchView('player');
      return;
    }
    try {`
  );
}

fs.writeFileSync(file, js);
console.log('Done');
