// Mock electron to prevent app.getPath crash during store.js initialization
jest.mock('electron', () => ({
  app: {
    getPath: (name) => `mock-${name}-path`
  }
}));

const { StremioAddonService, buildImdbStreamId, buildKitsuStreamId, detectQuality } = require('../src/main/StremioAddonService');

describe('StremioAddonService unit tests', () => {
  describe('detectQuality', () => {
    test('detects 4K quality', () => {
      expect(detectQuality('Movie.2023.2160p.4K.BluRay')).toBe('4K');
      expect(detectQuality('UHD Movie')).toBe('4K');
    });

    test('detects 1080p quality', () => {
      expect(detectQuality('Movie.1080p.x264')).toBe('1080p');
      expect(detectQuality('Movie.FULLHD.1080P')).toBe('1080p');
    });

    test('detects 720p quality', () => {
      expect(detectQuality('Movie.720p.HDTV')).toBe('720p');
    });

    test('detects CAM quality', () => {
      expect(detectQuality('Movie.2023.HDTS.x264')).toBe('CAM');
      expect(detectQuality('Movie.2023.CAM.XViD')).toBe('CAM');
    });

    test('returns HD as fallback for generic streams', () => {
      expect(detectQuality('Movie.WebRip')).toBe('HD');
    });

    test('returns Unknown for empty/null text', () => {
      expect(detectQuality(null)).toBe('Unknown');
      expect(detectQuality('')).toBe('Unknown');
    });
  });

  describe('buildImdbStreamId', () => {
    test('returns null for invalid imdbId', () => {
      expect(buildImdbStreamId('123456', 'movie')).toBeNull();
      expect(buildImdbStreamId('', 'movie')).toBeNull();
    });

    test('builds movie stream ID', () => {
      const result = buildImdbStreamId('tt1234567', 'movie');
      expect(result).toEqual({ stremioType: 'movie', stremioId: 'tt1234567' });
    });

    test('builds series stream ID with season and episode', () => {
      const result = buildImdbStreamId('tt1234567', 'series', 2, 5);
      expect(result).toEqual({ stremioType: 'series', stremioId: 'tt1234567:2:5' });
    });
  });

  describe('buildKitsuStreamId', () => {
    test('returns null if kitsuId is empty', () => {
      expect(buildKitsuStreamId(null, 5)).toBeNull();
    });

    test('builds kitsu stream ID adding kitsu prefix if missing', () => {
      const result = buildKitsuStreamId('4521', 12);
      expect(result).toEqual({ stremioType: 'series', stremioId: 'kitsu:4521:12' });
    });

    test('builds kitsu stream ID preserving kitsu prefix if present', () => {
      const result = buildKitsuStreamId('kitsu:4521', 12);
      expect(result).toEqual({ stremioType: 'series', stremioId: 'kitsu:4521:12' });
    });
  });

  describe('StremioAddonService getStreams sorting', () => {
    test('sorts streams by quality then seeds count', async () => {
      const service = new StremioAddonService();
      
      const mockStreams = [
        { title: 'Stream 720p', quality: '720p', seeds: 100 },
        { title: 'Stream 1080p Low Seeds', quality: '1080p', seeds: 5 },
        { title: 'Stream 4K', quality: '4K', seeds: 10 },
        { title: 'Stream 1080p High Seeds', quality: '1080p', seeds: 500 }
      ];

      // Mock _fetchWithId to return the mock streams list
      service._fetchWithId = jest.fn().mockResolvedValue(mockStreams);
      
      const results = await service.getStreams({ imdbId: 'tt1234567', type: 'movie' });
      
      // Expected sort order: 4K (seeds: 10) -> 1080p High Seeds (500) -> 1080p Low Seeds (5) -> 720p (100)
      expect(results[0].quality).toBe('4K');
      expect(results[1].quality).toBe('1080p');
      expect(results[1].seeds).toBe(500);
      expect(results[2].quality).toBe('1080p');
      expect(results[2].seeds).toBe(5);
      expect(results[3].quality).toBe('720p');
    });
  });
});
