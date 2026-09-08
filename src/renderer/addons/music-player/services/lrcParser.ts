import type { LyricLine } from '../types/music';

/**
 * Parses standard LRC strings into sorted LyricLine objects with exact timestamps.
 * Supports single and multiple timestamps per line: [mm:ss.xx] Lyrics
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const timeRegex = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  const result: LyricLine[] = [];
  let lineCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip metadata headers like [ti:Title], [ar:Artist], etc.
    if (/^\[(ti|ar|al|au|by|length|re|ve|offset):.*\]$/i.test(trimmed)) {
      continue;
    }

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const lyricContent = trimmed.replace(timeRegex, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millisStr = match[3] || '0';
      const millis = parseInt(millisStr.padEnd(3, '0').slice(0, 3), 10);

      const totalTime = minutes * 60 + seconds + millis / 1000;

      result.push({
        id: ++lineCounter,
        time: totalTime,
        text: lyricContent || '♪',
      });
    }
  }

  // Sort chronologically
  return result.sort((a, b) => a.time - b.time);
}

/**
 * Fetches synced LRC lyrics from LRCLIB (free open-source lyrics API).
 */
export async function fetchLyricsFromLrclib(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration?: number
): Promise<{ syncedLyrics?: string; plainLyrics?: string } | null> {
  try {
    const params = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    });
    if (albumName) params.append('album_name', albumName);
    if (duration && duration > 0) params.append('duration', Math.round(duration).toString());

    // 1. Direct match endpoint
    const getUrl = `https://lrclib.net/api/get?${params.toString()}`;
    let res = await fetch(getUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics || data.plainLyrics) {
        return {
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
        };
      }
    }

    // 2. Search fallback endpoint
    const searchParams = new URLSearchParams({
      q: `${trackName} ${artistName}`.trim(),
    });
    const searchUrl = `https://lrclib.net/api/search?${searchParams.toString()}`;
    res = await fetch(searchUrl);
    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        // Pick best matching synced lyrics
        const bestMatch = results.find((r: any) => r.syncedLyrics) || results[0];
        return {
          syncedLyrics: bestMatch.syncedLyrics,
          plainLyrics: bestMatch.plainLyrics,
        };
      }
    }
  } catch (err) {
    console.warn('[LyricsService] Error fetching lyrics from LRCLIB:', err);
  }

  return null;
}
