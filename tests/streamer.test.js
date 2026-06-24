describe('streamer unit tests', () => {
  let findBestVideoFile;

  beforeAll(() => {
    // Mock electron to prevent crashes on require
    jest.doMock('electron', () => ({
      app: {
        getPath: () => 'mock-path'
      }
    }));
    
    // Require streamer after mocking electron
    const streamer = require('../src/main/streamer');
    findBestVideoFile = streamer.findBestVideoFile;
  });

  describe('findBestVideoFile', () => {
    test('returns null for empty or null file list', () => {
      expect(findBestVideoFile(null)).toBeNull();
      expect(findBestVideoFile([])).toBeNull();
    });

    test('picks the single video file', () => {
      const files = [
        { name: 'movie.mp4', length: 1000 },
        { name: 'sample.txt', length: 50 }
      ];
      const result = findBestVideoFile(files);
      expect(result.name).toBe('movie.mp4');
    });

    test('picks the largest video file if multiple video files exist', () => {
      const files = [
        { name: 'sample.mp4', length: 50 },
        { name: 'feature.mkv', length: 5000 },
        { name: 'bonus.avi', length: 1500 }
      ];
      const result = findBestVideoFile(files);
      expect(result.name).toBe('feature.mkv');
    });

    test('ignores junk files and picks largest non-junk file as fallback', () => {
      const files = [
        { name: 'info.nfo', length: 100 },
        { name: 'unknown-ext.xyz', length: 2000 },
        { name: 'another-file.abc', length: 5000 }
      ];
      const result = findBestVideoFile(files);
      expect(result.name).toBe('another-file.abc');
    });

    test('picks largest file as last resort when all are junk', () => {
      const files = [
        { name: 'info.nfo', length: 100 },
        { name: 'sub.srt', length: 500 }
      ];
      const result = findBestVideoFile(files);
      expect(result.name).toBe('sub.srt');
    });
  });
});
