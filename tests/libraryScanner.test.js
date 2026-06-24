const { extractCleanTitle } = require('../src/main/libraryScanner');

describe('libraryScanner.extractCleanTitle', () => {
  test('removes quality tags and extensions and extra punctuation', () => {
    const input = 'My.Show.S01E01.1080p.BluRay.x264-GROUP.mkv';
    const out = extractCleanTitle(input);
    expect(out.startsWith('My Show')).toBe(true);
  });

  test('removes bracketed tags and multiple dots', () => {
    const input = 'Movie.Title.(2020).[YTS].1080p.web-dl.mkv';
    const out = extractCleanTitle(input);
    expect(out).toBe('Movie Title');
  });
});
