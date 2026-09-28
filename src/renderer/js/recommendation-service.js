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
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    if (this.cache.data && (now - this.cache.timestamp < CACHE_DURATION)) {
      console.log('[RECOMMENDATIONS] Returning cached recommendations');
      return { recommendations: this.cache.data, seedTitle: this.cache.seedTitle, isRecent: this.cache.isRecent };
    }

    try {
      const items = Array.isArray(userLibraryList) ? userLibraryList : [];
      let seed = null;
      let isRecent = false;

      if (items.length > 0) {
        // Most recently added item in watchlist/library
        seed = items[0];
        isRecent = true;
      } else {
        // Default popular seeds for empty libraries
        const defaultSeeds = [
          { title: 'Interstellar', type: 'movie' },
          { title: 'Attack on Titan', type: 'anime' },
          { title: 'Breaking Bad', type: 'tv' },
          { title: 'Demon Slayer', type: 'anime' },
          { title: 'Inception', type: 'movie' },
          { title: 'Solo Leveling', type: 'anime' }
        ];
        seed = defaultSeeds[Math.floor(Math.random() * defaultSeeds.length)];
        isRecent = false;
      }

      const seedTitle = seed.title || seed.name || 'this title';
      const searchSeed = seed.imdb_id || seed.imdbId || seedTitle;

      console.log(`[RECOMMENDATIONS] Fetching smart recommendations for seed: "${seedTitle}"`);
      
      let rawRecs = [];
      if (window.api && typeof window.api.invoke === 'function') {
        const resp = await window.api.invoke('get-smart-recommendations', searchSeed).catch(() => null);
        rawRecs = resp?.results || [];
      }

      if (!rawRecs || rawRecs.length === 0) {
        return { recommendations: [], seedTitle: '', isRecent: false };
      }

      // Filter out items already in the user's library
      const libraryTitles = new Set((items || []).map(i => (i.title || i.name || '').trim().toLowerCase()));
      const libraryIds = new Set((items || []).map(i => String(i.id || i.anime_id || i.imdb_id || i.imdbId || '')));

      const formatted = rawRecs
        .filter(item => {
          if (!item) return false;
          const t = (item.title || item.name || '').trim().toLowerCase();
          const keyId = String(item.id || item.tmdb_id || item.mal_id || '');
          if (!t) return false;
          if (libraryTitles.has(t)) return false;
          if (keyId && libraryIds.has(keyId)) return false;
          return true;
        })
        .map(item => {
          const isAnime = item.type === 'anime' || item.source === 'kitsu' || String(item.id).startsWith('kitsu:');
          const poster = item.poster || item.poster_path || '';
          const backdrop = item.backdrop || item.backdrop_path || '';

          return {
            id: item.id,
            tmdb_id: item.tmdb_id || null,
            mal_id: item.mal_id || null,
            anilist_id: item.anilist_id || null,
            title: item.title || item.name,
            name: item.title || item.name,
            poster: poster,
            poster_path: poster,
            backdrop: backdrop,
            backdrop_path: backdrop,
            type: isAnime ? 'anime' : (item.type || 'movie'),
            source: isAnime ? 'kitsu' : (item.source || 'tmdb'),
            rating: item.rating || item.vote_average || 0,
            score: item.rating || item.vote_average || 0,
            year: item.releaseYear || item.year || '',
            releaseYear: item.releaseYear || item.year || '',
            synopsis: item.synopsis || item.overview || '',
            format: isAnime ? 'TV' : (item.type === 'movie' ? 'Movie' : 'TV Series')
          };
        })
        .slice(0, 18);

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
