// ─── recommendation-service.js ─── MediaVault Smart Recommendation Engine ───

window.RecommendationService = {
  cache: {
    data: null,
    timestamp: 0,
    seedTitle: '',
    isRecent: false
  },

  async generatePersonalizedRecommendations(userLibraryList) {
    const now = Date.now();
    const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

    if (this.cache.data && (now - this.cache.timestamp < CACHE_DURATION)) {
      console.log('[RECOMMENDATIONS] Returning cached recommendations');
      return { recommendations: this.cache.data, seedTitle: this.cache.seedTitle, isRecent: this.cache.isRecent };
    }

    try {
      const animeItems = (userLibraryList || []).filter(item => {
        const idStr = String(item.id || '');
        return item.source === 'kitsu' || !idStr.startsWith('tmdb:') || item.anime_id;
      });

      let seed = null;
      let isRecent = false;
      if (animeItems.length > 0) {
        // Since toggleWatchlist unshifts items, index 0 is always the most recently added item!
        seed = animeItems[0];
        isRecent = true;
      } else {
        // Default seeds for new/empty profiles
        const defaultSeeds = [
          { id: 38000, title: 'Demon Slayer' },
          { id: 30276, title: 'One Punch Man' },
          { id: 21, title: 'One Piece' },
          { id: 5114, title: 'Fullmetal Alchemist: Brotherhood' }
        ];
        seed = defaultSeeds[Math.floor(Math.random() * defaultSeeds.length)];
        isRecent = false;
      }

      const seedId = seed.id || seed.anime_id;
      const seedTitle = seed.title || seed.name || 'this show';

      console.log(`[RECOMMENDATIONS] Fetching recommendations for seed: "${seedTitle}" (ID: ${seedId})`);
      const response = await window.api.invoke('mal-recommendations', seedId);

      if (!response || !response.data || !Array.isArray(response.data)) {
        return { recommendations: [], seedTitle: '' };
      }

      // Filter out items already in the user's library list
      const libraryTitles = new Set((userLibraryList || []).map(i => (i.title || i.name || '').toLowerCase()));
      const libraryIds = new Set((userLibraryList || []).map(i => String(i.id || i.anime_id || '')));

      const formatted = response.data
        .map(entry => {
          const node = entry.entry;
          if (!node) return null;
          return {
            id: node.mal_id,
            title: node.title,
            poster_path: node.images?.webp?.large_image_url || node.images?.webp?.image_url || node.images?.jpg?.large_image_url || '',
            source: 'kitsu', // Treat Jikan suggestions as kitsu items so they open in our beautiful unified detail view!
            score: 0,
            year: '',
            format: 'TV'
          };
        })
        .filter(item => {
          if (!item || !item.title) return false;
          const keyId = String(item.id);
          const keyTitle = item.title.toLowerCase();
          return !libraryIds.has(keyId) && !libraryTitles.has(keyTitle);
        })
        .slice(0, 15); // Return top 15 recommendations

      // Save to cache
      this.cache.data = formatted;
      this.cache.timestamp = now;
      this.cache.seedTitle = seedTitle;
      this.cache.isRecent = isRecent;

      return { recommendations: formatted, seedTitle, isRecent };
    } catch (e) {
      console.warn('[RECOMMENDATIONS] Generation failed', e);
      return { recommendations: [], seedTitle: '', isRecent: false };
    }
  }
};
