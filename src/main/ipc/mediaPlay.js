const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { toMediaProtocolUrl } = require('../mediaProtocol');
const { createPlayerWindow } = require('../windowManager');
const { startStreaming } = require('../streamer');

function initMediaPlayIpc(ipcMain) {
  async function playMedia(args) {
    try {
      const opts = typeof args === 'string' ? { path: args } : (args || {});
      const raw = opts.url || opts.path || opts.pathOrUrl || opts.filePath || '';
      const startTime = typeof opts.startTime === 'number' ? Math.max(0, Math.floor(opts.startTime)) : 0;

      // ── DETECT MAGNET / INFOHASH ──
      const isMagnet = /^magnet:/i.test(raw);
      const isInfoHash = /^[a-f0-9]{40}$/i.test(raw);

      if (isMagnet || isInfoHash) {
        console.log('[PLAY] Detected torrent input, starting WebTorrent stream...');
        const res = await startStreaming(raw, opts.fileIdx ?? null);
        if (!res || !res.success) {
          throw new Error(res?.error || 'Failed to start torrent stream');
        }
        let streamUrl = res.localUrl || res.url;
        console.log('[PLAY] Torrent stream ready:', streamUrl);
        createPlayerWindow({
          url: streamUrl,
          path: streamUrl,
          title: opts.title || res.title || opts.name || 'Torrent Playback',
          startTime,
          pbKey: opts.pbKey,
          item: {
            ...(opts.item || {}),
            torrentFiles: res.files,
            fileIdx: res.fileIdx,
            torrentMagnet: raw
          },
          show: opts.show,
          isTorrentStream: true
        });
        return { success: true, player: 'native', source: 'torrent', streamUrl };
      }

      // ── LOCAL FILE or HTTP URL ──
      const mediaUrl = toMediaProtocolUrl(raw);
      createPlayerWindow({
        url: mediaUrl,
        path: mediaUrl,
        title: opts.title || opts.name || 'Playback',
        startTime,
        pbKey: opts.pbKey,
        item: opts.item,
        show: opts.show
      });
      return { success: true, player: 'native' };
    } catch (err) {
      console.error('[PLAY] Native player failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async function openInVlc(args) {
    try {
      const opts = typeof args === 'string' ? { path: args } : (args || {});
      let raw = opts.url || opts.path || opts.pathOrUrl || opts.filePath || '';

      const isMagnet = /^magnet:/i.test(raw) || /^[a-f0-9]{40}$/i.test(raw);
      if (isMagnet) {
        const res = await startStreaming(raw, opts.fileIdx ?? null);
        if (!res || !res.success) throw new Error(res?.error || 'Failed to start torrent stream');
        raw = res.localUrl || res.url;
      }

      // Prefer explicit local file / stream URL
      // Determine VLC executable per platform
      let vlcCmd = null;
      if (process.platform === 'win32') {
        const p1 = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe');
        const p2 = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe');
        if (fs.existsSync(p1)) vlcCmd = p1;
        else if (fs.existsSync(p2)) vlcCmd = p2;
        else vlcCmd = 'vlc';
      } else if (process.platform === 'darwin') {
        // Use 'open -a VLC <url>' on macOS
        vlcCmd = 'open';
      } else {
        vlcCmd = 'vlc';
      }

      let child;
      if (process.platform === 'darwin') {
        child = spawn(vlcCmd, ['-a', 'VLC', raw], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn(vlcCmd, [raw], { detached: true, stdio: 'ignore' });
      }
      try { child.unref(); } catch (e) { /* ignore */ }
      return { success: true };
    } catch (e) {
      console.error('[VLC] openInVlc failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  ipcMain.handle('play-media', async (_e, args) => playMedia(args));
  ipcMain.handle('open-in-external-player', async (_e, args) => playMedia(args));
  ipcMain.handle('open-in-vlc', async (_e, args) => openInVlc(args));
  ipcMain.handle('play-external', async (_e, args) => playMedia(args));
  ipcMain.handle('play-native', async (_e, args) => playMedia(args));

  // Start a one-off local HTTP stream for a given filesystem path and return the stream URL
  ipcMain.handle('start-local-server', async (_e, filePath) => {
    try {
      if (!filePath) return null;
      const { startServer } = require('../mediaServer');
      const url = startServer(filePath);
      return url;
    } catch (err) {
      console.error('[IPC] start-local-server error:', err);
      return null;
    }
  });
}

module.exports = { initMediaPlayIpc };
