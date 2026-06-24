class FanartService {
  /**
   * Fetches the highest resolution background from Fanart.tv
   * @param {string} imdbId - The IMDB ID (e.g. tt1234567)
   * @param {string} type - 'movie' or 'series'
   * @returns {string|null} The URL of the highest resolution banner
   */
  static async getBackground(imdbId, type) {
    if (!window.api || !window.api.fanartGetImages) return null;
    try {
      const data = await window.api.fanartGetImages(imdbId, type);
      if (!data) return null;

      const bgArray = data.moviebackground || data.showbackground || [];
      if (bgArray.length > 0) {
        // Sort by likes as a proxy for quality/popularity
        const best = bgArray.sort((a, b) => b.likes - a.likes)[0];
        return best ? best.url : null;
      }
      return null;
    } catch (e) {
      console.error('[FanartService] getBackground error:', e);
      return null;
    }
  }

  static async getLogo(imdbId, type) {
    if (!window.api || !window.api.fanartGetImages) return null;
    try {
      const data = await window.api.fanartGetImages(imdbId, type);
      if (!data) return null;

      const logoArray = data.hdmovielogo || data.hdtvlogo || data.clearlogo || [];
      if (logoArray.length > 0) {
        const best = logoArray.sort((a, b) => b.likes - a.likes)[0];
        return best ? best.url : null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.FanartService = FanartService;
}
