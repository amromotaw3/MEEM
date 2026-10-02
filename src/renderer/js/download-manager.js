/**
 * MEEM Unified Download Manager (Adapter Pattern)
 * Provides a single, clean API for both Electron (PC) and Capacitor (Android/Mobile)
 */
(function(window) {
  'use strict';

  // ─── 1. Platform Detection ──────────────────────────────────────────────────
  const isElectron = !!(window.electronAPI?.download || (window.api && !window.Capacitor));
  const isCapacitor = !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.Plugins?.Filesystem);

  // ─── 2. Utility Helpers ─────────────────────────────────────────────────────
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
  }

  function detectDownloadType(url) {
    if (!url) return 'direct';
    if (url.startsWith('magnet:') || url.endsWith('.torrent') || url.includes('infoHash=')) {
      return 'torrent';
    }
    if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|reddit\.com|twitch\.tv|bilibili\.com|soundcloud\.com|vimeo\.com|dailymotion\.com)/i.test(url)) {
      return 'social';
    }
    return 'direct';
  }

  // ─── 3. Electron PC Adapter ─────────────────────────────────────────────────
  class ElectronDownloadAdapter {
    async init() {
      console.log('[Downloader] Initialized Electron Download Adapter.');
    }

    async startDownload(req) {
      if (window.electronAPI?.download?.start) {
        return await window.electronAPI.download.start(req);
      }
      if (window.api?.startDownload) {
        return await window.api.startDownload(req);
      }
      throw new Error('Electron download IPC bridge not found.');
    }

    async pauseDownload(id) {
      if (window.electronAPI?.download?.pause) return await window.electronAPI.download.pause(id);
      if (window.api?.pauseDownload) return await window.api.pauseDownload(id);
      return false;
    }

    async resumeDownload(id) {
      if (window.electronAPI?.download?.resume) return await window.electronAPI.download.resume(id);
      if (window.api?.resumeDownload) return await window.api.resumeDownload(id);
      return false;
    }

    async cancelDownload(id) {
      if (window.electronAPI?.download?.cancel) return await window.electronAPI.download.cancel(id);
      if (window.api?.cancelDownload) return await window.api.cancelDownload(id);
      return false;
    }

    onProgress(callback) {
      if (window.electronAPI?.download?.onProgress) {
        return window.electronAPI.download.onProgress(callback);
      }
      const handler = (e) => {
        if (e.detail) callback(e.detail);
      };
      window.addEventListener('download-progress', handler);
      return () => window.removeEventListener('download-progress', handler);
    }
  }

  // ─── 4. Capacitor Mobile Adapter ────────────────────────────────────────────
  class CapacitorDownloadAdapter {
    constructor() {
      this.plugin = window.Capacitor?.Plugins?.MeemDownloader || null;
      this.listenerHandles = [];
    }

    async init() {
      if (window.Capacitor?.Plugins?.MeemDownloader) {
        this.plugin = window.Capacitor.Plugins.MeemDownloader;
        console.log('[Downloader] Initialized Native MeemDownloader Capacitor Plugin.');
      } else {
        console.warn('[Downloader] MeemDownloader native plugin not registered, using Capacitor Filesystem fallback.');
      }
    }

    async startDownload(req) {
      if (this.plugin && typeof this.plugin.startDownload === 'function') {
        const res = await this.plugin.startDownload(req);
        return res || { id: req.id };
      }

      // Fallback via Bridge startDownload
      if (window.api?.startDownload) {
        return await window.api.startDownload(req);
      }
      throw new Error('No mobile download handler available.');
    }

    async pauseDownload(id) {
      if (this.plugin && typeof this.plugin.pauseDownload === 'function') {
        const res = await this.plugin.pauseDownload({ id });
        return res?.success || false;
      }
      return false;
    }

    async resumeDownload(id) {
      if (this.plugin && typeof this.plugin.resumeDownload === 'function') {
        const res = await this.plugin.resumeDownload({ id });
        return res?.success || false;
      }
      return false;
    }

    async cancelDownload(id) {
      if (this.plugin && typeof this.plugin.cancelDownload === 'function') {
        const res = await this.plugin.cancelDownload({ id });
        return res?.success || false;
      }
      return false;
    }

    onProgress(callback) {
      if (this.plugin && typeof this.plugin.addListener === 'function') {
        let handle = null;
        this.plugin.addListener('downloadProgress', (data) => {
          callback(data);
        }).then(h => {
          handle = h;
          this.listenerHandles.push(h);
        });

        return () => {
          if (handle) {
            handle.remove();
            this.listenerHandles = this.listenerHandles.filter(x => x !== handle);
          }
        };
      }

      // Fallback DOM event listener
      const handler = (e) => {
        if (e.detail) callback(e.detail);
      };
      window.addEventListener('download-progress', handler);
      return () => window.removeEventListener('download-progress', handler);
    }
  }

  // ─── 5. Web/Browser Fallback Adapter ─────────────────────────────────────────
  class WebDownloadAdapter {
    async init() {}
    async startDownload(req) {
      const a = document.createElement('a');
      a.href = req.url;
      a.download = req.fileName || 'download';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { id: req.id || 'web_' + Date.now() };
    }
    async pauseDownload() { return false; }
    async resumeDownload() { return false; }
    async cancelDownload() { return false; }
    onProgress() { return () => {}; }
  }

  // ─── 6. DownloadManager Facade ──────────────────────────────────────────────
  class DownloadManager {
    constructor() {
      this.adapter = null;
      this.activeDownloads = new Map();
      this.subscribers = new Set();
      this.isReady = false;
      this._selectAdapter();
    }

    _selectAdapter() {
      if (isElectron) {
        this.adapter = new ElectronDownloadAdapter();
      } else if (isCapacitor) {
        this.adapter = new CapacitorDownloadAdapter();
      } else {
        this.adapter = new WebDownloadAdapter();
      }
    }

    async init() {
      if (this.isReady) return;
      await this.adapter.init();
      this.adapter.onProgress((progress) => {
        if (!progress || !progress.id) return;
        this.activeDownloads.set(progress.id, progress);
        
        // Notify all registered subscribers
        this.subscribers.forEach(cb => {
          try { cb(progress); } catch(e) { console.error('[Downloader] Progress callback error:', e); }
        });

        // Also dispatch standard DOM CustomEvents for UI components listening via window
        window.dispatchEvent(new CustomEvent('download-progress', { detail: progress }));
        if (progress.status === 'completed') {
          window.dispatchEvent(new CustomEvent('download-complete', { detail: progress }));
        } else if (progress.status === 'error') {
          window.dispatchEvent(new CustomEvent('download-error', { detail: progress }));
        } else if (progress.status === 'cancelled') {
          window.dispatchEvent(new CustomEvent('download-cancelled', { detail: progress }));
        }
      });
      this.isReady = true;
    }

    async download(url, options = {}) {
      if (!this.isReady) await this.init();

      const type = options.type || detectDownloadType(url);
      const id = options.id || 'dl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const req = {
        id,
        url,
        type,
        name: options.name || options.fileName || 'download',
        fileName: options.fileName || options.name,
        destinationPath: options.destinationPath,
        format: options.format || 'video',
        quality: options.quality || 'best',
        profileName: options.profileName || window.currentProfile?.name || 'Default'
      };

      this.activeDownloads.set(id, {
        id,
        name: req.name,
        status: 'queued',
        percent: 0,
        downloaded: '0 B',
        total: '...',
        speed: '0 B/s',
        eta: '--:--',
        phaseMessage: 'Queued...'
      });

      try {
        const res = await this.adapter.startDownload(req);
        return res?.id || id;
      } catch (err) {
        const errProgress = {
          id,
          name: req.name,
          status: 'error',
          percent: 0,
          error: err.message || 'Failed to start download'
        };
        this.activeDownloads.set(id, errProgress);
        window.dispatchEvent(new CustomEvent('download-error', { detail: errProgress }));
        throw err;
      }
    }

    async pause(id) {
      return await this.adapter.pauseDownload(id);
    }

    async resume(id) {
      return await this.adapter.resumeDownload(id);
    }

    async cancel(id) {
      const success = await this.adapter.cancelDownload(id);
      if (success) {
        this.activeDownloads.delete(id);
      }
      return success;
    }

    subscribe(callback) {
      this.subscribers.add(callback);
      return () => this.subscribers.delete(callback);
    }

    getAll() {
      return Array.from(this.activeDownloads.values());
    }

    get(id) {
      return this.activeDownloads.get(id);
    }

    detectType(url) {
      return detectDownloadType(url);
    }

    formatBytes(bytes) {
      return formatBytes(bytes);
    }
  }

  // ─── Export to Global Scope ─────────────────────────────────────────────────
  const downloadManagerInstance = new DownloadManager();
  window.MEEM_DownloadManager = downloadManagerInstance;

  // Composable hook for Vue / Nuxt
  window.useDownloadManager = function() {
    return downloadManagerInstance;
  };

})(typeof window !== 'undefined' ? window : global);
