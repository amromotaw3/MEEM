/**
 * Advanced SubStation Alpha (.ass / .ssa) Subtitle Renderer Module
 * Powered by SubtitlesOctopus (libass-wasm) — Renders DIRECTLY on video canvas like VLC.
 *
 * Assets are served from: src/renderer/lib/libass-wasm/ (relative to index.html)
 * This avoids any require() / node_modules access from sandboxed renderer.
 */

(function () {
  'use strict';

  let currentOctopusInstance = null;
  let scriptLoadPromise = null;

  // Base path — relative to renderer/index.html which lives in src/renderer/
  // All libass-wasm assets were copied to src/renderer/lib/libass-wasm/
  const LIBASS_BASE = 'lib/libass-wasm';

  /**
   * Load SubtitlesOctopus constructor into window global.
   * First tries local copy, then CDN fallback.
   */
  function ensureOctopusLoaded() {
    if (scriptLoadPromise) return scriptLoadPromise;

    scriptLoadPromise = new Promise((resolve) => {
      if (typeof window.SubtitlesOctopus !== 'undefined') {
        return resolve(true);
      }

      const tryLoad = (src, onOk, onFail) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = onOk;
        s.onerror = onFail;
        document.head.appendChild(s);
      };

      const localSrc = `${LIBASS_BASE}/subtitles-octopus.js`;
      console.log('[ASS] Loading SubtitlesOctopus from:', localSrc);

      tryLoad(
        localSrc,
        () => {
          console.log('[ASS] SubtitlesOctopus loaded from local lib/');
          resolve(true);
        },
        () => {
          console.warn('[ASS] Local load failed, trying CDN...');
          tryLoad(
            'https://cdn.jsdelivr.net/npm/libass-wasm@4.1.0/dist/js/subtitles-octopus.js',
            () => { console.log('[ASS] Loaded from CDN'); resolve(true); },
            () => {
              console.error('[ASS] Failed to load SubtitlesOctopus');
              scriptLoadPromise = null;
              resolve(false);
            }
          );
        }
      );
    });

    return scriptLoadPromise;
  }

  /**
   * Attach ASS/SSA subtitles directly on a <video> element.
   * Renders a canvas overlay with full VLC-like styling, positioning, and motion effects.
   *
   * @param {HTMLVideoElement} videoNode
   * @param {string} assUrl   - blob: URL or http(s): URL pointing to raw .ass / .ssa content
   * @param {Object} [opts]   - Optional overrides
   * @returns {Promise<Object|null>}
   */
  async function attachAssSubtitles(videoNode, assUrl, opts = {}) {
    destroyAssSubtitles(); // Free previous WASM instance

    if (!videoNode || !assUrl) {
      console.warn('[ASS] Missing videoNode or assUrl');
      return null;
    }

    const loaded = await ensureOctopusLoaded();
    if (!loaded || typeof window.SubtitlesOctopus === 'undefined') {
      console.warn('[ASS] SubtitlesOctopus unavailable');
      return null;
    }

    const config = {
      video: videoNode,
      subUrl: assUrl,

      // Worker + WASM assets — relative paths from renderer/index.html
      workerUrl:      `${LIBASS_BASE}/subtitles-octopus-worker.js`,
      wasmUrl:        `${LIBASS_BASE}/subtitles-octopus-worker.wasm`,
      legacyWasmUrl:  `${LIBASS_BASE}/subtitles-octopus-worker-legacy.js`,

      // Arabic + Latin fallback fonts (loaded as network requests — OK in Electron)
      fonts: opts.fonts || [
        'https://fonts.gstatic.com/s/cairo/v28/SLtkH156lWqg4B8wUtF2.ttf',
        'https://fonts.gstatic.com/s/amiri/v27/J7aRnpd8CGxBHpUrtLMA.ttf',
        'https://fonts.gstatic.com/s/notosansarabic/v18/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfyGyvu3CBFQLaig.ttf',
      ],

      renderMode: 'jsCanvas',
      prescaleFactor: 1.0,
      prescaleHeightLimit: 1080,
      targetFps: 60,
      debug: false,

      ...opts
    };

    try {
      currentOctopusInstance = new window.SubtitlesOctopus(config);
      console.log('[ASS] ✅ Subtitles attached (full libass canvas rendering):', assUrl);
      return currentOctopusInstance;
    } catch (err) {
      console.error('[ASS] SubtitlesOctopus error:', err);
      currentOctopusInstance = null;
      return null;
    }
  }

  /**
   * Destroy current WASM instance and remove any orphaned canvases.
   */
  function destroyAssSubtitles() {
    if (currentOctopusInstance) {
      try {
        currentOctopusInstance.dispose();
        console.log('[ASS] WASM instance disposed');
      } catch (e) {
        console.warn('[ASS] Dispose warning:', e.message);
      }
      currentOctopusInstance = null;
    }
    // Remove any canvas injected by SubtitlesOctopus
    document.querySelectorAll('.libassjs-canvas-parent, canvas.libassjs-canvas').forEach(el => {
      try { el.remove(); } catch (_) {}
    });
  }

  function setAssSubtitleOffset(seconds) {
    if (!currentOctopusInstance) return;
    try { currentOctopusInstance.setTimeOffset(seconds); } catch (_) {}
  }

  function resizeAssSubtitles() {
    if (!currentOctopusInstance) return;
    try { currentOctopusInstance.resize(); } catch (_) {}
  }

  function isAssActive() {
    return currentOctopusInstance !== null;
  }

  // Auto-resize on layout changes
  window.addEventListener('resize', resizeAssSubtitles);
  document.addEventListener('fullscreenchange', () => setTimeout(resizeAssSubtitles, 200));

  // Global API
  window.AssSubtitleEngine = {
    attach:      attachAssSubtitles,
    destroy:     destroyAssSubtitles,
    setOffset:   setAssSubtitleOffset,
    resize:      resizeAssSubtitles,
    isActive:    isAssActive,
    getInstance: () => currentOctopusInstance
  };

  console.log('[ASS] AssSubtitleEngine ready (lib/libass-wasm/)');
})();
